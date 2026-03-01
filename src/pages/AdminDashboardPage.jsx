import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import api, { setAuthToken } from '../frontend/apiClient';
import { BarChart, Bar, ComposedChart, Cell, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid, Line } from 'recharts';
import { 
  Package, CheckCircle, XCircle, Clock, MapPin, Users, Activity, 
  Truck, AlertCircle, FileText, Target,
  ChevronUp, ChevronDown, RefreshCw, Download
} from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import DeliveryDetailModal from '../components/DeliveryDetailModal';

function ensureAuth() {
  const token = localStorage.getItem('auth_token');
  if (token) {
    setAuthToken(token);
  }
}

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
  const [deliverySearch, setDeliverySearch] = useState('');
  const [deliveryStatusFilter, setDeliveryStatusFilter] = useState('all');
  const [deliveryPage, setDeliveryPage] = useState(0);
  const deliveryTableRef = useRef(null);
  const [deliveryDateFrom, setDeliveryDateFrom] = useState('');
  const [deliveryDateTo, setDeliveryDateTo] = useState('');
  const [deliverySortBy, setDeliverySortBy] = useState('date');
  const [deliverySortDir, setDeliverySortDir] = useState('desc');
  const navigate = useNavigate();
  const location = useLocation();

  // Top Customers filter + sort
  const [topCustomersSearch, setTopCustomersSearch] = useState('');
  const [topCustomersAreaFilter, setTopCustomersAreaFilter] = useState('all');
  const [topCustomersSortBy, setTopCustomersSortBy] = useState('orders');
  const [topCustomersSortDir, setTopCustomersSortDir] = useState('desc');

  // Top Items filter + sort
  const [topItemsSearch, setTopItemsSearch] = useState('');
  const [topItemsSortBy, setTopItemsSortBy] = useState('count');
  const [topItemsSortDir, setTopItemsSortDir] = useState('desc');

  // Chart top-N
  const [chartTopN, setChartTopN] = useState(10);

  // Drivers table filter + sort
  const [driversSearch, setDriversSearch] = useState('');
  const [driversStatusFilter, setDriversStatusFilter] = useState('all');
  const [driversSortBy, setDriversSortBy] = useState('name');
  const [driversSortDir, setDriversSortDir] = useState('asc');

  // Hero chart period selector
  const [heroPeriod, setHeroPeriod] = useState('30d');

  // ─── DATA FETCHING ───

  const loadOnlineStatus = useCallback(async () => {
    try {
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
      } catch {
        const usersResponse = await api.get('/admin/drivers');
        const allUsers = usersResponse.data?.data || [];
        const now = new Date();
        const twoMinutesAgo = new Date(now.getTime() - 2 * 60 * 1000);
        allUsers.forEach(u => {
          if (u.account?.lastLogin && new Date(u.account.lastLogin) >= twoMinutesAgo) {
            activeSessionUserIds.add(u.id?.toString() || u.id);
          }
        });
      }
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
        setData(dashboardResp.value.data);
        setLastUpdate(new Date());
      } else {
        setData({ error: 'fetch_failed' });
      }

      if (driversResp.status === 'fulfilled') {
        const allUsers = driversResp.value.data?.data || [];
        setDrivers(allUsers.filter(u => (u.account?.role || 'driver') === 'driver'));
      }

      if (deliveriesResp.status === 'fulfilled') {
        setDeliveries(deliveriesResp.value.data?.deliveries || []);
      }
    } catch (e) {
      console.error('[Dashboard] Error:', e.message);
      setData({ error: 'fetch_failed' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    ensureAuth();
    let mounted = true;
    const loadData = async () => { if (mounted) await loadDashboardData(); };
    loadData();
    const handleVisChange = () => { if (!document.hidden && mounted) loadDashboardData(); };
    document.addEventListener('visibilitychange', handleVisChange);
    const handleUpdated = () => { if (mounted) loadDashboardData(); };
    window.addEventListener('deliveriesUpdated', handleUpdated);
    window.addEventListener('deliveryStatusUpdated', handleUpdated);
    return () => {
      mounted = false;
      document.removeEventListener('visibilitychange', handleVisChange);
      window.removeEventListener('deliveriesUpdated', handleUpdated);
      window.removeEventListener('deliveryStatusUpdated', handleUpdated);
    };
  }, [loadDashboardData]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const tab = params.get('tab');
    if (tab && tab !== activeTab) setActiveTab(tab);
    if (params.get('viewAll') === '1' && tab === 'deliveries') {
      setDeliveryStatusFilter('all');
      setDeliverySearch('');
      setDeliveryPage(0);
      setTimeout(() => deliveryTableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300);
    }
  }, [location.search, activeTab]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const deliveryId = params.get('delivery');
    if (!deliveryId || deliveries.length === 0) return;
    const match = deliveries.find(d => String(d.id || d.ID) === String(deliveryId));
    if (match) { setSelectedDelivery(match); setIsModalOpen(true); }
  }, [location.search, deliveries]);

  useEffect(() => {
    if (activeTab !== 'drivers') return;
    loadOnlineStatus();
    const interval = setInterval(() => loadOnlineStatus(), 30000);
    return () => clearInterval(interval);
  }, [activeTab, loadOnlineStatus]);

  useEffect(() => {
    if (activeTab === 'drivers') loadOnlineStatus();
  }, [drivers, activeTab, loadOnlineStatus]);

  // ─── COMPUTED VALUES ───

  const totals = (data?.totals) ? { ...data.totals } : {
    total: 0, delivered: 0, cancelled: 0, rescheduled: 0, pending: 0,
    customerAccepted: 0, customerCancelled: 0, customerRescheduled: 0,
    withPOD: 0, withoutPOD: 0
  };

  // KPI cards with delta vs yesterday
  const kpiCards = useMemo(() => {
    const list = deliveries && Array.isArray(deliveries) ? deliveries : [];
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterdayStart = new Date(todayStart.getTime() - 86400000);
    const yesterday = list.filter(d => {
      const date = new Date(d.created_at || d.createdAt || d.created || 0);
      return date >= yesterdayStart && date < todayStart;
    });
    const inTransit = list.filter(d => {
      const s = (d.status || '').toLowerCase();
      return ['out-for-delivery', 'in-progress', 'assigned', 'scheduled-confirmed'].includes(s);
    }).length;
    const yDelivered = yesterday.filter(d =>
      ['delivered', 'delivered-with-installation', 'delivered-without-installation'].includes((d.status || '').toLowerCase())
    ).length;
    const yTotal = yesterday.length;
    const pct = (a, b) => b > 0 ? { val: a - b, pct: (Math.abs((a - b) / b) * 100).toFixed(1), up: a >= b } : null;
    const successRate = totals.total > 0 ? ((totals.delivered / totals.total) * 100).toFixed(1) : '0.0';
    return [
      { id: 'total', label: 'Total Deliveries', value: totals.total, icon: Package, color: 'blue', delta: pct(totals.total, yTotal) },
      { id: 'delivered', label: 'Delivered', value: totals.delivered, icon: CheckCircle, color: 'green', delta: pct(totals.delivered, yDelivered) },
      { id: 'transit', label: 'In Transit', value: inTransit, icon: Truck, color: 'indigo', delta: null },
      { id: 'pending', label: 'Pending', value: totals.pending, icon: Clock, color: 'yellow', delta: null },
      { id: 'cancelled', label: 'Cancelled', value: totals.cancelled, icon: XCircle, color: 'red', delta: null },
      { id: 'rate', label: 'Success Rate', value: `${successRate}%`, icon: Target, color: 'emerald', delta: null },
    ];
  }, [deliveries, totals]);

  // Action items: overdue pending (>24h) + unassigned
  const actionItems = useMemo(() => {
    const list = deliveries && Array.isArray(deliveries) ? deliveries : [];
    const dayAgo = new Date(Date.now() - 86400000);
    const overdue = list.filter(d => {
      const s = (d.status || '').toLowerCase();
      return ['pending', 'scheduled'].includes(s) && new Date(d.created_at || d.createdAt || d.created || 0) < dayAgo;
    }).length;
    const unassigned = list.filter(d => {
      const s = (d.status || '').toLowerCase();
      return ['pending', 'scheduled'].includes(s) && !d.assignedDriverId && !d.tracking?.driverId;
    }).length;
    return { overdue, unassigned };
  }, [deliveries]);

  // Hero chart: daily trend
  const heroChartData = useMemo(() => {
    const list = deliveries && Array.isArray(deliveries) ? deliveries : [];
    const days = heroPeriod === '7d' ? 7 : heroPeriod === '30d' ? 30 : 90;
    const now = new Date();
    const start = new Date(now.getTime() - days * 86400000);
    const buckets = {};
    for (let i = 0; i < days; i++) {
      const d = new Date(start.getTime() + i * 86400000);
      const key = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
      buckets[key] = { date: key, total: 0, delivered: 0, rate: 0 };
    }
    list.forEach(d => {
      const date = new Date(d.created_at || d.createdAt || d.created || 0);
      if (date < start) return;
      const key = date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
      if (!buckets[key]) return;
      buckets[key].total++;
      if (['delivered', 'delivered-with-installation', 'delivered-without-installation'].includes((d.status || '').toLowerCase())) {
        buckets[key].delivered++;
      }
    });
    return Object.values(buckets).map(b => ({
      ...b, rate: b.total > 0 ? parseFloat(((b.delivered / b.total) * 100).toFixed(1)) : 0
    }));
  }, [deliveries, heroPeriod]);

  // Deliveries table: filtered + sorted
  const filteredDeliveries = useMemo(() => {
    const list = (deliveries && Array.isArray(deliveries) ? deliveries : []).slice();
    const dir = deliverySortDir === 'asc' ? 1 : -1;
    list.sort((a, b) => {
      if (deliverySortBy === 'customer') return dir * (a.customer || '').toLowerCase().localeCompare((b.customer || '').toLowerCase());
      if (deliverySortBy === 'status') return dir * (a.status || '').localeCompare(b.status || '');
      if (deliverySortBy === 'poNumber') return dir * (a.poNumber || '').localeCompare(b.poNumber || '');
      return dir * (new Date(a.created_at || a.createdAt || 0).getTime() - new Date(b.created_at || b.createdAt || 0).getTime());
    });
    return list.filter(d => {
      const q = deliverySearch.trim().toLowerCase();
      if (q && !((d.poNumber || '').toLowerCase().includes(q) || (d.customer || '').toLowerCase().includes(q) || (d.address || '').toLowerCase().includes(q))) return false;
      if (deliveryStatusFilter !== 'all' && (d.status || '').toLowerCase() !== deliveryStatusFilter) return false;
      const date = new Date(d.created_at || d.createdAt || 0);
      if (deliveryDateFrom && date < new Date(deliveryDateFrom)) return false;
      if (deliveryDateTo && date > new Date(deliveryDateTo + 'T23:59:59')) return false;
      return true;
    });
  }, [deliveries, deliverySearch, deliveryStatusFilter, deliveryDateFrom, deliveryDateTo, deliverySortBy, deliverySortDir]);

  // Area breakdown
  const deliveryByAreaData = useMemo(() => {
    const arr = (data?.analytics?.deliveryByArea || []).slice().sort((a, b) => (b.count ?? 0) - (a.count ?? 0));
    return arr.slice(0, chartTopN);
  }, [data?.analytics?.deliveryByArea, chartTopN]);

  // Top items
  const topItemsData = useMemo(() => {
    let rows = (data?.analytics?.topItems || []).filter(r => {
      const q = topItemsSearch.trim().toLowerCase();
      return !q || (r.item || '').toLowerCase().includes(q) || (r.pnc || '').toLowerCase().includes(q) || (r.modelId || '').toLowerCase().includes(q);
    });
    const dir = topItemsSortDir === 'asc' ? 1 : -1;
    if (topItemsSortBy === 'count') rows = [...rows].sort((a, b) => dir * ((a.count ?? 0) - (b.count ?? 0)));
    else if (topItemsSortBy === 'item') rows = [...rows].sort((a, b) => dir * (a.item || '').localeCompare(b.item || ''));
    else if (topItemsSortBy === 'pnc') rows = [...rows].sort((a, b) => dir * (a.pnc || '').localeCompare(b.pnc || ''));
    return rows.slice(0, chartTopN);
  }, [data?.analytics?.topItems, topItemsSearch, topItemsSortBy, topItemsSortDir, chartTopN]);

  // Top customers
  const topCustomersData = useMemo(() => {
    let rows = (data?.analytics?.topCustomers || []).filter(r => {
      const q = topCustomersSearch.trim().toLowerCase();
      const matchArea = topCustomersAreaFilter === 'all' || (r.primaryArea || '') === topCustomersAreaFilter;
      return matchArea && (!q || (r.customer || '').toLowerCase().includes(q) || (r.primaryArea || '').toLowerCase().includes(q));
    });
    const dir = topCustomersSortDir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      if (topCustomersSortBy === 'customer') return dir * (a.customer || '').localeCompare(b.customer || '');
      if (topCustomersSortBy === 'delivered') return dir * ((a.delivered ?? 0) - (b.delivered ?? 0));
      if (topCustomersSortBy === 'successRate') return dir * ((a.successRate ?? 0) - (b.successRate ?? 0));
      return dir * ((a.orders ?? 0) - (b.orders ?? 0));
    });
  }, [data?.analytics?.topCustomers, topCustomersSearch, topCustomersAreaFilter, topCustomersSortBy, topCustomersSortDir]);

  const topCustomersAreas = useMemo(() =>
    Array.from(new Set((data?.analytics?.topCustomers || []).map(r => r.primaryArea).filter(Boolean))).sort()
  , [data?.analytics?.topCustomers]);

  // Drivers filtered + sorted
  const driversData = useMemo(() => {
    let list = drivers.slice();
    if (driversSearch.trim()) {
      const q = driversSearch.trim().toLowerCase();
      list = list.filter(d => (d.fullName || d.full_name || d.username || '').toLowerCase().includes(q) || (d.email || '').toLowerCase().includes(q));
    }
    if (driversStatusFilter === 'online') list = list.filter(d => onlineUserIds.has(String(d.id)));
    else if (driversStatusFilter === 'offline') list = list.filter(d => !onlineUserIds.has(String(d.id)));
    const dir = driversSortDir === 'asc' ? 1 : -1;
    return [...list].sort((a, b) => {
      if (driversSortBy === 'name') return dir * (a.fullName || a.username || '').localeCompare(b.fullName || b.username || '');
      if (driversSortBy === 'status') return dir * ((onlineUserIds.has(String(a.id)) ? 1 : 0) - (onlineUserIds.has(String(b.id)) ? 1 : 0));
      if (driversSortBy === 'lastUpdate') return dir * (new Date(a.tracking?.lastUpdate || a.account?.lastLogin || 0) - new Date(b.tracking?.lastUpdate || b.account?.lastLogin || 0));
      return 0;
    });
  }, [drivers, driversSearch, driversStatusFilter, driversSortBy, driversSortDir, onlineUserIds]);

  // CSV export helper
  const exportCSV = (rows, fields, filename) => {
    const csv = [fields.join(','), ...rows.map(r => fields.map(f => `"${String(r[f] ?? '').replace(/"/g, '""')}"`).join(','))].join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `${filename}-${Date.now()}.csv`;
    a.click();
  };

  // ─── EARLY RETURNS ───

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-600 mx-auto mb-3"></div>
          <p className="text-gray-500 dark:text-gray-400 text-sm">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  if (data?.error) {
    return (
      <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-8 text-center max-w-md mx-auto mt-8">
        <AlertCircle className="w-8 h-8 text-red-500 mx-auto mb-2" />
        <p className="text-red-700 dark:text-red-300 font-medium mb-4">Failed to load dashboard data</p>
        <button onClick={() => { setLoading(true); setData(null); loadDashboardData(); }}
          className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm transition-colors">
          Retry
        </button>
      </div>
    );
  }

  // ─── CONSTANTS ───

  const PAGE_SIZE = 50;
  const totalPages = Math.max(1, Math.ceil(filteredDeliveries.length / PAGE_SIZE));
  const pagedDeliveries = filteredDeliveries.slice(deliveryPage * PAGE_SIZE, (deliveryPage + 1) * PAGE_SIZE);

  const STATUS_LABELS = {
    'pending': 'Pending', 'scheduled': 'Scheduled', 'scheduled-confirmed': 'Confirmed',
    'out-for-delivery': 'Out for Delivery', 'in-progress': 'In Progress',
    'delivered': 'Delivered', 'delivered-with-installation': 'Delivered + Install',
    'delivered-without-installation': 'Delivered', 'cancelled': 'Cancelled',
    'rejected': 'Rejected', 'rescheduled': 'Rescheduled', 'returned': 'Returned',
  };

  const STATUS_COLORS = {
    'pending': 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
    'scheduled': 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
    'scheduled-confirmed': 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
    'out-for-delivery': 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300',
    'in-progress': 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
    'delivered': 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
    'delivered-with-installation': 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
    'delivered-without-installation': 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
    'cancelled': 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
    'rejected': 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
    'rescheduled': 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300',
    'returned': 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300',
  };

  const KPI_COLOR_MAP = {
    blue:    { bg: 'bg-blue-50 dark:bg-blue-900/20',    icon: 'text-blue-600 dark:text-blue-400',    val: 'text-blue-700 dark:text-blue-300' },
    green:   { bg: 'bg-green-50 dark:bg-green-900/20',  icon: 'text-green-600 dark:text-green-400',  val: 'text-green-700 dark:text-green-300' },
    indigo:  { bg: 'bg-indigo-50 dark:bg-indigo-900/20',icon: 'text-indigo-600 dark:text-indigo-400',val: 'text-indigo-700 dark:text-indigo-300' },
    yellow:  { bg: 'bg-yellow-50 dark:bg-yellow-900/20',icon: 'text-yellow-600 dark:text-yellow-400',val: 'text-yellow-700 dark:text-yellow-300' },
    red:     { bg: 'bg-red-50 dark:bg-red-900/20',      icon: 'text-red-600 dark:text-red-400',      val: 'text-red-700 dark:text-red-300' },
    emerald: { bg: 'bg-emerald-50 dark:bg-emerald-900/20', icon: 'text-emerald-600 dark:text-emerald-400', val: 'text-emerald-700 dark:text-emerald-300' },
  };

  const inTransitCount = (deliveries || []).filter(d => ['out-for-delivery', 'in-progress', 'assigned'].includes((d.status || '').toLowerCase())).length;

  // Sortable column header component
  const SortTh = ({ label, sortKey, current, dir, onSort, align = 'left' }) => (
    <th
      className={`px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer select-none hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors text-${align}`}
      onClick={() => onSort(sortKey)}
    >
      <span className={`inline-flex items-center gap-1 ${align === 'right' ? 'justify-end w-full' : ''}`}>
        {label}
        {current === sortKey
          ? (dir === 'asc' ? <ChevronUp className="w-3 h-3 text-primary-500" /> : <ChevronDown className="w-3 h-3 text-primary-500" />)
          : <span className="w-3 h-3 text-gray-300 dark:text-gray-600">↕</span>}
      </span>
    </th>
  );

  const tabs = [
    { id: 'overview',   label: 'Overview',                                icon: Activity  },
    { id: 'deliveries', label: `Deliveries (${filteredDeliveries.length})`, icon: Package   },
    { id: 'by-area',    label: 'By Area',                                  icon: MapPin    },
    { id: 'by-product', label: 'By Product',                               icon: FileText  },
    { id: 'drivers',    label: 'Drivers',                                  icon: Users     },
  ];

  // ─── RENDER ───

  return (
    <div className="space-y-4">

      {/* ── Page Header ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Admin Dashboard</h1>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            Last updated: {lastUpdate.toLocaleTimeString()} &nbsp;<span className="text-green-500">● Live</span>
          </p>
        </div>
        <button
          onClick={() => { setLoading(true); loadDashboardData(); }}
          className="flex items-center gap-2 px-4 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors shadow-sm"
        >
          <RefreshCw className="w-4 h-4" /> Refresh
        </button>
      </div>

      {/* ── KPI Strip ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {kpiCards.map(card => {
          const Icon = card.icon;
          const c = KPI_COLOR_MAP[card.color];
          return (
            <div key={card.id} className="bg-white dark:bg-gray-800 rounded-lg border border-gray-100 dark:border-gray-700 shadow-sm p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide leading-tight">{card.label}</span>
                <div className={`p-1.5 rounded-md ${c.bg}`}><Icon className={`w-4 h-4 ${c.icon}`} /></div>
              </div>
              <div className={`text-2xl font-bold ${c.val}`}>{card.value}</div>
              {card.delta ? (
                <div className={`text-xs mt-1 flex items-center gap-0.5 ${card.delta.up ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'}`}>
                  {card.delta.up ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                  {card.delta.pct}% vs yesterday
                </div>
              ) : <div className="h-4 mt-1" />}
            </div>
          );
        })}
      </div>

      {/* ── Action Items Banner ── */}
      {(actionItems.overdue > 0 || actionItems.unassigned > 0) && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg px-4 py-3 flex flex-wrap items-center gap-4">
          <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0" />
          <div className="flex flex-wrap gap-4 text-sm text-amber-800 dark:text-amber-300 flex-1">
            {actionItems.overdue > 0 && <span><strong>{actionItems.overdue}</strong> overdue deliveries (pending &gt; 24 hours)</span>}
            {actionItems.unassigned > 0 && <span><strong>{actionItems.unassigned}</strong> unassigned deliveries</span>}
          </div>
          <button
            onClick={() => { setActiveTab('deliveries'); setDeliveryStatusFilter('pending'); setDeliveryPage(0); }}
            className="text-xs font-semibold text-amber-700 dark:text-amber-400 underline underline-offset-2"
          >
            View in Deliveries
          </button>
        </div>
      )}

      {/* ── Tab Navigation ── */}
      <div className="border-b border-gray-200 dark:border-gray-700">
        <nav className="flex overflow-x-auto">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => { setActiveTab(id); setDeliveryPage(0); }}
              className={`flex items-center gap-2 px-5 py-3 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
                activeTab === id
                  ? 'border-primary-600 text-primary-600 dark:border-primary-400 dark:text-primary-400'
                  : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600'
              }`}
            >
              <Icon className="w-4 h-4" />{label}
            </button>
          ))}
        </nav>
      </div>

      {/* ══════════════ OVERVIEW TAB ══════════════ */}
      {activeTab === 'overview' && (
        <div className="space-y-4">

          {/* Hero Chart: Delivery Trend */}
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-100 dark:border-gray-700 shadow-sm p-6">
            <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
              <div>
                <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Delivery Trend</h2>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Total dispatched vs delivered — success rate on right axis</p>
              </div>
              <div className="flex rounded-lg border border-gray-200 dark:border-gray-600 overflow-hidden text-xs font-medium">
                {[['7d', 'Last 7 days'], ['30d', 'Last 30 days'], ['90d', 'Last 90 days']].map(([p, label]) => (
                  <button
                    key={p}
                    onClick={() => setHeroPeriod(p)}
                    className={`px-3 py-1.5 transition-colors ${heroPeriod === p ? 'bg-primary-600 text-white' : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <ResponsiveContainer width="100%" height={300}>
              <ComposedChart data={heroChartData} margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#6b7280' }} tickLine={false} axisLine={false}
                  interval={heroPeriod === '7d' ? 0 : heroPeriod === '30d' ? 4 : 8} />
                <YAxis yAxisId="left" tick={{ fontSize: 11, fill: '#6b7280' }} tickLine={false} axisLine={false} />
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: '#f97316' }} tickLine={false} axisLine={false} unit="%" domain={[0, 100]} />
                <Tooltip
                  contentStyle={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', fontSize: '12px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)' }}
                  formatter={(val, name) => name === 'Success Rate %' ? [`${val}%`, name] : [val, name]}
                />
                <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '12px' }} />
                <Bar yAxisId="left" dataKey="total" fill="#c7d7f9" name="Total Dispatched" radius={[3, 3, 0, 0]} maxBarSize={20} />
                <Bar yAxisId="left" dataKey="delivered" fill="#2563EB" name="Delivered" radius={[3, 3, 0, 0]} maxBarSize={20} />
                <Line yAxisId="right" type="monotone" dataKey="rate" stroke="#f97316" name="Success Rate %" dot={false} strokeWidth={2.5} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {/* Three summary panels */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

            {/* Delivery Status Breakdown */}
            <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-100 dark:border-gray-700 shadow-sm p-5">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-4">Delivery Status</h3>
              <div className="space-y-3">
                {[
                  { label: 'Delivered',    value: totals.delivered,   color: 'bg-green-500'  },
                  { label: 'In Transit',   value: inTransitCount,     color: 'bg-indigo-500' },
                  { label: 'Pending',      value: totals.pending,     color: 'bg-yellow-400' },
                  { label: 'Rescheduled',  value: totals.rescheduled, color: 'bg-orange-400' },
                  { label: 'Cancelled',    value: totals.cancelled,   color: 'bg-red-500'    },
                ].map(({ label, value, color }) => {
                  const pct = totals.total > 0 ? ((value / totals.total) * 100).toFixed(1) : 0;
                  return (
                    <div key={label}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-gray-600 dark:text-gray-400">{label}</span>
                        <span className="font-semibold text-gray-900 dark:text-gray-100">
                          {value} <span className="text-gray-400 font-normal">({pct}%)</span>
                        </span>
                      </div>
                      <div className="w-full h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Customer Response */}
            <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-100 dark:border-gray-700 shadow-sm p-5">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-4">Customer Response</h3>
              <div className="space-y-3">
                {[
                  { label: 'Accepted',    value: totals.customerAccepted || 0,    color: 'text-green-600 dark:text-green-400',  bg: 'bg-green-50 dark:bg-green-900/20'  },
                  { label: 'Rescheduled', value: totals.customerRescheduled || 0, color: 'text-yellow-600 dark:text-yellow-400', bg: 'bg-yellow-50 dark:bg-yellow-900/20' },
                  { label: 'Cancelled',   value: totals.customerCancelled || 0,   color: 'text-red-600 dark:text-red-400',      bg: 'bg-red-50 dark:bg-red-900/20'      },
                ].map(({ label, value, color, bg }) => (
                  <div key={label} className={`flex items-center justify-between px-3 py-3 rounded-lg ${bg}`}>
                    <span className="text-sm text-gray-700 dark:text-gray-300">{label}</span>
                    <span className={`text-xl font-bold ${color}`}>{value}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Proof of Delivery */}
            <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-100 dark:border-gray-700 shadow-sm p-5">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-4">Proof of Delivery (POD)</h3>
              {totals.delivered > 0 ? (
                <>
                  <div className="flex items-baseline gap-2 mb-4">
                    <span className="text-3xl font-bold text-green-600 dark:text-green-400">{totals.withPOD || 0}</span>
                    <span className="text-sm text-gray-500 dark:text-gray-400">with POD</span>
                  </div>
                  <div className="w-full h-2 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden mb-3">
                    <div
                      className="h-full bg-green-500 rounded-full transition-all"
                      style={{ width: `${((totals.withPOD || 0) / totals.delivered * 100).toFixed(0)}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400">
                    <span>Coverage: {((totals.withPOD || 0) / totals.delivered * 100).toFixed(1)}%</span>
                    <span>Without POD: {totals.withoutPOD || 0}</span>
                  </div>
                  <button
                    onClick={() => navigate('/admin/reports/pod')}
                    className="mt-4 w-full text-xs text-primary-600 dark:text-primary-400 hover:underline text-center"
                  >
                    View full POD report →
                  </button>
                </>
              ) : (
                <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-8">No delivered items yet</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ══════════════ DELIVERIES TAB ══════════════ */}
      {activeTab === 'deliveries' && (
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-100 dark:border-gray-700 shadow-sm overflow-hidden">
          {/* Filter bar */}
          <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700 flex flex-wrap gap-2 items-center">
            <input
              type="text"
              placeholder="Search PO number, customer, address..."
              value={deliverySearch}
              onChange={e => { setDeliverySearch(e.target.value); setDeliveryPage(0); }}
              className="flex-1 min-w-[200px] px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
            <select
              value={deliveryStatusFilter}
              onChange={e => { setDeliveryStatusFilter(e.target.value); setDeliveryPage(0); }}
              className="px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              <option value="all">All Statuses</option>
              <option value="pending">Pending</option>
              <option value="scheduled">Scheduled</option>
              <option value="scheduled-confirmed">Confirmed</option>
              <option value="out-for-delivery">Out for Delivery</option>
              <option value="delivered">Delivered</option>
              <option value="delivered-without-installation">Delivered (no install)</option>
              <option value="cancelled">Cancelled</option>
              <option value="rescheduled">Rescheduled</option>
            </select>
            <input type="date" value={deliveryDateFrom} onChange={e => { setDeliveryDateFrom(e.target.value); setDeliveryPage(0); }}
              className="px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100" />
            <span className="text-gray-400 text-sm">—</span>
            <input type="date" value={deliveryDateTo} onChange={e => { setDeliveryDateTo(e.target.value); setDeliveryPage(0); }}
              className="px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100" />
            {(deliverySearch || deliveryStatusFilter !== 'all' || deliveryDateFrom || deliveryDateTo) && (
              <button
                onClick={() => { setDeliverySearch(''); setDeliveryStatusFilter('all'); setDeliveryDateFrom(''); setDeliveryDateTo(''); setDeliveryPage(0); }}
                className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400 hover:text-red-500 transition-colors"
              >Clear</button>
            )}
            <button
              onClick={() => exportCSV(
                filteredDeliveries.map(d => ({
                  poNumber: d.poNumber || '',
                  customer: d.customer || '',
                  status: STATUS_LABELS[(d.status || '').toLowerCase()] || d.status || '',
                  driver: d.driverName || '',
                  address: d.address || '',
                  date: d.created_at || d.createdAt || '',
                })),
                ['poNumber', 'customer', 'status', 'driver', 'address', 'date'],
                'deliveries'
              )}
              className="ml-auto flex items-center gap-2 px-4 py-2 text-sm bg-primary-600 hover:bg-primary-700 text-white rounded-lg transition-colors shadow-sm"
            >
              <Download className="w-4 h-4" /> Export CSV
            </button>
          </div>

          {/* Table */}
          <div className="overflow-x-auto" ref={deliveryTableRef}>
            <table className="min-w-full">
              <thead className="bg-gray-50 dark:bg-gray-700/50">
                <tr>
                  <SortTh label="PO Number" sortKey="poNumber" current={deliverySortBy} dir={deliverySortDir}
                    onSort={k => { if (deliverySortBy === k) setDeliverySortDir(d => d === 'asc' ? 'desc' : 'asc'); else { setDeliverySortBy(k); setDeliverySortDir('asc'); } setDeliveryPage(0); }} />
                  <SortTh label="Customer" sortKey="customer" current={deliverySortBy} dir={deliverySortDir}
                    onSort={k => { if (deliverySortBy === k) setDeliverySortDir(d => d === 'asc' ? 'desc' : 'asc'); else { setDeliverySortBy(k); setDeliverySortDir('asc'); } setDeliveryPage(0); }} />
                  <SortTh label="Status" sortKey="status" current={deliverySortBy} dir={deliverySortDir}
                    onSort={k => { if (deliverySortBy === k) setDeliverySortDir(d => d === 'asc' ? 'desc' : 'asc'); else { setDeliverySortBy(k); setDeliverySortDir('asc'); } setDeliveryPage(0); }} />
                  <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider text-left">Driver</th>
                  <SortTh label="Date" sortKey="date" current={deliverySortBy} dir={deliverySortDir}
                    onSort={k => { if (deliverySortBy === k) setDeliverySortDir(d => d === 'asc' ? 'desc' : 'asc'); else { setDeliverySortBy(k); setDeliverySortDir('desc'); } setDeliveryPage(0); }} />
                  <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider text-left">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {pagedDeliveries.length > 0 ? pagedDeliveries.map(delivery => {
                  const statusKey = (delivery.status || 'pending').toLowerCase();
                  return (
                    <tr
                      key={delivery.id || delivery.ID}
                      className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors cursor-pointer"
                      onClick={() => { setSelectedDelivery(delivery); setIsModalOpen(true); }}
                    >
                      <td className="px-4 py-3 text-sm font-mono text-primary-600 dark:text-primary-400">
                        {delivery.poNumber || String(delivery.id || delivery.ID || '').slice(0, 8)}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-900 dark:text-gray-100">{delivery.customer || 'N/A'}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-block px-2 py-0.5 text-xs font-semibold rounded-full ${STATUS_COLORS[statusKey] || 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300'}`}>
                          {STATUS_LABELS[statusKey] || delivery.status || 'Pending'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
                        {delivery.driverName || (delivery.tracking?.driverId ? 'Assigned' : 'Unassigned')}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
                        {(delivery.created_at || delivery.createdAt)
                          ? new Date(delivery.created_at || delivery.createdAt).toLocaleDateString('en-GB')
                          : 'N/A'}
                      </td>
                      <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center gap-2">
                          <select
                            value={delivery.status || 'pending'}
                            onChange={async e => {
                              const newStatus = e.target.value;
                              try {
                                await api.put(`/deliveries/admin/${delivery.id || delivery.ID}/status`, { status: newStatus });
                                setDeliveries(prev => prev.map(d =>
                                  (d.id === delivery.id || d.ID === delivery.ID) ? { ...d, status: newStatus } : d
                                ));
                                loadDashboardData();
                                window.dispatchEvent(new CustomEvent('deliveryStatusUpdated', { detail: { deliveryId: delivery.id || delivery.ID, newStatus } }));
                              } catch (err) { console.error('Status update error:', err); }
                            }}
                            onClick={e => e.stopPropagation()}
                            className="px-2 py-1 text-xs border border-gray-200 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-primary-500"
                          >
                            <option value="pending">Pending</option>
                            <option value="scheduled">Scheduled</option>
                            <option value="scheduled-confirmed">Confirmed</option>
                            <option value="out-for-delivery">Out for Delivery</option>
                            <option value="delivered">Delivered</option>
                            <option value="delivered-without-installation">Delivered (no install)</option>
                            <option value="cancelled">Cancelled</option>
                            <option value="rescheduled">Rescheduled</option>
                          </select>
                          <button
                            onClick={() => { setSelectedDelivery(delivery); setIsModalOpen(true); }}
                            className="px-2 py-1 text-xs text-primary-600 dark:text-primary-400 border border-primary-200 dark:border-primary-700 rounded hover:bg-primary-50 dark:hover:bg-primary-900/20 transition-colors"
                          >
                            View
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                }) : (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center text-gray-400 dark:text-gray-500 text-sm">
                      No deliveries match the current filters
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="px-5 py-3 border-t border-gray-100 dark:border-gray-700 flex items-center justify-between text-sm">
              <span className="text-gray-500 dark:text-gray-400">
                {deliveryPage * PAGE_SIZE + 1}–{Math.min((deliveryPage + 1) * PAGE_SIZE, filteredDeliveries.length)} of {filteredDeliveries.length}
              </span>
              <div className="flex items-center gap-1">
                <button
                  disabled={deliveryPage === 0}
                  onClick={() => { setDeliveryPage(p => p - 1); deliveryTableRef.current?.scrollIntoView({ behavior: 'smooth' }); }}
                  className="px-3 py-1.5 border border-gray-200 dark:border-gray-600 rounded-md disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-gray-700 dark:text-gray-300"
                >← Prev</button>
                <span className="px-3 text-gray-600 dark:text-gray-400">{deliveryPage + 1} / {totalPages}</span>
                <button
                  disabled={deliveryPage >= totalPages - 1}
                  onClick={() => { setDeliveryPage(p => p + 1); deliveryTableRef.current?.scrollIntoView({ behavior: 'smooth' }); }}
                  className="px-3 py-1.5 border border-gray-200 dark:border-gray-600 rounded-md disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-gray-700 dark:text-gray-300"
                >Next →</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ══════════════ BY AREA TAB ══════════════ */}
      {activeTab === 'by-area' && (
        <div className="space-y-4">
          {/* Chart */}
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-100 dark:border-gray-700 shadow-sm p-6">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div>
                <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Deliveries by Area</h2>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Showing top {chartTopN} areas by volume</p>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <span className="text-gray-500 dark:text-gray-400">Show top</span>
                <select value={chartTopN} onChange={e => setChartTopN(Number(e.target.value))}
                  className="px-3 py-1.5 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-sm">
                  {[5, 10, 15, 20].map(n => <option key={n} value={n}>{n} areas</option>)}
                </select>
              </div>
            </div>
            {deliveryByAreaData.length > 0 ? (
              <ResponsiveContainer width="100%" height={Math.max(220, deliveryByAreaData.length * 38)}>
                <BarChart data={deliveryByAreaData} layout="vertical" margin={{ left: 10, right: 50, top: 5, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11, fill: '#6b7280' }} tickLine={false} axisLine={false} />
                  <YAxis type="category" dataKey="area" width={130} tick={{ fontSize: 12, fill: '#374151' }} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', fontSize: '12px' }} />
                  <Bar dataKey="count" name="Deliveries" radius={[0, 4, 4, 0]}>
                    {deliveryByAreaData.map((_, i) => (
                      <Cell key={i} fill={i === 0 ? '#1d4ed8' : i < 3 ? '#2563EB' : '#3b82f6'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-center py-12 text-gray-400 dark:text-gray-500 text-sm">No area data available</p>
            )}
          </div>

          {/* Area table */}
          {deliveryByAreaData.length > 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-100 dark:border-gray-700 shadow-sm overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Area Detail</h3>
                <button
                  onClick={() => exportCSV(deliveryByAreaData, ['area', 'count'], 'area-deliveries')}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                >
                  <Download className="w-3.5 h-3.5" /> Export
                </button>
              </div>
              <table className="min-w-full">
                <thead className="bg-gray-50 dark:bg-gray-700/50">
                  <tr>
                    <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase text-left w-12">#</th>
                    <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase text-left">Area</th>
                    <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase text-right">Deliveries</th>
                    <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase text-right">Share</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {deliveryByAreaData.map((row, i) => {
                    const total = deliveryByAreaData.reduce((s, r) => s + (r.count || 0), 0);
                    const share = total > 0 ? ((row.count / total) * 100).toFixed(1) : 0;
                    return (
                      <tr key={row.area || i} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                        <td className="px-4 py-3 text-sm text-gray-400 dark:text-gray-500">{i + 1}</td>
                        <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-gray-100">
                          <span className="flex items-center gap-2"><MapPin className="w-3.5 h-3.5 text-gray-400" />{row.area}</span>
                        </td>
                        <td className="px-4 py-3 text-sm text-right font-bold text-primary-600 dark:text-primary-400">{row.count}</td>
                        <td className="px-4 py-3 text-sm text-right text-gray-500 dark:text-gray-400">{share}%</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ══════════════ BY PRODUCT TAB ══════════════ */}
      {activeTab === 'by-product' && (
        <div className="space-y-4">
          {/* Filter bar */}
          <div className="flex flex-wrap gap-2 items-center">
            <input
              type="text"
              placeholder="Search item name, PNC, or model..."
              value={topItemsSearch}
              onChange={e => setTopItemsSearch(e.target.value)}
              className="flex-1 min-w-[200px] px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
            <select value={chartTopN} onChange={e => setChartTopN(Number(e.target.value))}
              className="px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100">
              {[5, 10, 15, 20].map(n => <option key={n} value={n}>Top {n}</option>)}
            </select>
            <select value={topItemsSortBy} onChange={e => setTopItemsSortBy(e.target.value)}
              className="px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100">
              <option value="count">Sort: Quantity</option>
              <option value="item">Sort: Item Name</option>
              <option value="pnc">Sort: PNC</option>
            </select>
            <button onClick={() => setTopItemsSortDir(d => d === 'asc' ? 'desc' : 'asc')}
              className="px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
              {topItemsSortDir === 'asc' ? '↑ Asc' : '↓ Desc'}
            </button>
          </div>

          {/* Chart */}
          {topItemsData.length > 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-100 dark:border-gray-700 shadow-sm p-6">
              <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-4">Top Items by Quantity</h2>
              <ResponsiveContainer width="100%" height={Math.max(200, topItemsData.length * 40)}>
                <BarChart
                  data={topItemsData.map(r => ({ ...r, label: `${r.item || ''} [${r.pnc || ''}]` }))}
                  layout="vertical"
                  margin={{ left: 10, right: 50, top: 5, bottom: 5 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11, fill: '#6b7280' }} tickLine={false} axisLine={false} />
                  <YAxis type="category" dataKey="label" width={190} tick={{ fontSize: 11, fill: '#374151' }} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', fontSize: '12px' }} />
                  <Bar dataKey="count" fill="#2563EB" radius={[0, 4, 4, 0]} name="Quantity" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Items table */}
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-100 dark:border-gray-700 shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Item Detail</h3>
              <button onClick={() => exportCSV(topItemsData, ['item', 'pnc', 'modelId', 'count'], 'top-items')}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                <Download className="w-3.5 h-3.5" /> Export
              </button>
            </div>
            <table className="min-w-full">
              <thead className="bg-gray-50 dark:bg-gray-700/50">
                <tr>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase text-left w-12">#</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase text-left">Item Name</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase text-left">PNC</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase text-left">Model ID</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase text-right">Qty</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {topItemsData.length > 0 ? topItemsData.map((row, idx) => (
                  <tr key={idx} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    <td className="px-4 py-3 text-sm text-gray-400 dark:text-gray-500">{idx + 1}</td>
                    <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-gray-100">{row.item}</td>
                    <td className="px-4 py-3 text-sm font-mono text-gray-600 dark:text-gray-400">{row.pnc}</td>
                    <td className="px-4 py-3 text-sm font-mono text-gray-500 dark:text-gray-500">{row.modelId || '—'}</td>
                    <td className="px-4 py-3 text-sm text-right font-bold text-primary-600 dark:text-primary-400">{row.count}</td>
                  </tr>
                )) : (
                  <tr><td colSpan={5} className="px-6 py-10 text-center text-gray-400 dark:text-gray-500 text-sm">No product data available</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ══════════════ DRIVERS TAB ══════════════ */}
      {activeTab === 'drivers' && (
        <div className="space-y-4">
          {/* Driver KPIs */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Total Drivers', value: drivers.length,                                                                   color: 'text-gray-800 dark:text-gray-100'          },
              { label: 'Online',        value: driversData.filter(d => onlineUserIds.has(String(d.id))).length,                  color: 'text-green-600 dark:text-green-400'        },
              { label: 'Offline',       value: driversData.filter(d => !onlineUserIds.has(String(d.id))).length,                 color: 'text-gray-500 dark:text-gray-400'          },
              { label: 'On Route',      value: drivers.filter(d => d.tracking?.status === 'in_progress').length,                 color: 'text-indigo-600 dark:text-indigo-400'      },
            ].map(({ label, value, color }) => (
              <div key={label} className="bg-white dark:bg-gray-800 rounded-lg border border-gray-100 dark:border-gray-700 shadow-sm p-4">
                <div className="text-xs text-gray-500 dark:text-gray-400 uppercase font-medium mb-1 tracking-wide">{label}</div>
                <div className={`text-2xl font-bold ${color}`}>{value}</div>
              </div>
            ))}
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-100 dark:border-gray-700 shadow-sm overflow-hidden">
            {/* Filter bar */}
            <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700 flex flex-wrap gap-2 items-center">
              <input type="text" placeholder="Search name or email..." value={driversSearch}
                onChange={e => setDriversSearch(e.target.value)}
                className="flex-1 min-w-[180px] px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500" />
              <select value={driversStatusFilter} onChange={e => setDriversStatusFilter(e.target.value)}
                className="px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100">
                <option value="all">All Drivers</option>
                <option value="online">Online only</option>
                <option value="offline">Offline only</option>
              </select>
              <select value={driversSortBy} onChange={e => setDriversSortBy(e.target.value)}
                className="px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100">
                <option value="name">Sort: Name</option>
                <option value="status">Sort: Status</option>
                <option value="lastUpdate">Sort: Last Update</option>
              </select>
              <button onClick={() => setDriversSortDir(d => d === 'asc' ? 'desc' : 'asc')}
                className="px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                {driversSortDir === 'asc' ? '↑ Asc' : '↓ Desc'}
              </button>
              <button onClick={() => navigate('/admin/users')}
                className="ml-auto text-sm text-primary-600 dark:text-primary-400 hover:underline">
                Manage drivers →
              </button>
            </div>

            {/* Table */}
            <table className="min-w-full">
              <thead className="bg-gray-50 dark:bg-gray-700/50">
                <tr>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider text-left">Driver</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider text-left">Contact</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider text-left">Status</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider text-left">Last Seen</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider text-left">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {driversData.length > 0 ? driversData.map(driver => {
                  const isOnline = onlineUserIds.has(String(driver.id));
                  const lastSeen = driver.tracking?.lastUpdate || driver.account?.lastLogin;
                  const displayName = driver.fullName || driver.full_name || driver.username || 'Unknown';
                  return (
                    <tr key={driver.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="relative flex-shrink-0">
                            <div className="w-9 h-9 rounded-full bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center text-sm font-semibold text-primary-700 dark:text-primary-300">
                              {displayName[0].toUpperCase()}
                            </div>
                            {isOnline && <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-green-500 border-2 border-white dark:border-gray-800 rounded-full" />}
                          </div>
                          <div>
                            <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{displayName}</div>
                            <div className="text-xs text-gray-400 dark:text-gray-500">{driver.username}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-sm text-gray-600 dark:text-gray-400">{driver.email || '—'}</div>
                        <div className="text-xs text-gray-400 dark:text-gray-500">{driver.phone || '—'}</div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-full ${isOnline ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${isOnline ? 'bg-green-500' : 'bg-gray-400'}`} />
                          {isOnline ? 'Online' : 'Offline'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
                        {lastSeen
                          ? new Date(lastSeen).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
                          : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => navigate(`/admin/operations?tab=communication&userId=${driver.id}`)}
                          className="text-xs text-primary-600 dark:text-primary-400 hover:underline"
                        >
                          Message
                        </button>
                      </td>
                    </tr>
                  );
                }) : (
                  <tr>
                    <td colSpan={5} className="px-6 py-12 text-center text-gray-400 dark:text-gray-500 text-sm">
                      {drivers.length === 0 ? 'No drivers found' : 'No drivers match current filters'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Delivery Detail Modal */}
      <DeliveryDetailModal
        delivery={selectedDelivery}
        isOpen={isModalOpen}
        onClose={() => { setIsModalOpen(false); setSelectedDelivery(null); }}
        onStatusUpdate={(deliveryId, newStatus) => {
          setDeliveries(prev => prev.map(d =>
            (d.id === deliveryId || d.ID === deliveryId) ? { ...d, status: newStatus } : d
          ));
          setIsModalOpen(false);
          setSelectedDelivery(null);
          loadDashboardData();
        }}
      />
    </div>
  );
}
