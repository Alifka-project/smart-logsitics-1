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
  Circle
} from 'lucide-react';
import DriverTrackingMap from '../components/Tracking/DriverTrackingMap';

export default function AdminOperationsPage() {
  const [activeTab, setActiveTab] = useState('monitoring');
  const [drivers, setDrivers] = useState([]);
  const [deliveries, setDeliveries] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastUpdate, setLastUpdate] = useState(new Date());
  
  // Control tab state
  const [assigningDelivery, setAssigningDelivery] = useState(null);
  const [assignmentMessage, setAssignmentMessage] = useState(null);
  
  // Communication tab state
  const [selectedDriver, setSelectedDriver] = useState(null);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sendingMessage, setSendingMessage] = useState(false);
  const [onlineUserIds, setOnlineUserIds] = useState(new Set());
  const [contacts, setContacts] = useState([]);
  const [teamMembers, setTeamMembers] = useState([]);
  const [messageTemplates] = useState([
    'Please update delivery status',
    'New delivery assigned',
    'Please contact customer',
    'Delivery rescheduled',
    'Emergency: Return to warehouse'
  ]);
  
  // Unread message count per driver (for Communication tab badges)
  const [unreadByDriverId, setUnreadByDriverId] = useState({});
  // Refs for auto-scroll and polling
  const messagesEndRef = useRef(null);
  const messagePollingIntervalRef = useRef(null);
  // Refs to prevent duplicate API calls
  const loadingDataRef = useRef(false);
  const loadingOnlineStatusRef = useRef(false);
  const location = useLocation();

  const formatMessageTimestamp = (value) => {
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

  // Load online status - same logic as User Management and Dashboard pages
  const loadOnlineStatus = useCallback(async (silent = false) => {
    // Prevent duplicate calls
    if (loadingOnlineStatusRef.current) return;
    loadingOnlineStatusRef.current = true;
    
    try {
      // Try to get active sessions first
      let activeSessionUserIds = new Set();
      try {
        const sessionsResponse = await api.get('/admin/drivers/sessions');
        if (sessionsResponse.data?.sessions) {
          activeSessionUserIds = new Set(
            sessionsResponse.data.sessions
              .map(s => s.userId?.toString() || s.userId)
              .filter(Boolean)
          );
          if (!silent) {
            console.debug(`[AdminOps] Loaded ${activeSessionUserIds.size} users from sessions`);
          }
        }
      } catch (e) {
        // Fallback to time-based detection using contacts
        if (!silent) {
          console.debug('[AdminOps] Sessions failed, using lastLogin fallback');
        }
        const now = new Date();
        const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);
        
        // Check all contacts (which includes all user types)
        contacts.forEach(contact => {
          if (contact.account?.lastLogin) {
            const lastLogin = new Date(contact.account.lastLogin);
            if (lastLogin >= fiveMinutesAgo) {
              const userId = contact.id?.toString() || contact.id;
              activeSessionUserIds.add(userId);
            }
          }
        });
        
        if (!silent) {
          console.debug(`[AdminOps] Fallback found ${activeSessionUserIds.size} users active in last 5 minutes`);
        }
      }

      // Always update to ensure sync with other pages
      setOnlineUserIds(activeSessionUserIds);
    } catch (e) {
      console.error('Error loading online status:', e);
    } finally {
      loadingOnlineStatusRef.current = false;
    }
  }, [contacts]);

  // Fetch unread message counts per driver (for badge on each driver in Communication tab) - must be defined before useEffect that uses it
  const loadUnreadCounts = useCallback(async () => {
    try {
      const response = await api.get('/messages/unread');
      const counts = response.data || {};
      setUnreadByDriverId(typeof counts === 'object' ? counts : {});
    } catch (err) {
      if (err?.response?.status !== 403) {
        console.error('Failed to load unread counts:', err);
      }
    }
  }, []);

  const loadData = async () => {
    // Prevent duplicate calls
    if (loadingDataRef.current) return;
    loadingDataRef.current = true;
    
    try {
      const [driversResp, deliveriesResp, contactsResp] = await Promise.allSettled([
        api.get('/admin/tracking/drivers').catch(() => ({ data: { drivers: [] } })),
        api.get('/admin/tracking/deliveries').catch(() => ({ data: { deliveries: [] } })),
        api.get('/messages/contacts').catch(() => ({ data: { contacts: [], teamMembers: [], drivers: [] } }))
      ]);

      if (driversResp.status === 'fulfilled') {
        setDrivers(driversResp.value.data?.drivers || []);
      }

      // Load contacts for Communication tab (includes all users - drivers, admin, delivery_team, etc.)
      if (contactsResp.status === 'fulfilled') {
        const contactsData = contactsResp.value.data;
        setContacts(contactsData?.contacts || []);
        setTeamMembers(contactsData?.teamMembers || []);
      }

      if (deliveriesResp.status === 'fulfilled') {
        const deliveryData = deliveriesResp.value.data?.deliveries || [];
        setDeliveries(deliveryData);
        
        // Generate alerts from data
        const newAlerts = generateAlerts(deliveryData, driversResp.value.data?.drivers || []);
        setAlerts(newAlerts);
      }

      setLastUpdate(new Date());
      
      // Refresh online status when data loads
      loadOnlineStatus(true);
    } catch (e) {
      console.error('Error loading operations data:', e);
    } finally {
      setLoading(false);
      loadingDataRef.current = false;
    }
  };

  useEffect(() => {
    loadData();
    loadOnlineStatus(false);
    
    let interval = null;
    let currentPollInterval = 60000; // Start with 60 seconds
    let previousDataLength = null;
    
    if (autoRefresh) {
      const smartPoll = async () => {
        // Skip polling when tab is hidden
        if (document.hidden) {
          interval = setTimeout(smartPoll, currentPollInterval);
          return;
        }
        await loadData();
        
        // Check if data changed by comparing lengths
        const currentDataLength = `${deliveries.length}-${drivers.length}`;
        
        if (previousDataLength !== currentDataLength && previousDataLength !== null) {
          // Data changed, speed up polling
          currentPollInterval = Math.max(45000, currentPollInterval * 0.8);
        } else if (previousDataLength === currentDataLength) {
          // No change, slow down polling
          currentPollInterval = Math.min(180000, currentPollInterval * 1.3);
        }
        
        previousDataLength = currentDataLength;
        
        // Schedule next poll with adaptive interval
        if (autoRefresh) {
          interval = setTimeout(smartPoll, currentPollInterval);
        }
      };
      
      // Start smart polling after initial delay
      interval = setTimeout(smartPoll, currentPollInterval);
    }

    // Auto-refresh online status - only when tab is visible
    let onlineInterval = setInterval(() => {
      if (!document.hidden) loadOnlineStatus(true);
    }, 90000); // 90s instead of 60s

    return () => {
      if (interval) clearTimeout(interval);
      if (onlineInterval) clearInterval(onlineInterval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefresh]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const tab = params.get('tab');
    const driverId = params.get('driverId');
    const allowedTabs = new Set(['monitoring', 'control', 'communication', 'alerts']);

    if (tab && allowedTabs.has(tab) && tab !== activeTab) {
      setActiveTab(tab);
    } else if (driverId && activeTab !== 'communication') {
      setActiveTab('communication');
    }
  }, [location.search, activeTab]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const driverId = params.get('driverId');
    if (!driverId || drivers.length === 0) return;
    const match = drivers.find(driver => String(driver.id) === String(driverId));
    if (match && String(selectedDriver?.id) !== String(match.id)) {
      setSelectedDriver(match);
    }
  }, [location.search, drivers, selectedDriver]);

  // Refresh online status when contacts are loaded (for fallback detection)
  useEffect(() => {
    if (contacts.length > 0) {
      loadOnlineStatus(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contacts.length]);

  // Load messages when driver is selected - poll every 30s, pause when hidden
  useEffect(() => {
    if (selectedDriver?.id) {
      loadMessages(selectedDriver.id);
      messagePollingIntervalRef.current = setInterval(() => {
        if (!document.hidden && activeTab === 'communication') {
          loadMessages(selectedDriver.id, true);
        }
      }, 30000); // 30s instead of 15s
    }
    return () => {
      if (messagePollingIntervalRef.current) {
        clearInterval(messagePollingIntervalRef.current);
        messagePollingIntervalRef.current = null;
      }
    };
  }, [selectedDriver, activeTab]);

  // When on Communication tab, load and poll unread counts - 60s, pause when hidden
  useEffect(() => {
    if (activeTab !== 'communication') return;
    loadUnreadCounts();
    const interval = setInterval(() => {
      if (!document.hidden) loadUnreadCounts();
    }, 60000); // 60s instead of 30s
    return () => clearInterval(interval);
  }, [activeTab, loadUnreadCounts]);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  const loadMessages = async (driverId, silent = false) => {
    if (!driverId) return;

    if (!silent) setLoadingMessages(true);
    try {
      const response = await api.get(`/messages/conversations/${driverId}`);
      const messagesData = response.data?.messages || [];
      if (!silent) {
        console.log(`✓ Loaded ${messagesData.length} messages with driver ${driverId}`);
        console.log('First message sample:', messagesData[0]);
        if (messagesData.length > 0) {
          console.log('Message fields:', {
            hasSenderRole: 'senderRole' in messagesData[0],
            senderRole: messagesData[0].senderRole,
            hasFrom: 'from' in messagesData[0],
            from: messagesData[0].from
          });
        }
      }
      setMessages(messagesData);
    } catch (error) {
      if (!silent) {
        console.error('Failed to load messages:', error);
        console.error('Error details:', error.response?.data);
      }
      setMessages([]);
    } finally {
      if (!silent) setLoadingMessages(false);
    }
  };

  const handleSendMessage = async () => {
    if (!newMessage.trim() || !selectedDriver) return;

    const messageText = newMessage.trim();
    setSendingMessage(true);

    try {
      const response = await api.post('/messages/send', {
        driverId: selectedDriver.id,
        content: messageText
      });

      // Add message to state
      if (response.data?.message) {
        setMessages(prev => [...prev, {
          ...response.data.message,
          from: 'admin',
          senderRole: 'admin',
          text: response.data.message.content
        }]);
        console.log('✓ Message sent successfully');
      }
      
      setNewMessage('');
    } catch (error) {
      console.error('Failed to send message:', error);
      alert(`Failed to send message: ${error.response?.data?.error || error.message}`);
    } finally {
      setSendingMessage(false);
    }
  };

  const generateAlerts = (deliveries, drivers) => {
    const alertsList = [];
    const now = new Date();

    // Check for delayed deliveries
    deliveries.forEach(delivery => {
      if (delivery.tracking?.eta) {
        const eta = new Date(delivery.tracking.eta);
        const delayMinutes = (now - eta) / (1000 * 60);
        
        if (delayMinutes > 30) {
          alertsList.push({
            id: `delay-${delivery.id}`,
            type: 'urgent',
            title: `Delivery #${delivery.id?.slice(0, 8)} delayed`,
            message: `Delayed by ${Math.round(delayMinutes)} minutes`,
            timestamp: now
          });
        }
      }
    });

    // Check for idle drivers
    drivers.forEach(driver => {
      if (driver.tracking?.lastUpdate) {
        const lastUpdate = new Date(driver.tracking.lastUpdate);
        const idleMinutes = (now - lastUpdate) / (1000 * 60);
        
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

  // Helper function to check if driver is online
  const isDriverOnline = (driver) => {
    const driverIdStr = driver.id?.toString();
    const driverIdNum = driver.id;
    
    // Check session-based online status first
    if (onlineUserIds.has(driverIdStr) || 
        onlineUserIds.has(driverIdNum) ||
        onlineUserIds.has(String(driverIdNum)) ||
        driver.tracking?.online) {
      return true;
    }
    
    // Fallback to lastLogin check (5 minutes window)
    if (driver.account?.lastLogin) {
      const lastLogin = new Date(driver.account.lastLogin);
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
      return lastLogin >= fiveMinutesAgo;
    }
    
    return false;
  };

  const onlineDrivers = drivers.filter(d => isDriverOnline(d));
  const activeDeliveries = deliveries.filter(d => 
    d.tracking?.status === 'in_progress' || d.status?.toLowerCase() === 'out-for-delivery'
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
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-800 dark:text-gray-100">Operations Center</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Last updated: {lastUpdate.toLocaleTimeString()}
            {autoRefresh && <span className="ml-2 text-green-600 dark:text-green-400">● Live</span>}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="rounded"
            />
            <span className="text-sm text-gray-700 dark:text-gray-300">Auto-refresh</span>
          </label>
          <button
            onClick={loadData}
            className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm flex items-center gap-2"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh Now
          </button>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="border-b border-gray-200 dark:border-gray-700">
        <nav className="flex space-x-8">
          {[
            { id: 'monitoring', label: 'Monitoring', icon: Activity },
            { id: 'control', label: 'Control', icon: Settings },
            { id: 'communication', label: 'Communication', icon: MessageSquare },
            { id: 'alerts', label: 'Alerts', icon: AlertCircle }
          ].map(tab => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`
                  flex items-center gap-2 py-4 px-1 border-b-2 font-medium text-sm
                  ${activeTab === tab.id
                    ? 'border-primary-600 dark:border-primary-400 text-primary-600 dark:text-primary-400'
                    : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600'
                  }
                `}
              >
                <Icon className="w-5 h-5" />
                {tab.label}
                {tab.id === 'alerts' && alerts.length > 0 && (
                  <span className="ml-2 bg-red-500 text-white text-xs rounded-full px-2 py-0.5">
                    {alerts.length}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Tab Content */}
      {activeTab === 'monitoring' && (
        <div className="space-y-6">
          {/* Stats Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 transition-colors">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm text-gray-600 dark:text-gray-400 mb-1">Active Deliveries</div>
                  <div className="text-3xl font-bold text-gray-800 dark:text-gray-100">{activeDeliveries.length}</div>
                </div>
                <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                  <Truck className="w-6 h-6 text-blue-600 dark:text-blue-400" />
                </div>
              </div>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 transition-colors">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm text-gray-600 dark:text-gray-400 mb-1">Online Drivers</div>
                  <div className="text-3xl font-bold text-green-600 dark:text-green-400">{onlineDrivers.length}</div>
                </div>
                <div className="p-3 bg-green-50 dark:bg-green-900/20 rounded-lg">
                  <Users className="w-6 h-6 text-green-600 dark:text-green-400" />
                </div>
              </div>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 transition-colors">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm text-gray-600 dark:text-gray-400 mb-1">Total Drivers</div>
                  <div className="text-3xl font-bold text-gray-800 dark:text-gray-100">{drivers.length}</div>
                </div>
                <div className="p-3 bg-purple-50 dark:bg-purple-900/20 rounded-lg">
                  <Users className="w-6 h-6 text-purple-600 dark:text-purple-400" />
                </div>
              </div>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 transition-colors">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm text-gray-600 dark:text-gray-400 mb-1">Active Alerts</div>
                  <div className="text-3xl font-bold text-red-600 dark:text-red-400">{alerts.length}</div>
                </div>
                <div className="p-3 bg-red-50 dark:bg-red-900/20 rounded-lg">
                  <AlertCircle className="w-6 h-6 text-red-600 dark:text-red-400" />
                </div>
              </div>
            </div>
          </div>

          {/* Map and Lists */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Map */}
            <div className="lg:col-span-2 bg-white dark:bg-gray-800 rounded-lg shadow-lg overflow-hidden transition-colors">
              <div className="p-4 bg-gray-50 dark:bg-gray-700 border-b dark:border-gray-600">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Live Map View</h2>
              </div>
              <div className="h-[500px]">
                <DriverTrackingMap drivers={drivers} />
              </div>
            </div>

            {/* Active Deliveries List */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 transition-colors">
              <h2 className="text-lg font-semibold mb-4 text-gray-900 dark:text-gray-100">Active Deliveries</h2>
              <div className="space-y-3 max-h-[500px] overflow-y-auto">
                {activeDeliveries.slice(0, 10).map(delivery => (
                  <div key={delivery.id} className="p-3 border border-gray-200 dark:border-gray-700 rounded-lg">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                        #{delivery.id?.slice(0, 8) || 'N/A'}
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
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 transition-colors">
            <h2 className="text-lg font-semibold mb-4 text-gray-900 dark:text-gray-100">Driver Status</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {drivers.map(driver => {
                const isOnline = isDriverOnline(driver);
                const location = driver.tracking?.location;
                
                return (
                  <div key={driver.id} className="p-4 border border-gray-200 dark:border-gray-700 rounded-lg">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <div className="relative">
                          <div className={`w-3 h-3 rounded-full ${isOnline ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`}>
                            {isOnline && (
                              <div className="absolute inset-0 bg-green-500 rounded-full animate-ping opacity-75"></div>
                            )}
                          </div>
                        </div>
                        <span className="font-medium text-sm text-gray-900 dark:text-gray-100">
                          {driver.full_name || driver.username || 'Unknown'}
                        </span>
                      </div>
                    </div>
                    <div className="text-xs text-gray-600 dark:text-gray-400 space-y-1">
                      <div>Status: {driver.tracking?.status || 'offline'}</div>
                      {location && (
                        <>
                          <div>Speed: {location.speed ? `${(location.speed * 3.6).toFixed(0)} km/h` : 'N/A'}</div>
                          <div>Last Update: {new Date(location.timestamp || driver.tracking?.lastUpdate).toLocaleTimeString()}</div>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'control' && (
        <div className="space-y-6">
          {/* Control Header */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 transition-colors">
            <h2 className="text-2xl font-bold mb-4 text-gray-900 dark:text-gray-100">
              Delivery Assignment Control
            </h2>
            <p className="text-gray-600 dark:text-gray-400 mb-4">
              Assign and reassign deliveries to drivers. Select a driver from the dropdown to assign.
            </p>

            {/* Assignment Message */}
            {assignmentMessage && (
              <div className={`mb-4 p-4 rounded-lg ${
                assignmentMessage.type === 'success' 
                  ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300'
                  : 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300'
              }`}>
                {assignmentMessage.text}
              </div>
            )}

            {/* Stats */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="bg-primary-50 dark:bg-primary-900/20 rounded p-4">
                <div className="text-sm text-gray-600 dark:text-gray-400">Total Deliveries</div>
                <div className="text-2xl font-bold text-primary-600 dark:text-primary-400">{deliveries.length}</div>
              </div>
              <div className="bg-green-50 dark:bg-green-900/20 rounded p-4">
                <div className="text-sm text-gray-600 dark:text-gray-400">Assigned</div>
                <div className="text-2xl font-bold text-green-600 dark:text-green-400">
                  {deliveries.filter(d => d.tracking?.driverId || d.assignedDriverId).length}
                </div>
              </div>
              <div className="bg-yellow-50 dark:bg-yellow-900/20 rounded p-4">
                <div className="text-sm text-gray-600 dark:text-gray-400">Unassigned</div>
                <div className="text-2xl font-bold text-yellow-600 dark:text-yellow-400">
                  {deliveries.filter(d => !d.tracking?.driverId && !d.assignedDriverId).length}
                </div>
              </div>
              <div className="bg-blue-50 dark:bg-blue-900/20 rounded p-4">
                <div className="text-sm text-gray-600 dark:text-gray-400">Available Drivers</div>
                <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                  {drivers.length}
                </div>
              </div>
            </div>
          </div>

          {/* Deliveries Assignment Table */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden transition-colors">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead className="bg-gray-50 dark:bg-gray-700">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">PO Number</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Customer</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Address</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Status</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Assigned Driver</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Change Assignment</th>
                  </tr>
                </thead>
                <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                  {deliveries && deliveries.length > 0 ? (
                    deliveries
                      .filter(delivery => {
                        // Only show deliveries that have an assigned driver
                        const currentDriverId = delivery.tracking?.driverId || delivery.assignedDriverId;
                        return !!currentDriverId;
                      })
                      .map(delivery => {
                        const currentDriverId = delivery.tracking?.driverId || delivery.assignedDriverId;
                        const currentDriver = drivers.find(d => d.id === currentDriverId);
                        
                        return (
                          <tr key={delivery.id} className="hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                            <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-gray-100">
                              {delivery.poNumber || delivery.PONumber || delivery.metadata?.originalPONumber || 'N/A'}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100">
                              {delivery.customer || delivery.Customer || 'Unknown'}
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
                                    {currentDriver.fullName || currentDriver.full_name || currentDriver.username}
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
                                  const response = await api.put(`/deliveries/admin/${delivery.id}/assign`, { driverId: newDriverId });
                                  console.log(`✓ Assigned delivery ${delivery.id} to driver ${newDriverId}`);
                                  
                                  setAssignmentMessage({
                                    type: 'success',
                                    text: `✓ Delivery assigned to ${drivers.find(d => d.id === newDriverId)?.fullName || 'driver'}`
                                  });
                                  
                                  // Reload data after short delay
                                  setTimeout(() => {
                                    loadData();
                                  }, 500);
                                } catch (err) {
                                  console.error('Failed to assign delivery:', err);
                                  setAssignmentMessage({
                                    type: 'error',
                                    text: `✗ Failed to assign delivery: ${err.response?.data?.error || err.message}`
                                  });
                                } finally {
                                  setAssigningDelivery(null);
                                  // Clear message after 3 seconds
                                  setTimeout(() => setAssignmentMessage(null), 3000);
                                }
                              }}
                              disabled={assigningDelivery === delivery.id}
                              className={`px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-600 transition ${
                                assigningDelivery === delivery.id ? 'opacity-50 cursor-not-allowed' : ''
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
                      <td colSpan={7} className="px-6 py-12 text-center text-gray-500 dark:text-gray-400">
                        No deliveries found
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'communication' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-[calc(100vh-300px)]">
          {/* Contacts List Sidebar */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg overflow-hidden flex flex-col transition-colors">
            <div className="p-4 bg-gray-50 dark:bg-gray-700 border-b dark:border-gray-600">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Contacts</h2>
              <input
                type="text"
                placeholder="Search contacts..."
                className="mt-2 w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              />
            </div>
            <div className="flex-1 overflow-y-auto">
              {/* Team Members Section */}
              {teamMembers.length > 0 && (
                <>
                  <div className="px-4 py-2 bg-gray-100 dark:bg-gray-700/50">
                    <span className="text-xs font-medium text-gray-600 dark:text-gray-400 uppercase">Team</span>
                  </div>
                  {teamMembers.map(member => {
                    const isOnline = isDriverOnline(member);
                    const isSelected = selectedDriver?.id === member.id;
                    const unreadCount = unreadByDriverId[member.id] || 0;
                    const getRoleBadge = (role) => {
                      const roleConfig = {
                        admin: { label: 'Admin', color: 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300' },
                        driver: { label: 'Driver', color: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300' },
                        delivery_team: { label: 'Delivery', color: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300' },
                        sales_ops: { label: 'Sales', color: 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300' },
                        manager: { label: 'Manager', color: 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300' }
                      };
                      return roleConfig[role] || { label: role, color: 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300' };
                    };
                    const roleBadge = getRoleBadge(member.account?.role || member.role);
                    
                    return (
                      <button
                        key={member.id}
                        onClick={() => setSelectedDriver(member)}
                        className={`w-full p-4 border-b border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 text-left transition ${
                          isSelected ? 'bg-primary-50 dark:bg-primary-900/20 border-l-4 border-l-primary-600 dark:border-l-primary-400' : ''
                        }`}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            <div className="relative">
                              <div className={`w-3 h-3 rounded-full ${isOnline ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`}>
                                {isOnline && (
                                  <div className="absolute inset-0 bg-green-500 rounded-full animate-ping opacity-75"></div>
                                )}
                              </div>
                            </div>
                            <span className="font-medium text-sm text-gray-900 dark:text-gray-100">
                              {member.full_name || member.fullName || member.username || 'Unknown'}
                            </span>
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${roleBadge.color}`}>
                              {roleBadge.label}
                            </span>
                            {isOnline && (
                              <span className="text-xs text-green-600 dark:text-green-400 font-medium">• Active</span>
                            )}
                          </div>
                          {unreadCount > 0 && (
                            <span className="bg-red-500 text-white text-xs rounded-full px-2 py-0.5">
                              {unreadCount}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">
                          {isOnline ? (
                            <span className="text-green-600 dark:text-green-400 font-medium">Active now</span>
                          ) : (
                            <span>Offline</span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </>
              )}
              
              {/* Drivers Section */}
              {drivers.length > 0 && (
                <>
                  <div className="px-4 py-2 bg-gray-100 dark:bg-gray-700/50">
                    <span className="text-xs font-medium text-gray-600 dark:text-gray-400 uppercase">Drivers</span>
                  </div>
                  {drivers.map(driver => {
                    const isOnline = isDriverOnline(driver);
                    const isSelected = selectedDriver?.id === driver.id;
                    const unreadCount = unreadByDriverId[driver.id] || 0;
                    const getRoleBadge = (role) => {
                      const roleConfig = {
                        admin: { label: 'Admin', color: 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300' },
                        driver: { label: 'Driver', color: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300' },
                        delivery_team: { label: 'Delivery', color: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300' },
                        sales_ops: { label: 'Sales', color: 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300' },
                        manager: { label: 'Manager', color: 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300' }
                      };
                      return roleConfig[role] || { label: role, color: 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300' };
                    };
                    const roleBadge = getRoleBadge(driver.role);
                    
                    return (
                      <button
                        key={driver.id}
                        onClick={() => setSelectedDriver(driver)}
                        className={`w-full p-4 border-b border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 text-left transition ${
                          isSelected ? 'bg-primary-50 dark:bg-primary-900/20 border-l-4 border-l-primary-600 dark:border-l-primary-400' : ''
                        }`}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            <div className="relative">
                              <div className={`w-3 h-3 rounded-full ${isOnline ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`}>
                                {isOnline && (
                                  <div className="absolute inset-0 bg-green-500 rounded-full animate-ping opacity-75"></div>
                                )}
                              </div>
                            </div>
                            <span className="font-medium text-sm text-gray-900 dark:text-gray-100">
                              {driver.full_name || driver.fullName || driver.username || 'Unknown'}
                            </span>
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${roleBadge.color}`}>
                              {roleBadge.label}
                            </span>
                            {isOnline && (
                              <span className="text-xs text-green-600 dark:text-green-400 font-medium">• Active</span>
                            )}
                          </div>
                          {unreadCount > 0 && (
                            <span className="bg-red-500 text-white text-xs rounded-full px-2 py-0.5">
                              {unreadCount}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">
                          {isOnline ? (
                            <span className="text-green-600 dark:text-green-400 font-medium">Active now</span>
                          ) : (
                            <span>Offline</span>
                          )}
                          {driver.tracking?.location && (
                            <span className="ml-2">
                              • {driver.tracking.location.speed ? `${(driver.tracking.location.speed * 3.6).toFixed(0)} km/h` : 'Stationary'}
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
          <div className="lg:col-span-2 bg-white dark:bg-gray-800 rounded-lg shadow-lg overflow-hidden flex flex-col transition-colors">
            {selectedDriver ? (
              <>
                {/* Chat Header */}
                <div className="p-4 bg-gray-50 dark:bg-gray-700 border-b dark:border-gray-600 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="relative">
                      {(() => {
                        const isOnline = isDriverOnline(selectedDriver);
                        return (
                          <>
                            <div className={`w-10 h-10 rounded-full bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center ${
                              isOnline ? 'ring-2 ring-green-500/20' : ''
                            }`}>
                              <Users className="w-5 h-5 text-primary-600 dark:text-primary-400" />
                            </div>
                            {isOnline && (
                              <div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 bg-green-500 border-2 border-white dark:border-gray-800 rounded-full animate-pulse">
                                <div className="absolute inset-0 bg-green-500 rounded-full animate-ping opacity-75"></div>
                              </div>
                            )}
                          </>
                        );
                      })()}
                    </div>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold text-gray-900 dark:text-gray-100">
                          {selectedDriver.full_name || selectedDriver.fullName || selectedDriver.username || 'Unknown'}
                        </h3>
                        {(() => {
                          const roleConfig = {
                            admin: { label: 'Admin', color: 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300' },
                            driver: { label: 'Driver', color: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300' },
                            delivery_team: { label: 'Delivery', color: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300' },
                            sales_ops: { label: 'Sales', color: 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300' },
                            manager: { label: 'Manager', color: 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300' }
                          };
                          const roleBadge = roleConfig[selectedDriver.role] || { label: selectedDriver.role, color: 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300' };
                          return (
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${roleBadge.color}`}>
                              {roleBadge.label}
                            </span>
                          );
                        })()}
                        {isDriverOnline(selectedDriver) && (
                          <span className="text-xs text-green-600 dark:text-green-400 font-medium">• Active</span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {isDriverOnline(selectedDriver) ? (
                          <span className="text-green-600 dark:text-green-400 font-medium">Active now</span>
                        ) : (
                          <span>Offline</span>
                        )}
                        {selectedDriver.phone && ` • ${selectedDriver.phone}`}
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    {selectedDriver.phone && (
                      <a
                        href={`tel:${selectedDriver.phone}`}
                        className="p-2 text-gray-600 dark:text-gray-400 hover:text-primary-600 dark:hover:text-primary-400 hover:bg-gray-100 dark:hover:bg-gray-600 rounded-lg transition"
                        title="Call Driver"
                      >
                        <Phone className="w-5 h-5" />
                      </a>
                    )}
                    <button
                      onClick={() => {
                        // TODO: Request location
                        alert('Location request sent');
                      }}
                      className="p-2 text-gray-600 dark:text-gray-400 hover:text-primary-600 dark:hover:text-primary-400 hover:bg-gray-100 dark:hover:bg-gray-600 rounded-lg transition"
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
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 dark:border-primary-400 mx-auto mb-2"></div>
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
                      // Determine if message is from admin based on senderRole field
                      const isAdminMessage = msg.senderRole === 'admin';
                      
                      const messageText = msg.text || msg.content || '';
                      const messageTime = msg.timestamp || msg.createdAt;
                      
                      return (
                        <div
                          key={idx}
                          className={`flex ${isAdminMessage ? 'justify-end' : 'justify-start'}`}
                        >
                          <div
                            className={`max-w-[70%] rounded-lg p-3 ${
                              isAdminMessage
                                ? 'bg-primary-600 dark:bg-primary-500 text-white'
                                : 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 border border-gray-200 dark:border-gray-600'
                            }`}
                          >
                            <p className="text-sm">{messageText}</p>
                            <p className={`text-xs mt-1 ${isAdminMessage ? 'text-primary-100' : 'text-gray-500 dark:text-gray-400'}`}>
                              {formatMessageTimestamp(messageTime)}
                            </p>
                          </div>
                        </div>
                      );
                    })
                  )}
                  {/* Auto-scroll anchor */}
                  <div ref={messagesEndRef} />
                </div>

                {/* Message Templates */}
                <div className="px-4 py-2 bg-gray-50 dark:bg-gray-700 border-t dark:border-gray-600 border-b dark:border-gray-600">
                  <div className="flex gap-2 overflow-x-auto">
                    {messageTemplates.map((template, idx) => (
                      <button
                        key={idx}
                        onClick={() => setNewMessage(template)}
                        className="px-3 py-1 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg text-xs hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-900 dark:text-gray-100 whitespace-nowrap transition-colors"
                      >
                        {template}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Message Input */}
                <div className="p-4 bg-white dark:bg-gray-800 border-t dark:border-gray-600 transition-colors">
                  <div className="flex gap-2">
                    <button
                      className="p-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition"
                      title="Attach File"
                    >
                      <Paperclip className="w-5 h-5" />
                    </button>
                    <input
                      type="text"
                      value={newMessage}
                      onChange={(e) => setNewMessage(e.target.value)}
                      onKeyPress={(e) => {
                        if (e.key === 'Enter' && newMessage.trim() && !sendingMessage) {
                          handleSendMessage();
                        }
                      }}
                      placeholder="Type a message..."
                      disabled={sendingMessage}
                      className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 focus:ring-2 focus:ring-primary-500 focus:border-primary-500 disabled:opacity-50"
                    />
                    <button
                      onClick={handleSendMessage}
                      disabled={!newMessage.trim() || sendingMessage}
                      className="px-4 py-2 bg-primary-600 dark:bg-primary-500 text-white rounded-lg hover:bg-primary-700 dark:hover:bg-primary-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transition-colors"
                    >
                      {sendingMessage ? (
                        <>
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                          Sending...
                        </>
                      ) : (
                        <>
                          <Send className="w-4 h-4" />
                          Send
                        </>
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

      {activeTab === 'alerts' && (
        <div className="space-y-6">
          {/* Alert Summary */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 transition-colors">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm text-red-700 dark:text-red-300 mb-1">Urgent Alerts</div>
                  <div className="text-2xl font-bold text-red-600 dark:text-red-400">
                    {alerts.filter(a => a.type === 'urgent').length}
                  </div>
                </div>
                <AlertCircle className="w-8 h-8 text-red-600 dark:text-red-400" />
              </div>
            </div>
            <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4 transition-colors">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm text-yellow-700 dark:text-yellow-300 mb-1">Warnings</div>
                  <div className="text-2xl font-bold text-yellow-600 dark:text-yellow-400">
                    {alerts.filter(a => a.type === 'warning').length}
                  </div>
                </div>
                <Clock className="w-8 h-8 text-yellow-600 dark:text-yellow-400" />
              </div>
            </div>
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4 transition-colors">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm text-blue-700 dark:text-blue-300 mb-1">Info Alerts</div>
                  <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                    {alerts.filter(a => a.type === 'info').length}
                  </div>
                </div>
                <Activity className="w-8 h-8 text-blue-600 dark:text-blue-400" />
              </div>
            </div>
          </div>

          {/* Alerts List */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow transition-colors">
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
                alerts.map(alert => (
                  <div
                    key={alert.id}
                    className={`p-4 border-l-4 transition-colors ${
                      alert.type === 'urgent'
                        ? 'bg-red-50 dark:bg-red-900/20 border-red-500 dark:border-red-400'
                        : alert.type === 'warning'
                        ? 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-500 dark:border-yellow-400'
                        : 'bg-blue-50 dark:bg-blue-900/20 border-blue-500 dark:border-blue-400'
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-start gap-3 flex-1">
                        {alert.type === 'urgent' ? (
                          <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 mt-0.5 flex-shrink-0" />
                        ) : alert.type === 'warning' ? (
                          <Clock className="w-5 h-5 text-yellow-600 dark:text-yellow-400 mt-0.5 flex-shrink-0" />
                        ) : (
                          <Activity className="w-5 h-5 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
                        )}
                        <div className="flex-1">
                          <div className="font-semibold text-gray-900 dark:text-gray-100">{alert.title}</div>
                          <div className="text-sm text-gray-600 dark:text-gray-400 mt-1">{alert.message}</div>
                          <div className="text-xs text-gray-500 dark:text-gray-500 mt-2">
                            {alert.timestamp.toLocaleTimeString()} • {alert.timestamp.toLocaleDateString()}
                          </div>
                        </div>
                      </div>
                      <div className="flex gap-2 ml-4">
                        <button 
                          onClick={() => alert(`View details for: ${alert.title}`)}
                          className="px-3 py-1 text-sm bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
                        >
                          View
                        </button>
                        <button 
                          onClick={() => {
                            // TODO: Dismiss alert
                            alert('Alert dismissed');
                          }}
                          className="px-3 py-1 text-sm bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                        >
                          Dismiss
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

