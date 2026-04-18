import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import api, { setAuthToken } from '../frontend/apiClient';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { calculateRouteWithOSRM } from '../services/osrmRoutingService';
import DeliveryTable from '../components/DeliveryList/DeliveryTable';
import CustomerModal from '../components/CustomerDetails/CustomerModal';
import useDeliveryStore from '../store/useDeliveryStore';
import { calculateDistance } from '../utils/distanceCalculator';
import { useToast } from '../hooks/useToast';
import { ToastContainer } from '../components/common/Toast';
import {
  MapPin, Navigation, RefreshCw, AlertCircle, CheckCircle2,
  MessageSquare, Truck, Bell, Paperclip, Send, Search, ClipboardList, ChevronLeft
} from 'lucide-react';
import type { Delivery } from '../types';
import { getOnRouteDeliveriesForList, isOnRouteDeliveryListStatus, getEtaStatus } from '../utils/deliveryListFilter';

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
  /** The ETA calculated on the FIRST route run — used as the on-time baseline. Never overwritten. */
  plannedEta?: string | null;
  /**
   * Static ETA (D3): locked at "Start Delivery" time.
   * = departure time + cumulative drive time + 60-min service per stop.
   * Used as the baseline for delay detection (>1 hr over staticEta = Order Delay).
   */
  staticEta?: string | null;
  eta?: string | null;
  distanceFromDriverKm?: number;
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
  const markerAnimationRef = useRef<number | null>(null);
  const lastAutoPanAtRef = useRef<number>(0);
  const watchIdRef = useRef<number | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isTrackingRef = useRef<boolean>(false);

  // Tab management: Orders (map+list) and Messages
  const [activeTab, setActiveTab] = useState<string>('orders');

  // Delivery state
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [, setLoadingDeliveries] = useState<boolean>(false);

  // Separate delivery lists per type (on-route / confirmed / finished)
  const [onRouteDeliveries, setOnRouteDeliveries] = useState<Delivery[]>([]);
  const [confirmedDeliveries, setConfirmedDeliveries] = useState<Delivery[]>([]);
  const [finishedDeliveries, setFinishedDeliveries] = useState<Delivery[]>([]);

  // D4: "Start Delivery" — wall-clock time driver departed the warehouse
  // Once set, staticEta for each stop is locked and used for 1-hr delay detection (D3)
  const [deliveryStartedAt, setDeliveryStartedAt] = useState<number | null>(null);

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

  // Orders tab: modal for POD
  const [showModal, setShowModal] = useState<boolean>(false);
  const { toasts, removeToast, success, error: toastError } = useToast();
  const updateDeliveryOrder = useDeliveryStore((s) => s.updateDeliveryOrder);
  const setDeliveryListFilter = useDeliveryStore((s) => s.setDeliveryListFilter);
  // Store deliveries carry priority (assigned by loadDeliveries) — used for priority breakdown display
  const storeDeliveries = useDeliveryStore((s) => s.deliveries);

  // Manual reorder tracking: when the driver drags the list, honour that order
  // instead of recalculating via nearest-neighbour.
  const manuallyOrderedRef = useRef<boolean>(false);
  const userOrderRef = useRef<Delivery[]>([]);

  // Ref mirror of deliveryStartedAt so the routing effect can read it without being a dep.
  const deliveryStartedAtRef = useRef<number | null>(null);

  // Lock stop order after first OSRM calc so distances decrease monotonically on GPS movement.
  // Only reset when deliveries actually change (new/completed orders).
  const committedOrderRef = useRef<Delivery[]>([]);

  const confirmedDeliveriesRef = useRef<Delivery[]>([]);
  const finishedDeliveriesRef = useRef<Delivery[]>([]);

  // Callback passed to <DeliveryTable onReorder> so drag-reorder triggers map update
  const handleManualReorder = useCallback((newOrder: Delivery[]) => {
    manuallyOrderedRef.current = true;
    userOrderRef.current = newOrder;
    // Only keep on-route items in deliveries state (used by the routing effect).
    // The full reordered store list is handled by updateDeliveryOrder inside handleCardDrop.
    const onRouteOnly = newOrder.filter(d => isOnRouteDeliveryListStatus((d.status || '').toLowerCase()));
    setDeliveries(onRouteOnly.length > 0 ? onRouteOnly : newOrder);
    // Clear the last-origin ref so the effect does not short-circuit
    lastRouteDeliveriesRef.current = '';
  }, []);
  
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
    const a = Number.parseFloat(String(latRaw));
    const b = Number.parseFloat(String(lngRaw));
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    // UAE bounding box validation + auto-correct lat/lng swap
    const inUAE = (la: number, lo: number) =>
      la >= 22.0 && la <= 26.5 && lo >= 51.0 && lo <= 56.5;
    if (inUAE(a, b)) return { lat: a, lng: b };
    if (inUAE(b, a)) return { lat: b, lng: a }; // GeoJSON swap — auto-fix
    return null; // outside UAE bounds — skip pin
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
    if (markerAnimationRef.current !== null) {
      cancelAnimationFrame(markerAnimationRef.current);
      markerAnimationRef.current = null;
    }
    if (mapInstance.current) {
      mapInstance.current.remove();
      mapInstance.current = null;
    }
  }, [clearTrackingWatchers]);

  // Keep isTrackingRef in sync with state
  useEffect(() => {
    isTrackingRef.current = isTracking;
  }, [isTracking]);

  // Keep deliveryStartedAtRef in sync so the routing effect can read it without adding to deps
  useEffect(() => { deliveryStartedAtRef.current = deliveryStartedAt; }, [deliveryStartedAt]);

  useEffect(() => {
    ensureAuth();
    void loadLatestLocation();
    void loadDeliveries();
    void loadContacts();
    void loadNotificationCount();
    const notificationInterval = setInterval(() => {
      if (!document.hidden) void loadNotificationCount();
    }, 60000);
    // Periodic delivery refresh so newly assigned orders appear without manual reload
    const deliveryInterval = setInterval(() => {
      if (!document.hidden) void loadDeliveries();
    }, 30000);
    // Real-time ETA refresh: every 30 s recompute ETAs from current GPS without full OSRM round-trip
    const etaRefreshInterval = setInterval(() => {
      if (document.hidden) return;
      setOrderedDeliveries(prev => {
        if (!prev.length) return prev;
        const now = Date.now();
        return prev.map((d, i) => {
          // Re-base the ETA from "now" using the existing cumulative offset stored in estimatedEta
          const existingEta = d.estimatedEta ? new Date(d.estimatedEta).getTime() : null;
          if (!existingEta) return d;
          // Shift the ETA by the difference in time since last calc (approximate)
          const refreshedEta = new Date(existingEta).toISOString();
          return { ...d, estimatedEta: refreshedEta, routeIndex: i + 1 };
        });
      });
    }, 30000);
    // Auto-start GPS when driver logs in – tracking always on
    const t = setTimeout(() => {
      if (navigator.geolocation && !isTrackingRef.current) {
        requestLocationPermission();
      }
    }, 800);
    return () => {
      cleanup();
      clearInterval(notificationInterval);
      clearInterval(deliveryInterval);
      clearInterval(etaRefreshInterval);
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cleanup]);

  useEffect(() => {
    const params = new URLSearchParams(routeLocation.search);
    const tab = params.get('tab');
    if (tab && ['orders', 'messages'].includes(tab)) {
      setActiveTab(tab);
    }
  }, [routeLocation.search]);

  // D1: Immediately refresh deliveries after POD so the delivered item appears without waiting 30s
  useEffect(() => {
    const handlePodUpdate = () => {
      void loadDeliveries();
    };
    window.addEventListener('deliveryStatusUpdated', handlePodUpdate);
    return () => window.removeEventListener('deliveryStatusUpdated', handlePodUpdate);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep refs in sync for use inside routing effect closure without adding to deps
  useEffect(() => { confirmedDeliveriesRef.current = confirmedDeliveries; }, [confirmedDeliveries]);
  useEffect(() => { finishedDeliveriesRef.current = finishedDeliveries; }, [finishedDeliveries]);

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

  // Invalidate map size when orders tab is active
  useEffect(() => {
    if (activeTab === 'orders' && mapInstance.current && mapReady) {
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
    const map = mapInstance.current;
    const targetLatLng = L.latLng(latitude, longitude);

    // Create custom icon with better styling
    const truckTrackingIcon = L.divIcon({
      className: 'custom-marker',
      html: `<div style="
        width: 38px;
        height: 38px;
        border-radius: 999px;
        border: 2px solid white;
        background: radial-gradient(circle at center, rgba(37,99,235,0.35) 0%, rgba(37,99,235,0.15) 55%, rgba(37,99,235,0) 85%);
        box-shadow: 0 0 0 6px rgba(37,99,235,0.16), 0 4px 12px rgba(0,0,0,0.3);
        position: relative;
        display: flex;
        align-items: center;
        justify-content: center;
      ">
        <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M14 18H3V6h11v12z"></path>
          <path d="M14 10h4l3 3v5h-7"></path>
          <circle cx="7.5" cy="18.5" r="1.5"></circle>
          <circle cx="17.5" cy="18.5" r="1.5"></circle>
        </svg>
      </div>`,
      iconSize: [38, 38],
      iconAnchor: [19, 19],
    });

    const popupHtml = `
        <div style="font-family: 'DM Sans', 'Inter', -apple-system, sans-serif; font-size: 13px; min-width: 200px;">
          <div style="font-weight: 600; margin-bottom: 8px; color: #1f2937;">Live Truck Location</div>
          <div style="margin-bottom: 4px;"><strong>Coordinates:</strong> ${latitude.toFixed(6)}, ${longitude.toFixed(6)}</div>
          <div style="margin-bottom: 4px;"><strong>Time:</strong> ${new Date(location.timestamp).toLocaleString()}</div>
          ${location.accuracy ? `<div style="margin-bottom: 4px;"><strong>Accuracy:</strong> ±${location.accuracy.toFixed(0)}m</div>` : ''}
          ${location.speed ? `<div><strong>Speed:</strong> ${(location.speed * 3.6).toFixed(1)} km/h</div>` : ''}
        </div>
      `;

    // Create marker once, then smoothly animate to new GPS positions.
    if (!markerRef.current) {
      markerRef.current = L.marker(targetLatLng, { icon: truckTrackingIcon })
        .addTo(map)
        .bindPopup(popupHtml);
    } else {
      markerRef.current.setIcon(truckTrackingIcon);
      markerRef.current.setPopupContent(popupHtml);
      const startLatLng = markerRef.current.getLatLng();
      const durationMs = 1200;
      const startAt = performance.now();

      if (markerAnimationRef.current !== null) {
        cancelAnimationFrame(markerAnimationRef.current);
      }

      const animateMarker = (now: number) => {
        if (!markerRef.current) return;
        const elapsed = now - startAt;
        const t = Math.min(1, elapsed / durationMs);
        // Ease-out interpolation keeps the movement smooth but responsive.
        const ease = 1 - (1 - t) * (1 - t);
        const lat = startLatLng.lat + (targetLatLng.lat - startLatLng.lat) * ease;
        const lng = startLatLng.lng + (targetLatLng.lng - startLatLng.lng) * ease;
        markerRef.current.setLatLng([lat, lng]);
        if (t < 1) {
          markerAnimationRef.current = requestAnimationFrame(animateMarker);
        } else {
          markerAnimationRef.current = null;
        }
      };

      markerAnimationRef.current = requestAnimationFrame(animateMarker);
    }

    // Smooth auto-pan with throttle to prevent jumpy map movement.
    const routeData = route as DriverRouteData | null;
    if (!routeData?.coordinates?.length) {
      const now = Date.now();
      const center = map.getCenter();
      const centerDistanceMeters = map.distance(center, targetLatLng);
      if (centerDistanceMeters > 60 && now - lastAutoPanAtRef.current > 1800) {
        map.panTo(targetLatLng, { animate: true, duration: 1.2 });
        if (map.getZoom() < 15) map.setZoom(15, { animate: true });
        lastAutoPanAtRef.current = now;
      }
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

    // Use orderedDeliveries only when its IDs still match the current deliveries.
    // If deliveries changed (e.g. a stop was completed and removed) but
    // orderedDeliveries hasn't been recalculated yet, fall back to the fresh
    // deliveries list so stale stops never appear on the map.
    const currentIds = new Set(deliveries.map(d => d.id));
    const orderedMatchesCurrent = orderedDeliveries.length > 0
      && orderedDeliveries.length === deliveries.length
      && orderedDeliveries.every(d => currentIds.has(d.id));

    const list: EnrichedDelivery[] = orderedMatchesCurrent
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

    const deliverySignature = deliveries.map(d => {
      const m = (d as unknown as { metadata?: Record<string, unknown> }).metadata ?? {};
      return `${d.id}:${m.isPriority ? '1' : '0'}`;
    }).join('|');
    const originMovedKm = lastRouteOriginRef.current
      ? calculateDistance(origin.lat, origin.lng, lastRouteOriginRef.current.lat, lastRouteOriginRef.current.lng)
      : Infinity;
    const deliveriesChanged = deliverySignature !== lastRouteDeliveriesRef.current;

    // When deliveries actually change, reset committed order so we re-optimise
    if (deliveriesChanged) committedOrderRef.current = [];

    // Recalculate when: deliveries changed, driver moved ≥ 20 m (real-time like Google Maps), or no route yet
    if (!deliveriesChanged && originMovedKm < 0.02 && route) {
      return;
    }

    // Priority deliveries bubble to the front before distance-based ordering.
    // Score: 0 = P1/isPriority (urgent), 1 = P2 (high), 2 = normal
    const sortByPriority = (arr: Delivery[]) => {
      const score = (d: Delivery): number => {
        const m = (d as unknown as { metadata?: Record<string, unknown> }).metadata ?? {};
        if (d.priority === 1 || m.isPriority === true) return 0;
        if (d.priority === 2) return 1;
        return 2;
      };
      return [...arr].sort((a, b) => score(a) - score(b));
    };

    const withCoords = sortByPriority(deliveries.filter(d => normalizeDeliveryCoords(d)));
    const withoutCoords = deliveries.filter(d => !normalizeDeliveryCoords(d));
    // If driver manually reordered, respect their order; otherwise use nearest-neighbour optimisation.
    // After first OSRM calc, re-use committed order on GPS movement to prevent stop-order jumping.
    const orderedWithCoords = manuallyOrderedRef.current
      ? withCoords
      : committedOrderRef.current.length > 0 && !deliveriesChanged
          // Use committed order on GPS movement — prevents stop-order jumping
          ? committedOrderRef.current.filter(d => normalizeDeliveryCoords(d))
          : buildNearestNeighborOrder(withCoords, origin);
    const routeLocations = [origin, ...orderedWithCoords.map(d => normalizeDeliveryCoords(d)!).filter(Boolean)];

    if (routeLocations.length < 2) {
      setRoute(null);
      const fallback = [...orderedWithCoords, ...withoutCoords] as EnrichedDelivery[];
      setOrderedDeliveries(fallback);
      updateDeliveryOrder(fallback);
      return;
    }

    setIsRouteLoading(true);
    setRouteError(null);

    calculateRouteWithOSRM(routeLocations)
      .then((routeData) => {
        setRoute(routeData as unknown as DriverRouteData);
        const legs = (routeData.legs || []) as Array<{ duration?: number; distance?: number }>;
        let cumulativeSeconds = 0;
        let cumulativeMeters = 0;
        const baseTime = Date.now();

        // Look up current store deliveries so we can preserve priority and plannedEta
        // that were assigned by loadDeliveries but are not returned by the API.
        const storeDeliveries = useDeliveryStore.getState().deliveries;
        const storeById = new Map(storeDeliveries.map(d => [String(d.id), d as Record<string, unknown>]));

        // D3: 60-min service time per stop (30min install + 30min delivery)
        const SERVICE_TIME_SEC = 60 * 60; // 3600 s

        // D4: If "Start Delivery" was clicked, staticEta base is deliveryStartedAtRef.current;
        // otherwise fall back to the current baseTime (route first calculated = now).
        const staticBaseTime = deliveryStartedAtRef.current ?? baseTime;

        const enriched: EnrichedDelivery[] = orderedWithCoords.map((delivery, index) => {
          cumulativeSeconds += legs[index]?.duration || 0;
          cumulativeMeters += legs[index]?.distance || 0;
          const stopCoords = normalizeDeliveryCoords(delivery);
          const fallbackDistanceKm = stopCoords
            ? calculateDistance(origin.lat, origin.lng, stopCoords.lat, stopCoords.lng)
            : null;
          // Dynamic ETA: pure driving time from current GPS position
          const computedEta = new Date(baseTime + cumulativeSeconds * 1000).toISOString();
          // Static ETA (D3): driving time + 60-min service × stops completed before this one
          // The service time for THIS stop is counted in the NEXT stop's cumulative offset.
          const staticComputedEta = new Date(
            staticBaseTime + cumulativeSeconds * 1000 + index * SERVICE_TIME_SEC * 1000
          ).toISOString();

          const inStore = storeById.get(String(delivery.id));
          // plannedEta is the first-ever computed ETA — never overwritten after set.
          const existingPlannedEta = (inStore?.['plannedEta'] as string | null | undefined) ?? null;
          // staticEta is locked when "Start Delivery" is clicked; once set, never change.
          const existingStaticEta = (inStore?.['staticEta'] as string | null | undefined) ?? null;
          const newStaticEta = deliveryStartedAtRef.current
            ? (existingStaticEta ?? staticComputedEta) // lock on Start Delivery click
            : null; // not started yet — don't lock
          return {
            ...(inStore ?? {}),   // spread store version first → brings in priority, plannedEta, staticEta
            ...delivery,          // overlay fresh API data
            routeIndex: index + 1,
            estimatedEta: computedEta,
            plannedEta: existingPlannedEta ?? computedEta, // set once, never change
            staticEta: newStaticEta,
            distanceFromDriverKm: cumulativeMeters > 0 ? cumulativeMeters / 1000 : (fallbackDistanceKm ?? undefined)
          };
        });

        const trailing: EnrichedDelivery[] = withoutCoords.map((delivery, index) => ({
          ...delivery,
          routeIndex: enriched.length + index + 1,
          estimatedEta: (delivery as EnrichedDelivery).eta || null,
          distanceFromDriverKm: undefined
        }));

        const final = [...enriched, ...trailing];
        setOrderedDeliveries(final);
        // Merge enriched on-route items with confirmed+finished so the store has all delivery types
        updateDeliveryOrder([...final, ...confirmedDeliveriesRef.current, ...finishedDeliveriesRef.current]);
        // Commit the order if this was a fresh optimisation (not just a GPS position update reusing existing order)
        if (committedOrderRef.current.length === 0 || deliveriesChanged) {
          committedOrderRef.current = orderedWithCoords;
        }
        lastRouteOriginRef.current = origin;
        lastRouteDeliveriesRef.current = deliverySignature;
      })
      .catch((routeErr: unknown) => {
        console.error('Failed to calculate driver route:', routeErr);
        setRoute(null);
        setRouteError('Routing unavailable');
        const fallback = [...orderedWithCoords, ...withoutCoords] as EnrichedDelivery[];
        setOrderedDeliveries(fallback);
        updateDeliveryOrder(fallback);
      })
      .finally(() => {
        setIsRouteLoading(false);
      });
  }, [deliveries, location, buildNearestNeighborOrder, updateDeliveryOrder]);

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
    // Reset so routing effect recalculates from scratch on every fresh load (prevents stale route on re-login)
    lastRouteDeliveriesRef.current = '';
    try {
      // Fetch active and finished deliveries in parallel
      const [activeRes, finishedRes] = await Promise.all([
        api.get('/driver/deliveries'),
        api.get('/driver/deliveries/finished').catch(() => ({ data: { deliveries: [] } })),
      ]);
      const activeDeliveries = (activeRes.data?.deliveries as Delivery[]) || [];
      const fetchedFinished = (finishedRes.data?.deliveries as Delivery[]) || [];

      // Categorise active deliveries into on-route vs confirmed-pending
      const onRoute = getOnRouteDeliveriesForList(activeDeliveries);
      const confirmed = activeDeliveries.filter((d) => {
        const s = (d.status || '').toLowerCase();
        return s === 'confirmed' || s === 'scheduled-confirmed';
      });

      // Persist lists so tab-switching can reload store without an extra API call
      setOnRouteDeliveries(onRoute);
      setConfirmedDeliveries(confirmed);
      setFinishedDeliveries(fetchedFinished);

      // Map / routing always use on-route deliveries
      manuallyOrderedRef.current = false;
      userOrderRef.current = [];
      setDeliveries(onRoute);

      // Load ALL deliveries into the store so the unified filter table can show any type
      useDeliveryStore.getState().loadDeliveries([...onRoute, ...confirmed, ...fetchedFinished]);

      console.log(`✓ Loaded ${activeDeliveries.length} active (${onRoute.length} on-route, ${confirmed.length} confirmed) + ${fetchedFinished.length} finished`);
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
      // Auto-select the contact with the most recent message; fall back to first
      if (!selectedContact && allContacts.length > 0) {
        try {
          const msgResp = await api.get('/messages/driver');
          const recentMsgs = (msgResp.data?.messages || []) as DriverMessage[];
          if (recentMsgs.length > 0) {
            const lastMsg = recentMsgs[recentMsgs.length - 1];
            const recentAdminId = lastMsg.adminId as string | undefined;
            const matched = recentAdminId ? allContacts.find(c => c.id === recentAdminId) : undefined;
            setSelectedContact(matched ?? allContacts[0]);
          } else {
            setSelectedContact(allContacts[0]);
          }
        } catch {
          setSelectedContact(allContacts[0]);
        }
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
      void loadNotificationCount();
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

  // D4: Start Delivery — lock static ETAs directly from existing orderedDeliveries (no OSRM re-run)
  const handleStartDelivery = useCallback(() => {
    const now = Date.now();
    setDeliveryStartedAt(now);
    // Lock static ETAs immediately from existing orderedDeliveries — no OSRM re-run needed.
    // Avoids a network call that could fail and make the ETA panel show N/A.
    const SERVICE_TIME_SEC = 3600; // 60-min service per stop (same as routing effect)
    setOrderedDeliveries(prev => {
      if (!prev.length) return prev;
      return prev.map((d, index) => {
        if (d.staticEta) return d; // already locked from a previous Start
        const existingEta = d.estimatedEta ? new Date(d.estimatedEta).getTime() : null;
        if (!existingEta || isNaN(existingEta)) return d;
        // staticEta = existing ETA (drive time) + accumulated service time for previous stops
        const staticEta = new Date(existingEta + index * SERVICE_TIME_SEC * 1000).toISOString();
        return { ...d, staticEta };
      });
    });
  }, []);

  const hasRoute = !!(route as DriverRouteData | null)?.coordinates?.length;
  const routeStats = route as DriverRouteData | null;
  const nextStop = (orderedDeliveries[0] || deliveries[0]) as EnrichedDelivery | undefined;
  const nextEta = nextStop ? formatEta(nextStop.eta ?? nextStop.estimatedEta) : 'N/A';
  // Planned ETA: first route calculation (never changes) — shows baseline before/after Start Delivery
  const nextPlannedEta = nextStop ? formatEta(nextStop.plannedEta ?? nextStop.staticEta ?? nextStop.estimatedEta) : 'N/A';
  // Live ETA: current GPS-based estimate (updates as driver moves)
  const nextLiveEta = nextStop ? formatEta(nextStop.estimatedEta ?? nextStop.eta) : 'N/A';
  const speedKmh = location?.speed != null ? (location.speed * 3.6).toFixed(1) : 'N/A';

  return (
    <div className="space-y-4 md:space-y-6 w-full min-w-0">
      {/* Header Section - responsive and touch-friendly */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl sm:text-3xl font-bold text-gray-900 dark:text-gray-100">Driver Portal</h1>
            <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 mt-0.5">Your orders, route, and POD — GPS on when logged in</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            {notifications > 0 && (
              <div className="flex items-center gap-2 px-3 py-2.5 min-h-[44px] bg-red-50 text-red-700 rounded-lg border border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-800 touch-manipulation">
                <Bell className="w-4 h-4 flex-shrink-0" />
                <span className="text-sm font-semibold">{notifications}</span>
              </div>
            )}
          </div>
      </div>

      {/* Tab Navigation - Orders (map+list) and Messages */}
      <div className="pp-sticky-tab-rail pp-card px-2 py-2 mt-3 md:mt-6 mb-3 md:mb-6 overflow-x-auto">
        <nav className="flex flex-nowrap gap-2 min-w-max md:min-w-0">
          {[
            { id: 'orders', label: 'My Orders', icon: ClipboardList },
            { id: 'messages', label: 'Messages', icon: MessageSquare },
          ].map(tab => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`pp-nav-pill min-h-[46px] px-4 touch-manipulation ${activeTab === tab.id ? 'active' : ''}`}
              >
                <Icon className="w-5 h-5" />
                {tab.label}
                {tab.id === 'orders' && deliveries.filter(d => isOnRouteDeliveryListStatus((d.status || '').toLowerCase())).length > 0 && (
                  <span className="ml-2 bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 text-xs font-semibold px-2 py-0.5 rounded-full">
                    {deliveries.filter(d => isOnRouteDeliveryListStatus((d.status || '').toLowerCase())).length}
                  </span>
                )}
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

      {/* Tab content — kept mounted to prevent Leaflet map teardown */}
      <div>

      {/* Orders Tab - map + order list (POD, customer contact, route) */}
      <div className={`space-y-4 md:space-y-6${activeTab !== 'orders' ? ' hidden' : ''}`}>
          {/* Error Message */}
          {error && (
            <div className="bg-red-50 border-l-4 border-red-400 rounded-lg p-4 shadow-sm dark:bg-red-900/20 dark:border-red-600">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-300 mt-0.5 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-red-800 dark:text-red-200 font-semibold mb-1">GPS error</div>
                  <div className="text-red-700 dark:text-red-300 text-sm">{error}</div>
                  <button
                    onClick={requestLocationPermission}
                    className="mt-2 text-sm font-medium text-red-700 dark:text-red-300 hover:underline"
                  >
                    Retry enabling location
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Full-width map first (desktop + mobile) */}
          <div className="pp-card overflow-hidden w-full">
            <div className="p-3 sm:p-4 bg-gradient-to-r from-gray-50 to-gray-100 border-b border-gray-200 dark:from-gray-800 dark:to-gray-900 dark:border-gray-700">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <MapPin className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0" />
                  <h3 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-gray-100">Location Map</h3>
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-300">
                  {isRouteLoading ? 'Routing...' : routeError ? routeError : hasRoute ? 'Route updated' : 'No route'}
                </div>
              </div>
            </div>
            <div className="relative w-full" style={{ width: '100%', margin: 0, padding: 0 }}>
              <div
                ref={mapRef}
                className="h-[300px] sm:h-[420px] lg:h-[560px] bg-gray-100 dark:bg-gray-900"
                style={{ width: '100%', position: 'relative', zIndex: 1, margin: 0, padding: 0 }}
              />
              {!location && mapReady && (
                <div className="absolute inset-0 flex items-center justify-center bg-gray-50 bg-opacity-90 z-[1000] dark:bg-gray-900/80">
                  <div className="pp-card text-center p-4 max-w-sm mx-4">
                    <MapPin className="w-9 h-9 text-gray-400 dark:text-gray-500 mx-auto mb-2" />
                    <p className="text-gray-700 dark:text-gray-200 font-medium text-sm">Waiting for GPS…</p>
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

          {/* Two columns below map: 65% order list, 35% ETA/telemetry */}
          <div className="grid grid-cols-1 lg:grid-cols-[65%_35%] gap-3 md:gap-6 items-start">
            {/* Left column: order list */}
            <div className="pp-card p-3 sm:p-6 min-h-[520px]">
              <div className="flex items-center justify-between gap-2 mb-2">
                <h2 className="text-lg sm:text-xl font-semibold text-gray-900 dark:text-gray-100">Order list</h2>
                {/* D4: Start Delivery button — shown when there are on-route orders, locks static ETAs */}
                {onRouteDeliveries.length > 0 && (
                  deliveryStartedAt ? (
                    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-700">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Started {new Date(deliveryStartedAt).toLocaleTimeString('en-AE', { timeZone: 'Asia/Dubai', hour: '2-digit', minute: '2-digit' })}
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={handleStartDelivery}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white shadow-sm transition-colors touch-manipulation"
                    >
                      <Truck className="w-3.5 h-3.5" />
                      Start Delivery
                    </button>
                  )
                )}
              </div>
              <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 mb-2">Tap one order to update POD, call customer, or check details</p>

              <div className="max-h-[68vh] md:max-h-[560px] overflow-y-auto pr-1">
                <DeliveryTable
                  onSelectDelivery={() => setShowModal(true)}
                  onCloseDetailModal={() => setShowModal(false)}
                  onReorder={handleManualReorder}
                  isDriverPortal={true}
                />
              </div>
              {location && (
                <div className="mt-4 flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                  <CheckCircle2 className="w-4 h-4 text-green-600 dark:text-green-400 flex-shrink-0" />
                  <span>GPS active — Admin can track your location</span>
                </div>
              )}
            </div>

            {/* Right column: route + live telemetry */}
            <div className="space-y-4">
              {/* Mobile quick status strip */}
              <div className="lg:hidden pp-card p-3">
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-lg bg-blue-50 dark:bg-blue-900/20 p-2">
                    <div className="text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400">ETA</div>
                    <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{nextEta}</div>
                  </div>
                  <div className="rounded-lg bg-blue-50 dark:bg-blue-900/20 p-2">
                    <div className="text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400">Priority</div>
                    <div className="text-sm font-semibold text-red-600 dark:text-red-400">
                      {storeDeliveries.filter(d => {
                        const meta = (d as unknown as { metadata?: { isPriority?: boolean } }).metadata;
                        return d.priority === 1 || d.priority === 2 || meta?.isPriority === true;
                      }).length || 0}
                    </div>
                  </div>
                  <div className="rounded-lg bg-blue-50 dark:bg-blue-900/20 p-2">
                    <div className="text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400">Speed</div>
                    <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{speedKmh}</div>
                  </div>
                </div>
              </div>

              {(() => {
                // Count genuinely priority orders: P1 (urgent), P2 (high), or logistics-set isPriority flag
                const priorityCount = storeDeliveries.filter(d => {
                  const meta = (d as unknown as { metadata?: { isPriority?: boolean } }).metadata;
                  return d.priority === 1 || d.priority === 2 || meta?.isPriority === true;
                }).length;
                const delayedCount = orderedDeliveries.filter(d => getEtaStatus(d) === 'delayed').length;
                const routeStatusLabel = isRouteLoading
                  ? 'Routing…'
                  : routeError
                    ? '⚠ Offline'
                    : !hasRoute
                      ? 'No route'
                      : delayedCount > 0
                        ? `⚠ ${delayedCount} Delayed`
                        : '✓ On Track';
                const routeStatusCls = isRouteLoading || !hasRoute
                  ? 'text-gray-900 dark:text-gray-100'
                  : routeError
                    ? 'text-red-600 dark:text-red-400'
                    : delayedCount > 0
                      ? 'text-orange-600 dark:text-orange-400'
                      : 'text-green-600 dark:text-green-400';
                return (
                  <div className="pp-card p-4 sm:p-5">
                    <h3 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-gray-100 mb-3">Routing & ETA</h3>
                    <div className="grid grid-cols-2 gap-2 sm:gap-3 text-sm">
                      <div className="pp-card p-3">
                        <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">Planned ETA</div>
                        <div className="font-semibold text-gray-900 dark:text-gray-100">{nextPlannedEta}</div>
                        <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">
                          {deliveryStartedAt ? '🔒 Locked at start' : 'First route calc'}
                        </div>
                      </div>
                      <div className="pp-card p-3">
                        <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">Live ETA</div>
                        <div className="font-semibold text-blue-600 dark:text-blue-400">{nextLiveEta}</div>
                        <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">Real-time GPS</div>
                      </div>
                      <div className="pp-card p-3">
                        <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">Priority Orders</div>
                        <div className="font-semibold text-xs sm:text-sm">
                          {priorityCount === 0
                            ? <span className="text-gray-400 dark:text-gray-500">None</span>
                            : <span className="text-red-600 dark:text-red-400">
                                {priorityCount} order{priorityCount > 1 ? 's' : ''}
                              </span>
                          }
                        </div>
                      </div>
                      <div className="pp-card p-3">
                        <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">Total Stops</div>
                        <div className="font-semibold text-gray-900 dark:text-gray-100">{deliveries.length}</div>
                      </div>
                      <div className="pp-card p-3">
                        <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">Route Status</div>
                        <div className={`font-semibold ${routeStatusCls}`}>
                          {routeStatusLabel}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })()}

              <div className="pp-card p-4 sm:p-5">
                <h3 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-gray-100 mb-3">Live Coordinate & Speed</h3>
                <div className="space-y-2 sm:space-y-3 text-sm">
                  <div className="pp-card p-3">
                    <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">Latitude</div>
                    <div className="font-mono font-semibold text-gray-900 dark:text-gray-100">{location ? location.latitude.toFixed(6) : 'N/A'}</div>
                  </div>
                  <div className="pp-card p-3">
                    <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">Longitude</div>
                    <div className="font-mono font-semibold text-gray-900 dark:text-gray-100">{location ? location.longitude.toFixed(6) : 'N/A'}</div>
                  </div>
                  <div className="pp-card p-3">
                    <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">Speed</div>
                    <div className="font-semibold text-gray-900 dark:text-gray-100">{speedKmh} km/h</div>
                  </div>
                </div>
              </div>

            </div>
          </div>

      <ToastContainer toasts={toasts} onRemove={removeToast} />
      <CustomerModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        onSaveContactSuccess={(msg: string) => success(msg)}
        onSaveContactError={(msg: string) => toastError(msg)}
        useDriverEndpoint
      />
        </div>

      {/* Messages Tab — mobile style: list then open chat card */}
      <div className={`rounded-xl overflow-hidden border border-gray-200 dark:border-gray-700 shadow-sm bg-white dark:bg-gray-800${activeTab !== 'messages' ? ' hidden' : ''}`} style={{height: 'max(520px, calc(100dvh - 220px))' }}>
          {!selectedContact ? (
            <div className="h-full flex flex-col">
              <div className="px-4 pt-4 pb-3 border-b border-gray-200 dark:border-gray-700">
                <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-3">Messages</h3>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                  <input
                    type="text"
                    placeholder="Search contacts…"
                    className="w-full pl-9 pr-3 py-2.5 text-sm rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 border-0 focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                </div>
              </div>
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
                          const initials = (member.fullName || member.username || '?')[0].toUpperCase();
                          const roleLabel = member.account?.role === 'admin' ? 'Admin'
                            : member.account?.role === 'delivery_team' ? 'Delivery'
                            : member.role || '';
                          return (
                            <button
                              key={member.id}
                              onClick={() => { setSelectedContact(member); void loadMessages(member.id); }}
                              className="w-full flex items-center gap-3 px-4 py-3.5 text-left transition-colors border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/40"
                            >
                              <div className="relative flex-shrink-0">
                                <div className="w-11 h-11 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white font-semibold text-sm shadow-sm">
                                  {initials}
                                </div>
                                <div className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-white dark:border-gray-800 ${isOnline ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'}`} />
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between gap-1">
                                  <span className="font-semibold text-sm text-gray-900 dark:text-gray-100 truncate">
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
          ) : (
            <div className="h-full flex flex-col bg-gray-50 dark:bg-gray-900 min-w-0">
              <>
                {/* Chat header */}
                <div className="flex items-center justify-between px-3 sm:px-5 py-3 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 shadow-sm flex-shrink-0">
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => setSelectedContact(null)}
                      className="w-9 h-9 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center justify-center"
                      title="Back to messages"
                    >
                      <ChevronLeft className="w-5 h-5 text-gray-600 dark:text-gray-300" />
                    </button>
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
                <div className="flex-1 overflow-y-auto px-3 sm:px-5 py-4 space-y-3">
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
                        <div key={idx} className={`chat-message-enter flex items-end gap-2 ${isFromOther ? 'justify-start' : 'justify-end'}`}>
                          {isFromOther && (
                            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-gray-400 to-gray-600 flex-shrink-0 flex items-center justify-center text-white text-xs font-semibold shadow-sm">
                              {(selectedContact.fullName || selectedContact.username || '?')[0].toUpperCase()}
                            </div>
                          )}
                          <div className="max-w-[90%] sm:max-w-[75%]">
                            {isFromOther && roleBadge.label && (
                              <span className={`inline-block text-[10px] px-2 py-0.5 rounded-full font-semibold mb-1 ${roleBadge.color}`}>
                                {roleBadge.label}
                              </span>
                            )}
                            <div className={`px-4 py-2.5 shadow-sm ${
                              isFromOther
                                ? 'bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border border-gray-200 dark:border-gray-700 rounded-2xl rounded-tl-sm'
                                : 'bg-blue-700 dark:bg-blue-500 text-white rounded-2xl rounded-tr-sm'
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
                              {messageText && <p className="text-sm leading-relaxed font-medium">{messageText}</p>}
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
                  <div className="flex items-center gap-2 px-3 sm:px-4 py-3">
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
            </div>
          )}
        </div>

      </div>{/* end tab wrapper */}
    </div>
  );
}
