/**
 * ETD = Estimated Time of Departure (when the truck leaves the warehouse).
 *
 * Formula
 * ───────
 *   ETD = max( deliveryDate @ 08:00 Dubai , metadata.picking.confirmedAt )
 *
 * Cases this resolves
 *   1. Pickup confirmed yesterday, delivery today → today 08:00 (truck waits for the morning).
 *   2. Pickup confirmed today before 08:00, delivery today → today 08:00 (still waits).
 *   3. Urgent: pickup confirmed today after 08:00, delivery today → pickup time itself
 *      (truck rolls immediately; auto-promote at the picking-confirm endpoint also stamps
 *      `metadata.routeStartedAt` to the same moment, so this matches the server's reality).
 *
 * The chip is only meaningful AFTER the driver has confirmed picking — pre-pickup statuses
 * have no departure time, only a planned date. `shouldShowEtd` enforces this so callers
 * can render `{shouldShowEtd(d) && <Chip>{formatEtdLabel(computeETD(d)!)}</Chip>}` directly.
 */

import type { Delivery } from '../types';

const DUBAI_TZ = 'Asia/Dubai';
/** UAE has no DST. */
const DUBAI_OFFSET_H = 4;
const DEPARTURE_HOUR_DUBAI = 8;

/** Statuses where the truck has been loaded — ETD is meaningful only here onward. */
const POST_PICKUP_STATUSES = new Set<string>([
  'pickup-confirmed',
  'pickup_confirmed',
  'out-for-delivery',
  'out_for_delivery',
  'in-transit',
  'in_transit',
  'in-progress',
  'in_progress',
  'delivered',
  'delivered-with-installation',
  'delivered-without-installation',
  'completed',
  'pod-completed',
  'finished',
]);

/** True when the delivery's status is at or past pickup-confirmed. */
function isPostPickup(status: string | null | undefined): boolean {
  if (!status) return false;
  return POST_PICKUP_STATUSES.has(String(status).toLowerCase());
}

/**
 * Returns the UTC instant for 08:00 Dubai on the calendar day represented by `raw`.
 * Reads Y/M/D in Dubai TZ to avoid the off-by-one when a date stored as
 * 2026-04-29T20:00:00Z (= 30 Apr Dubai) gets interpreted as 29 Apr UTC.
 */
function dubaiAt8AM(raw: Date | string | number): Date | null {
  const d = raw instanceof Date ? raw : new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: DUBAI_TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d).split('-');
  const y = Number(parts[0]);
  const m = Number(parts[1]) - 1;
  const day = Number(parts[2]);
  // 08:00 Dubai = (08 - 4) UTC = 04:00 UTC. UAE has no DST so this is always exact.
  return new Date(Date.UTC(y, m, day, DEPARTURE_HOUR_DUBAI - DUBAI_OFFSET_H, 0, 0, 0));
}

interface DeliveryShape {
  status?: string | null;
  confirmedDeliveryDate?: string | Date | null;
  goodsMovementDate?: string | Date | null;
  metadata?: {
    picking?: { confirmedAt?: string } | null;
    goodsMovementDate?: string | Date | null;
  } | Record<string, unknown> | null;
}

/** Reads `metadata.picking.confirmedAt` (ISO string). Returns null when absent. */
function getPickupConfirmedAt(d: DeliveryShape): Date | null {
  const meta = d.metadata as Record<string, unknown> | null | undefined;
  const picking = meta?.picking as { confirmedAt?: string } | null | undefined;
  const raw = picking?.confirmedAt;
  if (!raw || typeof raw !== 'string') return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Returns the canonical delivery date — confirmed wins over GMD (matches server logic). */
function pickDeliveryDate(d: DeliveryShape): Date | null {
  const cdd = d.confirmedDeliveryDate;
  if (cdd) {
    const dt = cdd instanceof Date ? cdd : new Date(String(cdd));
    if (!Number.isNaN(dt.getTime())) return dt;
  }
  const gmd = d.goodsMovementDate ?? (d.metadata as Record<string, unknown> | null | undefined)?.goodsMovementDate;
  if (gmd) {
    const dt = gmd instanceof Date ? gmd : new Date(String(gmd));
    if (!Number.isNaN(dt.getTime())) return dt;
  }
  return null;
}

/**
 * Compute ETD per the formula above. Returns null when:
 *   - status is pre-pickup (no `picking.confirmedAt` yet), OR
 *   - the delivery has neither a confirmed delivery date nor a goods-movement date,
 *     AND no picking timestamp to fall back on.
 */
export function computeETD(d: Delivery | DeliveryShape): Date | null {
  if (!isPostPickup(d.status)) return null;

  const pickupAt = getPickupConfirmedAt(d);
  if (!pickupAt) return null;

  const deliveryDate = pickDeliveryDate(d);
  if (!deliveryDate) return pickupAt;

  const dispatchAnchor = dubaiAt8AM(deliveryDate);
  if (!dispatchAnchor) return pickupAt;

  return dispatchAnchor.getTime() >= pickupAt.getTime() ? dispatchAnchor : pickupAt;
}

/** Convenience guard for callers — `{shouldShowEtd(d) && <Chip…>}`. */
export function shouldShowEtd(d: Delivery | DeliveryShape): boolean {
  return computeETD(d) != null;
}

/**
 * Format an ETD instant for display.
 *   - When the ETD falls on Dubai-today: `"ETD 11:00"`.
 *   - Otherwise (future or past day): `"ETD 30 Apr · 08:00"` so a driver can't
 *     confuse a tomorrow-dispatch for today.
 */
export function formatEtdLabel(etd: Date | string): string {
  const dt = etd instanceof Date ? etd : new Date(etd);
  if (Number.isNaN(dt.getTime())) return 'ETD —';

  const dubaiYMD = (v: Date): string =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: DUBAI_TZ,
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(v);

  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: DUBAI_TZ,
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(dt);

  const todayYMD = dubaiYMD(new Date());
  if (dubaiYMD(dt) === todayYMD) return `ETD ${time}`;

  const dateLabel = new Intl.DateTimeFormat('en-GB', {
    timeZone: DUBAI_TZ,
    day: '2-digit', month: 'short',
  }).format(dt);
  return `ETD ${dateLabel} · ${time}`;
}

/** Exposed for tests. */
export const __testing__ = {
  isPostPickup,
  dubaiAt8AM,
  getPickupConfirmedAt,
  pickDeliveryDate,
  DEPARTURE_HOUR_DUBAI,
};
