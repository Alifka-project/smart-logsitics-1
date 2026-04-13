"use strict";
/**
 * Lookup: text search over deliveries (and optionally drivers).
 * Uses normalization and partial matching. Relevance: prefer customer/PO match, then address, then items.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DELIVERY_SELECT = void 0;
exports.searchDeliveries = searchDeliveries;
exports.searchDrivers = searchDrivers;
const prisma_1 = __importDefault(require("../../db/prisma"));
const normalize_1 = require("../../domain/normalize");
const analyticsExecutor_1 = require("./analyticsExecutor");
const DELIVERY_SELECT = {
    id: true,
    customer: true,
    address: true,
    status: true,
    poNumber: true,
    createdAt: true,
    phone: true,
};
exports.DELIVERY_SELECT = DELIVERY_SELECT;
/**
 * Search deliveries by text (customer, address, poNumber, items, status).
 * filters: { status, dateRange }. options: { limit, driverId for assigned-only }.
 */
async function searchDeliveries(query, filters, options = {}) {
    const limit = options.limit ?? 10;
    const driverId = options.driverId;
    const q = (0, normalize_1.normalizeText)(query);
    if (!q)
        return { rows: [], total: 0 };
    const base = (0, analyticsExecutor_1.baseWhere)(filters);
    const where = {
        ...base,
        OR: [
            { customer: { contains: query.trim(), mode: 'insensitive' } },
            { address: { contains: query.trim(), mode: 'insensitive' } },
            { poNumber: { contains: query.trim(), mode: 'insensitive' } },
            { items: { contains: query.trim(), mode: 'insensitive' } },
            { status: { contains: query.trim(), mode: 'insensitive' } },
        ],
    };
    if (driverId) {
        where.assignments = { some: { driverId } };
    }
    const [rows, total] = await Promise.all([
        prisma_1.default.delivery.findMany({
            where,
            orderBy: [{ createdAt: 'desc' }],
            take: limit,
            select: DELIVERY_SELECT,
        }),
        prisma_1.default.delivery.count({ where }),
    ]);
    return { rows: rows, total };
}
/**
 * Search drivers by name, username, email, phone (admin only).
 */
async function searchDrivers(query, options = {}) {
    const limit = options.limit ?? 5;
    const q = String(query || '').trim();
    if (!q)
        return { rows: [] };
    const rows = await prisma_1.default.driver.findMany({
        where: {
            OR: [
                { fullName: { contains: q, mode: 'insensitive' } },
                { username: { contains: q, mode: 'insensitive' } },
                { email: { contains: q, mode: 'insensitive' } },
                { phone: { contains: q, mode: 'insensitive' } },
            ],
        },
        take: limit,
        select: { id: true, fullName: true, username: true, email: true, active: true, phone: true },
    });
    return { rows };
}
