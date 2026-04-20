"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getEtaStatus = getEtaStatus;
exports.isTeamPortalGarbageDelivery = isTeamPortalGarbageDelivery;
exports.excludeTeamPortalGarbageDeliveries = excludeTeamPortalGarbageDeliveries;
exports.isActiveDeliveryListStatus = isActiveDeliveryListStatus;
exports.isOnRouteDeliveryListStatus = isOnRouteDeliveryListStatus;
exports.getOnRouteDeliveriesForList = getOnRouteDeliveriesForList;
exports.getActiveDeliveriesForList = getActiveDeliveriesForList;
exports.applyDeliveryListFilter = applyDeliveryListFilter;
exports.countForDeliveryListFilter = countForDeliveryListFilter;
/** Delay threshold: if estimatedEta is more than this many ms after plannedEta → Delayed (D3: 1-hour rule) */
const DELAY_THRESHOLD_MS = 60 * 60 * 1000; // 60 minutes (1 hour)
function getEtaStatus(d) {
    const planned = d['plannedEta'];
    const estimated = d['estimatedEta']
        ?? (d.estimatedTime instanceof Date ? d.estimatedTime.toISOString()
            : typeof d.estimatedTime === 'string' ? d.estimatedTime : null);
    if (!planned || !estimated)
        return 'unknown';
    const diff = new Date(estimated).getTime() - new Date(planned).getTime();
    return diff > DELAY_THRESHOLD_MS ? 'delayed' : 'on_time';
}
/** Placeholder customer from failed Excel mapping (`Customer 1`, `Customer3`, …). */
const PLACEHOLDER_CUSTOMER = /^customer\s*\d+$/i;
function normalizeSpaces(s) {
    return s.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}
/** True if any cell in the uploaded row is literally "removed" (bad column map). */
function originalRowContainsRemovedToken(metadata) {
    const meta = metadata;
    const row = (meta?.originalRow ?? meta?._originalRow);
    if (!row || typeof row !== 'object')
        return false;
    for (const v of Object.values(row)) {
        if (v != null && normalizeSpaces(String(v)).toLowerCase() === 'removed')
            return true;
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
function normalizedPoParts(d) {
    const parts = [];
    const po = d.poNumber != null ? String(d.poNumber).trim().toLowerCase() : '';
    const p2 = d.PONumber != null ? String(d.PONumber).trim().toLowerCase() : '';
    if (po)
        parts.push(po);
    if (p2 && p2 !== po)
        parts.push(p2);
    const meta = d.metadata;
    const orig = meta?.originalPONumber != null ? String(meta.originalPONumber).trim().toLowerCase() : '';
    if (orig)
        parts.push(orig);
    const origRow = (meta?.originalRow || meta?._originalRow);
    if (origRow && typeof origRow === 'object') {
        for (const k of ORIGINAL_ROW_PO_KEYS) {
            const v = origRow[k];
            if (v != null && String(v).trim()) {
                const p = String(v).trim().toLowerCase();
                if (p && !parts.includes(p))
                    parts.push(p);
            }
        }
    }
    return parts;
}
/**
 * Rows to hide on Delivery / Logistics team portals: bogus PO from bad column mapping,
 * or placeholder customer names from failed imports.
 */
function isTeamPortalGarbageDelivery(d) {
    const rec = d;
    const poDirect = normalizeSpaces(String(rec.poNumber ?? rec.PONumber ?? '')).toLowerCase();
    if (poDirect === 'removed')
        return true;
    const pos = normalizedPoParts(rec);
    if (pos.some((p) => p === 'removed'))
        return true;
    if (originalRowContainsRemovedToken(rec.metadata))
        return true;
    const cust = normalizeSpaces(String(rec.customer ?? rec.Customer ?? ''));
    if (PLACEHOLDER_CUSTOMER.test(cust))
        return true;
    return false;
}
function excludeTeamPortalGarbageDeliveries(list) {
    const arr = list ?? [];
    return arr.filter((row) => !isTeamPortalGarbageDelivery(row));
}
// "Completed" = successfully delivered OR cancelled — excludes returned/failed
const COMPLETED_STATUSES = new Set([
    'delivered', 'delivered-with-installation', 'delivered-without-installation',
    'completed', 'pod-completed', 'finished', 'cancelled',
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
function isActiveDeliveryListStatus(status) {
    if (!status)
        return true;
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
function isOnRouteDeliveryListStatus(status) {
    if (!status)
        return false;
    return ON_ROUTE_STATUSES.has(status.toLowerCase());
}
function getOnRouteDeliveriesForList(deliveries) {
    const list = deliveries ?? [];
    return list.filter((d) => isOnRouteDeliveryListStatus((d.status || '').toLowerCase()));
}
function getActiveDeliveriesForList(deliveries) {
    const list = deliveries ?? [];
    return list.filter((d) => {
        const status = (d.status || '').toLowerCase();
        return isActiveDeliveryListStatus(status);
    });
}
function applyDeliveryListFilter(deliveries, filter) {
    const list = deliveries ?? [];
    const safeFilter = filter ?? 'all';
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
            // Match numeric priority 1 OR the metadata.isPriority flag set by the
            // logistics portal — both signals must be treated as "P1 Urgent".
            return active.filter((d) => {
                const meta = d.metadata;
                return d.priority === 1 || meta?.isPriority === true;
            });
        case 'out_for_delivery':
            return active.filter((d) => isOnRouteDeliveryListStatus((d.status || '').toLowerCase()));
        case 'delivered': {
            // "Completed" view: delivered + cancelled orders within the last 3 days.
            // Excludes returned/failed (those stay in their own bucket).
            const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
            const cutoff = Date.now() - THREE_DAYS_MS;
            return list.filter((d) => {
                if (!COMPLETED_STATUSES.has((d.status || '').toLowerCase()))
                    return false;
                // Apply 3-day recency window — fall back to "always show" when no date available
                const rec = d;
                const dateStr = d.deliveredAt ??
                    d.podCompletedAt ??
                    d.updatedAt ??
                    rec.updated_at ??
                    rec.created_at ??
                    d.createdAt;
                if (!dateStr)
                    return false; // no date info → cannot confirm recency, exclude
                const ts = new Date(String(dateStr)).getTime();
                return !isNaN(ts) && ts >= cutoff;
            });
        }
        case 'on_time':
            return active.filter((d) => getEtaStatus(d) === 'on_time');
        case 'delayed':
            return active.filter((d) => getEtaStatus(d) === 'delayed');
        default:
            return active;
    }
}
function countForDeliveryListFilter(deliveries, filter) {
    return applyDeliveryListFilter(deliveries, filter).length;
}
