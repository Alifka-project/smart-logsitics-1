const express = require('express');
const router = express.Router();
const { randomUUID } = require('crypto');
const { authenticate, requireRole } = require('../auth');
const prisma = require('../db/prisma');

/**
 * SAP Data Ingestion Endpoint
 * POST /api/sap/ingest
 * 
 * This endpoint receives data from SAP and properly saves it to the database
 * Including all customer details, items, and delivery information
 */
router.post('/ingest', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { deliveries } = req.body;

    console.log(`[SAP Ingestion] Received ${deliveries?.length || 0} deliveries from SAP`);

    if (!deliveries || !Array.isArray(deliveries)) {
      return res.status(400).json({ error: 'deliveries_array_required' });
    }

    if (deliveries.length === 0) {
      return res.status(400).json({ error: 'no_deliveries_provided' });
    }

    const results = [];
    const errors = [];

    for (let i = 0; i < deliveries.length; i++) {
      const delivery = deliveries[i];
      
      try {
        // Generate or use existing UUID
        let deliveryId = delivery.id;
        if (!deliveryId || !deliveryId.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
          deliveryId = randomUUID();
        }

        console.log(`[SAP Ingestion] Processing delivery ${i + 1}/${deliveries.length}: ${deliveryId}`);

        // Parse items from SAP format (could be array, object, or string)
        let itemsData = delivery.items;
        if (typeof itemsData === 'object' && !Array.isArray(itemsData)) {
          itemsData = JSON.stringify(itemsData);
        } else if (Array.isArray(itemsData)) {
          itemsData = JSON.stringify(itemsData);
        } else if (typeof itemsData !== 'string') {
          itemsData = null;
        }

        // Prepare comprehensive metadata from SAP
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
          ...delivery.metadata || {}
        };

        // Save to database with full SAP data
        const savedDelivery = await prisma.delivery.upsert({
          where: { id: deliveryId },
          update: {
            customer: delivery.customer || delivery.customerName || delivery.name || null,
            address: delivery.address || delivery.deliveryAddress || null,
            phone: delivery.phone || delivery.customerPhone || delivery.contactNumber || null,
            poNumber: delivery._originalPONumber || delivery.poNumber || null,
            lat: delivery.lat || delivery.latitude || null,
            lng: delivery.lng || delivery.longitude || null,
            status: delivery.status || 'pending',
            items: itemsData,
            metadata: metadata,
            updatedAt: new Date()
          },
          create: {
            id: deliveryId,
            customer: delivery.customer || delivery.customerName || delivery.name || null,
            address: delivery.address || delivery.deliveryAddress || null,
            phone: delivery.phone || delivery.customerPhone || delivery.contactNumber || null,
            poNumber: delivery._originalPONumber || delivery.poNumber || null,
            lat: delivery.lat || delivery.latitude || null,
            lng: delivery.lng || delivery.longitude || null,
            status: delivery.status || 'pending',
            items: itemsData,
            metadata: metadata
          }
        });

        // Create event for SAP sync
        await prisma.deliveryEvent.create({
          data: {
            deliveryId: savedDelivery.id,
            eventType: 'sap_sync',
            payload: {
              source: 'SAP',
              customer: savedDelivery.customer,
              address: savedDelivery.address,
              items: itemsData,
              syncedAt: new Date().toISOString()
            },
            actorType: 'system',
            actorId: req.user?.sub || null
          }
        }).catch(err => {
          console.warn(`[SAP Ingestion] Failed to create sync event:`, err.message);
        });

        console.log(`[SAP Ingestion] ✓ Successfully saved delivery: ${savedDelivery.customer} at ${savedDelivery.address?.substring(0, 50)}`);
        
        results.push({
          id: savedDelivery.id,
          customer: savedDelivery.customer,
          status: 'success'
        });

      } catch (err) {
        console.error(`[SAP Ingestion] Error saving delivery ${i + 1}:`, err);
        errors.push({
          index: i,
          error: err.message,
          delivery: delivery.customer || delivery.name || 'unknown'
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

  } catch (err) {
    console.error('[SAP Ingestion] Fatal error:', err);
    res.status(500).json({ 
      error: 'sap_ingestion_failed', 
      detail: err.message 
    });
  }
});

/**
 * Batch update endpoint for SAP status updates
 * PUT /api/sap/status-update
 */
router.put('/status-update', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { updates } = req.body; // Array of { id, status, metadata }

    if (!updates || !Array.isArray(updates)) {
      return res.status(400).json({ error: 'updates_array_required' });
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

        const updatedDelivery = await prisma.delivery.update({
          where: { id: id },
          data: {
            status: status,
            metadata: {
              ...(metadata || {}),
              sapStatusUpdatedAt: new Date().toISOString()
            },
            updatedAt: new Date()
          }
        });

        results.push({ id: updatedDelivery.id, status: 'updated' });

      } catch (err) {
        errors.push({ id: update.id, error: err.message });
      }
    }

    res.json({
      success: true,
      updated: results.length,
      failed: errors.length,
      results: results,
      errors: errors.length > 0 ? errors : undefined
    });

  } catch (err) {
    console.error('[SAP Status Update] Fatal error:', err);
    res.status(500).json({ 
      error: 'sap_status_update_failed', 
      detail: err.message 
    });
  }
});

module.exports = router;
