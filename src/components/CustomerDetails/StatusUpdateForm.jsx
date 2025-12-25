import React from 'react';
import { CheckCircle, XCircle, RotateCcw } from 'lucide-react';

export default function StatusUpdateForm({ status, setStatus, notes, setNotes }) {
  const statuses = [
    { 
      value: 'delivered', 
      label: 'Delivered', 
      icon: CheckCircle, 
      color: 'green',
      activeClass: 'border-green-500 bg-green-50',
      iconActiveClass: 'text-green-600'
    },
    { 
      value: 'cancelled', 
      label: 'Cancelled', 
      icon: XCircle, 
      color: 'red',
      activeClass: 'border-red-500 bg-red-50',
      iconActiveClass: 'text-red-600'
    },
    { 
      value: 'returned', 
      label: 'Returned', 
      icon: RotateCcw, 
      color: 'orange',
      activeClass: 'border-orange-500 bg-orange-50',
      iconActiveClass: 'text-orange-600'
    },
  ];

  return (
    <div className="space-y-4">
      <h3 className="text-base sm:text-lg font-semibold text-gray-800">Update Status</h3>
      
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
        {statuses.map((s) => {
          const Icon = s.icon;
          return (
            <button
              key={s.value}
              onClick={() => setStatus(s.value)}
              className={`flex flex-col items-center gap-2 p-3 sm:p-4 rounded-lg border-2 transition-all ${
                status === s.value
                  ? s.activeClass
                  : 'border-gray-300 hover:border-gray-400'
              }`}
            >
              <Icon className={`w-6 h-6 sm:w-8 sm:h-8 ${status === s.value ? s.iconActiveClass : 'text-gray-400'}`} />
              <span className="font-medium text-sm sm:text-base">{s.label}</span>
            </button>
          );
        })}
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Notes / Comments
        </label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          className="w-full px-3 sm:px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm sm:text-base"
          placeholder="Add any additional notes..."
        />
      </div>
    </div>
  );
}

