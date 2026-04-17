import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import api from '../frontend/apiClient';
import PaginationBar from '../components/common/PaginationBar';
import { getCurrentUser } from '../frontend/auth';
import {
  Activity,
  Users,
  AlertCircle,
  CheckCircle,
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
import DeliveryManagementPage from './DeliveryManagementPage';
import useDeliveryStore from '../store/useDeliveryStore';
import { deliveryToManageOrder } from '../utils/deliveryWorkflowMap';
import { excludeTeamPortalGarbageDeliveries } from '../utils/deliveryListFilter';
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

export default function DeliveryTeamPortal() {
  const [activeTab, setActiveTab] = useState<string>('operations');
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
  /** Dubai ISO dates we have capacity snapshots for (sorted, today + future only). */
  const capacityDatesSorted = useMemo(() => {
    // Filter out past dates — only show today and future
    const todayIso = getTodayIsoDubai();
    return [...Object.keys(driverCapacityByDate)]
      .filter(iso => iso >= todayIso)
      .sort();
  }, [driverCapacityByDate]);

  // Control tab state
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
  const [highlightDeliveryId, setHighlightDeliveryId] = useState<string | null>(null);
  const highlightRowRef = useRef<HTMLTableRowElement | null>(null);

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
      const raw = res.data as DashData;
      const dashList = raw.deliveries ?? [];
      setDashData({
        ...raw,
        deliveries: excludeTeamPortalGarbageDeliveries(dashList) as DashDelivery[],
      });
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

    return () => {
      clearInterval(interval);
    };
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

  // Handle URL-based tab/contact/delivery selection
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const tabParam = params.get('tab');
    const contactId = params.get('driver') || params.get('contact');
    const deliveryId = params.get('delivery');

    // Switch to tab specified in URL
    if (tabParam) {
      setActiveTab(tabParam);
    }

    // If contact ID is provided, switch to communication tab and select contact
    if (contactId) {
      setActiveTab('communication');
      if (contacts.length > 0) {
        const contact = contacts.find(c => c.id === contactId);
        if (contact) {
          setSelectedContact(contact);
        }
      }
    }

    // If delivery ID is provided, switch to operations tab and highlight the row
    if (deliveryId) {
      setActiveTab('operations');
      setHighlightDeliveryId(deliveryId);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search, contacts.length]);

  // Auto-scroll to highlighted delivery row
  useEffect(() => {
    if (highlightDeliveryId && highlightRowRef.current) {
      highlightRowRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const t = setTimeout(() => setHighlightDeliveryId(null), 4000);
      return () => clearTimeout(t);
    }
  }, [highlightDeliveryId, deliveries]);

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

      // Load per-driver capacity per delivery date visible in table (non-critical)
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
      ? order.confirmedDeliveryDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
      : null;
    switch (order.status) {
      case 'order_delay':       return { label: 'Order Delay',                                                              color: 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300' };
      case 'out_for_delivery':  return { label: 'On Route',                                                                  color: 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300' };
      case 'next_shipment': {
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
        ws === 'delivered'        ? 'Delivered' :
        ws === 'out_for_delivery' ? 'On Route' :
        ws === 'next_shipment'    ? 'Next Shipment' :
        ws === 'future_schedule'  ? 'Future Schedule' :
        ws === 'order_delay'      ? 'Order Delay' :
        ws === 'sms_sent'         ? 'Awaiting Customer' :
        ws === 'unconfirmed'      ? 'No Response' :
        ws === 'confirmed'        ? 'Confirmed' :
        ws === 'rescheduled'      ? 'Rescheduled' :
        ws === 'failed'           ? 'Failed / Returned' :
        ws === 'cancelled'        ? 'Cancelled' :
        ws === 'uploaded'         ? 'Pending' :
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

  /** Tomorrow (Dubai calendar) — read-only list for Reports tab */
  const reportTomorrowDeliveries = useMemo(() => {
    const DUBAI_OFFSET_MS = 4 * 60 * 60 * 1000;
    const nowDubai = new Date(Date.now() + DUBAI_OFFSET_MS);
    const tomorrowDubai = new Date(nowDubai);
    tomorrowDubai.setUTCDate(tomorrowDubai.getUTCDate() + 1);
    const tomorrowIso = tomorrowDubai.toISOString().slice(0, 10);

    const excluded = new Set([
      'delivered', 'delivered-with-installation', 'delivered-without-installation',
      'finished', 'completed', 'pod-completed', 'cancelled', 'returned', 'failed',
      'out-for-delivery', 'in-transit', 'in-progress',
    ]);

    const rows = allDashDeliveries.filter((d) => {
      const raw = d.confirmedDeliveryDate as string | null | undefined;
      if (!raw) return false;
      const parsed = new Date(raw);
      if (Number.isNaN(parsed.getTime())) return false;
      const dubaiIso = new Date(parsed.getTime() + DUBAI_OFFSET_MS).toISOString().slice(0, 10);
      if (dubaiIso !== tomorrowIso) return false;
      const s = (d.status as string | undefined | null || '').toLowerCase();
      return !excluded.has(s);
    });

    return { tomorrowIso, rows };
  }, [allDashDeliveries]);

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
      // Filter by workflow status (covers all derived statuses including next_shipment, order_delay, etc.)
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
  const PIE_PALETTE = ['#22c55e','#ef4444','#f59e0b','#3b82f6','#8b5cf6','#94a3b8','#06b6d4','#f97316','#ec4899','#14b8a6','#a855f7','#64748b'];
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
    <div className="space-y-2 md:space-y-4 w-full min-w-0">
      {/* WhatsApp modal is handled globally in App.tsx */}
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
      <div className="pp-sticky-tab-rail pp-card mt-0 mb-2 overflow-x-auto px-2 py-2 md:mb-3">
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
                    }}
                    className={`flex flex-col items-center justify-center rounded-xl border p-3 ${bg} ${border} ${hover} cursor-pointer select-none transition-colors`}
                    title={`View ${label} in Delivery Orders table`}
                  >
                    <span className={`text-xl font-bold ${countColor}`}>{count}</span>
                    <span className={`mt-0.5 text-center text-xs font-semibold leading-tight ${labelColor}`}>{label}</span>
                    <span className="mt-0.5 text-center text-[10px] text-gray-400 dark:text-gray-500">→ {sublabel}</span>
                  </div>
                ))}
                </div>
                {(actionItems.pendingOrders.length > 0 || actionItems.unassigned.length > 0 || actionItems.awaitingConfirmation.length > 0 || actionItems.orderDelay.length > 0) && (
                  <p className="mt-3 text-center text-xs text-gray-400 dark:text-gray-500">Tap any card to open the filtered order list in Deliveries tab</p>
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

            {/* Truck capacity — per Dubai calendar day (today / tomorrow / …); on-route counts on today */}
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

          {/* ── Full-Width Order Detail Table ── */}
          {(() => {
            const q = opsSearch.toLowerCase().trim();
            const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
            const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999);
            const dateFromMs = opsDateFrom ? new Date(opsDateFrom + 'T00:00:00').getTime() : null;
            const dateToMs = opsDateTo ? new Date(opsDateTo + 'T23:59:59').getTime() : null;
            const opsRows = deliveries
              .filter(d => {
                const s = (d.status || '').toLowerCase();
                if (opsStatusFilter !== 'all') {
                  if (opsStatusFilter === 'pending' && !['pending', 'uploaded', 'scheduled', 'confirmed', 'scheduled-confirmed'].includes(s)) return false;
                  if (opsStatusFilter === 'awaiting' && !['sms_sent', 'sms-sent', 'unconfirmed'].includes(s)) return false;
                  if (opsStatusFilter === 'ofd' && s !== 'out-for-delivery') return false;
                  if (opsStatusFilter === 'delay' && s !== 'order-delay') return false;
                  if (opsStatusFilter === 'terminal' && !TERMINAL_STATUSES.has(s)) return false;
                  if (opsStatusFilter === 'priority') {
                    const m = ((d as unknown as { metadata?: Record<string, unknown> }).metadata ?? {});
                    if (m.isPriority !== true) return false;
                  }
                }
                if (opsTodayOnly) {
                  const dExt2 = d as unknown as { createdAt?: string };
                  const created = dExt2.createdAt ? new Date(dExt2.createdAt) : null;
                  if (!created || created < todayStart || created > todayEnd) return false;
                }
                if (dateFromMs || dateToMs) {
                  const dExt2 = d as unknown as { createdAt?: string };
                  const created = dExt2.createdAt ? new Date(dExt2.createdAt).getTime() : null;
                  if (!created) return false;
                  if (dateFromMs && created < dateFromMs) return false;
                  if (dateToMs && created > dateToMs) return false;
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
                  (d.phone || '').toLowerCase().includes(q) ||
                  (d.status || '').toLowerCase().includes(q)
                );
              })
              .sort((a, b) => {
                const aMeta = ((a as unknown as { metadata?: Record<string, unknown> }).metadata ?? {});
                const bMeta = ((b as unknown as { metadata?: Record<string, unknown> }).metadata ?? {});
                if (opsSortCol) {
                  const dir = opsSortDir === 'asc' ? 1 : -1;
                  const getTs = (d: typeof a): number => {
                    const ext = d as unknown as { goodsMovementDate?: string; confirmedDeliveryDate?: string; createdAt?: string };
                    const raw = opsSortCol === 'gmd' ? ext.goodsMovementDate
                      : opsSortCol === 'deldate' ? ext.confirmedDeliveryDate
                      : opsSortCol === 'customer' ? null
                      : opsSortCol === 'status' ? null
                      : ext.createdAt;
                    return raw ? new Date(raw).getTime() : 0;
                  };
                  if (opsSortCol === 'customer') {
                    const va = String((a.customer || '')).toLowerCase();
                    const vb = String((b.customer || '')).toLowerCase();
                    if (va !== vb) return va.localeCompare(vb) * dir;
                  } else if (opsSortCol === 'status') {
                    const va = String(a.status || '').toLowerCase();
                    const vb = String(b.status || '').toLowerCase();
                    if (va !== vb) return va.localeCompare(vb) * dir;
                  } else {
                    const diff = getTs(a) - getTs(b);
                    if (diff !== 0) return diff * dir;
                  }
                }
                const aPrio = aMeta.isPriority === true ? 0 : 1;
                const bPrio = bMeta.isPriority === true ? 0 : 1;
                if (aPrio !== bPrio) return aPrio - bPrio;
                const prio = (s: string) => s === 'out-for-delivery' ? 0 : s === 'order-delay' ? 1 : TERMINAL_STATUSES.has(s) ? 3 : 2;
                return prio((a.status || '').toLowerCase()) - prio((b.status || '').toLowerCase());
              });

            return (
              <div className="pp-card overflow-hidden">
                {/* Header */}
                <div className="p-4 bg-gray-50 dark:bg-gray-700 border-b dark:border-gray-600">
                  <div className="flex flex-wrap items-center gap-3 mb-3">
                    <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                      <Package className="w-4 h-4 text-blue-500" /> Order Details
                      <span className="text-xs font-normal text-gray-400 dark:text-gray-500">({opsRows.length} orders)</span>
                    </h2>
                    <div className="ml-auto flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void loadData()}
                        className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                      >
                        <RefreshCw className="w-3.5 h-3.5" /> Refresh
                      </button>
                    </div>
                  </div>
                  {/* Search + Filters */}
                  <div className="flex flex-wrap gap-2 items-center">
                    <input
                      type="text"
                      placeholder="Search customer, PO number, delivery #, address…"
                      value={opsSearch}
                      onChange={e => setOpsSearch(e.target.value)}
                      className="px-3 py-1.5 text-xs rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 w-64"
                    />
                    {([
                      { f: 'all',      label: 'All Orders',            active: 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900' },
                      { f: 'pending',  label: 'Pending',               active: 'bg-yellow-500 text-white' },
                      { f: 'awaiting', label: 'Awaiting Confirmation', active: 'bg-purple-600 text-white' },
                      { f: 'ofd',      label: 'On Route',              active: 'bg-blue-600 text-white' },
                      { f: 'delay',    label: 'Order Delayed',         active: 'bg-red-600 text-white' },
                      { f: 'terminal', label: 'Completed',             active: 'bg-green-600 text-white' },
                      { f: 'priority', label: '🚨 Priority',           active: 'bg-red-700 text-white' },
                    ] as const).map(({ f, label, active }) => (
                      <button
                        key={f}
                        type="button"
                        onClick={() => setOpsStatusFilter(f)}
                        className={`px-3 py-1 rounded-full text-[11px] font-semibold transition-colors ${
                          opsStatusFilter === f
                            ? active
                            : 'border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => setOpsTodayOnly(v => !v)}
                      className={`px-3 py-1 rounded-full text-[11px] font-semibold transition-colors ${
                        opsTodayOnly
                          ? 'bg-indigo-600 text-white'
                          : 'border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50'
                      }`}
                    >
                      📅 Today
                    </button>
                  </div>
                  {/* Date range row */}
                  <div className="flex flex-wrap items-center gap-2 mt-2">
                    <span className="text-[11px] text-gray-500 dark:text-gray-400 font-medium">Date range:</span>
                    <input
                      type="date"
                      value={opsDateFrom}
                      onChange={e => setOpsDateFrom(e.target.value)}
                      className="px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                    <span className="text-[11px] text-gray-400">to</span>
                    <input
                      type="date"
                      value={opsDateTo}
                      onChange={e => setOpsDateTo(e.target.value)}
                      className="px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                    {(opsDateFrom || opsDateTo) && (
                      <button
                        type="button"
                        onClick={() => { setOpsDateFrom(''); setOpsDateTo(''); }}
                        className="text-[11px] text-red-500 dark:text-red-400 hover:underline"
                      >
                        Clear
                      </button>
                    )}
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
                  <table className="w-full text-xs divide-y divide-gray-200 dark:divide-gray-700" style={{ minWidth: '1600px' }}>
                    <thead className="bg-gray-50 dark:bg-gray-700/80 sticky top-0 z-10">
                      <tr>
                        {([
                          { h: '·',               col: null },
                          { h: 'PO Number',        col: null },
                          { h: 'Delivery Number',  col: 'date' },
                          { h: 'Customer',         col: 'customer' },
                          { h: 'Phone',            col: null },
                          { h: 'Address',          col: null },
                          { h: 'City',             col: null },
                          { h: 'Status',           col: 'status' },
                          { h: 'GMD',              col: 'gmd' },
                          { h: 'Del Date',         col: 'deldate' },
                          { h: 'Model',            col: null },
                          { h: 'Description',      col: null },
                          { h: 'Material',         col: null },
                          { h: 'Inv. Price',       col: null },
                          { h: 'Qty',              col: null },
                          { h: 'Priority',         col: null },
                          { h: 'Driver',           col: null },
                          { h: 'Actions',          col: null },
                        ] as { h: string; col: 'date' | 'gmd' | 'deldate' | 'customer' | 'status' | null }[]).map(({ h, col }) => {
                          const isActive = col && opsSortCol === col;
                          return (
                            <th
                              key={h}
                              onClick={col ? () => {
                                if (opsSortCol === col) setOpsSortDir(d => d === 'asc' ? 'desc' : 'asc');
                                else { setOpsSortCol(col); setOpsSortDir('asc'); }
                              } : undefined}
                              className={`px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider whitespace-nowrap ${
                                col ? 'cursor-pointer select-none hover:text-blue-600 dark:hover:text-blue-400' : ''
                              } ${isActive ? 'text-blue-600 dark:text-blue-400' : 'text-gray-500 dark:text-gray-300'}`}
                            >
                              {h}{isActive ? (opsSortDir === 'asc' ? ' ↑' : ' ↓') : (col ? ' ↕' : '')}
                            </th>
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-100 dark:divide-gray-700/60">
                      {opsRows.length === 0 ? (
                        <tr>
                          <td colSpan={18} className="px-4 py-8 text-center text-gray-400 dark:text-gray-500">
                            No orders found
                          </td>
                        </tr>
                      ) : (
                        opsRows.map(delivery => {
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
                        const delNum = displayDeliveryNumber(delivery);
                        const city = displayCityForOps(delivery);
                        const model = displayModelForOps(delivery);
                        const description = displayDescriptionForOps(delivery);
                        const material = displayMaterialForOps(delivery);
                        const invoicePrice = String(orig['Invoice Price'] ?? orig['invoice_price'] ?? orig['Price'] ?? orig['Unit Price'] ?? '—');
                        const qtyRaw = orig['Order Quantity'] ?? orig['Confirmed quantity'] ?? orig['Total Line Deliv. Qt'] ?? orig['Order Qty'] ?? orig['Quantity'] ?? orig['qty'] ?? null;
                        const qty = String(qtyRaw ?? '—');
                        const gmd = dExt.goodsMovementDate ? new Date(dExt.goodsMovementDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }) : '—';
                        const delDate = dExt.confirmedDeliveryDate ? new Date(dExt.confirmedDeliveryDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }) : '—';
                        const rawStatus = (delivery.status || '').toLowerCase();
                        const workflowOrder = deliveryToManageOrder(delivery);
                        const isOFDWorkflow = workflowOrder.status === 'out_for_delivery';
                        const isDelayWorkflow = workflowOrder.status === 'order_delay';
                        const isPriority = (meta as Record<string, unknown>).isPriority === true;
                        const isDispatchable = ['pending', 'scheduled', 'uploaded', 'confirmed', 'scheduled-confirmed'].includes(rawStatus);
                        const hasGMD = !!dExt.goodsMovementDate;
                        // Show "Send SMS" (WhatsApp) until the customer confirms — regardless of
                        // whether a link was already sent. After customer confirms, button is not needed.
                        const confirmationDone = (dExt.confirmationStatus as string) === 'confirmed';
                        const terminalStatus = ['out-for-delivery', 'delivered', 'cancelled', 'returned', 'in-transit', 'in-progress', 'finished', 'completed', 'pod-completed'].includes(rawStatus);
                        const phoneForSms = displayPhone(delivery);
                        const needsSMS = phoneForSms !== '—' && !confirmationDone && !terminalStatus;
                        const currentDriverId = dExt.tracking?.driverId || delivery.assignedDriverId;
                        const currentDriver = drivers.find(d => d.id === currentDriverId);
                        const capacityDateIso = getCapacityDateIso(delivery);
                        const isOnline = currentDriver ? isContactOnline(currentDriver) : false;
                        const { label: statusLabel, color: statusColor, tierLabel, tierColor } = getDeliveryStatusBadge(delivery);
                        const rowBg = isOFDWorkflow
                          ? 'bg-blue-50/40 dark:bg-blue-900/10 border-l-4 border-l-blue-500'
                          : isDelayWorkflow
                          ? 'bg-red-50/40 dark:bg-red-900/10 border-l-4 border-l-red-400'
                          : 'border-l-4 border-l-transparent';

                        const isHighlighted = delivery.id === highlightDeliveryId;
                        return (
                          <tr
                            key={delivery.id}
                            ref={isHighlighted ? highlightRowRef : null}
                            className={`${rowBg} hover:brightness-95 dark:hover:brightness-110 transition-all${isHighlighted ? ' ring-2 ring-inset ring-blue-500 dark:ring-blue-400' : ''}`}
                          >
                            {/* Indicator dot */}
                            <td className="pl-3 pr-1 py-3">
                              <span className={`block w-2 h-2 rounded-full flex-shrink-0 ${
                                isOFDWorkflow ? 'bg-blue-500 shadow-[0_0_6px_rgba(59,130,246,0.7)]' :
                                isDelayWorkflow ? 'bg-red-400' :
                                currentDriverId ? 'bg-amber-400' : 'bg-gray-300 dark:bg-gray-600'
                              }`} />
                            </td>
                            <td className="px-3 py-2.5 font-mono text-gray-700 dark:text-gray-300 whitespace-nowrap">{displayPoNumber(delivery)}</td>
                            <td className="px-3 py-2.5 font-mono text-gray-600 dark:text-gray-400 whitespace-nowrap">{delNum}</td>
                            <td className="px-3 py-2.5">
                              <div className="font-medium text-gray-900 dark:text-gray-100 whitespace-nowrap">{displayCustomerName(delivery)}</div>
                            </td>
                            <td className="px-3 py-2.5 text-gray-500 dark:text-gray-400 whitespace-nowrap">{displayPhone(delivery)}</td>
                            <td className="px-3 py-2.5 max-w-[180px]">
                              <div className="truncate text-gray-600 dark:text-gray-300" title={delivery.address || ''}>{delivery.address || '—'}</div>
                            </td>
                            <td className="px-3 py-2.5 text-gray-600 dark:text-gray-300 whitespace-nowrap">{city}</td>
                            <td className="px-3 py-2.5">
                              <div className="flex flex-col gap-0.5">
                                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap ${statusColor}`}>
                                  {statusLabel}
                                </span>
                                {tierLabel && tierColor && (
                                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap ${tierColor}`}>
                                    {tierLabel}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="px-3 py-2.5 text-gray-600 dark:text-gray-300 whitespace-nowrap">{gmd}</td>
                            <td className="px-3 py-2.5 text-gray-600 dark:text-gray-300 whitespace-nowrap">{delDate}</td>
                            <td className="px-3 py-2.5 max-w-[100px]">
                              <div className="truncate text-gray-600 dark:text-gray-300" title={model}>{model}</div>
                            </td>
                            <td className="px-3 py-2.5 max-w-[140px]">
                              <div className="truncate text-gray-500 dark:text-gray-400" title={description}>{description}</div>
                            </td>
                            <td className="px-3 py-2.5 font-mono text-gray-600 dark:text-gray-400 whitespace-nowrap">{material}</td>
                            <td className="px-3 py-2.5 text-gray-600 dark:text-gray-300 whitespace-nowrap">{invoicePrice}</td>
                            <td className="px-3 py-2.5 text-gray-600 dark:text-gray-300 whitespace-nowrap">{qty}</td>
                            {/* Priority badge (read-only — set by Logistics portal) */}
                            <td className="px-3 py-2.5 text-center" style={{ minWidth: '90px' }}>
                              {isPriority ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 border border-red-300 dark:border-red-700 whitespace-nowrap">
                                  🚨 Priority
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-gray-100 dark:bg-gray-700 text-gray-400 dark:text-gray-500 whitespace-nowrap">
                                  📦 Normal
                                </span>
                              )}
                            </td>
                            {/* Driver (read-only — assignment is Logistics only) */}
                            <td className="px-3 py-2.5" style={{ minWidth: '160px' }}>
                              {currentDriver ? (
                                <div className="mb-1 flex items-center gap-1">
                                  <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${isOnline ? 'bg-green-500' : 'bg-gray-300'}`} />
                                  <span className="truncate text-xs font-medium text-gray-800 dark:text-gray-200">
                                    {currentDriver.fullName || currentDriver.username}
                                  </span>
                                </div>
                              ) : (
                                <div className="mb-1 text-xs text-gray-500 dark:text-gray-400">— Unassigned</div>
                              )}
                              <p className="mb-1 font-mono text-[9px] text-gray-400 dark:text-gray-500" title="Dubai calendar day used for truck capacity">
                                Truck day: {capacityDateIso}
                              </p>
                              <p className="text-[9px] text-gray-400 dark:text-gray-500 italic">Set by Logistics</p>
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
                                {isDispatchable && !hasGMD && !isOFDWorkflow && !isDelayWorkflow && (
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
                                {/* Status Update dropdown */}
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
                      })
                      )}
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
        <DeliveryManagementPage hidePageTitle excludeGarbageUploadRows />
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
          {reportsLoading && !dashData ? (
            <div className="flex items-center justify-center py-20">
              <div className="text-center">
                <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600 mx-auto mb-3" />
                <p className="text-gray-500 dark:text-gray-400 text-sm">Loading analytics…</p>
              </div>
            </div>
          ) : (
            <>
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
                        { label: 'Next Shipment', value: allDashWithWorkflow.filter(({ ws }) => ws === 'next_shipment').length, color: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300' },
                        { label: 'Future Schedule', value: allDashWithWorkflow.filter(({ ws }) => ws === 'future_schedule').length, color: 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300' },
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
                        <option value="next_shipment">Next Shipment</option>
                        <option value="future_schedule">Future Schedule</option>
                        <option value="order_delay">Order Delay</option>
                        <option value="sms_sent">Awaiting Customer (SMS Sent)</option>
                        <option value="unconfirmed">No Response</option>
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
                                  ws === 'out_for_delivery' ? 'On Route' :
                                  ws === 'next_shipment'    ? 'Next Shipment' :
                                  ws === 'future_schedule'  ? 'Future Schedule' :
                                  ws === 'order_delay'      ? 'Order Delay' :
                                  ws === 'sms_sent'         ? 'Awaiting Customer' :
                                  ws === 'unconfirmed'      ? 'No Response' :
                                  ws === 'uploaded'         ? 'Pending Order' :
                                  ws === 'confirmed'        ? 'Customer Confirmed' :
                                  ws === 'rescheduled'      ? 'Rescheduled' :
                                  ws === 'delivered'        ? 'Delivered' :
                                  ws === 'failed'           ? 'Failed / Returned' :
                                  ws === 'cancelled'        ? 'Cancelled' :
                                  ws;
                                const statusColor =
                                  ws === 'out_for_delivery' ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300' :
                                  ws === 'next_shipment'    ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300' :
                                  ws === 'future_schedule'  ? 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300' :
                                  ws === 'order_delay'      ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300' :
                                  ws === 'sms_sent'         ? 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300' :
                                  ws === 'unconfirmed'      ? 'bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300' :
                                  ws === 'confirmed'        ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300' :
                                  ws === 'rescheduled'      ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300' :
                                  ws === 'delivered'        ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300' :
                                  ws === 'failed'           ? 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300' :
                                  ws === 'cancelled'        ? 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400' :
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

              {/* Tomorrow delivery list — read-only, between charts and driver performance */}
              <div className="pp-card p-5">
                <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-1 flex flex-wrap items-center gap-2">
                  <Truck className="w-5 h-5 text-orange-500 shrink-0" />
                  Tomorrow&apos;s delivery list
                  <span className="px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-xs font-normal text-gray-600 dark:text-gray-400">
                    {reportTomorrowDeliveries.tomorrowIso}
                  </span>
                </h3>
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
                  Confirmed delivery date equals tomorrow in Dubai time. Read-only snapshot ({reportTomorrowDeliveries.rows.length} order{reportTomorrowDeliveries.rows.length === 1 ? '' : 's'}).
                </p>
                {reportTomorrowDeliveries.rows.length === 0 ? (
                  <p className="text-sm text-gray-400 dark:text-gray-500 py-6 text-center">No deliveries scheduled for this date.</p>
                ) : (
                  <div className="overflow-x-auto rounded-lg border border-gray-100 dark:border-gray-800">
                    <table className="w-full text-sm min-w-[960px]">
                      <thead className="bg-gray-50 dark:bg-gray-800/95 border-b border-gray-200 dark:border-gray-700">
                        <tr>
                          <th className="text-left py-2.5 px-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider w-10">#</th>
                          <th className="text-left py-2.5 px-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap">PO number</th>
                          <th className="text-left py-2.5 px-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap">Delivery no.</th>
                          <th className="text-left py-2.5 px-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Customer</th>
                          <th className="text-left py-2.5 px-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap">Phone</th>
                          <th className="text-left py-2.5 px-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider min-w-[180px]">Address</th>
                          <th className="text-left py-2.5 px-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap">Confirmed date</th>
                          <th className="text-left py-2.5 px-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap">Driver</th>
                          <th className="text-left py-2.5 px-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap">API status</th>
                          <th className="text-left py-2.5 px-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap">Workflow</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                        {reportTomorrowDeliveries.rows.map((d, i) => {
                          const meta = (d as unknown as { metadata?: { originalDeliveryNumber?: string } }).metadata;
                          const delNo = meta?.originalDeliveryNumber != null ? String(meta.originalDeliveryNumber) : '—';
                          const phoneRaw = (d as Record<string, unknown>).phone;
                          const phone = phoneRaw != null && String(phoneRaw).trim() ? String(phoneRaw).trim() : '—';
                          const confRaw = d.confirmedDeliveryDate as string | undefined;
                          const confFmt = confRaw
                            ? new Date(confRaw).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
                            : '—';
                          const wf = deliveryToManageOrder(d as unknown as Delivery).status;
                          const wfLabel =
                            wf === 'next_shipment' ? 'Next Shipment' :
                            wf === 'future_schedule' ? 'Future Schedule' :
                            wf === 'order_delay' ? 'Order Delay' :
                            wf === 'out_for_delivery' ? 'On Route' :
                            wf === 'rescheduled' ? 'Rescheduled' :
                            wf === 'confirmed' ? 'Confirmed' :
                            wf;
                          return (
                            <tr key={String(d.id ?? i)} className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                              <td className="py-2.5 px-3 text-xs text-gray-400 dark:text-gray-500 tabular-nums">{i + 1}</td>
                              <td className="py-2.5 px-3 font-mono text-xs text-gray-800 dark:text-gray-200 whitespace-nowrap">{d.poNumber ?? '—'}</td>
                              <td className="py-2.5 px-3 font-mono text-xs text-gray-600 dark:text-gray-400 whitespace-nowrap">{delNo}</td>
                              <td className="py-2.5 px-3 font-medium text-gray-900 dark:text-gray-100 max-w-[160px]"><span className="block truncate" title={d.customer ?? ''}>{d.customer ?? '—'}</span></td>
                              <td className="py-2.5 px-3 text-xs text-gray-700 dark:text-gray-300 whitespace-nowrap tabular-nums">{phone}</td>
                              <td className="py-2.5 px-3 text-xs text-gray-600 dark:text-gray-400 max-w-[280px]"><span className="line-clamp-2" title={d.address ?? ''}>{d.address ?? '—'}</span></td>
                              <td className="py-2.5 px-3 text-xs text-gray-700 dark:text-gray-300 whitespace-nowrap">{confFmt}</td>
                              <td className="py-2.5 px-3 text-xs text-gray-700 dark:text-gray-300 whitespace-nowrap">{d.driverName ?? '—'}</td>
                              <td className="py-2.5 px-3 text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap capitalize">{String(d.status ?? '—').replace(/-/g, ' ')}</td>
                              <td className="py-2.5 px-3 text-xs text-gray-700 dark:text-gray-300 whitespace-nowrap">{wfLabel}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
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


            </>
          )}
        </div>
      )}

      </div>{/* end tab-enter wrapper */}
    </div>
  );
}
