"use strict";
/**
 * Sort delivery list so that rows with missing address or phone appear at the bottom.
 * Within each group (complete first, incomplete last), sort by createdAt descending (newest first).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.sortDeliveriesIncompleteLast = sortDeliveriesIncompleteLast;
function sortDeliveriesIncompleteLast(deliveries) {
    if (!Array.isArray(deliveries) || deliveries.length === 0)
        return;
    deliveries.sort((a, b) => {
        const hasAddressAndPhone = (d) => (d.address != null && String(d.address).trim() !== '') &&
            (d.phone != null && String(d.phone).trim() !== '');
        const aComplete = hasAddressAndPhone(a);
        const bComplete = hasAddressAndPhone(b);
        if (aComplete !== bComplete)
            return aComplete ? -1 : 1;
        const aDate = a.createdAt ?? a.created_at ?? a.CreatedAt ?? 0;
        const bDate = b.createdAt ?? b.created_at ?? b.CreatedAt ?? 0;
        return new Date(bDate).getTime() - new Date(aDate).getTime();
    });
}
