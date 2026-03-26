import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { setAuthToken } from '../frontend/apiClient';
import {
  Download, Filter, Image, CheckCircle, XCircle, AlertTriangle,
  Camera, FileText, User, Clock, ArrowLeft, RefreshCw, Search,
  Award, TrendingUp, Shield, PenLine
} from 'lucide-react';

interface PODStats {
  totalDelivered?: number;
  withPOD?: number;
  withoutPOD?: number;
  totalPhotos?: number;
  podCompletionRate?: number;
  completePOD?: number;
  goodPOD?: number;
  partialPOD?: number;
  withDriverSignature?: number;
  withCustomerSignature?: number;
  withPhotos?: number;
}

interface DailyBreakdownItem {
  date: string;
  total: number;
  withPOD: number;
  withoutPOD: number;
  totalPhotos: number;
}

interface DriverBreakdownItem {
  driverName?: string;
  total: number;
  withPOD: number;
  withoutPOD: number;
  totalPhotos: number;
}

interface PODDelivery {
  id?: string;
  poNumber?: string;
  customer?: string;
  address?: string;
  status?: string;
  hasPOD?: boolean;
  podQuality?: string;
  photoCount?: number;
  hasDriverSignature?: boolean;
  hasCustomerSignature?: boolean;
  driverName?: string;
  deliveredAt?: string;
}

interface PODReportData {
  stats?: PODStats;
  deliveries?: PODDelivery[];
  dailyBreakdown?: DailyBreakdownItem[];
  driverBreakdown?: DriverBreakdownItem[];
  generatedAt?: string;
}

interface PODFilters {
  startDate: string;
  endDate: string;
  podStatus: string;
}

function ensureAuth(): void {
  const token = localStorage.getItem('auth_token');
  if (token) setAuthToken(token);
}

export default function AdminPODReportPage(): React.ReactElement {
  const [reportData, setReportData] = useState<PODReportData | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [filters, setFilters] = useState<PODFilters>({
    startDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    endDate: new Date().toISOString().split('T')[0],
    podStatus: 'all',
  });

  useEffect(() => {
    ensureAuth();
    void loadReport();
  }, []);

  const loadReport = async (exportFormat: string | null = null): Promise<void> => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.startDate) params.append('startDate', filters.startDate);
      if (filters.endDate) params.append('endDate', filters.endDate);
      if (filters.podStatus && filters.podStatus !== 'all') params.append('podStatus', filters.podStatus);
      if (exportFormat) params.append('format', exportFormat);

      if (exportFormat === 'csv' || exportFormat === 'html') {
        const token = localStorage.getItem('auth_token');
        const clientKey = localStorage.getItem('client_key');
        const apiUrl = import.meta.env.VITE_API_URL
          ? `${import.meta.env.VITE_API_URL as string}/api/admin/reports/pod`
          : `/api/admin/reports/pod`;
        const response = await fetch(`${apiUrl}?${params.toString()}`, {
          headers: {
            'Authorization': token ? `Bearer ${token}` : '',
            'X-Client-Key': clientKey || '',
          },
        });
        if (!response.ok) throw new Error(`Failed to download ${exportFormat.toUpperCase()}`);
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = exportFormat === 'csv'
          ? `electrolux-pod-report-${filters.startDate}-to-${filters.endDate}.csv`
          : `electrolux-pod-report-with-images-${filters.startDate}.html`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      } else {
        const response = await api.get(`/admin/reports/pod?${params.toString()}`);
        setReportData(response.data as PODReportData);
      }
    } catch (err: unknown) {
      const e = err as { message?: string; response?: { data?: { error?: string } } };
      console.error('Error loading POD report:', err);
      alert('Failed to load POD report: ' + (e?.response?.data?.error || e.message));
    } finally {
      setLoading(false);
    }
  };

  const handleFilterChange = (key: keyof PODFilters, value: string): void => {
    setFilters(prev => ({ ...prev, [key]: value }));
  };

  const formatDate = (val: string | null | undefined): string => {
    if (!val) return '—';
    return new Date(val).toLocaleDateString('en-AE', { year: 'numeric', month: 'short', day: 'numeric' });
  };

  const getCompletionColor = (pct: number): string => {
    if (pct >= 90) return 'text-green-600 dark:text-green-400';
    if (pct >= 60) return 'text-amber-600 dark:text-amber-400';
    return 'text-red-500 dark:text-red-400';
  };

  const getCompletionBarColor = (pct: number): string => {
    if (pct >= 90) return 'from-green-500 to-green-600';
    if (pct >= 60) return 'from-amber-500 to-amber-600';
    return 'from-red-500 to-red-600';
  };

  if (loading && !reportData) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <RefreshCw className="w-10 h-10 text-blue-700 dark:text-blue-300 animate-spin mx-auto mb-3" />
          <p className="text-gray-600 dark:text-gray-400 font-medium">Loading POD Report…</p>
        </div>
      </div>
    );
  }

  if (!reportData) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <Image className="w-14 h-14 text-gray-300 dark:text-gray-600" />
        <p className="text-gray-500 dark:text-gray-400">No POD data available.</p>
        <button
          onClick={() => void loadReport()}
          className="px-5 py-2.5 bg-blue-900 text-white rounded-lg hover:bg-blue-800 font-medium"
        >
          Load Report
        </button>
      </div>
    );
  }

  const stats: PODStats = reportData?.stats || {};
  const deliveries: PODDelivery[] = reportData?.deliveries || [];
  const dailyBreakdown: DailyBreakdownItem[] = reportData?.dailyBreakdown || [];
  const driverBreakdown: DriverBreakdownItem[] = reportData?.driverBreakdown || [];

  const overallPct = (stats.totalDelivered ?? 0) > 0
    ? Math.round(((stats.withPOD ?? 0) / (stats.totalDelivered as number)) * 100)
    : 0;

  return (
    <div className="space-y-6">

      {/* ── Back + Header ── */}
      <div>
        <Link
          to="/admin/reports"
          className="inline-flex items-center gap-2 px-3 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-blue-900 dark:hover:text-blue-300 font-medium"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Reports
        </Link>
      </div>

      <div className="pp-page-header flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="pp-page-title flex items-center gap-2">
            <Shield className="w-7 h-7 text-blue-900 dark:text-blue-300" />
            Proof of Delivery Report
          </h1>
          <p className="pp-page-subtitle">Signature & photo verification for all delivered orders</p>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
            Generated: {reportData?.generatedAt ? new Date(reportData.generatedAt).toLocaleString('en-AE') : '—'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => void loadReport('csv')}
            disabled={loading}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 font-medium text-sm"
          >
            <Download className="w-4 h-4" />
            Export CSV
          </button>
          <button
            onClick={() => void loadReport('html')}
            disabled={loading}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-blue-700 text-white rounded-lg hover:bg-blue-900 disabled:opacity-50 font-medium text-sm"
          >
            <Camera className="w-4 h-4" />
            Export with Images
          </button>
          <button
            onClick={() => void loadReport()}
            disabled={loading}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-blue-900 text-white rounded-lg hover:bg-blue-800 disabled:opacity-50 font-medium text-sm"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* ── Filters ── */}
      <div className="pp-card p-5">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-8 h-8 rounded-lg bg-blue-900/10 flex items-center justify-center">
            <Filter className="w-4 h-4 text-blue-900 dark:text-blue-300" />
          </div>
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Filters</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">From</label>
            <input
              type="date"
              value={filters.startDate}
              onChange={e => handleFilterChange('startDate', e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">To</label>
            <input
              type="date"
              value={filters.endDate}
              onChange={e => handleFilterChange('endDate', e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">POD Status</label>
            <select
              value={filters.podStatus}
              onChange={e => handleFilterChange('podStatus', e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">All Delivered Orders</option>
              <option value="with-pod">✓ With POD (Verified)</option>
              <option value="without-pod">✗ Without POD (Missing)</option>
            </select>
          </div>
        </div>
        <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-100 dark:border-gray-700">
          <button
            onClick={() => void loadReport()}
            disabled={loading}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-900 text-white rounded-lg hover:bg-blue-800 disabled:opacity-50 text-sm font-medium"
          >
            <Search className="w-4 h-4" />
            Apply Filters
          </button>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            <span className="font-semibold text-gray-900 dark:text-gray-100">{deliveries.length}</span> delivered order{deliveries.length !== 1 ? 's' : ''}
          </p>
        </div>
      </div>

      {/* ── Headline KPI cards ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-gradient-to-br from-blue-900 to-blue-700 rounded-xl p-5 text-white shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-blue-200 uppercase tracking-wide">Total Delivered</span>
            <div className="w-9 h-9 bg-white/15 rounded-lg flex items-center justify-center">
              <FileText className="w-5 h-5" />
            </div>
          </div>
          <div className="text-3xl font-bold">{stats.totalDelivered ?? 0}</div>
          <div className="text-xs text-blue-200 mt-1">Orders in period</div>
        </div>

        <div className="bg-gradient-to-br from-green-600 to-green-700 rounded-xl p-5 text-white shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-green-100 uppercase tracking-wide">With POD</span>
            <div className="w-9 h-9 bg-white/15 rounded-lg flex items-center justify-center">
              <CheckCircle className="w-5 h-5" />
            </div>
          </div>
          <div className="text-3xl font-bold">{stats.withPOD ?? 0}</div>
          <div className="text-xs text-green-100 mt-1">{stats.podCompletionRate ?? overallPct}% completion rate</div>
        </div>

        <div className="bg-gradient-to-br from-red-500 to-red-600 rounded-xl p-5 text-white shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-red-100 uppercase tracking-wide">Without POD</span>
            <div className="w-9 h-9 bg-white/15 rounded-lg flex items-center justify-center">
              <XCircle className="w-5 h-5" />
            </div>
          </div>
          <div className="text-3xl font-bold">{stats.withoutPOD ?? 0}</div>
          <div className="text-xs text-red-100 mt-1">Missing verification</div>
        </div>

        <div className="bg-gradient-to-br from-blue-600 to-blue-800 rounded-xl p-5 text-white shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-blue-200 uppercase tracking-wide">Total Photos</span>
            <div className="w-9 h-9 bg-white/15 rounded-lg flex items-center justify-center">
              <Camera className="w-5 h-5" />
            </div>
          </div>
          <div className="text-3xl font-bold">{stats.totalPhotos ?? 0}</div>
          <div className="text-xs text-blue-200 mt-1">
            Avg: {(stats.totalDelivered ?? 0) > 0 ? ((stats.totalPhotos ?? 0) / (stats.totalDelivered as number)).toFixed(1) : '0.0'} per delivery
          </div>
        </div>
      </div>

      {/* ── POD Completion Bar ── */}
      <div className="pp-card p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Award className="w-5 h-5 text-blue-900 dark:text-blue-300" />
            <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">Overall POD Completion</h3>
          </div>
          <span className={`text-2xl font-bold ${getCompletionColor(overallPct)}`}>{overallPct}%</span>
        </div>
        <div className="h-3 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden mb-2">
          <div
            className={`h-full bg-gradient-to-r ${getCompletionBarColor(overallPct)} rounded-full transition-all duration-700`}
            style={{ width: `${overallPct}%` }}
          />
        </div>
        <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400">
          <span>{stats.withPOD ?? 0} verified</span>
          <span>{stats.withoutPOD ?? 0} missing</span>
        </div>
      </div>

      {/* ── Detail Breakdown Panels ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* POD Quality */}
        <div className="pp-card p-5">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-7 h-7 rounded-lg bg-blue-900/10 flex items-center justify-center">
              <Award className="w-4 h-4 text-blue-900 dark:text-blue-300" />
            </div>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">POD Quality</h3>
          </div>
          <div className="space-y-3">
            <QualityRow
              icon={<CheckCircle className="w-4 h-4 text-green-600" />}
              label="Complete"
              sublabel="Both sigs + photos"
              value={stats.completePOD ?? 0}
              total={stats.withPOD || 1}
              color="green"
            />
            <QualityRow
              icon={<CheckCircle className="w-4 h-4 text-blue-600" />}
              label="Good"
              sublabel="Signature + photos"
              value={stats.goodPOD ?? 0}
              total={stats.withPOD || 1}
              color="blue"
            />
            <QualityRow
              icon={<AlertTriangle className="w-4 h-4 text-amber-500" />}
              label="Partial"
              sublabel="Missing some data"
              value={stats.partialPOD ?? 0}
              total={stats.withPOD || 1}
              color="amber"
            />
          </div>
        </div>

        {/* Signature Status */}
        <div className="pp-card p-5">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-7 h-7 rounded-lg bg-blue-900/10 flex items-center justify-center">
              <PenLine className="w-4 h-4 text-blue-900 dark:text-blue-300" />
            </div>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Signatures</h3>
          </div>
          <div className="space-y-4">
            <div>
              <div className="flex flex-wrap justify-between items-center gap-2 mb-1.5">
                <span className="text-sm text-gray-600 dark:text-gray-300 flex items-center gap-1.5">
                  <span className="text-xs px-1.5 py-0.5 bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300 rounded font-bold">D</span>
                  Driver Signature
                </span>
                <span className="text-sm font-bold text-gray-900 dark:text-gray-100">{stats.withDriverSignature ?? 0}</span>
              </div>
              <div className="h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-700 rounded-full"
                  style={{ width: `${(stats.totalDelivered ?? 0) > 0 ? ((stats.withDriverSignature ?? 0) / (stats.totalDelivered as number)) * 100 : 0}%` }}
                />
              </div>
            </div>
            <div>
              <div className="flex flex-wrap justify-between items-center gap-2 mb-1.5">
                <span className="text-sm text-gray-600 dark:text-gray-300 flex items-center gap-1.5">
                  <span className="text-xs px-1.5 py-0.5 bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300 rounded font-bold">C</span>
                  Customer Signature
                </span>
                <span className="text-sm font-bold text-gray-900 dark:text-gray-100">{stats.withCustomerSignature ?? 0}</span>
              </div>
              <div className="h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-purple-500 rounded-full"
                  style={{ width: `${(stats.totalDelivered ?? 0) > 0 ? ((stats.withCustomerSignature ?? 0) / (stats.totalDelivered as number)) * 100 : 0}%` }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Photo Status */}
        <div className="pp-card p-5">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-7 h-7 rounded-lg bg-blue-900/10 flex items-center justify-center">
              <Camera className="w-4 h-4 text-blue-900 dark:text-blue-300" />
            </div>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Photos</h3>
          </div>
          <div className="space-y-4">
            <div className="flex justify-between items-start">
              <span className="text-sm text-gray-600 dark:text-gray-300">Deliveries with Photos</span>
              <span className="text-sm font-bold text-gray-900 dark:text-gray-100">{stats.withPhotos ?? 0}</span>
            </div>
            <div>
              <div className="h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-blue-600 to-green-500 rounded-full"
                  style={{ width: `${(stats.totalDelivered ?? 0) > 0 ? ((stats.withPhotos ?? 0) / (stats.totalDelivered as number)) * 100 : 0}%` }}
                />
              </div>
              <div className="flex justify-between text-xs text-gray-400 dark:text-gray-500 mt-1">
                <span>{stats.withPhotos ?? 0} with photos</span>
                <span>{(stats.totalDelivered ?? 0) - (stats.withPhotos ?? 0)} without</span>
              </div>
            </div>
            <div className="pt-2 border-t border-gray-100 dark:border-gray-700">
              <div className="flex flex-wrap justify-between items-center gap-2">
                <span className="text-sm text-gray-600 dark:text-gray-300">Total Photos Uploaded</span>
                <span className="text-lg font-bold text-blue-900 dark:text-blue-300">{stats.totalPhotos ?? 0}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Daily Breakdown Table ── */}
      {dailyBreakdown.length > 0 && (
        <div className="pp-card overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700">
            <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">Daily POD Completion</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="pp-mobile-stack-table w-full min-w-[860px]">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-900/40 border-b border-gray-100 dark:border-gray-700">
                  <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Date</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Total</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">With POD</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Without POD</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Photos</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide w-48">Completion</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-gray-700/60">
                {dailyBreakdown.map((day) => {
                  const pct = day.total > 0 ? ((day.withPOD / day.total) * 100).toFixed(1) : '0.0';
                  return (
                    <tr key={day.date} className="hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                      <td className="px-5 py-3 text-sm font-medium text-gray-900 dark:text-gray-100 whitespace-nowrap" data-label="Date">{day.date}</td>
                      <td className="px-5 py-3 text-sm text-gray-700 dark:text-gray-300 whitespace-nowrap" data-label="Total">{day.total}</td>
                      <td className="px-5 py-3 whitespace-nowrap" data-label="With POD">
                        <span className="inline-flex items-center gap-1 text-sm font-semibold text-green-600 dark:text-green-400">
                          <CheckCircle className="w-3.5 h-3.5" /> {day.withPOD}
                        </span>
                      </td>
                      <td className="px-5 py-3 whitespace-nowrap" data-label="Without POD">
                        {day.withoutPOD > 0 ? (
                          <span className="inline-flex items-center gap-1 text-sm font-semibold text-red-500 dark:text-red-400">
                            <XCircle className="w-3.5 h-3.5" /> {day.withoutPOD}
                          </span>
                        ) : (
                          <span className="text-sm text-gray-400">0</span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-sm text-gray-700 dark:text-gray-300 whitespace-nowrap" data-label="Photos">
                        <span className="inline-flex items-center gap-1">
                          <Camera className="w-3.5 h-3.5 text-gray-400" />
                          {day.totalPhotos}
                        </span>
                      </td>
                      <td className="px-5 py-3 whitespace-nowrap" data-label="Completion">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden min-w-[80px]">
                            <div
                              className={`h-full rounded-full bg-gradient-to-r ${getCompletionBarColor(parseFloat(pct))}`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className={`text-xs font-bold ${getCompletionColor(parseFloat(pct))}`}>{pct}%</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Driver POD Performance ── */}
      {driverBreakdown.length > 0 && (
        <div className="pp-card overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-blue-900 dark:text-blue-300" />
              <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">Driver POD Performance</h3>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="pp-mobile-stack-table w-full min-w-[860px]">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-900/40 border-b border-gray-100 dark:border-gray-700">
                  <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Driver</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Total</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">With POD</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Without POD</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Photos</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide w-52">Completion Rate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-gray-700/60">
                {driverBreakdown.map((driver) => {
                  const pct = driver.total > 0 ? ((driver.withPOD / driver.total) * 100).toFixed(1) : '0.0';
                  return (
                    <tr key={driver.driverName} className="hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                      <td className="px-5 py-3 whitespace-nowrap" data-label="Driver">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-full bg-blue-900/10 dark:bg-blue-900/20 flex items-center justify-center">
                            <User className="w-4 h-4 text-blue-900 dark:text-blue-300" />
                          </div>
                          <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">{driver.driverName || 'Unknown'}</span>
                        </div>
                      </td>
                      <td className="px-5 py-3 text-sm text-gray-700 dark:text-gray-300 whitespace-nowrap" data-label="Total">{driver.total}</td>
                      <td className="px-5 py-3 whitespace-nowrap" data-label="With POD">
                        <span className="text-sm font-semibold text-green-600 dark:text-green-400">{driver.withPOD}</span>
                      </td>
                      <td className="px-5 py-3 whitespace-nowrap" data-label="Without POD">
                        {driver.withoutPOD > 0 ? (
                          <span className="text-sm font-semibold text-red-500 dark:text-red-400">{driver.withoutPOD}</span>
                        ) : (
                          <span className="text-sm text-gray-400">0</span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-sm text-gray-700 dark:text-gray-300 whitespace-nowrap" data-label="Photos">
                        <span className="inline-flex items-center gap-1">
                          <Camera className="w-3.5 h-3.5 text-gray-400" />
                          {driver.totalPhotos}
                        </span>
                      </td>
                      <td className="px-5 py-3 whitespace-nowrap" data-label="Completion Rate">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden min-w-[100px]">
                            <div
                              className={`h-full rounded-full bg-gradient-to-r ${getCompletionBarColor(parseFloat(pct))}`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className={`text-xs font-bold w-10 ${getCompletionColor(parseFloat(pct))}`}>{pct}%</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Delivery Details Table ── */}
      <div className="pp-card overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
              Delivery POD Details
              {deliveries.length > 0 && (
                <span className="ml-2 text-sm font-normal text-gray-500 dark:text-gray-400">({deliveries.length} orders)</span>
              )}
            </h3>
            <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
              <span className="flex items-center gap-1 text-green-600 dark:text-green-400 font-medium">
                <CheckCircle className="w-3.5 h-3.5" />
                {deliveries.filter(d => d.hasPOD).length} verified
              </span>
              <span className="flex items-center gap-1 text-red-500 dark:text-red-400 font-medium">
                <XCircle className="w-3.5 h-3.5" />
                {deliveries.filter(d => !d.hasPOD).length} missing
              </span>
            </div>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="pp-mobile-stack-table w-full min-w-[1100px]">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-900/40 border-b border-gray-100 dark:border-gray-700">
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">PO #</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Del. #</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Customer</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Status</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">POD Status</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Photos</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Signatures</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Driver</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Delivered At</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-gray-700/60">
              {deliveries.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-6 py-12 text-center text-gray-500 dark:text-gray-400 text-sm">
                    No deliveries found for the selected filters
                  </td>
                </tr>
              ) : (
                deliveries.map((delivery) => (
                  <tr
                    key={delivery.id}
                    className={`transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/30 ${
                      !delivery.hasPOD ? 'bg-red-50/50 dark:bg-red-900/5' : ''
                    }`}
                  >
                    <td className="px-5 py-3 whitespace-nowrap" data-label="PO #">
                      <span className="text-sm font-semibold text-blue-900 dark:text-blue-300">
                        {delivery.poNumber || '—'}
                      </span>
                    </td>
                    <td className="px-5 py-3 whitespace-nowrap" data-label="Del. #">
                      <span className="text-sm text-gray-500 dark:text-gray-400">
                        {(delivery as unknown as { metadata?: { originalDeliveryNumber?: string }; _originalDeliveryNumber?: string }).metadata?.originalDeliveryNumber || (delivery as unknown as { _originalDeliveryNumber?: string })._originalDeliveryNumber || '—'}
                      </span>
                    </td>
                    <td className="px-5 py-3" data-label="Customer">
                      <div className="text-sm font-medium text-gray-900 dark:text-gray-100 whitespace-nowrap">
                        {delivery.customer || '—'}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 truncate max-w-[200px]">
                        {delivery.address}
                      </div>
                    </td>
                    <td className="px-5 py-3 whitespace-nowrap" data-label="Status">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-semibold rounded-full bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">
                        <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                        {delivery.status}
                      </span>
                    </td>
                    <td className="px-5 py-3 whitespace-nowrap" data-label="POD Status">
                      {delivery.hasPOD ? (
                        <div className="flex flex-col gap-0.5">
                          <span className="flex items-center gap-1 text-xs font-semibold text-green-600 dark:text-green-400">
                            <CheckCircle className="w-3.5 h-3.5" />
                            {delivery.podQuality || 'Uploaded'}
                          </span>
                        </div>
                      ) : (
                        <span className="flex items-center gap-1 text-xs font-semibold text-red-500 dark:text-red-400">
                          <XCircle className="w-3.5 h-3.5" />
                          Missing
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3 whitespace-nowrap" data-label="Photos">
                      {(delivery.photoCount ?? 0) > 0 ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300 text-xs font-semibold rounded-full">
                          <Camera className="w-3 h-3" />
                          {delivery.photoCount}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-400 dark:text-gray-500">None</span>
                      )}
                    </td>
                    <td className="px-5 py-3 whitespace-nowrap" data-label="Signatures">
                      <div className="flex items-center gap-1.5">
                        {delivery.hasDriverSignature ? (
                          <span className="text-xs px-1.5 py-0.5 bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300 rounded font-semibold" title="Driver Signature">D</span>
                        ) : (
                          <span className="text-xs px-1.5 py-0.5 bg-gray-100 text-gray-400 dark:bg-gray-700 dark:text-gray-500 rounded font-semibold line-through" title="Driver Signature missing">D</span>
                        )}
                        {delivery.hasCustomerSignature ? (
                          <span className="text-xs px-1.5 py-0.5 bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300 rounded font-semibold" title="Customer Signature">C</span>
                        ) : (
                          <span className="text-xs px-1.5 py-0.5 bg-gray-100 text-gray-400 dark:bg-gray-700 dark:text-gray-500 rounded font-semibold line-through" title="Customer Signature missing">C</span>
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-3 whitespace-nowrap text-sm text-gray-700 dark:text-gray-300" data-label="Driver">
                      {delivery.driverName || '—'}
                    </td>
                    <td className="px-5 py-3 whitespace-nowrap" data-label="Delivered At">
                      <div className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                        <Clock className="w-3 h-3" />
                        {formatDate(delivery.deliveredAt)}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ─── QualityRow sub-component ─── */
interface QualityRowProps {
  icon: React.ReactNode;
  label: string;
  sublabel: string;
  value: number;
  total: number;
  color: 'green' | 'blue' | 'amber';
}

function QualityRow({ icon, label, sublabel, value, total, color }: QualityRowProps): React.ReactElement {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  const barColors: Record<string, string> = { green: 'bg-green-500', blue: 'bg-blue-600', amber: 'bg-amber-500' };
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm text-gray-700 dark:text-gray-300 flex items-center gap-1.5">
          {icon} {label}
        </span>
        <span className="text-sm font-bold text-gray-900 dark:text-gray-100">{value}</span>
      </div>
      <div className="h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
        <div className={`h-full ${barColors[color] || 'bg-gray-400'} rounded-full`} style={{ width: `${pct}%` }} />
      </div>
      <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{sublabel}</p>
    </div>
  );
}
