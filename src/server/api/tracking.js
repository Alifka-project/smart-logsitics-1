const express = require('express');
const router = express.Router();
const { authenticate, requireRole } = require('../auth');
const db = require('../db');
const sapService = require('../../../services/sapService');
const prisma = require('../db/prisma');
const cache = require('../cache');

// GET /api/admin/tracking/deliveries - real-time delivery tracking
// Optimized: uses select instead of include, server-side cache (30s fresh, 2min max)
router.get('/deliveries', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const data = await cache.getOrFetch('tracking:deliveries', async () => {
      // Fetch from database - use select for only needed fields
      let dbDeliveries = [];
      try {
        dbDeliveries = await prisma.delivery.findMany({
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
            assignments: {
              take: 1,
              orderBy: { assignedAt: 'desc' },
              select: {
                driverId: true,
                status: true,
                assignedAt: true,
                driver: {
                  select: { fullName: true }
                }
              }
            }
          },
          orderBy: { createdAt: 'desc' },
          take: 500 // Limit to 500 most recent
        });
      } catch (err) {
        console.error('[Tracking] Prisma query error:', err.message);
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
        assignedDriverId: d.assignments?.[0]?.driverId || null,
        driverName: d.assignments?.[0]?.driver?.fullName || null,
        assignmentStatus: d.assignments?.[0]?.status || 'unassigned',
        tracking: {
          assigned: !!(d.assignments?.[0]?.driverId),
          driverId: d.assignments?.[0]?.driverId || null,
          status: d.assignments?.[0]?.status || 'unassigned',
          assignedAt: d.assignments?.[0]?.assignedAt || null,
          lastLocation: null
        }
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
        
        const dbDeliveryIds = new Set(deliveries.map(d => d.id));
        const newSapDeliveries = sapDeliveries.filter(d => {
          const sapId = d.id || d.ID;
          return sapId && !dbDeliveryIds.has(sapId);
        });
        deliveries = deliveries.concat(newSapDeliveries);
      } catch (sapError) {
        // SAP not available, use database only
      }

      return deliveries;
    }, 30000, 120000); // 30s fresh, 2min max cache

    res.json({
      deliveries: data,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('tracking/deliveries error', err);
    res.status(500).json({ error: 'tracking_fetch_failed', detail: err.message });
  }
});

// GET /api/admin/tracking/drivers - real-time driver tracking
// Optimized: uses select, server-side cache, single combined query
router.get('/drivers', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const data = await cache.getOrFetch('tracking:drivers', async () => {
      let prismaDrivers = [];
      try {
        const dbDrivers = await prisma.driver.findMany({
          where: {
            account: { role: 'driver' }
          },
          select: {
            id: true,
            username: true,
            email: true,
            phone: true,
            fullName: true,
            active: true,
            account: { select: { role: true } },
            status: { select: { status: true, updatedAt: true, currentAssignmentId: true } }
          }
        });
        prismaDrivers = dbDrivers;
      } catch (e) {
        console.warn('[Tracking] Could not fetch Prisma drivers:', e.message);
      }

      // Fallback to SAP only if no Prisma drivers
      if (prismaDrivers.length === 0) {
        try {
          const driversResp = await sapService.call('/Drivers', 'get');
          let sapDrivers = [];
          if (Array.isArray(driversResp.data?.value)) sapDrivers = driversResp.data.value;
          else if (Array.isArray(driversResp.data)) sapDrivers = driversResp.data;
          return sapDrivers.map(d => ({ ...d, tracking: { online: false, location: null, status: 'offline', lastUpdate: null, assignmentId: null } }));
        } catch (_) {}
      }

      // Get latest locations - single query with distinct
      let locationsMap = {};
      try {
        const locationsData = await prisma.liveLocation.findMany({
          distinct: ['driverId'],
          orderBy: { recordedAt: 'desc' },
          select: {
            driverId: true,
            latitude: true,
            longitude: true,
            heading: true,
            speed: true,
            accuracy: true,
            recordedAt: true
          },
          take: 100
        });
        locationsData.forEach(l => { locationsMap[l.driverId] = l; });
      } catch (e) { /* locations unavailable */ }

      // Build response combining drivers with status and locations
      return prismaDrivers.map(d => {
        const loc = locationsMap[d.id];
        return {
          id: d.id,
          username: d.username,
          email: d.email,
          phone: d.phone,
          fullName: d.fullName,
          full_name: d.fullName,
          active: d.active,
          role: d.account?.role || 'driver',
          tracking: {
            online: loc ? (Date.now() - new Date(loc.recordedAt).getTime()) < 5 * 60 * 1000 : false,
            location: loc ? {
              lat: loc.latitude,
              lng: loc.longitude,
              heading: loc.heading,
              speed: loc.speed,
              accuracy: loc.accuracy,
              timestamp: loc.recordedAt
            } : null,
            status: d.status?.status || 'offline',
            lastUpdate: loc?.recordedAt || d.status?.updatedAt || null,
            assignmentId: d.status?.currentAssignmentId || null
          }
        };
      });
    }, 15000, 60000); // 15s fresh, 60s max cache

    res.json({
      drivers: data,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('tracking/drivers error', err);
    res.status(500).json({ error: 'tracking_fetch_failed', detail: err.message });
  }
});

module.exports = router;

