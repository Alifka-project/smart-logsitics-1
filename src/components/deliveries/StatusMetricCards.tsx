import React from 'react';
import { ArrowUpRight } from 'lucide-react';
import { STATUS_CONFIG } from '../../config/statusColors';
import type { DeliveryOrder } from '../../types/delivery';
import { classifyConfirmedDate } from '../../utils/deliveryWorkflowMap';

interface StatusMetricCardsProps {
  orders: DeliveryOrder[];
  /** Called with the card's status key when clicked. Parent maps to an OrdersTableTab. */
  onCardClick?: (statusKey: string) => void;
  /** The currently active filter key — highlights the matching card. */
  activeKey?: string;
}

const CARD_DEFS = [
  { key: 'uploaded',         sublabel: 'Awaiting action', darkIconBg: 'dark:bg-blue-500/30' },
  { key: 'sms_sent',         sublabel: 'Awaiting + no reply', darkIconBg: 'dark:bg-emerald-500/30' },
  { key: 'unconfirmed',      sublabel: 'No reply',        darkIconBg: 'dark:bg-red-500/35' },
  { key: 'next_shipment',    sublabel: 'Tomorrow',          darkIconBg: 'dark:bg-amber-500/30' },
  { key: 'future_schedule',  sublabel: '2+ days out',     darkIconBg: 'dark:bg-indigo-500/30' },
  { key: 'out_for_delivery', sublabel: 'Dispatched',      darkIconBg: 'dark:bg-orange-500/30' },
  { key: 'order_delay',      sublabel: 'Needs attention', darkIconBg: 'dark:bg-rose-500/35' },
  { key: 'delivered',        sublabel: 'Completed',       darkIconBg: 'dark:bg-green-500/35' },
] as const;

// Terminal workflow statuses — excluded from "Pending Orders" total
const TERMINAL_WF = new Set(['delivered', 'cancelled', 'failed']);

// Excluded from the date-tier shipment cards (Next Shipment / Future Schedule)
// so an order already dispatched or explicitly delayed doesn't double-count
// on cards that mean "scheduled-to-go-out". out_for_delivery lives under the
// On Route card; order_delay lives under Order Delay.
const SHIPMENT_CARD_EXCLUDED = new Set(['delivered', 'cancelled', 'failed', 'out_for_delivery', 'order_delay']);

export const StatusMetricCards: React.FC<StatusMetricCardsProps> = ({ orders, onCardClick, activeKey }) => {
  const statusCounts = {
    // "Pending Orders" = everything not yet delivered/cancelled/failed — same logic as Needs Attention
    uploaded:         orders.filter((o) => !TERMINAL_WF.has(o.status)).length,
    sms_sent:         orders.filter((o) => o.status === 'sms_sent' || o.status === 'unconfirmed').length,
    unconfirmed:      orders.filter((o) => o.status === 'unconfirmed').length,
    // Date-first tier counts. Any non-terminal, non-active-route order whose
    // confirmedDeliveryDate falls tomorrow (Dubai) counts as Next Shipment;
    // 2+ days out counts as Future Schedule. This catches rescheduled / pgi-
    // done / pickup-confirmed orders whose workflow status short-circuits
    // before the tier branches — those would otherwise silently disappear
    // from these cards even though the promised date falls within the tier.
    next_shipment: orders.filter((o) => {
      if (SHIPMENT_CARD_EXCLUDED.has(o.status)) return false;
      if (!o.confirmedDeliveryDate) return false;
      const tier = classifyConfirmedDate(o.confirmedDeliveryDate);
      return tier === 'same_day' || tier === 'next';
    }).length,
    future_schedule: orders.filter((o) => {
      if (SHIPMENT_CARD_EXCLUDED.has(o.status)) return false;
      if (!o.confirmedDeliveryDate) return false;
      return classifyConfirmedDate(o.confirmedDeliveryDate) === 'future';
    }).length,
    out_for_delivery: orders.filter((o) => o.status === 'out_for_delivery').length,
    order_delay:      orders.filter((o) => o.status === 'order_delay').length,
    delivered:        orders.filter((o) => o.status === 'delivered').length,
  };

  return (
    <div className="status-cards-mobile overflow-x-auto py-1 px-0.5 -mx-0.5">
      <div className="grid grid-cols-2 min-[480px]:grid-cols-4 md:grid-cols-4 lg:grid-cols-8 gap-3 w-full min-w-0">
        {CARD_DEFS.map(({ key, sublabel, darkIconBg }) => {
          const config = STATUS_CONFIG[key as keyof typeof statusCounts];
          const count = statusCounts[key as keyof typeof statusCounts];
          const isHighlight = Boolean(config.highlight);
          // A card is "active" when the parent's active filter matches this card's key
          const isActive = activeKey === key;
          const clickable = Boolean(onCardClick);
          // highlightRing uses CSS outline (immune to overflow:hidden clipping)
          const highlightRing = config.highlightRing ?? '';

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
                  ? 'outline outline-2 outline-blue-500 border-transparent bg-blue-50/40 dark:bg-blue-900/20'
                  : isHighlight
                  ? `${highlightRing} border-transparent`
                  : 'border-gray-200 dark:border-gray-600'
                }
                ${clickable && !isActive ? 'hover:shadow-md' : ''}
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

              <div className="mt-2 flex items-baseline justify-between gap-2 border-t border-gray-100 pt-2.5 dark:border-gray-600">
                <span className="text-2xl font-bold tabular-nums leading-none text-gray-900 dark:text-white">
                  {count}
                </span>
                <span className="text-[10px] font-medium text-gray-400 dark:text-gray-500">{sublabel}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
