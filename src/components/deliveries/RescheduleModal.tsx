import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { DeliveryOrder } from '../../types/delivery';

const RESCHEDULE_REASONS = [
  'Bad weather conditions',
  'Vehicle / operational issue',
  'Route optimization',
  'Customer area not accessible',
  'High delivery volume',
  'Other',
];

interface RescheduleModalProps {
  order: DeliveryOrder;
  onClose: () => void;
  onReschedule: (newDate: Date, reason: string) => void;
}

export const RescheduleModal: React.FC<RescheduleModalProps> = ({ order, onClose, onReschedule }) => {
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [reason, setReason] = useState<string>(RESCHEDULE_REASONS[0]);
  const [customReason, setCustomReason] = useState<string>('');

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

  // Use noon local time so toISOString() or Dubai-extraction never lands on the
  // wrong calendar day regardless of the local timezone offset.
  const makeLocalNoon = (daysFromNow: number): Date => {
    const d = new Date();
    d.setHours(12, 0, 0, 0); // anchor to noon today first
    d.setDate(d.getDate() + daysFromNow);
    return d;
  };
  const tomorrow = makeLocalNoon(1);
  const dayAfter  = makeLocalNoon(2);
  const nextWeek  = makeLocalNoon(7);

  const quickOptions = [
    { label: 'Tomorrow', date: tomorrow },
    { label: 'In 2 days', date: dayAfter },
    { label: 'Next week', date: nextWeek },
  ];

  // Use en-CA locale for YYYY-MM-DD format in Dubai timezone (avoids UTC day-shift)
  const minDateStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai' }).format(tomorrow);

  const effectiveReason = reason === 'Other' ? customReason.trim() : reason;
  const canConfirm = !!selectedDate && effectiveReason.length > 0;

  const handleConfirm = () => {
    if (selectedDate && canConfirm) {
      onReschedule(selectedDate, effectiveReason);
    }
  };

  const modal = (
    <div
      className="pp-modal-backdrop fixed inset-0 z-[10050] flex items-center justify-center bg-black/50 p-4 sm:p-6"
      role="presentation"
    >
      <div
        className="pp-modal-card flex max-h-[min(90vh,720px)] w-full max-w-md flex-col overflow-hidden rounded-xl border border-gray-100 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-800"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="shrink-0 border-b border-gray-100 p-4 dark:border-gray-700">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Reschedule Delivery</h3>
            <button
              type="button"
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              aria-label="Close"
            >
              ✕
            </button>
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Order #{order.orderNumber} — {order.customerName}
          </p>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-4">

          {/* Quick date options */}
          <div>
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Quick options</p>
            <div className="flex gap-2 flex-wrap">
              {quickOptions.map((option) => (
                <button
                  key={option.label}
                  type="button"
                  onClick={() => setSelectedDate(option.date)}
                  className={`
                    flex-1 min-w-[90px] py-2 px-3 rounded-lg text-sm border transition-all
                    ${
                      selectedDate?.toDateString() === option.date.toDateString()
                        ? 'bg-[#002D5B] text-white border-[#002D5B]'
                        : 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700'
                    }
                  `}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          {/* Custom date */}
          <div>
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Or pick a date</p>
            <input
              type="date"
              min={minDateStr}
              onChange={(e) => {
                const v = e.target.value;
                if (v) setSelectedDate(new Date(v + 'T12:00:00'));
              }}
              className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#002D5B]"
            />
          </div>

          {/* Reason */}
          <div>
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Reason for rescheduling</p>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#002D5B]"
            >
              {RESCHEDULE_REASONS.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
            {reason === 'Other' && (
              <input
                type="text"
                placeholder="Please specify the reason…"
                value={customReason}
                onChange={(e) => setCustomReason(e.target.value)}
                className="mt-2 w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#002D5B]"
              />
            )}
          </div>

          {/* Preview */}
          {selectedDate && (
            <div className="p-3 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 rounded-lg space-y-1">
              <p className="text-sm text-amber-800 dark:text-amber-200">
                📅 New date:{' '}
                <strong>
                  {selectedDate.toLocaleDateString('en-GB', {
                    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
                  })}
                </strong>
              </p>
              {effectiveReason && (
                <p className="text-sm text-amber-800 dark:text-amber-200">
                  📋 Reason: <strong>{effectiveReason}</strong>
                </p>
              )}
              <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                Customer will be notified by SMS.
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex shrink-0 gap-3 border-t border-gray-100 p-4 dark:border-gray-700">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2 px-4 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!canConfirm}
            className="flex-1 py-2 px-4 bg-[#002D5B] text-white rounded-lg hover:bg-[#001f3f] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Confirm Reschedule
          </button>
        </div>
      </div>
    </div>
  );

  if (typeof document === 'undefined') return null;
  return createPortal(modal, document.body);
};
