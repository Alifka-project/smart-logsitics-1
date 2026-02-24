// Express router for driver location ingestion
const express = require('express');
const router = express.Router();
const db = require('../db');
const prisma = require('../db/prisma');

const { authenticate } = require('../auth');

// ─────────────────────────────────────────────────────────────
// Haversine distance helper (returns metres)
// ─────────────────────────────────────────────────────────────
function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (v) => (v * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Check if driver has arrived at any assigned delivery destination and notify admin.
 * Called asynchronously after each location update (fire-and-forget).
 */
async function checkDriverArrival(driverId, driverLat, driverLng) {
  try {
    const ARRIVAL_RADIUS_METRES = 200;
    const COOLDOWN_MINUTES = 30;

    // Find active assigned deliveries with known coordinates
    const assignments = await prisma.deliveryAssignment.findMany({
      where: {
        driverId,
        status: { notIn: ['completed', 'cancelled'] }
      },
      select: {
        deliveryId: true,
        delivery: {
          select: {
            id: true,
            customer: true,
            address: true,
            lat: true,
            lng: true,
            status: true
          }
        }
      }
    });

    for (const assignment of assignments) {
      const delivery = assignment.delivery;
      if (!delivery) continue;
      // Skip if delivery is already completed/delivered
      const doneStatuses = ['delivered', 'completed', 'delivered-with-installation', 'delivered-without-installation', 'cancelled'];
      if (doneStatuses.includes((delivery.status || '').toLowerCase())) continue;
      if (!delivery.lat || !delivery.lng) continue;

      const distance = haversineDistance(driverLat, driverLng, delivery.lat, delivery.lng);
      if (distance > ARRIVAL_RADIUS_METRES) continue;

      // Debounce: skip if we already notified for this delivery in the last COOLDOWN_MINUTES
      const cutoff = new Date(Date.now() - COOLDOWN_MINUTES * 60 * 1000);
      const recentNotif = await prisma.adminNotification.findFirst({
        where: {
          type: 'driver_arrived',
          createdAt: { gt: cutoff },
          payload: { path: ['deliveryId'], equals: delivery.id }
        }
      });
      if (recentNotif) continue;

      // Create arrival notification
      const driver = await prisma.driver.findUnique({
        where: { id: driverId },
        select: { fullName: true, username: true }
      });
      const driverName = driver?.fullName || driver?.username || 'Driver';

      await prisma.adminNotification.create({
        data: {
          type: 'driver_arrived',
          title: 'Driver Arrived at Delivery Location',
          message: `${driverName} has arrived at ${delivery.customer || 'customer'} — ${delivery.address || 'address unknown'}`,
          payload: {
            driverId,
            driverName,
            deliveryId: delivery.id,
            customer: delivery.customer,
            address: delivery.address,
            distanceMetres: Math.round(distance)
          }
        }
      });

      console.log(`[Locations] 🔔 Driver ${driverName} arrived at delivery ${delivery.id} (${Math.round(distance)}m away)`);
    }
  } catch (err) {
    console.error('[Locations] Arrival check error:', err.message);
  }
}

// POST /api/driver/:id/location
router.post('/:id/location', async (req, res) => {
  const driverId = req.params.id;
  const { latitude, longitude, heading, speed, accuracy, recorded_at } = req.body;

  if (!latitude || !longitude) return res.status(400).json({ error: 'lat_long_required' });

  try {
    // Insert new location
    const q = `INSERT INTO live_locations(driver_id, latitude, longitude, heading, speed, accuracy, recorded_at)
               VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id, driver_id, latitude, longitude, recorded_at`;
    const vals = [driverId, latitude, longitude, heading || null, speed || null, accuracy || null, recorded_at || new Date().toISOString()];
    const { rows } = await db.query(q, vals);

    // Cleanup old locations for this driver (keep only last 24 hours) - do this async to not block response
    setImmediate(async () => {
      try {
        await db.query(
          `DELETE FROM live_locations 
           WHERE driver_id = $1 
           AND recorded_at < NOW() - INTERVAL '24 hours'`,
          [driverId]
        );
      } catch (err) {
        console.error('Location cleanup error:', err);
      }
    });

    // Async arrival check — non-blocking
    setImmediate(() => checkDriverArrival(driverId, latitude, longitude));

    res.json({ ok: true, location: rows[0] });
  } catch (err) {
    console.error('POST /api/driver/:id/location', err);
    res.status(500).json({ error: 'db_error' });
  }
});

// POST /api/driver/me/location - authenticated driver posts own location
router.post('/me/location', authenticate, async (req, res) => {
  const driverId = req.user.sub;
  const { latitude, longitude, heading, speed, accuracy, recorded_at } = req.body;
  if (!latitude || !longitude) return res.status(400).json({ error: 'lat_long_required' });
  try {
    // Insert new location
    const q = `INSERT INTO live_locations(driver_id, latitude, longitude, heading, speed, accuracy, recorded_at)
               VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id, driver_id, latitude, longitude, recorded_at`;
    const vals = [driverId, latitude, longitude, heading || null, speed || null, accuracy || null, recorded_at || new Date().toISOString()];
    const { rows } = await db.query(q, vals);
    
    // Cleanup old locations for this driver (keep only last 24 hours) - do this async to not block response
    setImmediate(async () => {
      try {
        await db.query(
          `DELETE FROM live_locations 
           WHERE driver_id = $1 
           AND recorded_at < NOW() - INTERVAL '24 hours'`,
          [driverId]
        );
      } catch (err) {
        console.error('Location cleanup error:', err);
      }
    });

    // Async arrival check — non-blocking
    setImmediate(() => checkDriverArrival(driverId, latitude, longitude));

    res.json({ ok: true, location: rows[0] });
  } catch (err) {
    console.error('POST /api/driver/me/location', err);
    res.status(500).json({ error: 'db_error' });
  }
});

// GET /api/driver/me/live - authenticated driver's latest location
router.get('/me/live', authenticate, async (req, res) => {
  const driverId = req.user.sub;
  try {
    const { rows } = await db.query('SELECT driver_id, latitude, longitude, recorded_at FROM live_locations WHERE driver_id = $1 ORDER BY recorded_at DESC LIMIT 1', [driverId]);
    if (!rows.length) return res.status(404).json({ error: 'not_found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('GET /api/driver/me/live', err);
    res.status(500).json({ error: 'db_error' });
  }
});

// GET /api/driver/:id/live - latest location (public per-driver)
router.get('/:id/live', async (req, res) => {
  const driverId = req.params.id;
  try {
    const { rows } = await db.query('SELECT driver_id, latitude, longitude, recorded_at FROM live_locations WHERE driver_id = $1 ORDER BY recorded_at DESC LIMIT 1', [driverId]);
    if (!rows.length) return res.status(404).json({ error: 'not_found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('GET /api/driver/:id/live', err);
    res.status(500).json({ error: 'db_error' });
  }
});

/**
 * GET /api/driver/deliveries - Get driver's assigned deliveries
 */
router.get('/deliveries', authenticate, async (req, res) => {
  try {
    const driverId = req.user?.sub;
    if (!driverId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const deliveries = await prisma.delivery.findMany({
      where: {
        assignments: {
          some: {
            driverId
          }
        }
      },
      include: {
        assignments: {
          where: { driverId },
          include: {
            driver: {
              select: { id: true, fullName: true, username: true }
            }
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json({
      success: true,
      deliveries: deliveries.map(d => ({
        id: d.id,
        customer: d.customer,
        address: d.address,
        phone: d.phone,
        lat: d.lat,
        lng: d.lng,
        poNumber: d.poNumber,
        status: d.status,
        createdAt: d.createdAt,
        updatedAt: d.updatedAt,
        assignedAt: d.assignments[0]?.assignedAt,
        eta: d.assignments[0]?.eta
      }))
    });
  } catch (error) {
    console.error('Error fetching driver deliveries:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/driver/notifications/count - Get unread notification count for driver
 */
router.get('/notifications/count', authenticate, async (req, res) => {
  try {
    const driverId = req.user?.sub;
    if (!driverId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Count unread messages received by this driver
    const unreadMessages = await prisma.message.count({
      where: {
        receiverId: driverId,
        isRead: false
      }
    });

    console.log(`[Driver Notifications] Driver ${driverId} has ${unreadMessages} unread messages`);

    res.json({
      success: true,
      count: unreadMessages
    });
  } catch (error) {
    console.error('Error fetching notification count:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
