import React, { useCallback, useMemo } from 'react';
import { useDropzone } from 'react-dropzone';
import type { DeliveryOrder } from '../../types/delivery';

const ACCEPT = {
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
  'application/vnd.ms-excel': ['.xls'],
  'text/csv': ['.csv'],
};

// Statuses where the order is considered "completed/terminal" — no longer pending
const TERMINAL_STATUSES = new Set<string>(['delivered', 'cancelled', 'failed']);

interface ManageSidebarProps {
  orders: DeliveryOrder[];
  onFileUpload: (file: File) => void;
  isUploading: boolean;
  /** When true, hides the file upload dropzone (e.g. logistics_team role cannot upload) */
  hideUpload?: boolean;
  /**
   * When true (Logistics portal), shows the Policy & KPI Guide.
   * When false (Delivery Team Portal), shows Today's Summary + simple How to Use guide instead.
   */
  showActionCards?: boolean;
}

export const ManageSidebar: React.FC<ManageSidebarProps> = ({
  orders,
  onFileUpload,
  isUploading,
  hideUpload = false,
  showActionCards = false,
}) => {
  // When upload is hidden AND no action cards (Delivery Team Portal with tab-rail upload),
  // the sidebar has no content — return null so the parent grid can go full-width.
  if (hideUpload && !showActionCards) return null;
  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      if (acceptedFiles.length > 0) onFileUpload(acceptedFiles[0]);
    },
    [onFileUpload],
  );

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop,
    accept: ACCEPT,
    multiple: false,
    disabled: isUploading,
    // noClick defaults to false — entire card is clickable to open the file browser
  });

  // ── Today's Summary (shown in Delivery Team Portal sidebar) ──────────────
  const todayIso = useMemo(
    () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai' }).format(new Date()),
    [],
  );
  const todaySummary = useMemo(() => {
    const isTodayDelivery = (o: DeliveryOrder) => {
      const d = o.confirmedDeliveryDate ?? o.scheduledDate ?? o.deliveryDate;
      if (!d) return false;
      return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai' }).format(d) === todayIso;
    };
    return {
      active:         orders.filter(o => !TERMINAL_STATUSES.has(o.status)).length,
      scheduledToday: orders.filter(isTodayDelivery).length,
      outForDelivery: orders.filter(o => ['out_for_delivery', 'out-for-delivery'].includes(o.status)).length,
      completed:      orders.filter(o => TERMINAL_STATUSES.has(o.status)).length,
    };
  }, [orders, todayIso]);

  return (
    <div className="space-y-4">
      {/* ── File Upload Drop Zone ── */}
      {!hideUpload && (
        <div
          {...getRootProps()}
          className={`
            p-4 sm:p-6 bg-white dark:bg-gray-800 rounded-xl border-2 border-dashed cursor-pointer transition-all
            ${isDragActive ? 'border-[#032145] bg-blue-50 dark:bg-blue-900/20' : 'border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500'}
            ${isUploading ? 'opacity-50 pointer-events-none' : ''}
          `}
        >
          <input {...getInputProps()} />
          <div className="text-center">
            <span className="text-2xl mb-2 block" aria-hidden>📤</span>
            <p className="text-sm font-medium text-gray-900 dark:text-white">
              {isDragActive ? 'Drop file here' : 'Drop Excel to import'}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">.xlsx, .xls, .csv</p>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); open(); }}
              className="text-xs text-[#032145] dark:text-blue-400 mt-2 hover:underline"
            >
              or browse files
            </button>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════
          DELIVERY TEAM PORTAL VIEW — Today's Summary + How to Use
          (showActionCards = false)
          ══════════════════════════════════════════════════════════════ */}
      {!showActionCards && (
        <>
          {/* ── Today's Summary ── */}
          <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-100 dark:border-gray-700">
            <div className="mb-3 flex items-center gap-2">
              <span className="text-base" aria-hidden>📅</span>
              <h3 className="font-semibold text-sm text-gray-900 dark:text-gray-100">Today's Summary</h3>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {([
                { count: todaySummary.active,         label: 'Active Orders',    color: 'text-blue-600 dark:text-blue-400',    bg: 'bg-blue-50 dark:bg-blue-900/20',    border: 'border-blue-100 dark:border-blue-800/30'    },
                { count: todaySummary.scheduledToday, label: 'Due Today',        color: 'text-amber-600 dark:text-amber-400',  bg: 'bg-amber-50 dark:bg-amber-900/20',  border: 'border-amber-100 dark:border-amber-800/30'  },
                { count: todaySummary.outForDelivery, label: 'Out for Delivery', color: 'text-teal-600 dark:text-teal-400',    bg: 'bg-teal-50 dark:bg-teal-900/20',    border: 'border-teal-100 dark:border-teal-800/30'    },
                { count: todaySummary.completed,      label: 'Completed',        color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-900/20', border: 'border-emerald-100 dark:border-emerald-800/30' },
              ] as { count: number; label: string; color: string; bg: string; border: string }[]).map(({ count, label, color, bg, border }) => (
                <div key={label} className={`flex flex-col items-center justify-center rounded-xl border p-3 ${bg} ${border}`}>
                  <span className={`text-xl font-bold ${color}`}>{count}</span>
                  <span className={`mt-0.5 text-center text-xs font-semibold leading-tight ${color}`}>{label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* ── How to Use ── */}
          <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm border border-gray-100 dark:border-gray-700">
            <h3 className="font-semibold text-sm text-gray-900 dark:text-white mb-3">📋 How to use</h3>
            <div className="space-y-2">
              {[
                { num: 1, text: 'Order processed',                 color: 'bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-300'     },
                { num: 2, text: 'Customer confirms delivery date', color: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-300' },
                { num: 3, text: 'Assign driver',                   color: 'bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-300'   },
                { num: 4, text: 'PGI',                             color: 'bg-indigo-100 text-indigo-600 dark:bg-indigo-900/40 dark:text-indigo-300' },
                { num: 5, text: 'Pickup confirmed',                color: 'bg-teal-100 text-teal-600 dark:bg-teal-900/40 dark:text-teal-300' },
                { num: 6, text: 'Dispatch',                        color: 'bg-purple-100 text-purple-600 dark:bg-purple-900/40 dark:text-purple-300' },
              ].map((step) => (
                <div key={step.num} className="flex items-center gap-2">
                  <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-semibold shrink-0 ${step.color}`}>
                    {step.num}
                  </span>
                  <span className="text-xs text-gray-600 dark:text-gray-300">{step.text}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* ══════════════════════════════════════════════════════════════
          LOGISTICS PORTAL VIEW — Policy & KPI Guide only
          (Needs Attention / Awaiting Customer Response / Truck Capacity
           cards removed per ops request — Truck Capacity lives in the
           Live Maps tab inside Delivery Orders & Dispatch.)
          ══════════════════════════════════════════════════════════════ */}
      {showActionCards && (
        <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm border border-gray-100 dark:border-gray-700">
          <h3 className="font-semibold text-sm text-gray-900 dark:text-white mb-3">📋 Policy &amp; KPI Guide</h3>

          <div className="space-y-3">
            <div>
              <p className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Workflow</p>
              <div className="space-y-1.5">
                {[
                  { num: 1, text: 'Order processed',                 color: 'bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-300' },
                  { num: 2, text: 'Customer confirms delivery date', color: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-300' },
                  { num: 3, text: 'Assign driver',                   color: 'bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-300' },
                  { num: 4, text: 'PGI',                             color: 'bg-indigo-100 text-indigo-600 dark:bg-indigo-900/40 dark:text-indigo-300' },
                  { num: 5, text: 'Pickup confirmed',                color: 'bg-teal-100 text-teal-600 dark:bg-teal-900/40 dark:text-teal-300' },
                  { num: 6, text: 'Dispatch',                        color: 'bg-purple-100 text-purple-600 dark:bg-purple-900/40 dark:text-purple-300' },
                ].map((step) => (
                  <div key={step.num} className="flex items-center gap-2">
                    <span className={`w-5 h-5 shrink-0 rounded-full flex items-center justify-center text-xs font-semibold ${step.color}`}>
                      {step.num}
                    </span>
                    <span className="text-xs text-gray-600 dark:text-gray-300 leading-snug">{step.text}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="border-t border-gray-100 dark:border-gray-700 pt-3">
              <p className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">KPI Rules</p>
              <div className="space-y-2">
                {[
                  { icon: '⏱', text: 'Delivery must be completed within 24 hours of pickup confirmed.' },
                  { icon: '📅', text: 'Orders uploaded after 3:00 PM cannot be dispatched for the next day\'s shipment.' },
                  { icon: '🚚', text: 'Every confirmed order must have a driver assigned before dispatch.' },
                  { icon: '✅', text: 'POD must be submitted after unit delivered.' },
                ].map((rule, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs text-gray-700 dark:text-gray-300">
                    <span className="shrink-0 mt-0.5">{rule.icon}</span>
                    <span className="leading-snug">{rule.text}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="border-t border-gray-100 dark:border-gray-700 pt-3">
              <p className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Watch Out For</p>
              <div className="space-y-2">
                {[
                  { icon: '🚨', text: 'Order Delay status — action required.' },
                  { icon: '📍', text: 'Verify delivery address before dispatch.' },
                  { icon: '🔄', text: 'Rescheduled orders must have a new confirmed date and driver re-assigned.' },
                  { icon: '📦', text: 'B2B orders: confirm with the company contact.' },
                ].map((rule, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs text-gray-700 dark:text-gray-300">
                    <span className="shrink-0 mt-0.5">{rule.icon}</span>
                    <span className="leading-snug">{rule.text}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
