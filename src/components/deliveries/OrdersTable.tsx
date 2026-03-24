import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import type { DeliveryOrder, DeliveryStatus } from '../../types/delivery';
import { STATUS_CONFIG } from '../../config/statusColors';
import { RescheduleModal } from './RescheduleModal';
import { rescheduleDateToWorkflow } from '../../utils/deliveryWorkflowMap';

export type OrdersTableTab = 'all' | 'pending' | 'confirmed' | 'scheduled' | 'out_for_delivery';

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
  onResendSMS: (orderId: string) => void;
  onCallCustomer: (phone: string) => void;
  onWhatsApp: (phone: string) => void;
  onTrackDelivery?: (orderId: string) => void;
  onEditOrder: (orderId: string) => void;
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
      return ['uploaded', 'sms_sent', 'unconfirmed'].includes(order.status);
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

function pageWindow(current: number, total: number, max = 5): number[] {
  if (total <= 0) return [];
  if (total <= max) return Array.from({ length: total }, (_, i) => i + 1);
  let start = Math.max(1, current - Math.floor(max / 2));
  let end = start + max - 1;
  if (end > total) {
    end = total;
    start = Math.max(1, end - max + 1);
  }
  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
}

export const OrdersTable: React.FC<OrdersTableProps> = ({
  orders,
  tableTab,
  onTableTabChange,
  onStatusChange,
  onResendSMS,
  onCallCustomer,
  onWhatsApp,
  onTrackDelivery,
  onEditOrder,
  searchQuery,
  onSearchChange,
  sortBy,
  onSortChange,
}) => {
  const [rescheduleOrder, setRescheduleOrder] = useState<DeliveryOrder | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const tableTopRef = useRef<HTMLDivElement | null>(null);
  const itemsPerPage = 10;

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
        order.product.toLowerCase().includes(q);
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
    if (order.status === 'uploaded' || order.status === 'sms_sent')
      return <span className="text-blue-600 dark:text-blue-400">Pending SMS</span>;
    return <span className="text-gray-400">—</span>;
  };

  const getActionButton = (order: DeliveryOrder) => {
    switch (order.status) {
      case 'uploaded':
        return (
          <button
            type="button"
            onClick={() => onResendSMS(order.id)}
            className="px-3 py-1 text-xs bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700"
          >
            Send SMS
          </button>
        );
      case 'sms_sent':
        return (
          <button
            type="button"
            onClick={() => onResendSMS(order.id)}
            className="px-3 py-1 text-xs bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 rounded hover:bg-emerald-100 dark:hover:bg-emerald-900/50"
          >
            Send SMS
          </button>
        );
      case 'unconfirmed':
        return (
          <button
            type="button"
            onClick={() => onResendSMS(order.id)}
            className="px-3 py-1 text-xs bg-red-50 dark:bg-red-900/30 border border-red-300 dark:border-red-800 text-red-700 dark:text-red-300 rounded hover:bg-red-100 dark:hover:bg-red-900/50"
          >
            Resend SMS
          </button>
        );
      case 'scheduled':
        return (
          <button
            type="button"
            onClick={() => setRescheduleOrder(order)}
            className="px-3 py-1 text-xs bg-amber-50 dark:bg-amber-900/30 border border-amber-400 dark:border-amber-700 text-amber-700 dark:text-amber-200 rounded hover:bg-amber-100 dark:hover:bg-amber-900/50"
          >
            Reschedule
          </button>
        );
      case 'confirmed':
        return (
          <button
            type="button"
            onClick={() => setRescheduleOrder(order)}
            className="px-3 py-1 text-xs bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700"
          >
            Reschedule
          </button>
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
      label: 'Pending',
      count: orders.filter((o) => ['uploaded', 'sms_sent', 'unconfirmed'].includes(o.status)).length,
    },
    { key: 'confirmed', label: 'Confirmed', count: orders.filter((o) => o.status === 'confirmed').length },
    { key: 'scheduled', label: 'Scheduled', count: orders.filter((o) => o.status === 'scheduled').length },
    {
      key: 'out_for_delivery',
      label: 'Out for delivery',
      count: orders.filter((o) => o.status === 'out_for_delivery').length,
    },
  ];

  const pages = pageWindow(currentPage, totalPages, 5);

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
              Use tabs and search below — status cards above are summary only.
            </p>
          </div>
        </div>

        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 mt-4">
          <div className="flex gap-2 overflow-x-auto pb-2 lg:pb-0 scrollbar-thin">
            {filterTabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => onTableTabChange(tab.key)}
                className={`
                  px-3 py-1.5 rounded-lg text-sm whitespace-nowrap flex-shrink-0 transition-colors
                  ${
                    tableTab === tab.key
                      ? 'bg-[#002D5B] text-white'
                      : 'bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                  }
                `}
              >
                {tab.label} <span className="ml-1 opacity-70">{tab.count}</span>
              </button>
            ))}
          </div>

          <div className="flex gap-2 flex-col sm:flex-row">
            <div className="relative flex-1 lg:w-52">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400 dark:text-gray-500" aria-hidden />
              <input
                type="search"
                placeholder="Search name, phone, order, area, product…"
                value={searchQuery}
                onChange={(e) => onSearchChange(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#002D5B]"
              />
            </div>
            <div className="relative">
              <select
                value={sortBy}
                onChange={(e) => onSortChange(e.target.value)}
                className="w-full appearance-none bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-600 rounded-lg pl-3 pr-8 py-1.5 text-sm text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-[#002D5B]"
              >
                <option value="newest">Newest</option>
                <option value="oldest">Oldest</option>
                <option value="customer">Customer A–Z</option>
                <option value="area">Area</option>
              </select>
              <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500 dark:text-gray-400" aria-hidden />
            </div>
          </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="manage-orders-table-mobile table-mobile-cards table-fixed min-w-[920px] md:min-w-[1130px] border-collapse text-sm">
          <colgroup>
            <col style={{ width: '170px' }} />
            <col style={{ width: '190px' }} />
            <col style={{ width: '125px' }} />
            <col style={{ width: '115px' }} />
            <col style={{ width: '95px' }} />
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
              <th className="min-w-[120px] max-w-[130px] w-[125px] whitespace-nowrap px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                Order
              </th>
              <th className="min-w-[110px] max-w-[120px] w-[115px] whitespace-nowrap px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                Delivery date
              </th>
              <th className="min-w-[90px] max-w-[100px] w-[95px] whitespace-nowrap px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                Area
              </th>
              <th className="whitespace-nowrap px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                Product
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
                <td colSpan={8} className="px-4 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
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
                    <td className="min-w-[120px] max-w-[130px] w-[125px] overflow-hidden px-3 py-2.5 align-middle" data-label="Order">
                      <span className="block truncate font-mono text-[13px] text-gray-700 dark:text-gray-300" title={`Order #${order.orderNumber}`}>
                        #{order.orderNumber}
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
                    <td className="min-w-0 overflow-hidden px-3 py-2.5 align-middle" data-label="Product">
                      <span
                        className="line-clamp-2 block break-words text-[13px] leading-snug text-gray-800 dark:text-gray-200"
                        title={order.product}
                      >
                        {order.product}
                      </span>
                    </td>
                    <td className="min-w-[140px] max-w-[150px] w-[145px] overflow-hidden px-3 py-2.5 align-middle" data-label="Status">
                      <div className="inline-flex max-w-full">
                        <OrderStatusPill status={order.status} onClick={() => onEditOrder(order.id)} />
                      </div>
                    </td>
                    <td className="min-w-[100px] max-w-[110px] w-[105px] overflow-hidden px-3 py-2.5 align-middle shrink-0" data-label="Action">
                      <div className="flex flex-nowrap items-center gap-1.5">
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

      <div className="px-4 py-3 border-t border-gray-100 dark:border-gray-700 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <span className="text-sm text-gray-600 dark:text-gray-400">
          {sortedOrders.length === 0
            ? '0 orders'
            : `Showing ${(currentPage - 1) * itemsPerPage + 1}–${Math.min(currentPage * itemsPerPage, sortedOrders.length)} of ${sortedOrders.length}`}
        </span>
        <div className="flex gap-1 flex-wrap">
          <button
            type="button"
            onClick={() => goToPage(Math.max(1, currentPage - 1))}
            disabled={currentPage === 1}
            className="px-3 py-1.5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-600 rounded text-sm disabled:opacity-50"
          >
            ←
          </button>
          {pages.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => goToPage(p)}
              className={`px-3 py-1.5 rounded text-sm ${
                currentPage === p
                  ? 'bg-[#002D5B] text-white'
                  : 'bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700'
              }`}
            >
              {p}
            </button>
          ))}
          <button
            type="button"
            onClick={() => goToPage(Math.min(totalPages, currentPage + 1))}
            disabled={currentPage === totalPages || sortedOrders.length === 0}
            className="px-3 py-1.5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-600 rounded text-sm disabled:opacity-50"
          >
            →
          </button>
        </div>
      </div>

      {rescheduleOrder && (
        <RescheduleModal
          order={rescheduleOrder}
          onClose={() => setRescheduleOrder(null)}
          onReschedule={(newDate) => {
            const workflow = rescheduleDateToWorkflow(newDate);
            onStatusChange(rescheduleOrder.id, workflow, newDate);
            setRescheduleOrder(null);
          }}
        />
      )}
    </div>
  );
};
