"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const crypto_1 = require("crypto");
const auth_js_1 = require("../auth.js");
const deliveryDedupService_js_1 = require("../services/deliveryDedupService.js");
const prisma_js_1 = __importDefault(require("../db/prisma.js"));
const router = (0, express_1.Router)();
/**
 * SAP Data Ingestion Endpoint
 * POST /api/sap/ingest
 *
 * This endpoint receives data from SAP and properly saves it to the database
 * Including all customer details, items, and delivery information
 */
router.post('/ingest', auth_js_1.authenticate, (0, auth_js_1.requireRole)('admin'), async (req, res) => {
    try {
        const { deliveries } = req.body;
        console.log(`[SAP Ingestion] Received ${deliveries?.length || 0} deliveries from SAP`);
        if (!deliveries || !Array.isArray(deliveries)) {
            res.status(400).json({ error: 'deliveries_array_required' });
            return;
        }
        if (deliveries.length === 0) {
            res.status(400).json({ error: 'no_deliveries_provided' });
            return;
        }
        const results = [];
        const errors = [];
        for (let i = 0; i < deliveries.length; i++) {
            const delivery = deliveries[i];
            try {
                let deliveryId = delivery.id;
                if (!deliveryId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(deliveryId)) {
                    deliveryId = (0, crypto_1.randomUUID)();
                }
                console.log(`[SAP Ingestion] Processing delivery ${i + 1}/${deliveries.length}: ${deliveryId}`);
                let itemsData = delivery.items;
                if (typeof itemsData === 'object' && !Array.isArray(itemsData)) {
                    itemsData = JSON.stringify(itemsData);
                }
                else if (Array.isArray(itemsData)) {
                    itemsData = JSON.stringify(itemsData);
                }
                else if (typeof itemsData !== 'string') {
                    itemsData = null;
                }
                const metadata = {
                    sapDeliveryNumber: delivery.sapDeliveryNumber || delivery.deliveryNumber || null,
                    sapOrderNumber: delivery.sapOrderNumber || delivery.orderNumber || null,
                    sapCustomerNumber: delivery.sapCustomerNumber || delivery.customerNumber || null,
                    originalPONumber: delivery._originalPONumber || delivery.poNumber || null,
                    originalDeliveryNumber: delivery._originalDeliveryNumber || null,
                    originalQuantity: delivery._originalQuantity || delivery.quantity || null,
                    originalCity: delivery._originalCity || delivery.city || null,
                    originalRoute: delivery._originalRoute || delivery.route || null,
                    warehouse: delivery.warehouse || null,
                    weight: delivery.weight || null,
                    volume: delivery.volume || null,
                    specialInstructions: delivery.specialInstructions || null,
                    customerPreferences: delivery.customerPreferences || null,
                    itemDetails: delivery.itemDetails || null,
                    sapSyncedAt: new Date().toISOString(),
                    ...(delivery.metadata || {})
                };
                const poNumberToSave = (delivery._originalPONumber || delivery.poNumber || null);
                const originalDeliveryNumber = (metadata.originalDeliveryNumber ||
                    metadata.sapDeliveryNumber ||
                    null);
                const businessKey = (0, deliveryDedupService_js_1.buildBusinessKey)(poNumberToSave, originalDeliveryNumber);
                const incoming = {
                    id: deliveryId,
                    customer: (delivery.customer || delivery.customerName || delivery.name || null),
                    address: (delivery.address || delivery.deliveryAddress || null),
                    phone: (delivery.phone || delivery.customerPhone || delivery.contactNumber || null),
                    poNumber: poNumberToSave,
                    lat: (delivery.lat || delivery.latitude || null),
                    lng: (delivery.lng || delivery.longitude || null),
                    status: (delivery.status || 'pending'),
                    items: itemsData,
                    metadata,
                    businessKey
                };
                const { delivery: savedDelivery, existed } = await (0, deliveryDedupService_js_1.upsertDeliveryByBusinessKey)({
                    prisma: prisma_js_1.default,
                    source: 'sap',
                    incoming
                });
                await prisma_js_1.default.deliveryEvent.create({
                    data: {
                        deliveryId: savedDelivery.id,
                        eventType: existed ? 'sap_reimport' : 'sap_sync',
                        payload: {
                            source: 'SAP',
                            customer: savedDelivery.customer,
                            address: savedDelivery.address,
                            items: itemsData,
                            syncedAt: new Date().toISOString(),
                            businessKey: savedDelivery.businessKey || businessKey || null,
                            deduplicated: !!existed
                        },
                        actorType: 'system',
                        actorId: req.user?.sub || null
                    }
                }).catch((err) => {
                    const e = err;
                    console.warn(`[SAP Ingestion] Failed to create sync event:`, e.message);
                });
                console.log(`[SAP Ingestion] ✓ Successfully saved delivery: ${savedDelivery.customer} at ${(savedDelivery.address || '').substring(0, 50)}`);
                results.push({
                    id: savedDelivery.id,
                    customer: savedDelivery.customer,
                    status: 'success'
                });
            }
            catch (err) {
                const e = err;
                console.error(`[SAP Ingestion] Error saving delivery ${i + 1}:`, err);
                errors.push({
                    index: i,
                    error: e.message ?? 'unknown error',
                    delivery: (delivery.customer || delivery.name || 'unknown')
                });
            }
        }
        console.log(`[SAP Ingestion] ✓ Completed: ${results.length} saved, ${errors.length} errors`);
        res.json({
            success: true,
            saved: results.length,
            failed: errors.length,
            results: results,
            errors: errors.length > 0 ? errors : undefined
        });
    }
    catch (err) {
        const e = err;
        console.error('[SAP Ingestion] Fatal error:', err);
        res.status(500).json({
            error: 'sap_ingestion_failed',
            detail: e.message
        });
    }
});
/**
 * Batch update endpoint for SAP status updates
 * PUT /api/sap/status-update
 */
router.put('/status-update', auth_js_1.authenticate, (0, auth_js_1.requireRole)('admin'), async (req, res) => {
    try {
        const { updates } = req.body;
        if (!updates || !Array.isArray(updates)) {
            res.status(400).json({ error: 'updates_array_required' });
            return;
        }
        const results = [];
        const errors = [];
        for (const update of updates) {
            try {
                const { id, status, metadata } = update;
                if (!id || !status) {
                    errors.push({ id: id || 'unknown', error: 'missing_id_or_status' });
                    continue;
                }
                const updatedDelivery = await prisma_js_1.default.delivery.update({
                    where: { id },
                    data: {
                        status,
                        metadata: {
                            ...(metadata || {}),
                            sapStatusUpdatedAt: new Date().toISOString()
                        },
                        updatedAt: new Date()
                    }
                });
                results.push({ id: updatedDelivery.id, status: 'updated' });
            }
            catch (err) {
                const e = err;
                errors.push({ id: update.id, error: e.message ?? 'unknown error' });
            }
        }
        res.json({
            success: true,
            updated: results.length,
            failed: errors.length,
            results,
            errors: errors.length > 0 ? errors : undefined
        });
    }
    catch (err) {
        const e = err;
        console.error('[SAP Status Update] Fatal error:', err);
        res.status(500).json({
            error: 'sap_status_update_failed',
            detail: e.message
        });
    }
});
exports.default = router;
