import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import api from '../../frontend/apiClient';
import type { Delivery } from '../../types';
import type { DeliveryOrder } from '../../types/delivery';
import { deliveryToManageOrder } from '../../utils/deliveryWorkflowMap';

// ── Phase-aware dropdown options ─────────────────────────────────────────────
// Phase 1: Before customer confirms (file uploaded, pending, scheduled)
const PHASE_PRE_CONFIRM = new Set(['pending', 'uploaded', 'scheduled']);
// Phase 2: After customer confirms / admin set confirmation date
const PHASE_CONFIRMED = new Set(['confirmed', 'scheduled-confirmed', 'rescheduled']);
// Phase 3: After PGI Done
const PHASE_POST_PGI = new Set([
  'pgi-done', 'pgi_done', 'pickup-confirmed', 'pickup_confirmed',
  'out-for-delivery', 'in-transit', 'in-progress',
]);

function getStatusPhase(status: string): 1 | 2 | 3 | 0 {
  const s = status.toLowerCase();
  if (PHASE_PRE_CONFIRM.has(s)) return 1;
  if (PHASE_CONFIRMED.has(s)) return 2;
  if (PHASE_POST_PGI.has(s)) return 3;
  return 0; // terminal or unknown
}

type StatusOption = { value: string; label: string };

const PHASE1_OPTIONS: StatusOption[] = [
  { value: 'confirmed', label: 'Confirmed Tomorrow / Soon' },
  { value: 'scheduled-confirmed', label: 'Confirmed Future Date' },
  { value: 'cancelled', label: 'Cancelled' },
];
const PHASE2_OPTIONS: StatusOption[] = [
  { value: 'rescheduled', label: 'Rescheduled' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'pgi-done', label: 'PGI Done' },
];
const PHASE3_OPTIONS: StatusOption[] = [
  { value: 'rescheduled', label: 'Rescheduled' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'delivered', label: 'Delivered' },
];

function getAvailableOptions(phase: 1 | 2 | 3 | 0, currentStatus: string): StatusOption[] {
  const currentLabel = currentStatus.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  const currentOpt: StatusOption = { value: currentStatus, label: `${currentLabel} (current)` };
  switch (phase) {
    case 1: return [currentOpt, ...PHASE1_OPTIONS];
    case 2: return [currentOpt, ...PHASE2_OPTIONS];
    case 3: return [currentOpt, ...PHASE3_OPTIONS];
    default: return [currentOpt];
  }
}

function toDateInputValue(d: Date): string {
  const x = new Date(d);
  x.setMinutes(x.getMinutes() - x.getTimezoneOffset());
  return x.toISOString().slice(0, 10);
}

interface OrderEditModalProps {
  delivery: Delivery;
  onClose: () => void;
  onSaved: (updated: { status: string; notes?: string; scheduledDateIso?: string; goodsMovementDate?: string; address?: string; phone?: string }) => void;
  onToastError: (message: string) => void;
  onResendSMS?: () => Promise<void>;
  onReschedule?: (newDate: Date, reason: string) => Promise<void>;
  onDispatch?: () => Promise<void>;
}

export const OrderEditModal: React.FC<OrderEditModalProps> = ({
  delivery,
  onClose,
  onSaved,
  onToastError,
  onResendSMS,
  onReschedule,
  onDispatch,
}) => {
  const order: DeliveryOrder = useMemo(() => deliveryToManageOrder(delivery), [delivery]);

  const initialStatus = (delivery.status || 'pending').toLowerCase();
  const phase = getStatusPhase(initialStatus);
  const availableOptions = useMemo(() => getAvailableOptions(phase, initialStatus), [phase, initialStatus]);

  const [apiStatus, setApiStatus] = useState(initialStatus);
  const [notes, setNotes] = useState(
    (delivery.deliveryNotes || delivery.conditionNotes || '')?.toString() ?? '',
  );
  const [dateStr, setDateStr] = useState(() => {
    const t = order.scheduledDate;
    if (t) return toDateInputValue(t);
    return '';
  });
  const [saving, setSaving] = useState(false);
  const [phone, setPhone] = useState(delivery.phone?.toString() ?? '');
  const [address, setAddress] = useState(delivery.address?.trim() ?? '');
  const [sendingSms, setSendingSms] = useState(false);
  const [dispatching, setDispatching] = useState(false);
  const [rescheduleDate, setRescheduleDate] = useState('');
  const [rescheduleReason, setRescheduleReason] = useState('');

  const existingGMD = (delivery as unknown as { goodsMovementDate?: string | Date | null }).goodsMovementDate;
  const [gmdStr, setGmdStr] = useState(() => {
    if (!existingGMD) return '';
    const d = new Date(existingGMD as string);
    return isNaN(d.getTime()) ? '' : toDateInputValue(d);
  });

  const hasGMD = !!(gmdStr.trim() || existingGMD);
  // All post-PGI statuses require GMD — pgi-done is by definition "GMD posted",
  // pickup-confirmed / out-for-delivery / in-transit all live downstream of it.
  const DISPATCH_STATUSES = new Set([
    'pgi-done', 'pgi_done',
    'pickup-confirmed', 'pickup_confirmed',
    'out-for-delivery', 'in-transit', 'in-progress',
  ]);
  const canSave = !saving && !(DISPATCH_STATUSES.has(apiStatus) && !hasGMD);

  useEffect(() => {
    const html = document.documentElement;
    const prevBody = document.body.style.overflow;
    const prevHtml = html.style.overflow;
    document.body.style.overflow = 'hidden';
    html.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevBody;
      html.style.overflow = prevHtml;
    };
  }, []);

  const handleSave = async (): Promise<void> => {
    if (!apiStatus.trim()) {
      onToastError('Please select a status.');
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        status: apiStatus,
        notes: notes.trim() || undefined,
        customer: delivery.customer ?? undefined,
        address: delivery.address ?? undefined,
      };
      if (phone.trim()) payload.phone = phone.trim();
      if (address.trim()) payload.address = address.trim();
      if (dateStr.trim()) {
        payload.scheduledDate = new Date(dateStr + 'T12:00:00').toISOString();
      }
      if (gmdStr.trim()) {
        payload.goodsMovementDate = new Date(gmdStr + 'T12:00:00').toISOString();
      }

      const response = await api.put(`/deliveries/admin/${delivery.id}/status`, payload);

      if (response.data && (response.data as { ok?: boolean }).ok) {
        const scheduledDateIso =
          dateStr.trim() ? new Date(dateStr + 'T12:00:00').toISOString() : undefined;
        const goodsMovementDate =
          gmdStr.trim() ? new Date(gmdStr + 'T12:00:00').toISOString() : undefined;

        // WhatsApp notification sent silently by backend (no popup needed)
        onSaved({
          status: apiStatus,
          notes: notes.trim() || undefined,
          scheduledDateIso,
          goodsMovementDate,
          address: address.trim() || undefined,
          phone: phone.trim() || undefined,
        });
        onClose();
      } else {
        const err = (response.data as { error?: string })?.error ?? 'Update failed';
        onToastError(err);
      }
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string; error?: string } }; message?: string };
      onToastError(
        err.response?.data?.detail || err.response?.data?.error || err.message || 'Failed to update delivery',
      );
    } finally {
      setSaving(false);
    }
  };

  const modal = (
    <div
      className="pp-modal-backdrop fixed inset-0 z-[10050] flex items-center justify-center bg-black/50 p-4 sm:p-6"
      role="presentation"
    >
      <div
        className="pp-modal-card flex max-h-[min(92vh,780px)] w-full max-w-md flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-800"
        role="dialog"
        aria-modal="true"
        aria-labelledby="order-edit-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 border-b border-gray-100 px-4 py-3 dark:border-gray-700">
          <div className="flex items-center justify-between gap-2">
            <h2 id="order-edit-title" className="text-lg font-semibold text-gray-900 dark:text-white">
              Update Status
            </h2>
            <button
              type="button"
              onClick={onClose}
              className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700"
              aria-label="Close"
            >
              ✕
            </button>
          </div>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {order.customerName}
          </p>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4">
          {/* POD Photos — shown when driver has uploaded proof of delivery */}
          {(() => {
            const pod = delivery as unknown as {
              photos?: Array<{ url?: string } | string>;
              driverSignature?: string;
              podCompletedAt?: string | Date;
            };
            const photos = pod.photos ?? [];
            const sig = pod.driverSignature;
            const completedAt = pod.podCompletedAt;
            if (photos.length === 0 && !sig) return null;
            const fmtTs = (ts: string | Date) => {
              const d = new Date(ts);
              return isNaN(d.getTime()) ? String(ts) : d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
            };
            return (
              <div className="rounded-lg border border-teal-200 dark:border-teal-700/50 bg-teal-50 dark:bg-teal-900/10 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-teal-700 dark:text-teal-300">Proof of Delivery</p>
                  {completedAt && (
                    <span className="text-[10px] text-teal-600 dark:text-teal-400">{fmtTs(completedAt)}</span>
                  )}
                </div>
                {photos.length > 0 && (
                  <div className="grid grid-cols-2 gap-2">
                    {photos.map((photo, idx) => {
                      const url = typeof photo === 'string' ? photo : (photo.url ?? '');
                      if (!url) return null;
                      return (
                        <a
                          key={idx}
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block rounded-md overflow-hidden border border-teal-200 dark:border-teal-700 hover:opacity-80 transition-opacity"
                          title={`POD photo ${idx + 1}`}
                        >
                          <img
                            src={url}
                            alt={`POD photo ${idx + 1}`}
                            className="w-full h-24 object-cover bg-gray-100 dark:bg-gray-700"
                            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                          />
                        </a>
                      );
                    })}
                  </div>
                )}
                {sig && (
                  <div className="space-y-1">
                    <p className="text-[10px] font-medium text-teal-600 dark:text-teal-400 uppercase tracking-wider">Driver Signature</p>
                    <a
                      href={sig}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block rounded-md overflow-hidden border border-teal-200 dark:border-teal-700 hover:opacity-80 transition-opacity"
                      title="Driver signature"
                    >
                      <img
                        src={sig}
                        alt="Driver signature"
                        className="w-full h-20 object-contain bg-white dark:bg-gray-800"
                        onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                      />
                    </a>
                  </div>
                )}
              </div>
            );
          })()}

          {/* PO + Delivery Number — critical tracking info */}
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-lg px-3 py-2">
              <p className="text-[10px] font-bold text-blue-700 dark:text-blue-300 uppercase tracking-widest">PO Number</p>
              <p className="font-mono font-bold text-blue-900 dark:text-blue-100 text-sm mt-0.5">
                {order.orderNumber || '—'}
              </p>
            </div>
            <div className="bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-700 rounded-lg px-3 py-2">
              <p className="text-[10px] font-bold text-indigo-700 dark:text-indigo-300 uppercase tracking-widest">Delivery Number</p>
              <p className="font-mono font-bold text-indigo-900 dark:text-indigo-100 text-sm mt-0.5">
                {order.deliveryNumber || '—'}
              </p>
            </div>
          </div>

          {/* Phone number — editable */}
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300">
              Phone Number
            </label>
            <div className="flex gap-2">
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+971 50 000 0000"
                className="flex-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#032145] dark:border-gray-600 dark:bg-gray-900 dark:text-white"
              />
              {/* HIDDEN — Resend SMS button disabled per business rule: SMS is only
                  sent automatically by the system when a new PO file is first ingested.
                  Keep the code for future re-enable.
              {onResendSMS && (
                <button
                  type="button"
                  disabled={sendingSms}
                  onClick={async () => {
                    setSendingSms(true);
                    try { await onResendSMS(); } finally { setSendingSms(false); }
                  }}
                  className="shrink-0 px-3 py-2 rounded-lg bg-purple-600 text-white text-xs font-semibold hover:bg-purple-700 disabled:opacity-50 whitespace-nowrap"
                >
                  {sendingSms ? '…' : 'Resend SMS'}
                </button>
              )}
              */}
            </div>
          </div>

          {/* Delivery Address — editable */}
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300">
              Delivery Address
            </label>
            <textarea
              rows={2}
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Full delivery address…"
              className="w-full resize-y rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#032145] dark:border-gray-600 dark:bg-gray-900 dark:text-white"
            />
          </div>

          {/* ── Status dropdown (phase-aware) ──────────────────────── */}
          <div>
            <label htmlFor="edit-status" className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300">
              Status
            </label>
            <select
              id="edit-status"
              value={apiStatus}
              onChange={(e) => setApiStatus(e.target.value)}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#032145] dark:border-gray-600 dark:bg-gray-900 dark:text-white"
            >
              {availableOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="edit-date" className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300">
              Delivery date (customer / planned)
            </label>
            <input
              id="edit-date"
              type="date"
              value={dateStr}
              onChange={(e) => setDateStr(e.target.value)}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#032145] dark:border-gray-600 dark:bg-gray-900 dark:text-white"
            />
            <p className="mt-1 text-[11px] text-gray-400">Saved to order metadata for scheduling views.</p>
          </div>

          <div>
            <label htmlFor="edit-gmd" className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300">
              Goods Movement Date
            </label>
            <input
              id="edit-gmd"
              type="date"
              value={gmdStr}
              onChange={(e) => setGmdStr(e.target.value)}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#032145] dark:border-gray-600 dark:bg-gray-900 dark:text-white"
            />
            <p className="mt-1 text-[11px] text-amber-600">Required for PGI Done / Ready to Depart / Out for delivery / In transit</p>
          </div>

          {/* Reschedule — always visible so date can be updated (customer may reschedule many times) */}
          <div className="rounded-lg border border-orange-200 dark:border-orange-800/40 bg-orange-50 dark:bg-orange-900/10 p-3 space-y-2">
            <p className="text-xs font-semibold text-orange-700 dark:text-orange-300">Reschedule Delivery</p>
            <input
              type="date"
              value={rescheduleDate}
              onChange={(e) => setRescheduleDate(e.target.value)}
              className="w-full rounded-lg border border-orange-200 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-400 dark:border-orange-700 dark:bg-gray-900 dark:text-white"
            />
            <input
              type="text"
              value={rescheduleReason}
              onChange={(e) => setRescheduleReason(e.target.value)}
              placeholder="Reason for reschedule…"
              className="w-full rounded-lg border border-orange-200 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-400 dark:border-orange-700 dark:bg-gray-900 dark:text-white"
            />
            <button
              type="button"
              disabled={!rescheduleDate || !rescheduleReason.trim()}
              onClick={async () => {
                if (!rescheduleDate || !rescheduleReason.trim()) return;
                if (onReschedule) {
                  await onReschedule(new Date(rescheduleDate + 'T12:00:00'), rescheduleReason.trim());
                  onClose();
                }
              }}
              className="w-full py-2 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold disabled:opacity-50 transition-colors"
            >
              Confirm Reschedule
            </button>
          </div>

          {/* HIDDEN — Dispatch button hidden per business request. Kept for future use.
          {onDispatch && (
            <div className="rounded-lg border border-green-200 dark:border-green-800/40 bg-green-50 dark:bg-green-900/10 p-3">
              <p className="text-xs font-semibold text-green-700 dark:text-green-300 mb-2">Dispatch</p>
              <button
                type="button"
                disabled={dispatching || !hasGMD}
                onClick={async () => {
                  setDispatching(true);
                  try { await onDispatch(); onClose(); } finally { setDispatching(false); }
                }}
                className="w-full py-2 rounded-lg bg-green-600 hover:bg-green-700 text-white text-sm font-semibold disabled:opacity-50 transition-colors"
                title={!hasGMD ? 'Set GMD date first' : 'Mark as Out for Delivery'}
              >
                {dispatching ? 'Dispatching…' : hasGMD ? 'Mark Out for Delivery' : 'Set GMD date first'}
              </button>
            </div>
          )}
          */}

          {DISPATCH_STATUSES.has(apiStatus) && !hasGMD && (
            <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-xs text-red-700">
              Cannot dispatch: Goods Movement Date is required. Please fill in the date the warehouse issued this order.
            </div>
          )}

          <div>
            <label htmlFor="edit-notes" className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300">
              Notes (internal / customer-visible context)
            </label>
            <textarea
              id="edit-notes"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Reschedule reason, cancellation note, special instructions…"
              className="w-full resize-y rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#032145] dark:border-gray-600 dark:bg-gray-900 dark:text-white"
            />
          </div>
        </div>

        <div className="flex shrink-0 gap-2 border-t border-gray-100 px-4 py-3 dark:border-gray-700">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-lg border border-gray-200 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!canSave}
            onClick={() => void handleSave()}
            className="flex-1 rounded-lg bg-[#032145] py-2 text-sm font-medium text-white hover:bg-[#021432] disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  );

  if (typeof document === 'undefined') return null;
  return createPortal(modal, document.body);
};
