/**
 * Scheduled cron endpoints.
 *
 * Auth: Bearer token in Authorization header, matching CRON_SECRET env var.
 * Vercel Cron sends this header automatically when CRON_SECRET is configured.
 *
 * Mounted in index.ts BEFORE the global authenticate middleware so Vercel can
 * call it without a session cookie.
 */

import { Router, Request, Response } from 'express';
import prisma from '../db/prisma';
import { smsAdapter } from '../sms/smsService';
import { outForDeliveryMessage } from '../sms/customerMessageTemplates';
import { normalizeUAEPhone } from '../utils/phoneUtils';
import { dubaiDayRangeUtc, getDubaiTodayIso } from '../services/deliveryCapacityService';

const cache = require('../cache');

const router = Router();

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function verifyCronSecret(req: Request): boolean {
  const expected = (process.env.CRON_SECRET || '').trim();
  if (!expected) return false;
  const header = String(req.header('authorization') || '').trim();
  // Vercel sends "Bearer <secret>". Accept the raw token too for manual triggers.
  const provided = header.toLowerCase().startsWith('bearer ')
    ? header.slice(7).trim()
    : header;
  if (!provided) return false;
  return constantTimeEqual(provided, expected);
}

interface PromotableRow {
  id: string;
  status: string;
  confirmedDeliveryDate: Date | null;
  goodsMovementDate: Date | null;
  phone: string | null;
  customer: string | null;
  poNumber: string | null;
  confirmationToken: string | null;
}

/**
 * Promote pickup-confirmed orders for today (or overdue) into out-for-delivery
 * and fan-out the "on the way" SMS. Designed to be called once a day at 08:00
 * Dubai (= 04:00 UTC) by Vercel Cron, but is idempotent and safe to re-trigger.
 */
async function dispatchMorning(): Promise<{ promoted: number; smsQueued: number; alreadyDispatched: boolean }> {
  const todayIso = getDubaiTodayIso();
  const { end: todayEnd } = dubaiDayRangeUtc(todayIso);

  const promotable = await prisma.delivery.findMany({
    where: {
      status: { in: ['pickup-confirmed', 'pickup_confirmed'] },
      OR: [
        { confirmedDeliveryDate: { lte: todayEnd } },
        { AND: [{ confirmedDeliveryDate: null }, { goodsMovementDate: { lte: todayEnd } }] },
      ],
      assignments: {
        some: { status: { in: ['assigned', 'in_progress'] } },
      },
    },
    select: {
      id: true,
      status: true,
      confirmedDeliveryDate: true,
      goodsMovementDate: true,
      phone: true,
      customer: true,
      poNumber: true,
      confirmationToken: true,
    },
  }) as PromotableRow[];

  if (promotable.length === 0) {
    return { promoted: 0, smsQueued: 0, alreadyDispatched: true };
  }

  const ids = promotable.map(p => p.id);

  // Atomic: flip status, promote assignments, write audit events.
  await prisma.$transaction(async (tx: typeof prisma) => {
    await tx.delivery.updateMany({
      where: { id: { in: ids } },
      data: { status: 'out-for-delivery', updatedAt: new Date() },
    });
    await tx.deliveryAssignment.updateMany({
      where: { deliveryId: { in: ids }, status: 'assigned' },
      data: { status: 'in_progress' },
    });
    await tx.deliveryEvent.createMany({
      data: promotable.map(p => ({
        deliveryId: p.id,
        eventType: 'auto_dispatch_morning_cron',
        payload: {
          fromStatus: p.status,
          toStatus: 'out-for-delivery',
          reason: 'morning_dispatch_08_dubai',
          confirmedDeliveryDate: p.confirmedDeliveryDate?.toISOString() ?? null,
          goodsMovementDate: p.goodsMovementDate?.toISOString() ?? null,
        },
        actorType: 'system',
        actorId: null,
      })),
    });
  });

  cache.invalidatePrefix('tracking:');
  cache.invalidatePrefix('dashboard:');
  cache.invalidatePrefix('deliveries:list:');

  // Fan-out SMS — fire-and-forget so we return 200 quickly.
  // SMS failures are logged per-row and never block the status flip.
  let smsQueued = 0;
  const frontendUrl = process.env.FRONTEND_URL || 'https://electrolux-smart-portal.vercel.app';
  for (const row of promotable) {
    if (!row.phone || !smsAdapter) continue;
    smsQueued += 1;
    const normalizedPhone = normalizeUAEPhone(row.phone) || row.phone;
    const trackingLink = row.confirmationToken
      ? `${frontendUrl}/customer-tracking/${row.confirmationToken}`
      : null;
    const customerName = row.customer || 'Valued Customer';
    const poRef = row.poNumber ? `#${row.poNumber}` : '';
    const smsBody = outForDeliveryMessage(customerName, poRef, trackingLink);
    void (async () => {
      let sendStatus = 'failed';
      try {
        const result = await smsAdapter!.sendSms({
          to: normalizedPhone,
          body: smsBody,
          metadata: { deliveryId: row.id, type: 'status_out_for_delivery', triggeredBy: 'morning_cron' },
        });
        sendStatus = (result?.messageId || result?.status === 'accepted' || result?.status === 'queued') ? 'sent' : 'failed';
      } catch (err: unknown) {
        console.warn(`[cron/dispatch-morning] SMS failed for ${row.id}:`, (err as Error).message);
      }
      try {
        await (prisma as any).smsLog.create({
          data: {
            deliveryId: row.id,
            phoneNumber: normalizedPhone,
            messageContent: smsBody,
            smsProvider: process.env.SMS_PROVIDER || 'd7',
            status: sendStatus,
            sentAt: new Date(),
            metadata: { type: 'status_out_for_delivery', triggeredBy: 'morning_cron' },
          },
        });
      } catch (logErr: unknown) {
        console.warn(`[cron/dispatch-morning] smsLog write failed for ${row.id}:`, (logErr as Error).message);
      }
    })();
  }

  return { promoted: promotable.length, smsQueued, alreadyDispatched: false };
}

router.get('/health', (req: Request, res: Response): void => {
  const ok = verifyCronSecret(req);
  res.status(ok ? 200 : 401).json({ ok, configured: Boolean(process.env.CRON_SECRET) });
});

const dispatchMorningHandler = async (req: Request, res: Response): Promise<void> => {
  if (!verifyCronSecret(req)) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  try {
    const result = await dispatchMorning();
    console.log('[cron/dispatch-morning]', JSON.stringify(result));
    res.json({ ok: true, ...result });
  } catch (err: unknown) {
    const e = err as { message?: string };
    console.error('[cron/dispatch-morning] error:', e.message);
    res.status(500).json({ error: 'dispatch_failed', detail: e.message });
  }
};

router.get('/dispatch-morning', dispatchMorningHandler);
router.post('/dispatch-morning', dispatchMorningHandler);

export default router;
