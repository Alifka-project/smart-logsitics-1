"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Tests for analytics executor result shapes. Require DB (DATABASE_URL) to run.
 * Run: npm test -- src/server/services/ai/analyticsExecutor.test.js
 */
const vitest_1 = require("vitest");
(0, vitest_1.describe)('analyticsExecutor result shape', () => {
    (0, vitest_1.it)('countDeliveries returns total, pending, inTransit, delivered, cancelled, period', async () => {
        // First Prisma call can be slow (cold start)
        const { countDeliveries } = await Promise.resolve().then(() => __importStar(require('./analyticsExecutor.js')));
        const result = await countDeliveries({});
        (0, vitest_1.expect)(result).toHaveProperty('total');
        (0, vitest_1.expect)(result).toHaveProperty('pending');
        (0, vitest_1.expect)(result).toHaveProperty('inTransit');
        (0, vitest_1.expect)(result).toHaveProperty('delivered');
        (0, vitest_1.expect)(result).toHaveProperty('cancelled');
        (0, vitest_1.expect)(result).toHaveProperty('period');
        (0, vitest_1.expect)(typeof result.total).toBe('number');
        (0, vitest_1.expect)(typeof result.pending).toBe('number');
    }, 15000);
    (0, vitest_1.it)('getTopCustomers returns rows array and period', async () => {
        const { getTopCustomers } = await Promise.resolve().then(() => __importStar(require('./analyticsExecutor.js')));
        const result = await getTopCustomers({}, 5);
        (0, vitest_1.expect)(Array.isArray(result.rows)).toBe(true);
        result.rows.forEach(row => {
            (0, vitest_1.expect)(row).toHaveProperty('customer');
            (0, vitest_1.expect)(row).toHaveProperty('deliveries');
            (0, vitest_1.expect)(typeof row.deliveries).toBe('number');
        });
        (0, vitest_1.expect)(result).toHaveProperty('period');
    });
    (0, vitest_1.it)('getTopProducts returns rows array and period', async () => {
        const { getTopProducts } = await Promise.resolve().then(() => __importStar(require('./analyticsExecutor.js')));
        const result = await getTopProducts({}, 5);
        (0, vitest_1.expect)(Array.isArray(result.rows)).toBe(true);
        result.rows.forEach(row => {
            (0, vitest_1.expect)(row).toHaveProperty('name');
            (0, vitest_1.expect)(row).toHaveProperty('deliveries');
            (0, vitest_1.expect)(typeof row.deliveries).toBe('number');
        });
        (0, vitest_1.expect)(result).toHaveProperty('period');
    });
    (0, vitest_1.it)('getStatusBreakdown returns table and counts', async () => {
        const { getStatusBreakdown } = await Promise.resolve().then(() => __importStar(require('./analyticsExecutor.js')));
        const result = await getStatusBreakdown({});
        (0, vitest_1.expect)(result).toHaveProperty('table');
        (0, vitest_1.expect)(Array.isArray(result.table)).toBe(true);
        (0, vitest_1.expect)(result.table.some(r => r.status && typeof r.count === 'number')).toBe(true);
        (0, vitest_1.expect)(result).toHaveProperty('total');
        (0, vitest_1.expect)(result).toHaveProperty('period');
    });
});
