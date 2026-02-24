import React, { useEffect, useState, useCallback, useMemo } from 'react';
import api, { setAuthToken } from '../frontend/apiClient';
import { BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid, AreaChart, Area } from 'recharts';
import { 
  Package, CheckCircle, XCircle, Clock, MapPin, TrendingUp, Users, Activity, 
  Truck, AlertCircle, FileText, Calendar, DollarSign, Target, Zap, Circle
} from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import DeliveryDetailModal from '../components/DeliveryDetailModal';

function ensureAuth() {
  const token = localStorage.getItem('auth_token');
  if (token) {
    setAuthToken(token);
  }
}

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8'];

export default function AdminDashboardPage() {
  const [data, setData] = useState(null);
  const [drivers, setDrivers] = useState([]);
  const [deliveries, setDeliveries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState(new Date());
  const [activeTab, setActiveTab] = useState('overview');
  const [selectedDelivery, setSelectedDelivery] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [onlineUserIds, setOnlineUserIds] = useState(new Set());
  const [showAllDeliveries, setShowAllDeliveries] = useState(false);
  const [deliverySearch, setDeliverySearch] = useState('');
  const [deliveryStatusFilter, setDeliveryStatusFilter] = useState('all');
  const [deliveryPage, setDeliveryPage] = useState(0);
  const [deliveryDateFrom, setDeliveryDateFrom] = useState('');
  const [deliveryDateTo, setDeliveryDateTo] = useState('');
  const [deliverySortBy, setDeliverySortBy] = useState('date');
  const [deliverySortDir, setDeliverySortDir] = useState('desc');
  const navigate = useNavigate();
  const location = useLocation();

  // Load online status for drivers tab - same logic as User Management page
  const loadOnlineStatus = useCallback(async (silent = false) => {
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
        }
      } catch (e) {
        // Fallback to time-based detection
        const usersResponse = await api.get('/admin/drivers');
        const allUsers = usersResponse.data?.data || [];
        const now = new Date();
        const twoMinutesAgo = new Date(now.getTime() - 2 * 60 * 1000);
        
        allUsers.forEach(u => {
          if (u.account?.lastLogin) {
            const lastLogin = new Date(u.account.lastLogin);
            if (lastLogin >= twoMinutesAgo) {
              const userId = u.id?.toString() || u.id;
              activeSessionUserIds.add(userId);
            }
          }
        });
      }

      // Always update to ensure sync with User Management page
      setOnlineUserIds(activeSessionUserIds);
    } catch (e) {
      console.error('Error loading online status:', e);
    }
  }, []);

  const loadDashboardData = useCallback(async () => {
    try {
      const [dashboardResp, driversResp, deliveriesResp] = await Promise.allSettled([
        api.get('/admin/dashboard'),
        api.get('/admin/drivers').catch(() => ({ data: { data: [] } })),
        api.get('/admin/tracking/deliveries').catch(() => ({ data: { deliveries: [] } }))
      ]);

      if (dashboardResp.status === 'fulfilled') {
        // API returns { drivers, recentLocations, smsRecent, totals, recentCounts }
        setData(dashboardResp.value.data);
        setLastUpdate(new Date());
      } else {
        console.error('[Dashboard] Error loading dashboard:', dashboardResp.reason?.message);
        setData({ error: 'fetch_failed' });
      }

      if (driversResp.status === 'fulfilled') {
        // Filter to only show drivers (not admin accounts)
        const allUsers = driversResp.value.data?.data || [];
        const driversOnly = allUsers.filter(u => {
          const role = u.account?.role || 'driver';
          return role === 'driver'; // Only show driver role accounts
        });
        setDrivers(driversOnly);
        
        // Refresh online status after drivers are loaded
        if (activeTab === 'drivers') {
          setTimeout(() => {
            loadOnlineStatus(true);
          }, 100);
        }
      }

      if (deliveriesResp.status === 'fulfilled') {
        setDeliveries(deliveriesResp.value.data?.deliveries || []);
      }
    } catch (e) {
      console.error('[Dashboard] Error loading dashboard:', e.message);
      setData({ error: 'fetch_failed' });
    } finally {
      setLoading(false);
    }
  }, [activeTab, loadOnlineStatus]);

  useEffect(() => {
    ensureAuth();
    let mounted = true;

    const loadData = async () => {
      if (!mounted) return;
      await loadDashboardData();
    };

    loadData();

    // Refresh once when tab becomes visible again
    const handleVisChange = () => {
      if (!document.hidden && mounted) loadDashboardData();
    };
    document.addEventListener('visibilitychange', handleVisChange);

    // Refresh when deliveries are created/updated via app actions
    const handleDeliveriesUpdated = () => { if (mounted) loadDashboardData(); };
    const handleDeliveryStatusUpdated = () => { if (mounted) loadDashboardData(); };
    window.addEventListener('deliveriesUpdated', handleDeliveriesUpdated);
    window.addEventListener('deliveryStatusUpdated', handleDeliveryStatusUpdated);

    return () => {
      mounted = false;
      document.removeEventListener('visibilitychange', handleVisChange);
      window.removeEventListener('deliveriesUpdated', handleDeliveriesUpdated);
      window.removeEventListener('deliveryStatusUpdated', handleDeliveryStatusUpdated);
    };
  }, [loadDashboardData]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const tab = params.get('tab');
    const allowedTabs = new Set(['overview', 'deliveries', 'drivers', 'performance']);
    if (tab && allowedTabs.has(tab) && tab !== activeTab) {
      setActiveTab(tab);
    }
  }, [location.search, activeTab]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const deliveryId = params.get('delivery');
    if (!deliveryId || deliveries.length === 0) return;
    const match = deliveries.find(delivery => String(delivery.id || delivery.ID) === String(deliveryId));
    if (match) {
      setSelectedDelivery(match);
      setIsModalOpen(true);
    }
  }, [location.search, deliveries]);

  // Auto-refresh online status when on drivers tab or when dashboard refreshes
  useEffect(() => {
    if (activeTab === 'drivers') {
      // Load immediately
      loadOnlineStatus(false);
      
      // Use visibility API to pause updates when tab is hidden
      let interval = null;
      
      const handleVisibilityChange = () => {
        if (document.hidden) {
          if (interval) {
            clearInterval(interval);
            interval = null;
          }
        } else {
          if (!interval) {
            loadOnlineStatus(true);
            interval = setInterval(() => {
              loadOnlineStatus(true);
            }, 30000); // 30s instead of 5s
          }
        }
      };
      
      if (!document.hidden) {
        const timeout = setTimeout(() => {
          interval = setInterval(() => {
            loadOnlineStatus(true);
          }, 30000); // 30s instead of 5s
        }, 5000);
        
        return () => {
          clearTimeout(timeout);
          if (interval) clearInterval(interval);
          document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
      }
      
      document.addEventListener('visibilitychange', handleVisibilityChange);
      
      return () => {
        if (interval) clearInterval(interval);
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      };
    }
  }, [activeTab, loadOnlineStatus]);

  // Also refresh online status when dashboard data refreshes
  useEffect(() => {
    if (activeTab === 'drivers') {
      loadOnlineStatus(true);
    }
  }, [drivers, activeTab, loadOnlineStatus]);

  // Safely extract data with defaults - MUST be before any conditional returns (React hooks rule)
  const totals = (data && data.totals) ? { ...data.totals } : { 
    total: 0, 
    delivered: 0, 
    cancelled: 0, 
    rescheduled: 0, 
    pending: 0,
    customerAccepted: 0,
    customerCancelled: 0,
    customerRescheduled: 0,
    withPOD: 0,
    withoutPOD: 0
  };
  const recent = (data && data.recentCounts) ? { ...data.recentCounts } : { delivered: 0, cancelled: 0, rescheduled: 0 };
  const activeDrivers = drivers?.filter(d => d.active !== false).length || 0;

  // Get recent deliveries (last 10) - safely handle empty arrays
  const recentDeliveries = (deliveries && Array.isArray(deliveries) ? deliveries : [])
    .sort((a, b) => {
      const dateA = new Date(a.created_at || a.createdAt || a.created || 0);
      const dateB = new Date(b.created_at || b.createdAt || b.created || 0);
      return dateB - dateA;
    })
    .slice(0, 10);

  // Get active deliveries - safely handle empty arrays
  const activeDeliveries = (deliveries && Array.isArray(deliveries) ? deliveries : []).filter(d => {
    const status = (d.status || '').toLowerCase();
    return ['out-for-delivery', 'in-progress', 'assigned', 'scheduled', 'scheduled-confirmed'].includes(status);
  }).slice(0, 10);

  // Chart data
  const statusChartData = [
    { name: 'Delivered', value: totals.delivered, color: '#10b981' },
    { name: 'Cancelled', value: totals.cancelled, color: '#ef4444' },
    { name: 'Rescheduled', value: totals.rescheduled, color: '#f59e0b' },
    { name: 'Pending', value: totals.pending, color: '#6b7280' },
  ];

  const pieChartData = statusChartData.filter(d => d.value > 0);

  const recentTrendData = [
    { name: 'Delivered', value: recent.delivered || 0 },
    { name: 'Cancelled', value: recent.cancelled || 0 },
    { name: 'Rescheduled', value: recent.rescheduled || 0 },
  ];

  // Calculate real daily performance data from deliveries (last 7 days) - MUST be before conditional returns
  const dailyPerformance = useMemo(() => {
    const daysOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const dailyData = {};
    
    // Initialize all days with zeros
    daysOfWeek.forEach(day => {
      dailyData[day] = { day, deliveries: 0, success: 0 };
    });

    if (deliveries && Array.isArray(deliveries) && deliveries.length > 0) {
      const now = new Date();
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      
      deliveries.forEach(delivery => {
        const createdDateStr = delivery.created_at || delivery.createdAt || delivery.created;
        if (!createdDateStr) return;
        
        const createdDate = new Date(createdDateStr);
        
        // Only count deliveries from the last 7 days
        if (createdDate >= sevenDaysAgo && createdDate <= now) {
          const dayName = daysOfWeek[createdDate.getDay()];
          if (dailyData[dayName]) {
            dailyData[dayName].deliveries++;
            
            // Count successful deliveries
            const status = (delivery.status || '').toLowerCase();
            if (['delivered', 'done', 'completed', 'delivered-with-installation', 'delivered-without-installation'].includes(status)) {
              dailyData[dayName].success++;
            }
          }
        }
      });
    }

    // Return array in order: Mon-Sat (skip Sunday)
    return [
      dailyData['Mon'],
      dailyData['Tue'],
      dailyData['Wed'],
      dailyData['Thu'],
      dailyData['Fri'],
      dailyData['Sat'],
    ];
  }, [deliveries]);

  // Now handle conditional returns AFTER all hooks are defined
  if (loading && !data) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto mb-4"></div>
          <p className="text-gray-600 dark:text-gray-400">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  // Handle error state - but still show basic layout
  if (data?.error) {
    return (
      <div className="space-y-6">
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <div className="text-red-600 dark:text-red-400 font-semibold">Error loading dashboard</div>
          <div className="text-red-500 dark:text-red-400 text-sm mt-1">
            {data.error === 'fetch_failed' ? 'Failed to fetch dashboard data. Please check your connection and try again.' : data.error}
          </div>
          <button
            onClick={() => {
              setLoading(true);
              setData(null);
              loadDashboardData();
            }}
            className="mt-4 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  // If no data at all, show empty state
  if (!data) {
    return (
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold text-gray-800 dark:text-gray-100">Admin Dashboard</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Last updated: {lastUpdate.toLocaleTimeString()}
            </p>
          </div>
          <button
            onClick={() => {
              setLoading(true);
              loadDashboardData();
            }}
            className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm"
          >
            Load Dashboard
          </button>
        </div>
        <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
          <p className="text-yellow-800 dark:text-yellow-300">
            Dashboard data not loaded. Click "Load Dashboard" to fetch data.
          </p>
        </div>
      </div>
    );
  }

  // Calculate success rate
  const successRate = totals.total > 0 
    ? ((totals.delivered / totals.total) * 100).toFixed(1)
    : '0.0';

  // Calculate cancellation rate
  const cancellationRate = totals.total > 0
    ? ((totals.cancelled / totals.total) * 100).toFixed(1)
    : '0.0';

  const tabs = [
    { id: 'overview', label: 'Overview', icon: Activity },
    { id: 'deliveries', label: 'Deliveries', icon: Package },
    { id: 'drivers', label: 'Drivers', icon: Users },
    { id: 'performance', label: 'Performance', icon: TrendingUp },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-800 dark:text-gray-100">Admin Dashboard</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Last updated: {lastUpdate.toLocaleTimeString()}
            <span className="ml-2 text-green-600 dark:text-green-400">● Live</span>
          </p>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="border-b border-gray-200 dark:border-gray-700">
        <nav className="flex space-x-8">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`
                  flex items-center gap-2 py-4 px-1 border-b-2 font-medium text-sm transition-colors
                  ${activeTab === tab.id
                    ? 'border-primary-600 dark:border-primary-400 text-primary-600 dark:text-primary-400'
                    : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600'
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

      {/* Tab Content */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
      {/* Key Metrics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          icon={Package}
          label="Total Deliveries"
          value={totals.total}
          color="blue"
          trend={null}
        />
        <MetricCard
          icon={CheckCircle}
          label="Delivered"
          value={totals.delivered}
          color="green"
          trend={`${successRate}% success rate`}
        />
        <MetricCard
          icon={Clock}
          label="Pending"
          value={totals.pending}
          color="yellow"
          trend={`${totals.total > 0 ? ((totals.pending / totals.total) * 100).toFixed(1) : 0}% of total`}
        />
        <MetricCard
          icon={XCircle}
          label="Cancelled"
          value={totals.cancelled}
          color="red"
          trend={`${cancellationRate}% cancellation rate`}
        />
      </div>

      {/* Secondary Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <MetricCard
          icon={Users}
          label="Active Drivers"
          value={activeDrivers}
          color="purple"
          trend={`${drivers.length} total drivers`}
        />
        <MetricCard
          icon={Activity}
          label="Recent Locations"
          value={data?.recentLocations || 0}
          color="indigo"
          trend="Last 24 hours"
        />
        <MetricCard
          icon={TrendingUp}
          label="Recent Deliveries (24h)"
          value={recent.delivered + recent.cancelled + recent.rescheduled}
          color="pink"
          trend={`${recent.delivered} delivered`}
        />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Status Breakdown - Bar Chart */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 transition-colors">
              <h2 className="text-xl font-semibold mb-4 text-gray-900 dark:text-gray-100">Status Breakdown</h2>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={statusChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" className="dark:stroke-gray-700" />
                  <XAxis dataKey="name" stroke="#6b7280" className="dark:stroke-gray-400" />
                  <YAxis stroke="#6b7280" className="dark:stroke-gray-400" />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: 'rgba(255, 255, 255, 0.95)',
                      border: '1px solid #e5e7eb',
                      borderRadius: '8px',
                      color: '#111827'
                    }}
                    wrapperClassName="dark:!bg-gray-800 dark:!border-gray-700 dark:!text-gray-100"
                  />
                  <Bar dataKey="value" fill="#2563EB" radius={[8, 8, 0, 0]}>
                {statusChartData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Status Distribution - Pie Chart */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 transition-colors">
              <h2 className="text-xl font-semibold mb-4 text-gray-900 dark:text-gray-100">Status Distribution</h2>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={pieChartData}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                outerRadius={100}
                fill="#8884d8"
                dataKey="value"
              >
                {pieChartData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: 'rgba(255, 255, 255, 0.95)',
                      border: '1px solid #e5e7eb',
                      borderRadius: '8px',
                      color: '#111827'
                    }}
                    wrapperClassName="dark:!bg-gray-800 dark:!border-gray-700 dark:!text-gray-100"
                  />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

          {/* Customer Response & POD Metrics */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Customer Response Metrics */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 transition-colors">
              <h2 className="text-xl font-semibold mb-4 text-gray-900 dark:text-gray-100">Customer Response Status</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <MetricCard
                  icon={CheckCircle}
                  label="Customer Accepted"
                  value={totals.customerAccepted || 0}
                  color="green"
                  trend={`${totals.total > 0 ? ((totals.customerAccepted / totals.total) * 100).toFixed(1) : 0}% acceptance rate`}
                />
                <MetricCard
                  icon={XCircle}
                  label="Customer Cancelled"
                  value={totals.customerCancelled || 0}
                  color="red"
                  trend={`${totals.total > 0 ? ((totals.customerCancelled / totals.total) * 100).toFixed(1) : 0}% cancellation rate`}
                />
                <MetricCard
                  icon={Clock}
                  label="Customer Rescheduled"
                  value={totals.customerRescheduled || 0}
                  color="yellow"
                  trend={`${totals.total > 0 ? ((totals.customerRescheduled / totals.total) * 100).toFixed(1) : 0}% reschedule rate`}
                />
              </div>
            </div>

            {/* POD Metrics */}
            {totals.delivered > 0 && (
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 transition-colors">
                <h2 className="text-xl font-semibold mb-4 text-gray-900 dark:text-gray-100">Proof of Delivery (POD) Status</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <MetricCard
                    icon={CheckCircle}
                    label="Deliveries with POD"
                    value={totals.withPOD || 0}
                    color="green"
                    trend={`${totals.delivered > 0 ? ((totals.withPOD / totals.delivered) * 100).toFixed(1) : 0}% of delivered`}
                  />
                  <MetricCard
                    icon={XCircle}
                    label="Deliveries without POD"
                    value={totals.withoutPOD || 0}
                    color="red"
                    trend={`${totals.delivered > 0 ? ((totals.withoutPOD / totals.delivered) * 100).toFixed(1) : 0}% of delivered`}
                  />
                </div>
              </div>
            )}
      </div>

      {/* Recent Activity */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 transition-colors">
            <h2 className="text-xl font-semibold mb-4 text-gray-900 dark:text-gray-100">Recent Activity (Last 24 Hours)</h2>
        <ResponsiveContainer width="100%" height={250}>
          <BarChart data={recentTrendData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" className="dark:stroke-gray-700" />
                <XAxis dataKey="name" stroke="#6b7280" className="dark:stroke-gray-400" />
                <YAxis stroke="#6b7280" className="dark:stroke-gray-400" />
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: 'rgba(255, 255, 255, 0.95)',
                    border: '1px solid #e5e7eb',
                    borderRadius: '8px',
                    color: '#111827'
                  }}
                  wrapperClassName="dark:!bg-gray-800 dark:!border-gray-700 dark:!text-gray-100"
                />
            <Legend wrapperClassName="dark:text-gray-300" />
            <Bar dataKey="value" fill="#2563EB" name="Count" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Analytics Section */}
      {data?.analytics && (
        <div className="space-y-6">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Analytics</h2>

          {/* 1. Top 10 Customers - Full Width */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 transition-colors">
            <h3 className="text-lg font-semibold mb-4 text-gray-900 dark:text-gray-100 flex items-center gap-2">
              <Users className="w-5 h-5 text-primary-600" />
              Top 10 Customers by Orders
            </h3>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead className="bg-gray-50 dark:bg-gray-700">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">#</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Customer</th>
                    <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Total Orders</th>
                    <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Delivered</th>
                    <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Pending</th>
                    <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Success Rate</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Total Qty</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Last Order</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Primary Area</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {(data.analytics.topCustomers || []).map((row, idx) => {
                    const successRate = row.successRate || 0;
                    const successRateColor = successRate >= 90 
                      ? 'text-green-600 dark:text-green-400' 
                      : successRate >= 70 
                      ? 'text-yellow-600 dark:text-yellow-400' 
                      : 'text-red-600 dark:text-red-400';
                    
                    const lastOrderDate = row.lastOrderDate ? new Date(row.lastOrderDate) : null;
                    const now = new Date();
                    let lastOrderDisplay = 'N/A';
                    
                    if (lastOrderDate) {
                      const daysDiff = Math.floor((now - lastOrderDate) / (1000 * 60 * 60 * 24));
                      if (daysDiff === 0) {
                        lastOrderDisplay = 'Today';
                      } else if (daysDiff === 1) {
                        lastOrderDisplay = 'Yesterday';
                      } else if (daysDiff < 7) {
                        lastOrderDisplay = `${daysDiff} days ago`;
                      } else if (daysDiff < 30) {
                        const weeks = Math.floor(daysDiff / 7);
                        lastOrderDisplay = `${weeks} ${weeks === 1 ? 'week' : 'weeks'} ago`;
                      } else if (daysDiff < 365) {
                        const months = Math.floor(daysDiff / 30);
                        lastOrderDisplay = `${months} ${months === 1 ? 'month' : 'months'} ago`;
                      } else {
                        const years = Math.floor(daysDiff / 365);
                        lastOrderDisplay = `${years} ${years === 1 ? 'year' : 'years'} ago`;
                      }
                    }
                    
                    return (
                      <tr key={idx} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                        <td className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400">{idx + 1}</td>
                        <td className="px-4 py-2 text-sm font-medium text-gray-900 dark:text-gray-100">{row.customer}</td>
                        <td className="px-4 py-2 text-sm text-center font-semibold text-primary-600 dark:text-primary-400">{row.orders}</td>
                        <td className="px-4 py-2 text-sm text-center text-green-600 dark:text-green-400">{row.delivered || 0}</td>
                        <td className="px-4 py-2 text-sm text-center text-yellow-600 dark:text-yellow-400">{row.pending || 0}</td>
                        <td className="px-4 py-2 text-sm text-center">
                          <span className={`font-semibold ${successRateColor}`}>
                            {successRate.toFixed(1)}%
                          </span>
                        </td>
                        <td className="px-4 py-2 text-sm text-right text-gray-900 dark:text-gray-100 font-mono">{row.totalQuantity || 0}</td>
                        <td className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 whitespace-nowrap">{lastOrderDisplay}</td>
                        <td className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300">
                          <span className="inline-flex items-center gap-1">
                            <MapPin className="w-3 h-3" />
                            {row.primaryArea || 'N/A'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                  {(!data.analytics.topCustomers || data.analytics.topCustomers.length === 0) && (
                    <tr><td colSpan={9} className="px-4 py-6 text-center text-gray-500 dark:text-gray-400">No data yet</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* 2. Top 10 Items and PNC - Table Only - Full Width */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 transition-colors">
            <h3 className="text-lg font-semibold mb-4 text-gray-900 dark:text-gray-100 flex items-center gap-2">
              <Package className="w-5 h-5 text-primary-600" />
              Top 10 Items and PNC
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">Item name, PNC (Material Number), and Model ID from delivery metadata</p>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead className="bg-gray-50 dark:bg-gray-700">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Rank</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Item Name</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">PNC</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Model ID</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Quantity</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {(data.analytics.topItems || []).map((row, idx) => (
                    <tr key={idx} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                      <td className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400">{idx + 1}</td>
                      <td className="px-4 py-2 text-sm font-medium text-gray-900 dark:text-gray-100">{row.item}</td>
                      <td className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 font-mono">{row.pnc}</td>
                      <td className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300 font-mono">{row.modelId || '-'}</td>
                      <td className="px-4 py-2 text-sm text-right font-semibold text-primary-600 dark:text-primary-400">{row.count}</td>
                    </tr>
                  ))}
                  {(!data.analytics.topItems || data.analytics.topItems.length === 0) && (
                    <tr><td colSpan={5} className="px-4 py-6 text-center text-gray-500 dark:text-gray-400">No data yet</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Quantity by Item Name and PNC Chart - Separate Full Width Section */}
          {(data.analytics.topItems || []).length > 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 transition-colors">
              <h3 className="text-lg font-semibold mb-4 text-gray-900 dark:text-gray-100 flex items-center gap-2">
                <Package className="w-5 h-5 text-primary-600" />
                Quantity by Item Name and PNC
              </h3>
              <ResponsiveContainer width="100%" height={400}>
                <BarChart data={(data.analytics.topItems || []).map(r => ({ ...r, label: `${r.item} [${r.pnc}]` }))} layout="vertical" margin={{ left: 20, right: 30, top: 10, bottom: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" className="dark:stroke-gray-700" />
                  <XAxis type="number" stroke="#6b7280" />
                  <YAxis type="category" dataKey="label" width={200} stroke="#6b7280" tick={{ fontSize: 11 }} />
                  <Tooltip contentStyle={{ backgroundColor: 'rgba(255,255,255,0.95)', borderRadius: '8px' }} formatter={(val, name, props) => [val, `Item: ${props.payload.item} | PNC: ${props.payload.pnc}`]} />
                  <Bar dataKey="count" fill="#2563EB" radius={[0, 4, 4, 0]} name="Quantity" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* 3. Delivery Area Statistics */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 transition-colors">
              <h3 className="text-lg font-semibold mb-4 text-gray-900 dark:text-gray-100 flex items-center gap-2">
                <MapPin className="w-5 h-5 text-primary-600" />
                Delivery Area Statistics
              </h3>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={data.analytics.deliveryByArea || []} layout="vertical" margin={{ left: 20, right: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" className="dark:stroke-gray-700" />
                  <XAxis type="number" stroke="#6b7280" />
                  <YAxis type="category" dataKey="area" width={100} stroke="#6b7280" tick={{ fontSize: 12 }} />
                  <Tooltip contentStyle={{ backgroundColor: 'rgba(255,255,255,0.95)', borderRadius: '8px' }} />
                  <Bar dataKey="count" fill="#2563EB" radius={[0, 4, 4, 0]} name="Deliveries" />
                </BarChart>
              </ResponsiveContainer>
              {(!data.analytics.deliveryByArea || data.analytics.deliveryByArea.length === 0) && (
                <p className="text-center py-8 text-gray-500 dark:text-gray-400">No area data yet</p>
              )}
            </div>

            {/* 4. Monthly Delivery Statistics */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 transition-colors">
              <h3 className="text-lg font-semibold mb-4 text-gray-900 dark:text-gray-100 flex items-center gap-2">
                <Calendar className="w-5 h-5 text-primary-600" />
                Monthly Delivery Statistics
              </h3>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={data.analytics.deliveryByMonth || []}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" className="dark:stroke-gray-700" />
                  <XAxis dataKey="label" stroke="#6b7280" tick={{ fontSize: 11 }} />
                  <YAxis stroke="#6b7280" />
                  <Tooltip contentStyle={{ backgroundColor: 'rgba(255,255,255,0.95)', borderRadius: '8px' }} />
                  <Bar dataKey="count" fill="#10b981" radius={[4, 4, 0, 0]} name="Deliveries" />
                </BarChart>
              </ResponsiveContainer>
              {(!data.analytics.deliveryByMonth || data.analytics.deliveryByMonth.length === 0) && (
                <p className="text-center py-8 text-gray-500 dark:text-gray-400">No monthly data yet</p>
              )}
            </div>
          </div>

          {/* 5. Delivery Quantity in a Week */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 transition-colors">
            <h3 className="text-lg font-semibold mb-4 text-gray-900 dark:text-gray-100 flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-primary-600" />
              Delivery Quantity (Last 7 Days)
            </h3>
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={data.analytics.deliveryByWeek || []}>
                <defs>
                  <linearGradient id="colorWeek" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#2563EB" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#2563EB" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" className="dark:stroke-gray-700" />
                <XAxis dataKey="day" stroke="#6b7280" />
                <YAxis stroke="#6b7280" />
                <Tooltip contentStyle={{ backgroundColor: 'rgba(255,255,255,0.95)', borderRadius: '8px' }} />
                <Area type="monotone" dataKey="count" stroke="#2563EB" fillOpacity={1} fill="url(#colorWeek)" name="Deliveries" />
              </AreaChart>
            </ResponsiveContainer>
            {(!data.analytics.deliveryByWeek || data.analytics.deliveryByWeek.length === 0) && (
              <p className="text-center py-8 text-gray-500 dark:text-gray-400">No weekly data yet</p>
            )}
          </div>
        </div>
      )}
        </div>
      )}

      {activeTab === 'deliveries' && (
        <div className="space-y-6">
          {/* Delivery Statistics */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <MetricCard icon={Package} label="Total" value={totals.total} color="blue" />
            <MetricCard icon={CheckCircle} label="Delivered" value={totals.delivered} color="green" />
            <MetricCard icon={Clock} label="Pending" value={totals.pending} color="yellow" />
            <MetricCard icon={Truck} label="In Transit" value={activeDeliveries.length} color="indigo" />
          </div>

          {/* Debug Info - Show deliveries count */}
          {import.meta.env.DEV && (
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
              <p className="text-sm text-blue-800 dark:text-blue-300">
                <strong>Debug:</strong> Deliveries loaded: {deliveries.length} | Total from API: {totals.total} | Recent Deliveries: {recentDeliveries.length}
              </p>
            </div>
          )}

          {/* Deliveries Table — recent (10) or all with search/filter */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden transition-colors">
            <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
                  {showAllDeliveries ? `All Deliveries (${deliveries.length})` : 'Recent Deliveries'}
                </h2>
                <button
                  onClick={() => { setShowAllDeliveries(v => !v); setDeliverySearch(''); setDeliveryStatusFilter('all'); setDeliveryPage(0); setDeliveryDateFrom(''); setDeliveryDateTo(''); setDeliverySortBy('date'); setDeliverySortDir('desc'); }}
                  className="text-sm text-primary-600 dark:text-primary-400 hover:underline font-medium"
                >
                  {showAllDeliveries ? '← Show Recent' : `View All (${deliveries.length}) →`}
                </button>
              </div>
              {showAllDeliveries && (
                <div className="space-y-2">
                  {/* Row 1: search */}
                  <input
                    type="text"
                    placeholder="Search PO number, customer, address..."
                    value={deliverySearch}
                    onChange={e => { setDeliverySearch(e.target.value); setDeliveryPage(0); }}
                    className="w-full px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                  {/* Row 2: status + date range + sort + clear */}
                  <div className="flex flex-wrap gap-2 items-center">
                    <select
                      value={deliveryStatusFilter}
                      onChange={e => { setDeliveryStatusFilter(e.target.value); setDeliveryPage(0); }}
                      className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
                    >
                      <option value="all">All Statuses</option>
                      <option value="pending">Pending</option>
                      <option value="out-for-delivery">Out for Delivery</option>
                      <option value="delivered">Delivered</option>
                      <option value="delivered-without-installation">Delivered w/o Install</option>
                      <option value="cancelled">Cancelled</option>
                    </select>
                    <div className="flex items-center gap-1">
                      <label className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">From</label>
                      <input
                        type="date"
                        value={deliveryDateFrom}
                        onChange={e => { setDeliveryDateFrom(e.target.value); setDeliveryPage(0); }}
                        className="px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
                      />
                    </div>
                    <div className="flex items-center gap-1">
                      <label className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">To</label>
                      <input
                        type="date"
                        value={deliveryDateTo}
                        onChange={e => { setDeliveryDateTo(e.target.value); setDeliveryPage(0); }}
                        className="px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
                      />
                    </div>
                    <select
                      value={deliverySortBy}
                      onChange={e => { setDeliverySortBy(e.target.value); setDeliveryPage(0); }}
                      className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
                    >
                      <option value="date">Sort: Date</option>
                      <option value="customer">Sort: Customer</option>
                      <option value="status">Sort: Status</option>
                      <option value="poNumber">Sort: PO Number</option>
                    </select>
                    <button
                      onClick={() => { setDeliverySortDir(d => d === 'desc' ? 'asc' : 'desc'); setDeliveryPage(0); }}
                      title={deliverySortDir === 'desc' ? 'Descending — click for ascending' : 'Ascending — click for descending'}
                      className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors font-mono"
                    >{deliverySortDir === 'desc' ? '↓ Desc' : '↑ Asc'}</button>
                    {(deliverySearch || deliveryStatusFilter !== 'all' || deliveryDateFrom || deliveryDateTo) && (
                      <button
                        onClick={() => { setDeliverySearch(''); setDeliveryStatusFilter('all'); setDeliveryDateFrom(''); setDeliveryDateTo(''); setDeliveryPage(0); }}
                        className="px-3 py-1.5 text-sm rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800 hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors"
                      >✕ Clear</button>
                    )}
                  </div>
                </div>
              )}
            </div>
            <div>
              {(() => {
                const PAGE_SIZE = 50;
                const base = (deliveries && Array.isArray(deliveries) ? deliveries : []).slice();
                // Dynamic sort
                base.sort((a, b) => {
                  let av, bv;
                  if (deliverySortBy === 'customer') {
                    av = (a.customer || a.Customer || a.customerName || '').toLowerCase();
                    bv = (b.customer || b.Customer || b.customerName || '').toLowerCase();
                    return deliverySortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
                  } else if (deliverySortBy === 'status') {
                    av = (a.status || '').toLowerCase();
                    bv = (b.status || '').toLowerCase();
                    return deliverySortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
                  } else if (deliverySortBy === 'poNumber') {
                    av = (a.poNumber || '').toLowerCase();
                    bv = (b.poNumber || '').toLowerCase();
                    return deliverySortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
                  } else {
                    // date (default)
                    av = new Date(a.created_at || a.createdAt || 0).getTime();
                    bv = new Date(b.created_at || b.createdAt || 0).getTime();
                    return deliverySortDir === 'asc' ? av - bv : bv - av;
                  }
                });
                const allSorted = base;
                const filtered = showAllDeliveries
                  ? allSorted.filter(d => {
                      const q = deliverySearch.trim().toLowerCase();
                      const matchSearch = !q ||
                        (d.poNumber || '').toLowerCase().includes(q) ||
                        (d.customer || '').toLowerCase().includes(q) ||
                        (d.address || '').toLowerCase().includes(q);
                      const matchStatus = deliveryStatusFilter === 'all' || (d.status || '').toLowerCase() === deliveryStatusFilter;
                      // Date range filter
                      const dDate = new Date(d.created_at || d.createdAt || 0);
                      const matchFrom = !deliveryDateFrom || dDate >= new Date(deliveryDateFrom);
                      const matchTo = !deliveryDateTo || dDate <= new Date(deliveryDateTo + 'T23:59:59');
                      return matchSearch && matchStatus && matchFrom && matchTo;
                    })
                  : allSorted;
                const totalPages = showAllDeliveries ? Math.max(1, Math.ceil(filtered.length / PAGE_SIZE)) : 1;
                const displayList = showAllDeliveries
                  ? filtered.slice(deliveryPage * PAGE_SIZE, (deliveryPage + 1) * PAGE_SIZE)
                  : filtered.slice(0, 10);
                return (
              <>
              <table className="w-full table-fixed divide-y divide-gray-200 dark:divide-gray-700">
                <thead className="bg-gray-50 dark:bg-gray-700">
                  <tr>
                    {[{key:'poNumber',label:'PO Number',w:'w-[14%]'},{key:'customer',label:'Customer',w:'w-[24%]'},{key:'status',label:'Status',w:'w-[16%]'},{key:null,label:'Driver',w:'w-[16%]'},{key:'date',label:'Date',w:'w-[10%]'},{key:null,label:'Actions',w:'w-[20%]'}].map(({key,label,w}) => (
                      <th
                        key={label}
                        onClick={key && showAllDeliveries ? () => { if(deliverySortBy===key){setDeliverySortDir(d=>d==='desc'?'asc':'desc');}else{setDeliverySortBy(key);setDeliverySortDir('desc');} setDeliveryPage(0); } : undefined}
                        className={`${w} px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider ${key && showAllDeliveries ? 'cursor-pointer select-none hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors' : ''}`}
                      >
                        <span className="flex items-center gap-1">
                          {label}
                          {key && showAllDeliveries && deliverySortBy===key && (
                            <span className="text-primary-500">{deliverySortDir==='desc'?'↓':'↑'}</span>
                          )}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                  {displayList.length > 0 ? (
                    displayList.map((delivery) => {
                      const status = (delivery.status || 'pending').toLowerCase();
                      const statusColors = {
                        delivered: 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300',
                        pending: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300',
                        cancelled: 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300',
                        'out-for-delivery': 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300',
                        default: 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-300'
                      };
                      return (
                        <tr
                          key={delivery.id || delivery.ID}
                          className="hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors cursor-pointer"
                          onClick={() => {
                            setSelectedDelivery(delivery);
                            setIsModalOpen(true);
                          }}
                        >
                          <td className="px-4 py-4 text-sm font-medium text-blue-600 dark:text-blue-400 font-mono truncate max-w-0">
                            {delivery.poNumber || String(delivery.id || delivery.ID || 'N/A').slice(0, 8)}
                          </td>
                          <td className="px-4 py-4 text-sm text-gray-900 dark:text-gray-100 truncate max-w-0">
                            {delivery.customer || delivery.Customer || delivery.customerName || 'N/A'}
                          </td>
                          <td className="px-4 py-4">
                            <span className={`px-2 py-1 text-xs font-semibold rounded-full ${statusColors[status] || statusColors.default}`}>
                              {delivery.status || 'Pending'}
                            </span>
                          </td>
                          <td className="px-4 py-4 text-sm text-gray-500 dark:text-gray-400 truncate max-w-0">
                            {delivery.driverName || delivery.tracking?.driverId ? 
                              (delivery.driverName || `Driver ${String(delivery.tracking?.driverId || delivery.assignedDriverId || '').slice(0, 6)}`) 
                              : 'Unassigned'}
                          </td>
                          <td className="px-4 py-4 text-sm text-gray-500 dark:text-gray-400">
                            {delivery.created_at || delivery.createdAt || delivery.created 
                              ? new Date(delivery.created_at || delivery.createdAt || delivery.created).toLocaleDateString()
                              : 'N/A'}
                          </td>
                          <td className="px-4 py-4">
                            <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                              <select
                                value={delivery.status || 'pending'}
                                onChange={async (e) => {
                                  const newStatusValue = e.target.value;
                                  try {
                                    const response = await api.put(`/deliveries/admin/${delivery.id || delivery.ID}/status`, {
                                      status: newStatusValue
                                    });
                                    
                                    if (response.data.success || response.status === 200) {
                                      // Update local state
                                      setDeliveries(deliveries.map(d => 
                                        (d.id === delivery.id || d.ID === delivery.id || d.id === delivery.ID || d.ID === delivery.ID)
                                          ? { ...d, status: newStatusValue }
                                          : d
                                      ));
                                      // Refresh dashboard data
                                      loadDashboardData();
                                      // Show toast notification
                                      window.dispatchEvent(new CustomEvent('deliveryStatusUpdated', {
                                        detail: { deliveryId: delivery.id || delivery.ID, newStatus: newStatusValue }
                                      }));
                                    }
                                  } catch (err) {
                                    console.error('Error updating status:', err);
                                    alert('Error updating status: ' + (err.response?.data?.message || err.message));
                                  }
                                }}
                                className="px-2.5 py-1.5 text-xs font-medium border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all appearance-none cursor-pointer pr-6 bg-right bg-no-repeat max-w-xs"
                                style={{
                                  backgroundImage: `url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6 9 12 15 18 9'%3e%3c/polyline%3e%3c/svg%3e")`,
                                  backgroundSize: '1rem'
                                }}
                              >
                                <option value="pending">📋 Pending</option>
                                <option value="out-for-delivery">🚚 Out for Delivery</option>
                                <option value="delivered">✓ Delivered</option>
                                <option value="delivered-without-installation">📦 Delivered w/o Install</option>
                                <option value="cancelled">✕ Cancelled</option>
                              </select>
                              <button
                                onClick={() => {
                                  setSelectedDelivery(delivery);
                                  setIsModalOpen(true);
                                }}
                                className="px-2.5 py-1.5 bg-blue-100 dark:bg-blue-900/30 hover:bg-blue-200 dark:hover:bg-blue-900/50 text-blue-700 dark:text-blue-400 font-semibold rounded-md transition-all duration-200 text-xs border border-blue-300 dark:border-blue-700 whitespace-nowrap"
                              >
                                📄
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={6} className="px-6 py-12 text-center text-gray-500 dark:text-gray-400">
                        <div className="space-y-3">
                          <p>No deliveries found</p>
                          {totals.total > 0 && (
                            <p className="text-sm text-blue-600 dark:text-blue-400">
                              💡 {totals.total} deliveries recorded but not loaded from tracking. Try <button onClick={loadDashboardData} className="underline font-semibold">refreshing</button> the page.
                            </p>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              {showAllDeliveries && totalPages > 1 && (
                <div className="px-6 py-3 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between">
                  <span className="text-sm text-gray-500 dark:text-gray-400">
                    Showing {deliveryPage * PAGE_SIZE + 1}–{Math.min((deliveryPage + 1) * PAGE_SIZE, filtered.length)} of {filtered.length}
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      disabled={deliveryPage === 0}
                      onClick={() => setDeliveryPage(p => p - 1)}
                      className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
                    >← Prev</button>
                    <span className="px-3 py-1.5 text-sm text-gray-500 dark:text-gray-400">{deliveryPage + 1} / {totalPages}</span>
                    <button
                      disabled={deliveryPage >= totalPages - 1}
                      onClick={() => setDeliveryPage(p => p + 1)}
                      className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
                    >Next →</button>
                  </div>
                </div>
              )}
              </>
                );
              })()}
            </div>
          </div>

          {/* Active Deliveries Table */}
          {activeDeliveries.length > 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden transition-colors">
              <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
                <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Active Deliveries</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                  <thead className="bg-gray-50 dark:bg-gray-700">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">PO Number</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Customer</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Status</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">ETA</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                    {activeDeliveries.map((delivery) => (
                      <tr
                        key={delivery.id || delivery.ID}
                        className="hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors cursor-pointer"
                        onClick={() => {
                          setSelectedDelivery(delivery);
                          setIsModalOpen(true);
                        }}
                      >
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-gray-100">
                          {delivery.poNumber || delivery.PONumber || 'N/A'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100">
                          {delivery.customer || delivery.Customer || 'N/A'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className="px-2 py-1 text-xs font-semibold rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300">
                            {delivery.status || 'In Progress'}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                          {delivery.tracking?.eta 
                            ? new Date(delivery.tracking.eta).toLocaleTimeString()
                            : 'N/A'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm" onClick={(e) => e.stopPropagation()}>
                          <button
                            onClick={() => navigate(`/deliveries?delivery=${delivery.id || delivery.ID}`)}
                            className="text-primary-600 dark:text-primary-400 hover:underline"
                          >
                            Track
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'drivers' && (
        <div className="space-y-6">
          {/* Driver Statistics */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <MetricCard icon={Users} label="Total Drivers" value={drivers.length} color="blue" />
            <MetricCard icon={CheckCircle} label="Active" value={activeDrivers} color="green" />
            <MetricCard icon={Clock} label="On Route" value={drivers.filter(d => d.tracking?.status === 'in_progress').length} color="yellow" />
            <MetricCard icon={MapPin} label="Online" value={drivers.filter(d => {
              const driverIdStr = d.id?.toString();
              const driverIdNum = d.id;
              return onlineUserIds.has(driverIdStr) || 
                     onlineUserIds.has(driverIdNum) ||
                     onlineUserIds.has(String(driverIdNum)) ||
                     d.tracking?.online;
            }).length} color="purple" />
          </div>

          {/* Drivers Table */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden transition-colors">
            <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">All Drivers</h2>
              <button
                onClick={() => navigate('/admin/users')}
                className="text-sm text-primary-600 dark:text-primary-400 hover:underline"
              >
                Manage Drivers →
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead className="bg-gray-50 dark:bg-gray-700">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Driver</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Contact</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Status</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Location</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Last Update</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                  {drivers.length > 0 ? (
                    drivers.map((driver) => {
                      // Check online status - try both string and number ID formats
                      const driverIdStr = driver.id?.toString();
                      const driverIdNum = driver.id;
                      const isOnline = onlineUserIds.has(driverIdStr) || 
                                     onlineUserIds.has(driverIdNum) ||
                                     onlineUserIds.has(String(driverIdNum)) ||
                                     driver.tracking?.online;
                      const location = driver.tracking?.location;
                      return (
                        <tr key={driver.id} className="hover:bg-gray-50 dark:hover:bg-gray-700 transition-all duration-200">
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="flex items-center">
                              <div className="relative">
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
                              </div>
                              <div className="ml-4">
                                <div className="flex items-center gap-2">
                                  <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                    {driver.fullName || driver.full_name || driver.username || 'Unknown'}
                                  </div>
                                  {isOnline && (
                                    <span className="text-xs text-green-600 dark:text-green-400 font-medium">• Active</span>
                                  )}
                                </div>
                                <div className="text-sm text-gray-500 dark:text-gray-400">{driver.username}</div>
                              </div>
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                            <div>{driver.email || 'N/A'}</div>
                            <div>{driver.phone || 'N/A'}</div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            {isOnline ? (
                              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-full bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300 shadow-sm">
                                <div className="relative">
                                  <Circle className="w-2.5 h-2.5 fill-current" />
                                  <div className="absolute inset-0 bg-green-500 rounded-full animate-ping opacity-75"></div>
                                </div>
                                Online
                              </span>
                            ) : (
                              <span className="px-3 py-1.5 text-xs font-semibold rounded-full bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-300">
                                Offline
                              </span>
                            )}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                            {location 
                              ? `${location.lat?.toFixed(4) || 'N/A'}, ${location.lng?.toFixed(4) || 'N/A'}`
                              : 'N/A'}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                            {location?.timestamp || driver.tracking?.lastUpdate
                              ? new Date(location?.timestamp || driver.tracking?.lastUpdate).toLocaleTimeString()
                              : 'N/A'}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm">
                            <button
                              onClick={() => navigate('/admin/operations?tab=communication')}
                              className="text-primary-600 dark:text-primary-400 hover:underline"
                            >
                              Contact
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={6} className="px-6 py-12 text-center text-gray-500 dark:text-gray-400">
                        No drivers found
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'performance' && (
        <div className="space-y-6">
          {/* Performance Metrics */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <MetricCard icon={Target} label="Success Rate" value={`${successRate}%`} color="green" />
            <MetricCard icon={AlertCircle} label="Cancellation Rate" value={`${cancellationRate}%`} color="red" />
            <MetricCard icon={Zap} label="Avg Delivery Time" value="N/A" color="blue" />
            <MetricCard icon={DollarSign} label="Efficiency Score" value={totals.total > 0 ? Math.round((totals.delivered / totals.total) * 100) : 0} color="purple" />
          </div>

          {/* Daily Performance Chart */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 transition-colors">
            <h2 className="text-xl font-semibold mb-4 text-gray-900 dark:text-gray-100">Weekly Performance Trend</h2>
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={dailyPerformance}>
                <defs>
                  <linearGradient id="colorDeliveries" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.8}/>
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="colorSuccess" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.8}/>
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" className="dark:stroke-gray-700" />
                <XAxis dataKey="day" stroke="#6b7280" className="dark:stroke-gray-400" />
                <YAxis stroke="#6b7280" className="dark:stroke-gray-400" />
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: 'rgba(255, 255, 255, 0.95)',
                    border: '1px solid #e5e7eb',
                    borderRadius: '8px',
                    color: '#111827'
                  }}
                  wrapperClassName="dark:!bg-gray-800 dark:!border-gray-700 dark:!text-gray-100"
                />
                <Legend wrapperClassName="dark:text-gray-300" />
                <Area type="monotone" dataKey="deliveries" stroke="#3b82f6" fillOpacity={1} fill="url(#colorDeliveries)" name="Total Deliveries" />
                <Area type="monotone" dataKey="success" stroke="#10b981" fillOpacity={1} fill="url(#colorSuccess)" name="Successful" />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* Performance Breakdown */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 transition-colors">
              <h2 className="text-xl font-semibold mb-4 text-gray-900 dark:text-gray-100">Delivery Status Breakdown</h2>
              <div className="space-y-4">
                <div className="flex items-center justify-between p-3 bg-green-50 dark:bg-green-900/20 rounded-lg">
                  <div className="flex items-center gap-3">
                    <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-400" />
                    <span className="text-sm font-medium text-gray-900 dark:text-gray-100">Delivered</span>
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-bold text-green-600 dark:text-green-400">{totals.delivered}</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">{successRate}%</div>
                  </div>
                </div>
                <div className="flex items-center justify-between p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg">
                  <div className="flex items-center gap-3">
                    <Clock className="w-5 h-5 text-yellow-600 dark:text-yellow-400" />
                    <span className="text-sm font-medium text-gray-900 dark:text-gray-100">Pending</span>
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-bold text-yellow-600 dark:text-yellow-400">{totals.pending}</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      {totals.total > 0 ? ((totals.pending / totals.total) * 100).toFixed(1) : 0}%
                    </div>
                  </div>
                </div>
                <div className="flex items-center justify-between p-3 bg-red-50 dark:bg-red-900/20 rounded-lg">
                  <div className="flex items-center gap-3">
                    <XCircle className="w-5 h-5 text-red-600 dark:text-red-400" />
                    <span className="text-sm font-medium text-gray-900 dark:text-gray-100">Cancelled</span>
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-bold text-red-600 dark:text-red-400">{totals.cancelled}</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">{cancellationRate}%</div>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 transition-colors">
              <h2 className="text-xl font-semibold mb-4 text-gray-900 dark:text-gray-100">Activity Summary (24h)</h2>
              <div className="grid grid-cols-1 gap-4">
                <div className="p-4 bg-green-50 dark:bg-green-900/20 rounded-lg">
                  <div className="text-sm text-gray-600 dark:text-gray-400">Delivered (24h)</div>
                  <div className="text-2xl font-bold text-green-600 dark:text-green-400">{recent.delivered}</div>
                </div>
                <div className="p-4 bg-red-50 dark:bg-red-900/20 rounded-lg">
                  <div className="text-sm text-gray-600 dark:text-gray-400">Cancelled (24h)</div>
                  <div className="text-2xl font-bold text-red-600 dark:text-red-400">{recent.cancelled}</div>
                </div>
                <div className="p-4 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg">
                  <div className="text-sm text-gray-600 dark:text-gray-400">Rescheduled (24h)</div>
                  <div className="text-2xl font-bold text-yellow-600 dark:text-yellow-400">{recent.rescheduled}</div>
                </div>
              </div>
          </div>
        </div>
      </div>
      )}

      {/* Delivery Detail Modal */}
      <DeliveryDetailModal
        delivery={selectedDelivery}
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setSelectedDelivery(null);
        }}
        onStatusUpdate={(deliveryId, newStatus) => {
          // Update the delivery status in the local state
          setDeliveries(deliveries.map(d => 
            (d.id === deliveryId || d.ID === deliveryId) 
              ? { ...d, status: newStatus }
              : d
          ));
          // Close modal and refresh dashboard data
          setIsModalOpen(false);
          setSelectedDelivery(null);
          loadDashboardData();
        }}
      />
    </div>
  );
}

function MetricCard({ icon: Icon, label, value, color, trend }) {
  const colorClasses = {
    blue: 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400',
    green: 'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400',
    yellow: 'bg-yellow-50 dark:bg-yellow-900/20 text-yellow-600 dark:text-yellow-400',
    red: 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400',
    purple: 'bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400',
    indigo: 'bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400',
    pink: 'bg-pink-50 dark:bg-pink-900/20 text-pink-600 dark:text-pink-400',
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 transition-colors">
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <div className="text-sm text-gray-600 dark:text-gray-400 mb-1">{label}</div>
          <div className="text-3xl font-bold text-gray-800 dark:text-gray-100">{value}</div>
          {trend && (
            <div className="text-xs text-gray-500 dark:text-gray-400 mt-2">{trend}</div>
          )}
        </div>
        <div className={`p-3 rounded-lg ${colorClasses[color]}`}>
          <Icon className="w-6 h-6" />
        </div>
      </div>
    </div>
  );
}
