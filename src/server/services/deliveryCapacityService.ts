/**
 * Truck capacity: max pieces per route/day, customer date window (7 eligible days, no Sunday).
 * Uses Asia/Dubai for calendar boundaries.
 */

import type { PrismaClient } from '@prisma/client';

/** Prisma client or transaction client — both expose `delivery`. */
type DeliveryDb = Pick<PrismaClient, 'delivery'>;

export const TRUCK_MAX_ITEMS_PER_DAY = Math.max(
  1,
  Number.parseInt(process.env.TRUCK_MAX_ITEMS_PER_DAY || '30', 10) || 30
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
 * Next 7 eligible delivery days: skip Sundays only; start from tomorrow (Dubai).
 */
export function getNextSevenEligibleDayIsoStrings(): string[] {
  const out: string[] = [];
  let cursor = addDubaiCalendarDays(getDubaiTodayIso(), 1);
  while (out.length < 7) {
    if (getDubaiWeekday(cursor) !== 0) {
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
 * Piece count for capacity: sum line quantities when present, else line count. Minimum 1.
 */
export function parseDeliveryItemCount(
  items: string | null | undefined,
  metadata?: Record<string, unknown> | null
): number {
  if (metadata?.originalQuantity != null) {
    const q = num(metadata.originalQuantity);
    if (q > 0) return Math.min(9999, Math.ceil(q));
  }
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
            num(o.Quantity) ||
            num(o.quantity) ||
            num(o.qty) ||
            num(o.Qty) ||
            num(o['Confirmed quantity']);
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
 * Sum piece counts for deliveries confirmed on this Dubai calendar day (excluding one delivery).
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

export async function getAvailableDatesForDeliveryId(
  db: DeliveryDb,
  deliveryId: string,
  items: string | null | undefined,
  metadata?: Record<string, unknown> | null
): Promise<{ availableDates: string[]; orderItemCount: number; exceedsTruckCapacity: boolean }> {
  const orderItemCount = parseDeliveryItemCount(items, metadata);
  if (orderItemCount > TRUCK_MAX_ITEMS_PER_DAY) {
    return { availableDates: [], orderItemCount, exceedsTruckCapacity: true };
  }

  const candidates = getNextSevenEligibleDayIsoStrings();
  const availableDates: string[] = [];

  for (const iso of candidates) {
    const used = await getTotalItemCountForDeliveryDate(db, iso, deliveryId);
    if (used + orderItemCount <= TRUCK_MAX_ITEMS_PER_DAY) {
      availableDates.push(iso);
    }
  }

  return { availableDates, orderItemCount, exceedsTruckCapacity: false };
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
      `This order (${orderItemCount} pcs) exceeds the maximum truck load (${TRUCK_MAX_ITEMS_PER_DAY} pcs). Please contact support.`
    );
  }
  const allowed = getNextSevenEligibleDayIsoStrings();
  if (!allowed.includes(isoDate)) {
    throw new Error('Selected date is outside the allowed delivery window.');
  }
  if (getDubaiWeekday(isoDate) === 0) {
    throw new Error('Sunday is not available for delivery.');
  }
  const used = await getTotalItemCountForDeliveryDate(db, isoDate, deliveryId);
  if (used + orderItemCount > TRUCK_MAX_ITEMS_PER_DAY) {
    throw new Error(
      'That delivery date is fully booked. Please choose another available date.'
    );
  }
}
