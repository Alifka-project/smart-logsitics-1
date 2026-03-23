import React, { useEffect, useState, useRef } from 'react';
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
  Search
} from 'lucide-react';
import DriverTrackingMap from '../components/Tracking/DriverTrackingMap';
import DeliveryManagementPage from './DeliveryManagementPage';
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
    } | null;
    lastUpdate?: string | null;
  };
}

interface TeamMessage {
  id: string;
  adminId?: string | number | null;
  driverId?: string | number | null;
  content: string;
  senderRole?: string;
  createdAt?: string;
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
  const [activeTab, setActiveTab] = useState<string>('monitoring');
  const [drivers, setDrivers] = useState<ContactUser[]>([]);
  const [contacts, setContacts] = useState<ContactUser[]>([]); // All contacts (drivers + team members)
  const [teamMembers, setTeamMembers] = useState<ContactUser[]>([]); // Admin + delivery_team
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [alerts, setAlerts] = useState<SystemAlert[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [autoRefresh, setAutoRefresh] = useState<boolean>(true);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  
  // Control tab state
  const [assigningDelivery, setAssigningDelivery] = useState<string | null>(null);
  const [assignmentMessage, setAssignmentMessage] = useState<AssignmentMessage | null>(null);
  
  // Communication tab state
  const [selectedContact, setSelectedContact] = useState<ContactUser | null>(null); // Changed from selectedDriver
  const [messages, setMessages] = useState<TeamMessage[]>([]);
  const [newMessage, setNewMessage] = useState<string>('');
  const [loadingMessages, setLoadingMessages] = useState<boolean>(false);
  const [sendingMessage, setSendingMessage] = useState<boolean>(false);
  const [onlineUserIds, setOnlineUserIds] = useState<Set<string>>(new Set());
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

    if (autoRefresh) {
      const interval = setInterval(() => {
        if (!document.hidden) void loadData();
      }, 60000); // 60s instead of 10s

      return () => clearInterval(interval);
    }
  }, [autoRefresh]);

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

  const loadData = async (): Promise<void> => {
    try {
      console.log('[DeliveryTeam] Loading data...');
      const [driversRes, deliveriesRes, contactsRes] = await Promise.all([
        api.get('/admin/drivers'),
        api.get('/deliveries'),
        api.get('/messages/contacts') // Load all contacts
      ]);

      const allDrivers = (driversRes.data?.data || []) as ContactUser[];
      const driversList = allDrivers.filter(u => u.account?.role === 'driver');
      setDrivers(driversList);
      
      // Set contacts from API response
      const allContacts = (contactsRes.data?.contacts || []) as ContactUser[];
      const teamMembersList = (contactsRes.data?.teamMembers || []) as ContactUser[];
      const driverContacts = (contactsRes.data?.drivers || []) as ContactUser[];
      
      console.log('[DeliveryTeam] Contacts loaded:', {
        allContacts: allContacts.length,
        teamMembers: teamMembersList.length,
        drivers: driverContacts.length,
        driversFiltered: driversList.length
      });
      
      setContacts(allContacts);
      setTeamMembers(teamMembersList);

      const allDeliveries = (deliveriesRes.data?.data || []) as Delivery[];
      setDeliveries(allDeliveries);

      // Generate alerts
      const newAlerts: SystemAlert[] = [];
      driversList.forEach(driver => {
        if (!driver.tracking?.lastUpdate) {
          newAlerts.push({
            id: `no-gps-${driver.id}`,
            type: 'warning',
            driver: driver.fullName || driver.username,
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
    if (!newMessage.trim() || !selectedContact) return;

    setSendingMessage(true);
    try {
      await api.post('/messages/send', {
        content: newMessage.trim(),
        driverId: selectedContact.id
      });
      
      setNewMessage('');
      await loadMessages(selectedContact.id, true);
    } catch (err: unknown) {
      console.error('Error sending message:', err);
      alert('Failed to send message');
    } finally {
      setSendingMessage(false);
    }
  };

  const isContactOnline = (contact: ContactUser): boolean => {
    const userId = contact.id?.toString() || contact.id;
    
    // Check sessions first
    if (onlineUserIds.has(userId?.toString()) || onlineUserIds.has(userId)) {
      return true;
    }
    
    // Fallback to lastLogin check (5 minutes)
    if (!contact.account?.lastLogin) {
      return false;
    }
    
    const lastLogin = new Date(contact.account.lastLogin);
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const isOnline = lastLogin >= fiveMinutesAgo;
    
    if (isOnline) {
      console.debug(`[DeliveryTeam] User ${contact.fullName || contact.username} online via lastLogin:`, lastLogin);
    }
    
    return isOnline;
  };

  const activeDeliveries = deliveries.filter(d => {
    const dWithTracking = d as unknown as { tracking?: { driverId?: string } };
    return d.status !== 'delivered' && (dWithTracking.tracking?.driverId || d.assignedDriverId);
  });

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
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <button
              onClick={() => setAutoRefresh(!autoRefresh)}
              className={`min-h-[44px] px-3 sm:px-4 py-2 rounded-lg flex items-center gap-2 touch-manipulation ${
                autoRefresh
                  ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-300'
                  : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
              }`}
            >
              <RefreshCw className={`w-4 h-4 flex-shrink-0 ${autoRefresh ? 'animate-spin' : ''}`} />
              <span className="text-sm font-medium">{autoRefresh ? 'Auto-refresh ON' : 'Auto-refresh OFF'}</span>
            </button>
            <div className="text-xs sm:text-sm text-gray-500 dark:text-gray-400">
              Last update: {lastUpdate.toLocaleTimeString()}
            </div>
          </div>
      </div>

      {/* Tab Navigation - bigger gap, scroll on mobile */}
      <div className="pp-card px-2 py-2 mt-4 md:mt-6 mb-4 md:mb-6 overflow-x-auto">
        <nav className="flex flex-wrap gap-2 min-w-max md:min-w-0">
          {[
            { id: 'monitoring', label: 'Monitoring', icon: Activity },
            { id: 'control', label: 'Delivery Control', icon: Settings },
            { id: 'deliveries', label: 'Deliveries', icon: Package },
            { id: 'communication', label: 'Communication', icon: MessageSquare }
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

      {/* Monitoring Tab - mobile: map top, list bottom */}
      {activeTab === 'monitoring' && (
        <div className="flex flex-col space-y-4 md:space-y-6">
          {/* Stats */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
            <div className="pp-card p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600 dark:text-gray-400">Active Drivers</p>
                  <p className="text-2xl font-bold text-gray-900 dark:text-gray-100 mt-1">
                    {drivers.filter(d => isContactOnline(d)).length}
                  </p>
                </div>
                <Users className="w-8 h-8 text-blue-600 dark:text-blue-400" />
              </div>
            </div>

            <div className="pp-card p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600 dark:text-gray-400">Active Deliveries</p>
                  <p className="text-2xl font-bold text-gray-900 dark:text-gray-100 mt-1">
                    {activeDeliveries.length}
                  </p>
                </div>
                <Truck className="w-8 h-8 text-blue-600 dark:text-blue-400" />
              </div>
            </div>

            <div className="pp-card p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600 dark:text-gray-400">Completed Today</p>
                  <p className="text-2xl font-bold text-gray-900 dark:text-gray-100 mt-1">
                    {deliveries.filter(d => d.status === 'delivered').length}
                  </p>
                </div>
                <CheckCircle className="w-8 h-8 text-green-600 dark:text-green-400" />
              </div>
            </div>

            <div className="pp-card p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600 dark:text-gray-400">Alerts</p>
                  <p className="text-2xl font-bold text-gray-900 dark:text-gray-100 mt-1">
                    {alerts.length}
                  </p>
                </div>
                <AlertCircle className="w-8 h-8 text-red-600 dark:text-red-400" />
              </div>
            </div>
          </div>

          <div className="flex flex-col lg:grid lg:grid-cols-3 gap-4 lg:gap-6 min-h-0">
            {/* Live Map - top on mobile, left on desktop */}
            <div className="lg:col-span-2 pp-card overflow-hidden order-first w-full">
              <div className="p-3 sm:p-4 bg-gray-50 dark:bg-gray-700 border-b dark:border-gray-600">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Live Map View</h2>
              </div>
              <div className="h-[42vh] min-h-[240px] lg:h-[500px]">
                <DriverTrackingMap drivers={drivers as unknown as import('../types').Driver[]} />
              </div>
            </div>

            {/* Active Deliveries List - below map on mobile */}
            <div className="pp-card p-4 sm:p-6 flex flex-col min-h-0 flex-1 lg:flex-initial">
              <h2 className="text-lg font-semibold mb-3 sm:mb-4 text-gray-900 dark:text-gray-100">Active Deliveries</h2>
              <div className="space-y-3 flex-1 min-h-0 overflow-y-auto max-h-[50vh] lg:max-h-[500px]">
                {activeDeliveries.slice(0, 10).map(delivery => {
                  const dWithTracking = delivery as unknown as { tracking?: { eta?: string } };
                  return (
                    <div
                      key={delivery.id}
                      className="p-3 bg-gray-50 dark:bg-gray-700 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex-1">
                          <p className="font-medium text-gray-900 dark:text-gray-100">
                            {delivery.customer || 'Unknown Customer'}
                          </p>
                          <p className="text-xs text-gray-500 dark:text-gray-400">
                            PO: {delivery.poNumber || (delivery as unknown as { PONumber?: string }).PONumber || 'N/A'}
                          </p>
                        </div>
                        <span className={`px-2 py-1 rounded text-xs font-semibold ${
                          delivery.status === 'out-for-delivery'
                            ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300'
                            : 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300'
                        }`}>
                          {delivery.status || 'pending'}
                        </span>
                      </div>
                      <p className="text-xs text-gray-600 dark:text-gray-400 mb-2">
                        {delivery.address || 'N/A'}
                      </p>
                      {dWithTracking.tracking?.eta && (
                        <div className="text-xs text-gray-500 dark:text-gray-500 mt-1">
                          ETA: {new Date(dWithTracking.tracking.eta).toLocaleTimeString()}
                        </div>
                      )}
                    </div>
                  );
                })}
                {activeDeliveries.length === 0 && (
                  <div className="text-center py-8 text-gray-500 dark:text-gray-400">No active deliveries</div>
                )}
              </div>
            </div>
          </div>

          {/* Driver Status Panel */}
          <div className="pp-card p-6">
            <h2 className="text-lg font-semibold mb-4 text-gray-900 dark:text-gray-100">Driver Status</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {drivers.map(driver => {
                const isOnline = isContactOnline(driver);
                const driverLocation = driver.tracking?.location;
                
                return (
                  <div
                    key={driver.id}
                    className="p-4 border border-gray-200 dark:border-gray-700 rounded-lg hover:border-blue-500 dark:hover:border-blue-400 transition-colors"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-medium text-gray-900 dark:text-gray-100">
                        {driver.fullName || driver.username}
                      </span>
                      <div className={`w-2 h-2 rounded-full ${isOnline ? 'bg-green-500' : 'bg-gray-300'}`} />
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 space-y-1">
                      <div>Status: {isOnline ? 'Online' : 'Offline'}</div>
                      {driverLocation && (
                        <div className="flex items-center gap-1">
                          <MapPin className="w-3 h-3" />
                          GPS Active
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
              {drivers.length === 0 && (
                <div className="col-span-full text-center py-8 text-gray-500 dark:text-gray-400">
                  No drivers available
                </div>
              )}
            </div>
          </div>

          {/* Alerts Panel */}
          {alerts.length > 0 && (
            <div className="pp-card p-6">
              <h2 className="text-lg font-semibold mb-4 text-gray-900 dark:text-gray-100">System Alerts</h2>
              <div className="space-y-2">
                {alerts.slice(0, 5).map(alert => (
                  <div
                    key={alert.id}
                    className="flex items-center gap-3 p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg"
                  >
                    <AlertCircle className="w-5 h-5 text-yellow-600 dark:text-yellow-400 flex-shrink-0" />
                    <div className="flex-1">
                      <p className="text-sm text-gray-900 dark:text-gray-100">
                        <span className="font-medium">{alert.driver || alert.delivery}:</span> {alert.message}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        {formatMessageTimestamp(alert.timestamp)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Delivery Control Tab */}
      {activeTab === 'control' && (
        <div className="space-y-6">
          {/* Stats Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="pp-card p-6">
              <div className="text-center">
                <div className="text-sm text-gray-600 dark:text-gray-400">Total Deliveries</div>
                <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                  {deliveries.length}
                </div>
              </div>
            </div>
            <div className="bg-green-50 dark:bg-green-900/20 rounded p-4">
              <div className="text-center">
                <div className="text-sm text-gray-600 dark:text-gray-400">Assigned</div>
                <div className="text-2xl font-bold text-green-600 dark:text-green-400">
                  {deliveries.filter(d => {
                    const dWithTracking = d as unknown as { tracking?: { driverId?: string } };
                    return dWithTracking.tracking?.driverId || d.assignedDriverId;
                  }).length}
                </div>
              </div>
            </div>
            <div className="bg-yellow-50 dark:bg-yellow-900/20 rounded p-4">
              <div className="text-center">
                <div className="text-sm text-gray-600 dark:text-gray-400">Unassigned</div>
                <div className="text-2xl font-bold text-yellow-600 dark:text-yellow-400">
                  {deliveries.filter(d => {
                    const dWithTracking = d as unknown as { tracking?: { driverId?: string } };
                    return !dWithTracking.tracking?.driverId && !d.assignedDriverId;
                  }).length}
                </div>
              </div>
            </div>
            <div className="bg-blue-50 dark:bg-blue-900/20 rounded p-4">
              <div className="text-center">
                <div className="text-sm text-gray-600 dark:text-gray-400">Available Drivers</div>
                <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                  {drivers.length}
                </div>
              </div>
            </div>
          </div>

          {assignmentMessage && (
            <div className={`p-4 rounded-lg ${
              assignmentMessage.type === 'success'
                ? 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-800 dark:text-green-300'
                : 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-300'
            }`}>
              {assignmentMessage.text}
            </div>
          )}

          {/* Deliveries Assignment Table */}
          <div className="pp-card overflow-hidden">
            <div className="p-4 bg-gray-50 dark:bg-gray-700 border-b dark:border-gray-600">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Assign Deliveries to Drivers</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead className="bg-gray-50 dark:bg-gray-700">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">PO Number</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Customer</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Address</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Status</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Assigned Driver</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Change Assignment</th>
                  </tr>
                </thead>
                <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                  {deliveries && deliveries.length > 0 ? (
                    deliveries
                      .filter(delivery => {
                        const dWithTracking = delivery as unknown as { tracking?: { driverId?: string } };
                        const currentDriverId = dWithTracking.tracking?.driverId || delivery.assignedDriverId;
                        return !!currentDriverId;
                      })
                      .map(delivery => {
                        const dWithTracking = delivery as unknown as { tracking?: { driverId?: string } };
                        const currentDriverId = dWithTracking.tracking?.driverId || delivery.assignedDriverId;
                        const currentDriver = drivers.find(d => d.id === currentDriverId);
                        
                        return (
                          <tr key={delivery.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                            <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-gray-100">
                              {delivery.poNumber || (delivery as unknown as { PONumber?: string }).PONumber || 'N/A'}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100">
                              {delivery.customer || 'Unknown'}
                            </td>
                            <td className="px-6 py-4 text-sm text-gray-500 dark:text-gray-400 max-w-xs truncate">
                              {delivery.address || 'N/A'}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm">
                              <span className={`px-2 py-1 rounded-full text-xs font-semibold ${
                                delivery.status === 'delivered' ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300' :
                                delivery.status === 'pending' ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300' :
                                'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-300'
                              }`}>
                                {delivery.status || 'pending'}
                              </span>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm">
                              {currentDriver ? (
                                <div className="flex items-center gap-2">
                                  <div className="w-2 h-2 rounded-full bg-green-500"></div>
                                  <span className="text-gray-900 dark:text-gray-100 font-medium">
                                    {currentDriver.fullName || currentDriver.username}
                                  </span>
                                </div>
                              ) : (
                                <span className="text-gray-400 italic">Not assigned</span>
                              )}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm">
                              <select
                                value={currentDriverId || ''}
                                onChange={async (e: React.ChangeEvent<HTMLSelectElement>) => {
                                  const newDriverId = e.target.value;
                                  if (!newDriverId) return;
                                  
                                  setAssigningDelivery(delivery.id);
                                  setAssignmentMessage(null);
                                  
                                  try {
                                    await api.put(`/deliveries/admin/${delivery.id}/assign`, { driverId: newDriverId });
                                    
                                    setAssignmentMessage({
                                      type: 'success',
                                      text: `✓ Delivery assigned to ${drivers.find(d => d.id === newDriverId)?.fullName || 'driver'}`
                                    });
                                    
                                    setTimeout(() => {
                                      void loadData();
                                      setAssignmentMessage(null);
                                    }, 2000);
                                  } catch {
                                    setAssignmentMessage({
                                      type: 'error',
                                      text: 'Failed to assign delivery'
                                    });
                                  } finally {
                                    setAssigningDelivery(null);
                                  }
                                }}
                                disabled={assigningDelivery === delivery.id}
                                className="px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-gray-100 disabled:opacity-50"
                              >
                                {drivers.map(driver => (
                                  <option key={driver.id} value={driver.id}>
                                    {driver.fullName || driver.username}
                                  </option>
                                ))}
                              </select>
                            </td>
                          </tr>
                        );
                      })
                  ) : (
                    <tr>
                      <td colSpan={6} className="px-6 py-8 text-center text-gray-500 dark:text-gray-400">
                        No deliveries available
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
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
                        <div key={msg.id} className={`flex items-end gap-2 ${isSent ? 'justify-end' : 'justify-start'}`}>
                          {!isSent && (
                            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-gray-400 to-gray-600 flex-shrink-0 flex items-center justify-center text-white text-xs font-semibold shadow-sm">
                              {(selectedContact.fullName || selectedContact.username || '?')[0].toUpperCase()}
                            </div>
                          )}
                          <div className="max-w-[65%]">
                            <div className={`px-4 py-2.5 shadow-sm ${
                              isSent
                                ? 'bg-blue-600 dark:bg-blue-500 text-white rounded-2xl rounded-tr-sm'
                                : 'bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border border-gray-200 dark:border-gray-700 rounded-2xl rounded-tl-sm'
                            }`}>
                              <p className="text-sm leading-relaxed">{msg.content}</p>
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
                <div className="flex-shrink-0 px-4 py-3 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700">
                  <div className="flex items-center gap-3 bg-gray-100 dark:bg-gray-700 rounded-full px-4 py-2.5 focus-within:ring-2 focus-within:ring-blue-500 transition-all">
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
                    <button
                      onClick={() => void handleSendMessage()}
                      disabled={sendingMessage || !newMessage.trim()}
                      className="flex-shrink-0 w-8 h-8 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-full flex items-center justify-center transition-colors shadow-sm"
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
