/**
 * Lookup: text search over deliveries (and optionally drivers).
 * Uses normalization and partial matching. Relevance: prefer customer/PO match, then address, then items.
 */

const prisma = require('../../db/prisma.js');
const { normalizeText } = require('../../domain/normalize.js');
const { baseWhere } = require('./analyticsExecutor.js');

const DELIVERY_SELECT = {
  id: true,
  customer: true,
  address: true,
  status: true,
  poNumber: true,
  createdAt: true,
  phone: true,
};

/**
 * Search deliveries by text (customer, address, poNumber, items, status).
 * filters: { status, dateRange }. options: { limit, driverId for assigned-only }.
 */
async function searchDeliveries(query, filters, options = {}) {
  const limit = options.limit ?? 10;
  const driverId = options.driverId;
  const q = normalizeText(query);
  if (!q) return { rows: [], total: 0 };

  const base = baseWhere(filters);
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
    prisma.delivery.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }],
      take: limit,
      select: DELIVERY_SELECT,
    }),
    prisma.delivery.count({ where }),
  ]);
  return { rows, total };
}

/**
 * Search drivers by name, username, email, phone (admin only).
 */
async function searchDrivers(query, options = {}) {
  const limit = options.limit ?? 5;
  const q = String(query || '').trim();
  if (!q) return { rows: [] };
  const rows = await prisma.driver.findMany({
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

module.exports = { searchDeliveries, searchDrivers, DELIVERY_SELECT };
