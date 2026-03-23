import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import api, { setAuthToken } from '../frontend/apiClient';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { calculateRouteWithOSRM } from '../services/osrmRoutingService';
import DeliveryManagementPage from './DeliveryManagementPage';
import { calculateDistance } from '../utils/distanceCalculator';
import { 
  MapPin, Navigation, Activity, RefreshCw, AlertCircle, CheckCircle2, 
  MessageSquare, Truck, Bell, Paperclip, Send, Clock, MapPinIcon, Search
} from 'lucide-react';
import type { Delivery } from '../types';

// Fix Leaflet default marker icons
delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: '/leaflet-images/marker-icon-2x.png',
  iconUrl: '/leaflet-images/marker-icon.png',
  shadowUrl: '/leaflet-images/marker-shadow.png',
});

interface LocationData {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  heading: number | null;
  speed: number | null;
  timestamp: string;
}

interface DriverRouteData {
  coordinates?: [number, number][];
  legs?: unknown[];
  [key: string]: unknown;
}

interface ContactUser {
  id: string;
  username: string;
  fullName?: string | null;
  full_name?: string | null;
  role?: string;
  account?: {
    role?: string;
    lastLogin?: string | null;
  };
}

interface DriverMessage {
  id?: string;
  text?: string;
  content?: string;
  from?: string;
  senderRole?: string;
  timestamp?: string;
  createdAt?: string;
  attachmentUrl?: string;
  attachmentType?: string;
  attachmentName?: string;
  [key: string]: unknown;
}

type EnrichedDelivery = Delivery & {
  routeIndex?: number;
  estimatedEta?: string | null;
  eta?: string | null;
};

interface LatLng {
  lat: number;
  lng: number;
}

function ensureAuth(): void {
  const token = localStorage.getItem('auth_token');
  if (token) setAuthToken(token);
}

const WAREHOUSE_LOCATION: LatLng = { lat: 25.0053, lng: 55.0760 };

export default function DriverPortal() {
  const routeLocation = useLocation();
  const [location, setLocation] = useState<LocationData | null>(null);
  const [isTracking, setIsTracking] = useState<boolean>(false);
  const [locationHistory, setLocationHistory] = useState<LocationData[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [mapReady, setMapReady] = useState<boolean>(false);
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isTrackingRef = useRef<boolean>(false);

  // Tab management
  const [activeTab, setActiveTab] = useState<string>('tracking');

  // Delivery state
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [, setLoadingDeliveries] = useState<boolean>(false);

  // Messaging state
  const [messages, setMessages] = useState<DriverMessage[]>([]);
  const [newMessage, setNewMessage] = useState<string>('');
  const [sendingMessage, setSendingMessage] = useState<boolean>(false);
  const [loadingMessages, setLoadingMessages] = useState<boolean>(false);
  const [contacts, setContacts] = useState<ContactUser[]>([]);
  const [teamMembers, setTeamMembers] = useState<ContactUser[]>([]);
  const [selectedContact, setSelectedContact] = useState<ContactUser | null>(null);
  const [loadingContacts, setLoadingContacts] = useState<boolean>(false);
  const [attachmentPreview, setAttachmentPreview] = useState<{ url: string; type: string; name: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Routing state
  const [route, setRoute] = useState<DriverRouteData | null>(null);
  const [orderedDeliveries, setOrderedDeliveries] = useState<EnrichedDelivery[]>([]);
  const [isRouteLoading, setIsRouteLoading] = useState<boolean>(false);
  const [routeError, setRouteError] = useState<string | null>(null);

  // Notification state
  const [notifications, setNotifications] = useState<number>(0);
  
  // Refs for auto-scroll and polling
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const messagePollingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const routeLayersRef = useRef<L.Polyline[]>([]);
  const deliveryMarkersRef = useRef<L.Marker[]>([]);
  const lastRouteOriginRef = useRef<LatLng | null>(null);
  const lastRouteDeliveriesRef = useRef<string>('');

  const scrollMessagesToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    if (!messagesEndRef.current) return;
    requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({ behavior, block: 'end' });
    });
  }, []);

  const formatMessageTimestamp = (value: string | null | undefined): string => {
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

  const normalizeDeliveryCoords = (delivery: Delivery): LatLng | null => {
    const d = delivery as unknown as Record<string, unknown>;
    const latRaw = d['lat'] ?? d['Lat'] ?? d['latitude'] ?? d['Latitude'];
    const lngRaw = d['lng'] ?? d['Lng'] ?? d['longitude'] ?? d['Longitude'];
    const lat = Number.parseFloat(String(latRaw));
    const lng = Number.parseFloat(String(lngRaw));
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  };

  const buildNearestNeighborOrder = useCallback((items: Delivery[], start: LatLng): Delivery[] => {
    const remaining = [...items];
    const ordered: Delivery[] = [];
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
  }, []);

  const formatEta = (eta: string | null | undefined): string => {
    if (!eta) return 'N/A';
    const date = new Date(eta);
    if (Number.isNaN(date.getTime())) return 'N/A';
    return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  };

  const isContactOnline = (contact: ContactUser): boolean => {
    if (!contact?.account?.lastLogin) {
      return false;
    }
    
    const lastActive = new Date(contact.account.lastLogin);
    const now = new Date();
    const diffMinutes = (now.getTime() - lastActive.getTime()) / 1000 / 60;
    const isOnline = diffMinutes < 5; // Consider online if active within 5 minutes
    
    if (isOnline) {
      console.debug(`[Driver] Contact ${contact.fullName || contact.username} online (active ${diffMinutes.toFixed(1)}m ago)`);
    }
    
    return isOnline;
  };

  const clearTrackingWatchers = useCallback(() => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const cleanup = useCallback(() => {
    clearTrackingWatchers();
    if (mapInstance.current) {
      mapInstance.current.remove();
      mapInstance.current = null;
    }
  }, [clearTrackingWatchers]);

  // Keep isTrackingRef in sync with state
  useEffect(() => {
    isTrackingRef.current = isTracking;
  }, [isTracking]);

  useEffect(() => {
    ensureAuth();
    void loadLatestLocation();
    void loadDeliveries();
    void loadContacts(); // Load contacts first, then messages will be loaded when contact is selected
    const notificationInterval = setInterval(() => {
      if (!document.hidden) void loadNotificationCount();
    }, 60000); // 60s instead of 10s
    return () => {
      cleanup();
      clearInterval(notificationInterval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cleanup]);

  useEffect(() => {
    const params = new URLSearchParams(routeLocation.search);
    const tab = params.get('tab');
    if (tab && ['tracking', 'deliveries', 'messages'].includes(tab)) {
      setActiveTab(tab);
    }
  }, [routeLocation.search]);

  // Initialize map once
  useEffect(() => {
    if (!mapRef.current || mapInstance.current) return;

    const defaultCenter: [number, number] = [25.0053, 55.0760]; // Dubai warehouse default

    mapInstance.current = L.map(mapRef.current, {
      zoomControl: true,
      attributionControl: true
    }).setView(defaultCenter, 13);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19,
      minZoom: 10
    }).addTo(mapInstance.current);

    // Invalidate map size to ensure it fills container properly
    const invalidateMap = () => {
      if (mapInstance.current) {
        mapInstance.current.invalidateSize();
      }
    };
    
    // Invalidate after initial render
    setTimeout(invalidateMap, 100);
    setTimeout(invalidateMap, 500);

    // Handle window resize
    const handleResize = () => {
      invalidateMap();
    };
    window.addEventListener('resize', handleResize);

    setMapReady(true);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (mapInstance.current) {
        mapInstance.current.remove();
        mapInstance.current = null;
        setMapReady(false);
      }
    };
  }, []);

  // Invalidate map size when tracking tab becomes active
  useEffect(() => {
    if (activeTab === 'tracking' && mapInstance.current && mapReady) {
      setTimeout(() => {
        if (mapInstance.current) {
          mapInstance.current.invalidateSize();
        }
      }, 100);
    }
  }, [activeTab, mapReady]);

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
        <div style="font-family: 'DM Sans', 'Inter', -apple-system, sans-serif; font-size: 13px; min-width: 200px;">
          <div style="font-weight: 600; margin-bottom: 8px; color: #1f2937;">Your Current Location</div>
          <div style="margin-bottom: 4px;"><strong>Coordinates:</strong> ${latitude.toFixed(6)}, ${longitude.toFixed(6)}</div>
          <div style="margin-bottom: 4px;"><strong>Time:</strong> ${new Date(location.timestamp).toLocaleString()}</div>
          ${location.accuracy ? `<div style="margin-bottom: 4px;"><strong>Accuracy:</strong> ±${location.accuracy.toFixed(0)}m</div>` : ''}
          ${location.speed ? `<div><strong>Speed:</strong> ${(location.speed * 3.6).toFixed(1)} km/h</div>` : ''}
        </div>
      `);

    // Smoothly pan and zoom to location unless routing is active
    const routeData = route as DriverRouteData | null;
    if (!routeData?.coordinates?.length) {
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
      if (mapInstance.current!.hasLayer(marker)) {
        mapInstance.current!.removeLayer(marker);
      }
    });
    deliveryMarkersRef.current = [];

    const list: EnrichedDelivery[] = orderedDeliveries.length > 0
      ? orderedDeliveries
      : (deliveries as EnrichedDelivery[]);

    list.forEach((delivery, index) => {
      const coords = normalizeDeliveryCoords(delivery);
      if (!coords) return;

      const marker = L.marker([coords.lat, coords.lng], {
        title: `Stop ${index + 1}: ${delivery.customer || 'Delivery'}`
      })
        .addTo(mapInstance.current!)
        .bindPopup(
          `<div style="font-family: 'DM Sans', 'Inter', -apple-system, sans-serif; font-size: 12px;">
            <strong>Stop ${index + 1}</strong><br />
            <strong>Customer:</strong> ${delivery.customer || 'N/A'}<br />
            <strong>Address:</strong> ${delivery.address || 'N/A'}<br />
            <strong>ETA:</strong> ${formatEta(delivery.eta ?? delivery.estimatedEta)}
          </div>`,
          { maxWidth: 260 }
        );

      deliveryMarkersRef.current.push(marker);
    });
  }, [deliveries, orderedDeliveries, mapReady]);

  useEffect(() => {
    if (!mapInstance.current || !mapReady) return;

    routeLayersRef.current.forEach((layer) => {
      if (mapInstance.current!.hasLayer(layer)) {
        mapInstance.current!.removeLayer(layer);
      }
    });
    routeLayersRef.current = [];

    const routeData = route as DriverRouteData | null;
    if (!routeData?.coordinates?.length) return;

    const routeLine = L.polyline(routeData.coordinates as [number, number][], {
      color: '#3b82f6',
      weight: 5,
      opacity: 0.85,
      lineCap: 'round',
      lineJoin: 'round'
    }).addTo(mapInstance.current!);

    routeLayersRef.current.push(routeLine);

    try {
      const bounds = routeLine.getBounds();
      if (bounds.isValid()) {
        mapInstance.current!.fitBounds(bounds, { padding: [50, 50], maxZoom: 15 });
      }
    } catch (e) {
      console.warn('Unable to fit route bounds:', e);
    }
  }, [route, mapReady]);
  
  // Auto-refresh messages when on messages tab - 30s, pause when hidden
  useEffect(() => {
    if (activeTab === 'messages' && selectedContact) {
      void loadMessages(selectedContact.id, true);
      messagePollingIntervalRef.current = setInterval(() => {
        if (!document.hidden) void loadMessages(selectedContact.id, true);
      }, 30000); // 30s instead of 3s
    }
    
    // Cleanup interval when tab changes or component unmounts
    return () => {
      if (messagePollingIntervalRef.current) {
        clearInterval(messagePollingIntervalRef.current);
        messagePollingIntervalRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, selectedContact]);
  
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

    const origin: LatLng = location
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
    const routeLocations = [origin, ...orderedWithCoords.map(d => normalizeDeliveryCoords(d)!).filter(Boolean)];

    if (routeLocations.length < 2) {
      setRoute(null);
      setOrderedDeliveries([...orderedWithCoords, ...withoutCoords] as EnrichedDelivery[]);
      return;
    }

    setIsRouteLoading(true);
    setRouteError(null);

    calculateRouteWithOSRM(routeLocations)
      .then((routeData) => {
        setRoute(routeData as unknown as DriverRouteData);
        const legs = (routeData.legs || []) as Array<{ duration?: number }>;
        let cumulativeSeconds = 0;
        const baseTime = Date.now();

        const enriched: EnrichedDelivery[] = orderedWithCoords.map((delivery, index) => {
          cumulativeSeconds += legs[index]?.duration || 0;
          const computedEta = new Date(baseTime + cumulativeSeconds * 1000).toISOString();
          return {
            ...delivery,
            routeIndex: index + 1,
            estimatedEta: (delivery as EnrichedDelivery).eta || computedEta
          };
        });

        const trailing: EnrichedDelivery[] = withoutCoords.map((delivery, index) => ({
          ...delivery,
          routeIndex: enriched.length + index + 1,
          estimatedEta: (delivery as EnrichedDelivery).eta || null
        }));

        setOrderedDeliveries([...enriched, ...trailing]);
        lastRouteOriginRef.current = origin;
        lastRouteDeliveriesRef.current = deliverySignature;
      })
      .catch((routeErr: unknown) => {
        console.error('Failed to calculate driver route:', routeErr);
        setRoute(null);
        setRouteError('Routing unavailable');
        setOrderedDeliveries([...orderedWithCoords, ...withoutCoords] as EnrichedDelivery[]);
      })
      .finally(() => {
        setIsRouteLoading(false);
      });
  }, [deliveries, location, route, buildNearestNeighborOrder]);

  const loadLatestLocation = async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.get('/driver/me/live').catch(() => null);
      if (response && response.data) {
        setLocation({
          latitude: response.data.latitude as number,
          longitude: response.data.longitude as number,
          timestamp: (response.data.recorded_at as string) || new Date().toISOString(),
          accuracy: (response.data.accuracy as number | null) || null,
          speed: (response.data.speed as number | null) || null,
          heading: null,
        });
      }
    } catch (e: unknown) {
      console.error('Error loading latest location:', e);
      setError('Failed to load latest location. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const loadDeliveries = async (): Promise<void> => {
    setLoadingDeliveries(true);
    try {
      // Driver gets their assigned deliveries
      const response = await api.get('/driver/deliveries');
      setDeliveries((response.data?.deliveries as Delivery[]) || []);
      console.log(`✓ Loaded ${response.data?.deliveries?.length || 0} deliveries`);
    } catch (deliveryErr: unknown) {
      console.error('Failed to load deliveries:', deliveryErr);
      setDeliveries([]);
    } finally {
      setLoadingDeliveries(false);
    }
  };

  const loadContacts = async (): Promise<void> => {
    try {
      setLoadingContacts(true);
      const response = await api.get('/messages/contacts');
      const allContacts = (response.data?.contacts || []) as ContactUser[];
      // Separate team members (admin, delivery_team) from drivers
      const team = allContacts.filter(c => c.account?.role === 'admin' || c.account?.role === 'delivery_team');
      setTeamMembers(team);
      setContacts(allContacts);
      // Auto-select first contact if none selected
      if (!selectedContact && allContacts.length > 0) {
        setSelectedContact(allContacts[0]);
      }
    } catch (contactErr: unknown) {
      console.error('Failed to load contacts:', contactErr);
      setContacts([]);
      setTeamMembers([]);
    } finally {
      setLoadingContacts(false);
    }
  };

  const loadMessages = async (contactId: string | null = null, silent = false): Promise<void> => {
    const targetContactId = contactId || selectedContact?.id;
    if (!targetContactId) return;
    
    if (!silent) setLoadingMessages(true);
    try {
      const response = await api.get(`/messages/driver/${targetContactId}`);
      setMessages((response.data?.messages || []) as DriverMessage[]);
      if (!silent) console.log(`✓ Loaded ${response.data?.messages?.length || 0} messages`);
    } catch (msgErr: unknown) {
      if (!silent) console.error('Failed to load messages:', msgErr);
      setMessages([]);
    } finally {
      if (!silent) setLoadingMessages(false);
    }
  };

  const loadNotificationCount = async (): Promise<void> => {
    try {
      const response = await api.get('/messages/driver/notifications/count');
      setNotifications((response.data?.count as number) || 0);
    } catch (notifErr: unknown) {
      console.error('Failed to load notification count:', notifErr);
    }
  };

  const handleSendMessage = async (): Promise<void> => {
    if ((!newMessage.trim() && !attachmentPreview) || !selectedContact) return;

    const messageText = newMessage.trim();
    setSendingMessage(true);

    try {
      const payload: Record<string, string> = {
        recipientId: selectedContact.id
      };
      if (messageText) payload.content = messageText;
      if (attachmentPreview) {
        payload.attachmentUrl = attachmentPreview.url;
        payload.attachmentType = attachmentPreview.type;
        payload.attachmentName = attachmentPreview.name;
      }

      const response = await api.post('/messages/driver/send', payload);

      if (response.data?.message) {
        const apiMsg = response.data.message as DriverMessage;
        setMessages(prev => [...prev, {
          ...apiMsg,
          from: 'driver',
          senderRole: 'driver',
          text: apiMsg.content
        }]);
        console.log('✓ Message sent successfully');
      }

      setNewMessage('');
      setAttachmentPreview(null);
    } catch (sendErr: unknown) {
      const e = sendErr as { message?: string; response?: { data?: { error?: string } } };
      console.error('Failed to send message:', sendErr);
      alert(`Failed to send message: ${e.response?.data?.error || e.message}`);
    } finally {
      setSendingMessage(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0];
    if (!file) return;
    const MAX_SIZE = 5 * 1024 * 1024; // 5 MB
    if (file.size > MAX_SIZE) {
      alert('File is too large. Maximum size is 5 MB.');
      e.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setAttachmentPreview({
        url: reader.result as string,
        type: file.type,
        name: file.name
      });
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const sendLocationToServer = useCallback(async (locationData: LocationData): Promise<void> => {
    try {
      await api.post('/driver/me/location', {
        latitude: locationData.latitude,
        longitude: locationData.longitude,
        heading: locationData.heading || null,
        speed: locationData.speed || null,
        accuracy: locationData.accuracy || null,
        recorded_at: locationData.timestamp
      });
    } catch (e: unknown) {
      console.error('Error sending location to server:', e);
      // Don't show error to user for background sync failures
    }
  }, []);

  const startTracking = useCallback(() => {
    if (!navigator.geolocation) {
      setError('Geolocation is not supported by your browser. Please use a modern browser.');
      return;
    }

    clearTrackingWatchers();
    setError(null);
    setIsTracking(true);
    setLoading(true);

    // Balanced defaults: high-accuracy GPS can time out on desktop/indoors.
    const watchOptions: PositionOptions = {
      enableHighAccuracy: true,
      timeout: 30000,
      maximumAge: 10000
    };

    // Watch position for real-time updates
    watchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
        const { latitude, longitude, accuracy, heading, speed } = position.coords;
        const newLocation: LocationData = {
          latitude,
          longitude,
          accuracy: accuracy || null,
          heading: heading || null,
          speed: speed || null,
          timestamp: new Date().toISOString()
        };

        setLocation(newLocation);
        setLoading(false);
        void sendLocationToServer(newLocation);
      },
      (err: GeolocationPositionError) => {
        console.error('Geolocation error:', err);
        let errorMessage = 'Location tracking error: ';
        switch (err.code) {
          case err.PERMISSION_DENIED:
            errorMessage += 'Permission denied. Please enable location access in your browser settings.';
            setIsTracking(false);
            break;
          case err.POSITION_UNAVAILABLE:
            errorMessage += 'Location unavailable. Please check your device settings.';
            setIsTracking(false);
            break;
          case err.TIMEOUT:
            errorMessage += 'Location update timed out. Retrying automatically...';
            break;
          default:
            errorMessage += err.message;
        }
        setError(errorMessage);
        setLoading(false);
      },
      watchOptions
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
        (position) => {
          const { latitude, longitude, accuracy, heading, speed } = position.coords;
          const locationData: LocationData = {
            latitude,
            longitude,
            accuracy: accuracy || null,
            heading: heading || null,
            speed: speed || null,
            timestamp: new Date().toISOString()
          };
          void sendLocationToServer(locationData);
        },
        (err: GeolocationPositionError) => console.error('Periodic location error:', err),
        {
          enableHighAccuracy: false,
          timeout: 30000,
          maximumAge: 60000
        }
      );
    }, 30000);
  }, [clearTrackingWatchers, sendLocationToServer]);

  const stopTracking = useCallback(() => {
    clearTrackingWatchers();
    setIsTracking(false);
    setLoading(false);
  }, [clearTrackingWatchers]);

  const requestLocationPermission = (): void => {
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
      (err: GeolocationPositionError) => {
        let errorMessage = 'Location access error: ';
        switch (err.code) {
          case err.PERMISSION_DENIED:
            errorMessage += 'Please enable location services in your browser settings.';
            break;
          case err.POSITION_UNAVAILABLE:
            errorMessage += 'Location unavailable. Please check your device.';
            break;
          case err.TIMEOUT:
            errorMessage += 'Request timed out. Please try again in an open area or disable strict GPS mode on your device.';
            break;
          default:
            errorMessage += err.message;
        }
        setError(errorMessage);
        setLoading(false);
      },
      { enableHighAccuracy: false, timeout: 30000, maximumAge: 60000 }
    );
  };

  const hasRoute = !!(route as DriverRouteData | null)?.coordinates?.length;

  return (
    <div className="space-y-4 md:space-y-6 w-full min-w-0">
      {/* Header Section - responsive and touch-friendly */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl sm:text-3xl font-bold text-gray-900 dark:text-gray-100">Driver Portal</h1>
            <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 mt-0.5">Track your location and manage deliveries in real-time</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <div className={`flex items-center gap-2 px-3 py-2.5 min-h-[44px] rounded-lg shadow-sm transition-all touch-manipulation ${
              isTracking 
                ? 'bg-green-50 text-green-700 border border-green-200 dark:bg-green-900/20 dark:text-green-300 dark:border-green-800'
                : 'bg-gray-50 text-gray-600 border border-gray-200 dark:bg-gray-700 dark:text-gray-200 dark:border-gray-600'
            }`}>
              <div className={`w-2.5 h-2.5 rounded-full transition-all flex-shrink-0 ${
                isTracking ? 'bg-green-500 animate-pulse' : 'bg-gray-400 dark:bg-gray-500'
              }`}></div>
              <span className="text-sm font-semibold">{isTracking ? 'Tracking Active' : 'Tracking Off'}</span>
            </div>
            {notifications > 0 && (
              <div className="flex items-center gap-2 px-3 py-2.5 min-h-[44px] bg-red-50 text-red-700 rounded-lg border border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-800 touch-manipulation">
                <Bell className="w-4 h-4 flex-shrink-0" />
                <span className="text-sm font-semibold">{notifications}</span>
              </div>
            )}
          </div>
      </div>

      {/* Tab Navigation - bigger gap, scroll on mobile */}
      <div className="pp-sticky-tab-rail pp-card px-2 py-2 mt-4 md:mt-6 mb-4 md:mb-6 overflow-x-auto">
        <nav className="flex flex-wrap gap-2 min-w-max md:min-w-0">
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
                className={`pp-nav-pill min-h-[44px] touch-manipulation ${activeTab === tab.id ? 'active' : ''}`}
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

      {/* Animated tab content — re-mounts on tab change */}
      <div key={activeTab} className="tab-enter">

      {/* Tracking Tab - mobile: map top, controls/list bottom */}
      {activeTab === 'tracking' && (
        <div className="flex flex-col md:block space-y-4 md:space-y-6">
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

      {/* Map - show first on mobile (top of split) */}
      <div className="pp-card overflow-hidden w-full order-first md:order-none">
        <div className="p-3 sm:p-4 bg-gradient-to-r from-gray-50 to-gray-100 border-b border-gray-200 dark:from-gray-800 dark:to-gray-900 dark:border-gray-700">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
            <MapPin className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0" />
            <h2 className="text-lg sm:text-xl font-semibold text-gray-900 dark:text-gray-100">Location Map</h2>
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-300">
              {isRouteLoading && 'Routing...'}
              {!isRouteLoading && routeError && routeError}
              {!isRouteLoading && !routeError && hasRoute && 'Route updated'}
            </div>
          </div>
        </div>
        <div className="relative w-full" style={{ width: '100%', margin: 0, padding: 0 }}>
          <div 
            ref={mapRef} 
            className="h-[42vh] min-h-[240px] sm:h-[500px] lg:h-[600px] bg-gray-100 dark:bg-gray-900"
            style={{ 
              width: '100%',
              position: 'relative',
              zIndex: 1,
              margin: 0,
              padding: 0
            }}
          />
          {!location && mapReady && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-50 bg-opacity-90 z-[1000] dark:bg-gray-900/80">
              <div className="pp-card text-center p-4 sm:p-6 max-w-sm mx-4">
                <MapPin className="w-10 h-10 sm:w-12 sm:h-12 text-gray-400 dark:text-gray-500 mx-auto mb-3" />
                <p className="text-gray-700 dark:text-gray-200 font-medium mb-1 text-sm sm:text-base">No location data available</p>
                <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400">Click "Start Tracking" below to begin</p>
              </div>
            </div>
          )}
          {!mapReady && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-50 dark:bg-gray-900">
              <div className="text-center">
                <RefreshCw className="w-8 h-8 text-gray-400 dark:text-gray-500 mx-auto mb-2 animate-spin" />
                <p className="text-gray-600 dark:text-gray-300 text-sm">Loading map...</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Control Panel - below map on mobile */}
      <div className="pp-card p-4 sm:p-6 order-2">
        <h2 className="text-lg sm:text-xl font-semibold text-gray-900 dark:text-gray-100 mb-3 sm:mb-4">Location Controls</h2>
        <div className="flex flex-wrap gap-2 sm:gap-3">
          {!isTracking ? (
            <button
              onClick={requestLocationPermission}
              disabled={loading}
              className="min-h-[44px] px-4 sm:px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 active:bg-blue-800 disabled:bg-blue-300 disabled:cursor-not-allowed flex items-center gap-2 font-semibold shadow-sm transition-all touch-manipulation"
            >
              <Navigation className="w-5 h-5 flex-shrink-0" />
              {loading ? 'Starting...' : 'Start Tracking'}
            </button>
          ) : (
            <button
              onClick={stopTracking}
              className="min-h-[44px] px-4 sm:px-6 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 active:bg-red-800 flex items-center gap-2 font-semibold shadow-sm transition-all touch-manipulation"
            >
              <Activity className="w-5 h-5 flex-shrink-0" />
              Stop Tracking
            </button>
          )}
          <button
            onClick={() => void loadLatestLocation()}
            disabled={loading}
            className="min-h-[44px] px-4 sm:px-6 py-3 bg-gray-600 text-white rounded-lg hover:bg-gray-700 active:bg-gray-800 disabled:bg-gray-300 disabled:cursor-not-allowed flex items-center gap-2 font-semibold shadow-sm transition-all touch-manipulation dark:bg-gray-700 dark:hover:bg-gray-600 dark:active:bg-gray-700"
          >
            <RefreshCw className={`w-5 h-5 flex-shrink-0 ${loading ? 'animate-spin' : ''}`} />
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
              <div className="pp-card p-3">
                <div className="text-gray-600 dark:text-gray-400 text-xs uppercase tracking-wide mb-1">Latitude</div>
                <div className="font-mono text-gray-900 dark:text-gray-100 font-semibold">{location.latitude.toFixed(6)}</div>
              </div>
              <div className="pp-card p-3">
                <div className="text-gray-600 dark:text-gray-400 text-xs uppercase tracking-wide mb-1">Longitude</div>
                <div className="font-mono text-gray-900 dark:text-gray-100 font-semibold">{location.longitude.toFixed(6)}</div>
              </div>
              {location.accuracy && (
                <div className="pp-card p-3">
                  <div className="text-gray-600 dark:text-gray-400 text-xs uppercase tracking-wide mb-1">Accuracy</div>
                  <div className="font-mono text-gray-900 dark:text-gray-100 font-semibold">±{location.accuracy.toFixed(0)}m</div>
                </div>
              )}
              <div className="pp-card p-3">
                <div className="text-gray-600 dark:text-gray-400 text-xs uppercase tracking-wide mb-1">Last Update</div>
                <div className="font-mono text-gray-900 dark:text-gray-100 font-semibold">{new Date(location.timestamp).toLocaleTimeString()}</div>
              </div>
              {location.speed && (
                <div className="pp-card p-3">
                  <div className="text-gray-600 dark:text-gray-400 text-xs uppercase tracking-wide mb-1">Speed</div>
                  <div className="font-mono text-gray-900 dark:text-gray-100 font-semibold">{(location.speed * 3.6).toFixed(1)} km/h</div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Location History */}
      {locationHistory.length > 0 && (
        <div className="pp-card p-6">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-4">
            Recent Locations ({locationHistory.length})
          </h2>
          <div className="overflow-x-auto">
            <table className="min-w-[760px] divide-y divide-gray-200 dark:divide-gray-700">
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

      {/* Deliveries Tab — hide Manage Delivery Order; drivers only see map/list */}
      {activeTab === 'deliveries' && (
        <DeliveryManagementPage hideManageTab />
      )}

      {/* Messages Tab — two-column chat layout */}
      {activeTab === 'messages' && (
        <div className="flex h-[calc(100vh-280px)] min-h-[520px] rounded-xl overflow-hidden border border-gray-200 dark:border-gray-700 shadow-sm">
          {/* ── LEFT COLUMN: Contacts Panel ── */}
          <div className="w-72 flex-shrink-0 flex flex-col bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700">
            {/* Panel header with search */}
            <div className="px-4 pt-4 pb-3 border-b border-gray-200 dark:border-gray-700">
              <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-3">Messages</h3>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                <input
                  type="text"
                  placeholder="Search contacts…"
                  className="w-full pl-9 pr-3 py-2 text-sm rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 border-0 focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
            </div>

            {/* Contact list */}
            <div className="flex-1 overflow-y-auto">
              {loadingContacts ? (
                <div className="flex flex-col items-center justify-center h-32 text-gray-400 dark:text-gray-500 text-sm gap-2">
                  <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                  Loading…
                </div>
              ) : (
                <>
                  {teamMembers.length > 0 && (
                    <>
                      <div className="px-4 pt-3 pb-1">
                        <span className="text-[10px] font-bold tracking-widest text-gray-400 dark:text-gray-500 uppercase">Team</span>
                      </div>
                      {teamMembers.map(member => {
                        const isOnline = isContactOnline(member);
                        const isSelected = selectedContact?.id === member.id;
                        const initials = (member.fullName || member.username || '?')[0].toUpperCase();
                        const roleLabel = member.account?.role === 'admin' ? 'Admin'
                          : member.account?.role === 'delivery_team' ? 'Delivery'
                          : member.role || '';
                        return (
                          <button
                            key={member.id}
                            onClick={() => { setSelectedContact(member); void loadMessages(member.id); }}
                            className={`w-full flex items-center gap-3 px-3 py-3 text-left transition-all border-l-4 ${
                              isSelected
                                ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-600 dark:border-blue-400'
                                : 'border-transparent hover:bg-gray-50 dark:hover:bg-gray-700/50'
                            }`}
                          >
                            <div className="relative flex-shrink-0">
                              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white font-semibold text-sm shadow-sm">
                                {initials}
                              </div>
                              <div className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-white dark:border-gray-800 ${isOnline ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'}`} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between gap-1">
                                <span className="font-medium text-sm text-gray-900 dark:text-gray-100 truncate">
                                  {member.fullName || member.username}
                                </span>
                                {roleLabel && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 flex-shrink-0 font-medium">
                                    {roleLabel}
                                  </span>
                                )}
                              </div>
                              <p className={`text-xs mt-0.5 truncate font-medium ${isOnline ? 'text-green-600 dark:text-green-400' : 'text-gray-400 dark:text-gray-500'}`}>
                                {isOnline ? '● Active now' : '○ Offline'}
                              </p>
                            </div>
                          </button>
                        );
                      })}
                    </>
                  )}

                  {contacts.length === 0 && (
                    <div className="flex flex-col items-center justify-center h-40 text-gray-400 dark:text-gray-500 text-sm gap-2 px-4 text-center">
                      <MessageSquare className="w-8 h-8 opacity-40" />
                      No contacts available
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* ── RIGHT COLUMN: Chat Panel ── */}
          <div className="flex-1 flex flex-col bg-gray-50 dark:bg-gray-900 min-w-0">
            {selectedContact ? (
              <>
                {/* Chat header */}
                <div className="flex items-center justify-between px-5 py-3 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 shadow-sm flex-shrink-0">
                  <div className="flex items-center gap-3">
                    <div className="relative">
                      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white font-semibold shadow-sm">
                        {(selectedContact.fullName || selectedContact.username || '?')[0].toUpperCase()}
                      </div>
                      {isContactOnline(selectedContact) && (
                        <div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 bg-green-500 rounded-full border-2 border-white dark:border-gray-800" />
                      )}
                    </div>
                    <div>
                      <h3 className="font-semibold text-gray-900 dark:text-gray-100 leading-tight">
                        {selectedContact.fullName || selectedContact.username}
                      </h3>
                      <p className="text-xs mt-0.5">
                        {isContactOnline(selectedContact)
                          ? <span className="text-green-600 dark:text-green-400 font-medium">Active now</span>
                          : <span className="text-gray-400 dark:text-gray-500">Offline</span>}
                        {selectedContact.account?.role && (
                          <span className="text-gray-400 dark:text-gray-500">
                            {' '}·{' '}
                            {selectedContact.account.role === 'admin' ? 'Admin'
                              : selectedContact.account.role === 'delivery_team' ? 'Delivery Team'
                              : 'Driver'}
                          </span>
                        )}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => void loadMessages(selectedContact.id)}
                    title="Refresh messages"
                    className="p-2 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                  >
                    <RefreshCw className="w-4 h-4" />
                  </button>
                </div>

                {/* Messages area */}
                <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
                  {loadingMessages && messages.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-gray-400 dark:text-gray-500 gap-2">
                      <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                      <span className="text-sm">Loading messages…</span>
                    </div>
                  ) : messages.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-gray-400 dark:text-gray-500 gap-3">
                      <div className="w-16 h-16 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
                        <MessageSquare className="w-8 h-8 opacity-40" />
                      </div>
                      <div className="text-center">
                        <p className="font-medium text-gray-600 dark:text-gray-400">No messages yet</p>
                        <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">Send a message to start the conversation</p>
                      </div>
                    </div>
                  ) : (
                    messages.map((msg, idx) => {
                      const isFromOther = msg.senderRole !== 'driver';
                      const messageText = msg.text || msg.content || '';
                      const messageTime = msg.timestamp || msg.createdAt;
                      const roleConfig: Record<string, { label: string; color: string }> = {
                        admin: { label: 'Admin', color: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300' },
                        delivery_team: { label: 'Delivery', color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' },
                        sales_ops: { label: 'Sales', color: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300' },
                        manager: { label: 'Manager', color: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300' }
                      };
                      const roleBadge = roleConfig[msg.senderRole ?? ''] || { label: msg.senderRole ?? '', color: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300' };
                      return (
                        <div key={idx} className={`flex items-end gap-2 ${isFromOther ? 'justify-start' : 'justify-end'}`}>
                          {isFromOther && (
                            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-gray-400 to-gray-600 flex-shrink-0 flex items-center justify-center text-white text-xs font-semibold shadow-sm">
                              {(selectedContact.fullName || selectedContact.username || '?')[0].toUpperCase()}
                            </div>
                          )}
                          <div className="max-w-[88%] sm:max-w-[75%]">
                            {isFromOther && roleBadge.label && (
                              <span className={`inline-block text-[10px] px-2 py-0.5 rounded-full font-semibold mb-1 ${roleBadge.color}`}>
                                {roleBadge.label}
                              </span>
                            )}
                            <div className={`px-4 py-2.5 shadow-sm ${
                              isFromOther
                                ? 'bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border border-gray-200 dark:border-gray-700 rounded-2xl rounded-tl-sm'
                                : 'bg-blue-600 dark:bg-blue-500 text-white rounded-2xl rounded-tr-sm'
                            }`}>
                              {/* Attachment rendering */}
                              {msg.attachmentUrl && msg.attachmentType?.startsWith('image/') && (
                                <a href={msg.attachmentUrl as string} target="_blank" rel="noopener noreferrer" className="block mb-2">
                                  <img
                                    src={msg.attachmentUrl as string}
                                    alt={(msg.attachmentName as string) || 'attachment'}
                                    className="max-w-full rounded-lg max-h-48 object-cover cursor-pointer hover:opacity-90 transition-opacity"
                                  />
                                </a>
                              )}
                              {msg.attachmentUrl && !msg.attachmentType?.startsWith('image/') && (
                                <a
                                  href={msg.attachmentUrl as string}
                                  download={(msg.attachmentName as string) || 'file'}
                                  className={`flex items-center gap-2 mb-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                                    isFromOther
                                      ? 'bg-gray-100 dark:bg-gray-700 text-blue-600 dark:text-blue-400 hover:bg-gray-200'
                                      : 'bg-blue-500 text-white hover:bg-blue-400'
                                  }`}
                                >
                                  <Paperclip className="w-4 h-4 flex-shrink-0" />
                                  <span className="truncate">{(msg.attachmentName as string) || 'Download file'}</span>
                                </a>
                              )}
                              {messageText && <p className="text-sm leading-relaxed">{messageText}</p>}
                            </div>
                            <p className={`text-[11px] mt-1 px-1 ${isFromOther ? 'text-left text-gray-400 dark:text-gray-500' : 'text-right text-gray-400 dark:text-gray-500'}`}>
                              {formatMessageTimestamp(messageTime)}
                            </p>
                          </div>
                        </div>
                      );
                    })
                  )}
                  <div ref={messagesEndRef} />
                </div>

                {/* Message input */}
                <div className="flex-shrink-0 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700">
                  {/* Attachment preview */}
                  {attachmentPreview && (
                    <div className="px-4 pt-3 flex items-center gap-3">
                      <div className="relative flex items-center gap-2 bg-gray-100 dark:bg-gray-700 rounded-xl px-3 py-2 max-w-xs">
                        {attachmentPreview.type.startsWith('image/') ? (
                          <img src={attachmentPreview.url} alt="preview" className="h-10 w-10 object-cover rounded-lg flex-shrink-0" />
                        ) : (
                          <div className="h-10 w-10 bg-blue-100 dark:bg-blue-900/30 rounded-lg flex items-center justify-center flex-shrink-0">
                            <Paperclip className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                          </div>
                        )}
                        <span className="text-xs text-gray-700 dark:text-gray-300 truncate max-w-[140px]">{attachmentPreview.name}</span>
                        <button
                          onClick={() => setAttachmentPreview(null)}
                          className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-gray-500 hover:bg-red-500 text-white rounded-full flex items-center justify-center text-xs transition-colors"
                        >✕</button>
                      </div>
                    </div>
                  )}
                  <div className="flex items-center gap-2 px-4 py-3">
                    {/* Hidden file input */}
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt"
                      className="hidden"
                      onChange={handleFileSelect}
                    />
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      disabled={sendingMessage}
                      title="Attach file or image"
                      className="flex-shrink-0 w-9 h-9 flex items-center justify-center text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full transition-colors disabled:opacity-40"
                    >
                      <Paperclip className="w-5 h-5" />
                    </button>
                    <div className="flex-1 flex items-center gap-3 bg-gray-100 dark:bg-gray-700 rounded-full px-4 py-2.5 focus-within:ring-2 focus-within:ring-blue-500 transition-all">
                      <input
                        type="text"
                        value={newMessage}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewMessage(e.target.value)}
                        onKeyPress={(e: React.KeyboardEvent<HTMLInputElement>) => {
                          if (e.key === 'Enter' && (newMessage.trim() || attachmentPreview) && !sendingMessage) {
                            void handleSendMessage();
                          }
                        }}
                        placeholder="Type a message…"
                        disabled={sendingMessage}
                        className="flex-1 bg-transparent text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 outline-none disabled:opacity-50"
                      />
                    </div>
                    <button
                      onClick={() => void handleSendMessage()}
                      disabled={(!newMessage.trim() && !attachmentPreview) || sendingMessage}
                      className="flex-shrink-0 w-9 h-9 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-full flex items-center justify-center transition-colors shadow-sm"
                    >
                      {sendingMessage
                        ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        : <Send className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center text-gray-400 dark:text-gray-500">
                  <div className="w-20 h-20 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center mx-auto mb-4">
                    <MessageSquare className="w-10 h-10 opacity-40" />
                  </div>
                  <p className="font-medium text-gray-600 dark:text-gray-400 text-lg">Your Messages</p>
                  <p className="text-sm mt-1">Select a contact to start a conversation</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      </div>{/* end tab-enter wrapper */}
    </div>
  );
}
