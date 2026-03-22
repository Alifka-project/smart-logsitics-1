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

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagePollingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const loadingDataRef = useRef<boolean>(false);
  const loadingOnlineStatusRef = useRef<boolean>(false);
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
    }, 90000);

    return () => {
      document.removeEventListener('visibilitychange', handleVisChange);
      window.removeEventListener('deliveriesUpdated', handleDeliveriesUpdated);
      window.removeEventListener('deliveryStatusUpdated', handleDeliveryStatusUpdated);
      clearInterval(onlineInterval);
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
      return new Date(driver.account.lastLogin) >= new Date(Date.now() - 5 * 60 * 1000);
    }
    return false;
  };

  const onlineDrivers = drivers.filter(d => isDriverOnline(d));
  const activeDeliveries = deliveries.filter(d =>
    d.tracking?.driverId || d.assignedDriverId || d.tracking?.assigned
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

  const estimateMinutes = (delivery: OpDelivery): number | null => {
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
    return null;
  };

  const deliveriesWithEta = deliveries.map(d => {
    const lat = d.lat || d.Lat || d.tracking?.lastLocation?.lat || 25.1124;
    const lng = d.lng || d.Lng || d.tracking?.lastLocation?.lng || 55.1980;
    const etaMinutes = estimateMinutes(d);
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

  const validRoutePoints = deliveriesWithEta
    .map(d => [Number((d as unknown as { lat?: number }).lat), Number((d as unknown as { lng?: number }).lng)] as [number, number])
    .filter(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180);
  const unifiedRoute = validRoutePoints.length > 0 ? { coordinates: [[25.0053, 55.0760], ...validRoutePoints] } : null;

  const driverLocations = drivers
    .map(driver => ({
      id: driver.id,
      name: driver.full_name || driver.fullName || driver.username || 'Driver',
      status: driver.tracking?.status || (isDriverOnline(driver) ? 'online' : 'offline'),
      speedKmh: driver.tracking?.location?.speed != null ? Math.round(driver.tracking.location.speed * 3.6) : null,
      lat: driver.tracking?.location?.lat,
      lng: driver.tracking?.location?.lng,
    }))
    .filter(driver => Number.isFinite(Number(driver.lat)) && Number.isFinite(Number(driver.lng)));

  const assignedDeliveries = deliveries.filter(d => d.tracking?.assigned || d.tracking?.driverId || d.assignedDriverId);
  const inProgressDeliveries = deliveries.filter(d => d.tracking?.status === 'in_progress');
  const completedDeliveries = deliveries.filter(d => (d.status || '').toLowerCase() === 'delivered');

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
      <div className="rounded-2xl bg-gray-100/80 dark:bg-white/[0.06] p-1.5 border border-gray-200/60 dark:border-white/[0.07]">
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
          <div className="pp-kpi-grid">
            {([
              { label: 'Active Deliveries',    value: activeDeliveries.length,                             icon: Truck,        bg: 'bg-blue-50 dark:bg-blue-900/20',     ic: 'text-blue-600 dark:text-blue-400',     val: 'text-blue-700 dark:text-blue-300'    },
              { label: 'Online Drivers',        value: onlineDrivers.length,                               icon: Users,        bg: 'bg-green-50 dark:bg-green-900/20',   ic: 'text-green-600 dark:text-green-400',   val: 'text-green-700 dark:text-green-300'  },
              { label: 'Drivers w/ Location',   value: drivers.filter(d => d.tracking?.location).length,  icon: MapPin,       bg: 'bg-purple-50 dark:bg-purple-900/20', ic: 'text-purple-600 dark:text-purple-400', val: 'text-purple-700 dark:text-purple-300'},
              { label: 'Active Alerts',         value: alerts.length,                                      icon: AlertCircle,  bg: 'bg-red-50 dark:bg-red-900/20',       ic: 'text-red-600 dark:text-red-400',       val: 'text-red-700 dark:text-red-300'      },
              { label: 'Total Drivers',         value: drivers.length,                                     icon: Activity,     bg: 'bg-indigo-50 dark:bg-indigo-900/20', ic: 'text-indigo-600 dark:text-indigo-400', val: 'text-indigo-700 dark:text-indigo-300'},
            ] as { label: string; value: number; icon: React.ElementType; bg: string; ic: string; val: string }[]).map(({ label, value, icon: Icon, bg, ic, val }) => (
              <div key={label} className="pp-dash-card p-4 w-full min-w-0 max-w-[280px]">
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

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 pp-dash-card overflow-hidden transition-colors">
              <div className="p-4 bg-gray-50 dark:bg-gray-700 border-b dark:border-gray-600">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Live Operations Map (Tracking + Deliveries + Route)</h2>
              </div>
              <DeliveryMap
                deliveries={deliveriesWithEta as unknown as import('../types').Delivery[]}
                route={unifiedRoute as unknown as import('../types').RouteResult}
                driverLocations={driverLocations}
                mapClassName="h-[320px] sm:h-[420px] lg:h-[560px]"
              />
            </div>

            <div className="pp-dash-card p-5 transition-colors">
              <h2 className="text-lg font-semibold mb-4 text-gray-900 dark:text-gray-100">Active Deliveries ETA</h2>
              <div className="space-y-3 max-h-[280px] sm:max-h-[380px] lg:max-h-[500px] overflow-y-auto">
                {deliveriesWithEta.filter(d => d.tracking?.driverId || d.assignedDriverId || d.tracking?.assigned).slice(0, 12).map(delivery => (
                  <div key={String(delivery.id || delivery.ID || '')} className="p-3 border border-gray-200 dark:border-gray-700 rounded-lg">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                        #{String(delivery.id || '').slice(0, 8) || 'N/A'}
                      </span>
                      <span className={`px-2 py-1 text-xs rounded-full ${
                        delivery.status === 'out-for-delivery'
                          ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300'
                          : 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300'
                      }`}>
                        {delivery.status || 'In Progress'}
                      </span>
                    </div>
                    <div className="text-xs text-gray-600 dark:text-gray-400">
                      {delivery.customer || delivery.Customer || 'Unknown Customer'}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-500 mt-1">
                      ETA: {(delivery as unknown as { etaMinutes?: number }).etaMinutes != null ? `${(delivery as unknown as { etaMinutes?: number }).etaMinutes} min` : 'Calculating...'}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-500">
                      Items: {(delivery as unknown as { itemCount?: number }).itemCount || 1} • ETA/item: {(delivery as unknown as { etaPerItemMinutes?: number }).etaPerItemMinutes != null ? `${(delivery as unknown as { etaPerItemMinutes?: number }).etaPerItemMinutes} min` : 'N/A'}
                    </div>
                  </div>
                ))}
                {activeDeliveries.length === 0 && (
                  <div className="text-center py-8 text-gray-500 dark:text-gray-400">No active deliveries</div>
                )}
              </div>
            </div>
          </div>

          <div className="pp-dash-card p-5 transition-colors">
            <h2 className="text-lg font-semibold mb-4 text-gray-900 dark:text-gray-100">Driver Status</h2>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead className="bg-gray-50 dark:bg-gray-700">
                  <tr>
                    {['Driver', 'Status', 'Location', 'Last Update'].map(h => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                  {drivers.map(driver => {
                    const driverName = driver.full_name || driver.name || driver.username || 'Unknown';
                    const online = isDriverOnline(driver);
                    const loc = driver.tracking?.location;
                    return (
                      <tr key={driver.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                        <td className="px-4 py-3 whitespace-nowrap">
                          <div className="flex items-center">
                            <div className={`w-3 h-3 rounded-full mr-3 ${online ? 'bg-green-500' : 'bg-gray-400'}`} />
                            <div>
                              <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{driverName}</div>
                              {driver.phone && <div className="text-sm text-gray-500 dark:text-gray-400">{driver.phone}</div>}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className={`px-2 py-1 text-xs font-semibold rounded-full ${online ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300' : 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-300'}`}>
                            {driver.tracking?.status || 'offline'}
                          </span>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                          {loc ? (
                            <div>
                              <div>{loc.lat.toFixed(4)}, {loc.lng.toFixed(4)}</div>
                              {loc.speed != null && <div className="text-xs text-gray-400">{(loc.speed * 3.6).toFixed(0)} km/h</div>}
                            </div>
                          ) : <span className="text-gray-400">No location</span>}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                          {loc?.timestamp
                            ? new Date(loc.timestamp).toLocaleTimeString()
                            : driver.tracking?.lastUpdate
                            ? new Date(driver.tracking.lastUpdate).toLocaleTimeString()
                            : 'N/A'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {drivers.length === 0 && <div className="text-center py-8 text-gray-500 dark:text-gray-400">No drivers found</div>}
            </div>
          </div>

          <div className="pp-dash-card p-5 transition-colors">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Delivery Tracking Overview</h2>
              <span className="text-xs text-gray-500 dark:text-gray-400">Unified monitoring + tracking view</span>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
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

          <div className="pp-dash-card p-5 transition-colors">
            <h2 className="text-lg font-semibold mb-4 text-gray-900 dark:text-gray-100">Delivery Status Details</h2>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead className="bg-gray-50 dark:bg-gray-700">
                  <tr>
                    {['Delivery', 'Status', 'Driver', 'Assigned At', 'ETA', 'Items / ETA Item', 'Location'].map(h => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                  {deliveriesWithEta.slice(0, 50).map(delivery => {
                    const tracking = delivery.tracking || {};
                    const loc = tracking.lastLocation;
                    const driverId = tracking.driverId || delivery.assignedDriverId;
                    const driver = drivers.find(d => String(d.id) === String(driverId));
                    const driverName = driver
                      ? (driver.full_name || driver.fullName || driver.username || driver.email || `Driver ${driver.id}`)
                      : (driverId || 'Unassigned');
                    return (
                      <tr key={String(delivery.id || delivery.ID || '')} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                        <td className="px-4 py-3">
                          <div>
                            <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{delivery.customer || delivery.Customer || 'Unknown'}</div>
                            <div className="text-sm text-gray-500 dark:text-gray-400">{String(delivery.address || delivery.Address || 'N/A')}</div>
                          </div>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className={`px-2 py-1 text-xs font-semibold rounded-full ${
                            tracking.status === 'in_progress' ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300'
                              : tracking.assigned ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300'
                              : 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-300'
                          }`}>
                            {tracking.status || delivery.status || 'unassigned'}
                          </span>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{driverName}</td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{tracking.assignedAt ? new Date(tracking.assignedAt).toLocaleString() : 'N/A'}</td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                          {(delivery as unknown as { etaMinutes?: number }).etaMinutes != null ? `${(delivery as unknown as { etaMinutes?: number }).etaMinutes} min` : 'Calculating...'}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                          {(delivery as unknown as { itemCount?: number }).itemCount || 1} / {(delivery as unknown as { etaPerItemMinutes?: number }).etaPerItemMinutes != null ? `${(delivery as unknown as { etaPerItemMinutes?: number }).etaPerItemMinutes} min` : 'N/A'}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
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
                <div key={label} className="pp-dash-card p-4 w-full min-w-0 max-w-[280px]">
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
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead className="bg-gray-50 dark:bg-gray-700">
                  <tr>
                    {['PO Number', 'Customer', 'Address', 'Status', 'Assigned Driver', 'Change Assignment'].map(h => (
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
                            <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-gray-100">
                              {delivery.poNumber || delivery.PONumber || delivery.metadata?.originalPONumber || 'N/A'}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100">
                              {delivery.customer || delivery.Customer || 'Unknown'}
                            </td>
                            <td className="px-6 py-4 text-sm text-gray-500 dark:text-gray-400 max-w-xs truncate">
                              {String(delivery.address || 'N/A')}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm">
                              <span className={`px-2 py-1 rounded-full text-xs font-semibold ${
                                delivery.status === 'delivered' ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300' :
                                delivery.status === 'pending'   ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300' :
                                'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-300'
                              }`}>
                                {delivery.status || 'pending'}
                              </span>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm">
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
                            <td className="px-6 py-4 whitespace-nowrap text-sm">
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
                <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
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
                          <td className="px-4 py-3">
                            <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{delivery.customer || delivery.Customer || 'Unknown'}</div>
                            <div className="text-sm text-gray-500 dark:text-gray-400">{String(delivery.address || delivery.Address || 'N/A')}</div>
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <span className={`px-2 py-1 text-xs font-semibold rounded-full ${
                              tracking.status === 'in_progress' ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300'
                                : tracking.assigned             ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300'
                                : 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-300'
                            }`}>
                              {tracking.status || delivery.status || 'unassigned'}
                            </span>
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{tracking.driverId || 'Unassigned'}</td>
                          <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                            {tracking.assignedAt ? new Date(tracking.assignedAt).toLocaleString() : 'N/A'}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
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
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-[calc(100vh-300px)]">
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
                          <div className={`max-w-[70%] rounded-lg p-3 ${
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
