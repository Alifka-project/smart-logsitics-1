import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Download, FileSpreadsheet, RefreshCw, Search, X, SlidersHorizontal } from 'lucide-react';
import { DateRangePicker } from '../common/DateRangePicker';
import type { DeliveryOrder, DeliveryStatus } from '../../types/delivery';
import { STATUS_CONFIG } from '../../config/statusColors';
import { RescheduleModal } from './RescheduleModal';
import PaginationBar from '../common/PaginationBar';
import { rescheduleDateToWorkflow, classifyConfirmedDate } from '../../utils/deliveryWorkflowMap';

import useDeliveryStore from '../../store/useDeliveryStore';

// ── DateRangePicker is imported from components/common/DateRangePicker ──────────

export type OrdersTableTab =
  | 'all'
  | 'pending'
  | 'awaiting_customer'
  | 'unconfirmed'      // customer was messaged but never replied (status = unconfirmed only)
  | 'confirmed'        // all confirmed orders (next + future + generic)
  | 'next_shipment'    // specific: today / tomorrow / day+2
  | 'future_schedule'  // specific: 3+ days out
  | 'scheduled'        // next + future combined
  | 'pgi_done'         // warehouse goods issued, awaiting driver pick
  | 'pickup_confirmed' // driver confirmed picking, awaiting dispatch
  | 'out_for_delivery'
  | 'order_delay'
  | 'rescheduled'
  | 'delivered'        // completed / delivered orders
  | 'cancelled'        // customer-rejected or admin-cancelled orders (terminal)
  | 'pending_pod'      // delivered orders that are still missing a Proof of Delivery
  | 'pending_gmd'      // active orders with no Goods Movement Date
  | 'unassigned';      // active non-dispatched orders with no driver assigned

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
  onTrackDelivery?: (orderId: string) => void;
  onEditOrder: (orderId: string) => void;
  onMarkOutForDelivery?: (orderId: string) => Promise<void>;
  /**
   * Called when the user clicks the Export button. Receives the IDs of the
   * orders currently visible after applying every filter (search, status tab,
   * status dropdown, date range, priority-only, driver, today-only). The
   * parent uses these IDs to subset its full delivery list before writing
   * the .xlsx — so the downloaded file always matches what the user sees.
   */
  onExport?: (filteredIds: string[]) => void;
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
  /**
   * Called when the user clicks "Upload POD" on a delivered-no-POD row.
   * The parent should open the DeliveryDetailModal for this order ID.
   */
  onUploadPod?: (orderId: string) => void;
  /** Delivery Team Portal: show a Material (PNC) column */
  showMaterialColumn?: boolean;
  /** Delivery Team Portal: show a Qty column */
  showQtyColumn?: boolean;
  /** Delivery Team Portal: show only plain driver name text — no icon, no assignment dropdown */
  simpleDriverDisplay?: boolean;
  /** Called when the user clicks "Re-order" on a cancelled order to move it back to PGI Done */
  onReorder?: (orderId: string) => void;
}

const CONFIRMED_STATUSES = new Set<DeliveryStatus>(['confirmed', 'next_shipment', 'future_schedule', 'ready_to_dispatch']);
const SCHEDULED_STATUSES = new Set<DeliveryStatus>(['scheduled', 'next_shipment', 'future_schedule', 'ready_to_dispatch']);
// Terminal workflow statuses — same list as StatusMetricCards so card count === table count
const PENDING_TERMINAL = new Set<DeliveryStatus>(['delivered', 'cancelled', 'failed']);
// Delivered workflow statuses (backend variants are already mapped to 'delivered' by deliveryToManageOrder)
const DELIVERED_STATUSES = new Set<DeliveryStatus>(['delivered']);
// Statuses that should display as "Confirmed" in the Status column pill
// (the Action column already shows the specific sub-status via NextStepBadge)
const DISPLAY_AS_CONFIRMED = new Set<DeliveryStatus>(['next_shipment', 'future_schedule', 'ready_to_dispatch']);
// Excluded from the date-first shipment tiers (Next Shipment / Future Schedule).
// out_for_delivery lives under On Route; order_delay lives under Order Delay;
// terminal rows don't belong on any scheduling tier.
const SHIPMENT_TIER_EXCLUDED = new Set<DeliveryStatus>(['delivered', 'cancelled', 'failed', 'out_for_delivery', 'order_delay']);

/** Does this order count under a Next Shipment or Future Schedule tier? */
function matchesShipmentTier(order: DeliveryOrder, tier: 'next' | 'future'): boolean {
  if (SHIPMENT_TIER_EXCLUDED.has(order.status)) return false;
  if (!order.confirmedDeliveryDate) return false;
  const classified = classifyConfirmedDate(order.confirmedDeliveryDate);
  // Next Shipment includes both same-day (urgent) and next-day orders,
  // matching the StatusMetricCards count logic.
  if (tier === 'next') return classified === 'same_day' || classified === 'next';
  return classified === tier;
}

function matchesTableTab(order: DeliveryOrder, tab: OrdersTableTab): boolean {
  switch (tab) {
    case 'all':               return true;
    case 'pending':           return !PENDING_TERMINAL.has(order.status);
    case 'awaiting_customer': return order.status === 'sms_sent' || order.status === 'unconfirmed';
    case 'unconfirmed':       return order.status === 'unconfirmed';
    case 'confirmed':         return CONFIRMED_STATUSES.has(order.status);
    // Date-first tier — include orders whose confirmedDeliveryDate falls
    // tomorrow (next) or 2+ days out (future) regardless of warehouse stage.
    // Catches pgi-done / pickup-confirmed / rescheduled-with-GMD rows whose
    // workflow status short-circuits before reaching the tier branches.
    case 'next_shipment':     return matchesShipmentTier(order, 'next');
    case 'future_schedule':   return matchesShipmentTier(order, 'future');
    case 'scheduled':         return SCHEDULED_STATUSES.has(order.status);
    case 'pgi_done':          return order.status === 'pgi_done';
    case 'pickup_confirmed':  return order.status === 'pickup_confirmed';
    case 'out_for_delivery':  return order.status === 'out_for_delivery';
    case 'order_delay':       return order.status === 'order_delay';
    case 'rescheduled':       return order.status === 'rescheduled' || order.isRescheduled === true;
    case 'delivered':         return DELIVERED_STATUSES.has(order.status);
    // Customer-rejected or admin-cancelled orders — terminal and separate from delivered
    case 'cancelled':         return order.status === 'cancelled';
    // Delivered orders that are still missing a Proof of Delivery — must stay actionable
    case 'pending_pod':       return order.status === 'delivered' && !order.hasPod;
    // Active orders without a Goods Movement Date (pre-dispatch) — actionable by logistics
    case 'pending_gmd':       return !order.goodsMovementDate && !PENDING_TERMINAL.has(order.status);
    // Active non-dispatched orders with no driver assigned
    case 'unassigned': {
      const DISPATCH_DONE = new Set<DeliveryStatus>(['out_for_delivery', 'order_delay', 'delivered', 'cancelled', 'failed', 'rescheduled']);
      return !DISPATCH_DONE.has(order.status) && !order.driverId;
    }
    default:                  return true;
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
const NEXT_STEP_CONFIG: Partial<Record<DeliveryStatus | 'terminal_delivered' | 'terminal_delivered_no_pod' | 'terminal_cancelled' | 'terminal_failed', StepConfig>> = {
  // Awaiting-customer-response indicators (informational only, not clickable).
  // SMS itself is auto-sent on PO ingest — these badges flag rows where we're
  // still waiting on the customer to pick a date. 'uploaded' stays hidden
  // (transient pre-SMS state); 'sms_sent' and 'unconfirmed' show a pill so
  // the team can spot waiting-on-customer rows at a glance in the table.
  sms_sent: {
    label: 'Awaiting Reply',  icon: '⏳',
    cls: 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-900/20 dark:text-sky-300 dark:border-sky-800/40',
  },
  unconfirmed: {
    label: 'Awaiting Reply',  icon: '⚠️',
    cls: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-300 dark:border-red-800/40',
  },
  confirmed: {
    label: 'Assign Driver',   icon: '✅',
    cls: 'bg-green-50 text-green-700 border-green-200 dark:bg-green-900/20 dark:text-green-300 dark:border-green-800/40',
  },
  next_shipment: {
    label: 'Next Shipment',   icon: '📦',
    cls: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-300 dark:border-amber-800/40',
    gmd: { label: 'Waiting PGI', cls: 'bg-slate-50 text-slate-600 border-slate-200 dark:bg-slate-800/40 dark:text-slate-400 dark:border-slate-700' },
  },
  future_schedule: {
    label: 'Future Schedule', icon: '📅',
    cls: 'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-900/20 dark:text-indigo-300 dark:border-indigo-800/40',
    gmd: { label: 'Waiting PGI', cls: 'bg-slate-50 text-slate-600 border-slate-200 dark:bg-slate-800/40 dark:text-slate-400 dark:border-slate-700' },
  },
  ready_to_dispatch: {
    label: 'PGI Updated',     icon: '✅',
    cls: 'bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-900/20 dark:text-teal-300 dark:border-teal-800/40',
    gmd: { label: 'Ready to Dispatch', cls: 'bg-teal-100 text-teal-800 border-teal-300 dark:bg-teal-900/30 dark:text-teal-200 dark:border-teal-700' },
  },
  order_delay: {
    label: 'Action Needed',   icon: '🚨',
    cls: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-300 dark:border-red-800/40',
  },
  pgi_done: {
    label: 'PGI Done',        icon: '📦',
    cls: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-300 dark:border-amber-800/40',
    gmd: { label: 'Awaiting Picking', cls: 'bg-slate-50 text-slate-600 border-slate-200 dark:bg-slate-800/40 dark:text-slate-400 dark:border-slate-700' },
  },
  pickup_confirmed: {
    label: 'Item Collected', icon: '🚛',
    cls: 'bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-900/20 dark:text-teal-300 dark:border-teal-800/40',
    gmd: { label: 'Ready to Dispatch', cls: 'bg-teal-100 text-teal-800 border-teal-300 dark:bg-teal-900/30 dark:text-teal-200 dark:border-teal-700' },
  },
  out_for_delivery: {
    label: 'Out for Delivery',icon: '🚚',
    cls: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:text-blue-300 dark:border-blue-800/40',
    gmd: { label: 'Waiting for POD', cls: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-300 dark:border-amber-800/40' },
  },
  rescheduled: {
    // Only hit when a rescheduled order has no new delivery date set yet.
    // (Overdue reschedules are routed to 'order_delay'; future reschedules
    // classify into next_shipment / future_schedule / ready / out_for_delivery.)
    label: 'Set New Date',    icon: '🔄',
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
  terminal_delivered_no_pod: {
    label: 'Upload POD',      icon: '⚠',
    cls: 'bg-amber-50 text-amber-700 border-amber-300 dark:bg-amber-900/20 dark:text-amber-300 dark:border-amber-700/60',
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
function NextStepBadge({ status, confirmedDeliveryDate }: { status: DeliveryStatus; confirmedDeliveryDate?: Date | null }): React.ReactElement | null {
  const cfg = NEXT_STEP_CONFIG[status];
  if (!cfg) return null;

  // Same-day next_shipment orders → show "Urgent Delivery" instead of "Next Shipment"
  let label = cfg.label;
  let icon = cfg.icon;
  let cls = cfg.cls;
  if (status === 'next_shipment' && confirmedDeliveryDate) {
    const tier = classifyConfirmedDate(confirmedDeliveryDate);
    if (tier === 'same_day') {
      label = 'Urgent Delivery';
      icon = '🚨';
      cls = 'bg-red-50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-300 dark:border-red-800/40';
    }
  }

  return (
    <div className="flex flex-col gap-1 w-full">
      {/* Primary next-step badge */}
      <span
        className={`inline-flex w-full items-center justify-center gap-1 px-1.5 py-1 rounded border text-[10px] font-semibold leading-none select-none ${cls}`}
        title={`Next step: ${label}`}
        aria-label={`Next step: ${label}`}
      >
        <span aria-hidden className="text-[10px]">{icon}</span>
        {label}
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
  onUploadPod?: (orderId: string) => void;
  onViewReason?: (order: DeliveryOrder, e: React.MouseEvent) => void;
  onReorder?: (orderId: string) => void;
}

function ActionDropdown({
  order,
  onStatusChange: _onStatusChange,
  onResendSMS: _onResendSMS,
  onMarkOutForDelivery: _onMarkOutForDelivery,
  onTrackDelivery: _onTrackDelivery,
  onEditOrder,
  onReschedule,
  onUploadPod,
  onViewReason,
  onReorder,
}: ActionDropdownProps) {
  const s = order.status;
  const isTerminal = s === 'delivered' || s === 'cancelled' || s === 'failed';

  // Delivered but missing POD — show an actionable "Upload POD" button
  if (s === 'delivered' && !order.hasPod) {
    const cfg = NEXT_STEP_CONFIG['terminal_delivered_no_pod']!;
    const handleClick = () => {
      if (onUploadPod) {
        onUploadPod(order.id);
      } else {
        onEditOrder(order.id);
      }
    };
    return (
      <button
        type="button"
        onClick={handleClick}
        className={`inline-flex w-full items-center justify-center gap-1 px-1.5 py-1 rounded border text-[10px] font-semibold leading-none cursor-pointer hover:brightness-95 active:scale-95 transition-all ${cfg.cls}`}
        title="Upload Proof of Delivery"
        aria-label={cfg.label}
      >
        <span aria-hidden>{cfg.icon}</span>
        {cfg.label}
      </button>
    );
  }

  // Cancelled / rejected — show "View Reason" + "Re-order" buttons
  if (s === 'cancelled') {
    const cfg = NEXT_STEP_CONFIG['terminal_cancelled']!;
    const reason = order.notes?.trim() || order.failureReason?.trim() || '';
    const hasReason = !!reason && !!onViewReason;
    return (
      <div className="flex flex-col items-stretch gap-1.5">
        <button
          type="button"
          onClick={hasReason ? (e) => onViewReason!(order, e) : undefined}
          disabled={!hasReason}
          className={`inline-flex w-full items-center justify-center gap-1 px-1.5 py-1 rounded border text-[10px] font-semibold leading-none ${cfg.cls} ${
            hasReason
              ? 'cursor-pointer hover:brightness-95 active:scale-95 transition-all'
              : 'cursor-default select-none opacity-80'
          }`}
          title={hasReason ? 'View rejection reason' : cfg.label}
          aria-label={hasReason ? 'View rejection reason' : cfg.label}
        >
          <span aria-hidden>{cfg.icon}</span>
          {hasReason ? 'View Reason' : cfg.label}
        </button>
        {onReorder && (
          <button
            type="button"
            onClick={() => onReorder(order.id)}
            className="w-full flex items-center justify-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold rounded border border-blue-400 bg-blue-50 text-blue-700 hover:bg-blue-500 hover:text-white dark:border-blue-500/60 dark:bg-blue-900/20 dark:text-blue-300 dark:hover:bg-blue-600 dark:hover:text-white transition-colors whitespace-nowrap"
            title="Re-order: move back to PGI Done"
          >
            🔄 Re-order
          </button>
        )}
      </div>
    );
  }

  // Other terminal orders (delivered WITH pod, or failed): static indicator
  if (isTerminal) {
    const termKey = `terminal_${s}` as 'terminal_delivered' | 'terminal_failed';
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
      {/* Rescheduled tag — shown whenever this order was previously rescheduled */}
      {order.isRescheduled && (
        <span className="inline-flex w-full items-center justify-center gap-1 px-1.5 py-1 rounded border text-[10px] font-semibold leading-none bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-900/20 dark:text-orange-300 dark:border-orange-800/40">
          🔄 Rescheduled
        </span>
      )}
      {/* Next-step indicator — always visible, non-clickable */}
      <NextStepBadge status={s} confirmedDeliveryDate={order.confirmedDeliveryDate} />

      {/* Reschedule button — only for order_delay rows */}
      {s === 'order_delay' && (
        <button
          type="button"
          onClick={() => onReschedule(order)}
          className="w-full flex items-center justify-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold rounded border border-amber-400 bg-amber-50 text-amber-700 hover:bg-amber-500 hover:text-white dark:border-amber-500/60 dark:bg-amber-900/20 dark:text-amber-300 dark:hover:bg-amber-600 dark:hover:text-white transition-colors whitespace-nowrap"
          title="Reschedule this delivery and notify customer"
        >
          📅 Reschedule
        </button>
      )}

      {/* Update Status button for all non-terminal orders */}
      <button
        type="button"
        onClick={() => onEditOrder(order.id)}
        className="w-full flex items-center justify-center px-2.5 py-1.5 text-[11px] font-semibold rounded border border-[#032145]/30 bg-[#032145]/5 text-[#032145] hover:bg-[#032145] hover:text-white dark:border-blue-500/40 dark:bg-blue-900/20 dark:text-blue-300 dark:hover:bg-blue-700 dark:hover:text-white transition-colors whitespace-nowrap"
        title="Update status"
      >
        Update Status
      </button>
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
  onUploadPod,
  showMaterialColumn = false,
  showQtyColumn = false,
  simpleDriverDisplay = false,
  onReorder,
}) => {
  const [rescheduleOrder, setRescheduleOrder] = useState<DeliveryOrder | null>(null);
  const [reasonOrder, setReasonOrder] = useState<DeliveryOrder | null>(null);
  const [reasonAnchor, setReasonAnchor] = useState<{ top: number; left: number } | null>(null);

  const openReasonPopup = useCallback((order: DeliveryOrder, e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const popW = 320; // matches w-80
    const popH = 160; // estimated height
    const pad = 12;   // min distance from screen edge
    // Horizontal: try to center on button, clamp to viewport
    let left = rect.left + rect.width / 2 - popW / 2;
    left = Math.max(pad, Math.min(left, window.innerWidth - popW - pad));
    // Vertical: drop below button, flip above if it would overflow
    let top = rect.bottom + 8;
    if (top + popH > window.innerHeight - pad) {
      top = rect.top - popH - 8;
    }
    top = Math.max(pad, top);
    setReasonAnchor({ top, left });
    setReasonOrder(order);
  }, []);
  const closeReasonPopup = useCallback(() => { setReasonOrder(null); setReasonAnchor(null); }, []);
  const [currentPage, setCurrentPage] = useState(1);
  const [assigningDriverId, setAssigningDriverId] = useState<string | null>(null);
  const [todayOnly, setTodayOnly] = useState(false);
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [priorityOnly, setPriorityOnly] = useState(false);
  const [driverFilter, setDriverFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const tableTopRef = useRef<HTMLDivElement | null>(null);
  const itemsPerPage = 20;
  // Row selection for targeted export
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Apply driver+date preset set by Dashboard → Driver Assignments click
  const manageTabPreset = useDeliveryStore((s) => s.manageTabPreset);
  const setManageTabPreset = useDeliveryStore((s) => s.setManageTabPreset);
  useEffect(() => {
    if (!manageTabPreset) return;
    if (manageTabPreset.driverId) setDriverFilter(manageTabPreset.driverId);
    if (manageTabPreset.dateFrom) setFilterDateFrom(manageTabPreset.dateFrom);
    if (manageTabPreset.dateTo)   setFilterDateTo(manageTabPreset.dateTo);
    setCurrentPage(1);
    setManageTabPreset(null); // consume & clear
    // Scroll to table top after a tick
    requestAnimationFrame(() => tableTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }, [manageTabPreset, setManageTabPreset]);

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

      // ── Granular status filter (specific status values) ──
      if (statusFilter !== 'all') {
        const s = order.status as string;
        const matched = (() => {
          switch (statusFilter) {
            case 'pending':          return s === 'uploaded';
            case 'sms_sent':        return s === 'sms_sent';
            case 'unconfirmed':      return s === 'unconfirmed';
            case 'confirmed':        return s === 'confirmed' || s === 'next_shipment' || s === 'future_schedule' || s === 'ready_to_dispatch';
            case 'scheduled':        return s === 'scheduled';
            case 'pgi_done':         return s === 'pgi_done';
            case 'pickup_confirmed': return s === 'pickup_confirmed';
            case 'out_for_delivery': return s === 'out_for_delivery';
            case 'order_delay':      return s === 'order_delay';
            case 'rescheduled':      return s === 'rescheduled' || order.isRescheduled === true;
            case 'delivered':        return s === 'delivered';
            case 'cancelled':        return s === 'cancelled';
            default:                 return s === statusFilter;
          }
        })();
        if (!matched) return false;
      }

      // ── Today filter: orders being processed today ──
      // Includes: delivery date = today, out_for_delivery (on route now), order_delay (needs action today)
      if (todayOnly) {
        const s = order.status as string;
        const isActiveNow = s === 'out_for_delivery' || s === 'order_delay';
        if (!isActiveNow) {
          const refDate = order.confirmedDeliveryDate ?? order.scheduledDate;
          if (!refDate) return false;
          const refMs = refDate.getTime();
          if (refMs < startOfToday.getTime() || refMs > endOfToday.getTime()) return false;
        }
      }

      // ── Date range filter (uses confirmed delivery date, fallback to uploadedAt) ──
      if (filterDateFrom) {
        const refDate = order.confirmedDeliveryDate ?? order.scheduledDate ?? order.uploadedAt;
        const fromMs = new Date(filterDateFrom + 'T00:00:00').getTime();
        if (refDate.getTime() < fromMs) return false;
      }
      if (filterDateTo) {
        const refDate = order.confirmedDeliveryDate ?? order.scheduledDate ?? order.uploadedAt;
        const toMs = new Date(filterDateTo + 'T00:00:00').getTime() + 86400000;
        if (refDate.getTime() >= toMs) return false;
      }

      if (priorityOnly && order.isPriority !== true) return false;
      if (driverFilter !== 'all') {
        if (order.driverId !== driverFilter) return false;
      }
      return matchesStatus && matchesSearch;
    });
  }, [orders, tableTab, searchQuery, statusFilter, todayOnly, filterDateFrom, filterDateTo, priorityOnly, driverFilter]);

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
  }, [tableTab, searchQuery, sortBy, statusFilter]);

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
        <span className="font-medium text-[#032145] dark:text-blue-200">{fmtDate(ofdDate)}</span>
      ) : <span className="text-gray-400 dark:text-gray-500">—</span>;
    }
    // For uploaded/sms_sent/unconfirmed — show date if available, else dash
    return dateSource ? (
      <span className="text-gray-600 dark:text-gray-400">{fmtDate(dateSource)}</span>
    ) : <span className="text-gray-400 dark:text-gray-500">—</span>;
  };

  const noPodCount = orders.filter((o) => o.status === 'delivered' && !o.hasPod).length;

  const pendingGmdCount = orders.filter((o) => !o.goodsMovementDate && !PENDING_TERMINAL.has(o.status)).length;
  const cancelledCount = orders.filter((o) => o.status === 'cancelled').length;

  const UNASSIGNED_DISPATCH_DONE = new Set<DeliveryStatus>(['out_for_delivery', 'order_delay', 'delivered', 'cancelled', 'failed', 'rescheduled']);
  const unassignedCount = orders.filter((o) => !UNASSIGNED_DISPATCH_DONE.has(o.status) && !o.driverId).length;

  const filterTabs: { key: OrdersTableTab; label: string; count: number; urgent?: boolean }[] = [
    { key: 'all',              label: 'All',              count: orders.length },
    { key: 'pending',          label: 'Pending Orders',   count: orders.filter((o) => !PENDING_TERMINAL.has(o.status)).length },
    { key: 'unassigned',       label: 'Unassigned',       count: unassignedCount, urgent: unassignedCount > 0 },
    { key: 'awaiting_customer',label: 'Awaiting Customer',count: orders.filter((o) => o.status === 'sms_sent' || o.status === 'unconfirmed').length },
    { key: 'unconfirmed',      label: 'No Response',      count: orders.filter((o) => o.status === 'unconfirmed').length },
    { key: 'pending_gmd',      label: 'Pending PGI',      count: pendingGmdCount, urgent: pendingGmdCount > 0 },
    { key: 'next_shipment',    label: 'Next Shipment',    count: orders.filter((o) => matchesShipmentTier(o, 'next')).length },
    { key: 'future_schedule',  label: 'Future Schedule',  count: orders.filter((o) => matchesShipmentTier(o, 'future')).length },
    { key: 'pgi_done',         label: 'PGI Done',         count: orders.filter((o) => o.status === 'pgi_done').length },
    { key: 'pickup_confirmed', label: 'Pickup Confirmed', count: orders.filter((o) => o.status === 'pickup_confirmed').length },
    { key: 'out_for_delivery', label: 'On Route',         count: orders.filter((o) => o.status === 'out_for_delivery').length },
    { key: 'order_delay',      label: 'Order Delay',      count: orders.filter((o) => o.status === 'order_delay').length },
    { key: 'rescheduled',      label: 'Rescheduled',      count: orders.filter((o) => o.status === 'rescheduled' || o.isRescheduled === true).length },
    { key: 'delivered',        label: 'Delivered',        count: orders.filter((o) => DELIVERED_STATUSES.has(o.status)).length },
    // Customer-rejected / admin-cancelled — terminal, driver notes carry the reason
    { key: 'cancelled',        label: 'Cancelled',        count: cancelledCount },
    // Delivered orders missing POD — shown with an amber warning style when count > 0
    { key: 'pending_pod',      label: 'No POD',           count: noPodCount, urgent: noPodCount > 0 },
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
      <div className="border-b border-gray-100 px-3 py-3 dark:border-gray-700 sm:px-4 space-y-2.5">

        {/* ── Row 1: Title + refresh (Export moved down next to Date range) ── */}
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-xl font-bold tracking-tight text-gray-900 dark:text-white whitespace-nowrap">
            Delivery Orders
          </h2>
          <div className="flex items-center gap-2 shrink-0">
            {onRefresh && (
              <button
                type="button"
                onClick={onRefresh}
                className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-400 hover:text-[#032145] dark:hover:text-blue-400 hover:bg-gray-50 dark:hover:bg-gray-700 transition-all"
                title="Refresh"
                aria-label="Refresh orders"
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* ── Row 2: Filters ── */}
        <div className="flex items-center gap-2 min-w-0 flex-wrap">

          {/* ── Search (flex-1 so it fills available space) ── */}
          <div className="relative flex-1 min-w-0" style={{ minWidth: 140 }}>
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400 dark:text-gray-500" aria-hidden />
            <input
              type="search"
              placeholder="Search name, PO, phone, area…"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              className="w-full pl-8 pr-7 py-[7px] bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-500 rounded-lg text-xs text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#032145] focus:border-transparent"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => onSearchChange('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                aria-label="Clear search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* ── Category filter ── */}
          <div className="relative shrink-0">
            <SlidersHorizontal className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-gray-400 dark:text-gray-500" aria-hidden />
            <select
              value={tableTab}
              onChange={(e) => { onTableTabChange(e.target.value as OrdersTableTab); setStatusFilter('all'); }}
              className="appearance-none pl-6 pr-6 py-[7px] bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-500 rounded-lg text-xs text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-[#032145] cursor-pointer"
              style={{ maxWidth: 148 }}
            >
              {filterTabs.map((tab) => (
                <option key={tab.key} value={tab.key}>
                  {tab.urgent ? `⚠ ${tab.label}` : tab.label} ({tab.count})
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-1.5 top-1/2 h-3 w-3 -translate-y-1/2 text-gray-400 dark:text-gray-500" aria-hidden />
          </div>

          {/* ── Driver filter ── */}
          {drivers && drivers.length > 0 && (
            <div className="relative shrink-0">
              <select
                value={driverFilter}
                onChange={e => { setDriverFilter(e.target.value); setCurrentPage(1); }}
                style={{ maxWidth: 120 }}
                className="appearance-none pl-2.5 pr-6 py-[7px] bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-500 rounded-lg text-xs text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-[#032145] cursor-pointer"
              >
                <option value="all">All Drivers</option>
                {drivers.map(dr => (
                  <option key={dr.id} value={dr.id}>{dr.fullName || dr.username}</option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-1.5 top-1/2 h-3 w-3 -translate-y-1/2 text-gray-400 dark:text-gray-500" aria-hidden />
            </div>
          )}

          {/* ── Sort ── */}
          <div className="relative shrink-0">
            <select
              value={sortBy}
              onChange={(e) => onSortChange(e.target.value)}
              style={{ maxWidth: 108 }}
              className="appearance-none pl-2.5 pr-6 py-[7px] bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-500 rounded-lg text-xs text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-[#032145] cursor-pointer"
            >
              <option value="newest">↓ Newest</option>
              <option value="oldest">↑ Oldest</option>
              <option value="customer">A–Z Name</option>
              <option value="area">A–Z Area</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-1.5 top-1/2 h-3 w-3 -translate-y-1/2 text-gray-400 dark:text-gray-500" aria-hidden />
          </div>

          {/* ── Dispatch-only: Priority · Date range · Export ── */}
          {enableDispatchFilters && (
            <>
              <button
                type="button"
                onClick={() => { setPriorityOnly(v => !v); setCurrentPage(1); }}
                className={`shrink-0 px-2.5 py-[7px] rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                  priorityOnly ? 'bg-red-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300'
                }`}
                title="Show only priority orders"
              >
                🚨 P1
              </button>
              <DateRangePicker
                from={filterDateFrom}
                to={filterDateTo}
                onChange={(f, t) => { setFilterDateFrom(f); setFilterDateTo(t); setCurrentPage(1); }}
              />
              {onExport && (
                <>
                  {selectedIds.size > 0 && (
                    <span className="text-xs font-medium text-blue-600 dark:text-blue-400">{selectedIds.size} selected</span>
                  )}
                  {selectedIds.size > 0 && (
                    <button type="button" onClick={() => setSelectedIds(new Set())} className="text-xs text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-colors">Clear</button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      const ids = selectedIds.size > 0
                        ? filteredOrders.filter(o => selectedIds.has(o.id)).map(o => o.id)
                        : filteredOrders.map(o => o.id);
                      onExport(ids);
                    }}
                    className="shrink-0 inline-flex items-center gap-1.5 px-3 py-[7px] rounded-lg text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700 transition-colors whitespace-nowrap"
                    title="Export to Excel"
                  >
                    <FileSpreadsheet className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    Export{selectedIds.size > 0 ? ` (${selectedIds.size})` : ''}
                  </button>
                </>
              )}
            </>
          )}
          {!enableDispatchFilters && onExport && (
            <>
              {selectedIds.size > 0 && (
                <span className="text-xs font-medium text-blue-600 dark:text-blue-400">{selectedIds.size} selected</span>
              )}
              {selectedIds.size > 0 && (
                <button type="button" onClick={() => setSelectedIds(new Set())} className="text-xs text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-colors">Clear</button>
              )}
              <button
                type="button"
                onClick={() => {
                  const ids = selectedIds.size > 0
                    ? filteredOrders.filter(o => selectedIds.has(o.id)).map(o => o.id)
                    : filteredOrders.map(o => o.id);
                  onExport(ids);
                }}
                className="shrink-0 inline-flex items-center gap-1.5 px-3 py-[7px] rounded-lg text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700 transition-colors whitespace-nowrap"
                title="Export to Excel"
              >
                <FileSpreadsheet className="h-3.5 w-3.5 shrink-0" aria-hidden />
                Export{selectedIds.size > 0 ? ` (${selectedIds.size})` : ''}
              </button>
            </>
          )}

          {/* ── Clear all ── */}
          {(tableTab !== 'all' || searchQuery || driverFilter !== 'all' || statusFilter !== 'all' || filterDateFrom || filterDateTo || todayOnly || priorityOnly || selectedIds.size > 0) && (
            <button
              type="button"
              onClick={() => {
                onTableTabChange('all');
                onSearchChange('');
                setDriverFilter('all');
                setStatusFilter('all');
                setFilterDateFrom('');
                setFilterDateTo('');
                setTodayOnly(false);
                setPriorityOnly(false);
                setSelectedIds(new Set());
              }}
              className="shrink-0 flex items-center gap-1 px-2 py-[7px] rounded-lg text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20 dark:hover:text-red-400 transition-colors"
              title="Clear all filters"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="manage-orders-table-mobile table-mobile-cards table-fixed w-full min-w-[900px] border-collapse text-sm">
          <colgroup>
            <col style={{ width: '34px' }} />  {/* Checkbox */}
            <col style={{ width: '16%' }} />   {/* Customer */}
            <col style={{ width: '11%' }} />   {/* Order */}
            <col style={{ width: '17%' }} />   {/* Product */}
            <col style={{ width: '11%' }} />   {/* Dates */}
            <col style={{ width: '8%' }} />    {/* Priority */}
            <col style={{ width: '12%' }} />   {/* Driver */}
            <col style={{ width: '12%' }} />   {/* Status */}
            <col style={{ width: '8%' }} />    {/* Action */}
          </colgroup>
          <thead className="border-b border-gray-200 bg-gray-50/95 dark:border-gray-600 dark:bg-gray-900/90">
            <tr>
              <th className="px-2 py-2.5 text-center w-9">
                <input
                  type="checkbox"
                  checked={paginatedOrders.length > 0 && paginatedOrders.every(o => selectedIds.has(o.id))}
                  onChange={(e) => {
                    const next = new Set(selectedIds);
                    if (e.target.checked) {
                      paginatedOrders.forEach(o => next.add(o.id));
                    } else {
                      paginatedOrders.forEach(o => next.delete(o.id));
                    }
                    setSelectedIds(next);
                  }}
                  className="w-3.5 h-3.5 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500 cursor-pointer"
                  title="Select all on this page"
                />
              </th>
              <th className="whitespace-nowrap px-2 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                Customer
              </th>
              <th className="whitespace-nowrap px-2 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                Order
              </th>
              <th className="whitespace-nowrap px-2 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                Product
              </th>
              <th className="whitespace-nowrap px-2 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                Dates
              </th>
              <th className="whitespace-nowrap px-2 py-2 text-center text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                Priority
              </th>
              <th className="whitespace-nowrap px-2 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                Driver
              </th>
              <th className="whitespace-nowrap px-2 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                Status
              </th>
              <th className="whitespace-nowrap px-2 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                Action
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700/80">
            {paginatedOrders.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
                  No orders match the current filters.
                </td>
              </tr>
            ) : (
              paginatedOrders.map((order) => {
                const fmtDate = (d: Date) =>
                  d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' });
                const isNoPod = order.status === 'delivered' && !order.hasPod;
                const isRowSelected = selectedIds.has(order.id);
                return (
                  <tr
                    key={order.id}
                    className={`transition-colors ${
                      isRowSelected
                        ? 'bg-blue-50 dark:bg-blue-900/20'
                        : isNoPod
                          ? 'bg-amber-50/60 dark:bg-amber-900/10 hover:bg-amber-50 dark:hover:bg-amber-900/20'
                          : 'hover:bg-gray-50/90 dark:hover:bg-gray-900/40'
                    }`}
                  >
                    <td className="px-2 py-2.5 text-center align-middle">
                      <input
                        type="checkbox"
                        checked={isRowSelected}
                        onChange={() => {
                          const next = new Set(selectedIds);
                          if (isRowSelected) next.delete(order.id); else next.add(order.id);
                          setSelectedIds(next);
                        }}
                        className="w-3.5 h-3.5 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500 cursor-pointer"
                      />
                    </td>
                    {/* Customer: name + Type badge + phone with call button */}
                    <td className="overflow-hidden px-2 py-2 align-middle" data-label="Customer">
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <div className="flex min-w-0 items-center gap-1.5">
                          <span className="line-clamp-1 min-w-0 flex-1 font-medium leading-snug text-gray-900 dark:text-white" title={order.customerName}>
                            {order.customerName}
                          </span>
                          <span
                            className={`inline-flex shrink-0 items-center rounded px-1 py-0.5 text-[9px] font-bold uppercase tracking-wide ${
                              order.orderType === 'B2C'
                                ? 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300'
                                : 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300'
                            }`}
                          >
                            {order.orderType ?? 'B2B'}
                          </span>
                        </div>
                        <div className="flex min-w-0 items-center gap-1.5">
                          <span className="min-w-0 flex-1 truncate text-[12px] tabular-nums text-gray-600 dark:text-gray-400" title={order.customerPhone}>
                            {order.customerPhone}
                          </span>
                          <button
                            type="button"
                            onClick={() => onCallCustomer(order.customerPhone)}
                            className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-blue-100 text-blue-700 hover:bg-blue-200 dark:bg-blue-900/50 dark:text-blue-200 dark:hover:bg-blue-900/70"
                            title="Call customer"
                          >
                            <span className="text-[10px]" aria-hidden>📞</span>
                          </button>
                        </div>
                      </div>
                    </td>

                    {/* Order: PO# + Delivery No. + Area */}
                    <td className="overflow-hidden px-2 py-2 align-middle" data-label="Order">
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <span className="block truncate font-mono text-[13px] font-semibold text-gray-800 dark:text-gray-200" title={order.orderNumber}>
                          {order.orderNumber}
                        </span>
                        <span className="block truncate font-mono text-[11px] text-gray-500 dark:text-gray-400" title={order.deliveryNumber ?? ''}>
                          {order.deliveryNumber || '—'}
                        </span>
                        <span className="line-clamp-1 text-[11px] leading-snug text-gray-600 dark:text-gray-400" title={order.area}>
                          📍 {order.area}
                        </span>
                      </div>
                    </td>

                    {/* Product: Model + Description (+ optional Material · Qty inline) */}
                    <td className="overflow-hidden px-2 py-2 align-middle" data-label="Product">
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <span
                          className="block truncate text-[13px] font-semibold leading-snug text-gray-800 dark:text-gray-200"
                          title={order.model ?? '—'}
                        >
                          {order.model || '—'}
                        </span>
                        <span
                          className="line-clamp-2 block break-words text-[12px] leading-snug text-gray-600 dark:text-gray-400"
                          title={order.productDescription ?? order.product}
                        >
                          {order.productDescription || order.product}
                        </span>
                        {(showMaterialColumn || showQtyColumn) && (
                          <div className="flex min-w-0 items-center gap-2 text-[11px]">
                            {showMaterialColumn && (
                              <span className="min-w-0 truncate font-mono text-blue-700 dark:text-blue-400" title={order.material ?? '—'}>
                                {order.material ?? '—'}
                              </span>
                            )}
                            {showMaterialColumn && showQtyColumn && (
                              <span className="text-gray-300 dark:text-gray-600">·</span>
                            )}
                            {showQtyColumn && (
                              <span className="shrink-0 font-semibold tabular-nums text-gray-700 dark:text-gray-300">
                                Qty {order.qty ?? '—'}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </td>

                    {/* Dates: Del. Date + PGI Date stacked */}
                    <td className="overflow-hidden px-2 py-2 align-middle" data-label="Dates">
                      <div className="flex min-w-0 flex-col gap-0.5 text-[12px] leading-snug">
                        <div className="flex min-w-0 items-baseline gap-1 whitespace-nowrap">
                          <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">Del</span>
                          <span>{getDeliveryDateDisplay(order)}</span>
                        </div>
                        <div className="flex min-w-0 items-baseline gap-1 whitespace-nowrap">
                          <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">PGI</span>
                          {order.goodsMovementDate ? (
                            <span className="font-medium text-teal-700 dark:text-teal-300">
                              {fmtDate(order.goodsMovementDate)}
                            </span>
                          ) : (
                            <span className="text-gray-400 dark:text-gray-500">—</span>
                          )}
                        </div>
                      </div>
                    </td>

                    <td className="px-2 py-2 align-middle text-center" data-label="Priority">
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
                        /* Read-only badge for portals that cannot change priority (e.g. Delivery Team) */
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold whitespace-nowrap ${
                          order.isPriority
                            ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 border border-red-300 dark:border-red-700'
                            : 'bg-gray-100 dark:bg-gray-700 text-gray-400 dark:text-gray-500 border border-gray-200 dark:border-gray-600'
                        }`}>
                          {order.isPriority ? '🚨 Priority' : '📦 Normal'}
                        </span>
                      )}
                    </td>
                    <td className="overflow-hidden px-2 py-2 align-middle" data-label="Driver">
                      {simpleDriverDisplay ? (
                        /* Delivery Team Portal: read-only plain text — no icon, no dropdown */
                        order.driverName ? (
                          <span className="block truncate text-[13px] font-medium text-gray-800 dark:text-gray-200" title={order.driverName}>
                            {order.driverName}
                          </span>
                        ) : (
                          <span className="text-[12px] text-gray-400 dark:text-gray-500 italic">Unassigned</span>
                        )
                      ) : drivers && drivers.length > 0 && onAssignDriver ? (
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
                            className="w-full max-w-full px-1.5 py-0.5 border border-gray-200 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-[10px] text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-[#032145] disabled:opacity-50 cursor-pointer"
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
                            {order.driverName}
                          </span>
                        ) : (
                          <span className="text-[12px] text-gray-400 dark:text-gray-500 italic">Unassigned</span>
                        )
                      )}
                    </td>
                    <td className="overflow-hidden px-2 py-2 align-middle" data-label="Status">
                      <div className="inline-flex flex-col gap-1 max-w-full">
                        <OrderStatusPill status={
                          DISPLAY_AS_CONFIRMED.has(order.status) ? 'confirmed' :
                          order.isRescheduled ? 'rescheduled' : order.status
                        } />
                        {isNoPod && (
                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded border text-[10px] font-semibold bg-amber-50 text-amber-700 border-amber-300 dark:bg-amber-900/20 dark:text-amber-300 dark:border-amber-700/60 whitespace-nowrap">
                            ⚠ No POD
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-2 py-2 align-middle" data-label="Action">
                      <ActionDropdown
                        order={order}
                        onStatusChange={onStatusChange}
                        onResendSMS={onResendSMS}
                        onMarkOutForDelivery={onMarkOutForDelivery}
                        onTrackDelivery={onTrackDelivery}
                        onEditOrder={onEditOrder}
                        onReschedule={(o) => setRescheduleOrder(o)}
                        onUploadPod={onUploadPod}
                        onViewReason={openReasonPopup}
                        onReorder={onReorder}
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

      {reasonOrder && reasonAnchor && createPortal(
        <>
          <div className="fixed inset-0 z-[9998]" onClick={closeReasonPopup} />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Rejection reason"
            className="fixed z-[9999] w-80 rounded-xl bg-white dark:bg-gray-800 shadow-xl border border-gray-200 dark:border-gray-700"
            style={{ top: reasonAnchor.top, left: reasonAnchor.left }}
          >
            <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-gray-200 dark:border-gray-700">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Rejection Reason</h3>
                <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5 truncate">
                  {reasonOrder.customerName} · {reasonOrder.orderNumber ?? '—'}
                </p>
              </div>
              <button
                type="button"
                onClick={closeReasonPopup}
                className="shrink-0 p-1 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="px-4 py-4">
              <p className="whitespace-pre-wrap text-sm text-gray-800 dark:text-gray-100 leading-relaxed">
                {(reasonOrder.notes?.trim() || reasonOrder.failureReason?.trim() || '—')}
              </p>
            </div>
          </div>
        </>,
        document.body,
      )}
    </div>
  );
};
