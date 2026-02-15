const express = require('express');
const router = express.Router();
const { authenticate, requireRole } = require('../auth');
const prisma = require('../db/prisma');

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
