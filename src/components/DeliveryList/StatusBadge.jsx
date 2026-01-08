import React from 'react';
import { CheckCircle, XCircle, Clock, RotateCcw, Truck, Package, AlertCircle, Wrench, CheckCircle2 } from 'lucide-react';

export default function StatusBadge({ status }) {
  const configs = {
    'scheduled': {
      icon: Clock,
      text: 'Scheduled',
      className: 'bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-300',
    },
    'scheduled-confirmed': {
      icon: CheckCircle2,
      text: 'Confirmed',
      className: 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300',
    },
    'out-for-delivery': {
      icon: Truck,
      text: 'Out for Delivery',
      className: 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-800 dark:text-indigo-300',
    },
    'delivered-with-installation': {
      icon: Wrench,
      text: 'Delivered (With Installation)',
      className: 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300',
    },
    'delivered-without-installation': {
      icon: CheckCircle,
      text: 'Delivered (No Installation)',
      className: 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300',
    },
    'pending': {
      icon: Clock,
      text: 'Pending',
      className: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300',
    },
    'in-progress': {
      icon: Truck,
      text: 'In Progress',
      className: 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300',
    },
    'delivered': {
      icon: CheckCircle,
      text: 'Delivered',
      className: 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300',
    },
    'cancelled': {
      icon: XCircle,
      text: 'Cancelled',
      className: 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300',
    },
    'rejected': {
      icon: AlertCircle,
      text: 'Rejected',
      className: 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300',
    },
    'rescheduled': {
      icon: RotateCcw,
      text: 'Rescheduled',
      className: 'bg-orange-100 dark:bg-orange-900/30 text-orange-800 dark:text-orange-300',
    },
    'returned': {
      icon: RotateCcw,
      text: 'Returned',
      className: 'bg-orange-100 dark:bg-orange-900/30 text-orange-800 dark:text-orange-300',
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
