import React, { useCallback, useMemo, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { CheckCircle, Clock, MessageSquare } from 'lucide-react';
import type { DeliveryOrder } from '../../types/delivery';
import type { OrdersTableTab } from './OrdersTable';

const ACCEPT = {
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
  'application/vnd.ms-excel': ['.xls'],
  'text/csv': ['.csv'],
};

// Statuses where the order is considered "completed/terminal" — no longer pending
const TERMINAL_STATUSES = new Set<string>(['delivered', 'cancelled', 'failed']);
// Statuses where the order has already been dispatched / handled — exclude from "unassigned"
const DISPATCH_DONE_STATUSES = new Set<string>([
  'out_for_delivery', 'order_delay', 'delivered', 'cancelled', 'failed', 'rescheduled',
]);

interface ManageSidebarProps {
  orders: DeliveryOrder[];
  drivers?: { id: string; fullName?: string | null; username: string }[];
  onFileUpload: (file: File) => void;
  isUploading: boolean;
  /** When true, hides the file upload dropzone (e.g. logistics_team role cannot upload) */
  hideUpload?: boolean;
  /** Called when a Needs Attention mini-card is tapped — filters the orders table */
  onTabClick?: (tab: OrdersTableTab) => void;
}

export const ManageSidebar: React.FC<ManageSidebarProps> = ({
  orders,
  drivers = [],
  onFileUpload,
  isUploading,
  hideUpload = false,
  onTabClick,
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

  // ── Needs Attention metrics (mirrors dashboard actionItems) ──────
  const pendingOrdersCount = useMemo(
    () => orders.filter(o => !TERMINAL_STATUSES.has(o.status)).length,
    [orders],
  );
  const unassignedCount = useMemo(
    () => orders.filter(o => !DISPATCH_DONE_STATUSES.has(o.status) && !o.driverId).length,
    [orders],
  );
  const awaitingOrders = useMemo(
    () => orders.filter(o => o.status === 'sms_sent' || o.status === 'unconfirmed'),
    [orders],
  );
  const orderDelayCount = useMemo(
    () => orders.filter(o => o.status === 'order_delay').length,
    [orders],
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

      {/* ── Needs Attention (mirrors dashboard 2×2 grid) ── */}
      <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-100 dark:border-gray-700">
        <div className="mb-3 flex items-center gap-2">
          <span className="text-amber-500 text-base" aria-hidden>⚠️</span>
          <h3 className="font-semibold text-sm text-gray-900 dark:text-gray-100">Needs Attention</h3>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {([
            { tab: 'all',               count: pendingOrdersCount, label: 'Pending Orders',   sublabel: 'Not yet completed', bg: 'bg-amber-50 dark:bg-amber-900/20',  border: 'border-amber-100 dark:border-amber-800/30',  hover: 'hover:bg-amber-100 dark:hover:bg-amber-900/30',  countColor: 'text-amber-600 dark:text-amber-400',  labelColor: 'text-amber-700 dark:text-amber-400'   },
            { tab: 'pending',           count: unassignedCount,    label: 'Unassigned',       sublabel: 'Needs driver',      bg: 'bg-orange-50 dark:bg-orange-900/20',border: 'border-orange-100 dark:border-orange-800/30', hover: 'hover:bg-orange-100 dark:hover:bg-orange-900/30',countColor: 'text-orange-600 dark:text-orange-400',labelColor: 'text-orange-700 dark:text-orange-400' },
            { tab: 'awaiting_customer', count: awaitingOrders.length, label: 'Awaiting Customer',sublabel: 'No confirmation',bg: 'bg-purple-50 dark:bg-purple-900/20',border: 'border-purple-100 dark:border-purple-800/30', hover: 'hover:bg-purple-100 dark:hover:bg-purple-900/30',countColor: 'text-purple-600 dark:text-purple-400',labelColor: 'text-purple-700 dark:text-purple-400' },
            { tab: 'order_delay',       count: orderDelayCount,    label: 'Order Delays',     sublabel: 'Needs resolution',  bg: 'bg-red-50 dark:bg-red-900/20',     border: 'border-red-100 dark:border-red-800/30',      hover: 'hover:bg-red-100 dark:hover:bg-red-900/30',     countColor: 'text-red-600 dark:text-red-400',      labelColor: 'text-red-700 dark:text-red-400'       },
          ] as { tab: OrdersTableTab; count: number; label: string; sublabel: string; bg: string; border: string; hover: string; countColor: string; labelColor: string }[]).map(({ tab, count, label, sublabel, bg, border, hover, countColor, labelColor }) => (
            <div
              key={label}
              onClick={() => onTabClick?.(tab)}
              className={`flex flex-col items-center justify-center rounded-xl border p-3 ${bg} ${border} ${onTabClick ? `${hover} cursor-pointer` : ''} select-none transition-colors`}
              title={onTabClick ? `View ${label} in Delivery Orders` : undefined}
            >
              <span className={`text-xl font-bold ${countColor}`}>{count}</span>
              <span className={`mt-0.5 text-center text-xs font-semibold leading-tight ${labelColor}`}>{label}</span>
              <span className="mt-0.5 text-center text-[10px] text-gray-400 dark:text-gray-500">→ {sublabel}</span>
            </div>
          ))}
        </div>
        {onTabClick && (pendingOrdersCount > 0 || unassignedCount > 0 || awaitingOrders.length > 0 || orderDelayCount > 0) && (
          <p className="mt-3 text-center text-[10px] text-gray-400 dark:text-gray-500">Tap any card to filter the order table</p>
        )}
      </div>

      {/* ── Awaiting Customer Response (mirrors dashboard scrollable list) ── */}
      <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-100 dark:border-gray-700">
        <div className="mb-3 flex items-center gap-2">
          <MessageSquare className="h-4 w-4 flex-shrink-0 text-purple-500" />
          <h3 className="font-semibold text-sm text-gray-900 dark:text-gray-100">Awaiting Customer Response</h3>
          {awaitingOrders.length > 0 && (
            <span className="ml-auto rounded-full bg-purple-100 px-2 py-0.5 text-xs font-bold text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">
              {awaitingOrders.length}
            </span>
          )}
        </div>
        {awaitingOrders.length === 0 ? (
          <div className="flex items-center justify-center py-4 text-sm text-gray-400 dark:text-gray-500">
            <CheckCircle className="mr-2 h-4 w-4 flex-shrink-0 text-green-400" />
            All customers responded ✓
          </div>
        ) : (
          <div className="max-h-52 overflow-y-auto pr-0.5 space-y-2">
            {awaitingOrders.map((o) => {
              const sentAt = o.smsSentAt ?? o.uploadedAt;
              const diff = Date.now() - sentAt.getTime();
              const h = Math.floor(diff / 3_600_000);
              const m = Math.floor((diff % 3_600_000) / 60_000);
              const sentAgo = h > 0 ? `${h}h ago` : `${m}m ago`;
              return (
                <div key={o.id} className="flex items-start gap-3 rounded-lg border border-purple-100 bg-purple-50 p-2.5 dark:border-purple-800/20 dark:bg-purple-900/10">
                  <Clock className="mt-0.5 h-4 w-4 flex-shrink-0 text-purple-500" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                      {o.customerName}
                    </p>
                    <p className="truncate text-xs text-gray-500 dark:text-gray-400">
                      {o.orderNumber ? `PO: ${o.orderNumber}` : ''}{o.area ? ` · ${o.area}` : ''}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-purple-600 dark:text-purple-400">{sentAgo}</span>
                </div>
              );
            })}
          </div>
        )}
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
