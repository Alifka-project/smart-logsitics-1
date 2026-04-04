import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import api from '../../frontend/apiClient';
import type { Delivery } from '../../types';
import type { DeliveryOrder } from '../../types/delivery';
import { deliveryToManageOrder } from '../../utils/deliveryWorkflowMap';

const API_STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: 'pending', label: 'Pending Order' },
  { value: 'uploaded', label: 'Pending Order (uploaded)' },
  { value: 'scheduled', label: 'Awaiting Customer (SMS sent)' },
  { value: 'confirmed', label: 'Confirmed (tomorrow / soon)' },
  { value: 'scheduled-confirmed', label: 'Confirmed — future date set' },
  { value: 'out-for-delivery', label: 'Out for delivery' },
  { value: 'in-transit', label: 'In transit' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'delivered-with-installation', label: 'Delivered (with installation)' },
  { value: 'delivered-without-installation', label: 'Delivered (no installation)' },
  { value: 'completed', label: 'Completed' },
  { value: 'pod-completed', label: 'POD completed' },
  { value: 'rescheduled', label: 'Rescheduled' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'returned', label: 'Returned / failed' },
];

function toDateInputValue(d: Date): string {
  const x = new Date(d);
  x.setMinutes(x.getMinutes() - x.getTimezoneOffset());
  return x.toISOString().slice(0, 10);
}

interface OrderEditModalProps {
  delivery: Delivery;
  onClose: () => void;
  onSaved: (updated: { status: string; notes?: string; scheduledDateIso?: string }) => void;
  onToastError: (message: string) => void;
}

export const OrderEditModal: React.FC<OrderEditModalProps> = ({
  delivery,
  onClose,
  onSaved,
  onToastError,
}) => {
  const order: DeliveryOrder = useMemo(() => deliveryToManageOrder(delivery), [delivery]);

  const initialStatus = (delivery.status || 'pending').toLowerCase();
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
      if (dateStr.trim()) {
        payload.scheduledDate = new Date(dateStr + 'T12:00:00').toISOString();
      }

      const response = await api.put(`/deliveries/admin/${delivery.id}/status`, payload);

      if (response.data && (response.data as { ok?: boolean }).ok) {
        const scheduledDateIso =
          dateStr.trim() ? new Date(dateStr + 'T12:00:00').toISOString() : undefined;
        onSaved({
          status: apiStatus,
          notes: notes.trim() || undefined,
          scheduledDateIso,
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
              Edit order
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

          <div>
            <label htmlFor="edit-status" className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300">
              Status
            </label>
            <select
              id="edit-status"
              value={apiStatus}
              onChange={(e) => setApiStatus(e.target.value)}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#002D5B] dark:border-gray-600 dark:bg-gray-900 dark:text-white"
            >
              {!API_STATUS_OPTIONS.some((o) => o.value === apiStatus) && (
                <option value={apiStatus}>{apiStatus} (current)</option>
              )}
              {API_STATUS_OPTIONS.map((o) => (
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
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#002D5B] dark:border-gray-600 dark:bg-gray-900 dark:text-white"
            />
            <p className="mt-1 text-[11px] text-gray-400">Saved to order metadata for scheduling views.</p>
          </div>

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
              className="w-full resize-y rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#002D5B] dark:border-gray-600 dark:bg-gray-900 dark:text-white"
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
            disabled={saving}
            onClick={() => void handleSave()}
            className="flex-1 rounded-lg bg-[#002D5B] py-2 text-sm font-medium text-white hover:bg-[#001f3f] disabled:opacity-50"
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
