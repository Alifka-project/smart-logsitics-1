import React from 'react';
import { CheckCircle, XCircle, RotateCcw, Truck, AlertCircle, Wrench, CheckCircle2, Clock } from 'lucide-react';

export default function StatusUpdateForm({ status, setStatus, notes, setNotes, deliveryStatus }) {
  // Determine available statuses based on current status
  const getAvailableStatuses = () => {
    const currentStatus = deliveryStatus || 'pending';
    
    // All status options for driver/admin to update
    const allStatuses = [
      { 
        value: 'scheduled', 
        label: 'Scheduled', 
        icon: Clock, 
        color: 'purple',
        activeClass: 'border-purple-500 bg-purple-50',
        iconActiveClass: 'text-purple-600',
        description: 'Mark as scheduled'
      },
      { 
        value: 'out-for-delivery', 
        label: 'Out for Delivery', 
        icon: Truck, 
        color: 'indigo',
        activeClass: 'border-indigo-500 bg-indigo-50',
        iconActiveClass: 'text-indigo-600',
        description: 'Driver has started delivery'
      },
      { 
        value: 'delivered-with-installation', 
        label: 'Delivered (With Installation)', 
        icon: Wrench, 
        color: 'green',
        activeClass: 'border-green-500 bg-green-50',
        iconActiveClass: 'text-green-600',
        description: 'Delivered and installed'
      },
      { 
        value: 'delivered-without-installation', 
        label: 'Delivered (No Installation)', 
        icon: CheckCircle2, 
        color: 'green',
        activeClass: 'border-green-500 bg-green-50',
        iconActiveClass: 'text-green-600',
        description: 'Delivered without installation'
      },
      { 
        value: 'cancelled', 
        label: 'Cancelled', 
        icon: XCircle, 
        color: 'red',
        activeClass: 'border-red-500 bg-red-50',
        iconActiveClass: 'text-red-600',
        description: 'Delivery cancelled'
      },
      { 
        value: 'rejected', 
        label: 'Rejected', 
        icon: AlertCircle, 
        color: 'red',
        activeClass: 'border-red-500 bg-red-50',
        iconActiveClass: 'text-red-600',
        description: 'Delivery rejected'
      },
      { 
        value: 'rescheduled', 
        label: 'Rescheduled', 
        icon: RotateCcw, 
        color: 'orange',
        activeClass: 'border-orange-500 bg-orange-50',
        iconActiveClass: 'text-orange-600',
        description: 'Reschedule delivery'
      },
    ];

    return allStatuses;
  };

  const statuses = getAvailableStatuses();

  return (
    <div className="space-y-4">
      <h3 className="text-base sm:text-lg font-semibold text-gray-800 dark:text-gray-100">Update Status</h3>
      
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
        {statuses.map((s) => {
          const Icon = s.icon;
          return (
            <button
              key={s.value}
              onClick={() => setStatus(s.value)}
              className={`flex flex-col items-center gap-2 p-3 sm:p-4 rounded-lg border-2 transition-all hover:shadow-md ${
                status === s.value
                  ? s.activeClass
                  : 'border-gray-300 dark:border-gray-700 hover:border-gray-400 dark:hover:border-gray-500 bg-white dark:bg-gray-800'
              }`}
              title={s.description}
            >
              <Icon className={`w-5 h-5 sm:w-6 sm:h-6 ${
                status === s.value
                  ? s.iconActiveClass
                  : 'text-gray-400 dark:text-gray-500'
              }`} />
              <span className={`font-medium text-xs sm:text-sm text-center ${
                status === s.value
                  ? 'text-gray-800 dark:text-gray-100'
                  : 'text-gray-600 dark:text-gray-300'
              }`}>
                {s.label}
              </span>
            </button>
          );
        })}
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-2">
          Notes / Comments
        </label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          className="w-full px-3 sm:px-4 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm sm:text-base bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 transition-colors"
          placeholder="Add any additional notes (reason for cancellation, reschedule details, etc.)..."
        />
      </div>
    </div>
  );
}
