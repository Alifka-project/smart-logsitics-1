import React, { useEffect, useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import api, { setAuthToken } from '../frontend/apiClient';
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid
} from 'recharts';
import {
  Download, Filter, FileText, ChevronDown, ChevronUp,
  MapPin, Phone, User, Clock, Image, ArrowRight,
  CheckCircle, XCircle, Camera, RefreshCw, Package,
  TrendingUp, TrendingDown, AlertCircle, Search, X
} from 'lucide-react';

function ensureAuth() {
  const token = localStorage.getItem('auth_token');
  if (token) setAuthToken(token);
}

/* Electrolux brand + semantic chart colours */
const CHART_COLORS = {
  delivered: '#22c55e',
  cancelled: '#ef4444',
  rescheduled: '#f59e0b',
  pending: '#64748b',
};
const PIE_COLORS = ['#22c55e', '#ef4444', '#f59e0b', '#64748b', '#8b5cf6', '#06b6d4'];

export default function AdminReportsPage() {
  const [reportData, setReportData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState({
    startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    endDate: new Date().toISOString().split('T')[0],
    status: '',
    customerStatus: '',
    poNumber: '',
    podFilter: '',
  });
  const [sortConfig, setSortConfig] = useState({ key: null, direction: 'asc' });
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(20);

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
      if (exportFormat) params.append('format', exportFormat);

      if (exportFormat === 'csv') {
        const token = localStorage.getItem('auth_token');
        const clientKey = localStorage.getItem('client_key');
        const apiUrl = import.meta.env.VITE_API_URL
          ? `${import.meta.env.VITE_API_URL}/api/admin/reports`
          : `/api/admin/reports`;
        const response = await fetch(`${apiUrl}?${params.toString()}`, {
          headers: {
            'Authorization': token ? `Bearer ${token}` : '',
            'X-Client-Key': clientKey || '',
          },
        });
        if (!response.ok) throw new Error('Failed to download CSV');
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `electrolux-deliveries-${filters.startDate}-to-${filters.endDate}.csv`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      } else {
        const response = await api.get(`/admin/reports?${params.toString()}`);
        setReportData(response.data);
        setCurrentPage(1);
      }
    } catch (e) {
      console.error('Error loading report:', e);
      alert('Failed to load report: ' + (e?.response?.data?.error || e.message));
    } finally {
      setLoading(false);
    }
  };

  const handleFilterChange = (key, value) => {
    setFilters(prev => ({ ...prev, [key]: value }));
    setCurrentPage(1);
  };

  const hasActiveFilters = () =>
    filters.status || filters.customerStatus || filters.poNumber || filters.podFilter;

  const clearFilters = () => {
    setFilters(prev => ({ ...prev, status: '', customerStatus: '', poNumber: '', podFilter: '' }));
    setCurrentPage(1);
  };

  const getCustomerStatus = (delivery) => {
    const status = (delivery.status || '').toLowerCase();
    if (status === 'scheduled-confirmed') return 'Accepted';
    if (
      (status === 'cancelled' || status === 'canceled' || status === 'rejected') &&
      (delivery.actor_type === 'customer' || delivery.cancelled_by === 'customer')
    ) return 'Cancelled';
    if (
      status === 'rescheduled' &&
      (delivery.actor_type === 'customer' || delivery.rescheduled_by === 'customer')
    ) return 'Rescheduled';
    return 'Pending';
  };

  const getPODStatus = (delivery) => {
    const hasPOD = !!(
      delivery.hasPOD ||
      delivery.driverSignature ||
      delivery.customerSignature ||
      (delivery.photoCount && delivery.photoCount > 0) ||
      (delivery.photos && delivery.photos.length > 0)
    );
    return hasPOD;
  };

  const filteredDeliveries = useMemo(() => {
    if (!reportData?.deliveries) return [];
    let filtered = [...reportData.deliveries];

    if (filters.status) {
      filtered = filtered.filter(d => (d.status || '').toLowerCase() === filters.status.toLowerCase());
    }
    if (filters.customerStatus) {
      filtered = filtered.filter(d =>
        getCustomerStatus(d).toLowerCase() === filters.customerStatus.toLowerCase()
      );
    }
    if (filters.poNumber) {
      const term = filters.poNumber.toLowerCase().trim();
      filtered = filtered.filter(d =>
        (d.poNumber || d.PONumber || '').toLowerCase().includes(term)
      );
    }
    if (filters.podFilter) {
      if (filters.podFilter === 'with-pod') {
        filtered = filtered.filter(d => getPODStatus(d));
      } else if (filters.podFilter === 'without-pod') {
        filtered = filtered.filter(d => !getPODStatus(d));
      }
    }
    return filtered;
  }, [reportData?.deliveries, filters.status, filters.customerStatus, filters.poNumber, filters.podFilter]);

  const sortedDeliveries = useMemo(() => {
    if (!sortConfig.key) return filteredDeliveries;
    return [...filteredDeliveries].sort((a, b) => {
      let av = a[sortConfig.key], bv = b[sortConfig.key];
      if (sortConfig.key === 'customer') { av = a.customer || a.Customer || ''; bv = b.customer || b.Customer || ''; }
      if (sortConfig.key === 'createdAt') {
        av = new Date(a.created_at || a.createdAt || 0);
        bv = new Date(b.created_at || b.createdAt || 0);
      }
      if (av < bv) return sortConfig.direction === 'asc' ? -1 : 1;
      if (av > bv) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
  }, [filteredDeliveries, sortConfig]);

  const paginatedDeliveries = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return sortedDeliveries.slice(start, start + itemsPerPage);
  }, [sortedDeliveries, currentPage, itemsPerPage]);

  const totalPages = Math.ceil(sortedDeliveries.length / itemsPerPage);

  const handleSort = (key) => {
    setSortConfig(prev =>
      prev.key === key
        ? { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' }
        : { key, direction: 'asc' }
    );
  };

  const getStatusBadge = (status) => {
    const s = (status || '').toLowerCase();
    if (['delivered', 'done', 'completed', 'delivered-with-installation', 'delivered-without-installation'].includes(s))
      return { cls: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300', dot: 'bg-green-500' };
    if (['cancelled', 'canceled', 'rejected'].includes(s))
      return { cls: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300', dot: 'bg-red-500' };
    if (s === 'rescheduled')
      return { cls: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300', dot: 'bg-amber-500' };
    if (['scheduled', 'scheduled-confirmed'].includes(s))
      return { cls: 'bg-primary-100 text-primary-800 dark:bg-primary-900/30 dark:text-primary-300', dot: 'bg-primary-500' };
    if (['out-for-delivery', 'in-progress'].includes(s))
      return { cls: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300', dot: 'bg-purple-500' };
    return { cls: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300', dot: 'bg-gray-400' };
  };

  const getCustomerStatusBadge = (status) => {
    if (status === 'Accepted') return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300';
    if (status === 'Cancelled') return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300';
    if (status === 'Rescheduled') return 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300';
    return 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400';
  };

  const formatDate = (val) => {
    if (!val) return '—';
    return new Date(val).toLocaleDateString('en-AE', { year: 'numeric', month: 'short', day: 'numeric' });
  };

  const formatStatusLabel = (status) => {
    return status
      .replace(/-/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase());
  };

  if (!reportData && !loading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <FileText className="w-14 h-14 text-gray-300 dark:text-gray-600" />
        <p className="text-gray-500 dark:text-gray-400">No report data. Click Refresh to load.</p>
        <button
          onClick={() => loadReport()}
          className="px-5 py-2.5 bg-primary-900 text-white rounded-lg hover:bg-primary-800 font-medium"
        >
          Load Report
        </button>
      </div>
    );
  }

  const stats = reportData?.stats || {};
  const dailyBreakdown = reportData?.dailyBreakdown || [];
  const statusDistribution = reportData?.statusDistribution || [];

  /* Compute POD counts from filtered deliveries for accurate display */
  const podWithCount = filteredDeliveries.filter(d => getPODStatus(d)).length;
  const podWithoutCount = filteredDeliveries.filter(d => !getPODStatus(d)).length;
  const podTotal = podWithCount + podWithoutCount;
  const podRate = podTotal > 0 ? ((podWithCount / podTotal) * 100).toFixed(1) : '0.0';

  return (
    <div className="space-y-6">

      {/* ── Page Header ── */}
      <div className="pp-page-header flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="pp-page-title">Reports & Analytics</h1>
          <p className="pp-page-subtitle">
            Electrolux Dubai Logistics · Generated:{' '}
            {reportData?.generatedAt ? new Date(reportData.generatedAt).toLocaleString('en-AE') : '—'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            to="/admin/reports/pod"
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-primary-900 text-white rounded-lg hover:bg-primary-800 font-medium text-sm"
          >
            <Image className="w-4 h-4" />
            POD Report
            <ArrowRight className="w-4 h-4" />
          </Link>
          <button
            onClick={() => loadReport('csv')}
            disabled={loading}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 font-medium text-sm"
          >
            <Download className="w-4 h-4" />
            Export CSV
          </button>
          <button
            onClick={() => loadReport()}
            disabled={loading}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-primary-700 text-white rounded-lg hover:bg-primary-900 disabled:opacity-50 font-medium text-sm"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* ── Filters ── */}
      <div className="pp-card p-5">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-8 h-8 rounded-lg bg-primary-900/10 flex items-center justify-center">
            <Filter className="w-4 h-4 text-primary-900 dark:text-primary-300" />
          </div>
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Filters & Date Range</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
          <div>
            <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">From</label>
            <input
              type="date"
              value={filters.startDate}
              onChange={e => handleFilterChange('startDate', e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-primary-500"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">To</label>
            <input
              type="date"
              value={filters.endDate}
              onChange={e => handleFilterChange('endDate', e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-primary-500"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">Delivery Status</label>
            <select
              value={filters.status}
              onChange={e => handleFilterChange('status', e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-primary-500"
            >
              <option value="">All Statuses</option>
              <option value="delivered">Delivered</option>
              <option value="delivered-with-installation">Delivered (With Installation)</option>
              <option value="delivered-without-installation">Delivered (Without Installation)</option>
              <option value="pending">Pending</option>
              <option value="scheduled">Scheduled</option>
              <option value="scheduled-confirmed">Scheduled Confirmed</option>
              <option value="out-for-delivery">Out for Delivery</option>
              <option value="in-progress">In Progress</option>
              <option value="cancelled">Cancelled</option>
              <option value="rescheduled">Rescheduled</option>
              <option value="rejected">Rejected</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">Customer Response</label>
            <select
              value={filters.customerStatus}
              onChange={e => handleFilterChange('customerStatus', e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-primary-500"
            >
              <option value="">All Responses</option>
              <option value="accepted">Accepted</option>
              <option value="cancelled">Cancelled</option>
              <option value="rescheduled">Rescheduled</option>
              <option value="pending">Pending</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">POD Status</label>
            <select
              value={filters.podFilter}
              onChange={e => handleFilterChange('podFilter', e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-primary-500"
            >
              <option value="">All POD</option>
              <option value="with-pod">✓ With POD</option>
              <option value="without-pod">✗ Without POD</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">PO Number</label>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
              <input
                type="text"
                value={filters.poNumber}
                onChange={e => handleFilterChange('poNumber', e.target.value)}
                placeholder="Search…"
                className="w-full pl-8 pr-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:ring-2 focus:ring-primary-500"
              />
            </div>
          </div>
        </div>
        <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-100 dark:border-gray-700">
          <div className="flex items-center gap-3">
            <button
              onClick={() => loadReport()}
              disabled={loading}
              className="inline-flex items-center gap-2 px-4 py-2 bg-primary-900 text-white rounded-lg hover:bg-primary-800 disabled:opacity-50 text-sm font-medium"
            >
              <Search className="w-4 h-4" />
              Apply Date Filter
            </button>
            {hasActiveFilters() && (
              <button
                onClick={clearFilters}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400"
              >
                <X className="w-4 h-4" />
                Clear filters
              </button>
            )}
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            <span className="font-semibold text-gray-900 dark:text-gray-100">{filteredDeliveries.length}</span> {filteredDeliveries.length === 1 ? 'delivery' : 'deliveries'} shown
          </p>
        </div>
      </div>

      {/* ── KPI Cards (always visible) ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label="Total Deliveries"
          value={stats.total ?? filteredDeliveries.length}
          icon={<Package className="w-5 h-5" />}
          color="navy"
        />
        <KpiCard
          label="Delivered"
          value={stats.delivered ?? 0}
          icon={<CheckCircle className="w-5 h-5" />}
          color="green"
          sub={`${stats.successRate ?? 0}% success rate`}
          trend="up"
        />
        <KpiCard
          label="Cancelled"
          value={stats.cancelled ?? 0}
          icon={<XCircle className="w-5 h-5" />}
          color="red"
          sub={`${stats.cancellationRate ?? 0}% cancellation rate`}
          trend="down"
        />
        <KpiCard
          label="Pending"
          value={stats.pending ?? 0}
          icon={<Clock className="w-5 h-5" />}
          color="amber"
        />
      </div>

      {/* ── POD Overview Banner ── */}
      <div className="pp-card p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary-900/10 flex items-center justify-center">
              <Image className="w-4 h-4 text-primary-900 dark:text-primary-300" />
            </div>
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Proof of Delivery (POD) Overview</h2>
          </div>
          <Link
            to="/admin/reports/pod"
            className="inline-flex items-center gap-1.5 text-sm text-primary-700 dark:text-primary-300 hover:underline font-medium"
          >
            Full POD Report <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <div className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">With POD</span>
            <span className="text-3xl font-bold text-green-600 dark:text-green-400">{hasActiveFilters() ? podWithCount : (stats.withPOD ?? podWithCount)}</span>
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {hasActiveFilters() ? podRate : (stats.delivered > 0 ? ((stats.withPOD / stats.delivered) * 100).toFixed(1) : podRate)}% of delivered orders
            </span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Without POD</span>
            <span className="text-3xl font-bold text-red-500 dark:text-red-400">{hasActiveFilters() ? podWithoutCount : (stats.withoutPOD ?? podWithoutCount)}</span>
            <span className="text-xs text-gray-500 dark:text-gray-400">Missing signatures / photos</span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Completion Rate</span>
            <span className="text-3xl font-bold text-primary-900 dark:text-primary-300">
              {hasActiveFilters() ? `${podRate}%` : `${stats.delivered > 0 ? ((stats.withPOD / stats.delivered) * 100).toFixed(1) : 0}%`}
            </span>
            <span className="text-xs text-gray-500 dark:text-gray-400">POD uploads vs deliveries</span>
          </div>
        </div>
        {/* Progress bar */}
        <div>
          <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mb-1.5">
            <span>POD Completion</span>
            <span>{hasActiveFilters() ? `${podRate}%` : `${stats.delivered > 0 ? ((stats.withPOD / stats.delivered) * 100).toFixed(1) : 0}%`}</span>
          </div>
          <div className="h-2.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-primary-700 to-green-500 rounded-full transition-all duration-500"
              style={{
                width: `${hasActiveFilters()
                  ? podRate
                  : stats.delivered > 0 ? ((stats.withPOD / stats.delivered) * 100).toFixed(1) : 0}%`
              }}
            />
          </div>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1.5">
            POD includes: driver signature, customer signature, or delivery photos
          </p>
        </div>
      </div>

      {/* ── Customer Response Stats ── */}
      {!hasActiveFilters() && (
        <div className="pp-card p-5">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-8 h-8 rounded-lg bg-primary-900/10 flex items-center justify-center">
              <User className="w-4 h-4 text-primary-900 dark:text-primary-300" />
            </div>
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Customer Response Statistics</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <KpiCard label="Customer Accepted" value={stats.customerAccepted ?? 0} icon={<CheckCircle className="w-5 h-5" />} color="green"
              sub={`${stats.total > 0 ? ((stats.customerAccepted / stats.total) * 100).toFixed(1) : 0}% acceptance rate`} />
            <KpiCard label="Customer Cancelled" value={stats.customerCancelled ?? 0} icon={<XCircle className="w-5 h-5" />} color="red"
              sub={`${stats.total > 0 ? ((stats.customerCancelled / stats.total) * 100).toFixed(1) : 0}% cancellation rate`} />
            <KpiCard label="Customer Rescheduled" value={stats.customerRescheduled ?? 0} icon={<RefreshCw className="w-5 h-5" />} color="amber"
              sub={`${stats.total > 0 ? ((stats.customerRescheduled / stats.total) * 100).toFixed(1) : 0}% reschedule rate`} />
          </div>
        </div>
      )}

      {/* ── Charts (hidden when filters active) ── */}
      {!hasActiveFilters() && dailyBreakdown.length > 0 && (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="pp-card p-5">
              <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-4">Daily Breakdown</h2>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={dailyBreakdown} margin={{ top: 4, right: 4, bottom: 4, left: -10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--muted)' }} />
                  <YAxis tick={{ fontSize: 11, fill: 'var(--muted)' }} />
                  <Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '10px', color: 'var(--text)', fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 12, color: 'var(--text2)' }} />
                  <Bar dataKey="delivered" stackId="a" fill={CHART_COLORS.delivered} name="Delivered" radius={[0,0,0,0]} />
                  <Bar dataKey="cancelled" stackId="a" fill={CHART_COLORS.cancelled} name="Cancelled" />
                  <Bar dataKey="rescheduled" stackId="a" fill={CHART_COLORS.rescheduled} name="Rescheduled" />
                  <Bar dataKey="pending" stackId="a" fill={CHART_COLORS.pending} name="Pending" radius={[4,4,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="pp-card p-5">
              <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-4">Status Distribution</h2>
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie
                    data={statusDistribution}
                    cx="50%" cy="50%"
                    outerRadius={95}
                    innerRadius={40}
                    labelLine={false}
                    label={({ status, percentage }) => `${percentage}%`}
                    dataKey="count"
                  >
                    {statusDistribution.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '10px', color: 'var(--text)', fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 12, color: 'var(--text2)' }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="pp-card p-5">
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-4">Daily Delivery Trend</h2>
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={dailyBreakdown} margin={{ top: 4, right: 4, bottom: 4, left: -10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--muted)' }} />
                <YAxis tick={{ fontSize: 11, fill: 'var(--muted)' }} />
                <Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '10px', color: 'var(--text)', fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 12, color: 'var(--text2)' }} />
                <Line type="monotone" dataKey="delivered" stroke={CHART_COLORS.delivered} strokeWidth={2} dot={false} name="Delivered" />
                <Line type="monotone" dataKey="cancelled" stroke={CHART_COLORS.cancelled} strokeWidth={2} dot={false} name="Cancelled" />
                <Line type="monotone" dataKey="pending" stroke={CHART_COLORS.pending} strokeWidth={2} dot={false} name="Pending" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </>
      )}

      {/* ── Delivery Details Table ── */}
      {reportData?.deliveries && reportData.deliveries.length > 0 && (
        <div className="pp-card overflow-hidden">
          {/* Table header */}
          <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Delivery Details</h2>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                {sortedDeliveries.length} {sortedDeliveries.length === 1 ? 'delivery' : 'deliveries'} · Page {currentPage} of {totalPages || 1}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500 dark:text-gray-400">
                POD uploaded:{' '}
                <span className="font-semibold text-green-600 dark:text-green-400">{podWithCount}</span>
                {' '}/ {filteredDeliveries.length}
              </span>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-900/40 border-b border-gray-100 dark:border-gray-700">
                  <SortTh label="PO Number" sortKey="poNumber" sortConfig={sortConfig} onSort={handleSort} />
                  <SortTh label="Customer" sortKey="customer" sortConfig={sortConfig} onSort={handleSort} />
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Address</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Phone</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Customer</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">POD</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Driver</th>
                  <SortTh label="Date" sortKey="createdAt" sortConfig={sortConfig} onSort={handleSort} />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-gray-700/60">
                {paginatedDeliveries.length === 0 ? (
                  <tr>
                    <td colSpan="9" className="px-6 py-12 text-center">
                      <AlertCircle className="w-8 h-8 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
                      <p className="text-gray-500 dark:text-gray-400 text-sm">No deliveries match the selected filters</p>
                    </td>
                  </tr>
                ) : (
                  paginatedDeliveries.map((delivery) => {
                    const customerStatus = getCustomerStatus(delivery);
                    const status = delivery.status || 'Pending';
                    const badge = getStatusBadge(status);
                    const hasPOD = getPODStatus(delivery);
                    const photoCount = delivery.photoCount || (delivery.photos?.length ?? 0);
                    const hasDriverSig = !!(delivery.hasDriverSignature || delivery.driverSignature);
                    const hasCustomerSig = !!(delivery.hasCustomerSignature || delivery.customerSignature);
                    const podQuality = delivery.podQuality || (hasPOD ? 'Uploaded' : null);

                    return (
                      <tr
                        key={delivery.id || delivery.ID}
                        className={`transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/30 ${
                          !hasPOD && ['delivered','done','completed','delivered-with-installation','delivered-without-installation'].includes(status.toLowerCase())
                            ? 'bg-red-50/40 dark:bg-red-900/5'
                            : ''
                        }`}
                      >
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className="text-sm font-semibold text-primary-900 dark:text-primary-300">
                            {delivery.poNumber || delivery.PONumber || '—'}
                          </span>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded-full bg-primary-900/10 flex items-center justify-center flex-shrink-0">
                              <User className="w-3.5 h-3.5 text-primary-900 dark:text-primary-300" />
                            </div>
                            <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                              {delivery.customer || delivery.Customer || '—'}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3 max-w-[180px]">
                          <div className="flex items-start gap-1.5">
                            <MapPin className="w-3.5 h-3.5 text-gray-400 mt-0.5 flex-shrink-0" />
                            <span className="text-xs text-gray-500 dark:text-gray-400 truncate">
                              {delivery.address || delivery.Address || '—'}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-xs text-gray-500 dark:text-gray-400">
                          {delivery.phone || delivery.Phone || delivery.telephone1 || '—'}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-semibold rounded-full ${badge.cls}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${badge.dot}`} />
                            {formatStatusLabel(status)}
                          </span>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className={`px-2 py-0.5 text-xs font-semibold rounded-full ${getCustomerStatusBadge(customerStatus)}`}>
                            {customerStatus}
                          </span>
                        </td>
                        {/* POD Column */}
                        <td className="px-4 py-3 whitespace-nowrap">
                          {hasPOD ? (
                            <div className="flex flex-col gap-0.5">
                              <span className="flex items-center gap-1 text-xs font-semibold text-green-600 dark:text-green-400">
                                <CheckCircle className="w-3.5 h-3.5" />
                                {podQuality || 'Yes'}
                              </span>
                              <div className="flex items-center gap-1.5 mt-0.5">
                                {photoCount > 0 && (
                                  <span className="flex items-center gap-0.5 text-xs text-gray-500 dark:text-gray-400">
                                    <Camera className="w-3 h-3" />
                                    {photoCount}
                                  </span>
                                )}
                                {hasDriverSig && (
                                  <span className="text-xs px-1.5 py-0.5 bg-primary-100 text-primary-800 dark:bg-primary-900/30 dark:text-primary-300 rounded font-medium">D</span>
                                )}
                                {hasCustomerSig && (
                                  <span className="text-xs px-1.5 py-0.5 bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300 rounded font-medium">C</span>
                                )}
                              </div>
                            </div>
                          ) : (
                            <span className="flex items-center gap-1 text-xs text-gray-400 dark:text-gray-500">
                              <XCircle className="w-3.5 h-3.5 text-red-400" />
                              None
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-xs text-gray-500 dark:text-gray-400">
                          {delivery.driver_id || delivery.driverId || delivery.assignedDriverId || '—'}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-xs text-gray-500 dark:text-gray-400">
                          {formatDate(delivery.created_at || delivery.createdAt || delivery.created)}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="px-6 py-4 border-t border-gray-100 dark:border-gray-700 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Showing {(currentPage - 1) * itemsPerPage + 1}–{Math.min(currentPage * itemsPerPage, sortedDeliveries.length)} of {sortedDeliveries.length}
              </p>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="px-3 py-1.5 text-xs border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-600"
                >
                  Previous
                </button>
                {Array.from({ length: Math.min(7, totalPages) }, (_, i) => {
                  let p;
                  if (totalPages <= 7) p = i + 1;
                  else if (currentPage <= 4) p = i + 1;
                  else if (currentPage >= totalPages - 3) p = totalPages - 6 + i;
                  else p = currentPage - 3 + i;
                  return (
                    <button
                      key={p}
                      onClick={() => setCurrentPage(p)}
                      className={`px-3 py-1.5 text-xs rounded-lg ${
                        currentPage === p
                          ? 'bg-primary-900 text-white font-semibold'
                          : 'border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600'
                      }`}
                    >
                      {p}
                    </button>
                  );
                })}
                <button
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="px-3 py-1.5 text-xs border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-600"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Sub-components ─── */

function KpiCard({ label, value, icon, color, sub, trend }) {
  const configs = {
    navy:  { bg: 'bg-primary-900',  text: 'text-white', sub: 'text-primary-200', iconBg: 'bg-white/15' },
    green: { bg: 'bg-green-600',    text: 'text-white', sub: 'text-green-100',   iconBg: 'bg-white/15' },
    red:   { bg: 'bg-red-500',      text: 'text-white', sub: 'text-red-100',     iconBg: 'bg-white/15' },
    amber: { bg: 'bg-amber-500',    text: 'text-white', sub: 'text-amber-100',   iconBg: 'bg-white/15' },
  };
  const c = configs[color] || configs.navy;
  return (
    <div className={`${c.bg} rounded-xl p-5 flex flex-col gap-3 shadow-sm`}>
      <div className="flex items-center justify-between">
        <span className={`text-sm font-medium ${c.sub}`}>{label}</span>
        <div className={`w-8 h-8 rounded-lg ${c.iconBg} flex items-center justify-center ${c.text}`}>
          {icon}
        </div>
      </div>
      <div className="flex items-end justify-between">
        <span className={`text-3xl font-bold ${c.text}`}>{value ?? '—'}</span>
        {trend && (
          trend === 'up'
            ? <TrendingUp className="w-5 h-5 text-white/70" />
            : <TrendingDown className="w-5 h-5 text-white/70" />
        )}
      </div>
      {sub && <span className={`text-xs ${c.sub}`}>{sub}</span>}
    </div>
  );
}

function SortTh({ label, sortKey, sortConfig, onSort }) {
  const active = sortConfig.key === sortKey;
  return (
    <th
      className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide cursor-pointer select-none hover:text-gray-700 dark:hover:text-gray-200"
      onClick={() => onSort(sortKey)}
    >
      <div className="flex items-center gap-1">
        {label}
        {active
          ? sortConfig.direction === 'asc'
            ? <ChevronUp className="w-3 h-3" />
            : <ChevronDown className="w-3 h-3" />
          : <span className="w-3 h-3" />}
      </div>
    </th>
  );
}
