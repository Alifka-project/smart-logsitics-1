/**
 * Truck capacity: max pieces per route/day, customer date window (7 eligible days).
 * Non-working days: Sundays + UAE public holidays. Uses Asia/Dubai for calendar boundaries.
 *
 * Business rule: 1 driver = 1 truck = TRUCK_MAX_ITEMS_PER_DAY units max per day.
 * Fleet daily capacity = numActiveDrivers × TRUCK_MAX_ITEMS_PER_DAY.
 * Per-driver capacity is also enforced at assignment time.
 */

import type { PrismaClient } from '@prisma/client';
import { isDubaiPublicHoliday } from '../../utils/dubaiHolidays';

/**
 * Prisma client or transaction client.
 * Includes `driver` so fleet capacity (numDrivers × truckMax) can be computed.
 * Includes `deliveryAssignment` for per-driver capacity queries.
 */
type DeliveryDb = Pick<PrismaClient, 'delivery' | 'driver' | 'deliveryAssignment'>;

/** One driver / one truck = 20 units max per delivery day. Env-configurable. */
export const TRUCK_MAX_ITEMS_PER_DAY = Math.max(
  1,
  Number.parseInt(process.env.TRUCK_MAX_ITEMS_PER_DAY || '20', 10) || 20
);

const DUBAI_TZ = 'Asia/Dubai';

/** YYYY-MM-DD for "today" in Dubai */
export function getDubaiTodayIso(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: DUBAI_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
}

export function getDubaiWeekday(isoDate: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: DUBAI_TZ,
    weekday: 'short'
  }).formatToParts(new Date(`${isoDate}T12:00:00+04:00`));
  const wd = parts.find(p => p.type === 'weekday')?.value;
  const map: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6
  };
  return wd ? (map[wd] ?? 0) : 0;
}

/** Add calendar days in Dubai (no DST in UAE). */
export function addDubaiCalendarDays(isoDate: string, deltaDays: number): string {
  const ref = new Date(`${isoDate}T12:00:00+04:00`);
  ref.setTime(ref.getTime() + deltaDays * 86400000);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: DUBAI_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(ref);
}

/**
 * Next 7 eligible delivery days: skip Sundays and UAE public holidays.
 * Starts from tomorrow (Dubai timezone).
 */
export function getNextSevenEligibleDayIsoStrings(): string[] {
  const out: string[] = [];
  let cursor = addDubaiCalendarDays(getDubaiTodayIso(), 1);
  while (out.length < 7) {
    const wd = getDubaiWeekday(cursor);
    if (wd !== 0 && !isDubaiPublicHoliday(cursor)) {
      out.push(cursor);
    }
    cursor = addDubaiCalendarDays(cursor, 1);
  }
  return out;
}

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number.parseFloat(String(v));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Piece count for capacity: reads from metadata.originalQuantity first,
 * then from the raw Excel row (Order Quantity / Confirmed quantity),
 * then from parsed JSON items array, defaulting to 1.
 */
export function parseDeliveryItemCount(
  items: string | null | undefined,
  metadata?: Record<string, unknown> | null
): number {
  // Primary: pre-extracted quantity stored on metadata
  if (metadata?.originalQuantity != null) {
    const q = num(metadata.originalQuantity);
    if (q > 0) return Math.min(9999, Math.ceil(q));
  }

  // Secondary: raw Excel row fields (exact column names from the spreadsheet)
  const orig = (
    metadata?.originalRow ??
    metadata?._originalRow ??
    {}
  ) as Record<string, unknown>;
  const excelQty = num(
    orig['Order Quantity'] ??
    orig['Confirmed quantity'] ??
    orig['Total Line Deliv. Qt'] ??
    orig['Order Qty'] ??
    orig['Quantity'] ??
    orig['qty'] ??
    orig['QTY'] ??
    0
  );
  if (excelQty > 0) return Math.min(9999, Math.ceil(excelQty));

  if (!items || !String(items).trim()) {
    return 1;
  }
  try {
    const parsed = JSON.parse(items) as unknown;
    if (Array.isArray(parsed)) {
      if (parsed.length === 0) return 1;
      let sum = 0;
      for (const row of parsed) {
        if (row && typeof row === 'object') {
          const o = row as Record<string, unknown>;
          const q =
            num(o['Order Quantity']) ||
            num(o['Confirmed quantity']) ||
            num(o.Quantity) ||
            num(o.quantity) ||
            num(o.qty) ||
            num(o.Qty);
          sum += q > 0 ? q : 1;
        } else {
          sum += 1;
        }
      }
      return Math.max(1, Math.min(9999, Math.ceil(sum)));
    }
  } catch {
    // fall through
  }
  return 1;
}

export function dubaiDayRangeUtc(isoDate: string): { start: Date; end: Date } {
  const start = new Date(`${isoDate}T00:00:00+04:00`);
  const end = new Date(`${isoDate}T23:59:59.999+04:00`);
  return { start, end };
}

const EXCLUDED_FROM_CAPACITY: Set<string> = new Set([
  'cancelled',
  'returned',
  'failed'
]);

/**
 * Count active drivers whose account has role='driver'.
 * Returns at least 1 so a zero-driver system still has a non-zero capacity ceiling.
 */
async function countActiveDeliveryDrivers(db: DeliveryDb): Promise<number> {
  try {
    const count = await db.driver.count({
      where: { active: true, account: { role: 'driver' } }
    });
    return Math.max(1, count);
  } catch {
    return 1;
  }
}

/**
 * Sum piece counts for deliveries confirmed on this Dubai calendar day (excluding one delivery).
 * Used for fleet-level capacity checking.
 */
export async function getTotalItemCountForDeliveryDate(
  db: DeliveryDb,
  isoDate: string,
  excludeDeliveryId?: string
): Promise<number> {
  const { start, end } = dubaiDayRangeUtc(isoDate);
  const rows = await db.delivery.findMany({
    where: {
      confirmationStatus: 'confirmed',
      confirmedDeliveryDate: { gte: start, lte: end },
      ...(excludeDeliveryId ? { id: { not: excludeDeliveryId } } : {}),
      status: { notIn: [...EXCLUDED_FROM_CAPACITY] }
    },
    select: { id: true, items: true, metadata: true }
  });

  let total = 0;
  for (const r of rows) {
    const meta = r.metadata && typeof r.metadata === 'object' ? (r.metadata as Record<string, unknown>) : null;
    total += parseDeliveryItemCount(r.items, meta);
  }
  return total;
}

/**
 * Sum piece counts for deliveries assigned to a specific driver on a given Dubai calendar day.
 * Joins through DeliveryAssignment (active assignments only) → Delivery.confirmedDeliveryDate.
 * Used to enforce the per-driver 20-unit capacity limit at assignment time.
 */
export async function getDriverItemCountForDate(
  db: Pick<PrismaClient, 'delivery' | 'deliveryAssignment'>,
  driverId: string,
  isoDate: string,
  excludeDeliveryId?: string
): Promise<number> {
  const { start, end } = dubaiDayRangeUtc(isoDate);

  // Find delivery IDs actively assigned to this driver that fall on the target date
  const assignments = await db.deliveryAssignment.findMany({
    where: {
      driverId,
      status: { in: ['assigned', 'in_progress'] },
      delivery: {
        confirmedDeliveryDate: { gte: start, lte: end },
        status: { notIn: [...EXCLUDED_FROM_CAPACITY] },
        ...(excludeDeliveryId ? { id: { not: excludeDeliveryId } } : {})
      }
    },
    select: {
      delivery: { select: { id: true, items: true, metadata: true } }
    }
  });

  let total = 0;
  for (const a of assignments) {
    const r = a.delivery;
    if (!r) continue;
    const meta = r.metadata && typeof r.metadata === 'object' ? (r.metadata as Record<string, unknown>) : null;
    total += parseDeliveryItemCount(r.items, meta);
  }
  return total;
}

/** Per-day capacity detail returned to customer confirmation page. */
export interface DayCapacityDetail {
  iso: string;
  available: boolean;
  used: number;
  total: number;
  remaining: number;
  reason?: string; // why unavailable (holiday, sunday, full, outside-window)
}

/**
 * Returns capacity details for each of the next 7 eligible calendar days,
 * plus unavailable days (Sunday, holiday) within the same 10-day scan window.
 * Customers see all days — available ones are selectable, full/blocked ones show reason.
 */
export async function getDateCapacityDetails(
  db: DeliveryDb,
  deliveryId: string,
  items: string | null | undefined,
  metadata?: Record<string, unknown> | null
): Promise<{
  days: DayCapacityDetail[];
  orderItemCount: number;
  exceedsTruckCapacity: boolean;
  availableDates: string[]; // backwards-compat
}> {
  const orderItemCount = parseDeliveryItemCount(items, metadata);

  if (orderItemCount > TRUCK_MAX_ITEMS_PER_DAY) {
    return {
      days: [],
      orderItemCount,
      exceedsTruckCapacity: true,
      availableDates: []
    };
  }

  const numDrivers = await countActiveDeliveryDrivers(db);
  const fleetDailyCapacity = numDrivers * TRUCK_MAX_ITEMS_PER_DAY;

  // Scan up to 14 calendar days to collect 7 eligible + show blocked days in between
  const today = getDubaiTodayIso();
  const days: DayCapacityDetail[] = [];
  const availableDates: string[] = [];
  let eligibleCount = 0;
  let cursor = addDubaiCalendarDays(today, 1);

  while (eligibleCount < 7 || days.length < 14) {
    const wd = getDubaiWeekday(cursor);
    const isHoliday = isDubaiPublicHoliday(cursor);

    if (wd === 0) {
      days.push({ iso: cursor, available: false, used: 0, total: 0, remaining: 0, reason: 'sunday' });
    } else if (isHoliday) {
      days.push({ iso: cursor, available: false, used: 0, total: 0, remaining: 0, reason: 'holiday' });
    } else {
      const used = await getTotalItemCountForDeliveryDate(db, cursor, deliveryId);
      const remaining = fleetDailyCapacity - used;
      const available = remaining >= orderItemCount;
      if (available) eligibleCount++;
      if (available) availableDates.push(cursor);
      days.push({
        iso: cursor,
        available,
        used,
        total: fleetDailyCapacity,
        remaining,
        reason: available ? undefined : 'full'
      });
    }

    // Stop once we have 7 eligible days and have shown at least 10 total days
    if (eligibleCount >= 7 && days.length >= 10) break;
    cursor = addDubaiCalendarDays(cursor, 1);
  }

  return { days, orderItemCount, exceedsTruckCapacity: false, availableDates };
}

export async function getAvailableDatesForDeliveryId(
  db: DeliveryDb,
  deliveryId: string,
  items: string | null | undefined,
  metadata?: Record<string, unknown> | null
): Promise<{ availableDates: string[]; orderItemCount: number; exceedsTruckCapacity: boolean }> {
  const result = await getDateCapacityDetails(db, deliveryId, items, metadata);
  return {
    availableDates: result.availableDates,
    orderItemCount: result.orderItemCount,
    exceedsTruckCapacity: result.exceedsTruckCapacity
  };
}

export async function assertSlotAvailable(
  db: DeliveryDb,
  deliveryId: string,
  isoDate: string,
  items: string | null | undefined,
  metadata?: Record<string, unknown> | null
): Promise<void> {
  const orderItemCount = parseDeliveryItemCount(items, metadata);
  if (orderItemCount > TRUCK_MAX_ITEMS_PER_DAY) {
    throw new Error(
      `This order (${orderItemCount} units) exceeds the maximum truck load of ${TRUCK_MAX_ITEMS_PER_DAY} units per truck. Please contact support.`
    );
  }
  const allowed = getNextSevenEligibleDayIsoStrings();
  if (!allowed.includes(isoDate)) {
    throw new Error('Selected date is outside the allowed delivery window.');
  }
  if (getDubaiWeekday(isoDate) === 0) {
    throw new Error('Sunday is not available for delivery.');
  }
  if (isDubaiPublicHoliday(isoDate)) {
    throw new Error('The selected date is a UAE public holiday. Please choose another available date.');
  }
  const numDrivers = await countActiveDeliveryDrivers(db);
  const fleetDailyCapacity = numDrivers * TRUCK_MAX_ITEMS_PER_DAY;
  const used = await getTotalItemCountForDeliveryDate(db, isoDate, deliveryId);
  if (used + orderItemCount > fleetDailyCapacity) {
    throw new Error(
      `That delivery date is fully booked (${used}/${fleetDailyCapacity} units used). Please choose another available date.`
    );
  }
}
