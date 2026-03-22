import React, { useState } from 'react';
import type { DeliveryOrder } from '../../types/delivery';

interface RescheduleModalProps {
  order: DeliveryOrder;
  onClose: () => void;
  onReschedule: (newDate: Date) => void;
}

export const RescheduleModal: React.FC<RescheduleModalProps> = ({ order, onClose, onReschedule }) => {
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);

  const dayAfter = new Date();
  dayAfter.setDate(dayAfter.getDate() + 2);

  const nextWeek = new Date();
  nextWeek.setDate(nextWeek.getDate() + 7);

  const quickOptions = [
    { label: 'Tomorrow', date: tomorrow },
    { label: 'In 2 days', date: dayAfter },
    { label: 'Next week', date: nextWeek },
  ];

  const minDateStr = tomorrow.toISOString().split('T')[0];

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-md border border-gray-100 dark:border-gray-700">
        <div className="p-4 border-b border-gray-100 dark:border-gray-700">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Reschedule Delivery</h3>
            <button
              type="button"
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              aria-label="Close"
            >
              ✕
            </button>
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Order #{order.orderNumber} — {order.customerName}
          </p>
        </div>

        <div className="p-4 space-y-4">
          <div>
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Quick options</p>
            <div className="flex gap-2 flex-wrap">
              {quickOptions.map((option) => (
                <button
                  key={option.label}
                  type="button"
                  onClick={() => setSelectedDate(option.date)}
                  className={`
                    flex-1 min-w-[90px] py-2 px-3 rounded-lg text-sm border transition-all
                    ${
                      selectedDate?.toDateString() === option.date.toDateString()
                        ? 'bg-[#002D5B] text-white border-[#002D5B]'
                        : 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700'
                    }
                  `}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Or pick a date</p>
            <input
              type="date"
              min={minDateStr}
              onChange={(e) => {
                const v = e.target.value;
                if (v) setSelectedDate(new Date(v + 'T12:00:00'));
              }}
              className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#002D5B]"
            />
          </div>

          {selectedDate && (
            <div className="p-3 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 rounded-lg">
              <p className="text-sm text-amber-800 dark:text-amber-200">
                📅 New delivery date:{' '}
                <strong>
                  {selectedDate.toLocaleDateString('en-GB', {
                    weekday: 'long',
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  })}
                </strong>
              </p>
            </div>
          )}
        </div>

        <div className="p-4 border-t border-gray-100 dark:border-gray-700 flex gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2 px-4 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => selectedDate && onReschedule(selectedDate)}
            disabled={!selectedDate}
            className="flex-1 py-2 px-4 bg-[#002D5B] text-white rounded-lg hover:bg-[#001f3f] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Confirm Reschedule
          </button>
        </div>
      </div>
    </div>
  );
};
