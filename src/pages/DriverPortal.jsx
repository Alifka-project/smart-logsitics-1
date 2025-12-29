import React, { useEffect, useState, useRef } from 'react';
import api, { setAuthToken } from '../frontend/apiClient';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { MapPin, Navigation, Activity, Upload } from 'lucide-react';

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
  const [status, setStatus] = useState('offline');
  const mapRef = useRef(null);
  const mapInstance = useRef(null);
  const markerRef = useRef(null);
  const watchIdRef = useRef(null);

  useEffect(() => {
    ensureAuth();
    loadLatestLocation();

    return () => {
      if (watchIdRef.current) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
      if (mapInstance.current) {
        mapInstance.current.remove();
      }
    };
  }, []);

  useEffect(() => {
    if (!mapRef.current) return;

    // Initialize map
    if (mapInstance.current) {
      mapInstance.current.remove();
    }

    const center = location 
      ? [location.latitude, location.longitude]
      : [25.0053, 55.0760]; // Default to Dubai warehouse

    mapInstance.current = L.map(mapRef.current).setView(center, 13);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19,
      minZoom: 10
    }).addTo(mapInstance.current);

    return () => {
      if (mapInstance.current) {
        mapInstance.current.remove();
        mapInstance.current = null;
      }
    };
  }, []);

  // Update map when location changes
  useEffect(() => {
    if (!mapInstance.current || !location) return;

    const { latitude, longitude } = location;

    // Remove old marker
    if (markerRef.current && mapInstance.current.hasLayer(markerRef.current)) {
      mapInstance.current.removeLayer(markerRef.current);
    }

    // Add new marker
    markerRef.current = L.marker([latitude, longitude], {
      icon: L.icon({
        iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-blue.png',
        shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
        iconSize: [25, 41],
        iconAnchor: [12, 41],
      }),
    })
      .addTo(mapInstance.current)
      .bindPopup(`
        <div style="font-family: Arial; font-size: 12px;">
          <b>Your Location</b><br>
          <strong>Coordinates:</strong> ${latitude.toFixed(4)}, ${longitude.toFixed(4)}<br>
          <strong>Time:</strong> ${new Date(location.timestamp).toLocaleTimeString()}<br>
          ${location.accuracy ? `<strong>Accuracy:</strong> ±${location.accuracy.toFixed(0)}m<br>` : ''}
          ${location.speed ? `<strong>Speed:</strong> ${(location.speed * 3.6).toFixed(1)} km/h<br>` : ''}
        </div>
      `);

    // Center map on location
    mapInstance.current.setView([latitude, longitude], 15);

    // Add location to history
    setLocationHistory(prev => {
      const newHistory = [...prev, location];
      return newHistory.slice(-50); // Keep last 50 locations
    });
  }, [location]);

  const loadLatestLocation = async () => {
    try {
      const r = await api.get('/driver/me/live').catch(() => null);
      if (r && r.data) {
        setLocation({
          latitude: r.data.latitude,
          longitude: r.data.longitude,
          timestamp: r.data.recorded_at || new Date().toISOString(),
        });
      }
    } catch (e) {
      console.error('Error loading latest location:', e);
    }
  };

  const startTracking = () => {
    if (!navigator.geolocation) {
      setError('Geolocation is not supported by your browser');
      return;
    }

    setError(null);
    setIsTracking(true);
    setStatus('online');

    const options = {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0
    };

    watchIdRef.current = navigator.geolocation.watchPosition(
      async (position) => {
        const { latitude, longitude, accuracy, heading, speed } = position.coords;
        const newLocation = {
          latitude,
          longitude,
          accuracy,
          heading: heading || null,
          speed: speed || null,
          timestamp: new Date().toISOString()
        };

        setLocation(newLocation);

        // Send location to server
        try {
          await api.post('/driver/me/location', {
            latitude,
            longitude,
            heading,
            speed,
            accuracy,
            recorded_at: newLocation.timestamp
          });
        } catch (e) {
          console.error('Error sending location to server:', e);
        }
      },
      (err) => {
        console.error('Geolocation error:', err);
        setError(`Location error: ${err.message}`);
        setIsTracking(false);
        setStatus('error');
      },
      options
    );

    // Also send location every 30 seconds if tracking
    const intervalId = setInterval(async () => {
      if (!isTracking) {
        clearInterval(intervalId);
        return;
      }

      navigator.geolocation.getCurrentPosition(
        async (position) => {
          const { latitude, longitude, accuracy, heading, speed } = position.coords;
          try {
            await api.post('/driver/me/location', {
              latitude,
              longitude,
              heading,
              speed,
              accuracy,
              recorded_at: new Date().toISOString()
            });
          } catch (e) {
            console.error('Error sending periodic location:', e);
          }
        },
        (err) => console.error('Periodic location error:', err),
        options
      );
    }, 30000);

    return () => clearInterval(intervalId);
  };

  const stopTracking = () => {
    if (watchIdRef.current) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    setIsTracking(false);
    setStatus('offline');
  };

  const requestLocationPermission = () => {
    if (!navigator.geolocation) {
      setError('Geolocation is not supported by your browser');
      return;
    }

    navigator.geolocation.getCurrentPosition(
      () => {
        setError(null);
        startTracking();
      },
      (err) => {
        setError(`Permission denied: ${err.message}. Please enable location services in your browser settings.`);
      },
      { enableHighAccuracy: true }
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-800">Driver Portal</h1>
          <p className="text-sm text-gray-500 mt-1">Track your location and manage deliveries</p>
        </div>
        <div className="flex items-center gap-3">
          <div className={`flex items-center gap-2 px-4 py-2 rounded-lg ${
            isTracking 
              ? 'bg-green-100 text-green-800' 
              : 'bg-gray-100 text-gray-600'
          }`}>
            <div className={`w-3 h-3 rounded-full ${
              isTracking ? 'bg-green-500 animate-pulse' : 'bg-gray-400'
            }`}></div>
            <span className="text-sm font-medium">{isTracking ? 'Tracking Active' : 'Tracking Off'}</span>
          </div>
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <div className="text-red-600 font-semibold">Error</div>
          <div className="text-red-500 text-sm mt-1">{error}</div>
        </div>
      )}

      {/* Control Panel */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold mb-4">Location Tracking</h2>
        <div className="flex flex-wrap gap-4">
          {!isTracking ? (
            <button
              onClick={requestLocationPermission}
              className="px-6 py-3 bg-primary-600 text-white rounded-lg hover:bg-primary-700 flex items-center gap-2"
            >
              <Navigation className="w-5 h-5" />
              Start Tracking
            </button>
          ) : (
            <button
              onClick={stopTracking}
              className="px-6 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 flex items-center gap-2"
            >
              <Activity className="w-5 h-5" />
              Stop Tracking
            </button>
          )}
          <button
            onClick={loadLatestLocation}
            className="px-6 py-3 bg-gray-600 text-white rounded-lg hover:bg-gray-700 flex items-center gap-2"
          >
            <MapPin className="w-5 h-5" />
            Refresh Location
          </button>
        </div>

        {/* Current Location Info */}
        {location && (
          <div className="mt-6 p-4 bg-gray-50 rounded-lg">
            <h3 className="font-semibold mb-2">Current Location</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <div className="text-gray-600">Latitude</div>
                <div className="font-mono">{location.latitude.toFixed(6)}</div>
              </div>
              <div>
                <div className="text-gray-600">Longitude</div>
                <div className="font-mono">{location.longitude.toFixed(6)}</div>
              </div>
              {location.accuracy && (
                <div>
                  <div className="text-gray-600">Accuracy</div>
                  <div className="font-mono">±{location.accuracy.toFixed(0)}m</div>
                </div>
              )}
              <div>
                <div className="text-gray-600">Last Update</div>
                <div className="font-mono">{new Date(location.timestamp).toLocaleTimeString()}</div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Map */}
      <div className="bg-white rounded-lg shadow-lg overflow-hidden">
        <div className="p-4 bg-gray-50 border-b">
          <h2 className="text-lg font-semibold">Location Map</h2>
        </div>
        <div 
          ref={mapRef} 
          className="h-[500px] w-full bg-gray-100"
        />
        {!location && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-100 bg-opacity-75">
            <div className="text-center">
              <MapPin className="w-12 h-12 text-gray-400 mx-auto mb-2" />
              <p className="text-gray-600">No location data available</p>
              <p className="text-sm text-gray-500 mt-1">Click "Start Tracking" to begin</p>
            </div>
          </div>
        )}
      </div>

      {/* Location History */}
      {locationHistory.length > 0 && (
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold mb-4">Recent Locations ({locationHistory.length})</h2>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Time</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Coordinates</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Accuracy</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Speed</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {locationHistory.slice(-10).reverse().map((loc, index) => (
                  <tr key={index}>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                      {new Date(loc.timestamp).toLocaleTimeString()}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm font-mono text-gray-900">
                      {loc.latitude.toFixed(6)}, {loc.longitude.toFixed(6)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                      {loc.accuracy ? `±${loc.accuracy.toFixed(0)}m` : 'N/A'}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
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
