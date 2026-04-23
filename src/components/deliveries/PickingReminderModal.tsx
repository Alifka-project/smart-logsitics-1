import React, { useMemo } from 'react';
import { AlertTriangle, Calendar, Package, X } from 'lucide-react';
import type { Delivery } from '../../types';

interface PickingReminderModalProps {
  isOpen: boolean;
  onDismiss: () => void;
  onOpenPickingList: () => void;
  pendingOrders: Delivery[];
}

/**
 * Format a Date into a YYYY-MM-DD calendar-day string in Dubai TZ.
 * Matches the comparison pattern used elsewhere (server picking-confirm,
 * driver /deliveries write-on-read) so urgency classification is consistent.
 */
function dubaiDayString(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const dt = value instanceof Date ? value : new Date(value);
  if (isNaN(dt.getTime())) return null;
  const z = new Date(dt.toLocaleString('en-US', { timeZone: 'Asia/Dubai' }));
  return `${z.getFullYear()}-${String(z.getMonth() + 1).padStart(2, '0')}-${String(z.getDate()).padStart(2, '0')}`;
}

interface UrgencyBuckets {
  today: number;
  tomorrow: number;
  future: number;
}

function computeUrgencyBuckets(orders: Delivery[]): UrgencyBuckets {
  const now = new Date();
  const todayStr = dubaiDayString(now);
  const tomorrowDt = new Date(now);
  tomorrowDt.setDate(tomorrowDt.getDate() + 1);
  const tomorrowStr = dubaiDayString(tomorrowDt);

  let today = 0;
  let tomorrow = 0;
  let future = 0;
  for (const d of orders) {
    const rec = d as unknown as Record<string, unknown>;
    const raw = (rec.confirmedDeliveryDate ?? rec.goodsMovementDate) as Date | string | null | undefined;
    const dateStr = dubaiDayString(raw);
    if (!dateStr) { future++; continue; }
    if (todayStr && dateStr === todayStr) today++;
    else if (tomorrowStr && dateStr === tomorrowStr) tomorrow++;
    else future++;
  }
  return { today, tomorrow, future };
}

function getOrderDateMs(d: Delivery): number {
  const rec = d as unknown as Record<string, unknown>;
  const v = (rec.confirmedDeliveryDate ?? rec.goodsMovementDate ?? rec.createdAt) as Date | string | null | undefined;
  if (!v) return Number.POSITIVE_INFINITY;
  const dt = v instanceof Date ? v : new Date(String(v));
  return isNaN(dt.getTime()) ? Number.POSITIVE_INFINITY : dt.getTime();
}

export default function PickingReminderModal({
  isOpen,
  onDismiss,
  onOpenPickingList,
  pendingOrders,
}: PickingReminderModalProps): React.ReactElement | null {
  // Compute derived state unconditionally so hooks order is stable across renders.
  const { today, tomorrow, future } = useMemo(
    () => computeUrgencyBuckets(pendingOrders),
    [pendingOrders],
  );

  const mostUrgent = useMemo<Delivery | null>(() => {
    if (pendingOrders.length === 0) return null;
    return [...pendingOrders].sort((a, b) => getOrderDateMs(a) - getOrderDateMs(b))[0];
  }, [pendingOrders]);

  if (!isOpen) return null;
  if (pendingOrders.length === 0) return null;

  const isUrgent = today > 0;
  const count = pendingOrders.length;

  const mostCustomer = mostUrgent?.customer?.trim() || '—';
  const mostPO = mostUrgent?.poNumber ? `PO #${mostUrgent.poNumber}` : '';
  const mostArea = (() => {
    const addr = mostUrgent?.address;
    if (typeof addr !== 'string') return '';
    const tail = addr.split(',').pop();
    return tail ? tail.trim() : '';
  })();

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
      onClick={onDismiss}
      role="dialog"
      aria-modal="true"
      aria-label="Picking list reminder"
    >
      <div
        className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl max-w-md w-full p-6 relative"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="absolute top-3 right-3 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
          onClick={onDismiss}
          aria-label="Close reminder"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-start gap-3 mb-4">
          <div className={`p-2 rounded-full ${isUrgent ? 'bg-red-100 dark:bg-red-900/30' : 'bg-blue-100 dark:bg-blue-900/30'}`}>
            {isUrgent
              ? <AlertTriangle className="w-6 h-6 text-red-600 dark:text-red-400" />
              : <Package className="w-6 h-6 text-blue-600 dark:text-blue-400" />}
          </div>
          <div>
            <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">
              {isUrgent ? 'Urgent — Picking Pending' : 'Picking List Reminder'}
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              Please confirm picking for these orders.
            </p>
          </div>
        </div>

        <div className="mb-4">
          <div className="text-3xl font-bold text-gray-900 dark:text-gray-100 mb-2">
            {count} {count === 1 ? 'order' : 'orders'} waiting
          </div>
          <ul className="space-y-1 text-sm">
            {today > 0 && (
              <li className="flex items-center gap-2 text-red-700 dark:text-red-300 font-semibold">
                <AlertTriangle className="w-4 h-4" />
                <span>{today} scheduled for <strong>TODAY</strong></span>
              </li>
            )}
            {tomorrow > 0 && (
              <li className="flex items-center gap-2 text-amber-700 dark:text-amber-300">
                <Calendar className="w-4 h-4" />
                <span>{tomorrow} scheduled for tomorrow</span>
              </li>
            )}
            {future > 0 && (
              <li className="flex items-center gap-2 text-gray-600 dark:text-gray-400">
                <Calendar className="w-4 h-4" />
                <span>{future} scheduled later</span>
              </li>
            )}
          </ul>
        </div>

        {mostUrgent && (
          <div className="mb-5 p-3 rounded-lg bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
            <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Most urgent</div>
            <div className="font-semibold text-gray-900 dark:text-gray-100">{mostCustomer}</div>
            <div className="text-xs text-gray-600 dark:text-gray-400">
              {[mostPO, mostArea].filter(Boolean).join(' · ') || ' '}
            </div>
          </div>
        )}

        <div className="flex gap-2">
          <button
            type="button"
            className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 rounded-lg transition-colors"
            onClick={onOpenPickingList}
          >
            Open Picking List
          </button>
          <button
            type="button"
            className="px-4 py-2.5 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 font-semibold rounded-lg transition-colors"
            onClick={onDismiss}
          >
            Later
          </button>
        </div>

        <div className="mt-3 text-xs text-gray-400 dark:text-gray-500 text-center">
          Next reminder in 2 hours
        </div>
      </div>
    </div>
  );
}
