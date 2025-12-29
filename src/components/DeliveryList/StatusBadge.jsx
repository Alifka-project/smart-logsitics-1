import React from 'react';
import { CheckCircle, XCircle, Clock, RotateCcw, Truck, Package, AlertCircle, Wrench, CheckCircle2 } from 'lucide-react';

export default function StatusBadge({ status }) {
  const configs = {
    'scheduled': {
      icon: Clock,
      text: 'Scheduled',
      className: 'bg-purple-100 text-purple-800',
    },
    'scheduled-confirmed': {
      icon: CheckCircle2,
      text: 'Confirmed',
      className: 'bg-blue-100 text-blue-800',
    },
    'out-for-delivery': {
      icon: Truck,
      text: 'Out for Delivery',
      className: 'bg-indigo-100 text-indigo-800',
    },
    'delivered-with-installation': {
      icon: Wrench,
      text: 'Delivered (With Installation)',
      className: 'bg-green-100 text-green-800',
    },
    'delivered-without-installation': {
      icon: CheckCircle,
      text: 'Delivered (No Installation)',
      className: 'bg-green-100 text-green-800',
    },
    'pending': {
      icon: Clock,
      text: 'Pending',
      className: 'bg-yellow-100 text-yellow-800',
    },
    'in-progress': {
      icon: Truck,
      text: 'In Progress',
      className: 'bg-blue-100 text-blue-800',
    },
    'delivered': {
      icon: CheckCircle,
      text: 'Delivered',
      className: 'bg-green-100 text-green-800',
    },
    'cancelled': {
      icon: XCircle,
      text: 'Cancelled',
      className: 'bg-red-100 text-red-800',
    },
    'rejected': {
      icon: AlertCircle,
      text: 'Rejected',
      className: 'bg-red-100 text-red-800',
    },
    'rescheduled': {
      icon: RotateCcw,
      text: 'Rescheduled',
      className: 'bg-orange-100 text-orange-800',
    },
    'returned': {
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
