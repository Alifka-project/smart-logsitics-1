import React, { useEffect, useState } from 'react';
import { AlertCircle, AlertTriangle, Zap } from 'lucide-react';
import useDeliveryStore from '../store/useDeliveryStore';
import DeliveryMap from '../components/MapView/DeliveryMap';
import DirectionsPanel from '../components/MapView/DirectionsPanel';
import { calculateRoute, generateFallbackRoute } from '../services/advancedRoutingService';

export default function MapViewPage() {
  const deliveries = useDeliveryStore((state) => state.deliveries);
  const [route, setRoute] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [isFallback, setIsFallback] = useState(false);
  const [isOptimized, setIsOptimized] = useState(false);

  // Debug: Log deliveries whenever they change
  useEffect(() => {
    console.log('MapViewPage - Deliveries updated:', {
      count: deliveries?.length || 0,
      first: deliveries?.[0],
      sample: deliveries?.slice(0, 3)
    });
  }, [deliveries]);

  useEffect(() => {
    if (deliveries.length === 0) return;

    const loadRoute = async () => {
      setIsLoading(true);
      setError(null);
      setIsFallback(false);
      setIsOptimized(false);
      try {
        const locations = [
          { lat: 25.0053, lng: 55.0760 }, // Warehouse
          ...deliveries.map(d => ({ lat: d.lat, lng: d.lng }))
        ];
        
        try {
          // Use advanced routing with AI optimization
          const routeData = await calculateRoute(locations, deliveries, true);
          setRoute(routeData);
          setIsOptimized(routeData.optimized === true);
          console.log('Route calculated with AI optimization:', {
            optimized: routeData.optimized,
            distance: routeData.distanceKm.toFixed(2),
            time: routeData.timeHours.toFixed(2)
          });
        } catch (apiError) {
          console.warn('Advanced route calculation failed, using fallback:', apiError.message);
          setError('Using simple fallback route (advanced routing temporarily unavailable)');
          setIsFallback(true);
          const fallbackRoute = generateFallbackRoute(locations);
          setRoute(fallbackRoute);
        }
      } catch (err) {
        console.error('Fatal error loading route:', err);
        setError('Failed to generate route. Please try again.');
      } finally {
        setIsLoading(false);
      }
    };

    loadRoute();
  }, [deliveries]);

  if (deliveries.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow-md p-6 sm:p-8 lg:p-12 text-center">
        <p className="text-gray-500 text-base sm:text-lg">
          No deliveries loaded. Please upload data or load synthetic data first.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Route Info */}
      <div className="bg-gradient-to-r from-primary-600 to-primary-700 text-white rounded-lg shadow-lg p-4 sm:p-6">
        <div className="flex items-center justify-between mb-3 sm:mb-4">
          <h2 className="text-xl sm:text-2xl font-bold">📍 Optimized Delivery Route</h2>
          {isOptimized && (
            <div className="flex items-center gap-1 bg-green-500 px-3 py-1 rounded-full text-xs sm:text-sm font-semibold">
              <Zap className="w-4 h-4" /> AI Optimized
            </div>
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 text-center">
          <div>
            <div className="text-2xl sm:text-3xl font-bold">{deliveries.length}</div>
            <div className="text-xs sm:text-sm opacity-90">Total Stops</div>
          </div>
          <div>
            <div className="text-2xl sm:text-3xl font-bold">
              {route ? route.distanceKm.toFixed(1) : '...'} km
            </div>
            <div className="text-xs sm:text-sm opacity-90">Total Distance</div>
          </div>
          <div>
            <div className="text-2xl sm:text-3xl font-bold">
              {route ? (route.timeHours + deliveries.length * 1).toFixed(1) : '...'} hrs
            </div>
            <div className="text-xs sm:text-sm opacity-90">Est. Time (with installation)</div>
          </div>
        </div>
        <div className="mt-3 sm:mt-4 space-y-1">
          <p className="text-xs sm:text-sm opacity-90">
            ✓ Starting Point: Jebel Ali Free Zone, Dubai
          </p>
          <p className="text-xs sm:text-sm opacity-90">
            ✓ Route {isOptimized ? 'optimized by AI' : 'calculated by distance'}
          </p>
          <p className="text-xs sm:text-sm opacity-90">
            ✓ Includes 1 hour installation time per stop
          </p>
          {route?.isMultiLeg && (
            <p className="text-xs sm:text-sm opacity-90">
              ℹ Multi-leg route: {route.chunkCount} segments (large dataset optimization)
            </p>
          )}
          {route?.optimization && (
            <p className="text-xs sm:text-sm opacity-90 italic">
              💡 {route.optimization.explanation}
            </p>
          )}
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className={`border-l-4 rounded-lg p-4 flex items-start gap-3 ${
          isFallback 
            ? 'bg-yellow-50 border-yellow-500' 
            : 'bg-red-50 border-red-500'
        }`}>
          {isFallback ? (
            <AlertTriangle className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
          ) : (
            <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
          )}
          <div className={`text-sm ${isFallback ? 'text-yellow-700' : 'text-red-700'}`}>
            <p className="font-semibold mb-1">
              {isFallback ? 'Using Simplified Route' : 'Route Calculation Error'}
            </p>
            <p>{error}</p>
          </div>
        </div>
      )}

      {/* Map */}
      <div className="bg-white rounded-lg shadow-lg overflow-hidden">
        {isLoading ? (
          <div className="h-[400px] sm:h-[500px] lg:h-[600px] flex items-center justify-center">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 sm:h-16 sm:w-16 border-b-2 border-primary-600 mx-auto mb-4"></div>
              <p className="text-gray-600 text-sm sm:text-base">Calculating route for {deliveries.length} deliveries...</p>
              {deliveries.length > 50 && (
                <p className="text-gray-500 text-xs mt-2">Large dataset - may take a minute</p>
              )}
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

