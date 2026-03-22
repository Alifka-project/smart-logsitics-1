import React from 'react';
import { Navigation } from 'lucide-react';

interface Maneuver {
  type: number;
  instruction: string;
  street_names?: string[];
  length?: number;
}

interface LegSummary {
  length?: number;
  time?: number;
}

interface RouteLeg {
  summary?: LegSummary;
  maneuvers?: Maneuver[];
}

interface Route {
  legs?: RouteLeg[];
}

interface DirectionsPanelProps {
  route?: Route | null;
}

export default function DirectionsPanel({ route }: DirectionsPanelProps) {
  if (!route || !route.legs) return null;

  return (
    <div className="bg-white rounded-lg shadow-lg p-6">
      <h3 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2">
        <Navigation className="w-6 h-6 text-blue-600" />
        Turn-by-Turn Directions
      </h3>

      <div className="space-y-4 max-h-96 overflow-y-auto">
        {route.legs.map((leg, legIndex) => (
          <div
            key={legIndex}
            className="border-l-4 border-blue-500 pl-4 py-2 bg-blue-50 rounded"
          >
            <div className="font-semibold text-blue-800 mb-2">
              Leg {legIndex + 1}:{' '}
              {legIndex === 0 ? 'From Warehouse' : `Stop ${legIndex}`} → Stop {legIndex + 1}
            </div>
            <div className="text-sm text-gray-600 mb-2">
              Distance: {leg.summary?.length?.toFixed(1) ?? 0} km | Duration:{' '}
              {Math.round((leg.summary?.time ?? 0) / 60)} min
            </div>

            {leg.maneuvers && (
              <ol className="list-decimal list-inside space-y-1 text-sm">
                {leg.maneuvers
                  .filter((m) => m.type !== 4)
                  .map((maneuver, idx) => (
                    <li key={idx} className="text-gray-700">
                      <strong>{maneuver.instruction}</strong>
                      {maneuver.street_names && (
                        <span className="text-gray-500">
                          {' '}
                          on {maneuver.street_names.join(', ')}
                        </span>
                      )}
                      <span className="text-gray-400">
                        {' '}
                        ({(maneuver.length ?? 0).toFixed(2)} km)
                      </span>
                    </li>
                  ))}
              </ol>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
