import type { Delivery } from '../types';

export type DeliveryListFilter = 'all' | 'pending' | 'confirmed' | 'p1' | 'out_for_delivery' | 'delivered' | 'on_time' | 'delayed';

/** Delay threshold: if estimatedEta is more than this many ms after plannedEta → Delayed (D3: 1-hour rule) */
const DELAY_THRESHOLD_MS = 60 * 60 * 1000; // 60 minutes (1 hour)

export function getEtaStatus(d: Delivery): 'on_time' | 'delayed' | 'unknown' {
  const planned = (d as Record<string, unknown>)['plannedEta'] as string | null | undefined;
  const estimated = (d as Record<string, unknown>)['estimatedEta'] as string | null | undefined
    ?? (d.estimatedTime instanceof Date ? d.estimatedTime.toISOString()
        : typeof d.estimatedTime === 'string' ? d.estimatedTime : null);
  if (!planned || !estimated) return 'unknown';
  const diff = new Date(estimated).getTime() - new Date(planned).getTime();
  return diff > DELAY_THRESHOLD_MS ? 'delayed' : 'on_time';
}

/** Placeholder customer from failed Excel mapping (`Customer 1`, `Customer3`, …). */
const PLACEHOLDER_CUSTOMER = /^customer\s*\d+$/i;

function normalizeSpaces(s: string): string {
  return s.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

/** True if any cell in the uploaded row is literally "removed" (bad column map). */
function originalRowContainsRemovedToken(metadata: unknown): boolean {
  const meta = metadata as Record<string, unknown> | null | undefined;
  const row = (meta?.originalRow ?? meta?._originalRow) as Record<string, unknown> | undefined;
  if (!row || typeof row !== 'object') return false;
  for (const v of Object.values(row)) {
    if (v != null && normalizeSpaces(String(v)).toLowerCase() === 'removed') return true;
  }
  return false;
}

const ORIGINAL_ROW_PO_KEYS = [
  'PO Number',
  'PO_NUMBER',
  'PONumber',
  'Cust. PO Number',
  'Cust PO Number',
  'poNumber',
  'po_number',
  'Purchase order',
  'Purchase Order',
];

function normalizedPoParts(d: { poNumber?: string | null; PONumber?: string | null; metadata?: unknown }): string[] {
  const parts: string[] = [];
  const po = d.poNumber != null ? String(d.poNumber).trim().toLowerCase() : '';
  const p2 = (d as { PONumber?: string | null }).PONumber != null ? String((d as { PONumber?: string | null }).PONumber).trim().toLowerCase() : '';
  if (po) parts.push(po);
  if (p2 && p2 !== po) parts.push(p2);
  const meta = d.metadata as Record<string, unknown> | null | undefined;
  const orig = meta?.originalPONumber != null ? String(meta.originalPONumber).trim().toLowerCase() : '';
  if (orig) parts.push(orig);
  const origRow = (meta?.originalRow || meta?._originalRow) as Record<string, unknown> | undefined;
  if (origRow && typeof origRow === 'object') {
    for (const k of ORIGINAL_ROW_PO_KEYS) {
      const v = origRow[k];
      if (v != null && String(v).trim()) {
        const p = String(v).trim().toLowerCase();
        if (p && !parts.includes(p)) parts.push(p);
      }
    }
  }
  return parts;
}

/**
 * Rows to hide on Delivery / Logistics team portals: bogus PO from bad column mapping,
 * or placeholder customer names from failed imports.
 */
export function isTeamPortalGarbageDelivery(d: Delivery | Record<string, unknown>): boolean {
  const rec = d as Record<string, unknown>;
  const poDirect = normalizeSpaces(String(rec.poNumber ?? rec.PONumber ?? '')).toLowerCase();
  if (poDirect === 'removed') return true;
  const pos = normalizedPoParts(rec as Delivery);
  if (pos.some((p) => p === 'removed')) return true;
  if (originalRowContainsRemovedToken(rec.metadata)) return true;
  const cust = normalizeSpaces(String(rec.customer ?? rec.Customer ?? ''));
  if (PLACEHOLDER_CUSTOMER.test(cust)) return true;
  return false;
}

export function excludeTeamPortalGarbageDeliveries<T extends Record<string, unknown>>(list: T[] | undefined | null): T[] {
  const arr = list ?? [];
  return arr.filter((row) => !isTeamPortalGarbageDelivery(row as unknown as Delivery));
}

const DELIVERED_STATUSES = new Set([
  'delivered', 'delivered-with-installation', 'delivered-without-installation',
  'completed', 'pod-completed', 'cancelled', 'returned',
]);

const ACTIVE_STATUSES = new Set([
  // Pre-dispatch statuses
  'pending',
  'uploaded',
  'scheduled',
  'confirmed',
  'scheduled-confirmed',
  // Dispatch / in-transit statuses
  'out-for-delivery',
  'in-transit',
  'in-progress',
  // Delay — still needs driver/admin action
  'order-delay',
  'order_delay',
]);

export function isActiveDeliveryListStatus(status: string): boolean {
  if (!status) return true;
  return ACTIVE_STATUSES.has(status.toLowerCase());
}

/** Driver / route-sequence list: only orders actually on the road (not awaiting SMS / confirmation). */
const ON_ROUTE_STATUSES = new Set([
  'out-for-delivery',
  'out_for_delivery',
  'in-transit',
  'in_progress',
  'in-progress',
  'order-delay',
  'order_delay',
]);

export function isOnRouteDeliveryListStatus(status: string): boolean {
  if (!status) return false;
  return ON_ROUTE_STATUSES.has(status.toLowerCase());
}

export function getOnRouteDeliveriesForList(deliveries: Delivery[] | undefined | null): Delivery[] {
  const list = deliveries ?? [];
  return list.filter((d) => isOnRouteDeliveryListStatus((d.status || '').toLowerCase()));
}

export function getActiveDeliveriesForList(deliveries: Delivery[] | undefined | null): Delivery[] {
  const list = deliveries ?? [];
  return list.filter((d) => {
    const status = (d.status || '').toLowerCase();
    return isActiveDeliveryListStatus(status);
  });
}

export function applyDeliveryListFilter(
  deliveries: Delivery[] | undefined | null,
  filter: DeliveryListFilter | undefined,
): Delivery[] {
  const list = deliveries ?? [];
  const safeFilter: DeliveryListFilter = filter ?? 'all';
  const active = getActiveDeliveriesForList(list);
  switch (safeFilter) {
    case 'pending':
      // "Pending" = any delivery that is awaiting admin/driver action — not yet
      // out for delivery and not yet confirmed by the customer for a future date.
      // Includes 'pending' (just uploaded), 'scheduled' (SMS sent, awaiting reply),
      // and 'uploaded' (ingested but not yet actioned).
      return active.filter((d) => {
        const s = (d.status || '').toLowerCase();
        return s === 'pending' || s === 'scheduled' || s === 'uploaded';
      });
    case 'confirmed':
      // "Confirmed" = customer has confirmed their delivery date via the SMS link.
      return active.filter((d) => {
        const s = (d.status || '').toLowerCase();
        return s === 'confirmed' || s === 'scheduled-confirmed';
      });
    case 'p1':
      return active.filter((d) => d.priority === 1);
    case 'out_for_delivery':
      return active.filter((d) => isOnRouteDeliveryListStatus((d.status || '').toLowerCase()));
    case 'delivered':
      // Bypass active filter — show terminal (delivered/cancelled/returned) deliveries.
      return list.filter((d) => DELIVERED_STATUSES.has((d.status || '').toLowerCase()));
    case 'on_time':
      return active.filter((d) => getEtaStatus(d) === 'on_time');
    case 'delayed':
      return active.filter((d) => getEtaStatus(d) === 'delayed');
    default:
      return active;
  }
}

export function countForDeliveryListFilter(
  deliveries: Delivery[] | undefined | null,
  filter: DeliveryListFilter | undefined,
): number {
  return applyDeliveryListFilter(deliveries, filter).length;
}
