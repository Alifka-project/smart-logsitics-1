import React, { useEffect, useState } from 'react';
import api, { setAuthToken } from '../frontend/apiClient';
import { BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid, AreaChart, Area } from 'recharts';
import { 
  Package, CheckCircle, XCircle, Clock, MapPin, TrendingUp, Users, Activity, 
  Truck, AlertCircle, FileText, Calendar, DollarSign, Target, Zap
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

function ensureAuth() {
  const token = localStorage.getItem('auth_token');
}

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8'];

export default function AdminDashboardPage() {
  const [data, setData] = useState(null);
  const [drivers, setDrivers] = useState([]);
  const [deliveries, setDeliveries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastUpdate, setLastUpdate] = useState(new Date());
  const [activeTab, setActiveTab] = useState('overview');
  const navigate = useNavigate();

  const loadDashboardData = async () => {
    try {
      const [dashboardResp, driversResp, deliveriesResp] = await Promise.allSettled([
        api.get('/admin/dashboard'),
        api.get('/admin/drivers').catch(() => ({ data: { data: [] } })),
        api.get('/admin/tracking/deliveries').catch(() => ({ data: { deliveries: [] } }))
      ]);

      if (dashboardResp.status === 'fulfilled') {
        setData(dashboardResp.value.data);
        setLastUpdate(new Date());
      } else {
        setData({ error: dashboardResp.reason?.response?.data?.error || 'fetch_failed' });
      }

      if (driversResp.status === 'fulfilled') {
        setDrivers(driversResp.value.data?.data || []);
      }

      if (deliveriesResp.status === 'fulfilled') {
        setDeliveries(deliveriesResp.value.data?.deliveries || []);
      }
    } catch (e) {
      console.error('Error loading dashboard:', e);
      setData({ error: e?.response?.data?.error || 'fetch_failed' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    ensureAuth();
    let mounted = true;
    
    const loadData = async () => {
      if (!mounted) return;
      await loadDashboardData();
    };
    
    loadData();

    let interval = null;
    if (autoRefresh) {
      interval = setInterval(() => {
        if (mounted) {
          loadDashboardData();
        }
      }, 5000);
    }

    return () => {
      mounted = false;
      if (interval) {
        clearInterval(interval);
      }
    };
  }, [autoRefresh]);

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto mb-4"></div>
          <p className="text-gray-600 dark:text-gray-400">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  if (data?.error) {
    return (
      <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
        <div className="text-red-600 dark:text-red-400 font-semibold">Error loading dashboard</div>
        <div className="text-red-500 dark:text-red-400 text-sm mt-1">{data.error}</div>
      </div>
    );
  }

  const totals = data?.totals || { 
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
  const recent = data?.recentCounts || { delivered: 0, cancelled: 0, rescheduled: 0 };
  const activeDrivers = drivers.filter(d => d.active !== false).length;

  // Get recent deliveries (last 10)
  const recentDeliveries = deliveries
    .sort((a, b) => {
      const dateA = new Date(a.created_at || a.createdAt || a.created || 0);
      const dateB = new Date(b.created_at || b.createdAt || b.created || 0);
      return dateB - dateA;
    })
    .slice(0, 10);

  // Get active deliveries
  const activeDeliveries = deliveries.filter(d => {
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
    { name: 'Delivered', value: recent.delivered },
    { name: 'Cancelled', value: recent.cancelled },
    { name: 'Rescheduled', value: recent.rescheduled },
  ];

  // Daily performance data (mock for now, can be enhanced with real data)
  const dailyPerformance = [
    { day: 'Mon', deliveries: totals.delivered > 0 ? Math.floor(totals.delivered * 0.15) : 0, success: totals.delivered > 0 ? Math.floor(totals.delivered * 0.12) : 0 },
    { day: 'Tue', deliveries: totals.delivered > 0 ? Math.floor(totals.delivered * 0.18) : 0, success: totals.delivered > 0 ? Math.floor(totals.delivered * 0.16) : 0 },
    { day: 'Wed', deliveries: totals.delivered > 0 ? Math.floor(totals.delivered * 0.20) : 0, success: totals.delivered > 0 ? Math.floor(totals.delivered * 0.18) : 0 },
    { day: 'Thu', deliveries: totals.delivered > 0 ? Math.floor(totals.delivered * 0.22) : 0, success: totals.delivered > 0 ? Math.floor(totals.delivered * 0.20) : 0 },
    { day: 'Fri', deliveries: totals.delivered > 0 ? Math.floor(totals.delivered * 0.15) : 0, success: totals.delivered > 0 ? Math.floor(totals.delivered * 0.14) : 0 },
    { day: 'Sat', deliveries: totals.delivered > 0 ? Math.floor(totals.delivered * 0.10) : 0, success: totals.delivered > 0 ? Math.floor(totals.delivered * 0.09) : 0 },
  ];

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
            onClick={loadDashboardData}
            className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm"
          >
            Refresh Now
          </button>
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
          <LineChart data={recentTrendData}>
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
            <Line type="monotone" dataKey="value" stroke="#2563EB" strokeWidth={2} name="Count" />
          </LineChart>
        </ResponsiveContainer>
      </div>
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

          {/* Recent Deliveries Table */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden transition-colors">
            <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Recent Deliveries</h2>
              <button
                onClick={() => navigate('/deliveries')}
                className="text-sm text-primary-600 dark:text-primary-400 hover:underline"
              >
                View All →
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead className="bg-gray-50 dark:bg-gray-700">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">ID</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Customer</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Status</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Driver</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Date</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                  {recentDeliveries.length > 0 ? (
                    recentDeliveries.map((delivery) => {
                      const status = (delivery.status || 'pending').toLowerCase();
                      const statusColors = {
                        delivered: 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300',
                        pending: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300',
                        cancelled: 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300',
                        'out-for-delivery': 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300',
                        default: 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-300'
                      };
                      return (
                        <tr key={delivery.id || delivery.ID} className="hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-gray-100">
                            #{String(delivery.id || delivery.ID || 'N/A').slice(0, 8)}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100">
                            {delivery.customer || delivery.Customer || delivery.customerName || 'N/A'}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className={`px-2 py-1 text-xs font-semibold rounded-full ${statusColors[status] || statusColors.default}`}>
                              {delivery.status || 'Pending'}
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                            {delivery.tracking?.driverId ? `Driver ${String(delivery.tracking.driverId).slice(0, 6)}` : 'Unassigned'}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                            {delivery.created_at || delivery.createdAt || delivery.created 
                              ? new Date(delivery.created_at || delivery.createdAt || delivery.created).toLocaleDateString()
                              : 'N/A'}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm">
                            <button
                              onClick={() => navigate(`/deliveries?delivery=${delivery.id || delivery.ID}`)}
                              className="text-primary-600 dark:text-primary-400 hover:underline"
                            >
                              View
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={6} className="px-6 py-12 text-center text-gray-500 dark:text-gray-400">
                        No deliveries found
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
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
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">ID</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Customer</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Status</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">ETA</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                    {activeDeliveries.map((delivery) => (
                      <tr key={delivery.id || delivery.ID} className="hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-gray-100">
                          #{String(delivery.id || delivery.ID || 'N/A').slice(0, 8)}
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
                        <td className="px-6 py-4 whitespace-nowrap text-sm">
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
            <MetricCard icon={MapPin} label="Online" value={drivers.filter(d => d.tracking?.online).length} color="purple" />
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
                      const isOnline = driver.tracking?.online;
                      const location = driver.tracking?.location;
                      return (
                        <tr key={driver.id} className="hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="flex items-center">
                              <div className={`w-3 h-3 rounded-full mr-3 ${isOnline ? 'bg-green-500' : 'bg-gray-400'}`}></div>
                              <div>
                                <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                  {driver.fullName || driver.full_name || driver.username || 'Unknown'}
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
                            <span className={`px-2 py-1 text-xs font-semibold rounded-full ${
                              isOnline 
                                ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300'
                                : 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-300'
                            }`}>
                              {isOnline ? 'Online' : 'Offline'}
                            </span>
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
