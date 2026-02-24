const express = require('express');
const router = express.Router();
const { authenticate, requireRole } = require('../auth');
const prisma = require('../db/prisma');

// ─────────────────────────────────────────────────────────────
// ADMIN ALERT NOTIFICATIONS  (AdminNotification table)
// ─────────────────────────────────────────────────────────────

/**
 * GET /api/admin/notifications/alerts
 * Returns recent unread AdminNotification records (driver_arrived, status_changed, overdue).
 * Admin only.
 */
router.get('/alerts', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const notifications = await prisma.adminNotification.findMany({
      where: { isRead: false },
      orderBy: { createdAt: 'desc' },
      take: 50
    });

    res.json({ ok: true, count: notifications.length, notifications });
  } catch (error) {
    console.error('[Notifications/Alerts] Error:', error);
    res.status(500).json({ error: 'fetch_failed', detail: error.message });
  }
});

/**
 * GET /api/admin/notifications/alerts/count
 * Badge count of unread AdminNotification records.
 * Admin only.
 */
router.get('/alerts/count', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const count = await prisma.adminNotification.count({ where: { isRead: false } });
    res.json({ ok: true, count });
  } catch (error) {
    console.error('[Notifications/AlertsCount] Error:', error);
    res.status(500).json({ error: 'fetch_failed', detail: error.message });
  }
});

/**
 * PUT /api/admin/notifications/alerts/:id/read
 * Mark a single AdminNotification as read.
 * Admin only.
 */
router.put('/alerts/:id/read', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'invalid_id' });

    await prisma.adminNotification.update({
      where: { id },
      data: { isRead: true }
    });

    res.json({ ok: true });
  } catch (error) {
    console.error('[Notifications/MarkRead] Error:', error);
    res.status(500).json({ error: 'update_failed', detail: error.message });
  }
});

/**
 * POST /api/admin/notifications/alerts/mark-all-read
 * Mark all unread AdminNotifications as read.
 * Admin only.
 */
router.post('/alerts/mark-all-read', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const result = await prisma.adminNotification.updateMany({
      where: { isRead: false },
      data: { isRead: true }
    });
    res.json({ ok: true, updated: result.count });
  } catch (error) {
    console.error('[Notifications/MarkAllRead] Error:', error);
    res.status(500).json({ error: 'update_failed', detail: error.message });
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
router.get('/overdue-deliveries', authenticate, requireRole('admin'), async (req, res) => {
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
  } catch (error) {
    console.error('[Notifications/Overdue] Error:', error);
    res.status(500).json({ error: 'fetch_failed', detail: error.message });
  }
});

/**
 * GET /api/admin/notifications/overdue-count
 * Returns combined count: overdue deliveries + unconfirmed SMS deliveries.
 * Admin only.
 */
router.get('/overdue-count', authenticate, requireRole('admin'), async (req, res) => {
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
  } catch (error) {
    console.error('[Notifications/OverdueCount] Error:', error);
    res.status(500).json({ error: 'fetch_failed', detail: error.message });
  }
});


/**
 * GET /api/notifications/unconfirmed-deliveries
 * Returns deliveries with SMS sent but not confirmed within 24 hours
 * Admin only - for notification system
 */
router.get('/unconfirmed-deliveries', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    
    // Find deliveries where:
    // 1. SMS was sent (confirmationToken exists)
    // 2. Status is still pending (not confirmed)
    // 3. Token was created more than 24 hours ago
    // 4. Token hasn't expired yet
    const unconfirmedDeliveries = await prisma.delivery.findMany({
      where: {
        confirmationToken: { not: null },
        confirmationStatus: 'pending',
        createdAt: { lt: twentyFourHoursAgo },
        tokenExpiresAt: { gt: new Date() } // Token still valid
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

    // Calculate hours since SMS sent
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
  } catch (error) {
    console.error('[Notifications] Error fetching unconfirmed deliveries:', error);
    res.status(500).json({ 
      error: 'fetch_failed', 
      detail: error.message 
    });
  }
});

/**
 * GET /api/notifications/count
 * Returns count of unconfirmed deliveries for badge display
 * Admin only
 */
router.get('/count', authenticate, requireRole('admin'), async (req, res) => {
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
  } catch (error) {
    console.error('[Notifications] Error fetching count:', error);
    res.status(500).json({ error: 'fetch_failed', detail: error.message });
  }
});

/**
 * POST /api/notifications/resend-sms/:deliveryId
 * Resend SMS confirmation to customer
 * Admin only
 */
router.post('/resend-sms/:deliveryId', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { deliveryId } = req.params;
    
    const delivery = await prisma.delivery.findUnique({
      where: { id: deliveryId }
    });

    if (!delivery) {
      return res.status(404).json({ error: 'delivery_not_found' });
    }

    if (!delivery.phone) {
      return res.status(400).json({ error: 'no_phone_number' });
    }

    // Use SMS service to resend
    const smsService = require('../sms/smsService');
    const result = await smsService.sendConfirmationSms(deliveryId, delivery.phone);

    res.json({ 
      ok: true, 
      messageId: result.messageId,
      token: result.token,
      expiresAt: result.expiresAt
    });
  } catch (error) {
    console.error('[Notifications] Error resending SMS:', error);
    res.status(500).json({ error: 'resend_failed', detail: error.message });
  }
});

module.exports = router;
