import React, { useEffect, useState } from 'react';
import api, { setAuthToken } from '../frontend/apiClient';
import { BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid } from 'recharts';
import { Package, CheckCircle, XCircle, Clock, MapPin, TrendingUp, Users, Activity } from 'lucide-react';

function ensureAuth() {
  const token = localStorage.getItem('auth_token');
  // Session is server-side via HttpOnly cookie; ensure client_key header will be sent by apiClient interceptor
}

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8'];

export default function AdminDashboardPage() {
  const [data, setData] = useState(null);
  const [drivers, setDrivers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastUpdate, setLastUpdate] = useState(new Date());

  const loadDashboardData = async () => {
    try {
      const [dashboardResp, driversResp] = await Promise.allSettled([
        api.get('/admin/dashboard'),
        api.get('/admin/drivers').catch(() => ({ data: { data: [] } }))
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
      }, 5000); // Refresh every 5 seconds
    }

    return () => {
      mounted = false;
      if (interval) {
        clearInterval(interval);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // Calculate success rate
  const successRate = totals.total > 0 
    ? ((totals.delivered / totals.total) * 100).toFixed(1)
    : '0.0';

  // Calculate cancellation rate
  const cancellationRate = totals.total > 0
    ? ((totals.cancelled / totals.total) * 100).toFixed(1)
    : '0.0';

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

      {/* POD (Proof of Delivery) Metrics */}
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

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Status Breakdown - Bar Chart */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 transition-colors">
          <h2 className="text-xl font-semibold mb-4 text-gray-900 dark:text-gray-100">Status Breakdown</h2>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={statusChartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip />
              <Bar dataKey="value" fill="#2563EB">
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
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Recent Activity */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 transition-colors">
        <h2 className="text-xl font-semibold mb-4 text-gray-900 dark:text-gray-100">Recent Activity (Last 24 Hours)</h2>
        <ResponsiveContainer width="100%" height={250}>
          <LineChart data={recentTrendData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="name" />
            <YAxis />
            <Tooltip />
            <Legend />
            <Line type="monotone" dataKey="value" stroke="#2563EB" strokeWidth={2} name="Count" />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Recent Activity Summary */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 transition-colors">
        <h2 className="text-xl font-semibold mb-4 text-gray-900 dark:text-gray-100">Activity Summary</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
  );
}

function MetricCard({ icon: Icon, label, value, color, trend }) {
  const colorClasses = {
    blue: 'bg-blue-50 text-blue-600',
    green: 'bg-green-50 text-green-600',
    yellow: 'bg-yellow-50 text-yellow-600',
    red: 'bg-red-50 text-red-600',
    purple: 'bg-purple-50 text-purple-600',
    indigo: 'bg-indigo-50 text-indigo-600',
    pink: 'bg-pink-50 text-pink-600',
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
