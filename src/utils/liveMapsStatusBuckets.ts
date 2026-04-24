/**
 * Shared status-bucket classifier for the Live Maps sub-tab in the
 * Logistics + Delivery team portals.
 *
 * Goal: one canonical rulebook for "which bucket does this delivery
 * belong to on the live map" so the list grouping, the counts, and the
 * map pin colouring can never drift. Pure functions only — no side
 * effects, no I/O.
 */

export type LiveMapBucket =
  | 'overdue'          // not delivered, promised date has passed
  | 'on_route_delayed' // out-for-delivery / in-transit, ETA > end-of-day
  | 'on_route'         // out-for-delivery / in-transit, on time
  | 'awaiting_pickup'  // pickup-confirmed, today's date
  | 'confirmed_today'  // confirmed / scheduled-confirmed / rescheduled, today
  | 'confirmed_future' // same as above, future date
  | 'other';           // doesn't belong in any explicit bucket (fallback)

export interface BucketMeta {
  label: string;
  color: string;              // hex — used for bucket-header accent
  bgClass: string;            // tailwind bg class for bucket header chip
  textClass: string;          // tailwind text class
  borderClass: string;        // tailwind border class for card-left accent
  shortLabel?: string;        // terse form for space-constrained chips
  /** Lower = higher priority in sort ordering. */
  sortOrder: number;
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
  confirmed_future: {
    label: 'Confirmed — Future',
    shortLabel: 'Future',
    color: '#64748b',
    bgClass: 'bg-slate-100 dark:bg-slate-700',
    textClass: 'text-slate-700 dark:text-slate-300',
    borderClass: 'border-l-4 border-slate-400',
    sortOrder: 6,
  },
  other: {
    label: 'Other',
    color: '#9ca3af',
    bgClass: 'bg-gray-100 dark:bg-gray-700',
    textClass: 'text-gray-600 dark:text-gray-300',
    borderClass: 'border-l-4 border-gray-300',
    sortOrder: 7,
  },
};

/** Ordered list of buckets (highest-priority first) for stable iteration. */
export const BUCKET_ORDER: LiveMapBucket[] = [
  'overdue',
  'on_route_delayed',
  'on_route',
  'awaiting_pickup',
  'confirmed_today',
  'confirmed_future',
  'other',
];

interface ClassifyInput {
  status?: string | null;
  confirmedDeliveryDate?: string | Date | null;
  goodsMovementDate?: string | Date | null;
  /** Minutes from "now" to estimated arrival, if driver has live GPS. */
  etaMinutes?: number | null;
}

function dubaiDayStr(v: Date | string | null | undefined): string | null {
  if (!v) return null;
  const dt = v instanceof Date ? v : new Date(v);
  if (isNaN(dt.getTime())) return null;
  const z = new Date(dt.toLocaleString('en-US', { timeZone: 'Asia/Dubai' }));
  return `${z.getFullYear()}-${String(z.getMonth() + 1).padStart(2, '0')}-${String(z.getDate()).padStart(2, '0')}`;
}

/**
 * Classifies a delivery into one of the LiveMapBucket values above.
 * The exact rulebook is documented inline so the list UI, the map pin
 * styling, and any future bucket-count widgets read the same source.
 */
export function classifyForLiveMap(input: ClassifyInput): LiveMapBucket {
  const status = (input.status || '').toLowerCase();
  const bucketDateStr = dubaiDayStr(input.confirmedDeliveryDate ?? input.goodsMovementDate ?? null);
  const today = dubaiDayStr(new Date());

  const isActiveOnRoute = ['out-for-delivery', 'out_for_delivery', 'in-transit', 'in-progress'].includes(status);
  const isOrderDelay = status === 'order-delay' || status === 'order_delay';
  const isPickupConfirmed = status === 'pickup-confirmed' || status === 'pickup_confirmed';
  const isConfirmedPreDispatch = ['confirmed', 'scheduled-confirmed', 'rescheduled'].includes(status);
  const isPast = !!(bucketDateStr && today && bucketDateStr < today);
  const isToday = !!(bucketDateStr && today && bucketDateStr === today);

  // 1. Overdue trumps everything — promised date is past and delivery
  //    hasn't flipped to a terminal status yet.
  if (isPast && !['delivered', 'delivered-with-installation', 'delivered-without-installation', 'pod-completed', 'finished', 'completed', 'cancelled', 'rejected', 'returned'].includes(status)) {
    return 'overdue';
  }

  // 2. On-route (active driver): split on live ETA vs promised end-of-day.
  if (isActiveOnRoute || isOrderDelay) {
    if (typeof input.etaMinutes === 'number' && input.etaMinutes >= 0 && bucketDateStr) {
      const eod = new Date(`${bucketDateStr}T16:00:00Z`); // 20:00 Dubai = 16:00 UTC
      const etaMs = Date.now() + input.etaMinutes * 60_000;
      return etaMs > eod.getTime() ? 'on_route_delayed' : 'on_route';
    }
    return isOrderDelay ? 'on_route_delayed' : 'on_route';
  }

  // 3. Pickup-confirmed and the driver hasn't tapped Start Delivery yet.
  if (isPickupConfirmed) {
    return isToday ? 'awaiting_pickup' : 'confirmed_future';
  }

  // 4. Admin-confirmed, awaiting dispatch.
  if (isConfirmedPreDispatch) {
    return isToday ? 'confirmed_today' : 'confirmed_future';
  }

  return 'other';
}
