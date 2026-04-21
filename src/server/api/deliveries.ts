import { Router, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { sendWhatsApp, sendWhatsAppDeliveryConfirmation, isWhatsAppConfigured } from '../sms/whatsappApiAdapter';
import { buildWhatsAppLink } from '../sms/waLink';
import {
  confirmationRequestMessage,
  outForDeliveryMessage,
  orderDelayMessage,
  deliveryCompletedMessage,
  driverArrivingMessage
} from '../sms/customerMessageTemplates';
import { smsAdapter } from '../sms/smsService';
import { normalizeUAEPhone } from '../utils/phoneUtils';
import {
  assertSlotAvailable,
  dubaiDayRangeUtc,
  getDubaiWeekday,
  getDubaiTodayIso,
  addDubaiCalendarDays,
  getNextSevenEligibleDayIsoStrings,
  getDriverItemCountForDate,
  parseDeliveryItemCount,
  TRUCK_MAX_ITEMS_PER_DAY
} from '../services/deliveryCapacityService';
const router = Router();
const { authenticate, requireRole, requireAnyRole } = require('../auth');
const sapService = require('../services/sapService.js');
const { autoAssignDelivery, autoAssignDeliveries, getAvailableDrivers } = require('../services/autoAssignmentService');
const { buildBusinessKey, upsertDeliveryByBusinessKey } = require('../services/deliveryDedupService');
const prisma = require('../db/prisma').default;
const cache = require('../cache');
const { sortDeliveriesIncompleteLast } = require('../utils/deliveryListSort');
const { normalizePhone } = require('../utils/phoneUtils');

async function deliveryExists(deliveryId: string): Promise<boolean> {
  try {
    const resp = await sapService.call(`/Deliveries/${deliveryId}`, 'get');
    return resp && resp.status && resp.status < 400;
  } catch (e) {
    return false;
  }
}

// POST /api/deliveries/:id/status
// body: { status, actor_type, actor_id, note }
router.post('/:id/status', authenticate, async (req: Request, res: Response): Promise<void> => {
  const { id: deliveryId } = req.params as { id: string };
  const { status, actor_type, actor_id, note } = req.body as {
    status?: string; actor_type?: string; actor_id?: string; note?: string;
  };

  if (!status) return void res.status(400).json({ error: 'status_required' });

  const exists = await deliveryExists(deliveryId);
  if (!exists) return void res.status(404).json({ error: 'delivery_not_found' });

  try {
    // Forward status update to SAP
    const payload = { status, actor_type, actor_id, note };
    const resp = await sapService.call(`/Deliveries/${deliveryId}/status`, 'post', payload);
    res.status(resp.status || 200).json({ ok: true, status: status, data: resp.data });
  } catch (err: unknown) {
    const e = err as { message?: string; response?: { status?: number } };
    console.error('deliveries status update error (sap)', err);
    const statusCode = e.response && e.response.status ? e.response.status : 500;
    res.status(statusCode).json({ error: 'sap_error', detail: e.message });
  }
});

// Shared status update logic - used by both admin and driver
async function updateDeliveryStatusHandler(
  req: Request,
  deliveryIdParam: string,
  body: {
    status?: string;
    notes?: string;
    driverSignature?: string;
    customerSignature?: string;
    photos?: Array<string | { data?: string; name?: string; id?: string; type?: string }>;
    actualTime?: string;
    customer?: string;
    address?: string;
    scheduledDate?: string;
    goodsMovementDate?: string;
  },
  options: { requireAssignment?: boolean; driverId?: string }
): Promise<{ ok: boolean; delivery?: unknown; previousDelivery?: unknown; error?: string }> {
  const { status, notes, driverSignature, customerSignature, photos, actualTime, customer, address, scheduledDate } = body;
  if (!status) return { ok: false, error: 'status_required' };

  let existingDelivery: Record<string, unknown> | null = null;
  try {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (uuidRegex.test(deliveryIdParam)) {
      existingDelivery = await prisma.delivery.findUnique({ where: { id: deliveryIdParam } });
    }
  } catch {
    /* ignore */
  }

  if (!existingDelivery && customer && address) {
    existingDelivery = await prisma.delivery.findFirst({
      where: { customer, address },
      orderBy: { createdAt: 'desc' }
    });
  }

  if (!existingDelivery) return { ok: false, error: 'delivery_not_found' };

  // Guard: dispatch statuses require Goods Movement Date to be set on the delivery.
  // Normalise underscore ↔ hyphen variants so both UI formats are covered:
  //   types/delivery.ts uses out_for_delivery (underscore)
  //   API / DB stores   out-for-delivery (hyphen)
  // Rule: without a GMD the warehouse has NOT dispatched the item, so the system
  // must refuse any attempt to move it into a dispatch status.
  const DISPATCH_STATUSES_GUARD = new Set([
    'out-for-delivery', 'out_for_delivery',
    'dispatched',
    'on-route', 'on_route',
  ]);
  if (status && DISPATCH_STATUSES_GUARD.has(status.toLowerCase())) {
    const existingGMD = (existingDelivery as Record<string, unknown>).goodsMovementDate;
    const bodyGMD = (body as Record<string, unknown>).goodsMovementDate;
    const hasGMD = !!(existingGMD || bodyGMD);
    if (!hasGMD) {
      return {
        ok: false,
        error: 'goods_movement_date_required',
      };
    }
  }

  if (options.requireAssignment && options.driverId) {
    const assignment = await prisma.deliveryAssignment.findFirst({
      where: { deliveryId: existingDelivery.id as string, driverId: options.driverId }
    });
    if (!assignment) {
      return { ok: false, error: 'delivery_not_assigned_to_driver' };
    }
  }

  const prevMeta = existingDelivery.metadata && typeof existingDelivery.metadata === 'object'
    ? (existingDelivery.metadata as Record<string, unknown>) : {};
  const nextMeta: Record<string, unknown> = {
    ...prevMeta,
    statusUpdatedAt: new Date().toISOString(),
    statusUpdatedBy: req.user?.sub || 'admin',
    actualTime: actualTime != null ? actualTime : (prevMeta.actualTime ?? null),
  };
  if (scheduledDate != null && String(scheduledDate).trim() !== '') {
    try {
      const d = new Date(scheduledDate);
      if (!Number.isNaN(d.getTime())) nextMeta.scheduledDate = d.toISOString();
    } catch {
      /* ignore */
    }
  }

  const updateData: Record<string, unknown> = {
    status,
    metadata: nextMeta,
    updatedAt: new Date()
  };
  // If a Goods Movement Date is being set for the first time alongside a dispatch status, persist it
  if (body.goodsMovementDate) {
    const gmdDate = new Date(String(body.goodsMovementDate));
    if (!isNaN(gmdDate.getTime())) {
      updateData.goodsMovementDate = gmdDate;
    }
  }
  if (driverSignature) updateData.driverSignature = driverSignature;
  if (customerSignature) updateData.customerSignature = customerSignature;
  if (photos && Array.isArray(photos) && photos.length > 0) {
    updateData.photos = photos.map((p) => ({
      data: typeof p === 'string' ? p : ((p as { data?: string }).data || p),
      name: typeof p === 'object' && p != null ? ((p as { name?: string }).name || null) : null
    }));
  }
  if (notes) {
    updateData.deliveryNotes = notes;
    updateData.conditionNotes = notes;
  }
  if (['delivered', 'completed', 'delivered-with-installation', 'delivered-without-installation',
       'pod-completed', 'finished'].includes(status.toLowerCase())) {
    updateData.deliveredAt = new Date();
    updateData.deliveredBy = req.user?.username || req.user?.email || req.user?.sub || 'driver';
    updateData.podCompletedAt = new Date();
  }

  const isTerminalStatus = ['delivered', 'completed', 'delivered-with-installation',
    'delivered-without-installation', 'pod-completed', 'finished', 'cancelled', 'rejected', 'returned', 'failed'].includes(status.toLowerCase());

  // Run delivery update + assignment closure atomically so both succeed or both fail.
  // Driver status recalculation runs outside the transaction (read-then-write, low-risk).
  let updatedDelivery: Record<string, unknown>;
  let affectedDriverIds: string[] = [];

  try {
    const txResult = await prisma.$transaction(async (tx: typeof prisma) => {
      const updated = await tx.delivery.update({
        where: { id: existingDelivery!.id },
        data: updateData
      }) as Record<string, unknown>;

      let closedAssignmentDriverIds: string[] = [];
      if (isTerminalStatus) {
        const closing = await tx.deliveryAssignment.findMany({
          where: { deliveryId: existingDelivery!.id as string, status: { in: ['assigned', 'in_progress'] } },
          select: { driverId: true }
        });
        closedAssignmentDriverIds = Array.from(new Set<string>(closing.map((a: { driverId: string }) => a.driverId)));
        await tx.deliveryAssignment.updateMany({
          where: { deliveryId: existingDelivery!.id as string, status: { in: ['assigned', 'in_progress'] } },
          data: { status: 'completed' }
        });
      }
      return { updated, closedAssignmentDriverIds };
    });
    updatedDelivery = txResult.updated;
    affectedDriverIds = txResult.closedAssignmentDriverIds;
  } catch (txErr: unknown) {
    console.error('[Deliveries] Status update transaction failed:', (txErr as Error).message);
    return { ok: false, error: 'status_update_failed' };
  }

  // After transaction: recalculate driver availability (outside tx — read-then-write is safe here)
  for (const driverId of affectedDriverIds) {
    try {
      const remaining = await prisma.deliveryAssignment.count({
        where: { driverId, status: { in: ['assigned', 'in_progress'] } }
      });
      if (remaining === 0) {
        await prisma.driverStatus.upsert({
          where: { driverId },
          update: { status: 'available', currentAssignmentId: null, updatedAt: new Date() },
          create: { driverId, status: 'available' }
        });
      }
    } catch (e: unknown) {
      console.warn('[Deliveries] Failed to reset driver status:', (e as Error).message);
    }
  }

  // Bust caches so the next admin reload reflects the change immediately
  cache.invalidatePrefix('tracking:');
  cache.invalidatePrefix('deliveries:list:');

  // When an order is confirmed for delivery (scheduled-confirmed):
  // Auto-assign a driver if none yet, so the driver can see upcoming work
  // before the admin formally dispatches.
  if (status.toLowerCase() === 'scheduled-confirmed') {
    try {
      const existingAssignment = await prisma.deliveryAssignment.findFirst({
        where: {
          deliveryId: existingDelivery.id as string,
          status: { in: ['assigned', 'in_progress'] }
        }
      });
      if (!existingAssignment) {
        await autoAssignDelivery(existingDelivery.id as string);
      }
    } catch (assignErr: unknown) {
      // Non-fatal — log but don't fail the status update.
      console.warn('[Deliveries] scheduled-confirmed auto-assign failed:', (assignErr as Error).message);
    }
  }

  // When dispatching (out-for-delivery):
  // 1. Auto-assign a driver if none is assigned yet (so the driver sees the order).
  // 2. Promote any existing assignment to in_progress so the driver's portal shows
  //    the delivery as actively in transit.
  if (status.toLowerCase() === 'out-for-delivery') {
    try {
      const activeAssignment = await prisma.deliveryAssignment.findFirst({
        where: {
          deliveryId: existingDelivery.id as string,
          status: { in: ['assigned', 'in_progress'] }
        }
      });
      if (!activeAssignment) {
        // No driver yet — auto-assign so the order lands in a driver's list.
        await autoAssignDelivery(existingDelivery.id as string);
      } else {
        // Promote to in_progress so the driver knows they're actively en route.
        await prisma.deliveryAssignment.updateMany({
          where: {
            deliveryId: existingDelivery.id as string,
            status: 'assigned'
          },
          data: { status: 'in_progress' }
        });
      }
    } catch (dispatchErr: unknown) {
      // Non-fatal — log but don't fail the status update.
      console.warn('[Deliveries] dispatch assignment step failed:', (dispatchErr as Error).message);
    }
  }

  await prisma.deliveryEvent.create({
    data: {
      deliveryId: existingDelivery.id,
      eventType: 'status_updated',
      payload: {
        previousStatus: existingDelivery.status,
        newStatus: status,
        notes,
        actualTime,
        hasPOD: !!(driverSignature || customerSignature || (photos && photos.length > 0)),
        photoCount: photos ? photos.length : 0,
        hasDriverSignature: !!driverSignature,
        hasCustomerSignature: !!customerSignature,
        updatedAt: new Date().toISOString()
      },
      actorType: req.user?.role || 'driver',
      actorId: req.user?.sub || null
    }
  }).catch((err: unknown) => {
    console.warn(`[Deliveries] Failed to create audit event:`, (err as Error).message);
  });

  cache.invalidatePrefix('tracking:');
  cache.invalidatePrefix('dashboard:');
  cache.invalidatePrefix('deliveries:list:v2');

  return { ok: true, delivery: updatedDelivery, previousDelivery: existingDelivery };
}

// PUT /api/deliveries/driver/:id/status - Driver POD/status update (assigned deliveries only)
router.put('/driver/:id/status', authenticate, requireRole('driver'), async (req: Request, res: Response): Promise<void> => {
  const { id: deliveryIdParam } = req.params as { id: string };
  const driverId = (req.user as { sub?: string })?.sub;
  if (!driverId) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  const body = req.body as {
    status?: string;
    notes?: string;
    driverSignature?: string;
    customerSignature?: string;
    photos?: Array<string | { data?: string; name?: string }>;
    actualTime?: string;
    customer?: string;
    address?: string;
  };
  try {
    const result = await updateDeliveryStatusHandler(req, deliveryIdParam, body, {
      requireAssignment: true,
      driverId
    });
    if (!result.ok) {
      const code = result.error === 'delivery_not_found' ? 404 : result.error === 'delivery_not_assigned_to_driver' ? 403 : 400;
      res.status(code).json({ error: result.error || 'update_failed' });
      return;
    }

    // Fire-and-forget: notify customer for key driver-triggered status changes
    const lowerStatus = (body.status || '').toLowerCase();
    const updatedDelivery = result.delivery as Record<string, unknown>;
    const previousDelivery = result.previousDelivery as Record<string, unknown> | undefined;
    const phone = (updatedDelivery.phone || previousDelivery?.phone) as string | undefined;
    if (phone) {
      (async () => {
        try {
          const normalizedPhone = normalizeUAEPhone(phone) || phone;
          const frontendUrl = process.env.FRONTEND_URL || 'https://electrolux-smart-portal.vercel.app';
          const token = (updatedDelivery.confirmationToken || previousDelivery?.confirmationToken) as string | undefined;
          const trackingLink = token ? `${frontendUrl}/customer-tracking/${token}` : null;
          const customerName = (updatedDelivery.customer || previousDelivery?.customer || 'Valued Customer') as string;
          const poNum = (updatedDelivery.poNumber || previousDelivery?.poNumber) as string | undefined;
          const poRef = poNum ? `#${poNum}` : '';

          // Shared send helper: D7 SMS → WhatsApp API → deep-link
          const trySend = async (msgBody: string, msgType: string): Promise<void> => {
            let provider = 'd7';
            let status = 'sent';
            try {
              if (smsAdapter) {
                await smsAdapter.sendSms({ to: normalizedPhone, body: msgBody, metadata: { deliveryId: deliveryIdParam, type: msgType } });
                console.log(`[Driver SMS] ${msgType} sent to ${normalizedPhone}`);
              } else throw new Error('no smsAdapter');
            } catch {
              if (isWhatsAppConfigured()) {
                try {
                  provider = 'whatsapp-api';
                  const waRes = await sendWhatsApp(normalizedPhone, msgBody);
                  status = waRes.ok ? 'sent' : 'failed';
                  console.log(`[Driver WhatsApp] ${msgType} to ${normalizedPhone}:`, waRes.ok ? 'ok' : waRes.error);
                } catch {
                  provider = 'whatsapp-link';
                  status = 'whatsapp_link_generated';
                }
              } else {
                provider = 'whatsapp-link';
                status = 'whatsapp_link_generated';
              }
            }
            await prisma.smsLog.create({ data: { deliveryId: deliveryIdParam, phoneNumber: normalizedPhone, messageContent: msgBody, smsProvider: provider, status, sentAt: new Date(), metadata: { type: msgType } } });
          };

          // Out for delivery — driver marked order as dispatched
          if (lowerStatus === 'out-for-delivery') {
            await trySend(outForDeliveryMessage(customerName, poRef, trackingLink), 'status_out_for_delivery');
          }

          // Delivery completed — driver submitted POD
          const completionStatuses = ['completed', 'delivered', 'delivered-with-installation', 'delivered-without-installation', 'pod-completed', 'finished'];
          const prevStatus = String(previousDelivery?.status || '').toLowerCase();
          if (completionStatuses.includes(lowerStatus) && !completionStatuses.includes(prevStatus)) {
            await trySend(deliveryCompletedMessage(customerName, poRef), 'status_order_finished');
          }

          // Rejected or cancelled — treat as a terminal / "finished" order from the
          // customer's perspective and send the same thank-you message we use for
          // a successful delivery. (Business decision: thank the customer either way.)
          const cancelStatuses = ['cancelled', 'rejected'];
          if (cancelStatuses.includes(lowerStatus) && !cancelStatuses.includes(prevStatus)) {
            console.log(`[Driver SMS] Firing rejection/cancel SMS for delivery ${deliveryIdParam}, prev=${prevStatus}, new=${lowerStatus}, phone=${normalizedPhone}`);
            await trySend(deliveryCompletedMessage(customerName, poRef), 'status_order_finished');
          }
        } catch (notifyErr: unknown) {
          console.warn('[Deliveries] Driver status SMS notify failed:', (notifyErr as Error).message);
        }
      })();
    }

    res.json({ ok: true, delivery: result.delivery });
  } catch (err: unknown) {
    const e = err as { message?: string };
    console.error('[Deliveries] Driver status update error:', err);
    res.status(500).json({ error: 'db_error', detail: e.message });
  }
});

// POST /api/deliveries/driver/route/start — persist the driver's Start Delivery
// snapshot (plannedEta + staticEta + routeStartedAt) onto each assigned
// delivery's metadata so the customer-tracking portal can display the locked
// plan ETA (not the live GPS ETA, which shifts every GPS tick).
// Body: { startedAt: string (ISO), stops: [{ deliveryId, plannedEta, staticEta }] }
router.post('/driver/route/start', authenticate, requireRole('driver'), async (req: Request, res: Response): Promise<void> => {
  const driverId = (req.user as { sub?: string })?.sub;
  if (!driverId) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  const body = req.body as {
    startedAt?: string;
    stops?: Array<{ deliveryId?: string; plannedEta?: string | null; staticEta?: string | null }>;
  };
  const stops = Array.isArray(body.stops) ? body.stops : [];
  if (stops.length === 0) {
    res.status(400).json({ error: 'no_stops' });
    return;
  }
  const startedAt = body.startedAt && !Number.isNaN(Date.parse(body.startedAt))
    ? new Date(body.startedAt).toISOString()
    : new Date().toISOString();

  const results: Array<{ deliveryId: string; ok: boolean; error?: string }> = [];

  for (const stop of stops) {
    if (!stop.deliveryId || typeof stop.deliveryId !== 'string') continue;
    try {
      // Only allow a driver to stamp deliveries they are actually assigned to.
      const assignment = await prisma.deliveryAssignment.findFirst({
        where: { deliveryId: stop.deliveryId, driverId },
      });
      if (!assignment) {
        results.push({ deliveryId: stop.deliveryId, ok: false, error: 'not_assigned' });
        continue;
      }
      const existing = await prisma.delivery.findUnique({
        where: { id: stop.deliveryId },
        select: { metadata: true },
      });
      if (!existing) {
        results.push({ deliveryId: stop.deliveryId, ok: false, error: 'not_found' });
        continue;
      }
      const currentMeta = (existing.metadata as Record<string, unknown> | null) ?? {};
      // Use the freshly-locked ETA from the driver's tap when it's truthy, so a
      // re-click after a stale/bad write heals the value on the next Start.
      // Only keep the existing value if the driver's new payload is empty.
      const newPlanned = typeof stop.plannedEta === 'string' && stop.plannedEta.trim() ? stop.plannedEta : null;
      const newStatic  = typeof stop.staticEta  === 'string' && stop.staticEta.trim()  ? stop.staticEta  : null;
      const nextMeta: Record<string, unknown> = {
        ...currentMeta,
        routeStartedAt: startedAt,
        plannedEta: newPlanned ?? (currentMeta.plannedEta ?? null),
        staticEta:  newStatic  ?? (currentMeta.staticEta  ?? null),
      };
      await prisma.delivery.update({
        where: { id: stop.deliveryId },
        data: { metadata: nextMeta },
      });
      console.log(`[route/start] delivery=${stop.deliveryId} plannedEta=${nextMeta.plannedEta} staticEta=${nextMeta.staticEta} startedAt=${startedAt}`);
      results.push({ deliveryId: stop.deliveryId, ok: true });
    } catch (stopErr: unknown) {
      const e = stopErr as { message?: string };
      console.warn(`[Deliveries] route/start failed for ${stop.deliveryId}:`, e.message);
      results.push({ deliveryId: stop.deliveryId, ok: false, error: 'db_error' });
    }
  }

  // Bust tracking caches so the new planned ETA surfaces on the customer
  // tracking page and the admin/logistics tracking views immediately.
  cache.invalidatePrefix('tracking:');

  res.json({ ok: true, results });
});

// PUT /api/admin/deliveries/:id/priority - Toggle manual priority (delivery team + admin only)
// Priority is a business decision owned by the Delivery Team; Logistics cannot set it.
// body: { isPriority: boolean }
router.put('/admin/:id/priority', authenticate, requireAnyRole('admin', 'delivery_team'), async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params as { id: string };
  const { isPriority } = req.body as { isPriority?: boolean };

  try {
    const existing = await prisma.delivery.findUnique({ where: { id }, select: { metadata: true } });
    if (!existing) {
      res.status(404).json({ error: 'not_found' });
      return;
    }

    const currentMeta = (existing.metadata as Record<string, unknown>) ?? {};
    const updatedMeta = { ...currentMeta, isPriority: isPriority === true };

    await prisma.delivery.update({
      where: { id },
      data: { metadata: updatedMeta },
    });

    // Invalidate caches so both portals see the updated priority immediately
    cache.invalidatePrefix('tracking:');
    cache.invalidatePrefix('dashboard:');
    cache.invalidatePrefix('deliveries:list:');

    res.json({ ok: true, isPriority: updatedMeta.isPriority });
  } catch (err: unknown) {
    const e = err as { message?: string };
    console.error('[Deliveries] Priority update error:', e.message);
    res.status(500).json({ error: 'db_error' });
  }
});

// PUT /api/admin/deliveries/:id/status - Update delivery status in database
// body: { status, notes, driverSignature, customerSignature, photos, actualTime, customer, address }
router.put('/admin/:id/status', authenticate, requireAnyRole('admin', 'delivery_team', 'logistics_team'), async (req: Request, res: Response): Promise<void> => {
  const { id: deliveryIdParam } = req.params as { id: string };
  const body = req.body as {
    status?: string;
    notes?: string;
    driverSignature?: string;
    customerSignature?: string;
    photos?: Array<string | { data?: string; name?: string; id?: string; type?: string }>;
    actualTime?: string;
    customer?: string;
    address?: string;
    scheduledDate?: string;
    goodsMovementDate?: string;
  };

  try {
    console.log(`[Deliveries] Admin updating delivery ${deliveryIdParam} status to ${body.status}`);
    const result = await updateDeliveryStatusHandler(req, deliveryIdParam, body, {});
    if (!result.ok) {
      const code = result.error === 'delivery_not_found' ? 404 : 400;
      res.status(code).json({ error: result.error || 'update_failed' });
      return;
    }
    const updatedDelivery = result.delivery as Record<string, unknown>;
    const existingDelivery = result.previousDelivery as Record<string, unknown>;
    const status = body.status || '';

    // Create admin notification for status change (fire-and-forget)
    prisma.adminNotification.create({
      data: {
        type: 'status_changed',
        title: 'Delivery Status Updated',
        message: `${existingDelivery?.customer || 'Unknown customer'} — ${existingDelivery?.address || 'Unknown address'}: ${existingDelivery?.status} → ${status}`,
        payload: {
          deliveryId: existingDelivery?.id,
          customer: existingDelivery?.customer,
          address: existingDelivery?.address,
          poNumber: existingDelivery?.poNumber,
          previousStatus: existingDelivery?.status,
          newStatus: status,
          updatedBy: req.user?.username || req.user?.sub || 'admin'
        }
      }
    }).catch((err: unknown) => {
      const e = err as { message?: string };
      console.warn(`[Deliveries] Failed to create status notification:`, e.message);
    });

    // Optionally notify customer by SMS for key status changes
    let statusWhatsappUrl: string | undefined;
    try {
      const lowerStatus = (status || '').toLowerCase();
      const phone = (updatedDelivery.phone || existingDelivery.phone) as string | undefined;

      if (phone) {
        const normalizedPhone = normalizeUAEPhone(phone) || phone;
        const frontendUrl = process.env.FRONTEND_URL || 'https://electrolux-smart-portal.vercel.app';
        const token = (updatedDelivery.confirmationToken || existingDelivery.confirmationToken) as string | undefined;
        const trackingLink = token ? `${frontendUrl}/customer-tracking/${token}` : null;
        const customerName = (updatedDelivery.customer || existingDelivery.customer || 'Valued Customer') as string;
        const poNum = (updatedDelivery.poNumber || existingDelivery.poNumber) as string | undefined;
        const poRef = poNum ? `#${poNum}` : '';

        // ── Helper: send via D7 SMS → WhatsApp API → deep-link (always delivers) ──
        const silentSend = async (msgBody: string, msgType: string): Promise<string | undefined> => {
          let waUrl: string | undefined;
          let sendStatus = 'sent';
          let smsProvider = 'd7';

          try {
            // Primary: D7 Networks SMS
            if (smsAdapter) {
              const result = await smsAdapter.sendSms({
                to: normalizedPhone,
                body: msgBody,
                metadata: { deliveryId: updatedDelivery.id as string, type: msgType }
              });
              sendStatus = result?.messageId ? 'sent' : 'failed';
              console.log(`[D7 SMS] ${msgType} sent to ${normalizedPhone}: ${sendStatus}`);
            } else {
              throw new Error('smsAdapter not configured — trying WhatsApp');
            }
          } catch (smsErr: unknown) {
            const se = smsErr as { message?: string };
            console.warn(`[SMS] D7 SMS failed for ${msgType} (${se.message}) — trying WhatsApp API`);
            // Fallback 1: WhatsApp API via D7
            if (isWhatsAppConfigured()) {
              try {
                smsProvider = 'whatsapp-api';
                const waRes = await sendWhatsApp(normalizedPhone, msgBody);
                sendStatus = waRes.ok ? 'sent' : 'failed';
                console.log(`[WhatsApp] ${msgType} to ${normalizedPhone}:`, waRes.ok ? 'ok' : waRes.error);
              } catch (waErr: unknown) {
                const we = waErr as { message?: string };
                console.warn(`[WhatsApp] ${msgType} also failed (${we.message}) — deep-link fallback`);
                smsProvider = 'whatsapp-link';
                sendStatus = 'whatsapp_link_generated';
                waUrl = buildWhatsAppLink(normalizedPhone, msgBody);
              }
            } else {
              // Last resort: wa.me deep-link
              smsProvider = 'whatsapp-link';
              sendStatus = 'whatsapp_link_generated';
              waUrl = buildWhatsAppLink(normalizedPhone, msgBody);
              console.log(`[SMS] No WhatsApp credentials — deep-link fallback for ${msgType}`);
            }
          }

          await prisma.smsLog.create({
            data: {
              deliveryId: updatedDelivery.id as string,
              phoneNumber: normalizedPhone,
              messageContent: msgBody,
              smsProvider,
              status: sendStatus,
              sentAt: new Date(),
              metadata: { type: msgType, ...(waUrl ? { whatsappUrl: waUrl } : {}) }
            }
          });
          return waUrl;
        };

        // Out for delivery
        if (lowerStatus === 'out-for-delivery') {
          const body = outForDeliveryMessage(customerName, poRef, trackingLink);
          statusWhatsappUrl = await silentSend(body, 'status_out_for_delivery');
        }

        // Order delay
        if (lowerStatus === 'order-delay') {
          const body = orderDelayMessage(customerName, poRef, trackingLink);
          statusWhatsappUrl = await silentSend(body, 'status_order_delay');
        }

        // Cancelled or rejected — send the same thank-you message used for delivered
        // orders (business decision: the order is "closed" from the customer's POV).
        if (lowerStatus === 'cancelled' || lowerStatus === 'rejected') {
          const body = deliveryCompletedMessage(customerName, poRef);
          statusWhatsappUrl = await silentSend(body, 'status_order_finished');
        }

        // Completed / delivered variants — all trigger the delivery-completed message
        const prevStatus = (String(existingDelivery.status || '')).toLowerCase();
        const completionStatuses = [
          'completed', 'delivered', 'delivered-with-installation',
          'delivered-without-installation', 'pod-completed', 'finished'
        ];
        const wasAlreadyFinished = completionStatuses.includes(prevStatus);

        if (completionStatuses.includes(lowerStatus) && !wasAlreadyFinished) {
          const body = deliveryCompletedMessage(customerName, poRef);
          statusWhatsappUrl = await silentSend(body, 'status_order_finished');
        }
      }
    } catch (notifyErr: unknown) {
      const ne = notifyErr as { message?: string };
      console.warn('[Deliveries] Failed to send customer status SMS:', ne.message);
    }

    res.json({
      ok: true,
      status: status,
      whatsappUrl: statusWhatsappUrl || null,  // frontend auto-opens this to notify customer
      delivery: {
        id: updatedDelivery.id,
        customer: updatedDelivery.customer,
        address: updatedDelivery.address,
        status: updatedDelivery.status,
        updatedAt: updatedDelivery.updatedAt
      }
    });
  } catch (err: unknown) {
    const e = err as { message?: string };
    console.error('deliveries status update error (database)', err);
    res.status(500).json({ error: 'status_update_failed', detail: e.message });
  }
});

// PUT /admin/:id/contact - Update delivery contact details (address, phone, lat, lng)
router.put('/admin/:id/contact', authenticate, requireAnyRole('admin', 'delivery_team', 'logistics_team'), async (req: Request, res: Response): Promise<void> => {
  const { id: deliveryIdParam } = req.params as { id: string };
  const { customer, address, phone, lat, lng } = req.body as {
    customer?: string; address?: string; phone?: string; lat?: unknown; lng?: unknown;
  };

  if (!address && !phone) {
    return void res.status(400).json({ error: 'address_or_phone_required' });
  }

  try {
    console.log(`[Deliveries] Updating contact for delivery ${deliveryIdParam}`);

    let existingDelivery: Record<string, unknown> | null = null;

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (uuidRegex.test(deliveryIdParam)) {
      existingDelivery = await prisma.delivery.findUnique({ where: { id: deliveryIdParam } });
    }

    if (!existingDelivery && customer && address) {
      existingDelivery = await prisma.delivery.findFirst({
        where: { customer, address },
        orderBy: { createdAt: 'desc' }
      });
    }

    if (!existingDelivery) {
      console.warn(`[Deliveries] Delivery not found for contact update: id=${deliveryIdParam}`);
      return void res.status(404).json({ error: 'delivery_not_found' });
    }

    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (address) updateData.address = address;
    if (phone)   updateData.phone = phone;
    if (lat != null && !Number.isNaN(Number(lat)))  updateData.lat = Number(lat);
    if (lng != null && !Number.isNaN(Number(lng)))  updateData.lng = Number(lng);

    const updatedDelivery = await prisma.delivery.update({
      where: { id: existingDelivery.id },
      data: updateData
    }) as Record<string, unknown>;

    cache.invalidatePrefix('tracking:');
    cache.invalidatePrefix('dashboard:');
    cache.del('deliveries:list:v2');

    console.log(`[Deliveries] Contact updated for delivery ${existingDelivery.id}`);

    res.json({
      ok: true,
      delivery: {
        id: updatedDelivery.id,
        customer: updatedDelivery.customer,
        address: updatedDelivery.address,
        phone: updatedDelivery.phone,
        lat: updatedDelivery.lat,
        lng: updatedDelivery.lng,
        updatedAt: updatedDelivery.updatedAt
      }
    });
  } catch (err: unknown) {
    const e = err as { message?: string };
    console.error('[Deliveries] contact update error:', err);
    res.status(500).json({ error: 'contact_update_failed', detail: e.message });
  }
});

// POST /api/deliveries/:id/assign - assign driver
// body: { driver_id }
router.post('/:id/assign', authenticate, requireRole('admin'), async (req: Request, res: Response): Promise<void> => {
  const { id: deliveryId } = req.params as { id: string };
  const { driver_id } = req.body as { driver_id?: string };
  if (!driver_id) return void res.status(400).json({ error: 'driver_id_required' });
  const exists = await deliveryExists(deliveryId);
  if (!exists) return void res.status(404).json({ error: 'delivery_not_found' });
  try {
    const resp = await sapService.call(`/Deliveries/${deliveryId}/assign`, 'post', { driver_id });
    res.status(resp.status || 200).json({ ok: true, assignment: resp.data });
  } catch (err: unknown) {
    const e = err as { message?: string; response?: { status?: number } };
    console.error('deliveries assign error (sap)', err);
    const statusCode = e.response && e.response.status ? e.response.status : 500;
    res.status(statusCode).json({ error: 'sap_error', detail: e.message });
  }
});

// GET /api/deliveries/:id/events
router.get('/:id/events', authenticate, requireRole('admin'), async (req: Request, res: Response): Promise<void> => {
  const { id: deliveryId } = req.params as { id: string };
  try {
    const resp = await sapService.call(`/Deliveries/${deliveryId}/events`, 'get');
    res.json({ events: resp.data && resp.data.value ? resp.data.value : resp.data });
  } catch (err: unknown) {
    const e = err as { message?: string; response?: { status?: number } };
    console.error('deliveries events error (sap)', err);
    const statusCode = e.response && e.response.status ? e.response.status : 500;
    res.status(statusCode).json({ error: 'sap_error', detail: e.message });
  }
});

// GET /api/deliveries/debug/check-po-numbers - Debug endpoint to check PO numbers in database
router.get('/debug/check-po-numbers', authenticate, requireRole('admin'), async (req: Request, res: Response): Promise<void> => {
  try {
    const deliveries = await prisma.delivery.findMany({
      select: {
        id: true,
        customer: true,
        poNumber: true,
        metadata: true,
        createdAt: true
      },
      orderBy: {
        createdAt: 'desc'
      },
      take: 20
    }) as Array<{ id: string; customer: string; poNumber?: string; metadata?: Record<string, unknown>; createdAt: string }>;

    const stats = {
      total: deliveries.length,
      withPONumber: deliveries.filter(d => d.poNumber).length,
      withoutPONumber: deliveries.filter(d => !d.poNumber).length,
      withMetadataPO: deliveries.filter(d => d.metadata?.originalPONumber).length
    };

    res.json({
      stats,
      recentDeliveries: deliveries.map(d => ({
        id: d.id.substring(0, 8),
        customer: d.customer,
        poNumber: d.poNumber,
        metadataPO: d.metadata?.originalPONumber,
        createdAt: d.createdAt
      }))
    });
  } catch (error: unknown) {
    const e = error as { message?: string };
    console.error('[Deliveries/Debug] Error checking PO numbers:', error);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/deliveries/upload - Save uploaded delivery data and auto-assign
// logistics_team (Kerry portal) is intentionally excluded — only admin and delivery_team may upload
router.post('/upload', authenticate, requireAnyRole('admin', 'delivery_team'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { deliveries } = req.body as { deliveries?: Record<string, unknown>[] };

    console.log(`[Deliveries/Upload] *** UPLOAD ENDPOINT RECEIVED ***`);
    console.log(`[Deliveries/Upload] Received ${deliveries?.length || 0} deliveries to save`);

    // Log the FIRST delivery in full detail
    if (deliveries && deliveries.length > 0) {
      console.log(`[Deliveries/Upload] *** FIRST DELIVERY IN REQUEST ***`);
      console.log(`[Deliveries/Upload] First delivery keys:`, Object.keys(deliveries[0]));
      console.log(`[Deliveries/Upload] First delivery._originalPONumber:`, deliveries[0]._originalPONumber);
      console.log(`[Deliveries/Upload] First delivery._originalDeliveryNumber:`, deliveries[0]._originalDeliveryNumber);
      console.log(`[Deliveries/Upload] First delivery:`, JSON.stringify(deliveries[0], null, 2).substring(0, 500));
      console.log(`[Deliveries/Upload] *** END FIRST DELIVERY ***`);
    }

    if (!deliveries || !Array.isArray(deliveries)) {
      return void res.status(400).json({ error: 'deliveries_array_required' });
    }

    if (deliveries.length === 0) {
      return void res.status(400).json({ error: 'no_deliveries_provided' });
    }

    const results: Array<{ deliveryId: string; saved: boolean; error?: string; deduplicated?: boolean; outcome?: string; gmdUpdated?: boolean }> = [];
    /** IDs of records that were created or updated (included in savedDeliveries response). */
    const deliveryIds: string[] = [];
    /** IDs of records that were skipped (pure duplicate) — returned in response for UI refresh. */
    const skippedIds: string[] = [];

    // Save deliveries to database with full data
    for (let i = 0; i < deliveries.length; i++) {
      const delivery = deliveries[i];
      // Generate valid UUID for each delivery (required by database)
      // If delivery.id exists and is a valid UUID, use it; otherwise generate new UUID
      let deliveryId = delivery.id as string | undefined;
      if (!deliveryId || !String(deliveryId).match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
        deliveryId = randomUUID();
      }

      console.log(`[Deliveries/Upload] Saving delivery ${i + 1}/${deliveries.length}: ${deliveryId}`);
      console.log(`[Deliveries/Upload] Data: customer="${delivery.customer}", address="${String(delivery.address || '').substring(0, 50)}", phone="${delivery.phone}", status="${delivery.status}"`);
      console.log(`[Deliveries/Upload] *** CRITICAL DEBUG ***`);
      console.log(`[Deliveries/Upload] delivery object type:`, typeof delivery);
      console.log(`[Deliveries/Upload] delivery object keys:`, Object.keys(delivery));
      console.log(`[Deliveries/Upload] delivery._originalPONumber:`, delivery._originalPONumber);
      console.log(`[Deliveries/Upload] delivery._originalDeliveryNumber:`, delivery._originalDeliveryNumber);
      console.log(`[Deliveries/Upload] *** END CRITICAL DEBUG ***`);

      try {
        // PO Number: use transformed fields first, then raw delivery keys (untransformed upload), then _originalRow
        let poNumberToSave: string | null = (delivery.poNumber ?? delivery.PONumber ?? delivery._originalPONumber ?? null) as string | null;
        if (poNumberToSave == null) {
          const raw = delivery['PO Number'] ?? delivery['PO#'] ?? delivery['Cust. PO Number'] ?? delivery['PONumber'] ?? delivery['Delivery number'] ?? delivery['Delivery Number'];
          if (raw != null && raw !== '') poNumberToSave = String(raw).trim();
        }
        const origRow = delivery._originalRow as Record<string, unknown> | undefined;
        if (poNumberToSave == null && origRow && typeof origRow === 'object') {
          const fromRow = origRow['PO Number'] ?? origRow['PO#'] ?? origRow['Cust. PO Number'] ?? origRow['PONumber'] ?? origRow['Delivery number'] ?? origRow['Delivery Number'] ?? null;
          if (fromRow != null) poNumberToSave = String(fromRow).trim() || null;
        }
        if (poNumberToSave != null && typeof poNumberToSave !== 'string') poNumberToSave = String(poNumberToSave);

        // Metadata: store all original row columns plus mapped fields so nothing is lost
        const baseMeta: Record<string, unknown> = {
          originalDeliveryNumber: delivery._originalDeliveryNumber ?? origRow?.['Delivery number'] ?? origRow?.['Delivery Number'],
          originalPONumber: poNumberToSave ?? delivery._originalPONumber,
          originalQuantity: delivery._originalQuantity ?? origRow?.['Confirmed quantity'],
          originalCity: delivery._originalCity ?? origRow?.['City'],
          originalRoute: delivery._originalRoute ?? origRow?.['Route'],
        };
        if (origRow && typeof origRow === 'object') {
          baseMeta.originalRow = origRow;
        }
        const deliveryMetadata = delivery.metadata as Record<string, unknown> | undefined;
        const metadataToSave = deliveryMetadata && typeof deliveryMetadata === 'object'
          ? { ...baseMeta, ...deliveryMetadata }
          : baseMeta;
        const originalDeliveryNumberToSave = (baseMeta.originalDeliveryNumber ?? null) as string | null;

        // Extract Goods Movement Date from upload
        const rawGmd = (delivery as Record<string, unknown>)._goodsMovementDate ?? (delivery as Record<string, unknown>).goodsMovementDate ?? origRow?.['Goods Movement Date'] ?? origRow?.['GoodsMovementDate'] ?? null;
        const goodsMovementDateToSave: string | null = (() => {
          if (!rawGmd) return null;
          const d = new Date(String(rawGmd));
          return isNaN(d.getTime()) ? null : d.toISOString();
        })();

        // Delivery Number: normalised version from transform
        const deliveryNumberToSave: string | null = (() => {
          const raw = (delivery as Record<string, unknown>)._deliveryNumber ?? (delivery as Record<string, unknown>).deliveryNumber ?? originalDeliveryNumberToSave;
          if (!raw) return null;
          const s = String(raw).trim().toUpperCase();
          return s || null;
        })();

        const businessKey = buildBusinessKey(poNumberToSave, deliveryNumberToSave);

        const deliveryItems = delivery.items;
        const incoming = {
          id: deliveryId,
          deliveryNumber: deliveryNumberToSave,
          goodsMovementDate: goodsMovementDateToSave,
          customer: (delivery.customer || delivery.name || null) as string | null,
          address: (delivery.address || null) as string | null,
          phone: (delivery.phone ?? null) as string | null,
          poNumber: poNumberToSave,
          lat: delivery.lat != null ? Number(delivery.lat) : null,
          lng: delivery.lng != null ? Number(delivery.lng) : null,
          status: (delivery.status || 'pending') as string,
          items: typeof deliveryItems === 'string' ? deliveryItems : (deliveryItems ? JSON.stringify(deliveryItems) : null),
          metadata: metadataToSave,
          businessKey
        };

        const upsertResult = await upsertDeliveryByBusinessKey({
          prisma,
          source: 'manual_upload',
          incoming
        }) as { delivery: Record<string, unknown>; existed: boolean; skipped: boolean; conflict?: string; gmdUpdated: boolean; outcome: string };

        if (upsertResult.conflict) {
          console.warn(`[Deliveries/Upload] REJECTED delivery ${deliveryId}: ${upsertResult.conflict}`);
          results.push({ deliveryId, saved: false, error: upsertResult.conflict, outcome: 'rejected' });
          continue;
        }

        const { delivery: savedDelivery, existed, skipped, gmdUpdated, outcome: upsertOutcome } = upsertResult;

        console.log(`[Deliveries/Upload] ✓ ${upsertOutcome} delivery ${savedDelivery.id} (existed=${!!existed}, skipped=${!!skipped}, gmdUpdated=${!!gmdUpdated})`);
        const savedMeta = savedDelivery.metadata as Record<string, unknown> | null;
        if (!savedDelivery.poNumber && !savedMeta?.originalPONumber) {
          console.log(`[Deliveries/Upload] ⚠ Warning: No PO Number found for delivery ${savedDelivery.id}`);
        }

        if (skipped) {
          // Pure duplicate — dedup service already logged the event. Track separately so
          // the frontend can refresh the current state without marking it as newly saved.
          skippedIds.push(savedDelivery.id as string);
          results.push({ deliveryId: savedDelivery.id as string, saved: false, deduplicated: true, outcome: 'duplicate' });
        } else {
          // New record or meaningful update — dedup service already logged gmd_received_dispatch
          // / dispatch events. Only log 'uploaded' here for brand-new records so we don't
          // double-log for update cases.
          if (!existed) {
            await prisma.deliveryEvent.create({
              data: {
                deliveryId: savedDelivery.id,
                eventType: 'uploaded',
                payload: {
                  customer: delivery.customer || delivery.name,
                  address: delivery.address,
                  phone: delivery.phone,
                  lat: delivery.lat,
                  lng: delivery.lng,
                  uploadDate: new Date().toISOString(),
                  businessKey: savedDelivery.businessKey || businessKey || null,
                  hasGMD: !!goodsMovementDateToSave,
                },
                actorType: req.user?.role || 'admin',
                actorId: req.user?.sub || null
              }
            }).catch((err: unknown) => {
              const e = err as { message?: string };
              console.warn(`[Deliveries] Failed to create event for ${deliveryId}:`, e.message);
            });
          }

          deliveryIds.push(savedDelivery.id as string);
          results.push({ deliveryId: savedDelivery.id as string, saved: true, deduplicated: !!existed, outcome: upsertOutcome, gmdUpdated: !!gmdUpdated });
        }
      } catch (error: unknown) {
        const e = error as { message?: string };
        console.error(`[Deliveries] Error saving delivery ${deliveryId}:`, error);
        results.push({ deliveryId, saved: false, error: e.message });
      }
    }

    // ── Post-processing for deliveries that became Out for Delivery via GMD ──────
    // Covers both 'dispatched' (existing record receives GMD for first time) and
    // 'new' records uploaded WITH a GMD already set — both result in out-for-delivery.
    //   1. Auto-assign a driver (or promote existing assignment to in_progress)
    //   2. Send the customer an "Out for Delivery" SMS notification
    //   3. Create an adminNotification so all portal users see the bell alert
    const dispatchedIds = results.filter(r => r.saved && (r.outcome === 'dispatched' || (r.outcome === 'new' && r.gmdUpdated))).map(r => r.deliveryId);

    if (dispatchedIds.length > 0) {
      // Fetch just the fields needed for assignment + SMS
      const dispatchedRows = await prisma.delivery.findMany({
        where: { id: { in: dispatchedIds } },
        select: { id: true, phone: true, customer: true, poNumber: true, confirmationToken: true }
      }) as Array<{ id: string; phone?: string | null; customer?: string | null; poNumber?: string | null; confirmationToken?: string | null }>;

      for (const d of dispatchedRows) {
        // 1. Auto-assign / promote driver assignment
        try {
          const activeAssignment = await prisma.deliveryAssignment.findFirst({
            where: { deliveryId: d.id, status: { in: ['assigned', 'in_progress'] } }
          });
          if (!activeAssignment) {
            await autoAssignDelivery(d.id);
          } else {
            await prisma.deliveryAssignment.updateMany({
              where: { deliveryId: d.id, status: 'assigned' },
              data: { status: 'in_progress' }
            });
          }
        } catch (assignErr: unknown) {
          console.warn(`[Deliveries/Upload] Auto-assign failed for ${d.id}:`, (assignErr as Error).message);
        }

        // 2. Notify customer that their order is out for delivery (D7 SMS → WhatsApp fallback)
        if (d.phone) {
          try {
            const frontendUrl = process.env.FRONTEND_URL || 'https://electrolux-smart-portal.vercel.app';
            const trackingLink = d.confirmationToken
              ? `${frontendUrl}/customer-tracking/${d.confirmationToken}`
              : null;
            const customerName = d.customer || 'Valued Customer';
            const poRef = d.poNumber ? `#${d.poNumber}` : '';
            const smsBody = outForDeliveryMessage(customerName, poRef, trackingLink);

            let sendStatus = 'failed';
            let smsProvider = 'd7';

            // Primary: D7 SMS
            if (smsAdapter) {
              try {
                const smsResult = await smsAdapter.sendSms({
                  to: d.phone,
                  body: smsBody,
                  metadata: { deliveryId: d.id, type: 'status_out_for_delivery', triggeredBy: 'gmd_upload' }
                });
                sendStatus = smsResult.status === 'accepted' || smsResult.status === 'queued' ? 'sent' : 'failed';
                console.log(`[D7] GMD dispatch SMS for ${d.id}:`, sendStatus, smsResult.messageId || '');
              } catch (d7Err: unknown) {
                console.warn(`[D7] GMD dispatch SMS failed for ${d.id}:`, (d7Err as Error).message, '— trying WhatsApp');
                sendStatus = 'failed';
              }
            }

            // Fallback: WhatsApp if D7 failed or not configured
            if (sendStatus !== 'sent') {
              if (isWhatsAppConfigured()) {
                smsProvider = 'whatsapp-api';
                const waRes = await sendWhatsApp(d.phone, smsBody);
                sendStatus = waRes.ok ? 'sent' : 'failed';
                console.log(`[WhatsApp] GMD dispatch fallback for ${d.id}:`, waRes.ok ? 'ok' : waRes.error);
              } else {
                smsProvider = 'whatsapp-link';
                sendStatus = 'whatsapp_link_generated';
                const fallbackUrl = buildWhatsAppLink(d.phone, smsBody);
                console.log(`[WhatsApp] No API creds — GMD fallback link for ${d.id}:`, fallbackUrl);
              }
            }

            await prisma.smsLog.create({
              data: {
                deliveryId: d.id,
                phoneNumber: d.phone,
                messageContent: smsBody,
                smsProvider,
                status: sendStatus,
                sentAt: new Date(),
                metadata: { type: 'status_out_for_delivery', triggeredBy: 'gmd_upload' }
              }
            });
          } catch (smsErr: unknown) {
            console.warn(`[Deliveries/Upload] Notification failed for ${d.id}:`, (smsErr as Error).message);
          }
        }

        // 3. Create an AdminNotification so the bell rings for admin, delivery_team and logistics_team
        prisma.adminNotification.create({
          data: {
            type: 'status_changed',
            title: 'Out for Delivery — GMD Received',
            message: `${d.customer || 'Order'} (${d.poNumber ? '#' + d.poNumber : d.id}) dispatched — Goods Movement Date received via upload`,
            payload: {
              deliveryId: d.id,
              customer: d.customer,
              poNumber: d.poNumber,
              previousStatus: 'pending',
              newStatus: 'out-for-delivery',
              triggeredBy: 'gmd_upload',
              uploadedBy: req.user?.sub || req.user?.username || 'system'
            }
          }
        }).catch((err: unknown) => {
          const e = err as { message?: string };
          console.warn(`[Deliveries/Upload] Failed to create dispatch notification for ${d.id}:`, e.message);
        });
      }
    }

    const mergedResults = results.map(result => ({
      ...result,
      assigned: dispatchedIds.includes(result.deliveryId),
      driverId: null as string | null,
      driverName: null as string | null,
      assignmentError: null as string | null,
      assignmentPendingCustomerConfirm: !dispatchedIds.includes(result.deliveryId)
    }));

    // Invalidate caches after bulk upload
    cache.invalidatePrefix('tracking:');
    cache.invalidatePrefix('dashboard:');
    cache.del('deliveries:list:v2');

    const newCount = results.filter(r => r.outcome === 'new').length;
    const dispatchedCount = results.filter(r => r.outcome === 'dispatched').length;
    const updatedCount = results.filter(r => r.outcome === 'updated').length;
    const duplicateCount = results.filter(r => r.outcome === 'duplicate').length;
    const rejectedCount = results.filter(r => r.outcome === 'rejected').length;

    console.log(`[Deliveries] Upload complete: ${newCount} new, ${dispatchedCount} out-for-delivery (GMD received), ${updatedCount} updated, ${duplicateCount} duplicate (skipped), ${rejectedCount} rejected (PO conflict)`);

    // The delivery fields we always return — includes goodsMovementDate and deliveryNumber
    // so the frontend can correctly reflect dispatch state after upload.
    const deliverySelect = {
      id: true,
      customer: true,
      address: true,
      phone: true,
      poNumber: true,
      deliveryNumber: true,
      goodsMovementDate: true,
      businessKey: true,
      lat: true,
      lng: true,
      status: true,
      items: true,
      metadata: true,
      createdAt: true,
      updatedAt: true,
      confirmationStatus: true,
      confirmationToken: true,
    };

    // Fetch created/updated deliveries with full data including UUIDs
    const savedDeliveries = await prisma.delivery.findMany({
      where: { id: { in: deliveryIds } },
      select: deliverySelect
    });

    // Also fetch skipped deliveries so the frontend can refresh their current state
    const skippedDeliveries = skippedIds.length > 0
      ? await prisma.delivery.findMany({ where: { id: { in: skippedIds } }, select: deliverySelect })
      : [];

    console.log(`[Deliveries] Returning ${(savedDeliveries as unknown[]).length} saved + ${(skippedDeliveries as unknown[]).length} skipped deliveries to frontend`);

    // ── After each upload: WhatsApp confirmation for every row that still needs a date confirmation ──
    // Includes: brand-new rows, updated master data rows, and pure-duplicate skips — if the customer
    // has not confirmed and the order is not already dispatched / terminal.
    const terminalNoDateConfirm = ['out-for-delivery', 'delivered', 'cancelled', 'returned', 'in-transit', 'in-progress', 'finished', 'completed', 'pod-completed'];
    const needsDateConfirmationWhatsApp = (d: Record<string, unknown>): boolean => {
      if (!d.phone) return false;
      if ((d.confirmationStatus as string) === 'confirmed') return false;
      const st = String(d.status || '').toLowerCase();
      if (terminalNoDateConfirm.includes(st)) return false;
      return true;
    };

    type ConfirmRow = {
      id: string;
      customer?: string | null;
      phone?: string | null;
      poNumber?: string | null;
      confirmationToken?: string | null;
      isNew: boolean;
    };

    const confirmationById = new Map<string, ConfirmRow>();

    for (const d of savedDeliveries as Array<Record<string, unknown>>) {
      if (!needsDateConfirmationWhatsApp(d)) continue;
      const r = results.find((x) => x.deliveryId === d.id);
      confirmationById.set(String(d.id), {
        id: String(d.id),
        customer: (d.customer as string | null) ?? null,
        phone: (d.phone as string | null) ?? null,
        poNumber: (d.poNumber as string | null) ?? null,
        confirmationToken: (d.confirmationToken as string | null) ?? null,
        isNew: r?.outcome === 'new',
      });
    }

    for (const d of skippedDeliveries as Array<Record<string, unknown>>) {
      if (!needsDateConfirmationWhatsApp(d)) continue;
      const id = String(d.id);
      if (confirmationById.has(id)) continue;
      confirmationById.set(id, {
        id,
        customer: (d.customer as string | null) ?? null,
        phone: (d.phone as string | null) ?? null,
        poNumber: (d.poNumber as string | null) ?? null,
        confirmationToken: (d.confirmationToken as string | null) ?? null,
        isNew: false,
      });
    }

    const smsUploadService = require('../sms/smsService');
    const frontendUrlUpload = process.env.FRONTEND_URL || 'https://electrolux-smart-portal.vercel.app';
    const confirmationsReady: Array<{ deliveryId: string; customerName: string; phone: string; whatsappUrl: string; confirmationLink: string; sent: boolean }> = [];

    const allDeliveriesForConfirmation = [...confirmationById.values()];

    /** Parallel batches: sequential D7 calls per row were exceeding Vercel function time limits. */
    const CONFIRMATION_SEND_CONCURRENCY = 5;
    const processOneConfirmation = async (
      d: ConfirmRow
    ): Promise<{ deliveryId: string; customerName: string; phone: string; whatsappUrl: string; confirmationLink: string; sent: boolean } | null> => {
      try {
        let token = d.confirmationToken as string | null;
        let needsTokenSave = false;
        if (!token) {
          token = smsUploadService.generateConfirmationToken() as string;
          needsTokenSave = true;
        }
        const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        const confirmationLink = `${frontendUrlUpload}/confirm-delivery/${token}`;
        const customerName = (d.customer as string) || 'Valued Customer';
        const poRef = d.poNumber ? `#${d.poNumber}` : '';
        const msgBody = confirmationRequestMessage(customerName, poRef, confirmationLink);

        if (needsTokenSave || (d as { isNew: boolean }).isNew) {
          // Save confirmation token (critical — WhatsApp link won't work without this)
          await prisma.delivery.update({
            where: { id: d.id },
            data: {
              confirmationToken: token,
              tokenExpiresAt: expiresAt,
              confirmationStatus: 'pending',
              status: 'scheduled',
            }
          });
          // Track send time separately — non-critical; sms_sent_at column requires
          // the add_sms_sent_at migration to be applied on the production DB.
          prisma.delivery.update({
            where: { id: d.id },
            data: { smsSentAt: new Date() }
          }).catch((e: unknown) => {
            console.warn('[Upload] smsSentAt update skipped (run add_sms_sent_at migration):', (e as Error).message);
          });
        }

        const normalizedPhone = normalizePhone((d.phone as string)) || (d.phone as string);
        let sent = false;
        let sendStatus = 'sent';

        // ── SMS via D7 Networks ─────────────────────────────────────────────
        try {
          const smsSendResult = await (smsUploadService.smsAdapter as { sendSms: (opts: { to: string; body: string; metadata: Record<string, unknown> }) => Promise<{ messageId?: string; status?: string }> }).sendSms({
            to: normalizedPhone, body: msgBody,
            metadata: { deliveryId: d.id, type: 'confirmation_request' }
          });
          sent = true;
          sendStatus = smsSendResult?.status || 'sent';
          console.log(`[SMS] Auto-confirmation sent for ${d.id} to ${normalizedPhone}: ok`);
        } catch (smsErr: unknown) {
          console.warn(`[SMS] Auto-confirmation failed for ${d.id}:`, (smsErr as Error).message);
          sendStatus = 'sms_failed';
        }
        // ── WhatsApp path (kept for reference — temporarily disabled) ─────────
        // if (isWhatsAppConfigured()) {
        //   const waRes = await sendWhatsAppDeliveryConfirmation(normalizedPhone, {
        //     fullTextBody: msgBody, customerName, poRef, confirmationLink
        //   });
        //   sent = waRes.ok; sendStatus = waRes.ok ? 'sent' : 'whatsapp_link_generated_after_api_failure';
        //   if (!waRes.ok) fallbackWaUrl = buildWhatsAppLink(normalizedPhone, msgBody);
        // } else { fallbackWaUrl = buildWhatsAppLink(normalizedPhone, msgBody); }
        // ─────────────────────────────────────────────────────────────────────

        await prisma.smsLog.create({
          data: {
            deliveryId: d.id,
            phoneNumber: (d.phone as string),
            messageContent: msgBody,
            smsProvider: process.env.SMS_PROVIDER || 'd7',
            status: sendStatus,
            sentAt: new Date(),
            metadata: { type: 'confirmation_request', triggeredBy: (d as { isNew: boolean }).isNew ? 'auto_upload' : 'resend_on_reupload', channel: 'sms' }
          }
        }).catch(() => { /* non-critical */ });

        return {
          deliveryId: d.id,
          customerName,
          phone: normalizedPhone,
          confirmationLink,
          whatsappUrl: '',
          sent
        };
      } catch (autoErr: unknown) {
        console.warn(`[Upload] Auto-token gen failed for ${d.id}:`, (autoErr as Error).message);
        return null;
      }
    };

    for (let i = 0; i < allDeliveriesForConfirmation.length; i += CONFIRMATION_SEND_CONCURRENCY) {
      const slice = allDeliveriesForConfirmation.slice(i, i + CONFIRMATION_SEND_CONCURRENCY);
      const batchOut = await Promise.all(slice.map((row) => processOneConfirmation(row)));
      for (const row of batchOut) {
        if (row) confirmationsReady.push(row);
      }
    }

    if (confirmationsReady.length > 0) {
      const sentSilently = confirmationsReady.filter(c => c.sent).length;
      const needsManual = confirmationsReady.filter(c => !c.sent).length;
      console.log(`[Upload] ${confirmationsReady.length} confirmation notifications: ${sentSilently} sent silently, ${needsManual} need manual send (no API creds)`);
    }
    // ──────────────────────────────────────────────────────────────────────────────

    res.json({
      success: true,
      count: deliveryIds.length,
      saved: results.filter(r => r.saved).length,
      assigned: 0,
      summary: { new: newCount, dispatched: dispatchedCount, updated: updatedCount, duplicate: duplicateCount, rejected: rejectedCount },
      results: mergedResults,
      deliveries: savedDeliveries,
      skippedDeliveries,
      confirmationsReady,  // sent=true means WhatsApp delivered silently; sent=false means API not configured
    });
  } catch (err: unknown) {
    const e = err as { message?: string; stack?: string };
    console.error('deliveries/upload error', err);
    console.error('deliveries/upload error stack:', e.stack);
    res.status(500).json({ error: 'upload_error', detail: e.message });
  }
});

// POST /api/deliveries/bulk-assign - Auto-assign multiple deliveries
router.post('/bulk-assign', authenticate, requireRole('admin'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { deliveryIds } = req.body as { deliveryIds?: string[] };

    if (!deliveryIds || !Array.isArray(deliveryIds)) {
      return void res.status(400).json({ error: 'delivery_ids_array_required' });
    }

    const results = await autoAssignDeliveries(deliveryIds) as Array<{ success: boolean }>;

    // Invalidate caches after bulk assignment
    cache.invalidatePrefix('tracking:');
    cache.invalidatePrefix('dashboard:');
    cache.invalidatePrefix('deliveries:list:v2');

    res.json({
      success: true,
      total: deliveryIds.length,
      assigned: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
      results
    });
  } catch (err: unknown) {
    const e = err as { message?: string };
    console.error('deliveries/bulk-assign error', err);
    res.status(500).json({ error: 'bulk_assign_error', detail: e.message });
  }
});

// GET /api/deliveries/available-drivers - Get available drivers for manual selection
router.get('/available-drivers', authenticate, requireRole('admin'), async (req: Request, res: Response): Promise<void> => {
  try {
    const drivers = await getAvailableDrivers();
    res.json({ drivers, count: (drivers as unknown[]).length });
  } catch (err: unknown) {
    const e = err as { message?: string };
    console.error('deliveries/available-drivers error', err);
    res.status(500).json({ error: 'db_error', detail: e.message });
  }
});

// Define which statuses are considered "terminal" / finished for routing purposes.
// These will normally be excluded from the Delivery Management active list unless
// a client explicitly asks to include them.
const TERMINAL_STATUSES = [
  'delivered',
  'delivered-with-installation',
  'delivered-without-installation',
  'completed',
  'pod-completed',
  'cancelled',
  'returned',
];

// GET /api/deliveries - Get deliveries from database
// By default returns ONLY "active" deliveries (non-terminal), filtered to
// today's deliveries: non-confirmed deliveries always show, while
// scheduled-confirmed deliveries only appear when their confirmedDeliveryDate
// is today or earlier (future-date picks are hidden until that date).
// Pass ?includeFinished=true to include all terminal-status deliveries.
router.get('/', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const includeFinished = req.query.includeFinished === 'true';

    // Build a today-scoped date range using Dubai timezone (UTC+4) so day
    // boundaries are correct regardless of the server's local timezone.
    const dubaiTodayIso = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Dubai', year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(new Date());
    const todayStart = new Date(`${dubaiTodayIso}T00:00:00+04:00`);
    const todayEnd   = new Date(`${dubaiTodayIso}T23:59:59+04:00`);
    // Cache key scoped to today's Dubai date so confirmed-for-future deliveries
    // automatically become visible on their scheduled date.
    const dateKey = dubaiTodayIso;
    const cacheKey = includeFinished
      ? 'deliveries:list:v2:all'
      : `deliveries:list:v2:active:${dateKey}`;

    const deliveries = await cache.getOrFetch(cacheKey, async () => {
      let whereClause: Record<string, unknown>;
      if (includeFinished) {
        whereClause = {};
      } else {
        whereClause = {
          status: { notIn: TERMINAL_STATUSES },
          // Only show confirmed deliveries whose date is today or earlier.
          // Unconfirmed deliveries (pending/scheduled/etc.) always show so
          // admin can dispatch them manually.
          OR: [
            { status: { notIn: ['scheduled-confirmed', 'confirmed'] } },
            { status: { in: ['scheduled-confirmed', 'confirmed'] }, confirmedDeliveryDate: { lte: todayEnd } },
            { status: { in: ['scheduled-confirmed', 'confirmed'] }, confirmedDeliveryDate: null },
          ],
        };
      }

      return prisma.delivery.findMany({
        where: whereClause,
        select: {
          id: true,
          customer: true,
          address: true,
          phone: true,
          lat: true,
          lng: true,
          status: true,
          items: true,
          metadata: true,
          poNumber: true,
          deliveryNumber: true,
          goodsMovementDate: true,
          smsSentAt: true,
          confirmationStatus: true,
          confirmedDeliveryDate: true,
          // Driver comments (e.g. mandatory rejection reason) — surfaced in the
          // Logistics / Delivery Team Delivery Orders table via the View Reason
          // button on cancelled rows.
          deliveryNotes: true,
          conditionNotes: true,
          createdAt: true,
          updatedAt: true,
          assignments: {
            select: {
              driverId: true,
              status: true,
              driver: { select: { fullName: true } }
            },
            take: 1,
            orderBy: { assignedAt: 'desc' }
          }
        },
        orderBy: { createdAt: 'desc' },
        take: 2000
      });
    }, 30000, 120000);

    // Format deliveries for frontend
    const formattedDeliveries = (deliveries as Array<Record<string, unknown>>).map(d => {
      const assignments = d.assignments as Array<{ driverId?: string; status?: string; driver?: { fullName?: string } }> | undefined;
      return {
        id: d.id,
        customer: d.customer,
        address: d.address,
        phone: d.phone,
        lat: d.lat,
        lng: d.lng,
        status: d.status,
        items: d.items,
        metadata: d.metadata,
        poNumber: d.poNumber,
        deliveryNumber: d.deliveryNumber ?? null,
        goodsMovementDate: d.goodsMovementDate ?? null,
        smsSentAt: d.smsSentAt ?? null,
        confirmationStatus: d.confirmationStatus,
        confirmedDeliveryDate: d.confirmedDeliveryDate,
        deliveryNotes: d.deliveryNotes ?? null,
        conditionNotes: d.conditionNotes ?? null,
        created_at: d.createdAt,
        createdAt: d.createdAt,
        created: d.createdAt,
        updatedAt: d.updatedAt,
        assignedDriverId: assignments?.[0]?.driverId || null,
        driverName: assignments?.[0]?.driver?.fullName || null,
        assignmentStatus: assignments?.[0]?.status || 'unassigned'
      };
    });

    // Deliveries with missing address or phone go to the bottom; otherwise newest first
    sortDeliveriesIncompleteLast(formattedDeliveries);

    res.json({
      deliveries: formattedDeliveries,
      count: formattedDeliveries.length
    });
  } catch (err: unknown) {
    const e = err as { message?: string };
    console.error('GET /api/deliveries error', err);
    res.status(500).json({ error: 'db_error', detail: e.message });
  }
});

// PUT /api/admin/deliveries/:id/assign - Assign delivery to driver (admin + delivery_team)
router.put('/admin/:id/assign', authenticate, requireAnyRole('admin', 'delivery_team', 'logistics_team'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params as { id: string };
    const { driverId } = req.body as { driverId?: string };

    if (!driverId) {
      return void res.status(400).json({ error: 'driverId_required' });
    }

    console.log(`[Deliveries] Assigning delivery ${id} to driver ${driverId}`);

    const targetDriver = await prisma.driver.findUnique({
      where: { id: driverId },
      include: { account: { select: { role: true } } }
    });

    if (!targetDriver || !targetDriver.account || targetDriver.account.role !== 'driver') {
      return void res.status(400).json({
        error: 'invalid_driver',
        message: 'Assignments are only allowed for accounts with the driver role.'
      });
    }

    // Verify delivery exists
    const delivery = await prisma.delivery.findUnique({
      where: { id },
      include: { assignments: true }
    }) as {
      id: string;
      status?: string | null;
      assignments?: unknown[];
      items?: string | null;
      metadata?: Record<string, unknown> | null;
      confirmedDeliveryDate?: Date | null;
      assignedDriverId?: string | null;
    } | null;

    if (!delivery) {
      return void res.status(404).json({ error: 'delivery_not_found' });
    }

    // Per-driver capacity check: 1 driver = 1 truck = max TRUCK_MAX_ITEMS_PER_DAY units per day
    {
      const orderItemCount = parseDeliveryItemCount(delivery.items, delivery.metadata);
      const apiStatus = String(delivery.status || '').toLowerCase().replace(/_/g, '-');
      const onRouteForCap = ['out-for-delivery', 'in-transit', 'in-progress'].includes(apiStatus);
      // On-route loads consume **today's** Dubai truck slot; others use confirmed delivery day (or tomorrow if unset)
      const targetIso = onRouteForCap
        ? getDubaiTodayIso()
        : delivery.confirmedDeliveryDate
          ? new Intl.DateTimeFormat('en-CA', {
              timeZone: 'Asia/Dubai',
              year: 'numeric', month: '2-digit', day: '2-digit'
            }).format(new Date(delivery.confirmedDeliveryDate))
          : addDubaiCalendarDays(getDubaiTodayIso(), 1);

      // Exclude this delivery from driver's current count (handles reassignment without double-counting)
      const driverUsed = await getDriverItemCountForDate(prisma, driverId, targetIso, id);

      if (driverUsed + orderItemCount > TRUCK_MAX_ITEMS_PER_DAY) {
        return void res.status(400).json({
          error: 'driver_capacity_exceeded',
          message: `Driver's truck is full for ${targetIso}: ${driverUsed} units already assigned, this order has ${orderItemCount} units (max ${TRUCK_MAX_ITEMS_PER_DAY} per truck).`,
          driverUsed,
          orderItemCount,
          maxItems: TRUCK_MAX_ITEMS_PER_DAY,
          remaining: Math.max(0, TRUCK_MAX_ITEMS_PER_DAY - driverUsed)
        });
      }
    }

    // Soft-close previous active assignments so history is preserved for reporting/audit
    if (delivery.assignments && delivery.assignments.length > 0) {
      await prisma.deliveryAssignment.updateMany({
        where: { deliveryId: id, status: { in: ['assigned', 'in_progress'] } },
        data: { status: 'reassigned' }
      });
      console.log(`[Deliveries] Soft-closed previous assignments for delivery ${id}`);
    }

    // Create new assignment
    const assignment = await prisma.deliveryAssignment.create({
      data: {
        deliveryId: id,
        driverId: driverId,
        assignedAt: new Date(),
        status: 'assigned'
      },
      include: {
        driver: {
          select: {
            id: true,
            fullName: true,
            email: true,
            phone: true
          }
        }
      }
    }) as {
      deliveryId: string; driverId: string; status: string; assignedAt: Date;
      driver: { fullName: string };
    };

    // Invalidate caches after assignment
    // Use invalidatePrefix so both deliveries:list:v2:active and deliveries:list:v2:all are cleared.
    cache.invalidatePrefix('tracking:');
    cache.invalidatePrefix('dashboard:');
    cache.invalidatePrefix('deliveries:list:v2');

    res.json({
      ok: true,
      assignment: {
        deliveryId: assignment.deliveryId,
        driverId: assignment.driverId,
        driverName: assignment.driver.fullName,
        status: assignment.status,
        assignedAt: assignment.assignedAt
      }
    });
  } catch (err: unknown) {
    const e = err as { message?: string };
    console.error('PUT /api/admin/deliveries/:id/assign error:', err);
    res.status(500).json({ error: 'assignment_failed', detail: e.message });
  }
});

// GET /api/deliveries/admin/driver-capacity?date=YYYY-MM-DD
// Returns per-driver capacity for the given date (or tomorrow if omitted).
// Used by Logistics/Delivery portals to show "N/20 units used" in assignment dropdowns.
router.get('/admin/driver-capacity', authenticate, requireAnyRole('admin', 'delivery_team', 'logistics_team'), async (req: Request, res: Response): Promise<void> => {
  try {
    const rawDate = (req.query as { date?: string }).date;
    let isoDate = rawDate ? String(rawDate).trim().split('T')[0] : null;
    if (!isoDate || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
      isoDate = addDubaiCalendarDays(getDubaiTodayIso(), 1);
    }

    const allDrivers = await prisma.driver.findMany({
      where: { active: true, account: { role: 'driver' } },
      include: { account: { select: { id: true, role: true } } },
      orderBy: { fullName: 'asc' }
    }) as Array<{ id: string; fullName: string; email?: string; phone?: string }>;

    const result = await Promise.all(allDrivers.map(async (driver: { id: string; fullName: string; email?: string; phone?: string }) => {
      const used = await getDriverItemCountForDate(prisma, driver.id, isoDate!);
      return {
        driverId: driver.id,
        driverName: driver.fullName,
        used,
        remaining: Math.max(0, TRUCK_MAX_ITEMS_PER_DAY - used),
        max: TRUCK_MAX_ITEMS_PER_DAY,
        full: used >= TRUCK_MAX_ITEMS_PER_DAY
      };
    }));

    res.json({ ok: true, date: isoDate, truckMax: TRUCK_MAX_ITEMS_PER_DAY, drivers: result });
  } catch (err: unknown) {
    const e = err as { message?: string };
    console.error('GET /admin/driver-capacity error:', err);
    res.status(500).json({ error: 'capacity_fetch_failed', detail: e.message });
  }
});

// POST /api/deliveries/:id/send-sms - Send confirmation SMS to customer
// Accessible by admin, delivery_team, and logistics_team
router.post('/:id/send-sms', authenticate, requireAnyRole('admin', 'delivery_team', 'logistics_team'), async (req: Request, res: Response): Promise<void> => {
  try {
    let { id: deliveryId } = req.params as { id: string };

    if (!deliveryId) {
      return void res.status(400).json({ error: 'delivery_id_required' });
    }

    // Sanitize delivery ID - remove any invalid characters and decode
    deliveryId = decodeURIComponent(String(deliveryId).trim());

    console.log('[SMS] Attempting to send SMS for delivery ID:', deliveryId);

    // Validate UUID format (standard UUID format: 8-4-4-4-12 hex characters)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    let delivery: Record<string, unknown> | null = null;

    if (uuidRegex.test(deliveryId)) {
      // Valid UUID format - use findUnique
      console.log('[SMS] Valid UUID format, using findUnique');
      try {
        delivery = await prisma.delivery.findUnique({
          where: { id: deliveryId }
        });
      } catch (prismaErr: unknown) {
        const pe = prismaErr as { message?: string };
        console.error('[SMS] Prisma findUnique error:', pe.message);
        return void res.status(400).json({
          error: 'invalid_delivery_id',
          message: 'Invalid delivery ID format',
          detail: pe.message
        });
      }
    } else {
      // Not a valid UUID - try searching by poNumber or other fields
      console.log('[SMS] Not a valid UUID, trying fallback search by poNumber');
      try {
        delivery = await prisma.delivery.findFirst({
          where: {
            OR: [
              { poNumber: deliveryId },
              { id: { contains: deliveryId } }
            ]
          }
        });
      } catch (searchErr: unknown) {
        const se = searchErr as { message?: string };
        console.error('[SMS] Fallback search error:', se.message);
      }
    }

    if (!delivery) {
      console.error('[SMS] Delivery not found for ID:', deliveryId);
      return void res.status(404).json({
        error: 'delivery_not_found',
        message: `No delivery found with ID: ${deliveryId}`
      });
    }

    console.log('[SMS] Found delivery:', delivery.id, 'Customer:', delivery.customer);

    if (!delivery.phone && !delivery.email) {
      return void res.status(400).json({ error: 'no_contact_info', message: 'Delivery has no phone number or email address' });
    }

    // Normalize the phone number to E.164 format if present
    const normalizedPhone = delivery.phone
      ? (normalizePhone(delivery.phone as string) || delivery.phone as string)
      : null;
    if (normalizedPhone && normalizedPhone !== delivery.phone) {
      console.log(`[SMS] Phone normalized: "${delivery.phone}" → "${normalizedPhone}"`);
    }

    // Accept optional customer email override from request body
    const reqBody = req.body as { email?: string };
    const customerEmail = reqBody?.email || delivery.email as string || null;

    if (!normalizedPhone) {
      return void res.status(400).json({ error: 'no_phone', message: 'Delivery has no phone number' });
    }

    // ── Send confirmation SMS via smsService (D7 Networks) ──────────────────
    const smsService = require('../sms/smsService');
    const result = await (smsService.sendConfirmationSms as (id: string, phone: string) => Promise<{ ok: boolean; token: string; messageId: string; phoneNumber: string; expiresAt: string; }>)(delivery.id as string, normalizedPhone);
    const frontendUrl = process.env.FRONTEND_URL || 'https://electrolux-smart-portal.vercel.app';
    const confirmationLink = `${frontendUrl}/confirm-delivery/${result.token}`;

    // ── WhatsApp path (kept for reference — temporarily disabled) ─────────────
    // const token = smsService.generateConfirmationToken() as string;
    // const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    // const customerName = (delivery.customer as string) || 'Valued Customer';
    // const poRef = delivery.poNumber ? `#${delivery.poNumber}` : '';
    // const smsBody = confirmationRequestMessage(customerName, poRef, confirmationLink);
    // const isUAE = normalizedPhone.startsWith('+971');
    // let whatsappUrl: string | undefined;
    // if (isWhatsAppConfigured()) {
    //   const waRes = await sendWhatsAppDeliveryConfirmation(normalizedPhone, {
    //     fullTextBody: smsBody, customerName, poRef, confirmationLink
    //   });
    //   if (waRes.ok) {
    //     // sent via WhatsApp API silently
    //   } else {
    //     whatsappUrl = buildWhatsAppLink(normalizedPhone, smsBody);
    //   }
    // } else {
    //   whatsappUrl = buildWhatsAppLink(normalizedPhone, smsBody);
    // }
    // ──────────────────────────────────────────────────────────────────────────

    return void res.json({
      ok: true,
      smsSent: true,
      deliveredVia: 'sms',
      d7Status: 'sent',
      message: 'SMS confirmation sent to customer',
      messageId: result.messageId,
      expiresAt: result.expiresAt,
      confirmationLink,
    });
  } catch (error: unknown) {
    const e = error as { message?: string };
    console.error('POST /api/deliveries/:id/send-sms error:', error);
    return void res.status(500).json({
      error: 'send_sms_failed',
      message: e.message || 'Failed to send SMS. Please check delivery data.'
    });
  }
});

/**
 * POST /api/deliveries/:id/notify-arrival
 *
 * Fires the "driver is arriving shortly" SMS/WhatsApp to the customer.
 *
 * Two triggers converge on this endpoint:
 *  1. Driver taps the "Arrived" button on the order card (manual).
 *  2. Driver portal detects GPS is within ~2 km of the delivery (auto).
 *
 * Idempotent: if `metadata.arrivalNotifiedAt` is already set, returns 200
 * with `alreadyNotified=true` and does NOT send another message.
 *
 * Allowed roles: driver (only for their assigned deliveries), delivery_team, admin.
 */
router.post('/:id/notify-arrival', authenticate, requireAnyRole('driver', 'delivery_team', 'admin'), async (req: Request, res: Response): Promise<void> => {
  const { id: deliveryId } = req.params as { id: string };
  const user = req.user as { sub?: string; role?: string } | undefined;
  if (!deliveryId) {
    res.status(400).json({ error: 'delivery_id_required' });
    return;
  }

  try {
    const delivery = await prisma.delivery.findUnique({ where: { id: deliveryId } });
    if (!delivery) {
      res.status(404).json({ error: 'delivery_not_found' });
      return;
    }

    // Driver must be assigned to this delivery (admin/delivery_team can notify anywhere)
    if (user?.role === 'driver') {
      const assignment = await prisma.deliveryAssignment.findFirst({
        where: { deliveryId, driverId: user.sub, status: { in: ['assigned', 'in_progress'] } },
      });
      if (!assignment) {
        res.status(403).json({ error: 'delivery_not_assigned_to_driver' });
        return;
      }
    }

    // Idempotency: only send once per delivery
    const existingMeta = (delivery.metadata as Record<string, unknown> | null) || {};
    if (existingMeta.arrivalNotifiedAt) {
      res.json({
        ok: true,
        alreadyNotified: true,
        arrivalNotifiedAt: existingMeta.arrivalNotifiedAt,
        message: 'Arrival SMS was already sent for this delivery',
      });
      return;
    }

    if (!delivery.phone) {
      res.status(400).json({ error: 'no_phone', message: 'Delivery has no phone number' });
      return;
    }
    const normalizedPhone = normalizeUAEPhone(delivery.phone) || delivery.phone;

    const customerName = delivery.customer || 'Valued Customer';
    const poRef = delivery.poNumber ? `#${delivery.poNumber}` : '';
    const frontendUrl = process.env.FRONTEND_URL || 'https://electrolux-smart-portal.vercel.app';
    const trackingLink = delivery.confirmationToken
      ? `${frontendUrl}/customer-tracking/${delivery.confirmationToken}`
      : null;
    const smsBody = driverArrivingMessage(customerName, poRef, trackingLink);

    // Send: D7 SMS → WhatsApp API → wa.me link (same cascade as other driver notifications)
    let provider = 'd7';
    let sendStatus = 'sent';
    try {
      if (smsAdapter) {
        await smsAdapter.sendSms({
          to: normalizedPhone,
          body: smsBody,
          metadata: { deliveryId, type: 'driver_arriving', triggeredBy: req.body?.trigger || 'manual' },
        });
      } else {
        throw new Error('no smsAdapter');
      }
    } catch (d7Err: unknown) {
      console.warn(`[Arrival] D7 SMS failed for ${deliveryId}:`, (d7Err as Error).message);
      if (isWhatsAppConfigured()) {
        try {
          provider = 'whatsapp-api';
          const waRes = await sendWhatsApp(normalizedPhone, smsBody);
          sendStatus = waRes.ok ? 'sent' : 'failed';
        } catch {
          provider = 'whatsapp-link';
          sendStatus = 'whatsapp_link_generated';
        }
      } else {
        provider = 'whatsapp-link';
        sendStatus = 'whatsapp_link_generated';
      }
    }

    const arrivalNotifiedAt = new Date().toISOString();

    // Persist flag in metadata JSON (no schema migration needed)
    await prisma.delivery.update({
      where: { id: deliveryId },
      data: {
        metadata: {
          ...existingMeta,
          arrivalNotifiedAt,
          arrivalNotifiedTrigger: req.body?.trigger || 'manual',
        },
      },
    });

    // Audit trail
    await prisma.smsLog.create({
      data: {
        deliveryId,
        phoneNumber: normalizedPhone,
        messageContent: smsBody,
        smsProvider: provider,
        status: sendStatus,
        sentAt: new Date(),
        metadata: { type: 'driver_arriving', trigger: req.body?.trigger || 'manual' },
      },
    }).catch((e: Error) => console.warn('[Arrival] smsLog insert failed:', e.message));

    // Write a DeliveryEvent so the customer tracking timeline advances to "Items Arrived"
    await prisma.deliveryEvent.create({
      data: {
        deliveryId,
        eventType: 'driver_arrived',
        payload: {
          trigger: req.body?.trigger || 'manual',
          notifiedAt: arrivalNotifiedAt,
          smsProvider: provider,
          smsStatus: sendStatus,
        },
        actorType: (user?.role as string) || 'driver',
        actorId: user?.sub || null,
      },
    }).catch((e: Error) => console.warn('[Arrival] deliveryEvent insert failed:', e.message));

    res.json({
      ok: true,
      alreadyNotified: false,
      arrivalNotifiedAt,
      provider,
      status: sendStatus,
      message: 'Arrival SMS sent to customer',
    });
  } catch (err: unknown) {
    const e = err as { message?: string };
    console.error('[Arrival] notify-arrival failed:', e.message);
    res.status(500).json({ error: 'notify_arrival_failed', detail: e.message });
  }
});

// GET /api/deliveries/:id/pod - Get Proof of Delivery data for a specific delivery
router.get('/:id/pod', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const { id: deliveryId } = req.params as { id: string };

    console.log(`[Deliveries/POD] Fetching POD data for delivery: ${deliveryId}`);

    type PodDelivery = {
      id: string; customer: string; address: string; phone: string; items: unknown;
      status: string; driverSignature?: string; customerSignature?: string;
      photos?: unknown[]; conditionNotes?: string; deliveryNotes?: string;
      deliveredBy?: string; deliveredAt?: string; podCompletedAt?: string;
      createdAt: string; updatedAt: string; metadata?: unknown;
    };

    // Try to find delivery by ID or poNumber
    let delivery: PodDelivery | null = null;
    try {
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (uuidRegex.test(deliveryId)) {
        delivery = await prisma.delivery.findUnique({
          where: { id: deliveryId },
          select: {
            id: true,
            customer: true,
            address: true,
            phone: true,
            items: true,
            status: true,
            driverSignature: true,
            customerSignature: true,
            photos: true,
            conditionNotes: true,
            deliveryNotes: true,
            deliveredBy: true,
            deliveredAt: true,
            podCompletedAt: true,
            createdAt: true,
            updatedAt: true,
            metadata: true
          }
        });
      } else {
        // Try by PO number
        delivery = await prisma.delivery.findFirst({
          where: { poNumber: deliveryId },
          select: {
            id: true,
            customer: true,
            address: true,
            phone: true,
            items: true,
            status: true,
            driverSignature: true,
            customerSignature: true,
            photos: true,
            conditionNotes: true,
            deliveryNotes: true,
            deliveredBy: true,
            deliveredAt: true,
            podCompletedAt: true,
            createdAt: true,
            updatedAt: true,
            metadata: true
          }
        });
      }
    } catch (err: unknown) {
      const e = err as { message?: string };
      console.error(`[Deliveries/POD] Error fetching delivery:`, err);
      return void res.status(500).json({ error: 'database_error', detail: e.message });
    }

    if (!delivery) {
      return void res.status(404).json({ error: 'delivery_not_found' });
    }

    // Check if POD exists
    const hasPOD = !!(delivery.driverSignature || delivery.customerSignature ||
                     (delivery.photos && Array.isArray(delivery.photos) && delivery.photos.length > 0));

    // Return POD data
    res.json({
      ok: true,
      deliveryId: delivery.id,
      customer: delivery.customer,
      address: delivery.address,
      items: delivery.items,
      status: delivery.status,
      hasPOD: hasPOD,
      pod: {
        driverSignature: delivery.driverSignature || null,
        customerSignature: delivery.customerSignature || null,
        photos: delivery.photos || [],
        photoCount: (delivery.photos && Array.isArray(delivery.photos)) ? delivery.photos.length : 0,
        conditionNotes: delivery.conditionNotes || null,
        deliveryNotes: delivery.deliveryNotes || null,
        deliveredBy: delivery.deliveredBy || null,
        deliveredAt: delivery.deliveredAt || null,
        podCompletedAt: delivery.podCompletedAt || null
      },
      metadata: delivery.metadata,
      createdAt: delivery.createdAt,
      updatedAt: delivery.updatedAt
    });

    console.log(`[Deliveries/POD] ✓ POD data retrieved successfully. Has POD: ${hasPOD}, Photos: ${delivery.photos?.length || 0}`);

  } catch (error: unknown) {
    const e = error as { message?: string };
    console.error('[Deliveries/POD] Error:', error);
    res.status(500).json({
      error: 'pod_retrieval_failed',
      detail: e.message
    });
  }
});

// PUT /api/admin/deliveries/:id/reschedule
// Admin-initiated reschedule: validates new date capacity, re-assigns driver, notifies customer.
// Status is set to scheduled-confirmed (not terminal) so the order stays visible and dispatchable.
router.put('/admin/:id/reschedule', authenticate, requireAnyRole('admin', 'delivery_team', 'logistics_team'), async (req: Request, res: Response): Promise<void> => {
  const { id: deliveryId } = req.params as { id: string };
  const { newDeliveryDate, reason } = req.body as { newDeliveryDate?: string; reason?: string };

  if (!newDeliveryDate) {
    res.status(400).json({ error: 'new_delivery_date_required' });
    return;
  }

  // Accept YYYY-MM-DD or ISO datetime; normalise to Dubai calendar date
  const iso = String(newDeliveryDate).trim().split('T')[0];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    res.status(400).json({ error: 'invalid_delivery_date', message: 'Use YYYY-MM-DD format.' });
    return;
  }

  // Must be a non-Sunday within the next 7 eligible days (same rule as customer portal)
  if (getDubaiWeekday(iso) === 0) {
    res.status(400).json({ error: 'invalid_delivery_date', message: 'Sunday deliveries are not available.' });
    return;
  }
  const eligibleDays = getNextSevenEligibleDayIsoStrings();
  if (!eligibleDays.includes(iso)) {
    res.status(400).json({ error: 'invalid_delivery_date', message: 'Date must be within the next 7 eligible delivery days.' });
    return;
  }

  try {
    const existingDelivery = await prisma.delivery.findUnique({
      where: { id: deliveryId },
      select: { id: true, status: true, phone: true, items: true, metadata: true, confirmedDeliveryDate: true, confirmationStatus: true }
    }) as Record<string, unknown> | null;

    if (!existingDelivery) {
      res.status(404).json({ error: 'delivery_not_found' });
      return;
    }

    const prevMeta = existingDelivery.metadata && typeof existingDelivery.metadata === 'object'
      ? (existingDelivery.metadata as Record<string, unknown>) : {};
    const reasonText = (reason || '').trim() || 'Operational requirements';

    // Check fleet capacity for the new date (exclude this delivery from count).
    try {
      await assertSlotAvailable(prisma, deliveryId, iso, existingDelivery.items as string | null, prevMeta);
    } catch (slotErr: unknown) {
      res.status(400).json({ error: 'slot_unavailable', message: (slotErr as Error).message });
      return;
    }

    const { start: newDateStart } = dubaiDayRangeUtc(iso);

    // Update delivery: mark as rescheduled with the new confirmed date.
    // 'rescheduled' is an active (non-terminal) status — the order still needs to be delivered.
    // No re-confirmation SMS is needed; customer is notified via their tracking page.
    const updatedDelivery = await prisma.delivery.update({
      where: { id: deliveryId },
      data: {
        status: 'rescheduled',
        confirmationStatus: 'confirmed',
        confirmedDeliveryDate: newDateStart,
        metadata: {
          ...prevMeta,
          rescheduleReason: reasonText,
          rescheduledAt: new Date().toISOString(),
          rescheduledBy: req.user?.username || req.user?.email || req.user?.sub || 'admin',
          previousStatus: existingDelivery.status,
          previousDeliveryDate: (existingDelivery.confirmedDeliveryDate as Date | null)?.toISOString() ?? null,
        }
      }
    }) as Record<string, unknown>;

    // Release old driver assignments so we can re-assign for the new date.
    await prisma.deliveryAssignment.deleteMany({ where: { deliveryId } });

    // Auto-assign the best driver for the new date (respects 30-item truck cap).
    try {
      await autoAssignDelivery(deliveryId);
    } catch (assignErr: unknown) {
      console.warn('[Deliveries] Reschedule auto-assign failed:', (assignErr as Error).message);
    }

    // Audit event
    await prisma.deliveryEvent.create({
      data: {
        deliveryId,
        eventType: 'admin_rescheduled',
        payload: {
          previousStatus: existingDelivery.status,
          previousDeliveryDate: (existingDelivery.confirmedDeliveryDate as Date | null)?.toISOString() ?? null,
          newDeliveryDate: newDateStart.toISOString(),
          newDeliveryDateDubai: iso,
          reason: reasonText,
          rescheduledBy: req.user?.username || req.user?.email || req.user?.sub || 'admin',
          rescheduledAt: new Date().toISOString(),
        },
        actorType: 'admin',
        actorId: req.user?.sub || null
      }
    }).catch((err: unknown) => {
      console.warn('[Deliveries] Failed to create reschedule event:', (err as Error).message);
    });

    // Notify customer by WhatsApp (awaited so we can return the link to frontend)
    let rescheduleWhatsappUrl: string | undefined;
    if (existingDelivery.phone) {
      try {
        const smsService = require('../sms/smsService');
        const smsResult = await smsService.sendRescheduleSms(deliveryId, newDateStart, reasonText) as { ok?: boolean; whatsappUrl?: string };
        rescheduleWhatsappUrl = smsResult?.whatsappUrl;
      } catch (err: unknown) {
        console.warn('[Deliveries] Reschedule SMS failed:', (err as Error).message);
      }
    }

    cache.invalidatePrefix('tracking:');
    cache.invalidatePrefix('dashboard:');
    cache.invalidatePrefix('deliveries:list:v2');

    res.json({
      ok: true,
      whatsappUrl: rescheduleWhatsappUrl || null,  // frontend auto-opens to notify customer
      delivery: {
        id: updatedDelivery.id,
        status: updatedDelivery.status,
        confirmedDeliveryDate: updatedDelivery.confirmedDeliveryDate,
        confirmedDeliveryDateDubai: iso,
        rescheduleReason: reasonText,
      }
    });
  } catch (err: unknown) {
    const e = err as { message?: string };
    console.error('[Deliveries] Admin reschedule error:', e.message);
    res.status(500).json({ error: 'reschedule_failed', detail: e.message });
  }
});

export default router;
