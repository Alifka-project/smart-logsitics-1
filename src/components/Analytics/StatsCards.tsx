import React, { useMemo } from 'react';
import { Package, CheckCircle, Clock, XCircle, Truck } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import useDeliveryStore from '../../store/useDeliveryStore';

interface StatItem {
  label: string;
  value: number;
  icon: LucideIcon;
  color: string;
  className: string;
}

export default function StatsCards() {
  const deliveries = useDeliveryStore((state) => state.deliveries ?? []);

  const analytics = useMemo(() => {
    return {
      total: deliveries.length,
      completed: deliveries.filter((d) => {
        const s = d.status?.toLowerCase();
        return (
          s === 'delivered' ||
          s === 'delivered-with-installation' ||
          s === 'delivered-without-installation'
        );
      }).length,
      pending: deliveries.filter((d) => {
        const s = (d.status || '').toLowerCase();
        // Any order that is not delivered, cancelled, or returned is still a pending order
        return !['delivered', 'delivered-with-installation', 'delivered-without-installation',
                 'finished', 'completed', 'pod-completed',
                 'cancelled', 'canceled', 'rejected',
                 'returned', 'failed'].includes(s);
      }).length,
      cancelled: deliveries.filter((d) => {
        const s = d.status?.toLowerCase();
        return s === 'cancelled' || s === 'rejected';
      }).length,
      inProgress: deliveries.filter((d) => {
        const s = d.status?.toLowerCase();
        return s === 'in-progress' || s === 'out-for-delivery' || s === 'pgi-done' || s === 'pickup-confirmed';
      }).length,
      scheduled: deliveries.filter((d) => d.status?.toLowerCase() === 'scheduled').length,
      scheduledConfirmed: deliveries.filter(
        (d) => d.status?.toLowerCase() === 'scheduled-confirmed',
      ).length,
      outForDelivery: deliveries.filter((d) => d.status?.toLowerCase() === 'out-for-delivery')
        .length,
      rescheduled: deliveries.filter((d) => d.status?.toLowerCase() === 'rescheduled').length,
      returned: deliveries.filter((d) => d.status?.toLowerCase() === 'returned').length,
    };
  }, [deliveries]);

  const stats: StatItem[] = [
    {
      label: 'Total Deliveries',
      value: analytics.total,
      icon: Package,
      color: 'primary',
      className: 'bg-gradient-to-br from-blue-500 to-blue-600',
    },
    {
      label: 'Completed',
      value: analytics.completed,
      icon: CheckCircle,
      color: 'green',
      className: 'bg-gradient-to-br from-green-500 to-green-600',
    },
    {
      label: 'Out for Delivery',
      value: analytics.outForDelivery,
      icon: Truck,
      color: 'indigo',
      className: 'bg-gradient-to-br from-indigo-500 to-indigo-600',
    },
    {
      label: 'Pending Order',
      value: analytics.pending,
      icon: Clock,
      color: 'yellow',
      className: 'bg-gradient-to-br from-yellow-500 to-yellow-600',
    },
    {
      label: 'Awaiting Customer',
      value: analytics.scheduled,
      icon: Clock,
      color: 'purple',
      className: 'bg-gradient-to-br from-orange-500 to-orange-600',
    },
    {
      label: 'Cancelled/Rejected',
      value: analytics.cancelled,
      icon: XCircle,
      color: 'red',
      className: 'bg-gradient-to-br from-red-500 to-red-600',
    },
  ];

  return (
    <div className="pp-kpi-grid pp-kpi-grid--stats">
      {stats.map((stat, index) => {
        const Icon = stat.icon;
        return (
          <div key={index} className={`${stat.className} rounded-xl shadow-md p-4 sm:p-5 text-white w-full min-w-0`}>
            <div className="flex items-center justify-between mb-2">
              <Icon className="w-5 h-5 sm:w-6 sm:h-6 opacity-80" />
            </div>
            <div className="text-2xl sm:text-3xl font-bold mb-1">{stat.value}</div>
            <div className="text-xs sm:text-sm opacity-90">{stat.label}</div>
          </div>
        );
      })}
    </div>
  );
}
