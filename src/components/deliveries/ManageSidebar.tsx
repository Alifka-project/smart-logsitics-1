import React, { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import type { DeliveryOrder } from '../../types/delivery';

const ACCEPT = {
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
  'application/vnd.ms-excel': ['.xls'],
  'text/csv': ['.csv'],
};

interface ManageSidebarProps {
  orders: DeliveryOrder[];
  drivers?: { id: string; fullName?: string | null; username: string }[];
  onFileUpload: (file: File) => void;
  isUploading: boolean;
  /** When true, hides the file upload dropzone (e.g. logistics_team role cannot upload) */
  hideUpload?: boolean;
}

export const ManageSidebar: React.FC<ManageSidebarProps> = ({
  orders,
  drivers = [],
  onFileUpload,
  isUploading,
  hideUpload = false,
}) => {
  const [showPolicy, setShowPolicy] = useState(false);

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
    noClick: true,
  });

  // ── Metrics ──────────────────────────────────────────────────────
  const now = new Date();
  const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
  const cutoffHour = 15; // 3 PM upload cutoff

  // Needs Attention: delayed orders + orders uploaded after cutoff still pending dispatch
  const delayedOrders = orders.filter(o => o.status === 'order_delay');
  const lateUploads = orders.filter(o => {
    if (!['uploaded', 'sms_sent', 'unconfirmed', 'confirmed', 'next_shipment', 'future_schedule', 'scheduled'].includes(o.status)) return false;
    const h = o.uploadedAt.getHours();
    const uploadedToday = o.uploadedAt >= todayStart;
    return uploadedToday && h >= cutoffHour;
  });
  const needsAttentionCount = delayedOrders.length + lateUploads.length;
  const needsAttentionItems: { label: string; count: number; color: string }[] = [
    ...(delayedOrders.length > 0 ? [{ label: 'Order Delays', count: delayedOrders.length, color: 'text-red-600 dark:text-red-400' }] : []),
    ...(lateUploads.length > 0 ? [{ label: 'Late Uploads (after 3 PM)', count: lateUploads.length, color: 'text-amber-600 dark:text-amber-400' }] : []),
  ];

  // Awaiting Confirm: customers who have not confirmed yet
  const awaitingOrders = orders.filter(o => o.status === 'sms_sent' || o.status === 'unconfirmed');
  const unassignedConfirmed = orders.filter(o =>
    (o.status === 'confirmed' || o.status === 'next_shipment' || o.status === 'ready_to_dispatch') && !o.driverId
  );

  // Truck Capacity: driver assignment summary
  const driverDeliveryCounts: Record<string, number> = {};
  orders.forEach(o => {
    if (o.driverId) driverDeliveryCounts[o.driverId] = (driverDeliveryCounts[o.driverId] ?? 0) + 1;
  });
  const assignedDriverCount = Object.keys(driverDeliveryCounts).length;
  const unassignedOrderCount = orders.filter(o => !o.driverId && !['delivered', 'cancelled', 'failed'].includes(o.status)).length;
  const totalDrivers = drivers.length;

  return (
    <div className="space-y-4">
      {!hideUpload && (
        <div
          {...getRootProps()}
          className={`
            p-4 sm:p-6 bg-white dark:bg-gray-800 rounded-xl border-2 border-dashed cursor-pointer transition-all
            ${isDragActive ? 'border-[#002D5B] bg-blue-50 dark:bg-blue-900/20' : 'border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500'}
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
              className="text-xs text-[#002D5B] dark:text-blue-400 mt-2 hover:underline"
            >
              or browse files
            </button>
          </div>
        </div>
      )}

      {/* ── Needs Attention ── */}
      <div className={`rounded-xl p-4 border ${needsAttentionCount > 0 ? 'bg-red-50 dark:bg-red-900/10 border-red-200 dark:border-red-800/40' : 'bg-white dark:bg-gray-800 border-gray-100 dark:border-gray-700'}`}>
        <div className="flex items-center justify-between mb-3">
          <h3 className={`font-semibold text-sm flex items-center gap-1.5 ${needsAttentionCount > 0 ? 'text-red-700 dark:text-red-300' : 'text-gray-700 dark:text-gray-300'}`}>
            🚨 Needs Attention
          </h3>
          <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${needsAttentionCount > 0 ? 'bg-red-600 text-white' : 'bg-gray-200 dark:bg-gray-600 text-gray-600 dark:text-gray-300'}`}>
            {needsAttentionCount}
          </span>
        </div>
        {needsAttentionCount === 0 ? (
          <p className="text-xs text-gray-500 dark:text-gray-400">All orders are on track ✓</p>
        ) : (
          <div className="space-y-2">
            {needsAttentionItems.map(item => (
              <div key={item.label} className="flex items-center justify-between">
                <span className="text-xs text-gray-700 dark:text-gray-300">{item.label}</span>
                <span className={`text-xs font-bold ${item.color}`}>{item.count}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Awaiting Customer Confirmation ── */}
      <div className={`rounded-xl p-4 border ${awaitingOrders.length > 0 ? 'bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800/40' : 'bg-white dark:bg-gray-800 border-gray-100 dark:border-gray-700'}`}>
        <div className="flex items-center justify-between mb-3">
          <h3 className={`font-semibold text-sm flex items-center gap-1.5 ${awaitingOrders.length > 0 ? 'text-amber-700 dark:text-amber-300' : 'text-gray-700 dark:text-gray-300'}`}>
            📩 Awaiting Confirmation
          </h3>
          <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${awaitingOrders.length > 0 ? 'bg-amber-500 text-white' : 'bg-gray-200 dark:bg-gray-600 text-gray-600 dark:text-gray-300'}`}>
            {awaitingOrders.length}
          </span>
        </div>
        <div className="space-y-1.5 text-xs text-gray-600 dark:text-gray-400">
          <div className="flex justify-between">
            <span>SMS sent, no reply yet</span>
            <span className="font-semibold text-amber-600 dark:text-amber-400">{orders.filter(o => o.status === 'sms_sent').length}</span>
          </div>
          <div className="flex justify-between">
            <span>No response (needs resend)</span>
            <span className="font-semibold text-red-600 dark:text-red-400">{orders.filter(o => o.status === 'unconfirmed').length}</span>
          </div>
          {unassignedConfirmed.length > 0 && (
            <div className="flex justify-between border-t border-amber-200 dark:border-amber-800/30 pt-1.5 mt-1.5">
              <span>Confirmed but no driver</span>
              <span className="font-semibold text-orange-600 dark:text-orange-400">{unassignedConfirmed.length}</span>
            </div>
          )}
        </div>
      </div>

      {/* ── Truck / Driver Capacity ── */}
      <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-100 dark:border-gray-700">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-sm text-gray-700 dark:text-gray-300 flex items-center gap-1.5">
            🚛 Truck Capacity
          </h3>
          <span className="text-xs text-gray-400 dark:text-gray-500">{assignedDriverCount}/{totalDrivers > 0 ? totalDrivers : '—'} drivers active</span>
        </div>
        <div className="space-y-2 text-xs text-gray-600 dark:text-gray-400">
          <div className="flex justify-between">
            <span>Orders assigned to a driver</span>
            <span className="font-semibold text-blue-600 dark:text-blue-400">{orders.length - unassignedOrderCount}</span>
          </div>
          <div className="flex justify-between">
            <span>Orders without driver</span>
            <span className={`font-semibold ${unassignedOrderCount > 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-400 dark:text-gray-500'}`}>{unassignedOrderCount}</span>
          </div>
          {drivers.length > 0 && (
            <div className="mt-2 pt-2 border-t border-gray-100 dark:border-gray-700 space-y-1">
              {drivers.map(dr => {
                const count = driverDeliveryCounts[dr.id] ?? 0;
                const pct = orders.length > 0 ? Math.round((count / Math.max(orders.length, 1)) * 100) : 0;
                return (
                  <div key={dr.id} className="flex items-center gap-2">
                    <span className="truncate flex-1 text-[11px]">{dr.fullName || dr.username}</span>
                    <div className="w-16 h-1.5 rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden shrink-0">
                      <div className="h-full bg-blue-500 rounded-full" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-[11px] font-medium w-5 text-right shrink-0">{count}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Policy & KPI / How to Use ── */}
      <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm border border-gray-100 dark:border-gray-700">
        <button
          type="button"
          onClick={() => setShowPolicy(v => !v)}
          className="w-full flex items-center justify-between mb-1"
        >
          <h3 className="font-semibold text-sm text-gray-900 dark:text-white">📋 Policy &amp; KPI Guide</h3>
          <span className="text-xs text-gray-400">{showPolicy ? '▲ Hide' : '▼ Show'}</span>
        </button>

        {!showPolicy && (
          <div className="mt-3 space-y-2">
            {[
              { num: 1, text: 'Upload Excel — system auto-sends SMS to customer', color: 'bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-300' },
              { num: 2, text: 'Customer confirms delivery date via WhatsApp link', color: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-300' },
              { num: 3, text: 'Assign driver immediately after confirmation', color: 'bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-300' },
              { num: 4, text: 'Set GMD date before dispatching (out-for-delivery)', color: 'bg-indigo-100 text-indigo-600 dark:bg-indigo-900/40 dark:text-indigo-300' },
              { num: 5, text: 'Target: deliver within 24h of confirmation', color: 'bg-purple-100 text-purple-600 dark:bg-purple-900/40 dark:text-purple-300' },
            ].map((step) => (
              <div key={step.num} className="flex items-start gap-2">
                <span className={`mt-0.5 w-5 h-5 shrink-0 rounded-full flex items-center justify-center text-xs font-semibold ${step.color}`}>
                  {step.num}
                </span>
                <span className="text-xs text-gray-600 dark:text-gray-300 leading-snug">{step.text}</span>
              </div>
            ))}
          </div>
        )}

        {showPolicy && (
          <div className="mt-3 space-y-3">
            {/* KPI Rules */}
            <div>
              <p className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">KPI Rules</p>
              <div className="space-y-2">
                {[
                  { icon: '⏱', text: 'Delivery must be completed within 24 hours of customer confirmation.' },
                  { icon: '📅', text: 'Orders uploaded after 3:00 PM cannot be dispatched for the next day\'s shipment.' },
                  { icon: '🚚', text: 'Every confirmed order must have a driver assigned before dispatch.' },
                  { icon: '📋', text: 'GMD (Goods Movement Date) must be set before marking Out-for-Delivery.' },
                  { icon: '✅', text: 'POD (Proof of Delivery) must be submitted within 2 hours of delivery.' },
                ].map((rule, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs text-gray-700 dark:text-gray-300">
                    <span className="shrink-0 mt-0.5">{rule.icon}</span>
                    <span className="leading-snug">{rule.text}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Alert Rules */}
            <div className="border-t border-gray-100 dark:border-gray-700 pt-3">
              <p className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Watch Out For</p>
              <div className="space-y-2">
                {[
                  { icon: '🚨', text: 'Order Delay status — action required within the hour. Contact driver immediately.' },
                  { icon: '⚠️', text: 'Unconfirmed orders — resend SMS if no reply within 4 hours.' },
                  { icon: '📍', text: 'Always verify delivery address before dispatch. Wrong address = failed delivery.' },
                  { icon: '🔄', text: 'Rescheduled orders must have a new confirmed date and driver re-assigned.' },
                  { icon: '📦', text: 'B2B orders (Ship-to Party): confirm with the company contact, not individual name.' },
                ].map((rule, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs text-gray-700 dark:text-gray-300">
                    <span className="shrink-0 mt-0.5">{rule.icon}</span>
                    <span className="leading-snug">{rule.text}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
