import { useMemo, useState } from 'react';
import { PackageCheck, Zap, X } from 'lucide-react';
import type { Delivery } from '../../types';
import api from '../../frontend/apiClient';
import useDeliveryStore from '../../store/useDeliveryStore';
import { useToast } from '../../hooks/useToast';
import { isPickingListEligible } from '../../utils/pickingListFilter';
import {
  displayModelForOps,
  displayMaterialForOps,
  displayPoNumber,
  displayDeliveryNumber,
  getDeliveryOriginalRow,
} from '../../utils/deliveryDisplayFields';

/**
 * Driver-side Picking List tab.
 *
 * Renders deliveries that are awaiting picking for the current driver.
 * Each card shows Model, Quantity, Material, PO, Delivery Number,
 * Delivery Date, and Delivery Address. The driver taps "Confirm Pickup"
 * → a confirmation dialog appears → on confirm the order transitions
 * to `pickup-confirmed` and moves to the My Orders tab.
 */

function isPriority(d: Delivery): boolean {
  const meta = (d.metadata && typeof d.metadata === 'object')
    ? (d.metadata as unknown as Record<string, unknown>)
    : {};
  return meta.isPriority === true;
}

function displayQty(delivery: Delivery): string {
  const orig = getDeliveryOriginalRow(delivery);
  const v =
    orig['Order Quantity'] ??
    orig['Confirmed quantity'] ??
    orig['Total Line Deliv. Qt'] ??
    orig['Order Qty'] ??
    orig['Quantity'] ??
    orig['qty'] ??
    null;
  if (v == null) return '—';
  const s = String(v).trim();
  return s || '—';
}

function formatDate(value: unknown): string {
  if (!value) return '—';
  const d = new Date(String(value));
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Dubai',
  });
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
  const [submitting, setSubmitting] = useState(false);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);

  const model = displayModelForOps(delivery);
  const material = displayMaterialForOps(delivery);
  const po = displayPoNumber(delivery);
  const deliveryNum = displayDeliveryNumber(delivery);
  const qty = displayQty(delivery);
  const deliveryDate = formatDate(
    delivery.confirmedDeliveryDate ?? delivery.goodsMovementDate,
  );

  async function handleConfirm(): Promise<void> {
    setShowConfirmDialog(false);
    setSubmitting(true);
    try {
      await api.post(`/deliveries/driver/${delivery.id}/picking/confirm`, {
        mispickReported: [],
        totalItems: 0,
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
        {/* Header */}
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
                    Rescheduled
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
            </div>
          </div>
        </div>

        {/* Order details grid */}
        <div className="p-4">
          <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-sm">
            <DetailRow label="Model" value={model} />
            <DetailRow label="Qty" value={qty} />
            <DetailRow label="Material" value={material} />
            <DetailRow label="PO" value={po} />
            <DetailRow label="Delivery No." value={deliveryNum} />
            <DetailRow label="Delivery Date" value={deliveryDate} />
          </div>
          <div className="mt-3 pt-2.5 border-t border-gray-100 dark:border-gray-700">
            <DetailRow label="Delivery Address" value={delivery.address || '—'} full />
          </div>
        </div>

        {/* Confirm button */}
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
                ?
              </p>
              <div className="mt-3 text-xs text-gray-500 dark:text-gray-400 space-y-1">
                {po !== '—' && <div>PO: {po}</div>}
                {deliveryNum !== '—' && <div>Delivery No: {deliveryNum}</div>}
                {model !== '—' && <div>Model: {model}</div>}
              </div>
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

function DetailRow({ label, value, full }: { label: string; value: string; full?: boolean }) {
  return (
    <div className={full ? 'col-span-2' : ''}>
      <div className="text-[11px] uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-0.5">
        {label}
      </div>
      <div className="text-gray-900 dark:text-gray-100 font-medium truncate" title={value}>
        {value}
      </div>
    </div>
  );
}
