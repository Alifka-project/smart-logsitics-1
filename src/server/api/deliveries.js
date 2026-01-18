const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
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

// POST /api/deliveries/upload - Save uploaded delivery data and auto-assign
router.post('/upload', authenticate, async (req, res) => {
  try {
    const { deliveries } = req.body;

    console.log(`[Deliveries/Upload] Received ${deliveries?.length || 0} deliveries to save`);

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
        deliveryId = uuidv4();
      }
      
      console.log(`[Deliveries/Upload] Saving delivery ${i + 1}/${deliveries.length}: ${deliveryId}`);
      console.log(`[Deliveries/Upload] Data: customer="${delivery.customer}", address="${delivery.address?.substring(0, 50)}", phone="${delivery.phone}", status="${delivery.status}"`);
      
      try {
        // Save full delivery data to database
        const savedDelivery = await prisma.delivery.upsert({
          where: { id: deliveryId },
          update: {
            customer: delivery.customer || delivery.name || null,
            address: delivery.address || null,
            phone: delivery.phone || null,
            lat: delivery.lat || null,
            lng: delivery.lng || null,
            status: delivery.status || 'pending',
            items: typeof delivery.items === 'string' ? delivery.items : (delivery.items ? JSON.stringify(delivery.items) : null),
            metadata: delivery.metadata || (delivery._originalDeliveryNumber ? {
              originalDeliveryNumber: delivery._originalDeliveryNumber,
              originalPONumber: delivery._originalPONumber,
              originalQuantity: delivery._originalQuantity,
              originalCity: delivery._originalCity,
              originalRoute: delivery._originalRoute,
            } : null),
            updatedAt: new Date()
          },
          create: {
            id: deliveryId,
            customer: delivery.customer || delivery.name || null,
            address: delivery.address || null,
            phone: delivery.phone || null,
            lat: delivery.lat || null,
            lng: delivery.lng || null,
            status: delivery.status || 'pending',
            items: typeof delivery.items === 'string' ? delivery.items : (delivery.items ? JSON.stringify(delivery.items) : null),
            metadata: delivery.metadata || (delivery._originalDeliveryNumber ? {
              originalDeliveryNumber: delivery._originalDeliveryNumber,
              originalPONumber: delivery._originalPONumber,
              originalQuantity: delivery._originalQuantity,
              originalCity: delivery._originalCity,
              originalRoute: delivery._originalRoute,
            } : null)
          }
        });

        console.log(`[Deliveries/Upload] ✓ Successfully saved delivery ${deliveryId} to database`);
        console.log(`[Deliveries/Upload] Saved delivery has: customer="${savedDelivery.customer}", address="${savedDelivery.address?.substring(0, 50)}"`);

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

module.exports = router;
