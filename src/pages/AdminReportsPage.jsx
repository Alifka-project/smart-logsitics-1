import React, { useEffect, useState } from 'react';
import api, { setAuthToken } from '../frontend/apiClient';
import { BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid } from 'recharts';
import { Download, Filter, Calendar, FileText } from 'lucide-react';

function ensureAuth() {
  const token = localStorage.getItem('auth_token');
}

const COLORS = ['#10b981', '#ef4444', '#f59e0b', '#6b7280'];

export default function AdminReportsPage() {
  const [reportData, setReportData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState({
    startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // Last 30 days
    endDate: new Date().toISOString().split('T')[0],
    status: '',
    driverId: ''
  });

  useEffect(() => {
    ensureAuth();
    loadReport();
  }, []);

  const loadReport = async (exportFormat = null) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.startDate) params.append('startDate', filters.startDate);
      if (filters.endDate) params.append('endDate', filters.endDate);
      if (filters.status) params.append('status', filters.status);
      if (filters.driverId) params.append('driverId', filters.driverId);
      if (exportFormat) params.append('format', exportFormat);

      if (exportFormat === 'csv') {
        // Handle CSV download using fetch directly
        const token = localStorage.getItem('auth_token');
        const clientKey = localStorage.getItem('client_key');
        // Use relative URLs for production (same domain), or VITE_API_URL if set
        const apiUrl = import.meta.env.VITE_API_URL ? `${import.meta.env.VITE_API_URL}/api/admin/reports` : `/api/admin/reports`;
        const response = await fetch(`${apiUrl}?${params.toString()}`, {
          headers: {
            'Authorization': token ? `Bearer ${token}` : '',
            'X-Client-Key': clientKey || '',
          }
        });
        
        if (!response.ok) throw new Error('Failed to download CSV');
        
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `deliveries-report-${Date.now()}.csv`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
        setLoading(false);
      } else {
        const response = await api.get(`/admin/reports?${params.toString()}`);
        setReportData(response.data);
        setLoading(false);
      }
    } catch (e) {
      console.error('Error loading report:', e);
      alert('Failed to load report: ' + (e?.response?.data?.error || e.message));
      setLoading(false);
    }
  };

  const handleFilterChange = (key, value) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  };

  const handleExportCSV = () => {
    loadReport('csv');
  };

  if (!reportData && !loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <FileText className="w-12 h-12 text-gray-400 mx-auto mb-4" />
          <p className="text-gray-600">No report data available</p>
        </div>
      </div>
    );
  }

  const stats = reportData?.stats || {};
  const dailyBreakdown = reportData?.dailyBreakdown || [];
  const statusDistribution = reportData?.statusDistribution || [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-800 dark:text-gray-100">Reports & Analytics</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Generated: {reportData?.generatedAt ? new Date(reportData.generatedAt).toLocaleString() : 'N/A'}
          </p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={handleExportCSV}
            disabled={loading}
            className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 flex items-center gap-2"
          >
            <Download className="w-4 h-4" />
            Export CSV
          </button>
          <button
            onClick={() => loadReport()}
            disabled={loading}
            className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50"
          >
            {loading ? 'Loading...' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 transition-colors">
        <div className="flex items-center gap-2 mb-4">
          <Filter className="w-5 h-5 text-gray-600 dark:text-gray-400" />
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Filters</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Start Date</label>
            <input
              type="date"
              value={filters.startDate}
              onChange={(e) => handleFilterChange('startDate', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-primary-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">End Date</label>
            <input
              type="date"
              value={filters.endDate}
              onChange={(e) => handleFilterChange('endDate', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-primary-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Status</label>
            <select
              value={filters.status}
              onChange={(e) => handleFilterChange('status', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-primary-500"
            >
              <option value="">All Statuses</option>
              <option value="delivered">Delivered</option>
              <option value="pending">Pending</option>
              <option value="cancelled">Cancelled</option>
              <option value="rescheduled">Rescheduled</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Driver ID</label>
            <input
              type="text"
              value={filters.driverId}
              onChange={(e) => handleFilterChange('driverId', e.target.value)}
              placeholder="Optional"
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:ring-2 focus:ring-primary-500"
            />
          </div>
        </div>
        <button
          onClick={() => loadReport()}
          disabled={loading}
          className="mt-4 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50"
        >
          Apply Filters
        </button>
      </div>

      {/* Summary Statistics */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard label="Total Deliveries" value={stats.total} color="blue" />
        <StatCard label="Delivered" value={stats.delivered} color="green" subtitle={`${stats.successRate}% success rate`} />
        <StatCard label="Cancelled" value={stats.cancelled} color="red" subtitle={`${stats.cancellationRate}% cancellation rate`} />
        <StatCard label="Pending" value={stats.pending} color="yellow" />
      </div>

      {/* Customer Response Statistics */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 transition-colors">
        <h2 className="text-lg font-semibold mb-4 text-gray-900 dark:text-gray-100">Customer Response Statistics</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <StatCard 
            label="Customer Accepted" 
            value={stats.customerAccepted || 0} 
            color="green" 
            subtitle={`${stats.total > 0 ? ((stats.customerAccepted / stats.total) * 100).toFixed(1) : 0}% acceptance rate`} 
          />
          <StatCard 
            label="Customer Cancelled" 
            value={stats.customerCancelled || 0} 
            color="red" 
            subtitle={`${stats.total > 0 ? ((stats.customerCancelled / stats.total) * 100).toFixed(1) : 0}% cancellation rate`} 
          />
          <StatCard 
            label="Customer Rescheduled" 
            value={stats.customerRescheduled || 0} 
            color="yellow" 
            subtitle={`${stats.total > 0 ? ((stats.customerRescheduled / stats.total) * 100).toFixed(1) : 0}% reschedule rate`} 
          />
        </div>
      </div>

      {/* POD (Proof of Delivery) Statistics */}
      {stats.delivered > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 transition-colors">
          <h2 className="text-lg font-semibold mb-4 text-gray-900 dark:text-gray-100">Proof of Delivery (POD) Statistics</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <StatCard 
              label="Deliveries with POD" 
              value={stats.withPOD || 0} 
              color="green" 
              subtitle={`${stats.delivered > 0 ? ((stats.withPOD / stats.delivered) * 100).toFixed(1) : 0}% of delivered deliveries`} 
            />
            <StatCard 
              label="Deliveries without POD" 
              value={stats.withoutPOD || 0} 
              color="red" 
              subtitle={`${stats.delivered > 0 ? ((stats.withoutPOD / stats.delivered) * 100).toFixed(1) : 0}% of delivered deliveries`} 
            />
          </div>
          <div className="mt-4 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
            <p className="text-sm text-gray-700 dark:text-gray-300">
              <strong>POD includes:</strong> Driver signature, Customer signature, or Delivery photos
            </p>
          </div>
        </div>
      )}

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Daily Breakdown */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 transition-colors">
          <h2 className="text-xl font-semibold mb-4 text-gray-900 dark:text-gray-100">Daily Breakdown</h2>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={dailyBreakdown}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" className="dark:stroke-gray-700" />
              <XAxis dataKey="date" stroke="#6b7280" className="dark:stroke-gray-400" />
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
              <Bar dataKey="delivered" stackId="a" fill="#10b981" name="Delivered" />
              <Bar dataKey="cancelled" stackId="a" fill="#ef4444" name="Cancelled" />
              <Bar dataKey="rescheduled" stackId="a" fill="#f59e0b" name="Rescheduled" />
              <Bar dataKey="pending" stackId="a" fill="#6b7280" name="Pending" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Status Distribution */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 transition-colors">
          <h2 className="text-xl font-semibold mb-4 text-gray-900 dark:text-gray-100">Status Distribution</h2>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={statusDistribution}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={({ status, percentage }) => `${status} ${percentage}%`}
                outerRadius={100}
                fill="#8884d8"
                dataKey="count"
              >
                {statusDistribution.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
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

      {/* Daily Trend */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 transition-colors">
        <h2 className="text-xl font-semibold mb-4 text-gray-900 dark:text-gray-100">Daily Trend</h2>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={dailyBreakdown}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" className="dark:stroke-gray-700" />
            <XAxis dataKey="date" stroke="#6b7280" className="dark:stroke-gray-400" />
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
            <Line type="monotone" dataKey="delivered" stroke="#10b981" strokeWidth={2} name="Delivered" />
            <Line type="monotone" dataKey="cancelled" stroke="#ef4444" strokeWidth={2} name="Cancelled" />
            <Line type="monotone" dataKey="pending" stroke="#6b7280" strokeWidth={2} name="Pending" />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function StatCard({ label, value, color, subtitle }) {
  const textColorClasses = {
    blue: 'text-blue-600 dark:text-blue-400',
    green: 'text-green-600 dark:text-green-400',
    yellow: 'text-yellow-600 dark:text-yellow-400',
    red: 'text-red-600 dark:text-red-400',
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 transition-colors">
      <div className="text-sm text-gray-600 dark:text-gray-400 mb-1">{label}</div>
      <div className={`text-3xl font-bold ${textColorClasses[color] || 'text-gray-800 dark:text-gray-100'}`}>{value}</div>
      {subtitle && <div className="text-xs text-gray-500 dark:text-gray-400 mt-2">{subtitle}</div>}
    </div>
  );
}

