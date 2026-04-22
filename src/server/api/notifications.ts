import { Router, Request, Response } from 'express';
import { authenticate, requireRole, requireAnyRole } from '../auth.js';
import prisma from '../db/prisma.js';

const router = Router();

// ─────────────────────────────────────────────────────────────
// ADMIN ALERT NOTIFICATIONS  (AdminNotification table)
// ─────────────────────────────────────────────────────────────

/**
 * GET /api/admin/notifications/alerts
 * Returns recent unread AdminNotification records (driver_arrived, status_changed, overdue).
 * Admin, Delivery Team and Logistics Team.
 */
router.get('/alerts', authenticate, requireAnyRole('admin', 'delivery_team', 'logistics_team'), async (req: Request, res: Response): Promise<void> => {
  try {
    const notifications = await (prisma as any).adminNotification.findMany({
      where: { isRead: false },
      orderBy: { createdAt: 'desc' },
      take: 50
    });

    // BigInt id must be serialized as string — JSON.stringify cannot handle BigInt natively
    const safe = notifications.map(n => ({ ...n, id: String(n.id) }));
    res.json({ ok: true, count: safe.length, notifications: safe });
  } catch (error: unknown) {
    const e = error as { code?: string; message?: string };
    // P2021 = table does not exist (migration not yet applied) — return empty gracefully
    if (e.code === 'P2021' || e.message?.includes('does not exist') || e.message?.includes('relation')) {
      console.warn('[Notifications/Alerts] Table not found — migration pending. Returning empty.');
      res.json({ ok: true, count: 0, notifications: [] }); return;
    }
    console.error('[Notifications/Alerts] Error:', error);
    res.status(500).json({ error: 'fetch_failed', detail: e.message });
  }
});

/**
 * GET /api/admin/notifications/alerts/count
 * Badge count of unread AdminNotification records.
 * Admin, Delivery Team and Logistics Team.
 */
router.get('/alerts/count', authenticate, requireAnyRole('admin', 'delivery_team', 'logistics_team'), async (req: Request, res: Response): Promise<void> => {
  try {
    const count = await (prisma as any).adminNotification.count({ where: { isRead: false } });
    res.json({ ok: true, count });
  } catch (error: unknown) {
    const e = error as { code?: string; message?: string };
    if (e.code === 'P2021' || e.message?.includes('does not exist') || e.message?.includes('relation')) {
      res.json({ ok: true, count: 0 }); return;
    }
    console.error('[Notifications/AlertsCount] Error:', error);
    res.status(500).json({ error: 'fetch_failed', detail: e.message });
  }
});

/**
 * PUT /api/admin/notifications/alerts/:id/read
 * Mark a single AdminNotification as read.
 * Admin, Delivery Team and Logistics Team.
 */
router.put('/alerts/:id/read', authenticate, requireAnyRole('admin', 'delivery_team', 'logistics_team'), async (req: Request, res: Response): Promise<void> => {
  try {
    const idStr = req.params.id as string;
    if (!idStr || !/^\d+$/.test(idStr)) { res.status(400).json({ error: 'invalid_id' }); return; }
    const id = BigInt(idStr);

    await (prisma as any).adminNotification.update({
      where: { id },
      data: { isRead: true }
    });

    res.json({ ok: true });
  } catch (error: unknown) {
    const e = error as { code?: string; message?: string };
    if (e.code === 'P2021' || e.message?.includes('does not exist') || e.message?.includes('relation')) {
      res.json({ ok: true }); return;
    }
    console.error('[Notifications/MarkRead] Error:', error);
    res.status(500).json({ error: 'update_failed', detail: e.message });
  }
});

/**
 * POST /api/admin/notifications/alerts/mark-all-read
 * Mark all unread AdminNotifications as read.
 * Admin only.
 */
router.post('/alerts/mark-all-read', authenticate, requireAnyRole('admin', 'delivery_team', 'logistics_team'), async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await (prisma as any).adminNotification.updateMany({
      where: { isRead: false },
      data: { isRead: true }
    });
    res.json({ ok: true, updated: result.count });
  } catch (error: unknown) {
    const e = error as { code?: string; message?: string };
    if (e.code === 'P2021' || e.message?.includes('does not exist') || e.message?.includes('relation')) {
      res.json({ ok: true, updated: 0 }); return;
    }
    console.error('[Notifications/MarkAllRead] Error:', error);
    res.status(500).json({ error: 'update_failed', detail: e.message });
  }
});

// ─────────────────────────────────────────────────────────────
// OVERDUE DELIVERIES  (pending/in-transit > 24 hours)
// ─────────────────────────────────────────────────────────────

/**
 * GET /api/admin/notifications/overdue-deliveries
 * Returns deliveries that have been active (not delivered/cancelled) for more than 24 hours.
 * Admin only.
 */
router.get('/overdue-deliveries', authenticate, requireAnyRole('admin', 'delivery_team', 'logistics_team'), async (req: Request, res: Response): Promise<void> => {
  try {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const overdueDeliveries = await prisma.delivery.findMany({
      where: {
        status: { notIn: ['delivered', 'completed', 'cancelled', 'delivered-with-installation', 'delivered-without-installation'] },
        createdAt: { lt: twentyFourHoursAgo }
      },
      select: {
        id: true,
        customer: true,
        address: true,
        phone: true,
        poNumber: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        assignments: {
          take: 1,
          orderBy: { assignedAt: 'desc' },
          select: {
            driver: { select: { fullName: true, phone: true } },
            status: true,
            assignedAt: true
          }
        }
      },
      orderBy: { createdAt: 'asc' }
    });

    const enriched = overdueDeliveries.map(d => ({
      id: d.id,
      customer: d.customer,
      address: d.address,
      phone: d.phone,
      poNumber: d.poNumber,
      status: d.status,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
      hoursOverdue: Math.floor((Date.now() - new Date(d.createdAt).getTime()) / (60 * 60 * 1000)),
      driverName: d.assignments?.[0]?.driver?.fullName || null,
      driverPhone: d.assignments?.[0]?.driver?.phone || null
    }));

    res.json({ ok: true, count: enriched.length, deliveries: enriched });
  } catch (error: unknown) {
    const e = error as { message?: string };
    console.error('[Notifications/Overdue] Error:', error);
    res.status(500).json({ error: 'fetch_failed', detail: e.message });
  }
});

/**
 * GET /api/admin/notifications/overdue-count
 * Returns combined count: overdue deliveries + unconfirmed SMS deliveries.
 * Admin only.
 */
router.get('/overdue-count', authenticate, requireAnyRole('admin', 'delivery_team', 'logistics_team'), async (req: Request, res: Response): Promise<void> => {
  try {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [overdueCount, unconfirmedCount] = await Promise.all([
      prisma.delivery.count({
        where: {
          status: { notIn: ['delivered', 'completed', 'cancelled', 'delivered-with-installation', 'delivered-without-installation'] },
          createdAt: { lt: twentyFourHoursAgo }
        }
      }),
      prisma.delivery.count({
        where: {
          confirmationToken: { not: null },
          confirmationStatus: 'pending',
          createdAt: { lt: twentyFourHoursAgo },
          tokenExpiresAt: { gt: new Date() }
        }
      })
    ]);

    res.json({ ok: true, overdueCount, unconfirmedCount, total: overdueCount + unconfirmedCount });
  } catch (error: unknown) {
    const e = error as { message?: string };
    console.error('[Notifications/OverdueCount] Error:', error);
    res.status(500).json({ error: 'fetch_failed', detail: e.message });
  }
});


/**
 * GET /api/notifications/unconfirmed-deliveries
 * Returns deliveries with SMS sent but not confirmed within 24 hours
 * Admin only - for notification system
 */
router.get('/unconfirmed-deliveries', authenticate, requireAnyRole('admin', 'delivery_team', 'logistics_team'), async (req: Request, res: Response): Promise<void> => {
  try {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const unconfirmedDeliveries = await prisma.delivery.findMany({
      where: {
        confirmationToken: { not: null },
        confirmationStatus: 'pending',
        createdAt: { lt: twentyFourHoursAgo },
        tokenExpiresAt: { gt: new Date() }
      },
      include: {
        smsLogs: {
          where: { 
            status: { in: ['sent', 'delivered'] }
          },
          orderBy: { sentAt: 'desc' },
          take: 1
        }
      },
      orderBy: { createdAt: 'asc' }
    });

    const enrichedDeliveries = unconfirmedDeliveries.map(delivery => {
      const lastSms = delivery.smsLogs[0];
      const hoursSinceSms = lastSms 
        ? Math.floor((Date.now() - new Date(lastSms.sentAt).getTime()) / (60 * 60 * 1000))
        : null;

      return {
        id: delivery.id,
        customer: delivery.customer,
        address: delivery.address,
        phone: delivery.phone,
        poNumber: delivery.poNumber,
        createdAt: delivery.createdAt,
        smsSentAt: lastSms?.sentAt,
        hoursSinceSms,
        tokenExpiresAt: delivery.tokenExpiresAt
      };
    });

    res.json({
      ok: true,
      count: enrichedDeliveries.length,
      deliveries: enrichedDeliveries
    });
  } catch (error: unknown) {
    const e = error as { message?: string };
    console.error('[Notifications] Error fetching unconfirmed deliveries:', error);
    res.status(500).json({ 
      error: 'fetch_failed', 
      detail: e.message 
    });
  }
});

/**
 * GET /api/notifications/count
 * Returns count of unconfirmed deliveries for badge display
 * Admin only
 */
router.get('/count', authenticate, requireAnyRole('admin', 'delivery_team', 'logistics_team'), async (req: Request, res: Response): Promise<void> => {
  try {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const count = await prisma.delivery.count({
      where: {
        confirmationToken: { not: null },
        confirmationStatus: 'pending',
        createdAt: { lt: twentyFourHoursAgo },
        tokenExpiresAt: { gt: new Date() }
      }
    });

    res.json({ ok: true, count });
  } catch (error: unknown) {
    const e = error as { message?: string };
    console.error('[Notifications] Error fetching count:', error);
    res.status(500).json({ error: 'fetch_failed', detail: e.message });
  }
});

/**
 * POST /api/notifications/resend-sms/:deliveryId
 * Resend SMS confirmation to customer
 * Admin only
 */
router.post('/resend-sms/:deliveryId', authenticate, requireAnyRole('admin', 'delivery_team', 'logistics_team'), async (req: Request, res: Response): Promise<void> => {
  try {
    const deliveryId = req.params.deliveryId as string;

    const delivery = await prisma.delivery.findUnique({
      where: { id: deliveryId }
    });

    if (!delivery) {
      res.status(404).json({ error: 'delivery_not_found' }); return;
    }

    if (!delivery.phone) {
      res.status(400).json({ error: 'no_phone_number' }); return;
    }

    const { sendConfirmationSms } = await import('../sms/smsService.js');
    const result = await sendConfirmationSms(deliveryId, delivery.phone as string) as unknown as { messageId: string; token: string; expiresAt: string };

    res.json({
      ok: true,
      messageId: result.messageId,
      token: result.token,
      expiresAt: result.expiresAt,
    });
  } catch (error: unknown) {
    const e = error as { message?: string };
    console.error('[Notifications] Error resending SMS:', error);
    res.status(500).json({ error: 'resend_failed', detail: e.message });
  }
});

export default router;
