import React from 'react';
import { ArrowUpRight } from 'lucide-react';
import { STATUS_CONFIG } from '../../config/statusColors';
import type { DeliveryOrder } from '../../types/delivery';

interface StatusMetricCardsProps {
  orders: DeliveryOrder[];
  /** Called with the card's status key when clicked. Parent maps to an OrdersTableTab. */
  onCardClick?: (statusKey: string) => void;
  /** The currently active filter key — highlights the matching card. */
  activeKey?: string;
}

const CARD_DEFS = [
  { key: 'uploaded',          sublabel: 'No SMS sent',    darkIconBg: 'dark:bg-blue-500/30' },
  { key: 'sms_sent',          sublabel: 'SMS sent',        darkIconBg: 'dark:bg-emerald-500/30' },
  { key: 'unconfirmed',       sublabel: 'No reply 48h+',  darkIconBg: 'dark:bg-red-500/35' },
  { key: 'tomorrow_shipment', sublabel: 'Ships tomorrow',  darkIconBg: 'dark:bg-teal-500/35' },
  { key: 'next_shipment',     sublabel: 'Skip day',        darkIconBg: 'dark:bg-cyan-500/30' },
  { key: 'future_shipment',   sublabel: 'Later date',      darkIconBg: 'dark:bg-indigo-500/30' },
  { key: 'out_for_delivery',  sublabel: 'On route',        darkIconBg: 'dark:bg-orange-500/30' },
  { key: 'delivered',         sublabel: 'Today',           darkIconBg: 'dark:bg-green-500/35' },
] as const;

export const StatusMetricCards: React.FC<StatusMetricCardsProps> = ({ orders, onCardClick, activeKey }) => {
  const statusCounts = {
    uploaded:          orders.filter((o) => o.status === 'uploaded').length,
    sms_sent:          orders.filter((o) => o.status === 'sms_sent').length,
    unconfirmed:       orders.filter((o) => o.status === 'unconfirmed').length,
    tomorrow_shipment: orders.filter((o) => o.status === 'tomorrow_shipment').length,
    next_shipment:     orders.filter((o) => o.status === 'next_shipment').length,
    future_shipment:   orders.filter((o) => o.status === 'future_shipment').length,
    out_for_delivery:  orders.filter((o) => o.status === 'out_for_delivery').length,
    delivered:         orders.filter((o) => o.status === 'delivered').length,
  };

  return (
    <div className="status-cards-mobile overflow-x-auto pb-1 -mx-1 px-1 lg:mx-0 lg:px-0">
      <div className="grid grid-cols-2 min-[480px]:grid-cols-4 md:grid-cols-4 lg:grid-cols-8 gap-3 w-full min-w-0">
        {CARD_DEFS.map(({ key, sublabel, darkIconBg }) => {
          const config = STATUS_CONFIG[key as keyof typeof statusCounts];
          const count = statusCounts[key as keyof typeof statusCounts];
          const isDelivered = key === 'delivered' && count > 0;
          const isHighlight = Boolean(config.highlight) || isDelivered;
          // A card is "active" when the parent's active filter matches this card's key
          const isActive = activeKey === key;
          const clickable = Boolean(onCardClick);

          return (
            <div
              key={key}
              role={clickable ? 'button' : undefined}
              tabIndex={clickable ? 0 : undefined}
              onClick={() => onCardClick?.(key)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onCardClick?.(key); }}
              className={`
                relative flex flex-col rounded-xl bg-white dark:bg-gray-800/80 p-3 pt-3.5 pb-3.5 text-left
                w-full min-w-0 shadow-sm border transition-all
                ${clickable ? 'cursor-pointer select-none' : ''}
                ${isActive
                  ? 'ring-2 ring-offset-1 ring-blue-500 border-blue-400 dark:ring-blue-400'
                  : isDelivered
                  ? 'border-2 border-green-400/90'
                  : isHighlight
                  ? 'border-2 border-amber-400/90'
                  : 'border border-gray-200 dark:border-gray-600'
                }
                ${clickable && !isActive ? 'hover:shadow-md hover:border-blue-300 dark:hover:border-blue-500' : ''}
              `}
            >
              <div className="flex items-start justify-between gap-2">
                <div
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-base ${config.iconBg} ${darkIconBg}`}
                >
                  <span className="leading-none">{config.icon}</span>
                </div>
                {clickable && (
                  <span className={`pointer-events-none ${isActive ? 'text-blue-400' : 'text-gray-300 dark:text-slate-600'}`} aria-hidden>
                    <ArrowUpRight className="w-3.5 h-3.5" strokeWidth={2} />
                  </span>
                )}
              </div>

              <p className={`mt-2.5 text-xs font-semibold leading-snug ${isHighlight || isActive ? config.textColor : 'text-gray-600 dark:text-gray-300'}`}>
                {config.label}
              </p>

              <div className="mt-2 flex items-end justify-between gap-2 border-t border-gray-100 pt-2.5 dark:border-gray-600">
                <span className="text-2xl font-bold tabular-nums leading-none text-gray-900 dark:text-white">
                  {count}
                </span>
                <span className="pb-0.5 text-[10px] font-medium text-gray-400 dark:text-gray-500">{sublabel}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
