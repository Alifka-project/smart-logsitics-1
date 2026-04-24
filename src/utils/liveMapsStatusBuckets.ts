/**
 * Shared status-bucket classifier for the Live Maps sub-tab in the
 * Logistics + Delivery team portals.
 *
 * Rule (date-first for non-terminal orders):
 *   Any delivery that isn't delivered / cancelled / returned / failed is
 *   classified primarily by its Dubai calendar date, regardless of the
 *   warehouse stage (pgi-done, pickup-confirmed, confirmed, rescheduled,
 *   out-for-delivery). This lets ops monitor "what do we owe customers
 *   tomorrow?" in a single sweep across the list.
 *
 * Priority:
 *   1. Terminal / cancelled / returned / failed → 'other' (filtered out
 *      of Live Maps anyway; kept as fallback).
 *   2. Actively on-route (out-for-delivery / in-transit / in-progress /
 *      explicit order-delay) → split by live ETA vs end-of-day:
 *        · past date → overdue
 *        · live ETA > end-of-day → on_route_delayed
 *        · otherwise → on_route
 *   3. Everything else (non-terminal, not on-route) classified by date:
 *        · past date → overdue
 *        · today + pickup-confirmed → awaiting_pickup
 *        · today + anything else non-terminal → confirmed_today
 *        · tomorrow → next_shipment
 *        · 2+ days → future_schedule
 *        · no date → other
 */

export type LiveMapBucket =
  | 'overdue'           // promised date past, not delivered
  | 'on_route_delayed'  // out-for-delivery, ETA > end-of-day
  | 'on_route'          // out-for-delivery, on time
  | 'awaiting_pickup'   // pickup-confirmed, today
  | 'confirmed_today'   // any non-terminal, today (non pickup-confirmed)
  | 'next_shipment'     // any non-terminal, tomorrow (Dubai)
  | 'future_schedule'   // any non-terminal, 2+ days out
  | 'other';            // fallback / terminal / no date

export interface BucketMeta {
  label: string;
  color: string;               // hex — used for header left-border accent
  bgClass: string;             // tailwind bg class for header chip
  textClass: string;           // tailwind text class
  borderClass: string;         // left-border class for card accent
  shortLabel?: string;
  sortOrder: number;           // lower = higher priority in sort
}

export const BUCKET_META: Record<LiveMapBucket, BucketMeta> = {
  overdue: {
    label: 'Overdue',
    color: '#dc2626',
    bgClass: 'bg-red-100 dark:bg-red-900/40',
    textClass: 'text-red-700 dark:text-red-300',
    borderClass: 'border-l-4 border-red-500',
    sortOrder: 1,
  },
  on_route_delayed: {
    label: 'On Route — Delayed',
    shortLabel: 'Delayed',
    color: '#f97316',
    bgClass: 'bg-orange-100 dark:bg-orange-900/40',
    textClass: 'text-orange-700 dark:text-orange-300',
    borderClass: 'border-l-4 border-orange-500',
    sortOrder: 2,
  },
  on_route: {
    label: 'On Route',
    color: '#2563eb',
    bgClass: 'bg-blue-100 dark:bg-blue-900/40',
    textClass: 'text-blue-700 dark:text-blue-300',
    borderClass: 'border-l-4 border-blue-500',
    sortOrder: 3,
  },
  awaiting_pickup: {
    label: 'Awaiting Pickup',
    color: '#0d9488',
    bgClass: 'bg-teal-100 dark:bg-teal-900/40',
    textClass: 'text-teal-700 dark:text-teal-300',
    borderClass: 'border-l-4 border-teal-500',
    sortOrder: 4,
  },
  confirmed_today: {
    label: 'Confirmed — Today',
    shortLabel: 'Today',
    color: '#6366f1',
    bgClass: 'bg-indigo-100 dark:bg-indigo-900/40',
    textClass: 'text-indigo-700 dark:text-indigo-300',
    borderClass: 'border-l-4 border-indigo-500',
    sortOrder: 5,
  },
  next_shipment: {
    label: 'Next Shipment',
    color: '#f59e0b',
    bgClass: 'bg-amber-100 dark:bg-amber-900/40',
    textClass: 'text-amber-700 dark:text-amber-300',
    borderClass: 'border-l-4 border-amber-500',
    sortOrder: 6,
  },
  future_schedule: {
    label: 'Future Schedule',
    color: '#6366f1',
    bgClass: 'bg-indigo-100 dark:bg-indigo-900/40',
    textClass: 'text-indigo-700 dark:text-indigo-300',
    borderClass: 'border-l-4 border-indigo-500',
    sortOrder: 7,
  },
  other: {
    label: 'Other',
    color: '#9ca3af',
    bgClass: 'bg-gray-100 dark:bg-gray-700',
    textClass: 'text-gray-600 dark:text-gray-300',
    borderClass: 'border-l-4 border-gray-300',
    sortOrder: 8,
  },
};

/** Ordered list of buckets (highest-priority first) for stable iteration. */
export const BUCKET_ORDER: LiveMapBucket[] = [
  'overdue',
  'on_route_delayed',
  'on_route',
  'awaiting_pickup',
  'confirmed_today',
  'next_shipment',
  'future_schedule',
  'other',
];

interface ClassifyInput {
  status?: string | null;
  confirmedDeliveryDate?: string | Date | null;
  goodsMovementDate?: string | Date | null;
  /** Minutes from now to estimated arrival, if driver has live GPS. */
  etaMinutes?: number | null;
}

/** Return the Dubai calendar-day string (YYYY-MM-DD) for a Date/ISO, or null. */
function dubaiDayStr(v: Date | string | null | undefined): string | null {
  if (!v) return null;
  const dt = v instanceof Date ? v : new Date(v);
  if (isNaN(dt.getTime())) return null;
  const z = new Date(dt.toLocaleString('en-US', { timeZone: 'Asia/Dubai' }));
  return `${z.getFullYear()}-${String(z.getMonth() + 1).padStart(2, '0')}-${String(z.getDate()).padStart(2, '0')}`;
}

/** Day offset of `target` relative to `today` in Dubai. Negative = past, 0 = today, positive = future. */
function dubaiDayOffset(target: string, today: string): number {
  const [ty, tm, td] = target.split('-').map(Number);
  const [cy, cm, cd] = today.split('-').map(Number);
  const tMs = Date.UTC(ty, tm - 1, td);
  const cMs = Date.UTC(cy, cm - 1, cd);
  return Math.round((tMs - cMs) / 86_400_000);
}

const TERMINAL_STATUSES = new Set([
  'delivered',
  'delivered-with-installation',
  'delivered-without-installation',
  'pod-completed',
  'finished',
  'completed',
  'cancelled',
  'rejected',
  'returned',
  'failed',
]);

const ACTIVE_ROUTE_STATUSES = new Set([
  'out-for-delivery',
  'out_for_delivery',
  'in-transit',
  'in-progress',
]);

/**
 * Classifies a delivery into one of the LiveMapBucket values above.
 */
export function classifyForLiveMap(input: ClassifyInput): LiveMapBucket {
  const status = (input.status || '').toLowerCase();

  // 1. Terminal → filtered out of Live Maps anyway. Bucket 'other' as a
  //    safe fallback.
  if (TERMINAL_STATUSES.has(status)) return 'other';

  const bucketDateStr = dubaiDayStr(input.confirmedDeliveryDate ?? input.goodsMovementDate ?? null);
  const today = dubaiDayStr(new Date())!;
  const dayOffset = bucketDateStr ? dubaiDayOffset(bucketDateStr, today) : null;
  const isPast = dayOffset != null && dayOffset < 0;
  const isToday = dayOffset === 0;
  const isTomorrow = dayOffset === 1;

  // 2. Actively on-route — split by live ETA vs end-of-day.
  const isActiveOnRoute = ACTIVE_ROUTE_STATUSES.has(status);
  const isOrderDelay = status === 'order-delay' || status === 'order_delay';
  if (isActiveOnRoute || isOrderDelay) {
    if (isPast) return 'overdue';
    if (typeof input.etaMinutes === 'number' && input.etaMinutes >= 0 && bucketDateStr) {
      // End-of-day Dubai 20:00 UTC
      const [by, bm, bd] = bucketDateStr.split('-').map(Number);
      const eodUtcMs = Date.UTC(by, bm - 1, bd, 20, 0, 0, 0);
      const etaMs = Date.now() + input.etaMinutes * 60_000;
      return etaMs > eodUtcMs ? 'on_route_delayed' : 'on_route';
    }
    return isOrderDelay ? 'on_route_delayed' : 'on_route';
  }

  // 3. Non-terminal, not on-route → classify by DATE TIER.
  //    Works uniformly for pgi-done, pickup-confirmed, confirmed,
  //    scheduled-confirmed, rescheduled, etc.
  if (isPast) return 'overdue';

  const isPickupConfirmed = status === 'pickup-confirmed' || status === 'pickup_confirmed';
  if (isToday) {
    return isPickupConfirmed ? 'awaiting_pickup' : 'confirmed_today';
  }
  if (isTomorrow) return 'next_shipment';
  if (dayOffset != null && dayOffset >= 2) return 'future_schedule';

  // No date at all → fallback.
  return 'other';
}
