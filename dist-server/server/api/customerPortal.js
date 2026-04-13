"use strict";
/**
 * Customer Confirmation & Tracking API Routes
 * Public routes for SMS confirmation flow (no authentication required)
 */
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const deliveryCapacityService_1 = require("../services/deliveryCapacityService");
const auth_js_1 = require("../auth.js");
const drivingRouteService_js_1 = require("../services/drivingRouteService.js");
const router = (0, express_1.Router)();
const smsService = require('../sms/smsService');
const prisma = require('../db/prisma').default;
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
            thankYouWhatsappUrl: result.thankYouWhatsappUrl // frontend auto-opens this after confirmation
        });
    }
    catch (error) {
        const e = error;
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
router.get('/confirm-delivery/:token', async (req, res) => {
    try {
        const { token } = req.params;
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
        const delivery = validation.delivery;
        // Parse items if it's a JSON string
        let items = [];
        if (delivery.items) {
            try {
                items = typeof delivery.items === 'string' ? JSON.parse(delivery.items) : delivery.items;
            }
            catch (e) {
                items = [{ description: delivery.items }];
            }
        }
        const fullDelivery = validation.delivery;
        const meta = fullDelivery.metadata && typeof fullDelivery.metadata === 'object'
            ? fullDelivery.metadata
            : null;
        const slot = await (0, deliveryCapacityService_1.getDateCapacityDetails)(prisma, delivery.id, fullDelivery.items ?? null, meta);
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
                confirmedDeliveryDate: fullDelivery.confirmedDeliveryDate ?? null,
                goodsMovementDate: fullDelivery.goodsMovementDate ?? null,
                deliveryNumber: fullDelivery.deliveryNumber ?? null,
                // Needed so customer UI can resolve SAP delivery no. (500…) from upload row / aliases
                metadata: fullDelivery.metadata ?? null,
            },
            availableDates: slot.availableDates,
            capacityDays: slot.days, // full per-day detail for UI rendering
            orderItemCount: slot.orderItemCount,
            exceedsTruckCapacity: slot.exceedsTruckCapacity,
            truckMaxItems: deliveryCapacityService_1.TRUCK_MAX_ITEMS_PER_DAY,
            isAlreadyConfirmed: validation.alreadyConfirmed || false
        });
    }
    catch (error) {
        const e = error;
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
router.get('/tracking/:token', async (req, res) => {
    try {
        const { token } = req.params;
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
        const tracking = await smsService.getCustomerTracking(token);
        // Parse items if it's a JSON string
        let items = [];
        if (tracking.delivery.items) {
            try {
                items = typeof tracking.delivery.items === 'string'
                    ? JSON.parse(tracking.delivery.items)
                    : tracking.delivery.items;
            }
            catch (e) {
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
    }
    catch (error) {
        const e = error;
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
router.get('/driving-route/:token', async (req, res) => {
    try {
        const { token } = req.params;
        const q = req.query;
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
        const route = await (0, drivingRouteService_js_1.fetchDrivingRouteBetweenPoints)({ lat: fromLat, lng: fromLng }, { lat: toLat, lng: toLng });
        if (!route?.coordinates?.length) {
            return void res.status(502).json({ error: 'routing_unavailable' });
        }
        return void res.json({
            ok: true,
            coordinates: route.coordinates,
            source: route.source,
        });
    }
    catch (error) {
        const e = error;
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
router.post('/resend-confirmation/:deliveryId', auth_js_1.authenticate, (0, auth_js_1.requireAnyRole)('admin', 'delivery_team', 'logistics_team'), async (req, res) => {
    try {
        const { deliveryId } = req.params;
        if (!deliveryId) {
            return void res.status(400).json({ error: 'delivery_id_required' });
        }
        const delivery = await prisma.delivery.findUnique({
            where: { id: deliveryId }
        });
        if (!delivery) {
            return void res.status(404).json({ error: 'delivery_not_found' });
        }
        if (!delivery.phone) {
            return void res.status(400).json({ error: 'no_phone_number' });
        }
        const smsResult = await smsService.sendConfirmationSms(deliveryId, delivery.phone);
        // Never return the raw token to the caller
        return void res.json({
            ok: true,
            message: 'Confirmation link ready',
            whatsappUrl: smsResult?.whatsappUrl // present during SMS compliance-pending period
        });
    }
    catch (error) {
        const e = error;
        console.error('POST /resend-confirmation error:', error);
        return void res.status(500).json({
            error: 'resend_failed',
            message: e.message
        });
    }
});
exports.default = router;
