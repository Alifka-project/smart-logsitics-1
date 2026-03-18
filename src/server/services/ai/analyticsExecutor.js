/**
 * Deterministic analytics execution. Uses Prisma aggregation only — no text search, no LLM.
 * All functions accept filters: { status, dateRange } where dateRange is { from, to, label }.
 */

const prisma = require('../../db/prisma.js');
const { CANONICAL, prismaStatusWhere } = require('../../domain/statusMap.js');
const { customerNormalized, productNormalized, parseProductNames } = require('../../domain/normalize.js');

function baseWhere(filters) {
  const where = {};
  if (filters?.dateRange?.from != null && filters?.dateRange?.to != null) {
    where.createdAt = { gte: filters.dateRange.from, lt: filters.dateRange.to };
  }
  if (filters?.status) {
    const statusWhere = prismaStatusWhere(filters.status);
    if (statusWhere) Object.assign(where, statusWhere);
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
    prisma.delivery.count({ where }),
    prisma.delivery.count({ where: { ...where, status: CANONICAL.pending } }),
    prisma.delivery.count({ where: { ...where, status: CANONICAL.inTransit } }),
    prisma.delivery.count({ where: { ...where, status: CANONICAL.delivered } }),
    prisma.delivery.count({ where: { ...where, status: CANONICAL.cancelled } }),
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
  const grouped = await prisma.delivery.groupBy({
    by: ['customer'],
    _count: { id: true },
    where: { customer: { not: null }, ...where },
  });
  const rows = grouped
    .map(g => ({ customer: customerNormalized(g.customer), deliveries: g._count.id }))
    .sort((a, b) => b.deliveries - a.deliveries)
    .slice(0, topN);
  return { rows, period: filters?.dateRange?.label || null };
}

/**
 * Top N products by delivery count. Derives product from items + metadata.
 */
async function getTopProducts(filters, topN = 10) {
  const where = baseWhere(filters);
  const deliveries = await prisma.delivery.findMany({
    where: { items: { not: null }, ...where },
    select: { items: true, metadata: true },
  });
  const countByProduct = {};
  deliveries.forEach(d => {
    const meta = d.metadata || {};
    const orig = meta.originalRow || meta._originalRow || {};
    const fromMeta = String(orig.Description || orig.description || '').trim();
    const names = fromMeta ? [fromMeta] : parseProductNames(d.items);
    names.forEach(name => {
      const key = productNormalized(name);
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
  const deliveries = await prisma.delivery.findMany({
    where,
    select: { createdAt: true, status: true },
  });
  const byKey = {};
  deliveries.forEach(d => {
    const dt = new Date(d.createdAt);
    let key;
    if (interval === 'day') {
      key = dt.toISOString().slice(0, 10);
    } else if (interval === 'month') {
      key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
    } else {
      key = dt.toISOString().slice(0, 10);
    }
    if (!byKey[key]) byKey[key] = { period: key, count: 0, delivered: 0, cancelled: 0 };
    byKey[key].count += 1;
    if (d.status === CANONICAL.delivered) byKey[key].delivered += 1;
    if (d.status === CANONICAL.cancelled) byKey[key].cancelled += 1;
  });
  const data = Object.values(byKey).sort((a, b) => a.period.localeCompare(b.period));
  return { data, period: filters?.dateRange?.label || null };
}

module.exports = {
  countDeliveries,
  getTopCustomers,
  getTopProducts,
  getStatusBreakdown,
  getDeliveryTrend,
  baseWhere,
};
