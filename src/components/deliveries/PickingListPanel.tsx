import { useMemo, useState } from 'react';
import { PackageCheck, CheckCircle2, Zap, X } from 'lucide-react';
import type { Delivery } from '../../types';
import api from '../../frontend/apiClient';
import useDeliveryStore from '../../store/useDeliveryStore';
import { useToast } from '../../hooks/useToast';
import { isPickingListEligible } from '../../utils/pickingListFilter';

/**
 * Driver-side Picking List tab.
 *
 * Renders deliveries that are awaiting picking for the current driver.
 * Each card shows the order info and items list. The driver taps
 * "Confirm Pickup" → a confirmation dialog appears → on confirm the
 * order transitions to `pickup-confirmed` and moves to the My Orders tab.
 */

interface ParsedItem {
  index: number;
  label: string;
}

function parseItems(raw: string | null | undefined): ParsedItem[] {
  if (!raw) return [];
  const trimmed = String(raw).trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('[')) {
    try {
      const arr = JSON.parse(trimmed) as unknown[];
      if (Array.isArray(arr) && arr.length > 0) {
        return arr.map((entry, i) => {
          if (typeof entry === 'string') return { index: i, label: entry };
          if (entry && typeof entry === 'object') {
            const obj = entry as Record<string, unknown>;
            const label =
              (obj.description as string) ||
              (obj.name as string) ||
              (obj.item as string) ||
              (obj.label as string) ||
              JSON.stringify(obj);
            return { index: i, label };
          }
          return { index: i, label: String(entry) };
        });
      }
    } catch {
      // fall through to line-based parsing
    }
  }
  const lines = trimmed
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const parts = lines.length > 1
    ? lines
    : trimmed.split(/\s*[;,]\s*/).map((l) => l.trim()).filter(Boolean);
  return parts.map((label, i) => ({ index: i, label }));
}

function isPriority(d: Delivery): boolean {
  const meta = (d.metadata && typeof d.metadata === 'object')
    ? (d.metadata as unknown as Record<string, unknown>)
    : {};
  return meta.isPriority === true;
}

interface Props {
  /** All deliveries the driver currently has — we filter to pgi-done inside. */
  deliveries: Delivery[];
  /** Called after a successful confirm so the parent can refetch. */
  onConfirmed?: (deliveryId: string) => void;
}

export default function PickingListPanel({ deliveries, onConfirmed }: Props) {
  const confirmPickingList = useDeliveryStore((s) => s.confirmPickingList);
  const { success, error: toastError } = useToast();

  const pickingOrders = useMemo(() => {
    const list = deliveries.filter((d) => isPickingListEligible(d));
    list.sort((a, b) => {
      const pa = isPriority(a) ? 1 : 0;
      const pb = isPriority(b) ? 1 : 0;
      if (pa !== pb) return pb - pa;
      const ta = a.createdAt ? new Date(a.createdAt as string).getTime() : 0;
      const tb = b.createdAt ? new Date(b.createdAt as string).getTime() : 0;
      return ta - tb;
    });
    return list;
  }, [deliveries]);

  if (pickingOrders.length === 0) {
    return (
      <div className="pp-card p-6 text-center">
        <PackageCheck className="w-10 h-10 text-gray-400 mx-auto mb-2" />
        <div className="text-gray-700 dark:text-gray-200 font-medium">No orders to pick</div>
        <div className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Orders appear here once the warehouse posts goods issue (PGI).
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {pickingOrders.map((d) => (
        <PickingCard
          key={d.id}
          delivery={d}
          onConfirm={confirmPickingList}
          onSuccess={onConfirmed}
          onToastSuccess={success}
          onToastError={toastError}
        />
      ))}
    </div>
  );
}

interface PickingCardProps {
  delivery: Delivery;
  onConfirm: (id: string, confirmedBy?: string) => void;
  onSuccess?: (deliveryId: string) => void;
  onToastSuccess: (msg: string) => void;
  onToastError: (msg: string) => void;
}

function PickingCard({
  delivery,
  onConfirm,
  onSuccess,
  onToastSuccess,
  onToastError,
}: PickingCardProps) {
  const items = useMemo(() => parseItems(delivery.items), [delivery.items]);
  const [submitting, setSubmitting] = useState(false);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);

  async function handleConfirm(): Promise<void> {
    setShowConfirmDialog(false);
    setSubmitting(true);
    try {
      await api.post(`/deliveries/driver/${delivery.id}/picking/confirm`, {
        mispickReported: [],
        totalItems: items.length,
      });
      onConfirm(delivery.id);
      onToastSuccess(`Pickup confirmed — ${delivery.customer || 'order'}`);
      if (onSuccess) onSuccess(delivery.id);
    } catch (err: unknown) {
      onToastError(`Confirm failed — ${(err as Error).message}`);
    } finally {
      setSubmitting(false);
    }
  }

  const priority = isPriority(delivery);

  return (
    <>
      <div
        className={`pp-card overflow-hidden ${
          priority ? 'ring-2 ring-red-400 dark:ring-red-500/70' : ''
        }`}
      >
        <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-gradient-to-r from-amber-50 to-white dark:from-amber-900/20 dark:to-gray-900">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                {priority && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300">
                    <Zap className="w-3 h-3" />
                    URGENT
                  </span>
                )}
                {String(delivery.status || '').toLowerCase() === 'rescheduled' ? (
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-200">
                    Rescheduled · PGI Done
                  </span>
                ) : (
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
                    PGI Done
                  </span>
                )}
              </div>
              <div className="font-semibold text-gray-900 dark:text-gray-100 truncate">
                {delivery.customer || 'Unnamed customer'}
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                {delivery.poNumber ? `PO ${delivery.poNumber}` : delivery.deliveryNumber || delivery.id}
                {delivery.address ? ` — ${delivery.address}` : ''}
              </div>
            </div>
            {items.length > 0 && (
              <div className="text-right text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                {items.length} item{items.length !== 1 ? 's' : ''}
              </div>
            )}
          </div>
        </div>

        {items.length > 0 && (
          <div className="p-4 space-y-1.5">
            {items.map((item) => (
              <div
                key={item.index}
                className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800/40 text-sm text-gray-800 dark:text-gray-100"
              >
                <span className="text-gray-400 dark:text-gray-500 text-xs font-mono w-5 text-right flex-shrink-0">
                  {item.index + 1}.
                </span>
                <span className="min-w-0 truncate">{item.label}</span>
              </div>
            ))}
          </div>
        )}

        <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 flex items-center justify-end">
          <button
            type="button"
            onClick={() => setShowConfirmDialog(true)}
            disabled={submitting}
            className={`px-5 py-2.5 text-sm rounded-lg font-semibold transition-colors touch-manipulation ${
              !submitting
                ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm'
                : 'bg-gray-200 text-gray-500 cursor-not-allowed dark:bg-gray-700 dark:text-gray-400'
            }`}
          >
            {submitting ? 'Confirming...' : 'Confirm Pickup'}
          </button>
        </div>
      </div>

      {/* Confirmation Dialog */}
      {showConfirmDialog && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-sm w-full overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700">
              <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">Confirm Pickup</h3>
              <button
                type="button"
                onClick={() => setShowConfirmDialog(false)}
                className="p-1 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="px-5 py-4">
              <p className="text-sm text-gray-700 dark:text-gray-300">
                Are you sure you have picked up the order for{' '}
                <span className="font-semibold text-gray-900 dark:text-gray-100">
                  {delivery.customer || 'this customer'}
                </span>
                {delivery.poNumber ? ` (PO ${delivery.poNumber})` : ''}?
              </p>
              {items.length > 0 && (
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                  {items.length} item{items.length !== 1 ? 's' : ''} will be marked as picked up.
                </p>
              )}
            </div>
            <div className="flex gap-3 px-5 py-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50">
              <button
                type="button"
                onClick={() => setShowConfirmDialog(false)}
                className="flex-1 px-4 py-2.5 text-sm font-medium rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleConfirm()}
                className="flex-1 px-4 py-2.5 text-sm font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition-colors"
              >
                Yes, Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
