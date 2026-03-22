import React from 'react';
import { STATUS_CONFIG } from '../../config/statusColors';
import type { DeliveryOrder } from '../../types/delivery';

interface StatusMetricCardsProps {
  orders: DeliveryOrder[];
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

/** Read-only KPI strip — filters live on the table tabs below (no duplicate click-to-filter). */
export const StatusMetricCards: React.FC<StatusMetricCardsProps> = ({ orders }) => {
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
          const isFaded = key === 'delivered' && count === 0;

          return (
            <div
              key={key}
              className={`
              relative flex flex-col rounded-xl bg-white dark:bg-gray-800/80 p-3 pt-3.5 pb-3.5 text-left
              w-full min-w-0 shadow-sm border
              ${
                isHighlight
                  ? 'border-2 border-amber-400/90'
                  : 'border border-gray-200 dark:border-gray-600'
              }
              ${isFaded ? 'opacity-50' : ''}
            `}
            >
              <div className="flex items-start justify-between gap-2">
                <div
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${config.iconBg} dark:opacity-90`}
                >
                  <span className="text-base leading-none">{config.icon}</span>
                </div>
              </div>

              <p
                className={`mt-2.5 text-xs font-semibold leading-snug ${isHighlight ? config.textColor : 'text-gray-600 dark:text-gray-300'}`}
              >
                {config.label}
              </p>

              <div className="mt-2 flex items-end justify-between gap-2 border-t border-gray-100 pt-2.5 dark:border-gray-700/80">
                <span className="text-2xl font-bold tabular-nums leading-none text-gray-900 dark:text-white">
                  {count}
                </span>
                <span className="pb-0.5 text-[10px] font-medium text-gray-400">{sublabel}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
