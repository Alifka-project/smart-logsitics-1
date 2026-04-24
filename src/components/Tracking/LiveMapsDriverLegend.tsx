import React from 'react';
import { Truck } from 'lucide-react';
import type { DriverRoute } from '../../services/advancedRoutingService';

/**
 * Horizontal driver colour legend for the Live Maps sub-tab.
 *
 * Purpose: the map draws one coloured polyline per driver (colours from
 * DRIVER_ROUTE_COLORS rotation). Without a legend the customer-support
 * user has no way to tell which polyline belongs to which driver until
 * they click each pin. This strip maps colour → driver name → stop count
 * and doubles as a one-click driver filter.
 *
 * Scope: presentational only. No data fetching, no map interactions —
 * the parent page passes the data and wires up the click handler.
 */

interface LegendDriver {
  id: string;
  name: string;
  /** Matches the colour DeliveryMap draws for this driver's polyline. */
  color: string;
  /** True when driver pinged GPS recently — drives the online dot. */
  online: boolean;
  /** Count of stops still active on this driver's route (excludes delivered). */
  stopCount: number;
}

interface LiveMapsDriverLegendProps {
  /** DriverRoute entries sourced from computePerDriverRoutes so colours match polylines. */
  driverRoutes: DriverRoute[];
  /** Optional enrichments: which drivers are online, how many active stops each has. */
  enrich?: (driverId: string) => { online?: boolean; stopCount?: number };
  /** Currently-active driver filter id ('all' | driverId). Drives the chip's active styling. */
  activeDriverId: string;
  /** Click handler — parent flips the filter between 'all' and the clicked driver id. */
  onSelectDriver: (driverId: string) => void;
}

export default function LiveMapsDriverLegend({
  driverRoutes,
  enrich,
  activeDriverId,
  onSelectDriver,
}: LiveMapsDriverLegendProps): React.ReactElement | null {
  if (!driverRoutes || driverRoutes.length === 0) return null;

  const items: LegendDriver[] = driverRoutes.map((r) => {
    const meta = enrich ? enrich(r.driverId) ?? {} : {};
    return {
      id: r.driverId,
      name: r.name,
      color: r.color,
      online: meta.online ?? false,
      stopCount: meta.stopCount ?? 0,
    };
  });

  return (
    <div className="flex flex-wrap items-center gap-1.5 px-3 py-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg">
      <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mr-1">
        <Truck className="w-3 h-3" />
        Drivers
      </span>
      <button
        type="button"
        onClick={() => onSelectDriver('all')}
        className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border transition-colors ${
          activeDriverId === 'all'
            ? 'bg-gray-900 text-white border-gray-900 dark:bg-gray-100 dark:text-gray-900 dark:border-gray-100'
            : 'bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:border-gray-400'
        }`}
      >
        All
      </button>
      {items.map((d) => {
        const active = activeDriverId === d.id;
        return (
          <button
            key={d.id}
            type="button"
            onClick={() => onSelectDriver(active ? 'all' : d.id)}
            title={`${d.name} — ${d.stopCount} stop${d.stopCount === 1 ? '' : 's'}${d.online ? ' · online' : ' · offline'}`}
            className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-0.5 rounded-full border transition-all ${
              active
                ? 'bg-gray-900 text-white border-gray-900 dark:bg-gray-100 dark:text-gray-900 dark:border-gray-100 shadow-sm'
                : 'bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-200 border-gray-200 dark:border-gray-700 hover:border-gray-400'
            }`}
          >
            <span
              className="w-3 h-3 rounded-full border border-white dark:border-gray-900 shadow-sm flex-shrink-0"
              style={{ background: d.color }}
              aria-hidden
            />
            <span className="truncate max-w-[10ch]">{d.name}</span>
            <span className={`inline-block w-1.5 h-1.5 rounded-full flex-shrink-0 ${d.online ? 'bg-green-500' : 'bg-gray-400'}`} aria-hidden />
            <span className={`text-[10px] ${active ? 'text-gray-200 dark:text-gray-700' : 'text-gray-500 dark:text-gray-400'}`}>
              {d.stopCount}
            </span>
          </button>
        );
      })}
    </div>
  );
}
