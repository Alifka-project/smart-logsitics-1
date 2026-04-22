/**
 * Picking List eligibility — shared between the driver's Picking tab, the
 * Start-Delivery readiness gate, and the server picking endpoints.
 *
 * An order belongs on the driver's picking list when:
 *   1. Warehouse has issued goods  →  goodsMovementDate is set, AND
 *   2. Picking hasn't been signed off yet  →  metadata.picking.confirmedAt is absent, AND
 *   3. Status is still pre-dispatch  →  pgi-done, pgi_done, or rescheduled.
 *      (rescheduled is included because a reschedule after PGI keeps the GMD;
 *      those orders still need to be re-picked for the new delivery date.)
 *
 * Orders without GMD (no PGI yet) or already pickup-confirmed / out-for-delivery
 * are intentionally excluded.
 */

interface MinimalDeliveryForPicking {
  status?: string | null;
  goodsMovementDate?: unknown;
  metadata?: unknown;
}

const PICKING_ELIGIBLE_STATUSES = new Set([
  'pgi-done',
  'pgi_done',
  'rescheduled',
]);

function readPickingConfirmedAt(meta: unknown): string | null {
  if (!meta || typeof meta !== 'object') return null;
  const picking = (meta as Record<string, unknown>).picking;
  if (!picking || typeof picking !== 'object') return null;
  const confirmedAt = (picking as Record<string, unknown>).confirmedAt;
  return typeof confirmedAt === 'string' && confirmedAt.length > 0 ? confirmedAt : null;
}

export function isPickingListEligible(d: MinimalDeliveryForPicking): boolean {
  const status = String(d.status || '').toLowerCase();
  if (!PICKING_ELIGIBLE_STATUSES.has(status)) return false;
  if (!d.goodsMovementDate) return false;
  if (readPickingConfirmedAt(d.metadata)) return false;
  return true;
}

/**
 * Orders where picking hasn't been confirmed yet — used to gate the
 * "Start Delivery" button. These are still "unready" on the driver's
 * plate (as opposed to pickup-confirmed which are ready).
 */
export function isPickingUnready(d: MinimalDeliveryForPicking): boolean {
  return isPickingListEligible(d);
}

/**
 * Statuses that belong on the driver's My Orders / Delivery Sequence table.
 * Per product spec the driver only sees orders whose pickup has already been
 * confirmed — pre-PGI rows (pending / scheduled / confirmed) and picking-stage
 * rows (pgi-done / pgi_done / rescheduled-awaiting-pick) are filtered out and
 * either live on the Picking List tab or are invisible to the driver entirely.
 *
 * Terminal rows (delivered, cancelled, returned, rejected) stay visible so the
 * driver can review recent history.
 */
const DRIVER_MY_ORDERS_STATUSES = new Set([
  // Ready to depart (picking signed off)
  'pickup-confirmed',
  'pickup_confirmed',
  // On the road
  'out-for-delivery',
  'out_for_delivery',
  'in-transit',
  'in_progress',
  'in-progress',
  'order-delay',
  'order_delay',
  // Terminal (history tail)
  'delivered',
  'delivered-with-installation',
  'delivered-without-installation',
  'completed',
  'pod-completed',
  'finished',
  'cancelled',
  'rejected',
  'returned',
]);

export function isDriverMyOrdersStatus(status: string | null | undefined): boolean {
  return DRIVER_MY_ORDERS_STATUSES.has(String(status || '').toLowerCase());
}
