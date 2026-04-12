import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import api, { setAuthToken } from '../frontend/apiClient';
import { BarChart, Bar, LabelList, ComposedChart, XAxis, YAxis, ZAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid, Line, AreaChart, Area, PieChart, Pie, Cell, ReferenceLine, ScatterChart, Scatter, type PieLabelRenderProps } from 'recharts';
import { 
  Package, CheckCircle, XCircle, Clock, MapPin, Users, Activity, 
  Truck, AlertCircle, FileText, Target, TrendingUp, MessageSquare,
  ChevronUp, ChevronDown, ChevronRight, RefreshCw, Download, ArrowUpRight, Filter, RotateCcw
} from 'lucide-react';
import RiskBadge, { riskFromSuccessRate } from '../components/Analytics/RiskBadge';
import MetricTooltip from '../components/Analytics/MetricTooltip';
import { sharePct, topNSharePct, concentrationLevel } from '../utils/analyticsHelpers';
import { useNavigate, useLocation } from 'react-router-dom';
import DeliveryDetailModal from '../components/DeliveryDetailModal';
import { MapContainer, TileLayer, CircleMarker, Tooltip as MapTooltip, Popup } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import type { Driver } from '../types';
import PaginationBar from '../components/common/PaginationBar';
import { excludeTeamPortalGarbageDeliveries } from '../utils/deliveryListFilter';
import type { Delivery } from '../types';
import { deliveryToManageOrder } from '../utils/deliveryWorkflowMap';

/**
 * Visual language follows PolicyPilot-style dashboards (airy cards, pill controls, blue accent).
 * @see https://dribbble.com/shots/26062430-PolicyPilot-Auto-Insurance-Dashboard-Design
 */

/** Recharts default tooltip — theme via --chart-* in index.css (:root / .dark) */
const RECHARTS_TOOLTIP = {
  wrapperStyle: { zIndex: 9999, outline: 'none' },
  contentStyle: {
    backgroundColor: 'var(--chart-tooltip-bg)',
    border: '1px solid var(--chart-tooltip-border)',
    borderRadius: '12px',
    fontSize: '13px',
    color: 'var(--chart-tooltip-fg)',
    padding: '10px 14px',
    minWidth: '130px',
    boxShadow: '0 8px 24px -4px rgba(0,0,0,0.18), 0 2px 8px -2px rgba(0,0,0,0.12)',
  },
  labelStyle: { color: 'var(--chart-tooltip-fg)', fontWeight: 600 as const, marginBottom: '4px' },
  itemStyle: { color: 'var(--chart-tooltip-fg)', fontSize: '13px', padding: '2px 0' },
};
const RECHARTS_TOOLTIP_12 = {
  ...RECHARTS_TOOLTIP,
  contentStyle: { ...RECHARTS_TOOLTIP.contentStyle, fontSize: '13px' },
};
/** Overview hero chart tooltip */
const RECHARTS_TOOLTIP_OVERVIEW = {
  ...RECHARTS_TOOLTIP,
  contentStyle: {
    ...RECHARTS_TOOLTIP.contentStyle,
  },
};

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

/** Minimal delivery record returned by /admin/dashboard for chart computations. */
interface DashboardDelivery {
  id?: string;
  customer?: string | null;
  poNumber?: string | null;
  status?: string;
  created_at?: string | Date | null;
  createdAt?: string | Date | null;
  created?: string | Date | null;
  delivered_at?: string | Date | null;
  deliveredAt?: string | Date | null;
  address?: string;
  metadata?: Record<string, unknown>;
  assignedDriverId?: string | null;
  driverName?: string | null;
  confirmationStatus?: string;
  customerConfirmedAt?: string | null;
  confirmedDeliveryDate?: string | Date | null;
  [key: string]: unknown;
}

interface DashboardData {
  totals?: DashboardTotals;
  analytics?: DashboardAnalytics;
  deliveries?: DashboardDelivery[];
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

/** Same workflow labels as Delivery / Logistics portals (ManageTab / deliveryToManageOrder). */
function adminDeliveriesWorkflowBadge(d: Record<string, unknown>): { label: string; pillClass: string } {
  const ws = deliveryToManageOrder(d as unknown as Delivery).status;
  const label =
    ws === 'delivered' ? 'Delivered' :
    ws === 'out_for_delivery' ? 'On Route' :
    ws === 'tomorrow_shipment' ? 'Tomorrow Shipment' :
    ws === 'next_shipment' ? 'Next Shipment' :
    ws === 'future_shipment' ? 'Future Shipment' :
    ws === 'order_delay' ? 'Order Delay' :
    ws === 'sms_sent' ? 'Awaiting Customer' :
    ws === 'unconfirmed' ? 'No Response (24h+)' :
    ws === 'confirmed' ? 'Confirmed' :
    ws === 'rescheduled' ? 'Rescheduled' :
    ws === 'failed' ? 'Failed / Returned' :
    ws === 'cancelled' ? 'Cancelled' :
    ws === 'uploaded' ? 'Pending Order' :
    'Pending Order';
  const pillClass =
    ws === 'order_delay' ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300' :
    ws === 'out_for_delivery' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300' :
    ws === 'unconfirmed' ? 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300' :
    ws === 'sms_sent' ? 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300' :
    ws === 'delivered' ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' :
    ws === 'cancelled' || ws === 'failed' ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300' :
    ws === 'tomorrow_shipment' || ws === 'next_shipment' || ws === 'future_shipment'
      ? 'bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-300' :
    'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300';
  return { label, pillClass };
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
  // 'rescheduled' is intentionally excluded — it is an active pending order, not terminal.
  // Any order that is not delivered/cancelled/returned still needs to be fulfilled.
  return ['cancelled', 'rejected', 'returned'].includes(s);
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

/** Max buckets for daily granularity (guards very wide custom ranges). */
const TREND_BUCKET_MAX = 200;

interface TrendBucketsConfig {
  buckets: Array<{ key: string; label: string; day?: string }>;
  rangeStart: Date;
  rangeEnd: Date;
}

/** Build time buckets + inclusive date bounds for trend charts (custom range or default sliding windows). */
function buildTrendBucketsAndRange(
  period: 'day' | 'month' | 'year',
  fromStr: string,
  toStr: string
): TrendBucketsConfig {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  let rangeStart: Date;
  let rangeEnd: Date;
  const custom = Boolean(fromStr || toStr);

  if (custom) {
    const from = fromStr ? new Date(fromStr + 'T00:00:00') : new Date(2000, 0, 1);
    const to = toStr ? new Date(toStr + 'T23:59:59.999') : now;
    rangeStart = from;
    rangeEnd = to;
    if (rangeStart.getTime() > rangeEnd.getTime()) {
      const a = rangeStart.getTime();
      const b = rangeEnd.getTime();
      rangeStart = new Date(Math.min(a, b));
      rangeStart.setHours(0, 0, 0, 0);
      rangeEnd = new Date(Math.max(a, b));
      rangeEnd.setHours(23, 59, 59, 999);
    }
  } else if (period === 'day') {
    rangeEnd = new Date(now);
    rangeEnd.setHours(23, 59, 59, 999);
    rangeStart = new Date(now);
    rangeStart.setDate(rangeStart.getDate() - 6);
    rangeStart.setHours(0, 0, 0, 0);
  } else if (period === 'month') {
    rangeStart = new Date(now.getFullYear(), now.getMonth() - 11, 1);
    rangeEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  } else {
    rangeStart = new Date(now.getFullYear() - 4, 0, 1);
    rangeEnd = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
  }

  const buckets: TrendBucketsConfig['buckets'] = [];
  if (period === 'day') {
    const d = new Date(rangeStart);
    d.setHours(0, 0, 0, 0);
    const endDay = new Date(rangeEnd);
    endDay.setHours(0, 0, 0, 0);
    let guard = 0;
    while (d.getTime() <= endDay.getTime() && guard < TREND_BUCKET_MAX) {
      buckets.push({
        key: d.toISOString().slice(0, 10),
        label: d.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' }),
        day: d.toLocaleDateString('en-GB', { weekday: 'short' }),
      });
      d.setDate(d.getDate() + 1);
      guard++;
    }
  } else if (period === 'month') {
    let d = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), 1);
    const endM = new Date(rangeEnd.getFullYear(), rangeEnd.getMonth(), 1);
    let guard = 0;
    while (d.getTime() <= endM.getTime() && guard < TREND_BUCKET_MAX) {
      buckets.push({
        key: `${d.getFullYear()}-${pad(d.getMonth() + 1)}`,
        label: d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }),
      });
      d.setMonth(d.getMonth() + 1);
      guard++;
    }
  } else {
    let y = rangeStart.getFullYear();
    const yEnd = rangeEnd.getFullYear();
    let guard = 0;
    while (y <= yEnd && guard < TREND_BUCKET_MAX) {
      buckets.push({ key: String(y), label: String(y) });
      y++;
      guard++;
    }
  }

  return { buckets, rangeStart, rangeEnd };
}

function deliveryCreatedInTrendRange(t: unknown, rangeStart: Date, rangeEnd: Date): boolean {
  if (!t) return false;
  const dt = new Date(t as string | number);
  return dt.getTime() >= rangeStart.getTime() && dt.getTime() <= rangeEnd.getTime();
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
  /** When true, period pills are hidden (use global Trends filter instead). */
  hidePeriodFilter?: boolean;
}

/** Estimate chart card content width from viewport — used as seed so the chart
 *  renders immediately without waiting for DOM measurement (which can fail on
 *  mobile when the CSS grid hasn't committed its track widths yet). */
function estimateCardWidth(): number {
  if (typeof window === 'undefined') return 320;
  const vw = window.innerWidth;
  // app-main has 16px padding each side; pp-dash-card.p-5 gets 14px !important on ≤640px
  // Grid: grid-cols-1 on <768, md:grid-cols-2 on <1024, lg:grid-cols-3 on ≥1024
  if (vw < 768)  return Math.max(200, vw - 60);             // 1-col: full width − margins
  if (vw < 1024) return Math.max(200, Math.floor((vw - 80) / 2));  // 2-col
  return Math.max(200, Math.floor((vw - 100) / 3));         // 3-col
}

function TrendChartCard({ title, subtitle, period, onPeriodChange, data, dataKey, xKey, chartType, barColor = '#2563EB', nameKey = 'name', targetValue, hidePeriodFilter = false }: TrendChartCardProps): React.ReactElement {
  // Seed width from viewport estimate so Recharts v3 renders immediately on first paint.
  // A ResizeObserver refines to the actual container width after layout.
  const [cw, setCw] = React.useState<number>(estimateCardWidth);
  const cardRoRef = React.useRef<ResizeObserver | null>(null);
  const wrapRef = React.useCallback((el: HTMLDivElement | null) => {
    if (cardRoRef.current) { cardRoRef.current.disconnect(); cardRoRef.current = null; }
    if (!el) return;
    const update = () => { const w = el.getBoundingClientRect().width; if (w > 0) setCw(Math.round(w)); };
    update();
    cardRoRef.current = new ResizeObserver(update);
    cardRoRef.current.observe(el);
  }, []);

  const FilterBtns = () => (
    <div className="inline-flex p-1 rounded-xl bg-gray-100/90 dark:bg-slate-700/45 gap-0.5 text-xs font-medium">
      {(['day', 'month', 'year'] as const).map(p => (
        <button
          key={p}
          type="button"
          onClick={() => onPeriodChange(p)}
          className={`px-3 py-1.5 rounded-lg capitalize transition-all ${
            period === p
              ? 'bg-white dark:bg-slate-800 text-blue-600 dark:text-blue-400 shadow-sm font-semibold'
              : 'text-gray-600 dark:text-gray-400 hover:bg-white/70 dark:hover:bg-slate-600/40'
          }`}
        >
          {p === 'day' ? 'Daily' : p === 'month' ? 'Monthly' : 'Yearly'}
        </button>
      ))}
    </div>
  );
  const d = data as Record<string, unknown>[];
  const hasData = d.length > 0;

  const renderChart = (width: number): React.ReactNode => {
    if (!hasData) return null;
    if (chartType === 'line') {
      return (
        <ResponsiveContainer width="100%" height={220} initialDimension={{ width: width, height: 220 }}>
          <ComposedChart data={d} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
            <XAxis dataKey={xKey} tick={{ fontSize: 10, fill: 'var(--chart-tick)' }} tickLine={false} axisLine={false} />
            <YAxis tick={{ fontSize: 10, fill: 'var(--chart-tick)' }} tickLine={false} axisLine={false} domain={dataKey === 'rate' ? [0, 100] : undefined} unit={dataKey === 'rate' ? '%' : undefined} />
            <Tooltip {...RECHARTS_TOOLTIP} formatter={dataKey === 'rate' ? (val: number) => [`${val}%`, 'Success Rate'] : undefined} />
            <Line type="monotone" dataKey={dataKey || 'count'} stroke={barColor} strokeWidth={2} dot={{ r: 3 }} fill="transparent" isAnimationActive />
          </ComposedChart>
        </ResponsiveContainer>
      );
    }
    if (chartType === 'area') {
      return (
        <ResponsiveContainer width="100%" height={220} initialDimension={{ width: width, height: 220 }}>
          <AreaChart data={d} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
            <defs>
              <linearGradient id={`areaGrad-${title.replace(/\s/g, '')}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={barColor} stopOpacity={0.4} />
                <stop offset="95%" stopColor={barColor} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
            <XAxis dataKey={xKey} tick={{ fontSize: 10, fill: 'var(--chart-tick)' }} tickLine={false} axisLine={false} />
            <YAxis tick={{ fontSize: 10, fill: 'var(--chart-tick)' }} tickLine={false} axisLine={false} />
            <Tooltip {...RECHARTS_TOOLTIP} />
            <Area type="monotone" dataKey={dataKey || 'count'} stroke={barColor} fill={`url(#areaGrad-${title.replace(/\s/g, '')})`} strokeWidth={2} isAnimationActive />
          </AreaChart>
        </ResponsiveContainer>
      );
    }
    if (chartType === 'stacked-area') {
      return (
        <ResponsiveContainer width="100%" height={220} initialDimension={{ width: width, height: 220 }}>
          <AreaChart data={d} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
            <XAxis dataKey={xKey} tick={{ fontSize: 10, fill: 'var(--chart-tick)' }} tickLine={false} axisLine={false} />
            <YAxis tick={{ fontSize: 10, fill: 'var(--chart-tick)' }} tickLine={false} axisLine={false} />
            <Tooltip {...RECHARTS_TOOLTIP} />
            <Legend wrapperStyle={{ fontSize: '10px', color: 'var(--chart-legend)' }} />
            <Area type="monotone" dataKey="delivered" stackId="1" stroke="#059669" fill="#059669" fillOpacity={0.6} name="Delivered" isAnimationActive />
            <Area type="monotone" dataKey="pending" stackId="1" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.6} name="Pending" isAnimationActive />
            <Area type="monotone" dataKey="cancelled" stackId="1" stroke="#dc2626" fill="#dc2626" fillOpacity={0.6} name="Cancelled" isAnimationActive />
          </AreaChart>
        </ResponsiveContainer>
      );
    }
    if (chartType === 'stacked-bar') {
      return (
        <ResponsiveContainer width="100%" height={220} initialDimension={{ width: width, height: 220 }}>
          <BarChart data={d} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
            <XAxis dataKey={xKey} tick={{ fontSize: 10, fill: 'var(--chart-tick)' }} tickLine={false} axisLine={false} />
            <YAxis tick={{ fontSize: 10, fill: 'var(--chart-tick)' }} tickLine={false} axisLine={false} />
            <Tooltip {...RECHARTS_TOOLTIP} />
            <Legend wrapperStyle={{ fontSize: '10px', color: 'var(--chart-legend)' }} />
            <Bar dataKey="delivered" stackId="a" fill="#059669" name="Delivered" radius={[0, 0, 0, 0]} isAnimationActive />
            <Bar dataKey="pending" stackId="a" fill="#f59e0b" name="Pending" radius={[0, 0, 0, 0]} isAnimationActive />
            <Bar dataKey="cancelled" stackId="a" fill="#dc2626" name="Cancelled" radius={[0, 0, 0, 0]} isAnimationActive />
          </BarChart>
        </ResponsiveContainer>
      );
    }
    if (chartType === 'bar') {
      return (
        <ResponsiveContainer width="100%" height={220} initialDimension={{ width: width, height: 220 }}>
          <BarChart data={d} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
            <XAxis dataKey={xKey} tick={{ fontSize: 10, fill: 'var(--chart-tick)' }} tickLine={false} axisLine={false} />
            <YAxis tick={{ fontSize: 10, fill: 'var(--chart-tick)' }} tickLine={false} axisLine={false} />
            <Tooltip {...RECHARTS_TOOLTIP} />
            <Bar dataKey={dataKey || 'count'} fill={barColor} radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive />
          </BarChart>
        </ResponsiveContainer>
      );
    }
    if (chartType === 'bar-h') {
      return (
        <ResponsiveContainer width="100%" height={220} initialDimension={{ width: width, height: 220 }}>
          <BarChart data={d} layout="vertical" margin={{ top: 5, right: 30, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 10, fill: 'var(--chart-tick)' }} tickLine={false} axisLine={false} />
            <YAxis type="category" dataKey={xKey} width={80} tick={{ fontSize: 10, fill: 'var(--chart-tick-emphasis)' }} tickLine={false} axisLine={false} />
            <Tooltip {...RECHARTS_TOOLTIP} />
            <Bar dataKey={dataKey || 'count'} fill={barColor} radius={[0, 4, 4, 0]} maxBarSize={16} isAnimationActive />
          </BarChart>
        </ResponsiveContainer>
      );
    }
    if (chartType === 'demand-ma') {
      return (
        <ResponsiveContainer width="100%" height={220} initialDimension={{ width: width, height: 220 }}>
          <ComposedChart data={d} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
            <XAxis dataKey={xKey} tick={{ fontSize: 10, fill: 'var(--chart-tick)' }} tickLine={false} axisLine={false} />
            <YAxis tick={{ fontSize: 10, fill: 'var(--chart-tick)' }} tickLine={false} axisLine={false} />
            <Tooltip {...RECHARTS_TOOLTIP} />
            <Legend wrapperStyle={{ fontSize: '10px', color: 'var(--chart-legend)' }} />
            <Bar dataKey="count" fill="#2563EB" radius={[4, 4, 0, 0]} maxBarSize={24} name="Requests" isAnimationActive />
            <Line type="monotone" dataKey="ma" stroke="#f59e0b" strokeWidth={2} strokeDasharray="4 4" dot={{ r: 2 }} name="Moving Avg" isAnimationActive />
          </ComposedChart>
        </ResponsiveContainer>
      );
    }
    if (chartType === 'fulfillment') {
      return (
        <ResponsiveContainer width="100%" height={220} initialDimension={{ width: width, height: 220 }}>
          <BarChart data={d} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
            <XAxis dataKey={xKey} tick={{ fontSize: 10, fill: 'var(--chart-tick)' }} tickLine={false} axisLine={false} />
            <YAxis tick={{ fontSize: 10, fill: 'var(--chart-tick)' }} tickLine={false} axisLine={false} />
            <Tooltip {...RECHARTS_TOOLTIP} />
            <Legend wrapperStyle={{ fontSize: '10px', color: 'var(--chart-legend)' }} />
            <Bar dataKey="created" fill="#3b82f6" radius={[0, 0, 0, 0]} maxBarSize={28} name="Created" isAnimationActive />
            <Bar dataKey="delivered" fill="#059669" radius={[0, 0, 0, 0]} maxBarSize={28} name="Delivered" isAnimationActive />
            <Bar dataKey="pendingActive" fill="#f59e0b" radius={[0, 0, 0, 0]} maxBarSize={28} name="Pending" isAnimationActive />
            <Bar dataKey="cancelled" fill="#dc2626" radius={[0, 0, 0, 0]} maxBarSize={28} name="Cancelled" isAnimationActive />
          </BarChart>
        </ResponsiveContainer>
      );
    }
    if (chartType === 'success-target' && targetValue != null) {
      return (
        <ResponsiveContainer width="100%" height={220} initialDimension={{ width: width, height: 220 }}>
          <ComposedChart data={d} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
            <XAxis dataKey={xKey} tick={{ fontSize: 10, fill: 'var(--chart-tick)' }} tickLine={false} axisLine={false} />
            <YAxis tick={{ fontSize: 10, fill: 'var(--chart-tick)' }} tickLine={false} axisLine={false} domain={[0, 100]} unit="%" />
            <Tooltip {...RECHARTS_TOOLTIP} formatter={(val: number) => [`${val}%`, 'Success Rate']} />
            <ReferenceLine y={targetValue} stroke="#dc2626" strokeDasharray="4 4" strokeWidth={1.5} />
            <Line type="monotone" dataKey="rate" stroke="#059669" strokeWidth={2} dot={{ r: 3 }} name="Success Rate" isAnimationActive />
          </ComposedChart>
        </ResponsiveContainer>
      );
    }
    if (chartType === 'lead-time') {
      return (
        <ResponsiveContainer width="100%" height={220} initialDimension={{ width: width, height: 220 }}>
          <ComposedChart data={d} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
            <XAxis dataKey={xKey} tick={{ fontSize: 10, fill: 'var(--chart-tick)' }} tickLine={false} axisLine={false} />
            <YAxis tick={{ fontSize: 10, fill: 'var(--chart-tick)' }} tickLine={false} axisLine={false} unit="h" />
            <Tooltip {...RECHARTS_TOOLTIP} />
            <Legend wrapperStyle={{ fontSize: '10px', color: 'var(--chart-legend)' }} />
            <Line type="monotone" dataKey="medianHours" stroke="#2563EB" strokeWidth={2} dot={{ r: 3 }} name="Median (h)" isAnimationActive />
            <Line type="monotone" dataKey="p90Hours" stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="4 4" dot={{ r: 2 }} name="P90 (h)" isAnimationActive />
          </ComposedChart>
        </ResponsiveContainer>
      );
    }
    if (chartType === 'backlog') {
      return (
        <ResponsiveContainer width="100%" height={220} initialDimension={{ width: width, height: 220 }}>
          <AreaChart data={d} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
            <defs>
              <linearGradient id={`backlogGrad-${title.replace(/\s/g, '')}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.4} />
                <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
            <XAxis dataKey={xKey} tick={{ fontSize: 10, fill: 'var(--chart-tick)' }} tickLine={false} axisLine={false} />
            <YAxis tick={{ fontSize: 10, fill: 'var(--chart-tick)' }} tickLine={false} axisLine={false} />
            <Tooltip {...RECHARTS_TOOLTIP} />
            <Area type="monotone" dataKey="open" stroke="#8b5cf6" fill={`url(#backlogGrad-${title.replace(/\s/g, '')})`} strokeWidth={2} name="Open orders" isAnimationActive />
          </AreaChart>
        </ResponsiveContainer>
      );
    }
    if (chartType === 'status-mix-100') {
      return (
        <ResponsiveContainer width="100%" height={220} initialDimension={{ width: width, height: 220 }}>
          <AreaChart data={d} margin={{ top: 5, right: 10, left: 0, bottom: 5 }} stackOffset="expand">
            <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
            <XAxis dataKey={xKey} tick={{ fontSize: 10, fill: 'var(--chart-tick)' }} tickLine={false} axisLine={false} />
            <YAxis tick={{ fontSize: 10, fill: 'var(--chart-tick)' }} tickLine={false} axisLine={false} domain={[0, 100]} unit="%" tickFormatter={(v) => `${v}%`} />
            <Tooltip {...RECHARTS_TOOLTIP} formatter={(val: number) => [`${Number(val).toFixed(1)}%`, undefined]} />
            <Legend wrapperStyle={{ fontSize: '10px', color: 'var(--chart-legend)' }} />
            <Area type="monotone" dataKey="deliveredPct" stackId="1" stroke="#059669" fill="#059669" fillOpacity={0.6} name="Delivered" isAnimationActive />
            <Area type="monotone" dataKey="pendingPct" stackId="1" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.6} name="Pending" isAnimationActive />
            <Area type="monotone" dataKey="cancelledPct" stackId="1" stroke="#dc2626" fill="#dc2626" fillOpacity={0.6} name="Cancelled" isAnimationActive />
          </AreaChart>
        </ResponsiveContainer>
      );
    }
    if (chartType === 'areas-stacked') {
      const topKeys = (d[0] ? Object.keys(d[0]).filter(k => !['key', 'label', 'day'].includes(k) && typeof (d[0] as Record<string, unknown>)[k] === 'number') : []) as string[];
      return (
        <ResponsiveContainer width="100%" height={220} initialDimension={{ width: width, height: 220 }}>
          <AreaChart data={d} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
            <XAxis dataKey={xKey} tick={{ fontSize: 10, fill: 'var(--chart-tick)' }} tickLine={false} axisLine={false} />
            <YAxis tick={{ fontSize: 10, fill: 'var(--chart-tick)' }} tickLine={false} axisLine={false} />
            <Tooltip {...RECHARTS_TOOLTIP} />
            <Legend wrapperStyle={{ fontSize: '10px', color: 'var(--chart-legend)' }} />
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
        <ResponsiveContainer width="100%" height={220} initialDimension={{ width: width, height: 220 }}>
          <BarChart data={d} layout="vertical" margin={{ top: 5, right: 30, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 10, fill: 'var(--chart-tick)' }} tickLine={false} axisLine={false} />
            <YAxis type="category" dataKey={xKey} width={90} tick={{ fontSize: 9, fill: 'var(--chart-tick-emphasis)' }} tickLine={false} axisLine={false} />
            <Tooltip {...RECHARTS_TOOLTIP} />
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
        <ResponsiveContainer width="100%" height={220} initialDimension={{ width: width, height: 220 }}>
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
            <Tooltip {...RECHARTS_TOOLTIP} formatter={(val: number, name: string) => [val, name]} />
          </PieChart>
        </ResponsiveContainer>
      );
    }
    return null;
  };

  return (
    <div className="pp-dash-card p-5 min-w-0">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex items-start gap-2">
          <div>
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100 tracking-tight truncate">{title}</h2>
            <p className="pp-page-subtitle text-xs mt-0.5 leading-relaxed line-clamp-2">{subtitle}</p>
          </div>
        </div>
        {!hidePeriodFilter && <FilterBtns />}
      </div>
      <div style={{ width: '100%', height: 220, minHeight: 220 }}>
        {hasData
          ? renderChart(cw)
          : <p className="text-center py-10 text-gray-400 dark:text-gray-500 text-xs">No data available</p>
        }
      </div>
    </div>
  );
}

function PeakHeatmapCard({ data, title, subtitle }: { data: number[][]; title: string; subtitle: string }): React.ReactElement {
  const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const maxVal = Math.max(1, ...data.flat());
  const getOpacity = (v: number) => (maxVal > 0 ? 0.25 + 0.75 * (v / maxVal) : 0);

  return (
    <div className="pp-dash-card p-5">
      <div className="flex items-start justify-between gap-2 mb-3">
        <div>
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100 tracking-tight truncate">{title}</h2>
          <p className="pp-page-subtitle text-xs mt-0.5 leading-relaxed line-clamp-2">{subtitle}</p>
        </div>
      </div>
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
                        style={{ backgroundColor: v > 0 ? `rgba(37, 99, 235, ${op})` : 'var(--heatmap-empty)' }}
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
  // Hero chart seed width — used only as initialDimension so Recharts v3 renders on first paint.
  // ResponsiveContainer with width="100%" uses its own ResizeObserver to measure the actual size.
  const heroCw = useState<number>(() => {
    if (typeof window === 'undefined') return 320;
    const vw = window.innerWidth;
    return Math.max(200, vw < 1280 ? vw - 60 : Math.floor((vw - 100) * 2 / 3));
  })[0];

  const [data, setData] = useState<DashboardData | null>(null);
  const [drivers, setDrivers] = useState<AdminDriver[]>([]);
  const [deliveries, setDeliveries] = useState<TrackingDelivery[]>([]);
  // Full history (all statuses, last 90 days) from /admin/dashboard — used for chart computations.
  // Tracking API returns only active deliveries (for live map), so charts must use this separate list.
  const [dashboardDeliveries, setDashboardDeliveries] = useState<DashboardDelivery[]>([]);
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
  const [responseFilter, setResponseFilter] = useState<'Confirmed' | 'Rescheduled' | 'Cancelled' | null>(null);
  const responseDetailRef = useRef<HTMLDivElement>(null);
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
  const [topCustomersMinOrders, setTopCustomersMinOrders] = useState<string>('');
  const [topCustomersMinSuccess, setTopCustomersMinSuccess] = useState<string>('');
  const [topCustomersRiskFilter, setTopCustomersRiskFilter] = useState<string>('all');

  const [topItemsSearch, setTopItemsSearch] = useState<string>('');
  const [topItemsSortBy, setTopItemsSortBy] = useState<string>('count');
  const [topItemsSortDir, setTopItemsSortDir] = useState<string>('desc');
  const [topItemsMinQty, setTopItemsMinQty] = useState<string>('');

  const [chartTopN, setChartTopN] = useState<number>(10);

  const [driversSearch, setDriversSearch] = useState<string>('');
  const [driversStatusFilter, setDriversStatusFilter] = useState<string>('all');
  const [driversSortBy, setDriversSortBy] = useState<string>('name');
  const [driversSortDir, setDriversSortDir] = useState<string>('asc');

  const [heroPeriod, setHeroPeriod] = useState<string>('30d');
  const [trendsGlobalPeriod, setTrendsGlobalPeriod] = useState<'day' | 'month' | 'year'>('month');
  const [trendsRangeFrom, setTrendsRangeFrom] = useState<string>('');
  const [trendsRangeTo, setTrendsRangeTo] = useState<string>('');
  // Tracks which preset pill is highlighted; cleared on manual range/period change
  const [trendsActivePreset, setTrendsActivePreset] = useState<string>('default');

  const trendsBucketsConfig = useMemo(
    () => buildTrendBucketsAndRange(trendsGlobalPeriod, trendsRangeFrom, trendsRangeTo),
    [trendsGlobalPeriod, trendsRangeFrom, trendsRangeTo]
  );

  const fmtYmd = useCallback((d: Date): string => {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }, []);

  const applyTrendPreset = useCallback((preset: string): void => {
    const now = new Date();
    setTrendsActivePreset(preset);
    if (preset === 'default') {
      setTrendsRangeFrom(''); setTrendsRangeTo(''); setTrendsGlobalPeriod('month'); return;
    }
    if (preset === 'last7') {
      setTrendsRangeFrom(fmtYmd(new Date(now.getTime() - 6 * 86400000)));
      setTrendsRangeTo(fmtYmd(now)); setTrendsGlobalPeriod('day'); return;
    }
    if (preset === 'last30') {
      setTrendsRangeFrom(fmtYmd(new Date(now.getTime() - 29 * 86400000)));
      setTrendsRangeTo(fmtYmd(now)); setTrendsGlobalPeriod('day'); return;
    }
    if (preset === 'thisMonth') {
      setTrendsRangeFrom(fmtYmd(new Date(now.getFullYear(), now.getMonth(), 1)));
      setTrendsRangeTo(fmtYmd(now)); setTrendsGlobalPeriod('day'); return;
    }
    if (preset === 'lastMonth') {
      setTrendsRangeFrom(fmtYmd(new Date(now.getFullYear(), now.getMonth() - 1, 1)));
      setTrendsRangeTo(fmtYmd(new Date(now.getFullYear(), now.getMonth(), 0)));
      setTrendsGlobalPeriod('day'); return;
    }
    if (preset === 'last90') {
      setTrendsRangeFrom(fmtYmd(new Date(now.getTime() - 89 * 86400000)));
      setTrendsRangeTo(fmtYmd(now)); setTrendsGlobalPeriod('month'); return;
    }
    if (preset === 'last6m') {
      setTrendsRangeFrom(fmtYmd(new Date(now.getFullYear(), now.getMonth() - 5, 1)));
      setTrendsRangeTo(fmtYmd(now)); setTrendsGlobalPeriod('month'); return;
    }
    if (preset === 'thisYear') {
      setTrendsRangeFrom(fmtYmd(new Date(now.getFullYear(), 0, 1)));
      setTrendsRangeTo(fmtYmd(now)); setTrendsGlobalPeriod('month'); return;
    }
    if (preset === 'lastYear') {
      setTrendsRangeFrom(fmtYmd(new Date(now.getFullYear() - 1, 0, 1)));
      setTrendsRangeTo(fmtYmd(new Date(now.getFullYear() - 1, 11, 31)));
      setTrendsGlobalPeriod('month'); return;
    }
    if (preset === 'allTime') {
      setTrendsRangeFrom(''); setTrendsRangeTo(''); setTrendsGlobalPeriod('year'); return;
    }
  }, [fmtYmd]);

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
        const dashData = dashboardResp.value.data as DashboardData;
        setData(dashData);
        setDashboardDeliveries(dashData.deliveries || []);
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

  const portalOperationalDeliveries = useMemo(
    () =>
      excludeTeamPortalGarbageDeliveries(
        deliveries as unknown as Record<string, unknown>[]
      ) as unknown as TrackingDelivery[],
    [deliveries]
  );

  /** Same counting rules as DeliveryTeamPortal "Needs Attention" + On Route / Delay. */
  const deliveriesTabWorkflowStats = useMemo(() => {
    const list = portalOperationalDeliveries;
    const orders = list.map(d => ({ order: deliveryToManageOrder(d as unknown as Delivery) }));
    const TERMINAL = new Set(['delivered', 'cancelled', 'failed']);
    const pendingOrders = orders.filter(({ order }) => !TERMINAL.has(order.status)).length;
    const noResponse = orders.filter(({ order }) => order.status === 'unconfirmed').length;
    const onRoute = orders.filter(({ order }) => order.status === 'out_for_delivery').length;
    const orderDelay = orders.filter(({ order }) => order.status === 'order_delay').length;
    const delivered = orders.filter(({ order }) => order.status === 'delivered').length;
    return { pendingOrders, noResponse, onRoute, orderDelay, delivered, total: list.length };
  }, [portalOperationalDeliveries]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const deliveryId = params.get('delivery');
    if (!deliveryId || portalOperationalDeliveries.length === 0) return;
    const match = portalOperationalDeliveries.find(d => String(d.id || d.ID) === String(deliveryId));
    if (match) { setSelectedDelivery(match); setIsModalOpen(true); }
  }, [location.search, portalOperationalDeliveries]);

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
    const list = dashboardDeliveries && Array.isArray(dashboardDeliveries) ? dashboardDeliveries : [];
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
      { id: 'pending', label: 'Pending Orders', value: totals.pending, icon: Clock, color: 'yellow', delta: null },
      { id: 'cancelled', label: 'Cancelled', value: totals.cancelled, icon: XCircle, color: 'red', delta: null },
      { id: 'rate', label: 'Success Rate', value: `${successRate}%`, icon: Target, color: 'emerald', delta: null },
    ];
  }, [dashboardDeliveries, totals]);

  const actionItems = useMemo(() => {
    const list = dashboardDeliveries && Array.isArray(dashboardDeliveries) ? dashboardDeliveries : [];
    const dayAgo = new Date(Date.now() - 86400000);
    const overdue = list.filter(d => {
      const s = (d.status || '').toLowerCase();
      return ['pending', 'scheduled'].includes(s) && new Date(d.created_at || d.createdAt || d.created || 0) < dayAgo;
    }).length;
    const unassigned = list.filter(d => {
      const s = (d.status || '').toLowerCase();
      return ['pending', 'scheduled'].includes(s) && !d.assignedDriverId;
    }).length;
    const unconfirmed = list.filter(d => {
      const s = (d.status || '').toLowerCase();
      const conf = String(d.confirmationStatus || '').toLowerCase();
      return ['pending', 'scheduled'].includes(s) && conf !== 'confirmed' && !d.customerConfirmedAt;
    }).length;
    return { overdue, unassigned, unconfirmed };
  }, [dashboardDeliveries]);

  const heroChartData = useMemo(() => {
    const list = dashboardDeliveries && Array.isArray(dashboardDeliveries) ? dashboardDeliveries : [];
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
  }, [dashboardDeliveries, heroPeriod]);

  const areaKeywords = useMemo(() => [
    'Marina', 'Jumeirah', 'Jebel Ali', 'Business Bay', 'Downtown', 'Deira', 'Bur Dubai',
    'Silicon Oasis', 'Motor City', 'Arabian Ranches', 'The Springs', 'Palm', 'Al Barsha',
    'Al Quoz', 'JLT', 'DIFC', 'Karama', 'Satwa', 'Oud Metha', 'Mirdif', 'Dubai Hills'
  ], []);

  const trend1DeliveryRequests = useMemo(() => {
    const list = dashboardDeliveries && Array.isArray(dashboardDeliveries) ? dashboardDeliveries : [];
    const { buckets: baseBuckets, rangeStart, rangeEnd } = trendsBucketsConfig;
    const buckets = baseBuckets.map(b => ({ ...b, count: 0 }));
    const bucketMap = Object.fromEntries(buckets.map((b, i) => [b.key, i]));
    list.forEach(d => {
      const t = d.created_at || d.createdAt || d.created;
      if (!t || !deliveryCreatedInTrendRange(t, rangeStart, rangeEnd)) return;
      const dt = new Date(t as string | number);
      const key = trendsGlobalPeriod === 'day' ? dt.toISOString().slice(0, 10) : trendsGlobalPeriod === 'month' ? `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}` : String(dt.getFullYear());
      const i = bucketMap[key];
      if (i !== undefined) buckets[i].count++;
    });
    const windowSize = trendsGlobalPeriod === 'day' ? 7 : trendsGlobalPeriod === 'month' ? 4 : 3;
    return buckets.map((b, i) => {
      const start = Math.max(0, i - windowSize + 1);
      const slice = buckets.slice(start, i + 1);
      const sum = slice.reduce((s, x) => s + x.count, 0);
      const ma = slice.length > 0 ? parseFloat((sum / slice.length).toFixed(1)) : 0;
      return { label: (b as { day?: string }).day ?? b.label, ...b, ma };
    });
  }, [dashboardDeliveries, trendsGlobalPeriod, trendsBucketsConfig]);

  const trend2Fulfillment = useMemo(() => {
    const list = dashboardDeliveries && Array.isArray(dashboardDeliveries) ? dashboardDeliveries : [];
    const isDelivered = (s: string) => ['delivered', 'delivered-with-installation', 'delivered-without-installation'].includes((s || '').toLowerCase());
    const isCancelled = (s: string) => ['cancelled', 'rejected', 'returned'].includes((s || '').toLowerCase());
    const { buckets: baseBuckets, rangeStart, rangeEnd } = trendsBucketsConfig;
    const buckets = baseBuckets.map(b => ({ ...b, created: 0, delivered: 0, pendingActive: 0, cancelled: 0 }));
    const bucketMap = Object.fromEntries(buckets.map((b, i) => [b.key, i]));
    list.forEach(d => {
      const t = d.created_at || d.createdAt || d.created;
      if (!t || !deliveryCreatedInTrendRange(t, rangeStart, rangeEnd)) return;
      const dt = new Date(t as string | number);
      const key = trendsGlobalPeriod === 'day' ? dt.toISOString().slice(0, 10) : trendsGlobalPeriod === 'month' ? `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}` : String(dt.getFullYear());
      const i = bucketMap[key];
      if (i === undefined) return;
      buckets[i].created++;
      const s = (d.status || '').toLowerCase();
      if (isDelivered(s)) buckets[i].delivered++;
      else if (isCancelled(s)) buckets[i].cancelled++;
      else buckets[i].pendingActive++;
    });
    return buckets.map(b => ({ label: (b as { day?: string }).day ?? b.label, ...b }));
  }, [dashboardDeliveries, trendsGlobalPeriod, trendsBucketsConfig]);

  const trend3SuccessRate = useMemo(() => {
    const list = dashboardDeliveries && Array.isArray(dashboardDeliveries) ? dashboardDeliveries : [];
    const isDelivered = (s: string) => ['delivered', 'delivered-with-installation', 'delivered-without-installation'].includes((s || '').toLowerCase());
    const { buckets: baseBuckets, rangeStart, rangeEnd } = trendsBucketsConfig;
    const buckets = baseBuckets.map(b => ({ ...b, total: 0, delivered: 0, rate: 0 }));
    const bucketMap = Object.fromEntries(buckets.map((b, i) => [b.key, i]));
    list.forEach(d => {
      const t = d.created_at || d.createdAt || d.created;
      if (!t || !deliveryCreatedInTrendRange(t, rangeStart, rangeEnd)) return;
      const dt = new Date(t as string | number);
      const key = trendsGlobalPeriod === 'day' ? dt.toISOString().slice(0, 10) : trendsGlobalPeriod === 'month' ? `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}` : String(dt.getFullYear());
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
  }, [dashboardDeliveries, trendsGlobalPeriod, trendsBucketsConfig]);

  const trend4LeadTime = useMemo(() => {
    const list = dashboardDeliveries && Array.isArray(dashboardDeliveries) ? dashboardDeliveries : [];
    const isDelivered = (s: string) => ['delivered', 'delivered-with-installation', 'delivered-without-installation'].includes((s || '').toLowerCase());
    const { buckets: baseBuckets, rangeStart, rangeEnd } = trendsBucketsConfig;
    const buckets = baseBuckets.map(b => ({ ...b, leadTimes: [] as number[] }));
    const bucketMap = Object.fromEntries(buckets.map((b, i) => [b.key, i]));
    list.forEach(d => {
      if (!isDelivered(d.status || '')) return;
      const created = d.created_at || d.createdAt || d.created;
      const delivered = d.delivered_at || d.deliveredAt || created;
      if (!created || !delivered) return;
      if (!deliveryCreatedInTrendRange(created, rangeStart, rangeEnd)) return;
      const createdDt = new Date(created as string | number);
      const deliveredDt = new Date(delivered as string | number);
      const hours = (deliveredDt.getTime() - createdDt.getTime()) / (1000 * 60 * 60);
      const key = trendsGlobalPeriod === 'day' ? deliveredDt.toISOString().slice(0, 10) : trendsGlobalPeriod === 'month' ? `${deliveredDt.getFullYear()}-${String(deliveredDt.getMonth() + 1).padStart(2, '0')}` : String(deliveredDt.getFullYear());
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
  }, [dashboardDeliveries, trendsGlobalPeriod, trendsBucketsConfig]);

  const trend5Backlog = useMemo(() => {
    const list = dashboardDeliveries && Array.isArray(dashboardDeliveries) ? dashboardDeliveries : [];
    const isOpen = (s: string) => ['pending', 'scheduled', 'scheduled-confirmed', 'out-for-delivery', 'in-progress', 'assigned'].includes((s || '').toLowerCase());
    const { buckets: baseBuckets, rangeStart, rangeEnd } = trendsBucketsConfig;
    const buckets = baseBuckets.map(b => ({ ...b, open: 0 }));
    const bucketMap = Object.fromEntries(buckets.map((b, i) => [b.key, i]));
    list.forEach(d => {
      if (!isOpen(d.status || '')) return;
      const t = d.created_at || d.createdAt || d.created;
      if (!t || !deliveryCreatedInTrendRange(t, rangeStart, rangeEnd)) return;
      const dt = new Date(t as string | number);
      const key = trendsGlobalPeriod === 'day' ? dt.toISOString().slice(0, 10) : trendsGlobalPeriod === 'month' ? `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}` : String(dt.getFullYear());
      const i = bucketMap[key];
      if (i !== undefined) buckets[i].open++;
    });
    return buckets.map(b => ({ label: (b as { day?: string }).day ?? b.label, ...b }));
  }, [dashboardDeliveries, trendsGlobalPeriod, trendsBucketsConfig]);

  const trend6StatusMix100 = useMemo(() => {
    const list = dashboardDeliveries && Array.isArray(dashboardDeliveries) ? dashboardDeliveries : [];
    const { buckets: baseBuckets, rangeStart, rangeEnd } = trendsBucketsConfig;
    const buckets = baseBuckets.map(b => ({ ...b, delivered: 0, pending: 0, cancelled: 0 }));
    const bucketMap = Object.fromEntries(buckets.map((b, i) => [b.key, i]));
    list.forEach(d => {
      const t = d.created_at || d.createdAt || d.created;
      if (!t || !deliveryCreatedInTrendRange(t, rangeStart, rangeEnd)) return;
      const dt = new Date(t as string | number);
      const key = trendsGlobalPeriod === 'day' ? dt.toISOString().slice(0, 10) : trendsGlobalPeriod === 'month' ? `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}` : String(dt.getFullYear());
      const i = bucketMap[key];
      if (i !== undefined) {
        const s = (d.status || '').toLowerCase();
        if (['delivered', 'delivered-with-installation', 'delivered-without-installation'].includes(s)) buckets[i].delivered++;
        else if (['cancelled', 'rejected', 'returned'].includes(s)) buckets[i].cancelled++;
        else buckets[i].pending++;
      }
    });
    return buckets.map(b => {
      const total = b.delivered + b.pending + b.cancelled;
      const toPct = (v: number) => total > 0 ? parseFloat(((v / total) * 100).toFixed(1)) : 0;
      return {
        label: (b as { day?: string }).day ?? b.label,
        ...b,
        deliveredPct: toPct(b.delivered),
        pendingPct: toPct(b.pending),
        cancelledPct: toPct(b.cancelled)
      };
    });
  }, [dashboardDeliveries, trendsGlobalPeriod, trendsBucketsConfig]);

  const trend7Heatmap = useMemo(() => {
    const list = dashboardDeliveries && Array.isArray(dashboardDeliveries) ? dashboardDeliveries : [];
    const grid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
    const { rangeStart, rangeEnd } = trendsBucketsConfig;
    const customRange = Boolean(trendsRangeFrom || trendsRangeTo);
    const start = customRange ? rangeStart : new Date(Date.now() - 30 * 86400000);
    const end = customRange ? rangeEnd : new Date();
    list.forEach(d => {
      const t = d.created_at || d.createdAt || d.created;
      if (!t) return;
      const dt = new Date(t as string | number);
      if (dt < start || dt > end) return;
      const day = dt.getDay();
      const hour = dt.getHours();
      grid[day][hour]++;
    });
    return grid;
  }, [dashboardDeliveries, trendsBucketsConfig, trendsRangeFrom, trendsRangeTo]);

  const trend5TopItems = useMemo(() => {
    const list = dashboardDeliveries && Array.isArray(dashboardDeliveries) ? dashboardDeliveries : [];
    const { rangeStart, rangeEnd } = trendsBucketsConfig;
    const inRange = (t: unknown) => deliveryCreatedInTrendRange(t, rangeStart, rangeEnd);
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
  }, [dashboardDeliveries, trendsBucketsConfig]);

  const trend6TopAreas = useMemo(() => {
    const list = dashboardDeliveries && Array.isArray(dashboardDeliveries) ? dashboardDeliveries : [];
    const { rangeStart, rangeEnd } = trendsBucketsConfig;
    const inRange = (t: unknown) => deliveryCreatedInTrendRange(t, rangeStart, rangeEnd);
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
  }, [dashboardDeliveries, trendsBucketsConfig, areaKeywords]);

  const trend8AreasStacked = useMemo(() => {
    const list = dashboardDeliveries && Array.isArray(dashboardDeliveries) ? dashboardDeliveries : [];
    const { buckets: baseBuckets, rangeStart, rangeEnd } = trendsBucketsConfig;
    const buckets = baseBuckets.map(b => ({ ...b } as Record<string, unknown>));
    const bucketMap = Object.fromEntries(buckets.map((b, i) => [b.key as string, i]));
    const allAreas: Record<string, number> = {};
    list.forEach(d => {
      const t0 = d.created_at || d.createdAt || d.created;
      if (!t0 || !deliveryCreatedInTrendRange(t0, rangeStart, rangeEnd)) return;
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
      if (!t || !deliveryCreatedInTrendRange(t, rangeStart, rangeEnd)) return;
      const dt = new Date(t as string | number);
      const key = trendsGlobalPeriod === 'day' ? dt.toISOString().slice(0, 10) : trendsGlobalPeriod === 'month' ? `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}` : String(dt.getFullYear());
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
  }, [dashboardDeliveries, trendsGlobalPeriod, trendsBucketsConfig, areaKeywords]);

  const filteredDeliveries = useMemo<TrackingDelivery[]>(() => {
    // Same list as Delivery / Logistics portals: /admin/tracking/deliveries + garbage filter (not dashboard 90d merge).
    const list = portalOperationalDeliveries.slice();
    const dir = deliverySortDir === 'asc' ? 1 : -1;
    list.sort((a, b) => {
      if (deliverySortBy === 'customer') return dir * (a.customer || '').toLowerCase().localeCompare((b.customer || '').toLowerCase());
      if (deliverySortBy === 'status') {
        const wa = deliveryToManageOrder(a as unknown as Delivery).status;
        const wb = deliveryToManageOrder(b as unknown as Delivery).status;
        return dir * wa.localeCompare(wb);
      }
      if (deliverySortBy === 'poNumber') return dir * String(a.poNumber || '').localeCompare(String(b.poNumber || ''));
      return dir * (new Date(a.created_at || a.createdAt || 0).getTime() - new Date(b.created_at || b.createdAt || 0).getTime());
    });
    const dayAgo = new Date(Date.now() - 86400000);
    return list.filter(d => {
      const q = deliverySearch.trim().toLowerCase();
      if (q && !((d.poNumber || '').toLowerCase().includes(q) || (d.customer || '').toLowerCase().includes(q) || (d.address || '').toLowerCase().includes(q) || String(d.id || '').toLowerCase().includes(q))) return false;
      if (deliveryStatusFilter !== 'all') {
        const wf = deliveryToManageOrder(d as unknown as Delivery).status;
        if (deliveryStatusFilter === 'wf:unconfirmed') {
          if (wf !== 'unconfirmed') return false;
        } else if (deliveryStatusFilter === 'wf:order_delay') {
          if (wf !== 'order_delay') return false;
        } else if (deliveryStatusFilter === 'wf:out_for_delivery') {
          if (wf !== 'out_for_delivery') return false;
        } else {
          const s = (d.status || '').toLowerCase();
          if (deliveryStatusFilter === 'pending') {
            if (s !== 'pending' && s !== 'uploaded') return false;
          } else {
            if (s !== deliveryStatusFilter) return false;
          }
        }
      }
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
        const dt = d as unknown as { tracking?: { driverId?: string } };
        if (d.assignedDriverId || dt.tracking?.driverId) return false;
      } else if (deliveryAttentionFilter === 'awaiting') {
        const s = (d.status || '').toLowerCase();
        const conf = String(d.confirmationStatus || '').toLowerCase();
        if (!['pending', 'scheduled'].includes(s)) return false;
        if (conf === 'confirmed' || d.customerConfirmedAt) return false;
      }
      return true;
    });
  }, [portalOperationalDeliveries, deliverySearch, deliveryStatusFilter, deliveryDateFrom, deliveryDateTo, deliveryAttentionFilter, deliverySortBy, deliverySortDir]);

  const deliveryByAreaData = useMemo<AreaItem[]>(() => {
    const arr = (data?.analytics?.deliveryByArea || []).slice().sort((a, b) => (b.count ?? 0) - (a.count ?? 0));
    return arr.slice(0, chartTopN);
  }, [data?.analytics?.deliveryByArea, chartTopN]);

  type AreaRowEnhanced = AreaItem & { pending?: number; delivered?: number; successRate?: number };
  const deliveryByAreaEnhanced = useMemo<AreaRowEnhanced[]>(() => {
    const list = dashboardDeliveries && Array.isArray(dashboardDeliveries) ? dashboardDeliveries : [];
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
  }, [dashboardDeliveries, areaKeywords, chartTopN]);

  const topItemsData = useMemo<ItemItem[]>(() => {
    const minQty = Number(topItemsMinQty) || 0;
    let rows = (data?.analytics?.topItems || []).filter(r => {
      const q = topItemsSearch.trim().toLowerCase();
      const matchSearch = !q || (r.item || '').toLowerCase().includes(q) || (r.pnc || '').toLowerCase().includes(q) || (r.modelId || '').toLowerCase().includes(q);
      const matchMinQty = minQty <= 0 || (r.count ?? 0) >= minQty;
      return matchSearch && matchMinQty;
    });
    const dir = topItemsSortDir === 'asc' ? 1 : -1;
    if (topItemsSortBy === 'count') rows = [...rows].sort((a, b) => dir * ((a.count ?? 0) - (b.count ?? 0)));
    else if (topItemsSortBy === 'item') rows = [...rows].sort((a, b) => dir * (a.item || '').localeCompare(b.item || ''));
    else if (topItemsSortBy === 'pnc') rows = [...rows].sort((a, b) => dir * (a.pnc || '').localeCompare(b.pnc || ''));
    return rows.slice(0, chartTopN);
  }, [data?.analytics?.topItems, topItemsSearch, topItemsSortBy, topItemsSortDir, topItemsMinQty, chartTopN]);

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
      const matchSearch = !q || (r.customer || '').toLowerCase().includes(q) || (r.primaryArea || '').toLowerCase().includes(q);
      const minOrd = Number(topCustomersMinOrders) || 0;
      const minSucc = Number(topCustomersMinSuccess) || 0;
      const matchMinOrders = minOrd <= 0 || (r.orders ?? 0) >= minOrd;
      const matchMinSuccess = minSucc <= 0 || (r.successRate ?? 0) >= minSucc;
      const risk = riskFromSuccessRate(r.successRate ?? 0);
      const matchRisk = topCustomersRiskFilter === 'all' || risk === topCustomersRiskFilter;
      return matchArea && matchSearch && matchMinOrders && matchMinSuccess && matchRisk;
    });
    const dir = topCustomersSortDir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      if (topCustomersSortBy === 'customer') return dir * (a.customer || '').localeCompare(b.customer || '');
      if (topCustomersSortBy === 'delivered') return dir * ((a.delivered ?? 0) - (b.delivered ?? 0));
      if (topCustomersSortBy === 'successRate') return dir * ((a.successRate ?? 0) - (b.successRate ?? 0));
      return dir * ((a.orders ?? 0) - (b.orders ?? 0));
    });
  }, [data?.analytics?.topCustomers, topCustomersSearch, topCustomersAreaFilter, topCustomersSortBy, topCustomersSortDir, topCustomersMinOrders, topCustomersMinSuccess, topCustomersRiskFilter]);

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

  /** Management KPI computations: on-time, delay, cancellation, reschedule rates */
  const mgmtKpis = useMemo(() => {
    const total = dashboardDeliveries.length;

    const DELIVERED_STATUSES = ['delivered', 'delivered-with-installation', 'delivered-without-installation', 'completed', 'pod-completed'];
    const CANCELLED_STATUSES = ['cancelled'];
    const RESCHEDULED_STATUSES = ['rescheduled'];

    let onTimeCount = 0;
    let delayCount = 0;
    let cancelCount = 0;
    let rescheduleCount = 0;

    for (const d of dashboardDeliveries) {
      const st = String(d.status || '').toLowerCase();
      if (CANCELLED_STATUSES.includes(st)) {
        cancelCount++;
        continue;
      }
      if (RESCHEDULED_STATUSES.includes(st)) {
        rescheduleCount++;
        continue;
      }
      if (DELIVERED_STATUSES.includes(st)) {
        const deliveredAt = d.deliveredAt || d.delivered_at;
        const scheduledDate = d.confirmedDeliveryDate;
        if (deliveredAt && scheduledDate) {
          const dDelivered = new Date(deliveredAt as string).setHours(0, 0, 0, 0);
          const dScheduled = new Date(scheduledDate as string).setHours(0, 0, 0, 0);
          if (dDelivered <= dScheduled) onTimeCount++;
          else delayCount++;
        } else {
          // No schedule set — count as on-time (delivered without a promised date)
          onTimeCount++;
        }
      }
    }

    const pct = (n: number) => total > 0 ? Math.round((n / total) * 1000) / 10 : 0;

    return {
      total,
      onTime: { count: onTimeCount, pct: pct(onTimeCount) },
      delay: { count: delayCount, pct: pct(delayCount) },
      cancel: { count: cancelCount, pct: pct(cancelCount) },
      reschedule: { count: rescheduleCount, pct: pct(rescheduleCount) },
    };
  }, [dashboardDeliveries]);

  /** Per-customer confirmation detail for the linked table */
  const customerResponseDetail = useMemo(() => {
    type ResponseRow = {
      customer: string;
      poNumber: string;
      action: 'Confirmed' | 'Rescheduled' | 'Cancelled';
      confirmedAt: string | null;
      address: string;
      status: string;
    };
    const rows: ResponseRow[] = [];
    for (const d of dashboardDeliveries) {
      const cs = String(d.confirmationStatus || '').toLowerCase();
      if (!cs || cs === 'pending' || cs === '') continue;
      let action: ResponseRow['action'] | null = null;
      if (cs === 'confirmed') action = 'Confirmed';
      else if (cs === 'rescheduled') action = 'Rescheduled';
      else if (cs === 'cancelled') action = 'Cancelled';
      if (!action) continue;
      rows.push({
        customer: String(d.customer || '—'),
        poNumber: String(d.poNumber || '—'),
        action,
        confirmedAt: d.customerConfirmedAt ? new Date(d.customerConfirmedAt as string).toLocaleDateString('en-GB') : null,
        address: String(d.address || '—'),
        status: String(d.status || '—'),
      });
    }
    // Sort: Confirmed first, then Rescheduled, then Cancelled
    const order: Record<string, number> = { Confirmed: 0, Rescheduled: 1, Cancelled: 2 };
    rows.sort((a, b) => (order[a.action] ?? 3) - (order[b.action] ?? 3));
    return rows;
  }, [dashboardDeliveries]);

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
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600 mx-auto mb-3"></div>
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

  const PAGE_SIZE = 20;
  const totalPages = Math.max(1, Math.ceil(filteredDeliveries.length / PAGE_SIZE));
  const pagedDeliveries = filteredDeliveries.slice(deliveryPage * PAGE_SIZE, (deliveryPage + 1) * PAGE_SIZE);

  const STATUS_LABELS: Record<string, string> = {
    'pending': 'Pending Order', 'uploaded': 'Pending Order',
    'scheduled': 'Awaiting Customer', 'confirmed': 'Confirmed',
    'scheduled-confirmed': 'Confirmed', 'out-for-delivery': 'Out for Delivery',
    'in-transit': 'In Transit', 'in-progress': 'In Progress', 'assigned': 'Assigned',
    'delivered': 'Delivered', 'delivered-with-installation': 'Delivered + Install',
    'delivered-without-installation': 'Delivered (no install)',
    'completed': 'Completed', 'pod-completed': 'POD Completed',
    'cancelled': 'Cancelled', 'rejected': 'Rejected',
    'rescheduled': 'Rescheduled', 'returned': 'Returned', 'failed': 'Failed',
  };

  const STATUS_COLORS: Record<string, string> = {
    'pending': 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
    'uploaded': 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
    'scheduled': 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300',
    'confirmed': 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
    'scheduled-confirmed': 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
    'out-for-delivery': 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300',
    'in-transit': 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300',
    'in-progress': 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
    'assigned': 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
    'delivered': 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
    'delivered-with-installation': 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
    'delivered-without-installation': 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
    'completed': 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
    'pod-completed': 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
    'cancelled': 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
    'rejected': 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
    'rescheduled': 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300',
    'returned': 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300',
    'failed': 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
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
          ? (dir === 'asc' ? <ChevronUp className="w-3 h-3 text-blue-500" /> : <ChevronDown className="w-3 h-3 text-blue-500" />)
          : <span className="w-3 h-3 text-gray-300 dark:text-gray-600">↕</span>}
      </span>
    </th>
  );

  const tabs = [
    { id: 'overview',   label: 'Overview',                                  icon: Activity    },
    { id: 'deliveries', label: 'Deliveries',                                 icon: Package     },
    { id: 'trends',     label: 'Trends',                                    icon: TrendingUp  },
    { id: 'customers',  label: 'Top Customers',                             icon: Users       },
    { id: 'by-area',    label: 'By Area',                                   icon: MapPin      },
    { id: 'by-product', label: 'By Product',                                icon: FileText    },
    { id: 'drivers',    label: 'Drivers',                                   icon: Users       },
  ];

  // ─── RENDER ───

    return (
    <div className="space-y-5 w-full min-w-0">

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
          className="flex items-center gap-2 px-4 py-2.5 text-sm border border-gray-200/90 dark:border-white/10 rounded-2xl bg-white dark:bg-slate-800/90 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors shadow-sm"
        >
          <RefreshCw className="w-4 h-4" /> Refresh
          </button>
        </div>

      {/* ── Tab Navigation (PolicyPilot pill rail) ── */}
      <div className="pp-sticky-tab-rail rounded-2xl bg-gray-100/80 dark:bg-white/[0.06] p-1.5 border border-gray-200/60 dark:border-white/[0.07]">
        <nav className="flex flex-nowrap gap-1 overflow-x-auto pb-1">
          {tabs.map(({ id, label, icon: Icon }) => (
              <button
              key={id}
              type="button"
              onClick={() => { setActiveTab(id); setDeliveryPage(0); }}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium whitespace-nowrap rounded-xl transition-all ${
                activeTab === id
                  ? 'bg-white dark:bg-slate-800 text-blue-600 dark:text-blue-400 shadow-sm'
                    : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 hover:bg-white/60 dark:hover:bg-slate-700/50'
              }`}
              >
              <Icon className="w-4 h-4 shrink-0" />{label}
              </button>
          ))}
        </nav>
      </div>

      {/* Animated tab content */}
      <div key={activeTab} className="tab-enter">

      {/* ══════════════ OVERVIEW TAB ══════════════ */}
      {activeTab === 'overview' && (
        <div className="space-y-3">
          {/* ── Row 1: Volume KPI Strip ── */}
          <div className="pp-kpi-grid--fill">
            {kpiCards.map(card => {
              const Icon = card.icon;
              const c = KPI_COLOR_MAP[card.color];
              return (
                <div
                  key={card.id}
                  className="pp-dash-card p-4 sm:p-5 relative w-full min-w-0"
                  title={
                    card.id === 'rate'
                      ? 'Success rate = delivered orders ÷ total orders. The trend chart uses the same ratio per day (delivered ÷ dispatched that day).'
                      : undefined
                  }
                >
                  <span className="absolute top-3 right-3 text-gray-300 dark:text-slate-600 pointer-events-none" aria-hidden>
                    <ArrowUpRight className="w-3.5 h-3.5" strokeWidth={2} />
                  </span>
                  <div className="flex items-start gap-3 pr-6">
                    <div className={`p-2.5 rounded-full shrink-0 ${c.bg}`}><Icon className={`w-4 h-4 ${c.icon}`} /></div>
                    <div className="min-w-0 flex-1">
                      <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide leading-snug">
                        {card.label}
                      </span>
                      <div className={`text-2xl sm:text-3xl font-bold tracking-tight ${c.val} mt-1`}>{card.value}</div>
                      {card.delta ? (
                        <div className={`text-xs mt-1 flex items-center gap-0.5 ${card.delta.up ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'}`}>
                          {card.delta.up ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                          {card.delta.pct}% vs yesterday
                        </div>
                      ) : <div className="h-4 mt-1" />}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* ── Row 2: Two-column layout ── */}
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-3 xl:gap-4">
            {/* Left column — ~2/3 */}
            <div className="xl:col-span-2 space-y-3">
              {/* Hero Chart */}
              <div className="pp-dash-card p-4 sm:p-5">
                <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-gray-300 dark:text-slate-600 shrink-0 hidden sm:inline" aria-hidden>
                      <ArrowUpRight className="w-4 h-4" strokeWidth={2} />
                    </span>
                    <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 tracking-tight">Delivery Trend</h2>
                  </div>
                  <div className="inline-flex p-1 rounded-xl bg-gray-100/90 dark:bg-slate-700/45 gap-0.5 text-xs font-medium shrink-0">
                    {([['7d', 'Last 7 days'], ['30d', 'Last 30 days'], ['90d', 'Last 90 days']] as [string, string][]).map(([p, label]) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setHeroPeriod(p)}
                        className={`px-3 py-1.5 rounded-lg transition-all whitespace-nowrap ${heroPeriod === p ? 'bg-white dark:bg-slate-800 text-blue-600 dark:text-blue-400 shadow-sm font-semibold' : 'text-gray-600 dark:text-gray-400 hover:bg-white/70 dark:hover:bg-slate-600/40'}`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="w-full h-[248px] sm:h-[268px]">
                  <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: heroCw, height: 248 }}>
                      <ComposedChart data={heroChartData} margin={{ top: 8, right: 24, left: -8, bottom: 4 }} barCategoryGap="12%">
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
                        <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--chart-tick)' }} tickLine={false} axisLine={false}
                          interval={heroPeriod === '7d' ? 0 : heroPeriod === '30d' ? 4 : 8} />
                        <YAxis
                          yAxisId="left"
                          tick={{ fontSize: 11, fill: 'var(--chart-tick)' }}
                          tickLine={false}
                          axisLine={false}
                          width={36}
                          allowDecimals={false}
                        />
                        <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: '#f97316' }} tickLine={false} axisLine={false} unit="%" domain={[0, 100]} width={40} />
                        <Tooltip
                          {...RECHARTS_TOOLTIP_OVERVIEW}
                          formatter={(val: number | string, name: string) => (name === 'Success Rate %' ? [`${val}%`, name] : [val, name]) as [React.ReactNode, string]}
                        />
                        <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '8px', color: 'var(--chart-legend)' }} />
                        <Bar yAxisId="left" dataKey="total" fill="#c7d7f9" name="Total Dispatched" radius={[3, 3, 0, 0]} maxBarSize={36} isAnimationActive animationDuration={900} animationEasing="ease-out" />
                        <Bar yAxisId="left" dataKey="delivered" fill="#2563EB" name="Delivered" radius={[3, 3, 0, 0]} maxBarSize={36} isAnimationActive animationDuration={900} animationEasing="ease-out" />
                        <Line yAxisId="right" type="monotone" dataKey="rate" stroke="#f97316" name="Success Rate %" dot={false} strokeWidth={2.5} isAnimationActive animationDuration={1100} animationEasing="ease-out" />
                      </ComposedChart>
                    </ResponsiveContainer>
                </div>
              </div>

              {/* Customer Response Detail */}
              {(() => {
                const visibleRows = responseFilter
                  ? customerResponseDetail.filter(r => r.action === responseFilter)
                  : customerResponseDetail;
                const title = responseFilter
                  ? `${responseFilter === 'Confirmed' ? 'Accepted' : responseFilter} Orders`
                  : 'Customer Response Detail';
                return (
                  <div className="pp-dash-card p-5" ref={responseDetailRef}>
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{title}</h3>
                        {responseFilter && (
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                            responseFilter === 'Confirmed' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                            : responseFilter === 'Rescheduled' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
                            : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                          }`}>{visibleRows.length}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-3">
                        {responseFilter && (
                          <button type="button" onClick={() => setResponseFilter(null)} className="text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300">
                            ✕ Clear
                          </button>
                        )}
                        <span className="text-xs text-gray-400 dark:text-gray-500">{visibleRows.length} {responseFilter ? '' : 'responses'}</span>
                      </div>
                    </div>
                    {visibleRows.length > 0 ? (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-gray-100 dark:border-gray-700 text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                              <th className="text-left pb-2 pr-4 font-semibold">Customer</th>
                              <th className="text-left pb-2 pr-4 font-semibold">Delivery No.</th>
                              {!responseFilter && <th className="text-left pb-2 pr-4 font-semibold">Response</th>}
                              <th className="text-left pb-2 pr-4 font-semibold">Confirmed On</th>
                              <th className="text-left pb-2 font-semibold">Status</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
                            {visibleRows.slice(0, 100).map((row, idx) => (
                              <tr key={idx} className="hover:bg-gray-50 dark:hover:bg-gray-800/40 transition-colors">
                                <td className="py-2.5 pr-4 text-gray-900 dark:text-gray-100 font-medium max-w-[160px] truncate">{row.customer}</td>
                                <td className="py-2.5 pr-4 text-gray-600 dark:text-gray-400 font-mono text-xs">{row.poNumber}</td>
                                {!responseFilter && (
                                  <td className="py-2.5 pr-4">
                                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${
                                      row.action === 'Confirmed' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                                      : row.action === 'Rescheduled' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
                                      : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                                    }`}>
                                      {row.action}
                                    </span>
                                  </td>
                                )}
                                <td className="py-2.5 pr-4 text-gray-500 dark:text-gray-400 text-xs">{row.confirmedAt || '—'}</td>
                                <td className="py-2.5 text-gray-500 dark:text-gray-400 capitalize text-xs">{row.status}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {visibleRows.length > 100 && (
                          <p className="text-xs text-gray-400 dark:text-gray-500 text-center mt-3">
                            Showing 100 of {visibleRows.length} responses
                          </p>
                        )}
                      </div>
                    ) : (
                      <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-6">
                        {responseFilter ? `No ${responseFilter === 'Confirmed' ? 'accepted' : responseFilter.toLowerCase()} orders found` : 'No customer responses yet'}
                      </p>
                    )}
                  </div>
                );
              })()}
            </div>

            {/* Right column — ~1/3 side widgets */}
            <div className="space-y-3">
              {/* Exception Queue */}
              <div className="pp-dash-soft-gradient p-5">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3 tracking-tight">Needs Attention</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3">
                  <button onClick={() => { setActiveTab('deliveries'); setDeliveryAttentionFilter('overdue'); setDeliveryStatusFilter('all'); setDeliveryPage(0); }}
                    className="flex flex-col items-center justify-center p-3 rounded-xl bg-white/90 dark:bg-slate-900/50 hover:bg-white dark:hover:bg-slate-800/80 transition-colors text-left cursor-pointer shadow-sm border border-white/60 dark:border-white/10">
                    <span className="text-lg font-bold text-amber-600 dark:text-amber-400">{actionItems.overdue}</span>
                    <span className="text-xs text-gray-600 dark:text-gray-400">Pending Orders</span>
                  </button>
                  <button onClick={() => { setActiveTab('deliveries'); setDeliveryAttentionFilter('unassigned'); setDeliveryStatusFilter('all'); setDeliveryPage(0); }}
                    className="flex flex-col items-center justify-center p-3 rounded-xl bg-white/90 dark:bg-slate-900/50 hover:bg-white dark:hover:bg-slate-800/80 transition-colors text-left cursor-pointer shadow-sm border border-white/60 dark:border-white/10">
                    <span className="text-lg font-bold text-orange-600 dark:text-orange-400">{actionItems.unassigned}</span>
                    <span className="text-xs text-gray-600 dark:text-gray-400">Unassigned</span>
                  </button>
                  <button onClick={() => { setActiveTab('deliveries'); setDeliveryAttentionFilter('awaiting'); setDeliveryStatusFilter('all'); setDeliveryPage(0); }}
                    className="flex flex-col items-center justify-center p-3 rounded-xl bg-white/90 dark:bg-slate-900/50 hover:bg-white dark:hover:bg-slate-800/80 transition-colors text-left col-span-2 cursor-pointer shadow-sm border border-white/60 dark:border-white/10">
                    <span className="text-lg font-bold text-purple-600 dark:text-purple-400">{actionItems.unconfirmed}</span>
                    <span className="text-xs text-gray-600 dark:text-gray-400">Awaiting confirmation</span>
                  </button>
                </div>
                <button onClick={() => { setActiveTab('deliveries'); setDeliveryPage(0); }}
                  className="w-full flex items-center justify-center gap-1 text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline">
                  View in Deliveries <ChevronRight className="w-3 h-3" />
                </button>
              </div>

              {/* Customer Response Summary */}
              <div className="pp-dash-card p-5">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-4">Customer Response</h3>
                <div className="space-y-3">
                  {([
                    { label: 'Accepted', filter: 'Confirmed' as const, value: totals.customerAccepted || 0, color: 'text-green-600 dark:text-green-400', bg: 'bg-green-50 dark:bg-green-900/20', ring: 'ring-green-400' },
                    { label: 'Rescheduled', filter: 'Rescheduled' as const, value: totals.customerRescheduled || 0, color: 'text-yellow-600 dark:text-yellow-400', bg: 'bg-yellow-50 dark:bg-yellow-900/20', ring: 'ring-yellow-400' },
                    { label: 'Cancelled', filter: 'Cancelled' as const, value: totals.customerCancelled || 0, color: 'text-red-600 dark:text-red-400', bg: 'bg-red-50 dark:bg-red-900/20', ring: 'ring-red-400' },
                  ] as const).map(({ label, filter, value, color, bg, ring }) => (
                    <button
                      key={label}
                      type="button"
                      onClick={() => {
                        setResponseFilter(f => f === filter ? null : filter);
                        setTimeout(() => responseDetailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
                      }}
                      className={`w-full flex items-center justify-between px-3 py-3 rounded-lg transition-all ${bg} ${responseFilter === filter ? `ring-2 ${ring}` : 'hover:opacity-80'}`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-gray-700 dark:text-gray-300">{label}</span>
                        {responseFilter === filter && <span className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Filtered</span>}
                      </div>
                      <span className={`text-xl font-bold ${color}`}>{value}</span>
                    </button>
                  ))}
                </div>
                {responseFilter && (
                  <button
                    type="button"
                    onClick={() => setResponseFilter(null)}
                    className="mt-3 w-full text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 text-center"
                  >
                    ✕ Clear filter
                  </button>
                )}
              </div>

              {/* Proof of Delivery */}
              <div className="pp-dash-card p-5">
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
                    <button onClick={() => navigate('/admin/reports/pod')} className="mt-4 w-full text-xs text-blue-600 dark:text-blue-400 hover:underline text-center">
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
          {/* ── Trends filter — unified smart presets ── */}
          <div className="pp-dash-card p-4 sm:p-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100">Time Period</h3>
              {/* Granularity override — secondary, for power users */}
              <div className="inline-flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-gray-400">
                <span className="hidden sm:inline">Granularity:</span>
                <div className="inline-flex p-0.5 rounded-lg bg-gray-100 dark:bg-slate-700/50" role="group">
                  {(['day', 'month', 'year'] as const).map(p => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => { setTrendsGlobalPeriod(p); setTrendsActivePreset('custom'); }}
                      className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-all ${
                        trendsGlobalPeriod === p
                          ? 'bg-white dark:bg-slate-800 text-blue-600 dark:text-blue-400 shadow-sm'
                          : 'text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'
                      }`}
                    >
                      {p === 'day' ? 'Day' : p === 'month' ? 'Month' : 'Year'}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Smart preset pills — each sets BOTH range AND granularity */}
            <div className="flex flex-wrap gap-1.5">
              {([
                ['default',  'Last 12 Months', 'month'],
                ['last7',    'Last 7 Days',    'day'],
                ['last30',   'Last 30 Days',   'day'],
                ['thisMonth','This Month',     'day'],
                ['lastMonth','Last Month',     'day'],
                ['last90',   'Last 3 Months',  'month'],
                ['last6m',   'Last 6 Months',  'month'],
                ['thisYear', 'This Year',      'month'],
                ['lastYear', 'Last Year',      'month'],
                ['allTime',  'All Time',       'year'],
              ] as const).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => applyTrendPreset(k)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-all ${
                    trendsActivePreset === k
                      ? 'bg-[#002D5B] border-[#002D5B] text-white shadow-sm'
                      : 'border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Custom date range */}
            <details className="group">
              <summary className="cursor-pointer text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline list-none flex items-center gap-1">
                <span className="group-open:hidden">▸ Custom date range</span>
                <span className="hidden group-open:inline">▾ Custom date range</span>
              </summary>
              <div className="mt-2 flex flex-wrap items-end gap-2">
                <label className="flex flex-col gap-1 text-xs">
                  <span className="font-medium text-gray-600 dark:text-gray-400">From</span>
                  <input
                    type="date"
                    value={trendsRangeFrom}
                    onChange={e => { setTrendsRangeFrom(e.target.value); setTrendsActivePreset('custom'); }}
                    className="px-3 py-1.5 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                  />
                </label>
                <span className="text-gray-400 pb-1 hidden sm:inline">—</span>
                <label className="flex flex-col gap-1 text-xs">
                  <span className="font-medium text-gray-600 dark:text-gray-400">To</span>
                  <input
                    type="date"
                    value={trendsRangeTo}
                    onChange={e => { setTrendsRangeTo(e.target.value); setTrendsActivePreset('custom'); }}
                    className="px-3 py-1.5 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => applyTrendPreset('default')}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"
                >
                  Reset
                </button>
              </div>
            </details>

            {/* Status bar */}
            <p className="text-[11px] text-gray-400 dark:text-gray-500 border-t border-gray-100 dark:border-gray-700 pt-2">
              {trendsRangeFrom || trendsRangeTo
                ? <><strong className="text-gray-600 dark:text-gray-300">{trendsRangeFrom || '…'}</strong> → <strong className="text-gray-600 dark:text-gray-300">{trendsRangeTo || '…'}</strong></>
                : <span>Default window</span>}
              {' · '}
              <span className="capitalize">{trendsGlobalPeriod === 'day' ? 'Daily' : trendsGlobalPeriod === 'month' ? 'Monthly' : 'Yearly'} granularity</span>
              {' · '}
              <span>{trendsBucketsConfig.buckets.length} data points</span>
              {trendsBucketsConfig.buckets.length >= TREND_BUCKET_MAX && (
                <span className="text-amber-600 dark:text-amber-400 ml-1"> — cap reached; narrow the range.</span>
              )}
            </p>
          </div>

          {/* Trend charts — 3 columns on lg */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 [&>*]:min-w-0">
            {/* 1. Delivery Demand Trend — Column + moving average */}
            <TrendChartCard
              title="Delivery Demand Trend"
              subtitle={trendsGlobalPeriod === 'day' ? 'Total requests per day + 7-day moving avg' : trendsGlobalPeriod === 'month' ? 'Per month + 4-period moving avg' : 'Per year + 3-period moving avg'}
              period={trendsGlobalPeriod}
              onPeriodChange={setTrendsGlobalPeriod}
              hidePeriodFilter
              data={trend1DeliveryRequests}
              dataKey="count"
              xKey={trendsGlobalPeriod === 'day' ? 'day' : 'label'}
              chartType="demand-ma"
              barColor="#2563EB"
            />
            {/* 2. Fulfillment Trend — Grouped columns: created vs delivered vs pending vs cancelled */}
            <TrendChartCard
              title="Fulfillment Trend"
              subtitle="Created vs Delivered vs Pending vs Cancelled"
              period={trendsGlobalPeriod}
              onPeriodChange={setTrendsGlobalPeriod}
              hidePeriodFilter
              data={trend2Fulfillment}
              xKey={trendsGlobalPeriod === 'day' ? 'day' : 'label'}
              chartType="fulfillment"
            />
            {/* 3. Success Rate — Line + 95% target */}
            <TrendChartCard
              title="Success Rate"
              subtitle="Delivered / total completed requests (target 95%)"
              period={trendsGlobalPeriod}
              onPeriodChange={setTrendsGlobalPeriod}
              hidePeriodFilter
              data={trend3SuccessRate}
              dataKey="rate"
              xKey={trendsGlobalPeriod === 'day' ? 'day' : 'label'}
              chartType="success-target"
              targetValue={95}
            />
            {/* 4. Delivery Lead Time Trend — Median + P90 */}
            <TrendChartCard
              title="Delivery Lead Time Trend"
              subtitle="Median and P90 hours from created to delivered"
              period={trendsGlobalPeriod}
              onPeriodChange={setTrendsGlobalPeriod}
              hidePeriodFilter
              data={trend4LeadTime}
              xKey={trendsGlobalPeriod === 'day' ? 'day' : 'label'}
              chartType="lead-time"
            />
            {/* 5. Backlog Trend — Open deliveries over time */}
            <TrendChartCard
              title="Backlog / Open Deliveries Trend"
              subtitle={trendsGlobalPeriod === 'day' ? 'Open orders created per day' : trendsGlobalPeriod === 'month' ? 'Per month' : 'Per year'}
              period={trendsGlobalPeriod}
              onPeriodChange={setTrendsGlobalPeriod}
              hidePeriodFilter
              data={trend5Backlog}
              xKey={trendsGlobalPeriod === 'day' ? 'day' : 'label'}
              chartType="backlog"
            />
            {/* 6. Status Mix Over Time — 100% stacked area */}
            <TrendChartCard
              title="Status Mix Over Time"
              subtitle="Delivered vs Pending vs Cancelled (100% stacked)"
              period={trendsGlobalPeriod}
              onPeriodChange={setTrendsGlobalPeriod}
              hidePeriodFilter
              data={trend6StatusMix100}
              xKey={trendsGlobalPeriod === 'day' ? 'day' : 'label'}
              chartType="status-mix-100"
            />
            {/* 7. Peak Pattern Analysis — Heatmap */}
            <PeakHeatmapCard
              title="Peak Pattern Analysis"
              subtitle={trendsRangeFrom || trendsRangeTo ? 'Request volume by day/hour for the selected date range' : 'Request volume by day of week and hour (last 30 days)'}
              data={trend7Heatmap}
            />
            {/* 8. Top Areas Trend — Stacked area by top 5 areas */}
            <TrendChartCard
              title="Top Areas Trend"
              subtitle={trendsGlobalPeriod === 'day' ? 'Volume by top 5 areas per day' : trendsGlobalPeriod === 'month' ? 'Per month' : 'Per year'}
              period={trendsGlobalPeriod}
              onPeriodChange={setTrendsGlobalPeriod}
              hidePeriodFilter
              data={trend8AreasStacked}
              xKey="label"
              chartType="areas-stacked"
            />
            {/* 9. Top Items — Ranked horizontal bars */}
            <TrendChartCard
              title="Top Items by Volume"
              subtitle={trendsGlobalPeriod === 'day' ? 'Last 7 days' : trendsGlobalPeriod === 'month' ? 'Last 12 months' : 'Last 5 years'}
              period={trendsGlobalPeriod}
              onPeriodChange={setTrendsGlobalPeriod}
              hidePeriodFilter
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
          {/* Six KPIs — top-customer concentration & health */}
          <div className="pp-kpi-grid--six">
            {[
              { label: 'Total Customers', value: topCustomersData.length, icon: Users, color: 'blue' },
              { label: 'Total Orders', value: topCustomersData.reduce((s, r) => s + (r.orders ?? 0), 0), icon: Package, color: 'indigo' },
              { label: 'Delivered', value: topCustomersData.reduce((s, r) => s + (r.delivered ?? 0), 0), icon: CheckCircle, color: 'green' },
              {
                label: 'Top 1 Share',
                value: `${customerKpis.top1Share.toFixed(1)}%`,
                icon: Target,
                color: 'blue',
                tooltip: 'Share of all orders from your #1 customer. High value means revenue concentration risk; if this keeps increasing, diversify the customer mix to reduce dependency.',
              },
              {
                label: 'Top 3 Share',
                value: `${customerKpis.top3Share.toFixed(1)}%`,
                icon: TrendingUp,
                color: 'indigo',
                tooltip: 'Combined share of orders from your top 3 customers. Use this to track portfolio balance: lower is usually healthier, while very high values indicate over-reliance on a few accounts.',
              },
              {
                label: 'Avg Success Rate',
                value: `${customerKpis.avgSuccess.toFixed(1)}%`,
                icon: Activity,
                color: 'emerald',
                tooltip: 'Average delivery success rate across listed customers. If this drops, review failed/pending clusters by customer and area to find service issues or scheduling bottlenecks.',
              },
            ].map(({ label, value, icon: Icon, color, tooltip }) => {
              const c = KPI_COLOR_MAP[color];
              return (
                <div key={label} className="pp-dash-card p-3 relative flex items-center gap-2 sm:gap-3 w-full min-w-0 pr-8">
                  <span className="absolute top-2 right-2 text-gray-300 dark:text-slate-600 pointer-events-none" aria-hidden>
                    <ArrowUpRight className="w-3 h-3 sm:w-3.5 sm:h-3.5" strokeWidth={2} />
                  </span>
                  <div className={`p-2.5 rounded-full shrink-0 ${c.bg}`}><Icon className={`w-4 h-4 ${c.icon}`} /></div>
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

          {/* Filter bar — advanced */}
          <div className="pp-dash-card p-4 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Filter className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
              <input
                type="text"
                placeholder="Search customer or area..."
                value={topCustomersSearch}
                onChange={e => setTopCustomersSearch(e.target.value)}
                className="flex-1 min-w-0 sm:min-w-[140px] md:min-w-[180px] px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <select value={topCustomersAreaFilter} onChange={e => setTopCustomersAreaFilter(e.target.value)}
                className="px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100">
                <option value="all">All Areas</option>
                {topCustomersAreas.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
              <input type="number" min={0} placeholder="Min orders" value={topCustomersMinOrders} onChange={e => setTopCustomersMinOrders(e.target.value)}
                className="w-24 px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100" title="Show customers with at least this many orders" />
              <input type="number" min={0} max={100} placeholder="Min success %" value={topCustomersMinSuccess} onChange={e => setTopCustomersMinSuccess(e.target.value)}
                className="w-28 px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100" title="Minimum success rate" />
              <select value={topCustomersRiskFilter} onChange={e => setTopCustomersRiskFilter(e.target.value)}
                className="px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100">
                <option value="all">All risk levels</option>
                <option value="low">Low risk</option>
                <option value="medium">Medium risk</option>
                <option value="high">High risk</option>
              </select>
              <select value={topCustomersSortBy} onChange={e => setTopCustomersSortBy(e.target.value)}
                className="px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100">
                <option value="orders">Sort: Orders</option>
                <option value="delivered">Sort: Delivered</option>
                <option value="successRate">Sort: Success %</option>
                <option value="customer">Sort: Name</option>
              </select>
              <button onClick={() => setTopCustomersSortDir(d => d === 'asc' ? 'desc' : 'asc')}
                className="px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                {topCustomersSortDir === 'asc' ? '↑ Asc' : '↓ Desc'}
              </button>
              {(topCustomersSearch || topCustomersAreaFilter !== 'all' || topCustomersMinOrders || topCustomersMinSuccess || topCustomersRiskFilter !== 'all') && (
                <button onClick={() => { setTopCustomersSearch(''); setTopCustomersAreaFilter('all'); setTopCustomersMinOrders(''); setTopCustomersMinSuccess(''); setTopCustomersRiskFilter('all'); }}
                  className="flex items-center gap-1.5 px-3 py-2 text-sm text-gray-500 hover:text-red-600 dark:text-gray-400 dark:hover:text-red-400 transition-colors">
                  <RotateCcw className="w-3.5 h-3.5" /> Clear filters
                </button>
              )}
              <button onClick={() => exportCSV(topCustomersDataWithMeta as unknown as Record<string, unknown>[], ['customer', 'orders', 'delivered', 'pending', 'cancelled', 'successRate', 'sharePct', 'pendingRate', 'riskFlag', 'primaryArea', 'totalQuantity'], 'top-customers')}
                className="ml-auto flex items-center gap-1.5 px-3 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold shadow-sm transition-colors">
                <Download className="w-3.5 h-3.5" /> Export
              </button>
            </div>
          </div>

          {/* Two-column layout: Chart | Table */}
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
            {/* Chart — left, with Pareto overlay */}
            <div className="xl:col-span-5 space-y-4">
              {topCustomersData.length > 0 ? (
                <div className="pp-dash-card p-4 sm:p-6">
                  <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-4">Top 10 Customers by Orders + Cumulative Share</h2>
                  <ResponsiveContainer width="100%" height={Math.max(260, Math.min(topCustomersData.length * 46, 480))}>
                    <ComposedChart
                      data={topCustomersData.map((r, i) => {
                        const total = topCustomersData.reduce((s, x) => s + (x.orders ?? 0), 0);
                        const cum = topCustomersData.slice(0, i + 1).reduce((s, x) => s + (x.orders ?? 0), 0);
                        return { name: r.customer, orders: r.orders, delivered: r.delivered, cumPct: total > 0 ? sharePct(cum, total) : 0 };
                      })}
                      layout="vertical"
                      margin={{ left: 4, right: 20, top: 5, bottom: 5 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" horizontal={false} />
                      <XAxis type="number" tick={{ fontSize: 11, fill: 'var(--chart-tick)' }} tickLine={false} axisLine={false} />
                      <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 11, fill: 'var(--chart-tick-emphasis)' }} tickLine={false} axisLine={false} />
                      <YAxis type="number" yAxisId="pct" orientation="right" domain={[0, 100]} tick={{ fontSize: 9, fill: 'var(--chart-tick-secondary)' }} tickFormatter={v => `${v}%`} width={36} tickLine={false} axisLine={false} />
                      <Tooltip {...RECHARTS_TOOLTIP_12} formatter={(val: number, name: string, props: { payload?: { cumPct?: number } }) => (name === 'Cum. Share' ? [`${(props?.payload?.cumPct ?? val).toFixed(1)}%`, name] : [val, name])} />
                      <Legend wrapperStyle={{ fontSize: '12px', color: 'var(--chart-legend)' }} />
                      <Bar dataKey="orders" name="Total Orders" fill="#93c5fd" radius={[0, 3, 3, 0]} maxBarSize={18} isAnimationActive />
                      <Bar dataKey="delivered" name="Delivered" fill="#2563EB" radius={[0, 3, 3, 0]} maxBarSize={18} isAnimationActive />
                      <Line type="monotone" dataKey="cumPct" name="Cum. Share" stroke="#f59e0b" strokeWidth={2} strokeDasharray="4 4" dot={{ r: 2 }} yAxisId="pct" isAnimationActive />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="pp-dash-card p-4 sm:p-6">
                  <p className="text-center py-8 text-gray-400 dark:text-gray-500 text-sm">No customer data available</p>
                </div>
              )}
              {/* Side widget: Top customer spotlight */}
              {topCustomersData.length > 0 && topCustomersData[0] && (
                <div className="mt-4 pp-dash-card p-4">
                  <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-2">Top Customer</h3>
                  <p className="font-medium text-gray-900 dark:text-gray-100">{topCustomersData[0].customer}</p>
                  <p className="text-sm text-gray-500 dark:text-gray-400">{topCustomersData[0].orders ?? 0} orders · {topCustomersData[0].delivered ?? 0} delivered</p>
                  {topCustomersData[0].primaryArea && <p className="text-xs text-gray-400 mt-1 flex items-center gap-1"><MapPin className="w-3 h-3" />{topCustomersData[0].primaryArea}</p>}
                </div>
              )}

              {/* Customer Performance Matrix */}
              {topCustomersData.length > 0 && (
                <div className="mt-4 pp-dash-card p-4">
                  <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-2">Customer Performance Matrix</h3>
                  <p className="text-[10px] text-gray-400 mb-2">Orders (x) vs Success % (y), bubble size = pending</p>
                  <ResponsiveContainer width="100%" height={180}>
                    <ScatterChart margin={{ top: 5, right: 10, bottom: 5, left: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                      <XAxis type="number" dataKey="orders" name="Orders" tick={{ fontSize: 9, fill: 'var(--chart-tick)' }} tickLine={false} />
                      <YAxis type="number" dataKey="successRate" name="Success %" domain={[0, 100]} tick={{ fontSize: 9, fill: 'var(--chart-tick)' }} tickLine={false} />
                      <Tooltip cursor={{ strokeDasharray: '3 3' }} {...RECHARTS_TOOLTIP} formatter={(val: number, name: string) => [name === 'pending' ? val : name === 'successRate' ? `${val}%` : val, name]} />
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
            <div className="xl:col-span-7">
          <div className="pp-dash-card overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-700">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Customer Detail — Top {topCustomersData.length}</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="pp-mobile-stack-table min-w-[980px]">
                <thead className="bg-gray-50 dark:bg-gray-700/50">
                  <tr>
                    <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase text-left w-10">#</th>
                    <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase text-left">Customer</th>
                    <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase text-right">Orders</th>
                    <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase text-right">Delivered</th>
                    <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase text-right">Pending</th>
                    <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase text-right">Cancelled</th>
                    <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase text-right">
                      <MetricTooltip term="Share %" definition="This customer's order share out of all customer orders in the current dataset." />
                    </th>
                    <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase text-right">
                      <MetricTooltip term="Pending Rate" definition="Pending orders divided by this customer's total orders. Higher values may indicate scheduling or fulfillment delays." />
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
                      <td className="px-4 py-3 text-sm text-gray-400 dark:text-gray-500" data-label="#">{idx + 1}</td>
                      <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-gray-100" data-label="Customer">{row.customer || '—'}</td>
                      <td className="px-4 py-3 text-sm text-right font-bold text-blue-600 dark:text-blue-400" data-label="Orders">{row.orders ?? 0}</td>
                      <td className="px-4 py-3 text-sm text-right text-green-600 dark:text-green-400 font-semibold" data-label="Delivered">{row.delivered ?? 0}</td>
                      <td className="px-4 py-3 text-sm text-right text-yellow-600 dark:text-yellow-400" data-label="Pending">{row.pending ?? 0}</td>
                      <td className="px-4 py-3 text-sm text-right text-red-500 dark:text-red-400" data-label="Cancelled">{row.cancelled ?? 0}</td>
                      <td className="px-4 py-3 text-sm text-right text-gray-600 dark:text-gray-400" data-label="Share %">{row.sharePct?.toFixed(1) ?? '—'}%</td>
                      <td className="px-4 py-3 text-sm text-right" data-label="Pending Rate">
                        <span className={row.pendingRate > 20 ? 'text-amber-600 dark:text-amber-400 font-medium' : 'text-gray-600 dark:text-gray-400'}>
                          {row.pendingRate?.toFixed(1) ?? '—'}%
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-right" data-label="Success %">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${(row.successRate ?? 0) >= 80 ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : (row.successRate ?? 0) >= 50 ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'}`}>
                          {(row.successRate ?? 0).toFixed(1)}%
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-center" data-label="Risk">
                        <RiskBadge level={row.riskFlag ?? 'low'} />
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400" data-label="Primary Area">
                        {row.primaryArea ? <span className="flex items-center gap-1"><MapPin className="w-3 h-3 text-gray-400" />{row.primaryArea}</span> : '—'}
                      </td>
                      <td className="px-4 py-3 text-sm text-right text-gray-600 dark:text-gray-400" data-label="Total Qty">{row.totalQuantity ?? '—'}</td>
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
          {/* Compact strip — 6 delivery metrics */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {[
              { label: 'Total (live)', value: deliveriesTabWorkflowStats.total, icon: Package, color: 'blue' },
              { label: 'Pending orders', value: deliveriesTabWorkflowStats.pendingOrders, icon: Clock, color: 'yellow' },
              { label: 'No response (24h+)', value: deliveriesTabWorkflowStats.noResponse, icon: MessageSquare, color: 'emerald' },
              { label: 'On route', value: deliveriesTabWorkflowStats.onRoute, icon: Truck, color: 'indigo' },
              { label: 'Order delay', value: deliveriesTabWorkflowStats.orderDelay, icon: AlertCircle, color: 'red' },
              { label: 'Delivered', value: deliveriesTabWorkflowStats.delivered, icon: CheckCircle, color: 'green' },
            ].map(({ label, value, icon: Icon, color }) => {
              const c = KPI_COLOR_MAP[color];
              return (
                <div key={label} className="pp-dash-card p-3 relative flex items-center gap-3 pr-9">
                  <span className="absolute top-2.5 right-2.5 text-gray-300 dark:text-slate-600 pointer-events-none" aria-hidden>
                    <ArrowUpRight className="w-3.5 h-3.5" strokeWidth={2} />
                  </span>
                  <div className={`p-2.5 rounded-full shrink-0 ${c.bg}`}><Icon className={`w-4 h-4 ${c.icon}`} /></div>
                  <div className="min-w-0">
                    <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
                    <p className={`text-lg font-bold ${c.val}`}>{value}</p>
                  </div>
                </div>
              );
            })}
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Counts and the table use the same live delivery list and status rules as the Delivery and Logistics portals. Rows from bad uploads (for example PO shown as &quot;removed&quot; or placeholder customers like Customer 3) are hidden.
          </p>

          {/* Two-column: Table | Side widgets */}
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            <div className="xl:col-span-2">
        <div className="pp-dash-card overflow-hidden">
          {/* Filter bar */}
          <div className="px-3 sm:px-5 py-4 border-b border-gray-100 dark:border-gray-700 flex flex-wrap gap-2 items-center">
                  <input
                    type="text"
                    placeholder="Search PO number, customer, address..."
                    value={deliverySearch}
                    onChange={e => { setDeliverySearch(e.target.value); setDeliveryPage(0); }}
              className="flex-1 min-w-0 sm:min-w-[140px] md:min-w-[200px] px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                    <select
                      value={deliveryStatusFilter}
                      onChange={e => { setDeliveryStatusFilter(e.target.value); setDeliveryPage(0); }}
              className="px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="all">All Statuses</option>
                      <option value="wf:out_for_delivery">On route (workflow)</option>
                      <option value="wf:order_delay">Order delay (workflow)</option>
                      <option value="wf:unconfirmed">No response 24h+ (workflow)</option>
                      <option value="pending">Pending Order</option>
              <option value="scheduled">Awaiting Customer (SMS sent)</option>
              <option value="scheduled-confirmed">Confirmed</option>
                      <option value="out-for-delivery">Out for Delivery</option>
                      <option value="delivered">Delivered</option>
              <option value="delivered-with-installation">Delivered + Install</option>
              <option value="delivered-without-installation">Delivered (no install)</option>
              <option value="pod-completed">POD Completed</option>
                      <option value="cancelled">Cancelled</option>
              <option value="rescheduled">Rescheduled</option>
              <option value="returned">Returned / Failed</option>
                    </select>
            <input type="date" value={deliveryDateFrom} onChange={e => { setDeliveryDateFrom(e.target.value); setDeliveryPage(0); }}
              className="px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100" />
            <span className="text-gray-400 text-sm">—</span>
            <input type="date" value={deliveryDateTo} onChange={e => { setDeliveryDateTo(e.target.value); setDeliveryPage(0); }}
              className="px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100" />
                    {(deliverySearch || deliveryStatusFilter !== 'all' || deliveryDateFrom || deliveryDateTo || deliveryAttentionFilter) && (
                      <button
                        onClick={() => { setDeliverySearch(''); setDeliveryStatusFilter('all'); setDeliveryDateFrom(''); setDeliveryDateTo(''); setDeliveryAttentionFilter(null); setDeliveryPage(0); }}
                className="px-3 py-2 text-sm font-medium text-red-500 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 transition-colors flex items-center gap-1"
              ><XCircle className="w-3.5 h-3.5" /> Clear filters</button>
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
              className="ml-auto flex-shrink-0 flex items-center gap-2 px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold transition-colors shadow-sm"
            >
              <Download className="w-4 h-4" /> Export CSV
            </button>
            </div>

          {/* Table */}
          <div className="overflow-x-auto" ref={deliveryTableRef}>
            <table className="pp-mobile-stack-table min-w-[840px]">
              <thead className="bg-gray-50 dark:bg-gray-700/50">
                <tr>
                  <SortTh label="PO Number" sortKey="poNumber" current={deliverySortBy} dir={deliverySortDir}
                    onSort={k => { if (deliverySortBy === k) setDeliverySortDir(d => d === 'asc' ? 'desc' : 'asc'); else { setDeliverySortBy(k); setDeliverySortDir('asc'); } setDeliveryPage(0); }} />
                  <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider text-left">Delivery Number</th>
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
                  const wfBadge = adminDeliveriesWorkflowBadge(delivery as unknown as Record<string, unknown>);
                      return (
                        <tr
                          key={delivery.id || delivery.ID}
                      className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors cursor-pointer"
                      onClick={() => { setSelectedDelivery(delivery); setIsModalOpen(true); }}
                    >
                      <td className="px-4 py-3 text-sm font-mono text-blue-600 dark:text-blue-400" data-label="PO Number">
                        {delivery.poNumber || String(delivery.id || delivery.ID || '').slice(0, 8)}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400" data-label="Delivery Number">
                        {(delivery.metadata as { originalDeliveryNumber?: string } | null | undefined)?.originalDeliveryNumber || (delivery as unknown as { _originalDeliveryNumber?: string })._originalDeliveryNumber || '—'}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-900 dark:text-gray-100" data-label="Customer">{delivery.customer || 'N/A'}</td>
                      <td className="px-4 py-3" data-label="Status">
                        <span className={`inline-block px-2 py-0.5 text-xs font-semibold rounded-full ${wfBadge.pillClass}`}>
                          {wfBadge.label}
                            </span>
                          </td>
                      <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400" data-label="Driver">
                        {delivery.driverName || (delivery.assignedDriverId ? 'Assigned' : 'Unassigned')}
                          </td>
                      <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400" data-label="Date">
                        {(delivery.created_at || delivery.createdAt)
                          ? new Date(delivery.created_at || delivery.createdAt).toLocaleDateString('en-GB')
                              : 'N/A'}
                          </td>
                      <td className="px-4 py-3" data-label="Actions" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center gap-2">
                              <select
                                value={delivery.status || 'pending'}
                            onChange={async e => {
                              const newStatus = e.target.value;
                              const deliveryId = delivery.id || delivery.ID;
                              if (!deliveryId) return;
                              try {
                                await api.put(`/deliveries/admin/${deliveryId}/status`, { status: newStatus });
                                setDashboardDeliveries(prev => prev.map(d =>
                                  d.id === delivery.id ? { ...d, status: newStatus } : d
                                ));
                                      void loadDashboardData();
                                window.dispatchEvent(new CustomEvent('deliveryStatusUpdated', { detail: { deliveryId: delivery.id || delivery.ID, newStatus } }));
                              } catch (err) { console.error('Status update error:', err); }
                            }}
                            onClick={e => e.stopPropagation()}
                            className="px-2 py-1 text-xs border border-gray-200 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
                          >
                            {/* Dynamic fallback — shows current status if it's not in the list below */}
                            {!['pending','uploaded','scheduled','scheduled-confirmed','confirmed',
                               'out-for-delivery','in-transit','in-progress','delivered',
                               'delivered-with-installation','delivered-without-installation',
                               'completed','pod-completed','cancelled','rescheduled','returned',
                               'failed','assigned'].includes((delivery.status || 'pending').toLowerCase()) && (
                              <option value={delivery.status || 'pending'}>
                                {STATUS_LABELS[(delivery.status || '').toLowerCase()] || delivery.status || 'Pending Order'}
                              </option>
                            )}
                            <option value="pending">Pending Order</option>
                            <option value="uploaded">Pending Order (uploaded)</option>
                            <option value="scheduled">Awaiting Customer</option>
                            <option value="confirmed">Confirmed (tomorrow)</option>
                            <option value="scheduled-confirmed">Confirmed (future date)</option>
                            <option value="out-for-delivery">Out for Delivery</option>
                            <option value="in-transit">In Transit</option>
                            <option value="in-progress">In Progress</option>
                            <option value="delivered">Delivered</option>
                            <option value="delivered-with-installation">Delivered + Install</option>
                            <option value="delivered-without-installation">Delivered (no install)</option>
                            <option value="completed">Completed</option>
                            <option value="pod-completed">POD Completed</option>
                            <option value="cancelled">Cancelled</option>
                            <option value="rescheduled">Rescheduled</option>
                            <option value="returned">Returned / Failed</option>
                              </select>
                              <button
                            onClick={() => { setSelectedDelivery(delivery); setIsModalOpen(true); }}
                            className="px-2 py-1 text-xs text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-700 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
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
          <PaginationBar
            page={deliveryPage + 1}
            totalPages={totalPages}
            pageSize={PAGE_SIZE}
            total={filteredDeliveries.length}
            onPageChange={(n) => { setDeliveryPage(n - 1); deliveryTableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}
          />
        </div>
            </div>

            {/* Side widgets */}
            <div className="space-y-4">
              {/* Needs Attention */}
              <div className="pp-dash-soft-gradient p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Needs Attention</h3>
                  {deliveryAttentionFilter && (
                    <button
                      onClick={() => { setDeliveryAttentionFilter(null); setDeliveryPage(0); }}
                      className="text-xs text-red-500 dark:text-red-400 hover:underline flex items-center gap-0.5"
                    >
                      <XCircle className="w-3 h-3" /> Clear
                    </button>
                  )}
                </div>
                <div className="space-y-2">
                  {(
                    [
                      { key: 'overdue' as const, label: 'Pending Orders', count: actionItems.overdue, color: 'text-amber-600 dark:text-amber-400' },
                      { key: 'unassigned' as const, label: 'Unassigned', count: actionItems.unassigned, color: 'text-orange-600 dark:text-orange-400' },
                      { key: 'awaiting' as const, label: 'Awaiting Customer', count: actionItems.unconfirmed, color: 'text-purple-600 dark:text-purple-400' },
                    ] as const
                  ).map(({ key, label, count, color }) => (
                    <button
                      key={key}
                      onClick={() => {
                        if (deliveryAttentionFilter === key) {
                          setDeliveryAttentionFilter(null);
                        } else {
                          setDeliveryAttentionFilter(key);
                          setDeliveryStatusFilter('all');
                        }
                        setDeliveryPage(0);
                      }}
                      className={`w-full flex justify-between items-center p-2.5 rounded-lg text-left cursor-pointer transition-colors ${
                        deliveryAttentionFilter === key
                          ? 'bg-blue-50 dark:bg-blue-900/30 ring-1 ring-blue-300 dark:ring-blue-700'
                          : 'bg-white/80 dark:bg-gray-800/80 hover:bg-white dark:hover:bg-gray-800'
                      }`}
                    >
                      <span className="text-sm text-gray-700 dark:text-gray-300">{label}</span>
                      <span className={`font-bold ${color}`}>{count}</span>
                    </button>
                  ))}
                </div>
                {deliveryAttentionFilter && (
                  <p className="mt-2 text-xs text-blue-600 dark:text-blue-400 text-center">
                    Filtering by: <span className="font-semibold">{deliveryAttentionFilter === 'overdue' ? 'Pending Orders' : deliveryAttentionFilter === 'unassigned' ? 'Unassigned' : 'Awaiting Customer'}</span>
                    {' · '}
                    <button onClick={() => { setDeliveryAttentionFilter(null); setDeliveryPage(0); }} className="underline hover:no-underline">show all</button>
                  </p>
                )}
              </div>

              {/* Delivery Performance Charts — vertical */}
              <div className="pp-dash-card p-4">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-4">Delivery Performance</h3>

                {/* Donut */}
                {(() => {
                  const inProgress = Math.max(0, mgmtKpis.total - mgmtKpis.onTime.count - mgmtKpis.delay.count - mgmtKpis.cancel.count - mgmtKpis.reschedule.count);
                  const donutData = [
                    { name: 'On-Time', value: mgmtKpis.onTime.count, fill: '#16a34a' },
                    { name: 'Delayed', value: mgmtKpis.delay.count, fill: '#f97316' },
                    { name: 'Cancelled', value: mgmtKpis.cancel.count, fill: '#dc2626' },
                    { name: 'Rescheduled', value: mgmtKpis.reschedule.count, fill: '#ca8a04' },
                    { name: 'In Progress', value: inProgress, fill: '#94a3b8' },
                  ].filter(d => d.value > 0);
                  return (
                    <div className="mb-5">
                      <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Outcome Breakdown</p>
                      <div className="w-full h-[220px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={donutData}
                              cx="50%"
                              cy="50%"
                              innerRadius="38%"
                              outerRadius="62%"
                              paddingAngle={2}
                              dataKey="value"
                              isAnimationActive
                              animationDuration={900}
                            >
                              {donutData.map((entry, i) => (
                                <Cell key={i} fill={entry.fill} />
                              ))}
                            </Pie>
                            <Tooltip
                              {...RECHARTS_TOOLTIP_OVERVIEW}
                              formatter={(val: number | string) => [`${val} orders`, '']}
                            />
                            <Legend
                              iconType="circle"
                              iconSize={8}
                              wrapperStyle={{ fontSize: '11px', color: 'var(--chart-legend)' }}
                            />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  );
                })()}

                {/* Horizontal bar chart */}
                <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">QTY &amp; Rate</p>
                <div className="w-full h-[200px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      layout="vertical"
                      data={[
                        { name: 'On-Time', count: mgmtKpis.onTime.count, labelText: `${mgmtKpis.onTime.count} (${mgmtKpis.onTime.pct}%)`, fill: '#16a34a' },
                        { name: 'Delayed', count: mgmtKpis.delay.count, labelText: `${mgmtKpis.delay.count} (${mgmtKpis.delay.pct}%)`, fill: '#f97316' },
                        { name: 'Cancelled', count: mgmtKpis.cancel.count, labelText: `${mgmtKpis.cancel.count} (${mgmtKpis.cancel.pct}%)`, fill: '#dc2626' },
                        { name: 'Rescheduled', count: mgmtKpis.reschedule.count, labelText: `${mgmtKpis.reschedule.count} (${mgmtKpis.reschedule.pct}%)`, fill: '#ca8a04' },
                      ]}
                      margin={{ top: 4, right: 72, left: 4, bottom: 4 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" horizontal={false} />
                      <XAxis type="number" tick={{ fontSize: 11, fill: 'var(--chart-tick)' }} tickLine={false} axisLine={false} />
                      <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: 'var(--chart-tick)' }} tickLine={false} axisLine={false} width={68} />
                      <Tooltip
                        {...RECHARTS_TOOLTIP_OVERVIEW}
                        formatter={(val: number | string) => [val, 'Orders']}
                      />
                      <Bar dataKey="count" radius={[0, 4, 4, 0]} maxBarSize={28} isAnimationActive animationDuration={900}>
                        {[
                          { fill: '#16a34a' },
                          { fill: '#f97316' },
                          { fill: '#dc2626' },
                          { fill: '#ca8a04' },
                        ].map((c, i) => <Cell key={i} fill={c.fill} />)}
                        <LabelList dataKey="labelText" position="right" style={{ fontSize: 11, fill: 'var(--chart-tick)' }} />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════ BY AREA TAB ══════════════ */}
      {activeTab === 'by-area' && (
        <div className="space-y-4">
          {/* Six area KPIs */}
          <div className="pp-kpi-grid--six">
            {[
              { label: 'Active Areas', value: deliveryByAreaData.length, icon: MapPin, color: 'blue' },
              { label: 'Total Deliveries', value: deliveryByAreaData.reduce((s,r)=>s+(r.count||0),0), icon: Package, color: 'indigo' },
              { label: 'Top Region', value: deliveryByAreaData[0]?.area || '—', icon: Target, color: 'emerald' },
              { label: 'Top Area Share', value: `${areaKpis.topShare.toFixed(1)}%`, icon: TrendingUp, color: 'yellow', tooltip: 'Share of total deliveries handled by the busiest area. High values can indicate capacity concentration, so monitor whether one zone is overloaded.' },
              { label: 'Avg Area Success', value: `${areaKpis.avgSuccess.toFixed(1)}%`, icon: CheckCircle, color: 'green', tooltip: 'Average delivery success rate across all active areas. Use this to track service consistency between zones and quickly spot declining performance.' },
              { label: 'Largest Backlog', value: areaKpis.largestBacklog?.area ?? '—', icon: Clock, color: 'yellow', tooltip: 'Area currently holding the highest pending volume. Prioritize this zone for driver allocation or route optimization to prevent delays.' },
            ].map(({ label, value, icon: Icon, color, tooltip }) => {
              const c = KPI_COLOR_MAP[color];
              return (
                <div key={label} className="pp-dash-card p-3 relative flex items-center gap-2 sm:gap-3 w-full min-w-0 pr-8">
                  <span className="absolute top-2 right-2 text-gray-300 dark:text-slate-600 pointer-events-none" aria-hidden>
                    <ArrowUpRight className="w-3 h-3 sm:w-3.5 sm:h-3.5" strokeWidth={2} />
                  </span>
                  <div className={`p-2.5 rounded-full shrink-0 ${c.bg}`}><Icon className={`w-4 h-4 ${c.icon}`} /></div>
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
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-start">
            <div className="xl:col-span-5 flex flex-col gap-4 min-w-0">
              <div className="pp-dash-card p-4 sm:p-6">
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
                  <ResponsiveContainer width="100%" height={Math.max(260, deliveryByAreaEnhanced.length * 44)}>
                    <BarChart data={deliveryByAreaEnhanced} layout="vertical" margin={{ left: 4, right: 20, top: 5, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" horizontal={false} />
                      <XAxis type="number" tick={{ fontSize: 11, fill: 'var(--chart-tick)' }} tickLine={false} axisLine={false} />
                      <YAxis type="category" dataKey="area" width={100} tick={{ fontSize: 12, fill: 'var(--chart-tick-emphasis)' }} tickLine={false} axisLine={false} />
                      <Tooltip {...RECHARTS_TOOLTIP_12} />
                      <Bar dataKey="count" name="Deliveries" radius={[0, 4, 4, 0]} fill="#2563EB" isAnimationActive />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="text-center py-12 text-gray-400 dark:text-gray-500 text-sm">No area data available</p>
                )}
              </div>

              {deliveryByAreaEnhanced.length > 0 && (
                <div className="pp-dash-card p-4">
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-2">Area Performance Matrix</h3>
                  <p className="text-[10px] text-gray-400 mb-2">Deliveries (x) vs Success % (y), bubble size = pending</p>
                  <div style={{ width: '100%', height: 220, minHeight: 220 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <ScatterChart margin={{ top: 5, right: 10, bottom: 5, left: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                        <XAxis type="number" dataKey="count" name="Deliveries" tick={{ fontSize: 9, fill: 'var(--chart-tick)' }} tickLine={false} />
                        <YAxis type="number" dataKey="successRate" name="Success %" domain={[0, 100]} tick={{ fontSize: 9, fill: 'var(--chart-tick)' }} tickLine={false} />
                        <ZAxis type="number" dataKey="pending" range={[60, 400]} name="Pending" />
                        <Tooltip cursor={{ strokeDasharray: '3 3' }} {...RECHARTS_TOOLTIP} formatter={(val: number, name: string) => [name === 'successRate' ? `${val}%` : val, name]} />
                        <Scatter
                          data={deliveryByAreaEnhanced.map(r => ({ ...r, pending: Math.max(r.pending ?? 0, 1) }))}
                          fill="#2563EB"
                          fillOpacity={0.7}
                        />
                      </ScatterChart>
                    </ResponsiveContainer>
                  </div>
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
                <div className="xl:col-span-7 pp-dash-card p-6 min-h-0">
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
            <div className="pp-dash-card overflow-hidden">
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
              <table className="pp-mobile-stack-table w-full min-w-[900px]">
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
                        <td className="px-4 py-3 text-sm text-gray-400 dark:text-gray-500" data-label="#">{i + 1}</td>
                        <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-gray-100" data-label="Area">
                          <span className="flex items-center gap-2"><MapPin className="w-3.5 h-3.5 text-gray-400" />{row.area}</span>
                        </td>
                        <td className="px-4 py-3 text-sm text-right font-bold text-blue-600 dark:text-blue-400" data-label="Deliveries">{row.count}</td>
                        <td className="px-4 py-3 text-sm text-right text-gray-600 dark:text-gray-400" data-label="Share %">{share}%</td>
                        <td className="px-4 py-3 text-sm text-right text-yellow-600 dark:text-yellow-400" data-label="Pending">{row.pending ?? 0}</td>
                        <td className="px-4 py-3 text-sm text-right" data-label="Success %">
                          <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${(row.successRate ?? 0) >= 80 ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : (row.successRate ?? 0) >= 50 ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'}`}>
                            {(row.successRate ?? 0).toFixed(1)}%
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-center" data-label="Risk">
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
          {/* Six product KPIs */}
          <div className="pp-kpi-grid--six">
            {[
              { label: 'SKUs Tracked', value: topItemsData.length, icon: FileText, color: 'blue' },
              { label: 'Total Qty', value: topItemsData.reduce((s,r)=>s+(r.count||0),0), icon: Package, color: 'indigo' },
              { label: 'Best Seller', value: topItemsData[0]?.item?.slice(0, 18) || '—', icon: Target, color: 'emerald' },
              { label: 'Best Seller Qty', value: topItemsData[0]?.count ?? '—', icon: TrendingUp, color: 'yellow' },
              { label: 'Top SKU Share', value: `${productKpis.top1Share.toFixed(1)}%`, icon: Target, color: 'blue', tooltip: 'Percentage of total quantity contributed by your highest-volume SKU. If this grows too much, inventory and demand risk become concentrated on one item.' },
              { label: 'Concentration', value: productKpis.concentration, icon: Activity, color: 'emerald', tooltip: 'Overall product mix concentration (High/Medium/Low). High means fewer SKUs drive most volume; low means demand is spread more evenly across products.' },
            ].map(({ label, value, icon: Icon, color, tooltip }) => {
              const c = KPI_COLOR_MAP[color];
              return (
                <div key={label} className="pp-dash-card p-3 relative flex items-center gap-3 min-w-0 w-full pr-8">
                  <span className="absolute top-2 right-2 text-gray-300 dark:text-slate-600 pointer-events-none" aria-hidden>
                    <ArrowUpRight className="w-3 h-3 sm:w-3.5 sm:h-3.5" strokeWidth={2} />
                  </span>
                  <div className={`p-2.5 rounded-full shrink-0 ${c.bg}`}><Icon className={`w-4 h-4 ${c.icon}`} /></div>
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

          {/* Filter bar — advanced */}
          <div className="pp-dash-card p-4 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Filter className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
              <input
                type="text"
                placeholder="Search item, PNC, or model..."
                value={topItemsSearch}
                onChange={e => setTopItemsSearch(e.target.value)}
                className="flex-1 min-w-0 sm:min-w-[140px] md:min-w-[180px] px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <input type="number" min={0} placeholder="Min quantity" value={topItemsMinQty} onChange={e => setTopItemsMinQty(e.target.value)}
                className="w-28 px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100" title="Show items with at least this quantity" />
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
              {(topItemsSearch || topItemsMinQty) && (
                <button onClick={() => { setTopItemsSearch(''); setTopItemsMinQty(''); }}
                  className="flex items-center gap-1.5 px-3 py-2 text-sm text-gray-500 hover:text-red-600 dark:text-gray-400 dark:hover:text-red-400 transition-colors">
                  <RotateCcw className="w-3.5 h-3.5" /> Clear filters
                </button>
              )}
            </div>
          </div>

          {/* ~40% charts | ~60% table */}
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-start">
            <div className="xl:col-span-5 flex flex-col gap-4 min-w-0">
              {topItemsData.length > 0 ? (
                <div className="pp-dash-card p-4 sm:p-6">
                  <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-4">Top Items by Quantity + Cumulative Share</h2>
                  <ResponsiveContainer width="100%" height={Math.max(260, Math.min(topItemsData.length * 44, 500))}>
                    <ComposedChart
                      data={topItemsData.map((r, i) => {
                        const total = topItemsData.reduce((s, x) => s + (x.count ?? 0), 0);
                        const cum = topItemsData.slice(0, i + 1).reduce((s, x) => s + (x.count ?? 0), 0);
                        return { ...r, label: `${(r.item || '').slice(0, 24)}${(r.item || '').length > 24 ? '…' : ''}`, count: r.count, cumPct: total > 0 ? sharePct(cum, total) : 0 };
                      })}
                      layout="vertical"
                      margin={{ left: 4, right: 20, top: 5, bottom: 5 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" horizontal={false} />
                      <XAxis type="number" tick={{ fontSize: 11, fill: 'var(--chart-tick)' }} tickLine={false} axisLine={false} />
                      <YAxis type="category" dataKey="label" width={120} tick={{ fontSize: 10, fill: 'var(--chart-tick-emphasis)' }} tickLine={false} axisLine={false} />
                      <YAxis type="number" yAxisId="pct" orientation="right" domain={[0, 100]} tick={{ fontSize: 9, fill: 'var(--chart-tick-secondary)' }} tickFormatter={v => `${v}%`} width={36} tickLine={false} axisLine={false} />
                      <Tooltip {...RECHARTS_TOOLTIP_12} formatter={(val: number, name: string, props: { payload?: { cumPct?: number } }) => (name === 'Cum. Share' ? [`${(props?.payload?.cumPct ?? val).toFixed(1)}%`, name] : [val, name])} />
                      <Legend wrapperStyle={{ fontSize: '12px', color: 'var(--chart-legend)' }} />
                      <Bar dataKey="count" fill="#2563EB" radius={[0, 4, 4, 0]} name="Quantity" isAnimationActive />
                      <Line type="monotone" dataKey="cumPct" name="Cum. Share" stroke="#f59e0b" strokeWidth={2} strokeDasharray="4 4" dot={{ r: 2 }} yAxisId="pct" isAnimationActive />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="pp-dash-card p-4 sm:p-6">
                  <p className="text-center py-8 text-gray-400 dark:text-gray-500 text-sm">No product data available</p>
                </div>
              )}

              {topItemsData.length > 0 && (
                <div className="pp-dash-card p-4">
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-2">Product Portfolio Matrix</h3>
                  <p className="text-[10px] text-gray-400 mb-2">Volume (x) vs Share % (y)</p>
                  <ResponsiveContainer width="100%" height={200}>
                    <ScatterChart margin={{ top: 5, right: 10, bottom: 5, left: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                      <XAxis type="number" dataKey="count" name="Volume" tick={{ fontSize: 9, fill: 'var(--chart-tick)' }} tickLine={false} />
                      <YAxis type="number" dataKey="sharePct" name="Share %" tick={{ fontSize: 9, fill: 'var(--chart-tick)' }} tickLine={false} />
                      <Tooltip cursor={{ strokeDasharray: '3 3' }} {...RECHARTS_TOOLTIP} formatter={(val: number, name: string) => [name === 'sharePct' ? `${val}%` : val, name]} />
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

            <div className="xl:col-span-7 pp-dash-card overflow-hidden min-w-0">
            <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Item Detail</h3>
              <button onClick={() => exportCSV(topItemsTableData as unknown as Record<string, unknown>[], ['item', 'pnc', 'modelId', 'count', 'sharePct'], 'top-items')}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                <Download className="w-3.5 h-3.5" /> Export
              </button>
            </div>
            <div className="overflow-x-auto">
            <table className="pp-mobile-stack-table min-w-[860px]">
              <thead className="bg-gray-50 dark:bg-gray-700/50">
                <tr>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase text-left w-12">#</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase text-left">Item Name</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase text-left">PNC</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase text-left">Model ID</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase text-right">Orders</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase text-right">
                    <MetricTooltip term="Share %" definition="This item's quantity share out of total product volume in the current view." />
                  </th>
                  </tr>
                </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {topItemsTableData.length > 0 ? topItemsTableData.map((row, idx) => (
                  <tr key={idx} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    <td className="px-4 py-3 text-sm text-gray-400 dark:text-gray-500" data-label="#"> {idx + 1}</td>
                    <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-gray-100" data-label="Item Name">{row.item}</td>
                    <td className="px-4 py-3 text-sm font-mono text-gray-600 dark:text-gray-400" data-label="PNC">{row.pnc}</td>
                    <td className="px-4 py-3 text-sm font-mono text-gray-500 dark:text-gray-500" data-label="Model ID">{row.modelId || '—'}</td>
                    <td className="px-4 py-3 text-sm text-right font-bold text-blue-600 dark:text-blue-400" data-label="Orders">{row.count}</td>
                    <td className="px-4 py-3 text-sm text-right text-gray-600 dark:text-gray-400" data-label="Share %">{row.sharePct?.toFixed(1) ?? '—'}%</td>
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
          <div className="pp-kpi-grid--fill-4">
            {[
              { label: 'Total Drivers', value: drivers.length, icon: Users, color: 'blue' },
              { label: 'Online', value: driversData.filter(d => onlineUserIds.has(String(d.id))).length, icon: CheckCircle, color: 'green' },
              { label: 'Offline', value: driversData.filter(d => !onlineUserIds.has(String(d.id))).length, icon: Clock, color: 'yellow' },
              { label: 'On Route', value: drivers.filter(d => d.tracking?.status === 'in_progress').length, icon: Truck, color: 'indigo' },
            ].map(({ label, value, icon: Icon, color }) => {
              const c = KPI_COLOR_MAP[color];
              return (
                <div key={label} className="pp-dash-card p-3 sm:p-4 relative flex items-center justify-center gap-3 w-full min-w-0 pr-9">
                  <span className="absolute top-2.5 right-2.5 text-gray-300 dark:text-slate-600 pointer-events-none" aria-hidden>
                    <ArrowUpRight className="w-3.5 h-3.5" strokeWidth={2} />
                  </span>
                  <div className={`p-2.5 rounded-full shrink-0 ${c.bg}`}><Icon className={`w-4 h-4 ${c.icon}`} /></div>
                  <div className="min-w-0 text-center">
                    <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
                    <p className={`text-xl font-bold ${c.val}`}>{value}</p>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Two-column: Table | Performance widget */}
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            <div className="xl:col-span-2">
          <div className="pp-dash-card overflow-hidden">
            {/* Filter bar */}
            <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700 flex flex-wrap gap-2 items-center">
              <input type="text" placeholder="Search name or email..." value={driversSearch}
                onChange={e => setDriversSearch(e.target.value)}
                className="flex-1 min-w-0 sm:min-w-[140px] md:min-w-[180px] px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500" />
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
                className="ml-auto text-sm text-blue-600 dark:text-blue-400 hover:underline">
                Manage drivers →
              </button>
                                </div>

            {/* Table */}
            <div className="overflow-x-auto">
            <table className="pp-mobile-stack-table min-w-[760px]">
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
                      <td className="px-4 py-3" data-label="Driver">
                        <div className="flex items-center gap-3">
                          <div className="relative flex-shrink-0">
                            <div className="w-9 h-9 rounded-full bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center text-sm font-semibold text-blue-700 dark:text-blue-300">
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
                      <td className="px-4 py-3" data-label="Contact">
                        <div className="text-sm text-gray-600 dark:text-gray-400">{driver.email || '—'}</div>
                        <div className="text-xs text-gray-400 dark:text-gray-500">{driver.phone || '—'}</div>
                          </td>
                      <td className="px-4 py-3" data-label="Status">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-full ${isOnline ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${isOnline ? 'bg-green-500' : 'bg-gray-400'}`} />
                          {isOnline ? 'Online' : 'Offline'}
                              </span>
                          </td>
                      <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400" data-label="Last Seen">
                        {lastSeen
                          ? new Date(lastSeen).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
                          : '—'}
                          </td>
                      <td className="px-4 py-3" data-label="Actions">
                            <button
                          onClick={() => navigate(`/admin/operations?tab=communication&userId=${driver.id}`)}
                          className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
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
              <div className="pp-dash-card p-4">
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
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" horizontal={false} />
                      <XAxis type="number" tick={{ fontSize: 10, fill: 'var(--chart-tick)' }} allowDecimals={false} />
                      <YAxis type="category" dataKey="name" width={92} tick={{ fontSize: 10, fill: 'var(--chart-tick-emphasis)' }} />
                      <Tooltip
                        {...RECHARTS_TOOLTIP}
                        formatter={(v: number) => [`${v}`, 'Assigned']}
                      />
                      <Bar dataKey="count" fill="#2563eb" radius={[0, 4, 4, 0]} maxBarSize={18} name="Assigned" />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>

              <div className="pp-dash-card p-4">
                <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">Outcomes</h4>
                <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-2">Status mix for driver-assigned deliveries only</p>
                {!driverPanelAnalytics.hasAssignments ? (
                  <p className="text-center text-xs text-gray-400 dark:text-gray-500 py-10">No assigned deliveries to analyze.</p>
                ) : driverPanelAnalytics.outcomesPie.length === 0 ? (
                  <p className="text-center text-xs text-gray-400 dark:text-gray-500 py-10">No outcome data.</p>
                ) : (
                  <div style={{ width: '100%', height: 220, minHeight: 220 }}>
                    <ResponsiveContainer width="100%" height="100%">
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
                            <Cell key={i} fill={entry.fill} stroke="var(--surface)" strokeWidth={1} />
                          ))}
                        </Pie>
                        <Tooltip
                          {...RECHARTS_TOOLTIP}
                          formatter={(v: number, name: string) => [v, name]}
                        />
                        <Legend wrapperStyle={{ fontSize: '11px', color: 'var(--chart-legend)' }} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
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
