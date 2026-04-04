import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import PaginationBar from '../components/common/PaginationBar';
import api, { setAuthToken } from '../frontend/apiClient';
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid,
  type PieLabelRenderProps,
} from 'recharts';
import {
  Download, Filter, FileText, ChevronDown, ChevronUp,
  MapPin, Phone, User, Clock, Image, ArrowRight,
  CheckCircle, XCircle, Camera, RefreshCw, Package,
  TrendingUp, TrendingDown, AlertCircle, Search, X
} from 'lucide-react';

interface ReportDelivery {
  id?: string;
  ID?: string;
  poNumber?: string;
  PONumber?: string;
  customer?: string;
  Customer?: string;
  address?: string;
  Address?: string;
  phone?: string;
  Phone?: string;
  telephone1?: string;
  status?: string;
  actor_type?: string;
  cancelled_by?: string;
  rescheduled_by?: string;
  hasPOD?: boolean;
  driverSignature?: string;
  customerSignature?: string;
  photoCount?: number;
  photos?: unknown[];
  hasDriverSignature?: boolean;
  hasCustomerSignature?: boolean;
  podQuality?: string;
  driver_id?: string;
  driverId?: string;
  assignedDriverId?: string;
  created_at?: string;
  createdAt?: string;
  created?: string;
  [key: string]: unknown;
}

interface ReportStats {
  total?: number;
  delivered?: number;
  cancelled?: number;
  pending?: number;
  successRate?: number;
  cancellationRate?: number;
  withPOD?: number;
  withoutPOD?: number;
  customerAccepted?: number;
  customerCancelled?: number;
  customerRescheduled?: number;
}

interface DailyBreakdown {
  date: string;
  delivered?: number;
  cancelled?: number;
  rescheduled?: number;
  pending?: number;
  [key: string]: unknown;
}

interface StatusDistributionItem {
  status?: string;
  count?: number;
  percentage?: number;
  [key: string]: unknown;
}

interface ReportData {
  deliveries?: ReportDelivery[];
  stats?: ReportStats;
  dailyBreakdown?: DailyBreakdown[];
  statusDistribution?: StatusDistributionItem[];
  generatedAt?: string;
}

interface Filters {
  startDate: string;
  endDate: string;
  status: string;
  customerStatus: string;
  poNumber: string;
  podFilter: string;
}

interface SortConfig {
  key: string | null;
  direction: 'asc' | 'desc';
}

function ensureAuth(): void {
  const token = localStorage.getItem('auth_token');
  if (token) setAuthToken(token);
}

const CHART_COLORS = {
  delivered: '#22c55e',
  cancelled: '#ef4444',
  rescheduled: '#f59e0b',
  pending: '#64748b',
};
const PIE_COLORS = ['#22c55e', '#ef4444', '#f59e0b', '#64748b', '#8b5cf6', '#06b6d4'];

/** Matches Admin Dashboard KPI tiles (tinted icon + bold value). */
const REPORT_KPI_COLOR_MAP: Record<string, { bg: string; icon: string; val: string }> = {
  blue: {
    bg: 'bg-blue-50 dark:bg-blue-900/20',
    icon: 'text-blue-600 dark:text-blue-400',
    val: 'text-blue-700 dark:text-blue-300',
  },
  green: {
    bg: 'bg-green-50 dark:bg-green-900/20',
    icon: 'text-green-600 dark:text-green-400',
    val: 'text-green-700 dark:text-green-300',
  },
  red: {
    bg: 'bg-red-50 dark:bg-red-900/20',
    icon: 'text-red-600 dark:text-red-400',
    val: 'text-red-700 dark:text-red-300',
  },
  yellow: {
    bg: 'bg-yellow-50 dark:bg-yellow-900/20',
    icon: 'text-yellow-600 dark:text-yellow-400',
    val: 'text-yellow-700 dark:text-yellow-300',
  },
};

const inputReportsClass =
  'w-full rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-slate-800/90 px-3 py-2.5 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/35';

type ReportMetricTone = 'blue' | 'green' | 'red' | 'yellow';

interface ReportMetricCardProps {
  label: string;
  value: number | string;
  icon: React.ReactNode;
  tone: ReportMetricTone;
  sub?: string;
  trend?: 'up' | 'down';
}

/** Same visual language as Admin Dashboard overview KPIs (`pp-dash-card`). */
function ReportMetricCard({ label, value, icon, tone, sub, trend }: ReportMetricCardProps): React.ReactElement {
  const c = REPORT_KPI_COLOR_MAP[tone];
  const iconEl = React.isValidElement(icon)
    ? React.cloneElement(icon as React.ReactElement<{ className?: string }>, {
        className: `w-4 h-4 shrink-0 ${c.icon}`,
      })
    : icon;
  return (
    <div className="pp-dash-card p-4 sm:p-5 w-full min-w-0">
      <div className="flex items-start gap-3">
        <div className={`p-2.5 rounded-full shrink-0 ${c.bg}`}>{iconEl}</div>
        <div className="min-w-0 flex-1">
          <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide leading-snug">
            {label}
          </span>
          <div className="flex flex-wrap items-end justify-between gap-2 mt-1">
            <span className={`text-2xl sm:text-3xl font-bold tracking-tight tabular-nums ${c.val}`}>{value ?? '—'}</span>
            {trend ? (
              trend === 'up' ? (
                <TrendingUp className="w-5 h-5 text-green-500 dark:text-green-400 shrink-0" aria-hidden />
              ) : (
                <TrendingDown className="w-5 h-5 text-red-500 dark:text-red-400 shrink-0" aria-hidden />
              )
            ) : null}
          </div>
          {sub ? <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{sub}</p> : null}
        </div>
      </div>
    </div>
  );
}

export default function AdminReportsPage(): React.ReactElement {
  const [reportData, setReportData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [filters, setFilters] = useState<Filters>({
    startDate: '',
    endDate: '',
    status: '',
    customerStatus: '',
    poNumber: '',
    podFilter: '',
  });
  const [sortConfig, setSortConfig] = useState<SortConfig>({ key: null, direction: 'asc' });
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [itemsPerPage] = useState<number>(20);
  const deliveryTableTopRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    ensureAuth();
    void loadReport();
  }, []);

  // Auto-apply date filter with debounce when dates change
  const dateDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (dateDebounceRef.current) clearTimeout(dateDebounceRef.current);
    dateDebounceRef.current = setTimeout(() => {
      void loadReport();
    }, 400);
    return () => {
      if (dateDebounceRef.current) clearTimeout(dateDebounceRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.startDate, filters.endDate]);

  const loadReport = async (exportFormat: string | null = null): Promise<void> => {
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
          ? `${import.meta.env.VITE_API_URL as string}/api/admin/reports`
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
        const rangeLabel = filters.startDate && filters.endDate
          ? `${filters.startDate}-to-${filters.endDate}`
          : 'all-dates';
        a.download = `electrolux-deliveries-${rangeLabel}.csv`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      } else {
        const response = await api.get(`/admin/reports?${params.toString()}`);
        setReportData(response.data as ReportData);
        setCurrentPage(1);
      }
    } catch (err: unknown) {
      const e = err as { message?: string; response?: { data?: { error?: string } } };
      console.error('Error loading report:', err);
      alert('Failed to load report: ' + (e?.response?.data?.error || e.message));
    } finally {
      setLoading(false);
    }
  };

  const handleFilterChange = (key: keyof Filters, value: string): void => {
    setFilters(prev => ({ ...prev, [key]: value }));
    setCurrentPage(1);
  };

  const hasActiveFilters = (): boolean =>
    !!(filters.startDate || filters.endDate || filters.status || filters.customerStatus || filters.poNumber || filters.podFilter);

  const hasDateFilters = (): boolean => !!(filters.startDate || filters.endDate);

  const clearDateFilters = (): void => {
    setFilters(prev => ({ ...prev, startDate: '', endDate: '' }));
    setCurrentPage(1);
  };

  const clearFilters = (): void => {
    setFilters({ startDate: '', endDate: '', status: '', customerStatus: '', poNumber: '', podFilter: '' });
    setCurrentPage(1);
  };

  const getCustomerStatus = (delivery: ReportDelivery): string => {
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
    return 'No Response (24h+)';
  };

  const getPODStatus = (delivery: ReportDelivery): boolean => {
    return !!(
      delivery.hasPOD ||
      delivery.driverSignature ||
      delivery.customerSignature ||
      (delivery.photoCount && delivery.photoCount > 0) ||
      (delivery.photos && delivery.photos.length > 0)
    );
  };

  const filteredDeliveries = useMemo<ReportDelivery[]>(() => {
    if (!reportData?.deliveries) return [];
    let filtered = [...reportData.deliveries];

    if (filters.status) {
      filtered = filtered.filter(d => {
        const s = (d.status || '').toLowerCase();
        // 'pending' filter covers both 'pending' and 'uploaded' DB statuses
        if (filters.status.toLowerCase() === 'pending') return s === 'pending' || s === 'uploaded';
        return s === filters.status.toLowerCase();
      });
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

  const sortedDeliveries = useMemo<ReportDelivery[]>(() => {
    if (!sortConfig.key) return filteredDeliveries;
    return [...filteredDeliveries].sort((a, b) => {
      let av: unknown = a[sortConfig.key as string];
      let bv: unknown = b[sortConfig.key as string];
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

  const paginatedDeliveries = useMemo<ReportDelivery[]>(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return sortedDeliveries.slice(start, start + itemsPerPage);
  }, [sortedDeliveries, currentPage, itemsPerPage]);

  const totalPages = Math.ceil(sortedDeliveries.length / itemsPerPage);

  const handleSort = (key: string): void => {
    setSortConfig(prev =>
      prev.key === key
        ? { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' }
        : { key, direction: 'asc' }
    );
  };

  const goToReportPage = (page: number): void => {
    setCurrentPage(page);
    deliveryTableTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const getStatusBadge = (status: string): { cls: string; dot: string } => {
    const s = (status || '').toLowerCase();
    if (['delivered', 'done', 'completed', 'delivered-with-installation', 'delivered-without-installation'].includes(s))
      return { cls: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300', dot: 'bg-green-500' };
    if (['cancelled', 'canceled', 'rejected'].includes(s))
      return { cls: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300', dot: 'bg-red-500' };
    if (s === 'rescheduled')
      return { cls: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300', dot: 'bg-amber-500' };
    if (['scheduled', 'scheduled-confirmed'].includes(s))
      return { cls: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300', dot: 'bg-blue-500' };
    if (['out-for-delivery', 'in-progress'].includes(s))
      return { cls: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300', dot: 'bg-purple-500' };
    return { cls: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300', dot: 'bg-gray-400' };
  };

  const getCustomerStatusBadge = (status: string): string => {
    if (status === 'Accepted') return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300';
    if (status === 'Cancelled') return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300';
    if (status === 'Rescheduled') return 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300';
    return 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400';
  };

  const formatDate = (val: string | null | undefined): string => {
    if (!val) return '—';
    return new Date(val).toLocaleDateString('en-AE', { year: 'numeric', month: 'short', day: 'numeric' });
  };

  const STATUS_DISPLAY: Record<string, string> = {
    'pending':                        'Pending Order',
    'uploaded':                       'Pending Order',
    'scheduled':                      'Awaiting Customer',
    'scheduled-confirmed':            'Confirmed',
    'out-for-delivery':               'On Route',
    'in-transit':                     'In Transit',
    'in-progress':                    'In Progress',
    'delivered':                      'Delivered',
    'delivered-with-installation':    'Delivered (With Install)',
    'delivered-without-installation': 'Delivered (No Install)',
    'completed':                      'Completed',
    'pod-completed':                  'POD Completed',
    'cancelled':                      'Cancelled',
    'rescheduled':                    'Rescheduled',
    'returned':                       'Returned',
    'failed':                         'Failed',
    'rejected':                       'Rejected',
  };

  const formatStatusLabel = (status: string): string => {
    const key = (status || '').toLowerCase();
    if (STATUS_DISPLAY[key]) return STATUS_DISPLAY[key];
    return status.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  };

  if (!reportData && !loading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <FileText className="w-14 h-14 text-gray-300 dark:text-gray-600" />
        <p className="text-gray-500 dark:text-gray-400">No report data. Click Refresh to load.</p>
        <button
          type="button"
          onClick={() => void loadReport()}
          className="px-5 py-2.5 rounded-xl bg-blue-900 text-white hover:bg-blue-800 font-semibold shadow-sm"
        >
          Load Report
        </button>
      </div>
    );
  }

  const stats: ReportStats = reportData?.stats || {};
  const dailyBreakdown: DailyBreakdown[] = reportData?.dailyBreakdown || [];
  const statusDistribution: StatusDistributionItem[] = reportData?.statusDistribution || [];

  const podWithCount = filteredDeliveries.filter(d => getPODStatus(d)).length;
  const podWithoutCount = filteredDeliveries.filter(d => !getPODStatus(d)).length;
  const podTotal = podWithCount + podWithoutCount;
  const podRate = podTotal > 0 ? ((podWithCount / podTotal) * 100).toFixed(1) : '0.0';

  return (
    <div className="space-y-5 w-full min-w-0">

      {/* ── Page Header (aligned with Admin Dashboard) ── */}
      <div className="pp-page-header flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h1 className="pp-page-title">Reports & Analytics</h1>
          <p className="pp-page-subtitle">
            Electrolux Dubai Logistics · Generated:{' '}
            {reportData?.generatedAt ? new Date(reportData.generatedAt).toLocaleString('en-AE') : '—'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 shrink-0 w-full sm:w-auto">
          <Link
            to="/admin/reports/pod"
            className="inline-flex items-center justify-center gap-2 w-full sm:w-auto px-4 py-2.5 text-sm font-semibold rounded-xl bg-blue-900 text-white hover:bg-blue-800 shadow-sm transition-colors"
          >
            <Image className="w-4 h-4" />
            POD Report
            <ArrowRight className="w-4 h-4" />
          </Link>
          <button
            type="button"
            onClick={() => void loadReport('csv')}
            disabled={loading}
            className="inline-flex items-center justify-center gap-2 w-full sm:w-auto px-4 py-2.5 text-sm font-semibold rounded-xl bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 shadow-sm transition-colors"
          >
            <Download className="w-4 h-4" />
            Export CSV
          </button>
          <button
            type="button"
            onClick={() => void loadReport()}
            disabled={loading}
            className="inline-flex items-center justify-center gap-2 w-full sm:w-auto px-4 py-2.5 text-sm font-medium rounded-2xl border border-gray-200/90 dark:border-white/10 bg-white dark:bg-slate-800/90 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-slate-700 disabled:opacity-50 shadow-sm transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* ── Filters ── */}
      <div className="pp-card p-5 sm:p-6">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-9 h-9 rounded-xl bg-blue-900/10 dark:bg-blue-400/10 flex items-center justify-center">
            <Filter className="w-4 h-4 text-blue-900 dark:text-blue-300" />
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
              className={inputReportsClass}
            />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">To</label>
              {hasDateFilters() && (
                <button
                  type="button"
                  onClick={clearDateFilters}
                  className="inline-flex items-center gap-1 text-[11px] text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 font-medium"
                >
                  <X className="w-3 h-3" /> Clear dates
                </button>
              )}
            </div>
            <input
              type="date"
              value={filters.endDate}
              onChange={e => handleFilterChange('endDate', e.target.value)}
              className={inputReportsClass}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">Delivery Status</label>
            <select
              value={filters.status}
              onChange={e => handleFilterChange('status', e.target.value)}
              className={inputReportsClass}
            >
              <option value="">All Statuses</option>
              <option value="delivered">Delivered</option>
              <option value="delivered-with-installation">Delivered (With Installation)</option>
              <option value="delivered-without-installation">Delivered (Without Installation)</option>
              <option value="pending">Pending Order</option>
              <option value="scheduled">Awaiting Customer (SMS sent)</option>
              <option value="scheduled-confirmed">Confirmed (future date set)</option>
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
              className={inputReportsClass}
            >
              <option value="">All Responses</option>
              <option value="accepted">Accepted</option>
              <option value="cancelled">Cancelled</option>
              <option value="rescheduled">Rescheduled</option>
              <option value="no response (24h+)">No Response (24h+)</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">POD Status</label>
            <select
              value={filters.podFilter}
              onChange={e => handleFilterChange('podFilter', e.target.value)}
              className={inputReportsClass}
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
                className={`${inputReportsClass} pl-8`}
              />
            </div>
          </div>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mt-4 pt-4 border-t border-gray-100 dark:border-gray-700/80">
          <div className="flex flex-wrap items-center gap-3">
            {loading && (
              <span className="inline-flex items-center gap-2 text-sm text-blue-600 dark:text-blue-400">
                <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Updating…
              </span>
            )}
            {hasActiveFilters() && (
              <button
                type="button"
                onClick={clearFilters}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 font-medium transition-colors"
              >
                <X className="w-4 h-4" />
                Clear all filters
              </button>
            )}
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            <span className="font-semibold text-gray-900 dark:text-gray-100">{filteredDeliveries.length}</span> {filteredDeliveries.length === 1 ? 'delivery' : 'deliveries'} shown
          </p>
        </div>
      </div>

      {/* ── KPI strip — same grid + card system as Admin Dashboard ── */}
      <div className="pp-kpi-grid--fill-4">
        <ReportMetricCard
          label="Total Deliveries"
          value={stats.total ?? filteredDeliveries.length}
          icon={<Package className="w-5 h-5" />}
          tone="blue"
        />
        <ReportMetricCard
          label="Delivered"
          value={stats.delivered ?? 0}
          icon={<CheckCircle className="w-5 h-5" />}
          tone="green"
          sub={`${stats.successRate ?? 0}% success rate`}
          trend="up"
        />
        <ReportMetricCard
          label="Cancelled"
          value={stats.cancelled ?? 0}
          icon={<XCircle className="w-5 h-5" />}
          tone="red"
          sub={`${stats.cancellationRate ?? 0}% cancellation rate`}
          trend="down"
        />
        <ReportMetricCard
          label="Pending Orders"
          value={stats.pending ?? 0}
          icon={<Clock className="w-5 h-5" />}
          tone="yellow"
        />
      </div>

      {/* ── POD Overview ── */}
      <div className="pp-card p-5 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-blue-900/10 dark:bg-blue-400/10 flex items-center justify-center">
              <Image className="w-4 h-4 text-blue-900 dark:text-blue-300" />
            </div>
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Proof of Delivery (POD) Overview</h2>
          </div>
          <Link
            to="/admin/reports/pod"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-blue-600 dark:text-blue-400 hover:underline shrink-0"
          >
            Full POD Report <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
          <div className="pp-dash-card p-4 rounded-xl">
            <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">With POD</span>
            <span className="block text-2xl sm:text-3xl font-bold text-green-600 dark:text-green-400 mt-1 tabular-nums">
              {hasActiveFilters() ? podWithCount : (stats.withPOD ?? podWithCount)}
            </span>
            <span className="text-xs text-gray-500 dark:text-gray-400 mt-1 block">
              {hasActiveFilters() ? podRate : ((stats.delivered ?? 0) > 0 ? (((stats.withPOD ?? 0) / (stats.delivered as number)) * 100).toFixed(1) : podRate)}% of delivered orders
            </span>
          </div>
          <div className="pp-dash-card p-4 rounded-xl">
            <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Without POD</span>
            <span className="block text-2xl sm:text-3xl font-bold text-red-600 dark:text-red-400 mt-1 tabular-nums">
              {hasActiveFilters() ? podWithoutCount : (stats.withoutPOD ?? podWithoutCount)}
            </span>
            <span className="text-xs text-gray-500 dark:text-gray-400 mt-1 block">Missing signatures / photos</span>
          </div>
          <div className="pp-dash-card p-4 rounded-xl">
            <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Completion Rate</span>
            <span className="block text-2xl sm:text-3xl font-bold text-blue-700 dark:text-blue-300 mt-1 tabular-nums">
              {hasActiveFilters() ? `${podRate}%` : `${(stats.delivered ?? 0) > 0 ? (((stats.withPOD ?? 0) / (stats.delivered as number)) * 100).toFixed(1) : 0}%`}
            </span>
            <span className="text-xs text-gray-500 dark:text-gray-400 mt-1 block">POD uploads vs deliveries</span>
          </div>
        </div>
        <div className="pp-dash-soft-gradient rounded-xl p-4">
          <div className="flex justify-between text-xs font-medium text-gray-600 dark:text-gray-300 mb-2">
            <span>POD Completion</span>
            <span>
              {hasActiveFilters() ? `${podRate}%` : `${(stats.delivered ?? 0) > 0 ? (((stats.withPOD ?? 0) / (stats.delivered as number)) * 100).toFixed(1) : 0}%`}
            </span>
          </div>
          <div className="h-2.5 bg-white/80 dark:bg-slate-900/40 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-blue-700 to-green-500 rounded-full transition-all duration-500"
              style={{
                width: `${hasActiveFilters()
                  ? podRate
                  : (stats.delivered ?? 0) > 0 ? (((stats.withPOD ?? 0) / (stats.delivered as number)) * 100).toFixed(1) : 0}%`,
              }}
            />
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
            POD includes: driver signature, customer signature, or delivery photos
          </p>
        </div>
      </div>

      {/* ── Customer Response Stats ── */}
      {!hasActiveFilters() && (
        <div className="pp-card p-5 sm:p-6">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-9 h-9 rounded-xl bg-blue-900/10 dark:bg-blue-400/10 flex items-center justify-center">
              <User className="w-4 h-4 text-blue-900 dark:text-blue-300" />
            </div>
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Customer Response Statistics</h2>
          </div>
          <div className="pp-kpi-grid--fill-3">
            <ReportMetricCard
              label="Customer Accepted"
              value={stats.customerAccepted ?? 0}
              icon={<CheckCircle className="w-5 h-5" />}
              tone="green"
              sub={`${(stats.total ?? 0) > 0 ? (((stats.customerAccepted ?? 0) / (stats.total as number)) * 100).toFixed(1) : 0}% acceptance rate`}
            />
            <ReportMetricCard
              label="Customer Cancelled"
              value={stats.customerCancelled ?? 0}
              icon={<XCircle className="w-5 h-5" />}
              tone="red"
              sub={`${(stats.total ?? 0) > 0 ? (((stats.customerCancelled ?? 0) / (stats.total as number)) * 100).toFixed(1) : 0}% cancellation rate`}
            />
            <ReportMetricCard
              label="Customer Rescheduled"
              value={stats.customerRescheduled ?? 0}
              icon={<RefreshCw className="w-5 h-5" />}
              tone="yellow"
              sub={`${(stats.total ?? 0) > 0 ? (((stats.customerRescheduled ?? 0) / (stats.total as number)) * 100).toFixed(1) : 0}% reschedule rate`}
            />
          </div>
        </div>
      )}

      {/* ── Charts ── */}
      {!hasActiveFilters() && dailyBreakdown.length > 0 && (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:gap-5">
            <div className="pp-dash-card p-5 sm:p-6 reports-chart-card">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 tracking-tight mb-4">Daily Breakdown</h2>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={dailyBreakdown} margin={{ top: 4, right: 4, bottom: 4, left: -10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--muted)' }} />
                  <YAxis tick={{ fontSize: 11, fill: 'var(--muted)' }} />
                  <Tooltip wrapperStyle={{ zIndex: 9999 }} contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '12px', color: 'var(--text)', fontSize: 13, padding: '10px 14px', minWidth: 130, boxShadow: '0 8px 24px -4px rgba(0,0,0,0.18)' }} />
                  <Legend wrapperStyle={{ fontSize: 12, color: 'var(--text2)' }} />
                  <Bar dataKey="delivered" stackId="a" fill={CHART_COLORS.delivered} name="Delivered" radius={[0,0,0,0]} />
                  <Bar dataKey="cancelled" stackId="a" fill={CHART_COLORS.cancelled} name="Cancelled" />
                  <Bar dataKey="rescheduled" stackId="a" fill={CHART_COLORS.rescheduled} name="Rescheduled" />
                  <Bar dataKey="pending" stackId="a" fill={CHART_COLORS.pending} name="Pending" radius={[4,4,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="pp-dash-card p-5 sm:p-6 reports-chart-card">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 tracking-tight mb-4">Status Distribution</h2>
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie
                    data={statusDistribution.map((row) => ({
                      ...row,
                      name: formatStatusLabel(String(row.status || 'Unknown')),
                    }))}
                    cx="50%" cy="50%"
                    outerRadius={95}
                    innerRadius={40}
                    labelLine={false}
                    label={(props: PieLabelRenderProps) => {
                      const p = Number(props.percent ?? 0);
                      return `${Number.isFinite(p) ? Math.round(p * 100) : 0}%`;
                    }}
                    nameKey="name"
                    dataKey="count"
                  >
                    {statusDistribution.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    wrapperStyle={{ zIndex: 9999 }}
                    contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '12px', color: 'var(--text)', fontSize: 13, padding: '10px 14px', minWidth: 130, boxShadow: '0 8px 24px -4px rgba(0,0,0,0.18)' }}
                    formatter={(value: number | string, name: string) => [value, name === 'count' ? 'Orders' : name]}
                  />
                  <Legend wrapperStyle={{ fontSize: 12, color: 'var(--text2)' }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="pp-dash-card p-5 sm:p-6 reports-chart-card">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 tracking-tight mb-4">Daily Delivery Trend</h2>
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={dailyBreakdown} margin={{ top: 4, right: 4, bottom: 4, left: -10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--muted)' }} />
                <YAxis tick={{ fontSize: 11, fill: 'var(--muted)' }} />
                <Tooltip wrapperStyle={{ zIndex: 9999 }} contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '12px', color: 'var(--text)', fontSize: 13, padding: '10px 14px', minWidth: 130, boxShadow: '0 8px 24px -4px rgba(0,0,0,0.18)' }} />
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
        <div className="pp-dash-card overflow-hidden">
          <div ref={deliveryTableTopRef} />
          <div className="px-5 sm:px-6 py-4 border-b border-gray-100 dark:border-white/[0.07] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 tracking-tight">Delivery Details</h2>
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
            <table className="pp-mobile-stack-table min-w-[980px]">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-900/40 border-b border-gray-100 dark:border-gray-700">
                  <SortTh label="PO Number" sortKey="poNumber" sortConfig={sortConfig} onSort={handleSort} />
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Delivery Number</th>
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
                    <td colSpan={9} className="px-6 py-12 text-center">
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
                        key={(delivery.id || delivery.ID) as string}
                        className={`transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/30 ${
                          !hasPOD && ['delivered','done','completed','delivered-with-installation','delivered-without-installation'].includes(status.toLowerCase())
                            ? 'bg-red-50/40 dark:bg-red-900/5'
                            : ''
                        }`}
                      >
                        <td className="px-4 py-3 whitespace-nowrap" data-label="PO Number">
                          <span className="text-sm font-semibold text-blue-900 dark:text-blue-300">
                            {delivery.poNumber || delivery.PONumber || '—'}
                          </span>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap" data-label="Delivery Number">
                          <span className="text-sm text-gray-500 dark:text-gray-400">
                            {(delivery.metadata as { originalDeliveryNumber?: string } | null | undefined)?.originalDeliveryNumber || (delivery as unknown as { _originalDeliveryNumber?: string })._originalDeliveryNumber || '—'}
                          </span>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap" data-label="Customer">
                          <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded-full bg-blue-900/10 flex items-center justify-center flex-shrink-0">
                              <User className="w-3.5 h-3.5 text-blue-900 dark:text-blue-300" />
                            </div>
                            <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                              {delivery.customer || delivery.Customer || '—'}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3 max-w-[180px]" data-label="Address">
                          <div className="flex items-start gap-1.5">
                            <MapPin className="w-3.5 h-3.5 text-gray-400 mt-0.5 flex-shrink-0" />
                            <span className="text-xs text-gray-500 dark:text-gray-400 truncate">
                              {delivery.address || delivery.Address || '—'}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-xs text-gray-500 dark:text-gray-400" data-label="Phone">
                          {(delivery.phone || delivery.Phone || delivery.telephone1 || '—') as string}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap" data-label="Status">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-semibold rounded-full ${badge.cls}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${badge.dot}`} />
                            {formatStatusLabel(status)}
                          </span>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap" data-label="Customer Status">
                          <span className={`px-2 py-0.5 text-xs font-semibold rounded-full ${getCustomerStatusBadge(customerStatus)}`}>
                            {customerStatus}
                          </span>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap" data-label="POD">
                          {hasPOD ? (
                            <div className="flex flex-col gap-0.5">
                              <span className="flex items-center gap-1 text-xs font-semibold text-green-600 dark:text-green-400">
                                <CheckCircle className="w-3.5 h-3.5" />
                                {podQuality || 'Yes'}
                              </span>
                              <div className="flex items-center gap-1.5 mt-0.5">
                                {(photoCount as number) > 0 && (
                                  <span className="flex items-center gap-0.5 text-xs text-gray-500 dark:text-gray-400">
                                    <Camera className="w-3 h-3" />
                                    {photoCount as number}
                                  </span>
                                )}
                                {hasDriverSig && (
                                  <span className="text-xs px-1.5 py-0.5 bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300 rounded font-medium">D</span>
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
                        <td className="px-4 py-3 whitespace-nowrap text-xs text-gray-500 dark:text-gray-400" data-label="Driver">
                          {(delivery.driver_id || delivery.driverId || delivery.assignedDriverId || '—') as string}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-xs text-gray-500 dark:text-gray-400" data-label="Date">
                          {formatDate(delivery.created_at || delivery.createdAt || delivery.created as string | undefined)}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <PaginationBar
            page={currentPage}
            totalPages={totalPages}
            pageSize={itemsPerPage}
            total={sortedDeliveries.length}
            onPageChange={goToReportPage}
          />
        </div>
      )}
    </div>
  );
}

/* ─── Sub-components ─── */

interface SortThProps {
  label: string;
  sortKey: string;
  sortConfig: SortConfig;
  onSort: (key: string) => void;
}

function SortTh({ label, sortKey, sortConfig, onSort }: SortThProps): React.ReactElement {
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
