const express = require('express');
const router = express.Router();
const { randomUUID } = require('crypto');
const { authenticate, requireRole } = require('../auth');
const sapService = require('../../../services/sapService');
const { autoAssignDeliveries, getAvailableDrivers } = require('../services/autoAssignmentService');
const prisma = require('../db/prisma');

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
      updateData.photos = photos; // Store as JSON array
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

    console.log(`[Deliveries] ✓ Successfully updated delivery ${existingDelivery.id} to status ${status}`);

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

        const upsertData = {
          customer: delivery.customer || delivery.name || null,
          address: delivery.address || null,
          phone: delivery.phone ?? null,
          poNumber: poNumberToSave,
          lat: delivery.lat != null ? Number(delivery.lat) : null,
          lng: delivery.lng != null ? Number(delivery.lng) : null,
          status: delivery.status || 'pending',
          items: typeof delivery.items === 'string' ? delivery.items : (delivery.items ? JSON.stringify(delivery.items) : null),
          metadata: metadataToSave,
        };

        const savedDelivery = await prisma.delivery.upsert({
          where: { id: deliveryId },
          update: { ...upsertData, updatedAt: new Date() },
          create: { id: deliveryId, ...upsertData }
        });

        console.log(`[Deliveries/Upload] ✓ Successfully saved delivery ${deliveryId} to database`);
        console.log(`[Deliveries/Upload] *** AFTER SAVE - WHAT WAS SAVED ***`);
        console.log(`[Deliveries/Upload] savedDelivery.poNumber = "${savedDelivery.poNumber}"`);
        console.log(`[Deliveries/Upload] savedDelivery.customer = "${savedDelivery.customer}"`);
        console.log(`[Deliveries/Upload] typeof savedDelivery.poNumber = ${typeof savedDelivery.poNumber}`);
        console.log(`[Deliveries/Upload] savedDelivery.poNumber === null:`, savedDelivery.poNumber === null);
        console.log(`[Deliveries/Upload] *** END AFTER SAVE ***`);
        console.log(`[Deliveries/Upload] Saved delivery: customer="${savedDelivery.customer}", address="${savedDelivery.address?.substring(0, 50)}"`);
        if (savedDelivery.poNumber) {
          console.log(`[Deliveries/Upload] ✓ PO Number saved: "${savedDelivery.poNumber}"`);
        }
        if (savedDelivery.metadata?.originalPONumber) {
          console.log(`[Deliveries/Upload] ✓ PO Number in metadata: "${savedDelivery.metadata.originalPONumber}"`);
        }
        if (!savedDelivery.poNumber && !savedDelivery.metadata?.originalPONumber) {
          console.log(`[Deliveries/Upload] ⚠ Warning: No PO Number found for delivery ${deliveryId}`);
        }

        // Save delivery event for audit
        await prisma.deliveryEvent.create({
          data: {
            deliveryId,
            eventType: 'uploaded',
            payload: {
              customer: delivery.customer || delivery.name,
              address: delivery.address,
              phone: delivery.phone,
              lat: delivery.lat,
              lng: delivery.lng,
              uploadDate: new Date().toISOString()
            },
            actorType: req.user?.role || 'admin',
            actorId: req.user?.sub || null
          }
        }).catch(err => {
          // Don't fail if event creation fails
          console.warn(`[Deliveries] Failed to create event for ${deliveryId}:`, err.message);
        });

        deliveryIds.push(deliveryId);
        results.push({ deliveryId, saved: true });
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

    console.log(`[Deliveries] Upload complete: ${results.filter(r => r.saved).length} saved, ${assignmentResults.filter(a => a.success).length} assigned`);
    
    res.json({
      success: true,
      count: deliveryIds.length,
      saved: results.filter(r => r.saved).length,
      assigned: assignmentResults.filter(a => a.success).length,
      results: mergedResults
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

// GET /api/deliveries - Get all deliveries from database
router.get('/', authenticate, async (req, res) => {
  try {
    const deliveries = await prisma.delivery.findMany({
      include: {
        assignments: {
          include: {
            driver: {
              include: {
                account: true
              }
            }
          }
        },
        events: {
          orderBy: { createdAt: 'desc' },
          take: 1
        }
      },
      orderBy: { createdAt: 'desc' }
    });

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

    console.log(`[Deliveries] ✓ Successfully assigned delivery ${id} to driver ${driverId}`);

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

    // Sanitize delivery ID - remove any invalid characters
    deliveryId = String(deliveryId).trim();
    
    // Check if it's a valid UUID format (36 chars with hyphens or similar)
    if (!/^[a-f0-9\-]{36}$|^[a-f0-9]{32}$/.test(deliveryId)) {
      console.warn('Invalid deliveryId format:', deliveryId);
      // Try using the ID as-is anyway, let Prisma handle it
    }

    // Get delivery from database
    let delivery;
    try {
      delivery = await prisma.delivery.findUnique({
        where: { id: deliveryId }
      });
    } catch (prismaErr) {
      console.error('Prisma findUnique error:', prismaErr.message);
      // Fallback: try to find by poNumber if ID lookup fails
      if (prismaErr.message.includes('Inconsistent column data')) {
        console.log('Trying fallback search by poNumber:', deliveryId);
        delivery = await prisma.delivery.findFirst({
          where: { poNumber: String(deliveryId) }
        });
      }
      
      if (!delivery) {
        throw prismaErr;
      }
    }

    if (!delivery) {
      return res.status(404).json({ error: 'delivery_not_found' });
    }

    if (!delivery.phone) {
      return res.status(400).json({ error: 'no_phone_number' });
    }

    // Send SMS using SMS service
    const smsService = require('../sms/smsService');
    const result = await smsService.sendConfirmationSms(delivery.id, delivery.phone);

    return res.json({
      ok: true,
      message: 'SMS sent successfully',
      token: result.token,
      messageId: result.messageId,
      expiresAt: result.expiresAt,
      confirmationLink: `${process.env.FRONTEND_URL || 'https://smart-logistics-1.vercel.app'}/confirm-delivery/${result.token}`
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
