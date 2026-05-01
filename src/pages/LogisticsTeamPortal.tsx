import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import api from '../frontend/apiClient';
import { getCurrentUser } from '../frontend/auth';
import {
  MapPin,
  Activity,
  Users,
  AlertCircle,
  CheckCircle,
  XCircle,
  Clock,
  RefreshCw,
  Truck,
  Settings,
  MessageSquare,
  Phone,
  Send,
  Paperclip,
  Navigation as NavigationIcon,
  Circle,
  Package,
  Search,
  ChevronLeft,
  Camera,
  TrendingUp,
} from 'lucide-react';
import DeliveryDetailModal from '../components/DeliveryDetailModal';
import DeliveryMap from '../components/MapView/DeliveryMap';
import DeliveryManagementPage from './DeliveryManagementPage';
import { classifyForLiveMap, BUCKET_ORDER, BUCKET_META, type LiveMapBucket } from '../utils/liveMapsStatusBuckets';

import { PieChart, Pie, Cell, BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, CartesianGrid, LabelList } from 'recharts';
import { calculateRoute, generateFallbackRoute, computePerDriverRoutes } from '../services/advancedRoutingService';
import type { DriverRoute } from '../services/advancedRoutingService';
import useDeliveryStore from '../store/useDeliveryStore';
import { deliveryToManageOrder } from '../utils/deliveryWorkflowMap';
import { excludeTeamPortalGarbageDeliveries } from '../utils/deliveryListFilter';
import { computeETD, formatEtdLabel } from '../utils/etd';

import { getTodayIsoDubai, addCalendarDaysDubai, formatInstantToDubaiIsoDate } from '../utils/dubaiCalendarIso';

import type { Delivery, AuthUser } from '../types';

interface ContactUser {
  id: string;
  username: string;
  fullName?: string | null;
  full_name?: string | null;
  role?: string;
  phone?: string | null;
  account?: {
    role?: string;
    lastLogin?: string | null;
  };
  tracking?: {
    location?: {
      lat: number;
      lng: number;
      speed?: number;
      timestamp?: string;
    } | null;
    lastUpdate?: string | null;
    online?: boolean;
    status?: string;
  };
}

interface TeamMessage {
  id: string;
  adminId?: string | number | null;
  driverId?: string | number | null;
  content: string;
  senderRole?: string;
  createdAt?: string;
  attachmentUrl?: string;
  attachmentType?: string;
  attachmentName?: string;
}

interface SystemAlert {
  id: string;
  type: 'warning' | 'error' | 'info';
  driver?: string;
  delivery?: string;
  message: string;
  timestamp: Date;
}

export default function LogisticsTeamPortal() {
  const [activeTab, setActiveTab] = useState<string>('dashboard');
  // Default to the unified Manage Delivery Order tab (merged from old manage-dispatch)
  const [deliveriesSubTab, setDeliveriesSubTab] = useState<string>('manage');
  const [trackingDriverFilter, setTrackingDriverFilter] = useState<string>('all');
  const [trackingSelectedId, setTrackingSelectedId] = useState<string | null>(null);
  const [liveStatusFilter, setLiveStatusFilter] = useState<'all' | 'out_for_delivery' | 'confirmed' | 'priority' | 'delayed'>('all');
  // Free-text search across customer / PO / delivery no / phone — drives
  // what the list and the map show simultaneously so finding an order for
  // a phone-call enquiry is one keystroke away.
  const [trackingSearchQuery, setTrackingSearchQuery] = useState<string>('');
  // Live-maps list grouping. 'driver' groups orders under each driver so
  // ops see at-a-glance who carries what; 'status' groups by bucket
  // (overdue / on-route / awaiting / confirmed); 'flat' is the legacy
  // single-list view for backward-compatibility.
  const [liveMapsViewMode, setLiveMapsViewMode] = useState<'driver' | 'status' | 'flat'>('driver');
  // Live Maps right-panel date scope. 'today' = Dubai today, 'tomorrow' = Dubai +1d,
  // 'all' = whatever passes the existing status / driver / search filters across any date.
  // Drives both which orders are listed AND which date's capacity bar shows in driver headers.
  const [liveMapsDateMode, setLiveMapsDateMode] = useState<'today' | 'tomorrow' | 'all'>('today');
  // Per-card "Reassign to driver…" menu state — only one open at a time.
  const [reassignMenuFor, setReassignMenuFor] = useState<string | null>(null);
  const [reassignBusyId, setReassignBusyId] = useState<string | null>(null);
  const [podModalDelivery, setPodModalDelivery] = useState<Delivery | null>(null);
  const [drivers, setDrivers] = useState<ContactUser[]>([]);
  const [contacts, setContacts] = useState<ContactUser[]>([]); // All contacts (drivers + team members)
  const [teamMembers, setTeamMembers] = useState<ContactUser[]>([]); // Admin + delivery_team
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const recentUploads = useDeliveryStore((s) => s.recentUploads ?? []);
  const [alerts, setAlerts] = useState<SystemAlert[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  
  // Per-driver daily capacity by date: ISO date -> driverId -> capacity
  const [driverCapacityByDate, setDriverCapacityByDate] = useState<Record<string, Record<string, { used: number; remaining: number; max: number; full: boolean }>>>({});
  const fallbackCapacityDateIso = useMemo(() => {
    const nowDubai = new Date(Date.now() + 4 * 60 * 60 * 1000);
    nowDubai.setUTCDate(nowDubai.getUTCDate() + 1);
    return nowDubai.toISOString().slice(0, 10);
  }, []);
  const getCapacityDateIso = useCallback((d: Delivery): string => {
    const s = String(d.status || '').toLowerCase().replace(/_/g, '-');
    if (['out-for-delivery', 'in-transit', 'in-progress'].includes(s)) {
      return getTodayIsoDubai();
    }
    const raw = (d as unknown as { confirmedDeliveryDate?: string | null }).confirmedDeliveryDate;
    if (!raw) return fallbackCapacityDateIso;
    const t = Date.parse(String(raw));
    if (!Number.isFinite(t)) return fallbackCapacityDateIso;
    return formatInstantToDubaiIsoDate(t);
  }, [fallbackCapacityDateIso]);
  const getDriverCapacity = useCallback((d: Delivery, driverId: string | undefined): { used: number; remaining: number; max: number; full: boolean } | undefined => {
    if (!driverId) return undefined;
    const iso = getCapacityDateIso(d);
    return driverCapacityByDate[iso]?.[driverId];
  }, [driverCapacityByDate, getCapacityDateIso]);

  const capacityDatesSorted = useMemo(() => {
    // Only show today and future dates — never past dates
    const todayIso = getTodayIsoDubai();
    return [...Object.keys(driverCapacityByDate)]
      .filter(iso => iso >= todayIso)
      .sort();
  }, [driverCapacityByDate]);

  // Communication tab state
  const [selectedContact, setSelectedContact] = useState<ContactUser | null>(null); // Changed from selectedDriver
  const [messages, setMessages] = useState<TeamMessage[]>([]);
  const [newMessage, setNewMessage] = useState<string>('');
  const [loadingMessages, setLoadingMessages] = useState<boolean>(false);
  const [sendingMessage, setSendingMessage] = useState<boolean>(false);
  const [onlineUserIds, setOnlineUserIds] = useState<Set<string>>(new Set());
  const [attachmentPreview, setAttachmentPreview] = useState<{ url: string; type: string; name: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [contactSearch, setContactSearch] = useState<string>('');
  const [messageTemplates] = useState<string[]>([
    'Please update delivery status',
    'New delivery assigned',
    'Please contact customer',
    'Delivery rescheduled',
    'Emergency: Return to warehouse'
  ]);
  
  // Unread message count per driver
  const [unreadByDriverId, setUnreadByDriverId] = useState<Record<string, number>>({});
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const messagePollingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const location = useLocation();
  const [highlightDeliveryId, setHighlightDeliveryId] = useState<string | null>(null);
  const highlightRowRef = useRef<HTMLTableRowElement | null>(null);


  // Route for monitoring map (matches Admin Operations)
  const [monitoringRoute, setMonitoringRoute] = useState<{ coordinates: [number, number][] } | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [driverRoutes, setDriverRoutes] = useState<DriverRoute[]>([]);
  const driverRouteKeyRef = useRef<string>('');

  const formatMessageTimestamp = (value: string | Date | null | undefined): string => {
    if (!value) return '';
    const date = new Date(value as string);
    if (isNaN(date.getTime())) return '';
    const now = new Date();
    const diff = Math.abs(now.getTime() - date.getTime());
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return date.toLocaleDateString();
  };


  useEffect(() => {
    const currentUser = getCurrentUser();
    if (!currentUser) {
      console.error('[LogisticsTeamPortal] No user found');
      return;
    }

    void loadData();

    const interval = setInterval(() => {
      if (!document.hidden) void loadData();
    }, 60000);

    // Fast 10s driver-only GPS poll
    const driverPoll = setInterval(async () => {
      if (document.hidden) return;
      try {
        const r = await api.get('/admin/tracking/drivers');
        const list = (r.data?.drivers || []) as typeof drivers;
        setDrivers(list);
      } catch { /* silent */ }
    }, 10_000);

    return () => {
      clearInterval(interval);
      clearInterval(driverPoll);
    };
  }, []);

  // Recompute per-driver OSRM routes when driver GPS or deliveries change
  useEffect(() => {
    const key = drivers
      .filter((d) => d.tracking?.location)
      .map((d) => {
        const loc = d.tracking!.location!;
        return `${d.id}:${loc.lat.toFixed(4)},${loc.lng.toFixed(4)}`;
      })
      .join(';');
    if (key === driverRouteKeyRef.current) return;
    driverRouteKeyRef.current = key;
    if (!key) { setDriverRoutes([]); return; }
    void computePerDriverRoutes(
      drivers as Parameters<typeof computePerDriverRoutes>[0],
      deliveries as Parameters<typeof computePerDriverRoutes>[1],
    ).then(setDriverRoutes);
  }, [drivers, deliveries]);

  // Load online users after contacts are loaded
  useEffect(() => {
    if (contacts.length > 0) {
      void loadOnlineUsers();
      
      // Set up interval for online status refresh - only when visible
      const onlineInterval = setInterval(() => {
        if (!document.hidden) void loadOnlineUsers();
      }, 60000); // 60s instead of 10s
      
      return () => clearInterval(onlineInterval);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contacts.length]);

  // Handle URL-based tab/contact/delivery selection
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    let tabParam = params.get('tab');
    const contactId = params.get('driver') || params.get('contact');
    const deliveryId = params.get('delivery');

    // Backward-compat: remap old top-level tab names
    if (tabParam === 'operations') tabParam = 'dashboard';

    // Sub-tabs inside Deliveries: manage (unified orders+dispatch), live-maps
    // manage-dispatch and manage-orders are both legacy aliases for 'manage'
    const deliveriesSubTabs = ['manage-orders', 'manage-dispatch', 'manage', 'live-tracking', 'live-maps', 'deliveries'];
    if (tabParam && deliveriesSubTabs.includes(tabParam)) {
      setActiveTab('deliveries');
      // Map all legacy dispatch/orders sub-tab names to the current 'manage' tab
      // live-tracking is the legacy name for live-maps
      const subTab = (tabParam === 'deliveries' || tabParam === 'manage-orders' || tabParam === 'manage-dispatch') ? 'manage' : tabParam === 'live-tracking' ? 'live-maps' : tabParam;
      setDeliveriesSubTab(subTab);
    } else if (tabParam) {
      setActiveTab(tabParam);
    }

    if (contactId) {
      setActiveTab('communication');
      if (contacts.length > 0) {
        const contact = contacts.find(c => c.id === contactId);
        if (contact) setSelectedContact(contact);
      }
    }

    // Delivery highlight → go to Deliveries > Manage Delivery Orders where the table lives
    if (deliveryId) {
      setActiveTab('deliveries');
      setDeliveriesSubTab('manage');
      setHighlightDeliveryId(deliveryId);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search, contacts.length]);

  // Auto-scroll to highlighted delivery row
  useEffect(() => {
    if (highlightDeliveryId && highlightRowRef.current) {
      highlightRowRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // Clear highlight after 4 seconds
      const t = setTimeout(() => setHighlightDeliveryId(null), 4000);
      return () => clearTimeout(t);
    }
  }, [highlightDeliveryId, deliveries]);

  // Load unread counts when in communication tab - 60s, pause when hidden
  useEffect(() => {
    if (activeTab === 'communication') {
      void loadUnreadCounts();
      const interval = setInterval(() => {
        if (!document.hidden) void loadUnreadCounts();
      }, 60000); // 60s instead of 5s
      return () => clearInterval(interval);
    }
  }, [activeTab]);

  // Load messages when contact is selected - 30s, pause when hidden
  useEffect(() => {
    if (selectedContact) {
      void loadMessages(selectedContact.id);
      
      const interval = setInterval(() => {
        if (!document.hidden && activeTab === 'communication') {
          void loadMessages(selectedContact.id, true);
        }
      }, 30000); // 30s instead of 5s
      
      messagePollingIntervalRef.current = interval;
      return () => {
        if (messagePollingIntervalRef.current) {
          clearInterval(messagePollingIntervalRef.current);
        }
      };
    }
  }, [selectedContact, activeTab]);

  useEffect(() => {
    if (activeTab !== 'communication') return;
    if (!messagesEndRef.current) return;
    
    requestAnimationFrame(() => {
      if (messagesEndRef.current) {
        messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
      }
    });
  }, [messages, activeTab]);

  // Compute route for monitoring map — only Out-for-Delivery stops, matching the map markers
  useEffect(() => {
    const ofdDeliveries = deliveries.filter(d => (d.status || '').toLowerCase() === 'out-for-delivery');

    const pts = ofdDeliveries
      .map((d) => {
        const lat = d.lat ?? (d as unknown as { Lat?: number }).Lat;
        const lng = d.lng ?? (d as unknown as { Lng?: number }).Lng;
        return lat != null && lng != null ? [Number(lat), Number(lng)] as [number, number] : null;
      })
      .filter(
        (p): p is [number, number] =>
          p != null &&
          Number.isFinite(p[0]) &&
          Number.isFinite(p[1]) &&
          p[0] >= -90 && p[0] <= 90 &&
          p[1] >= -180 && p[1] <= 180,
      );

    if (pts.length === 0) {
      setMonitoringRoute(null);
      return;
    }

    const locations = [{ lat: 25.0053, lng: 55.0760 }, ...pts.map(([lat, lng]) => ({ lat, lng }))];
    if (locations.length < 2) {
      setMonitoringRoute(null);
      return;
    }

    setRouteLoading(true);
    calculateRoute(locations, ofdDeliveries, false)
      .then((result) => setMonitoringRoute({ coordinates: result.coordinates }))
      .catch(() => {
        try {
          const fallback = generateFallbackRoute(locations);
          setMonitoringRoute({ coordinates: fallback.coordinates });
        } catch {
          setMonitoringRoute({ coordinates: [[25.0053, 55.0760], ...pts] });
        }
      })
      .finally(() => setRouteLoading(false));
  }, [deliveries]);

  const loadData = async (): Promise<void> => {
    try {
      console.log('[DeliveryTeam] Loading data (tracking APIs for consistency with Operations)...');
      // Use tracking APIs so monitoring matches Admin Operations (live GPS, same delivery list)
      const [driversRes, deliveriesRes, contactsRes] = await Promise.all([
        api.get('/admin/tracking/drivers').catch(() => ({ data: { drivers: [] } })),
        api.get('/admin/tracking/deliveries').catch(() => ({ data: { deliveries: [] } })),
        api.get('/messages/contacts') // Load contacts for messaging
      ]);

      const driversList = (driversRes.data?.drivers || []) as ContactUser[];
      setDrivers(driversList);

      const allDeliveries = (deliveriesRes.data?.deliveries || []) as Delivery[];
      const portalDeliveries = excludeTeamPortalGarbageDeliveries(allDeliveries);
      setDeliveries(portalDeliveries);

      // Sync to store so Deliveries tab shows same list as monitoring
      useDeliveryStore.getState().loadDeliveries(portalDeliveries);

      // Set contacts from API response (for communication tab)
      const allContacts = (contactsRes.data?.contacts || []) as ContactUser[];
      const teamMembersList = (contactsRes.data?.teamMembers || []) as ContactUser[];

      console.log('[DeliveryTeam] Loaded:', {
        drivers: driversList.length,
        deliveries: portalDeliveries.length,
        contacts: allContacts.length
      });

      setContacts(allContacts);
      setTeamMembers(teamMembersList);

      // Generate alerts
      const newAlerts: SystemAlert[] = [];
      driversList.forEach(driver => {
        if (!driver.tracking?.lastUpdate && !driver.tracking?.location) {
          newAlerts.push({
            id: `no-gps-${driver.id}`,
            type: 'warning',
            driver: driver.fullName || driver.full_name || driver.username,
            message: 'GPS not active',
            timestamp: new Date()
          });
        }
      });

      portalDeliveries.forEach(delivery => {
        const deliveryTracking = delivery as unknown as { tracking?: { driverId?: string } };
        if (!deliveryTracking.tracking?.driverId && !delivery.assignedDriverId) {
          newAlerts.push({
            id: `unassigned-${delivery.id}`,
            type: 'warning',
            delivery: delivery.poNumber || delivery.id,
            message: 'Unassigned delivery',
            timestamp: new Date()
          });
        }
      });

      setAlerts(newAlerts);
      setLastUpdate(new Date());

      // Load per-driver capacity per delivery date visible in table
      try {
        const dateSet = new Set<string>();
        for (const d of portalDeliveries) dateSet.add(getCapacityDateIso(d));
        const todayIso = getTodayIsoDubai();
        dateSet.add(todayIso);
        dateSet.add(addCalendarDaysDubai(todayIso, 1));
        if (dateSet.size === 0) dateSet.add(fallbackCapacityDateIso);

        const capByDate: Record<string, Record<string, { used: number; remaining: number; max: number; full: boolean }>> = {};
        await Promise.all([...dateSet].map(async (iso) => {
          const capRes = await api.get('/deliveries/admin/driver-capacity', { params: { date: iso } }).catch(() => null);
          if (!capRes?.data?.drivers) return;
          const map: Record<string, { used: number; remaining: number; max: number; full: boolean }> = {};
          for (const row of capRes.data.drivers as Array<{ driverId: string; used: number; remaining: number; max: number; full: boolean }>) {
            map[row.driverId] = { used: row.used, remaining: row.remaining, max: row.max, full: row.full };
          }
          capByDate[iso] = map;
        }));
        setDriverCapacityByDate(capByDate);
      } catch { /* non-critical */ }
    } catch (err: unknown) {
      console.error('Error loading data:', err);
    } finally {
      setLoading(false);
    }
  };

  // Reassign a delivery to a different driver from the Live Maps panel.
  // Server enforces the per-driver 20-units/day cap (deliveryCapacityService.TRUCK_MAX_ITEMS_PER_DAY)
  // and surfaces 'driver_capacity_exceeded' which we present inline so ops never silently overflow.
  const reassignDelivery = async (deliveryId: string, driverId: string): Promise<void> => {
    setReassignBusyId(deliveryId);
    try {
      await api.put(`/deliveries/admin/${deliveryId}/assign`, { driverId });
      setReassignMenuFor(null);
      // Refetch deliveries + capacity so headers reflect the new allocation.
      await loadData();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string; error?: string } }; message?: string };
      const msg =
        e.response?.data?.message
        || e.response?.data?.error
        || e.message
        || 'Failed to reassign delivery';
      window.alert(msg);
    } finally {
      setReassignBusyId(null);
    }
  };

  const loadOnlineUsers = async (): Promise<void> => {
    try {
      // Try to get active sessions first
      let activeSessionUserIds = new Set<string>();
      try {
        const response = await api.get('/admin/drivers/sessions');
        if (response.data?.sessions) {
          activeSessionUserIds = new Set(
            (response.data.sessions as Array<{ userId?: string | number }>)
              .map(s => s.userId?.toString() || '')
              .filter(Boolean)
          );
          console.debug(`[DeliveryTeam] Loaded ${activeSessionUserIds.size} online users from sessions`);
        }
      } catch (sessionError: unknown) {
        const e = sessionError as { message?: string };
        console.debug('[DeliveryTeam] Sessions endpoint error, using time-based fallback:', e.message);
        // Fallback to time-based detection using lastLogin from contacts
        const now = new Date();
        const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);
        
        // Check all contacts (drivers + team members)
        contacts.forEach(contact => {
          if (contact.account?.lastLogin) {
            const lastLogin = new Date(contact.account.lastLogin);
            if (lastLogin >= fiveMinutesAgo) {
              const userId = contact.id?.toString() || contact.id;
              activeSessionUserIds.add(userId);
            }
          }
        });
        
        console.debug(`[DeliveryTeam] Fallback: ${activeSessionUserIds.size} users active in last 5 minutes`);
      }

      setOnlineUserIds(activeSessionUserIds);
    } catch (err: unknown) {
      console.error('Error loading online users:', err);
    }
  };

  const loadUnreadCounts = async (): Promise<void> => {
    try {
      const response = await api.get('/messages/unread');
      if (response.data && typeof response.data === 'object') {
        setUnreadByDriverId(response.data as Record<string, number>);
      }
    } catch (err: unknown) {
      console.error('Error loading unread counts:', err);
    }
  };

  const loadMessages = async (contactId: string, silent = false): Promise<void> => {
    console.log('[DeliveryTeam] loadMessages called with contactId:', contactId, 'silent:', silent);
    if (!silent) setLoadingMessages(true);
    try {
      const response = await api.get(`/messages/conversations/${contactId}`);
      const msgs = (response.data?.messages || []) as TeamMessage[];
      console.log('[DeliveryTeam] Loaded messages:', msgs.length, 'messages');
      setMessages(msgs);
      
      // Update unread count
      setUnreadByDriverId(prev => ({
        ...prev,
        [contactId]: 0
      }));
    } catch (err: unknown) {
      console.error('[DeliveryTeam] Error loading messages:', err);
      if (!silent) console.error('Error loading messages:', err);
    } finally {
      if (!silent) setLoadingMessages(false);
    }
  };

  const handleSendMessage = async (): Promise<void> => {
    if ((!newMessage.trim() && !attachmentPreview) || !selectedContact) return;

    setSendingMessage(true);
    try {
      const payload: Record<string, string> = {
        driverId: selectedContact.id
      };
      if (newMessage.trim()) payload.content = newMessage.trim();
      if (attachmentPreview) {
        payload.attachmentUrl = attachmentPreview.url;
        payload.attachmentType = attachmentPreview.type;
        payload.attachmentName = attachmentPreview.name;
      }
      await api.post('/messages/send', payload);
      
      setNewMessage('');
      setAttachmentPreview(null);
      await loadMessages(selectedContact.id, true);
    } catch (err: unknown) {
      console.error('Error sending message:', err);
      alert('Failed to send message');
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

  const isContactOnline = (contact: ContactUser): boolean => {
    // Tracking drivers have live GPS status
    if (contact.tracking?.online === true) return true;

    const userId = contact.id?.toString() || contact.id;
    if (onlineUserIds.has(userId?.toString()) || onlineUserIds.has(userId)) {
      return true;
    }

    if (!contact.account?.lastLogin) return false;
    const lastLogin = new Date(contact.account.lastLogin);
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    return lastLogin >= fiveMinutesAgo;
  };

  // Must match TERMINAL_STATUSES in AdminOperationsPage so counts are consistent.
  const TERMINAL_STATUSES = new Set([
    'delivered', 'delivered-with-installation', 'delivered-without-installation',
    'completed', 'pod-completed', 'cancelled', 'returned',
  ]);

  // Needs Attention — uses same deliveryToManageOrder workflow as ManageTab so counts are always in sync
  const actionItems = React.useMemo(() => {
    const list = deliveries && Array.isArray(deliveries) ? deliveries : [];
    // Derive workflow status once for every delivery using the shared helper
    const orders = list.map(d => ({ raw: d, order: deliveryToManageOrder(d) }));

    // Pending Orders: everything not yet in a terminal state (consistent with TERMINAL_STATUSES)
    const pendingOrders = orders.filter(({ order }) => !TERMINAL_STATUSES.has(order.status)).map(({ raw }) => raw);

    // Unassigned: active non-dispatched orders with no driver
    const DISPATCH_DONE = new Set(['out_for_delivery', 'order_delay', 'delivered', 'cancelled', 'failed', 'rescheduled']);
    const unassigned = orders.filter(({ raw, order }) => {
      if (DISPATCH_DONE.has(order.status)) return false;
      const dt = raw as unknown as { tracking?: { driverId?: string } };
      return !raw.assignedDriverId && !dt.tracking?.driverId;
    }).map(({ raw }) => raw);

    // Awaiting customer: sms_sent or unconfirmed — matches OrdersTable 'awaiting_customer' tab exactly
    const awaitingConfirmation = orders.filter(({ order }) =>
      order.status === 'sms_sent' || order.status === 'unconfirmed'
    ).map(({ raw }) => raw);

    // Order delays: explicit + auto-detected (out-for-delivery/scheduled past due date)
    const orderDelay = orders.filter(({ order }) => order.status === 'order_delay').map(({ raw }) => raw);

    return { pendingOrders, unassigned, awaitingConfirmation, orderDelay };
  }, [deliveries]);

  // Badge derived from the same workflow status as ManageTab — single source of truth.
  // For warehouse-stage statuses (pgi-done, pickup-confirmed) we ALSO emit a
  // tier pill (Order Delay / Next Shipment / Future Schedule · date) when
  // the promised date isn't today, so ops can monitor "what do we owe
  // customers tomorrow?" without having to inspect each card's ETA grid.
  const getDeliveryStatusBadge = (delivery: Delivery): { label: string; color: string; tierLabel?: string; tierColor?: string } => {
    const order = deliveryToManageOrder(delivery);
    const shortDate = order.confirmedDeliveryDate
      ? order.confirmedDeliveryDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Asia/Dubai' })
      : null;
    // Compute Dubai-day tier for pgi-done / pickup-confirmed date pills.
    const dateTier: 'past' | 'today' | 'tomorrow' | 'future' | 'none' = (() => {
      if (!order.confirmedDeliveryDate) return 'none';
      const toDubaiMidnight = (d: Date): number => {
        const z = new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Dubai' }));
        return Date.UTC(z.getFullYear(), z.getMonth(), z.getDate());
      };
      const diffDays = Math.round((toDubaiMidnight(order.confirmedDeliveryDate) - toDubaiMidnight(new Date())) / 86_400_000);
      if (diffDays < 0) return 'past';
      if (diffDays === 0) return 'today';
      if (diffDays === 1) return 'tomorrow';
      return 'future';
    })();
    const tierPillFor = (tier: typeof dateTier): { tierLabel?: string; tierColor?: string } => {
      if (tier === 'past' && shortDate)    return { tierLabel: `Order Delay · ${shortDate}`,     tierColor: 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300' };
      if (tier === 'tomorrow' && shortDate) return { tierLabel: `Next Shipment · ${shortDate}`,   tierColor: 'bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300' };
      if (tier === 'future' && shortDate)   return { tierLabel: `Future Schedule · ${shortDate}`, tierColor: 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-800 dark:text-indigo-300' };
      return {};
    };
    switch (order.status) {
      case 'order_delay':       return { label: shortDate ? `Order Delay · ${shortDate}` : 'Order Delay', color: 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300' };
      case 'pgi_done':          return { label: 'PGI Done',        color: 'bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300', ...tierPillFor(dateTier) };
      case 'pickup_confirmed':  return { label: 'Pickup Confirmed', color: 'bg-teal-100 dark:bg-teal-900/30 text-teal-800 dark:text-teal-300',     ...tierPillFor(dateTier) };
      case 'out_for_delivery':  return { label: 'On Route',                                                                  color: 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300' };
      case 'next_shipment': {
        // Dual-badge when this is a rescheduled order whose new date falls tomorrow
        if (order.isRescheduled) {
          return {
            label: 'Rescheduled',
            color: 'bg-orange-100 dark:bg-orange-900/30 text-orange-800 dark:text-orange-300',
            tierLabel: shortDate ? `Next Shipment · ${shortDate}` : 'Next Shipment',
            tierColor: 'bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300',
          };
        }
        return { label: shortDate ? `Next Shipment · ${shortDate}` : 'Next Shipment', color: 'bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300' };
      }
      case 'future_schedule': {
        // Dual-badge when this is a rescheduled order whose new date is 2+ days out
        if (order.isRescheduled) {
          return {
            label: 'Rescheduled',
            color: 'bg-orange-100 dark:bg-orange-900/30 text-orange-800 dark:text-orange-300',
            tierLabel: shortDate ? `Future Schedule · ${shortDate}` : 'Future Schedule',
            tierColor: 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-800 dark:text-indigo-300',
          };
        }
        return { label: shortDate ? `Future Schedule · ${shortDate}` : 'Future Schedule', color: 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-800 dark:text-indigo-300' };
      }
      case 'confirmed':         return { label: 'Customer Confirmed',                                                        color: 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300' };
      case 'sms_sent':          return { label: 'Awaiting Customer',                                                         color: 'bg-orange-100 dark:bg-orange-900/30 text-orange-800 dark:text-orange-300' };
      case 'unconfirmed':       return { label: 'No Response',                                                        color: 'bg-rose-100 dark:bg-rose-900/30 text-rose-800 dark:text-rose-300' };
      case 'uploaded':          return { label: 'Pending Order',                                                             color: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300' };
      case 'rescheduled':
        // workflow returns 'rescheduled' only when date is past or unset — no tier badge
        return { label: 'Rescheduled', color: 'bg-orange-100 dark:bg-orange-900/30 text-orange-800 dark:text-orange-300' };
      case 'delivered':         return { label: 'Delivered',                                                                 color: 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300' };
      case 'cancelled':         return { label: 'Cancelled',                                                                 color: 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300' };
      case 'failed':            return { label: 'Failed / Returned',                                                         color: 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300' };
      default:                  return { label: delivery.status?.replace(/-/g, ' ') || 'Pending', color: 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300' };
    }
  };

  // ────────────────────────────────────────────────────────────────────────────


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
    <div className="space-y-3 md:space-y-5 w-full min-w-0">
      {/* Header - responsive and touch-friendly */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl sm:text-3xl font-bold text-gray-900 dark:text-gray-100">Logistics Team Portal</h1>
            <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 mt-0.5">Monitor drivers, manage deliveries, and coordinate operations</p>
          </div>
          <div className="text-xs sm:text-sm text-gray-500 dark:text-gray-400">
            Last update: {lastUpdate.toLocaleTimeString()}
          </div>
      </div>

      {/* Tab Navigation - bigger gap, scroll on mobile */}
      <div className="pp-sticky-tab-rail pp-card mt-0 mb-3 overflow-x-auto px-2 py-2 md:mb-4">
        <nav className="flex flex-wrap gap-2 min-w-max md:min-w-0">
          {[
            { id: 'dashboard',     label: 'Dashboard',   icon: Activity },
            { id: 'deliveries',    label: 'Deliveries',  icon: Package },
            { id: 'communication', label: 'Communication', icon: MessageSquare },
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
              </button>
            );
          })}
        </nav>
      </div>

      {/* Animated tab content — re-mounts on tab change */}
      <div key={activeTab} className="tab-enter">

      {/* ── DASHBOARD TAB ── */}
      {activeTab === 'dashboard' && (
        <div className="space-y-4 md:space-y-5">

          {/* ── Today's Summary (30%) + KPI Stats (70%) side-by-side ── */}
          {(() => {
            const todayIso = getTodayIsoDubai();
            const todayMs = new Date(todayIso + 'T00:00:00+04:00').getTime();
            const tomorrowMs = todayMs + 86400000;
            const t0 = new Date(todayIso + 'T00:00:00+04:00');

            // Workflow-mapped view of every delivery, computed ONCE per render.
            // Cards that conceptually mirror a Manage-table filter MUST count
            // against this array (not raw .status) so dashboard KPIs match the
            // table's filter-tab counts. Without this, a "confirmed" order with
            // GMD set shows under "PGI Done" in the table but disappeared from
            // the dashboard's PGI Done card (table 12, dashboard 0).
            const orders = deliveries.map(d => deliveryToManageOrder(d));

            // Today's Summary stats
            // Count actual deliveries created today (server-side truth).
            // The local `recentUploads` store is per-user and per-session, so it
            // misses uploads done elsewhere (admin/delivery-team portals, SAP, OneDrive).
            const uploadsToday = deliveries.filter(d => {
              const ext = d as unknown as { createdAt?: string };
              if (!ext.createdAt) return false;
              const t = new Date(ext.createdAt).getTime();
              return t >= todayMs && t < tomorrowMs;
            }).length;
            // recentUploads kept here for compatibility; no longer used for this card.
            void recentUploads;
            const totalOrders = deliveries.length;
            const activeDriverIds = new Set(deliveries.map(d => d.assignedDriverId).filter((id): id is string => Boolean(id)));
            const deliveredSummary = deliveries.filter(d => {
              const s = (d.status || '').toLowerCase();
              return ['delivered', 'delivered-with-installation', 'delivered-without-installation', 'finished', 'completed', 'pod-completed'].includes(s);
            }).length;
            const unconfirmedCount = deliveries.filter(d => {
              const s = (d.status || '').toLowerCase();
              return s === 'scheduled' || s === 'sms_sent' || s === 'unconfirmed';
            }).length;

            // KPI Stats
            const pendingGMD = deliveries.filter(d => {
              const ext = d as unknown as { goodsMovementDate?: string };
              return !ext.goodsMovementDate && !TERMINAL_STATUSES.has((d.status || '').toLowerCase());
            }).length;
            const todayProcessed = deliveries.filter(d => {
              const ext = d as unknown as { createdAt?: string };
              if (!ext.createdAt) return false;
              const t = new Date(ext.createdAt).getTime();
              return t >= todayMs && t < tomorrowMs;
            }).length;
            const deliveredKPI = deliveries.filter(d => TERMINAL_STATUSES.has((d.status || '').toLowerCase())).length;
            const pendingPOD = deliveries.filter(d => {
              const s = (d.status || '').toLowerCase();
              const ext = d as unknown as { podCompletedAt?: string; photos?: unknown[]; driverSignature?: string };
              const isDelivered = ['delivered', 'pod-completed', 'delivered-with-installation', 'delivered-without-installation'].includes(s);
              return isDelivered && !ext.podCompletedAt && !ext.driverSignature && (!ext.photos || (ext.photos as unknown[]).length === 0);
            }).length;
            // New stat cards
            const todayDelivery = deliveries.filter(d => {
              const raw = (d as unknown as { confirmedDeliveryDate?: string | null }).confirmedDeliveryDate;
              if (!raw) return false;
              const t = Date.parse(String(raw));
              return Number.isFinite(t) && t >= todayMs && t < tomorrowMs;
            }).length;
            const recentDelivered = deliveries.filter(d => {
              const s = (d.status || '').toLowerCase();
              return ['delivered', 'delivered-with-installation', 'delivered-without-installation', 'pod-completed', 'finished'].includes(s);
            }).length;
            const recentCancelled = deliveries.filter(d => {
              const s = (d.status || '').toLowerCase();
              return s === 'cancelled' || s === 'returned';
            }).length;
            // Advanced workflow counters — PGI Done (warehouse issued, awaiting driver pick)
            // and Ready to Depart (picking list confirmed, waiting on driver's Start Delivery).
            // Both count against the workflow-mapped status so a 'confirmed'/'rescheduled'
            // order with GMD set is correctly classified as PGI Done — same as the table.
            const pgiDoneCount = orders.filter(o => o.status === 'pgi_done').length;
            const readyToDepartCount = orders.filter(o => o.status === 'pickup_confirmed').length;

            // ── Delivery KPI (last 7 Dubai-days): on-time vs delayed ─────────────
            // Bucket each order by its confirmedDeliveryDate Dubai calendar day
            // (fallback to goodsMovementDate only if the promised date is absent).
            // • On-time  = status is one of the terminal delivered aliases AND
            //              deliveredAt (or podCompletedAt) is on/before end of
            //              the bucket day (Dubai 24:00).
            // • Late     = any of:
            //                · delivered late (completedAt after end-of-day)
            //                · status is explicitly order-delay
            //                · bucket day in the past AND still in transit / pgi-done
            //                  / pickup-confirmed (missed the promised day, no
            //                  completion yet)
            // Today's bucket only counts as late on the explicit order-delay
            // signal — orders still in motion today are not yet late.
            // Future bucket days, cancelled/returned rows, and rows with no
            // date at all are skipped (not counted either way).
            const DELAY_STATUSES = new Set(['order-delay', 'order_delay']);
            const DELIVERED_TERMINAL = new Set([
              'delivered', 'delivered-with-installation', 'delivered-without-installation',
              'pod-completed', 'finished', 'completed',
            ]);
            const IN_TRANSIT_SET = new Set([
              'pgi-done', 'pgi_done',
              'pickup-confirmed', 'pickup_confirmed',
              'out-for-delivery', 'out_for_delivery',
              'in-transit', 'in-progress',
            ]);
            const dubaiDayStr = (v: Date | string | null | undefined): string | null => {
              if (!v) return null;
              const dt = v instanceof Date ? v : new Date(v);
              if (isNaN(dt.getTime())) return null;
              const z = new Date(dt.toLocaleString('en-US', { timeZone: 'Asia/Dubai' }));
              return `${z.getFullYear()}-${String(z.getMonth() + 1).padStart(2, '0')}-${String(z.getDate()).padStart(2, '0')}`;
            };
            const todayDayStr = dubaiDayStr(new Date())!;
            // Build the 7-day window [today-6 … today], oldest first.
            const windowDayStrs: string[] = [];
            const windowLabels: string[] = [];
            {
              const [ny, nm, nd] = todayDayStr.split('-').map(Number);
              for (let i = 6; i >= 0; i--) {
                const t = new Date(Date.UTC(ny, nm - 1, nd - i));
                const ds = `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
                windowDayStrs.push(ds);
                windowLabels.push(`${String(t.getUTCDate()).padStart(2, '0')}/${String(t.getUTCMonth() + 1).padStart(2, '0')}`);
              }
            }
            const kpiLineData: { date: string; onTime: number; delayed: number }[] =
              windowDayStrs.map((_, i) => ({ date: windowLabels[i], onTime: 0, delayed: 0 }));

            for (const d of deliveries) {
              const ext = d as unknown as {
                confirmedDeliveryDate?: string | Date | null;
                goodsMovementDate?: string | Date | null;
                deliveredAt?: string | Date | null;
                podCompletedAt?: string | Date | null;
                status?: string | null;
              };
              const bucketDayStr = dubaiDayStr(ext.confirmedDeliveryDate ?? ext.goodsMovementDate ?? null);
              if (!bucketDayStr) continue;
              const idx = windowDayStrs.indexOf(bucketDayStr);
              if (idx === -1) continue;

              const status = (ext.status || '').toLowerCase();
              const completedRaw = ext.deliveredAt ?? ext.podCompletedAt ?? null;
              const completedTs = completedRaw ? new Date(completedRaw as string | Date).getTime() : null;
              const [by, bm, bd] = bucketDayStr.split('-').map(Number);
              // End-of-day Dubai = next-day 00:00 Dubai = 20:00 UTC of the bucket day
              const bucketEndUtcMs = Date.UTC(by, bm - 1, bd, 20, 0, 0, 0);

              if (DELIVERED_TERMINAL.has(status)) {
                if (completedTs != null && completedTs <= bucketEndUtcMs) {
                  kpiLineData[idx].onTime += 1;
                } else {
                  // Delivered but after end-of-day of the promised date → late.
                  kpiLineData[idx].delayed += 1;
                }
                continue;
              }
              if (DELAY_STATUSES.has(status)) {
                kpiLineData[idx].delayed += 1;
                continue;
              }
              if (bucketDayStr < todayDayStr && IN_TRANSIT_SET.has(status)) {
                // Promised day has passed, still in transit → missed the window.
                kpiLineData[idx].delayed += 1;
              }
              // Today / future in-transit, cancelled, returned → not counted.
            }

            const onTimeTotal = kpiLineData.reduce((sum, x) => sum + x.onTime, 0);
            const delayedTotal = kpiLineData.reduce((sum, x) => sum + x.delayed, 0);
            const kpiDenominator = onTimeTotal + delayedTotal;
            const onTimePct = kpiDenominator > 0 ? Math.round((onTimeTotal / kpiDenominator) * 100) : null;

            return (
              <div className="space-y-4">
                {/* ── ROW 1: Today Summary (30%) + KPI Stat Cards (70%) ── */}
                <div className="flex flex-col lg:flex-row gap-4 items-stretch">
                  {/* Today's Summary — 30% */}
                  <div className="bg-[#032145] rounded-xl p-4 sm:p-5 text-white flex flex-col lg:w-[30%] lg:shrink-0">
                    <div className="flex items-center justify-between mb-4 flex-shrink-0">
                      <h3 className="font-semibold text-sm tracking-wide">Today&apos;s Summary</h3>
                      <span className="text-white/40 text-xs">↗</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2.5 flex-1">
                      {[
                        { value: uploadsToday,         label: 'Uploaded Today', sub: 'orders today', color: 'text-sky-300'   },
                        { value: totalOrders,          label: 'Total Orders',   sub: 'in system',    color: 'text-white'     },
                        { value: activeDriverIds.size, label: 'Active Drivers', sub: 'on the road',  color: 'text-amber-300' },
                        { value: deliveredSummary,     label: 'Delivered',      sub: 'completed',    color: 'text-green-300' },
                      ].map(({ value, label, sub, color }) => (
                        <div key={label} className="bg-white/10 hover:bg-white/15 transition-colors rounded-lg p-3 flex flex-col justify-between gap-1">
                          <p className="text-white/50 text-[10px] uppercase tracking-widest font-medium leading-tight">{label}</p>
                          <p className={`text-3xl font-bold leading-none tabular-nums ${color}`}>{value}</p>
                          <p className="text-white/30 text-[9px] uppercase tracking-wider leading-tight">{sub}</p>
                        </div>
                      ))}
                    </div>
                    {unconfirmedCount > 0 && (
                      <div className="mt-3 flex-shrink-0 p-2.5 bg-amber-400/20 border border-amber-400/30 rounded-lg">
                        <p className="text-xs text-amber-200">⚠️ {unconfirmedCount} orders awaiting customer response</p>
                      </div>
                    )}
                  </div>

                  {/* KPI Stat Cards — 70% · responsive grid (2 → 3 → 5).
                      Intermediate `md:` step keeps portrait tablets readable
                      instead of cramming 5 columns into ~768px. */}
                  <div className="flex-1 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
                    <div
                      onClick={() => {
                        useDeliveryStore.getState().setManageTabFilter('pending_gmd');
                        setActiveTab('deliveries');
                        setDeliveriesSubTab('manage');
                      }}
                      className="pp-card p-4 flex flex-col items-center justify-center text-center cursor-pointer hover:ring-2 hover:ring-amber-400 transition-all"
                      title="Deliveries with no Post Goods Issue date"
                    >
                      <div className="text-[11px] font-medium text-gray-500 dark:text-gray-400 mb-1">Pending PGI</div>
                      <div className="text-3xl font-bold text-amber-600 dark:text-amber-400">{pendingGMD}</div>
                      <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-1">no PGI date</div>
                    </div>
                    <div className="pp-card p-4 flex flex-col items-center justify-center text-center">
                      <div className="text-[11px] font-medium text-gray-500 dark:text-gray-400 mb-1">Today Processed</div>
                      <div className="text-3xl font-bold text-blue-600 dark:text-blue-400">{todayProcessed}</div>
                      <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-1">new POs today</div>
                    </div>
                    <div className="pp-card p-4 flex flex-col items-center justify-center text-center">
                      <div className="text-[11px] font-medium text-gray-500 dark:text-gray-400 mb-1">Today Delivery</div>
                      <div className="text-3xl font-bold text-indigo-600 dark:text-indigo-400">{todayDelivery}</div>
                      <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-1">scheduled today</div>
                    </div>
                    <div
                      onClick={() => {
                        useDeliveryStore.getState().setManageTabFilter('pending_pod');
                        setActiveTab('deliveries');
                        setDeliveriesSubTab('manage');
                      }}
                      className="pp-card p-4 flex flex-col items-center justify-center text-center cursor-pointer hover:ring-2 hover:ring-red-400 transition-all"
                      title="Delivered orders missing proof of delivery"
                    >
                      <div className="text-[11px] font-medium text-gray-500 dark:text-gray-400 mb-1">Pending POD</div>
                      <div className={`text-3xl font-bold ${pendingPOD > 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-400 dark:text-gray-500'}`}>{pendingPOD}</div>
                      <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-1">no proof attached</div>
                    </div>
                    <div className="pp-card p-4 flex flex-col items-center justify-center text-center">
                      <div className="text-[11px] font-medium text-gray-500 dark:text-gray-400 mb-1">Delivery KPI</div>
                      {onTimePct !== null ? (
                        <>
                          <div className={`text-3xl font-bold ${onTimePct >= 80 ? 'text-green-600 dark:text-green-400' : onTimePct >= 60 ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400'}`}>{onTimePct}%</div>
                          <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-1">{onTimeTotal} on time · {delayedTotal} late · 7d</div>
                        </>
                      ) : (
                        <>
                          <div className="text-3xl font-bold text-gray-300 dark:text-gray-600">—</div>
                          <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-1">on-time rate · last 7 days</div>
                        </>
                      )}
                    </div>
                    <div className="pp-card p-4 flex flex-col items-center justify-center text-center">
                      <div className="text-[11px] font-medium text-gray-500 dark:text-gray-400 mb-1">Total Delivered</div>
                      <div className="text-3xl font-bold text-green-600 dark:text-green-400">{deliveredKPI}</div>
                      <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-1">completed</div>
                    </div>
                    <div className="pp-card p-4 flex flex-col items-center justify-center text-center">
                      <div className="text-[11px] font-medium text-gray-500 dark:text-gray-400 mb-1">Recent Delivered</div>
                      <div className="text-3xl font-bold text-emerald-600 dark:text-emerald-400">{recentDelivered}</div>
                      <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-1">incl. with POD</div>
                    </div>
                    <div className="pp-card p-4 flex flex-col items-center justify-center text-center">
                      <div className="text-[11px] font-medium text-gray-500 dark:text-gray-400 mb-1">Cancelled</div>
                      <div className={`text-3xl font-bold ${recentCancelled > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-gray-400 dark:text-gray-500'}`}>{recentCancelled}</div>
                      <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-1">cancelled / returned</div>
                    </div>
                    <div
                      onClick={() => {
                        // ManageTab reads `manageTabFilter` and forwards it to
                        // OrdersTable as tableTab; setDeliveryListFilter writes
                        // into a different store used by the driver-facing
                        // DeliveryTable, so the admin OrdersTable never sees it.
                        useDeliveryStore.getState().setManageTabFilter('pgi_done');
                        setActiveTab('deliveries');
                        setDeliveriesSubTab('manage');
                      }}
                      className="pp-card p-4 flex flex-col items-center justify-center text-center cursor-pointer hover:ring-2 hover:ring-amber-400 transition-all"
                      title="Warehouse has issued goods — awaiting driver pick"
                    >
                      <div className="text-[11px] font-medium text-gray-500 dark:text-gray-400 mb-1">PGI Done</div>
                      <div className={`text-3xl font-bold ${pgiDoneCount > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-gray-400 dark:text-gray-500'}`}>{pgiDoneCount}</div>
                      <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-1">awaiting driver pick</div>
                    </div>
                    <div
                      onClick={() => {
                        useDeliveryStore.getState().setManageTabFilter('pickup_confirmed');
                        setActiveTab('deliveries');
                        setDeliveriesSubTab('manage');
                      }}
                      className="pp-card p-4 flex flex-col items-center justify-center text-center cursor-pointer hover:ring-2 hover:ring-teal-400 transition-all"
                      title="Driver confirmed pickup — item collected"
                    >
                      <div className="text-[11px] font-medium text-gray-500 dark:text-gray-400 mb-1">Pickup Confirmed</div>
                      <div className={`text-3xl font-bold ${readyToDepartCount > 0 ? 'text-teal-600 dark:text-teal-400' : 'text-gray-400 dark:text-gray-500'}`}>{readyToDepartCount}</div>
                      <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-1">item collected</div>
                    </div>
                  </div>
                </div>

                {/* ── ROW 2: 3 Charts (equal columns) ── */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                  {/* Chart 1 — Status Breakdown (donut). Counts use the
                      workflow-mapped order.status so chart segments match the
                      Manage table's filter-tab counts (e.g. a 'confirmed +
                      GMD' row shows under PGI Done in both, not split). */}
                  {(() => {
                    const statusGroups = [
                      { name: 'Delivered',  value: orders.filter(o => o.status === 'delivered').length,         color: '#22c55e' },
                      { name: 'On Route',   value: orders.filter(o => o.status === 'out_for_delivery').length,  color: '#3b82f6' },
                      { name: 'Awaiting',   value: orders.filter(o => o.status === 'sms_sent' || o.status === 'unconfirmed').length, color: '#a855f7' },
                      { name: 'Pending',    value: orders.filter(o => ['uploaded','next_shipment','future_schedule','rescheduled'].includes(o.status)).length, color: '#f59e0b' },
                      { name: 'Delayed',    value: orders.filter(o => o.status === 'order_delay').length,       color: '#ef4444' },
                    ].filter(g => g.value > 0);
                    const total = statusGroups.reduce((s, g) => s + g.value, 0);
                    return (
                      <div className="pp-card flex min-h-0 flex-col p-4 sm:p-5 lg:h-[300px]">
                        <div className="mb-2 flex flex-shrink-0 items-center gap-2">
                          <Activity className="h-5 w-5 flex-shrink-0 text-blue-500" />
                          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Status Breakdown</h2>
                          <span className="ml-auto text-[10px] text-gray-400 dark:text-gray-500">{total} total</span>
                        </div>
                        {total === 0 ? (
                          <div className="flex-1 flex items-center justify-center text-sm text-gray-400 dark:text-gray-500">No data</div>
                        ) : (
                          <div className="flex-1 flex flex-col items-center justify-center min-h-0">
                            {/* Donut with slice-value labels and a centred total.
                                Hover still shows the Tooltip with exact % for
                                power users; at-a-glance readers get the number
                                without interacting. */}
                            <div className="relative w-full" style={{ height: 170 }}>
                              <ResponsiveContainer width="100%" height={170}>
                                <PieChart>
                                  <Pie
                                    data={statusGroups}
                                    cx="50%"
                                    cy="50%"
                                    innerRadius={48}
                                    outerRadius={72}
                                    paddingAngle={2}
                                    dataKey="value"
                                    label={(props: Record<string, unknown>) => {
                                      const v = typeof props.value === 'number' ? props.value : 0;
                                      return v > 0 ? String(v) : '';
                                    }}
                                    labelLine={false}
                                    fontSize={11}
                                  >
                                    {statusGroups.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                                  </Pie>
                                  <Tooltip formatter={(v: number, name: string) => [`${v} (${Math.round(v/total*100)}%)`, name]} contentStyle={{ fontSize: 11 }} />
                                </PieChart>
                              </ResponsiveContainer>
                              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                                <div className="text-xl font-bold text-gray-900 dark:text-gray-100 leading-none">{total}</div>
                                <div className="text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400 mt-0.5">total</div>
                              </div>
                            </div>
                            <div className="flex flex-wrap justify-center gap-x-3 gap-y-1 mt-1">
                              {statusGroups.map(g => (
                                <div key={g.name} className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-400">
                                  <span className="w-2 h-2 rounded-full inline-block" style={{ background: g.color }} />
                                  <span>{g.name}</span>
                                  <span className="font-semibold text-gray-800 dark:text-gray-200">{g.value}</span>
                                  <span className="text-[10px] text-gray-400 dark:text-gray-500">({Math.round(g.value/total*100)}%)</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {/* Chart 2 — Delivery KPI (last 7 days: on-time vs late).
                      Uses the kpiLineData + onTimePct computed once above so the
                      card, the on-time badge, and this chart all tell the same
                      story. Scaffolding (axis + grid) always renders; a small
                      caption signals a truly empty window instead of a
                      full-height "No data" panel. */}
                  <div className="pp-card flex min-h-0 flex-col p-4 sm:p-5 lg:h-[300px]">
                    <div className="mb-2 flex flex-shrink-0 items-center gap-2">
                      <TrendingUp className="h-5 w-5 flex-shrink-0 text-green-500" />
                      <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Delivery KPI</h2>
                      <span className="ml-auto text-xs font-semibold">
                        <span className={`${onTimePct !== null && onTimePct >= 80 ? 'text-green-600 dark:text-green-400' : onTimePct !== null && onTimePct >= 60 ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400'}`}>
                          {onTimePct !== null ? `${onTimePct}%` : '—'}
                        </span>
                        <span className="text-[10px] text-gray-400 dark:text-gray-500 ml-1">on-time</span>
                      </span>
                    </div>
                    <div className="flex-1 min-h-0">
                      <ResponsiveContainer width="100%" height={200}>
                        <LineChart data={kpiLineData} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                          <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="#9ca3af" />
                          <YAxis allowDecimals={false} tick={{ fontSize: 10 }} stroke="#9ca3af" />
                          <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                          <Line type="monotone" dataKey="onTime" name="On Time" stroke="#22c55e" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                          <Line type="monotone" dataKey="delayed" name="Late" stroke="#ef4444" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                          <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                    {kpiDenominator === 0 && (
                      <div className="text-[10px] text-center text-gray-400 dark:text-gray-500 mt-1">
                        No completed or delayed deliveries in the last 7 days
                      </div>
                    )}
                  </div>

                  {/* Chart 3 — Driver Workload (bar chart).
                      Inline LabelList shows the count inside each segment when
                      it's wide enough, and a total number sits above every bar
                      so the per-driver workload is readable without hovering.
                      A small totals strip below the chart surfaces fleet-wide
                      counts per status. */}
                  {(() => {
                    const driverData = drivers.map(dr => {
                      const drOrders = deliveries.filter(d => {
                        const ext = d as unknown as { tracking?: { driverId?: string } };
                        return ext.tracking?.driverId === dr.id || d.assignedDriverId === dr.id;
                      });
                      const onRoute = drOrders.filter(d => (d.status||'').toLowerCase() === 'out-for-delivery').length;
                      const delivered = drOrders.filter(d => TERMINAL_STATUSES.has((d.status||'').toLowerCase())).length;
                      const pending = drOrders.filter(d => !['out-for-delivery','out_for_delivery'].includes((d.status||'').toLowerCase()) && !TERMINAL_STATUSES.has((d.status||'').toLowerCase())).length;
                      return {
                        name: (dr.fullName || dr.username || '').split(' ')[0],
                        'On Route': onRoute,
                        Delivered: delivered,
                        Pending: pending,
                        total: onRoute + delivered + pending,
                      };
                    });
                    const fleetOnRoute = driverData.reduce((s, d) => s + d['On Route'], 0);
                    const fleetPending = driverData.reduce((s, d) => s + d.Pending, 0);
                    const fleetDelivered = driverData.reduce((s, d) => s + d.Delivered, 0);
                    return (
                      <div className="pp-card flex min-h-0 flex-col p-4 sm:p-5 lg:h-[300px]">
                        <div className="mb-2 flex flex-shrink-0 items-center gap-2">
                          <Truck className="h-5 w-5 flex-shrink-0 text-teal-500" />
                          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Driver Workload</h2>
                          <span className="ml-auto text-[10px] text-gray-400 dark:text-gray-500">orders assigned</span>
                        </div>
                        {drivers.length === 0 ? (
                          <div className="flex-1 flex items-center justify-center text-sm text-gray-400 dark:text-gray-500">No drivers</div>
                        ) : (
                          <>
                            <div className="flex-1 min-h-0">
                              <ResponsiveContainer width="100%" height={200}>
                                <BarChart data={driverData} margin={{ top: 16, right: 4, left: -20, bottom: 0 }} barSize={18}>
                                  <XAxis dataKey="name" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                                  <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} allowDecimals={false} />
                                  <Tooltip contentStyle={{ fontSize: 11 }} />
                                  <Legend wrapperStyle={{ fontSize: 10, paddingTop: 4 }} />
                                  <Bar dataKey="On Route" stackId="a" fill="#3b82f6" radius={[0,0,0,0]}>
                                    <LabelList dataKey="On Route" position="center" style={{ fontSize: 10, fill: '#fff', fontWeight: 600 }} formatter={(v: unknown) => (typeof v === 'number' && v > 0 ? String(v) : '')} />
                                  </Bar>
                                  <Bar dataKey="Pending"  stackId="a" fill="#f59e0b" radius={[0,0,0,0]}>
                                    <LabelList dataKey="Pending" position="center" style={{ fontSize: 10, fill: '#fff', fontWeight: 600 }} formatter={(v: unknown) => (typeof v === 'number' && v > 0 ? String(v) : '')} />
                                  </Bar>
                                  <Bar dataKey="Delivered" stackId="a" fill="#22c55e" radius={[3,3,0,0]}>
                                    <LabelList dataKey="Delivered" position="center" style={{ fontSize: 10, fill: '#fff', fontWeight: 600 }} formatter={(v: unknown) => (typeof v === 'number' && v > 0 ? String(v) : '')} />
                                    <LabelList dataKey="total" position="top" style={{ fontSize: 11, fill: '#111827', fontWeight: 700 }} formatter={(v: unknown) => (typeof v === 'number' && v > 0 ? String(v) : '')} />
                                  </Bar>
                                </BarChart>
                              </ResponsiveContainer>
                            </div>
                            <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-[11px] border-t border-gray-100 dark:border-gray-700 pt-2 mt-1">
                              <div className="flex items-center gap-1.5 text-gray-600 dark:text-gray-400">
                                <span className="w-2 h-2 rounded-full inline-block bg-blue-500" />
                                <span>On Route</span>
                                <span className="font-semibold text-gray-800 dark:text-gray-200">{fleetOnRoute}</span>
                              </div>
                              <div className="flex items-center gap-1.5 text-gray-600 dark:text-gray-400">
                                <span className="w-2 h-2 rounded-full inline-block bg-amber-500" />
                                <span>Pending</span>
                                <span className="font-semibold text-gray-800 dark:text-gray-200">{fleetPending}</span>
                              </div>
                              <div className="flex items-center gap-1.5 text-gray-600 dark:text-gray-400">
                                <span className="w-2 h-2 rounded-full inline-block bg-green-500" />
                                <span>Delivered</span>
                                <span className="font-semibold text-gray-800 dark:text-gray-200">{fleetDelivered}</span>
                              </div>
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })()}
                </div>

                {/* ── Action buttons (hidden — preserved for future use) ── */}
                {false && (<div className="grid grid-cols-2 gap-3">
                <div
                  onClick={() => { setActiveTab('deliveries'); setDeliveriesSubTab('manage'); }}
                  className="rounded-xl p-4 flex items-center gap-3 cursor-pointer bg-primary-900 hover:bg-primary-800 transition-all group shadow-sm"
                  title="Open Delivery Orders & Dispatch"
                >
                  <div className="w-9 h-9 rounded-lg bg-white/15 flex items-center justify-center flex-shrink-0">
                    <Package className="w-4 h-4 text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-white font-semibold text-sm leading-tight">Manage Delivery Orders</p>
                    <p className="text-white/60 text-[10px] mt-0.5">View, assign &amp; dispatch</p>
                  </div>
                  <span className="text-white/50 group-hover:text-white/80 text-lg leading-none transition-colors">→</span>
                </div>
                <div
                  onClick={() => { setActiveTab('deliveries'); setDeliveriesSubTab('live-maps'); }}
                  className="rounded-xl p-4 flex items-center gap-3 cursor-pointer bg-emerald-700 hover:bg-emerald-600 transition-all group shadow-sm"
                  title="Open Live Driver Tracking"
                >
                  <div className="w-9 h-9 rounded-lg bg-white/15 flex items-center justify-center flex-shrink-0">
                    <NavigationIcon className="w-4 h-4 text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-white font-semibold text-sm leading-tight">Live Tracking</p>
                    <p className="text-white/60 text-[10px] mt-0.5">Real-time driver map</p>
                  </div>
                  <span className="text-white/50 group-hover:text-white/80 text-lg leading-none transition-colors">→</span>
                </div>
                </div>)}

              </div>
            );
          })()}

          {/* ── Needs Attention · Awaiting Customer (hidden per ops request — Truck Capacity moved to Live Maps tab) ── */}
          {false && (<div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-stretch">
            {/* Needs Attention */}
            <div className="pp-card flex min-h-0 flex-col p-4 sm:p-5 lg:h-[340px]">
              <div className="mb-3 flex flex-shrink-0 items-center gap-2">
                <AlertCircle className="h-5 w-5 flex-shrink-0 text-amber-500" />
                <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Needs Attention</h2>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto pr-0.5">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4">
                  {([
                  { tableTab: 'all',               count: actionItems.pendingOrders.length,        label: 'Pending Orders',    sublabel: 'Not yet completed', bg: 'bg-amber-50 dark:bg-amber-900/20',  border: 'border-amber-100 dark:border-amber-800/30',   hover: 'hover:bg-amber-100 dark:hover:bg-amber-900/30',   countColor: 'text-amber-600 dark:text-amber-400',   labelColor: 'text-amber-700 dark:text-amber-400'   },
                  { tableTab: 'unassigned',        count: actionItems.unassigned.length,           label: 'Unassigned',        sublabel: 'Needs driver',      bg: 'bg-orange-50 dark:bg-orange-900/20',border: 'border-orange-100 dark:border-orange-800/30',  hover: 'hover:bg-orange-100 dark:hover:bg-orange-900/30', countColor: 'text-orange-600 dark:text-orange-400', labelColor: 'text-orange-700 dark:text-orange-400' },
                  { tableTab: 'awaiting_customer', count: actionItems.awaitingConfirmation.length, label: 'Awaiting Customer',  sublabel: 'No confirmation',  bg: 'bg-purple-50 dark:bg-purple-900/20',border: 'border-purple-100 dark:border-purple-800/30',  hover: 'hover:bg-purple-100 dark:hover:bg-purple-900/30', countColor: 'text-purple-600 dark:text-purple-400', labelColor: 'text-purple-700 dark:text-purple-400' },
                  { tableTab: 'order_delay',       count: actionItems.orderDelay.length,           label: 'Order Delays',      sublabel: 'Needs resolution',  bg: 'bg-red-50 dark:bg-red-900/20',     border: 'border-red-100 dark:border-red-800/30',        hover: 'hover:bg-red-100 dark:hover:bg-red-900/30',       countColor: 'text-red-600 dark:text-red-400',       labelColor: 'text-red-700 dark:text-red-400'       },
                ] as const).map(({ tableTab: targetTab, count, label, sublabel, bg, border, hover, countColor, labelColor }) => (
                  <div
                    key={label}
                    onClick={() => {
                      useDeliveryStore.getState().setManageTabFilter(targetTab);
                      setActiveTab('deliveries');
                      setDeliveriesSubTab('manage');
                    }}
                    className={`flex flex-col items-center justify-center rounded-xl border p-3 ${bg} ${border} ${hover} cursor-pointer select-none transition-colors`}
                    title={`View ${label} in Delivery Orders & Dispatch`}
                  >
                    <span className={`text-xl font-bold ${countColor}`}>{count}</span>
                    <span className={`mt-0.5 text-center text-xs font-semibold leading-tight ${labelColor}`}>{label}</span>
                    <span className="mt-0.5 text-center text-[10px] text-gray-400 dark:text-gray-500">→ {sublabel}</span>
                  </div>
                ))}
                </div>
                {(actionItems.pendingOrders.length > 0 || actionItems.unassigned.length > 0 || actionItems.awaitingConfirmation.length > 0 || actionItems.orderDelay.length > 0) && (
                  <p className="mt-3 text-center text-xs text-gray-400 dark:text-gray-500">Tap any card to open the filtered order list in Delivery Orders & Dispatch</p>
                )}
              </div>
            </div>

            {/* Awaiting Customer Response list */}
            <div className="pp-card flex min-h-0 flex-col p-4 sm:p-5 lg:h-[340px]">
              <div className="mb-3 flex flex-shrink-0 items-center gap-2">
                <MessageSquare className="h-5 w-5 flex-shrink-0 text-purple-500" />
                <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Awaiting Customer Response</h2>
                {actionItems.awaitingConfirmation.length > 0 && (
                  <span className="ml-auto rounded-full bg-purple-100 px-2 py-0.5 text-xs font-bold text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">
                    {actionItems.awaitingConfirmation.length}
                  </span>
                )}
              </div>
              {actionItems.awaitingConfirmation.length === 0 ? (
                <div className="flex min-h-0 flex-1 items-center justify-center py-4 text-sm text-gray-400 dark:text-gray-500">
                  <CheckCircle className="mr-2 h-4 w-4 flex-shrink-0 text-green-400" /> All customers responded
                </div>
              ) : (
                <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-0.5">
                  {actionItems.awaitingConfirmation.map((delivery, idx) => {
                    const sentAgo = (() => {
                      const t = delivery.updatedAt || delivery.createdAt || delivery.created_at;
                      if (!t) return null;
                      const diff = Date.now() - new Date(t as string).getTime();
                      const h = Math.floor(diff / 3600000);
                      const m = Math.floor((diff % 3600000) / 60000);
                      return h > 0 ? `${h}h ago` : `${m}m ago`;
                    })();
                    return (
                      <div key={delivery.id || idx} className="flex items-start gap-3 rounded-lg border border-purple-100 bg-purple-50 p-2.5 dark:border-purple-800/20 dark:bg-purple-900/10">
                        <Clock className="mt-0.5 h-4 w-4 flex-shrink-0 text-purple-500" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                            {delivery.customer || 'Unknown Customer'}
                          </p>
                          <p className="truncate text-xs text-gray-500 dark:text-gray-400">
                            {delivery.poNumber ? `PO: ${delivery.poNumber}` : ''} {delivery.address || ''}
                          </p>
                        </div>
                        {sentAgo && (
                          <span className="shrink-0 text-xs text-purple-600 dark:text-purple-400">{sentAgo}</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

          </div>)}

          {/* ── Driver Status + old Charts grid (hidden — preserved for future use) ── */}
          {false && (<div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-stretch">

            {/* Driver Status — hidden, preserved for future use */}
            <div className="pp-card flex min-h-0 flex-col p-4 sm:p-5 lg:h-[340px]">
              <div className="mb-3 flex flex-shrink-0 items-center gap-2">
                <Users className="h-5 w-5 flex-shrink-0 text-indigo-500" />
                <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Driver Status</h2>
                <span className="ml-auto text-[10px] text-gray-400 dark:text-gray-500">Click to chat</span>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto space-y-2 pr-0.5">
                {drivers.length === 0 ? (
                  <div className="flex items-center justify-center py-8 text-sm text-gray-400 dark:text-gray-500">No drivers</div>
                ) : drivers.map(driver => {
                  const isOnline = isContactOnline(driver);
                  const assignedOrders = deliveries.filter(d => {
                    const dExt = d as unknown as { tracking?: { driverId?: string } };
                    return (dExt.tracking?.driverId === driver.id || d.assignedDriverId === driver.id) && (d.status || '').toLowerCase() === 'out-for-delivery';
                  }).length;
                  return (
                    <button
                      key={driver.id}
                      type="button"
                      onClick={() => { setSelectedContact(driver); setActiveTab('communication'); void loadMessages(driver.id); }}
                      className="w-full text-left px-2.5 py-2 rounded-xl border border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 hover:border-indigo-200 dark:hover:border-indigo-700 transition-all group flex items-center gap-2"
                    >
                      <div className="relative flex-shrink-0">
                        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-indigo-500 to-blue-600 flex items-center justify-center text-white text-[11px] font-bold">
                          {(driver.fullName || driver.username || '?')[0].toUpperCase()}
                        </div>
                        <span className={`absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border-2 border-white dark:border-gray-800 ${isOnline ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-semibold text-gray-900 dark:text-gray-100 truncate">{driver.fullName || driver.username}</div>
                        <div className="flex items-center gap-2 text-[10px]">
                          <span className={isOnline ? 'text-green-600 dark:text-green-400' : 'text-gray-400'}>{isOnline ? '● Online' : '○ Offline'}</span>
                          {assignedOrders > 0 && <span className="text-blue-500"><Truck className="inline w-2.5 h-2.5 mr-0.5" />{assignedOrders} on route</span>}
                        </div>
                      </div>
                      <MessageSquare className="w-3 h-3 text-gray-300 dark:text-gray-600 group-hover:text-indigo-500 flex-shrink-0" />
                    </button>
                  );
                })}
                {alerts.length > 0 && (
                  <div className="mt-1 pt-2 border-t border-gray-100 dark:border-gray-700 space-y-1">
                    {alerts.slice(0, 3).map(alert => (
                      <div key={alert.id} className="flex items-start gap-1.5 p-1.5 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-100 dark:border-yellow-800/40 rounded-lg">
                        <AlertCircle className="w-3 h-3 text-amber-500 flex-shrink-0 mt-0.5" />
                        <p className="text-[10px] text-gray-600 dark:text-gray-300 leading-tight truncate">
                          <span className="font-medium">{alert.driver || alert.delivery}:</span> {alert.message}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

          </div>)}

        </div>
      )}

      {/* ── DELIVERIES TAB ── */}
      {activeTab === 'deliveries' && (
        <DeliveryManagementPage
          hidePageTitle
          excludeGarbageUploadRows
          hideUpload
          hideDeliveriesTab
          enableDispatchFilters
          showActionCards={false}
          showTabRailPolicyGuide
          showMaterialColumn
          getDriverCapacity={(orderId, driverId) => {
            const d = deliveries.find(x => x.id === orderId);
            if (!d) return null;
            return getDriverCapacity(d, driverId) ?? null;
          }}
          driverList={drivers.map(dr => ({ id: dr.id, fullName: dr.fullName ?? null, username: dr.username }))}
          driverCapacityByDate={driverCapacityByDate}
          onlineDriverIds={new Set(drivers.filter(dr => isContactOnline(dr)).map(dr => dr.id))}
          forceTab={deliveriesSubTab}
          onTabChange={(id) => setDeliveriesSubTab(id)}
          extraTabs={[
            {
              id: 'live-maps',
              label: 'Live Maps',
              icon: MapPin,
              content: (() => {
            // Filter deliveries for the live-maps panel.
            // Rules:
            //   1. INCLUDE only on-route, order-delay, and confirmed variants — the
            //      driver is genuinely in motion / actively expected to move. Delivered,
            //      cancelled, rejected, failed, returned, and pre-confirmation rows are
            //      all excluded so the map shows only addresses worth routing to.
            //   2. Only include orders that have a driver assigned (live tracking OR assignedDriverId)
            //   3. When a specific driver is selected, show only that driver's orders
            //   4. Apply the status-based quick filter (liveStatusFilter)
            const LIVE_MAP_VISIBLE = new Set([
              'out-for-delivery', 'in-transit', 'in-progress',    // On Route
              'order-delay',                                       // Order Delay
              'confirmed', 'scheduled-confirmed', 'rescheduled',   // Confirmed / Rescheduled
            ]);
            const nowForFilter = new Date();
            const trackingDeliveries = deliveries
              .filter(d => {
                // 1. Include only on-route / delayed / confirmed rows
                if (!LIVE_MAP_VISIBLE.has((d.status || '').toLowerCase())) return false;

                const ext = d as unknown as { tracking?: { driverId?: string }; confirmedDeliveryDate?: string; metadata?: Record<string, unknown> };
                const liveDriverId = ext.tracking?.driverId;

                // 2. Only show orders that have a driver (assigned or live tracking)
                const hasDriver = liveDriverId || d.assignedDriverId;
                if (!hasDriver) return false;

                // 3. Driver filter
                if (trackingDriverFilter !== 'all') {
                  if (liveDriverId && liveDriverId !== trackingDriverFilter) return false;
                  if (!(liveDriverId === trackingDriverFilter || d.assignedDriverId === trackingDriverFilter)) return false;
                }

                // 4. Status quick filter
                const status = (d.status || '').toLowerCase();
                if (liveStatusFilter === 'out_for_delivery') {
                  // Match every actively-in-motion status — out-for-delivery plus
                  // the legacy in-transit / in-progress aliases — so the pill
                  // count matches the pins drawn by the route polyline.
                  return ['out-for-delivery', 'in-transit', 'in-progress'].includes(status);
                }
                if (liveStatusFilter === 'confirmed') {
                  return ['confirmed', 'scheduled-confirmed', 'rescheduled'].includes(status);
                }
                if (liveStatusFilter === 'priority') {
                  const meta = ext.metadata ?? {};
                  return meta.isPriority === true;
                }
                if (liveStatusFilter === 'delayed') {
                  const confirmedDate = ext.confirmedDeliveryDate;
                  if (!confirmedDate) return false;
                  const endOfDay = new Date(confirmedDate);
                  endOfDay.setHours(23, 59, 59, 999);
                  return nowForFilter > endOfDay;
                }
                return true; // 'all'
              })
              // 5. Date filter (Today / Tomorrow / All) — uses the same Dubai
              // calendar resolver as the capacity API so the capacity bar in
              // the driver header always lines up with the visible cards.
              // 'all' is a no-op so existing status/driver filters still bound the list.
              .filter((d) => {
                if (liveMapsDateMode === 'all') return true;
                return getCapacityDateIso(d) === (liveMapsDateMode === 'today' ? getTodayIsoDubai() : addCalendarDaysDubai(getTodayIsoDubai(), 1));
              })
              // 6. Free-text search — matches customer / PO / delivery no / phone.
              // Applied last so status + driver filters still bound the space.
              .filter((d) => {
                const q = trackingSearchQuery.trim().toLowerCase();
                if (!q) return true;
                const rec = d as unknown as {
                  customer?: string | null;
                  poNumber?: string | null;
                  deliveryNumber?: string | null;
                  phone?: string | null;
                  address?: string | null;
                };
                const haystack = [
                  rec.customer,
                  rec.poNumber,
                  rec.deliveryNumber,
                  rec.phone,
                  rec.address,
                ]
                  .filter((v): v is string => typeof v === 'string' && v.length > 0)
                  .join(' ')
                  .toLowerCase();
                return haystack.includes(q);
              })
              // Sort: priority first → out-for-delivery before confirmed → by confirmed date → by name
              .sort((a, b) => {
                const am = (a as unknown as { metadata?: Record<string, unknown> }).metadata ?? {};
                const bm = (b as unknown as { metadata?: Record<string, unknown> }).metadata ?? {};
                const ap = am.isPriority === true ? 0 : 1;
                const bp = bm.isPriority === true ? 0 : 1;
                if (ap !== bp) return ap - bp;
                // out-for-delivery before other statuses
                const aOfd = (a.status || '').toLowerCase() === 'out-for-delivery' ? 0 : 1;
                const bOfd = (b.status || '').toLowerCase() === 'out-for-delivery' ? 0 : 1;
                if (aOfd !== bOfd) return aOfd - bOfd;
                const aDate = (a as unknown as { confirmedDeliveryDate?: string }).confirmedDeliveryDate;
                const bDate = (b as unknown as { confirmedDeliveryDate?: string }).confirmedDeliveryDate;
                if (aDate && bDate) return new Date(aDate).getTime() - new Date(bDate).getTime();
                if (aDate) return -1;
                if (bDate) return 1;
                return (a.customer || '').localeCompare(b.customer || '');
              });
            const highlightedIndex = trackingSelectedId
              ? trackingDeliveries.findIndex(d => d.id === trackingSelectedId)
              : null;

            // ── Per-delivery unit count (mirrors server's parseDeliveryItemCount) ──
            // Used to (a) sum a driver's load in the group header and (b) show a
            // "× N units" chip on each card. Server still owns the truth at
            // assignment time; this is for display only.
            const unitsFor = (d: Delivery): number => {
              const meta = (d.metadata ?? {}) as Record<string, unknown>;
              const orig = (meta.originalRow ?? meta._originalRow ?? {}) as Record<string, unknown>;
              const num = (v: unknown): number => {
                const n = typeof v === 'number' ? v : Number.parseFloat(String(v ?? ''));
                return Number.isFinite(n) && n > 0 ? n : 0;
              };
              let q = num(meta.originalQuantity);
              if (q > 0) return Math.min(9999, Math.ceil(q));
              q = num(
                orig['Order Quantity']
                ?? orig['Confirmed quantity']
                ?? orig['Total Line Deliv. Qt']
                ?? orig['Order Qty']
                ?? orig['Quantity']
                ?? orig['qty']
                ?? orig['QTY']
              );
              if (q > 0) return Math.min(9999, Math.ceil(q));
              if (d.items) {
                try {
                  const parsed = JSON.parse(String(d.items)) as unknown;
                  if (Array.isArray(parsed) && parsed.length > 0) {
                    let sum = 0;
                    for (const row of parsed) {
                      if (row && typeof row === 'object') {
                        const o = row as Record<string, unknown>;
                        const r = num(o['Order Quantity'])
                          || num(o['Confirmed quantity'])
                          || num(o.Quantity)
                          || num(o.quantity)
                          || num(o.qty)
                          || num(o.Qty);
                        sum += r > 0 ? r : 1;
                      } else {
                        sum += 1;
                      }
                    }
                    return Math.max(1, Math.min(9999, Math.ceil(sum)));
                  }
                } catch { /* fall through */ }
              }
              return 1;
            };

            // ── Date scope for the right-hand panel ──
            // 'today' / 'tomorrow' resolve to a Dubai ISO date and select which
            // capacity bar shows in the driver header. 'all' shows everything
            // already passed by the existing filters with no extra scoping.
            const todayIsoForPanel = getTodayIsoDubai();
            const tomorrowIsoForPanel = addCalendarDaysDubai(todayIsoForPanel, 1);
            const targetCapacityIso = liveMapsDateMode === 'today'
              ? todayIsoForPanel
              : liveMapsDateMode === 'tomorrow'
                ? tomorrowIsoForPanel
                : null;

            // Build an interleaved list of "header" + "card" entries based on
            // the selected view mode. A single render pass iterates this and
            // branches on entry.type — the existing card JSX below is reused
            // verbatim for every card entry.
            type DisplayItem =
              | {
                  type: 'header';
                  key: string;
                  label: string;
                  color?: string;
                  // Rich payload (driver mode only): drives the capacity bar + on-route/delayed badges
                  driverId?: string;
                  online?: boolean;
                  stops?: number;
                  units?: number;
                  ofd?: number;
                  delay?: number;
                  isUnassigned?: boolean;
                }
              | { type: 'card'; delivery: typeof trackingDeliveries[number]; idx: number };
            const displayItems: DisplayItem[] = (() => {
              const items: DisplayItem[] = [];
              if (liveMapsViewMode === 'flat') {
                trackingDeliveries.forEach((d, i) => items.push({ type: 'card', delivery: d, idx: i }));
                return items;
              }
              if (liveMapsViewMode === 'driver') {
                const byId = new Map<string, typeof trackingDeliveries>();
                const unassigned: typeof trackingDeliveries = [];
                for (const d of trackingDeliveries) {
                  const ext = d as unknown as { tracking?: { driverId?: string } };
                  const did = ext.tracking?.driverId || d.assignedDriverId || null;
                  if (!did) { unassigned.push(d); continue; }
                  if (!byId.has(did)) byId.set(did, []);
                  byId.get(did)!.push(d);
                }
                const driverColorFromRoutes = new Map(driverRoutes.map((r) => [r.driverId, r.color] as const));
                let runningIdx = 0;
                for (const [driverId, group] of byId.entries()) {
                  const drv = drivers.find((x) => x.id === driverId);
                  const name = drv?.fullName || drv?.username || 'Driver';
                  const online = drv ? isContactOnline(drv) : false;
                  // Aggregate stats for the capacity-aware header.
                  let units = 0;
                  let ofd = 0;
                  let delay = 0;
                  for (const d of group) {
                    units += unitsFor(d);
                    const s = (d.status || '').toLowerCase();
                    if (['out-for-delivery', 'in-transit', 'in-progress'].includes(s)) ofd++;
                    if (s === 'order-delay' || s === 'order_delay') delay++;
                  }
                  items.push({
                    type: 'header',
                    key: `h-drv-${driverId}`,
                    label: name,
                    color: driverColorFromRoutes.get(driverId),
                    driverId,
                    online,
                    stops: group.length,
                    units,
                    ofd,
                    delay,
                  });
                  group.forEach((d) => items.push({ type: 'card', delivery: d, idx: runningIdx++ }));
                }
                if (unassigned.length > 0) {
                  let units = 0;
                  for (const d of unassigned) units += unitsFor(d);
                  items.push({
                    type: 'header',
                    key: 'h-unassigned',
                    label: 'Unassigned',
                    color: '#9ca3af',
                    isUnassigned: true,
                    stops: unassigned.length,
                    units,
                    ofd: 0,
                    delay: 0,
                  });
                  unassigned.forEach((d) => items.push({ type: 'card', delivery: d, idx: runningIdx++ }));
                }
                return items;
              }
              // status mode
              const byBucket = new Map<LiveMapBucket, typeof trackingDeliveries>();
              for (const d of trackingDeliveries) {
                const dExt = d as unknown as { etaMinutes?: number; confirmedDeliveryDate?: string; goodsMovementDate?: string };
                const bucket = classifyForLiveMap({
                  status: d.status,
                  confirmedDeliveryDate: dExt.confirmedDeliveryDate,
                  goodsMovementDate: dExt.goodsMovementDate,
                  etaMinutes: dExt.etaMinutes,
                });
                if (!byBucket.has(bucket)) byBucket.set(bucket, []);
                byBucket.get(bucket)!.push(d);
              }
              let runningIdx = 0;
              for (const bucket of BUCKET_ORDER) {
                const group = byBucket.get(bucket);
                if (!group || group.length === 0) continue;
                items.push({
                  type: 'header',
                  key: `h-bucket-${bucket}`,
                  label: `${BUCKET_META[bucket].label} · ${group.length}`,
                  color: BUCKET_META[bucket].color,
                });
                group.forEach((d) => items.push({ type: 'card', delivery: d, idx: runningIdx++ }));
              }
              return items;
            })();

            return (
              <div className="flex flex-col gap-3">
                {/* Mobile: stacked rows — map fixed 280px, panel grows to its
                    natural content height and the page scrolls. sm+ (≥640px):
                    50/50 split — map on the left, Drivers & Loads on the right
                    with internal scroll. The right panel folds the old separate
                    Truck Capacity card into per-driver headers. */}
                <div
                  className="grid gap-3 grid-rows-[280px_auto] sm:grid-rows-none sm:grid-cols-2 sm:overflow-hidden sm:h-[max(560px,calc(100dvh-240px))]"
                >
                {/* ── Map panel ── */}
                <div className="flex flex-col min-w-0 min-h-0">
                  <div className="pp-card overflow-hidden flex-1 relative" style={{ minHeight: 0 }}>
                    {routeLoading && (
                      <div className="absolute inset-0 flex items-center justify-center bg-white/60 dark:bg-gray-900/60 z-10">
                        <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                      </div>
                    )}
                    <DeliveryMap
                      deliveries={trackingDeliveries}
                      route={monitoringRoute}
                      highlightedIndex={highlightedIndex === -1 ? null : highlightedIndex}
                      driverLocations={drivers
                        .filter(dr => trackingDriverFilter === 'all' || dr.id === trackingDriverFilter)
                        .filter(dr => dr.tracking?.location && Number.isFinite(dr.tracking.location.lat))
                        .map(dr => ({
                          id: dr.id,
                          name: dr.fullName || dr.username,
                          username: dr.username,
                          status: isContactOnline(dr) ? 'online' : 'offline',
                          lat: dr.tracking!.location!.lat,
                          lng: dr.tracking!.location!.lng,
                          speed: dr.tracking!.location!.speed ?? undefined,
                        }))}
                      driverRoutes={trackingDriverFilter === 'all' ? driverRoutes : driverRoutes.filter(r => r.driverId === trackingDriverFilter)}
                      mapClassName="w-full h-full"
                    />
                  </div>
                </div>

                {/* ── Drivers & Loads panel (full width on mobile, 50% on sm+) ── */}
                <div className="flex flex-col gap-2 min-w-0 min-h-0 w-full">
                  {/* Header + date tabs + search + driver filter + status pills */}
                  <div className="pp-card p-3 flex-shrink-0 space-y-2">
                    {/* Title row */}
                    <div className="flex items-center gap-2">
                      <Truck className="w-4 h-4 text-teal-600 dark:text-teal-400 flex-shrink-0" />
                      <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">Drivers &amp; Loads</h2>
                      <span className="ml-auto text-[10px] font-semibold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 px-1.5 py-0.5 rounded-full flex-shrink-0">
                        {trackingDeliveries.length}
                      </span>
                      <button
                        type="button"
                        onClick={() => void loadData()}
                        className="text-xs text-gray-400 hover:text-blue-600 transition-colors flex-shrink-0"
                        title="Refresh"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {/* Date scope tabs — Today / Tomorrow / All. The selected
                        date drives both the visible cards AND the capacity bar
                        shown in driver headers, so on-screen counts always
                        match what the assignment endpoint will enforce. */}
                    <div className="flex gap-1 rounded-lg bg-gray-100 dark:bg-gray-800 p-0.5">
                      {([
                        { key: 'today', label: 'Today' },
                        { key: 'tomorrow', label: 'Tomorrow' },
                        { key: 'all', label: 'All' },
                      ] as { key: typeof liveMapsDateMode; label: string }[]).map((m) => (
                        <button
                          key={m.key}
                          type="button"
                          onClick={() => { setLiveMapsDateMode(m.key); setReassignMenuFor(null); }}
                          className={`flex-1 px-2 py-1 rounded-md text-[10px] font-semibold transition-colors ${
                            liveMapsDateMode === m.key
                              ? 'bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 shadow-sm'
                              : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                          }`}
                        >
                          {m.label}
                        </button>
                      ))}
                    </div>

                    {/* Search box — matches customer / PO / delivery no / phone /
                        address. Lets the user answer a customer phone-call query
                        ("where's my PO 12345?") in one keystroke instead of
                        scanning dozens of cards. */}
                    <div className="relative">
                      <input
                        type="text"
                        value={trackingSearchQuery}
                        onChange={(e) => setTrackingSearchQuery(e.target.value)}
                        placeholder="Search customer, PO, phone…"
                        className="w-full pl-7 pr-7 py-1.5 text-xs rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
                      {trackingSearchQuery && (
                        <button
                          type="button"
                          onClick={() => setTrackingSearchQuery('')}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs"
                          title="Clear search"
                          aria-label="Clear search"
                        >
                          ✕
                        </button>
                      )}
                    </div>

                    {/* Driver dropdown */}
                    <select
                      value={trackingDriverFilter}
                      onChange={e => { setTrackingDriverFilter(e.target.value); setTrackingSelectedId(null); }}
                      className="w-full px-2 py-1.5 text-xs rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="all">All Drivers</option>
                      {drivers.map(dr => {
                        const driverOrders = deliveries.filter(d => {
                          const ext = d as unknown as { tracking?: { driverId?: string } };
                          return (ext.tracking?.driverId === dr.id || d.assignedDriverId === dr.id)
                            && LIVE_MAP_VISIBLE.has((d.status || '').toLowerCase());
                        });
                        const onRoute = driverOrders.filter(d => (d.status || '').toLowerCase() === 'out-for-delivery').length;
                        return (
                          <option key={dr.id} value={dr.id}>
                            {dr.fullName || dr.username} — {onRoute > 0 ? `${onRoute} on route` : `${driverOrders.length} assigned`}
                          </option>
                        );
                      })}
                    </select>

                    {/* Status quick-filter pills */}
                    <div className="flex flex-wrap gap-1">
                      {(
                        [
                          { key: 'all',              label: 'All' },
                          { key: 'out_for_delivery', label: 'On Route' },
                          { key: 'confirmed',        label: 'Confirmed' },
                          { key: 'priority',         label: 'Priority' },
                          { key: 'delayed',          label: 'Delayed' },
                        ] as { key: typeof liveStatusFilter; label: string }[]
                      ).map(f => (
                        <button
                          key={f.key}
                          type="button"
                          onClick={() => setLiveStatusFilter(f.key)}
                          className={`px-2 py-0.5 rounded-full text-[10px] font-semibold transition-colors ${
                            liveStatusFilter === f.key
                              ? f.key === 'delayed'   ? 'bg-red-600 text-white'
                              : f.key === 'priority'  ? 'bg-orange-500 text-white'
                              : f.key === 'confirmed' ? 'bg-green-600 text-white'
                              : f.key === 'out_for_delivery' ? 'bg-blue-600 text-white'
                              : 'bg-gray-700 text-white dark:bg-gray-200 dark:text-gray-900'
                              : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                          }`}
                        >
                          {f.label}
                        </button>
                      ))}
                    </div>

                    {trackingSelectedId && (
                      <button
                        type="button"
                        onClick={() => setTrackingSelectedId(null)}
                        className="w-full text-[11px] text-blue-600 dark:text-blue-400 hover:underline"
                      >
                        ✕ Clear map selection
                      </button>
                    )}

                    {/* View-mode toggle — Driver / Status / Flat.
                        Groups the list so ops can answer "whose order is
                        this?" and "which are overdue?" at a glance. */}
                    <div className="flex gap-1 rounded-lg bg-gray-100 dark:bg-gray-800 p-0.5">
                      {([
                        { key: 'driver', label: 'By Driver' },
                        { key: 'status', label: 'By Status' },
                        { key: 'flat', label: 'Flat' },
                      ] as { key: typeof liveMapsViewMode; label: string }[]).map((m) => (
                        <button
                          key={m.key}
                          type="button"
                          onClick={() => setLiveMapsViewMode(m.key)}
                          className={`flex-1 px-2 py-1 rounded-md text-[10px] font-semibold transition-colors ${
                            liveMapsViewMode === m.key
                              ? 'bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 shadow-sm'
                              : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                          }`}
                        >
                          {m.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Scrollable order cards */}
                  <div className="flex-1 overflow-y-auto space-y-1.5" style={{ minHeight: 0 }}>
                    {trackingDeliveries.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-12 text-gray-400 dark:text-gray-500 text-sm gap-2">
                        <NavigationIcon className="w-8 h-8 opacity-30" />
                        <p className="font-medium">No active deliveries</p>
                        <p className="text-xs text-center">Orders out for delivery will appear here</p>
                      </div>
                    ) : displayItems.map((item) => {
                      // Branch: a section header row in driver/status modes.
                      if (item.type === 'header') {
                        // Rich driver header: capacity bar + on-route/delayed badges +
                        // pickup label. Only renders when item.driverId is set
                        // (driver-mode groupings); otherwise falls back to the
                        // plain bucket/unassigned label used by 'status' mode.
                        if (item.driverId || item.isUnassigned) {
                          const cap = item.driverId ? (targetCapacityIso ? driverCapacityByDate[targetCapacityIso]?.[item.driverId] : undefined) : undefined;
                          const used = cap?.used ?? item.units ?? 0;
                          const max = cap?.max ?? 20;
                          const pct = Math.max(0, Math.min(100, (used / Math.max(1, max)) * 100));
                          // Bar color: green up to 70%, amber up to 90%, red beyond.
                          const barColor = pct >= 90 ? 'bg-red-500' : pct >= 70 ? 'bg-amber-500' : 'bg-emerald-500';
                          return (
                            <div
                              key={item.key}
                              className="sticky top-0 z-[5] bg-gray-50 dark:bg-gray-900/95 backdrop-blur border border-gray-200 dark:border-gray-700 rounded-md px-2.5 py-2"
                              style={item.color ? { borderLeft: `3px solid ${item.color}` } : undefined}
                            >
                              <div className="flex items-center gap-2">
                                {!item.isUnassigned && (
                                  <span className={`h-2 w-2 shrink-0 rounded-full ${item.online ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'}`} />
                                )}
                                <span className="truncate text-[12px] font-semibold text-gray-900 dark:text-gray-100">
                                  {item.label}
                                </span>
                                <span className="ml-auto text-[10px] font-semibold text-gray-500 dark:text-gray-400 tabular-nums">
                                  {item.stops} stop{item.stops === 1 ? '' : 's'} · {item.units} unit{item.units === 1 ? '' : 's'}
                                </span>
                              </div>
                              {!item.isUnassigned && (
                                <div className="mt-1.5 flex items-center gap-2">
                                  {/* Capacity bar — server is the source of truth; client total
                                      shown only when capacity API hasn't loaded yet. */}
                                  <div className="flex-1 h-1.5 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
                                    <div className={`h-full ${barColor} transition-all`} style={{ width: `${pct}%` }} />
                                  </div>
                                  <span className="text-[10px] font-semibold text-gray-600 dark:text-gray-300 tabular-nums shrink-0">
                                    {used}/{max}
                                  </span>
                                  {cap?.full && (
                                    <span className="text-[9px] font-bold text-red-600 dark:text-red-400 shrink-0">FULL</span>
                                  )}
                                </div>
                              )}
                              <div className="mt-1 flex flex-wrap items-center gap-1">
                                {item.ofd != null && item.ofd > 0 && (
                                  <span className="text-[9px] font-semibold text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/30 px-1.5 py-0.5 rounded-full">
                                    🚛 {item.ofd} on route
                                  </span>
                                )}
                                {item.delay != null && item.delay > 0 && (
                                  <span className="text-[9px] font-semibold text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/30 px-1.5 py-0.5 rounded-full">
                                    ⚠ {item.delay} delayed
                                  </span>
                                )}
                                {!item.isUnassigned && (
                                  <span className="text-[9px] font-medium text-gray-500 dark:text-gray-400">
                                    📍 Pickup: Jebel Ali WH
                                  </span>
                                )}
                              </div>
                            </div>
                          );
                        }
                        return (
                          <div
                            key={item.key}
                            className="sticky top-0 z-[5] flex items-center gap-2 px-2 py-1.5 bg-gray-50 dark:bg-gray-900/90 backdrop-blur border border-gray-200 dark:border-gray-700 rounded-md text-[11px] font-semibold text-gray-700 dark:text-gray-200"
                            style={item.color ? { borderLeft: `3px solid ${item.color}` } : undefined}
                          >
                            <span className="truncate">{item.label}</span>
                          </div>
                        );
                      }
                      const { delivery, idx } = item;
                      const dExt = delivery as unknown as {
                        tracking?: { driverId?: string };
                        goodsMovementDate?: string;
                        confirmedDeliveryDate?: string;
                        deliveryNumber?: string;
                        etaMinutes?: number;
                        metadata?: Record<string, unknown>;
                        _usedDefaultCoords?: boolean;
                      };
                      const meta = dExt.metadata ?? {};
                      const isPriority = meta.isPriority === true;
                      const assignedDriver = drivers.find(dr =>
                        dr.id === dExt.tracking?.driverId || dr.id === delivery.assignedDriverId
                      );
                      const isSelected = delivery.id === trackingSelectedId;
                      // Pre-dispatch rows (confirmed / scheduled-confirmed / rescheduled)
                      // show a pin on the map but the driver hasn't started — the
                      // route polyline intentionally skips them. Surface this so the
                      // user isn't confused why the line seems to jump over the pin.
                      const statusLcForBadge = (delivery.status || '').toLowerCase();
                      const isPreDispatch = ['confirmed', 'scheduled-confirmed', 'rescheduled'].includes(statusLcForBadge);
                      // Missing / fallback coords — pin either doesn't render or sits
                      // on the default Dubai point; route skips these to avoid
                      // corrupting the polyline. Expose it so ops can fix the address.
                      const latNum = Number(delivery.lat);
                      const lngNum = Number(delivery.lng);
                      const hasMissingCoords = !Number.isFinite(latNum) || !Number.isFinite(lngNum) || dExt._usedDefaultCoords === true;

                      // ── ETA: planned delivery date vs live routing ETA ────────
                      const etaMinutes = dExt.etaMinutes ?? null;
                      const now = new Date();

                      // Realtime ETA text (from OSRM routing via driver GPS)
                      const realtimeEtaText = (() => {
                        if (etaMinutes != null && etaMinutes > 0) {
                          return etaMinutes < 60
                            ? `${etaMinutes}m`
                            : `${Math.floor(etaMinutes / 60)}h ${etaMinutes % 60}m`;
                        }
                        return '—';
                      })();

                      // Planned ETA = confirmed delivery date (formatted)
                      const plannedDate = dExt.confirmedDeliveryDate
                        ? new Date(dExt.confirmedDeliveryDate)
                        : null;
                      const plannedEtaText = plannedDate
                        ? plannedDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'Asia/Dubai' })
                        : '—';

                      // On-time / delayed / overdue indicator
                      type LiveStatus = 'on_time' | 'delayed' | 'overdue' | null;
                      const liveStatus: LiveStatus = (() => {
                        if (!plannedDate) return null;
                        const endOfPlannedDay = new Date(plannedDate);
                        endOfPlannedDay.setHours(23, 59, 59, 999);
                        // If planned date already passed with no delivery → overdue
                        if (now > endOfPlannedDay) return 'overdue';
                        // If we have live ETA, compare arrival time to end of planned day
                        if (etaMinutes != null && etaMinutes >= 0) {
                          const eta = new Date(now.getTime() + etaMinutes * 60000);
                          return eta <= endOfPlannedDay ? 'on_time' : 'delayed';
                        }
                        return null;
                      })();

                      const delDateShort = plannedEtaText; // alias for existing references below

                      // Selection highlight takes priority over priority colour so
                      // the blue ring is always visible regardless of order type.
                      const cardBg = isSelected
                        ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-400 dark:border-blue-500'
                        : isPriority
                        ? 'bg-red-50 dark:bg-red-900/20 border-red-300 dark:border-red-700'
                        : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-600';

                      return (
                        <div
                          key={delivery.id}
                          className={`rounded-lg border transition-all overflow-hidden ${cardBg} ${
                            isSelected ? 'ring-2 ring-blue-400 dark:ring-blue-500 shadow-md' : 'hover:shadow-sm'
                          }`}
                        >
                          {/* Click area — selects/deselects on map */}
                          <div
                            role="button"
                            tabIndex={0}
                            onClick={() => setTrackingSelectedId(isSelected ? null : delivery.id)}
                            onKeyDown={e => e.key === 'Enter' && setTrackingSelectedId(isSelected ? null : delivery.id)}
                            className="flex items-start gap-2 p-2.5 cursor-pointer"
                            title={isSelected ? 'Click to deselect' : 'Click to highlight on map'}
                          >
                            {/* Stop number */}
                            <span className="text-sm font-bold text-blue-600 dark:text-blue-400 w-6 flex-shrink-0 leading-5">
                              {idx + 1}.
                            </span>

                            <div className="flex-1 min-w-0 space-y-1">
                              {/* Customer name + badges row */}
                              <div className="flex items-center gap-1 min-w-0">
                                <span className="text-xs font-semibold text-gray-900 dark:text-gray-100 truncate flex-1 min-w-0">
                                  {delivery.customer || 'Unknown Customer'}
                                </span>
                                {isPriority && (
                                  <span className="text-[9px] font-bold uppercase px-1 py-0.5 rounded bg-red-600 text-white flex-shrink-0">
                                    P1
                                  </span>
                                )}
                                {(() => {
                                  // ETD chip — sits next to P1 / On Route per ops request.
                                  const etd = computeETD(delivery);
                                  if (!etd) return null;
                                  return (
                                    <span
                                      className="text-[9px] font-bold uppercase px-1 py-0.5 rounded bg-teal-50 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300 flex-shrink-0 tabular-nums"
                                      title="Departure from warehouse (driver pickup-confirmed)"
                                    >
                                      {formatEtdLabel(etd)}
                                    </span>
                                  );
                                })()}
                                {isSelected && (
                                  <span className="text-[9px] font-semibold px-1 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 flex-shrink-0">
                                    ● map
                                  </span>
                                )}
                              </div>

                              {/* PO number */}
                              {delivery.poNumber && (
                                <p className="text-[10px] text-gray-400 dark:text-gray-500 font-mono">
                                  PO: {delivery.poNumber}
                                </p>
                              )}

                              {/* Address — 1 line truncate */}
                              {delivery.address && (
                                <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate">
                                  📍 {delivery.address}
                                </p>
                              )}

                              {/* Driver row */}
                              {assignedDriver && (
                                <div className="flex items-center gap-1">
                                  <Truck className="w-3 h-3 text-indigo-500 dark:text-indigo-400 flex-shrink-0" />
                                  <span className="text-[11px] font-medium text-indigo-600 dark:text-indigo-400 truncate">
                                    {assignedDriver.fullName || assignedDriver.username}
                                  </span>
                                </div>
                              )}

                              {/* Status + tier pills — workflow status (PGI Done /
                                  Pickup Confirmed / Rescheduled / etc.) plus a
                                  date-tier chip (Next Shipment · 27 Apr /
                                  Future Schedule · 29 Apr / Order Delay · 25 Apr)
                                  so ops immediately see when the order is due. */}
                              {(() => {
                                const b = getDeliveryStatusBadge(delivery);
                                if (!b.label && !b.tierLabel) return null;
                                return (
                                  <div className="flex flex-wrap items-center gap-1">
                                    {b.label && (
                                      <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold ${b.color}`}>
                                        {b.label}
                                      </span>
                                    )}
                                    {b.tierLabel && (
                                      <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold ${b.tierColor}`}>
                                        {b.tierLabel}
                                      </span>
                                    )}
                                  </div>
                                );
                              })()}

                              {/* ── ETA section: Planned + Realtime ── */}
                              <div className="grid grid-cols-2 gap-1 pt-0.5">
                                <div className="flex flex-col">
                                  <span className="text-[9px] text-gray-400 dark:text-gray-500 uppercase tracking-wide leading-none mb-0.5">Planned</span>
                                  <span className="text-[11px] font-semibold text-gray-700 dark:text-gray-200">{delDateShort}</span>
                                </div>
                                <div className="flex flex-col">
                                  <span className="text-[9px] text-gray-400 dark:text-gray-500 uppercase tracking-wide leading-none mb-0.5">Live ETA</span>
                                  <span className={`text-[11px] font-semibold ${realtimeEtaText === '—' ? 'text-gray-400 dark:text-gray-500' : 'text-blue-700 dark:text-blue-300'}`}>
                                    {realtimeEtaText === '—' ? '— no GPS' : realtimeEtaText}
                                  </span>
                                </div>
                              </div>

                              {/* On-time / Delayed / Overdue badge */}
                              {liveStatus && (
                                <div>
                                  <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${
                                    liveStatus === 'on_time'
                                      ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                                      : liveStatus === 'overdue'
                                      ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
                                      : 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'
                                  }`}>
                                    {liveStatus === 'on_time' ? '✓ On Time' : liveStatus === 'overdue' ? '⚠ Overdue' : '⚠ Delayed'}
                                  </span>
                                </div>
                              )}

                              {/* Pre-dispatch explanation — tells the user why the map
                                  pin has no route line connected to it. */}
                              {isPreDispatch && (
                                <div>
                                  <span
                                    className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 dark:bg-slate-800/60 text-slate-600 dark:text-slate-300"
                                    title="Driver hasn't started the route yet — no live polyline connects to this pin"
                                  >
                                    ⏳ Not yet dispatched
                                  </span>
                                </div>
                              )}

                              {/* Coord-missing explanation — pin may be at the Dubai
                                  default fallback and the route intentionally skips
                                  it to keep geometry clean. */}
                              {hasMissingCoords && (
                                <div>
                                  <span
                                    className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400"
                                    title="Coordinates are missing or fell back to a default — the route skips this stop. Fix the address to draw it."
                                  >
                                    📍 Location needs geocoding
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Footer row: units chip · Reassign · POD.
                              Stops the click bubble so the row's map-select
                              behaviour above is preserved. The Reassign menu
                              uses the same PUT endpoint that ManageTab uses,
                              and the server enforces the per-driver day cap. */}
                          <div className="relative border-t border-gray-100 dark:border-gray-700 px-2.5 py-1.5">
                            <div className="flex items-center gap-2">
                              <span
                                className="text-[10px] font-semibold text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded-full tabular-nums"
                                title="Units on this order (server-enforced 20/driver/day cap)"
                              >
                                × {unitsFor(delivery)} unit{unitsFor(delivery) === 1 ? '' : 's'}
                              </span>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setReassignMenuFor(reassignMenuFor === delivery.id ? null : delivery.id);
                                }}
                                className="ml-auto flex items-center gap-1 text-[11px] font-medium text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 transition-colors disabled:opacity-50"
                                disabled={reassignBusyId === delivery.id}
                                title="Move this order to a different driver"
                              >
                                <Truck className="w-3 h-3" />
                                {reassignBusyId === delivery.id ? 'Moving…' : 'Reassign'}
                              </button>
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); setPodModalDelivery(delivery); }}
                                className="flex items-center gap-1 text-[11px] font-medium text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                              >
                                <Camera className="w-3 h-3" />
                                POD
                              </button>
                            </div>

                            {/* Reassign popover — anchored above the footer.
                                Disabled drivers are full for the selected date.
                                Server-side cap is the authority; this is just
                                an optimistic preview. */}
                            {reassignMenuFor === delivery.id && (
                              <div
                                className="absolute right-2 bottom-full mb-1 z-10 w-64 max-h-72 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-xl"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <div className="sticky top-0 px-2.5 py-1.5 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 flex items-center justify-between">
                                  <span>Move to driver</span>
                                  <button
                                    type="button"
                                    onClick={() => setReassignMenuFor(null)}
                                    className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                                    aria-label="Close"
                                  >
                                    ✕
                                  </button>
                                </div>
                                {(() => {
                                  const orderUnits = unitsFor(delivery);
                                  const targetIso = getCapacityDateIso(delivery);
                                  const currentDriverId = (delivery as unknown as { tracking?: { driverId?: string } }).tracking?.driverId
                                    || delivery.assignedDriverId
                                    || null;
                                  return drivers.map((dr) => {
                                    const isCurrent = dr.id === currentDriverId;
                                    const cap = driverCapacityByDate[targetIso]?.[dr.id];
                                    const used = cap?.used ?? 0;
                                    const max = cap?.max ?? 20;
                                    const remaining = Math.max(0, max - used);
                                    // Exclude current delivery's units when checking
                                    // overflow against current driver — re-assigning to
                                    // self is meaningless but should not appear "full".
                                    const wouldOverflow = isCurrent
                                      ? false
                                      : (used + orderUnits > max);
                                    const online = isContactOnline(dr);
                                    return (
                                      <button
                                        key={dr.id}
                                        type="button"
                                        disabled={isCurrent || wouldOverflow || reassignBusyId === delivery.id}
                                        onClick={() => { void reassignDelivery(delivery.id, dr.id); }}
                                        className={`w-full flex items-center gap-2 px-2.5 py-1.5 text-left text-[11px] border-b border-gray-100 dark:border-gray-800 last:border-0 transition-colors ${
                                          isCurrent
                                            ? 'bg-gray-50 dark:bg-gray-800/60 text-gray-400 dark:text-gray-500 cursor-default'
                                            : wouldOverflow
                                              ? 'bg-red-50 dark:bg-red-900/10 text-red-700 dark:text-red-400 cursor-not-allowed'
                                              : 'hover:bg-blue-50 dark:hover:bg-blue-900/20 text-gray-700 dark:text-gray-200'
                                        }`}
                                        title={
                                          isCurrent ? 'Currently assigned'
                                          : wouldOverflow ? `Would overflow truck (${used}+${orderUnits} > ${max})`
                                          : `${remaining} unit${remaining === 1 ? '' : 's'} free of ${max}`
                                        }
                                      >
                                        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${online ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'}`} />
                                        <span className="flex-1 min-w-0 truncate font-medium">
                                          {dr.fullName || dr.username}
                                          {isCurrent && <span className="ml-1 text-[9px] uppercase text-gray-400">current</span>}
                                        </span>
                                        <span className="text-[10px] tabular-nums shrink-0">
                                          {used}/{max}
                                        </span>
                                      </button>
                                    );
                                  });
                                })()}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
                </div>
              </div>
            );
          })(),
            },
          ]}
        />
      )}

      {/* Communication Tab — two-column chat layout */}
      {activeTab === 'communication' && (
        <div className="flex md:flex-row rounded-xl overflow-hidden border border-gray-200 dark:border-gray-700 shadow-sm bg-white dark:bg-gray-800" style={{ height: 'max(520px, calc(100dvh - 220px))' }}>
          {/* ── LEFT COLUMN: Contacts Panel ── */}
          <div className={`${selectedContact ? 'hidden md:flex' : 'flex'} w-full md:w-72 md:flex-shrink-0 flex-col bg-white dark:bg-gray-800 md:border-r border-gray-200 dark:border-gray-700`}>
            {/* Panel header with search */}
            <div className="px-4 pt-4 pb-3 border-b border-gray-200 dark:border-gray-700">
              <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-3">Messages</h3>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                <input
                  type="text"
                  placeholder="Search contacts…"
                  value={contactSearch}
                  onChange={(e) => setContactSearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-sm rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 border-0 focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
            </div>

            {/* Contact list */}
            <div className="flex-1 overflow-y-auto">
              {/* Team Members Section */}
              {teamMembers.filter(m => !contactSearch || (m.fullName || m.username || '').toLowerCase().includes(contactSearch.toLowerCase())).length > 0 && (
                <>
                  <div className="px-4 pt-3 pb-1">
                    <span className="text-[10px] font-bold tracking-widest text-gray-400 dark:text-gray-500 uppercase">Team</span>
                  </div>
                  {teamMembers.filter(m => !contactSearch || (m.fullName || m.username || '').toLowerCase().includes(contactSearch.toLowerCase())).map(member => {
                    const isOnline = isContactOnline(member);
                    const isSelected = selectedContact?.id === member.id;
                    const unreadCount = unreadByDriverId[member.id] || 0;
                    const initials = (member.fullName || member.username || '?')[0].toUpperCase();
                    const roleLabel = (member.account?.role || member.role) === 'admin' ? 'Admin'
                      : (member.account?.role || member.role) === 'delivery_team' ? 'Delivery'
                      : member.account?.role || member.role || '';
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
                          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center text-white font-semibold text-sm shadow-sm">
                            {initials}
                          </div>
                          <div className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-white dark:border-gray-800 ${isOnline ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'}`} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-1">
                            <span className="font-medium text-sm text-gray-900 dark:text-gray-100 truncate">
                              {member.fullName || member.username}
                            </span>
                            <div className="flex items-center gap-1 flex-shrink-0">
                              {roleLabel && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 font-medium">
                                  {roleLabel}
                                </span>
                              )}
                              {unreadCount > 0 && (
                                <span className="w-5 h-5 bg-blue-600 text-white text-[10px] rounded-full flex items-center justify-center font-bold">
                                  {unreadCount}
                                </span>
                              )}
                            </div>
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

              {/* Drivers Section */}
              {drivers.filter(d => !contactSearch || (d.fullName || d.username || '').toLowerCase().includes(contactSearch.toLowerCase())).length > 0 && (
                <>
                  <div className="px-4 pt-3 pb-1">
                    <span className="text-[10px] font-bold tracking-widest text-gray-400 dark:text-gray-500 uppercase">Drivers</span>
                  </div>
                  {drivers.filter(d => !contactSearch || (d.fullName || d.username || '').toLowerCase().includes(contactSearch.toLowerCase())).map(driver => {
                    const isOnline = isContactOnline(driver);
                    const isSelected = selectedContact?.id === driver.id;
                    const unreadCount = unreadByDriverId[driver.id] || 0;
                    const initials = (driver.fullName || driver.username || '?')[0].toUpperCase();
                    return (
                      <button
                        key={driver.id}
                        onClick={() => { setSelectedContact(driver); void loadMessages(driver.id); }}
                        className={`w-full flex items-center gap-3 px-3 py-3 text-left transition-all border-l-4 ${
                          isSelected
                            ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-600 dark:border-blue-400'
                            : 'border-transparent hover:bg-gray-50 dark:hover:bg-gray-700/50'
                        }`}
                      >
                        <div className="relative flex-shrink-0">
                          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-cyan-600 flex items-center justify-center text-white font-semibold text-sm shadow-sm">
                            {initials}
                          </div>
                          <div className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-white dark:border-gray-800 ${isOnline ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'}`} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-1">
                            <span className="font-medium text-sm text-gray-900 dark:text-gray-100 truncate">
                              {driver.fullName || driver.username}
                            </span>
                            {unreadCount > 0 && (
                              <span className="w-5 h-5 bg-blue-600 text-white text-[10px] rounded-full flex items-center justify-center font-bold flex-shrink-0">
                                {unreadCount}
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

              {drivers.length === 0 && teamMembers.length === 0 && (
                <div className="flex flex-col items-center justify-center h-40 text-gray-400 dark:text-gray-500 text-sm gap-2 px-4 text-center">
                  <MessageSquare className="w-8 h-8 opacity-40" />
                  No contacts available
                </div>
              )}
              {(drivers.length > 0 || teamMembers.length > 0) && contactSearch && drivers.filter(d => (d.fullName || d.username || '').toLowerCase().includes(contactSearch.toLowerCase())).length === 0 && teamMembers.filter(m => (m.fullName || m.username || '').toLowerCase().includes(contactSearch.toLowerCase())).length === 0 && (
                <div className="flex flex-col items-center justify-center h-40 text-gray-400 dark:text-gray-500 text-sm gap-2 px-4 text-center">
                  <Search className="w-8 h-8 opacity-40" />
                  No contacts match "{contactSearch}"
                </div>
              )}
            </div>
          </div>

          {/* ── RIGHT COLUMN: Chat Panel ── */}
          <div className={`${selectedContact ? 'flex' : 'hidden md:flex'} flex-1 flex-col bg-gray-50 dark:bg-gray-900 min-w-0`}>
            {selectedContact ? (
              <>
                {/* Chat header */}
                <div className="flex items-center justify-between px-5 py-3 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 shadow-sm flex-shrink-0">
                  <div className="flex items-center gap-3 min-w-0">
                    <button
                      onClick={() => setSelectedContact(null)}
                      className="md:hidden w-9 h-9 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center justify-center text-gray-500 dark:text-gray-300"
                      title="Back to messages"
                    >
                      <ChevronLeft className="w-5 h-5" />
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
                              : selectedContact.account.role === 'logistics_team' ? 'Logistics Team'
                              : 'Driver'}
                          </span>
                        )}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {selectedContact.phone && (
                      <a
                        href={`tel:${selectedContact.phone}`}
                        className="p-2 text-gray-400 hover:text-green-600 dark:hover:text-green-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                        title="Call"
                      >
                        <Phone className="w-4 h-4" />
                      </a>
                    )}
                    <button
                      onClick={() => void loadMessages(selectedContact.id)}
                      title="Refresh"
                      className="p-2 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                    >
                      <RefreshCw className="w-4 h-4" />
                    </button>
                  </div>
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
                        <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">
                          Start a conversation with {selectedContact.fullName || selectedContact.username}
                        </p>
                      </div>
                    </div>
                  ) : (() => {
                    // Resolve current user identity once for all messages
                    const currentUser = getCurrentUser() as (AuthUser & { account?: { role?: string }; role?: string }) | null;
                    // client_user stores 'id', not 'sub' — sub is only in the JWT payload
                    const currentUserId = String(currentUser?.id || currentUser?.sub || '');
                    // My role (e.g. 'logistics_team') vs the contact's role (e.g. 'delivery_team' or 'driver')
                    const myRole = String(currentUser?.role || currentUser?.account?.role || '');
                    const contactRole = String(selectedContact.account?.role || selectedContact.role || '');
                    const contactId = String(selectedContact.id || '');

                    // KEY FACTS about the data model:
                    // • adminId = the SENDER's ID — set server-side by the auth token (reliable)
                    // • driverId = the RECIPIENT's ID — always = selectedContact.id in the send payload
                    //             → do NOT use driverId to detect the sender
                    // • senderRole = the SENDER's role → most reliable when roles differ
                    //
                    // Priority:
                    // 1. senderRole comparison — unambiguous when my role ≠ contact's role
                    // 2. adminId comparison  — reliable fallback (same-role conversations)
                    const getIsSent = (msg: TeamMessage): boolean => {
                      // 1. Role comparison (unambiguous when roles differ, e.g. logistics_team vs driver)
                      if (msg.senderRole && myRole && contactRole && myRole !== contactRole) {
                        if (msg.senderRole === myRole) return true;
                        if (msg.senderRole === contactRole) return false;
                      }
                      // 2. adminId is the sender's ID (set by server, NOT the payload driverId)
                      if (currentUserId && String(msg.adminId || '') === currentUserId) return true;
                      if (contactId && String(msg.adminId || '') === contactId) return false;
                      return false; // default: received
                    };

                    const contactName = selectedContact.fullName || selectedContact.username || 'Contact';
                    const contactInitial = contactName[0].toUpperCase();
                    let lastDateLabel = '';

                    return messages.map((msg, idx) => {
                      const isSent = getIsSent(msg);

                      // Date separator
                      const msgDate = msg.createdAt ? new Date(msg.createdAt) : null;
                      const dateLabel = msgDate
                        ? msgDate.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
                        : '';
                      const showDateSep = dateLabel && dateLabel !== lastDateLabel;
                      if (showDateSep) lastDateLabel = dateLabel;

                      // Show sender name/avatar only on first msg in a group
                      const prevMsg = idx > 0 ? messages[idx - 1] : null;
                      const prevIsSent = prevMsg ? getIsSent(prevMsg) : true;
                      const isFirstInGroup = !prevMsg || prevIsSent !== isSent;

                      return (
                        <React.Fragment key={msg.id}>
                          {/* Date separator */}
                          {showDateSep && (
                            <div className="flex items-center gap-3 my-2">
                              <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
                              <span className="text-[10px] font-medium text-gray-400 dark:text-gray-500 whitespace-nowrap px-2">{dateLabel}</span>
                              <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
                            </div>
                          )}

                          <div className={`chat-message-enter flex items-end gap-2 ${isSent ? 'justify-end' : 'justify-start'}`}>
                            {/* Contact avatar — left side, only on first in group */}
                            {!isSent ? (
                              isFirstInGroup ? (
                                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-gray-500 to-slate-700 flex-shrink-0 flex items-center justify-center text-white text-xs font-bold shadow-sm self-end">
                                  {contactInitial}
                                </div>
                              ) : <div className="w-8 flex-shrink-0" />
                            ) : null}

                            <div className={`max-w-[80%] sm:max-w-[70%] flex flex-col ${isSent ? 'items-end' : 'items-start'}`}>
                              {/* Sender label on first msg in group */}
                              {isFirstInGroup && (
                                <span className={`text-[10px] font-semibold mb-1 px-1 ${
                                  isSent ? 'text-blue-500 dark:text-blue-400 self-end' : 'text-gray-500 dark:text-gray-400'
                                }`}>
                                  {isSent ? 'You' : contactName}
                                </span>
                              )}

                              <div className={`px-4 py-2.5 shadow-sm ${
                                isSent
                                  ? 'bg-blue-600 dark:bg-blue-500 text-white rounded-2xl rounded-tr-sm'
                                  : 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 border border-gray-200 dark:border-gray-600 rounded-2xl rounded-tl-sm'
                              }`}>
                                {/* Attachment rendering */}
                                {msg.attachmentUrl && msg.attachmentType?.startsWith('image/') && (
                                  <a href={msg.attachmentUrl} target="_blank" rel="noopener noreferrer" className="block mb-2">
                                    <img src={msg.attachmentUrl} alt={msg.attachmentName || 'attachment'}
                                      className="max-w-full rounded-lg max-h-48 object-cover cursor-pointer hover:opacity-90 transition-opacity" />
                                  </a>
                                )}
                                {msg.attachmentUrl && !msg.attachmentType?.startsWith('image/') && (
                                  <a href={msg.attachmentUrl} download={msg.attachmentName || 'file'}
                                    className={`flex items-center gap-2 mb-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                                      isSent ? 'bg-blue-500 text-white hover:bg-blue-400' : 'bg-gray-100 dark:bg-gray-600 text-blue-600 dark:text-blue-300 hover:bg-gray-200'
                                    }`}>
                                    <Paperclip className="w-4 h-4 flex-shrink-0" />
                                    <span className="truncate">{msg.attachmentName || 'Download file'}</span>
                                  </a>
                                )}
                                {msg.content && <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">{msg.content}</p>}
                              </div>
                              <p className={`text-[10px] mt-1 px-1 text-gray-400 dark:text-gray-500 ${isSent ? 'text-right' : 'text-left'}`}>
                                {formatMessageTimestamp(msg.createdAt)}
                              </p>
                            </div>

                            {/* "You" avatar — right side, only on first in group */}
                            {isSent ? (
                              isFirstInGroup ? (
                                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex-shrink-0 flex items-center justify-center text-white text-xs font-bold shadow-sm self-end">
                                  {(currentUser?.username || 'Y')[0].toUpperCase()}
                                </div>
                              ) : <div className="w-8 flex-shrink-0" />
                            ) : null}
                          </div>
                        </React.Fragment>
                      );
                    });
                  })()}
                  <div ref={messagesEndRef} />
                </div>

                {/* Quick-reply templates */}
                <div className="flex-shrink-0 px-4 py-2 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700">
                  <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
                    {messageTemplates.map((template, index) => (
                      <button
                        key={index}
                        onClick={() => setNewMessage(template)}
                        className="px-3 py-1.5 text-xs bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-full hover:bg-blue-100 dark:hover:bg-blue-900/30 hover:text-blue-700 dark:hover:text-blue-300 whitespace-nowrap transition-colors flex-shrink-0"
                      >
                        {template}
                      </button>
                    ))}
                  </div>
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
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            void handleSendMessage();
                          }
                        }}
                        placeholder="Type a message…"
                        className="flex-1 bg-transparent text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 outline-none disabled:opacity-50"
                        disabled={sendingMessage}
                      />
                    </div>
                    <button
                      onClick={() => void handleSendMessage()}
                      disabled={sendingMessage || (!newMessage.trim() && !attachmentPreview)}
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
                  <p className="font-medium text-gray-600 dark:text-gray-400 text-lg">Team Messages</p>
                  <p className="text-sm mt-1">Select a contact to start a conversation</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      </div>{/* end tab-enter wrapper */}

      {/* ── POD upload / view modal (opened from Live Maps order cards) ── */}
      {podModalDelivery && (
        <DeliveryDetailModal
          delivery={podModalDelivery as unknown as import('../types').Delivery & Record<string, unknown>}
          isOpen={true}
          onClose={() => setPodModalDelivery(null)}
          onStatusUpdate={(deliveryId, newStatus) => {
            window.dispatchEvent(new CustomEvent('deliveryStatusUpdated', {
              detail: { deliveryId, status: newStatus, updatedAt: new Date() },
            }));
            void loadData();
          }}
        />
      )}
    </div>
  );
}
