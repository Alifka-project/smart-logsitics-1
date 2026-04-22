import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Prisma + driving-route mocks ────────────────────────────────────────────
// plannedEtaService imports prisma via `require('../db/prisma').default` and
// the driving route helper as a named export. We mock both so the tests run
// without any DB or OSRM dependency.

// vi.hoisted() — the factory runs BEFORE any vi.mock hoisting, so the mocks
// exist when the vi.mock factories execute.
const { prismaMock, fetchMock } = vi.hoisted(() => ({
  prismaMock: {
    deliveryAssignment: { findMany: vi.fn() },
  },
  fetchMock: vi.fn(),
}));

vi.mock('../db/prisma.js', () => ({ default: prismaMock }));
vi.mock('../db/prisma', () => ({ default: prismaMock }));

vi.mock('./drivingRouteService.js', () => ({
  fetchDrivingRouteBetweenPoints: (...args: unknown[]) => fetchMock(...args),
}));
vi.mock('./drivingRouteService', () => ({
  fetchDrivingRouteBetweenPoints: (...args: unknown[]) => fetchMock(...args),
}));

import { computePlannedSlotWindow, __testing__ } from './plannedEtaService';

const { SERVICE_TIME_MIN, WINDOW_HALF_MIN, DEPARTURE_HOUR_DUBAI, FALLBACK_LEG_MIN, dubaiDepartureUtc, pickAnchorDateIso } = __testing__;

function anchorDate(dayOffsetFromToday = 0): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + dayOffsetFromToday);
  return d;
}

function leg(minutes: number): { durationS: number; distanceM: number; coordinates: [number, number][] } {
  return { durationS: minutes * 60, distanceM: minutes * 1000, coordinates: [] };
}

describe('plannedEtaService pure helpers', () => {
  it('dubaiDepartureUtc returns 04:00 UTC (08:00 Dubai) on the anchor day', () => {
    const anchor = new Date(Date.UTC(2026, 5, 10, 15, 30)); // arbitrary time-of-day
    const dep = dubaiDepartureUtc(anchor.toISOString());
    expect(dep.getUTCFullYear()).toBe(2026);
    expect(dep.getUTCMonth()).toBe(5);
    expect(dep.getUTCDate()).toBe(10);
    expect(dep.getUTCHours()).toBe(DEPARTURE_HOUR_DUBAI - 4);
    expect(dep.getUTCMinutes()).toBe(0);
  });

  it('pickAnchorDateIso prefers goodsMovementDate, falls back to confirmedDeliveryDate, then today', () => {
    const gmd = '2026-07-01T00:00:00.000Z';
    const cdd = '2026-08-01T00:00:00.000Z';
    expect(pickAnchorDateIso({ goodsMovementDate: gmd, confirmedDeliveryDate: cdd })).toBe(new Date(gmd).toISOString());
    expect(pickAnchorDateIso({ confirmedDeliveryDate: cdd })).toBe(new Date(cdd).toISOString());
    const anyToday = pickAnchorDateIso({});
    expect(Number.isNaN(new Date(anyToday).getTime())).toBe(false);
  });
});

describe('computePlannedSlotWindow', () => {
  beforeEach(() => {
    prismaMock.deliveryAssignment.findMany.mockReset();
    fetchMock.mockReset();
    __testing__.clearCache();
  });

  it('falls back to the degraded 08:00–18:00 window when no driver is assigned', async () => {
    const anchor = anchorDate(1);
    const window = await computePlannedSlotWindow({
      delivery: { id: 'd1', goodsMovementDate: anchor.toISOString() },
      driverId: null,
    });
    expect(window.mode).toBe('planned');
    expect(window.degraded).toBe(true);
    const start = new Date(window.earliest).getTime();
    const end = new Date(window.latest).getTime();
    expect((end - start) / 3_600_000).toBeCloseTo(10, 5);
  });

  it('uses a 0-minute first leg and cumulative legs + service time for downstream stops', async () => {
    const anchor = anchorDate(1);
    prismaMock.deliveryAssignment.findMany.mockResolvedValue([
      { createdAt: new Date('2026-01-01T06:00:00Z'), delivery: { id: 's1', lat: 25.1, lng: 55.1, metadata: null, createdAt: new Date('2026-01-01T06:00:00Z') } },
      { createdAt: new Date('2026-01-01T06:05:00Z'), delivery: { id: 's2', lat: 25.2, lng: 55.2, metadata: null, createdAt: new Date('2026-01-01T06:05:00Z') } },
      { createdAt: new Date('2026-01-01T06:10:00Z'), delivery: { id: 's3', lat: 25.3, lng: 55.3, metadata: null, createdAt: new Date('2026-01-01T06:10:00Z') } },
    ]);
    // leg s1→s2 = 30 min, leg s2→s3 = 45 min
    fetchMock
      .mockResolvedValueOnce(leg(30))
      .mockResolvedValueOnce(leg(45));

    const stop1 = await computePlannedSlotWindow({
      delivery: { id: 's1', goodsMovementDate: anchor.toISOString() },
      driverId: 'driver-A',
    });
    const stop2 = await computePlannedSlotWindow({
      delivery: { id: 's2', goodsMovementDate: anchor.toISOString() },
      driverId: 'driver-A',
    });
    const stop3 = await computePlannedSlotWindow({
      delivery: { id: 's3', goodsMovementDate: anchor.toISOString() },
      driverId: 'driver-A',
    });

    const departureMs = dubaiDepartureUtc(anchor.toISOString()).getTime();

    if (stop1.mode !== 'planned' || stop2.mode !== 'planned' || stop3.mode !== 'planned') {
      throw new Error('expected planned windows');
    }

    // Stop 1: 0 leg, 0 preceding service → center = departure, ±60 min
    expect(new Date(stop1.center).getTime()).toBe(departureMs);
    expect(new Date(stop1.latest).getTime() - new Date(stop1.earliest).getTime()).toBe(2 * WINDOW_HALF_MIN * 60_000);

    // Stop 2: leg s1→s2 = 30 min + 1 × 20 min service (from stop 1) = 50 min
    expect(new Date(stop2.center).getTime()).toBe(departureMs + (30 + SERVICE_TIME_MIN) * 60_000);

    // Stop 3: leg s1→s2 (30) + service + leg s2→s3 (45) + service = 115 min
    expect(new Date(stop3.center).getTime()).toBe(
      departureMs + (30 + SERVICE_TIME_MIN + 45 + SERVICE_TIME_MIN) * 60_000,
    );
  });

  it('uses FALLBACK_LEG_MIN when OSRM throws', async () => {
    const anchor = anchorDate(1);
    prismaMock.deliveryAssignment.findMany.mockResolvedValue([
      { createdAt: new Date('2026-01-01T06:00:00Z'), delivery: { id: 'a', lat: 25.1, lng: 55.1, metadata: null, createdAt: new Date('2026-01-01T06:00:00Z') } },
      { createdAt: new Date('2026-01-01T06:05:00Z'), delivery: { id: 'b', lat: 25.2, lng: 55.2, metadata: null, createdAt: new Date('2026-01-01T06:05:00Z') } },
    ]);
    fetchMock.mockRejectedValueOnce(new Error('osrm unavailable'));

    const stop = await computePlannedSlotWindow({
      delivery: { id: 'b', goodsMovementDate: anchor.toISOString() },
      driverId: 'driver-B',
    });
    if (stop.mode !== 'planned') throw new Error('expected planned');

    const departureMs = dubaiDepartureUtc(anchor.toISOString()).getTime();
    expect(new Date(stop.center).getTime()).toBe(
      departureMs + (FALLBACK_LEG_MIN + SERVICE_TIME_MIN) * 60_000,
    );
  });

  it('floats priority stops to the front of the sequence', async () => {
    const anchor = anchorDate(1);
    prismaMock.deliveryAssignment.findMany.mockResolvedValue([
      // Chronological order: x, y; but y has isPriority → should be first.
      { createdAt: new Date('2026-01-01T06:00:00Z'), delivery: { id: 'x', lat: 25.1, lng: 55.1, metadata: null, createdAt: new Date('2026-01-01T06:00:00Z') } },
      { createdAt: new Date('2026-01-01T06:05:00Z'), delivery: { id: 'y', lat: 25.2, lng: 55.2, metadata: { isPriority: true }, createdAt: new Date('2026-01-01T06:05:00Z') } },
    ]);
    fetchMock.mockResolvedValue(leg(10));

    const yWindow = await computePlannedSlotWindow({
      delivery: { id: 'y', goodsMovementDate: anchor.toISOString() },
      driverId: 'driver-C',
    });
    if (yWindow.mode !== 'planned') throw new Error('expected planned');

    const departureMs = dubaiDepartureUtc(anchor.toISOString()).getTime();
    // y is now stop 0 → center = departure
    expect(new Date(yWindow.center).getTime()).toBe(departureMs);
  });

  it('degrades when the target delivery is not in the driver\'s sequence', async () => {
    const anchor = anchorDate(1);
    prismaMock.deliveryAssignment.findMany.mockResolvedValue([
      { createdAt: new Date('2026-01-01T06:00:00Z'), delivery: { id: 'x', lat: 25.1, lng: 55.1, metadata: null, createdAt: new Date('2026-01-01T06:00:00Z') } },
    ]);
    const w = await computePlannedSlotWindow({
      delivery: { id: 'unknown-stop', goodsMovementDate: anchor.toISOString() },
      driverId: 'driver-D',
    });
    expect(w.mode).toBe('planned');
    expect(w.degraded).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Scenario tests: real-world what-ifs the operations team cares about.
// Each test mirrors a specific day-in-the-life situation driven by the new
// pgi-done → pickup-confirmed → out-for-delivery workflow.
// ──────────────────────────────────────────────────────────────────────────
describe('plannedEtaService — real-world scenarios', () => {
  beforeEach(() => {
    prismaMock.deliveryAssignment.findMany.mockReset();
    fetchMock.mockReset();
    __testing__.clearCache();
  });

  // Scenario 1: Driver picks items at 22:00 but the truck doesn't leave until
  // tomorrow morning. Customer opens the tracking link the next morning.
  // → anchor must be goodsMovementDate (the scheduled day), NOT "right now".
  it('Scenario 1 — late-night picking: customer ETA anchors to GMD 08:00, not wall-clock', async () => {
    const gmdTomorrow = anchorDate(1);
    prismaMock.deliveryAssignment.findMany.mockResolvedValue([
      { createdAt: new Date('2026-01-01T20:00:00Z'), delivery: { id: 'late-a', lat: 25.1, lng: 55.1, metadata: null, createdAt: new Date('2026-01-01T20:00:00Z') } },
    ]);
    const w = await computePlannedSlotWindow({
      delivery: { id: 'late-a', goodsMovementDate: gmdTomorrow.toISOString() },
      driverId: 'driver-scn1',
    });
    if (w.mode !== 'planned') throw new Error('expected planned');
    expect(w.degraded).toBe(false);
    // Center should be 04:00 UTC of the GMD day (08:00 Dubai), independent of now().
    const expected = dubaiDepartureUtc(gmdTomorrow.toISOString()).getTime();
    expect(new Date(w.center).getTime()).toBe(expected);
  });

  // Scenario 2: Urgent order lands at 10:00 AM when route already has 2 stops.
  // The priority flag must push the urgent order to the head of the sequence,
  // so its planned center = 08:00 (stop index 0), and the two existing stops
  // shift down by (leg + service) each.
  it('Scenario 2 — morning urgent injection: priority floats to head, others push down', async () => {
    const anchor = anchorDate(0);
    prismaMock.deliveryAssignment.findMany.mockResolvedValue([
      // Existing route: p1, p2 (chronological).
      { createdAt: new Date('2026-01-01T05:00:00Z'), delivery: { id: 'p1', lat: 25.1, lng: 55.1, metadata: null, createdAt: new Date('2026-01-01T05:00:00Z') } },
      { createdAt: new Date('2026-01-01T05:10:00Z'), delivery: { id: 'p2', lat: 25.2, lng: 55.2, metadata: null, createdAt: new Date('2026-01-01T05:10:00Z') } },
      // Urgent dropped in at 10:00 — late createdAt, but priority.
      { createdAt: new Date('2026-01-01T10:00:00Z'), delivery: { id: 'urg', lat: 25.3, lng: 55.3, metadata: { isPriority: true }, createdAt: new Date('2026-01-01T10:00:00Z') } },
    ]);
    // Sequence becomes: urg (0), p1 (1), p2 (2). We serialize the three
    // lookups so the first call populates the route-matrix cache and the
    // next two hit that cache instead of racing `fetchMock` with Promise.all.
    fetchMock
      .mockResolvedValueOnce(leg(25)) // urg → p1
      .mockResolvedValueOnce(leg(35)); // p1 → p2

    const urgW = await computePlannedSlotWindow({ delivery: { id: 'urg', goodsMovementDate: anchor.toISOString() }, driverId: 'driver-scn2' });
    const p1W  = await computePlannedSlotWindow({ delivery: { id: 'p1',  goodsMovementDate: anchor.toISOString() }, driverId: 'driver-scn2' });
    const p2W  = await computePlannedSlotWindow({ delivery: { id: 'p2',  goodsMovementDate: anchor.toISOString() }, driverId: 'driver-scn2' });
    if (urgW.mode !== 'planned' || p1W.mode !== 'planned' || p2W.mode !== 'planned') throw new Error('expected planned');
    const dep = dubaiDepartureUtc(anchor.toISOString()).getTime();
    expect(new Date(urgW.center).getTime()).toBe(dep);
    expect(new Date(p1W.center).getTime()).toBe(dep + (25 + SERVICE_TIME_MIN) * 60_000);
    expect(new Date(p2W.center).getTime()).toBe(dep + (25 + SERVICE_TIME_MIN + 35 + SERVICE_TIME_MIN) * 60_000);
  });

  // Scenario 3: Customer polls the tracking endpoint every 30s. For the same
  // (driverId, day, target) the second call MUST hit the cache and not re-run
  // the DB findMany. Otherwise 120 polls/hour × N customers = DB hammer.
  it('Scenario 3 — 30s polling: cache short-circuits Prisma call on second poll', async () => {
    const anchor = anchorDate(0);
    prismaMock.deliveryAssignment.findMany.mockResolvedValue([
      { createdAt: new Date('2026-01-01T06:00:00Z'), delivery: { id: 'cache-a', lat: 25.1, lng: 55.1, metadata: null, createdAt: new Date('2026-01-01T06:00:00Z') } },
      { createdAt: new Date('2026-01-01T06:05:00Z'), delivery: { id: 'cache-b', lat: 25.2, lng: 55.2, metadata: null, createdAt: new Date('2026-01-01T06:05:00Z') } },
    ]);
    fetchMock.mockResolvedValue(leg(15));

    const first = await computePlannedSlotWindow({ delivery: { id: 'cache-b', goodsMovementDate: anchor.toISOString() }, driverId: 'driver-cache' });
    const second = await computePlannedSlotWindow({ delivery: { id: 'cache-b', goodsMovementDate: anchor.toISOString() }, driverId: 'driver-cache' });
    const third = await computePlannedSlotWindow({ delivery: { id: 'cache-b', goodsMovementDate: anchor.toISOString() }, driverId: 'driver-cache' });

    // Exactly one Prisma query, exactly one OSRM call across 3 polls.
    expect(prismaMock.deliveryAssignment.findMany).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // And the window is identical across polls (no jitter).
    if (first.mode !== 'planned' || second.mode !== 'planned' || third.mode !== 'planned') throw new Error('expected planned');
    expect(first.center).toBe(second.center);
    expect(second.center).toBe(third.center);
  });

  // Scenario 4: Two drivers working the same day must NOT share cached state —
  // otherwise driver B's first poll would see driver A's sequence.
  it('Scenario 4 — two drivers same day: cache keys isolated', async () => {
    const anchor = anchorDate(0);
    prismaMock.deliveryAssignment.findMany
      .mockResolvedValueOnce([
        { createdAt: new Date('2026-01-01T06:00:00Z'), delivery: { id: 'drA-1', lat: 25.1, lng: 55.1, metadata: null, createdAt: new Date('2026-01-01T06:00:00Z') } },
      ])
      .mockResolvedValueOnce([
        { createdAt: new Date('2026-01-01T06:00:00Z'), delivery: { id: 'drB-1', lat: 25.2, lng: 55.2, metadata: null, createdAt: new Date('2026-01-01T06:00:00Z') } },
      ]);
    const wA = await computePlannedSlotWindow({ delivery: { id: 'drA-1', goodsMovementDate: anchor.toISOString() }, driverId: 'driver-A' });
    const wB = await computePlannedSlotWindow({ delivery: { id: 'drB-1', goodsMovementDate: anchor.toISOString() }, driverId: 'driver-B' });
    expect(prismaMock.deliveryAssignment.findMany).toHaveBeenCalledTimes(2);
    expect(wA.mode).toBe('planned');
    expect(wB.mode).toBe('planned');
  });

  // Scenario 5: goodsMovementDate is blank but confirmedDeliveryDate is set.
  // The customer should still see a reasonable planned window anchored to CDD.
  it('Scenario 5 — GMD missing, CDD set: planned window anchors to CDD 08:00', async () => {
    const cdd = anchorDate(2);
    prismaMock.deliveryAssignment.findMany.mockResolvedValue([
      { createdAt: new Date('2026-01-01T06:00:00Z'), delivery: { id: 'cdd-only', lat: 25.1, lng: 55.1, metadata: null, createdAt: new Date('2026-01-01T06:00:00Z') } },
    ]);
    const w = await computePlannedSlotWindow({
      delivery: { id: 'cdd-only', goodsMovementDate: null, confirmedDeliveryDate: cdd.toISOString() },
      driverId: 'driver-scn5',
    });
    if (w.mode !== 'planned') throw new Error('expected planned');
    const expected = dubaiDepartureUtc(cdd.toISOString()).getTime();
    expect(new Date(w.center).getTime()).toBe(expected);
  });

  // Scenario 6: An OSRM leg comes back absurdly short (e.g. 60 seconds) — the
  // service clamps a minimum of 5 minutes so tight urban stops don't collapse
  // into zero-time hops and shave the downstream window unrealistically.
  it('Scenario 6 — ultra-short OSRM leg: clamped to 5-min minimum', async () => {
    const anchor = anchorDate(0);
    prismaMock.deliveryAssignment.findMany.mockResolvedValue([
      { createdAt: new Date('2026-01-01T06:00:00Z'), delivery: { id: 'near-a', lat: 25.1, lng: 55.1, metadata: null, createdAt: new Date('2026-01-01T06:00:00Z') } },
      { createdAt: new Date('2026-01-01T06:05:00Z'), delivery: { id: 'near-b', lat: 25.1001, lng: 55.1001, metadata: null, createdAt: new Date('2026-01-01T06:05:00Z') } },
    ]);
    fetchMock.mockResolvedValueOnce({ durationS: 30, distanceM: 80, coordinates: [] }); // 0.5 min raw
    const w = await computePlannedSlotWindow({ delivery: { id: 'near-b', goodsMovementDate: anchor.toISOString() }, driverId: 'driver-scn6' });
    if (w.mode !== 'planned') throw new Error('expected planned');
    const dep = dubaiDepartureUtc(anchor.toISOString()).getTime();
    // 5-min clamp + 20-min service from prev stop.
    expect(new Date(w.center).getTime()).toBe(dep + (5 + SERVICE_TIME_MIN) * 60_000);
  });

  // Scenario 7: A stop is missing lat/lng (bad geocoding upstream). Service
  // should silently fall back to FALLBACK_LEG_MIN for that leg instead of
  // crashing the tracking endpoint.
  it('Scenario 7 — missing lat/lng: leg uses FALLBACK_LEG_MIN without invoking OSRM', async () => {
    const anchor = anchorDate(0);
    prismaMock.deliveryAssignment.findMany.mockResolvedValue([
      { createdAt: new Date('2026-01-01T06:00:00Z'), delivery: { id: 'g-a', lat: 25.1, lng: 55.1, metadata: null, createdAt: new Date('2026-01-01T06:00:00Z') } },
      { createdAt: new Date('2026-01-01T06:05:00Z'), delivery: { id: 'g-b', lat: null, lng: null, metadata: null, createdAt: new Date('2026-01-01T06:05:00Z') } },
    ]);
    const w = await computePlannedSlotWindow({ delivery: { id: 'g-b', goodsMovementDate: anchor.toISOString() }, driverId: 'driver-scn7' });
    if (w.mode !== 'planned') throw new Error('expected planned');
    expect(fetchMock).not.toHaveBeenCalled();
    const dep = dubaiDepartureUtc(anchor.toISOString()).getTime();
    expect(new Date(w.center).getTime()).toBe(dep + (FALLBACK_LEG_MIN + SERVICE_TIME_MIN) * 60_000);
  });

  // Scenario 8: 10-stop route performance sanity — window math scales and
  // completes quickly even at the upper end of a single-driver truck day.
  it('Scenario 8 — 10-stop long route: cumulative center computed correctly', async () => {
    const anchor = anchorDate(0);
    const stops = Array.from({ length: 10 }, (_, i) => ({
      createdAt: new Date(`2026-01-01T06:${String(i).padStart(2, '0')}:00Z`),
      delivery: {
        id: `long-${i}`,
        lat: 25 + i * 0.01,
        lng: 55 + i * 0.01,
        metadata: null,
        createdAt: new Date(`2026-01-01T06:${String(i).padStart(2, '0')}:00Z`),
      },
    }));
    prismaMock.deliveryAssignment.findMany.mockResolvedValue(stops);
    // Every leg between stops is 15 min.
    fetchMock.mockResolvedValue(leg(15));

    const t0 = Date.now();
    const last = await computePlannedSlotWindow({ delivery: { id: 'long-9', goodsMovementDate: anchor.toISOString() }, driverId: 'driver-long' });
    const elapsed = Date.now() - t0;
    if (last.mode !== 'planned') throw new Error('expected planned');
    const dep = dubaiDepartureUtc(anchor.toISOString()).getTime();
    // index 9: 9 legs × 15 + 9 preceding services × 20 = 135 + 180 = 315 min.
    expect(new Date(last.center).getTime()).toBe(dep + 315 * 60_000);
    // Cold-path compute should be well under 200ms even with 9 mocked OSRM calls.
    expect(elapsed).toBeLessThan(500);
  });

  // Scenario 9: After picking confirm, the status is pickup-confirmed. The
  // planned window still applies (pre-route phase) — so computePlannedSlotWindow
  // behaves identically regardless of whether the stop is pgi-done or
  // pickup-confirmed (the service doesn't read status; the customerPortal
  // switch does).
  it('Scenario 9 — pickup-confirmed phase: same planned window as pgi-done', async () => {
    const anchor = anchorDate(0);
    prismaMock.deliveryAssignment.findMany.mockResolvedValue([
      { createdAt: new Date('2026-01-01T06:00:00Z'), delivery: { id: 'pk-a', lat: 25.1, lng: 55.1, metadata: null, createdAt: new Date('2026-01-01T06:00:00Z') } },
    ]);
    const w = await computePlannedSlotWindow({
      delivery: { id: 'pk-a', goodsMovementDate: anchor.toISOString(), status: 'pickup-confirmed' },
      driverId: 'driver-scn9',
    });
    if (w.mode !== 'planned') throw new Error('expected planned');
    const dep = dubaiDepartureUtc(anchor.toISOString()).getTime();
    expect(new Date(w.center).getTime()).toBe(dep);
  });

  // Scenario 10: Anchor date window boundary — a GMD at 23:59 Dubai (19:59 UTC)
  // must still anchor to 08:00 Dubai of that same calendar day, not the next.
  it('Scenario 10 — late-evening GMD timestamp: anchor still 08:00 Dubai same day', async () => {
    // 2026-06-10 23:59 Dubai = 2026-06-10 19:59 UTC.
    const nearMidnight = new Date(Date.UTC(2026, 5, 10, 19, 59));
    prismaMock.deliveryAssignment.findMany.mockResolvedValue([
      { createdAt: nearMidnight, delivery: { id: 'mn-a', lat: 25.1, lng: 55.1, metadata: null, createdAt: nearMidnight } },
    ]);
    const w = await computePlannedSlotWindow({
      delivery: { id: 'mn-a', goodsMovementDate: nearMidnight.toISOString() },
      driverId: 'driver-scn10',
    });
    if (w.mode !== 'planned') throw new Error('expected planned');
    // Expect 2026-06-10 04:00 UTC = 08:00 Dubai same calendar day.
    expect(new Date(w.center).toISOString()).toBe('2026-06-10T04:00:00.000Z');
  });

  // Scenario 11: Planned window width is always exactly 120 minutes (±60)
  // regardless of driving time — the "soft promise" to the customer.
  it('Scenario 11 — window width invariant: always 120 min even on long routes', async () => {
    const anchor = anchorDate(0);
    prismaMock.deliveryAssignment.findMany.mockResolvedValue([
      { createdAt: new Date('2026-01-01T06:00:00Z'), delivery: { id: 'w-a', lat: 25.1, lng: 55.1, metadata: null, createdAt: new Date('2026-01-01T06:00:00Z') } },
      { createdAt: new Date('2026-01-01T06:05:00Z'), delivery: { id: 'w-b', lat: 25.9, lng: 55.9, metadata: null, createdAt: new Date('2026-01-01T06:05:00Z') } },
    ]);
    fetchMock.mockResolvedValueOnce(leg(90)); // 90-min leg
    const w = await computePlannedSlotWindow({ delivery: { id: 'w-b', goodsMovementDate: anchor.toISOString() }, driverId: 'driver-scn11' });
    if (w.mode !== 'planned') throw new Error('expected planned');
    const width = (new Date(w.latest).getTime() - new Date(w.earliest).getTime()) / 60_000;
    expect(width).toBe(2 * WINDOW_HALF_MIN);
  });

  // Scenario 12: No driver + no dates at all (pathological). Must still return
  // a valid planned window rather than throwing or returning undefined — the
  // customer tracking page always needs SOMETHING to render.
  it('Scenario 12 — pathological: no driver, no dates → degraded flat window (never throws)', async () => {
    const w = await computePlannedSlotWindow({ delivery: { id: 'x' } as Record<string, unknown>, driverId: null });
    expect(w.mode).toBe('planned');
    expect(w.degraded).toBe(true);
    // And the window is still 10h wide.
    const hours = (new Date(w.latest).getTime() - new Date(w.earliest).getTime()) / 3_600_000;
    expect(hours).toBeCloseTo(10, 5);
  });
});
