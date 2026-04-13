"use strict";
/**
 * Unified status taxonomy for deliveries.
 * Used by AI search, reports, and dashboard so counts and analytics stay consistent.
 *
 * Canonical DB values: pending | out-for-delivery | delivered | cancelled
 * Aliases map to these for filtering and aggregation.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PENDING_ALIASES = exports.IN_TRANSIT_ALIASES = exports.CANCELLED_ALIASES = exports.DELIVERED_ALIASES = exports.CANONICAL = void 0;
exports.toCanonicalStatus = toCanonicalStatus;
exports.intentToStatus = intentToStatus;
exports.getCanonicalStatuses = getCanonicalStatuses;
exports.prismaStatusWhere = prismaStatusWhere;
const DELIVERED_ALIASES = [
    'delivered', 'done', 'completed', 'delivered-with-installation', 'delivered-without-installation',
];
exports.DELIVERED_ALIASES = DELIVERED_ALIASES;
const CANCELLED_ALIASES = ['cancelled', 'canceled', 'rejected'];
exports.CANCELLED_ALIASES = CANCELLED_ALIASES;
const IN_TRANSIT_ALIASES = ['out-for-delivery', 'in-progress', 'in transit', 'on the way'];
exports.IN_TRANSIT_ALIASES = IN_TRANSIT_ALIASES;
const SCHEDULED_ALIASES = ['scheduled', 'scheduled-confirmed'];
const RESCHEDULED_ALIASES = ['rescheduled'];
const PENDING_ALIASES = ['pending', 'waiting', 'not delivered yet'];
exports.PENDING_ALIASES = PENDING_ALIASES;
/** Canonical status values stored in DB (Prisma) */
const CANONICAL = {
    delivered: 'delivered',
    cancelled: 'cancelled',
    inTransit: 'out-for-delivery',
    scheduled: 'scheduled',
    rescheduled: 'rescheduled',
    pending: 'pending',
};
exports.CANONICAL = CANONICAL;
/**
 * Map raw status string to canonical status for filtering.
 * Returns one of: 'pending' | 'out-for-delivery' | 'delivered' | 'cancelled' | null (unknown).
 */
function toCanonicalStatus(raw) {
    if (raw == null || raw === '')
        return null;
    const s = String(raw).toLowerCase().trim();
    if (DELIVERED_ALIASES.includes(s))
        return CANONICAL.delivered;
    if (CANCELLED_ALIASES.includes(s))
        return CANONICAL.cancelled;
    if (IN_TRANSIT_ALIASES.includes(s))
        return CANONICAL.inTransit;
    if (SCHEDULED_ALIASES.includes(s))
        return 'scheduled';
    if (RESCHEDULED_ALIASES.includes(s))
        return CANONICAL.rescheduled;
    if (PENDING_ALIASES.includes(s))
        return CANONICAL.pending;
    return null;
}
/**
 * Resolve user intent (e.g. "pending", "delivered", "cancelled") to canonical status.
 * Used by query classification to build filters.
 */
function intentToStatus(intent) {
    const q = (intent || '').toLowerCase();
    if (q.includes('cancel'))
        return CANONICAL.cancelled;
    if (q.includes('pending') || q.includes('waiting'))
        return CANONICAL.pending;
    if (q.includes('transit') || q.includes('on the way') || q.includes('out for delivery'))
        return CANONICAL.inTransit;
    if (q.includes('delivered') || q.includes('completed') || q.includes('done'))
        return CANONICAL.delivered;
    return null;
}
/**
 * All canonical statuses used in delivery analytics (for status breakdown).
 */
function getCanonicalStatuses() {
    return ['pending', 'out-for-delivery', 'delivered', 'cancelled'];
}
/**
 * Prisma where clause: status equals one of the aliases for a canonical group.
 * Use when filtering by "delivered" (include done, completed, etc.) if DB has mixed values.
 * For strict match (DB only has canonical values), use: { status: canonical }.
 */
function prismaStatusWhere(canonicalStatus) {
    if (!canonicalStatus)
        return undefined;
    const aliases = {
        [CANONICAL.delivered]: DELIVERED_ALIASES,
        [CANONICAL.cancelled]: CANCELLED_ALIASES,
        [CANONICAL.inTransit]: IN_TRANSIT_ALIASES,
        [CANONICAL.pending]: PENDING_ALIASES,
    };
    const list = aliases[canonicalStatus];
    if (!list)
        return { status: canonicalStatus };
    return { status: { in: list } };
}
