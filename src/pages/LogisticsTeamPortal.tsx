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
import { calculateRoute, generateFallbackRoute } from '../services/advancedRoutingService';
import useDeliveryStore from '../store/useDeliveryStore';
import { deliveryToManageOrder } from '../utils/deliveryWorkflowMap';
import { isDubaiPublicHoliday } from '../utils/dubaiHolidays';
import type { Delivery, AuthUser } from '../types';
import WhatsAppSendModal from '../components/Upload/WhatsAppSendModal';

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
  const [activeTab, setActiveTab] = useState<string>('operations');
  const [drivers, setDrivers] = useState<ContactUser[]>([]);
  const [contacts, setContacts] = useState<ContactUser[]>([]); // All contacts (drivers + team members)
  const [teamMembers, setTeamMembers] = useState<ContactUser[]>([]); // Admin + delivery_team
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [alerts, setAlerts] = useState<SystemAlert[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  
  // Per-driver daily capacity: driverId → { used, remaining, max }
  const [driverCapacity, setDriverCapacity] = useState<Record<string, { used: number; remaining: number; max: number; full: boolean }>>({});

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


  // Route for monitoring map (matches Admin Operations)
  const [monitoringRoute, setMonitoringRoute] = useState<{ coordinates: [number, number][] } | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);

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

    return () => clearInterval(interval);
  }, []);

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

  // Handle URL-based contact selection for communication
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const tabParam = params.get('tab');
    const contactId = params.get('driver') || params.get('contact');
    
    // Switch to tab specified in URL
    if (tabParam && tabParam !== activeTab) {
      setActiveTab(tabParam);
    }
    
    // If contact ID is provided, switch to communication tab and select contact
    if (contactId) {
      if (activeTab !== 'communication') {
        setActiveTab('communication');
      }
      
      // Select the contact when contacts are loaded
      if (contacts.length > 0) {
        const contact = contacts.find(c => c.id === contactId);
        if (contact && (!selectedContact || selectedContact.id !== contactId)) {
          console.log('[DeliveryTeam] Selecting contact from URL:', contact.fullName || contact.username);
          setSelectedContact(contact);
        }
      }
    }
  }, [location.search, contacts, selectedContact, activeTab]);

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
      setDeliveries(allDeliveries);

      // Sync to store so Deliveries tab shows same list as monitoring
      useDeliveryStore.getState().loadDeliveries(allDeliveries);

      // Set contacts from API response (for communication tab)
      const allContacts = (contactsRes.data?.contacts || []) as ContactUser[];
      const teamMembersList = (contactsRes.data?.teamMembers || []) as ContactUser[];

      console.log('[DeliveryTeam] Loaded:', {
        drivers: driversList.length,
        deliveries: allDeliveries.length,
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

      allDeliveries.forEach(delivery => {
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

      // Load per-driver capacity for today + tomorrow
      try {
        const capRes = await api.get('/deliveries/admin/driver-capacity').catch(() => null);
        if (capRes?.data?.drivers) {
          const map: Record<string, { used: number; remaining: number; max: number; full: boolean }> = {};
          for (const d of capRes.data.drivers as Array<{ driverId: string; used: number; remaining: number; max: number; full: boolean }>) {
            map[d.driverId] = { used: d.used, remaining: d.remaining, max: d.max, full: d.full };
          }
          setDriverCapacity(map);
        }
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
  const getDeliveryStatusBadge = (delivery: Delivery): { label: string; color: string } => {
    const order = deliveryToManageOrder(delivery);
    const shortDate = order.confirmedDeliveryDate
      ? order.confirmedDeliveryDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
      : null;
    switch (order.status) {
      case 'order_delay':       return { label: 'Order Delay',                                                              color: 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300' };
      case 'out_for_delivery':  return { label: 'On Route',                                                                  color: 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300' };
      case 'tomorrow_shipment': return { label: shortDate ? `Tomorrow · ${shortDate}` : 'Tomorrow Shipment',                 color: 'bg-teal-100 dark:bg-teal-900/30 text-teal-800 dark:text-teal-300' };
      case 'next_shipment':     return { label: shortDate ? `Next Shipment · ${shortDate}` : 'Next Shipment',               color: 'bg-cyan-100 dark:bg-cyan-900/30 text-cyan-800 dark:text-cyan-300' };
      case 'future_shipment':   return { label: shortDate ? `Future Shipment · ${shortDate}` : 'Future Shipment',           color: 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-800 dark:text-indigo-300' };
      case 'confirmed':         return { label: 'Customer Confirmed',                                                        color: 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300' };
      case 'sms_sent':          return { label: 'Awaiting Customer',                                                         color: 'bg-orange-100 dark:bg-orange-900/30 text-orange-800 dark:text-orange-300' };
      case 'unconfirmed':       return { label: 'No Response (24h+)',                                                        color: 'bg-rose-100 dark:bg-rose-900/30 text-rose-800 dark:text-rose-300' };
      case 'uploaded':          return { label: 'Pending Order',                                                             color: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300' };
      case 'rescheduled':       return { label: shortDate ? `Rescheduled · ${shortDate}` : 'Rescheduled',                   color: 'bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300' };
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
    <div className="space-y-4 md:space-y-6 w-full min-w-0">
      {/* WhatsApp confirmation modal — opens automatically after file upload */}
      <WhatsAppSendModal />
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
      <div className="pp-sticky-tab-rail pp-card px-2 py-2 mt-4 md:mt-6 mb-4 md:mb-6 overflow-x-auto">
        <nav className="flex flex-wrap gap-2 min-w-max md:min-w-0">
          {[
            { id: 'operations', label: 'Operations', icon: Activity },
            { id: 'deliveries', label: 'Deliveries', icon: Package },
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

      {/* Operations Tab — two-column: left=map+drivers, right=dispatch table */}
      {activeTab === 'operations' && (
        <div className="space-y-4 md:space-y-6">

          {/* ── Unified Stats Row ── */}
          {(() => {
            const activeAll = deliveries.filter(d => !TERMINAL_STATUSES.has((d.status || '').toLowerCase()));
            const assignedActive = activeAll.filter(d => {
              const dt = d as unknown as { tracking?: { driverId?: string } };
              return !!(dt.tracking?.driverId || d.assignedDriverId);
            });
            const unassignedActive = activeAll.filter(d => {
              const dt = d as unknown as { tracking?: { driverId?: string } };
              return !dt.tracking?.driverId && !d.assignedDriverId;
            });
            const ofd = activeAll.filter(d => (d.status || '').toLowerCase() === 'out-for-delivery');
            const onlineDrivers = drivers.filter(d => isContactOnline(d)).length;
            const completedCount = deliveries.filter(d => TERMINAL_STATUSES.has((d.status || '').toLowerCase())).length;
            return (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                <div className="pp-card p-4 text-center">
                  <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Active Orders</div>
                  <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">{activeAll.length}</div>
                  <div className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">need delivery</div>
                </div>
                <div className="pp-card p-4 text-center bg-green-50 dark:bg-green-900/20">
                  <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Assigned</div>
                  <div className="text-2xl font-bold text-green-600 dark:text-green-400">{assignedActive.length}</div>
                  <div className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">with driver</div>
                </div>
                <div className="pp-card p-4 text-center bg-yellow-50 dark:bg-yellow-900/20">
                  <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Unassigned</div>
                  <div className="text-2xl font-bold text-yellow-600 dark:text-yellow-400">{unassignedActive.length}</div>
                  <div className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">needs assignment</div>
                </div>
                <div className="pp-card p-4 text-center bg-blue-50 dark:bg-blue-900/20">
                  <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Out for Delivery</div>
                  <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">{ofd.length}</div>
                  <div className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">in transit</div>
                </div>
                <div className="pp-card p-4 text-center bg-emerald-50 dark:bg-emerald-900/20">
                  <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Completed</div>
                  <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{completedCount}</div>
                  <div className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">all time</div>
                </div>
                <div className="pp-card p-4 text-center bg-indigo-50 dark:bg-indigo-900/20">
                  <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Online Drivers</div>
                  <div className="text-2xl font-bold text-indigo-600 dark:text-indigo-400">{onlineDrivers}</div>
                  <div className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">of {drivers.length} total</div>
                </div>
              </div>
            );
          })()}

          {/* ── Needs Attention + Awaiting Customer Response ── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Needs Attention */}
            <div className="pp-card p-4 sm:p-5">
              <div className="flex items-center gap-2 mb-4">
                <AlertCircle className="w-5 h-5 text-amber-500" />
                <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Needs Attention</h2>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
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
                    }}
                    className={`flex flex-col items-center justify-center p-3 rounded-xl ${bg} border ${border} ${hover} transition-colors cursor-pointer select-none`}
                    title={`View ${label} in Delivery Orders table`}
                  >
                    <span className={`text-xl font-bold ${countColor}`}>{count}</span>
                    <span className={`text-xs font-semibold ${labelColor} mt-0.5 text-center leading-tight`}>{label}</span>
                    <span className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5 text-center">→ {sublabel}</span>
                  </div>
                ))}
              </div>
              {(actionItems.pendingOrders.length > 0 || actionItems.unassigned.length > 0 || actionItems.awaitingConfirmation.length > 0 || actionItems.orderDelay.length > 0) && (
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-3 text-center">Tap any card to open the filtered order list in Deliveries tab</p>
              )}
            </div>

            {/* Awaiting Customer Response list */}
            <div className="pp-card p-4 sm:p-5 flex flex-col">
              <div className="flex items-center gap-2 mb-4">
                <MessageSquare className="w-5 h-5 text-purple-500" />
                <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Awaiting Customer Response</h2>
                {actionItems.awaitingConfirmation.length > 0 && (
                  <span className="ml-auto px-2 py-0.5 rounded-full bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 text-xs font-bold">
                    {actionItems.awaitingConfirmation.length}
                  </span>
                )}
              </div>
              {actionItems.awaitingConfirmation.length === 0 ? (
                <div className="flex-1 flex items-center justify-center py-6 text-sm text-gray-400 dark:text-gray-500">
                  <CheckCircle className="w-4 h-4 mr-2 text-green-400" /> All customers responded
                </div>
              ) : (
                <div className="space-y-2 max-h-48 overflow-y-auto">
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
                      <div key={delivery.id || idx} className="flex items-start gap-3 p-2.5 rounded-lg bg-purple-50 dark:bg-purple-900/10 border border-purple-100 dark:border-purple-800/20">
                        <Clock className="w-4 h-4 text-purple-500 mt-0.5 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                            {delivery.customer || 'Unknown Customer'}
                          </p>
                          <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                            {delivery.poNumber ? `PO: ${delivery.poNumber}` : ''} {delivery.address || ''}
                          </p>
                        </div>
                        {sentAgo && (
                          <span className="text-xs text-purple-600 dark:text-purple-400 shrink-0">{sentAgo}</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* ── Live Map (70%) + Driver Cards (30%) ── */}
          <div className="flex flex-col xl:flex-row gap-4">

            {/* Live Operations Map — 70% */}
            <div className="pp-card overflow-hidden xl:flex-[7]">
              <div className="p-3 bg-gray-50 dark:bg-gray-700 border-b dark:border-gray-600 flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-blue-500" /> Live Operations Map
                </h2>
                {routeLoading && <span className="text-xs text-blue-600 dark:text-blue-400">Calculating route…</span>}
              </div>
              <DeliveryMap
                deliveries={deliveries.filter(d => (d.status || '').toLowerCase() === 'out-for-delivery')}
                route={monitoringRoute}
                driverLocations={drivers
                  .filter((d) => isContactOnline(d) && d.tracking?.location && Number.isFinite(d.tracking.location.lat) && Number.isFinite(d.tracking.location.lng))
                  .map((d) => ({
                    id: d.id,
                    name: d.fullName || d.full_name || d.username || 'Driver',
                    status: d.tracking?.online ? 'online' : 'offline',
                    speedKmh: d.tracking?.location?.speed != null ? Math.round(d.tracking.location.speed * 3.6) : null,
                    lat: d.tracking!.location!.lat,
                    lng: d.tracking!.location!.lng,
                  }))}
                mapClassName="h-[380px] md:h-[460px]"
              />
            </div>

            {/* Driver Status Cards — 30% (clickable → chat) */}
            <div className="pp-card p-3 xl:flex-[3] flex flex-col">
              <div className="flex items-center gap-2 mb-3">
                <Users className="w-4 h-4 text-indigo-500" />
                <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Driver Status</h2>
                <span className="ml-auto text-[10px] text-gray-400 dark:text-gray-500">Click to chat</span>
              </div>
              {drivers.length === 0 ? (
                <div className="flex-1 flex items-center justify-center py-6 text-sm text-gray-400 dark:text-gray-500">No drivers available</div>
              ) : (
                <div className="flex-1 overflow-y-auto space-y-2" style={{ maxHeight: '420px' }}>
                  {drivers.map(driver => {
                    const isOnline = isContactOnline(driver);
                    const loc = driver.tracking?.location;
                    const assignedOrders = deliveries.filter(d => {
                      const dExt = d as unknown as { tracking?: { driverId?: string } };
                      return (dExt.tracking?.driverId === driver.id || d.assignedDriverId === driver.id) && (d.status || '').toLowerCase() === 'out-for-delivery';
                    }).length;
                    return (
                      <button
                        key={driver.id}
                        type="button"
                        onClick={() => {
                          setSelectedContact(driver);
                          setActiveTab('communication');
                          void loadMessages(driver.id);
                        }}
                        className="w-full text-left p-3 rounded-xl border border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-750 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 hover:border-indigo-200 dark:hover:border-indigo-700 transition-all group"
                      >
                        <div className="flex items-center gap-2 mb-1.5">
                          <div className="relative flex-shrink-0">
                            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-blue-600 flex items-center justify-center text-white text-xs font-bold shadow-sm">
                              {(driver.fullName || driver.username || '?')[0].toUpperCase()}
                            </div>
                            <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white dark:border-gray-800 ${isOnline ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'}`} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-semibold text-gray-900 dark:text-gray-100 truncate">{driver.fullName || driver.username}</div>
                            <div className={`text-[10px] font-medium ${isOnline ? 'text-green-600 dark:text-green-400' : 'text-gray-400 dark:text-gray-500'}`}>
                              {isOnline ? '● Online' : '○ Offline'}
                            </div>
                          </div>
                          <MessageSquare className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500 group-hover:text-indigo-500 dark:group-hover:text-indigo-400 transition-colors flex-shrink-0" />
                        </div>
                        <div className="flex items-center gap-3 text-[10px] text-gray-500 dark:text-gray-400">
                          {loc && <span className="flex items-center gap-1"><MapPin className="w-2.5 h-2.5" />GPS Active</span>}
                          {assignedOrders > 0 && <span className="flex items-center gap-1"><Truck className="w-2.5 h-2.5" />{assignedOrders} on route</span>}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
              {/* Alerts compact */}
              {alerts.length > 0 && (
                <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-700">
                  <div className="flex items-center gap-2 mb-2">
                    <AlertCircle className="w-3.5 h-3.5 text-amber-500" />
                    <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">Alerts</span>
                    <span className="ml-auto px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 text-[10px] font-bold">{alerts.length}</span>
                  </div>
                  <div className="space-y-1.5 max-h-32 overflow-y-auto">
                    {alerts.slice(0, 5).map(alert => (
                      <div key={alert.id} className="flex items-start gap-2 p-2 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
                        <AlertCircle className="w-3 h-3 text-yellow-600 dark:text-yellow-400 flex-shrink-0 mt-0.5" />
                        <p className="text-[10px] text-gray-700 dark:text-gray-300 leading-tight">
                          <span className="font-medium">{alert.driver || alert.delivery}:</span> {alert.message}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* ── Full-Width Assign & Dispatch Table ── */}
          {(() => {
            const q = opsSearch.toLowerCase().trim();
            const opsRows = deliveries
              .filter(d => {
                const s = (d.status || '').toLowerCase();
                if (opsStatusFilter !== 'all') {
                  if (opsStatusFilter === 'pending' && !['pending', 'uploaded'].includes(s)) return false;
                  if (opsStatusFilter === 'awaiting' && s !== 'scheduled') return false;
                  if (opsStatusFilter === 'ofd' && s !== 'out-for-delivery') return false;
                  if (opsStatusFilter === 'delay' && s !== 'order-delay') return false;
                  if (opsStatusFilter === 'terminal' && !TERMINAL_STATUSES.has(s)) return false;
                }
                if (!q) return true;
                const meta = ((d as unknown as { metadata?: Record<string, unknown> }).metadata ?? {});
                const orig = ((meta.originalRow ?? meta._originalRow ?? {}) as Record<string, unknown>);
                const delNum = String((d as unknown as { deliveryNumber?: string }).deliveryNumber ?? orig['Delivery number'] ?? orig['Delivery Number'] ?? orig['Delivery'] ?? meta.originalDeliveryNumber ?? '');
                return (
                  (d.customer || '').toLowerCase().includes(q) ||
                  (d.poNumber || '').toLowerCase().includes(q) ||
                  delNum.toLowerCase().includes(q) ||
                  (d.address || '').toLowerCase().includes(q) ||
                  (d.phone || '').toLowerCase().includes(q)
                );
              })
              .sort((a, b) => {
                const prio = (s: string) => s === 'out-for-delivery' ? 0 : s === 'order-delay' ? 1 : TERMINAL_STATUSES.has(s) ? 3 : 2;
                return prio((a.status || '').toLowerCase()) - prio((b.status || '').toLowerCase());
              });

            return (
              <div className="pp-card overflow-hidden">
                {/* Header */}
                <div className="p-4 bg-gray-50 dark:bg-gray-700 border-b dark:border-gray-600">
                  <div className="flex flex-wrap items-center gap-3 mb-3">
                    <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                      <Truck className="w-4 h-4 text-blue-500" /> Assign & Dispatch
                      <span className="text-xs font-normal text-gray-400 dark:text-gray-500">({opsRows.length} orders)</span>
                    </h2>
                    <div className="ml-auto flex items-center gap-2">
                      <button type="button" onClick={() => void loadData()} className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-blue-600 transition-colors">
                        <RefreshCw className="w-3.5 h-3.5" /> Refresh
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 items-center">
                    <input
                      type="text"
                      placeholder="Search customer, PO, delivery #, address…"
                      value={opsSearch}
                      onChange={e => setOpsSearch(e.target.value)}
                      className="px-3 py-1.5 text-xs rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 w-64"
                    />
                    {(['all','pending','awaiting','ofd','delay','terminal'] as const).map(f => (
                      <button
                        key={f}
                        type="button"
                        onClick={() => setOpsStatusFilter(f)}
                        className={`px-3 py-1 rounded-full text-[11px] font-semibold transition-colors ${
                          opsStatusFilter === f
                            ? f === 'all' ? 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900'
                            : f === 'pending' ? 'bg-yellow-500 text-white'
                            : f === 'awaiting' ? 'bg-purple-600 text-white'
                            : f === 'ofd' ? 'bg-blue-600 text-white'
                            : f === 'delay' ? 'bg-red-600 text-white'
                            : 'bg-green-600 text-white'
                            : 'border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50'
                        }`}
                      >
                        {f === 'all' ? 'All' : f === 'pending' ? 'Pending' : f === 'awaiting' ? 'Awaiting SMS' : f === 'ofd' ? 'On Route' : f === 'delay' ? 'Delayed' : 'Completed'}
                      </button>
                    ))}
                  </div>
                </div>

                {assignmentMessage && (
                  <div className={`mx-4 mt-3 p-3 rounded-lg text-sm ${
                    assignmentMessage.type === 'success'
                      ? 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-800 dark:text-green-300'
                      : 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-300'
                  }`}>
                    {assignmentMessage.text}
                  </div>
                )}

                <div className="overflow-x-auto">
                  <table className="w-full text-xs divide-y divide-gray-200 dark:divide-gray-700" style={{ minWidth: '1700px' }}>
                    <thead className="bg-gray-50 dark:bg-gray-700/80 sticky top-0 z-10">
                      <tr>
                        {['·','PO #','Del #','Customer','Phone','Address','City','Status','GMD','Del Date','Model','Description','Material','Inv. Price','Items','Units','Driver','Actions'].map(h => (
                          <th key={h} className="px-3 py-2.5 text-left text-[10px] font-semibold text-gray-500 dark:text-gray-300 uppercase tracking-wider whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-100 dark:divide-gray-700/60">
                      {opsRows.length === 0 ? (
                        <tr>
                          <td colSpan={18} className="px-4 py-8 text-center text-gray-400 dark:text-gray-500">No orders found</td>
                        </tr>
                      ) : opsRows.map(delivery => {
                        const dExt = delivery as unknown as {
                          goodsMovementDate?: string;
                          smsSentAt?: string;
                          confirmedDeliveryDate?: string;
                          deliveryNumber?: string;
                          confirmationStatus?: string;
                          metadata?: Record<string, unknown>;
                          tracking?: { driverId?: string };
                        };
                        const meta = (dExt.metadata ?? {}) as Record<string, unknown>;
                        const orig = ((meta.originalRow ?? meta._originalRow ?? {}) as Record<string, unknown>);
                        const delNum = String(dExt.deliveryNumber ?? orig['Delivery number'] ?? orig['Delivery Number'] ?? orig['Delivery'] ?? meta.originalDeliveryNumber ?? '—');
                        const city = String(orig['City'] ?? orig['city'] ?? orig['Ship-to City'] ?? '—');
                        const model = String(orig['MODEL ID'] ?? orig['Model ID'] ?? orig['model_id'] ?? orig['Model'] ?? '—');
                        // 'Description' appears as multiple columns in the Excel; take first non-empty
                        const description = String(orig['Description'] ?? orig['description'] ?? meta['description'] ?? delivery.items ?? '—');
                        const material = String(orig['Material'] ?? orig['material'] ?? orig['Material Number'] ?? orig['PNC'] ?? '—');
                        const invoicePrice = String(orig['Invoice Price'] ?? orig['invoice_price'] ?? orig['Price'] ?? '—');
                        // Items: use Order Quantity or Confirmed quantity (real Excel columns)
                        const itemQty = String(orig['Order Quantity'] ?? orig['Confirmed quantity'] ?? orig['Total Line Deliv. Qt'] ?? orig['Order Qty'] ?? orig['Quantity'] ?? orig['qty'] ?? '—');
                        // Units: use Sales unit (real Excel column, e.g. "EA" = each)
                        const salesUnit = String(orig['Sales unit'] ?? orig['Unit'] ?? orig['UOM'] ?? orig['Sales Unit'] ?? '—');
                        const gmd = dExt.goodsMovementDate ? new Date(dExt.goodsMovementDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }) : '—';
                        const delDate = dExt.confirmedDeliveryDate ? new Date(dExt.confirmedDeliveryDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }) : '—';
                        const rawStatus = (delivery.status || '').toLowerCase();
                        const isOFD = rawStatus === 'out-for-delivery' || rawStatus === 'in-transit' || rawStatus === 'in-progress';
                        const isDelay = rawStatus === 'order-delay';
                        const isDispatchable = ['pending', 'scheduled', 'uploaded', 'confirmed', 'scheduled-confirmed'].includes(rawStatus);
                        const hasGMD = !!dExt.goodsMovementDate;
                        // Show "Send SMS" (WhatsApp) until the customer confirms — regardless of
                        // whether a link was already sent. After customer confirms, button is not needed.
                        const confirmationDone = (dExt.confirmationStatus as string) === 'confirmed';
                        const terminalStatus = ['out-for-delivery', 'delivered', 'cancelled', 'returned', 'in-transit', 'in-progress', 'finished', 'completed', 'pod-completed'].includes(rawStatus);
                        const needsSMS = !!delivery.phone && !confirmationDone && !terminalStatus;
                        const currentDriverId = dExt.tracking?.driverId || delivery.assignedDriverId;
                        const currentDriver = drivers.find(d => d.id === currentDriverId);
                        const isOnline = currentDriver ? isContactOnline(currentDriver) : false;
                        const { label: statusLabel, color: statusColor } = getDeliveryStatusBadge(delivery);
                        const rowBg = isOFD
                          ? 'bg-blue-50/40 dark:bg-blue-900/10 border-l-4 border-l-blue-500'
                          : isDelay
                          ? 'bg-red-50/40 dark:bg-red-900/10 border-l-4 border-l-red-400'
                          : 'border-l-4 border-l-transparent';

                        return (
                          <tr key={delivery.id} className={`${rowBg} hover:brightness-95 dark:hover:brightness-110 transition-all`}>
                            <td className="pl-3 pr-1 py-3">
                              <span className={`block w-2 h-2 rounded-full flex-shrink-0 ${
                                isOFD ? 'bg-blue-500 shadow-[0_0_6px_rgba(59,130,246,0.7)]' :
                                isDelay ? 'bg-red-400' :
                                currentDriverId ? 'bg-amber-400' : 'bg-gray-300 dark:bg-gray-600'
                              }`} />
                            </td>
                            <td className="px-3 py-2.5 font-mono text-gray-700 dark:text-gray-300 whitespace-nowrap">{delivery.poNumber || '—'}</td>
                            <td className="px-3 py-2.5 font-mono text-gray-600 dark:text-gray-400 whitespace-nowrap">{delNum}</td>
                            <td className="px-3 py-2.5">
                              <div className="font-medium text-gray-900 dark:text-gray-100 whitespace-nowrap">{delivery.customer || '—'}</div>
                            </td>
                            <td className="px-3 py-2.5 text-gray-500 dark:text-gray-400 whitespace-nowrap">{delivery.phone || '—'}</td>
                            <td className="px-3 py-2.5 max-w-[160px]">
                              <div className="truncate text-gray-600 dark:text-gray-300" title={delivery.address || ''}>{delivery.address || '—'}</div>
                            </td>
                            <td className="px-3 py-2.5 text-gray-600 dark:text-gray-300 whitespace-nowrap">{city}</td>
                            <td className="px-3 py-2.5">
                              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap ${statusColor}`}>
                                {statusLabel}
                              </span>
                            </td>
                            <td className="px-3 py-2.5 text-gray-600 dark:text-gray-300 whitespace-nowrap">{gmd}</td>
                            <td className="px-3 py-2.5 text-gray-600 dark:text-gray-300 whitespace-nowrap">{delDate}</td>
                            <td className="px-3 py-2.5 max-w-[100px]">
                              <div className="truncate text-gray-600 dark:text-gray-300" title={model}>{model}</div>
                            </td>
                            <td className="px-3 py-2.5 max-w-[130px]">
                              <div className="truncate text-gray-500 dark:text-gray-400" title={description}>{description}</div>
                            </td>
                            <td className="px-3 py-2.5 font-mono text-gray-600 dark:text-gray-400 whitespace-nowrap">{material}</td>
                            <td className="px-3 py-2.5 text-gray-600 dark:text-gray-300 whitespace-nowrap">{invoicePrice}</td>
                            <td className="px-3 py-2.5 text-center font-semibold text-gray-800 dark:text-gray-200 whitespace-nowrap">{itemQty}</td>
                            <td className="px-3 py-2.5 text-center text-gray-500 dark:text-gray-400 whitespace-nowrap">{salesUnit}</td>
                            {/* Driver + capacity */}
                            <td className="px-3 py-2.5" style={{ minWidth: '160px' }}>
                              {currentDriver && (
                                <div className="flex items-center gap-1 mb-1">
                                  <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isOnline ? 'bg-green-500' : 'bg-gray-300'}`} />
                                  <span className="text-xs font-medium text-gray-800 dark:text-gray-200 truncate">{currentDriver.fullName || currentDriver.username}</span>
                                  {driverCapacity[currentDriverId || ''] && (
                                    <span className={`ml-auto text-[9px] font-bold px-1 py-0.5 rounded ${driverCapacity[currentDriverId || ''].full ? 'bg-red-100 text-red-600' : driverCapacity[currentDriverId || ''].used >= driverCapacity[currentDriverId || ''].max * 0.75 ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'}`}>
                                      {driverCapacity[currentDriverId || ''].used}/{driverCapacity[currentDriverId || ''].max}
                                    </span>
                                  )}
                                </div>
                              )}
                              <select
                                value={currentDriverId || ''}
                                onChange={async (e: React.ChangeEvent<HTMLSelectElement>) => {
                                  const newDriverId = e.target.value;
                                  if (!newDriverId) return;
                                  setAssigningDelivery(delivery.id);
                                  setAssignmentMessage(null);
                                  try {
                                    await api.put(`/deliveries/admin/${delivery.id}/assign`, { driverId: newDriverId });
                                    setAssignmentMessage({ type: 'success', text: `✓ Assigned to ${drivers.find(d => d.id === newDriverId)?.fullName || 'driver'}` });
                                    setTimeout(() => { void loadData(); setAssignmentMessage(null); }, 2000);
                                  } catch (err: unknown) {
                                    const apiErr = err as { response?: { data?: { message?: string; remaining?: number } } };
                                    const errMsg = apiErr?.response?.data?.message || 'Failed to assign delivery';
                                    setAssignmentMessage({ type: 'error', text: errMsg });
                                  } finally { setAssigningDelivery(null); }
                                }}
                                disabled={assigningDelivery === delivery.id}
                                className="w-full px-2 py-1 border border-gray-200 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-[11px] text-gray-700 dark:text-gray-200 disabled:opacity-50"
                              >
                                <option value="">{currentDriverId ? '— Reassign —' : '— Assign —'}</option>
                                {drivers.map(driver => {
                                  const cap = driverCapacity[driver.id];
                                  const label = cap
                                    ? `${driver.fullName || driver.username} (${cap.used}/${cap.max} used${cap.full ? ' — FULL' : ''})`
                                    : (driver.fullName || driver.username);
                                  return (
                                    <option key={driver.id} value={driver.id} disabled={cap?.full && driver.id !== currentDriverId}>
                                      {label}
                                    </option>
                                  );
                                })}
                              </select>
                            </td>
                            {/* Actions */}
                            <td className="px-3 py-2.5" style={{ minWidth: '140px' }}>
                              <div className="flex flex-col gap-1">
                                {needsSMS && (
                                  <button
                                    type="button"
                                    disabled={sendingSms === delivery.id}
                                    onClick={async () => {
                                      setSendingSms(delivery.id);
                                      try {
                                        const res = await api.post(`/deliveries/${delivery.id}/send-sms`);
                                        // Open WhatsApp deep-link if returned (SMS provider compliance pending)
                                        const waUrl = (res.data as { whatsappUrl?: string })?.whatsappUrl;
                                        if (waUrl) window.open(waUrl, '_blank');
                                        setAssignmentMessage({ type: 'success', text: `✓ SMS sent to ${delivery.customer || 'customer'}` });
                                        setTimeout(() => { void loadData(); setAssignmentMessage(null); }, 2000);
                                      } catch { setAssignmentMessage({ type: 'error', text: 'Failed to send SMS' }); }
                                      finally { setSendingSms(null); }
                                    }}
                                    className="inline-flex items-center justify-center gap-1 px-2 py-1 rounded text-[11px] font-semibold bg-purple-600 hover:bg-purple-700 text-white disabled:opacity-60 whitespace-nowrap"
                                  >
                                    {sendingSms === delivery.id ? '…' : dExt.smsSentAt ? '📱 Resend SMS' : '📱 Send SMS'}
                                  </button>
                                )}
                                {isDispatchable && !hasGMD && !isOFD && (
                                  <span className="inline-flex items-center justify-center px-2 py-1 rounded text-[11px] font-semibold bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 cursor-not-allowed whitespace-nowrap" title="Set Goods Movement Date to dispatch">
                                    GMD required
                                  </span>
                                )}
                                {isDispatchable && hasGMD && (
                                  <button
                                    type="button"
                                    disabled={markingOFD === delivery.id}
                                    onClick={async () => {
                                      setMarkingOFD(delivery.id);
                                      try {
                                        await api.put(`/deliveries/admin/${delivery.id}/status`, {
                                          status: 'out-for-delivery',
                                          customer: delivery.customer,
                                          address: delivery.address,
                                          goodsMovementDate: dExt.goodsMovementDate,
                                        });
                                        setAssignmentMessage({ type: 'success', text: `✓ ${delivery.customer || 'Delivery'} dispatched` });
                                        setTimeout(() => { void loadData(); setAssignmentMessage(null); }, 2000);
                                      } catch (err: unknown) {
                                        const e = err as { response?: { data?: { error?: string } }; message?: string };
                                        setAssignmentMessage({ type: 'error', text: e?.response?.data?.error ?? e?.message ?? 'Failed to dispatch' });
                                      } finally { setMarkingOFD(null); }
                                    }}
                                    className="inline-flex items-center justify-center gap-1 px-2 py-1 rounded text-[11px] font-semibold bg-green-600 hover:bg-green-700 text-white disabled:opacity-60 whitespace-nowrap"
                                  >
                                    {markingOFD === delivery.id ? '…' : '🚚 Dispatch'}
                                  </button>
                                )}
                                <select
                                  value=""
                                  disabled={statusUpdating === delivery.id}
                                  onChange={async (e: React.ChangeEvent<HTMLSelectElement>) => {
                                    const newStatus = e.target.value;
                                    if (!newStatus) return;
                                    setStatusUpdating(delivery.id);
                                    try {
                                      await api.put(`/deliveries/admin/${delivery.id}/status`, { status: newStatus, customer: delivery.customer, address: delivery.address });
                                      setAssignmentMessage({ type: 'success', text: `✓ Status updated to ${newStatus}` });
                                      setTimeout(() => { void loadData(); setAssignmentMessage(null); }, 2000);
                                    } catch { setAssignmentMessage({ type: 'error', text: 'Failed to update status' }); }
                                    finally { setStatusUpdating(null); }
                                  }}
                                  className="w-full px-2 py-1 border border-gray-200 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-[11px] text-gray-700 dark:text-gray-200 disabled:opacity-50"
                                >
                                  <option value="">✏ Update status…</option>
                                  <option value="order-delay">⚠ Mark Delayed</option>
                                  <option value="out-for-delivery">🚚 Out for Delivery</option>
                                  <option value="rescheduled">📅 Rescheduled</option>
                                  <option value="delivered">✅ Delivered</option>
                                  <option value="cancelled">❌ Cancelled</option>
                                  <option value="returned">↩ Returned</option>
                                </select>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })()}

        </div>
      )}

      {/* Deliveries Tab */}
      {activeTab === 'deliveries' && (
        <DeliveryManagementPage />
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
                  className="w-full pl-9 pr-3 py-2 text-sm rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 border-0 focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
            </div>

            {/* Contact list */}
            <div className="flex-1 overflow-y-auto">
              {/* Team Members Section */}
              {teamMembers.length > 0 && (
                <>
                  <div className="px-4 pt-3 pb-1">
                    <span className="text-[10px] font-bold tracking-widest text-gray-400 dark:text-gray-500 uppercase">Team</span>
                  </div>
                  {teamMembers.map(member => {
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
              {drivers.length > 0 && (
                <>
                  <div className="px-4 pt-3 pb-1">
                    <span className="text-[10px] font-bold tracking-widest text-gray-400 dark:text-gray-500 uppercase">Drivers</span>
                  </div>
                  {drivers.map(driver => {
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

              {contacts.length === 0 && (
                <div className="flex flex-col items-center justify-center h-40 text-gray-400 dark:text-gray-500 text-sm gap-2 px-4 text-center">
                  <MessageSquare className="w-8 h-8 opacity-40" />
                  No contacts available
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
                      const currentUserRole = currentUser?.account?.role || currentUser?.role;
                      const msgAdminId = String(msg.adminId);
                      const userId = String(currentUserId);
                      const isSentByAdminId = msgAdminId === userId;
                      const isSentByRole = msg.senderRole === currentUserRole;
                      const isSent = currentUserRole === 'delivery_team' ? isSentByRole : isSentByAdminId;

                      if (messages.indexOf(msg) === 0) {
                        console.log('[DeliveryTeam Message Debug]', {
                          messageId: msg.id, adminId: msg.adminId, driverId: msg.driverId,
                          senderRole: msg.senderRole, currentUserId, currentUserRole,
                          isSentByAdminId, isSentByRole, isSent,
                          content: msg.content?.substring(0, 20)
                        });
                      }

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
