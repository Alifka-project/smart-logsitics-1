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
