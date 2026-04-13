"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Unit tests for deliveryListSort – incomplete (missing address or phone) at bottom
 */
const vitest_1 = require("vitest");
const deliveryListSort_1 = require("./deliveryListSort");
(0, vitest_1.describe)('deliveryListSort', () => {
    (0, vitest_1.it)('sorts deliveries with missing address or phone to the bottom', () => {
        const list = [
            { id: '1', address: '', phone: '555', createdAt: '2025-01-03' },
            { id: '2', address: 'Addr 2', phone: '666', createdAt: '2025-01-02' },
            { id: '3', address: 'Addr 3', phone: '', createdAt: '2025-01-01' },
            { id: '4', address: 'Addr 4', phone: '888', createdAt: '2025-01-04' }
        ];
        (0, deliveryListSort_1.sortDeliveriesIncompleteLast)(list);
        (0, vitest_1.expect)(list.map(d => d.id)).toEqual(['4', '2', '1', '3']);
    });
    (0, vitest_1.it)('within complete group, newest first; within incomplete, newest first', () => {
        const list = [
            { id: 'a', address: 'A', phone: '1', createdAt: '2025-01-01' },
            { id: 'b', address: 'B', phone: '2', createdAt: '2025-01-03' },
            { id: 'c', address: null, phone: '3', createdAt: '2025-01-02' },
            { id: 'd', address: 'D', phone: null, createdAt: '2025-01-04' }
        ];
        (0, deliveryListSort_1.sortDeliveriesIncompleteLast)(list);
        (0, vitest_1.expect)(list.map(d => d.id)).toEqual(['b', 'a', 'd', 'c']);
    });
    (0, vitest_1.it)('handles empty array and null/undefined safely', () => {
        const empty = [];
        (0, deliveryListSort_1.sortDeliveriesIncompleteLast)(empty);
        (0, vitest_1.expect)(empty).toEqual([]);
    });
});
