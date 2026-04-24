/**
 * Live ETA service — used by the customer tracking endpoint when a delivery
 * is out-for-delivery / in-transit.
 *
 * Rationale:
 *   The locked `metadata.staticEta` (set at driver's Start Delivery tap) can
 *   drift dramatically when a route starts late, traffic changes, or the
 *   driver picks up the order a day after the scheduled date. That produces
 *   customer-visible bugs like "ETA: Tue 21 Apr 14:04" shown on 23 Apr.
 *
 *   This service computes an ETA from the driver's latest GPS ping + the
 *   delivery coordinates so the customer always sees a timestamp whose date
 *   matches the driver's live reality.
 *
 * Approach:
 *   1. Pull driver's most recent row from live_locations.
 *   2. Enforce freshness — if the latest ping is too old, return null so the
 *      caller falls back to the static ETA (transparent to the customer).
 *   3. Compute straight-line haversine distance from driver → delivery
 *      destination, convert to drive time at an average urban Dubai speed.
 *      OSRM-accurate routing is intentionally avoided here to keep the
 *      customer-fetch path cheap; the ±30-min window on the customer card
 *      swallows the haversine approximation error in practice.
 *   4. ETA = now + drive time. Date is always "today" by construction, so
 *      the customer card shows the same day as the driver.
 *
 * Caching:
 *   Results are memoised per deliveryId for CACHE_TTL_MS so the customer's
 *   poll cadence doesn't thrash the DB. Cache key is the deliveryId alone;
 *   the driver's GPS and the current wall clock are what actually change
 *   within a 30-second window, so a deliveryId-keyed cache is sufficient.
 */

import prisma from '../db/prisma.js';

const CACHE_TTL_MS = 30 * 1000;                // serve cached result for 30s
const FRESH_GPS_MS = 5 * 60 * 1000;            // <5 min = "live"
const STALE_GPS_MS = 20 * 60 * 1000;           // >20 min = no live ETA (fallback)
const AVG_SPEED_KMH = 35;                      // Dubai urban average incl. lights
const MIN_DRIVE_MIN = 3;                       // floor so "driver at door" still shows a plausible window

export interface LiveEtaResult {
  /** ISO string — the point-estimate for arrival. The ±window lives on the client. */
  eta: string;
  /** ISO string — when the driver's GPS was last recorded. */
  driverUpdatedAt: string;
  /** Straight-line distance between driver and destination, in kilometres. */
  distanceKm: number;
  /** Source flag — currently only 'haversine'. Reserved for future OSRM integration. */
  source: 'haversine';
  /** Freshness bucket — lets the UI dim / label stale-but-usable pings. */
  freshness: 'fresh' | 'stale';
}

interface CacheEntry {
  computedAt: number;
  result: LiveEtaResult;
}

const cache = new Map<string, CacheEntry>();

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth radius in km
  const toRad = (v: number): number => (v * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

interface ComputeParams {
  deliveryId: string;
  deliveryLat: number | null | undefined;
  deliveryLng: number | null | undefined;
  driverId: string | null | undefined;
}

/**
 * Returns a live ETA if the driver's GPS is recent enough AND both the
 * driver and the destination have coordinates. Returns null otherwise so
 * the caller falls back to whatever static data is available.
 */
export async function computeLiveEta(params: ComputeParams): Promise<LiveEtaResult | null> {
  const { deliveryId, deliveryLat, deliveryLng, driverId } = params;
  if (!deliveryId) return null;
  if (typeof deliveryLat !== 'number' || typeof deliveryLng !== 'number') return null;
  if (!Number.isFinite(deliveryLat) || !Number.isFinite(deliveryLng)) return null;
  if (!driverId) return null;

  // Cache hit — return immediately. Customers poll the tracking endpoint
  // aggressively and the live ETA doesn't change minute-to-minute in a way
  // that's customer-visible, so 30s is a reasonable floor.
  const cached = cache.get(deliveryId);
  if (cached && Date.now() - cached.computedAt < CACHE_TTL_MS) {
    return cached.result;
  }

  let latestGps: { latitude: number; longitude: number; recordedAt: Date } | null = null;
  try {
    const row = await prisma.liveLocation.findFirst({
      where: { driverId },
      orderBy: { recordedAt: 'desc' },
      select: { latitude: true, longitude: true, recordedAt: true },
    });
    latestGps = row as typeof latestGps;
  } catch (err: unknown) {
    console.warn('[liveEta] GPS lookup failed:', (err as Error).message);
    return null;
  }
  if (!latestGps) return null;

  const gpsAgeMs = Date.now() - new Date(latestGps.recordedAt).getTime();
  if (gpsAgeMs > STALE_GPS_MS) {
    // Driver hasn't pinged in a long time — don't speculate a live ETA.
    // Customer portal falls back to staticEta with no loss of information.
    return null;
  }

  const distanceKm = haversineKm(
    latestGps.latitude,
    latestGps.longitude,
    deliveryLat,
    deliveryLng,
  );
  // Drive time with a sensible floor so "driver at the door" still renders
  // a future timestamp — otherwise the window straddles now and reads badly.
  const driveMin = Math.max(MIN_DRIVE_MIN, (distanceKm / AVG_SPEED_KMH) * 60);
  const etaMs = Date.now() + driveMin * 60 * 1000;

  const result: LiveEtaResult = {
    eta: new Date(etaMs).toISOString(),
    driverUpdatedAt: new Date(latestGps.recordedAt).toISOString(),
    distanceKm: Math.round(distanceKm * 10) / 10,
    source: 'haversine',
    freshness: gpsAgeMs <= FRESH_GPS_MS ? 'fresh' : 'stale',
  };

  cache.set(deliveryId, { computedAt: Date.now(), result });
  return result;
}

/** Testing hook — clears the in-memory cache between tests. */
export function __resetLiveEtaCacheForTests(): void {
  cache.clear();
}
