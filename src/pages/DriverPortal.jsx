import React, { useEffect, useState, useRef, useCallback } from 'react';
import api, { setAuthToken } from '../frontend/apiClient';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { MapPin, Navigation, Activity, RefreshCw, AlertCircle, CheckCircle2 } from 'lucide-react';

// Fix Leaflet default marker icons
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

function ensureAuth() {
  const token = localStorage.getItem('auth_token');
  if (token) setAuthToken(token);
}

export default function DriverPortal() {
  const [location, setLocation] = useState(null);
  const [isTracking, setIsTracking] = useState(false);
  const [locationHistory, setLocationHistory] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const mapRef = useRef(null);
  const mapInstance = useRef(null);
  const markerRef = useRef(null);
  const watchIdRef = useRef(null);
  const intervalRef = useRef(null);
  const isTrackingRef = useRef(false);

  // Keep isTrackingRef in sync with state
  useEffect(() => {
    isTrackingRef.current = isTracking;
  }, [isTracking]);

  useEffect(() => {
    ensureAuth();
    loadLatestLocation();

    return () => {
      cleanup();
    };
  }, []);

  const cleanup = useCallback(() => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (mapInstance.current) {
      mapInstance.current.remove();
      mapInstance.current = null;
    }
  }, []);

  // Initialize map once
  useEffect(() => {
    if (!mapRef.current || mapInstance.current) return;

    const defaultCenter = [25.0053, 55.0760]; // Dubai warehouse default

    mapInstance.current = L.map(mapRef.current, {
      zoomControl: true,
      attributionControl: true
    }).setView(defaultCenter, 13);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19,
      minZoom: 10
    }).addTo(mapInstance.current);

    setMapReady(true);

    return () => {
      if (mapInstance.current) {
        mapInstance.current.remove();
        mapInstance.current = null;
        setMapReady(false);
      }
    };
  }, []);

  // Update map when location changes
  useEffect(() => {
    if (!mapInstance.current || !location || !mapReady) return;

    const { latitude, longitude } = location;

    // Remove old marker
    if (markerRef.current && mapInstance.current.hasLayer(markerRef.current)) {
      mapInstance.current.removeLayer(markerRef.current);
    }

    // Create custom icon with better styling
    const customIcon = L.divIcon({
      className: 'custom-marker',
      html: `<div style="
        background-color: #2563eb;
        width: 32px;
        height: 32px;
        border-radius: 50% 50% 50% 0;
        transform: rotate(-45deg);
        border: 3px solid white;
        box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        position: relative;
      ">
        <div style="
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%) rotate(45deg);
          width: 12px;
          height: 12px;
          background-color: white;
          border-radius: 50%;
        "></div>
      </div>`,
      iconSize: [32, 32],
      iconAnchor: [16, 32],
    });

    // Add new marker
    markerRef.current = L.marker([latitude, longitude], { icon: customIcon })
      .addTo(mapInstance.current)
      .bindPopup(`
        <div style="font-family: system-ui, -apple-system, sans-serif; font-size: 13px; min-width: 200px;">
          <div style="font-weight: 600; margin-bottom: 8px; color: #1f2937;">Your Current Location</div>
          <div style="margin-bottom: 4px;"><strong>Coordinates:</strong> ${latitude.toFixed(6)}, ${longitude.toFixed(6)}</div>
          <div style="margin-bottom: 4px;"><strong>Time:</strong> ${new Date(location.timestamp).toLocaleString()}</div>
          ${location.accuracy ? `<div style="margin-bottom: 4px;"><strong>Accuracy:</strong> ±${location.accuracy.toFixed(0)}m</div>` : ''}
          ${location.speed ? `<div><strong>Speed:</strong> ${(location.speed * 3.6).toFixed(1)} km/h</div>` : ''}
        </div>
      `);

    // Smoothly pan and zoom to location
    mapInstance.current.setView([latitude, longitude], 15, {
      animate: true,
      duration: 1.0
    });

    // Add location to history
    setLocationHistory(prev => {
      const newHistory = [...prev, location];
      return newHistory.slice(-50); // Keep last 50 locations
    });
  }, [location, mapReady]);

  const loadLatestLocation = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.get('/driver/me/live').catch(() => null);
      if (response && response.data) {
        setLocation({
          latitude: response.data.latitude,
          longitude: response.data.longitude,
          timestamp: response.data.recorded_at || new Date().toISOString(),
          accuracy: response.data.accuracy || null,
          speed: response.data.speed || null,
        });
      }
    } catch (e) {
      console.error('Error loading latest location:', e);
      setError('Failed to load latest location. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const sendLocationToServer = useCallback(async (locationData) => {
    try {
      await api.post('/driver/me/location', {
        latitude: locationData.latitude,
        longitude: locationData.longitude,
        heading: locationData.heading || null,
        speed: locationData.speed || null,
        accuracy: locationData.accuracy || null,
        recorded_at: locationData.timestamp
      });
    } catch (e) {
      console.error('Error sending location to server:', e);
      // Don't show error to user for background sync failures
    }
  }, []);

  const startTracking = useCallback(() => {
    if (!navigator.geolocation) {
      setError('Geolocation is not supported by your browser. Please use a modern browser.');
      return;
    }

    setError(null);
    setIsTracking(true);
    setLoading(true);

    const options = {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 0
    };

    // Watch position for real-time updates
    watchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
        const { latitude, longitude, accuracy, heading, speed } = position.coords;
        const newLocation = {
          latitude,
          longitude,
          accuracy: accuracy || null,
          heading: heading || null,
          speed: speed || null,
          timestamp: new Date().toISOString()
        };

        setLocation(newLocation);
        setLoading(false);
        sendLocationToServer(newLocation);
      },
      (err) => {
        console.error('Geolocation error:', err);
        let errorMessage = 'Location tracking error: ';
        switch (err.code) {
          case err.PERMISSION_DENIED:
            errorMessage += 'Permission denied. Please enable location access in your browser settings.';
            break;
          case err.POSITION_UNAVAILABLE:
            errorMessage += 'Location unavailable. Please check your device settings.';
            break;
          case err.TIMEOUT:
            errorMessage += 'Location request timed out. Please try again.';
            break;
          default:
            errorMessage += err.message;
        }
        setError(errorMessage);
        setIsTracking(false);
        setLoading(false);
      },
      options
    );

    // Periodic backup location sync every 30 seconds
    intervalRef.current = setInterval(() => {
      if (!isTrackingRef.current) {
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
        return;
      }

      navigator.geolocation.getCurrentPosition(
        async (position) => {
          const { latitude, longitude, accuracy, heading, speed } = position.coords;
          const locationData = {
            latitude,
            longitude,
            accuracy: accuracy || null,
            heading: heading || null,
            speed: speed || null,
            timestamp: new Date().toISOString()
          };
          sendLocationToServer(locationData);
        },
        (err) => console.error('Periodic location error:', err),
        options
      );
    }, 30000);
  }, [sendLocationToServer]);

  const stopTracking = useCallback(() => {
    cleanup();
    setIsTracking(false);
    setLoading(false);
  }, [cleanup]);

  const requestLocationPermission = () => {
    if (!navigator.geolocation) {
      setError('Geolocation is not supported by your browser');
      return;
    }

    setLoading(true);
    navigator.geolocation.getCurrentPosition(
      () => {
        setError(null);
        setLoading(false);
        startTracking();
      },
      (err) => {
        let errorMessage = 'Permission denied: ';
        switch (err.code) {
          case err.PERMISSION_DENIED:
            errorMessage += 'Please enable location services in your browser settings.';
            break;
          case err.POSITION_UNAVAILABLE:
            errorMessage += 'Location unavailable. Please check your device.';
            break;
          case err.TIMEOUT:
            errorMessage += 'Request timed out. Please try again.';
            break;
          default:
            errorMessage += err.message;
        }
        setError(errorMessage);
        setLoading(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  return (
    <div className="space-y-6">
      {/* Header Section */}
      <div className="bg-white rounded-lg shadow-sm p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl sm:text-4xl font-bold text-gray-900">Driver Portal</h1>
            <p className="text-sm sm:text-base text-gray-600 mt-2">Track your location and manage deliveries in real-time</p>
          </div>
          <div className="flex items-center gap-3">
            <div className={`flex items-center gap-2 px-4 py-2.5 rounded-lg shadow-sm transition-all ${
              isTracking 
                ? 'bg-green-50 text-green-700 border border-green-200' 
                : 'bg-gray-50 text-gray-600 border border-gray-200'
            }`}>
              <div className={`w-2.5 h-2.5 rounded-full transition-all ${
                isTracking ? 'bg-green-500 animate-pulse' : 'bg-gray-400'
              }`}></div>
              <span className="text-sm font-semibold">{isTracking ? 'Tracking Active' : 'Tracking Off'}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="bg-red-50 border-l-4 border-red-400 rounded-lg p-4 shadow-sm">
          <div className="flex items-start">
            <AlertCircle className="w-5 h-5 text-red-400 mt-0.5 mr-3 flex-shrink-0" />
            <div className="flex-1">
              <div className="text-red-800 font-semibold mb-1">Error</div>
              <div className="text-red-700 text-sm">{error}</div>
            </div>
          </div>
        </div>
      )}

      {/* Control Panel */}
      <div className="bg-white rounded-lg shadow-sm p-6">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">Location Controls</h2>
        <div className="flex flex-wrap gap-3">
          {!isTracking ? (
            <button
              onClick={requestLocationPermission}
              disabled={loading}
              className="px-6 py-3 bg-primary-600 text-white rounded-lg hover:bg-primary-700 active:bg-primary-800 disabled:bg-primary-300 disabled:cursor-not-allowed flex items-center gap-2 font-semibold shadow-sm transition-all transform hover:scale-105 active:scale-95"
            >
              <Navigation className="w-5 h-5" />
              {loading ? 'Starting...' : 'Start Tracking'}
            </button>
          ) : (
            <button
              onClick={stopTracking}
              className="px-6 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 active:bg-red-800 flex items-center gap-2 font-semibold shadow-sm transition-all transform hover:scale-105 active:scale-95"
            >
              <Activity className="w-5 h-5" />
              Stop Tracking
            </button>
          )}
          <button
            onClick={loadLatestLocation}
            disabled={loading}
            className="px-6 py-3 bg-gray-600 text-white rounded-lg hover:bg-gray-700 active:bg-gray-800 disabled:bg-gray-300 disabled:cursor-not-allowed flex items-center gap-2 font-semibold shadow-sm transition-all transform hover:scale-105 active:scale-95"
          >
            <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
            Refresh Location
          </button>
        </div>

        {/* Current Location Info */}
        {location && (
          <div className="mt-6 p-5 bg-gradient-to-br from-blue-50 to-indigo-50 rounded-lg border border-blue-100">
            <div className="flex items-center gap-2 mb-3">
              <CheckCircle2 className="w-5 h-5 text-green-600" />
              <h3 className="font-semibold text-gray-900">Current Location</h3>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
              <div className="bg-white rounded p-3 shadow-sm">
                <div className="text-gray-600 text-xs uppercase tracking-wide mb-1">Latitude</div>
                <div className="font-mono text-gray-900 font-semibold">{location.latitude.toFixed(6)}</div>
              </div>
              <div className="bg-white rounded p-3 shadow-sm">
                <div className="text-gray-600 text-xs uppercase tracking-wide mb-1">Longitude</div>
                <div className="font-mono text-gray-900 font-semibold">{location.longitude.toFixed(6)}</div>
              </div>
              {location.accuracy && (
                <div className="bg-white rounded p-3 shadow-sm">
                  <div className="text-gray-600 text-xs uppercase tracking-wide mb-1">Accuracy</div>
                  <div className="font-mono text-gray-900 font-semibold">±{location.accuracy.toFixed(0)}m</div>
                </div>
              )}
              <div className="bg-white rounded p-3 shadow-sm">
                <div className="text-gray-600 text-xs uppercase tracking-wide mb-1">Last Update</div>
                <div className="font-mono text-gray-900 font-semibold">{new Date(location.timestamp).toLocaleTimeString()}</div>
              </div>
              {location.speed && (
                <div className="bg-white rounded p-3 shadow-sm">
                  <div className="text-gray-600 text-xs uppercase tracking-wide mb-1">Speed</div>
                  <div className="font-mono text-gray-900 font-semibold">{(location.speed * 3.6).toFixed(1)} km/h</div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Map */}
      <div className="bg-white rounded-lg shadow-sm overflow-hidden">
        <div className="p-4 bg-gradient-to-r from-gray-50 to-gray-100 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <MapPin className="w-5 h-5 text-primary-600" />
            <h2 className="text-xl font-semibold text-gray-900">Location Map</h2>
          </div>
        </div>
        <div className="relative">
          <div 
            ref={mapRef} 
            className="h-[500px] sm:h-[600px] w-full bg-gray-100"
            style={{ minHeight: '400px' }}
          />
          {!location && mapReady && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-50 bg-opacity-90 z-[1000]">
              <div className="text-center p-6 bg-white rounded-lg shadow-lg border border-gray-200 max-w-sm mx-4">
                <MapPin className="w-12 h-12 text-gray-400 mx-auto mb-3" />
                <p className="text-gray-700 font-medium mb-1">No location data available</p>
                <p className="text-sm text-gray-500">Click "Start Tracking" to begin location tracking</p>
              </div>
            </div>
          )}
          {!mapReady && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-50">
              <div className="text-center">
                <RefreshCw className="w-8 h-8 text-gray-400 mx-auto mb-2 animate-spin" />
                <p className="text-gray-600">Loading map...</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Location History */}
      {locationHistory.length > 0 && (
        <div className="bg-white rounded-lg shadow-sm p-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">
            Recent Locations ({locationHistory.length})
          </h2>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Time</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Coordinates</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Accuracy</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Speed</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {locationHistory.slice(-10).reverse().map((loc, index) => (
                  <tr key={index} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-700">
                      {new Date(loc.timestamp).toLocaleTimeString()}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm font-mono text-gray-900">
                      {loc.latitude.toFixed(6)}, {loc.longitude.toFixed(6)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-600">
                      {loc.accuracy ? `±${loc.accuracy.toFixed(0)}m` : 'N/A'}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-600">
                      {loc.speed ? `${(loc.speed * 3.6).toFixed(1)} km/h` : 'N/A'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
