import { Router, Request, Response } from 'express';
import { authenticate, requireAnyRole } from '../auth.js';
import sapService from '../services/sapService.js';
import prisma from '../db/prisma.js';
import cache from '../cache.js';
import * as db from '../db/index.js';
import { excludeTeamPortalGarbageDeliveries } from '../../utils/deliveryListFilter.js';

const router = Router();

/**
 * Detect addresses that cannot be used for routing (e.g. "call for delivery").
 * Mirrors src/utils/addressHandler.js isUnrecognizableAddress for server-side use.
 */
const UNRECOGNIZABLE_ADDR_PATTERNS = [
  /^(call|call\s+for\s+(delivery|pickup|address|location)|call\s+customer)$/i,
  /^(tbd|to\s+be\s+(confirmed|determined|advised)|n\/a|na|none|nil|-)$/i,
  /^(pickup|warehouse|collect|collection\s+point)$/i,
  /^(see\s+notes?|as\s+instructed|contact\s+(customer|driver|office))$/i,
  /^(unknown|unspecified|no\s+address|no\s+delivery\s+address)$/i,
  /^(refer\s+to|check\s+with|pending|awaiting)$/i,
];

function isUnrecognizableAddressServer(address: unknown): boolean {
  if (!address || typeof address !== 'string') return true;
  const trimmed = address.trim();
  if (trimmed.length < 5) return true;
  for (const p of UNRECOGNIZABLE_ADDR_PATTERNS) {
    if (p.test(trimmed)) return true;
  }
  if (/^call\b/i.test(trimmed)) return true;
  return false;
}

// GET /api/admin/tracking/deliveries - real-time delivery tracking
// Optimized: uses select instead of include, server-side cache (30s fresh, 2min max)
router.get('/deliveries', authenticate, requireAnyRole('admin', 'delivery_team', 'logistics_team'), async (req: Request, res: Response): Promise<void> => {
  try {
    const data = await cache.getOrFetch('tracking:deliveries:v2', async () => {
      let dbDeliveries: unknown[] = [];
      try {
        // Statuses permanently excluded (never shown on portal/manage tab).
        // 'rescheduled' is intentionally NOT here — rescheduled orders must
        // remain visible until the customer confirms a new date.
        const ALWAYS_EXCLUDED = ['cancelled', 'returned'];
        // Delivered-type statuses: excluded beyond 24 h but included for today's card.
        const DELIVERED_STATUSES = [
          'delivered', 'delivered-with-installation', 'delivered-without-installation',
          'completed', 'pod-completed', 'finished',
        ];
        const cutoff24h = new Date(Date.now() - 86_400_000); // 24 hours ago

        dbDeliveries = await prisma.delivery.findMany({
          where: {
            OR: [
              // All active (non-terminal) deliveries
              { status: { notIn: [...ALWAYS_EXCLUDED, ...DELIVERED_STATUSES] } },
              // Recently delivered (last 24 h) — powers the "Delivered Today" card
              { status: { in: DELIVERED_STATUSES }, updatedAt: { gte: cutoff24h } },
            ],
          },
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
            confirmationStatus: true,
            confirmationToken: true,
            customerConfirmedAt: true,
            confirmedDeliveryDate: true,
            smsSentAt: true,
            goodsMovementDate: true,
            deliveryNumber: true,
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
          take: 500
        });
      } catch (err: unknown) {
        const e = err as { message?: string };
        console.error('[Tracking] Prisma query error:', e.message);
        dbDeliveries = [];
      }

      let deliveries = (dbDeliveries as {
        id: string; customer: string | null; address: string | null; phone: string | null;
        lat: number | null; lng: number | null; status: string; items: unknown;
        metadata: unknown; poNumber: string | null; createdAt: Date; updatedAt: Date;
        confirmationStatus: string | null; confirmationToken: string | null;
        customerConfirmedAt: Date | null; confirmedDeliveryDate: Date | null;
        smsSentAt: Date | null; goodsMovementDate: Date | null; deliveryNumber: string | null;
        assignments: { driverId: string | null; status: string; assignedAt: Date | null; driver?: { fullName?: string } | null }[];
      }[]).map(d => ({
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
        updatedAt: d.updatedAt,
        confirmationStatus: d.confirmationStatus,
        confirmationToken: d.confirmationToken,
        customerConfirmedAt: d.customerConfirmedAt,
        confirmedDeliveryDate: d.confirmedDeliveryDate,
        smsSentAt: d.smsSentAt,
        goodsMovementDate: d.goodsMovementDate,
        deliveryNumber: d.deliveryNumber,
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

      try {
        const deliveriesResp = await sapService.call('/Deliveries', 'get') as { data: unknown };
        let sapDeliveries: unknown[] = [];
        const sapData = deliveriesResp.data as Record<string, unknown>;
        if (Array.isArray(sapData?.value)) {
          sapDeliveries = sapData.value as unknown[];
        } else if (Array.isArray(deliveriesResp.data)) {
          sapDeliveries = deliveriesResp.data as unknown[];
        }

        const dbDeliveryIds = new Set(deliveries.map(d => d.id));
        const newSapDeliveries = (sapDeliveries as { id?: string; ID?: string }[]).filter(d => {
          const sapId = d.id || d.ID;
          return sapId && !dbDeliveryIds.has(sapId);
        });
        deliveries = deliveries.concat(newSapDeliveries as typeof deliveries);
      } catch (_) {
        // SAP not available, use database only
      }

      deliveries.sort((a, b) => {
        const aPhone = a.phone != null ? String(a.phone).trim() : '';
        const bPhone = b.phone != null ? String(b.phone).trim() : '';
        const aHasPhone = aPhone.length > 0;
        const bHasPhone = bPhone.length > 0;

        const aBadAddress = isUnrecognizableAddressServer(a.address);
        const bBadAddress = isUnrecognizableAddressServer(b.address);

        const aHasContact = aHasPhone && !aBadAddress;
        const bHasContact = bHasPhone && !bBadAddress;

        if (aHasContact && !bHasContact) return -1;
        if (!aHasContact && bHasContact) return 1;
        return 0;
      });

      return excludeTeamPortalGarbageDeliveries(deliveries);
    }, 5000, 15000);

    res.json({
      deliveries: data,
      timestamp: new Date().toISOString()
    });
  } catch (err: unknown) {
    const e = err as { message?: string };
    console.error('tracking/deliveries error', err);
    res.status(500).json({ error: 'tracking_fetch_failed', detail: e.message });
  }
});

// GET /api/admin/tracking/drivers - real-time driver tracking
// Optimized: uses select, server-side cache, single combined query
router.get('/drivers', authenticate, requireAnyRole('admin', 'delivery_team', 'logistics_team'), async (req: Request, res: Response): Promise<void> => {
  try {
    const ONLINE_WINDOW_MINUTES = 15;
    const data = await cache.getOrFetch('tracking:drivers', async () => {
      let prismaDrivers: {
        id: string; username: string | null; email: string | null; phone: string | null;
        fullName: string | null; active: boolean | null;
        account?: { role: string; lastLogin?: Date | null } | null;
        status?: { status: string; updatedAt: Date; currentAssignmentId: string | null } | null;
      }[] = [];

      try {
        // For the monitoring map, show all active drivers regardless of account linkage.
        // The assignment endpoint enforces role='driver' separately; here we just need
        // to know who is in the field. Drivers without a linked account are included so
        // the map is never silently empty.
        const dbDrivers = await prisma.driver.findMany({
          where: { active: true },
          select: {
            id: true,
            username: true,
            email: true,
            phone: true,
            fullName: true,
            active: true,
            account: { select: { role: true, lastLogin: true } },
            status: { select: { status: true, updatedAt: true, currentAssignmentId: true } }
          }
        });
        // Keep only role='driver' accounts for the assignment dropdown; drivers without
        // an account are still surfaced in monitoring with role='driver' as a safe default.
        prismaDrivers = dbDrivers.filter(d => !d.account || d.account.role === 'driver');
      } catch (e: unknown) {
        const err = e as { message?: string };
        console.warn('[Tracking] Could not fetch Prisma drivers:', err.message);
      }

      if (prismaDrivers.length === 0) {
        console.warn('[Tracking] No active drivers found in database.');
        return [];
      }

      let locationsMap: Record<string, {
        driverId: string; latitude: number; longitude: number;
        heading: number | null; speed: number | null; accuracy: number | null; recordedAt: Date;
      }> = {};

      try {
        const driverIds = prismaDrivers.map(d => d.id).filter(Boolean);
        if (driverIds.length > 0) {
          const latestRows = await db.query(
            `
              SELECT DISTINCT ON (driver_id)
                driver_id, latitude, longitude, heading, speed, accuracy, recorded_at
              FROM live_locations
              WHERE driver_id = ANY($1::uuid[])
              ORDER BY driver_id, recorded_at DESC
            `,
            [driverIds]
          );
          for (const row of latestRows.rows as Array<{
            driver_id: string;
            latitude: number;
            longitude: number;
            heading: number | null;
            speed: number | null;
            accuracy: number | null;
            recorded_at: string | Date;
          }>) {
            locationsMap[row.driver_id] = {
              driverId: row.driver_id,
              latitude: Number(row.latitude),
              longitude: Number(row.longitude),
              heading: row.heading != null ? Number(row.heading) : null,
              speed: row.speed != null ? Number(row.speed) : null,
              accuracy: row.accuracy != null ? Number(row.accuracy) : null,
              recordedAt: new Date(row.recorded_at)
            };
          }
        }
      } catch (err: unknown) {
        const e = err as { message?: string };
        console.warn('[Tracking] Could not fetch latest live locations:', e.message);
      }

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
          account: { role: d.account?.role || 'driver', lastLogin: d.account?.lastLogin || null },
          tracking: {
            online: loc ? (Date.now() - new Date(loc.recordedAt).getTime()) < ONLINE_WINDOW_MINUTES * 60 * 1000 : false,
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
    }, 2000, 10000);

    res.json({
      drivers: data,
      timestamp: new Date().toISOString()
    });
  } catch (err: unknown) {
    const e = err as { message?: string };
    console.error('tracking/drivers error', err);
    res.status(500).json({ error: 'tracking_fetch_failed', detail: e.message });
  }
});

export default router;
