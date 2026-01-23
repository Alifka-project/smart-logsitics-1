/**
 * Customer Confirmation & Tracking API Routes
 * Public routes for SMS confirmation flow (no authentication required)
 */

const express = require('express');
const router = express.Router();
const smsService = require('../sms/smsService');
const prisma = require('../db/prisma');

/**
 * POST /api/customer/confirm-delivery/:token
 * Customer confirms delivery and selects delivery date
 * Public endpoint (token-based access)
 */
router.post('/confirm-delivery/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const { deliveryDate } = req.body;

    if (!token) {
      return res.status(400).json({ error: 'token_required' });
    }

    if (!deliveryDate) {
      return res.status(400).json({ error: 'delivery_date_required' });
    }

    const date = new Date(deliveryDate);
    if (isNaN(date.getTime())) {
      return res.status(400).json({ error: 'invalid_delivery_date' });
    }

    // Confirm delivery
    const result = await smsService.confirmDelivery(token, date);

    return res.json({
      ok: true,
      message: 'Delivery confirmed successfully',
      delivery: result.delivery
    });
  } catch (error) {
    console.error('POST /confirm-delivery error:', error);
    return res.status(400).json({
      error: 'confirmation_failed',
      message: error.message
    });
  }
});

/**
 * GET /api/customer/confirm-delivery/:token
 * Get delivery details for confirmation page
 * Public endpoint (token-based access)
 */
router.get('/confirm-delivery/:token', async (req, res) => {
  try {
    const { token } = req.params;

    if (!token) {
      return res.status(400).json({ error: 'token_required' });
    }

    // Validate token
    const validation = await smsService.validateConfirmationToken(token);
    if (!validation.isValid) {
      return res.status(400).json({
        error: 'invalid_token',
        message: validation.error
      });
    }

    const delivery = validation.delivery;

    // Parse items if it's a JSON string
    let items = [];
    if (delivery.items) {
      try {
        items = typeof delivery.items === 'string' ? JSON.parse(delivery.items) : delivery.items;
      } catch (e) {
        items = [{ description: delivery.items }];
      }
    }

    // Generate available delivery dates (next 7 days, excluding weekends)
    const availableDates = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (let i = 1; i <= 7; i++) {
      const date = new Date(today);
      date.setDate(date.getDate() + i);
      
      // Skip weekends (Saturday = 6, Sunday = 0)
      if (date.getDay() !== 0 && date.getDay() !== 6) {
        availableDates.push(date);
      }
    }

    return res.json({
      ok: true,
      delivery: {
        id: delivery.id,
        customer: delivery.customer,
        address: delivery.address,
        phone: delivery.phone,
        poNumber: delivery.poNumber,
        items,
        status: delivery.status,
        confirmedStatus: delivery.confirmationStatus,
        createdAt: delivery.createdAt
      },
      availableDates: availableDates.map(d => d.toISOString().split('T')[0]),
      isAlreadyConfirmed: validation.alreadyConfirmed || false
    });
  } catch (error) {
    console.error('GET /confirm-delivery error:', error);
    return res.status(500).json({
      error: 'server_error',
      message: error.message
    });
  }
});

/**
 * GET /api/customer/tracking/:token
 * Get real-time tracking information
 * Public endpoint (token-based access)
 */
router.get('/tracking/:token', async (req, res) => {
  try {
    const { token } = req.params;

    if (!token) {
      return res.status(400).json({ error: 'token_required' });
    }

    // Validate token
    const validation = await smsService.validateConfirmationToken(token);
    if (!validation.isValid) {
      return res.status(400).json({
        error: 'invalid_token',
        message: validation.error
      });
    }

    // Get tracking info
    const tracking = await smsService.getCustomerTracking(token);

    // Parse items if it's a JSON string
    let items = [];
    if (tracking.delivery.items) {
      try {
        items = typeof tracking.delivery.items === 'string' 
          ? JSON.parse(tracking.delivery.items) 
          : tracking.delivery.items;
      } catch (e) {
        items = [{ description: tracking.delivery.items }];
      }
    }

    // Format events into timeline
    const timeline = tracking.tracking.events.map(event => ({
      type: event.eventType,
      timestamp: event.createdAt,
      details: event.payload
    }));

    return res.json({
      ok: true,
      delivery: {
        ...tracking.delivery,
        items
      },
      tracking: {
        status: tracking.delivery.status,
        eta: tracking.tracking.eta,
        driver: tracking.tracking.assignment ? {
          name: tracking.tracking.assignment.driver.fullName,
          phone: tracking.tracking.assignment.driver.phone
        } : null,
        driverLocation: tracking.tracking.driverLocation ? {
          latitude: tracking.tracking.driverLocation.latitude,
          longitude: tracking.tracking.driverLocation.longitude,
          heading: tracking.tracking.driverLocation.heading,
          speed: tracking.tracking.driverLocation.speed,
          recordedAt: tracking.tracking.driverLocation.recordedAt
        } : null
      },
      timeline
    });
  } catch (error) {
    console.error('GET /tracking error:', error);
    return res.status(500).json({
      error: 'server_error',
      message: error.message
    });
  }
});

/**
 * POST /api/customer/resend-confirmation/:deliveryId
 * Resend confirmation SMS (admin can trigger)
 * Protected endpoint
 */
router.post('/resend-confirmation/:deliveryId', async (req, res) => {
  try {
    const { deliveryId } = req.params;

    if (!deliveryId) {
      return res.status(400).json({ error: 'delivery_id_required' });
    }

    const delivery = await prisma.delivery.findUnique({
      where: { id: deliveryId }
    });

    if (!delivery) {
      return res.status(404).json({ error: 'delivery_not_found' });
    }

    if (!delivery.phone) {
      return res.status(400).json({ error: 'no_phone_number' });
    }

    // Send confirmation SMS
    const result = await smsService.sendConfirmationSms(deliveryId, delivery.phone);

    return res.json({
      ok: true,
      message: 'Confirmation SMS resent',
      token: result.token,
      expiresAt: result.expiresAt
    });
  } catch (error) {
    console.error('POST /resend-confirmation error:', error);
    return res.status(500).json({
      error: 'resend_failed',
      message: error.message
    });
  }
});

module.exports = router;
