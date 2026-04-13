"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const deliveryDedupService_1 = require("./deliveryDedupService");
(0, vitest_1.describe)('deliveryDedupService - buildBusinessKey', () => {
    (0, vitest_1.it)('builds a normalized business key from PO and original delivery number', () => {
        const key = (0, deliveryDedupService_1.buildBusinessKey)(' po-123 ', ' del-9 ');
        (0, vitest_1.expect)(key).toBe('PO-123::DEL-9');
    });
    (0, vitest_1.it)('returns null when PO is missing', () => {
        const key = (0, deliveryDedupService_1.buildBusinessKey)(null, 'DEL-9');
        (0, vitest_1.expect)(key).toBeNull();
    });
    (0, vitest_1.it)('returns null when original delivery number is missing', () => {
        const key = (0, deliveryDedupService_1.buildBusinessKey)('PO-123', '');
        (0, vitest_1.expect)(key).toBeNull();
    });
});
