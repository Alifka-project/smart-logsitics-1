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
} from 'lucide-react';
import DeliveryMap from '../components/MapView/DeliveryMap';
import DeliveryManagementPage from './DeliveryManagementPage';
import PaginationBar from '../components/common/PaginationBar';
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { calculateRoute, generateFallbackRoute, computePerDriverRoutes } from '../services/advancedRoutingService';
import type { DriverRoute } from '../services/advancedRoutingService';
import useDeliveryStore from '../store/useDeliveryStore';
import { deliveryToManageOrder, classifyConfirmedDate } from '../utils/deliveryWorkflowMap';
import { excludeTeamPortalGarbageDeliveries } from '../utils/deliveryListFilter';
import { isDubaiPublicHoliday } from '../utils/dubaiHolidays';
import { getTodayIsoDubai, addCalendarDaysDubai, formatInstantToDubaiIsoDate } from '../utils/dubaiCalendarIso';
import {
  displayCityForOps,
  displayCustomerName,
  displayDeliveryNumber,
  displayDescriptionForOps,
  displayMaterialForOps,
  displayModelForOps,
  displayPhone,
  displayPoNumber,
  getOrderType,
} from '../utils/deliveryDisplayFields';
import type { Delivery, AuthUser } from '../types';
// WhatsAppSendModal is mounted globally in App.tsx — no local import needed

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

interface AssignmentMessage {
  type: 'success' | 'error';
  text: string;
}

export default function LogisticsTeamPortal() {
  const [activeTab, setActiveTab] = useState<string>('dashboard');
  // L6: Default directly to the unified dispatch table (was 'manage-orders')
  const [deliveriesSubTab, setDeliveriesSubTab] = useState<string>('manage-dispatch');
  const [trackingDriverFilter, setTrackingDriverFilter] = useState<string>('all');
  const [trackingSelectedId, setTrackingSelectedId] = useState<string | null>(null);
  const [drivers, setDrivers] = useState<ContactUser[]>([]);
  const [contacts, setContacts] = useState<ContactUser[]>([]); // All contacts (drivers + team members)
  const [teamMembers, setTeamMembers] = useState<ContactUser[]>([]); // Admin + delivery_team
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
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

  const capacityDatesSorted = useMemo(
    () => [...Object.keys(driverCapacityByDate)].sort(),
    [driverCapacityByDate],
  );

  // Control tab state
  const [assigningDelivery, setAssigningDelivery] = useState<string | null>(null);
  const [assignmentMessage, setAssignmentMessage] = useState<AssignmentMessage | null>(null);
  const [markingOFD, setMarkingOFD] = useState<string | null>(null);
  const [markingDelay, setMarkingDelay] = useState<string | null>(null);
  const [dispatchFilter, setDispatchFilter] = useState<'all' | 'overdue' | 'unassigned' | 'awaiting' | 'delay'>('all');
  const [sendingSms, setSendingSms] = useState<string | null>(null);
  const [statusUpdating, setStatusUpdating] = useState<string | null>(null);
  const [opsSearch, setOpsSearch] = useState<string>('');
  const [opsStatusFilter, setOpsStatusFilter] = useState<string>('all');
  const [opsSortCol, setOpsSortCol] = useState<'date' | 'gmd' | 'deldate' | 'customer' | 'status' | null>(null);
  const [opsSortDir, setOpsSortDir] = useState<'asc' | 'desc'>('asc');
  const [opsTodayOnly, setOpsTodayOnly] = useState(false);
  const [opsDateFrom, setOpsDateFrom] = useState('');
  const [opsDateTo, setOpsDateTo] = useState('');
  const [opsPage, setOpsPage] = useState(1);
  const OPS_PAGE_SIZE = 20;
  const dispatchTableRef = useRef<HTMLDivElement | null>(null);
  
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
  const [togglingPriority, setTogglingPriority] = useState<string | null>(null);

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
      console.error('[DeliveryTeamPortal] No user found');
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

    // Sub-tabs inside Deliveries: manage-dispatch (unified), live-tracking
    // L6: manage-orders is merged into manage-dispatch; 'deliveries' and 'manage-orders' both go to dispatch
    const deliveriesSubTabs = ['manage-orders', 'manage-dispatch', 'live-tracking', 'deliveries'];
    if (tabParam && deliveriesSubTabs.includes(tabParam)) {
      setActiveTab('deliveries');
      // L6: both 'deliveries' and 'manage-orders' route to the unified dispatch table
      const subTab = (tabParam === 'deliveries' || tabParam === 'manage-orders') ? 'manage-dispatch' : tabParam;
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

    // Pending Orders: everything not yet delivered, cancelled, or failed/returned
    const TERMINAL = new Set(['delivered', 'cancelled', 'failed']);
    const pendingOrders = orders.filter(({ order }) => !TERMINAL.has(order.status)).map(({ raw }) => raw);

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

  // Badge derived from the same workflow status as ManageTab — single source of truth
  const getDeliveryStatusBadge = (delivery: Delivery): { label: string; color: string; tierLabel?: string; tierColor?: string } => {
    const order = deliveryToManageOrder(delivery);
    const shortDate = order.confirmedDeliveryDate
      ? order.confirmedDeliveryDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Asia/Dubai' })
      : null;
    switch (order.status) {
      case 'order_delay':       return { label: 'Order Delay',                                                              color: 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300' };
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

  // Active = non-terminal deliveries that have a driver assigned.
  const activeDeliveries = deliveries.filter(d => {
    const dWithTracking = d as unknown as { tracking?: { driverId?: string } };
    return !TERMINAL_STATUSES.has((d.status || '').toLowerCase()) &&
           (dWithTracking.tracking?.driverId || d.assignedDriverId);
  });

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
    <div className="space-y-2 md:space-y-4 w-full min-w-0">
      {/* WhatsApp modal is handled globally in App.tsx */}
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
      <div className="pp-sticky-tab-rail pp-card mt-0 mb-2 overflow-x-auto px-2 py-2 md:mb-3">
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

          {/* ── KPI Stats Row ── */}
          {(() => {
            const todayIso = getTodayIsoDubai();
            const todayMs = new Date(todayIso).getTime();
            const tomorrowMs = todayMs + 86400000;

            // Pending GMD: active orders without a goods movement date
            const pendingGMD = deliveries.filter(d => {
              const ext = d as unknown as { goodsMovementDate?: string };
              return !ext.goodsMovementDate && !TERMINAL_STATUSES.has((d.status || '').toLowerCase());
            }).length;

            // Today processed: deliveries created today (new POs uploaded today)
            const todayProcessed = deliveries.filter(d => {
              const ext = d as unknown as { createdAt?: string };
              if (!ext.createdAt) return false;
              const t = new Date(ext.createdAt).getTime();
              return t >= todayMs && t < tomorrowMs;
            }).length;

            // Delivered: terminal-status deliveries
            const deliveredCount = deliveries.filter(d =>
              TERMINAL_STATUSES.has((d.status || '').toLowerCase())
            ).length;

            // Pending POD: delivered but no proof of delivery attached
            const pendingPOD = deliveries.filter(d => {
              const s = (d.status || '').toLowerCase();
              const ext = d as unknown as { podCompletedAt?: string; photos?: unknown[]; driverSignature?: string };
              const isDelivered = ['delivered', 'pod-completed', 'delivered-with-installation', 'delivered-without-installation'].includes(s);
              return isDelivered && !ext.podCompletedAt && !ext.driverSignature && (!ext.photos || (ext.photos as unknown[]).length === 0);
            }).length;

            // KPI: % of deliveries completed within 1 hour (customerConfirmedAt → deliveredAt)
            const timed = deliveries.filter(d => {
              const ext = d as unknown as { customerConfirmedAt?: string; deliveredAt?: string; podCompletedAt?: string };
              return !!ext.customerConfirmedAt && !!(ext.deliveredAt || ext.podCompletedAt);
            });
            const durations = timed.map(d => {
              const ext = d as unknown as { customerConfirmedAt?: string; deliveredAt?: string; podCompletedAt?: string };
              return new Date((ext.deliveredAt || ext.podCompletedAt)!).getTime() - new Date(ext.customerConfirmedAt!).getTime();
            });
            const kpiMet = durations.filter(ms => ms >= 0 && ms <= 3600000).length;
            const kpiPct = durations.length > 0 ? Math.round((kpiMet / durations.length) * 100) : null;
            const avgMin = durations.length > 0 ? Math.round(durations.filter(ms => ms >= 0).reduce((a, b) => a + b, 0) / durations.length / 60000) : null;

            return (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                <div
                  onClick={() => { setActiveTab('deliveries'); setDeliveriesSubTab('manage'); }}
                  className="pp-card p-4 text-center cursor-pointer hover:ring-2 hover:ring-amber-400 transition-all"
                  title="Click to view Manage Delivery Orders"
                >
                  <div className="text-[11px] font-medium text-gray-500 dark:text-gray-400 mb-1">Pending GMD</div>
                  <div className="text-3xl font-bold text-amber-600 dark:text-amber-400">{pendingGMD}</div>
                  <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-1">no movement date</div>
                </div>
                <div className="pp-card p-4 text-center">
                  <div className="text-[11px] font-medium text-gray-500 dark:text-gray-400 mb-1">Today Processed</div>
                  <div className="text-3xl font-bold text-blue-600 dark:text-blue-400">{todayProcessed}</div>
                  <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-1">new POs today</div>
                </div>
                <div className="pp-card p-4 text-center">
                  <div className="text-[11px] font-medium text-gray-500 dark:text-gray-400 mb-1">Delivered</div>
                  <div className="text-3xl font-bold text-green-600 dark:text-green-400">{deliveredCount}</div>
                  <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-1">completed</div>
                </div>
                <div
                  onClick={() => { setActiveTab('deliveries'); setDeliveriesSubTab('manage'); }}
                  className="pp-card p-4 text-center cursor-pointer hover:ring-2 hover:ring-red-400 transition-all"
                  title="Click to view Manage Delivery Orders"
                >
                  <div className="text-[11px] font-medium text-gray-500 dark:text-gray-400 mb-1">Pending POD</div>
                  <div className={`text-3xl font-bold ${pendingPOD > 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-400 dark:text-gray-500'}`}>{pendingPOD}</div>
                  <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-1">no proof attached</div>
                </div>
                <div className="pp-card p-4 text-center">
                  <div className="text-[11px] font-medium text-gray-500 dark:text-gray-400 mb-1">Delivery KPI</div>
                  {kpiPct !== null ? (
                    <>
                      <div className={`text-3xl font-bold ${kpiPct >= 80 ? 'text-green-600 dark:text-green-400' : kpiPct >= 60 ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400'}`}>{kpiPct}%</div>
                      <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-1">≤1h target · avg {avgMin}m</div>
                    </>
                  ) : (
                    <>
                      <div className="text-3xl font-bold text-gray-300 dark:text-gray-600">—</div>
                      <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-1">target ≤1h/delivery</div>
                    </>
                  )}
                </div>
              </div>
            );
          })()}

          {/* ── Needs Attention · Awaiting Customer · Truck capacity (equal thirds on large screens) ── */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:items-stretch">
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
                  { tableTab: 'pending',           count: actionItems.unassigned.length,           label: 'Unassigned',        sublabel: 'Needs driver',      bg: 'bg-orange-50 dark:bg-orange-900/20',border: 'border-orange-100 dark:border-orange-800/30',  hover: 'hover:bg-orange-100 dark:hover:bg-orange-900/30', countColor: 'text-orange-600 dark:text-orange-400', labelColor: 'text-orange-700 dark:text-orange-400' },
                  { tableTab: 'awaiting_customer', count: actionItems.awaitingConfirmation.length, label: 'Awaiting Customer',  sublabel: 'No confirmation',  bg: 'bg-purple-50 dark:bg-purple-900/20',border: 'border-purple-100 dark:border-purple-800/30',  hover: 'hover:bg-purple-100 dark:hover:bg-purple-900/30', countColor: 'text-purple-600 dark:text-purple-400', labelColor: 'text-purple-700 dark:text-purple-400' },
                  { tableTab: 'order_delay',       count: actionItems.orderDelay.length,           label: 'Order Delays',      sublabel: 'Needs resolution',  bg: 'bg-red-50 dark:bg-red-900/20',     border: 'border-red-100 dark:border-red-800/30',        hover: 'hover:bg-red-100 dark:hover:bg-red-900/30',       countColor: 'text-red-600 dark:text-red-400',       labelColor: 'text-red-700 dark:text-red-400'       },
                ] as const).map(({ tableTab: targetTab, count, label, sublabel, bg, border, hover, countColor, labelColor }) => (
                  <div
                    key={label}
                    onClick={() => {
                      useDeliveryStore.getState().setManageTabFilter(targetTab);
                      setActiveTab('deliveries');
                      // L6: all order views now go to the unified Dispatch table
                      setDeliveriesSubTab('manage-dispatch');
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

            <div className="pp-card flex min-h-0 flex-col p-4 sm:p-5 lg:h-[340px]">
              <div className="mb-2 flex flex-shrink-0 items-center gap-2">
                <Truck className="h-5 w-5 flex-shrink-0 text-teal-600 dark:text-teal-400" />
                <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Truck capacity</h2>
              </div>
              <p className="mb-2 flex-shrink-0 text-[10px] leading-snug text-gray-400 dark:text-gray-500">
                By delivery date (Dubai). Dispatched / on-route orders count toward <span className="font-semibold text-gray-500 dark:text-gray-400">today</span>.
              </p>
              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-0.5">
                {drivers.length === 0 ? (
                  <div className="py-6 text-center text-sm text-gray-400 dark:text-gray-500">No drivers</div>
                ) : capacityDatesSorted.length === 0 ? (
                  <div className="py-4 text-center text-xs text-gray-400 dark:text-gray-500">Loading capacity…</div>
                ) : (
                  capacityDatesSorted.map((iso) => {
                    const dayLabel = new Date(`${iso}T00:00:00+04:00`).toLocaleDateString('en-AE', {
                      timeZone: 'Asia/Dubai', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric'
                    });
                    return (
                      <div key={iso} className="rounded-lg border border-gray-100 dark:border-gray-700 bg-white/40 dark:bg-gray-800/40 p-2">
                        <p className="mb-1.5 px-0.5 text-[10px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                          {dayLabel} <span className="font-mono font-normal normal-case text-gray-400">({iso})</span>
                        </p>
                        <div className="space-y-1.5">
                          {[...drivers]
                            .sort((a, b) => String(a.fullName || a.username || '').localeCompare(String(b.fullName || b.username || '')))
                            .map((driver) => {
                              const cap = driverCapacityByDate[iso]?.[driver.id];
                              const online = isContactOnline(driver);
                              return (
                                <div
                                  key={`${iso}-${driver.id}`}
                                  className="flex items-start gap-2 rounded-md border border-gray-100 bg-gray-50 px-2 py-1.5 dark:border-gray-700 dark:bg-gray-800/60"
                                >
                                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${online ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'}`} />
                                  <div className="min-w-0 flex-1">
                                    <p className="truncate text-[11px] font-semibold text-gray-900 dark:text-gray-100">
                                      {driver.fullName || driver.username}
                                    </p>
                                    {cap ? (
                                      <p className="mt-0.5 text-[10px] text-gray-600 dark:text-gray-300">
                                        <span className="font-mono font-semibold text-teal-700 dark:text-teal-300">{cap.remaining}</span> left
                                        <span className="text-gray-400 dark:text-gray-500"> · </span>
                                        {cap.used}/{cap.max} used
                                      </p>
                                    ) : (
                                      <p className="mt-0.5 text-[10px] text-gray-400 dark:text-gray-500">—</p>
                                    )}
                                  </div>
                                  {cap?.full && (
                                    <span className="shrink-0 text-[9px] font-bold text-red-600 dark:text-red-400">FULL</span>
                                  )}
                                </div>
                              );
                            })}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>

          {/* ── Driver Status + 2 Charts (3-column, same height as Needs Attention) ── */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:items-stretch">

            {/* Driver Status — compact, same style as Needs Attention */}
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

            {/* Chart 1 — Delivery Status Breakdown (donut) */}
            {(() => {
              const statusGroups = [
                { name: 'Delivered',  value: deliveries.filter(d => TERMINAL_STATUSES.has((d.status||'').toLowerCase())).length,                                                            color: '#22c55e' },
                { name: 'On Route',   value: deliveries.filter(d => (d.status||'').toLowerCase() === 'out-for-delivery').length,                                                            color: '#3b82f6' },
                { name: 'Awaiting',   value: deliveries.filter(d => ['sms_sent','sms-sent','unconfirmed','awaiting_customer'].includes((d.status||'').toLowerCase())).length,               color: '#a855f7' },
                { name: 'Pending',    value: deliveries.filter(d => ['pending','uploaded','scheduled','confirmed','scheduled-confirmed'].includes((d.status||'').toLowerCase())).length,    color: '#f59e0b' },
                { name: 'Delayed',    value: deliveries.filter(d => ['order-delay','order_delay'].includes((d.status||'').toLowerCase())).length,                                           color: '#ef4444' },
              ].filter(g => g.value > 0);
              const total = statusGroups.reduce((s, g) => s + g.value, 0);
              return (
                <div className="pp-card flex min-h-0 flex-col p-4 sm:p-5 lg:h-[340px]">
                  <div className="mb-2 flex flex-shrink-0 items-center gap-2">
                    <Activity className="h-5 w-5 flex-shrink-0 text-blue-500" />
                    <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Status Breakdown</h2>
                    <span className="ml-auto text-[10px] text-gray-400 dark:text-gray-500">{total} total</span>
                  </div>
                  {total === 0 ? (
                    <div className="flex-1 flex items-center justify-center text-sm text-gray-400 dark:text-gray-500">No data</div>
                  ) : (
                    <div className="flex-1 flex flex-col items-center justify-center min-h-0">
                      <ResponsiveContainer width="100%" height={180}>
                        <PieChart>
                          <Pie data={statusGroups} cx="50%" cy="50%" innerRadius={52} outerRadius={78} paddingAngle={2} dataKey="value">
                            {statusGroups.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                          </Pie>
                          <Tooltip formatter={(v: number, name: string) => [`${v} (${Math.round(v/total*100)}%)`, name]} contentStyle={{ fontSize: 11 }} />
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="flex flex-wrap justify-center gap-x-3 gap-y-1 mt-1">
                        {statusGroups.map(g => (
                          <div key={g.name} className="flex items-center gap-1 text-[10px] text-gray-600 dark:text-gray-400">
                            <span className="w-2 h-2 rounded-full inline-block" style={{ background: g.color }} />
                            {g.name} <span className="font-semibold text-gray-800 dark:text-gray-200">{g.value}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Chart 2 — Driver Workload (bar chart per driver) */}
            {(() => {
              const driverData = drivers.map(dr => {
                const drOrders = deliveries.filter(d => {
                  const ext = d as unknown as { tracking?: { driverId?: string } };
                  return ext.tracking?.driverId === dr.id || d.assignedDriverId === dr.id;
                });
                return {
                  name: (dr.fullName || dr.username || '').split(' ')[0],
                  'On Route': drOrders.filter(d => (d.status||'').toLowerCase() === 'out-for-delivery').length,
                  Delivered:  drOrders.filter(d => TERMINAL_STATUSES.has((d.status||'').toLowerCase())).length,
                  Pending:    drOrders.filter(d => !['out-for-delivery','out_for_delivery'].includes((d.status||'').toLowerCase()) && !TERMINAL_STATUSES.has((d.status||'').toLowerCase())).length,
                };
              });
              return (
                <div className="pp-card flex min-h-0 flex-col p-4 sm:p-5 lg:h-[340px]">
                  <div className="mb-2 flex flex-shrink-0 items-center gap-2">
                    <Truck className="h-5 w-5 flex-shrink-0 text-teal-500" />
                    <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Driver Workload</h2>
                    <span className="ml-auto text-[10px] text-gray-400 dark:text-gray-500">orders assigned</span>
                  </div>
                  {drivers.length === 0 ? (
                    <div className="flex-1 flex items-center justify-center text-sm text-gray-400 dark:text-gray-500">No drivers</div>
                  ) : (
                    <div className="flex-1 min-h-0">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={driverData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }} barSize={14}>
                          <XAxis dataKey="name" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                          <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} allowDecimals={false} />
                          <Tooltip contentStyle={{ fontSize: 11 }} />
                          <Legend wrapperStyle={{ fontSize: 10, paddingTop: 4 }} />
                          <Bar dataKey="On Route" stackId="a" fill="#3b82f6" radius={[0,0,0,0]} />
                          <Bar dataKey="Pending"  stackId="a" fill="#f59e0b" radius={[0,0,0,0]} />
                          <Bar dataKey="Delivered" stackId="a" fill="#22c55e" radius={[3,3,0,0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </div>
              );
            })()}

          </div>

        </div>
      )}

      {/* ── DELIVERIES TAB ── */}
      {activeTab === 'deliveries' && (
        <DeliveryManagementPage
          hidePageTitle
          excludeGarbageUploadRows
          hideUpload
          forceTab={deliveriesSubTab === 'manage-orders' ? 'manage' : deliveriesSubTab}
          onTabChange={(id) => setDeliveriesSubTab(id)}
          extraTabs={[
            {
              id: 'live-tracking',
              label: 'Live Tracking',
              icon: MapPin,
              content: (() => {
            // Only show out-for-delivery / on-route orders
            const trackingDeliveries = deliveries.filter(d => {
              const s = (d.status || '').toLowerCase();
              if (s !== 'out-for-delivery') return false;
              if (trackingDriverFilter === 'all') return true;
              const ext = d as unknown as { tracking?: { driverId?: string } };
              return ext.tracking?.driverId === trackingDriverFilter || d.assignedDriverId === trackingDriverFilter;
            });
            const highlightedIndex = trackingSelectedId
              ? trackingDeliveries.findIndex(d => d.id === trackingSelectedId)
              : null;

            return (
              <div className="flex gap-3" style={{ height: 'max(560px, calc(100dvh - 240px))' }}>

                {/* ── Map 70% ── */}
                <div className="flex flex-col min-w-0" style={{ flex: '0 0 70%' }}>
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

                {/* ── Order list 30% ── */}
                <div className="flex flex-col gap-2 min-w-0" style={{ flex: '0 0 30%' }}>
                  {/* Header + driver filter */}
                  <div className="pp-card p-3 flex-shrink-0">
                    <div className="flex items-center gap-2 mb-2">
                      <NavigationIcon className="w-4 h-4 text-blue-500 flex-shrink-0" />
                      <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Live Orders</h2>
                      <span className="ml-auto text-[10px] text-gray-400 dark:text-gray-500">{trackingDeliveries.length} orders</span>
                      <button
                        type="button"
                        onClick={() => void loadData()}
                        className="text-xs text-gray-400 hover:text-blue-600 transition-colors"
                        title="Refresh"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <select
                      value={trackingDriverFilter}
                      onChange={e => { setTrackingDriverFilter(e.target.value); setTrackingSelectedId(null); }}
                      className="w-full px-2 py-1.5 text-xs rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="all">All Drivers ({drivers.length})</option>
                      {drivers.map(dr => {
                        const onRoute = deliveries.filter(d => {
                          const ext = d as unknown as { tracking?: { driverId?: string } };
                          return (ext.tracking?.driverId === dr.id || d.assignedDriverId === dr.id) && (d.status||'').toLowerCase() === 'out-for-delivery';
                        }).length;
                        return (
                          <option key={dr.id} value={dr.id}>
                            {dr.fullName || dr.username} — {onRoute > 0 ? `${onRoute} on route` : 'no active'}
                          </option>
                        );
                      })}
                    </select>
                    {trackingSelectedId && (
                      <button
                        type="button"
                        onClick={() => setTrackingSelectedId(null)}
                        className="mt-2 w-full text-[11px] text-blue-600 dark:text-blue-400 hover:underline"
                      >
                        ✕ Clear selection
                      </button>
                    )}
                  </div>

                  {/* Scrollable cards — styled like DeliveryCard */}
                  <div className="flex-1 overflow-y-auto space-y-2 pr-0.5" style={{ minHeight: 0 }}>
                    {trackingDeliveries.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-12 text-gray-400 dark:text-gray-500 text-sm gap-2">
                        <NavigationIcon className="w-8 h-8 opacity-30" />
                        <p className="font-medium">No active deliveries</p>
                        <p className="text-xs text-center">Orders with status "Out for Delivery" will appear here</p>
                      </div>
                    ) : trackingDeliveries.map((delivery, idx) => {
                      const dExt = delivery as unknown as {
                        tracking?: { driverId?: string };
                        goodsMovementDate?: string;
                        confirmedDeliveryDate?: string;
                        deliveryNumber?: string;
                        etaMinutes?: number;
                        metadata?: Record<string, unknown>;
                      };
                      const meta = dExt.metadata ?? {};
                      const isPriority = meta.isPriority === true;
                      const assignedDriver = drivers.find(dr =>
                        dr.id === dExt.tracking?.driverId || dr.id === delivery.assignedDriverId
                      );
                      const isSelected = delivery.id === trackingSelectedId;

                      // ETA: etaMinutes from routing, or time remaining to delivery date
                      const etaMinutes = dExt.etaMinutes ?? null;
                      const etaText = (() => {
                        if (etaMinutes != null && etaMinutes > 0) {
                          return etaMinutes < 60
                            ? `${etaMinutes} min`
                            : `${Math.floor(etaMinutes / 60)}h ${etaMinutes % 60}m`;
                        }
                        if (dExt.confirmedDeliveryDate) {
                          const ms = new Date(dExt.confirmedDeliveryDate).getTime() - Date.now();
                          if (ms > 0 && ms < 24 * 3600000) {
                            const h = Math.floor(ms / 3600000);
                            const m = Math.floor((ms % 3600000) / 60000);
                            return h > 0 ? `${h}h ${m}m` : `${m}m`;
                          }
                        }
                        return 'Calculating…';
                      })();

                      const delDateShort = dExt.confirmedDeliveryDate
                        ? new Date(dExt.confirmedDeliveryDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
                        : null;

                      return (
                        <div
                          key={delivery.id}
                          onClick={() => setTrackingSelectedId(isSelected ? null : delivery.id)}
                          title={isSelected ? 'Click to deselect' : 'Click to highlight on map'}
                          className={`flex flex-col rounded-lg border transition-all cursor-pointer ${
                            isPriority
                              ? 'bg-red-50 dark:bg-red-900/20 border-red-300 dark:border-red-700'
                              : isSelected
                              ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-400 dark:border-blue-500'
                              : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-600'
                          } ${isSelected ? 'ring-2 ring-blue-400 dark:ring-blue-500 shadow-md' : 'hover:shadow-md'}`}
                        >
                          <div className="flex items-start gap-2 p-3">
                            {/* Stop number */}
                            <span className="text-base font-bold text-blue-600 dark:text-blue-400 w-7 flex-shrink-0 pt-0.5">
                              {idx + 1}.
                            </span>

                            <div className="flex-1 min-w-0 space-y-1.5">
                              {/* Customer + badges */}
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
                                  {delivery.customer || 'Unknown Customer'}
                                </span>
                                {isPriority && (
                                  <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-red-600 text-white shrink-0">
                                    P1
                                  </span>
                                )}
                                {isSelected && (
                                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 shrink-0">
                                    ● on map
                                  </span>
                                )}
                              </div>

                              {/* PO number */}
                              {delivery.poNumber && (
                                <p className="text-[11px] text-gray-400 dark:text-gray-500 font-mono">
                                  PO: {delivery.poNumber}
                                </p>
                              )}

                              {/* Address */}
                              {delivery.address && (
                                <div className="text-xs text-gray-600 dark:text-gray-400 flex items-start gap-1">
                                  📍 <span className="break-words">{delivery.address}</span>
                                </div>
                              )}

                              {/* Driver */}
                              {assignedDriver && (
                                <div className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
                                  <Truck className="w-3 h-3 shrink-0" />
                                  <span className="truncate font-medium text-indigo-600 dark:text-indigo-400">
                                    {assignedDriver.fullName || assignedDriver.username}
                                  </span>
                                </div>
                              )}

                              {/* ETA + delivery date row */}
                              <div className="flex flex-wrap items-center gap-2 pt-0.5">
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300">
                                  <Clock className="w-3 h-3" /> ETA {etaText}
                                </span>
                                {delDateShort && (
                                  <span className="text-[11px] text-gray-400 dark:text-gray-500">
                                    Del: {delDateShort}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
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
                  ) : (
                    messages.map(msg => {
                      const currentUser = getCurrentUser() as (AuthUser & { account?: { role?: string } }) | null;
                      const currentUserId = currentUser?.sub;
                      // A message is "sent by me" when:
                      // 1. My ID matches adminId (staff side of conversation), AND
                      // 2. The sender is not a driver (driver messages also store adminId = the staff they messaged)
                      const isSent = String(msg.adminId) === String(currentUserId) && msg.senderRole !== 'driver';

                      return (
                        <div key={msg.id} className={`chat-message-enter flex items-end gap-2 ${isSent ? 'justify-end' : 'justify-start'}`}>
                          {!isSent && (
                            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-gray-400 to-gray-600 flex-shrink-0 flex items-center justify-center text-white text-xs font-semibold shadow-sm">
                              {(selectedContact.fullName || selectedContact.username || '?')[0].toUpperCase()}
                            </div>
                          )}
                          <div className="max-w-[88%] sm:max-w-[75%]">
                            <div className={`px-4 py-2.5 shadow-sm ${
                              isSent
                                ? 'bg-blue-600 dark:bg-blue-500 text-white rounded-2xl rounded-tr-sm'
                                : 'bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border border-gray-200 dark:border-gray-700 rounded-2xl rounded-tl-sm'
                            }`}>
                              {/* Attachment rendering */}
                              {msg.attachmentUrl && msg.attachmentType?.startsWith('image/') && (
                                <a href={msg.attachmentUrl} target="_blank" rel="noopener noreferrer" className="block mb-2">
                                  <img
                                    src={msg.attachmentUrl}
                                    alt={msg.attachmentName || 'attachment'}
                                    className="max-w-full rounded-lg max-h-48 object-cover cursor-pointer hover:opacity-90 transition-opacity"
                                  />
                                </a>
                              )}
                              {msg.attachmentUrl && !msg.attachmentType?.startsWith('image/') && (
                                <a
                                  href={msg.attachmentUrl}
                                  download={msg.attachmentName || 'file'}
                                  className={`flex items-center gap-2 mb-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                                    isSent
                                      ? 'bg-blue-500 text-white hover:bg-blue-400'
                                      : 'bg-gray-100 dark:bg-gray-700 text-blue-600 dark:text-blue-400 hover:bg-gray-200'
                                  }`}
                                >
                                  <Paperclip className="w-4 h-4 flex-shrink-0" />
                                  <span className="truncate">{msg.attachmentName || 'Download file'}</span>
                                </a>
                              )}
                              {msg.content && <p className="text-sm leading-relaxed">{msg.content}</p>}
                            </div>
                            <p className={`text-[11px] mt-1 px-1 text-gray-400 dark:text-gray-500 ${isSent ? 'text-right' : 'text-left'}`}>
                              {formatMessageTimestamp(msg.createdAt)}
                            </p>
                          </div>
                        </div>
                      );
                    })
                  )}
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
    </div>
  );
}
