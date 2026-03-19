/**
 * Deterministic analytics execution. Uses Prisma aggregation only — no text search, no LLM.
 * All functions accept filters: { status, dateRange } where dateRange is { from, to, label }.
 */

import prisma from '../../db/prisma';
import { CANONICAL, prismaStatusWhere } from '../../domain/statusMap';
import { customerNormalized, productNormalized, parseProductNames } from '../../domain/normalize';

export interface DateRange {
  from: Date;
  to: Date;
  label: string;
}

export interface AnalyticsFilters {
  status?: string | null;
  dateRange?: DateRange | null;
}

export interface DeliveryCountResult {
  total: number;
  pending: number;
  inTransit: number;
  delivered: number;
  cancelled: number;
  period: string | null;
}

export interface CustomerRow {
  customer: string;
  deliveries: number;
}

export interface TopCustomersResult {
  rows: CustomerRow[];
  period: string | null;
}

export interface ProductRow {
  name: string;
  deliveries: number;
}

export interface TopProductsResult {
  rows: ProductRow[];
  period: string | null;
}

export interface StatusBreakdownRow {
  status: string;
  count: number;
}

export interface StatusBreakdownResult extends DeliveryCountResult {
  table: StatusBreakdownRow[];
}

export interface TrendDataPoint {
  period: string;
  count: number;
  delivered: number;
  cancelled: number;
}

export interface DeliveryTrendResult {
  data: TrendDataPoint[];
  period: string | null;
}

function baseWhere(filters?: AnalyticsFilters): Record<string, unknown> {
  const where: Record<string, unknown> = {};
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
async function countDeliveries(filters?: AnalyticsFilters): Promise<DeliveryCountResult> {
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
async function getTopCustomers(filters?: AnalyticsFilters, topN = 10): Promise<TopCustomersResult> {
  const where = baseWhere(filters);
  const grouped = await prisma.delivery.groupBy({
    by: ['customer'] as ['customer'],
    _count: { id: true },
    where: { customer: { not: null }, ...where },
  });
  const rows = (grouped as Array<{ customer: string | null; _count: { id: number } }>)
    .map(g => ({ customer: customerNormalized(g.customer as string), deliveries: g._count.id }))
    .sort((a, b) => b.deliveries - a.deliveries)
    .slice(0, topN);
  return { rows, period: filters?.dateRange?.label || null };
}

/**
 * Top N products by delivery count. Derives product from items + metadata.
 */
async function getTopProducts(filters?: AnalyticsFilters, topN = 10): Promise<TopProductsResult> {
  const where = baseWhere(filters);
  const deliveries = await prisma.delivery.findMany({
    where: { items: { not: null }, ...where },
    select: { items: true, metadata: true },
  });
  const countByProduct: Record<string, number> = {};
  deliveries.forEach(d => {
    const meta = (d.metadata as Record<string, unknown>) || {};
    const orig = (meta.originalRow || meta._originalRow || {}) as Record<string, unknown>;
    const fromMeta = String(orig.Description || orig.description || '').trim();
    const names = fromMeta ? [fromMeta] : parseProductNames(d.items as string);
    names.forEach((name: string) => {
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
async function getStatusBreakdown(filters?: AnalyticsFilters): Promise<StatusBreakdownResult> {
  const counts = await countDeliveries(filters);
  const table: StatusBreakdownRow[] = [
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
async function getDeliveryTrend(filters?: AnalyticsFilters, interval = 'day'): Promise<DeliveryTrendResult> {
  const where = baseWhere(filters);
  const deliveries = await prisma.delivery.findMany({
    where,
    select: { createdAt: true, status: true },
  });
  const byKey: Record<string, TrendDataPoint> = {};
  deliveries.forEach(d => {
    const dt = new Date(d.createdAt);
    let key: string;
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

export {
  countDeliveries,
  getTopCustomers,
  getTopProducts,
  getStatusBreakdown,
  getDeliveryTrend,
  baseWhere,
};
