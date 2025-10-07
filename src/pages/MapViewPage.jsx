import React, { useEffect, useState } from 'react';
import useDeliveryStore from '../store/useDeliveryStore';
import DeliveryMap from '../components/MapView/DeliveryMap';
import DirectionsPanel from '../components/MapView/DirectionsPanel';
import { calculateRoute } from '../services/routingService';

export default function MapViewPage() {
  const deliveries = useDeliveryStore((state) => state.deliveries);
  const [route, setRoute] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (deliveries.length === 0) return;

    const loadRoute = async () => {
      setIsLoading(true);
      try {
        const locations = [
          { lat: 25.0053, lng: 55.0760 }, // Warehouse
          ...deliveries.map(d => ({ lat: d.lat, lng: d.lng }))
        ];
        const routeData = await calculateRoute(locations);
        setRoute(routeData);
      } catch (error) {
        console.error('Failed to calculate route:', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadRoute();
  }, [deliveries]);

  if (deliveries.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow-md p-12 text-center">
        <p className="text-gray-500 text-lg">
          No deliveries loaded. Please upload data or load synthetic data first.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Route Info */}
      <div className="bg-gradient-to-r from-purple-600 to-purple-700 text-white rounded-lg shadow-lg p-6">
        <h2 className="text-2xl font-bold mb-4">📍 Optimized Delivery Route</h2>
        <div className="grid grid-cols-3 gap-4 text-center">
          <div>
            <div className="text-3xl font-bold">{deliveries.length}</div>
            <div className="text-sm opacity-90">Total Stops</div>
          </div>
          <div>
            <div className="text-3xl font-bold">
              {route ? route.distance.toFixed(1) : '...'} km
            </div>
            <div className="text-sm opacity-90">Total Distance</div>
          </div>
          <div>
            <div className="text-3xl font-bold">
              {route ? ((route.time + deliveries.length * 3600) / 3600).toFixed(1) : '...'} hrs
            </div>
            <div className="text-sm opacity-90">Est. Time (with installation)</div>
          </div>
        </div>
        <p className="text-sm mt-4 opacity-90">
          ✓ Starting Point: Jebel Ali Free Zone, Dubai
        </p>
        <p className="text-sm opacity-90">
          ✓ Route optimized by distance - closest deliveries first
        </p>
        <p className="text-sm opacity-90">
          ✓ Includes 1 hour installation time per stop
        </p>
      </div>

      {/* Map */}
      <div className="bg-white rounded-lg shadow-lg overflow-hidden">
        {isLoading ? (
          <div className="h-[600px] flex items-center justify-center">
            <div className="text-center">
              <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-purple-600 mx-auto mb-4"></div>
              <p className="text-gray-600">Calculating route...</p>
            </div>
          </div>
        ) : (
          <DeliveryMap deliveries={deliveries} route={route} />
        )}
      </div>

      {/* Turn-by-turn Directions */}
      {route && <DirectionsPanel route={route} />}
    </div>
  );
}

