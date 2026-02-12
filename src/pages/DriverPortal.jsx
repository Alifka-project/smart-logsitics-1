import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import api, { setAuthToken } from '../frontend/apiClient';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { calculateRouteWithOSRM } from '../services/osrmRoutingService';
import { calculateDistance } from '../utils/distanceCalculator';
import { 
  MapPin, Navigation, Activity, RefreshCw, AlertCircle, CheckCircle2, 
  MessageSquare, Truck, Bell, Paperclip, Send, Clock, MapPinIcon
} from 'lucide-react';

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

const WAREHOUSE_LOCATION = { lat: 25.0053, lng: 55.0760 };

export default function DriverPortal() {
  const routeLocation = useLocation();
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

  // Tab management
  const [activeTab, setActiveTab] = useState('tracking');

  // Delivery state
  const [deliveries, setDeliveries] = useState([]);
  const [loadingDeliveries, setLoadingDeliveries] = useState(false);

  // Messaging state
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [sendingMessage, setSendingMessage] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);

  // Routing state
  const [route, setRoute] = useState(null);
  const [orderedDeliveries, setOrderedDeliveries] = useState([]);
  const [isRouteLoading, setIsRouteLoading] = useState(false);
  const [routeError, setRouteError] = useState(null);

  // Notification state
  const [notifications, setNotifications] = useState(0);
  
  // Refs for auto-scroll and polling
  const messagesEndRef = useRef(null);
  const messagePollingIntervalRef = useRef(null);
  const routeLayersRef = useRef([]);
  const deliveryMarkersRef = useRef([]);
  const lastRouteOriginRef = useRef(null);
  const lastRouteDeliveriesRef = useRef('');

  const scrollMessagesToBottom = useCallback((behavior = 'smooth') => {
    if (!messagesEndRef.current) return;
    requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({ behavior, block: 'end' });
    });
  }, []);

  const formatMessageTimestamp = (value) => {
    if (!value) return 'Unknown time';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Unknown time';
    return date.toLocaleString('en-GB', {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  };


  const normalizeDeliveryCoords = (delivery) => {
    const latRaw = delivery.lat ?? delivery.Lat ?? delivery.latitude ?? delivery.Latitude;
    const lngRaw = delivery.lng ?? delivery.Lng ?? delivery.longitude ?? delivery.Longitude;
    const lat = Number.parseFloat(latRaw);
    const lng = Number.parseFloat(lngRaw);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  };

  const buildNearestNeighborOrder = (items, start) => {
    const remaining = [...items];
    const ordered = [];
    let current = start;

    while (remaining.length > 0) {
      let bestIndex = 0;
      let bestDistance = Infinity;

      for (let i = 0; i < remaining.length; i += 1) {
        const coords = normalizeDeliveryCoords(remaining[i]);
        if (!coords) continue;
        const distance = calculateDistance(current.lat, current.lng, coords.lat, coords.lng);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestIndex = i;
        }
      }

      const next = remaining.splice(bestIndex, 1)[0];
      ordered.push(next);
      const nextCoords = normalizeDeliveryCoords(next);
      if (nextCoords) current = nextCoords;
    }

    return ordered;
  };

  const formatEta = (eta) => {
    if (!eta) return 'N/A';
    const date = new Date(eta);
    if (Number.isNaN(date.getTime())) return 'N/A';
    return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  };

  // Keep isTrackingRef in sync with state
  useEffect(() => {
    isTrackingRef.current = isTracking;
  }, [isTracking]);

  useEffect(() => {
    ensureAuth();
    loadLatestLocation();
    loadDeliveries();
    loadMessages();
    
    // Poll for notifications every 10 seconds
    const notificationInterval = setInterval(() => {
      loadNotificationCount();
    }, 10000);

    return () => {
      cleanup();
      clearInterval(notificationInterval);
    };
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(routeLocation.search);
    const tab = params.get('tab');
    if (tab && ['tracking', 'deliveries', 'messages'].includes(tab)) {
      setActiveTab(tab);
    }
  }, [routeLocation.search]);

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
        <div style="font-family: 'Montserrat', 'Avenir', -apple-system, sans-serif; font-size: 13px; min-width: 200px;">
          <div style="font-weight: 600; margin-bottom: 8px; color: #1f2937;">Your Current Location</div>
          <div style="margin-bottom: 4px;"><strong>Coordinates:</strong> ${latitude.toFixed(6)}, ${longitude.toFixed(6)}</div>
          <div style="margin-bottom: 4px;"><strong>Time:</strong> ${new Date(location.timestamp).toLocaleString()}</div>
          ${location.accuracy ? `<div style="margin-bottom: 4px;"><strong>Accuracy:</strong> ±${location.accuracy.toFixed(0)}m</div>` : ''}
          ${location.speed ? `<div><strong>Speed:</strong> ${(location.speed * 3.6).toFixed(1)} km/h</div>` : ''}
        </div>
      `);

    // Smoothly pan and zoom to location unless routing is active
    if (!route?.coordinates?.length) {
      mapInstance.current.setView([latitude, longitude], 15, {
        animate: true,
        duration: 1.0
      });
    }

    // Add location to history
    setLocationHistory(prev => {
      const newHistory = [...prev, location];
      return newHistory.slice(-50); // Keep last 50 locations
    });
  }, [location, mapReady, route]);

  useEffect(() => {
    if (!mapInstance.current || !mapReady) return;

    deliveryMarkersRef.current.forEach((marker) => {
      if (mapInstance.current.hasLayer(marker)) {
        mapInstance.current.removeLayer(marker);
      }
    });
    deliveryMarkersRef.current = [];

    const list = orderedDeliveries.length > 0 ? orderedDeliveries : deliveries;
    list.forEach((delivery, index) => {
      const coords = normalizeDeliveryCoords(delivery);
      if (!coords) return;

      const marker = L.marker([coords.lat, coords.lng], {
        title: `Stop ${index + 1}: ${delivery.customer || 'Delivery'}`
      })
        .addTo(mapInstance.current)
        .bindPopup(
          `<div style="font-family: 'Montserrat', 'Avenir', -apple-system, sans-serif; font-size: 12px;">
            <strong>Stop ${index + 1}</strong><br />
            <strong>Customer:</strong> ${delivery.customer || 'N/A'}<br />
            <strong>Address:</strong> ${delivery.address || 'N/A'}<br />
            <strong>ETA:</strong> ${formatEta(delivery.eta || delivery.estimatedEta)}
          </div>`,
          { maxWidth: 260 }
        );

      deliveryMarkersRef.current.push(marker);
    });
  }, [deliveries, orderedDeliveries, mapReady]);

  useEffect(() => {
    if (!mapInstance.current || !mapReady) return;

    routeLayersRef.current.forEach((layer) => {
      if (mapInstance.current.hasLayer(layer)) {
        mapInstance.current.removeLayer(layer);
      }
    });
    routeLayersRef.current = [];

    if (!route?.coordinates?.length) return;

    const routeLine = L.polyline(route.coordinates, {
      color: '#3b82f6',
      weight: 5,
      opacity: 0.85,
      lineCap: 'round',
      lineJoin: 'round'
    }).addTo(mapInstance.current);

    routeLayersRef.current.push(routeLine);

    try {
      const bounds = routeLine.getBounds();
      if (bounds.isValid()) {
        mapInstance.current.fitBounds(bounds, { padding: [50, 50], maxZoom: 15 });
      }
    } catch (e) {
      console.warn('Unable to fit route bounds:', e);
    }
  }, [route, mapReady]);
  
  // Auto-refresh messages when on messages tab
  useEffect(() => {
    if (activeTab === 'messages') {
      loadMessages(true);
      // Start auto-refresh every 3 seconds for real-time updates
      messagePollingIntervalRef.current = setInterval(() => {
        loadMessages(true);
      }, 3000);
    }
    
    // Cleanup interval when tab changes or component unmounts
    return () => {
      if (messagePollingIntervalRef.current) {
        clearInterval(messagePollingIntervalRef.current);
        messagePollingIntervalRef.current = null;
      }
    };
  }, [activeTab]);
  
  // Auto-scroll to bottom when messages change or tab becomes active
  useEffect(() => {
    if (activeTab !== 'messages') return;
    scrollMessagesToBottom('smooth');
  }, [messages, activeTab, scrollMessagesToBottom]);

  useEffect(() => {
    if (deliveries.length === 0) {
      setRoute(null);
      setOrderedDeliveries([]);
      return;
    }

    const origin = location
      ? { lat: location.latitude, lng: location.longitude }
      : WAREHOUSE_LOCATION;

    const deliverySignature = deliveries.map(d => d.id).join('|');
    const originMovedKm = lastRouteOriginRef.current
      ? calculateDistance(origin.lat, origin.lng, lastRouteOriginRef.current.lat, lastRouteOriginRef.current.lng)
      : Infinity;
    const deliveriesChanged = deliverySignature !== lastRouteDeliveriesRef.current;

    if (!deliveriesChanged && originMovedKm < 0.25 && route) {
      return;
    }

    const withCoords = deliveries.filter(d => normalizeDeliveryCoords(d));
    const withoutCoords = deliveries.filter(d => !normalizeDeliveryCoords(d));
    const orderedWithCoords = buildNearestNeighborOrder(withCoords, origin);
    const routeLocations = [origin, ...orderedWithCoords.map(d => normalizeDeliveryCoords(d))];

    if (routeLocations.length < 2) {
      setRoute(null);
      setOrderedDeliveries([...orderedWithCoords, ...withoutCoords]);
      return;
    }

    setIsRouteLoading(true);
    setRouteError(null);

    calculateRouteWithOSRM(routeLocations)
      .then((routeData) => {
        setRoute(routeData);
        const legs = routeData.legs || [];
        let cumulativeSeconds = 0;
        const baseTime = Date.now();

        const enriched = orderedWithCoords.map((delivery, index) => {
          cumulativeSeconds += legs[index]?.duration || 0;
          const computedEta = new Date(baseTime + cumulativeSeconds * 1000).toISOString();
          return {
            ...delivery,
            routeIndex: index + 1,
            estimatedEta: delivery.eta || computedEta
          };
        });

        const trailing = withoutCoords.map((delivery, index) => ({
          ...delivery,
          routeIndex: enriched.length + index + 1,
          estimatedEta: delivery.eta || null
        }));

        setOrderedDeliveries([...enriched, ...trailing]);
        lastRouteOriginRef.current = origin;
        lastRouteDeliveriesRef.current = deliverySignature;
      })
      .catch((error) => {
        console.error('Failed to calculate driver route:', error);
        setRoute(null);
        setRouteError('Routing unavailable');
        setOrderedDeliveries([...orderedWithCoords, ...withoutCoords]);
      })
      .finally(() => {
        setIsRouteLoading(false);
      });
  }, [deliveries, location, route]);

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

  const loadDeliveries = async () => {
    setLoadingDeliveries(true);
    try {
      // Driver gets their assigned deliveries
      const response = await api.get('/driver/deliveries');
      setDeliveries(response.data?.deliveries || []);
      console.log(`✓ Loaded ${response.data?.deliveries?.length || 0} deliveries`);
    } catch (error) {
      console.error('Failed to load deliveries:', error);
      setDeliveries([]);
    } finally {
      setLoadingDeliveries(false);
    }
  };

  const loadMessages = async (silent = false) => {
    if (!silent) setLoadingMessages(true);
    try {
      const response = await api.get('/messages/driver');
      setMessages(response.data?.messages || []);
      if (!silent) console.log(`✓ Loaded ${response.data?.messages?.length || 0} messages`);
    } catch (error) {
      if (!silent) console.error('Failed to load messages:', error);
      setMessages([]);
    } finally {
      if (!silent) setLoadingMessages(false);
    }
  };

  const loadNotificationCount = async () => {
    try {
      const response = await api.get('/messages/driver/notifications/count');
      setNotifications(response.data?.count || 0);
    } catch (error) {
      console.error('Failed to load notification count:', error);
    }
  };

  const handleSendMessage = async () => {
    if (!newMessage.trim()) return;

    const messageText = newMessage.trim();
    setSendingMessage(true);

    try {
      const response = await api.post('/messages/driver/send', {
        content: messageText
      });

      if (response.data?.message) {
        setMessages(prev => [...prev, {
          ...response.data.message,
          from: 'driver',
          senderRole: 'driver',
          text: response.data.message.content
        }]);
        console.log('✓ Message sent successfully');
      }

      setNewMessage('');
    } catch (error) {
      console.error('Failed to send message:', error);
      alert(`Failed to send message: ${error.response?.data?.error || error.message}`);
    } finally {
      setSendingMessage(false);
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

  const deliveryRows = orderedDeliveries.length > 0 ? orderedDeliveries : deliveries;
  const hasRoute = !!route?.coordinates?.length;

  return (
    <div className="space-y-6">
      {/* Header Section */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl sm:text-4xl font-bold text-gray-900 dark:text-gray-100">Driver Portal</h1>
            <p className="text-sm sm:text-base text-gray-600 dark:text-gray-300 mt-2">Track your location and manage deliveries in real-time</p>
          </div>
          <div className="flex items-center gap-3">
            <div className={`flex items-center gap-2 px-4 py-2.5 rounded-lg shadow-sm transition-all ${
              isTracking 
                ? 'bg-green-50 text-green-700 border border-green-200 dark:bg-green-900/20 dark:text-green-300 dark:border-green-800'
                : 'bg-gray-50 text-gray-600 border border-gray-200 dark:bg-gray-700 dark:text-gray-200 dark:border-gray-600'
            }`}>
              <div className={`w-2.5 h-2.5 rounded-full transition-all ${
                isTracking ? 'bg-green-500 animate-pulse' : 'bg-gray-400 dark:bg-gray-500'
              }`}></div>
              <span className="text-sm font-semibold">{isTracking ? 'Tracking Active' : 'Tracking Off'}</span>
            </div>
            {notifications > 0 && (
              <div className="flex items-center gap-2 px-3 py-2 bg-red-50 text-red-700 rounded-lg border border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-800">
                <Bell className="w-4 h-4" />
                <span className="text-sm font-semibold">{notifications}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="border-b border-gray-200 dark:border-gray-700">
        <nav className="flex space-x-8">
          {[
            { id: 'tracking', label: 'Tracking', icon: Navigation },
            { id: 'deliveries', label: 'Deliveries', icon: Truck },
            { id: 'messages', label: 'Messages', icon: MessageSquare }
          ].map(tab => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`
                  flex items-center gap-2 py-4 px-1 border-b-2 font-medium text-sm
                  ${activeTab === tab.id
                    ? 'border-primary-600 text-primary-600 dark:text-primary-400'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-300 dark:hover:text-gray-100 dark:hover:border-gray-600'
                  }
                `}
              >
                <Icon className="w-5 h-5" />
                {tab.label}
                {tab.id === 'messages' && notifications > 0 && (
                  <span className="ml-2 bg-red-500 text-white text-xs rounded-full px-2 py-0.5">
                    {notifications}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Tracking Tab */}
      {activeTab === 'tracking' && (
        <div className="space-y-6">
          {/* Error Message */}
          {error && (
            <div className="bg-red-50 border-l-4 border-red-400 rounded-lg p-4 shadow-sm dark:bg-red-900/20 dark:border-red-600">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-300 mt-0.5 flex-shrink-0" />
                <div>
                  <div className="text-red-800 dark:text-red-200 font-semibold mb-1">Error</div>
                  <div className="text-red-700 dark:text-red-300 text-sm">{error}</div>
                </div>
              </div>
            </div>
          )}

      {/* Control Panel */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-6">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-4">Location Controls</h2>
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
            className="px-6 py-3 bg-gray-600 text-white rounded-lg hover:bg-gray-700 active:bg-gray-800 disabled:bg-gray-300 disabled:cursor-not-allowed flex items-center gap-2 font-semibold shadow-sm transition-all transform hover:scale-105 active:scale-95 dark:bg-gray-700 dark:hover:bg-gray-600 dark:active:bg-gray-700"
          >
            <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
            Refresh Location
          </button>
        </div>

        {/* Current Location Info */}
        {location && (
          <div className="mt-6 p-5 bg-gradient-to-br from-blue-50 to-indigo-50 rounded-lg border border-blue-100 dark:from-blue-900/30 dark:to-indigo-900/30 dark:border-blue-800">
            <div className="flex items-center gap-2 mb-3">
              <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400" />
              <h3 className="font-semibold text-gray-900 dark:text-gray-100">Current Location</h3>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
              <div className="bg-white dark:bg-gray-800 rounded p-3 shadow-sm">
                <div className="text-gray-600 dark:text-gray-400 text-xs uppercase tracking-wide mb-1">Latitude</div>
                <div className="font-mono text-gray-900 dark:text-gray-100 font-semibold">{location.latitude.toFixed(6)}</div>
              </div>
              <div className="bg-white dark:bg-gray-800 rounded p-3 shadow-sm">
                <div className="text-gray-600 dark:text-gray-400 text-xs uppercase tracking-wide mb-1">Longitude</div>
                <div className="font-mono text-gray-900 dark:text-gray-100 font-semibold">{location.longitude.toFixed(6)}</div>
              </div>
              {location.accuracy && (
                <div className="bg-white dark:bg-gray-800 rounded p-3 shadow-sm">
                  <div className="text-gray-600 dark:text-gray-400 text-xs uppercase tracking-wide mb-1">Accuracy</div>
                  <div className="font-mono text-gray-900 dark:text-gray-100 font-semibold">±{location.accuracy.toFixed(0)}m</div>
                </div>
              )}
              <div className="bg-white dark:bg-gray-800 rounded p-3 shadow-sm">
                <div className="text-gray-600 dark:text-gray-400 text-xs uppercase tracking-wide mb-1">Last Update</div>
                <div className="font-mono text-gray-900 dark:text-gray-100 font-semibold">{new Date(location.timestamp).toLocaleTimeString()}</div>
              </div>
              {location.speed && (
                <div className="bg-white dark:bg-gray-800 rounded p-3 shadow-sm">
                  <div className="text-gray-600 dark:text-gray-400 text-xs uppercase tracking-wide mb-1">Speed</div>
                  <div className="font-mono text-gray-900 dark:text-gray-100 font-semibold">{(location.speed * 3.6).toFixed(1)} km/h</div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Map */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm overflow-hidden">
        <div className="p-4 bg-gradient-to-r from-gray-50 to-gray-100 border-b border-gray-200 dark:from-gray-800 dark:to-gray-900 dark:border-gray-700">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
            <MapPin className="w-5 h-5 text-primary-600 dark:text-primary-400" />
            <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Location Map</h2>
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-300">
              {isRouteLoading && 'Routing...'}
              {!isRouteLoading && routeError && routeError}
              {!isRouteLoading && !routeError && hasRoute && 'Route updated'}
            </div>
          </div>
        </div>
        <div className="relative">
          <div 
            ref={mapRef} 
            className="h-[500px] sm:h-[600px] w-full bg-gray-100 dark:bg-gray-900"
            style={{ minHeight: '400px' }}
          />
          {!location && mapReady && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-50 bg-opacity-90 z-[1000] dark:bg-gray-900/80">
              <div className="text-center p-6 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 max-w-sm mx-4">
                <MapPin className="w-12 h-12 text-gray-400 dark:text-gray-500 mx-auto mb-3" />
                <p className="text-gray-700 dark:text-gray-200 font-medium mb-1">No location data available</p>
                <p className="text-sm text-gray-500 dark:text-gray-400">Click "Start Tracking" to begin location tracking</p>
              </div>
            </div>
          )}
          {!mapReady && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-50 dark:bg-gray-900">
              <div className="text-center">
                <RefreshCw className="w-8 h-8 text-gray-400 dark:text-gray-500 mx-auto mb-2 animate-spin" />
                <p className="text-gray-600 dark:text-gray-300">Loading map...</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Location History */}
      {locationHistory.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-6">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-4">
            Recent Locations ({locationHistory.length})
          </h2>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
              <thead className="bg-gray-50 dark:bg-gray-900/40">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Time</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Coordinates</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Accuracy</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Speed</th>
                </tr>
              </thead>
              <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                {locationHistory.slice(-10).reverse().map((loc, index) => (
                  <tr key={index} className="hover:bg-gray-50 dark:hover:bg-gray-700/40 transition-colors">
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-700 dark:text-gray-200">
                      {new Date(loc.timestamp).toLocaleTimeString()}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm font-mono text-gray-900 dark:text-gray-100">
                      {loc.latitude.toFixed(6)}, {loc.longitude.toFixed(6)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-600 dark:text-gray-300">
                      {loc.accuracy ? `±${loc.accuracy.toFixed(0)}m` : 'N/A'}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-600 dark:text-gray-300">
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
      )}

      {/* Deliveries Tab */}
      {activeTab === 'deliveries' && (
        <div className="space-y-6">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">My Deliveries</h2>
              <button
                onClick={loadDeliveries}
                disabled={loadingDeliveries}
                className="px-3 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 flex items-center gap-2 text-sm"
              >
                <RefreshCw className={`w-4 h-4 ${loadingDeliveries ? 'animate-spin' : ''}`} />
                Refresh
              </button>
            </div>

            {loadingDeliveries ? (
              <div className="flex justify-center py-8">
                <div className="text-center">
                  <RefreshCw className="w-8 h-8 animate-spin text-primary-600 mx-auto mb-2" />
                  <p className="text-gray-600 dark:text-gray-300">Loading deliveries...</p>
                </div>
              </div>
            ) : deliveryRows.length === 0 ? (
              <div className="text-center py-12 text-gray-500 dark:text-gray-300">
                <Truck className="w-12 h-12 mx-auto mb-2 opacity-50" />
                <p>No deliveries assigned yet</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                  <thead className="bg-gray-50 dark:bg-gray-900/40">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Stop</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">PO Number</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Customer</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Address</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Status</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">ETA</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Assigned</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                    {deliveryRows.map((delivery, index) => (
                      <tr key={delivery.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/40 transition-colors">
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600 dark:text-gray-300">
                          {delivery.routeIndex || index + 1}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-gray-100">
                          {delivery.poNumber || delivery.PONumber || 'N/A'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100">
                          {delivery.customer || 'Unknown'}
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-500 dark:text-gray-300 max-w-xs truncate">
                          {delivery.address || 'N/A'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm">
                          <span className={`px-2 py-1 rounded-full text-xs font-semibold ${
                            delivery.status === 'delivered' ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' :
                            delivery.status === 'out-for-delivery' || delivery.status === 'pending' ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300' :
                            'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200'
                          }`}>
                            {delivery.status || 'pending'}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600 dark:text-gray-300">
                          {formatEta(delivery.eta || delivery.estimatedEta)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-300">
                          {delivery.assignedAt ? new Date(delivery.assignedAt).toLocaleDateString() : 'N/A'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Messages Tab */}
      {activeTab === 'messages' && (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm overflow-hidden flex flex-col h-[calc(100vh-350px)]">
          <div className="p-4 bg-gray-50 dark:bg-gray-900/40 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Messages</h2>
            <button
              onClick={loadMessages}
              disabled={loadingMessages}
              className="px-3 py-1 bg-gray-200 text-gray-700 rounded hover:bg-gray-300 text-sm flex items-center gap-2 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
            >
              <RefreshCw className={`w-4 h-4 ${loadingMessages ? 'animate-spin' : ''}`} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50 dark:bg-gray-900/30">
            {loadingMessages ? (
              <div className="flex justify-center py-8">
                <div className="text-center text-gray-500 dark:text-gray-300">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto mb-2"></div>
                  <p>Loading messages...</p>
                </div>
              </div>
            ) : messages.length === 0 ? (
              <div className="text-center py-12 text-gray-500 dark:text-gray-300">
                <MessageSquare className="w-12 h-12 mx-auto mb-2 opacity-50" />
                <p>No messages yet</p>
                <p className="text-sm mt-1 text-gray-500 dark:text-gray-400">Check back for updates from admin</p>
              </div>
            ) : (
              messages.map((msg, idx) => {
                // Determine if message is from sender (other user) or driver (self)
                const isFromOther = msg.senderRole !== 'driver';
                
                const messageText = msg.text || msg.content || '';
                const messageTime = msg.timestamp || msg.createdAt;
                
                // Role badge configuration
                const getRoleBadge = (role) => {
                  const roleConfig = {
                    admin: { label: 'Admin', color: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300' },
                    delivery_team: { label: 'Delivery Team', color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' },
                    sales_ops: { label: 'Sales Ops', color: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300' },
                    manager: { label: 'Manager', color: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300' }
                  };
                  return roleConfig[role] || { label: role, color: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300' };
                };
                
                const roleBadge = getRoleBadge(msg.senderRole);
                
                return (
                  <div
                    key={idx}
                    className={`flex ${isFromOther ? 'justify-start' : 'justify-end'}`}
                  >
                    <div
                      className={`max-w-[70%] rounded-lg p-3 ${
                        isFromOther
                          ? 'bg-white text-gray-900 border border-gray-200 dark:bg-gray-800 dark:text-gray-100 dark:border-gray-700'
                          : 'bg-primary-600 text-white'
                      }`}
                    >
                      {isFromOther && (
                        <span className={`inline-block text-xs px-2 py-0.5 rounded-full font-medium mb-1 ${roleBadge.color}`}>
                          {roleBadge.label}
                        </span>
                      )}
                      <p className="text-sm">{messageText}</p>
                      <p className={`text-xs mt-1 ${isFromOther ? 'text-gray-500 dark:text-gray-400' : 'text-primary-100'}`}>
                        {formatMessageTimestamp(messageTime)}
                      </p>
                    </div>
                  </div>
                );
              })
            )}
            {/* Auto-scroll anchor */}
            <div ref={messagesEndRef} />
          </div>

          <div className="p-4 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700">
            <div className="flex gap-2">
              <input
                type="text"
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                onKeyPress={(e) => {
                  if (e.key === 'Enter' && newMessage.trim() && !sendingMessage) {
                    handleSendMessage();
                  }
                }}
                placeholder="Type a message..."
                disabled={sendingMessage}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-primary-500 focus:border-primary-500 disabled:opacity-50 dark:bg-gray-900 dark:text-gray-100 dark:border-gray-700"
              />
              <button
                onClick={handleSendMessage}
                disabled={!newMessage.trim() || sendingMessage}
                className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {sendingMessage ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                    Sending...
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4" />
                    Send
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
