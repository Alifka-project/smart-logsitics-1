/**
 * Lookup: text search over deliveries (and optionally drivers).
 * Uses normalization and partial matching. Relevance: prefer customer/PO match, then address, then items.
 */

import prisma from '../../db/prisma';
import { normalizeText } from '../../domain/normalize';
import { baseWhere } from './analyticsExecutor';
import { AnalyticsFilters } from './analyticsExecutor';

const DELIVERY_SELECT = {
  id: true,
  customer: true,
  address: true,
  status: true,
  poNumber: true,
  createdAt: true,
  phone: true,
};

interface DeliveryRow {
  id: string;
  customer: string | null;
  address: string | null;
  status: string;
  poNumber: string | null;
  createdAt: Date;
  phone: string | null;
}

interface SearchDeliveriesOptions {
  limit?: number;
  driverId?: string;
}

interface SearchDeliveriesResult {
  rows: DeliveryRow[];
  total: number;
}

interface DriverRow {
  id: string;
  fullName: string | null;
  username: string | null;
  email: string | null;
  active: boolean;
  phone: string | null;
}

interface SearchDriversOptions {
  limit?: number;
}

interface SearchDriversResult {
  rows: DriverRow[];
}

/**
 * Search deliveries by text (customer, address, poNumber, items, status).
 * filters: { status, dateRange }. options: { limit, driverId for assigned-only }.
 */
async function searchDeliveries(
  query: string,
  filters: AnalyticsFilters | undefined,
  options: SearchDeliveriesOptions = {}
): Promise<SearchDeliveriesResult> {
  const limit = options.limit ?? 10;
  const driverId = options.driverId;
  const q = normalizeText(query);
  if (!q) return { rows: [], total: 0 };

  const base = baseWhere(filters);
  const where: Record<string, unknown> = {
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
  return { rows: rows as DeliveryRow[], total };
}

/**
 * Search drivers by name, username, email, phone (admin only).
 */
async function searchDrivers(query: string, options: SearchDriversOptions = {}): Promise<SearchDriversResult> {
  const limit = options.limit ?? 5;
  const q = String(query || '').trim();
  if (!q) return { rows: [] };
  const rows = await (prisma as any).driver.findMany({
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

export { searchDeliveries, searchDrivers, DELIVERY_SELECT };
