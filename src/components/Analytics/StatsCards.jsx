import React, { useMemo } from 'react';
import { Package, CheckCircle, Clock, XCircle } from 'lucide-react';
import useDeliveryStore from '../../store/useDeliveryStore';

export default function StatsCards() {
  const deliveries = useDeliveryStore((state) => state.deliveries);
  
  // Memoize analytics to prevent infinite re-renders
  const analytics = useMemo(() => {
    return {
      total: deliveries.length,
      completed: deliveries.filter(d => d.status === 'delivered').length,
      pending: deliveries.filter(d => d.status === 'pending').length,
      cancelled: deliveries.filter(d => d.status === 'cancelled').length,
      inProgress: deliveries.filter(d => d.status === 'in-progress').length,
      returned: deliveries.filter(d => d.status === 'returned').length,
    };
  }, [deliveries]);

  const stats = [
    {
      label: 'Total Deliveries',
      value: analytics.total,
      icon: Package,
      color: 'purple',
      className: 'bg-gradient-to-br from-purple-500 to-purple-600',
    },
    {
      label: 'Completed',
      value: analytics.completed,
      icon: CheckCircle,
      color: 'green',
      className: 'bg-gradient-to-br from-green-500 to-green-600',
    },
    {
      label: 'Pending',
      value: analytics.pending,
      icon: Clock,
      color: 'yellow',
      className: 'bg-gradient-to-br from-yellow-500 to-yellow-600',
    },
    {
      label: 'Cancelled',
      value: analytics.cancelled,
      icon: XCircle,
      color: 'red',
      className: 'bg-gradient-to-br from-red-500 to-red-600',
    },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      {stats.map((stat) => {
        const Icon = stat.icon;
        return (
          <div
            key={stat.label}
            className={`${stat.className} text-white rounded-lg shadow-lg p-6`}
          >
            <div className="flex items-center justify-between mb-4">
              <Icon className="w-8 h-8" />
              <div className="text-3xl font-bold">{stat.value}</div>
            </div>
            <div className="text-sm opacity-90">{stat.label}</div>
          </div>
        );
      })}
    </div>
  );
}

