import React, { useMemo } from 'react';
import { Package, CheckCircle, Clock, XCircle, Truck, AlertCircle } from 'lucide-react';
import useDeliveryStore from '../../store/useDeliveryStore';

export default function StatsCards() {
  const deliveries = useDeliveryStore((state) => state.deliveries);
  
  // Memoize analytics to prevent infinite re-renders
  const analytics = useMemo(() => {
    return {
      total: deliveries.length,
      // Count all delivered variations
      completed: deliveries.filter(d => {
        const s = d.status?.toLowerCase();
        return s === 'delivered' || s === 'delivered-with-installation' || s === 'delivered-without-installation';
      }).length,
      pending: deliveries.filter(d => {
        const s = d.status?.toLowerCase();
        return s === 'pending' || s === 'scheduled';
      }).length,
      cancelled: deliveries.filter(d => {
        const s = d.status?.toLowerCase();
        return s === 'cancelled' || s === 'rejected';
      }).length,
      inProgress: deliveries.filter(d => {
        const s = d.status?.toLowerCase();
        return s === 'in-progress' || s === 'out-for-delivery';
      }).length,
      scheduled: deliveries.filter(d => d.status?.toLowerCase() === 'scheduled').length,
      scheduledConfirmed: deliveries.filter(d => d.status?.toLowerCase() === 'scheduled-confirmed').length,
      outForDelivery: deliveries.filter(d => d.status?.toLowerCase() === 'out-for-delivery').length,
      rescheduled: deliveries.filter(d => d.status?.toLowerCase() === 'rescheduled').length,
      returned: deliveries.filter(d => d.status?.toLowerCase() === 'returned').length,
    };
  }, [deliveries]);

  const stats = [
    {
      label: 'Total Deliveries',
      value: analytics.total,
      icon: Package,
      color: 'primary',
      className: 'bg-gradient-to-br from-primary-500 to-primary-600',
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
      label: 'Pending',
      value: analytics.pending,
      icon: Clock,
      color: 'yellow',
      className: 'bg-gradient-to-br from-yellow-500 to-yellow-600',
    },
    {
      label: 'Scheduled',
      value: analytics.scheduled,
      icon: Clock,
      color: 'purple',
      className: 'bg-gradient-to-br from-purple-500 to-purple-600',
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
    <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3 sm:gap-4">
      {stats.map((stat, index) => {
        const Icon = stat.icon;
        return (
          <div key={index} className={`${stat.className} rounded-lg shadow-md p-4 sm:p-6 text-white`}>
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
