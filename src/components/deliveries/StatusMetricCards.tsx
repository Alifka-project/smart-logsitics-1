import React from 'react';
import { STATUS_CONFIG } from '../../config/statusColors';
import type { DeliveryOrder } from '../../types/delivery';

interface StatusMetricCardsProps {
  orders: DeliveryOrder[];
  onCardClick: (status: string) => void;
  activeFilter?: string;
}

const CARD_DEFS = [
  { key: 'uploaded', sublabel: 'New' },
  { key: 'sms_sent', sublabel: 'Awaiting' },
  { key: 'unconfirmed', sublabel: 'No reply' },
  { key: 'confirmed', sublabel: 'Tomorrow' },
  { key: 'scheduled', sublabel: 'Future' },
  { key: 'out_for_delivery', sublabel: 'On route' },
  { key: 'delivered', sublabel: 'Done' },
] as const;

export const StatusMetricCards: React.FC<StatusMetricCardsProps> = ({
  orders,
  onCardClick,
  activeFilter,
}) => {
  const statusCounts = {
    uploaded: orders.filter((o) => o.status === 'uploaded').length,
    sms_sent: orders.filter((o) => o.status === 'sms_sent').length,
    unconfirmed: orders.filter((o) => o.status === 'unconfirmed').length,
    confirmed: orders.filter((o) => o.status === 'confirmed').length,
    scheduled: orders.filter((o) => o.status === 'scheduled').length,
    out_for_delivery: orders.filter((o) => o.status === 'out_for_delivery').length,
    delivered: orders.filter((o) => o.status === 'delivered').length,
  };

  return (
    <div className="status-cards-mobile overflow-x-auto pb-1 -mx-1 px-1 lg:mx-0 lg:px-0">
      <div className="grid grid-cols-2 min-[480px]:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-3 w-full min-w-0">
        {CARD_DEFS.map(({ key, sublabel }) => {
          const config = STATUS_CONFIG[key as keyof typeof statusCounts];
          const count = statusCounts[key as keyof typeof statusCounts];
          const isHighlight = Boolean(config.highlight);
          const isActive = activeFilter === key;
          const isFaded = key === 'delivered' && count === 0;

          return (
            <button
              key={key}
              type="button"
              onClick={() => onCardClick(key)}
              className={`
              relative p-3 sm:p-4 rounded-xl bg-white dark:bg-gray-800/80 border text-left w-full min-w-0
              shadow-sm transition-all hover:shadow-md
              ${isHighlight ? 'border-2 border-amber-400' : 'border border-gray-200 dark:border-gray-600'}
              ${isActive ? 'ring-2 ring-[#002D5B] ring-offset-2 dark:ring-offset-gray-900' : ''}
              ${isFaded ? 'opacity-50' : ''}
            `}
            >
              <div
                className={`w-8 h-8 rounded-full ${config.iconBg} dark:opacity-90 flex items-center justify-center mb-2`}
              >
                <span className="text-sm">{config.icon}</span>
              </div>

              <span className="absolute top-3 right-3 text-gray-400 text-xs" aria-hidden>
                ↗
              </span>

              <p
                className={`text-xs font-medium ${isHighlight ? config.textColor : 'text-gray-600 dark:text-gray-300'}`}
              >
                {config.label}
              </p>

              <div className="flex items-baseline gap-1 mt-1">
                <span className="text-xl font-semibold text-gray-900 dark:text-white">{count}</span>
                <span className="text-xs text-gray-400">{sublabel}</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};
