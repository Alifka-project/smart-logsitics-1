import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import api from '../frontend/apiClient';
import PaginationBar from '../components/common/PaginationBar';
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
  BarChart2,
  TrendingUp,
  FileText,
  Download
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  Cell, PieChart, Pie, CartesianGrid, Legend
} from 'recharts';
import DeliveryMap from '../components/MapView/DeliveryMap';
import DeliveryManagementPage from './DeliveryManagementPage';
import { calculateRoute, generateFallbackRoute } from '../services/advancedRoutingService';
import useDeliveryStore from '../store/useDeliveryStore';
import { deliveryToManageOrder } from '../utils/deliveryWorkflowMap';
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

interface AssignmentMessage {
  type: 'success' | 'error';
  text: string;
}

export default function DeliveryTeamPortal() {
  const [activeTab, setActiveTab] = useState<string>('operations');
  const [drivers, setDrivers] = useState<ContactUser[]>([]);
  const [contacts, setContacts] = useState<ContactUser[]>([]); // All contacts (drivers + team members)
  const [teamMembers, setTeamMembers] = useState<ContactUser[]>([]); // Admin + delivery_team
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [alerts, setAlerts] = useState<SystemAlert[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  
  // Control tab state
  const [assigningDelivery, setAssigningDelivery] = useState<string | null>(null);
  const [assignmentMessage, setAssignmentMessage] = useState<AssignmentMessage | null>(null);
  const [markingOFD, setMarkingOFD] = useState<string | null>(null);
  const [markingDelay, setMarkingDelay] = useState<string | null>(null);
  const [dispatchFilter, setDispatchFilter] = useState<'all' | 'overdue' | 'unassigned' | 'awaiting' | 'delay'>('all');
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

  // Reports & Analytics tab state
  interface DashTotals {
    total: number; delivered: number; cancelled: number; rescheduled: number;
    pending: number; returned?: number; withPOD: number; withoutPOD: number;
    customerAccepted: number; customerCancelled: number; customerRescheduled: number;
    [key: string]: number | undefined;
  }
  interface DashDelivery {
    id?: string; customer?: string | null; poNumber?: string | null; status?: string;
    created_at?: string | null; createdAt?: string | null; delivered_at?: string | null;
    deliveredAt?: string | null; address?: string; driverName?: string | null;
    assignedDriverId?: string | null; confirmationStatus?: string | null;
    confirmedDeliveryDate?: string | null; customerConfirmedAt?: string | null;
    confirmationToken?: string | null;
    [key: string]: unknown;
  }
  interface DashData { totals?: DashTotals; deliveries?: DashDelivery[]; generatedAt?: string; }
  const [dashData, setDashData] = useState<DashData | null>(null);
  const [reportsLoading, setReportsLoading] = useState(false);
  const [reportsPeriod, setReportsPeriod] = useState<'7d' | '30d' | '90d'>('90d');
  // POD table filters, sort & pagination (independent from top period filter)
  const [podSearch, setPodSearch] = useState('');
  const [podStatusFilter, setPodStatusFilter] = useState('all');
  const [podDriverFilter, setPodDriverFilter] = useState('all');
  const [podDateFrom, setPodDateFrom] = useState('');
  const [podDateTo, setPodDateTo] = useState('');
  const [podSortKey, setPodSortKey] = useState<string>('date');
  const [podSortDir, setPodSortDir] = useState<'asc' | 'desc'>('desc');
  const [podPage, setPodPage] = useState(1);
  const podTableRef = useRef<HTMLDivElement | null>(null);
  const POD_PAGE_SIZE = 20;

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

  // Must be declared before any useEffect that references it
  const loadReportsData = useCallback(async (force = false): Promise<void> => {
    if (dashData && !force) return;
    setReportsLoading(true);
    try {
      const res = await api.get('/admin/dashboard');
      setDashData(res.data as DashData);
    } catch (err) {
      console.error('[DeliveryTeam] Failed to load reports data:', err);
    } finally {
      setReportsLoading(false);
    }
  }, [dashData]);

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

  // Load reports data when reports tab is active
  useEffect(() => {
    if (activeTab === 'reports') {
      void loadReportsData();
    }
  }, [activeTab, loadReportsData]);

  // Reset page to 1 whenever table filters change
  useEffect(() => {
    setPodPage(1);
  }, [podSearch, podStatusFilter, podDriverFilter, podDateFrom, podDateTo, podSortKey, podSortDir]);

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
    'completed', 'pod-completed', 'cancelled', 'rescheduled', 'returned',
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

  // ─── Reports computed values ────────────────────────────────────────────────
  const DELIVERED_STATUSES = new Set(['delivered','delivered-with-installation','delivered-without-installation','completed','pod-completed','finished','done']);
  const CANCELLED_STATUSES = new Set(['cancelled','canceled','rejected']);

  const reportsDeliveries = useMemo((): DashDelivery[] => {
    const list = dashData?.deliveries ?? [];
    const now = Date.now();
    const msBack = reportsPeriod === '7d' ? 7 : reportsPeriod === '30d' ? 30 : 90;
    const cutoff = now - msBack * 86400000;
    return list.filter(d => {
      const t = new Date((d.created_at ?? d.createdAt ?? 0) as string).getTime();
      return t >= cutoff;
    });
  }, [dashData, reportsPeriod]);

  const reportsTotals = useMemo(() => {
    let total = 0, delivered = 0, cancelled = 0, rescheduled = 0, returned = 0, pending = 0, podCompleted = 0;
    for (const d of reportsDeliveries) {
      total++;
      const s = (d.status ?? '').toLowerCase();
      if (DELIVERED_STATUSES.has(s)) delivered++;
      if (CANCELLED_STATUSES.has(s)) cancelled++;
      if (s === 'rescheduled') rescheduled++;
      if (s === 'returned') returned++;
      if (s === 'pending' || s === 'uploaded') pending++;
      if (s === 'pod-completed') podCompleted++;
    }
    const successRate = total > 0 ? Math.round((delivered / total) * 100) : 0;
    return { total, delivered, cancelled, rescheduled, returned, pending, podCompleted, successRate };
  }, [reportsDeliveries]);

  const trendData = useMemo(() => {
    const days = reportsPeriod === '7d' ? 7 : reportsPeriod === '30d' ? 30 : 90;
    const buckets: Record<string, { date: string; delivered: number; cancelled: number; rescheduled: number; total: number }> = {};
    const now = new Date();
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const key = `${String(d.getMonth() + 1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`;
      buckets[key] = { date: key, delivered: 0, cancelled: 0, rescheduled: 0, total: 0 };
    }
    for (const d of reportsDeliveries) {
      const raw = d.delivered_at ?? d.deliveredAt ?? d.created_at ?? d.createdAt;
      if (!raw) continue;
      const dt = new Date(raw as string);
      const key = `${String(dt.getMonth() + 1).padStart(2,'0')}/${String(dt.getDate()).padStart(2,'0')}`;
      if (!buckets[key]) continue;
      buckets[key].total++;
      const s = (d.status ?? '').toLowerCase();
      if (DELIVERED_STATUSES.has(s)) buckets[key].delivered++;
      else if (CANCELLED_STATUSES.has(s)) buckets[key].cancelled++;
      else if (s === 'rescheduled') buckets[key].rescheduled++;
    }
    // For shorter ranges show every label; for 90d thin out labels
    return Object.values(buckets).map((b, i, arr) => ({
      ...b,
      date: days <= 30 || i % 5 === 0 || i === arr.length - 1 ? b.date : '',
    }));
  }, [reportsDeliveries, reportsPeriod]);

  const statusDistribution = useMemo(() => {
    const map: Record<string, number> = {};
    for (const d of reportsDeliveries) {
      const ws = deliveryToManageOrder(d as unknown as Delivery).status;
      const label =
        ws === 'delivered'         ? 'Delivered' :
        ws === 'out_for_delivery'  ? 'On Route' :
        ws === 'tomorrow_shipment' ? 'Tomorrow Shipment' :
        ws === 'next_shipment'     ? 'Next Shipment' :
        ws === 'future_shipment'   ? 'Future Shipment' :
        ws === 'order_delay'       ? 'Order Delay' :
        ws === 'sms_sent'          ? 'Awaiting Customer' :
        ws === 'unconfirmed'       ? 'No Response (24h+)' :
        ws === 'confirmed'         ? 'Confirmed' :
        ws === 'rescheduled'       ? 'Rescheduled' :
        ws === 'failed'            ? 'Failed / Returned' :
        ws === 'cancelled'         ? 'Cancelled' :
        ws === 'uploaded'          ? 'Pending' :
        'Other';
      map[label] = (map[label] ?? 0) + 1;
    }
    return Object.entries(map).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [reportsDeliveries]);

  const driverPerformance = useMemo(() => {
    const map: Record<string, { name: string; assigned: number; delivered: number; cancelled: number; podCompleted: number }> = {};
    for (const d of reportsDeliveries) {
      const id = (d.assignedDriverId as string) ?? '';
      const name = (d.driverName as string) ?? (id ? `Driver ${id.slice(0,6)}` : 'Unassigned');
      if (!id) continue;
      if (!map[id]) map[id] = { name, assigned: 0, delivered: 0, cancelled: 0, podCompleted: 0 };
      map[id].assigned++;
      const s = (d.status ?? '').toLowerCase();
      if (DELIVERED_STATUSES.has(s)) map[id].delivered++;
      if (CANCELLED_STATUSES.has(s)) map[id].cancelled++;
      if (s === 'pod-completed') map[id].podCompleted++;
    }
    return Object.values(map)
      .map(r => ({ ...r, successRate: r.assigned > 0 ? Math.round((r.delivered / r.assigned) * 100) : 0 }))
      .sort((a, b) => b.assigned - a.assigned);
  }, [reportsDeliveries]);

  // Extract PNC / Model ID / item description from delivery metadata (same fields as adminDashboard.ts)
  const extractItemMeta = useCallback((d: DashDelivery): { pnc: string; modelId: string; description: string } => {
    const meta = (d.metadata as Record<string, unknown>) ?? {};
    const orig = ((meta.originalRow ?? meta._originalRow ?? {}) as Record<string, unknown>);
    const pnc = String(orig['Material'] ?? orig['material'] ?? orig['Material Number'] ?? orig['PNC'] ?? orig['pnc'] ?? '').trim();
    const modelId = String(orig['MODEL ID'] ?? orig['Model ID'] ?? orig['model_id'] ?? orig['ModelID'] ?? orig['Model'] ?? orig['model'] ?? '').trim();
    const description = String(orig['Description'] ?? orig['description'] ?? d.items ?? meta['items'] ?? '').trim();
    return { pnc: pnc || '—', modelId: modelId || '—', description: description || '—' };
  }, []);

  // Raw full list — NOT filtered by the top period selector
  const allDashDeliveries = useMemo((): DashDelivery[] => dashData?.deliveries ?? [], [dashData]);

  // Enrich each dashboard delivery with its derived workflow status (same logic as ManageTab)
  const allDashWithWorkflow = useMemo(() =>
    allDashDeliveries.map(d => ({
      d,
      ws: deliveryToManageOrder(d as unknown as Delivery).status,
    })),
  [allDashDeliveries]);

  // Unique driver names for filter dropdown (from full list)
  const podDriverOptions = useMemo(() => {
    const names = new Set<string>();
    for (const d of allDashDeliveries) {
      if (d.driverName) names.add(d.driverName as string);
    }
    return Array.from(names).sort();
  }, [allDashDeliveries]);

  // Table deliveries — independent filters + sort, never affected by top period
  // Returns { d, ws } pairs so row renderer can use workflow status for labels/colors
  const podDeliveries = useMemo((): { d: DashDelivery; ws: string }[] => {
    const q = podSearch.toLowerCase().trim();
    const fromTs = podDateFrom ? new Date(podDateFrom + 'T00:00:00').getTime() : null;
    const toTs   = podDateTo   ? new Date(podDateTo   + 'T23:59:59').getTime() : null;

    const filtered = allDashWithWorkflow.filter(({ d, ws }) => {
      // Filter by workflow status (covers all derived statuses including tomorrow_shipment, order_delay, etc.)
      if (podStatusFilter !== 'all' && ws !== podStatusFilter) return false;
      if (podDriverFilter !== 'all' && (d.driverName as string | undefined) !== podDriverFilter) return false;
      // Date range (uses created_at as the reference date)
      if (fromTs !== null || toTs !== null) {
        const t = new Date((d.created_at ?? d.createdAt ?? 0) as string).getTime();
        if (fromTs !== null && t < fromTs) return false;
        if (toTs   !== null && t > toTs)   return false;
      }
      if (q) {
        const { pnc, modelId, description } = extractItemMeta(d);
        const haystack = [d.poNumber, d.id, d.customer, d.address, d.driverName, pnc, modelId, description]
          .map(v => String(v ?? '').toLowerCase()).join(' ');
        if (!haystack.includes(q)) return false;
      }
      return true;
    });

    // Sort
    filtered.sort((a, b) => {
      const ad = a.d; const bd = b.d;
      if (podSortKey === 'date') {
        const ta = new Date((ad.created_at ?? ad.createdAt ?? 0) as string).getTime();
        const tb = new Date((bd.created_at ?? bd.createdAt ?? 0) as string).getTime();
        return podSortDir === 'asc' ? ta - tb : tb - ta;
      }
      let va = '', vb = '';
      if (podSortKey === 'poNumber')  { va = String(ad.poNumber ?? '');  vb = String(bd.poNumber ?? ''); }
      if (podSortKey === 'customer')  { va = String(ad.customer ?? '');  vb = String(bd.customer ?? ''); }
      if (podSortKey === 'driver')    { va = String(ad.driverName ?? '');vb = String(bd.driverName ?? ''); }
      if (podSortKey === 'status')    { va = a.ws;                       vb = b.ws; }
      if (podSortKey === 'address')   { va = String(ad.address ?? '');   vb = String(bd.address ?? ''); }
      if (podSortKey === 'pnc')       { va = extractItemMeta(ad).pnc;   vb = extractItemMeta(bd).pnc; }
      if (podSortKey === 'modelId')   { va = extractItemMeta(ad).modelId; vb = extractItemMeta(bd).modelId; }
      if (podSortKey === 'description'){ va = extractItemMeta(ad).description; vb = extractItemMeta(bd).description; }
      const cmp = va.localeCompare(vb, undefined, { sensitivity: 'base' });
      return podSortDir === 'asc' ? cmp : -cmp;
    });

    return filtered;
  }, [allDashWithWorkflow, podSearch, podStatusFilter, podDriverFilter, podDateFrom, podDateTo, podSortKey, podSortDir, extractItemMeta]);

  const CHART_COLORS = { delivered: '#22c55e', cancelled: '#ef4444', rescheduled: '#f59e0b', returned: '#8b5cf6', pending: '#94a3b8' };
  const PIE_PALETTE = ['#22c55e','#ef4444','#f59e0b','#3b82f6','#8b5cf6','#94a3b8','#06b6d4'];
  const TOOLTIP_STYLE = {
    wrapperStyle: { zIndex: 9999 },
    contentStyle: { background: 'var(--chart-tooltip-bg, #fff)', border: '1px solid var(--chart-tooltip-border, #e5e7eb)', borderRadius: '12px', fontSize: '13px', color: 'var(--chart-tooltip-fg, #111)', padding: '10px 14px', minWidth: '130px', boxShadow: '0 8px 24px -4px rgba(0,0,0,0.18)' },
    labelStyle: { fontWeight: 600, marginBottom: '4px' },
    itemStyle: { fontSize: '13px', padding: '2px 0' },
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
    <div className="space-y-4 md:space-y-6 w-full min-w-0">
      {/* Header - responsive and touch-friendly */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl sm:text-3xl font-bold text-gray-900 dark:text-gray-100">Delivery Team Portal</h1>
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
            { id: 'reports', label: 'Reports & Analytics', icon: BarChart2 },
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

          {/* ── Two-Column Main: Left=Map+Drivers  Right=Dispatch Table (50/50) ── */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 md:gap-6 items-start">

            {/* ── LEFT COLUMN: Live Map + Driver Status + Alerts ── */}
            <div className="space-y-4">
              {/* Live Map */}
              <div className="pp-card overflow-hidden">
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
                  mapClassName="h-[260px] md:h-[320px]"
                />
              </div>

              {/* Driver Status */}
              <div className="pp-card p-4">
                <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3 flex items-center gap-2">
                  <Users className="w-4 h-4 text-indigo-500" /> Driver Status
                </h2>
                {drivers.length === 0 ? (
                  <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-4">No drivers available</p>
                ) : (
                  <div className="space-y-2">
                    {drivers.map(driver => {
                      const isOnline = isContactOnline(driver);
                      const loc = driver.tracking?.location;
                      return (
                        <div key={driver.id} className="flex items-center justify-between p-3 rounded-lg border border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-750">
                          <div className="flex items-center gap-2 min-w-0">
                            <div className={`w-2 h-2 rounded-full flex-shrink-0 ${isOnline ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'}`} />
                            <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                              {driver.fullName || driver.username}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 shrink-0">
                            {loc && <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />GPS</span>}
                            <span className={isOnline ? 'text-green-600 dark:text-green-400 font-medium' : ''}>
                              {isOnline ? 'Online' : 'Offline'}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Alerts */}
              {alerts.length > 0 && (
                <div className="pp-card p-4">
                  <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3 flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 text-amber-500" /> Alerts
                    <span className="ml-auto px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 text-xs font-bold">{alerts.length}</span>
                  </h2>
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {alerts.slice(0, 8).map(alert => (
                      <div key={alert.id} className="flex items-start gap-2 p-2.5 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
                        <AlertCircle className="w-4 h-4 text-yellow-600 dark:text-yellow-400 flex-shrink-0 mt-0.5" />
                        <div className="min-w-0">
                          <p className="text-xs text-gray-900 dark:text-gray-100">
                            <span className="font-medium">{alert.driver || alert.delivery}:</span> {alert.message}
                          </p>
                          <p className="text-xs text-gray-400 dark:text-gray-500">{formatMessageTimestamp(alert.timestamp)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* ── RIGHT COLUMN: Dispatch Control Table ── */}
            <div id="dispatch-table" ref={dispatchTableRef} className="pp-card overflow-hidden">
              <div className="p-4 bg-gray-50 dark:bg-gray-700 border-b dark:border-gray-600 flex items-center justify-between gap-2">
                <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                  <Truck className="w-4 h-4 text-blue-500" /> Assign & Dispatch
                </h2>
                <div className="flex items-center gap-2">
                  {dispatchFilter !== 'all' && (
                    <button
                      type="button"
                      onClick={() => setDispatchFilter('all')}
                      className="flex items-center gap-1 text-xs px-2 py-1 rounded-md bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-900/50 transition-colors"
                    >
                      <span>Filtered: {dispatchFilter}</span>
                      <span className="font-bold">×</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void loadData()}
                    className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                  >
                    <RefreshCw className="w-3.5 h-3.5" /> Refresh
                  </button>
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

              {/* Legend */}
              <div className="px-4 pt-3 pb-1 flex items-center gap-3 flex-wrap border-b border-gray-100 dark:border-gray-700">
                <span className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide">Legend:</span>
                <span className="flex items-center gap-1 text-[10px] text-blue-700 dark:text-blue-300"><span className="w-2 h-2 rounded-full bg-blue-500 inline-block" />On Route</span>
                <span className="flex items-center gap-1 text-[10px] text-red-700 dark:text-red-300"><span className="w-2 h-2 rounded-full bg-red-400 inline-block" />Delayed</span>
                <span className="flex items-center gap-1 text-[10px] text-amber-700 dark:text-amber-300"><span className="w-2 h-2 rounded-full bg-amber-400 inline-block" />Ready to Dispatch</span>
                <span className="flex items-center gap-1 text-[10px] text-gray-500 dark:text-gray-400"><span className="w-2 h-2 rounded-full bg-gray-300 dark:bg-gray-600 inline-block" />Unassigned</span>
                <span className="ml-auto text-[10px] text-gray-400 dark:text-gray-500">Sorted: On Route → Delayed → Assigned → Unassigned (grouped by driver)</span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full divide-y divide-gray-200 dark:divide-gray-700" style={{ minWidth: '680px' }}>
                  <thead className="bg-gray-50 dark:bg-gray-700/80 sticky top-0 z-10">
                    <tr>
                      <th className="pl-4 pr-2 py-2.5 text-left text-[10px] font-semibold text-gray-500 dark:text-gray-300 uppercase tracking-wider w-5">·</th>
                      <th className="px-3 py-2.5 text-left text-[10px] font-semibold text-gray-500 dark:text-gray-300 uppercase tracking-wider" style={{ width: '22%' }}>Driver</th>
                      <th className="px-3 py-2.5 text-left text-[10px] font-semibold text-gray-500 dark:text-gray-300 uppercase tracking-wider" style={{ width: '18%' }}>Customer</th>
                      <th className="px-3 py-2.5 text-left text-[10px] font-semibold text-gray-500 dark:text-gray-300 uppercase tracking-wider" style={{ width: '20%' }}>Address</th>
                      <th className="px-3 py-2.5 text-left text-[10px] font-semibold text-gray-500 dark:text-gray-300 uppercase tracking-wider" style={{ width: '15%' }}>Status</th>
                      <th className="px-3 py-2.5 text-left text-[10px] font-semibold text-gray-500 dark:text-gray-300 uppercase tracking-wider" style={{ width: '10%' }}>PO / Del#</th>
                      <th className="px-3 py-2.5 text-left text-[10px] font-semibold text-gray-500 dark:text-gray-300 uppercase tracking-wider" style={{ width: '15%' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-100 dark:divide-gray-700/60">
                    {deliveries && deliveries.length > 0 ? (() => {
                      // Status priority for sort: OFD first, then delay, then assigned, then unassigned
                      const statusPriority = (s: string) => {
                        if (s === 'out-for-delivery') return 0;
                        if (s === 'order-delay')      return 1;
                        return 2;
                      };

                      const sorted = deliveries
                        .filter(delivery => !TERMINAL_STATUSES.has((delivery.status || '').toLowerCase()))
                        .filter(delivery => {
                          if (dispatchFilter === 'all') return true;
                          const s = (delivery.status || '').toLowerCase();
                          const dt = delivery as unknown as { tracking?: { driverId?: string } };
                          const dayAgo = new Date(Date.now() - 86400000);
                          if (dispatchFilter === 'overdue') return ['pending', 'scheduled'].includes(s) && new Date((delivery.created_at || delivery.createdAt || delivery.created || 0) as string | number) < dayAgo;
                          if (dispatchFilter === 'unassigned') return ['pending', 'scheduled'].includes(s) && !delivery.assignedDriverId && !dt.tracking?.driverId;
                          if (dispatchFilter === 'awaiting') { const conf = String(delivery.confirmationStatus || '').toLowerCase(); return conf === 'pending' && !TERMINAL_STATUSES.has(s); }
                          if (dispatchFilter === 'delay') return s === 'order-delay';
                          return true;
                        })
                        .sort((a, b) => {
                          const aS = (a.status || '').toLowerCase();
                          const bS = (b.status || '').toLowerCase();
                          const aPrio = statusPriority(aS);
                          const bPrio = statusPriority(bS);
                          if (aPrio !== bPrio) return aPrio - bPrio;

                          // Within same priority: group by driver (assigned before unassigned, then alphabetical)
                          const aDriverId = (a as unknown as { tracking?: { driverId?: string } }).tracking?.driverId || a.assignedDriverId || '';
                          const bDriverId = (b as unknown as { tracking?: { driverId?: string } }).tracking?.driverId || b.assignedDriverId || '';
                          if (aDriverId && !bDriverId) return -1;
                          if (!aDriverId && bDriverId) return 1;
                          const aName = drivers.find(d => d.id === aDriverId)?.fullName || aDriverId;
                          const bName = drivers.find(d => d.id === bDriverId)?.fullName || bDriverId;
                          return aName.localeCompare(bName);
                        });

                      let lastDriverId = '__init__';

                      return sorted.map(delivery => {
                        const dWithTracking = delivery as unknown as { tracking?: { driverId?: string } };
                        const currentDriverId = dWithTracking.tracking?.driverId || delivery.assignedDriverId;
                        const currentDriver = drivers.find(d => d.id === currentDriverId);
                        const rawStatus = (delivery.status || '').toLowerCase();
                        const { label: statusLabel, color: statusColor } = getDeliveryStatusBadge(delivery);
                        const isOFD = rawStatus === 'out-for-delivery';
                        const isDelay = rawStatus === 'order-delay';
                        const isDispatchable = ['pending', 'scheduled', 'uploaded', 'confirmed', 'scheduled-confirmed'].includes(rawStatus);
                        const isOnline = currentDriver ? isContactOnline(currentDriver) : false;

                        // Driver group separator
                        const driverGroupId = currentDriverId || '__unassigned__';
                        const showDriverSeparator = driverGroupId !== lastDriverId && lastDriverId !== '__init__';
                        lastDriverId = driverGroupId;

                        // Row accent color
                        const rowBg = isOFD
                          ? 'bg-blue-50/60 dark:bg-blue-900/10 border-l-[3px] border-l-blue-500'
                          : isDelay
                          ? 'bg-red-50/60 dark:bg-red-900/10 border-l-[3px] border-l-red-400'
                          : currentDriverId
                          ? 'bg-amber-50/40 dark:bg-amber-900/5 border-l-[3px] border-l-amber-400'
                          : 'border-l-[3px] border-l-transparent';

                        return (
                          <React.Fragment key={delivery.id}>
                            {showDriverSeparator && (
                              <tr>
                                <td colSpan={7} className="h-px bg-gray-200 dark:bg-gray-600 p-0" />
                              </tr>
                            )}
                            <tr className={`${rowBg} hover:brightness-95 dark:hover:brightness-110 transition-all`}>
                              {/* Status dot */}
                              <td className="pl-3 pr-1 py-3">
                                <span className={`block w-2 h-2 rounded-full flex-shrink-0 ${
                                  isOFD ? 'bg-blue-500 shadow-[0_0_6px_rgba(59,130,246,0.7)]' :
                                  isDelay ? 'bg-red-400' :
                                  currentDriverId ? 'bg-amber-400' : 'bg-gray-300 dark:bg-gray-600'
                                }`} />
                              </td>
                              {/* Driver */}
                              <td className="px-3 py-2.5">
                                {currentDriver ? (
                                  <div className="flex items-center gap-1.5 mb-1.5">
                                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isOnline ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'}`} />
                                    <span className="text-xs font-semibold text-gray-900 dark:text-gray-100 truncate">{currentDriver.fullName || currentDriver.username}</span>
                                  </div>
                                ) : (
                                  <div className="text-[10px] text-amber-600 dark:text-amber-400 font-medium mb-1.5">⚠ No driver</div>
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
                                    } catch {
                                      setAssignmentMessage({ type: 'error', text: 'Failed to assign delivery' });
                                    } finally {
                                      setAssigningDelivery(null);
                                    }
                                  }}
                                  disabled={assigningDelivery === delivery.id}
                                  className="w-full px-2 py-1 border border-gray-200 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-xs text-gray-700 dark:text-gray-200 disabled:opacity-50"
                                >
                                  {!currentDriverId && <option value="">— Assign driver —</option>}
                                  {drivers.map(driver => (
                                    <option key={driver.id} value={driver.id}>
                                      {driver.fullName || driver.username}
                                    </option>
                                  ))}
                                </select>
                              </td>
                              {/* Customer */}
                              <td className="px-3 py-2.5">
                                <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{delivery.customer || 'Unknown'}</div>
                                {delivery.phone && <div className="text-[10px] text-gray-400 dark:text-gray-500 truncate">{delivery.phone}</div>}
                              </td>
                              {/* Address */}
                              <td className="px-3 py-2.5">
                                <div className="text-xs text-gray-600 dark:text-gray-300 truncate" title={delivery.address || ''}>{delivery.address || '—'}</div>
                              </td>
                              {/* Status */}
                              <td className="px-3 py-2.5">
                                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap ${statusColor}`}>
                                  {statusLabel}
                                </span>
                              </td>
                              {/* PO / Del# */}
                              <td className="px-3 py-2.5">
                                <div className="text-xs font-medium text-gray-700 dark:text-gray-300 truncate">{delivery.poNumber || '—'}</div>
                                <div className="text-[10px] text-gray-400 dark:text-gray-500 truncate">
                                  {(delivery as unknown as { metadata?: { originalDeliveryNumber?: string } }).metadata?.originalDeliveryNumber || ''}
                                </div>
                              </td>
                              {/* Actions */}
                              <td className="px-3 py-2.5">
                                <div className="flex flex-col gap-1">
                                  {isDispatchable && (
                                    <button
                                      type="button"
                                      disabled={markingOFD === delivery.id || markingDelay === delivery.id}
                                      onClick={async () => {
                                        setMarkingOFD(delivery.id);
                                        try {
                                          await api.put(`/deliveries/admin/${delivery.id}/status`, { status: 'out-for-delivery', customer: delivery.customer, address: delivery.address });
                                          setAssignmentMessage({ type: 'success', text: `✓ ${delivery.customer || 'Delivery'} dispatched` });
                                          setTimeout(() => { void loadData(); setAssignmentMessage(null); }, 2000);
                                        } catch {
                                          setAssignmentMessage({ type: 'error', text: 'Failed to dispatch' });
                                        } finally { setMarkingOFD(null); }
                                      }}
                                      className="inline-flex items-center justify-center gap-1 px-2.5 py-1.5 rounded text-[11px] font-semibold bg-green-600 hover:bg-green-700 text-white disabled:opacity-60 whitespace-nowrap"
                                    >
                                      {markingOFD === delivery.id ? '…' : '🚚 Dispatch'}
                                    </button>
                                  )}
                                  {isDispatchable && (
                                    <button
                                      type="button"
                                      disabled={markingDelay === delivery.id || markingOFD === delivery.id}
                                      onClick={async () => {
                                        setMarkingDelay(delivery.id);
                                        try {
                                          await api.put(`/deliveries/admin/${delivery.id}/status`, { status: 'order-delay', customer: delivery.customer, address: delivery.address });
                                          setAssignmentMessage({ type: 'success', text: `⚠ ${delivery.customer || 'Order'} marked delayed` });
                                          setTimeout(() => { void loadData(); setAssignmentMessage(null); }, 2500);
                                        } catch {
                                          setAssignmentMessage({ type: 'error', text: 'Failed to mark delay' });
                                        } finally { setMarkingDelay(null); }
                                      }}
                                      className="inline-flex items-center justify-center gap-1 px-2.5 py-1.5 rounded text-[11px] font-semibold bg-red-50 hover:bg-red-100 dark:bg-red-900/30 dark:hover:bg-red-900/50 text-red-700 dark:text-red-300 disabled:opacity-60 whitespace-nowrap"
                                    >
                                      {markingDelay === delivery.id ? '…' : '⚠ Delay'}
                                    </button>
                                  )}
                                  {isOFD && (
                                    <span className="inline-flex items-center justify-center gap-1 px-2 py-1 rounded text-[11px] font-semibold bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 whitespace-nowrap">
                                      🚛 On Route
                                    </span>
                                  )}
                                  {isDelay && (
                                    <span className="inline-flex items-center justify-center gap-1 px-2 py-1 rounded text-[11px] font-semibold bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 whitespace-nowrap">
                                      ⚠ Delayed
                                    </span>
                                  )}
                                </div>
                              </td>
                            </tr>
                          </React.Fragment>
                        );
                      });
                    })() : (
                      <tr>
                        <td colSpan={7} className="px-4 py-8 text-center text-gray-500 dark:text-gray-400">
                          No active deliveries
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

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

      {/* ── Reports & Analytics Tab ─────────────────────────────────────── */}
      {activeTab === 'reports' && (
        <div className="space-y-6">
          {/* Header row */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                <BarChart2 className="w-6 h-6 text-blue-600 dark:text-blue-400" />
                Reports &amp; Analytics
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                Delivery performance, success rates, and POD records
              </p>
            </div>
            <button
              onClick={() => void loadReportsData(true)}
              disabled={reportsLoading}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${reportsLoading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>

          {reportsLoading && !dashData ? (
            <div className="flex items-center justify-center py-20">
              <div className="text-center">
                <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600 mx-auto mb-3" />
                <p className="text-gray-500 dark:text-gray-400 text-sm">Loading analytics…</p>
              </div>
            </div>
          ) : (
            <>
              {/* KPI Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                {[
                  { label: 'Total Orders', value: reportsTotals.total, icon: Package, color: 'blue' },
                  { label: 'Delivered', value: reportsTotals.delivered, icon: CheckCircle, color: 'green' },
                  { label: 'Success Rate', value: `${reportsTotals.successRate}%`, icon: TrendingUp, color: 'emerald' },
                  { label: 'Cancelled', value: reportsTotals.cancelled, icon: XCircle, color: 'red' },
                  { label: 'Rescheduled', value: reportsTotals.rescheduled, icon: Clock, color: 'amber' },
                  { label: 'POD Completed', value: reportsTotals.podCompleted, icon: FileText, color: 'purple' },
                ].map(({ label, value, icon: Icon, color }) => {
                  const colorMap: Record<string, string> = {
                    blue: 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20',
                    green: 'text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20',
                    emerald: 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20',
                    red: 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20',
                    amber: 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20',
                    purple: 'text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/20',
                  };
                  return (
                    <div key={label} className="pp-card p-4">
                      <div className={`inline-flex p-2 rounded-lg mb-2 ${colorMap[color]}`}>
                        <Icon className="w-4 h-4" />
                      </div>
                      <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{value}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{label}</p>
                    </div>
                  );
                })}
              </div>

              {/* ── Delivery Report Table (moved above charts) ─────────────── */}
              {(() => {
                const totalPages = Math.max(1, Math.ceil(podDeliveries.length / POD_PAGE_SIZE));
                const safePage = Math.min(podPage, totalPages);
                const pageRows = podDeliveries.slice((safePage - 1) * POD_PAGE_SIZE, safePage * POD_PAGE_SIZE);
                const goToPage = (p: number) => {
                  setPodPage(p);
                  requestAnimationFrame(() => {
                    podTableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  });
                };
                // page window: always show max 5 page buttons
                const pageNums: number[] = [];
                const half = 2;
                let start = Math.max(1, safePage - half);
                let end = Math.min(totalPages, start + 4);
                if (end - start < 4) start = Math.max(1, end - 4);
                for (let i = start; i <= end; i++) pageNums.push(i);

                return (
                  <div className="pp-card p-5" ref={podTableRef}>
                    {/* Header */}
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
                      <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                        <FileText className="w-5 h-5 text-purple-500" />
                        Delivery Report
                        <span className="ml-1 px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 text-xs font-normal">
                          {podDeliveries.length} / {allDashDeliveries.length} records
                        </span>
                      </h3>
                      <div className="flex items-center gap-2 flex-wrap">
                        <button
                          onClick={() => {
                            const header = 'No,Delivery ID,PO Number,Customer,Address,PNC (Material),Model ID,Description,Driver,Date,Status\n';
                            const rows = podDeliveries.map(({ d, ws }, i) => {
                              const { pnc, modelId, description } = extractItemMeta(d);
                              const dateRaw = d.delivered_at ?? d.deliveredAt ?? d.created_at ?? d.createdAt ?? '';
                              const dateStr = dateRaw ? new Date(dateRaw as string).toLocaleDateString('en-GB') : '';
                              return [i + 1, d.id ?? '', d.poNumber ?? '', d.customer ?? '', d.address ?? '', pnc, modelId, description, d.driverName ?? 'Unassigned', dateStr, ws].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',');
                            }).join('\n');
                            const blob = new Blob(['\uFEFF' + header + rows], { type: 'text/csv;charset=utf-8' });
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url; a.download = `delivery-report-${new Date().toISOString().slice(0,10)}.csv`; a.click();
                            URL.revokeObjectURL(url);
                          }}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-gray-200 dark:border-gray-700 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                        >
                          <Download className="w-4 h-4" />
                          Export CSV
                        </button>
                        <button
                          onClick={() => {
                            const token = localStorage.getItem('auth_token') ?? '';
                            const clientKey = localStorage.getItem('client_key') ?? '';
                            const base = (import.meta.env.VITE_API_URL as string | undefined) ?? '';
                            void fetch(`${base}/api/admin/reports/pod?format=html`, {
                              headers: { 'Authorization': token ? `Bearer ${token}` : '', 'X-Client-Key': clientKey },
                            }).then(async (res) => {
                              if (!res.ok) throw new Error('Failed');
                              const blob = await res.blob();
                              const url = window.URL.createObjectURL(blob);
                              const a = document.createElement('a');
                              a.href = url; a.download = `pod-report-${new Date().toISOString().slice(0,10)}.html`;
                              document.body.appendChild(a); a.click();
                              window.URL.revokeObjectURL(url); document.body.removeChild(a);
                            }).catch(() => alert('Failed to download POD report'));
                          }}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-sm font-medium transition-colors"
                        >
                          <FileText className="w-4 h-4" />
                          Download POD Report
                        </button>
                      </div>
                    </div>

                    {/* Summary chips — always based on full dataset (independent of chart period) */}
                    <div className="flex flex-wrap gap-2 mb-4">
                      {[
                        { label: 'Total', value: allDashWithWorkflow.length, color: 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300' },
                        { label: 'Tomorrow Shipment', value: allDashWithWorkflow.filter(({ ws }) => ws === 'tomorrow_shipment').length, color: 'bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300' },
                        { label: 'On Route', value: allDashWithWorkflow.filter(({ ws }) => ws === 'out_for_delivery').length, color: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300' },
                        { label: 'Order Delay', value: allDashWithWorkflow.filter(({ ws }) => ws === 'order_delay').length, color: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300' },
                        { label: 'Delivered', value: allDashWithWorkflow.filter(({ ws }) => ws === 'delivered').length, color: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300' },
                        { label: 'Cancelled', value: allDashWithWorkflow.filter(({ ws }) => ws === 'cancelled').length, color: 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400' },
                        { label: 'Failed / Returned', value: allDashWithWorkflow.filter(({ ws }) => ws === 'failed').length, color: 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300' },
                      ].map(({ label, value, color }) => (
                        <span key={label} className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium ${color}`}>
                          <span className="font-bold text-sm">{value}</span> {label}
                        </span>
                      ))}
                    </div>

                    {/* Filters — single compact row */}
                    <div className="flex flex-wrap items-center gap-2 mb-4">
                      {/* Search */}
                      <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 flex-1 min-w-[160px]">
                        <Search className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                        <input type="text" value={podSearch} onChange={e => setPodSearch(e.target.value)}
                          placeholder="Search PO#, customer, PNC…"
                          className="flex-1 bg-transparent text-xs text-gray-900 dark:text-gray-100 placeholder-gray-400 outline-none min-w-0" />
                        {podSearch && <button onClick={() => setPodSearch('')} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-[10px] flex-shrink-0">✕</button>}
                      </div>
                      {/* Date from */}
                      <input type="date" value={podDateFrom} onChange={e => setPodDateFrom(e.target.value)}
                        title="From date"
                        className="px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs text-gray-700 dark:text-gray-300 outline-none focus:ring-2 focus:ring-blue-500 w-[130px]" />
                      {/* Date to */}
                      <input type="date" value={podDateTo} onChange={e => setPodDateTo(e.target.value)}
                        title="To date"
                        className="px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs text-gray-700 dark:text-gray-300 outline-none focus:ring-2 focus:ring-blue-500 w-[130px]" />
                      {/* Status */}
                      <select value={podStatusFilter} onChange={e => setPodStatusFilter(e.target.value)}
                        className="px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs text-gray-700 dark:text-gray-300 outline-none focus:ring-2 focus:ring-blue-500">
                        <option value="all">All Statuses</option>
                        <option value="out_for_delivery">On Route (Out for Delivery)</option>
                        <option value="tomorrow_shipment">Tomorrow Shipment</option>
                        <option value="next_shipment">Next Shipment</option>
                        <option value="future_shipment">Future Shipment</option>
                        <option value="order_delay">Order Delay</option>
                        <option value="sms_sent">Awaiting Customer (SMS Sent)</option>
                        <option value="unconfirmed">No Response (24h+)</option>
                        <option value="uploaded">Pending Order</option>
                        <option value="confirmed">Customer Confirmed</option>
                        <option value="rescheduled">Rescheduled</option>
                        <option value="delivered">Delivered</option>
                        <option value="failed">Failed / Returned</option>
                        <option value="cancelled">Cancelled</option>
                      </select>
                      {/* Driver */}
                      <select value={podDriverFilter} onChange={e => setPodDriverFilter(e.target.value)}
                        className="px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs text-gray-700 dark:text-gray-300 outline-none focus:ring-2 focus:ring-blue-500">
                        <option value="all">All Drivers</option>
                        {podDriverOptions.map(name => <option key={name} value={name}>{name}</option>)}
                      </select>
                      {/* Clear */}
                      {(podSearch || podStatusFilter !== 'all' || podDriverFilter !== 'all' || podDateFrom || podDateTo) && (
                        <button onClick={() => { setPodSearch(''); setPodStatusFilter('all'); setPodDriverFilter('all'); setPodDateFrom(''); setPodDateTo(''); }}
                          className="px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-xs text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors whitespace-nowrap">
                          Clear all
                        </button>
                      )}
                    </div>

                    {podDeliveries.length === 0 ? (
                      <p className="text-sm text-gray-400 dark:text-gray-500 py-8 text-center">No deliveries match the current filters</p>
                    ) : (
                      <>
                        <div className="overflow-x-auto rounded-lg border border-gray-100 dark:border-gray-800">
                          <table className="w-full text-sm min-w-[900px]">
                            <thead className="bg-gray-50 dark:bg-gray-800/95">
                              <tr className="border-b border-gray-200 dark:border-gray-700">
                                <th className="text-left py-2.5 px-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider w-8">#</th>
                                {([
                                  { key: 'poNumber',     label: 'Delivery No.',    cls: 'whitespace-nowrap' },
                                  { key: 'customer',     label: 'Customer',         cls: '' },
                                  { key: 'pnc',          label: 'PNC (Material)',   cls: 'whitespace-nowrap' },
                                  { key: 'modelId',      label: 'Model ID',         cls: 'whitespace-nowrap' },
                                  { key: 'description',  label: 'Description',      cls: 'hidden lg:table-cell' },
                                  { key: 'address',      label: 'Address',          cls: 'hidden md:table-cell' },
                                  { key: 'driver',       label: 'Driver',           cls: '' },
                                  { key: 'date',         label: 'Date',             cls: 'whitespace-nowrap' },
                                  { key: 'status',       label: 'Status',           cls: '' },
                                ] as { key: string; label: string; cls: string }[]).map(col => (
                                  <th
                                    key={col.key}
                                    onClick={() => {
                                      if (podSortKey === col.key) {
                                        setPodSortDir(d => d === 'asc' ? 'desc' : 'asc');
                                      } else {
                                        setPodSortKey(col.key);
                                        setPodSortDir('asc');
                                      }
                                    }}
                                    className={`text-left py-2.5 px-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer select-none hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700/50 transition-colors ${col.cls}`}
                                  >
                                    <span className="inline-flex items-center gap-1">
                                      {col.label}
                                      <span className="text-[10px] leading-none">
                                        {podSortKey === col.key ? (podSortDir === 'asc' ? '▲' : '▼') : '⇅'}
                                      </span>
                                    </span>
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                              {pageRows.map(({ d, ws }, idx) => {
                                const globalIdx = (safePage - 1) * POD_PAGE_SIZE + idx;
                                const { pnc, modelId, description } = extractItemMeta(d);
                                const dateRaw = d.delivered_at ?? d.deliveredAt ?? d.created_at ?? d.createdAt;
                                const formattedDate = dateRaw ? new Date(dateRaw as string).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }) : '—';
                                const statusLabel =
                                  ws === 'out_for_delivery'  ? 'On Route' :
                                  ws === 'tomorrow_shipment' ? 'Tomorrow Shipment' :
                                  ws === 'next_shipment'     ? 'Next Shipment' :
                                  ws === 'future_shipment'   ? 'Future Shipment' :
                                  ws === 'order_delay'       ? 'Order Delay' :
                                  ws === 'sms_sent'          ? 'Awaiting Customer' :
                                  ws === 'unconfirmed'       ? 'No Response (24h+)' :
                                  ws === 'uploaded'          ? 'Pending Order' :
                                  ws === 'confirmed'         ? 'Customer Confirmed' :
                                  ws === 'rescheduled'       ? 'Rescheduled' :
                                  ws === 'delivered'         ? 'Delivered' :
                                  ws === 'failed'            ? 'Failed / Returned' :
                                  ws === 'cancelled'         ? 'Cancelled' :
                                  ws;
                                const statusColor =
                                  ws === 'out_for_delivery'  ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300' :
                                  ws === 'tomorrow_shipment' ? 'bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300' :
                                  ws === 'next_shipment'     ? 'bg-cyan-100 dark:bg-cyan-900/30 text-cyan-700 dark:text-cyan-300' :
                                  ws === 'future_shipment'   ? 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300' :
                                  ws === 'order_delay'       ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300' :
                                  ws === 'sms_sent'          ? 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300' :
                                  ws === 'unconfirmed'       ? 'bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300' :
                                  ws === 'confirmed'         ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300' :
                                  ws === 'rescheduled'       ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300' :
                                  ws === 'delivered'         ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300' :
                                  ws === 'failed'            ? 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300' :
                                  ws === 'cancelled'         ? 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400' :
                                  'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400';
                                return (
                                  <tr key={String(d.id ?? idx)} className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                                    <td className="py-2.5 px-3 text-xs text-gray-400 dark:text-gray-500">{globalIdx + 1}</td>
                                    <td className="py-2.5 px-3 whitespace-nowrap">
                                      <span className="font-mono text-xs text-gray-700 dark:text-gray-300">{d.poNumber ?? '—'}</span>
                                      {d.id && <span className="block font-mono text-[10px] text-gray-400 dark:text-gray-600">{String(d.id).slice(0,8)}</span>}
                                    </td>
                                    <td className="py-2.5 px-3 font-medium text-gray-900 dark:text-gray-100 max-w-[140px]"><span className="block truncate">{d.customer ?? '—'}</span></td>
                                    <td className="py-2.5 px-3 font-mono text-xs text-blue-700 dark:text-blue-400 whitespace-nowrap">{pnc}</td>
                                    <td className="py-2.5 px-3 font-mono text-xs text-gray-600 dark:text-gray-400 whitespace-nowrap">{modelId}</td>
                                    <td className="py-2.5 px-3 text-gray-500 dark:text-gray-400 hidden lg:table-cell max-w-[160px]"><span className="block truncate text-xs">{description}</span></td>
                                    <td className="py-2.5 px-3 text-gray-500 dark:text-gray-400 hidden md:table-cell max-w-[150px]"><span className="block truncate text-xs">{d.address ?? '—'}</span></td>
                                    <td className="py-2.5 px-3 text-gray-700 dark:text-gray-300 whitespace-nowrap text-xs">{d.driverName ?? <span className="text-gray-400 italic">Unassigned</span>}</td>
                                    <td className="py-2.5 px-3 text-gray-500 dark:text-gray-400 whitespace-nowrap text-xs">{formattedDate}</td>
                                    <td className="py-2.5 px-3">
                                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${statusColor}`}>{statusLabel}</span>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>

                        {/* Pagination */}
                        <PaginationBar
                          page={safePage}
                          totalPages={totalPages}
                          pageSize={POD_PAGE_SIZE}
                          total={podDeliveries.length}
                          onPageChange={goToPage}
                        />
                      </>
                    )}
                  </div>
                );
              })()}

              {/* Charts row */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                {/* Delivery Trend */}
                <div className="pp-card p-5 lg:col-span-2">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">Delivery Trend</h3>
                    <div className="flex bg-gray-100 dark:bg-gray-800 rounded-xl p-0.5 gap-0.5">
                      {(['7d','30d','90d'] as const).map(p => (
                        <button key={p} onClick={() => setReportsPeriod(p)}
                          className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${reportsPeriod === p ? 'bg-white dark:bg-gray-700 text-blue-700 dark:text-blue-300 shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}>
                          {p === '7d' ? '7d' : p === '30d' ? '30d' : '90d'}
                        </button>
                      ))}
                    </div>
                  </div>
                  {trendData.length === 0 ? (
                    <div className="flex items-center justify-center h-44 text-gray-400 dark:text-gray-500 text-sm">No data for this period</div>
                  ) : (
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={trendData} margin={{ top: 4, right: 4, bottom: 4, left: -12 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid, #e5e7eb)" />
                        <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--chart-tick, #6b7280)' }} />
                        <YAxis tick={{ fontSize: 11, fill: 'var(--chart-tick, #6b7280)' }} allowDecimals={false} />
                        <Tooltip {...TOOLTIP_STYLE} />
                        <Legend wrapperStyle={{ fontSize: 12 }} />
                        <Bar dataKey="delivered" name="Delivered" fill={CHART_COLORS.delivered} radius={[3,3,0,0]} stackId="a" />
                        <Bar dataKey="cancelled" name="Cancelled" fill={CHART_COLORS.cancelled} radius={[0,0,0,0]} stackId="a" />
                        <Bar dataKey="rescheduled" name="Rescheduled" fill={CHART_COLORS.rescheduled} radius={[3,3,0,0]} stackId="a" />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>

                {/* Status Distribution */}
                <div className="pp-card p-5">
                  <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-4">
                    Status Breakdown
                    <span className="ml-2 text-xs font-normal text-gray-400 dark:text-gray-500">({reportsPeriod === '7d' ? 'last 7 days' : reportsPeriod === '30d' ? 'last 30 days' : 'last 90 days'})</span>
                  </h3>
                  {statusDistribution.length === 0 ? (
                    <div className="flex items-center justify-center h-44 text-gray-400 dark:text-gray-500 text-sm">No data</div>
                  ) : (
                    <ResponsiveContainer width="100%" height={220}>
                      <PieChart>
                        <Pie data={statusDistribution} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} innerRadius={36}
                          label={false}
                          labelLine={false}>
                          {statusDistribution.map((_, i) => (
                            <Cell key={i} fill={PIE_PALETTE[i % PIE_PALETTE.length]} />
                          ))}
                        </Pie>
                        <Tooltip {...TOOLTIP_STYLE} />
                      </PieChart>
                    </ResponsiveContainer>
                  )}
                  {/* Legend */}
                  <div className="mt-2 space-y-1">
                    {statusDistribution.map((item, i) => (
                      <div key={item.name} className="flex items-center justify-between text-xs text-gray-600 dark:text-gray-400">
                        <span className="flex items-center gap-1.5">
                          <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: PIE_PALETTE[i % PIE_PALETTE.length] }} />
                          {item.name}
                        </span>
                        <span className="font-medium text-gray-800 dark:text-gray-200">{item.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Driver Performance */}
              <div className="pp-card p-5">
                <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-4 flex items-center gap-2">
                  <Users className="w-5 h-5 text-blue-500" />
                  Driver Performance
                </h3>
                {driverPerformance.length === 0 ? (
                  <p className="text-sm text-gray-400 dark:text-gray-500 py-4 text-center">No driver data for this period</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-200 dark:border-gray-700">
                          <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Driver</th>
                          <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Assigned</th>
                          <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Delivered</th>
                          <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Cancelled</th>
                          <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Success %</th>
                          <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">POD</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                        {driverPerformance.map((dr) => (
                          <tr key={dr.name} className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                            <td className="py-2.5 px-3 font-medium text-gray-900 dark:text-gray-100">{dr.name}</td>
                            <td className="py-2.5 px-3 text-right text-gray-700 dark:text-gray-300">{dr.assigned}</td>
                            <td className="py-2.5 px-3 text-right text-green-600 dark:text-green-400 font-medium">{dr.delivered}</td>
                            <td className="py-2.5 px-3 text-right text-red-500 dark:text-red-400">{dr.cancelled}</td>
                            <td className="py-2.5 px-3 text-right">
                              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${dr.successRate >= 80 ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300' : dr.successRate >= 60 ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300' : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'}`}>
                                {dr.successRate}%
                              </span>
                            </td>
                            <td className="py-2.5 px-3 text-right text-purple-600 dark:text-purple-400">{dr.podCompleted}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* ── Tomorrow's Delivery Schedule ─────────────── */}
              {(() => {
                const DUBAI_OFFSET_MS = 4 * 60 * 60 * 1000;
                const nowDubai = new Date(Date.now() + DUBAI_OFFSET_MS);
                const tomorrowDubai = new Date(nowDubai);
                tomorrowDubai.setUTCDate(tomorrowDubai.getUTCDate() + 1);
                const tomorrowIso = tomorrowDubai.toISOString().slice(0, 10); // YYYY-MM-DD

                const tomorrowRows = allDashDeliveries.filter(d => {
                  const raw = d.confirmedDeliveryDate as string | null | undefined;
                  if (!raw) return false;
                  return raw.slice(0, 10) === tomorrowIso;
                });

                const totalItems = tomorrowRows.reduce((sum, d) => {
                  try {
                    const items = typeof d.items === 'string' ? JSON.parse(d.items) : (Array.isArray(d.items) ? d.items : []);
                    return sum + (Array.isArray(items) ? items.reduce((s: number, it: { quantity?: number }) => s + (Number(it.quantity) || 1), 0) : 1);
                  } catch { return sum + 1; }
                }, 0);

                // Group by driver
                const byDriver: Record<string, { name: string; rows: typeof tomorrowRows; items: number }> = {};
                for (const d of tomorrowRows) {
                  const driverName = (d.driverName as string | null | undefined) || 'Unassigned';
                  if (!byDriver[driverName]) byDriver[driverName] = { name: driverName, rows: [], items: 0 };
                  byDriver[driverName].rows.push(d);
                  try {
                    const items = typeof d.items === 'string' ? JSON.parse(d.items) : (Array.isArray(d.items) ? d.items : []);
                    byDriver[driverName].items += Array.isArray(items) ? items.reduce((s: number, it: { quantity?: number }) => s + (Number(it.quantity) || 1), 0) : 1;
                  } catch { byDriver[driverName].items += 1; }
                }

                const handlePrintTomorrow = () => {
                  const rows = tomorrowRows.map((d, i) => {
                    let itemsStr = '';
                    try {
                      const items = typeof d.items === 'string' ? JSON.parse(d.items) : (Array.isArray(d.items) ? d.items : []);
                      if (Array.isArray(items)) {
                        itemsStr = items.map((it: { description?: string; pnc?: string; quantity?: number }) =>
                          `${it.description || it.pnc || ''}${it.quantity && it.quantity > 1 ? ` x${it.quantity}` : ''}`
                        ).filter(Boolean).join(', ');
                      }
                    } catch { /* ignore */ }
                    const dName = (d.driverName as string | null | undefined) || 'Unassigned';
                    return `<tr>
                      <td>${i + 1}</td>
                      <td>${d.poNumber ?? '—'}</td>
                      <td>${(d as unknown as { metadata?: { originalDeliveryNumber?: string } }).metadata?.originalDeliveryNumber ?? '—'}</td>
                      <td>${d.customer ?? '—'}</td>
                      <td>${d.address ?? '—'}</td>
                      <td>${itemsStr || '—'}</td>
                      <td>${dName}</td>
                    </tr>`;
                  }).join('');
                  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Tomorrow's Delivery Schedule – ${tomorrowIso}</title>
                  <style>body{font-family:Arial,sans-serif;font-size:11px;margin:20px}h1{font-size:14px;margin-bottom:4px}p{margin:2px 0 10px;color:#555}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ccc;padding:5px 7px;text-align:left}th{background:#f0f0f0;font-size:10px;text-transform:uppercase}tr:nth-child(even){background:#fafafa}@media print{button{display:none}}</style></head>
                  <body><h1>Tomorrow's Delivery Schedule — ${tomorrowIso}</h1>
                  <p>${tomorrowRows.length} orders &nbsp;·&nbsp; ${totalItems} items total</p>
                  <table><thead><tr><th>#</th><th>PO #</th><th>Del. No.</th><th>Customer</th><th>Address</th><th>Items</th><th>Driver</th></tr></thead><tbody>${rows}</tbody></table>
                  <script>window.print();</script></body></html>`;
                  const w = window.open('', '_blank');
                  if (w) { w.document.write(html); w.document.close(); }
                };

                return (
                  <div className="pp-card p-5">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
                      <div>
                        <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                          <Truck className="w-5 h-5 text-orange-500" />
                          Tomorrow's Delivery Schedule
                          <span className="ml-1 px-2 py-0.5 rounded-full bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 text-xs font-normal">
                            {tomorrowIso}
                          </span>
                        </h3>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                          {tomorrowRows.length} orders &middot; {totalItems} items &middot; {Object.keys(byDriver).length} driver{Object.keys(byDriver).length !== 1 ? 's' : ''}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={handlePrintTomorrow}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-orange-600 hover:bg-orange-700 text-white text-sm font-medium transition-colors"
                        >
                          <FileText className="w-4 h-4" />
                          Print Schedule
                        </button>
                        <button
                          onClick={() => {
                            const header = 'No,PO #,Delivery No.,Customer,Address,Items,Driver,Confirmed Date\n';
                            const csvRows = tomorrowRows.map((d, i) => {
                              let itemsStr = '';
                              try {
                                const items = typeof d.items === 'string' ? JSON.parse(d.items) : (Array.isArray(d.items) ? d.items : []);
                                if (Array.isArray(items)) itemsStr = items.map((it: { description?: string; pnc?: string; quantity?: number }) => `${it.description || it.pnc || ''}${it.quantity && it.quantity > 1 ? ` x${it.quantity}` : ''}`).filter(Boolean).join(' | ');
                              } catch { /* ignore */ }
                              const dName = (d.driverName as string | null | undefined) || 'Unassigned';
                              return [i + 1, d.poNumber ?? '', (d as unknown as { metadata?: { originalDeliveryNumber?: string } }).metadata?.originalDeliveryNumber ?? '', d.customer ?? '', d.address ?? '', itemsStr, dName, tomorrowIso].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',');
                            }).join('\n');
                            const blob = new Blob(['\uFEFF' + header + csvRows], { type: 'text/csv;charset=utf-8' });
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url; a.download = `tomorrow-schedule-${tomorrowIso}.csv`; a.click();
                            URL.revokeObjectURL(url);
                          }}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-gray-200 dark:border-gray-700 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                        >
                          <Download className="w-4 h-4" />
                          Export CSV
                        </button>
                      </div>
                    </div>

                    {/* Driver summary chips */}
                    {Object.values(byDriver).length > 0 && (
                      <div className="flex flex-wrap gap-2 mb-4">
                        {Object.values(byDriver).map(dr => (
                          <span key={dr.name} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300">
                            <Users className="w-3 h-3" />
                            <span className="font-semibold">{dr.name}</span>
                            <span className="opacity-70">— {dr.rows.length} orders / {dr.items} items</span>
                          </span>
                        ))}
                      </div>
                    )}

                    {tomorrowRows.length === 0 ? (
                      <div className="text-center py-10">
                        <Package className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
                        <p className="text-sm text-gray-500 dark:text-gray-400">No deliveries scheduled for tomorrow ({tomorrowIso})</p>
                        <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Deliveries appear here once customers confirm a date</p>
                      </div>
                    ) : (
                      <div className="overflow-x-auto rounded-lg border border-gray-100 dark:border-gray-800">
                        <table className="w-full text-sm min-w-[700px] table-fixed">
                          <colgroup>
                            <col style={{ width: '32px' }} />
                            <col style={{ width: '80px' }} />
                            <col style={{ width: '90px' }} />
                            <col style={{ width: '14%' }} />
                            <col style={{ width: '20%' }} />
                            <col style={{ width: '25%' }} />
                            <col style={{ width: '13%' }} />
                          </colgroup>
                          <thead className="bg-gray-50 dark:bg-gray-800/95 border-b border-gray-200 dark:border-gray-700">
                            <tr>
                              <th className="text-left py-2.5 px-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">#</th>
                              <th className="text-left py-2.5 px-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">PO #</th>
                              <th className="text-left py-2.5 px-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Del. No.</th>
                              <th className="text-left py-2.5 px-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Customer</th>
                              <th className="text-left py-2.5 px-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Address</th>
                              <th className="text-left py-2.5 px-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Items</th>
                              <th className="text-left py-2.5 px-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Driver</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                            {tomorrowRows.map((d, i) => {
                              let itemsStr = '—';
                              let itemCount = 0;
                              try {
                                const items = typeof d.items === 'string' ? JSON.parse(d.items) : (Array.isArray(d.items) ? d.items : []);
                                if (Array.isArray(items) && items.length > 0) {
                                  itemsStr = items.map((it: { description?: string; pnc?: string; quantity?: number }) =>
                                    `${it.description || it.pnc || ''}${it.quantity && it.quantity > 1 ? ` ×${it.quantity}` : ''}`
                                  ).filter(Boolean).join(', ');
                                  itemCount = items.reduce((s: number, it: { quantity?: number }) => s + (Number(it.quantity) || 1), 0);
                                }
                              } catch { /* ignore */ }
                              const dName = (d.driverName as string | null | undefined) || 'Unassigned';
                              const delivNo = (d as unknown as { metadata?: { originalDeliveryNumber?: string } }).metadata?.originalDeliveryNumber;
                              return (
                                <tr key={d.id ?? i} className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                                  <td className="py-2.5 px-3 text-xs text-gray-400 dark:text-gray-500">{i + 1}</td>
                                  <td className="py-2.5 px-3 text-xs font-semibold text-blue-700 dark:text-blue-300 truncate">{d.poNumber ?? '—'}</td>
                                  <td className="py-2.5 px-3 text-xs text-gray-500 dark:text-gray-400 truncate">{delivNo ?? '—'}</td>
                                  <td className="py-2.5 px-3 text-xs font-medium text-gray-900 dark:text-gray-100 truncate">{d.customer ?? '—'}</td>
                                  <td className="py-2.5 px-3 text-xs text-gray-500 dark:text-gray-400 truncate">{d.address ?? '—'}</td>
                                  <td className="py-2.5 px-3 text-xs text-gray-600 dark:text-gray-300 truncate">
                                    {itemsStr !== '—' ? (
                                      <span title={itemsStr}>
                                        {itemCount > 0 && <span className="mr-1 font-semibold text-orange-600 dark:text-orange-400">[{itemCount}]</span>}
                                        {itemsStr}
                                      </span>
                                    ) : '—'}
                                  </td>
                                  <td className="py-2.5 px-3 text-xs truncate">
                                    <span className={`font-medium ${dName === 'Unassigned' ? 'text-yellow-600 dark:text-yellow-400' : 'text-gray-700 dark:text-gray-300'}`}>
                                      {dName}
                                    </span>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })()}

            </>
          )}
        </div>
      )}

      </div>{/* end tab-enter wrapper */}
    </div>
  );
}
