import React from 'react';
import {
  CheckCircle2,
  Wrench,
  RotateCcw,
  AlertCircle,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

interface StatusOption {
  value: string;
  label: string;
  icon: LucideIcon;
  activeClass: string;
  iconActiveClass: string;
  textActiveClass: string;
  description: string;
}

interface StatusUpdateFormProps {
  status: string;
  setStatus: (status: string) => void;
  notes: string;
  setNotes: (notes: string) => void;
  rescheduleDate: string;
  setRescheduleDate: (date: string) => void;
  deliveryStatus?: string | null;
}

const DRIVER_STATUSES: StatusOption[] = [
  {
    value: 'delivered-with-installation',
    label: 'Delivered (with installation)',
    icon: Wrench,
    activeClass: 'border-green-500 bg-green-50 dark:border-green-400 dark:bg-green-500/20',
    iconActiveClass: 'text-green-600 dark:text-green-300',
    textActiveClass: 'text-green-700 dark:text-green-200',
    description: 'Delivered and installed successfully',
  },
  {
    value: 'delivered-without-installation',
    label: 'Delivered (without installation)',
    icon: CheckCircle2,
    activeClass: 'border-green-500 bg-green-50 dark:border-green-400 dark:bg-green-500/20',
    iconActiveClass: 'text-green-600 dark:text-green-300',
    textActiveClass: 'text-green-700 dark:text-green-200',
    description: 'Delivered without installation',
  },
  {
    value: 'rescheduled',
    label: 'Reschedule',
    icon: RotateCcw,
    activeClass: 'border-orange-500 bg-orange-50 dark:border-orange-400 dark:bg-orange-500/20',
    iconActiveClass: 'text-orange-600 dark:text-orange-300',
    textActiveClass: 'text-orange-700 dark:text-orange-200',
    description: 'Reschedule delivery (max 7 days)',
  },
  {
    value: 'rejected',
    label: 'Rejected',
    icon: AlertCircle,
    activeClass: 'border-red-500 bg-red-50 dark:border-red-400 dark:bg-red-500/20',
    iconActiveClass: 'text-red-600 dark:text-red-300',
    textActiveClass: 'text-red-700 dark:text-red-200',
    description: 'Delivery rejected by customer',
  },
];

/** Returns YYYY-MM-DD string offset by `days` from today */
function offsetDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export default function StatusUpdateForm({
  status,
  setStatus,
  notes,
  setNotes,
  rescheduleDate,
  setRescheduleDate,
}: StatusUpdateFormProps) {
  const minDate = offsetDate(1);   // tomorrow
  const maxDate = offsetDate(7);   // 7-day policy

  const isReschedule = status === 'rescheduled';

  return (
    <div className="space-y-4">
      <h3 className="text-base sm:text-lg font-semibold text-gray-800 dark:text-gray-100">
        Update Status
      </h3>

      <div className="grid grid-cols-2 gap-3">
        {DRIVER_STATUSES.map((s) => {
          const Icon = s.icon;
          return (
            <button
              key={s.value}
              type="button"
              onClick={() => setStatus(s.value)}
              title={s.description}
              className={`flex flex-col items-center gap-2 p-3 sm:p-4 rounded-lg border-2 transition-all hover:shadow-md ${
                status === s.value
                  ? s.activeClass
                  : 'border-gray-300 dark:border-gray-700 hover:border-gray-400 dark:hover:border-gray-500 bg-white dark:bg-gray-800'
              }`}
            >
              <Icon
                className={`w-5 h-5 sm:w-6 sm:h-6 ${
                  status === s.value ? s.iconActiveClass : 'text-gray-400 dark:text-gray-500'
                }`}
              />
              <span
                className={`font-medium text-xs sm:text-sm text-center leading-snug ${
                  status === s.value ? s.textActiveClass : 'text-gray-600 dark:text-gray-300'
                }`}
              >
                {s.label}
              </span>
            </button>
          );
        })}
      </div>

      {/* Reschedule date picker — visible only when Reschedule is selected */}
      {isReschedule && (
        <div className="rounded-lg border border-orange-200 dark:border-orange-700 bg-orange-50 dark:bg-orange-900/20 p-4 space-y-2">
          <label className="block text-sm font-semibold text-orange-800 dark:text-orange-200">
            New Delivery Date <span className="font-normal text-orange-600 dark:text-orange-400">(max 7 days)</span>
          </label>
          <input
            type="date"
            value={rescheduleDate}
            min={minDate}
            max={maxDate}
            onChange={(e) => setRescheduleDate(e.target.value)}
            className="w-full px-3 py-2 border border-orange-300 dark:border-orange-600 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-orange-400 focus:border-transparent"
          />
          {rescheduleDate && (
            <p className="text-xs text-orange-700 dark:text-orange-300">
              Rescheduled to:{' '}
              <span className="font-semibold">
                {new Date(rescheduleDate + 'T00:00:00').toLocaleDateString('en-GB', {
                  weekday: 'long',
                  day: 'numeric',
                  month: 'long',
                  year: 'numeric',
                })}
              </span>
            </p>
          )}
        </div>
      )}

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-2">
          Notes / Comments
          {(isReschedule || status === 'rejected') && (
            <span className="ml-1 text-red-500">*</span>
          )}
        </label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          className="w-full px-3 sm:px-4 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm sm:text-base bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 transition-colors"
          placeholder={
            isReschedule
              ? 'Reason for rescheduling (e.g. customer not available, access issue)...'
              : status === 'rejected'
              ? 'Reason for rejection...'
              : 'Add any additional notes...'
          }
        />
      </div>
    </div>
  );
}
