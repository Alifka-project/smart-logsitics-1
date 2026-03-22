import React, { useEffect, useMemo, useState } from 'react';
import type { DeliveryOrder, DeliveryStatus } from '../../types/delivery';
import { STATUS_CONFIG } from '../../config/statusColors';
import { RescheduleModal } from './RescheduleModal';
import { rescheduleDateToWorkflow } from '../../utils/deliveryWorkflowMap';

export type OrdersTableTab = 'all' | 'pending' | 'confirmed' | 'scheduled' | 'out_for_delivery';

interface OrdersTableProps {
  orders: DeliveryOrder[];
  cardFilter: string;
  tableTab: OrdersTableTab;
  onTableTabChange: (tab: OrdersTableTab) => void;
  onStatusChange: (orderId: string, newStatus: DeliveryStatus, scheduledDate?: Date) => void;
  onResendSMS: (orderId: string) => void;
  onCallCustomer: (phone: string) => void;
  onWhatsApp: (phone: string) => void;
  onTrackDelivery?: (orderId: string) => void;
  selectedOrders: string[];
  onSelectOrder: (orderId: string) => void;
  onSelectPage: (pageIds: string[], selected: boolean) => void;
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

function matchesCard(order: DeliveryOrder, card: string): boolean {
  if (!card || card === 'all') return true;
  return order.status === card;
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
  cardFilter,
  tableTab,
  onTableTabChange,
  onStatusChange,
  onResendSMS,
  onCallCustomer,
  onWhatsApp,
  onTrackDelivery,
  selectedOrders,
  onSelectOrder,
  onSelectPage,
  searchQuery,
  onSearchChange,
  sortBy,
  onSortChange,
}) => {
  const [rescheduleOrder, setRescheduleOrder] = useState<DeliveryOrder | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  const filteredOrders = useMemo(() => {
    return orders.filter((order) => {
      const matchesStatus = matchesCard(order, cardFilter) && matchesTableTab(order, tableTab);
      const q = searchQuery.trim().toLowerCase();
      const matchesSearch =
        !q ||
        order.customerName.toLowerCase().includes(q) ||
        order.orderNumber.toLowerCase().includes(q) ||
        order.area.toLowerCase().includes(q) ||
        order.customerPhone.toLowerCase().includes(q);
      return matchesStatus && matchesSearch;
    });
  }, [orders, cardFilter, tableTab, searchQuery]);

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
  }, [cardFilter, tableTab, searchQuery, sortBy]);

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
      return <span className="text-purple-600 dark:text-purple-400">Today</span>;
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
        return (
          <button
            type="button"
            className="px-3 py-1 text-xs bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300"
          >
            Actions ▾
          </button>
        );
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

  const pageIds = paginatedOrders.map((o) => o.id);
  const allPageSelected =
    pageIds.length > 0 && pageIds.every((id) => selectedOrders.includes(id));

  const toggleSelectAllPage = () => {
    onSelectPage(pageIds, !allPageSelected);
  };

  const pages = pageWindow(currentPage, totalPages, 5);

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
      <div className="p-4 border-b border-gray-100 dark:border-gray-700">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Delivery Orders</h2>
          <span className="text-gray-400 text-sm hidden sm:block" aria-hidden>
            ↗
          </span>
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
            <div className="relative flex-1 lg:w-48">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm" aria-hidden>
                🔍
              </span>
              <input
                type="search"
                placeholder="Search…"
                value={searchQuery}
                onChange={(e) => onSearchChange(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#002D5B]"
              />
            </div>
            <select
              value={sortBy}
              onChange={(e) => onSortChange(e.target.value)}
              className="px-3 py-1.5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-600 dark:text-gray-300"
            >
              <option value="newest">Newest</option>
              <option value="oldest">Oldest</option>
              <option value="customer">Customer A–Z</option>
              <option value="area">Area</option>
            </select>
          </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="manage-orders-table-mobile w-full min-w-[800px]">
          <thead className="bg-gray-50 dark:bg-gray-900/80 border-b border-gray-100 dark:border-gray-700">
            <tr>
              <th className="w-10 px-4 py-3">
                <input
                  type="checkbox"
                  checked={allPageSelected}
                  onChange={toggleSelectAllPage}
                  className="rounded border-gray-300 dark:border-gray-600"
                  aria-label="Select all on this page"
                />
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                Customer
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                Phone
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                Order
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                Delivery date
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                Area
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                Product
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                Status
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                Action
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
            {paginatedOrders.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
                  No orders match the current filters.
                </td>
              </tr>
            ) : (
              paginatedOrders.map((order) => {
                const statusConfig = STATUS_CONFIG[order.status];
                const isSelected = selectedOrders.includes(order.id);

                return (
                  <tr
                    key={order.id}
                    className={`hover:bg-gray-50 dark:hover:bg-gray-900/50 ${isSelected ? 'bg-blue-50 dark:bg-blue-900/20' : ''}`}
                  >
                    <td className="px-4 py-3" data-label="Select">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => onSelectOrder(order.id)}
                        className="rounded border-gray-300 dark:border-gray-600"
                        aria-label={`Select ${order.customerName}`}
                      />
                    </td>
                    <td className="px-4 py-3" data-label="Customer">
                      <span className="text-sm font-medium text-gray-900 dark:text-white">{order.customerName}</span>
                    </td>
                    <td className="px-4 py-3" data-label="Phone">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm text-gray-600 dark:text-gray-300">{order.customerPhone}</span>
                        <button
                          type="button"
                          onClick={() => onCallCustomer(order.customerPhone)}
                          className="w-7 h-7 flex items-center justify-center bg-blue-100 dark:bg-blue-900/40 rounded hover:bg-blue-200 dark:hover:bg-blue-900/60"
                          title="Call customer"
                        >
                          <span className="text-xs" aria-hidden>
                            📞
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => onWhatsApp(order.customerPhone)}
                          className="w-7 h-7 flex items-center justify-center bg-green-100 dark:bg-green-900/40 rounded hover:bg-green-200 dark:hover:bg-green-900/60"
                          title="WhatsApp"
                        >
                          <span className="text-xs" aria-hidden>
                            💬
                          </span>
                        </button>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-300" data-label="Order">
                      #{order.orderNumber}
                    </td>
                    <td className="px-4 py-3 text-sm" data-label="Delivery date">
                      {getDeliveryDateDisplay(order)}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-300" data-label="Area">
                      {order.area}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-300" data-label="Product">
                      {order.product}
                    </td>
                    <td className="px-4 py-3" data-label="Status">
                      <span
                        className={`inline-flex px-2.5 py-1 rounded-full text-xs font-medium ${statusConfig.badgeStyle}`}
                      >
                        ● {statusConfig.label}
                      </span>
                    </td>
                    <td className="px-4 py-3" data-label="Action">
                      {getActionButton(order)}
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
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            disabled={currentPage === 1}
            className="px-3 py-1.5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-600 rounded text-sm disabled:opacity-50"
          >
            ←
          </button>
          {pages.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setCurrentPage(p)}
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
            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
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
