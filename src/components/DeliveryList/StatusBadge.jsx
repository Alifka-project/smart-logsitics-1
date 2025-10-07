import React from 'react';
import { CheckCircle, XCircle, Clock, RotateCcw, Truck } from 'lucide-react';

export default function StatusBadge({ status }) {
  const configs = {
    pending: {
      icon: Clock,
      text: 'Pending',
      className: 'bg-yellow-100 text-yellow-800',
    },
    'in-progress': {
      icon: Truck,
      text: 'In Progress',
      className: 'bg-blue-100 text-blue-800',
    },
    delivered: {
      icon: CheckCircle,
      text: 'Delivered',
      className: 'bg-green-100 text-green-800',
    },
    cancelled: {
      icon: XCircle,
      text: 'Cancelled',
      className: 'bg-red-100 text-red-800',
    },
    returned: {
      icon: RotateCcw,
      text: 'Returned',
      className: 'bg-orange-100 text-orange-800',
    },
  };

  const config = configs[status] || configs.pending;
  const Icon = config.icon;

  return (
    <div className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm font-semibold ${config.className}`}>
      <Icon className="w-4 h-4" />
      {config.text}
    </div>
  );
}

