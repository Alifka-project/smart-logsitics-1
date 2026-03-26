import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import api from '../frontend/apiClient';
import { 
  MapPin, 
  Activity, 
  Users, 
  AlertCircle, 
  CheckCircle, 
  XCircle, 
  Clock,
  Truck,
  Settings,
  MessageSquare,
  Phone,
  Send,
  Paperclip,
  Circle,
  Package
} from 'lucide-react';
import DeliveryMap from '../components/MapView/DeliveryMap';
import { calculateRoute } from '../services/advancedRoutingService';

/* ──── Interfaces ──── */

interface TrackingLocation {
  lat: number;
  lng: number;
  speed?: number;
  timestamp?: string;
}

interface DriverTracking {
  online?: boolean;
  status?: string;
  location?: TrackingLocation;
  lastUpdate?: string;
}

interface DriverAccount {
  role?: string;
  lastLogin?: string;
}

interface OpDriver {
  id: string;
  username?: string;
  fullName?: string;
  full_name?: string;
  name?: string;
  email?: string;
  phone?: string;
  role?: string;
  account?: DriverAccount;
  tracking?: DriverTracking;
}

interface DeliveryTracking {
  assigned?: boolean;
  status?: string;
  driverId?: string;
  assignedAt?: string;
  eta?: string;
  lastLocation?: TrackingLocation;
}

interface OpDelivery {
  id?: string;
  ID?: string;
  poNumber?: string;
  PONumber?: string;
  customer?: string;
  Customer?: string;
  address?: string;
  Address?: string;
  status?: string;
  assignedDriverId?: string;
  lat?: number;
  Lat?: number;
  lng?: number;
  Lng?: number;
  metadata?: { originalPONumber?: string };
  tracking?: DeliveryTracking;
  [key: string]: unknown;
}

interface AlertItem {
  id: string;
  type: 'urgent' | 'warning' | 'info';
  title: string;
  message: string;
  timestamp: Date;
}

interface ChatMessage {
  text?: string;
  content?: string;
  timestamp?: string;
  createdAt?: string;
  senderRole?: string;
  from?: string;
  [key: string]: unknown;
}

interface AssignmentMessage {
  type: 'success' | 'error';
  text: string;
}

interface ContactsResponse {
  contacts?: OpDriver[];
  teamMembers?: OpDriver[];
  drivers?: OpDriver[];
}

/* ──── Helpers ──── */

function getRoleBadge(role?: string): { label: string; color: string } {
  const roleConfig: Record<string, { label: string; color: string }> = {
    admin:         { label: 'Admin',    color: 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300' },
    driver:        { label: 'Driver',   color: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300' },
    delivery_team: { label: 'Delivery', color: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300' },
    sales_ops:     { label: 'Sales',    color: 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300' },
    manager:       { label: 'Manager',  color: 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300' },
  };
  return roleConfig[role || ''] || { label: role || 'Unknown', color: 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300' };
}

/** Map raw status strings to a clean label + Tailwind colour classes. */
function getStatusDisplay(raw?: string): { label: string; color: string } {
  const s = (raw || '').toLowerCase().replace(/_/g, '-');
  const map: Record<string, { label: string; color: string }> = {
    'out-for-delivery':               { label: 'Out for Delivery',  color: 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300' },
    'in-progress':                    { label: 'In Progress',        color: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300' },
    'assigned':                       { label: 'Assigned',           color: 'bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-300' },
    'pending':                        { label: 'Pending Order',      color: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300' },
    'uploaded':                       { label: 'Pending Order',      color: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300' },
    'scheduled':                      { label: 'Awaiting Customer',  color: 'bg-orange-100 dark:bg-orange-900/30 text-orange-800 dark:text-orange-300' },
    'scheduled-confirmed':            { label: 'Confirmed',          color: 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-800 dark:text-indigo-300' },
    'delivered':                      { label: 'Delivered',          color: 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300' },
    'delivered-with-installation':    { label: 'Delivered + Install',color: 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300' },
    'delivered-without-installation': { label: 'Delivered – No Install', color: 'bg-teal-100 dark:bg-teal-900/30 text-teal-800 dark:text-teal-300' },
    'completed':                      { label: 'Completed',          color: 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300' },
    'pod-completed':                  { label: 'POD Completed',      color: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-300' },
    'cancelled':                      { label: 'Cancelled',          color: 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300' },
    'rescheduled':                    { label: 'Rescheduled',        color: 'bg-orange-100 dark:bg-orange-900/30 text-orange-800 dark:text-orange-300' },
    'returned':                       { label: 'Returned',           color: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300' },
    'failed':                         { label: 'Failed',             color: 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300' },
  };
  return map[s] || { label: raw ? raw.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : 'Unknown', color: 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300' };
}

function getPriorityDisplay(priority?: number | string): { label: string; color: string; border: string } {
  const p = Number(priority);
  if (p === 1) return { label: 'High',   color: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300',    border: 'border-l-red-500' };
  if (p === 2) return { label: 'Medium', color: 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300', border: 'border-l-orange-400' };
  return               { label: 'Low',   color: 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400',   border: 'border-l-gray-300 dark:border-l-gray-600' };
}

// Statuses that mean delivery work is finished — used both for KPI grouping
// and to exclude completed stops from the route displayed on the map.
const TERMINAL_STATUSES = new Set([
  'delivered', 'delivered-with-installation', 'delivered-without-installation',
  'completed', 'pod-completed', 'cancelled', 'rescheduled', 'returned',
]);

/* ──── Component ──── */

export default function AdminOperationsPage(): React.ReactElement {
  const [activeTab, setActiveTab] = useState<string>('monitoring');
  const [drivers, setDrivers] = useState<OpDriver[]>([]);
  const [deliveries, setDeliveries] = useState<OpDelivery[]>([]);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());

  const [assigningDelivery, setAssigningDelivery] = useState<string | null>(null);
  const [assignmentMessage, setAssignmentMessage] = useState<AssignmentMessage | null>(null);

  const [selectedDriver, setSelectedDriver] = useState<OpDriver | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState<string>('');
  const [loadingMessages, setLoadingMessages] = useState<boolean>(false);
  const [sendingMessage, setSendingMessage] = useState<boolean>(false);
  // Keep as a loose Set to mirror JSX behavior (it may store string/number/undefined).
  const [onlineUserIds, setOnlineUserIds] = useState<Set<any>>(new Set());
  const [contacts, setContacts] = useState<OpDriver[]>([]);
  const [teamMembers, setTeamMembers] = useState<OpDriver[]>([]);
  const [messageTemplates] = useState<string[]>([
    'Please update delivery status',
    'New delivery assigned',
    'Please contact customer',
    'Delivery rescheduled',
    'Emergency: Return to warehouse'
  ]);

  const [unreadByDriverId, setUnreadByDriverId] = useState<Record<string, number>>({});
  const [roadRoute, setRoadRoute] = useState<{ coordinates: [number, number][] } | null>(null);
  const [routeLoading, setRouteLoading] = useState<boolean>(false);
  const [routeLegDurationsSec, setRouteLegDurationsSec] = useState<number[]>([]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagePollingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const loadingDataRef = useRef<boolean>(false);
  const loadingOnlineStatusRef = useRef<boolean>(false);
  // Track the last coordinates key so we only recalculate the route when
  // the actual delivery lat/lng values change, not on every 5-second poll.
  const lastRouteKeyRef = useRef<string>('');
  const location = useLocation();

  const formatMessageTimestamp = (value: string | undefined | null): string => {
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

  const loadOnlineStatus = useCallback(async (silent = false): Promise<void> => {
    if (loadingOnlineStatusRef.current) return;
    loadingOnlineStatusRef.current = true;
    try {
      let activeSessionUserIds = new Set<any>();
      try {
        const sessionsResponse = await api.get('/admin/drivers/sessions');
        const sessData = sessionsResponse.data as { sessions?: Array<{ userId?: string | number }> };
        if (sessData?.sessions) {
          activeSessionUserIds = new Set(
            sessData.sessions
              .map(s => s.userId?.toString() || s.userId)
              .filter(Boolean),
          );
          if (!silent) console.debug(`[AdminOps] Loaded ${activeSessionUserIds.size} users from sessions`);
        }
      } catch {
        if (!silent) console.debug('[AdminOps] Sessions failed, using lastLogin fallback');
        const now = new Date();
        const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);
        contacts.forEach(contact => {
          if (contact.account?.lastLogin) {
            const lastLogin = new Date(contact.account.lastLogin);
            if (lastLogin >= fiveMinutesAgo) {
              const userId = (contact as any).id?.toString() || (contact as any).id;
              activeSessionUserIds.add(userId);
            }
          }
        });
        if (!silent) console.debug(`[AdminOps] Fallback found ${activeSessionUserIds.size} users active in last 5 minutes`);
      }
      setOnlineUserIds(activeSessionUserIds);
    } catch (e: unknown) {
      console.error('Error loading online status:', e);
    } finally {
      loadingOnlineStatusRef.current = false;
    }
  }, [contacts]);

  const loadUnreadCounts = useCallback(async (): Promise<void> => {
    try {
      const response = await api.get('/messages/unread');
      const counts = response.data as Record<string, number> | null;
      setUnreadByDriverId(typeof counts === 'object' && counts !== null ? counts : {});
    } catch (err: unknown) {
      const e = err as { response?: { status?: number } };
      if (e?.response?.status !== 403) console.error('Failed to load unread counts:', err);
    }
  }, []);

  const generateAlerts = (deliveriesList: OpDelivery[], driversList: OpDriver[]): AlertItem[] => {
    const alertsList: AlertItem[] = [];
    const now = new Date();
    deliveriesList.forEach(delivery => {
      if (delivery.tracking?.eta) {
        const eta = new Date(delivery.tracking.eta);
        const delayMinutes = (now.getTime() - eta.getTime()) / (1000 * 60);
        if (delayMinutes > 30) {
          alertsList.push({
            id: `delay-${String(delivery.id || '')}`,
            type: 'urgent',
            title: `Delivery #${String(delivery.id || '').slice(0, 8)} delayed`,
            message: `Delayed by ${Math.round(delayMinutes)} minutes`,
            timestamp: now
          });
        }
      }
    });
    driversList.forEach(driver => {
      if (driver.tracking?.lastUpdate) {
        const lastUpdate = new Date(driver.tracking.lastUpdate);
        const idleMinutes = (now.getTime() - lastUpdate.getTime()) / (1000 * 60);
        if (idleMinutes > 30 && driver.tracking?.online) {
          alertsList.push({
            id: `idle-${driver.id}`,
            type: 'warning',
            title: `Driver ${driver.full_name || driver.username} idle`,
            message: `Idle for ${Math.round(idleMinutes)} minutes`,
            timestamp: now
          });
        }
      }
    });
    return alertsList;
  };

  const loadData = async (): Promise<void> => {
    if (loadingDataRef.current) return;
    loadingDataRef.current = true;
    try {
      const [driversResp, deliveriesResp, contactsResp] = await Promise.allSettled([
        api.get('/admin/tracking/drivers').catch(() => ({ data: { drivers: [] } })),
        api.get('/admin/tracking/deliveries').catch(() => ({ data: { deliveries: [] } })),
        api.get('/messages/contacts').catch(() => ({ data: { contacts: [], teamMembers: [], drivers: [] } }))
      ]);

      let newDrivers: OpDriver[] = [];

      if (driversResp.status === 'fulfilled') {
        newDrivers = (driversResp.value.data as { drivers?: OpDriver[] }).drivers || [];
        setDrivers(newDrivers);
      }

      if (contactsResp.status === 'fulfilled') {
        const contactsData = contactsResp.value.data as ContactsResponse;
        setContacts(contactsData?.contacts || []);
        setTeamMembers(contactsData?.teamMembers || []);
      }

      if (deliveriesResp.status === 'fulfilled') {
        const deliveryData = (deliveriesResp.value.data as { deliveries?: OpDelivery[] }).deliveries || [];
        setDeliveries(deliveryData);
        const newAlerts = generateAlerts(deliveryData, newDrivers);
        setAlerts(newAlerts);
      }

      setLastUpdate(new Date());
      void loadOnlineStatus(true);
    } catch (e: unknown) {
      console.error('Error loading operations data:', e);
    } finally {
      setLoading(false);
      loadingDataRef.current = false;
    }
  };

  useEffect(() => {
    void loadData();
    void loadOnlineStatus(false);

    const handleVisChange = (): void => {
      if (!document.hidden) { void loadData(); void loadOnlineStatus(true); }
    };
    document.addEventListener('visibilitychange', handleVisChange);

    const handleDeliveriesUpdated = (): void => { void loadData(); };
    const handleDeliveryStatusUpdated = (): void => { void loadData(); };
    window.addEventListener('deliveriesUpdated', handleDeliveriesUpdated);
    window.addEventListener('deliveryStatusUpdated', handleDeliveryStatusUpdated);

    const onlineInterval = setInterval(() => {
      if (!document.hidden) void loadOnlineStatus(true);
    }, 15000);

    // Keep operations map/data truly live while page is visible.
    const trackingInterval = setInterval(() => {
      if (!document.hidden) void loadData();
    }, 5000);

    return () => {
      document.removeEventListener('visibilitychange', handleVisChange);
      window.removeEventListener('deliveriesUpdated', handleDeliveriesUpdated);
      window.removeEventListener('deliveryStatusUpdated', handleDeliveryStatusUpdated);
      clearInterval(onlineInterval);
      clearInterval(trackingInterval);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const tab = params.get('tab');
    const driverId = params.get('driverId') || params.get('userId');
    const allowedTabs = new Set(['monitoring', 'control', 'communication']);
    if (tab === 'delivery-tracking') {
      setActiveTab('monitoring');
      return;
    }
    if (tab && allowedTabs.has(tab) && tab !== activeTab) {
      setActiveTab(tab);
    } else if (driverId && activeTab !== 'communication') {
      setActiveTab('communication');
    }
  }, [location.search, activeTab]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const driverId = params.get('driverId') || params.get('userId');
    if (!driverId || drivers.length === 0) return;
    const match = drivers.find(driver => String(driver.id) === String(driverId));
    if (match && String(selectedDriver?.id) !== String(match.id)) {
      setSelectedDriver(match);
    }
  }, [location.search, drivers, selectedDriver]);

  useEffect(() => {
    if (contacts.length > 0) void loadOnlineStatus(true);
  }, [contacts.length]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (selectedDriver?.id) {
      void loadMessages(selectedDriver.id);
      messagePollingIntervalRef.current = setInterval(() => {
        if (!document.hidden && activeTab === 'communication') {
          void loadMessages(selectedDriver.id!, true);
        }
      }, 30000);
    }
    return () => {
      if (messagePollingIntervalRef.current) {
        clearInterval(messagePollingIntervalRef.current);
        messagePollingIntervalRef.current = null;
      }
    };
  }, [selectedDriver, activeTab]);

  useEffect(() => {
    if (activeTab !== 'communication') return;
    void loadUnreadCounts();
    const interval = setInterval(() => {
      if (!document.hidden) void loadUnreadCounts();
    }, 60000);
    return () => clearInterval(interval);
  }, [activeTab, loadUnreadCounts]);

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  /* Road-following route for map (OSRM) — only recalculates when the actual
     delivery coordinates change, not on every 5-second poll cycle.
     Only active (non-terminal) deliveries are routed — completed/cancelled
     stops are excluded so the route only covers work still to be done. */
  useEffect(() => {
    const pts = deliveries
      .filter((d) => !TERMINAL_STATUSES.has((d.status || '').toLowerCase()))
      .map((d) => {
        const lat = d.lat ?? d.Lat;
        const lng = d.lng ?? d.Lng;
        return lat != null && lng != null ? [Number(lat), Number(lng)] as [number, number] : null;
      })
      .filter(
        (p): p is [number, number] =>
          p != null &&
          Number.isFinite(p[0]) &&
          Number.isFinite(p[1]) &&
          p[0] >= -90 &&
          p[0] <= 90 &&
          p[1] >= -180 &&
          p[1] <= 180,
      );

    if (pts.length === 0) {
      setRoadRoute(null);
      setRouteLegDurationsSec([]);
      lastRouteKeyRef.current = '';
      return;
    }

    // Build a stable key from the coordinate values — skip recalculation if
    // coordinates haven't actually changed (prevents OSRM calls every 5 s).
    const newKey = pts.map(([la, ln]) => `${la.toFixed(4)},${ln.toFixed(4)}`).join('|');
    if (newKey === lastRouteKeyRef.current) return;
    lastRouteKeyRef.current = newKey;

    const locations = [{ lat: 25.0053, lng: 55.0760 }, ...pts.map(([lat, lng]) => ({ lat, lng }))];
    if (locations.length < 2) {
      setRoadRoute(null);
      setRouteLegDurationsSec([]);
      return;
    }

    setRouteLoading(true);
    calculateRoute(locations, deliveries as unknown as import('../types').Delivery[], false)
      .then((result) => {
        setRoadRoute({ coordinates: result.coordinates });
        const legs = Array.isArray(result.legs) ? result.legs : [];
        const durations = legs
          .map((leg) => Number((leg as { duration?: number }).duration))
          .filter((v) => Number.isFinite(v) && v > 0);
        setRouteLegDurationsSec(durations);
      })
      .catch(() => {
        // On OSRM failure show no route rather than confusing straight lines.
        setRoadRoute(null);
        setRouteLegDurationsSec([]);
      })
      .finally(() => setRouteLoading(false));
  }, [deliveries]);

  const loadMessages = async (driverId: string, silent = false): Promise<void> => {
    if (!driverId) return;
    if (!silent) setLoadingMessages(true);
    try {
      const response = await api.get(`/messages/conversations/${driverId}`);
      const messagesData = (response.data as { messages?: ChatMessage[] })?.messages || [];
      setMessages(messagesData);
    } catch (error: unknown) {
      if (!silent) {
        const e = error as { response?: { data?: unknown } };
        console.error('Failed to load messages:', error);
        console.error('Error details:', e.response?.data);
      }
      setMessages([]);
    } finally {
      if (!silent) setLoadingMessages(false);
    }
  };

  const handleSendMessage = async (): Promise<void> => {
    if (!newMessage.trim() || !selectedDriver) return;
    const messageText = newMessage.trim();
    setSendingMessage(true);
    try {
      const response = await api.post('/messages/send', {
        driverId: selectedDriver.id,
        content: messageText
      });
      const sentMsg = (response.data as { message?: ChatMessage })?.message;
      if (sentMsg) {
        setMessages(prev => [...prev, { ...sentMsg, from: 'admin', senderRole: 'admin', text: sentMsg.content }]);
      }
      setNewMessage('');
    } catch (error: unknown) {
      const e = error as { message?: string; response?: { data?: { error?: string } } };
      console.error('Failed to send message:', error);
      window.alert(`Failed to send message: ${e.response?.data?.error || e.message}`);
    } finally {
      setSendingMessage(false);
    }
  };

  const isDriverOnline = (driver: OpDriver): boolean => {
    const ONLINE_FALLBACK_WINDOW_MS = 15 * 60 * 1000;
    const driverAny = driver as any;
    const driverIdStr = driverAny.id?.toString();
    const driverIdNum = driverAny.id;

    if (
      onlineUserIds.has(driverIdStr) ||
      onlineUserIds.has(driverIdNum) ||
      onlineUserIds.has(String(driverIdNum)) ||
      driverAny.tracking?.online
    ) {
      return true;
    }
    if (driver.account?.lastLogin) {
      return new Date(driver.account.lastLogin) >= new Date(Date.now() - ONLINE_FALLBACK_WINDOW_MS);
    }
    return false;
  };

  const onlineDrivers = drivers.filter(d => isDriverOnline(d));

  // Active = not yet in a terminal status (still needs action).
  const activeDeliveries = deliveries.filter(
    d => !TERMINAL_STATUSES.has((d.status || '').toLowerCase())
  );

  const getItemCount = (delivery: OpDelivery): number => {
    const items = delivery.items as unknown;
    if (Array.isArray(items)) return items.length;
    const itemText = (delivery.items as string) || (delivery.item as string) || '';
    if (typeof itemText !== 'string') return 1;
    const normalized = itemText.trim();
    if (!normalized) return 1;
    return normalized.split(',').filter(Boolean).length;
  };

  const estimateMinutes = (delivery: OpDelivery, index: number): number | null => {
    const etaRaw = delivery?.tracking?.eta;
    if (etaRaw) {
      const etaDate = new Date(etaRaw);
      if (!Number.isNaN(etaDate.getTime())) {
        return Math.max(0, Math.round((etaDate.getTime() - Date.now()) / 60000));
      }
    }
    const speedMps = Number(
      (delivery as unknown as { tracking?: { lastLocation?: { speed?: number }; location?: { speed?: number } } })
        ?.tracking?.lastLocation?.speed ||
      (delivery as unknown as { tracking?: { location?: { speed?: number } } })?.tracking?.location?.speed ||
      0
    );
    const remainingKm = Number((delivery as unknown as { remainingDistanceKm?: number; distanceFromWarehouse?: number }).remainingDistanceKm || (delivery as unknown as { distanceFromWarehouse?: number }).distanceFromWarehouse || 0);
    if (speedMps > 0 && remainingKm > 0) {
      const speedKmh = speedMps * 3.6;
      const mins = (remainingKm / speedKmh) * 60;
      if (Number.isFinite(mins)) return Math.max(0, Math.round(mins));
    }

    // Fallback ETA from current optimized route legs.
    if (routeLegDurationsSec.length > 0) {
      const upto = Math.min(index + 1, routeLegDurationsSec.length);
      if (upto > 0) {
        const cumulativeSec = routeLegDurationsSec
          .slice(0, upto)
          .reduce((sum, sec) => sum + sec, 0);
        return Math.max(1, Math.round(cumulativeSec / 60));
      }
    }
    return null;
  };

  const deliveriesWithEta = deliveries.map((d, index) => {
    const lat = d.lat ?? d.Lat;
    const lng = d.lng ?? d.Lng;
    const etaMinutes = estimateMinutes(d, index);
    const itemCount = getItemCount(d);
    return {
      ...d,
      lat,
      lng,
      etaMinutes,
      itemCount,
      etaPerItemMinutes: etaMinutes != null && itemCount > 0 ? Math.max(1, Math.round(etaMinutes / itemCount)) : null
    };
  });

  // Use OSRM road-following route only — no straight-line fallback so the map
  // never shows misleading direct-line segments.  The map simply shows no
  // route line while OSRM is loading and snaps to the real road path once it
  // resolves (typically within a few seconds).
  const mapRoute = roadRoute;

  const driverLocations = drivers
    .filter(d => isDriverOnline(d))
    .map(driver => ({
      id: driver.id,
      name: driver.full_name || driver.fullName || driver.username || 'Driver',
      status: driver.tracking?.status || 'online',
      speedKmh: driver.tracking?.location?.speed != null ? Math.round(driver.tracking.location.speed * 3.6) : null,
      lat: driver.tracking?.location?.lat,
      lng: driver.tracking?.location?.lng,
    }))
    .filter(driver => Number.isFinite(Number(driver.lat)) && Number.isFinite(Number(driver.lng)));

  // Assigned = active AND has a driver assigned (in-flight work).
  const assignedDeliveries = activeDeliveries.filter(
    d => d.tracking?.driverId || d.assignedDriverId || d.tracking?.assigned
  );
  // Completed = any terminal status (delivered, cancelled, returned, etc.).
  const completedDeliveries = deliveries.filter(
    d => TERMINAL_STATUSES.has((d.status || '').toLowerCase())
  );

  // In Progress = active deliveries that have been picked up and are being delivered.
  const inProgressDeliveries = activeDeliveries.filter(
    d => ['in_progress', 'in-progress', 'in-transit', 'out-for-delivery', 'out_for_delivery'].includes(
      (d.tracking?.status || d.status || '').toLowerCase()
    )
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600 dark:text-gray-400">Loading operations center...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 w-full min-w-0">
      {/* Header */}
      <div className="pp-page-header flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="pp-page-title">Operations Center</h1>
          <p className="pp-page-subtitle">
            Last updated: {lastUpdate.toLocaleTimeString()}
            <span className="ml-2 text-green-600 dark:text-green-400">● Live</span>
          </p>
        </div>
      </div>

      {/* Tab Navigation — PolicyPilot pill rail */}
      <div className="pp-sticky-tab-rail rounded-2xl bg-gray-100/80 dark:bg-white/[0.06] p-1.5 border border-gray-200/60 dark:border-white/[0.07]">
        <nav className="flex flex-wrap gap-1 overflow-x-auto">
          {([
            { id: 'monitoring',       label: 'Monitoring & Tracking', icon: Activity      },
            { id: 'control',          label: 'Control',            icon: Settings      },
            { id: 'communication',    label: 'Communication',      icon: MessageSquare },
          ] as { id: string; label: string; icon: React.ElementType }[]).map(tab => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium whitespace-nowrap rounded-xl transition-all ${
                  activeTab === tab.id
                    ? 'bg-white dark:bg-slate-800 text-blue-600 dark:text-blue-400 shadow-sm'
                    : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 hover:bg-white/60 dark:hover:bg-slate-700/50'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                {tab.label}
                {tab.id === 'alerts' && alerts.length > 0 && (
                  <span className="ml-1 bg-red-500 text-white text-xs rounded-full px-2 py-0.5 font-semibold">
                    {alerts.length}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Tab Content */}
      <div key={activeTab} className="tab-enter">

      {/* ══════════ MONITORING ══════════ */}
      {activeTab === 'monitoring' && (
        <div className="space-y-6">
          <div className="pp-kpi-grid pp-kpi-grid--six">
            {([
              // "Active" = pending/in-progress, not yet terminal. This is the actionable workload.
              { label: 'Active Deliveries',   value: activeDeliveries.length,    icon: Truck,       bg: 'bg-blue-50 dark:bg-blue-900/20',     ic: 'text-blue-600 dark:text-blue-400',     val: 'text-blue-700 dark:text-blue-300'    },
              // "Assigned" = subset of active that already have a driver.
              { label: 'Assigned to Driver',  value: assignedDeliveries.length,  icon: Package,     bg: 'bg-amber-50 dark:bg-amber-900/20',   ic: 'text-amber-600 dark:text-amber-400',   val: 'text-amber-700 dark:text-amber-300'  },
              // "Completed" = delivered / cancelled / returned — done, no action needed.
              { label: 'Completed',           value: completedDeliveries.length, icon: CheckCircle, bg: 'bg-emerald-50 dark:bg-emerald-900/20',ic: 'text-emerald-600 dark:text-emerald-400',val: 'text-emerald-700 dark:text-emerald-300'},
              { label: 'Online Drivers',      value: onlineDrivers.length,       icon: Users,       bg: 'bg-green-50 dark:bg-green-900/20',   ic: 'text-green-600 dark:text-green-400',   val: 'text-green-700 dark:text-green-300'  },
              { label: 'Drivers w/ GPS',      value: drivers.filter(d => d.tracking?.location).length, icon: MapPin, bg: 'bg-purple-50 dark:bg-purple-900/20', ic: 'text-purple-600 dark:text-purple-400', val: 'text-purple-700 dark:text-purple-300'},
              { label: 'Active Alerts',       value: alerts.length,              icon: AlertCircle, bg: 'bg-red-50 dark:bg-red-900/20',       ic: 'text-red-600 dark:text-red-400',       val: 'text-red-700 dark:text-red-300'      },
            ] as { label: string; value: number; icon: React.ElementType; bg: string; ic: string; val: string }[]).map(({ label, value, icon: Icon, bg, ic, val }) => (
              <div key={label} className="pp-dash-card p-4 w-full min-w-0">
                <div className="flex items-start gap-3">
                  <div className={`p-2.5 rounded-full shrink-0 ${bg}`}><Icon className={`w-4 h-4 ${ic}`} /></div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide leading-snug">{label}</p>
                    <p className={`text-2xl font-bold tracking-tight ${val} mt-1`}>{value}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
            <div className="lg:col-span-3 pp-dash-card overflow-hidden transition-colors">
              <div className="p-4 bg-gray-50 dark:bg-gray-700 border-b dark:border-gray-600 flex items-center justify-between gap-2">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Live Operations Map (Tracking + Deliveries + Route)</h2>
                {routeLoading && (
                  <span className="text-xs text-blue-600 dark:text-blue-400 font-medium">Calculating road route…</span>
                )}
              </div>
              <div className="relative">
                <DeliveryMap
                  deliveries={deliveriesWithEta.filter(d =>
                    // Only show active (non-terminal) deliveries — completed/cancelled from
                    // previous days must not appear as stale markers on the live map.
                    !TERMINAL_STATUSES.has((d.status || '').toLowerCase()) &&
                    // Only render a marker when we have real, finite coordinates.
                    d.lat != null && d.lng != null &&
                    Number.isFinite(Number(d.lat)) && Number.isFinite(Number(d.lng))
                  ) as unknown as import('../types').Delivery[]}
                  route={mapRoute as unknown as import('../types').RouteResult}
                  driverLocations={driverLocations}
                  mapClassName="h-[320px] sm:h-[420px] lg:h-[560px]"
                />
              </div>
            </div>

            <div className="lg:col-span-2 pp-dash-card p-5 transition-colors">
              {/* Active (non-terminal) deliveries only, sorted by urgency */}
              {(() => {
                const ORDER = ['out-for-delivery','in-progress','in_progress','out_for_delivery','assigned'];
                const activeEta = deliveriesWithEta
                  .filter(d => !TERMINAL_STATUSES.has((d.status || '').toLowerCase()))
                  .sort((a, b) => {
                    const ai = ORDER.indexOf((a.status || '').toLowerCase());
                    const bi = ORDER.indexOf((b.status || '').toLowerCase());
                    const aIdx = ai === -1 ? 99 : ai;
                    const bIdx = bi === -1 ? 99 : bi;
                    if (aIdx !== bIdx) return aIdx - bIdx;
                    return Number((a as unknown as {priority?: number}).priority ?? 3) - Number((b as unknown as {priority?: number}).priority ?? 3);
                  });
                return (
                  <>
                    <div className="flex items-center justify-between mb-4">
                      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                        Active Deliveries
                        <span className="ml-2 text-sm font-normal text-gray-500 dark:text-gray-400">({activeEta.length})</span>
                      </h2>
                      {activeEta.filter(d => ['out-for-delivery','out_for_delivery','in-progress','in_progress'].includes((d.status||'').toLowerCase())).length > 0 && (
                        <span className="text-xs font-medium text-blue-600 dark:text-blue-400">
                          {activeEta.filter(d => ['out-for-delivery','out_for_delivery','in-progress','in_progress'].includes((d.status||'').toLowerCase())).length} out for delivery
                        </span>
                      )}
                    </div>
                    <div className="space-y-3 max-h-[560px] overflow-y-auto pr-1">
                      {activeEta.slice(0, 20).map((delivery, stopIdx) => {
                        const poNum = delivery.poNumber || delivery.PONumber || (delivery.metadata as { originalPONumber?: string })?.originalPONumber || '';
                        const deliveryNum = (delivery.metadata as { originalDeliveryNumber?: string } | null | undefined)?.originalDeliveryNumber || (delivery as unknown as { _originalDeliveryNumber?: string })._originalDeliveryNumber || '';
                        const customer = delivery.customer || delivery.Customer || 'Unknown';
                        const address = String(delivery.address || delivery.Address || '');
                        const driverId = delivery.tracking?.driverId || delivery.assignedDriverId;
                        const driver = drivers.find(d => String(d.id) === String(driverId));
                        const driverName = driver ? (driver.full_name || driver.fullName || driver.username || 'Driver') : null;
                        const eta = (delivery as unknown as { etaMinutes?: number }).etaMinutes;
                        const itemCount = (delivery as unknown as { itemCount?: number }).itemCount || 1;
                        const statusInfo = getStatusDisplay(delivery.status);
                        const priorityInfo = getPriorityDisplay((delivery as unknown as {priority?: number}).priority);
                        return (
                          <div key={String(delivery.id || delivery.ID || stopIdx)}
                            className={`p-3 border border-gray-200 dark:border-gray-700 rounded-lg border-l-4 ${priorityInfo.border}`}>
                            <div className="flex items-center justify-between mb-1">
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="text-xs font-bold text-gray-500 dark:text-gray-400 shrink-0">Stop {stopIdx + 1}</span>
                              </div>
                              <span className={`px-2 py-0.5 text-xs font-medium rounded-full shrink-0 ml-2 ${statusInfo.color}`}>
                                {statusInfo.label}
                              </span>
                            </div>
                            {/* PO Number + Delivery Number — tracking identifiers */}
                            <div className="flex flex-wrap gap-x-3 gap-y-0.5 mb-1.5">
                              <span className="text-[11px] text-gray-500 dark:text-gray-400">
                                PO: <span className="font-mono font-semibold text-blue-700 dark:text-blue-300">{poNum || '—'}</span>
                              </span>
                              <span className="text-[11px] text-gray-500 dark:text-gray-400">
                                Del: <span className="font-mono font-semibold text-indigo-700 dark:text-indigo-300">{deliveryNum || '—'}</span>
                              </span>
                            </div>
                            <div className="text-sm text-gray-700 dark:text-gray-300 font-medium truncate">{customer}</div>
                            {address && (
                              <div className="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5">{address.slice(0, 55)}{address.length > 55 ? '…' : ''}</div>
                            )}
                            <div className="flex items-center justify-between mt-2 text-xs text-gray-500 dark:text-gray-400">
                              <div className="flex items-center gap-3">
                                {driverName && (
                                  <span>🚚 {driverName}</span>
                                )}
                                <span>{itemCount} item{itemCount !== 1 ? 's' : ''}</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className={`px-1.5 py-0.5 rounded text-xs ${priorityInfo.color}`}>{priorityInfo.label}</span>
                                <span className="font-medium text-gray-700 dark:text-gray-300">
                                  {eta != null ? `ETA ${eta} min` : 'ETA —'}
                                </span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                      {activeEta.length === 0 && (
                        <div className="text-center py-8 text-gray-500 dark:text-gray-400">No active deliveries</div>
                      )}
                    </div>
                  </>
                );
              })()}
            </div>
          </div>

          <div className="pp-dash-card p-5 transition-colors">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Delivery Tracking Overview</h2>
              <span className="text-xs text-gray-500 dark:text-gray-400">Unified monitoring + tracking view</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4">
                <div className="text-xs text-gray-600 dark:text-gray-400 mb-1">Total Deliveries</div>
                <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">{deliveries.length}</div>
              </div>
              <div className="bg-purple-50 dark:bg-purple-900/20 rounded-lg p-4">
                <div className="text-xs text-gray-600 dark:text-gray-400 mb-1">Assigned</div>
                <div className="text-2xl font-bold text-purple-600 dark:text-purple-400">{assignedDeliveries.length}</div>
              </div>
              <div className="bg-yellow-50 dark:bg-yellow-900/20 rounded-lg p-4">
                <div className="text-xs text-gray-600 dark:text-gray-400 mb-1">In Progress</div>
                <div className="text-2xl font-bold text-yellow-600 dark:text-yellow-400">{inProgressDeliveries.length}</div>
              </div>
              <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-4">
                <div className="text-xs text-gray-600 dark:text-gray-400 mb-1">Completed</div>
                <div className="text-2xl font-bold text-green-600 dark:text-green-400">{completedDeliveries.length}</div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
            <div className="lg:col-span-2 pp-dash-card p-4 transition-colors">
              <h2 className="text-lg font-semibold mb-4 text-gray-900 dark:text-gray-100">Driver Status</h2>
              <div className="space-y-3 max-h-[560px] overflow-y-auto pr-1">
                {drivers.map(driver => {
                  const driverName = driver.full_name || driver.name || driver.username || 'Unknown';
                  const online = isDriverOnline(driver);
                  const loc = driver.tracking?.location;
                  const statusLabel = driver.tracking?.status || (online ? 'online' : 'offline');
                  const lastSeen = loc?.timestamp || driver.tracking?.lastUpdate;
                  return (
                    <div key={driver.id} className="p-3 border border-gray-200 dark:border-gray-700 rounded-lg">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <div className={`w-2.5 h-2.5 rounded-full ${online ? 'bg-green-500' : 'bg-gray-400'}`} />
                            <span className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">{driverName}</span>
                          </div>
                          {driver.phone && (
                            <div className="text-xs text-gray-500 dark:text-gray-400 mt-1 truncate">{driver.phone}</div>
                          )}
                        </div>
                        <span className={`px-2 py-1 text-[11px] font-semibold rounded-full whitespace-nowrap ${online ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300' : 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-300'}`}>
                          {statusLabel}
                        </span>
                      </div>
                      <div className="mt-2 text-xs text-gray-500 dark:text-gray-400 space-y-1">
                        <div>
                          {loc
                            ? `${loc.lat.toFixed(4)}, ${loc.lng.toFixed(4)}`
                            : 'No location'}
                        </div>
                        <div>
                          {loc?.speed != null
                            ? `${(loc.speed * 3.6).toFixed(0)} km/h`
                            : 'Speed unavailable'}
                        </div>
                        <div>
                          Last update: {lastSeen ? new Date(lastSeen).toLocaleTimeString() : 'N/A'}
                        </div>
                      </div>
                    </div>
                  );
                })}
                {drivers.length === 0 && <div className="text-center py-8 text-gray-500 dark:text-gray-400">No drivers found</div>}
              </div>
            </div>

            <div className="lg:col-span-3 pp-dash-card p-5 transition-colors">
              {/* On-going deliveries only (non-terminal), sorted by status urgency then priority */}
              {(() => {
                const STATUS_ORDER = ['out-for-delivery','out_for_delivery','in-progress','in_progress','assigned','pending'];
                const ongoingRows = deliveriesWithEta
                  .filter(d => !TERMINAL_STATUSES.has((d.status || '').toLowerCase()))
                  .sort((a, b) => {
                    const ai = STATUS_ORDER.indexOf((a.status || '').toLowerCase());
                    const bi = STATUS_ORDER.indexOf((b.status || '').toLowerCase());
                    const aIdx = ai === -1 ? 99 : ai;
                    const bIdx = bi === -1 ? 99 : bi;
                    if (aIdx !== bIdx) return aIdx - bIdx;
                    return Number((a as unknown as {priority?: number}).priority ?? 3) - Number((b as unknown as {priority?: number}).priority ?? 3);
                  });
                const now = Date.now();
                return (
                  <>
                    <div className="flex items-center justify-between mb-4">
                      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                        On-Going Deliveries
                        <span className="ml-2 text-sm font-normal text-gray-500 dark:text-gray-400">({ongoingRows.length} active)</span>
                      </h2>
                    </div>
                    <div className="overflow-x-auto max-h-[560px] overflow-y-auto">
                      <table className="pp-mobile-stack-table min-w-[720px] w-full divide-y divide-gray-200 dark:divide-gray-700">
                        <thead className="bg-gray-50 dark:bg-gray-700 sticky top-0 z-10">
                          <tr>
                            {['#', 'Order', 'Customer & Address', 'Status', 'Driver', 'Priority', 'ETA', 'GPS'].map(h => (
                              <th key={h} className="px-3 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-300 uppercase tracking-wider whitespace-nowrap">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                          {ongoingRows.map((delivery, idx) => {
                            const tracking = delivery.tracking || {};
                            const loc = tracking.lastLocation as { lat: number; lng: number; timestamp?: string } | undefined;
                            const driverId = tracking.driverId || delivery.assignedDriverId;
                            const driver = drivers.find(d => String(d.id) === String(driverId));
                            const driverName = driver
                              ? (driver.full_name || driver.fullName || driver.username || `Driver ${driver.id}`)
                              : null;
                            const poNum = delivery.poNumber || delivery.PONumber || (delivery.metadata as { originalPONumber?: string })?.originalPONumber || `—`;
                            const customer = delivery.customer || delivery.Customer || 'Unknown';
                            const address = String(delivery.address || delivery.Address || '');
                            const eta = (delivery as unknown as { etaMinutes?: number }).etaMinutes;
                            const itemCount = (delivery as unknown as { itemCount?: number }).itemCount || 1;
                            const statusInfo = getStatusDisplay(delivery.status);
                            const priorityInfo = getPriorityDisplay((delivery as unknown as {priority?: number}).priority);
                            // GPS freshness
                            let gpsCell: React.ReactNode = <span className="text-gray-400 dark:text-gray-500 text-xs">No GPS</span>;
                            if (loc?.timestamp) {
                              const ageMins = Math.round((now - new Date(loc.timestamp).getTime()) / 60000);
                              if (ageMins < 2) {
                                gpsCell = <span className="flex items-center gap-1 text-green-600 dark:text-green-400 text-xs font-medium"><span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse inline-block" />Live</span>;
                              } else {
                                gpsCell = <span className="text-xs text-gray-500 dark:text-gray-400">{ageMins}m ago</span>;
                              }
                            } else if (loc) {
                              gpsCell = <span className="text-xs text-gray-500 dark:text-gray-400">GPS active</span>;
                            }
                            return (
                              <tr key={String(delivery.id || delivery.ID || idx)} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                                <td className="px-3 py-3 text-xs text-gray-500 dark:text-gray-400 font-medium whitespace-nowrap" data-label="#">{idx + 1}</td>
                                <td className="px-3 py-3 whitespace-nowrap" data-label="Order">
                                  <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">{poNum}</span>
                                  <div className="text-xs text-gray-400 dark:text-gray-500">{itemCount} item{itemCount !== 1 ? 's' : ''}</div>
                                </td>
                                <td className="px-3 py-3 max-w-[200px]" data-label="Customer & Address">
                                  <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{customer}</div>
                                  <div className="text-xs text-gray-500 dark:text-gray-400 truncate">{address.slice(0, 50)}{address.length > 50 ? '…' : ''}</div>
                                </td>
                                <td className="px-3 py-3 whitespace-nowrap" data-label="Status">
                                  <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${statusInfo.color}`}>
                                    {statusInfo.label}
                                  </span>
                                </td>
                                <td className="px-3 py-3 whitespace-nowrap text-sm text-gray-600 dark:text-gray-300" data-label="Driver">
                                  {driverName || <span className="text-gray-400 dark:text-gray-500 italic">Unassigned</span>}
                                </td>
                                <td className="px-3 py-3 whitespace-nowrap" data-label="Priority">
                                  <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${priorityInfo.color}`}>
                                    {priorityInfo.label}
                                  </span>
                                </td>
                                <td className="px-3 py-3 whitespace-nowrap text-sm font-medium text-gray-700 dark:text-gray-300" data-label="ETA">
                                  {eta != null ? `${eta} min` : <span className="text-gray-400 dark:text-gray-500 text-xs">—</span>}
                                </td>
                                <td className="px-3 py-3 whitespace-nowrap" data-label="GPS">{gpsCell}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                      {ongoingRows.length === 0 && (
                        <div className="text-center py-10 text-gray-500 dark:text-gray-400">No on-going deliveries</div>
                      )}
                    </div>
                  </>
                );
              })()}
            </div>
          </div>

        </div>
      )}

      {/* ══════════ CONTROL ══════════ */}
      {activeTab === 'control' && (
        <div className="space-y-6">
          <div className="pp-dash-card p-5 transition-colors">
            <h2 className="text-2xl font-bold mb-4 text-gray-900 dark:text-gray-100">Delivery Assignment Control</h2>
            <p className="text-gray-600 dark:text-gray-400 mb-4">Assign and reassign deliveries to drivers.</p>

            {assignmentMessage && (
              <div className={`mb-4 p-4 rounded-lg ${
                assignmentMessage.type === 'success'
                  ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300'
                  : 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300'
              }`}>
                {assignmentMessage.text}
              </div>
            )}

            <div className="pp-kpi-grid">
              {[
                { label: 'Total Deliveries', value: deliveries.length, color: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-50 dark:bg-blue-900/20' },
                { label: 'Assigned',         value: deliveries.filter(d => d.tracking?.driverId || d.assignedDriverId).length, color: 'text-green-600 dark:text-green-400', bg: 'bg-green-50 dark:bg-green-900/20' },
                { label: 'Unassigned',       value: deliveries.filter(d => !d.tracking?.driverId && !d.assignedDriverId).length, color: 'text-yellow-600 dark:text-yellow-400', bg: 'bg-yellow-50 dark:bg-yellow-900/20' },
                { label: 'Available Drivers',value: drivers.length, color: 'text-indigo-600 dark:text-indigo-400', bg: 'bg-indigo-50 dark:bg-indigo-900/20' },
              ].map(({ label, value, color, bg }) => (
                <div key={label} className="pp-dash-card p-4 w-full min-w-0">
                  <div className={`rounded-xl p-3 ${bg}`}>
                    <div className="text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide">{label}</div>
                    <div className={`text-2xl font-bold ${color} mt-1`}>{value}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="pp-dash-card overflow-hidden transition-colors">
            <div className="overflow-x-auto">
              <table className="pp-mobile-stack-table min-w-[760px] divide-y divide-gray-200 dark:divide-gray-700">
                <thead className="bg-gray-50 dark:bg-gray-700">
                  <tr>
                    {['PO Number', 'Delivery Number', 'Customer', 'Address', 'Status', 'Assigned Driver', 'Change Assignment'].map(h => (
                      <th key={h} className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                  {deliveries.length > 0 ? (
                    deliveries
                      .filter(delivery => !!(delivery.tracking?.driverId || delivery.assignedDriverId))
                      .map(delivery => {
                        const currentDriverId = delivery.tracking?.driverId || delivery.assignedDriverId || '';
                        const currentDriver = drivers.find(d => d.id === currentDriverId);
                        return (
                          <tr key={String(delivery.id || '')} className="hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                            <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-gray-100" data-label="PO Number">
                              {delivery.poNumber || delivery.PONumber || delivery.metadata?.originalPONumber || 'N/A'}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400" data-label="Delivery Number">
                              {(delivery.metadata as { originalDeliveryNumber?: string } | null | undefined)?.originalDeliveryNumber || (delivery as unknown as { _originalDeliveryNumber?: string })._originalDeliveryNumber || '—'}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100" data-label="Customer">
                              {delivery.customer || delivery.Customer || 'Unknown'}
                            </td>
                            <td className="px-6 py-4 text-sm text-gray-500 dark:text-gray-400 max-w-xs truncate" data-label="Address">
                              {String(delivery.address || 'N/A')}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm" data-label="Status">
                              <span className={`px-2 py-1 rounded-full text-xs font-semibold ${
                                delivery.status === 'delivered' ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300' :
                                delivery.status === 'pending'   ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300' :
                                'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-300'
                              }`}>
                                {delivery.status || 'pending'}
                              </span>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm" data-label="Assigned Driver">
                              {currentDriver ? (
                                <div className="flex items-center gap-2">
                                  <div className="w-2 h-2 rounded-full bg-green-500" />
                                  <span className="text-gray-900 dark:text-gray-100 font-medium">
                                    {currentDriver.fullName || currentDriver.full_name || currentDriver.username}
                                  </span>
                                </div>
                              ) : (
                                <span className="text-gray-400 italic">Not assigned</span>
                              )}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm" data-label="Change Assignment">
                              <select
                                value={currentDriverId}
                                onChange={async (e: React.ChangeEvent<HTMLSelectElement>) => {
                                  const newDriverId = e.target.value;
                                  if (!newDriverId) return;
                                  const deliveryId = String(delivery.id || '');
                                  setAssigningDelivery(deliveryId);
                                  setAssignmentMessage(null);
                                  try {
                                    await api.put(`/deliveries/admin/${deliveryId}/assign`, { driverId: newDriverId });
                                    const assignedDriver = drivers.find(d => d.id === newDriverId);
                                    setAssignmentMessage({ type: 'success', text: `✓ Delivery assigned to ${assignedDriver?.fullName || 'driver'}` });
                                    setTimeout(() => void loadData(), 500);
                                  } catch (err: unknown) {
                                    const e = err as { message?: string; response?: { data?: { error?: string } } };
                                    console.error('Failed to assign delivery:', err);
                                    setAssignmentMessage({ type: 'error', text: `✗ Failed to assign delivery: ${e.response?.data?.error || e.message}` });
                                  } finally {
                                    setAssigningDelivery(null);
                                    setTimeout(() => setAssignmentMessage(null), 3000);
                                  }
                                }}
                                disabled={assigningDelivery === String(delivery.id || '')}
                                className={`px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-600 transition ${
                                  assigningDelivery === String(delivery.id || '') ? 'opacity-50 cursor-not-allowed' : ''
                                }`}
                              >
                                <option value="">Select driver...</option>
                                {drivers.map(driver => (
                                  <option key={driver.id} value={driver.id}>
                                    {driver.fullName || driver.full_name || driver.username}
                                  </option>
                                ))}
                              </select>
                            </td>
                          </tr>
                        );
                      })
                  ) : (
                    <tr>
                      <td colSpan={6} className="px-6 py-12 text-center text-gray-500 dark:text-gray-400">No deliveries found</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ══════════ DELIVERY TRACKING ══════════ */}
      {false && activeTab === 'delivery-tracking' && (() => {
        const deliveriesForMap = deliveries.map(d => ({
          ...d,
          lat: d.lat || d.Lat || d.tracking?.lastLocation?.lat || 25.1124,
          lng: d.lng || d.Lng || d.tracking?.lastLocation?.lng || 55.1980,
        }));
        const assignedDeliveries = deliveries.filter(d => d.tracking?.assigned);
        const inProgressDeliveries = deliveries.filter(d => d.tracking?.status === 'in_progress');
        const completedDeliveries = deliveries.filter(d => (d.status || '').toLowerCase() === 'delivered');
        return (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              {[
                { label: 'Total Deliveries', value: deliveries.length,           icon: Package,       color: 'text-blue-600 dark:text-blue-400',     bg: 'bg-blue-50 dark:bg-blue-900/20'     },
                { label: 'Assigned',         value: assignedDeliveries.length,   icon: MapPin,        color: 'text-purple-600 dark:text-purple-400', bg: 'bg-purple-50 dark:bg-purple-900/20' },
                { label: 'In Progress',      value: inProgressDeliveries.length, icon: Clock,         color: 'text-yellow-600 dark:text-yellow-400', bg: 'bg-yellow-50 dark:bg-yellow-900/20' },
                { label: 'Completed',        value: completedDeliveries.length,  icon: CheckCircle,   color: 'text-green-600 dark:text-green-400',   bg: 'bg-green-50 dark:bg-green-900/20'   },
              ].map(({ label, value, icon: Icon, color, bg }) => (
                <div key={label} className="pp-dash-card p-5">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm text-gray-600 dark:text-gray-400 mb-1">{label}</div>
                      <div className={`text-3xl font-bold ${color}`}>{value}</div>
                    </div>
                    <div className={`p-3 ${bg} rounded-lg`}><Icon className={`w-6 h-6 ${color}`} /></div>
                  </div>
                </div>
              ))}
            </div>

            {deliveriesForMap.length > 0 && (
              <div className="pp-dash-card overflow-hidden">
                <DeliveryMap deliveries={deliveriesForMap as unknown as import('../types').Delivery[]} route={null} />
              </div>
            )}

            <div className="pp-dash-card p-5">
              <h2 className="text-xl font-semibold mb-4 text-gray-900 dark:text-gray-100">Delivery Status</h2>
              <div className="overflow-x-auto">
                <table className="pp-mobile-stack-table min-w-[760px] divide-y divide-gray-200 dark:divide-gray-700">
                  <thead className="bg-gray-50 dark:bg-gray-700">
                    <tr>
                      {['Delivery', 'Status', 'Driver', 'Assigned At', 'Location'].map(h => (
                        <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                    {deliveries.slice(0, 50).map(delivery => {
                      const tracking = delivery.tracking || {};
                      const loc = tracking.lastLocation;
                      return (
                        <tr key={String(delivery.id || delivery.ID || '')} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                          <td className="px-4 py-3" data-label="Delivery">
                            <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{delivery.customer || delivery.Customer || 'Unknown'}</div>
                            <div className="text-sm text-gray-500 dark:text-gray-400">{String(delivery.address || delivery.Address || 'N/A')}</div>
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap" data-label="Status">
                            <span className={`px-2 py-1 text-xs font-semibold rounded-full ${
                              tracking.status === 'in_progress' ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300'
                                : tracking.assigned             ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300'
                                : 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-300'
                            }`}>
                              {tracking.status || delivery.status || 'unassigned'}
                            </span>
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400" data-label="Driver">{tracking.driverId || 'Unassigned'}</td>
                          <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400" data-label="Assigned At">
                            {tracking.assignedAt ? new Date(tracking.assignedAt).toLocaleString() : 'N/A'}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400" data-label="Location">
                            {loc ? (
                              <div>
                                <div>{loc.lat.toFixed(4)}, {loc.lng.toFixed(4)}</div>
                                {loc.timestamp && <div className="text-xs text-gray-400">{new Date(loc.timestamp).toLocaleTimeString()}</div>}
                              </div>
                            ) : <span className="text-gray-400">No location</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {deliveries.length === 0 && <div className="text-center py-8 text-gray-500 dark:text-gray-400">No deliveries found</div>}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ══════════ COMMUNICATION ══════════ */}
      {activeTab === 'communication' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 min-h-[420px] lg:h-[calc(100vh-300px)]">
          {/* Contacts Sidebar */}
          <div className="pp-dash-card overflow-hidden flex flex-col transition-colors">
            <div className="p-4 bg-gray-50 dark:bg-gray-700 border-b dark:border-gray-600">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Contacts</h2>
              <input
                type="text"
                placeholder="Search contacts..."
                className="mt-2 w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="flex-1 overflow-y-auto">
              {teamMembers.length > 0 && (
                <>
                  <div className="px-4 py-2 bg-gray-100 dark:bg-gray-700/50">
                    <span className="text-xs font-medium text-gray-600 dark:text-gray-400 uppercase">Team</span>
                  </div>
                  {teamMembers.map(member => {
                    const online = isDriverOnline(member);
                    const isSelected = selectedDriver?.id === member.id;
                    const unreadCount = unreadByDriverId[member.id] || 0;
                    const roleBadge = getRoleBadge(member.account?.role || member.role);
                    return (
                      <button
                        key={member.id}
                        onClick={() => setSelectedDriver(member)}
                        className={`w-full p-4 border-b border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 text-left transition ${
                          isSelected ? 'bg-blue-50 dark:bg-blue-900/20 border-l-4 border-l-blue-600 dark:border-l-blue-400' : ''
                        }`}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            <div className="relative">
                              <div className={`w-3 h-3 rounded-full ${online ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`}>
                                {online && <div className="absolute inset-0 bg-green-500 rounded-full animate-ping opacity-75" />}
                              </div>
                            </div>
                            <span className="font-medium text-sm text-gray-900 dark:text-gray-100">
                              {member.full_name || member.fullName || member.username || 'Unknown'}
                            </span>
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${roleBadge.color}`}>{roleBadge.label}</span>
                            {online && <span className="text-xs text-green-600 dark:text-green-400 font-medium">• Active</span>}
                          </div>
                          {unreadCount > 0 && (
                            <span className="bg-red-500 text-white text-xs rounded-full px-2 py-0.5">{unreadCount}</span>
                          )}
                        </div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">
                          {online ? <span className="text-green-600 dark:text-green-400 font-medium">Active now</span> : <span>Offline</span>}
                        </div>
                      </button>
                    );
                  })}
                </>
              )}

              {drivers.length > 0 && (
                <>
                  <div className="px-4 py-2 bg-gray-100 dark:bg-gray-700/50">
                    <span className="text-xs font-medium text-gray-600 dark:text-gray-400 uppercase">Drivers</span>
                  </div>
                  {drivers.map(driver => {
                    const online = isDriverOnline(driver);
                    const isSelected = selectedDriver?.id === driver.id;
                    const unreadCount = unreadByDriverId[driver.id] || 0;
                    const roleBadge = getRoleBadge(driver.role);
                    return (
                      <button
                        key={driver.id}
                        onClick={() => setSelectedDriver(driver)}
                        className={`w-full p-4 border-b border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 text-left transition ${
                          isSelected ? 'bg-blue-50 dark:bg-blue-900/20 border-l-4 border-l-blue-600 dark:border-l-blue-400' : ''
                        }`}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            <div className="relative">
                              <div className={`w-3 h-3 rounded-full ${online ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`}>
                                {online && <div className="absolute inset-0 bg-green-500 rounded-full animate-ping opacity-75" />}
                              </div>
                            </div>
                            <span className="font-medium text-sm text-gray-900 dark:text-gray-100">
                              {driver.full_name || driver.fullName || driver.username || 'Unknown'}
                            </span>
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${roleBadge.color}`}>{roleBadge.label}</span>
                            {online && <span className="text-xs text-green-600 dark:text-green-400 font-medium">• Active</span>}
                          </div>
                          {unreadCount > 0 && (
                            <span className="bg-red-500 text-white text-xs rounded-full px-2 py-0.5">{unreadCount}</span>
                          )}
                        </div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">
                          {online ? <span className="text-green-600 dark:text-green-400 font-medium">Active now</span> : <span>Offline</span>}
                          {driver.tracking?.location && (
                            <span className="ml-2">
                              • {driver.tracking.location.speed != null
                                ? `${(driver.tracking.location.speed * 3.6).toFixed(0)} km/h`
                                : 'Stationary'}
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </>
              )}

              {contacts.length === 0 && (
                <div className="p-8 text-center text-gray-500 dark:text-gray-400">
                  <Users className="w-12 h-12 mx-auto mb-2 opacity-50" />
                  <p>No contacts available</p>
                </div>
              )}
            </div>
          </div>

          {/* Chat Area */}
          <div className="lg:col-span-2 pp-dash-card overflow-hidden flex flex-col transition-colors">
            {selectedDriver ? (
              <>
                {/* Chat Header */}
                <div className="p-4 bg-gray-50 dark:bg-gray-700 border-b dark:border-gray-600 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="relative">
                      <div className={`w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center ${isDriverOnline(selectedDriver) ? 'ring-2 ring-green-500/20' : ''}`}>
                        <Users className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                      </div>
                      {isDriverOnline(selectedDriver) && (
                        <div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 bg-green-500 border-2 border-white dark:border-gray-800 rounded-full animate-pulse">
                          <div className="absolute inset-0 bg-green-500 rounded-full animate-ping opacity-75" />
                        </div>
                      )}
                    </div>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold text-gray-900 dark:text-gray-100">
                          {selectedDriver.full_name || selectedDriver.fullName || selectedDriver.username || 'Unknown'}
                        </h3>
                        {(() => {
                          const roleBadge = getRoleBadge(selectedDriver.role);
                          return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${roleBadge.color}`}>{roleBadge.label}</span>;
                        })()}
                        {isDriverOnline(selectedDriver) && <span className="text-xs text-green-600 dark:text-green-400 font-medium">• Active</span>}
                      </div>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {isDriverOnline(selectedDriver)
                          ? <span className="text-green-600 dark:text-green-400 font-medium">Active now</span>
                          : <span>Offline</span>}
                        {selectedDriver.phone && ` • ${selectedDriver.phone}`}
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    {selectedDriver.phone && (
                      <a href={`tel:${selectedDriver.phone}`}
                        className="p-2 text-gray-600 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-gray-100 dark:hover:bg-gray-600 rounded-lg transition"
                        title="Call Driver">
                        <Phone className="w-5 h-5" />
                      </a>
                    )}
                    <button
                      onClick={() => window.alert('Location request sent')}
                      className="p-2 text-gray-600 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-gray-100 dark:hover:bg-gray-600 rounded-lg transition"
                      title="Request Location"
                    >
                      <MapPin className="w-5 h-5" />
                    </button>
                  </div>
                </div>

                {/* Messages Area */}
                <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50 dark:bg-gray-900">
                  {loadingMessages ? (
                    <div className="flex items-center justify-center h-full">
                      <div className="text-center text-gray-500 dark:text-gray-400">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 dark:border-blue-400 mx-auto mb-2"></div>
                        <p>Loading messages...</p>
                      </div>
                    </div>
                  ) : messages.length === 0 ? (
                    <div className="text-center py-12 text-gray-500 dark:text-gray-400">
                      <MessageSquare className="w-12 h-12 mx-auto mb-2 opacity-50" />
                      <p>No messages yet</p>
                      <p className="text-sm mt-1">Start a conversation with {selectedDriver.full_name || selectedDriver.username}</p>
                    </div>
                  ) : (
                    messages.map((msg, idx) => {
                      const isAdminMessage = msg.senderRole === 'admin';
                      const messageText = (msg.text || msg.content || '') as string;
                      const messageTime = (msg.timestamp || msg.createdAt) as string | undefined;
                      return (
                        <div key={idx} className={`flex ${isAdminMessage ? 'justify-end' : 'justify-start'}`}>
                          <div className={`max-w-[88%] sm:max-w-[75%] rounded-lg p-3 ${
                            isAdminMessage
                              ? 'bg-blue-600 dark:bg-blue-500 text-white'
                              : 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 border border-gray-200 dark:border-gray-600'
                          }`}>
                            <p className="text-sm">{messageText}</p>
                            <p className={`text-xs mt-1 ${isAdminMessage ? 'text-blue-100' : 'text-gray-500 dark:text-gray-400'}`}>
                              {formatMessageTimestamp(messageTime)}
                            </p>
                          </div>
                        </div>
                      );
                    })
                  )}
                  <div ref={messagesEndRef} />
                </div>

                {/* Templates */}
                <div className="px-4 py-2 bg-gray-50 dark:bg-gray-700 border-t dark:border-gray-600 border-b dark:border-gray-600">
                  <div className="flex gap-2 overflow-x-auto">
                    {messageTemplates.map((template, idx) => (
                      <button key={idx} onClick={() => setNewMessage(template)}
                        className="px-3 py-1 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg text-xs hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-900 dark:text-gray-100 whitespace-nowrap transition-colors">
                        {template}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Input */}
                <div className="p-4 bg-white dark:bg-gray-800 border-t dark:border-gray-600 transition-colors">
                  <div className="flex gap-2">
                    <button className="p-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition" title="Attach File">
                      <Paperclip className="w-5 h-5" />
                    </button>
                    <input
                      type="text"
                      value={newMessage}
                      onChange={e => setNewMessage(e.target.value)}
                      onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                        if (e.key === 'Enter' && newMessage.trim() && !sendingMessage) void handleSendMessage();
                      }}
                      placeholder="Type a message..."
                      disabled={sendingMessage}
                      className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                    />
                    <button
                      onClick={() => void handleSendMessage()}
                      disabled={!newMessage.trim() || sendingMessage}
                      className="px-4 py-2 bg-blue-600 dark:bg-blue-500 text-white rounded-lg hover:bg-blue-700 dark:hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transition-colors"
                    >
                      {sendingMessage ? (
                        <><div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />Sending...</>
                      ) : (
                        <><Send className="w-4 h-4" />Send</>
                      )}
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-gray-500 dark:text-gray-400">
                <div className="text-center">
                  <MessageSquare className="w-16 h-16 mx-auto mb-4 opacity-50" />
                  <p className="text-lg">Select a driver to start messaging</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══════════ ALERTS ══════════ */}
      {false && activeTab === 'alerts' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {([
              { type: 'urgent',  label: 'Urgent Alerts', icon: AlertCircle, color: 'text-red-600 dark:text-red-400',    bg: 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800' },
              { type: 'warning', label: 'Warnings',      icon: Clock,       color: 'text-yellow-600 dark:text-yellow-400', bg: 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800' },
              { type: 'info',    label: 'Info Alerts',   icon: Activity,    color: 'text-blue-600 dark:text-blue-400',  bg: 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800'   },
            ] as { type: AlertItem['type']; label: string; icon: React.ElementType; color: string; bg: string }[]).map(({ type, label, icon: Icon, color, bg }) => (
              <div key={type} className={`${bg} border rounded-lg p-4 transition-colors`}>
                <div className="flex items-center justify-between">
                  <div>
                    <div className={`text-sm ${color} mb-1`}>{label}</div>
                    <div className={`text-2xl font-bold ${color}`}>{alerts.filter(a => a.type === type).length}</div>
                  </div>
                  <Icon className={`w-8 h-8 ${color}`} />
                </div>
              </div>
            ))}
          </div>

          <div className="pp-dash-card transition-colors">
            <div className="p-4 border-b dark:border-gray-700 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Active Alerts</h2>
              <div className="flex gap-2">
                <select className="px-3 py-1 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100">
                  <option value="all">All Types</option>
                  <option value="urgent">Urgent</option>
                  <option value="warning">Warning</option>
                  <option value="info">Info</option>
                </select>
                <button className="px-3 py-1 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 text-sm transition-colors">
                  Mark All Read
                </button>
              </div>
            </div>
            <div className="divide-y divide-gray-200 dark:divide-gray-700">
              {alerts.length === 0 ? (
                <div className="p-12 text-center">
                  <CheckCircle className="w-12 h-12 text-green-500 dark:text-green-400 mx-auto mb-4" />
                  <p className="text-gray-600 dark:text-gray-400">No active alerts</p>
                  <p className="text-sm text-gray-500 dark:text-gray-500 mt-2">All systems operating normally</p>
                </div>
              ) : (
                alerts.map(alertItem => (
                  <div
                    key={alertItem.id}
                    className={`p-4 border-l-4 transition-colors ${
                      alertItem.type === 'urgent'
                        ? 'bg-red-50 dark:bg-red-900/20 border-red-500 dark:border-red-400'
                        : alertItem.type === 'warning'
                        ? 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-500 dark:border-yellow-400'
                        : 'bg-blue-50 dark:bg-blue-900/20 border-blue-500 dark:border-blue-400'
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-start gap-3 flex-1">
                        {alertItem.type === 'urgent'
                          ? <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 mt-0.5 flex-shrink-0" />
                          : alertItem.type === 'warning'
                          ? <Clock className="w-5 h-5 text-yellow-600 dark:text-yellow-400 mt-0.5 flex-shrink-0" />
                          : <Activity className="w-5 h-5 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />}
                        <div className="flex-1">
                          <div className="font-semibold text-gray-900 dark:text-gray-100">{alertItem.title}</div>
                          <div className="pp-page-subtitle">{alertItem.message}</div>
                          <div className="text-xs text-gray-500 dark:text-gray-500 mt-2">
                            {alertItem.timestamp.toLocaleTimeString()} • {alertItem.timestamp.toLocaleDateString()}
                          </div>
                        </div>
                      </div>
                      <div className="flex gap-2 ml-4">
                        <button
                          onClick={() => window.alert(`View details for: ${alertItem.title}`)}
                          className="px-3 py-1 text-sm bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
                        >View</button>
                        <button
                          onClick={() => window.alert('Alert dismissed')}
                          className="px-3 py-1 text-sm bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                        >Dismiss</button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      </div>{/* end tab-enter wrapper */}
    </div>
  );
}
