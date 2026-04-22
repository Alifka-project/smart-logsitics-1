/**
 * Planned ETA for customer tracking during pre-route statuses (scheduled,
 * confirmed, pgi-done, pickup-confirmed).
 *
 * Algorithm
 * ─────────
 * 1. Anchor: 08:00 Dubai on the delivery date (goodsMovementDate, falling back
 *    to confirmedDeliveryDate, then today).
 * 2. Derive the driver's stop sequence for that date from the assignments
 *    created-at order (the driver app orders in-memory; we approximate with
 *    assignment creation time + priority flag).
 * 3. For each preceding stop, add driving time (OSRM / Valhalla) + fixed
 *    SERVICE_TIME_MIN minutes of service at the stop.
 * 4. Return a ±WINDOW_HALF_MIN window around the cumulative center.
 *
 * The (driverId, date) route matrix is cached in-memory for ROUTE_CACHE_TTL_MS
 * to avoid hammering OSRM on the 30-second customer-tracking poll.
 *
 * If the driver isn't assigned yet, or if routing lookups fail, we degrade to
 * a flat 08:00-18:00 "Today" window so the customer still sees *something*
 * reasonable rather than a missing ETA.
 */

import { fetchDrivingRouteBetweenPoints } from './drivingRouteService.js';
import prisma from '../db/prisma.js';

/** Minutes spent at each stop doing delivery + paperwork + install handoff. */
const SERVICE_TIME_MIN = 20;
/** Half-width of the window shown to the customer (total window = 2 × this). */
const WINDOW_HALF_MIN = 60;
/** 08:00 Dubai truck departure. */
const DEPARTURE_HOUR_DUBAI = 8;
/** UTC offset for Dubai (no DST). */
const DUBAI_OFFSET_H = 4;
/** Avg driving minutes per leg used as the OSRM fallback. */
const FALLBACK_LEG_MIN = 20;

const ROUTE_CACHE_TTL_MS = 5 * 60 * 1000;

type RouteLeg = { fromId: string | null; toId: string; minutes: number };
type RouteMatrix = {
  legs: RouteLeg[];
  /** Ordered delivery IDs including the target. */
  orderedIds: string[];
};

const routeMatrixCache = new Map<string, { expiresAt: number; matrix: RouteMatrix }>();

function cacheKey(driverId: string, dateIso: string): string {
  return `${driverId}::${dateIso.slice(0, 10)}`;
}

function getCachedMatrix(driverId: string, dateIso: string): RouteMatrix | null {
  const hit = routeMatrixCache.get(cacheKey(driverId, dateIso));
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    routeMatrixCache.delete(cacheKey(driverId, dateIso));
    return null;
  }
  return hit.matrix;
}

function setCachedMatrix(driverId: string, dateIso: string, matrix: RouteMatrix): void {
  routeMatrixCache.set(cacheKey(driverId, dateIso), {
    expiresAt: Date.now() + ROUTE_CACHE_TTL_MS,
    matrix,
  });
}

/** Pick the best date to anchor the planned ETA to. */
function pickAnchorDateIso(delivery: Record<string, unknown>): string {
  const gmd = delivery.goodsMovementDate as Date | string | null | undefined;
  if (gmd) {
    const d = new Date(gmd as string);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  const cdd = delivery.confirmedDeliveryDate as Date | string | null | undefined;
  if (cdd) {
    const d = new Date(cdd as string);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return new Date().toISOString();
}

/** 08:00 Dubai (UTC+4) on the given calendar day, returned as a UTC Date. */
function dubaiDepartureUtc(anchorDateIso: string): Date {
  const anchor = new Date(anchorDateIso);
  const year = anchor.getUTCFullYear();
  const month = anchor.getUTCMonth();
  const day = anchor.getUTCDate();
  // 08:00 Dubai = 04:00 UTC
  return new Date(Date.UTC(year, month, day, DEPARTURE_HOUR_DUBAI - DUBAI_OFFSET_H, 0, 0, 0));
}

async function buildRouteMatrix(driverId: string, anchorDateIso: string, targetDeliveryId: string): Promise<RouteMatrix> {
  const cached = getCachedMatrix(driverId, anchorDateIso);
  if (cached && cached.orderedIds.includes(targetDeliveryId)) return cached;

  // Day window (Dubai calendar day) in UTC: 00:00 – 23:59 Dubai = -4:00 – +19:59 UTC.
  const anchor = new Date(anchorDateIso);
  const y = anchor.getUTCFullYear();
  const m = anchor.getUTCMonth();
  const d = anchor.getUTCDate();
  const dayStart = new Date(Date.UTC(y, m, d, 0 - DUBAI_OFFSET_H, 0, 0, 0));
  const dayEnd = new Date(Date.UTC(y, m, d + 1, 0 - DUBAI_OFFSET_H, 0, 0, 0));

  // All assigned deliveries for this driver, on this Dubai calendar day, that
  // aren't terminal yet. Priority first, then assignment createdAt, then
  // delivery createdAt — deterministic, approximates the app-side ordering.
  const assignments = await prisma.deliveryAssignment.findMany({
    where: {
      driverId,
      status: { in: ['assigned', 'in_progress'] },
      delivery: {
        goodsMovementDate: { gte: dayStart, lt: dayEnd },
        status: { notIn: ['delivered', 'completed', 'pod-completed', 'finished', 'cancelled', 'rejected', 'returned', 'failed'] },
      },
    },
    select: {
      createdAt: true,
      delivery: {
        select: { id: true, lat: true, lng: true, metadata: true, createdAt: true },
      },
    },
    orderBy: [{ createdAt: 'asc' }],
  }) as Array<{
    createdAt: Date;
    delivery: {
      id: string;
      lat: number | null;
      lng: number | null;
      metadata: Record<string, unknown> | null;
      createdAt: Date;
    } | null;
  }>;

  const rows = assignments
    .map((a) => a.delivery)
    .filter((d): d is NonNullable<typeof assignments[number]['delivery']> => !!d);

  // Priority-first sort, then stable on arrival order.
  rows.sort((a, b) => {
    const aPri = (a.metadata as Record<string, unknown> | null)?.isPriority === true ? 1 : 0;
    const bPri = (b.metadata as Record<string, unknown> | null)?.isPriority === true ? 1 : 0;
    if (aPri !== bPri) return bPri - aPri;
    return a.createdAt.getTime() - b.createdAt.getTime();
  });

  const orderedIds = rows.map((r) => r.id);
  if (orderedIds.length === 0 || !orderedIds.includes(targetDeliveryId)) {
    const fallback: RouteMatrix = { legs: [], orderedIds };
    setCachedMatrix(driverId, anchorDateIso, fallback);
    return fallback;
  }

  // Compute leg durations sequentially: depot → stop1 → stop2 → ...
  // Depot coordinate is unknown server-side; use the first stop's coordinate
  // as the zero leg (0 minutes of drive into the first stop — the 08:00 anchor
  // already accounts for the morning loadout).
  const legs: RouteLeg[] = [];
  for (let i = 0; i < rows.length; i++) {
    const cur = rows[i];
    if (i === 0) {
      legs.push({ fromId: null, toId: cur.id, minutes: 0 });
      continue;
    }
    const prev = rows[i - 1];
    let minutes = FALLBACK_LEG_MIN;
    if (
      Number.isFinite(prev.lat) && Number.isFinite(prev.lng) &&
      Number.isFinite(cur.lat) && Number.isFinite(cur.lng)
    ) {
      try {
        const leg = await fetchDrivingRouteBetweenPoints(
          { lat: Number(prev.lat), lng: Number(prev.lng) },
          { lat: Number(cur.lat), lng: Number(cur.lng) },
        );
        if (leg && Number.isFinite(leg.durationS)) {
          minutes = Math.max(5, Math.round(leg.durationS / 60));
        }
      } catch {
        // keep FALLBACK_LEG_MIN
      }
    }
    legs.push({ fromId: prev.id, toId: cur.id, minutes });
  }

  const matrix: RouteMatrix = { legs, orderedIds };
  setCachedMatrix(driverId, anchorDateIso, matrix);
  return matrix;
}

export interface PlannedEtaWindow {
  mode: 'planned';
  earliest: string;
  latest: string;
  center: string;
  /** True when the returned window is a degraded flat 08:00–18:00 estimate. */
  degraded: boolean;
}

/**
 * Compute the planned-ETA window for the customer-facing tracking page.
 * Returns a ±60-minute window around the cumulative arrival time.
 */
export async function computePlannedSlotWindow(params: {
  delivery: Record<string, unknown>;
  driverId?: string | null;
}): Promise<PlannedEtaWindow> {
  const anchorIso = pickAnchorDateIso(params.delivery);
  const departureUtc = dubaiDepartureUtc(anchorIso);
  const deliveryId = (params.delivery.id || '') as string;

  // No driver assigned yet → flat AM window (still truthful: we don't know which truck).
  if (!params.driverId || !deliveryId) {
    return degradedWindow(departureUtc);
  }

  try {
    const matrix = await buildRouteMatrix(params.driverId, anchorIso, deliveryId);
    const idx = matrix.orderedIds.indexOf(deliveryId);
    if (idx < 0) return degradedWindow(departureUtc);

    // Sum: (leg_0 + service × 0) + (leg_1 + service × 1) + ... until we arrive at idx.
    let minutesFromDeparture = 0;
    for (let i = 0; i <= idx; i++) {
      const leg = matrix.legs[i];
      minutesFromDeparture += leg ? leg.minutes : FALLBACK_LEG_MIN;
      // Preceding stops incur service time before moving on; the target stop's
      // service time is NOT added — the customer's arrival is the arrival.
      if (i < idx) minutesFromDeparture += SERVICE_TIME_MIN;
    }

    const centerMs = departureUtc.getTime() + minutesFromDeparture * 60_000;
    const earliestMs = centerMs - WINDOW_HALF_MIN * 60_000;
    const latestMs = centerMs + WINDOW_HALF_MIN * 60_000;
    return {
      mode: 'planned',
      earliest: new Date(earliestMs).toISOString(),
      latest: new Date(latestMs).toISOString(),
      center: new Date(centerMs).toISOString(),
      degraded: false,
    };
  } catch {
    return degradedWindow(departureUtc);
  }
}

function degradedWindow(departureUtc: Date): PlannedEtaWindow {
  // 08:00–18:00 Dubai = 04:00–14:00 UTC. Center = noon Dubai = 08:00 UTC.
  const earliestMs = departureUtc.getTime();
  const latestMs = departureUtc.getTime() + 10 * 60 * 60_000;
  const centerMs = departureUtc.getTime() + 4 * 60 * 60_000;
  return {
    mode: 'planned',
    earliest: new Date(earliestMs).toISOString(),
    latest: new Date(latestMs).toISOString(),
    center: new Date(centerMs).toISOString(),
    degraded: true,
  };
}

/** Exposed for tests. */
export const __testing__ = {
  SERVICE_TIME_MIN,
  WINDOW_HALF_MIN,
  DEPARTURE_HOUR_DUBAI,
  FALLBACK_LEG_MIN,
  dubaiDepartureUtc,
  pickAnchorDateIso,
  clearCache: (): void => routeMatrixCache.clear(),
};
