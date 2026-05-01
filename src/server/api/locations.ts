// Express router for driver location ingestion
import { Router, Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import * as db from '../db/index.js';
import prisma from '../db/prisma.js';
import cache from '../cache.js';
import { authenticate } from '../auth.js';

const router = Router();

type AuthUser = { sub: string; role?: string; account?: { role?: string } };
type DbLocationRow = {
  id?: bigint | number;
  driverId?: string;
  latitude?: number;
  longitude?: number;
  heading?: number | null;
  speed?: number | null;
  accuracy?: number | null;
  recordedAt?: Date | string;
};

function getAuthenticatedDriverId(req: Request): string | null {
  const user = (req.user || {}) as { sub?: string; id?: string };
  return user.sub || user.id || null;
}

// ─────────────────────────────────────────────────────────────
// Haversine distance helper (returns metres)
// ─────────────────────────────────────────────────────────────
function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (v: number) => (v * Math.PI) / 180;
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
async function checkDriverArrival(driverId: string, driverLat: number, driverLng: number): Promise<void> {
  try {
    const ARRIVAL_RADIUS_METRES = 200;
    const COOLDOWN_MINUTES = 30;

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
      const doneStatuses = ['delivered', 'completed', 'delivered-with-installation', 'delivered-without-installation', 'cancelled'];
      if (doneStatuses.includes((delivery.status || '').toLowerCase())) continue;
      if (!delivery.lat || !delivery.lng) continue;

      const distance = haversineDistance(driverLat, driverLng, delivery.lat, delivery.lng);
      if (distance > ARRIVAL_RADIUS_METRES) continue;

      const cutoff = new Date(Date.now() - COOLDOWN_MINUTES * 60 * 1000);
      const recentNotif = await (prisma as any).adminNotification.findFirst({
        where: {
          type: 'driver_arrived',
          createdAt: { gt: cutoff },
          payload: { path: ['deliveryId'], equals: delivery.id }
        }
      });
      if (recentNotif) continue;

      const driver = await prisma.driver.findUnique({
        where: { id: driverId },
        select: { fullName: true, username: true }
      });
      const driverName = driver?.fullName || driver?.username || 'Driver';

      await (prisma as any).adminNotification.create({
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
  } catch (err: unknown) {
    const e = err as { message?: string };
    console.error('[Locations] Arrival check error:', e.message);
  }
}

// POST /api/driver/me/location - authenticated driver posts own location
// IMPORTANT: must be defined before /:id/location to prevent Express matching "me" as an :id param
router.post('/me/location', authenticate, async (req: Request, res: Response): Promise<void> => {
  const driverId = getAuthenticatedDriverId(req);
  const { latitude, longitude, heading, speed, accuracy, recorded_at } = req.body;
  if (!driverId) { res.status(401).json({ error: 'unauthorized' }); return; }
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    res.status(400).json({ error: 'lat_long_required' });
    return;
  }
  try {
    const created = await prisma.liveLocation.create({
      data: {
        driverId,
        latitude: lat,
        longitude: lng,
        heading: heading != null ? Number(heading) : null,
        speed: speed != null ? Number(speed) : null,
        accuracy: accuracy != null ? Number(accuracy) : null,
        recordedAt: recorded_at ? new Date(recorded_at as string) : new Date()
      }
    }) as DbLocationRow;

    setTimeout(async () => {
      try {
        await prisma.liveLocation.deleteMany({
          where: {
            driverId,
            recordedAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) }
          }
        });
      } catch (err: unknown) {
        console.error('Location cleanup error:', err);
      }
    }, 0);

    setTimeout(() => {
      void checkDriverArrival(driverId, lat, lng);
    }, 0);

    cache.invalidatePrefix('tracking:');
    res.json({
      ok: true,
      location: {
        id: created.id != null ? String(created.id) : undefined,
        driver_id: created.driverId,
        latitude: created.latitude,
        longitude: created.longitude,
        recorded_at: created.recordedAt
      }
    });
  } catch (err: unknown) {
    console.error('POST /api/driver/me/location', err);
    res.status(500).json({ error: 'db_error', detail: (err as { message?: string })?.message });
  }
});

// POST /api/driver/:id/location
router.post('/:id/location', async (req: Request, res: Response): Promise<void> => {
  const driverId = req.params.id as string;
  const { latitude, longitude, heading, speed, accuracy, recorded_at } = req.body;

  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    res.status(400).json({ error: 'lat_long_required' });
    return;
  }

  try {
    const created = await prisma.liveLocation.create({
      data: {
        driverId,
        latitude: lat,
        longitude: lng,
        heading: heading != null ? Number(heading) : null,
        speed: speed != null ? Number(speed) : null,
        accuracy: accuracy != null ? Number(accuracy) : null,
        recordedAt: recorded_at ? new Date(recorded_at as string) : new Date()
      }
    }) as DbLocationRow;

    setTimeout(async () => {
      try {
        await prisma.liveLocation.deleteMany({
          where: {
            driverId,
            recordedAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) }
          }
        });
      } catch (err: unknown) {
        console.error('Location cleanup error:', err);
      }
    }, 0);

    setTimeout(() => {
      void checkDriverArrival(driverId, lat, lng);
    }, 0);

    cache.invalidatePrefix('tracking:');
    res.json({
      ok: true,
      location: {
        id: created.id != null ? String(created.id) : undefined,
        driver_id: created.driverId,
        latitude: created.latitude,
        longitude: created.longitude,
        recorded_at: created.recordedAt
      }
    });
  } catch (err: unknown) {
    console.error('POST /api/driver/:id/location', err);
    res.status(500).json({ error: 'db_error', detail: (err as { message?: string })?.message });
  }
});

// GET /api/driver/me/live - authenticated driver's latest location
router.get('/me/live', authenticate, async (req: Request, res: Response): Promise<void> => {
  const driverId = getAuthenticatedDriverId(req);
  if (!driverId) { res.status(401).json({ error: 'unauthorized' }); return; }
  try {
    const latest = await prisma.liveLocation.findFirst({
      where: { driverId },
      orderBy: { recordedAt: 'desc' },
      select: {
        driverId: true,
        latitude: true,
        longitude: true,
        recordedAt: true,
        speed: true,
        accuracy: true,
        heading: true
      }
    });
    if (!latest) { res.status(404).json({ error: 'not_found' }); return; }
    res.json({
      driver_id: latest.driverId,
      latitude: latest.latitude,
      longitude: latest.longitude,
      recorded_at: latest.recordedAt,
      speed: latest.speed,
      accuracy: latest.accuracy,
      heading: latest.heading
    });
  } catch (err: unknown) {
    console.error('GET /api/driver/me/live', err);
    res.status(500).json({ error: 'db_error', detail: (err as { message?: string })?.message });
  }
});

// GET /api/driver/:id/live - latest location (public per-driver)
router.get('/:id/live', async (req: Request, res: Response): Promise<void> => {
  const driverId = req.params.id;
  try {
    const { rows } = await db.query('SELECT driver_id, latitude, longitude, recorded_at FROM live_locations WHERE driver_id = $1 ORDER BY recorded_at DESC LIMIT 1', [driverId]);
    if (!rows.length) { res.status(404).json({ error: 'not_found' }); return; }
    res.json(rows[0]);
  } catch (err: unknown) {
    console.error('GET /api/driver/:id/live', err);
    res.status(500).json({ error: 'db_error' });
  }
});

/**
 * GET /api/driver/deliveries - Get driver's assigned deliveries
 */
// Statuses that require no further action from the driver.
const DRIVER_TERMINAL_STATUSES = [
  'delivered', 'delivered-with-installation', 'delivered-without-installation',
  'completed', 'pod-completed', 'finished', 'cancelled', 'rejected', 'returned',
];

router.get('/deliveries', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const driverId = (req.user as AuthUser)?.sub;
    if (!driverId) {
      res.status(401).json({ error: 'Unauthorized' }); return;
    }

    // Only return active (non-terminal) deliveries where this driver has a
    // CURRENT active assignment (assigned or in_progress).
    // Filtering by assignment status excludes deliveries that were reassigned
    // to another driver (their old assignment is kept as 'reassigned' for
    // audit history but must not appear in the driver's live work list).
    const deliveries = await prisma.delivery.findMany({
      where: {
        assignments: { some: { driverId, status: { in: ['assigned', 'in_progress'] } } },
        status: { notIn: DRIVER_TERMINAL_STATUSES }
      },
      include: {
        assignments: {
          where: { driverId, status: { in: ['assigned', 'in_progress'] } },
          orderBy: { assignedAt: 'desc' },
          take: 1,
          include: {
            driver: { select: { id: true, fullName: true, username: true } }
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    // Write-on-read promotion: any pickup-confirmed row whose delivery date
    // has reached Dubai-today (or is already past) must flip to out-for-delivery
    // so this portal, admin/logistics/delivery portals, and customer tracking
    // all show the same label. Catches two cases:
    //   (a) driver picking-confirmed for a future date yesterday, never tapped
    //       Start Delivery, and the date has since arrived.
    //   (b) legacy rows promoted before the picking-confirm endpoint was fixed.
    // Idempotent — guarded by status in the UPDATE WHERE clause, so concurrent
    // fetches cannot double-promote or double-log the event.
    const dubaiNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Dubai' }));
    const dubaiTodayStr = `${dubaiNow.getFullYear()}-${String(dubaiNow.getMonth() + 1).padStart(2, '0')}-${String(dubaiNow.getDate()).padStart(2, '0')}`;
    const dubaiDayString = (d: Date | string | null | undefined): string | null => {
      if (!d) return null;
      const dt = d instanceof Date ? d : new Date(d);
      if (isNaN(dt.getTime())) return null;
      const z = new Date(dt.toLocaleString('en-US', { timeZone: 'Asia/Dubai' }));
      return `${z.getFullYear()}-${String(z.getMonth() + 1).padStart(2, '0')}-${String(z.getDate()).padStart(2, '0')}`;
    };
    const toPromote = deliveries.filter((d) => {
      const s = (d.status || '').toLowerCase();
      if (s !== 'pickup-confirmed' && s !== 'pickup_confirmed') return false;
      const deliveryDateStr = dubaiDayString(d.confirmedDeliveryDate ?? d.goodsMovementDate);
      return deliveryDateStr != null && deliveryDateStr <= dubaiTodayStr;
    });
    if (toPromote.length > 0) {
      const promotedAt = new Date();
      const promotedAtIso = promotedAt.toISOString();
      for (const d of toPromote) {
        const prevStatus = (d.status || '').toLowerCase();
        const currentMeta = (d.metadata as Record<string, unknown> | null) ?? {};
        // Preserve any existing routeStartedAt (ISO string) — only stamp now if
        // absent. Cast to string | null because Prisma's InputJsonValue rejects
        // unknown. If metadata was malformed, default to the promotion time.
        const existingRouteStartedAt = typeof currentMeta.routeStartedAt === 'string'
          ? currentMeta.routeStartedAt
          : null;
        const nextMeta: Record<string, unknown> = {
          ...currentMeta,
          routeStartedAt: existingRouteStartedAt ?? promotedAtIso,
        };
        // Conditional UPDATE: only flips rows that are still pickup-confirmed.
        // Two concurrent requests cannot both claim to have promoted the row.
        // Cast to Prisma.InputJsonValue because updateMany's stricter type
        // rejects Record<string, unknown>; values are all JSON-safe primitives
        // and nested objects already stored in metadata.
        const updateResult = await prisma.delivery.updateMany({
          where: { id: d.id, status: { in: ['pickup-confirmed', 'pickup_confirmed'] } },
          data: {
            status: 'out-for-delivery',
            metadata: nextMeta as Prisma.InputJsonValue,
            updatedAt: promotedAt,
          },
        });
        if (updateResult.count === 0) {
          // Another request beat us to the promotion; don't log a duplicate event.
          continue;
        }
        await prisma.deliveryAssignment.updateMany({
          where: { deliveryId: d.id, status: 'assigned' },
          data: { status: 'in_progress' },
        });
        await prisma.deliveryEvent.create({
          data: {
            deliveryId: d.id,
            eventType: 'auto_promoted_overdue_pickup',
            payload: {
              previousStatus: prevStatus,
              newStatus: 'out-for-delivery',
              reason: 'delivery_date_reached',
              promotedAt: promotedAtIso,
              triggeredBy: 'driver_deliveries_fetch',
            },
            actorType: 'system',
            actorId: null,
          },
        }).catch((e: unknown) => {
          console.warn('[driver/deliveries] auto-promote event log failed:', (e as Error).message);
        });
        // Patch the in-memory row so the response reflects the new DB state.
        d.status = 'out-for-delivery';
        d.metadata = nextMeta as typeof d.metadata;
        d.updatedAt = promotedAt;
      }
      cache.invalidatePrefix('tracking:');
      cache.invalidatePrefix('deliveries:list:');
      cache.invalidatePrefix('dashboard:');
    }

    const mapped = deliveries.map(d => ({
      id: d.id,
      customer: d.customer,
      address: d.address,
      phone: d.phone,
      lat: d.lat,
      lng: d.lng,
      poNumber: d.poNumber,
      status: d.status,
      priority: (d as unknown as { priority?: number }).priority ?? null,
      items: d.items,
      metadata: d.metadata,
      goodsMovementDate: d.goodsMovementDate,
      deliveryNumber: d.deliveryNumber,
      confirmedDeliveryDate: d.confirmedDeliveryDate,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
      assignedDriverId: driverId,
      // Expose a tracking sub-object so the driver portal can access driverId
      // and assignment status the same way the admin/ops portal does.
      tracking: {
        assigned: true,
        driverId,
        status: d.assignments[0]?.status || 'assigned',
        assignedAt: d.assignments[0]?.assignedAt || null,
        eta: d.assignments[0]?.eta || null,
      }
    }));

    // Contact-complete deliveries first (have both address and phone).
    const withContact: typeof mapped = [];
    const missingContact: typeof mapped = [];
    for (const d of mapped) {
      const hasAddress = d.address != null && String(d.address).trim().length > 0;
      const hasPhone = d.phone != null && String(d.phone).trim().length > 0;
      if (hasAddress && hasPhone) withContact.push(d);
      else missingContact.push(d);
    }

    res.json({
      success: true,
      deliveries: [...withContact, ...missingContact]
    });
  } catch (error: unknown) {
    const e = error as { message?: string };
    console.error('Error fetching driver deliveries:', error);
    res.status(500).json({ error: e.message });
  }
});

/**
 * GET /api/driver/deliveries/finished - Get driver's finished (terminal) deliveries
 * Returns delivered, cancelled, and returned orders so drivers can review history.
 */
const DRIVER_FINISHED_STATUSES = [
  'delivered', 'delivered-with-installation', 'delivered-without-installation',
  'completed', 'pod-completed', 'finished', 'cancelled', 'rejected', 'returned',
];

router.get('/deliveries/finished', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const driverId = (req.user as AuthUser)?.sub;
    if (!driverId) {
      res.status(401).json({ error: 'Unauthorized' }); return;
    }

    // Only show deliveries that this driver actually completed (assignment status
    // 'completed'). Deliveries reassigned away keep a 'reassigned' assignment
    // for this driver but should not appear in their history.
    //
    // Hard 48-hour recency window applied AT THE SERVER so the Driver Portal's
    // "Completed" chip can never inflate beyond what's actually recent. Without
    // this guard, every prior bulk update (geocoding fix, status mass-edit,
    // re-import) would touch updatedAt on hundreds of old delivered rows and
    // make them all look "recent" in the client-side filter.
    const FORTY_EIGHT_HOURS_MS = 48 * 60 * 60 * 1000;
    const cutoff = new Date(Date.now() - FORTY_EIGHT_HOURS_MS);
    const deliveries = await prisma.delivery.findMany({
      where: {
        assignments: { some: { driverId, status: 'completed' } },
        status: { in: DRIVER_FINISHED_STATUSES },
        // Recency gate — order must have been *completed* (not just touched) in
        // the last 48h. deliveredAt is the canonical completion timestamp;
        // podCompletedAt covers driver-side POD finalisation when delivered
        // happens out-of-order. updatedAt is intentionally NOT used here since
        // unrelated bulk writes would falsify recency.
        OR: [
          { deliveredAt: { gte: cutoff } },
          { podCompletedAt: { gte: cutoff } },
        ],
      },
      include: {
        assignments: {
          where: { driverId, status: 'completed' },
          orderBy: { assignedAt: 'desc' },
          take: 1,
        }
      },
      orderBy: { deliveredAt: 'desc' },
      take: 50, // Even with the 48h gate, hard-cap at 50 to keep the response light
    });

    const mapped = deliveries.map(d => ({
      id: d.id,
      customer: d.customer,
      address: d.address,
      phone: d.phone,
      poNumber: d.poNumber,
      status: d.status,
      items: d.items,
      metadata: d.metadata,
      conditionNotes: d.conditionNotes,
      deliveryNotes: (d as unknown as Record<string, unknown>).deliveryNotes ?? null,
      driverSignature: d.driverSignature,
      customerSignature: d.customerSignature,
      photos: d.photos,
      deliveredAt: d.deliveredAt,
      podCompletedAt: d.podCompletedAt,
      updatedAt: d.updatedAt,
      createdAt: d.createdAt,
    }));

    res.json({ success: true, deliveries: mapped });
  } catch (error: unknown) {
    const e = error as { message?: string };
    console.error('Error fetching driver finished deliveries:', error);
    res.status(500).json({ error: e.message });
  }
});

/**
 * GET /api/driver/notifications/count - Get unread notification count for driver
 */
router.get('/notifications/count', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const driverId = (req.user as AuthUser)?.sub;
    if (!driverId) {
      res.status(401).json({ error: 'Unauthorized' }); return;
    }

    const unreadMessages = await prisma.message.count({
      where: {
        driverId: driverId,
        isRead: false
      }
    });

    console.log(`[Driver Notifications] Driver ${driverId} has ${unreadMessages} unread messages`);

    res.json({
      success: true,
      count: unreadMessages
    });
  } catch (error: unknown) {
    const e = error as { message?: string };
    console.error('Error fetching notification count:', error);
    res.status(500).json({ error: e.message });
  }
});

export default router;
