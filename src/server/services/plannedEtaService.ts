/**
 * Planned ETA for customer tracking during pre-route statuses (scheduled,
 * confirmed, pgi-done, pickup-confirmed).
 *
 * Algorithm
 * ─────────
 * 1. Anchor: 08:00 Dubai on the delivery date (confirmedDeliveryDate, falling
 *    back to goodsMovementDate, then today). confirmedDeliveryDate must win
 *    over goodsMovementDate so a rescheduled order anchors to the *new*
 *    delivery date — goodsMovementDate is the warehouse-PGI calendar day and
 *    is intentionally not updated on reschedule.
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

/**
 * Pick the best date to anchor the planned ETA to.
 *
 * Priority:
 *   1. confirmedDeliveryDate — the customer-facing delivery date. Updated on
 *      reschedule (both /admin/:id/reschedule and /admin/:id/status), so this
 *      is the single source of truth for "when is the customer getting it".
 *   2. goodsMovementDate — the warehouse PGI calendar day. Used only when no
 *      confirmed date exists; it survives reschedules unchanged so it must
 *      not win over confirmedDeliveryDate when both are set.
 *   3. today — last-resort fallback so the customer page still renders a
 *      reasonable window instead of falling through to "pending".
 */
function pickAnchorDateIso(delivery: Record<string, unknown>): string {
  const cdd = delivery.confirmedDeliveryDate as Date | string | null | undefined;
  if (cdd) {
    const d = new Date(cdd as string);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  const gmd = delivery.goodsMovementDate as Date | string | null | undefined;
  if (gmd) {
    const d = new Date(gmd as string);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return new Date().toISOString();
}

/**
 * Extract Y/M/D in Dubai timezone from any ISO timestamp. Critical: a
 * confirmedDeliveryDate of "30 Apr Dubai" is stored as 2026-04-29T20:00:00Z,
 * so reading getUTCDate() returns 29 — one day off. Always read the calendar
 * day in the customer's timezone, not the server's UTC clock.
 */
function dubaiYMD(anchorDateIso: string): { year: number; month: number; day: number } {
  const dt = new Date(anchorDateIso);
  // en-CA formats as "YYYY-MM-DD" which parses unambiguously.
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dubai',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(dt).split('-');
  return { year: Number(parts[0]), month: Number(parts[1]) - 1, day: Number(parts[2]) };
}

/** 08:00 Dubai (UTC+4) on the given calendar day, returned as a UTC Date. */
function dubaiDepartureUtc(anchorDateIso: string): Date {
  const { year, month, day } = dubaiYMD(anchorDateIso);
  // 08:00 Dubai = 04:00 UTC
  return new Date(Date.UTC(year, month, day, DEPARTURE_HOUR_DUBAI - DUBAI_OFFSET_H, 0, 0, 0));
}

async function buildRouteMatrix(driverId: string, anchorDateIso: string, targetDeliveryId: string): Promise<RouteMatrix> {
  const cached = getCachedMatrix(driverId, anchorDateIso);
  if (cached && cached.orderedIds.includes(targetDeliveryId)) return cached;

  // Day window (Dubai calendar day) in UTC: 00:00 – 23:59 Dubai = -4:00 – +19:59 UTC.
  // Use Dubai-TZ extraction (not getUTC*) so a confirmedDeliveryDate stored
  // as 2026-04-29T20:00:00Z (= 30 Apr Dubai) yields the 30 Apr window, not 29.
  const { year: y, month: m, day: d } = dubaiYMD(anchorDateIso);
  const dayStart = new Date(Date.UTC(y, m, d, 0 - DUBAI_OFFSET_H, 0, 0, 0));
  const dayEnd = new Date(Date.UTC(y, m, d + 1, 0 - DUBAI_OFFSET_H, 0, 0, 0));

  // All assigned deliveries for this driver, on this Dubai calendar day, that
  // aren't terminal yet. Priority first, then assignment assignedAt (stable
  // creation order), then delivery createdAt — deterministic, approximates
  // the app-side ordering.
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
      delivery: {
        select: { id: true, lat: true, lng: true, metadata: true, createdAt: true },
      },
    },
    orderBy: [{ assignedAt: 'asc' }],
  }) as Array<{
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
