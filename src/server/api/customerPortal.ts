/**
 * Customer Confirmation & Tracking API Routes
 * Public routes for SMS confirmation flow (no authentication required)
 */

import { Router, Request, Response } from 'express';
import { getDateCapacityDetails, TRUCK_MAX_ITEMS_PER_DAY } from '../services/deliveryCapacityService';
import { authenticate, requireAnyRole } from '../auth.js';
import { fetchDrivingRouteBetweenPoints } from '../services/drivingRouteService.js';

const router = Router();
const smsService = require('../sms/smsService');
const prisma = require('../db/prisma').default;

/**
 * POST /api/customer/confirm-delivery/:token
 * Customer confirms delivery and selects delivery date
 * Public endpoint (token-based access)
 */
router.post('/confirm-delivery/:token', async (req: Request, res: Response): Promise<void> => {
  try {
    const { token } = req.params as { token: string };
    const { deliveryDate } = req.body as { deliveryDate?: string };

    if (!token) {
      return void res.status(400).json({ error: 'token_required' });
    }

    if (!deliveryDate) {
      return void res.status(400).json({ error: 'delivery_date_required' });
    }

    const iso = String(deliveryDate).trim().split('T')[0];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
      return void res.status(400).json({ error: 'invalid_delivery_date' });
    }

    const result = await smsService.confirmDelivery(token, iso);

    return void res.json({
      ok: true,
      message: 'Delivery confirmed successfully',
      delivery: result.delivery,
      thankYouWhatsappUrl: result.thankYouWhatsappUrl  // frontend auto-opens this after confirmation
    });
  } catch (error: unknown) {
    const e = error as { message?: string };
    console.error('POST /confirm-delivery error:', error);
    return void res.status(400).json({
      error: 'confirmation_failed',
      message: e.message
    });
  }
});

/**
 * GET /api/customer/confirm-delivery/:token
 * Get delivery details for confirmation page
 * Public endpoint (token-based access)
 */
router.get('/confirm-delivery/:token', async (req: Request, res: Response): Promise<void> => {
  try {
    const { token } = req.params as { token: string };

    if (!token) {
      return void res.status(400).json({ error: 'token_required' });
    }

    // Validate token
    const validation = await smsService.validateConfirmationToken(token);
    if (!validation.isValid) {
      return void res.status(400).json({
        error: 'invalid_token',
        message: validation.error
      });
    }

    const delivery = validation.delivery as {
      id: string;
      customer: string;
      address: string;
      phone: string;
      poNumber: string;
      items?: string | unknown[];
      status: string;
      confirmationStatus: string;
      createdAt: string;
    };

    // Parse items if it's a JSON string
    let items: unknown[] = [];
    if (delivery.items) {
      try {
        items = typeof delivery.items === 'string' ? JSON.parse(delivery.items) : delivery.items as unknown[];
      } catch (e) {
        items = [{ description: delivery.items }];
      }
    }

    const fullDelivery = validation.delivery as Record<string, unknown>;
    const meta =
      fullDelivery.metadata && typeof fullDelivery.metadata === 'object'
        ? (fullDelivery.metadata as Record<string, unknown>)
        : null;

    const slot = await getDateCapacityDetails(
      prisma,
      delivery.id,
      (fullDelivery.items as string | null | undefined) ?? null,
      meta
    );

    return void res.json({
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
        createdAt: delivery.createdAt,
        // Include confirmed delivery date so UI can show "Your delivery is confirmed for <date>"
        confirmedDeliveryDate: (fullDelivery.confirmedDeliveryDate as string | null) ?? null,
        goodsMovementDate: (fullDelivery.goodsMovementDate as string | null) ?? null,
        deliveryNumber: (fullDelivery.deliveryNumber as string | null) ?? null,
        // Needed so customer UI can resolve SAP delivery no. (500…) from upload row / aliases
        metadata: fullDelivery.metadata ?? null,
      },
      availableDates: slot.availableDates,
      capacityDays: slot.days,           // full per-day detail for UI rendering
      orderItemCount: slot.orderItemCount,
      exceedsTruckCapacity: slot.exceedsTruckCapacity,
      truckMaxItems: TRUCK_MAX_ITEMS_PER_DAY,
      isAlreadyConfirmed: validation.alreadyConfirmed || false
    });
  } catch (error: unknown) {
    const e = error as { message?: string };
    console.error('GET /confirm-delivery error:', error);
    return void res.status(500).json({
      error: 'server_error',
      message: e.message
    });
  }
});

/**
 * GET /api/customer/tracking/:token
 * Get real-time tracking information
 * Public endpoint (token-based access)
 */
router.get('/tracking/:token', async (req: Request, res: Response): Promise<void> => {
  try {
    const { token } = req.params as { token: string };

    if (!token) {
      return void res.status(400).json({ error: 'token_required' });
    }

    // Validate token
    const validation = await smsService.validateConfirmationToken(token);
    if (!validation.isValid) {
      return void res.status(400).json({
        error: 'invalid_token',
        message: validation.error
      });
    }

    // Get tracking info
    const tracking = await smsService.getCustomerTracking(token) as {
      delivery: {
        status: string;
        items?: string | unknown[];
        [key: string]: unknown;
      };
      tracking: {
        events: Array<{ eventType: string; createdAt: string; payload: unknown }>;
        eta: unknown;
        assignment?: {
          driver: { fullName: string; phone: string };
        };
        driverLocation?: {
          latitude: number;
          longitude: number;
          heading: number;
          speed: number;
          recordedAt: string;
        };
      };
    };

    // Parse items if it's a JSON string
    let items: unknown[] = [];
    if (tracking.delivery.items) {
      try {
        items = typeof tracking.delivery.items === 'string'
          ? JSON.parse(tracking.delivery.items)
          : tracking.delivery.items as unknown[];
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

    return void res.json({
      ok: true,
      delivery: {
        ...tracking.delivery,
        items
      },
      tracking: {
        status: tracking.delivery.status,
        eta: tracking.tracking.eta,
        driver: tracking.tracking.assignment?.driver ? {
          name: (tracking.tracking.assignment.driver as { fullName?: string }).fullName,
          phone: (tracking.tracking.assignment.driver as { phone?: string }).phone
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
  } catch (error: unknown) {
    const e = error as { message?: string };
    console.error('GET /tracking error:', error);
    return void res.status(500).json({
      error: 'server_error',
      message: e.message
    });
  }
});

/**
 * GET /api/customer/driving-route/:token
 * Road-following polyline for live map (token must match tracking link).
 */
router.get('/driving-route/:token', async (req: Request, res: Response): Promise<void> => {
  try {
    const { token } = req.params as { token: string };
    const q = req.query as Record<string, string | undefined>;
    const fromLat = Number(q.fromLat);
    const fromLng = Number(q.fromLng);
    const toLat = Number(q.toLat);
    const toLng = Number(q.toLng);

    if (!token) {
      return void res.status(400).json({ error: 'token_required' });
    }

    const validation = await smsService.validateConfirmationToken(token);
    if (!validation.isValid) {
      return void res.status(400).json({
        error: 'invalid_token',
        message: validation.error
      });
    }

    if (![fromLat, fromLng, toLat, toLng].every((n) => Number.isFinite(n))) {
      return void res.status(400).json({ error: 'invalid_coordinates' });
    }

    const route = await fetchDrivingRouteBetweenPoints(
      { lat: fromLat, lng: fromLng },
      { lat: toLat, lng: toLng },
    );

    if (!route?.coordinates?.length) {
      return void res.status(502).json({ error: 'routing_unavailable' });
    }

    return void res.json({
      ok: true,
      coordinates: route.coordinates,
      source: route.source,
    });
  } catch (error: unknown) {
    const e = error as { message?: string };
    console.error('GET /driving-route error:', error);
    return void res.status(500).json({
      error: 'server_error',
      message: e.message
    });
  }
});

/**
 * POST /api/customer/resend-confirmation/:deliveryId
 * Resend confirmation SMS (admin can trigger)
 * Protected endpoint
 */
router.post('/resend-confirmation/:deliveryId', authenticate, requireAnyRole('admin', 'delivery_team', 'logistics_team'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { deliveryId } = req.params as { deliveryId: string };

    if (!deliveryId) {
      return void res.status(400).json({ error: 'delivery_id_required' });
    }

    const delivery = await prisma.delivery.findUnique({
      where: { id: deliveryId }
    }) as { id: string; phone?: string } | null;

    if (!delivery) {
      return void res.status(404).json({ error: 'delivery_not_found' });
    }

    if (!delivery.phone) {
      return void res.status(400).json({ error: 'no_phone_number' });
    }

    const smsResult = await smsService.sendConfirmationSms(deliveryId, delivery.phone) as { whatsappUrl?: string };

    // Never return the raw token to the caller
    return void res.json({
      ok: true,
      message: 'Confirmation link ready',
      whatsappUrl: smsResult?.whatsappUrl  // present during SMS compliance-pending period
    });
  } catch (error: unknown) {
    const e = error as { message?: string };
    console.error('POST /resend-confirmation error:', error);
    return void res.status(500).json({
      error: 'resend_failed',
      message: e.message
    });
  }
});

export default router;
