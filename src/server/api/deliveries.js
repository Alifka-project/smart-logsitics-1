const express = require('express');
const router = express.Router();
const { randomUUID } = require('crypto');
const { authenticate, requireRole } = require('../auth');
const sapService = require('../../../services/sapService');
const { autoAssignDeliveries, getAvailableDrivers } = require('../services/autoAssignmentService');
const { buildBusinessKey, upsertDeliveryByBusinessKey } = require('../services/deliveryDedupService');
const prisma = require('../db/prisma');
const cache = require('../cache');
const { sortDeliveriesIncompleteLast } = require('../utils/deliveryListSort');
const { normalizePhone } = require('../utils/phoneUtils');

async function deliveryExists(deliveryId) {
  try {
    const resp = await sapService.call(`/Deliveries/${deliveryId}`, 'get');
    return resp && resp.status && resp.status < 400;
  } catch (e) {
    return false;
  }
}

// POST /api/deliveries/:id/status
// body: { status, actor_type, actor_id, note }
router.post('/:id/status', authenticate, async (req, res) => {
  const deliveryId = req.params.id;
  const { status, actor_type, actor_id, note } = req.body;

  if (!status) return res.status(400).json({ error: 'status_required' });

  const exists = await deliveryExists(deliveryId);
  if (!exists) return res.status(404).json({ error: 'delivery_not_found' });

  try {
    // Forward status update to SAP
    const payload = { status, actor_type, actor_id, note };
    const resp = await sapService.call(`/Deliveries/${deliveryId}/status`, 'post', payload);
    res.status(resp.status || 200).json({ ok: true, status: status, data: resp.data });
  } catch (err) {
    console.error('deliveries status update error (sap)', err);
    const statusCode = err.response && err.response.status ? err.response.status : 500;
    res.status(statusCode).json({ error: 'sap_error', detail: err.message });
  }
});

// PUT /api/admin/deliveries/:id/status - Update delivery status in database
// body: { status, notes, driverSignature, customerSignature, photos, actualTime, customer, address }
router.put('/admin/:id/status', authenticate, requireRole('admin'), async (req, res) => {
  const deliveryIdParam = req.params.id;
  const { status, notes, driverSignature, customerSignature, photos, actualTime, customer, address } = req.body;

  if (!status) return res.status(400).json({ error: 'status_required' });

  try {
    console.log(`[Deliveries] Updating delivery ${deliveryIdParam} status to ${status}`);
    
    let existingDelivery;
    
    // Try to find by ID first (if it's a valid UUID)
    try {
      // Check if ID looks like a UUID
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (uuidRegex.test(deliveryIdParam)) {
        existingDelivery = await prisma.delivery.findUnique({
          where: { id: deliveryIdParam }
        });
      }
    } catch (e) {
      console.log(`[Deliveries] Could not find by ID ${deliveryIdParam}, trying by customer+address`);
    }

    // If not found by ID or ID is not a UUID, try by customer + address
    if (!existingDelivery && customer && address) {
      console.log(`[Deliveries] Looking up delivery by customer="${customer}" and address="${address}"`);
      existingDelivery = await prisma.delivery.findFirst({
        where: {
          customer: customer,
          address: address
        },
        orderBy: {
          createdAt: 'desc'
        }
      });
    }

    if (!existingDelivery) {
      console.warn(`[Deliveries] Delivery not found: id=${deliveryIdParam}, customer=${customer}, address=${address}`);
      return res.status(404).json({ error: 'delivery_not_found' });
    }

    console.log(`[Deliveries] Found delivery: id=${existingDelivery.id}, customer=${existingDelivery.customer}`);

    // Prepare update data - save POD data to dedicated fields
    const updateData = {
      status: status,
      metadata: {
        ...existingDelivery.metadata || {},
        statusUpdatedAt: new Date().toISOString(),
        statusUpdatedBy: req.user?.sub || 'admin',
        actualTime: actualTime || null
      },
      updatedAt: new Date()
    };

    // Save POD data to dedicated fields for better querying and reporting
    if (driverSignature) {
      updateData.driverSignature = driverSignature;
    }
    if (customerSignature) {
      updateData.customerSignature = customerSignature;
    }
    if (photos && Array.isArray(photos) && photos.length > 0) {
      // Normalize to [{ data, name? }] so DB stores a clean JSON array (support frontend { id, data, name, type })
      updateData.photos = photos.map((p) => ({
        data: typeof p === 'string' ? p : (p.data || p),
        name: typeof p === 'object' && p != null ? (p.name || null) : null
      }));
    }
    if (notes) {
      updateData.deliveryNotes = notes;
      updateData.conditionNotes = notes; // Also save to conditionNotes for consistency
    }
    
    // Set delivery completion timestamp and delivered by
    if (['delivered', 'completed', 'delivered-with-installation', 'delivered-without-installation'].includes(status.toLowerCase())) {
      updateData.deliveredAt = new Date();
      updateData.deliveredBy = req.user?.username || req.user?.email || req.user?.sub || 'admin';
      updateData.podCompletedAt = new Date();
    }

    // Update delivery status in database
    const updatedDelivery = await prisma.delivery.update({
      where: { id: existingDelivery.id },
      data: updateData
    });

    // Create delivery event for audit
    await prisma.deliveryEvent.create({
      data: {
        deliveryId: existingDelivery.id,
        eventType: 'status_updated',
        payload: {
          previousStatus: existingDelivery.status,
          newStatus: status,
          notes: notes,
          actualTime: actualTime,
          hasPOD: !!(driverSignature || customerSignature || (photos && photos.length > 0)),
          photoCount: photos ? photos.length : 0,
          hasDriverSignature: !!driverSignature,
          hasCustomerSignature: !!customerSignature,
          updatedAt: new Date().toISOString()
        },
        actorType: req.user?.role || 'admin',
        actorId: req.user?.sub || null
      }
    }).catch(err => {
      console.warn(`[Deliveries] Failed to create audit event for ${existingDelivery.id}:`, err.message);
    });

    // Invalidate caches so tracking/dashboard pick up the change
    cache.invalidatePrefix('tracking:');
    cache.invalidatePrefix('dashboard:');
    cache.invalidatePrefix('deliveries:list:v2');

    // Create admin notification for status change (fire-and-forget)
    prisma.adminNotification.create({
      data: {
        type: 'status_changed',
        title: 'Delivery Status Updated',
        message: `${existingDelivery.customer || 'Unknown customer'} — ${existingDelivery.address || 'Unknown address'}: ${existingDelivery.status} → ${status}`,
        payload: {
          deliveryId: existingDelivery.id,
          customer: existingDelivery.customer,
          address: existingDelivery.address,
          poNumber: existingDelivery.poNumber,
          previousStatus: existingDelivery.status,
          newStatus: status,
          updatedBy: req.user?.username || req.user?.sub || 'admin'
        }
      }
    }).catch(err => {
      console.warn(`[Deliveries] Failed to create status notification for ${existingDelivery.id}:`, err.message);
    });

    // Optionally notify customer by SMS for key status changes
    try {
      const lowerStatus = (status || '').toLowerCase();
      const phone = updatedDelivery.phone || existingDelivery.phone;

      if (phone) {
        const smsService = require('../sms/smsService');
        const frontendUrl = process.env.FRONTEND_URL || 'https://electrolux-smart-portal.vercel.app';
        const token = updatedDelivery.confirmationToken || existingDelivery.confirmationToken;
        const trackingLink = token ? `${frontendUrl}/customer-tracking/${token}` : null;
        const customerName = updatedDelivery.customer || existingDelivery.customer || 'Valued Customer';
        const poRef = (updatedDelivery.poNumber || existingDelivery.poNumber) ? `#${updatedDelivery.poNumber || existingDelivery.poNumber}` : '';

        // Out for delivery (same day as scheduled)
        if (lowerStatus === 'out-for-delivery') {
          const body = `Dear ${customerName},

Your Electrolux order ${poRef} is out for delivery today.
${trackingLink ? `\nTrack your delivery in real time:\n${trackingLink}\n` : ''}
For assistance, please contact the Electrolux Delivery Team at +971524408687.

Thank you,
Electrolux Delivery Team`;

          const smsResult = await smsService.smsAdapter.sendSms({
            to: phone,
            body,
            metadata: { deliveryId: updatedDelivery.id, type: 'status_out_for_delivery' }
          });

          await prisma.smsLog.create({
            data: {
              deliveryId: updatedDelivery.id,
              phoneNumber: phone,
              messageContent: body,
              smsProvider: process.env.SMS_PROVIDER || 'd7',
              externalMessageId: smsResult.messageId,
              status: smsResult.status || 'sent',
              sentAt: new Date(),
              metadata: { type: 'status_out_for_delivery' }
            }
          });
        }

        // Order finished: send final thank-you SMS ONLY once, when moving into a true
        // \"finished\" state (completed / POD done). Do NOT send when the item just arrives.
        const prevStatus = (existingDelivery.status || '').toLowerCase();
        const completionStatuses = ['completed'];
        const wasAlreadyFinished = completionStatuses.includes(prevStatus);

        if (completionStatuses.includes(lowerStatus) && !wasAlreadyFinished) {
          const body = `Dear ${customerName},

Your Electrolux delivery ${poRef} has been completed.

Thank you for choosing Electrolux.`;

          const smsResult = await smsService.smsAdapter.sendSms({
            to: phone,
            body,
            metadata: { deliveryId: updatedDelivery.id, type: 'status_order_finished' }
          });

          await prisma.smsLog.create({
            data: {
              deliveryId: updatedDelivery.id,
              phoneNumber: phone,
              messageContent: body,
              smsProvider: process.env.SMS_PROVIDER || 'd7',
              externalMessageId: smsResult.messageId,
              status: smsResult.status || 'sent',
              sentAt: new Date(),
              metadata: { type: 'status_order_finished' }
            }
          });
        }
      }
    } catch (notifyErr) {
      console.warn('[Deliveries] Failed to send customer status SMS:', notifyErr.message);
    }

    res.json({
      ok: true,
      status: status,
      delivery: {
        id: updatedDelivery.id,
        customer: updatedDelivery.customer,
        address: updatedDelivery.address,
        status: updatedDelivery.status,
        updatedAt: updatedDelivery.updatedAt
      }
    });
  } catch (err) {
    console.error('deliveries status update error (database)', err);
    res.status(500).json({ error: 'status_update_failed', detail: err.message });
  }
});

// PUT /admin/:id/contact - Update delivery contact details (address, phone, lat, lng)
router.put('/admin/:id/contact', authenticate, requireRole('admin'), async (req, res) => {
  const deliveryIdParam = req.params.id;
  const { customer, address, phone, lat, lng } = req.body;

  if (!address && !phone) {
    return res.status(400).json({ error: 'address_or_phone_required' });
  }

  try {
    console.log(`[Deliveries] Updating contact for delivery ${deliveryIdParam}`);

    let existingDelivery;

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
      return res.status(404).json({ error: 'delivery_not_found' });
    }

    const updateData = { updatedAt: new Date() };
    if (address) updateData.address = address;
    if (phone)   updateData.phone = phone;
    if (lat != null && !Number.isNaN(Number(lat)))  updateData.lat = Number(lat);
    if (lng != null && !Number.isNaN(Number(lng)))  updateData.lng = Number(lng);

    const updatedDelivery = await prisma.delivery.update({
      where: { id: existingDelivery.id },
      data: updateData
    });

    cache.invalidatePrefix('tracking:');
    cache.invalidatePrefix('dashboard:');
    cache.delete('deliveries:list:v2');

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
  } catch (err) {
    console.error('[Deliveries] contact update error:', err);
    res.status(500).json({ error: 'contact_update_failed', detail: err.message });
  }
});

// POST /api/deliveries/:id/assign - assign driver
// body: { driver_id }
router.post('/:id/assign', authenticate, requireRole('admin'), async (req, res) => {
  const deliveryId = req.params.id;
  const { driver_id } = req.body;
  if (!driver_id) return res.status(400).json({ error: 'driver_id_required' });
  const exists = await deliveryExists(deliveryId);
  if (!exists) return res.status(404).json({ error: 'delivery_not_found' });
  try {
    const resp = await sapService.call(`/Deliveries/${deliveryId}/assign`, 'post', { driver_id });
    res.status(resp.status || 200).json({ ok: true, assignment: resp.data });
  } catch (err) {
    console.error('deliveries assign error (sap)', err);
    const statusCode = err.response && err.response.status ? err.response.status : 500;
    res.status(statusCode).json({ error: 'sap_error', detail: err.message });
  }
});

// GET /api/deliveries/:id/events
router.get('/:id/events', authenticate, requireRole('admin'), async (req, res) => {
  const deliveryId = req.params.id;
  try {
    const resp = await sapService.call(`/Deliveries/${deliveryId}/events`, 'get');
    res.json({ events: resp.data && resp.data.value ? resp.data.value : resp.data });
  } catch (err) {
    console.error('deliveries events error (sap)', err);
    const statusCode = err.response && err.response.status ? err.response.status : 500;
    res.status(statusCode).json({ error: 'sap_error', detail: err.message });
  }
});

// GET /api/deliveries/debug/check-po-numbers - Debug endpoint to check PO numbers in database
router.get('/debug/check-po-numbers', authenticate, requireRole('admin'), async (req, res) => {
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
    });

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
  } catch (error) {
    console.error('[Deliveries/Debug] Error checking PO numbers:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/deliveries/upload - Save uploaded delivery data and auto-assign
router.post('/upload', authenticate, async (req, res) => {
  try {
    const { deliveries } = req.body;

    console.log(`[Deliveries/Upload] *** UPLOAD ENDPOINT RECEIVED ***`);
    console.log(`[Deliveries/Upload] Received ${deliveries?.length || 0} deliveries to save`);
    
    // Log the FIRST delivery in full detail
    if (deliveries && deliveries.length > 0) {
      console.log(`[Deliveries/Upload] *** FIRST DELIVERY IN REQUEST ***`);
      console.log(`[Deliveries/Upload] First delivery keys:`, Object.keys(deliveries[0]));
      console.log(`[Deliveries/Upload] First delivery._originalPONumber:`, deliveries[0]._originalPONumber);
      console.log(`[Deliveries/Upload] First delivery:`, JSON.stringify(deliveries[0], null, 2).substring(0, 500));
      console.log(`[Deliveries/Upload] *** END FIRST DELIVERY ***`);
    }

    if (!deliveries || !Array.isArray(deliveries)) {
      return res.status(400).json({ error: 'deliveries_array_required' });
    }

    if (deliveries.length === 0) {
      return res.status(400).json({ error: 'no_deliveries_provided' });
    }

    const results = [];
    const deliveryIds = [];

    // Save deliveries to database with full data
    for (let i = 0; i < deliveries.length; i++) {
      const delivery = deliveries[i];
      // Generate valid UUID for each delivery (required by database)
      // If delivery.id exists and is a valid UUID, use it; otherwise generate new UUID
      let deliveryId = delivery.id;
      if (!deliveryId || !deliveryId.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
        deliveryId = randomUUID();
      }
      
      console.log(`[Deliveries/Upload] Saving delivery ${i + 1}/${deliveries.length}: ${deliveryId}`);
      console.log(`[Deliveries/Upload] Data: customer="${delivery.customer}", address="${delivery.address?.substring(0, 50)}", phone="${delivery.phone}", status="${delivery.status}"`);
      console.log(`[Deliveries/Upload] *** CRITICAL DEBUG ***`);
      console.log(`[Deliveries/Upload] delivery object type:`, typeof delivery);
      console.log(`[Deliveries/Upload] delivery object keys:`, Object.keys(delivery));
      console.log(`[Deliveries/Upload] delivery._originalPONumber:`, delivery._originalPONumber);
      console.log(`[Deliveries/Upload] delivery._originalDeliveryNumber:`, delivery._originalDeliveryNumber);
      console.log(`[Deliveries/Upload] *** END CRITICAL DEBUG ***`);
      
      try {
        // PO Number: use transformed fields first, then raw delivery keys (untransformed upload), then _originalRow
        let poNumberToSave = delivery.poNumber ?? delivery.PONumber ?? delivery._originalPONumber ?? null;
        if (poNumberToSave == null) {
          const raw = delivery['PO Number'] ?? delivery['PO#'] ?? delivery['Cust. PO Number'] ?? delivery['PONumber'] ?? delivery['Delivery number'] ?? delivery['Delivery Number'];
          if (raw != null && raw !== '') poNumberToSave = String(raw).trim();
        }
        if (poNumberToSave == null && delivery._originalRow && typeof delivery._originalRow === 'object') {
          const r = delivery._originalRow;
          const fromRow = r['PO Number'] ?? r['PO#'] ?? r['Cust. PO Number'] ?? r['PONumber'] ?? r['Delivery number'] ?? r['Delivery Number'] ?? null;
          if (fromRow != null) poNumberToSave = String(fromRow).trim() || null;
        }
        if (poNumberToSave != null && typeof poNumberToSave !== 'string') poNumberToSave = String(poNumberToSave);

        // Metadata: store all original row columns plus mapped fields so nothing is lost
        const baseMeta = {
          originalDeliveryNumber: delivery._originalDeliveryNumber ?? delivery._originalRow?.['Delivery number'] ?? delivery._originalRow?.['Delivery Number'],
          originalPONumber: poNumberToSave ?? delivery._originalPONumber,
          originalQuantity: delivery._originalQuantity ?? delivery._originalRow?.['Confirmed quantity'],
          originalCity: delivery._originalCity ?? delivery._originalRow?.['City'],
          originalRoute: delivery._originalRoute ?? delivery._originalRow?.['Route'],
        };
        if (delivery._originalRow && typeof delivery._originalRow === 'object') {
          baseMeta.originalRow = delivery._originalRow;
        }
        const metadataToSave = delivery.metadata && typeof delivery.metadata === 'object'
          ? { ...baseMeta, ...delivery.metadata }
          : baseMeta;
        const originalDeliveryNumberToSave = baseMeta.originalDeliveryNumber ?? null;

        const businessKey = buildBusinessKey({
          poNumber: poNumberToSave,
          originalDeliveryNumber: originalDeliveryNumberToSave
        });

        const incoming = {
          id: deliveryId,
          customer: delivery.customer || delivery.name || null,
          address: delivery.address || null,
          phone: delivery.phone ?? null,
          poNumber: poNumberToSave,
          lat: delivery.lat != null ? Number(delivery.lat) : null,
          lng: delivery.lng != null ? Number(delivery.lng) : null,
          status: delivery.status || 'pending',
          items: typeof delivery.items === 'string' ? delivery.items : (delivery.items ? JSON.stringify(delivery.items) : null),
          metadata: metadataToSave,
          businessKey
        };

        const { delivery: savedDelivery, existed } = await upsertDeliveryByBusinessKey({
          prisma,
          source: 'manual_upload',
          incoming
        });

        console.log(`[Deliveries/Upload] ✓ Saved delivery ${savedDelivery.id} (existed=${!!existed})`);
        if (!savedDelivery.poNumber && !savedDelivery.metadata?.originalPONumber) {
          console.log(`[Deliveries/Upload] ⚠ Warning: No PO Number found for delivery ${savedDelivery.id}`);
        }

        // Save delivery event for audit
        await prisma.deliveryEvent.create({
          data: {
            deliveryId: savedDelivery.id,
            eventType: existed ? 'duplicate_upload' : 'uploaded',
            payload: {
              customer: delivery.customer || delivery.name,
              address: delivery.address,
              phone: delivery.phone,
              lat: delivery.lat,
              lng: delivery.lng,
              uploadDate: new Date().toISOString(),
              businessKey: savedDelivery.businessKey || businessKey || null,
              deduplicated: !!existed
            },
            actorType: req.user?.role || 'admin',
            actorId: req.user?.sub || null
          }
        }).catch(err => {
          // Don't fail if event creation fails
          console.warn(`[Deliveries] Failed to create event for ${deliveryId}:`, err.message);
        });

        deliveryIds.push(savedDelivery.id);
        results.push({ deliveryId: savedDelivery.id, saved: true, deduplicated: !!existed });
      } catch (error) {
        console.error(`[Deliveries] Error saving delivery ${deliveryId}:`, error);
        results.push({ deliveryId, saved: false, error: error.message });
      }
    }

    // Auto-assign deliveries to drivers
    const assignmentResults = await autoAssignDeliveries(deliveryIds);

    // Merge results
    const mergedResults = results.map(result => {
      const assignment = assignmentResults.find(a => a.deliveryId === result.deliveryId);
      return {
        ...result,
        assigned: assignment?.success || false,
        driverId: assignment?.assignment?.driverId || null,
        driverName: assignment?.assignment?.driverName || null,
        assignmentError: assignment?.error || null
      };
    });

    // Invalidate caches after bulk upload
    cache.invalidatePrefix('tracking:');
    cache.invalidatePrefix('dashboard:');
    cache.delete('deliveries:list:v2');

    console.log(`[Deliveries] Upload complete: ${results.filter(r => r.saved).length} saved, ${assignmentResults.filter(a => a.success).length} assigned`);
    
    // Fetch the saved deliveries from database to return with full data including UUIDs
    const savedDeliveries = await prisma.delivery.findMany({
      where: { id: { in: deliveryIds } },
      select: {
        id: true,
        customer: true,
        address: true,
        phone: true,
        poNumber: true,
        lat: true,
        lng: true,
        status: true,
        items: true,
        metadata: true,
        createdAt: true,
        updatedAt: true
      }
    });
    
    console.log(`[Deliveries] Returning ${savedDeliveries.length} deliveries with database IDs to frontend`);
    
    res.json({
      success: true,
      count: deliveryIds.length,
      saved: results.filter(r => r.saved).length,
      assigned: assignmentResults.filter(a => a.success).length,
      results: mergedResults,
      deliveries: savedDeliveries  // ← ADD THIS: Return full delivery objects with UUIDs
    });
  } catch (err) {
    console.error('deliveries/upload error', err);
    console.error('deliveries/upload error stack:', err.stack);
    res.status(500).json({ error: 'upload_error', detail: err.message });
  }
});

// POST /api/deliveries/bulk-assign - Auto-assign multiple deliveries
router.post('/bulk-assign', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { deliveryIds } = req.body;

    if (!deliveryIds || !Array.isArray(deliveryIds)) {
      return res.status(400).json({ error: 'delivery_ids_array_required' });
    }

    const results = await autoAssignDeliveries(deliveryIds);

    // Invalidate caches after bulk assignment
    cache.invalidatePrefix('tracking:');
    cache.invalidatePrefix('dashboard:');
    cache.delete('deliveries:list:v2');

    res.json({
      success: true,
      total: deliveryIds.length,
      assigned: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
      results
    });
  } catch (err) {
    console.error('deliveries/bulk-assign error', err);
    res.status(500).json({ error: 'bulk_assign_error', detail: err.message });
  }
});

// GET /api/deliveries/available-drivers - Get available drivers for manual selection
router.get('/available-drivers', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const drivers = await getAvailableDrivers();
    res.json({ drivers, count: drivers.length });
  } catch (err) {
    console.error('deliveries/available-drivers error', err);
    res.status(500).json({ error: 'db_error', detail: err.message });
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
  'rescheduled',
  'returned',
];

// GET /api/deliveries - Get deliveries from database
// By default returns ONLY "active" deliveries (non-terminal). To include history,
// pass ?includeFinished=true from the client.
router.get('/', authenticate, async (req, res) => {
  try {
    const includeFinished = req.query.includeFinished === 'true';
    const cacheKey = includeFinished
      ? 'deliveries:list:v2:all'
      : 'deliveries:list:v2:active';

    const deliveries = await cache.getOrFetch(cacheKey, async () => {
      const whereClause = includeFinished
        ? {}
        : {
            status: {
              notIn: TERMINAL_STATUSES,
            },
          };

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
          createdAt: true,
          updatedAt: true,
          assignments: {
            select: {
              driverId: true,
              status: true,
              driver: {
                select: {
                  fullName: true
                }
              }
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
    const formattedDeliveries = deliveries.map(d => ({
      id: d.id,
      customer: d.customer,
      address: d.address,
      phone: d.phone,
      lat: d.lat,
      lng: d.lng,
      status: d.status,
      items: d.items,
      metadata: d.metadata,
      created_at: d.createdAt,
      createdAt: d.createdAt,
      created: d.createdAt,
      updatedAt: d.updatedAt,
      assignedDriverId: d.assignments?.[0]?.driverId || null,
      driverName: d.assignments?.[0]?.driver?.fullName || null,
      assignmentStatus: d.assignments?.[0]?.status || 'unassigned'
    }));

    // Deliveries with missing address or phone go to the bottom; otherwise newest first
    sortDeliveriesIncompleteLast(formattedDeliveries);

    res.json({
      deliveries: formattedDeliveries,
      count: formattedDeliveries.length
    });
  } catch (err) {
    console.error('GET /api/deliveries error', err);
    res.status(500).json({ error: 'db_error', detail: err.message });
  }
});

// PUT /api/admin/deliveries/:id/assign - Assign delivery to driver
router.put('/admin/:id/assign', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { driverId } = req.body;

    if (!driverId) {
      return res.status(400).json({ error: 'driverId_required' });
    }

    console.log(`[Deliveries] Assigning delivery ${id} to driver ${driverId}`);

    // Verify delivery exists
    const delivery = await prisma.delivery.findUnique({
      where: { id },
      include: { assignments: true }
    });

    if (!delivery) {
      return res.status(404).json({ error: 'delivery_not_found' });
    }

    // Remove old assignments for this delivery
    if (delivery.assignments && delivery.assignments.length > 0) {
      await prisma.deliveryAssignment.deleteMany({
        where: { deliveryId: id }
      });
      console.log(`[Deliveries] Removed old assignments for delivery ${id}`);
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
    });

    // Invalidate caches after assignment
    cache.invalidatePrefix('tracking:');
    cache.invalidatePrefix('dashboard:');
    cache.delete('deliveries:list:v2');

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
  } catch (err) {
    console.error('PUT /api/admin/deliveries/:id/assign error:', err);
    res.status(500).json({ error: 'assignment_failed', detail: err.message });
  }
});

// POST /api/deliveries/:id/send-sms - Send confirmation SMS to customer
// Admin endpoint to trigger SMS when document is uploaded or SAP process completes
router.post('/:id/send-sms', authenticate, requireRole('admin'), async (req, res) => {
  try {
    let { id: deliveryId } = req.params;

    if (!deliveryId) {
      return res.status(400).json({ error: 'delivery_id_required' });
    }

    // Sanitize delivery ID - remove any invalid characters and decode
    deliveryId = decodeURIComponent(String(deliveryId).trim());
    
    console.log('[SMS] Attempting to send SMS for delivery ID:', deliveryId);
    
    // Validate UUID format (standard UUID format: 8-4-4-4-12 hex characters)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    
    let delivery;
    
    if (uuidRegex.test(deliveryId)) {
      // Valid UUID format - use findUnique
      console.log('[SMS] Valid UUID format, using findUnique');
      try {
        delivery = await prisma.delivery.findUnique({
          where: { id: deliveryId }
        });
      } catch (prismaErr) {
        console.error('[SMS] Prisma findUnique error:', prismaErr.message);
        return res.status(400).json({ 
          error: 'invalid_delivery_id',
          message: 'Invalid delivery ID format',
          detail: prismaErr.message
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
      } catch (searchErr) {
        console.error('[SMS] Fallback search error:', searchErr.message);
      }
    }

    if (!delivery) {
      console.error('[SMS] Delivery not found for ID:', deliveryId);
      return res.status(404).json({ 
        error: 'delivery_not_found',
        message: `No delivery found with ID: ${deliveryId}`
      });
    }
    
    console.log('[SMS] Found delivery:', delivery.id, 'Customer:', delivery.customer);

    if (!delivery.phone && !delivery.email) {
      return res.status(400).json({ error: 'no_contact_info', message: 'Delivery has no phone number or email address' });
    }

    // Normalize the phone number to E.164 format if present
    const normalizedPhone = delivery.phone
      ? (normalizePhone(delivery.phone) || delivery.phone)
      : null;
    if (normalizedPhone && normalizedPhone !== delivery.phone) {
      console.log(`[SMS] Phone normalized: "${delivery.phone}" → "${normalizedPhone}"`);
    }

    // Accept optional customer email override from request body
    const customerEmail = req.body?.email || delivery.email || null;

    // Always generate the confirmation token first — link is always available
    // even when both SMS and email fail.
    const smsService = require('../sms/smsService');
    const token = smsService.generateConfirmationToken();
    // 30 days — customers may receive stock next month
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const frontendUrl = process.env.FRONTEND_URL || 'https://electrolux-smart-portal.vercel.app';
    const confirmationLink = `${frontendUrl}/confirm-delivery/${token}`;
    const customerName = delivery.customer || 'Valued Customer';
    const poRef = delivery.poNumber ? `#${delivery.poNumber}` : '';
    const smsBody = `Dear ${customerName},\n\nYour Electrolux order ${poRef} is ready for delivery.\n\nPlease confirm your preferred delivery date using the link below:\n${confirmationLink}\n\nFor assistance, please contact the Electrolux Delivery Team at +971524408687.\n\nThank you,\nElectrolux Delivery Team`;

    // Persist the token to the delivery record immediately
    await prisma.delivery.update({
      where: { id: delivery.id },
      data: {
        confirmationToken: token,
        tokenExpiresAt: expiresAt,
        confirmationStatus: 'pending'
      }
    });

    if (!normalizedPhone) {
      return res.status(400).json({ error: 'no_phone', message: 'Delivery has no phone number' });
    }

    // ── 1. Send message — WhatsApp for UAE (+971), SMS for all other countries ──
    const isUAE = normalizedPhone.startsWith('+971');
    let sent = false;
    let sendError = null;
    let messageId = null;
    let d7Status = null;
    let channel = isUAE ? 'whatsapp' : 'sms';

    try {
      if (isUAE) {
        const WhatsAppAdapter = require('../sms/whatsappAdapter');
        const waAdapter = new WhatsAppAdapter(process.env);
        const result = await waAdapter.sendMessage({ to: normalizedPhone, body: smsBody });
        messageId = result.messageId;
        d7Status = result.status;
        sent = true;
        console.log('[WhatsApp] Sent to', normalizedPhone, 'MID:', messageId);
      } else {
        const smsResult = await smsService.smsAdapter.sendSms({
          to: normalizedPhone,
          body: smsBody,
          metadata: { deliveryId: delivery.id, type: 'confirmation_request' }
        });
        messageId = smsResult.messageId;
        d7Status = smsResult.status;
        sent = true;
        console.log('[SMS] Sent to', normalizedPhone, 'MID:', messageId);
      }

      await prisma.smsLog.create({
        data: {
          deliveryId: delivery.id,
          phoneNumber: normalizedPhone,
          messageContent: smsBody,
          smsProvider: isUAE ? 'd7-whatsapp' : 'd7',
          externalMessageId: messageId,
          status: 'sent',
          sentAt: new Date(),
          metadata: { type: 'confirmation_request', channel, tokenExpiry: expiresAt.toISOString(), d7Status }
        }
      });
    } catch (err) {
      console.error(`[${channel.toUpperCase()}] Send failed:`, err.message);
      sendError = err.message;
      const d7Detail = err.response?.data ? JSON.stringify(err.response.data) : null;

      await prisma.smsLog.create({
        data: {
          deliveryId: delivery.id,
          phoneNumber: normalizedPhone,
          messageContent: smsBody,
          smsProvider: isUAE ? 'd7-whatsapp' : 'd7',
          status: 'failed',
          failureReason: err.message,
          sentAt: new Date(),
          metadata: { type: 'confirmation_request', channel, tokenExpiry: expiresAt.toISOString(), d7Detail }
        }
      }).catch(e => console.error('[Log] Error:', e.message));
    }

    // ── 2. Build response ──────────────────────────────────────────────────
    if (!sent) {
      return res.status(500).json({
        ok: false,
        error: `${channel}_failed`,
        message: sendError || `${channel} send failed`,
        d7Detail: sendError,
        token,
        confirmationLink
      });
    }

    return res.json({
      ok: true,
      smsSent: true,
      deliveredVia: channel,
      d7Status,
      message: isUAE ? 'WhatsApp message sent successfully' : 'SMS sent successfully',
      token,
      messageId,
      expiresAt: expiresAt.toISOString(),
      confirmationLink
    });
  } catch (error) {
    console.error('POST /api/deliveries/:id/send-sms error:', error);
    return res.status(500).json({
      error: 'send_sms_failed',
      message: error.message || 'Failed to send SMS. Please check delivery data.'
    });
  }
});

// GET /api/deliveries/:id/pod - Get Proof of Delivery data for a specific delivery
router.get('/:id/pod', authenticate, async (req, res) => {
  try {
    const deliveryId = req.params.id;

    console.log(`[Deliveries/POD] Fetching POD data for delivery: ${deliveryId}`);

    // Try to find delivery by ID or poNumber
    let delivery;
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
    } catch (err) {
      console.error(`[Deliveries/POD] Error fetching delivery:`, err);
      return res.status(500).json({ error: 'database_error', detail: err.message });
    }

    if (!delivery) {
      return res.status(404).json({ error: 'delivery_not_found' });
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

  } catch (error) {
    console.error('[Deliveries/POD] Error:', error);
    res.status(500).json({ 
      error: 'pod_retrieval_failed', 
      detail: error.message 
    });
  }
});

module.exports = router;
