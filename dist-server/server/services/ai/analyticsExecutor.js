"use strict";
/**
 * Deterministic analytics execution. Uses Prisma aggregation only — no text search, no LLM.
 * All functions accept filters: { status, dateRange } where dateRange is { from, to, label }.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.countDeliveries = countDeliveries;
exports.getTopCustomers = getTopCustomers;
exports.getTopProducts = getTopProducts;
exports.getStatusBreakdown = getStatusBreakdown;
exports.getDeliveryTrend = getDeliveryTrend;
exports.baseWhere = baseWhere;
const prisma_1 = __importDefault(require("../../db/prisma"));
const statusMap_1 = require("../../domain/statusMap");
const normalize_1 = require("../../domain/normalize");
function baseWhere(filters) {
    const where = {};
    if (filters?.dateRange?.from != null && filters?.dateRange?.to != null) {
        where.createdAt = { gte: filters.dateRange.from, lt: filters.dateRange.to };
    }
    if (filters?.status) {
        const statusWhere = (0, statusMap_1.prismaStatusWhere)(filters.status);
        if (statusWhere)
            Object.assign(where, statusWhere);
    }
    return where;
}
/**
 * Count deliveries by optional status and date range.
 * Returns { total, pending, inTransit, delivered, cancelled, period }.
 */
async function countDeliveries(filters) {
    const where = baseWhere(filters);
    const [total, pending, inTransit, delivered, cancelled] = await Promise.all([
        prisma_1.default.delivery.count({ where }),
        prisma_1.default.delivery.count({ where: { ...where, status: statusMap_1.CANONICAL.pending } }),
        prisma_1.default.delivery.count({ where: { ...where, status: statusMap_1.CANONICAL.inTransit } }),
        prisma_1.default.delivery.count({ where: { ...where, status: statusMap_1.CANONICAL.delivered } }),
        prisma_1.default.delivery.count({ where: { ...where, status: statusMap_1.CANONICAL.cancelled } }),
    ]);
    return {
        total,
        pending,
        inTransit,
        delivered,
        cancelled,
        period: filters?.dateRange?.label || null,
    };
}
/**
 * Top N customers by delivery count. Uses normalized customer for grouping.
 */
async function getTopCustomers(filters, topN = 10) {
    const where = baseWhere(filters);
    const grouped = await prisma_1.default.delivery.groupBy({
        by: ['customer'],
        _count: { id: true },
        where: { customer: { not: null }, ...where },
    });
    const rows = grouped
        .map(g => ({ customer: (0, normalize_1.customerNormalized)(g.customer), deliveries: g._count.id }))
        .sort((a, b) => b.deliveries - a.deliveries)
        .slice(0, topN);
    return { rows, period: filters?.dateRange?.label || null };
}
/**
 * Top N products by delivery count. Derives product from items + metadata.
 */
async function getTopProducts(filters, topN = 10) {
    const where = baseWhere(filters);
    const deliveries = await prisma_1.default.delivery.findMany({
        where: { items: { not: null }, ...where },
        select: { items: true, metadata: true },
    });
    const countByProduct = {};
    deliveries.forEach(d => {
        const meta = d.metadata || {};
        const orig = (meta.originalRow || meta._originalRow || {});
        const fromMeta = String(orig.Description || orig.description || '').trim();
        const names = fromMeta ? [fromMeta] : (0, normalize_1.parseProductNames)(d.items);
        names.forEach((name) => {
            const key = (0, normalize_1.productNormalized)(name);
            countByProduct[key] = (countByProduct[key] || 0) + 1;
        });
    });
    const rows = Object.entries(countByProduct)
        .map(([name, deliveries]) => ({ name, deliveries }))
        .sort((a, b) => b.deliveries - a.deliveries)
        .slice(0, topN);
    return { rows, period: filters?.dateRange?.label || null };
}
/**
 * Status breakdown: counts per status in the period.
 */
async function getStatusBreakdown(filters) {
    const counts = await countDeliveries(filters);
    const table = [
        { status: 'Pending', count: counts.pending },
        { status: 'In transit', count: counts.inTransit },
        { status: 'Delivered', count: counts.delivered },
        { status: 'Cancelled', count: counts.cancelled },
    ];
    return { ...counts, table, period: filters?.dateRange?.label || null };
}
/**
 * Delivery trend by interval (e.g. by day for last 7 days). Returns series for chart.
 */
async function getDeliveryTrend(filters, interval = 'day') {
    const where = baseWhere(filters);
    const deliveries = await prisma_1.default.delivery.findMany({
        where,
        select: { createdAt: true, status: true },
    });
    const byKey = {};
    deliveries.forEach(d => {
        const dt = new Date(d.createdAt);
        let key;
        if (interval === 'day') {
            key = dt.toISOString().slice(0, 10);
        }
        else if (interval === 'month') {
            key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
        }
        else {
            key = dt.toISOString().slice(0, 10);
        }
        if (!byKey[key])
            byKey[key] = { period: key, count: 0, delivered: 0, cancelled: 0 };
        byKey[key].count += 1;
        if (d.status === statusMap_1.CANONICAL.delivered)
            byKey[key].delivered += 1;
        if (d.status === statusMap_1.CANONICAL.cancelled)
            byKey[key].cancelled += 1;
    });
    const data = Object.values(byKey).sort((a, b) => a.period.localeCompare(b.period));
    return { data, period: filters?.dateRange?.label || null };
}
