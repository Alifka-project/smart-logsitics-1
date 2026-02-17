import React, { useEffect, useState, useCallback, useRef } from 'react';
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
  Package
} from 'lucide-react';
import DriverTrackingMap from '../components/Tracking/DriverTrackingMap';

export default function DeliveryTeamPortal() {
  const [activeTab, setActiveTab] = useState('monitoring');
  const [drivers, setDrivers] = useState([]);
  const [contacts, setContacts] = useState([]); // All contacts (drivers + team members)
  const [teamMembers, setTeamMembers] = useState([]); // Admin + delivery_team
  const [deliveries, setDeliveries] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastUpdate, setLastUpdate] = useState(new Date());
  
  // Control tab state
  const [assigningDelivery, setAssigningDelivery] = useState(null);
  const [assignmentMessage, setAssignmentMessage] = useState(null);
  
  // Communication tab state
  const [selectedContact, setSelectedContact] = useState(null); // Changed from selectedDriver
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sendingMessage, setSendingMessage] = useState(false);
  const [onlineUserIds, setOnlineUserIds] = useState(new Set());
  const [messageTemplates] = useState([
    'Please update delivery status',
    'New delivery assigned',
    'Please contact customer',
    'Delivery rescheduled',
    'Emergency: Return to warehouse'
  ]);
  
  // Unread message count per driver
  const [unreadByDriverId, setUnreadByDriverId] = useState({});
  const messagesEndRef = useRef(null);
  const messagePollingIntervalRef = useRef(null);
  const location = useLocation();

  const formatMessageTimestamp = (value) => {
    if (!value) return '';
    const date = new Date(value);
    if (isNaN(date.getTime())) return '';
    const now = new Date();
    const diff = Math.abs(now - date);
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
    
    console.log('[DeliveryTeamPortal] Current user:', currentUser.sub, 'Role:', currentUser.account?.role);

    loadData();

    if (autoRefresh) {
      const interval = setInterval(() => {
        loadData();
      }, 10000);

      return () => clearInterval(interval);
    }
  }, [autoRefresh]);

  // Load online users after contacts are loaded
  useEffect(() => {
    if (contacts.length > 0) {
      loadOnlineUsers();
      
      // Set up interval for online status refresh
      const onlineInterval = setInterval(() => {
        loadOnlineUsers();
      }, 10000);
      
      return () => clearInterval(onlineInterval);
    }
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

  // Load unread counts when in communication tab
  useEffect(() => {
    if (activeTab === 'communication') {
      loadUnreadCounts();
      const interval = setInterval(loadUnreadCounts, 5000);
      return () => clearInterval(interval);
    }
  }, [activeTab]);

  // Load messages when contact is selected
  useEffect(() => {
    console.log('[DeliveryTeam] selectedContact changed:', selectedContact?.id, selectedContact?.fullName || selectedContact?.username);
    if (selectedContact) {
      loadMessages(selectedContact.id);
      
      const interval = setInterval(() => {
        loadMessages(selectedContact.id, true);
      }, 5000);
      
      messagePollingIntervalRef.current = interval;
      return () => {
        if (messagePollingIntervalRef.current) {
          clearInterval(messagePollingIntervalRef.current);
        }
      };
    }
  }, [selectedContact]);

  useEffect(() => {
    if (activeTab !== 'communication') return;
    if (!messagesEndRef.current) return;
    
    requestAnimationFrame(() => {
      if (messagesEndRef.current) {
        messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
      }
    });
  }, [messages, activeTab]);

  const loadData = async () => {
    try {
      console.log('[DeliveryTeam] Loading data...');
      const [driversRes, deliveriesRes, contactsRes] = await Promise.all([
        api.get('/admin/drivers'),
        api.get('/deliveries'),
        api.get('/messages/contacts') // Load all contacts
      ]);

      const allDrivers = driversRes.data?.data || [];
      const driversList = allDrivers.filter(u => u.account?.role === 'driver');
      setDrivers(driversList);
      
      // Set contacts from API response
      const allContacts = contactsRes.data?.contacts || [];
      const teamMembersList = contactsRes.data?.teamMembers || [];
      const driverContacts = contactsRes.data?.drivers || [];
      
      console.log('[DeliveryTeam] Contacts loaded:', {
        allContacts: allContacts.length,
        teamMembers: teamMembersList.length,
        drivers: driverContacts.length,
        driversFiltered: driversList.length
      });
      
      setContacts(allContacts);
      setTeamMembers(teamMembersList);

      const allDeliveries = deliveriesRes.data?.data || [];
      setDeliveries(allDeliveries);

      // Generate alerts
      const newAlerts = [];
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
        if (!delivery.tracking?.driverId && !delivery.assignedDriverId) {
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
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadOnlineUsers = async () => {
    try {
      // Try to get active sessions first
      let activeSessionUserIds = new Set();
      try {
        const response = await api.get('/admin/drivers/sessions');
        if (response.data?.sessions) {
          activeSessionUserIds = new Set(
            response.data.sessions
              .map(s => s.userId?.toString() || s.userId)
              .filter(Boolean)
          );
          console.debug(`[DeliveryTeam] Loaded ${activeSessionUserIds.size} online users from sessions`);
        }
      } catch (sessionError) {
        console.debug('[DeliveryTeam] Sessions endpoint error, using time-based fallback:', sessionError.message);
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
    } catch (error) {
      console.error('Error loading online users:', error);
    }
  };

  const loadUnreadCounts = async () => {
    try {
      const response = await api.get('/messages/unread');
      if (response.data && typeof response.data === 'object') {
        setUnreadByDriverId(response.data);
      }
    } catch (error) {
      console.error('Error loading unread counts:', error);
    }
  };

  const loadMessages = async (contactId, silent = false) => {
    console.log('[DeliveryTeam] loadMessages called with contactId:', contactId, 'silent:', silent);
    if (!silent) setLoadingMessages(true);
    try {
      const response = await api.get(`/messages/conversations/${contactId}`);
      const messages = response.data?.messages || [];
      console.log('[DeliveryTeam] Loaded messages:', messages.length, 'messages');
      setMessages(messages);
      
      // Update unread count
      setUnreadByDriverId(prev => ({
        ...prev,
        [contactId]: 0
      }));
    } catch (error) {
      console.error('[DeliveryTeam] Error loading messages:', error);
      if (!silent) console.error('Error loading messages:', error);
    } finally {
      if (!silent) setLoadingMessages(false);
    }
  };

  const handleSendMessage = async () => {
    if (!newMessage.trim() || !selectedContact) return;

    setSendingMessage(true);
    try {
      await api.post('/messages/send', {
        content: newMessage.trim(),
        driverId: selectedContact.id
      });
      
      setNewMessage('');
      await loadMessages(selectedContact.id, true);
    } catch (error) {
      console.error('Error sending message:', error);
      alert('Failed to send message');
    } finally {
      setSendingMessage(false);
    }
  };

  const isContactOnline = (contact) => {
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

  const activeDeliveries = deliveries.filter(d => 
    d.status !== 'delivered' && (d.tracking?.driverId || d.assignedDriverId)
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto mb-4"></div>
          <p className="text-gray-600 dark:text-gray-400">Loading operations center...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl sm:text-4xl font-bold text-gray-900 dark:text-gray-100">Delivery Team Portal</h1>
            <p className="text-sm sm:text-base text-gray-600 dark:text-gray-300 mt-2">
              Monitor drivers, manage deliveries, and coordinate operations
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setAutoRefresh(!autoRefresh)}
              className={`px-4 py-2 rounded-lg flex items-center gap-2 ${
                autoRefresh
                  ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-300'
                  : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
              }`}
            >
              <RefreshCw className={`w-4 h-4 ${autoRefresh ? 'animate-spin' : ''}`} />
              {autoRefresh ? 'Auto-refresh ON' : 'Auto-refresh OFF'}
            </button>
            <div className="text-sm text-gray-500 dark:text-gray-400">
              Last update: {lastUpdate.toLocaleTimeString()}
            </div>
          </div>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm">
        <div className="border-b border-gray-200 dark:border-gray-700">
          <nav className="flex space-x-8 px-6">
            {[
              { id: 'monitoring', label: 'Monitoring', icon: Activity },
              { id: 'control', label: 'Delivery Control', icon: Settings },
              { id: 'communication', label: 'Communication', icon: MessageSquare }
            ].map(tab => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`
                    flex items-center gap-2 py-4 px-1 border-b-2 font-medium text-sm transition-colors
                    ${activeTab === tab.id
                      ? 'border-primary-600 text-primary-600 dark:text-primary-400'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300'
                    }
                  `}
                >
                  <Icon className="w-5 h-5" />
                  {tab.label}
                </button>
              );
            })}
          </nav>
        </div>
      </div>

      {/* Monitoring Tab */}
      {activeTab === 'monitoring' && (
        <div className="space-y-6">
          {/* Stats */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600 dark:text-gray-400">Active Drivers</p>
                  <p className="text-2xl font-bold text-gray-900 dark:text-gray-100 mt-1">
                    {drivers.filter(d => isContactOnline(d)).length}
                  </p>
                </div>
                <Users className="w-8 h-8 text-primary-600 dark:text-primary-400" />
              </div>
            </div>

            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
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

            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
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

            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
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

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Live Map */}
            <div className="lg:col-span-2 bg-white dark:bg-gray-800 rounded-lg shadow-lg overflow-hidden">
              <div className="p-4 bg-gray-50 dark:bg-gray-700 border-b dark:border-gray-600">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Live Map View</h2>
              </div>
              <div className="h-[500px]">
                <DriverTrackingMap drivers={drivers} />
              </div>
            </div>

            {/* Active Deliveries List */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
              <h2 className="text-lg font-semibold mb-4 text-gray-900 dark:text-gray-100">Active Deliveries</h2>
              <div className="space-y-3 max-h-[500px] overflow-y-auto">
                {activeDeliveries.slice(0, 10).map(delivery => (
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
                          PO: {delivery.poNumber || delivery.PONumber || 'N/A'}
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
                    {delivery.tracking?.eta && (
                      <div className="text-xs text-gray-500 dark:text-gray-500 mt-1">
                        ETA: {new Date(delivery.tracking.eta).toLocaleTimeString()}
                      </div>
                    )}
                  </div>
                ))}
                {activeDeliveries.length === 0 && (
                  <div className="text-center py-8 text-gray-500 dark:text-gray-400">No active deliveries</div>
                )}
              </div>
            </div>
          </div>

          {/* Driver Status Panel */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold mb-4 text-gray-900 dark:text-gray-100">Driver Status</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {drivers.map(driver => {
                const isOnline = isContactOnline(driver);
                const location = driver.tracking?.location;
                
                return (
                  <div
                    key={driver.id}
                    className="p-4 border border-gray-200 dark:border-gray-700 rounded-lg hover:border-primary-500 dark:hover:border-primary-400 transition-colors"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-medium text-gray-900 dark:text-gray-100">
                        {driver.fullName || driver.username}
                      </span>
                      <div className={`w-2 h-2 rounded-full ${isOnline ? 'bg-green-500' : 'bg-gray-300'}`} />
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 space-y-1">
                      <div>Status: {isOnline ? 'Online' : 'Offline'}</div>
                      {location && (
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
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
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
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
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
                  {deliveries.filter(d => d.tracking?.driverId || d.assignedDriverId).length}
                </div>
              </div>
            </div>
            <div className="bg-yellow-50 dark:bg-yellow-900/20 rounded p-4">
              <div className="text-center">
                <div className="text-sm text-gray-600 dark:text-gray-400">Unassigned</div>
                <div className="text-2xl font-bold text-yellow-600 dark:text-yellow-400">
                  {deliveries.filter(d => !d.tracking?.driverId && !d.assignedDriverId).length}
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
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
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
                        const currentDriverId = delivery.tracking?.driverId || delivery.assignedDriverId;
                        return !!currentDriverId;
                      })
                      .map(delivery => {
                        const currentDriverId = delivery.tracking?.driverId || delivery.assignedDriverId;
                        const currentDriver = drivers.find(d => d.id === currentDriverId);
                        
                        return (
                          <tr key={delivery.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                            <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-gray-100">
                              {delivery.poNumber || delivery.PONumber || 'N/A'}
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
                                onChange={async (e) => {
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
                                      loadData();
                                      setAssignmentMessage(null);
                                    }, 2000);
                                  } catch (err) {
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
                      <td colSpan="6" className="px-6 py-8 text-center text-gray-500 dark:text-gray-400">
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

      {/* Communication Tab */}
      {activeTab === 'communication' && (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Contacts List */}
          <div className="lg:col-span-1 bg-white dark:bg-gray-800 rounded-lg shadow">
            <div className="p-4 border-b border-gray-200 dark:border-gray-700">
              <h3 className="font-semibold text-gray-900 dark:text-gray-100">Contacts</h3>
            </div>
            <div className="divide-y divide-gray-200 dark:divide-gray-700 max-h-[600px] overflow-y-auto">
              {/* Team Members Section */}
              {teamMembers.length > 0 && (
                <>
                  <div className="px-4 py-2 bg-gray-50 dark:bg-gray-700/50">
                    <span className="text-xs font-medium text-gray-600 dark:text-gray-400 uppercase">Team</span>
                  </div>
                  {teamMembers.map(member => {
                    const isOnline = isContactOnline(member);
                    const unreadCount = unreadByDriverId[member.id] || 0;
                    
                    return (
                      <button
                        key={member.id}
                        onClick={() => setSelectedContact(member)}
                        className={`w-full p-4 text-left hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors ${
                          selectedContact?.id === member.id ? 'bg-primary-50 dark:bg-primary-900/20' : ''
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-medium text-gray-900 dark:text-gray-100">
                            {member.fullName || member.username}
                          </span>
                          {unreadCount > 0 && (
                            <span className="px-2 py-0.5 bg-red-500 text-white text-xs rounded-full">
                              {unreadCount}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                          <div className={`w-2 h-2 rounded-full ${isOnline ? 'bg-green-500' : 'bg-gray-300'}`} />
                          {isOnline ? 'Online' : 'Offline'}
                          <span className="ml-1">• {member.role}</span>
                        </div>
                      </button>
                    );
                  })}
                </>
              )}
              
              {/* Drivers Section */}
              {drivers.length > 0 && (
                <>
                  <div className="px-4 py-2 bg-gray-50 dark:bg-gray-700/50">
                    <span className="text-xs font-medium text-gray-600 dark:text-gray-400 uppercase">Drivers</span>
                  </div>
                  {drivers.map(driver => {
                    const isOnline = isContactOnline(driver);
                    const unreadCount = unreadByDriverId[driver.id] || 0;
                    
                    return (
                      <button
                        key={driver.id}
                        onClick={() => setSelectedContact(driver)}
                        className={`w-full p-4 text-left hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors ${
                          selectedContact?.id === driver.id ? 'bg-primary-50 dark:bg-primary-900/20' : ''
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-medium text-gray-900 dark:text-gray-100">
                            {driver.fullName || driver.username}
                          </span>
                          {unreadCount > 0 && (
                            <span className="px-2 py-0.5 bg-red-500 text-white text-xs rounded-full">
                              {unreadCount}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                          <div className={`w-2 h-2 rounded-full ${isOnline ? 'bg-green-500' : 'bg-gray-300'}`} />
                          {isOnline ? 'Online' : 'Offline'}
                        </div>
                      </button>
                    );
                  })}
                </>
              )}
              
              {contacts.length === 0 && (
                <div className="p-8 text-center text-gray-500 dark:text-gray-400">
                  No contacts available
                </div>
              )}
            </div>
          </div>

          {/* Chat Area */}
          <div className="lg:col-span-3 bg-white dark:bg-gray-800 rounded-lg shadow flex flex-col h-[600px]">
            {selectedContact ? (
              <>
                {/* Chat Header */}
                <div className="p-4 border-b border-gray-200 dark:border-gray-700">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`w-3 h-3 rounded-full ${isContactOnline(selectedContact) ? 'bg-green-500' : 'bg-gray-300'}`} />
                      <div>
                        <h3 className="font-semibold text-gray-900 dark:text-gray-100">
                          {selectedContact.fullName || selectedContact.username}
                        </h3>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          {isContactOnline(selectedContact) ? 'Online' : 'Offline'}
                          {selectedContact.account?.role && ` • ${selectedContact.account.role === 'admin' ? 'Admin' : selectedContact.account.role === 'delivery_team' ? 'Delivery Team' : 'Driver'}`}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => loadMessages(selectedContact.id)}
                      className="p-2 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
                    >
                      <RefreshCw className="w-5 h-5" />
                    </button>
                  </div>
                </div>

                {/* Messages */}
                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                  {loadingMessages && messages.length === 0 ? (
                    <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                      Loading messages...
                    </div>
                  ) : messages.length === 0 ? (
                    <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                      No messages yet. Start a conversation!
                    </div>
                  ) : (
                    messages.map(msg => {
                      const currentUser = getCurrentUser();
                      const currentUserId = currentUser?.sub;
                      const currentUserRole = currentUser?.account?.role || currentUser?.role;
                      
                      // Determine if message is sent by current user
                      // Method 1: Check if adminId matches current user (for admin/delivery_team sending)
                      const msgAdminId = String(msg.adminId);
                      const userId = String(currentUserId);
                      const isSentByAdminId = msgAdminId === userId;
                      
                      // Method 2: Check if senderRole matches current user role
                      const isSentByRole = msg.senderRole === currentUserRole;
                      
                      // Use role-based check for delivery_team
                      const isSent = currentUserRole === 'delivery_team' ? isSentByRole : isSentByAdminId;
                      
                      // Debug logging for first message
                      if (messages.indexOf(msg) === 0) {
                        console.log('[DeliveryTeam Message Debug]', {
                          messageId: msg.id,
                          adminId: msg.adminId,
                          driverId: msg.driverId,
                          senderRole: msg.senderRole,
                          currentUserId: currentUserId,
                          currentUserRole: currentUserRole,
                          isSentByAdminId,
                          isSentByRole,
                          isSent,
                          content: msg.content?.substring(0, 20)
                        });
                      }
                      
                      return (
                        <div
                          key={msg.id}
                          className={`flex ${isSent ? 'justify-end' : 'justify-start'}`}
                        >
                          <div className={`max-w-[70%] rounded-lg p-3 ${
                            isSent
                              ? 'bg-primary-600 text-white'
                              : 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-gray-100'
                          }`}>
                            <p className="text-sm">{msg.content}</p>
                            <p className={`text-xs mt-1 ${
                              isSent
                                ? 'text-primary-100'
                                : 'text-gray-500 dark:text-gray-400'
                            }`}>
                              {formatMessageTimestamp(msg.createdAt)}
                            </p>
                          </div>
                        </div>
                      );
                    })
                  )}
                  <div ref={messagesEndRef} />
                </div>

                {/* Message Templates */}
                <div className="px-4 py-2 border-t border-gray-200 dark:border-gray-700">
                  <div className="flex gap-2 overflow-x-auto">
                    {messageTemplates.map((template, index) => (
                      <button
                        key={index}
                        onClick={() => setNewMessage(template)}
                        className="px-3 py-1.5 text-xs bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-full hover:bg-gray-200 dark:hover:bg-gray-600 whitespace-nowrap"
                      >
                        {template}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Input Area */}
                <div className="p-4 border-t border-gray-200 dark:border-gray-700">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newMessage}
                      onChange={(e) => setNewMessage(e.target.value)}
                      onKeyPress={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          handleSendMessage();
                        }
                      }}
                      placeholder="Type a message..."
                      className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
                      disabled={sendingMessage}
                    />
                    <button
                      onClick={handleSendMessage}
                      disabled={sendingMessage || !newMessage.trim()}
                      className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                    >
                      <Send className="w-5 h-5" />
                      Send
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-gray-500 dark:text-gray-400">
                <div className="text-center">
                  <MessageSquare className="w-12 h-12 mx-auto mb-2 opacity-50" />
                  <p>Select a contact to start messaging</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
