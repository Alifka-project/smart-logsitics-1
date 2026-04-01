import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search, X, SlidersHorizontal } from 'lucide-react';
import type { DeliveryOrder, DeliveryStatus } from '../../types/delivery';
import { STATUS_CONFIG } from '../../config/statusColors';
import { RescheduleModal } from './RescheduleModal';
import PaginationBar from '../common/PaginationBar';
import { rescheduleDateToWorkflow } from '../../utils/deliveryWorkflowMap';

export type OrdersTableTab = 'all' | 'pending' | 'awaiting_customer' | 'confirmed' | 'scheduled' | 'out_for_delivery';

function OrderStatusPill({
  status,
  onClick,
}: {
  status: DeliveryStatus;
  onClick?: () => void;
}): React.ReactElement {
  const c = STATUS_CONFIG[status];
  const text = c.pillLabel ?? c.label;
  const baseClass = `
    inline-flex max-w-full cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-md border px-2.5 py-1.5
    text-xs font-semibold leading-none shadow-sm transition-opacity hover:opacity-90
    ${c.badgeStyle} ${c.borderColor}
  `;
  const content = (
    <>
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-55" aria-hidden />
      {text}
    </>
  );
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={baseClass}
        title={`Change status — click to edit`}
        aria-label={`Edit order status: ${text}`}
      >
        {content}
      </button>
    );
  }
  return (
    <span className={baseClass} title={c.pillLabel ? c.label : undefined}>
      {content}
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
  searchQuery: string;
  onSearchChange: (query: string) => void;
  sortBy: string;
  onSortChange: (sort: string) => void;
}

function matchesTableTab(order: DeliveryOrder, tab: OrdersTableTab): boolean {
  switch (tab) {
    case 'all':
      return true;
    case 'pending':
      // Pending Order = new order, no SMS sent yet
      return order.status === 'uploaded';
    case 'awaiting_customer':
      // Awaiting Customer = SMS sent (waiting for reply) OR no response after 48h
      return order.status === 'sms_sent' || order.status === 'unconfirmed';
    case 'confirmed':
      return order.status === 'confirmed';
    case 'scheduled':
      return order.status === 'scheduled';
    case 'out_for_delivery':
      return order.status === 'out_for_delivery';
    default:
      return true;
  }
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
  searchQuery,
  onSearchChange,
  sortBy,
  onSortChange,
}) => {
  const [rescheduleOrder, setRescheduleOrder] = useState<DeliveryOrder | null>(null);
  const [markingOFD, setMarkingOFD] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const tableTopRef = useRef<HTMLDivElement | null>(null);
  const itemsPerPage = 20;

  const filteredOrders = useMemo(() => {
    return orders.filter((order) => {
      const matchesStatus = matchesTableTab(order, tableTab);
      const q = searchQuery.trim().toLowerCase();
      const matchesSearch =
        !q ||
        order.customerName.toLowerCase().includes(q) ||
        order.orderNumber.toLowerCase().includes(q) ||
        order.area.toLowerCase().includes(q) ||
        order.customerPhone.toLowerCase().includes(q) ||
        order.product.toLowerCase().includes(q) ||
        (order.model?.toLowerCase().includes(q) ?? false) ||
        (order.productDescription?.toLowerCase().includes(q) ?? false);
      return matchesStatus && matchesSearch;
    });
  }, [orders, tableTab, searchQuery]);

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
    if (order.status === 'confirmed') return <span className="text-green-600 dark:text-green-400">Tomorrow</span>;
    if (order.status === 'scheduled' && order.scheduledDate) {
      return (
        <span className="px-2 py-0.5 bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-200 rounded text-xs">
          {order.scheduledDate.toLocaleDateString('en-GB', { month: 'short', day: 'numeric' })}
        </span>
      );
    }
    if (order.status === 'out_for_delivery')
      return <span className="font-medium text-[#002D5B] dark:text-blue-200">Today</span>;
    if (order.status === 'unconfirmed')
      return <span className="text-red-600 dark:text-red-400">No response</span>;
    if (order.status === 'sms_sent')
      return <span className="text-emerald-600 dark:text-emerald-400">Awaiting reply</span>;
    if (order.status === 'uploaded')
      return <span className="text-gray-400 dark:text-gray-500">No SMS yet</span>;
    return <span className="text-gray-400">—</span>;
  };

  const ofdButton = (orderId: string) =>
    onMarkOutForDelivery ? (
      <button
        type="button"
        disabled={markingOFD === orderId}
        onClick={() => {
          setMarkingOFD(orderId);
          void onMarkOutForDelivery(orderId).finally(() => setMarkingOFD(null));
        }}
        className="px-3 py-1 text-xs bg-green-600 hover:bg-green-700 text-white rounded disabled:opacity-60"
        title="Manually dispatch — mark as out for delivery"
      >
        {markingOFD === orderId ? '…' : '🚚 Dispatch'}
      </button>
    ) : null;

  const getActionButton = (order: DeliveryOrder) => {
    switch (order.status) {
      case 'uploaded':
        return (
          <>
            <button
              type="button"
              onClick={() => onResendSMS(order.id)}
              className="px-3 py-1 text-xs bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              Send SMS
            </button>
            {ofdButton(order.id)}
          </>
        );
      case 'sms_sent':
        return (
          <>
            <button
              type="button"
              onClick={() => onResendSMS(order.id)}
              className="px-3 py-1 text-xs bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 rounded hover:bg-emerald-100 dark:hover:bg-emerald-900/50"
            >
              Send SMS
            </button>
            {ofdButton(order.id)}
          </>
        );
      case 'unconfirmed':
        return (
          <>
            <button
              type="button"
              onClick={() => onResendSMS(order.id)}
              className="px-3 py-1 text-xs bg-red-50 dark:bg-red-900/30 border border-red-300 dark:border-red-800 text-red-700 dark:text-red-300 rounded hover:bg-red-100 dark:hover:bg-red-900/50"
            >
              Resend SMS
            </button>
            {ofdButton(order.id)}
          </>
        );
      case 'scheduled':
        return (
          <>
            <button
              type="button"
              onClick={() => setRescheduleOrder(order)}
              className="px-3 py-1 text-xs bg-amber-50 dark:bg-amber-900/30 border border-amber-400 dark:border-amber-700 text-amber-700 dark:text-amber-200 rounded hover:bg-amber-100 dark:hover:bg-amber-900/50"
            >
              Reschedule
            </button>
            {ofdButton(order.id)}
          </>
        );
      case 'confirmed':
        return (
          <>
            <button
              type="button"
              onClick={() => setRescheduleOrder(order)}
              className="px-3 py-1 text-xs bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              Reschedule
            </button>
            {ofdButton(order.id)}
          </>
        );
      case 'out_for_delivery':
        return (
          <button
            type="button"
            onClick={() => onTrackDelivery?.(order.id)}
            className="px-3 py-1 text-xs bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700"
          >
            Track →
          </button>
        );
      default:
        return <span className="text-xs text-gray-400 dark:text-gray-500">—</span>;
    }
  };

  const filterTabs: { key: OrdersTableTab; label: string; count: number }[] = [
    { key: 'all', label: 'All', count: orders.length },
    {
      key: 'pending',
      label: 'Pending Order',
      count: orders.filter((o) => o.status === 'uploaded').length,
    },
    {
      key: 'awaiting_customer',
      label: 'Awaiting Customer',
      count: orders.filter((o) => o.status === 'sms_sent' || o.status === 'unconfirmed').length,
    },
    { key: 'confirmed', label: 'Confirmed', count: orders.filter((o) => o.status === 'confirmed').length },
    { key: 'scheduled', label: 'Scheduled', count: orders.filter((o) => o.status === 'scheduled').length },
    {
      key: 'out_for_delivery',
      label: 'Out for Delivery',
      count: orders.filter((o) => o.status === 'out_for_delivery').length,
    },
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
              onClick={() => { onTableTabChange('all'); onSearchChange(''); }}
              className="shrink-0 flex items-center gap-1 px-2.5 py-2 rounded-lg text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
            >
              <X className="h-3 w-3" />
              Clear
            </button>
          )}
          <span className="shrink-0 text-xs text-gray-500 dark:text-gray-400 tabular-nums">
            {sortedOrders.length} {sortedOrders.length === 1 ? 'order' : 'orders'}
          </span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="manage-orders-table-mobile table-mobile-cards table-fixed min-w-[1060px] md:min-w-[1280px] border-collapse text-sm">
          <colgroup>
            <col style={{ width: '170px' }} />
            <col style={{ width: '190px' }} />
            <col style={{ width: '120px' }} />
            <col style={{ width: '120px' }} />
            <col style={{ width: '115px' }} />
            <col style={{ width: '95px' }} />
            <col style={{ width: '130px' }} />
            <col style={{ width: '1%' }} />
            <col style={{ width: '145px' }} />
            <col style={{ width: '105px' }} />
          </colgroup>
          <thead className="border-b border-gray-200 bg-gray-50/95 dark:border-gray-600 dark:bg-gray-900/90">
            <tr>
              <th className="min-w-[160px] max-w-[180px] w-[170px] whitespace-nowrap px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                Customer
              </th>
              <th className="min-w-[180px] max-w-[200px] w-[190px] whitespace-nowrap px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                Phone
              </th>
              <th className="min-w-[115px] max-w-[125px] w-[120px] whitespace-nowrap px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                PO Number
              </th>
              <th className="min-w-[115px] max-w-[125px] w-[120px] whitespace-nowrap px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                Delivery Number
              </th>
              <th className="min-w-[110px] max-w-[120px] w-[115px] whitespace-nowrap px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                Delivery date
              </th>
              <th className="min-w-[90px] max-w-[100px] w-[95px] whitespace-nowrap px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                Area
              </th>
              <th className="min-w-[120px] max-w-[140px] w-[130px] whitespace-nowrap px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                Model
              </th>
              <th className="whitespace-nowrap px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                Product Description
              </th>
              <th className="min-w-[140px] max-w-[150px] w-[145px] whitespace-nowrap px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                Status
              </th>
              <th className="min-w-[100px] max-w-[110px] w-[105px] whitespace-nowrap px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                Action
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700/80">
            {paginatedOrders.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-4 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
                  No orders match the current filters.
                </td>
              </tr>
            ) : (
              paginatedOrders.map((order) => {
                return (
                  <tr
                    key={order.id}
                    className="transition-colors hover:bg-gray-50/90 dark:hover:bg-gray-900/40"
                  >
                    <td className="min-w-[160px] max-w-[180px] w-[170px] overflow-hidden px-3 py-2.5 align-middle" data-label="Customer">
                      <span className="line-clamp-2 block font-medium leading-snug text-gray-900 dark:text-white" title={order.customerName}>
                        {order.customerName}
                      </span>
                    </td>
                    <td className="min-w-[180px] max-w-[200px] w-[190px] overflow-hidden px-3 py-2.5 align-middle" data-label="Phone">
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
                    <td className="min-w-[115px] max-w-[125px] w-[120px] overflow-hidden px-3 py-2.5 align-middle" data-label="PO Number">
                      <span className="block truncate font-mono text-[13px] text-gray-700 dark:text-gray-300" title={`PO #${order.orderNumber}`}>
                        #{order.orderNumber}
                      </span>
                    </td>
                    <td className="min-w-[115px] max-w-[125px] w-[120px] overflow-hidden px-3 py-2.5 align-middle" data-label="Delivery Number">
                      <span className="block truncate font-mono text-[13px] text-gray-500 dark:text-gray-400" title={order.deliveryNumber ?? ''}>
                        {order.deliveryNumber ? `#${order.deliveryNumber}` : '—'}
                      </span>
                    </td>
                    <td className="min-w-[110px] max-w-[120px] w-[115px] overflow-hidden px-3 py-2.5 align-middle text-[13px]" data-label="Delivery date">
                      {getDeliveryDateDisplay(order)}
                    </td>
                    <td className="min-w-[90px] max-w-[100px] w-[95px] overflow-hidden px-3 py-2.5 align-middle" data-label="Area">
                      <span className="line-clamp-2 text-[13px] leading-snug text-gray-700 dark:text-gray-300">
                        {order.area}
                      </span>
                    </td>
                    <td className="min-w-[120px] max-w-[140px] w-[130px] overflow-hidden px-3 py-2.5 align-middle" data-label="Model">
                      <span
                        className="block truncate text-[13px] leading-snug text-gray-800 dark:text-gray-200"
                        title={order.model ?? '—'}
                      >
                        {order.model || '—'}
                      </span>
                    </td>
                    <td className="min-w-0 overflow-hidden px-3 py-2.5 align-middle" data-label="Product Description">
                      <span
                        className="line-clamp-2 block break-words text-[13px] leading-snug text-gray-800 dark:text-gray-200"
                        title={order.productDescription ?? order.product}
                      >
                        {order.productDescription || order.product}
                      </span>
                    </td>
                    <td className="min-w-[140px] max-w-[150px] w-[145px] overflow-hidden px-3 py-2.5 align-middle" data-label="Status">
                      <div className="inline-flex max-w-full">
                        <OrderStatusPill status={order.status} onClick={() => onEditOrder(order.id)} />
                      </div>
                    </td>
                    <td className="min-w-[100px] max-w-[110px] w-[105px] overflow-hidden px-3 py-2.5 align-middle shrink-0" data-label="Action">
                      <div className="flex flex-wrap items-center gap-1">
                        <button
                          type="button"
                          onClick={() => onEditOrder(order.id)}
                          className="px-2 py-1 text-[11px] font-medium rounded border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
                          title="Change status"
                        >
                          Status
                        </button>
                        {getActionButton(order)}
                      </div>
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
