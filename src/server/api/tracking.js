const express = require('express');
const router = express.Router();
const { authenticate, requireRole } = require('../auth');
const db = require('../db');
const sapService = require('../../../services/sapService');

// GET /api/admin/tracking/deliveries - real-time delivery tracking
router.get('/deliveries', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const prisma = require('../db/prisma');
    
    // Fetch from database first (uploaded deliveries)
    const dbDeliveries = await prisma.delivery.findMany({
      include: {
        assignments: {
          include: {
            driver: {
              include: {
                account: true
              }
            }
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    }).catch(err => {
      console.error('[Tracking] Prisma query error:', err);
      return []; // Return empty array on error
    });

    // Format database deliveries
    let deliveries = dbDeliveries.map(d => ({
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
      assignedDriverId: d.assignments?.[0]?.driverId || null,
      driverName: d.assignments?.[0]?.driver?.fullName || null,
      assignmentStatus: d.assignments?.[0]?.status || 'unassigned'
    }));

    // Try to fetch from SAP as well (fallback/additional data)
    try {
      const deliveriesResp = await sapService.call('/Deliveries', 'get');
      let sapDeliveries = [];
      if (Array.isArray(deliveriesResp.data?.value)) {
        sapDeliveries = deliveriesResp.data.value;
      } else if (Array.isArray(deliveriesResp.data)) {
        sapDeliveries = deliveriesResp.data;
      }
      
      // Only add SAP deliveries that don't exist in database
      const dbDeliveryIds = new Set(deliveries.map(d => d.id));
      const newSapDeliveries = sapDeliveries.filter(d => {
        const sapId = d.id || d.ID;
        return sapId && !dbDeliveryIds.has(sapId);
      });
      deliveries = deliveries.concat(newSapDeliveries);
    } catch (sapError) {
      console.warn('[Tracking] SAP fetch failed, using database only:', sapError.message);
    }

    // Get delivery assignments and driver locations
    const assignmentsQuery = `SELECT delivery_id, driver_id, status, assigned_at FROM delivery_assignments WHERE status IN ('assigned', 'in_progress')`;
    const { rows: assignments } = await db.query(assignmentsQuery).catch(() => ({ rows: [] }));

    // Get latest locations for all drivers
    const locationsQuery = `
      SELECT DISTINCT ON (driver_id) 
        driver_id, latitude, longitude, heading, speed, recorded_at
      FROM live_locations
      WHERE recorded_at > NOW() - INTERVAL '1 hour'
      ORDER BY driver_id, recorded_at DESC
    `;
    const { rows: locations } = await db.query(locationsQuery).catch(() => ({ rows: [] }));

    // Enrich deliveries with tracking info
    const trackedDeliveries = deliveries.map(delivery => {
      const assignment = assignments.find(a => a.delivery_id === delivery.id || a.delivery_id === delivery.ID);
      const location = assignment ? locations.find(l => l.driver_id === assignment.driver_id) : null;

      return {
        ...delivery,
        tracking: {
          assigned: !!assignment,
          driverId: assignment?.driver_id || null,
          status: assignment?.status || 'unassigned',
          assignedAt: assignment?.assigned_at || null,
          lastLocation: location ? {
            lat: location.latitude,
            lng: location.longitude,
            heading: location.heading,
            speed: location.speed,
            timestamp: location.recorded_at
          } : null
        }
      };
    });

    res.json({
      deliveries: trackedDeliveries,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('tracking/deliveries error', err);
    res.status(500).json({ error: 'tracking_fetch_failed', detail: err.message });
  }
});

// GET /api/admin/tracking/drivers - real-time driver tracking
router.get('/drivers', authenticate, requireRole('admin'), async (req, res) => {
  try {
    // Get all active drivers
    const driversResp = await sapService.call('/Drivers', 'get').catch(() => ({ data: { value: [] } }));
    let drivers = [];
    if (Array.isArray(driversResp.data?.value)) {
      drivers = driversResp.data.value;
    } else if (Array.isArray(driversResp.data)) {
      drivers = driversResp.data;
    }

    // Get latest location for each driver
    const locationsQuery = `
      SELECT DISTINCT ON (driver_id) 
        driver_id, latitude, longitude, heading, speed, accuracy, recorded_at
      FROM live_locations
      WHERE recorded_at > NOW() - INTERVAL '1 hour'
      ORDER BY driver_id, recorded_at DESC
    `;
    const { rows: locations } = await db.query(locationsQuery).catch(() => ({ rows: [] }));

    // Get driver status
    const statusQuery = `SELECT driver_id, status, updated_at, current_assignment_id FROM driver_status`;
    const { rows: statuses } = await db.query(statusQuery).catch(() => ({ rows: [] }));

    // Enrich drivers with location and status
    const trackedDrivers = drivers.map(driver => {
      const driverId = driver.id || driver.ID;
      const location = locations.find(l => l.driver_id === driverId);
      const status = statuses.find(s => s.driver_id === driverId);

      return {
        ...driver,
        id: driverId,
        tracking: {
          online: location ? (Date.now() - new Date(location.recorded_at).getTime()) < 5 * 60 * 1000 : false, // Online if location < 5 min old
          location: location ? {
            lat: location.latitude,
            lng: location.longitude,
            heading: location.heading,
            speed: location.speed,
            accuracy: location.accuracy,
            timestamp: location.recorded_at
          } : null,
          status: status?.status || 'offline',
          lastUpdate: location?.recorded_at || status?.updated_at || null,
          assignmentId: status?.current_assignment_id || null
        }
      };
    });

    res.json({
      drivers: trackedDrivers,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('tracking/drivers error', err);
    res.status(500).json({ error: 'tracking_fetch_failed', detail: err.message });
  }
});

module.exports = router;

