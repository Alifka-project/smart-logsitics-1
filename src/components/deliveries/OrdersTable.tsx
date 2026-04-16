import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Download, FileSpreadsheet, Search, X, SlidersHorizontal } from 'lucide-react';
import type { DeliveryOrder, DeliveryStatus } from '../../types/delivery';
import { STATUS_CONFIG } from '../../config/statusColors';
import { RescheduleModal } from './RescheduleModal';
import PaginationBar from '../common/PaginationBar';
import { rescheduleDateToWorkflow } from '../../utils/deliveryWorkflowMap';

export type OrdersTableTab =
  | 'all'
  | 'pending'
  | 'awaiting_customer'
  | 'confirmed'        // all confirmed orders (next + future + generic)
  | 'next_shipment'    // specific: today / tomorrow / day+2
  | 'future_schedule'  // specific: 3+ days out
  | 'scheduled'        // next + future combined
  | 'out_for_delivery'
  | 'order_delay'
  | 'rescheduled'
  | 'delivered';       // completed / delivered orders

function OrderStatusPill({ status }: { status: DeliveryStatus }): React.ReactElement {
  const c = STATUS_CONFIG[status];
  const text = c.pillLabel ?? c.label;
  return (
    <span
      className={`inline-flex max-w-full items-center gap-1.5 whitespace-nowrap rounded-md border px-2.5 py-1.5 text-xs font-semibold leading-none shadow-sm ${c.badgeStyle} ${c.borderColor}`}
      title={c.pillLabel ? c.label : undefined}
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-55" aria-hidden />
      {text}
    </span>
  );
}

interface OrdersTableProps {
  orders: DeliveryOrder[];
  tableTab: OrdersTableTab;
  onTableTabChange: (tab: OrdersTableTab) => void;
  onStatusChange: (orderId: string, newStatus: DeliveryStatus, scheduledDate?: Date) => void;
  onAdminReschedule?: (orderId: string, newDate: Date, reason: string) => void;
  onResendSMS: (orderId: string) => void;
  onCallCustomer: (phone: string) => void;
  onWhatsApp: (phone: string) => void;
  onTrackDelivery?: (orderId: string) => void;
  onEditOrder: (orderId: string) => void;
  onMarkOutForDelivery?: (orderId: string) => Promise<void>;
  onExport?: () => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  sortBy: string;
  onSortChange: (sort: string) => void;
  /** Optional: list of drivers for the Assign Driver action (combined dispatch feature) */
  drivers?: { id: string; fullName?: string | null; username: string }[];
  /** Optional: callback when a driver is assigned to an order */
  onAssignDriver?: (orderId: string, driverId: string) => void;
  /** Toggle the priority flag for an order (Logistics-only) */
  onTogglePriority?: (orderId: string, newIsPriority: boolean) => void;
  /** Returns driver capacity info for a given order+driver pair */
  getDriverCapacity?: (orderId: string, driverId: string) => { used: number; max: number; remaining: number; full: boolean } | null;
  /** Enable Today + date range filters in header */
  enableDispatchFilters?: boolean;
  onRefresh?: () => void;
}

const CONFIRMED_STATUSES = new Set<DeliveryStatus>(['confirmed', 'next_shipment', 'future_schedule', 'ready_to_dispatch']);
const SCHEDULED_STATUSES = new Set<DeliveryStatus>(['scheduled', 'next_shipment', 'future_schedule', 'ready_to_dispatch']);
// Terminal workflow statuses — same list as StatusMetricCards so card count === table count
const PENDING_TERMINAL = new Set<DeliveryStatus>(['delivered', 'cancelled', 'failed']);
// Delivered workflow statuses (backend variants are already mapped to 'delivered' by deliveryToManageOrder)
const DELIVERED_STATUSES = new Set<DeliveryStatus>(['delivered']);
// Statuses that should display as "Confirmed" in the Status column pill
// (the Action column already shows the specific sub-status via NextStepBadge)
const DISPLAY_AS_CONFIRMED = new Set<DeliveryStatus>(['next_shipment', 'future_schedule', 'ready_to_dispatch', 'rescheduled']);

function matchesTableTab(order: DeliveryOrder, tab: OrdersTableTab): boolean {
  switch (tab) {
    case 'all':           return true;
    case 'pending':       return !PENDING_TERMINAL.has(order.status);
    case 'awaiting_customer': return order.status === 'sms_sent' || order.status === 'unconfirmed';
    case 'confirmed':      return CONFIRMED_STATUSES.has(order.status);
    case 'next_shipment':  return order.status === 'next_shipment';
    case 'future_schedule': return order.status === 'future_schedule';
    case 'scheduled':      return SCHEDULED_STATUSES.has(order.status);
    case 'out_for_delivery':  return order.status === 'out_for_delivery';
    case 'order_delay':   return order.status === 'order_delay';
    case 'rescheduled':   return order.status === 'rescheduled' || order.isRescheduled === true;
    case 'delivered':     return DELIVERED_STATUSES.has(order.status);
    default:              return true;
  }
}


interface StepConfig {
  label: string;
  icon: string;
  cls: string;
  /** Optional secondary badge shown below the primary (e.g. GMD status) */
  gmd?: { label: string; cls: string };
}

/** Maps workflow status → next-step indicator(s) shown in the action column */
const NEXT_STEP_CONFIG: Partial<Record<DeliveryStatus | 'terminal_delivered' | 'terminal_cancelled' | 'terminal_failed', StepConfig>> = {
  uploaded:    {
    label: 'Resend SMS',      icon: '📱',
    cls: 'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-900/20 dark:text-orange-300 dark:border-orange-800/40',
  },
  sms_sent:    {
    label: 'Resend SMS',      icon: '📱',
    cls: 'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-900/20 dark:text-orange-300 dark:border-orange-800/40',
  },
  unconfirmed: {
    label: 'Resend SMS',      icon: '⚠️',
    cls: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-300 dark:border-red-800/40',
  },
  confirmed: {
    label: 'Assign Driver',   icon: '✅',
    cls: 'bg-green-50 text-green-700 border-green-200 dark:bg-green-900/20 dark:text-green-300 dark:border-green-800/40',
  },
  next_shipment: {
    label: 'Next Shipment',   icon: '📦',
    cls: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-300 dark:border-amber-800/40',
    gmd: { label: 'Waiting GMD', cls: 'bg-slate-50 text-slate-600 border-slate-200 dark:bg-slate-800/40 dark:text-slate-400 dark:border-slate-700' },
  },
  future_schedule: {
    label: 'Future Schedule', icon: '📅',
    cls: 'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-900/20 dark:text-indigo-300 dark:border-indigo-800/40',
    gmd: { label: 'Waiting GMD', cls: 'bg-slate-50 text-slate-600 border-slate-200 dark:bg-slate-800/40 dark:text-slate-400 dark:border-slate-700' },
  },
  ready_to_dispatch: {
    label: 'GMD Updated',     icon: '✅',
    cls: 'bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-900/20 dark:text-teal-300 dark:border-teal-800/40',
    gmd: { label: 'Ready to Dispatch', cls: 'bg-teal-100 text-teal-800 border-teal-300 dark:bg-teal-900/30 dark:text-teal-200 dark:border-teal-700' },
  },
  order_delay: {
    label: 'Action Needed',   icon: '🚨',
    cls: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-300 dark:border-red-800/40',
  },
  out_for_delivery: {
    label: 'Out for Delivery',icon: '🚚',
    cls: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:text-blue-300 dark:border-blue-800/40',
    gmd: { label: 'Waiting for POD', cls: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-300 dark:border-amber-800/40' },
  },
  rescheduled: {
    label: 'Next Shipment',   icon: '🔄',
    cls: 'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-900/20 dark:text-orange-300 dark:border-orange-800/40',
  },
  scheduled: {
    label: 'Awaiting SMS',    icon: '⏳',
    cls: 'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-900/20 dark:text-purple-300 dark:border-purple-800/40',
  },
  terminal_delivered: {
    label: 'POD Submitted',   icon: '✓',
    cls: 'bg-green-50 text-green-600 border-green-200 dark:bg-green-900/20 dark:text-green-400 dark:border-green-800/40',
  },
  terminal_cancelled: {
    label: 'Cancelled',       icon: '✕',
    cls: 'bg-gray-100 text-gray-500 border-gray-200 dark:bg-gray-700/40 dark:text-gray-400 dark:border-gray-600',
  },
  terminal_failed: {
    label: 'Returned',        icon: '↩',
    cls: 'bg-gray-100 text-gray-500 border-gray-200 dark:bg-gray-700/40 dark:text-gray-400 dark:border-gray-600',
  },
};

/** Non-clickable indicator pill(s) showing the recommended next action for this order */
function NextStepBadge({ status }: { status: DeliveryStatus }): React.ReactElement | null {
  const cfg = NEXT_STEP_CONFIG[status];
  if (!cfg) return null;
  return (
    <div className="flex flex-col gap-1 w-full">
      {/* Primary next-step badge */}
      <span
        className={`inline-flex w-full items-center justify-center gap-1 px-1.5 py-1 rounded border text-[10px] font-semibold leading-none select-none ${cfg.cls}`}
        title={`Next step: ${cfg.label}`}
        aria-label={`Next step: ${cfg.label}`}
      >
        <span aria-hidden className="text-[10px]">{cfg.icon}</span>
        {cfg.label}
      </span>
      {/* Secondary GMD badge (shown for next_shipment, future_schedule, out_for_delivery) */}
      {cfg.gmd && (
        <span
          className={`inline-flex w-full items-center justify-center gap-1 px-1.5 py-1 rounded border text-[10px] font-medium leading-none select-none ${cfg.gmd.cls}`}
          aria-label={cfg.gmd.label}
        >
          <span aria-hidden className="text-[9px]">⧖</span>
          {cfg.gmd.label}
        </span>
      )}
    </div>
  );
}

interface ActionDropdownProps {
  order: DeliveryOrder;
  onStatusChange: (orderId: string, newStatus: DeliveryStatus) => void;
  onResendSMS: (orderId: string) => void;
  onMarkOutForDelivery?: (orderId: string) => Promise<void>;
  onTrackDelivery?: (orderId: string) => void;
  onEditOrder: (orderId: string) => void;
  onReschedule: (order: DeliveryOrder) => void;
}

function ActionDropdown({
  order,
  onStatusChange: _onStatusChange,
  onResendSMS: _onResendSMS,
  onMarkOutForDelivery: _onMarkOutForDelivery,
  onTrackDelivery,
  onEditOrder,
  onReschedule: _onReschedule,
}: ActionDropdownProps) {
  const s = order.status;
  const isTerminal = s === 'delivered' || s === 'cancelled' || s === 'failed';
  const isOnRoute = s === 'out_for_delivery';

  // Terminal orders: show a simple completion indicator, no action button
  if (isTerminal) {
    const termKey = `terminal_${s}` as 'terminal_delivered' | 'terminal_cancelled' | 'terminal_failed';
    const cfg = NEXT_STEP_CONFIG[termKey];
    if (!cfg) return null;
    return (
      <span
        className={`inline-flex w-full items-center justify-center gap-1 px-1.5 py-1 rounded border text-[10px] font-semibold leading-none select-none ${cfg.cls}`}
        aria-label={cfg.label}
      >
        <span aria-hidden>{cfg.icon}</span>
        {cfg.label}
      </span>
    );
  }

  return (
    <div className="flex flex-col items-stretch gap-1.5">
      {/* Next-step indicator — always visible, non-clickable */}
      <NextStepBadge status={s} />

      {isOnRoute && (
        <button
          type="button"
          onClick={() => onTrackDelivery?.(order.id)}
          className="w-full px-2.5 py-1.5 text-[11px] font-semibold rounded border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700 whitespace-nowrap transition-colors"
        >
          Track →
        </button>
      )}

      {!isOnRoute && (
        <button
          type="button"
          onClick={() => onEditOrder(order.id)}
          className="w-full flex items-center justify-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold rounded border border-[#002D5B]/30 bg-[#002D5B]/5 text-[#002D5B] hover:bg-[#002D5B] hover:text-white dark:border-blue-500/40 dark:bg-blue-900/20 dark:text-blue-300 dark:hover:bg-blue-700 dark:hover:text-white transition-colors whitespace-nowrap"
          title="Edit order"
        >
          Edit Order ✏️
        </button>
      )}
    </div>
  );
}

export const OrdersTable: React.FC<OrdersTableProps> = ({
  orders,
  tableTab,
  onTableTabChange,
  onStatusChange,
  onAdminReschedule,
  onResendSMS,
  onCallCustomer,
  onWhatsApp,
  onTrackDelivery,
  onEditOrder,
  onMarkOutForDelivery,
  onExport,
  searchQuery,
  onSearchChange,
  sortBy,
  onSortChange,
  drivers,
  onAssignDriver,
  onTogglePriority,
  getDriverCapacity,
  enableDispatchFilters = false,
  onRefresh,
}) => {
  const [rescheduleOrder, setRescheduleOrder] = useState<DeliveryOrder | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [assigningDriverId, setAssigningDriverId] = useState<string | null>(null);
  const [todayOnly, setTodayOnly] = useState(false);
  const [filterDate, setFilterDate] = useState('');
  const [priorityOnly, setPriorityOnly] = useState(false);
  const [driverFilter, setDriverFilter] = useState<string>('all');
  const tableTopRef = useRef<HTMLDivElement | null>(null);
  const itemsPerPage = 20;

  const filteredOrders = useMemo(() => {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);
    return orders.filter((order) => {
      const matchesStatus = matchesTableTab(order, tableTab);
      const q = searchQuery.trim().toLowerCase();
      const matchesSearch =
        !q ||
        order.customerName.toLowerCase().includes(q) ||
        order.orderNumber.toLowerCase().includes(q) ||
        (order.deliveryNumber?.toLowerCase().includes(q) ?? false) ||
        order.area.toLowerCase().includes(q) ||
        order.address.toLowerCase().includes(q) ||
        order.customerPhone.toLowerCase().includes(q) ||
        order.product.toLowerCase().includes(q) ||
        (order.model?.toLowerCase().includes(q) ?? false) ||
        (order.productDescription?.toLowerCase().includes(q) ?? false) ||
        (order.driverName?.toLowerCase().includes(q) ?? false) ||
        (order.orderType?.toLowerCase().includes(q) ?? false) ||
        order.status.toLowerCase().includes(q);
      if (todayOnly) {
        const uploadedMs = order.uploadedAt.getTime();
        if (uploadedMs < startOfToday.getTime() || uploadedMs > endOfToday.getTime()) return false;
      }
      if (filterDate) {
        const selectedMs = new Date(filterDate + 'T00:00:00').getTime();
        const selectedEnd = selectedMs + 86400000; // +1 day
        if (order.uploadedAt.getTime() < selectedMs || order.uploadedAt.getTime() >= selectedEnd) return false;
      }
      if (priorityOnly && order.isPriority !== true) return false;
      if (driverFilter !== 'all') {
        if (order.driverId !== driverFilter) return false;
      }
      return matchesStatus && matchesSearch;
    });
  }, [orders, tableTab, searchQuery, todayOnly, filterDate, priorityOnly, driverFilter]);

  const sortedOrders = useMemo(() => {
    const list = [...filteredOrders];
    switch (sortBy) {
      case 'oldest':
        list.sort((a, b) => a.uploadedAt.getTime() - b.uploadedAt.getTime());
        break;
      case 'customer':
        list.sort((a, b) => a.customerName.localeCompare(b.customerName));
        break;
      case 'area':
        list.sort((a, b) => a.area.localeCompare(b.area));
        break;
      case 'newest':
      default:
        list.sort((a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime());
        break;
    }
    return list;
  }, [filteredOrders, sortBy]);

  const totalPages = Math.max(1, Math.ceil(sortedOrders.length / itemsPerPage));

  useEffect(() => {
    setCurrentPage((p) => Math.min(p, totalPages));
  }, [totalPages]);

  useEffect(() => {
    setCurrentPage(1);
  }, [tableTab, searchQuery, sortBy]);

  const paginatedOrders = sortedOrders.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const getDeliveryDateDisplay = (order: DeliveryOrder) => {
    const fmtDate = (d: Date) =>
      d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' });

    // Always prefer the most specific confirmed date
    const dateSource =
      order.confirmedDeliveryDate ??
      order.deliveryDate ??
      order.scheduledDate;

    // Color the date by status context
    if (order.status === 'next_shipment') {
      return dateSource ? (
        <span className="font-semibold text-amber-700 dark:text-amber-300">{fmtDate(dateSource)}</span>
      ) : <span className="text-gray-400 dark:text-gray-500">—</span>;
    }
    if (order.status === 'future_schedule' || order.status === 'scheduled') {
      return dateSource ? (
        <span className="font-semibold text-indigo-700 dark:text-indigo-300">{fmtDate(dateSource)}</span>
      ) : <span className="text-gray-400 dark:text-gray-500">—</span>;
    }
    if (order.status === 'ready_to_dispatch') {
      return dateSource ? (
        <span className="font-semibold text-teal-700 dark:text-teal-300">{fmtDate(dateSource)}</span>
      ) : <span className="text-gray-400 dark:text-gray-500">—</span>;
    }
    if (order.status === 'confirmed') {
      return dateSource ? (
        <span className="font-medium text-amber-600 dark:text-amber-400">{fmtDate(dateSource)}</span>
      ) : <span className="text-gray-400 dark:text-gray-500">—</span>;
    }
    if (order.status === 'order_delay') {
      return dateSource ? (
        <span className="font-medium text-red-600 dark:text-red-400">{fmtDate(dateSource)}</span>
      ) : <span className="text-red-400 dark:text-red-500">—</span>;
    }
    if (order.status === 'delivered') {
      const dDate = order.deliveryDate ?? order.confirmedDeliveryDate;
      return dDate ? (
        <span className="font-medium text-green-600 dark:text-green-400">{fmtDate(dDate)}</span>
      ) : <span className="text-gray-400 dark:text-gray-500">—</span>;
    }
    if (order.status === 'out_for_delivery') {
      const ofdDate = order.confirmedDeliveryDate ?? order.scheduledDate ?? order.deliveryDate;
      return ofdDate ? (
        <span className="font-medium text-[#002D5B] dark:text-blue-200">{fmtDate(ofdDate)}</span>
      ) : <span className="text-gray-400 dark:text-gray-500">—</span>;
    }
    // For uploaded/sms_sent/unconfirmed — show date if available, else dash
    return dateSource ? (
      <span className="text-gray-600 dark:text-gray-400">{fmtDate(dateSource)}</span>
    ) : <span className="text-gray-400 dark:text-gray-500">—</span>;
  };

  const filterTabs: { key: OrdersTableTab; label: string; count: number }[] = [
    { key: 'all',              label: 'All',              count: orders.length },
    { key: 'pending',          label: 'Pending Orders',   count: orders.filter((o) => !PENDING_TERMINAL.has(o.status)).length },
    { key: 'awaiting_customer',label: 'Awaiting Customer',count: orders.filter((o) => o.status === 'sms_sent' || o.status === 'unconfirmed').length },
    { key: 'next_shipment',    label: 'Next Shipment',    count: orders.filter((o) => o.status === 'next_shipment').length },
    { key: 'future_schedule',  label: 'Future Schedule',  count: orders.filter((o) => o.status === 'future_schedule').length },
    { key: 'out_for_delivery', label: 'On Route',         count: orders.filter((o) => o.status === 'out_for_delivery').length },
    { key: 'order_delay',      label: 'Order Delay',      count: orders.filter((o) => o.status === 'order_delay').length },
    { key: 'rescheduled',      label: 'Rescheduled',      count: orders.filter((o) => o.isRescheduled === true).length },
    { key: 'delivered',        label: 'Delivered',        count: orders.filter((o) => DELIVERED_STATUSES.has(o.status)).length },
  ];

  const scrollToTableTop = (): void => {
    tableTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const goToPage = (nextPage: number): void => {
    setCurrentPage(nextPage);
    scrollToTableTop();
  };

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200/80 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
      <div ref={tableTopRef} />
      <div className="border-b border-gray-100 px-4 py-4 dark:border-gray-700 sm:px-5">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-gray-900 dark:text-white">Delivery Orders</h2>
            <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
              Filter by status, search, and sort below — KPI cards above are summary only.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {onRefresh && (
              <button
                type="button"
                onClick={onRefresh}
                className="shrink-0 inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                title="Refresh orders"
              >
                <span aria-hidden>🔄</span>
                <span>Refresh</span>
              </button>
            )}
            {onExport && (
              <button
                type="button"
                onClick={onExport}
                className="shrink-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-emerald-600 text-white hover:bg-emerald-700 active:bg-emerald-800 shadow-sm hover:shadow-md transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800"
                title="Export current filtered orders to Excel"
              >
                <FileSpreadsheet className="h-4 w-4 shrink-0" aria-hidden />
                <span>Export Excel</span>
                <Download className="h-3.5 w-3.5 shrink-0 opacity-75" aria-hidden />
              </button>
            )}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {/* Search bar */}
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400 dark:text-gray-500" aria-hidden />
            <input
              type="search"
              placeholder="Search name, phone, order #, area…"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              className="w-full pl-9 pr-9 py-2 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#002D5B] focus:border-transparent"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => onSearchChange('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                aria-label="Clear search"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {/* Status filter */}
          <div className="relative shrink-0">
            <SlidersHorizontal className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400 dark:text-gray-500" aria-hidden />
            <select
              value={tableTab}
              onChange={(e) => onTableTabChange(e.target.value as OrdersTableTab)}
              className="appearance-none pl-8 pr-8 py-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-[#002D5B] cursor-pointer"
            >
              {filterTabs.map((tab) => (
                <option key={tab.key} value={tab.key}>
                  {tab.label} ({tab.count})
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400 dark:text-gray-500" aria-hidden />
          </div>

          {/* Sort */}
          <div className="relative shrink-0">
            <select
              value={sortBy}
              onChange={(e) => onSortChange(e.target.value)}
              className="appearance-none pl-3 pr-8 py-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-[#002D5B] cursor-pointer"
            >
              <option value="newest">↓ Newest</option>
              <option value="oldest">↑ Oldest</option>
              <option value="customer">A–Z Customer</option>
              <option value="area">A–Z Area</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400 dark:text-gray-500" aria-hidden />
          </div>

          {/* Clear filters + results count */}
          {(tableTab !== 'all' || searchQuery) && (
            <button
              type="button"
              onClick={() => { onTableTabChange('all'); onSearchChange(''); setDriverFilter('all'); setFilterDate(''); setTodayOnly(false); setPriorityOnly(false); }}
              className="shrink-0 flex items-center gap-1 px-2.5 py-2 rounded-lg text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
            >
              <X className="h-3 w-3" />
              Clear
            </button>
          )}

          {enableDispatchFilters && (
            <>
              <button
                type="button"
                onClick={() => setTodayOnly(v => !v)}
                className={`shrink-0 px-3 py-2 rounded-lg text-xs font-semibold transition-colors ${
                  todayOnly ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300'
                }`}
                title="Show only orders uploaded today"
              >
                📅 Today
              </button>
              <button
                type="button"
                onClick={() => setPriorityOnly(v => !v)}
                className={`shrink-0 px-3 py-2 rounded-lg text-xs font-semibold transition-colors ${
                  priorityOnly ? 'bg-red-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300'
                }`}
                title="Show only priority orders"
              >
                🚨 Priority
              </button>
              {drivers && drivers.length > 0 && (
                <select
                  value={driverFilter}
                  onChange={e => { setDriverFilter(e.target.value); setCurrentPage(1); }}
                  className="shrink-0 appearance-none px-3 py-2 rounded-lg text-xs font-semibold bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 border-0 focus:outline-none focus:ring-2 focus:ring-[#002D5B] cursor-pointer"
                >
                  <option value="all">🚗 All Drivers</option>
                  {drivers.map(dr => (
                    <option key={dr.id} value={dr.id}>{dr.fullName || dr.username}</option>
                  ))}
                </select>
              )}
              <div className="shrink-0 flex items-center gap-1.5">
                <label className="relative flex items-center gap-1.5 cursor-pointer group">
                  <span className={`flex items-center gap-1 px-3 py-2 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                    filterDate ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300'
                  }`}>
                    📅 {filterDate ? new Date(filterDate + 'T12:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : 'Date'}
                  </span>
                  <input
                    type="date"
                    value={filterDate}
                    onChange={e => { setFilterDate(e.target.value); setCurrentPage(1); }}
                    className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
                  />
                </label>
                {filterDate && (
                  <button type="button" onClick={() => { setFilterDate(''); setCurrentPage(1); }} className="text-xs text-red-500 hover:text-red-700 dark:text-red-400">✕</button>
                )}
              </div>
            </>
          )}

          <span className="shrink-0 text-xs text-gray-500 dark:text-gray-400 tabular-nums">
            {sortedOrders.length} {sortedOrders.length === 1 ? 'order' : 'orders'}
          </span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="manage-orders-table-mobile table-mobile-cards table-fixed min-w-[1300px] md:min-w-[1500px] border-collapse text-sm">
          <colgroup>
            <col style={{ width: '140px' }} />
            <col style={{ width: '160px' }} />
            <col style={{ width: '70px' }} />
            <col style={{ width: '110px' }} />
            <col style={{ width: '110px' }} />
            <col style={{ width: '100px' }} />
            <col style={{ width: '100px' }} />
            <col style={{ width: '85px' }} />
            <col style={{ width: '110px' }} />
            <col style={{ width: '1%' }} />
            <col style={{ width: '100px' }} />
            <col style={{ width: '200px' }} />
            <col style={{ width: '140px' }} />
            <col style={{ width: '120px' }} />
          </colgroup>
          <thead className="border-b border-gray-200 bg-gray-50/95 dark:border-gray-600 dark:bg-gray-900/90">
            <tr>
              <th className="min-w-[130px] w-[140px] whitespace-nowrap px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                Customer
              </th>
              <th className="min-w-[150px] w-[160px] whitespace-nowrap px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                Phone
              </th>
              <th className="min-w-[65px] w-[70px] whitespace-nowrap px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                Type
              </th>
              <th className="min-w-[100px] w-[110px] whitespace-nowrap px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                PO Number
              </th>
              <th className="min-w-[100px] w-[110px] whitespace-nowrap px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                Delivery No.
              </th>
              <th className="min-w-[95px] w-[100px] whitespace-nowrap px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                Del. Date
              </th>
              <th className="min-w-[95px] w-[100px] whitespace-nowrap px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                GMD Date
              </th>
              <th className="min-w-[80px] w-[85px] whitespace-nowrap px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                Area
              </th>
              <th className="min-w-[100px] w-[110px] whitespace-nowrap px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                Model
              </th>
              <th className="whitespace-nowrap px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                Description
              </th>
              <th className="min-w-[90px] w-[100px] whitespace-nowrap px-3 py-2.5 text-center text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                Priority
              </th>
              <th className="min-w-[180px] w-[200px] whitespace-nowrap px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                Driver
              </th>
              <th className="min-w-[130px] w-[140px] whitespace-nowrap px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                Status
              </th>
              <th className="min-w-[110px] w-[120px] whitespace-nowrap px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                Action
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700/80">
            {paginatedOrders.length === 0 ? (
              <tr>
                <td colSpan={14} className="px-4 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
                  No orders match the current filters.
                </td>
              </tr>
            ) : (
              paginatedOrders.map((order) => {
                const fmtDate = (d: Date) =>
                  d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' });
                return (
                  <tr
                    key={order.id}
                    className="transition-colors hover:bg-gray-50/90 dark:hover:bg-gray-900/40"
                  >
                    <td className="min-w-[130px] w-[140px] overflow-hidden px-3 py-2.5 align-middle" data-label="Customer">
                      <span className="line-clamp-2 block font-medium leading-snug text-gray-900 dark:text-white" title={order.customerName}>
                        {order.customerName}
                      </span>
                    </td>
                    <td className="min-w-[150px] w-[160px] overflow-hidden px-3 py-2.5 align-middle" data-label="Phone">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <span className="min-w-0 shrink text-[13px] tabular-nums text-gray-700 dark:text-gray-300 truncate">
                          {order.customerPhone}
                        </span>
                        <div className="flex shrink-0 items-center gap-0.5">
                          <button
                            type="button"
                            onClick={() => onCallCustomer(order.customerPhone)}
                            className="flex h-7 w-7 items-center justify-center rounded bg-blue-100 text-blue-700 hover:bg-blue-200 dark:bg-blue-900/50 dark:text-blue-200 dark:hover:bg-blue-900/70"
                            title="Call customer"
                          >
                            <span className="text-xs" aria-hidden>📞</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => onWhatsApp(order.customerPhone)}
                            className="flex h-7 w-7 items-center justify-center rounded bg-green-100 text-green-700 hover:bg-green-200 dark:bg-green-900/50 dark:text-green-200 dark:hover:bg-green-900/70"
                            title="WhatsApp"
                          >
                            <span className="text-xs" aria-hidden>💬</span>
                          </button>
                        </div>
                      </div>
                    </td>
                    <td className="min-w-[65px] w-[70px] overflow-hidden px-3 py-2.5 align-middle" data-label="Type">
                      <span
                        className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                          order.orderType === 'B2C'
                            ? 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300'
                            : 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300'
                        }`}
                      >
                        {order.orderType ?? 'B2B'}
                      </span>
                    </td>
                    <td className="min-w-[100px] w-[110px] overflow-hidden px-3 py-2.5 align-middle" data-label="PO Number">
                      <span className="block truncate font-mono text-[13px] text-gray-700 dark:text-gray-300" title={order.orderNumber}>
                        {order.orderNumber}
                      </span>
                    </td>
                    <td className="min-w-[100px] w-[110px] overflow-hidden px-3 py-2.5 align-middle" data-label="Delivery Number">
                      <span className="block truncate font-mono text-[13px] text-gray-500 dark:text-gray-400" title={order.deliveryNumber ?? ''}>
                        {order.deliveryNumber || '—'}
                      </span>
                    </td>
                    <td className="min-w-[95px] w-[100px] overflow-hidden px-3 py-2.5 align-middle text-[13px]" data-label="Del. Date">
                      {getDeliveryDateDisplay(order)}
                    </td>
                    <td className="min-w-[95px] w-[100px] overflow-hidden px-3 py-2.5 align-middle text-[13px]" data-label="GMD Date">
                      {order.goodsMovementDate ? (
                        <span className="font-medium text-teal-700 dark:text-teal-300">
                          {fmtDate(order.goodsMovementDate)}
                        </span>
                      ) : (
                        <span className="text-gray-400 dark:text-gray-500">—</span>
                      )}
                    </td>
                    <td className="min-w-[80px] w-[85px] overflow-hidden px-3 py-2.5 align-middle" data-label="Area">
                      <span className="line-clamp-2 text-[13px] leading-snug text-gray-700 dark:text-gray-300">
                        {order.area}
                      </span>
                    </td>
                    <td className="min-w-[100px] w-[110px] overflow-hidden px-3 py-2.5 align-middle" data-label="Model">
                      <span
                        className="block truncate text-[13px] leading-snug text-gray-800 dark:text-gray-200"
                        title={order.model ?? '—'}
                      >
                        {order.model || '—'}
                      </span>
                    </td>
                    <td className="min-w-0 overflow-hidden px-3 py-2.5 align-middle" data-label="Description">
                      <span
                        className="line-clamp-2 block break-words text-[13px] leading-snug text-gray-800 dark:text-gray-200"
                        title={order.productDescription ?? order.product}
                      >
                        {order.productDescription || order.product}
                      </span>
                    </td>
                    <td className="min-w-[90px] w-[100px] px-3 py-2.5 align-middle text-center" data-label="Priority">
                      {onTogglePriority ? (
                        <button
                          type="button"
                          onClick={() => onTogglePriority(order.id, !order.isPriority)}
                          className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-bold transition-colors whitespace-nowrap ${
                            order.isPriority
                              ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 border border-red-300 dark:border-red-700 hover:bg-red-200 dark:hover:bg-red-900/50'
                              : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 border border-gray-300 dark:border-gray-600 hover:bg-gray-200 dark:hover:bg-gray-600'
                          }`}
                          title={order.isPriority ? 'Click to set Normal' : 'Click to set Priority'}
                        >
                          {order.isPriority ? '🚨 Priority' : '📦 Normal'}
                        </button>
                      ) : (
                        <span className="text-gray-300 dark:text-gray-600 text-xs">—</span>
                      )}
                    </td>
                    <td className="min-w-[180px] w-[200px] overflow-hidden px-3 py-2.5 align-middle" data-label="Driver">
                      {drivers && drivers.length > 0 && onAssignDriver ? (
                        <div className="flex flex-col gap-1">
                          {/* Current driver display */}
                          {order.driverName && (
                            <span className="flex items-center gap-1 text-[12px] font-medium text-indigo-700 dark:text-indigo-300 truncate">
                              <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-green-500" />
                              {order.driverName}
                            </span>
                          )}
                          {/* Assign / Reassign dropdown */}
                          <select
                            value={order.driverId || ''}
                            disabled={assigningDriverId === order.id}
                            onChange={async (e) => {
                              const newDriverId = e.target.value;
                              if (!newDriverId) return;
                              setAssigningDriverId(order.id);
                              try {
                                await onAssignDriver(order.id, newDriverId);
                              } finally {
                                setAssigningDriverId(null);
                              }
                            }}
                            className="w-full max-w-full px-2 py-1 border border-gray-200 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-[11px] text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-[#002D5B] disabled:opacity-50 cursor-pointer"
                          >
                            <option value="">{order.driverId ? '— Reassign —' : '— Assign driver —'}</option>
                            {drivers.map((driver) => {
                              const cap = getDriverCapacity?.(order.id, driver.id);
                              const capHint = cap ? ` — ${cap.remaining} left (${cap.used}/${cap.max})` : '';
                              const isFull = cap?.full === true && driver.id !== order.driverId;
                              return (
                                <option key={driver.id} value={driver.id} disabled={isFull}>
                                  {(driver.fullName || driver.username) + capHint}
                                </option>
                              );
                            })}
                          </select>
                          {assigningDriverId === order.id && (
                            <span className="text-[11px] text-blue-500 dark:text-blue-400">Assigning…</span>
                          )}
                        </div>
                      ) : (
                        /* Fallback: just show driver name when no driver list available */
                        order.driverName ? (
                          <span className="block truncate text-[13px] font-medium text-indigo-700 dark:text-indigo-300" title={order.driverName}>
                            🚗 {order.driverName}
                          </span>
                        ) : (
                          <span className="text-[12px] text-gray-400 dark:text-gray-500 italic">Unassigned</span>
                        )
                      )}
                    </td>
                    <td className="min-w-[130px] w-[140px] overflow-hidden px-3 py-2.5 align-middle" data-label="Status">
                      <div className="inline-flex flex-col gap-1 max-w-full">
                        <OrderStatusPill status={
                          DISPLAY_AS_CONFIRMED.has(order.status) ? 'confirmed' :
                          order.isRescheduled ? 'rescheduled' : order.status
                        } />
                      </div>
                    </td>
                    <td className="min-w-[110px] w-[120px] px-3 py-2.5 align-middle" data-label="Action">
                      <ActionDropdown
                        order={order}
                        onStatusChange={onStatusChange}
                        onResendSMS={onResendSMS}
                        onMarkOutForDelivery={onMarkOutForDelivery}
                        onTrackDelivery={onTrackDelivery}
                        onEditOrder={onEditOrder}
                        onReschedule={(o) => setRescheduleOrder(o)}
                      />
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <PaginationBar
        page={currentPage}
        totalPages={totalPages}
        pageSize={itemsPerPage}
        total={sortedOrders.length}
        onPageChange={goToPage}
      />

      {rescheduleOrder && (
        <RescheduleModal
          order={rescheduleOrder}
          onClose={() => setRescheduleOrder(null)}
          onReschedule={(newDate, reason) => {
            if (onAdminReschedule) {
              onAdminReschedule(rescheduleOrder.id, newDate, reason);
            } else {
              const workflow = rescheduleDateToWorkflow(newDate);
              onStatusChange(rescheduleOrder.id, workflow, newDate);
            }
            setRescheduleOrder(null);
          }}
        />
      )}
    </div>
  );
};
