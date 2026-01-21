const express = require('express');
const router = express.Router();
const { authenticate, requireRole } = require('../auth');
const db = require('../db');
const sapService = require('../../../services/sapService');
const prisma = require('../db/prisma');

// GET /api/admin/tracking/deliveries - real-time delivery tracking
router.get('/deliveries', authenticate, requireRole('admin'), async (req, res) => {
  try {
    // Fetch from database first (uploaded deliveries)
    let dbDeliveries = [];
    try {
      dbDeliveries = await prisma.delivery.findMany({
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
      });
    } catch (err) {
      console.error('[Tracking] Prisma query error:', err.message);
      // Return empty array as fallback
      dbDeliveries = [];
    }

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
      poNumber: d.poNumber,
      created_at: d.createdAt,
      createdAt: d.createdAt,
      created: d.createdAt,
      // Get driver info from assignments (ordered by most recent)
      assignedDriverId: d.assignments && d.assignments.length > 0 ? d.assignments[0].driverId : null,
      driverName: d.assignments && d.assignments.length > 0 ? d.assignments[0].driver?.fullName : null,
      assignmentStatus: d.assignments && d.assignments.length > 0 ? d.assignments[0].status : 'unassigned'
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
    let assignments = [];
    let locations = [];
    
    try {
      // Try to get assignments from Prisma if available
      const assignmentsData = await prisma.deliveryAssignment.findMany({
        where: {
          status: { in: ['assigned', 'in_progress'] }
        }
      }).catch(() => []);
      assignments = assignmentsData.map(a => ({
        delivery_id: a.deliveryId,
        driver_id: a.driverId,
        status: a.status,
        assigned_at: a.createdAt
      }));
    } catch (e) {
      console.warn('[Tracking] Could not fetch assignments:', e.message);
    }

    // Get latest locations for all drivers - simplified for now
    // In production, this would query a live_locations table
    // Note: locations is already initialized above as let locations = []

    // Enrich deliveries with tracking info
    const trackedDeliveries = deliveries.map(delivery => {
      // Use already-extracted assignedDriverId from the formatted delivery
      // Fallback to looking up in assignments if needed
      let driverId = delivery.assignedDriverId;
      let status = delivery.assignmentStatus;
      let assignedAt = null;
      
      if (!driverId) {
        const assignment = assignments.find(a => a.delivery_id === delivery.id || a.delivery_id === delivery.ID);
        driverId = assignment?.driver_id || null;
        status = assignment?.status || 'unassigned';
        assignedAt = assignment?.assigned_at || null;
      }
      
      const location = driverId ? locations.find(l => l.driver_id === driverId) : null;

      return {
        ...delivery,
        tracking: {
          assigned: !!driverId,
          driverId: driverId,
          status: status,
          assignedAt: assignedAt,
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
// Returns drivers with "driver" role only (excludes admins)
router.get('/drivers', authenticate, requireRole('admin'), async (req, res) => {
  try {
    // Get drivers from Prisma (internal system drivers)
    let prismaDrivers = [];
    try {
      const dbDrivers = await prisma.driver.findMany({
        where: {
          account: {
            role: 'driver'  // Only get drivers, not admins
          }
        },
        include: {
          account: true,
          status: true
        }
      });
      prismaDrivers = dbDrivers.map(d => ({
        id: d.id,
        username: d.username,
        email: d.email,
        phone: d.phone,
        fullName: d.fullName,
        full_name: d.fullName,
        active: d.active,
        role: d.account?.role || 'driver'
      }));
    } catch (e) {
      console.warn('[Tracking] Could not fetch Prisma drivers:', e.message);
    }

    // Get all active drivers from SAP (fallback)
    const driversResp = await sapService.call('/Drivers', 'get').catch(() => ({ data: { value: [] } }));
    let sapDrivers = [];
    if (Array.isArray(driversResp.data?.value)) {
      sapDrivers = driversResp.data.value;
    } else if (Array.isArray(driversResp.data)) {
      sapDrivers = driversResp.data;
    }

    // Merge: Use Prisma drivers (with role filtering), fallback to SAP
    let drivers = prismaDrivers.length > 0 ? prismaDrivers : sapDrivers;

    // Get latest location for each driver - simplified for now
    let locations = [];
    try {
      // Try to get locations from Prisma if available
      const locationsData = await prisma.liveLocation.findMany({
        distinct: ['driverId'],
        orderBy: { recordedAt: 'desc' },
        take: 100
      }).catch(() => []);
      locations = locationsData.map(l => ({
        driver_id: l.driverId,
        latitude: l.latitude,
        longitude: l.longitude,
        heading: l.heading,
        speed: l.speed,
        accuracy: l.accuracy,
        recorded_at: l.recordedAt
      }));
    } catch (e) {
      console.warn('[Tracking] Could not fetch locations:', e.message);
    }

    // Get driver status - simplified for now
    let statuses = [];
    try {
      // Try to get statuses from Prisma if available
      const statusData = await prisma.driverStatus.findMany().catch(() => []);
      statuses = statusData.map(s => ({
        driver_id: s.driverId,
        status: s.status,
        updated_at: s.updatedAt,
        current_assignment_id: s.currentAssignmentId
      }));
    } catch (e) {
      console.warn('[Tracking] Could not fetch driver status:', e.message);
    }

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

