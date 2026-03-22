import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import api, { setAuthToken } from '../frontend/apiClient';
import { BarChart, Bar, ComposedChart, XAxis, YAxis, ZAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid, Line, AreaChart, Area, PieChart, Pie, Cell, ReferenceLine, ScatterChart, Scatter, type PieLabelRenderProps } from 'recharts';
import { 
  Package, CheckCircle, XCircle, Clock, MapPin, Users, Activity, 
  Truck, AlertCircle, FileText, Target, TrendingUp, HelpCircle,
  ChevronUp, ChevronDown, ChevronRight, RefreshCw, Download
} from 'lucide-react';
import RiskBadge, { riskFromSuccessRate } from '../components/Analytics/RiskBadge';
import MetricTooltip from '../components/Analytics/MetricTooltip';
import { sharePct, topNSharePct, concentrationLevel } from '../utils/analyticsHelpers';
import { useNavigate, useLocation } from 'react-router-dom';
import DeliveryDetailModal from '../components/DeliveryDetailModal';
import { MapContainer, TileLayer, CircleMarker, Tooltip as MapTooltip, Popup } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import type { Driver } from '../types';

/* Dubai area → approximate centre [lat, lng] */
const DUBAI_AREA_COORDS: Record<string, [number, number]> = {
  'Marina':      [25.0800, 55.1350],
  'JLT':         [25.0693, 55.1477],
  'JVC':         [25.0590, 55.2101],
  'Downtown':    [25.1972, 55.2744],
  'Jumeirah':    [25.2048, 55.2381],
  'Al Barsha':   [25.1137, 55.2004],
  'Deira':       [25.2695, 55.3266],
  'Bur Dubai':   [25.2582, 55.2988],
  'Mirdif':      [25.2218, 55.4159],
  'Silicon':     [25.1275, 55.3842],
  'Sports':      [25.0438, 55.1888],
  'Discovery':   [25.0498, 55.1380],
  'Business Bay':[25.1863, 55.2664],
  'DIFC':        [25.2123, 55.2797],
  'Sharjah':     [25.3573, 55.4033],
  'Abu Dhabi':   [24.4539, 54.3773],
  'Ajman':       [25.4052, 55.5136],
  'Other':       [25.2048, 55.2708],
};

interface DashboardTotals {
  total: number;
  delivered: number;
  cancelled: number;
  rescheduled: number;
  pending: number;
  customerAccepted: number;
  customerCancelled: number;
  customerRescheduled: number;
  withPOD: number;
  withoutPOD: number;
}

interface AreaItem { area: string; count: number; }
interface ItemItem { item: string; pnc: string; modelId?: string; count: number; }
interface CustomerItem {
  customer: string;
  orders: number;
  delivered: number;
  pending: number;
  cancelled: number;
  successRate: number;
  primaryArea?: string;
  totalQuantity?: number;
}
interface MonthItem { label: string; count: number; }
interface WeekItem { day: string; count: number; }

interface DashboardAnalytics {
  deliveryByArea?: AreaItem[];
  topItems?: ItemItem[];
  topCustomers?: CustomerItem[];
  deliveryByMonth?: MonthItem[];
  deliveryByWeek?: WeekItem[];
}

interface DashboardData {
  totals?: DashboardTotals;
  analytics?: DashboardAnalytics;
  generatedAt?: string;
  error?: string;
}

interface TrackingDelivery {
  id?: string;
  ID?: string;
  poNumber?: string;
  customer?: string;
  Customer?: string;
  address?: string;
  status?: string;
  created_at?: string;
  createdAt?: string;
  created?: string;
  delivered_at?: string;
  deliveredAt?: string;
  driverName?: string;
  assignedDriverId?: string;
  tracking?: {
    driverId?: string;
    eta?: string;
    lastLocation?: { lat: number; lng: number };
    assigned?: boolean;
    status?: string;
    assignedAt?: string;
  };
  lat?: number;
  Lat?: number;
  lng?: number;
  Lng?: number;
  confirmationStatus?: string;
  customerConfirmedAt?: string;
  [key: string]: unknown;
}

interface AdminDriver extends Driver {
  account?: { role?: string; lastLogin?: string };
  name?: string;
  tracking?: Driver['tracking'] & { lastUpdate?: string | Date | null };
}

/** Resolve driver id for a delivery (matches list + name fallback). */
function deliveryDriverIdForAnalytics(d: TrackingDelivery, driversList: AdminDriver[]): string | undefined {
  const raw = d.assignedDriverId ?? d.tracking?.driverId;
  if (raw !== undefined && raw !== null && String(raw).trim() !== '') return String(raw);
  const nm = typeof d.driverName === 'string' ? d.driverName.trim() : '';
  if (!nm || driversList.length === 0) return undefined;
  const lower = nm.toLowerCase();
  const match = driversList.find(dr => {
    const a = (dr.fullName || dr.full_name || dr.username || '').trim().toLowerCase();
    return a === lower;
  });
  return match?.id !== undefined && match?.id !== null ? String(match.id) : undefined;
}

function normalizeDeliveryStatus(s: unknown): string {
  return String(s ?? '').toLowerCase().trim();
}

function isDeliveredDeliveryStatus(s: string): boolean {
  return ['delivered', 'delivered-with-installation', 'delivered-without-installation', 'finished', 'completed', 'pod-completed'].includes(s);
}

function isCancelledOrRescheduledDeliveryStatus(s: string): boolean {
  return ['cancelled', 'rejected', 'returned', 'rescheduled'].includes(s);
}

interface KpiCard {
  id: string;
  label: string;
  value: number | string;
  icon: React.ElementType;
  color: string;
  delta: { val: number; pct: string; up: boolean } | null;
}

interface SortThProps {
  label: string;
  sortKey: string;
  current: string;
  dir: string;
  onSort: (key: string) => void;
  align?: string;
}

interface TrendChartCardProps {
  title: string;
  subtitle: string;
  period: 'day' | 'month' | 'year';
  onPeriodChange: (p: 'day' | 'month' | 'year') => void;
  data: unknown[];
  dataKey?: string;
  xKey: string;
  chartType: 'bar' | 'line' | 'stacked' | 'bar-h' | 'donut' | 'area' | 'stacked-area' | 'stacked-bar' | 'demand-ma' | 'fulfillment' | 'success-target' | 'lead-time' | 'backlog' | 'status-mix-100' | 'areas-stacked' | 'items-ranked';
  barColor?: string;
  nameKey?: string;
  targetValue?: number;
}

function TrendChartCard({ title, subtitle, period, onPeriodChange, data, dataKey, xKey, chartType, barColor = '#2563EB', nameKey = 'name', targetValue }: TrendChartCardProps): React.ReactElement {
  const FilterBtns = () => (
    <div className="flex rounded-lg border border-gray-200 dark:border-gray-600 overflow-hidden text-xs font-medium">
      {(['day', 'month', 'year'] as const).map(p => (
        <button
          key={p}
          onClick={() => onPeriodChange(p)}
          className={`px-2 py-1.5 transition-colors capitalize ${period === p ? 'bg-primary-600 text-white' : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'}`}
        >
          {p === 'day' ? 'Daily' : p === 'month' ? 'Monthly' : 'Yearly'}
        </button>
      ))}
    </div>
  );
  const d = data as Record<string, unknown>[];
  const hasData = d.length > 0;

  const renderChart = (): React.ReactNode => {
    if (!hasData) return null;
    if (chartType === 'line') {
      return (
        <ResponsiveContainer width="100%" height={220}>
          <ComposedChart data={d} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
            <XAxis dataKey={xKey} tick={{ fontSize: 10, fill: '#6b7280' }} tickLine={false} axisLine={false} />
            <YAxis tick={{ fontSize: 10, fill: '#6b7280' }} tickLine={false} axisLine={false} domain={dataKey === 'rate' ? [0, 100] : undefined} unit={dataKey === 'rate' ? '%' : undefined} />
            <Tooltip contentStyle={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', fontSize: '11px' }} formatter={dataKey === 'rate' ? (val: number) => [`${val}%`, 'Success Rate'] : undefined} />
            <Line type="monotone" dataKey={dataKey || 'count'} stroke={barColor} strokeWidth={2} dot={{ r: 3 }} fill="transparent" isAnimationActive />
          </ComposedChart>
        </ResponsiveContainer>
      );
    }
    if (chartType === 'area') {
      return (
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={d} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
            <defs>
              <linearGradient id={`areaGrad-${title.replace(/\s/g, '')}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={barColor} stopOpacity={0.4} />
                <stop offset="95%" stopColor={barColor} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
            <XAxis dataKey={xKey} tick={{ fontSize: 10, fill: '#6b7280' }} tickLine={false} axisLine={false} />
            <YAxis tick={{ fontSize: 10, fill: '#6b7280' }} tickLine={false} axisLine={false} />
            <Tooltip contentStyle={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', fontSize: '11px' }} />
            <Area type="monotone" dataKey={dataKey || 'count'} stroke={barColor} fill={`url(#areaGrad-${title.replace(/\s/g, '')})`} strokeWidth={2} isAnimationActive />
          </AreaChart>
        </ResponsiveContainer>
      );
    }
    if (chartType === 'stacked-area') {
      return (
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={d} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
            <XAxis dataKey={xKey} tick={{ fontSize: 10, fill: '#6b7280' }} tickLine={false} axisLine={false} />
            <YAxis tick={{ fontSize: 10, fill: '#6b7280' }} tickLine={false} axisLine={false} />
            <Tooltip contentStyle={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', fontSize: '11px' }} />
            <Legend wrapperStyle={{ fontSize: '10px' }} />
            <Area type="monotone" dataKey="delivered" stackId="1" stroke="#059669" fill="#059669" fillOpacity={0.6} name="Delivered" isAnimationActive />
            <Area type="monotone" dataKey="pending" stackId="1" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.6} name="Pending" isAnimationActive />
            <Area type="monotone" dataKey="cancelled" stackId="1" stroke="#dc2626" fill="#dc2626" fillOpacity={0.6} name="Cancelled" isAnimationActive />
          </AreaChart>
        </ResponsiveContainer>
      );
    }
    if (chartType === 'stacked-bar') {
      return (
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={d} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
            <XAxis dataKey={xKey} tick={{ fontSize: 10, fill: '#6b7280' }} tickLine={false} axisLine={false} />
            <YAxis tick={{ fontSize: 10, fill: '#6b7280' }} tickLine={false} axisLine={false} />
            <Tooltip contentStyle={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', fontSize: '11px' }} />
            <Legend wrapperStyle={{ fontSize: '10px' }} />
            <Bar dataKey="delivered" stackId="a" fill="#059669" name="Delivered" radius={[0, 0, 0, 0]} isAnimationActive />
            <Bar dataKey="pending" stackId="a" fill="#f59e0b" name="Pending" radius={[0, 0, 0, 0]} isAnimationActive />
            <Bar dataKey="cancelled" stackId="a" fill="#dc2626" name="Cancelled" radius={[0, 0, 0, 0]} isAnimationActive />
          </BarChart>
        </ResponsiveContainer>
      );
    }
    if (chartType === 'bar') {
      return (
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={d} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
            <XAxis dataKey={xKey} tick={{ fontSize: 10, fill: '#6b7280' }} tickLine={false} axisLine={false} />
            <YAxis tick={{ fontSize: 10, fill: '#6b7280' }} tickLine={false} axisLine={false} />
            <Tooltip contentStyle={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', fontSize: '11px' }} />
            <Bar dataKey={dataKey || 'count'} fill={barColor} radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive />
          </BarChart>
        </ResponsiveContainer>
      );
    }
    if (chartType === 'bar-h') {
      return (
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={d} layout="vertical" margin={{ top: 5, right: 30, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 10, fill: '#6b7280' }} tickLine={false} axisLine={false} />
            <YAxis type="category" dataKey={xKey} width={80} tick={{ fontSize: 10, fill: '#374151' }} tickLine={false} axisLine={false} />
            <Tooltip contentStyle={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', fontSize: '11px' }} />
            <Bar dataKey={dataKey || 'count'} fill={barColor} radius={[0, 4, 4, 0]} maxBarSize={16} isAnimationActive />
          </BarChart>
        </ResponsiveContainer>
      );
    }
    if (chartType === 'demand-ma') {
      return (
        <ResponsiveContainer width="100%" height={220}>
          <ComposedChart data={d} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
            <XAxis dataKey={xKey} tick={{ fontSize: 10, fill: '#6b7280' }} tickLine={false} axisLine={false} />
            <YAxis tick={{ fontSize: 10, fill: '#6b7280' }} tickLine={false} axisLine={false} />
            <Tooltip contentStyle={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', fontSize: '11px' }} />
            <Legend wrapperStyle={{ fontSize: '10px' }} />
            <Bar dataKey="count" fill="#2563EB" radius={[4, 4, 0, 0]} maxBarSize={24} name="Requests" isAnimationActive />
            <Line type="monotone" dataKey="ma" stroke="#f59e0b" strokeWidth={2} strokeDasharray="4 4" dot={{ r: 2 }} name="Moving Avg" isAnimationActive />
          </ComposedChart>
        </ResponsiveContainer>
      );
    }
    if (chartType === 'fulfillment') {
      return (
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={d} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
            <XAxis dataKey={xKey} tick={{ fontSize: 10, fill: '#6b7280' }} tickLine={false} axisLine={false} />
            <YAxis tick={{ fontSize: 10, fill: '#6b7280' }} tickLine={false} axisLine={false} />
            <Tooltip contentStyle={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', fontSize: '11px' }} />
            <Legend wrapperStyle={{ fontSize: '10px' }} />
            <Bar dataKey="created" fill="#3b82f6" radius={[0, 0, 0, 0]} maxBarSize={28} name="Created" isAnimationActive />
            <Bar dataKey="delivered" fill="#059669" radius={[0, 0, 0, 0]} maxBarSize={28} name="Delivered" isAnimationActive />
            <Bar dataKey="inTransit" fill="#8b5cf6" radius={[0, 0, 0, 0]} maxBarSize={28} name="In Transit" isAnimationActive />
            <Bar dataKey="cancelled" fill="#dc2626" radius={[0, 0, 0, 0]} maxBarSize={28} name="Cancelled" isAnimationActive />
          </BarChart>
        </ResponsiveContainer>
      );
    }
    if (chartType === 'success-target' && targetValue != null) {
      return (
        <ResponsiveContainer width="100%" height={220}>
          <ComposedChart data={d} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
            <XAxis dataKey={xKey} tick={{ fontSize: 10, fill: '#6b7280' }} tickLine={false} axisLine={false} />
            <YAxis tick={{ fontSize: 10, fill: '#6b7280' }} tickLine={false} axisLine={false} domain={[0, 100]} unit="%" />
            <Tooltip contentStyle={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', fontSize: '11px' }} formatter={(val: number) => [`${val}%`, 'Success Rate']} />
            <ReferenceLine y={targetValue} stroke="#dc2626" strokeDasharray="4 4" strokeWidth={1.5} />
            <Line type="monotone" dataKey="rate" stroke="#059669" strokeWidth={2} dot={{ r: 3 }} name="Success Rate" isAnimationActive />
          </ComposedChart>
        </ResponsiveContainer>
      );
    }
    if (chartType === 'lead-time') {
      return (
        <ResponsiveContainer width="100%" height={220}>
          <ComposedChart data={d} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
            <XAxis dataKey={xKey} tick={{ fontSize: 10, fill: '#6b7280' }} tickLine={false} axisLine={false} />
            <YAxis tick={{ fontSize: 10, fill: '#6b7280' }} tickLine={false} axisLine={false} unit="h" />
            <Tooltip contentStyle={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', fontSize: '11px' }} />
            <Legend wrapperStyle={{ fontSize: '10px' }} />
            <Line type="monotone" dataKey="medianHours" stroke="#2563EB" strokeWidth={2} dot={{ r: 3 }} name="Median (h)" isAnimationActive />
            <Line type="monotone" dataKey="p90Hours" stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="4 4" dot={{ r: 2 }} name="P90 (h)" isAnimationActive />
          </ComposedChart>
        </ResponsiveContainer>
      );
    }
    if (chartType === 'backlog') {
      return (
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={d} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
            <defs>
              <linearGradient id={`backlogGrad-${title.replace(/\s/g, '')}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.4} />
                <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
            <XAxis dataKey={xKey} tick={{ fontSize: 10, fill: '#6b7280' }} tickLine={false} axisLine={false} />
            <YAxis tick={{ fontSize: 10, fill: '#6b7280' }} tickLine={false} axisLine={false} />
            <Tooltip contentStyle={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', fontSize: '11px' }} />
            <Area type="monotone" dataKey="open" stroke="#8b5cf6" fill={`url(#backlogGrad-${title.replace(/\s/g, '')})`} strokeWidth={2} name="Open / Pending / In Transit" isAnimationActive />
          </AreaChart>
        </ResponsiveContainer>
      );
    }
    if (chartType === 'status-mix-100') {
      return (
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={d} margin={{ top: 5, right: 10, left: 0, bottom: 5 }} stackOffset="expand">
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
            <XAxis dataKey={xKey} tick={{ fontSize: 10, fill: '#6b7280' }} tickLine={false} axisLine={false} />
            <YAxis tick={{ fontSize: 10, fill: '#6b7280' }} tickLine={false} axisLine={false} domain={[0, 100]} unit="%" tickFormatter={(v) => `${v}%`} />
            <Tooltip contentStyle={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', fontSize: '11px' }} formatter={(val: number) => [`${Number(val).toFixed(1)}%`, undefined]} />
            <Legend wrapperStyle={{ fontSize: '10px' }} />
            <Area type="monotone" dataKey="deliveredPct" stackId="1" stroke="#059669" fill="#059669" fillOpacity={0.6} name="Delivered" isAnimationActive />
            <Area type="monotone" dataKey="pendingPct" stackId="1" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.6} name="Pending" isAnimationActive />
            <Area type="monotone" dataKey="inTransitPct" stackId="1" stroke="#8b5cf6" fill="#8b5cf6" fillOpacity={0.6} name="In Transit" isAnimationActive />
            <Area type="monotone" dataKey="cancelledPct" stackId="1" stroke="#dc2626" fill="#dc2626" fillOpacity={0.6} name="Cancelled" isAnimationActive />
          </AreaChart>
        </ResponsiveContainer>
      );
    }
    if (chartType === 'areas-stacked') {
      const topKeys = (d[0] ? Object.keys(d[0]).filter(k => !['key', 'label', 'day'].includes(k) && typeof (d[0] as Record<string, unknown>)[k] === 'number') : []) as string[];
      return (
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={d} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
            <XAxis dataKey={xKey} tick={{ fontSize: 10, fill: '#6b7280' }} tickLine={false} axisLine={false} />
            <YAxis tick={{ fontSize: 10, fill: '#6b7280' }} tickLine={false} axisLine={false} />
            <Tooltip contentStyle={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', fontSize: '11px' }} />
            <Legend wrapperStyle={{ fontSize: '10px' }} />
            {topKeys.map((k, i) => {
              const colors = ['#2563EB', '#059669', '#f59e0b', '#8b5cf6', '#ec4899'];
              return <Area key={k} type="monotone" dataKey={k} stackId="1" stroke={colors[i % colors.length]} fill={colors[i % colors.length]} fillOpacity={0.6} name={k} isAnimationActive />;
            })}
          </AreaChart>
        </ResponsiveContainer>
      );
    }
    if (chartType === 'items-ranked') {
      return (
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={d} layout="vertical" margin={{ top: 5, right: 30, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 10, fill: '#6b7280' }} tickLine={false} axisLine={false} />
            <YAxis type="category" dataKey={xKey} width={90} tick={{ fontSize: 9, fill: '#374151' }} tickLine={false} axisLine={false} />
            <Tooltip contentStyle={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', fontSize: '11px' }} />
            <Bar dataKey={dataKey || 'count'} fill={barColor} radius={[0, 4, 4, 0]} maxBarSize={16} name="Volume" isAnimationActive />
          </BarChart>
        </ResponsiveContainer>
      );
    }
    if (chartType === 'donut') {
      const COLORS = ['#2563EB', '#059669', '#f59e0b', '#dc2626', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#6366f1'];
      const pieData = d
        .map((row, i) => {
          const val = Number(row[dataKey as keyof typeof row] ?? row.count ?? 0);
          const nm = String(row[nameKey as keyof typeof row] ?? row[xKey as keyof typeof row] ?? `Item ${i + 1}`);
          return { name: nm, value: val, fill: COLORS[i % COLORS.length] };
        })
        .filter((item) => item.value > 0);
      if (pieData.length === 0) return <p className="text-center py-10 text-gray-400 dark:text-gray-500 text-xs">No data to display</p>;
      return (
        <ResponsiveContainer width="100%" height={220}>
          <PieChart margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
            <Pie
              data={pieData}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius="55%"
              outerRadius="85%"
              paddingAngle={1}
              isAnimationActive
            />
            <Tooltip contentStyle={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', fontSize: '11px' }} formatter={(val: number, name: string) => [val, name]} />
          </PieChart>
        </ResponsiveContainer>
      );
    }
    return null;
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-100 dark:border-gray-700 shadow-sm p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">{title}</h2>
          <p className="pp-page-subtitle text-xs truncate">{subtitle}</p>
        </div>
        <FilterBtns />
      </div>
      {hasData ? renderChart() : <p className="text-center py-10 text-gray-400 dark:text-gray-500 text-xs">No data available</p>}
    </div>
  );
}

function PeakHeatmapCard({ data, title, subtitle }: { data: number[][]; title: string; subtitle: string }): React.ReactElement {
  const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const maxVal = Math.max(1, ...data.flat());
  const getOpacity = (v: number) => (maxVal > 0 ? 0.25 + 0.75 * (v / maxVal) : 0);

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-100 dark:border-gray-700 shadow-sm p-4">
      <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">{title}</h2>
      <p className="pp-page-subtitle text-xs truncate mb-3">{subtitle}</p>
      <div className="overflow-x-auto -mx-1">
        <table className="w-full border-collapse text-[10px]">
          <thead>
            <tr>
              <th className="w-8 text-left text-gray-500 dark:text-gray-400 font-medium pr-1"></th>
              {Array.from({ length: 24 }, (_, h) => (
                <th key={h} className="w-5 text-center text-gray-500 dark:text-gray-400 font-normal">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {dayLabels.map((day, row) => (
              <tr key={day}>
                <td className="text-gray-600 dark:text-gray-400 font-medium py-0.5 pr-1">{day}</td>
                {Array.from({ length: 24 }, (_, col) => {
                  const v = data[row]?.[col] ?? 0;
                  const op = getOpacity(v);
                  return (
                    <td key={col} className="p-0.5">
                      <div
                        title={`${day} ${col}:00 - ${v} requests`}
                        className="w-5 h-4 rounded-sm transition-all duration-300 ease-out"
                        style={{ backgroundColor: v > 0 ? `rgba(37, 99, 235, ${op})` : 'rgba(229, 231, 235, 0.25)' }}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-[9px] text-gray-400 mt-1">Hour of day (0–23)</p>
      </div>
    </div>
  );
}

function ensureAuth(): void {
  const token = localStorage.getItem('auth_token');
  if (token) setAuthToken(token);
}

export default function AdminDashboardPage(): React.ReactElement {
  const [data, setData] = useState<DashboardData | null>(null);
  const [drivers, setDrivers] = useState<AdminDriver[]>([]);
  const [deliveries, setDeliveries] = useState<TrackingDelivery[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  const [activeTab, setActiveTab] = useState<string>('overview');
  const [selectedDelivery, setSelectedDelivery] = useState<TrackingDelivery | null>(null);
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [onlineUserIds, setOnlineUserIds] = useState<Set<string>>(new Set());
  const [deliverySearch, setDeliverySearch] = useState<string>('');
  const [deliveryStatusFilter, setDeliveryStatusFilter] = useState<string>('all');
  const [deliveryAttentionFilter, setDeliveryAttentionFilter] = useState<'overdue' | 'unassigned' | 'awaiting' | null>(null);
  const [deliveryPage, setDeliveryPage] = useState<number>(0);
  const deliveryTableRef = useRef<HTMLDivElement>(null);
  const [deliveryDateFrom, setDeliveryDateFrom] = useState<string>('');
  const [deliveryDateTo, setDeliveryDateTo] = useState<string>('');
  const [deliverySortBy, setDeliverySortBy] = useState<string>('date');
  const [deliverySortDir, setDeliverySortDir] = useState<string>('desc');
  const navigate = useNavigate();
  const location = useLocation();

  const clearDeliveryQuery = useCallback((): void => {
    const params = new URLSearchParams(location.search);
    if (!params.has('delivery')) return;
    params.delete('delivery');
    const next = params.toString();
    navigate(next ? `${location.pathname}?${next}` : location.pathname, { replace: true });
  }, [location.pathname, location.search, navigate]);

  const [topCustomersSearch, setTopCustomersSearch] = useState<string>('');
  const [topCustomersAreaFilter, setTopCustomersAreaFilter] = useState<string>('all');
  const [topCustomersSortBy, setTopCustomersSortBy] = useState<string>('orders');
  const [topCustomersSortDir, setTopCustomersSortDir] = useState<string>('desc');

  const [topItemsSearch, setTopItemsSearch] = useState<string>('');
  const [topItemsSortBy, setTopItemsSortBy] = useState<string>('count');
  const [topItemsSortDir, setTopItemsSortDir] = useState<string>('desc');

  const [chartTopN, setChartTopN] = useState<number>(10);

  const [driversSearch, setDriversSearch] = useState<string>('');
  const [driversStatusFilter, setDriversStatusFilter] = useState<string>('all');
  const [driversSortBy, setDriversSortBy] = useState<string>('name');
  const [driversSortDir, setDriversSortDir] = useState<string>('asc');

  const [heroPeriod, setHeroPeriod] = useState<string>('30d');
  const [trendPeriod1, setTrendPeriod1] = useState<'day' | 'month' | 'year'>('month');
  const [trendPeriod2, setTrendPeriod2] = useState<'day' | 'month' | 'year'>('month');
  const [trendPeriod3, setTrendPeriod3] = useState<'day' | 'month' | 'year'>('month');
  const [trendPeriod4, setTrendPeriod4] = useState<'day' | 'month' | 'year'>('month');
  const [trendPeriod5, setTrendPeriod5] = useState<'day' | 'month' | 'year'>('month');
  const [trendPeriod6, setTrendPeriod6] = useState<'day' | 'month' | 'year'>('month');
  const [trendPeriod7, setTrendPeriod7] = useState<'day' | 'month' | 'year'>('month');
  const [trendPeriod8, setTrendPeriod8] = useState<'day' | 'month' | 'year'>('month');

  // ─── DATA FETCHING ───

  const loadOnlineStatus = useCallback(async (): Promise<void> => {
    try {
      let activeSessionUserIds = new Set<string>();
      try {
        const sessionsResponse = await api.get('/admin/drivers/sessions');
        const sessData = sessionsResponse.data as { sessions?: Array<{ userId?: string | number }> };
        if (sessData?.sessions) {
          activeSessionUserIds = new Set(
            sessData.sessions
              .map(s => s.userId?.toString() || '')
              .filter(Boolean)
          );
        }
      } catch {
        const usersResponse = await api.get('/admin/drivers');
        const allUsers = (usersResponse.data as { data?: AdminDriver[] }).data || [];
        const now = new Date();
        const twoMinutesAgo = new Date(now.getTime() - 2 * 60 * 1000);
        allUsers.forEach(u => {
          if (u.account?.lastLogin && new Date(u.account.lastLogin) >= twoMinutesAgo) {
            activeSessionUserIds.add(u.id?.toString() || u.id);
          }
        });
      }
      setOnlineUserIds(activeSessionUserIds);
    } catch (e: unknown) {
      console.error('Error loading online status:', e);
    }
  }, []);

  const loadDashboardData = useCallback(async (): Promise<void> => {
    try {
      const [dashboardResp, driversResp, deliveriesResp] = await Promise.allSettled([
        api.get('/admin/dashboard', { params: { nocache: 1 } }),
        api.get('/admin/drivers').catch(() => ({ data: { data: [] } })),
        api.get('/admin/tracking/deliveries').catch(() => ({ data: { deliveries: [] } }))
      ]);

      if (dashboardResp.status === 'fulfilled') {
        setData(dashboardResp.value.data as DashboardData);
        setLastUpdate(new Date());
      } else {
        setData({ error: 'fetch_failed' });
      }

      if (driversResp.status === 'fulfilled') {
        const allUsers = (driversResp.value.data as { data?: AdminDriver[] }).data || [];
        setDrivers(allUsers.filter(u => (u.account?.role || 'driver') === 'driver'));
      }

      if (deliveriesResp.status === 'fulfilled') {
        setDeliveries((deliveriesResp.value.data as { deliveries?: TrackingDelivery[] }).deliveries || []);
      }
    } catch (e: unknown) {
      const err = e as { message?: string };
      console.error('[Dashboard] Error:', err.message);
      setData({ error: 'fetch_failed' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    ensureAuth();
    let mounted = true;
    const loadData = async (): Promise<void> => { if (mounted) await loadDashboardData(); };
    void loadData();
    const handleVisChange = (): void => { if (!document.hidden && mounted) void loadDashboardData(); };
    document.addEventListener('visibilitychange', handleVisChange);
    const handleUpdated = (): void => { if (mounted) void loadDashboardData(); };
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
  }, [location.search]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const deliveryId = params.get('delivery');
    if (!deliveryId || deliveries.length === 0) return;
    const match = deliveries.find(d => String(d.id || d.ID) === String(deliveryId));
    if (match) { setSelectedDelivery(match); setIsModalOpen(true); }
  }, [location.search, deliveries]);

  useEffect(() => {
    if (activeTab !== 'drivers') return;
    void loadOnlineStatus();
    const interval = setInterval(() => void loadOnlineStatus(), 30000);
    return () => clearInterval(interval);
  }, [activeTab, loadOnlineStatus]);

  useEffect(() => {
    if (activeTab === 'drivers') void loadOnlineStatus();
  }, [drivers, activeTab, loadOnlineStatus]);

  // ─── COMPUTED VALUES ───

  const totals: DashboardTotals = (data?.totals) ? { ...data.totals } : {
    total: 0, delivered: 0, cancelled: 0, rescheduled: 0, pending: 0,
    customerAccepted: 0, customerCancelled: 0, customerRescheduled: 0,
    withPOD: 0, withoutPOD: 0
  };

  const kpiCards = useMemo<KpiCard[]>(() => {
    const list = deliveries && Array.isArray(deliveries) ? deliveries : [];
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterdayStart = new Date(todayStart.getTime() - 86400000);
    const yesterday = list.filter(d => {
      const date = new Date(d.created_at || d.createdAt || d.created || 0);
      return date >= yesterdayStart && date < todayStart;
    });
    const yDelivered = yesterday.filter(d =>
      ['delivered', 'delivered-with-installation', 'delivered-without-installation'].includes((d.status || '').toLowerCase())
    ).length;
    const yTotal = yesterday.length;
    const pct = (a: number, b: number) => b > 0 ? { val: a - b, pct: (Math.abs((a - b) / b) * 100).toFixed(1), up: a >= b } : null;
    const successRate = totals.total > 0 ? ((totals.delivered / totals.total) * 100).toFixed(1) : '0.0';
    return [
      { id: 'total', label: 'Total Deliveries', value: totals.total, icon: Package, color: 'blue', delta: pct(totals.total, yTotal) },
      { id: 'delivered', label: 'Delivered', value: totals.delivered, icon: CheckCircle, color: 'green', delta: pct(totals.delivered, yDelivered) },
      { id: 'pending', label: 'Pending', value: totals.pending, icon: Clock, color: 'yellow', delta: null },
      { id: 'cancelled', label: 'Cancelled', value: totals.cancelled, icon: XCircle, color: 'red', delta: null },
      { id: 'rate', label: 'Success Rate', value: `${successRate}%`, icon: Target, color: 'emerald', delta: null },
    ];
  }, [deliveries, totals]);

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
    const unconfirmed = list.filter(d => {
      const s = (d.status || '').toLowerCase();
      const conf = String(d.confirmationStatus || '').toLowerCase();
      return ['pending', 'scheduled'].includes(s) && conf !== 'confirmed' && !d.customerConfirmedAt;
    }).length;
    return { overdue, unassigned, unconfirmed };
  }, [deliveries]);

  const heroChartData = useMemo(() => {
    const list = deliveries && Array.isArray(deliveries) ? deliveries : [];
    const days = heroPeriod === '7d' ? 7 : heroPeriod === '30d' ? 30 : 90;
    const now = new Date();
    const start = new Date(now.getTime() - days * 86400000);
    const buckets: Record<string, { date: string; total: number; delivered: number; rate: number }> = {};
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

  const areaKeywords = useMemo(() => [
    'Marina', 'Jumeirah', 'Jebel Ali', 'Business Bay', 'Downtown', 'Deira', 'Bur Dubai',
    'Silicon Oasis', 'Motor City', 'Arabian Ranches', 'The Springs', 'Palm', 'Al Barsha',
    'Al Quoz', 'JLT', 'DIFC', 'Karama', 'Satwa', 'Oud Metha', 'Mirdif', 'Dubai Hills'
  ], []);

  const getTimeBuckets = useCallback((period: 'day' | 'month' | 'year') => {
    const now = new Date();
    if (period === 'day') {
      return Array.from({ length: 7 }, (_, i) => {
        const d = new Date(now);
        d.setDate(d.getDate() - (6 - i));
        return { key: d.toISOString().slice(0, 10), label: d.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' }), day: d.toLocaleDateString('en-GB', { weekday: 'short' }) };
      });
    }
    if (period === 'month') {
      return Array.from({ length: 12 }, (_, i) => {
        const d = new Date(now.getFullYear(), now.getMonth() - (11 - i), 1);
        return { key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, label: d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }) };
      }).sort((a, b) => a.key.localeCompare(b.key));
    }
    return Array.from({ length: 5 }, (_, i) => {
      const y = now.getFullYear() - (4 - i);
      return { key: String(y), label: String(y) };
    });
  }, []);

  const trend1DeliveryRequests = useMemo(() => {
    const list = deliveries && Array.isArray(deliveries) ? deliveries : [];
    const buckets = getTimeBuckets(trendPeriod1).map(b => ({ ...b, count: 0 }));
    const bucketMap = Object.fromEntries(buckets.map((b, i) => [b.key, i]));
    list.forEach(d => {
      const t = d.created_at || d.createdAt || d.created;
      if (!t) return;
      const dt = new Date(t as string | number);
      const key = trendPeriod1 === 'day' ? dt.toISOString().slice(0, 10) : trendPeriod1 === 'month' ? `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}` : String(dt.getFullYear());
      const i = bucketMap[key];
      if (i !== undefined) buckets[i].count++;
    });
    const windowSize = trendPeriod1 === 'day' ? 7 : trendPeriod1 === 'month' ? 4 : 3;
    return buckets.map((b, i) => {
      const start = Math.max(0, i - windowSize + 1);
      const slice = buckets.slice(start, i + 1);
      const sum = slice.reduce((s, x) => s + x.count, 0);
      const ma = slice.length > 0 ? parseFloat((sum / slice.length).toFixed(1)) : 0;
      return { label: (b as { day?: string }).day ?? b.label, ...b, ma };
    });
  }, [deliveries, trendPeriod1, getTimeBuckets]);

  const trend2Fulfillment = useMemo(() => {
    const list = deliveries && Array.isArray(deliveries) ? deliveries : [];
    const isDelivered = (s: string) => ['delivered', 'delivered-with-installation', 'delivered-without-installation'].includes((s || '').toLowerCase());
    const isInTransit = (s: string) => ['out-for-delivery', 'in-progress', 'assigned', 'scheduled-confirmed'].includes((s || '').toLowerCase());
    const isCancelled = (s: string) => ['cancelled', 'rescheduled', 'rejected'].includes((s || '').toLowerCase());
    const buckets = getTimeBuckets(trendPeriod2).map(b => ({ ...b, created: 0, delivered: 0, inTransit: 0, cancelled: 0 }));
    const bucketMap = Object.fromEntries(buckets.map((b, i) => [b.key, i]));
    list.forEach(d => {
      const t = d.created_at || d.createdAt || d.created;
      if (!t) return;
      const dt = new Date(t as string | number);
      const key = trendPeriod2 === 'day' ? dt.toISOString().slice(0, 10) : trendPeriod2 === 'month' ? `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}` : String(dt.getFullYear());
      const i = bucketMap[key];
      if (i === undefined) return;
      buckets[i].created++;
      const s = (d.status || '').toLowerCase();
      if (isDelivered(s)) buckets[i].delivered++;
      else if (isInTransit(s)) buckets[i].inTransit++;
      else if (isCancelled(s)) buckets[i].cancelled++;
    });
    return buckets.map(b => ({ label: (b as { day?: string }).day ?? b.label, ...b }));
  }, [deliveries, trendPeriod2, getTimeBuckets]);

  const trend3SuccessRate = useMemo(() => {
    const list = deliveries && Array.isArray(deliveries) ? deliveries : [];
    const isDelivered = (s: string) => ['delivered', 'delivered-with-installation', 'delivered-without-installation'].includes((s || '').toLowerCase());
    const buckets = getTimeBuckets(trendPeriod3).map(b => ({ ...b, total: 0, delivered: 0, rate: 0 }));
    const bucketMap = Object.fromEntries(buckets.map((b, i) => [b.key, i]));
    list.forEach(d => {
      const t = d.created_at || d.createdAt || d.created;
      if (!t) return;
      const dt = new Date(t as string | number);
      const key = trendPeriod3 === 'day' ? dt.toISOString().slice(0, 10) : trendPeriod3 === 'month' ? `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}` : String(dt.getFullYear());
      const i = bucketMap[key];
      if (i !== undefined) {
        buckets[i].total++;
        if (isDelivered(d.status || '')) buckets[i].delivered++;
      }
    });
    return buckets.map(b => ({
      label: (b as { day?: string }).day ?? b.label,
      ...b,
      rate: b.total > 0 ? parseFloat(((b.delivered / b.total) * 100).toFixed(1)) : 0
    }));
  }, [deliveries, trendPeriod3, getTimeBuckets]);

  const trend4LeadTime = useMemo(() => {
    const list = deliveries && Array.isArray(deliveries) ? deliveries : [];
    const isDelivered = (s: string) => ['delivered', 'delivered-with-installation', 'delivered-without-installation'].includes((s || '').toLowerCase());
    const buckets = getTimeBuckets(trendPeriod4).map(b => ({ ...b, leadTimes: [] as number[] }));
    const bucketMap = Object.fromEntries(buckets.map((b, i) => [b.key, i]));
    list.forEach(d => {
      if (!isDelivered(d.status || '')) return;
      const created = d.created_at || d.createdAt || d.created;
      const delivered = d.delivered_at || d.deliveredAt || created;
      if (!created || !delivered) return;
      const createdDt = new Date(created as string | number);
      const deliveredDt = new Date(delivered as string | number);
      const hours = (deliveredDt.getTime() - createdDt.getTime()) / (1000 * 60 * 60);
      const key = trendPeriod4 === 'day' ? deliveredDt.toISOString().slice(0, 10) : trendPeriod4 === 'month' ? `${deliveredDt.getFullYear()}-${String(deliveredDt.getMonth() + 1).padStart(2, '0')}` : String(deliveredDt.getFullYear());
      const i = bucketMap[key];
      if (i !== undefined) buckets[i].leadTimes.push(hours);
    });
    return buckets.map(b => {
      const sorted = [...b.leadTimes].sort((a, b) => a - b);
      const n = sorted.length;
      const medianHours = n > 0 ? parseFloat((sorted[Math.floor(n * 0.5)] ?? 0).toFixed(1)) : 0;
      const p90Hours = n > 0 ? parseFloat((sorted[Math.min(Math.floor(n * 0.9), n - 1)] ?? 0).toFixed(1)) : 0;
      return { label: (b as { day?: string }).day ?? b.label, ...b, medianHours, p90Hours };
    });
  }, [deliveries, trendPeriod4, getTimeBuckets]);

  const trend5Backlog = useMemo(() => {
    const list = deliveries && Array.isArray(deliveries) ? deliveries : [];
    const isOpen = (s: string) => ['pending', 'scheduled', 'scheduled-confirmed', 'out-for-delivery', 'in-progress', 'assigned'].includes((s || '').toLowerCase());
    const buckets = getTimeBuckets(trendPeriod5).map(b => ({ ...b, open: 0 }));
    const bucketMap = Object.fromEntries(buckets.map((b, i) => [b.key, i]));
    list.forEach(d => {
      if (!isOpen(d.status || '')) return;
      const t = d.created_at || d.createdAt || d.created;
      if (!t) return;
      const dt = new Date(t as string | number);
      const key = trendPeriod5 === 'day' ? dt.toISOString().slice(0, 10) : trendPeriod5 === 'month' ? `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}` : String(dt.getFullYear());
      const i = bucketMap[key];
      if (i !== undefined) buckets[i].open++;
    });
    return buckets.map(b => ({ label: (b as { day?: string }).day ?? b.label, ...b }));
  }, [deliveries, trendPeriod5, getTimeBuckets]);

  const trend6StatusMix100 = useMemo(() => {
    const list = deliveries && Array.isArray(deliveries) ? deliveries : [];
    const buckets = getTimeBuckets(trendPeriod6).map(b => ({ ...b, delivered: 0, pending: 0, inTransit: 0, cancelled: 0 }));
    const bucketMap = Object.fromEntries(buckets.map((b, i) => [b.key, i]));
    list.forEach(d => {
      const t = d.created_at || d.createdAt || d.created;
      if (!t) return;
      const dt = new Date(t as string | number);
      const key = trendPeriod6 === 'day' ? dt.toISOString().slice(0, 10) : trendPeriod6 === 'month' ? `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}` : String(dt.getFullYear());
      const i = bucketMap[key];
      if (i !== undefined) {
        const s = (d.status || '').toLowerCase();
        if (['delivered', 'delivered-with-installation', 'delivered-without-installation'].includes(s)) buckets[i].delivered++;
        else if (['pending', 'scheduled', 'scheduled-confirmed'].includes(s)) buckets[i].pending++;
        else if (['out-for-delivery', 'in-progress', 'assigned'].includes(s)) buckets[i].inTransit++;
        else if (['cancelled', 'rescheduled', 'rejected'].includes(s)) buckets[i].cancelled++;
      }
    });
    return buckets.map(b => {
      const total = b.delivered + b.pending + b.inTransit + b.cancelled;
      const toPct = (v: number) => total > 0 ? parseFloat(((v / total) * 100).toFixed(1)) : 0;
      return {
        label: (b as { day?: string }).day ?? b.label,
        ...b,
        deliveredPct: toPct(b.delivered),
        pendingPct: toPct(b.pending),
        inTransitPct: toPct(b.inTransit),
        cancelledPct: toPct(b.cancelled)
      };
    });
  }, [deliveries, trendPeriod6, getTimeBuckets]);

  const trend7Heatmap = useMemo(() => {
    const list = deliveries && Array.isArray(deliveries) ? deliveries : [];
    const grid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
    const now = new Date();
    const start = new Date(now.getTime() - 30 * 86400000);
    list.forEach(d => {
      const t = d.created_at || d.createdAt || d.created;
      if (!t) return;
      const dt = new Date(t as string | number);
      if (dt < start) return;
      const day = dt.getDay();
      const hour = dt.getHours();
      grid[day][hour]++;
    });
    return grid;
  }, [deliveries]);

  const trend5TopItems = useMemo(() => {
    const list = deliveries && Array.isArray(deliveries) ? deliveries : [];
    const now = new Date();
    const getKey = (t: string | number) => {
      const dt = new Date(t);
      return trendPeriod5 === 'day' ? dt.toISOString().slice(0, 10) : trendPeriod5 === 'month' ? `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}` : String(dt.getFullYear());
    };
    const rangeStart = trendPeriod5 === 'day' ? new Date(now.getTime() - 7 * 86400000) : trendPeriod5 === 'month' ? new Date(now.getFullYear(), now.getMonth() - 12, 1) : new Date(now.getFullYear() - 5, 0, 1);
    const inRange = (t: string | number) => new Date(t) >= rangeStart;
    const itemCount: Record<string, number> = {};
    list.forEach(d => {
      const t = d.created_at || d.createdAt || d.created;
      if (!t || !inRange(t)) return;
      const meta = (d.metadata || {}) as Record<string, unknown>;
      const orig = (meta.originalRow || meta._originalRow || {}) as Record<string, unknown>;
      const item = String(orig?.Description || orig?.description || (d as { items?: string }).items || '').trim() || 'Unspecified';
      const display = item.length > 30 ? item.slice(0, 27) + '...' : item;
      itemCount[display] = (itemCount[display] || 0) + 1;
    });
    return Object.entries(itemCount).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([item, count]) => ({ item, count }));
  }, [deliveries, trendPeriod5]);

  const trend6TopAreas = useMemo(() => {
    const list = deliveries && Array.isArray(deliveries) ? deliveries : [];
    const now = new Date();
    const rangeStart = trendPeriod6 === 'day' ? new Date(now.getTime() - 7 * 86400000) : trendPeriod6 === 'month' ? new Date(now.getFullYear(), now.getMonth() - 12, 1) : new Date(now.getFullYear() - 5, 0, 1);
    const inRange = (t: string | number) => new Date(t) >= rangeStart;
    const areaCount: Record<string, number> = {};
    list.forEach(d => {
      const t = d.created_at || d.createdAt || d.created;
      if (!t || !inRange(t)) return;
      const meta = (d.metadata || {}) as Record<string, unknown>;
      const orig = (meta.originalRow || meta._originalRow || {}) as Record<string, unknown>;
      const addr = ((d.address || '') + ' ' + (orig.City || '')).toLowerCase();
      let area = 'Other';
      for (const kw of areaKeywords) {
        if (addr.includes(kw.toLowerCase())) { area = kw; break; }
      }
      areaCount[area] = (areaCount[area] || 0) + 1;
    });
    return Object.entries(areaCount).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([area, count]) => ({ area, count }));
  }, [deliveries, trendPeriod6, areaKeywords]);

  const trend8AreasStacked = useMemo(() => {
    const list = deliveries && Array.isArray(deliveries) ? deliveries : [];
    const buckets = getTimeBuckets(trendPeriod7).map(b => ({ ...b } as Record<string, unknown>));
    const bucketMap = Object.fromEntries(buckets.map((b, i) => [b.key as string, i]));
    const allAreas: Record<string, number> = {};
    list.forEach(d => {
      const meta = (d.metadata || {}) as Record<string, unknown>;
      const orig = (meta.originalRow || meta._originalRow || {}) as Record<string, unknown>;
      const addr = ((d.address || '') + ' ' + (orig.City || '')).toLowerCase();
      let area = 'Other';
      for (const kw of areaKeywords) {
        if (addr.includes(kw.toLowerCase())) { area = kw; break; }
      }
      allAreas[area] = (allAreas[area] || 0) + 1;
    });
    const top5 = Object.entries(allAreas).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([a]) => a);
    top5.forEach(a => { buckets.forEach(b => { (b as Record<string, number>)[a] = 0; }); });
    list.forEach(d => {
      const t = d.created_at || d.createdAt || d.created;
      if (!t) return;
      const dt = new Date(t as string | number);
      const key = trendPeriod7 === 'day' ? dt.toISOString().slice(0, 10) : trendPeriod7 === 'month' ? `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}` : String(dt.getFullYear());
      const i = bucketMap[key];
      if (i === undefined) return;
      const meta = (d.metadata || {}) as Record<string, unknown>;
      const orig = (meta.originalRow || meta._originalRow || {}) as Record<string, unknown>;
      const addr = ((d.address || '') + ' ' + (orig.City || '')).toLowerCase();
      let area = 'Other';
      for (const kw of areaKeywords) {
        if (addr.includes(kw.toLowerCase())) { area = kw; break; }
      }
      if (top5.includes(area)) (buckets[i] as Record<string, number>)[area]++;
    });
    return buckets.map(b => ({
      label: (b as { day?: string }).day ?? (b as { label?: string }).label,
      xKey: (b as { day?: string }).day ?? (b as { label?: string }).label,
      ...b
    }));
  }, [deliveries, trendPeriod7, getTimeBuckets, areaKeywords]);

  const filteredDeliveries = useMemo<TrackingDelivery[]>(() => {
    const list = (deliveries && Array.isArray(deliveries) ? deliveries : []).slice();
    const dir = deliverySortDir === 'asc' ? 1 : -1;
    list.sort((a, b) => {
      if (deliverySortBy === 'customer') return dir * (a.customer || '').toLowerCase().localeCompare((b.customer || '').toLowerCase());
      if (deliverySortBy === 'status') return dir * (a.status || '').localeCompare(b.status || '');
      if (deliverySortBy === 'poNumber') return dir * (a.poNumber || '').localeCompare(b.poNumber || '');
      return dir * (new Date(a.created_at || a.createdAt || 0).getTime() - new Date(b.created_at || b.createdAt || 0).getTime());
    });
    const dayAgo = new Date(Date.now() - 86400000);
    return list.filter(d => {
      const q = deliverySearch.trim().toLowerCase();
      if (q && !((d.poNumber || '').toLowerCase().includes(q) || (d.customer || '').toLowerCase().includes(q) || (d.address || '').toLowerCase().includes(q))) return false;
      if (deliveryStatusFilter !== 'all' && (d.status || '').toLowerCase() !== deliveryStatusFilter) return false;
      const date = new Date(d.created_at || d.createdAt || 0);
      if (deliveryDateFrom && date < new Date(deliveryDateFrom)) return false;
      if (deliveryDateTo && date > new Date(deliveryDateTo + 'T23:59:59')) return false;
      if (deliveryAttentionFilter === 'overdue') {
        const s = (d.status || '').toLowerCase();
        if (!['pending', 'scheduled'].includes(s)) return false;
        if (date >= dayAgo) return false;
      } else if (deliveryAttentionFilter === 'unassigned') {
        const s = (d.status || '').toLowerCase();
        if (!['pending', 'scheduled'].includes(s)) return false;
        if (d.assignedDriverId || d.tracking?.driverId) return false;
      } else if (deliveryAttentionFilter === 'awaiting') {
        const s = (d.status || '').toLowerCase();
        const conf = String(d.confirmationStatus || '').toLowerCase();
        if (!['pending', 'scheduled'].includes(s)) return false;
        if (conf === 'confirmed' || d.customerConfirmedAt) return false;
      }
      return true;
    });
  }, [deliveries, deliverySearch, deliveryStatusFilter, deliveryDateFrom, deliveryDateTo, deliveryAttentionFilter, deliverySortBy, deliverySortDir]);

  const deliveryByAreaData = useMemo<AreaItem[]>(() => {
    const arr = (data?.analytics?.deliveryByArea || []).slice().sort((a, b) => (b.count ?? 0) - (a.count ?? 0));
    return arr.slice(0, chartTopN);
  }, [data?.analytics?.deliveryByArea, chartTopN]);

  type AreaRowEnhanced = AreaItem & { pending?: number; delivered?: number; successRate?: number };
  const deliveryByAreaEnhanced = useMemo<AreaRowEnhanced[]>(() => {
    const list = deliveries && Array.isArray(deliveries) ? deliveries : [];
    const byArea: Record<string, { count: number; pending: number; delivered: number }> = {};
    list.forEach(d => {
      const meta = (d.metadata || {}) as Record<string, unknown>;
      const orig = (meta.originalRow || meta._originalRow || {}) as Record<string, unknown>;
      const addr = ((d.address || '') + ' ' + (orig.City || '')).toLowerCase();
      let area = 'Other';
      for (const kw of areaKeywords) {
        if (addr.includes(kw.toLowerCase())) { area = kw; break; }
      }
      if (!byArea[area]) byArea[area] = { count: 0, pending: 0, delivered: 0 };
      byArea[area].count++;
      const s = (d.status || '').toLowerCase();
      if (['delivered', 'delivered-with-installation', 'delivered-without-installation'].includes(s)) byArea[area].delivered++;
      else if (['pending', 'scheduled', 'scheduled-confirmed', 'out-for-delivery', 'in-progress', 'assigned'].includes(s)) byArea[area].pending++;
    });
    return Object.entries(byArea)
      .map(([area, v]) => ({
        area,
        count: v.count,
        pending: v.pending,
        delivered: v.delivered,
        successRate: v.count > 0 ? sharePct(v.delivered, v.count) : 0
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, chartTopN);
  }, [deliveries, areaKeywords, chartTopN]);

  const topItemsData = useMemo<ItemItem[]>(() => {
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

  const topItemsTableData = useMemo(() => {
    const total = (data?.analytics?.topItems || []).reduce((s, r) => s + (r.count ?? 0), 0);
    return topItemsData.map(r => ({
      ...r,
      sharePct: total > 0 ? sharePct(r.count ?? 0, total) : 0
    }));
  }, [topItemsData, data?.analytics?.topItems]);

  const topCustomersData = useMemo<CustomerItem[]>(() => {
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

  const topCustomersDataWithMeta = useMemo(() => {
    const total = topCustomersData.reduce((s, r) => s + (r.orders ?? 0), 0);
    return topCustomersData.map(r => ({
      ...r,
      sharePct: total > 0 ? sharePct(r.orders ?? 0, total) : 0,
      pendingRate: (r.orders ?? 0) > 0 ? sharePct(r.pending ?? 0, r.orders ?? 0) : 0,
      riskFlag: riskFromSuccessRate(r.successRate ?? 0)
    }));
  }, [topCustomersData]);

  const topCustomersAreas = useMemo<string[]>(() =>
    Array.from(new Set((data?.analytics?.topCustomers || []).map(r => r.primaryArea).filter((a): a is string => Boolean(a)))).sort()
  , [data?.analytics?.topCustomers]);

  const customerKpis = useMemo(() => {
    const cust = topCustomersData;
    const totalOrders = cust.reduce((s, r) => s + (r.orders ?? 0), 0);
    const top1Share = totalOrders > 0 && cust[0] ? sharePct(cust[0].orders ?? 0, totalOrders) : 0;
    const top3Share = topNSharePct(cust, r => r.orders ?? 0, 3);
    const avgSuccess = cust.length > 0 ? cust.reduce((s, r) => s + (r.successRate ?? 0), 0) / cust.length : 0;
    const lowPerf = cust.filter(r => (r.successRate ?? 0) < 70).length;
    return { top1Share, top3Share, avgSuccess, lowPerf };
  }, [topCustomersData]);

  const areaKpis = useMemo(() => {
    const areas = deliveryByAreaEnhanced;
    const total = areas.reduce((s, r) => s + r.count, 0);
    const topShare = total > 0 && areas[0] ? sharePct(areas[0].count, total) : 0;
    const avgSuccess = areas.length > 0 ? areas.reduce((s, r) => s + (r.successRate ?? 0), 0) / areas.length : 0;
    const worstArea = areas.length === 0 ? null : areas.reduce((a, b) => ((a.successRate ?? 100) <= (b.successRate ?? 100) ? a : b));
    const largestBacklog = areas.filter(r => (r.pending ?? 0) > 0).sort((a, b) => (b.pending ?? 0) - (a.pending ?? 0))[0] ?? null;
    return { topShare, avgSuccess, worstArea, largestBacklog };
  }, [deliveryByAreaEnhanced]);

  const productKpis = useMemo(() => {
    const items = (data?.analytics?.topItems || []).slice();
    const total = items.reduce((s, r) => s + (r.count ?? 0), 0);
    const top1Share = total > 0 && items[0] ? sharePct(items[0].count ?? 0, total) : 0;
    const top3Share = topNSharePct(items, r => r.count ?? 0, 3);
    const conc = concentrationLevel(items, total);
    const dqIssues = items.filter(r => {
      const dq = !r.item || r.item === 'Unspecified' || !r.pnc || r.pnc === '-';
      return dq;
    }).length;
    return { top1Share, top3Share, concentration: conc, dqIssues };
  }, [data?.analytics?.topItems]);

  const driversData = useMemo<AdminDriver[]>(() => {
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
      if (driversSortBy === 'lastUpdate') {
        const aTime = new Date(a.tracking?.lastUpdate || a.account?.lastLogin || 0).getTime();
        const bTime = new Date(b.tracking?.lastUpdate || b.account?.lastLogin || 0).getTime();
        return dir * (aTime - bTime);
      }
      return 0;
    });
  }, [drivers, driversSearch, driversStatusFilter, driversSortBy, driversSortDir, onlineUserIds]);

  /** Workload + outcome charts for Drivers tab (from live deliveries, not duplicated table rows). */
  const driverPanelAnalytics = useMemo(() => {
    const idOf = (row: TrackingDelivery) => deliveryDriverIdForAnalytics(row, drivers);
    const counts = new Map<string, number>();
    let assignedN = 0;
    let deliveredN = 0;
    let pipelineN = 0;
    let negativeN = 0;

    for (const row of deliveries) {
      const did = idOf(row);
      if (!did) continue;
      assignedN++;
      counts.set(did, (counts.get(did) || 0) + 1);
      const st = normalizeDeliveryStatus(row.status);
      if (isDeliveredDeliveryStatus(st)) deliveredN++;
      else if (isCancelledOrRescheduledDeliveryStatus(st)) negativeN++;
      else pipelineN++;
    }

    const workloadBars = drivers
      .map(dr => {
        const id = String(dr.id);
        const name = (dr.fullName || dr.full_name || dr.username || 'Driver').trim();
        const short = name.length > 22 ? `${name.slice(0, 20)}…` : name;
        return { name: short, count: counts.get(id) || 0 };
      })
      .filter(r => r.count > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);

    const outcomesPie = [
      { name: 'Delivered', value: deliveredN, fill: '#16a34a' },
      { name: 'In pipeline', value: pipelineN, fill: '#2563eb' },
      { name: 'Cancelled / rescheduled', value: negativeN, fill: '#94a3b8' },
    ].filter(x => x.value > 0);

    return {
      workloadBars,
      outcomesPie,
      hasAssignments: assignedN > 0,
    };
  }, [deliveries, drivers]);

  const exportCSV = (rows: Record<string, unknown>[], fields: string[], filename: string): void => {
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
        <button onClick={() => { setLoading(true); setData(null); void loadDashboardData(); }}
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

  const STATUS_LABELS: Record<string, string> = {
    'pending': 'Pending', 'scheduled': 'Scheduled', 'scheduled-confirmed': 'Confirmed',
    'out-for-delivery': 'Out for Delivery', 'in-progress': 'In Progress',
    'delivered': 'Delivered', 'delivered-with-installation': 'Delivered + Install',
    'delivered-without-installation': 'Delivered', 'cancelled': 'Cancelled',
    'rejected': 'Rejected', 'rescheduled': 'Rescheduled', 'returned': 'Returned',
  };

  const STATUS_COLORS: Record<string, string> = {
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

  const KPI_COLOR_MAP: Record<string, { bg: string; icon: string; val: string }> = {
    blue:    { bg: 'bg-blue-50 dark:bg-blue-900/20',    icon: 'text-blue-600 dark:text-blue-400',    val: 'text-blue-700 dark:text-blue-300' },
    green:   { bg: 'bg-green-50 dark:bg-green-900/20',  icon: 'text-green-600 dark:text-green-400',  val: 'text-green-700 dark:text-green-300' },
    indigo:  { bg: 'bg-indigo-50 dark:bg-indigo-900/20',icon: 'text-indigo-600 dark:text-indigo-400',val: 'text-indigo-700 dark:text-indigo-300' },
    yellow:  { bg: 'bg-yellow-50 dark:bg-yellow-900/20',icon: 'text-yellow-600 dark:text-yellow-400',val: 'text-yellow-700 dark:text-yellow-300' },
    red:     { bg: 'bg-red-50 dark:bg-red-900/20',      icon: 'text-red-600 dark:text-red-400',      val: 'text-red-700 dark:text-red-300' },
    emerald: { bg: 'bg-emerald-50 dark:bg-emerald-900/20', icon: 'text-emerald-600 dark:text-emerald-400', val: 'text-emerald-700 dark:text-emerald-300' },
  };

  const SortTh = ({ label, sortKey, current, dir, onSort, align = 'left' }: SortThProps): React.ReactElement => (
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
    { id: 'overview',   label: 'Overview',                                  icon: Activity    },
    { id: 'deliveries', label: `Deliveries (${filteredDeliveries.length})`, icon: Package     },
    { id: 'trends',     label: 'Trends',                                    icon: TrendingUp  },
    { id: 'customers',  label: 'Top Customers',                             icon: Users       },
    { id: 'by-area',    label: 'By Area',                                   icon: MapPin      },
    { id: 'by-product', label: 'By Product',                                icon: FileText    },
    { id: 'drivers',    label: 'Drivers',                                   icon: Users       },
  ];

  // ─── RENDER ───

    return (
    <div className="space-y-6 w-full min-w-0">

      {/* ── Page Header ── */}
      <div className="pp-page-header flex flex-wrap items-center justify-between gap-3">
          <div>
          <h1 className="pp-page-title">Admin Dashboard</h1>
          <p className="pp-page-subtitle">
            Last updated: {lastUpdate.toLocaleTimeString()} &nbsp;<span className="text-green-500">● Live</span>
            </p>
          </div>
          <button
          onClick={() => { setLoading(true); void loadDashboardData(); }}
          className="flex items-center gap-2 px-4 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors shadow-sm"
        >
          <RefreshCw className="w-4 h-4" /> Refresh
          </button>
        </div>

      {/* ── Tab Navigation ── */}
      <div className="border-b border-gray-200 dark:border-gray-700">
        <nav className="flex overflow-x-auto">
          {tabs.map(({ id, label, icon: Icon }) => (
              <button
              key={id}
              onClick={() => { setActiveTab(id); setDeliveryPage(0); }}
              className={`flex items-center gap-2 px-5 py-3 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
                activeTab === id
                  ? 'border-blue-500 text-blue-500 dark:border-blue-400 dark:text-blue-400'
                    : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600'
              }`}
              >
              <Icon className="w-4 h-4" />{label}
              </button>
          ))}
        </nav>
      </div>

      {/* Animated tab content */}
      <div key={activeTab} className="tab-enter">

      {/* ══════════════ OVERVIEW TAB ══════════════ */}
      {activeTab === 'overview' && (
        <div className="space-y-4">
          {/* KPI Strip — Overview only */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {kpiCards.map(card => {
              const Icon = card.icon;
              const c = KPI_COLOR_MAP[card.color];
              return (
                <div key={card.id} className="bg-white dark:bg-gray-800 rounded-lg border border-gray-100 dark:border-gray-700 shadow-sm p-4">
                  <div className="flex items-center justify-between mb-2 gap-2">
                    <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide leading-tight flex items-center gap-1 min-w-0">
                      {card.label}
                      {card.id === 'rate' && (
                        <span
                          className="inline-flex shrink-0 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                          title="Success rate = delivered orders ÷ total orders. The trend chart uses the same ratio per day (delivered ÷ dispatched that day)."
                        >
                          <HelpCircle className="w-3.5 h-3.5" aria-hidden />
                        </span>
                      )}
                    </span>
                    <div className={`p-1.5 rounded-md shrink-0 ${c.bg}`}><Icon className={`w-4 h-4 ${c.icon}`} /></div>
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

          {/* Two-column main content */}
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            {/* Left column — ~2/3 */}
            <div className="xl:col-span-2 space-y-4">
              {/* Hero Chart */}
              <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-100 dark:border-gray-700 shadow-sm p-6">
                <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
                  <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Delivery Trend</h2>
                  <div className="flex rounded-lg border border-gray-200 dark:border-gray-600 overflow-hidden text-xs font-medium shrink-0">
                    {([['7d', 'Last 7 days'], ['30d', 'Last 30 days'], ['90d', 'Last 90 days']] as [string, string][]).map(([p, label]) => (
                      <button
                        key={p}
                        type="button"
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
                      formatter={(val: number | string, name: string) => (name === 'Success Rate %' ? [`${val}%`, name] : [val, name]) as [React.ReactNode, string]}
                    />
                    <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '12px' }} />
                    <Bar yAxisId="left" dataKey="total" fill="#c7d7f9" name="Total Dispatched" radius={[3, 3, 0, 0]} maxBarSize={20} isAnimationActive={false} />
                    <Bar yAxisId="left" dataKey="delivered" fill="#2563EB" name="Delivered" radius={[3, 3, 0, 0]} maxBarSize={20} isAnimationActive={false} />
                    <Line yAxisId="right" type="monotone" dataKey="rate" stroke="#f97316" name="Success Rate %" dot={false} strokeWidth={2.5} isAnimationActive={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>

              {/* Delivery Status Breakdown */}
              <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-100 dark:border-gray-700 shadow-sm p-5">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Delivery Status</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 mb-4">
                  Share of all orders (same headline totals as the KPI strip). Percentages are of total orders.
                </p>
                <div className="space-y-3">
                  {[
                    { label: 'Delivered', value: totals.delivered, color: 'bg-green-500' },
                    { label: 'Pending', value: totals.pending, color: 'bg-yellow-400' },
                    { label: 'Rescheduled', value: totals.rescheduled, color: 'bg-orange-400' },
                    { label: 'Cancelled', value: totals.cancelled, color: 'bg-red-500' },
                  ].map(({ label, value, color }) => {
                    const pct = totals.total > 0 ? ((value / totals.total) * 100).toFixed(1) : 0;
                    return (
                      <div key={label}>
                        <div className="flex justify-between text-xs mb-1">
                          <span className="text-gray-600 dark:text-gray-400">{label}</span>
                          <span className="font-semibold text-gray-900 dark:text-gray-100">{value} <span className="text-gray-400 font-normal">({pct}%)</span></span>
                        </div>
                        <div className="w-full h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Right column — ~1/3 side widgets */}
            <div className="space-y-4">
              {/* Exception Queue — PolicyPilot style */}
              <div className="bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 rounded-lg border border-blue-100 dark:border-blue-800 shadow-sm p-5">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3">Needs Attention</h3>
                <div className="grid grid-cols-2 gap-2 mb-3">
                  <button onClick={() => { setActiveTab('deliveries'); setDeliveryAttentionFilter('overdue'); setDeliveryStatusFilter('pending'); setDeliveryPage(0); }}
                    className="flex flex-col items-center justify-center p-3 rounded-lg bg-white/80 dark:bg-gray-800/80 hover:bg-white dark:hover:bg-gray-800 transition-colors text-left cursor-pointer">
                    <span className="text-lg font-bold text-amber-600 dark:text-amber-400">{actionItems.overdue}</span>
                    <span className="text-xs text-gray-600 dark:text-gray-400">Overdue</span>
                  </button>
                  <button onClick={() => { setActiveTab('deliveries'); setDeliveryAttentionFilter('unassigned'); setDeliveryStatusFilter('pending'); setDeliveryPage(0); }}
                    className="flex flex-col items-center justify-center p-3 rounded-lg bg-white/80 dark:bg-gray-800/80 hover:bg-white dark:hover:bg-gray-800 transition-colors text-left cursor-pointer">
                    <span className="text-lg font-bold text-orange-600 dark:text-orange-400">{actionItems.unassigned}</span>
                    <span className="text-xs text-gray-600 dark:text-gray-400">Unassigned</span>
                  </button>
                  <button onClick={() => { setActiveTab('deliveries'); setDeliveryAttentionFilter('awaiting'); setDeliveryStatusFilter('pending'); setDeliveryPage(0); }}
                    className="flex flex-col items-center justify-center p-3 rounded-lg bg-white/80 dark:bg-gray-800/80 hover:bg-white dark:hover:bg-gray-800 transition-colors text-left col-span-2 cursor-pointer">
                    <span className="text-lg font-bold text-purple-600 dark:text-purple-400">{actionItems.unconfirmed}</span>
                    <span className="text-xs text-gray-600 dark:text-gray-400">Awaiting confirmation</span>
                  </button>
                </div>
                <button onClick={() => { setActiveTab('deliveries'); setDeliveryPage(0); }}
                  className="w-full flex items-center justify-center gap-1 text-xs font-medium text-primary-600 dark:text-primary-400 hover:underline">
                  View in Deliveries <ChevronRight className="w-3 h-3" />
                </button>
              </div>

              {/* Customer Response */}
              <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-100 dark:border-gray-700 shadow-sm p-5">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-4">Customer Response</h3>
                <div className="space-y-3">
                  {[
                    { label: 'Accepted', value: totals.customerAccepted || 0, color: 'text-green-600 dark:text-green-400', bg: 'bg-green-50 dark:bg-green-900/20' },
                    { label: 'Rescheduled', value: totals.customerRescheduled || 0, color: 'text-yellow-600 dark:text-yellow-400', bg: 'bg-yellow-50 dark:bg-yellow-900/20' },
                    { label: 'Cancelled', value: totals.customerCancelled || 0, color: 'text-red-600 dark:text-red-400', bg: 'bg-red-50 dark:bg-red-900/20' },
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
                      <div className="h-full bg-green-500 rounded-full transition-all" style={{ width: `${((totals.withPOD || 0) / totals.delivered * 100).toFixed(0)}%` }} />
                    </div>
                    <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400">
                      <span>Coverage: {((totals.withPOD || 0) / totals.delivered * 100).toFixed(1)}%</span>
                      <span>Without POD: {totals.withoutPOD || 0}</span>
                    </div>
                    <button onClick={() => navigate('/admin/reports/pod')} className="mt-4 w-full text-xs text-primary-600 dark:text-primary-400 hover:underline text-center">
                      View full POD report →
                    </button>
                  </>
                ) : (
                  <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-8">No delivered items yet</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════ TRENDS TAB ══════════════ */}
      {activeTab === 'trends' && (
        <div className="space-y-4">
          {/* Compact strip — tab-specific */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {[
              { label: 'Total Deliveries', value: totals.total, icon: Package, color: 'blue' },
              { label: 'Delivered', value: totals.delivered, icon: CheckCircle, color: 'green' },
              { label: 'Success Rate', value: totals.total > 0 ? `${((totals.delivered / totals.total) * 100).toFixed(1)}%` : '0%', icon: Target, color: 'emerald' },
            ].map(({ label, value, icon: Icon, color }) => {
              const c = KPI_COLOR_MAP[color];
              return (
                <div key={label} className="bg-white dark:bg-gray-800 rounded-lg border border-gray-100 dark:border-gray-700 shadow-sm p-3 flex items-center gap-3">
                  <div className={`p-2 rounded-lg ${c.bg}`}><Icon className={`w-4 h-4 ${c.icon}`} /></div>
                  <div>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
                    <p className={`text-lg font-bold ${c.val}`}>{value}</p>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Eight trend charts — 3 columns on lg */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* 1. Delivery Demand Trend — Column + moving average */}
            <TrendChartCard
              title="Delivery Demand Trend"
              subtitle={trendPeriod1 === 'day' ? 'Total requests per day + 7-day moving avg' : trendPeriod1 === 'month' ? 'Per month + 4-period moving avg' : 'Per year + 3-period moving avg'}
              period={trendPeriod1}
              onPeriodChange={setTrendPeriod1}
              data={trend1DeliveryRequests}
              dataKey="count"
              xKey={trendPeriod1 === 'day' ? 'day' : 'label'}
              chartType="demand-ma"
              barColor="#2563EB"
            />
            {/* 2. Fulfillment Trend — Grouped columns: created vs delivered vs in-transit vs cancelled */}
            <TrendChartCard
              title="Fulfillment Trend"
              subtitle="Created vs Delivered vs In Transit vs Cancelled per period"
              period={trendPeriod2}
              onPeriodChange={setTrendPeriod2}
              data={trend2Fulfillment}
              xKey={trendPeriod2 === 'day' ? 'day' : 'label'}
              chartType="fulfillment"
            />
            {/* 3. Success Rate — Line + 95% target */}
            <TrendChartCard
              title="Success Rate"
              subtitle="Success rate = delivered / total completed requests. Target: 95%"
              period={trendPeriod3}
              onPeriodChange={setTrendPeriod3}
              data={trend3SuccessRate}
              dataKey="rate"
              xKey={trendPeriod3 === 'day' ? 'day' : 'label'}
              chartType="success-target"
              targetValue={95}
            />
            {/* 4. Delivery Lead Time Trend — Median + P90 */}
            <TrendChartCard
              title="Delivery Lead Time Trend"
              subtitle="Median and P90 hours from created to delivered"
              period={trendPeriod4}
              onPeriodChange={setTrendPeriod4}
              data={trend4LeadTime}
              xKey={trendPeriod4 === 'day' ? 'day' : 'label'}
              chartType="lead-time"
            />
            {/* 5. Backlog Trend — Open deliveries over time */}
            <TrendChartCard
              title="Backlog / Open Deliveries Trend"
              subtitle={trendPeriod5 === 'day' ? 'Pending + in-transit created per day' : trendPeriod5 === 'month' ? 'Per month' : 'Per year'}
              period={trendPeriod5}
              onPeriodChange={setTrendPeriod5}
              data={trend5Backlog}
              xKey={trendPeriod5 === 'day' ? 'day' : 'label'}
              chartType="backlog"
            />
            {/* 6. Status Mix Over Time — 100% stacked area */}
            <TrendChartCard
              title="Status Mix Over Time"
              subtitle="Proportion of delivered, pending, in-transit, cancelled over time"
              period={trendPeriod6}
              onPeriodChange={setTrendPeriod6}
              data={trend6StatusMix100}
              xKey={trendPeriod6 === 'day' ? 'day' : 'label'}
              chartType="status-mix-100"
            />
            {/* 7. Peak Pattern Analysis — Heatmap */}
            <PeakHeatmapCard
              title="Peak Pattern Analysis"
              subtitle="Request volume by day of week and hour (last 30 days)"
              data={trend7Heatmap}
            />
            {/* 8. Top Areas Trend — Stacked area by top 5 areas */}
            <TrendChartCard
              title="Top Areas Trend"
              subtitle={trendPeriod7 === 'day' ? 'Volume by top 5 areas per day' : trendPeriod7 === 'month' ? 'Per month' : 'Per year'}
              period={trendPeriod7}
              onPeriodChange={setTrendPeriod7}
              data={trend8AreasStacked}
              xKey="label"
              chartType="areas-stacked"
            />
            {/* 9. Top Items — Ranked horizontal bars */}
            <TrendChartCard
              title="Top Items by Volume"
              subtitle={trendPeriod8 === 'day' ? 'Last 7 days' : trendPeriod8 === 'month' ? 'Last 12 months' : 'Last 5 years'}
              period={trendPeriod8}
              onPeriodChange={setTrendPeriod8}
              data={trend5TopItems}
              dataKey="count"
              xKey="item"
              chartType="items-ranked"
              barColor="#2563EB"
            />
          </div>
        </div>
      )}

      {/* ══════════════ TOP CUSTOMERS TAB ══════════════ */}
      {activeTab === 'customers' && (
        <div className="space-y-4">
          {/* KPI strip — original + extra */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
            {[
              { label: 'Total Customers', value: topCustomersData.length, icon: Users, color: 'blue' },
              { label: 'Total Orders', value: topCustomersData.reduce((s, r) => s + (r.orders ?? 0), 0), icon: Package, color: 'indigo' },
              { label: 'Delivered', value: topCustomersData.reduce((s, r) => s + (r.delivered ?? 0), 0), icon: CheckCircle, color: 'green' },
              { label: 'Areas', value: topCustomersAreas.length, icon: MapPin, color: 'emerald' },
              { label: 'Top 1 Share', value: `${customerKpis.top1Share.toFixed(1)}%`, icon: Target, color: 'blue', tooltip: 'Top customer orders as % of total' },
              { label: 'Top 3 Share', value: `${customerKpis.top3Share.toFixed(1)}%`, icon: TrendingUp, color: 'indigo', tooltip: 'Top 3 customers combined share' },
              { label: 'Avg Success Rate', value: `${customerKpis.avgSuccess.toFixed(1)}%`, icon: CheckCircle, color: 'green', tooltip: 'Average delivery success rate across customers' },
              { label: 'Low Perf (<70%)', value: customerKpis.lowPerf, icon: AlertCircle, color: 'red', tooltip: 'Customers with success rate below 70%' },
            ].map(({ label, value, icon: Icon, color, tooltip }) => {
              const c = KPI_COLOR_MAP[color];
              return (
                <div key={label} className="bg-white dark:bg-gray-800 rounded-lg border border-gray-100 dark:border-gray-700 shadow-sm p-3 flex items-center gap-3">
                  <div className={`p-2 rounded-lg ${c.bg}`}><Icon className={`w-4 h-4 ${c.icon}`} /></div>
                  <div className="min-w-0">
                    <p className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
                      {tooltip ? <MetricTooltip term={label} definition={tooltip} /> : label}
                    </p>
                    <p className={`text-lg font-bold ${c.val} truncate`}>{value}</p>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Filter bar */}
          <div className="flex flex-wrap gap-2 items-center">
            <input
              type="text"
              placeholder="Search customer name or area..."
              value={topCustomersSearch}
              onChange={e => setTopCustomersSearch(e.target.value)}
              className="flex-1 min-w-0 sm:min-w-[140px] md:min-w-[200px] px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
            <select value={topCustomersAreaFilter} onChange={e => setTopCustomersAreaFilter(e.target.value)}
              className="px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100">
              <option value="all">All Areas</option>
              {topCustomersAreas.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
            <select value={topCustomersSortBy} onChange={e => setTopCustomersSortBy(e.target.value)}
              className="px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100">
              <option value="orders">Sort: Total Orders</option>
              <option value="delivered">Sort: Delivered</option>
              <option value="successRate">Sort: Success Rate</option>
              <option value="customer">Sort: Name</option>
            </select>
            <button onClick={() => setTopCustomersSortDir(d => d === 'asc' ? 'desc' : 'asc')}
              className="px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
              {topCustomersSortDir === 'asc' ? '↑ Asc' : '↓ Desc'}
            </button>
            <button onClick={() => exportCSV(topCustomersDataWithMeta as unknown as Record<string, unknown>[], ['customer', 'orders', 'delivered', 'pending', 'cancelled', 'successRate', 'sharePct', 'pendingRate', 'riskFlag', 'primaryArea', 'totalQuantity'], 'top-customers')}
              className="flex items-center gap-1.5 px-3 py-2 text-sm bg-primary-600 hover:bg-primary-700 text-white rounded-lg transition-colors">
              <Download className="w-3.5 h-3.5" /> Export
            </button>
          </div>

          {/* Two-column layout: Chart | Table */}
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            {/* Chart — left, with Pareto overlay */}
            <div className="xl:col-span-1 space-y-4">
              {topCustomersData.length > 0 ? (
                <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-100 dark:border-gray-700 shadow-sm p-6">
                  <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-4">Top 10 Customers by Orders + Cumulative Share</h2>
                  <ResponsiveContainer width="100%" height={Math.max(220, Math.min(topCustomersData.length * 42, 400))}>
                    <ComposedChart
                      data={topCustomersData.map((r, i) => {
                        const total = topCustomersData.reduce((s, x) => s + (x.orders ?? 0), 0);
                        const cum = topCustomersData.slice(0, i + 1).reduce((s, x) => s + (x.orders ?? 0), 0);
                        return { name: r.customer, orders: r.orders, delivered: r.delivered, cumPct: total > 0 ? sharePct(cum, total) : 0 };
                      })}
                      layout="vertical"
                      margin={{ left: 10, right: 50, top: 5, bottom: 5 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" horizontal={false} />
                      <XAxis type="number" tick={{ fontSize: 11, fill: '#6b7280' }} tickLine={false} axisLine={false} />
                      <YAxis type="category" dataKey="name" width={140} tick={{ fontSize: 11, fill: '#374151' }} tickLine={false} axisLine={false} />
                      <YAxis type="number" yAxisId="pct" orientation="right" domain={[0, 100]} tick={{ fontSize: 9, fill: '#9ca3af' }} tickFormatter={v => `${v}%`} width={45} tickLine={false} axisLine={false} />
                      <Tooltip contentStyle={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', fontSize: '12px' }} formatter={(val: number, name: string, props: { payload?: { cumPct?: number } }) => (name === 'Cum. Share' ? [`${(props?.payload?.cumPct ?? val).toFixed(1)}%`, name] : [val, name])} />
                      <Legend wrapperStyle={{ fontSize: '12px' }} />
                      <Bar dataKey="orders" name="Total Orders" fill="#93c5fd" radius={[0, 3, 3, 0]} maxBarSize={18} isAnimationActive />
                      <Bar dataKey="delivered" name="Delivered" fill="#2563EB" radius={[0, 3, 3, 0]} maxBarSize={18} isAnimationActive />
                      <Line type="monotone" dataKey="cumPct" name="Cum. Share" stroke="#f59e0b" strokeWidth={2} strokeDasharray="4 4" dot={{ r: 2 }} yAxisId="pct" isAnimationActive />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-100 dark:border-gray-700 shadow-sm p-6">
                  <p className="text-center py-8 text-gray-400 dark:text-gray-500 text-sm">No customer data available</p>
                </div>
              )}
              {/* Side widget: Top customer spotlight */}
              {topCustomersData.length > 0 && topCustomersData[0] && (
                <div className="mt-4 bg-white dark:bg-gray-800 rounded-lg border border-gray-100 dark:border-gray-700 shadow-sm p-4">
                  <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-2">Top Customer</h3>
                  <p className="font-medium text-gray-900 dark:text-gray-100">{topCustomersData[0].customer}</p>
                  <p className="text-sm text-gray-500 dark:text-gray-400">{topCustomersData[0].orders ?? 0} orders · {topCustomersData[0].delivered ?? 0} delivered</p>
                  {topCustomersData[0].primaryArea && <p className="text-xs text-gray-400 mt-1 flex items-center gap-1"><MapPin className="w-3 h-3" />{topCustomersData[0].primaryArea}</p>}
                </div>
              )}

              {/* Customer Performance Matrix */}
              {topCustomersData.length > 0 && (
                <div className="mt-4 bg-white dark:bg-gray-800 rounded-lg border border-gray-100 dark:border-gray-700 shadow-sm p-4">
                  <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-2">Customer Performance Matrix</h3>
                  <p className="text-[10px] text-gray-400 mb-2">Orders (x) vs Success % (y), bubble size = pending</p>
                  <ResponsiveContainer width="100%" height={180}>
                    <ScatterChart margin={{ top: 5, right: 10, bottom: 5, left: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis type="number" dataKey="orders" name="Orders" tick={{ fontSize: 9 }} tickLine={false} />
                      <YAxis type="number" dataKey="successRate" name="Success %" domain={[0, 100]} tick={{ fontSize: 9 }} tickLine={false} />
                      <Tooltip cursor={{ strokeDasharray: '3 3' }} contentStyle={{ fontSize: '11px' }} formatter={(val: number, name: string) => [name === 'pending' ? val : name === 'successRate' ? `${val}%` : val, name]} />
                      <ZAxis type="number" dataKey="pending" range={[60, 400]} name="Pending" />
                      <Scatter
                        data={topCustomersData.map(r => ({ orders: r.orders ?? 0, successRate: r.successRate ?? 0, pending: Math.max(r.pending ?? 0, 1), name: r.customer }))}
                        fill="#2563EB"
                        fillOpacity={0.7}
                      />
                    </ScatterChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            {/* Table — right, spans 2 cols */}
            <div className="xl:col-span-2">
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-100 dark:border-gray-700 shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-700">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Customer Detail — Top {topCustomersData.length}</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead className="bg-gray-50 dark:bg-gray-700/50">
                  <tr>
                    <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase text-left w-10">#</th>
                    <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase text-left">Customer</th>
                    <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase text-right">Orders</th>
                    <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase text-right">Delivered</th>
                    <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase text-right">Pending</th>
                    <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase text-right">Cancelled</th>
                    <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase text-right">
                      <MetricTooltip term="Share %" definition="Customer orders as % of total" />
                    </th>
                    <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase text-right">
                      <MetricTooltip term="Pending Rate" definition="Pending orders as % of customer total" />
                    </th>
                    <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase text-right">Success %</th>
                    <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase text-center">Risk</th>
                    <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase text-left">Primary Area</th>
                    <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase text-right">Total Qty</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {topCustomersDataWithMeta.length > 0 ? topCustomersDataWithMeta.map((row, idx) => (
                    <tr key={idx} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                      <td className="px-4 py-3 text-sm text-gray-400 dark:text-gray-500">{idx + 1}</td>
                      <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-gray-100">{row.customer || '—'}</td>
                      <td className="px-4 py-3 text-sm text-right font-bold text-blue-600 dark:text-blue-400">{row.orders ?? 0}</td>
                      <td className="px-4 py-3 text-sm text-right text-green-600 dark:text-green-400 font-semibold">{row.delivered ?? 0}</td>
                      <td className="px-4 py-3 text-sm text-right text-yellow-600 dark:text-yellow-400">{row.pending ?? 0}</td>
                      <td className="px-4 py-3 text-sm text-right text-red-500 dark:text-red-400">{row.cancelled ?? 0}</td>
                      <td className="px-4 py-3 text-sm text-right text-gray-600 dark:text-gray-400">{row.sharePct?.toFixed(1) ?? '—'}%</td>
                      <td className="px-4 py-3 text-sm text-right">
                        <span className={row.pendingRate > 20 ? 'text-amber-600 dark:text-amber-400 font-medium' : 'text-gray-600 dark:text-gray-400'}>
                          {row.pendingRate?.toFixed(1) ?? '—'}%
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-right">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${(row.successRate ?? 0) >= 80 ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : (row.successRate ?? 0) >= 50 ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'}`}>
                          {(row.successRate ?? 0).toFixed(1)}%
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-center">
                        <RiskBadge level={row.riskFlag ?? 'low'} />
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
                        {row.primaryArea ? <span className="flex items-center gap-1"><MapPin className="w-3 h-3 text-gray-400" />{row.primaryArea}</span> : '—'}
                      </td>
                      <td className="px-4 py-3 text-sm text-right text-gray-600 dark:text-gray-400">{row.totalQuantity ?? '—'}</td>
                    </tr>
                  )) : (
                    <tr><td colSpan={12} className="px-6 py-10 text-center text-gray-400 dark:text-gray-500 text-sm">No customer data available</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════ DELIVERIES TAB ══════════════ */}
      {activeTab === 'deliveries' && (
        <div className="space-y-4">
          {/* Compact strip — Cureer style */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {[
              { label: 'Total', value: filteredDeliveries.length, icon: Package, color: 'blue' },
              { label: 'Delivered', value: filteredDeliveries.filter(d => ['delivered','delivered-with-installation','delivered-without-installation'].includes((d.status||'').toLowerCase())).length, icon: CheckCircle, color: 'green' },
              { label: 'Pending', value: filteredDeliveries.filter(d => ['pending','scheduled'].includes((d.status||'').toLowerCase())).length, icon: Clock, color: 'yellow' },
            ].map(({ label, value, icon: Icon, color }) => {
              const c = KPI_COLOR_MAP[color];
              return (
                <div key={label} className="bg-white dark:bg-gray-800 rounded-lg border border-gray-100 dark:border-gray-700 shadow-sm p-3 flex items-center gap-3">
                  <div className={`p-2 rounded-lg ${c.bg}`}><Icon className={`w-4 h-4 ${c.icon}`} /></div>
                  <div>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
                    <p className={`text-lg font-bold ${c.val}`}>{value}</p>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Two-column: Table | Side widgets */}
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            <div className="xl:col-span-2">
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-100 dark:border-gray-700 shadow-sm overflow-hidden">
          {/* Filter bar */}
          <div className="px-3 sm:px-5 py-4 border-b border-gray-100 dark:border-gray-700 flex flex-wrap gap-2 items-center">
                  <input
                    type="text"
                    placeholder="Search PO number, customer, address..."
                    value={deliverySearch}
                    onChange={e => { setDeliverySearch(e.target.value); setDeliveryPage(0); }}
              className="flex-1 min-w-0 sm:min-w-[140px] md:min-w-[200px] px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
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
              className="ml-auto flex-shrink-0 flex items-center gap-2 px-4 py-2 text-sm bg-primary-600 hover:bg-primary-700 text-white rounded-lg transition-colors shadow-sm"
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
                                      void loadDashboardData();
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
                <button disabled={deliveryPage === 0} onClick={() => { setDeliveryPage(p => p - 1); deliveryTableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}
                  className="px-3 py-1.5 border border-gray-200 dark:border-gray-600 rounded-md disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-gray-700 dark:text-gray-300">← Prev</button>
                <span className="px-3 text-gray-600 dark:text-gray-400">{deliveryPage + 1} / {totalPages}</span>
                <button disabled={deliveryPage >= totalPages - 1} onClick={() => { setDeliveryPage(p => p + 1); deliveryTableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}
                  className="px-3 py-1.5 border border-gray-200 dark:border-gray-600 rounded-md disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-gray-700 dark:text-gray-300">Next →</button>
              </div>
            </div>
          )}
        </div>
            </div>

            {/* Side widgets */}
            <div className="space-y-4">
              <div className="bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 rounded-lg border border-blue-100 dark:border-blue-800 p-4">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3">Needs Attention</h3>
                <div className="space-y-2">
                  <button onClick={() => { setDeliveryAttentionFilter('overdue'); setDeliveryStatusFilter('pending'); setDeliveryPage(0); }} className="w-full flex justify-between items-center p-2 rounded-lg bg-white/80 dark:bg-gray-800/80 hover:bg-white dark:hover:bg-gray-800 text-left cursor-pointer">
                    <span className="text-sm text-gray-700 dark:text-gray-300">Overdue</span>
                    <span className="font-bold text-amber-600">{actionItems.overdue}</span>
                  </button>
                  <button onClick={() => { setDeliveryAttentionFilter('unassigned'); setDeliveryStatusFilter('pending'); setDeliveryPage(0); }} className="w-full flex justify-between items-center p-2 rounded-lg bg-white/80 dark:bg-gray-800/80 hover:bg-white dark:hover:bg-gray-800 text-left cursor-pointer">
                    <span className="text-sm text-gray-700 dark:text-gray-300">Unassigned</span>
                    <span className="font-bold text-orange-600">{actionItems.unassigned}</span>
                  </button>
                  <button onClick={() => { setDeliveryAttentionFilter('awaiting'); setDeliveryStatusFilter('pending'); setDeliveryPage(0); }} className="w-full flex justify-between items-center p-2 rounded-lg bg-white/80 dark:bg-gray-800/80 hover:bg-white dark:hover:bg-gray-800 text-left cursor-pointer">
                    <span className="text-sm text-gray-700 dark:text-gray-300">Awaiting confirmation</span>
                    <span className="font-bold text-purple-600">{actionItems.unconfirmed}</span>
                  </button>
                </div>
              </div>
              <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-100 dark:border-gray-700 p-4">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-2">Quick Stats</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400">Filtered: {filteredDeliveries.length} deliveries</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Cancelled: {filteredDeliveries.filter(d => (d.status||'').toLowerCase() === 'cancelled').length}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════ BY AREA TAB ══════════════ */}
      {activeTab === 'by-area' && (
        <div className="space-y-4">
          {/* KPI strip — original + extra */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
            {[
              { label: 'Areas', value: deliveryByAreaData.length, icon: MapPin, color: 'blue' },
              { label: 'Total Deliveries', value: deliveryByAreaData.reduce((s,r)=>s+(r.count||0),0), icon: Package, color: 'indigo' },
              { label: 'Top Area', value: deliveryByAreaData[0]?.area || '—', icon: Target, color: 'emerald' },
              { label: 'Share', value: deliveryByAreaData[0] && deliveryByAreaData.reduce((s,r)=>s+(r.count||0),0) > 0 ? `${((deliveryByAreaData[0].count/deliveryByAreaData.reduce((s,r)=>s+(r.count||0),0))*100).toFixed(0)}%` : '—', icon: TrendingUp, color: 'yellow' },
              { label: 'Top Area Share', value: `${areaKpis.topShare.toFixed(1)}%`, icon: Target, color: 'blue', tooltip: 'Top area deliveries as % of total' },
              { label: 'Avg Area Success', value: `${areaKpis.avgSuccess.toFixed(1)}%`, icon: CheckCircle, color: 'green', tooltip: 'Average success rate across areas' },
              { label: 'Worst Area', value: areaKpis.worstArea?.area ?? '—', icon: AlertCircle, color: 'red', tooltip: 'Area with lowest success rate' },
              { label: 'Largest Backlog', value: areaKpis.largestBacklog?.area ?? '—', icon: Clock, color: 'yellow', tooltip: 'Area with most pending deliveries' },
            ].map(({ label, value, icon: Icon, color, tooltip }) => {
              const c = KPI_COLOR_MAP[color];
              return (
                <div key={label} className="bg-white dark:bg-gray-800 rounded-lg border border-gray-100 dark:border-gray-700 shadow-sm p-3 flex items-center gap-3">
                  <div className={`p-2 rounded-lg ${c.bg}`}><Icon className={`w-4 h-4 ${c.icon}`} /></div>
                  <div className="min-w-0">
                    <p className="text-xs text-gray-500 dark:text-gray-400 truncate flex items-center gap-1">
                      {tooltip ? <MetricTooltip term={label} definition={tooltip} /> : label}
                    </p>
                    <p className={`text-sm font-bold ${c.val} truncate`}>{value}</p>
                  </div>
                </div>
              );
            })}
          </div>

          {/* ~40% chart + matrix | ~60% map */}
          <div className="grid grid-cols-1 xl:grid-cols-5 gap-4 items-start">
            <div className="xl:col-span-2 flex flex-col gap-4 min-w-0">
              <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-100 dark:border-gray-700 shadow-sm p-6">
                <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                  <div>
                    <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Deliveries by Area</h2>
                    <p className="pp-page-subtitle">Showing top {chartTopN} areas by volume</p>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-gray-500 dark:text-gray-400">Show top</span>
                    <select value={chartTopN} onChange={e => setChartTopN(Number(e.target.value))}
                      className="px-3 py-1.5 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-sm">
                      {[5, 10, 15, 20].map(n => <option key={n} value={n}>{n} areas</option>)}
                    </select>
                  </div>
                </div>
                {deliveryByAreaEnhanced.length > 0 ? (
                  <ResponsiveContainer width="100%" height={Math.max(220, deliveryByAreaEnhanced.length * 38)}>
                    <BarChart data={deliveryByAreaEnhanced} layout="vertical" margin={{ left: 10, right: 50, top: 5, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" horizontal={false} />
                      <XAxis type="number" tick={{ fontSize: 11, fill: '#6b7280' }} tickLine={false} axisLine={false} />
                      <YAxis type="category" dataKey="area" width={130} tick={{ fontSize: 12, fill: '#374151' }} tickLine={false} axisLine={false} />
                      <Tooltip contentStyle={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', fontSize: '12px' }} />
                      <Bar dataKey="count" name="Deliveries" radius={[0, 4, 4, 0]} fill="#2563EB" isAnimationActive />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="text-center py-12 text-gray-400 dark:text-gray-500 text-sm">No area data available</p>
                )}
              </div>

              {deliveryByAreaEnhanced.length > 0 && (
                <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-100 dark:border-gray-700 shadow-sm p-4">
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-2">Area Performance Matrix</h3>
                  <p className="text-[10px] text-gray-400 mb-2">Deliveries (x) vs Success % (y), bubble size = pending</p>
                  <ResponsiveContainer width="100%" height={220}>
                    <ScatterChart margin={{ top: 5, right: 10, bottom: 5, left: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis type="number" dataKey="count" name="Deliveries" tick={{ fontSize: 9 }} tickLine={false} />
                      <YAxis type="number" dataKey="successRate" name="Success %" domain={[0, 100]} tick={{ fontSize: 9 }} tickLine={false} />
                      <ZAxis type="number" dataKey="pending" range={[60, 400]} name="Pending" />
                      <Tooltip cursor={{ strokeDasharray: '3 3' }} contentStyle={{ fontSize: '11px' }} formatter={(val: number, name: string) => [name === 'successRate' ? `${val}%` : val, name]} />
                      <Scatter
                        data={deliveryByAreaEnhanced.map(r => ({ ...r, pending: Math.max(r.pending ?? 0, 1) }))}
                        fill="#2563EB"
                        fillOpacity={0.7}
                      />
                    </ScatterChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            {deliveryByAreaEnhanced.length > 0 && (() => {
              const totalDel = deliveryByAreaEnhanced.reduce((s, x) => s + x.count, 0);
              const maxCount = Math.max(...deliveryByAreaEnhanced.map(r => r.count || 0), 1);
              const mapPoints = deliveryByAreaEnhanced
                .map(r => {
                  const key = Object.keys(DUBAI_AREA_COORDS).find(k =>
                    r.area?.toLowerCase().includes(k.toLowerCase()) ||
                    k.toLowerCase().includes((r.area || '').toLowerCase())
                  ) || 'Other';
                  return { ...r, coords: DUBAI_AREA_COORDS[key] || DUBAI_AREA_COORDS['Other'] };
                })
                .filter(r => r.coords);
              return (
                <div className="xl:col-span-3 bg-white dark:bg-gray-800 rounded-lg border border-gray-100 dark:border-gray-700 shadow-sm p-6 min-h-0">
                  <div className="mb-3">
                    <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Delivery Hotspot Map — Dubai</h2>
                    <p className="pp-page-subtitle">Circle size = delivery volume · Hover for share %, pending, success</p>
                  </div>
                  <div className="h-[min(70vh,560px)] min-h-[380px] sm:min-h-[440px] rounded-xl overflow-hidden">
                    <MapContainer center={[25.2, 55.27]} zoom={11} style={{ height: '100%', width: '100%' }} scrollWheelZoom={false}>
                      <TileLayer
                        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                      />
                      {mapPoints.map((r, i) => {
                        const radius = 8 + (r.count / maxCount) * 32;
                        const fillColor = r.count === maxCount ? '#1d4ed8' : r.count / maxCount > 0.5 ? '#2563EB' : '#60a5fa';
                        const share = totalDel > 0 ? ((r.count / totalDel) * 100).toFixed(1) : '0';
                        return (
                          <CircleMarker
                            key={r.area || i}
                            center={r.coords}
                            radius={radius}
                            pathOptions={{ fillColor, color: '#fff', weight: 1.5, fillOpacity: 0.8 }}
                          >
                            <MapTooltip permanent={false} direction="top" offset={[0, -radius]}>
                              <span style={{ fontWeight: 600 }}>{r.area}</span>
                              <br />
                              <span>{r.count} deliveries ({share}%)</span>
                              <br />
                              <span>Pending: {r.pending ?? 0} · Success: {(r.successRate ?? 0).toFixed(1)}%</span>
                            </MapTooltip>
                            <Popup>
                              <strong>{r.area}</strong><br />
                              {r.count} deliveries ({share}% of total)<br />
                              Pending: {r.pending ?? 0} · Success: {(r.successRate ?? 0).toFixed(1)}%
                            </Popup>
                          </CircleMarker>
                        );
                      })}
                    </MapContainer>
                  </div>
                  <div className="flex flex-wrap gap-3 mt-3 text-xs text-gray-500 dark:text-gray-400">
                    <span className="flex items-center gap-1.5"><span style={{ width: 10, height: 10, borderRadius: '50%', background: '#1d4ed8', display: 'inline-block' }} /> Highest volume</span>
                    <span className="flex items-center gap-1.5"><span style={{ width: 10, height: 10, borderRadius: '50%', background: '#2563EB', display: 'inline-block' }} /> Medium volume</span>
                    <span className="flex items-center gap-1.5"><span style={{ width: 10, height: 10, borderRadius: '50%', background: '#60a5fa', display: 'inline-block' }} /> Lower volume</span>
                    <span className="ml-auto italic">Click a circle for details • Scroll or pinch to zoom</span>
                  </div>
                </div>
              );
            })()}
          </div>

          {/* Area table — full width, expanded */}
          {deliveryByAreaEnhanced.length > 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-100 dark:border-gray-700 shadow-sm overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Area Detail</h3>
                <button
                  onClick={() => exportCSV(deliveryByAreaEnhanced as unknown as Record<string, unknown>[], ['area', 'count', 'pending', 'delivered', 'successRate'], 'area-deliveries')}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                >
                  <Download className="w-3.5 h-3.5" /> Export
                </button>
              </div>
              <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead className="bg-gray-50 dark:bg-gray-700/50">
                  <tr>
                    <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase text-left w-12">#</th>
                    <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase text-left">Area</th>
                    <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase text-right">Deliveries</th>
                    <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase text-right">Share %</th>
                    <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase text-right">Pending</th>
                    <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase text-right">Success %</th>
                    <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase text-center">Risk</th>
                    </tr>
                  </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {deliveryByAreaEnhanced.map((row, i) => {
                    const total = deliveryByAreaEnhanced.reduce((s, r) => s + r.count, 0);
                    const share = total > 0 ? ((row.count / total) * 100).toFixed(1) : '0';
                    const risk = riskFromSuccessRate(row.successRate ?? 0);
                    return (
                      <tr key={row.area || i} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                        <td className="px-4 py-3 text-sm text-gray-400 dark:text-gray-500">{i + 1}</td>
                        <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-gray-100">
                          <span className="flex items-center gap-2"><MapPin className="w-3.5 h-3.5 text-gray-400" />{row.area}</span>
                        </td>
                        <td className="px-4 py-3 text-sm text-right font-bold text-primary-600 dark:text-primary-400">{row.count}</td>
                        <td className="px-4 py-3 text-sm text-right text-gray-600 dark:text-gray-400">{share}%</td>
                        <td className="px-4 py-3 text-sm text-right text-yellow-600 dark:text-yellow-400">{row.pending ?? 0}</td>
                        <td className="px-4 py-3 text-sm text-right">
                          <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${(row.successRate ?? 0) >= 80 ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : (row.successRate ?? 0) >= 50 ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'}`}>
                            {(row.successRate ?? 0).toFixed(1)}%
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-center">
                          <RiskBadge level={risk} />
                        </td>
                      </tr>
                    );
                  })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ══════════════ BY PRODUCT TAB ══════════════ */}
      {activeTab === 'by-product' && (
        <div className="space-y-4">
          {/* KPI strip — original + extra */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
            {[
              { label: 'Top Items', value: topItemsData.length, icon: FileText, color: 'blue' },
              { label: 'Total Qty', value: topItemsData.reduce((s,r)=>s+(r.count||0),0), icon: Package, color: 'indigo' },
              { label: 'Top Item', value: topItemsData[0]?.item?.slice(0, 20) || '—', icon: Target, color: 'emerald' },
              { label: 'Count', value: topItemsData[0]?.count ?? '—', icon: TrendingUp, color: 'yellow' },
              { label: 'Top SKU Share', value: `${productKpis.top1Share.toFixed(1)}%`, icon: Target, color: 'blue', tooltip: 'Top SKU volume as % of total' },
              { label: 'Top 3 SKU Share', value: `${productKpis.top3Share.toFixed(1)}%`, icon: TrendingUp, color: 'indigo', tooltip: 'Top 3 SKUs combined share' },
              { label: 'Concentration', value: productKpis.concentration, icon: Package, color: 'emerald', tooltip: 'Product concentration level (High/Medium/Low)' },
              { label: 'DQ Issues', value: productKpis.dqIssues, icon: AlertCircle, color: 'red', tooltip: 'Items with missing PNC or description' },
            ].map(({ label, value, icon: Icon, color, tooltip }) => {
              const c = KPI_COLOR_MAP[color];
              return (
                <div key={label} className="bg-white dark:bg-gray-800 rounded-lg border border-gray-100 dark:border-gray-700 shadow-sm p-3 flex items-center gap-3">
                  <div className={`p-2 rounded-lg ${c.bg}`}><Icon className={`w-4 h-4 ${c.icon}`} /></div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-gray-500 dark:text-gray-400 truncate flex items-center gap-1">
                      {tooltip ? <MetricTooltip term={label} definition={tooltip} /> : label}
                    </p>
                    <p className={`text-sm font-bold ${c.val} truncate`}>{value}</p>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Filter bar */}
          <div className="flex flex-wrap gap-2 items-center">
            <input
              type="text"
              placeholder="Search item name, PNC, or model..."
              value={topItemsSearch}
              onChange={e => setTopItemsSearch(e.target.value)}
              className="flex-1 min-w-0 sm:min-w-[140px] md:min-w-[200px] px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
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

          {/* ~40% charts | ~60% table */}
          <div className="grid grid-cols-1 xl:grid-cols-5 gap-4 items-start">
            <div className="xl:col-span-2 flex flex-col gap-4 min-w-0">
              {topItemsData.length > 0 ? (
                <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-100 dark:border-gray-700 shadow-sm p-6">
                  <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-4">Top Items by Quantity + Cumulative Share</h2>
                  <ResponsiveContainer width="100%" height={Math.max(200, Math.min(topItemsData.length * 40, 400))}>
                    <ComposedChart
                      data={topItemsData.map((r, i) => {
                        const total = topItemsData.reduce((s, x) => s + (x.count ?? 0), 0);
                        const cum = topItemsData.slice(0, i + 1).reduce((s, x) => s + (x.count ?? 0), 0);
                        return { ...r, label: `${(r.item || '').slice(0, 24)}${(r.item || '').length > 24 ? '…' : ''}`, count: r.count, cumPct: total > 0 ? sharePct(cum, total) : 0 };
                      })}
                      layout="vertical"
                      margin={{ left: 10, right: 50, top: 5, bottom: 5 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" horizontal={false} />
                      <XAxis type="number" tick={{ fontSize: 11, fill: '#6b7280' }} tickLine={false} axisLine={false} />
                      <YAxis type="category" dataKey="label" width={180} tick={{ fontSize: 10, fill: '#374151' }} tickLine={false} axisLine={false} />
                      <YAxis type="number" yAxisId="pct" orientation="right" domain={[0, 100]} tick={{ fontSize: 9, fill: '#9ca3af' }} tickFormatter={v => `${v}%`} width={45} tickLine={false} axisLine={false} />
                      <Tooltip contentStyle={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', fontSize: '12px' }} formatter={(val: number, name: string, props: { payload?: { cumPct?: number } }) => (name === 'Cum. Share' ? [`${(props?.payload?.cumPct ?? val).toFixed(1)}%`, name] : [val, name])} />
                      <Legend wrapperStyle={{ fontSize: '12px' }} />
                      <Bar dataKey="count" fill="#2563EB" radius={[0, 4, 4, 0]} name="Quantity" isAnimationActive />
                      <Line type="monotone" dataKey="cumPct" name="Cum. Share" stroke="#f59e0b" strokeWidth={2} strokeDasharray="4 4" dot={{ r: 2 }} yAxisId="pct" isAnimationActive />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-100 dark:border-gray-700 shadow-sm p-6">
                  <p className="text-center py-8 text-gray-400 dark:text-gray-500 text-sm">No product data available</p>
                </div>
              )}

              {topItemsData.length > 0 && (
                <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-100 dark:border-gray-700 shadow-sm p-4">
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-2">Product Portfolio Matrix</h3>
                  <p className="text-[10px] text-gray-400 mb-2">Volume (x) vs Share % (y)</p>
                  <ResponsiveContainer width="100%" height={200}>
                    <ScatterChart margin={{ top: 5, right: 10, bottom: 5, left: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis type="number" dataKey="count" name="Volume" tick={{ fontSize: 9 }} tickLine={false} />
                      <YAxis type="number" dataKey="sharePct" name="Share %" tick={{ fontSize: 9 }} tickLine={false} />
                      <Tooltip cursor={{ strokeDasharray: '3 3' }} contentStyle={{ fontSize: '11px' }} formatter={(val: number, name: string) => [name === 'sharePct' ? `${val}%` : val, name]} />
                      <Scatter
                        data={topItemsData.map((r) => {
                          const total = topItemsData.reduce((s, x) => s + (x.count ?? 0), 0);
                          return { count: r.count ?? 0, sharePct: total > 0 ? sharePct(r.count ?? 0, total) : 0, name: r.item };
                        })}
                        fill="#2563EB"
                        fillOpacity={0.7}
                      />
                    </ScatterChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            <div className="xl:col-span-3 bg-white dark:bg-gray-800 rounded-lg border border-gray-100 dark:border-gray-700 shadow-sm overflow-hidden min-w-0">
            <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Item Detail</h3>
              <button onClick={() => exportCSV(topItemsTableData as unknown as Record<string, unknown>[], ['item', 'pnc', 'modelId', 'count', 'sharePct'], 'top-items')}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                <Download className="w-3.5 h-3.5" /> Export
              </button>
            </div>
            <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead className="bg-gray-50 dark:bg-gray-700/50">
                <tr>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase text-left w-12">#</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase text-left">Item Name</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase text-left">PNC</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase text-left">Model ID</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase text-right">Orders</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase text-right">
                    <MetricTooltip term="Share %" definition="Item volume as % of total" />
                  </th>
                  </tr>
                </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {topItemsTableData.length > 0 ? topItemsTableData.map((row, idx) => (
                  <tr key={idx} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    <td className="px-4 py-3 text-sm text-gray-400 dark:text-gray-500">{idx + 1}</td>
                    <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-gray-100">{row.item}</td>
                    <td className="px-4 py-3 text-sm font-mono text-gray-600 dark:text-gray-400">{row.pnc}</td>
                    <td className="px-4 py-3 text-sm font-mono text-gray-500 dark:text-gray-500">{row.modelId || '—'}</td>
                    <td className="px-4 py-3 text-sm text-right font-bold text-primary-600 dark:text-primary-400">{row.count}</td>
                    <td className="px-4 py-3 text-sm text-right text-gray-600 dark:text-gray-400">{row.sharePct?.toFixed(1) ?? '—'}%</td>
                  </tr>
                )) : (
                  <tr><td colSpan={6} className="px-6 py-10 text-center text-gray-400 dark:text-gray-500 text-sm">No product data available</td></tr>
                )}
              </tbody>
            </table>
            </div>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════ DRIVERS TAB ══════════════ */}
      {activeTab === 'drivers' && (
        <div className="space-y-4">
          {/* Driver KPIs — compact strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Total Drivers', value: drivers.length, icon: Users, color: 'blue' },
              { label: 'Online', value: driversData.filter(d => onlineUserIds.has(String(d.id))).length, icon: CheckCircle, color: 'green' },
              { label: 'Offline', value: driversData.filter(d => !onlineUserIds.has(String(d.id))).length, icon: Clock, color: 'yellow' },
              { label: 'On Route', value: drivers.filter(d => d.tracking?.status === 'in_progress').length, icon: Truck, color: 'indigo' },
            ].map(({ label, value, icon: Icon, color }) => {
              const c = KPI_COLOR_MAP[color];
              return (
                <div key={label} className="bg-white dark:bg-gray-800 rounded-lg border border-gray-100 dark:border-gray-700 shadow-sm p-3 flex items-center gap-3">
                  <div className={`p-2 rounded-lg ${c.bg}`}><Icon className={`w-4 h-4 ${c.icon}`} /></div>
                  <div>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
                    <p className={`text-lg font-bold ${c.val}`}>{value}</p>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Two-column: Table | Performance widget */}
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            <div className="xl:col-span-2">
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-100 dark:border-gray-700 shadow-sm overflow-hidden">
            {/* Filter bar */}
            <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700 flex flex-wrap gap-2 items-center">
              <input type="text" placeholder="Search name or email..." value={driversSearch}
                onChange={e => setDriversSearch(e.target.value)}
                className="flex-1 min-w-0 sm:min-w-[140px] md:min-w-[180px] px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500" />
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
            <div className="overflow-x-auto">
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
            </div>

            {/* Performance analytics — charts from delivery data */}
            <div className="space-y-4">
              <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-100 dark:border-gray-700 shadow-sm p-4">
                <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">Workload</h4>
                <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-2">Assigned deliveries by driver (top 8)</p>
                {driverPanelAnalytics.workloadBars.length === 0 ? (
                  <p className="text-center text-xs text-gray-400 dark:text-gray-500 py-10">No driver-assigned deliveries in current data.</p>
                ) : (
                  <ResponsiveContainer width="100%" height={Math.min(320, 48 + driverPanelAnalytics.workloadBars.length * 36)}>
                    <BarChart
                      layout="vertical"
                      data={driverPanelAnalytics.workloadBars}
                      margin={{ top: 4, right: 12, left: 4, bottom: 4 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" horizontal={false} />
                      <XAxis type="number" tick={{ fontSize: 10, fill: '#6b7280' }} allowDecimals={false} />
                      <YAxis type="category" dataKey="name" width={92} tick={{ fontSize: 10, fill: '#6b7280' }} />
                      <Tooltip
                        contentStyle={{ backgroundColor: 'var(--surface, white)', border: '1px solid var(--border, #e5e7eb)', borderRadius: '8px', fontSize: '11px' }}
                        formatter={(v: number) => [`${v}`, 'Assigned']}
                      />
                      <Bar dataKey="count" fill="#2563eb" radius={[0, 4, 4, 0]} maxBarSize={18} name="Assigned" />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>

              <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-100 dark:border-gray-700 shadow-sm p-4">
                <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">Outcomes</h4>
                <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-2">Status mix for driver-assigned deliveries only</p>
                {!driverPanelAnalytics.hasAssignments ? (
                  <p className="text-center text-xs text-gray-400 dark:text-gray-500 py-10">No assigned deliveries to analyze.</p>
                ) : driverPanelAnalytics.outcomesPie.length === 0 ? (
                  <p className="text-center text-xs text-gray-400 dark:text-gray-500 py-10">No outcome data.</p>
                ) : (
                  <ResponsiveContainer width="100%" height={220}>
                    <PieChart>
                      <Pie
                        data={driverPanelAnalytics.outcomesPie}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        innerRadius="52%"
                        outerRadius="78%"
                        paddingAngle={2}
                        labelLine={false}
                        label={(props: PieLabelRenderProps) => {
                          const p = Number(props.percent ?? 0);
                          return Number.isFinite(p) && p >= 0.06
                            ? `${Math.round(p * 100)}%`
                            : '';
                        }}
                      >
                        {driverPanelAnalytics.outcomesPie.map((entry, i) => (
                          <Cell key={i} fill={entry.fill} stroke="var(--background, #fff)" strokeWidth={1} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{ backgroundColor: 'var(--surface, white)', border: '1px solid var(--border, #e5e7eb)', borderRadius: '8px', fontSize: '11px' }}
                        formatter={(v: number, name: string) => [v, name]}
                      />
                      <Legend wrapperStyle={{ fontSize: '11px' }} />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delivery Detail Modal */}
      <DeliveryDetailModal
        delivery={selectedDelivery as unknown as import('../types').Delivery & Record<string, unknown>}
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setSelectedDelivery(null);
          clearDeliveryQuery();
        }}
        onStatusUpdate={(deliveryId: string, newStatus: string) => {
          setDeliveries(prev => prev.map(d =>
            (d.id === deliveryId || d.ID === deliveryId) ? { ...d, status: newStatus } : d
          ));
          setIsModalOpen(false);
          setSelectedDelivery(null);
          clearDeliveryQuery();
          void loadDashboardData();
        }}
      />
      </div>{/* end tab-enter wrapper */}
    </div>
  );
}
