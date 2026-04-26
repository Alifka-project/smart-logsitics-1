import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  AlertCircle, Loader, MapPin, Truck, Clock, Package,
  Phone, CheckCircle, Navigation, Star, RefreshCw, ChevronRight, ArrowLeft,
  Calendar, MessageCircle
} from 'lucide-react';
import { MapContainer, TileLayer, Marker, Popup, Polyline } from 'react-leaflet';
import L from 'leaflet';
import type { Delivery, TrackingEvent } from '../types';
import { createDriverMarkerIcon, createDeliveryIconForDelivery } from '../utils/mapIcons';

delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: '/leaflet-images/marker-icon-2x.png',
  iconUrl: '/leaflet-images/marker-icon.png',
  shadowUrl: '/leaflet-images/marker-shadow.png',
});

// ── Global CSS animations ────────────────────────────────────────────────────
const STYLES = `
  @keyframes fadeUp {
    from { opacity: 0; transform: translateY(24px); }
    to   { opacity: 1; transform: translateY(0);    }
  }
  @keyframes scaleIn {
    from { opacity: 0; transform: scale(0.7); }
    to   { opacity: 1; transform: scale(1);   }
  }
  @keyframes progressLine {
    from { height: 0; }
    to   { height: 100%; }
  }
  @keyframes ripple {
    0%   { box-shadow: 0 0 0 0   rgba(0,80,130,0.25); }
    70%  { box-shadow: 0 0 0 14px rgba(0,80,130,0);   }
    100% { box-shadow: 0 0 0 0   rgba(0,80,130,0);    }
  }
  @keyframes shimmer {
    0%   { background-position: -400px 0; }
    100% { background-position:  400px 0; }
  }
  .anim-card { animation: fadeUp 0.5s ease both; }
  .anim-card-1 { animation-delay: 0.05s; }
  .anim-card-2 { animation-delay: 0.12s; }
  .anim-card-3 { animation-delay: 0.19s; }
  .anim-card-4 { animation-delay: 0.26s; }
  .anim-card-5 { animation-delay: 0.33s; }
  .anim-card-6 { animation-delay: 0.40s; }
  .anim-icon   { animation: scaleIn 0.4s cubic-bezier(0.34,1.56,0.64,1) both; }

  .card {
    background: #fff;
    border-radius: 20px;
    box-shadow: 0 2px 16px rgba(0,0,0,0.06);
    border: 1px solid #f1f5f9;
  }
  .card-hover {
    transition: transform 0.2s ease, box-shadow 0.2s ease;
    cursor: default;
  }
  .card-hover:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 28px rgba(0,0,0,0.1);
  }
  .btn-call {
    display: flex; align-items: center; justify-content: center;
    width: 44px; height: 44px; border-radius: 50%;
    background: linear-gradient(135deg, #032145 0%, #115a96 100%);
    color: #fff; border: none; cursor: pointer;
    transition: transform 0.2s, box-shadow 0.2s;
    animation: ripple 2s infinite;
    text-decoration: none;
    flex-shrink: 0;
  }
  .btn-call:hover { transform: scale(1.08); box-shadow: 0 4px 16px rgba(3,33,69,0.4); }
  .btn-call:active { transform: scale(0.97); }

  .btn-refresh {
    display: flex; align-items: center; gap: 6px;
    padding: 8px 16px; border-radius: 50px;
    border: 1.5px solid #e2e8f0; background: #fff;
    font-size: 12px; font-weight: 600; color: #475569;
    cursor: pointer; transition: all 0.2s ease;
  }
  .btn-refresh:hover { border-color: #032145; color: #032145; background: #f3f6fa; }
  .btn-refresh:active { transform: scale(0.97); }
  .btn-refresh.spinning svg { animation: spin 1s linear infinite; }
  @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

  .driver-actions {
    display: flex; gap: 8px; margin-top: 8px;
  }
  .btn-driver-action {
    flex: 1;
    display: flex; align-items: center; justify-content: center; gap: 6px;
    padding: 7px 8px; border-radius: 10px; font-size: 11px; font-weight: 700;
    text-decoration: none; border: 1px solid #e2e8f0; background: #f8fafc; color: #0f172a;
    box-sizing: border-box; min-width: 0;
    transition: background 0.15s ease, border-color 0.15s ease;
  }
  .btn-driver-action:hover { background: #f3f6fa; border-color: #03214533; }
  .btn-driver-action--primary {
    background: linear-gradient(135deg, #032145 0%, #115a96 100%);
    color: #fff; border-color: transparent;
  }
  .btn-driver-action--primary:hover { filter: brightness(1.05); }

  .step-line-fill {
    width: 2px; background: #032145;
    animation: progressLine 0.7s ease both;
    animation-delay: 0.3s;
  }
  .toggle-track {
    width: 44px; height: 24px; border-radius: 50px;
    background: #e2e8f0; position: relative;
    cursor: pointer; transition: background 0.3s ease;
  }
  .toggle-track.on { background: linear-gradient(135deg, #032145, #115a96); }
  .toggle-thumb {
    position: absolute; top: 3px; left: 3px;
    width: 18px; height: 18px; border-radius: 50%;
    background: #fff; box-shadow: 0 1px 4px rgba(0,0,0,0.2);
    transition: transform 0.3s cubic-bezier(0.34,1.56,0.64,1);
  }
  .toggle-track.on .toggle-thumb { transform: translateX(20px); }

  .status-chip {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 4px 12px; border-radius: 50px;
    font-size: 11px; font-weight: 700; letter-spacing: 0.5px;
  }
  @keyframes beat {
    0%   { transform: scale(1);   box-shadow: 0 0 0 0 rgba(3,33,69,0.25); }
    40%  { transform: scale(1.08); box-shadow: 0 0 0 8px rgba(3,33,69,0); }
    100% { transform: scale(1);   box-shadow: 0 0 0 0 rgba(3,33,69,0); }
  }
  .step-icon-current {
    animation: beat 1.4s ease-out infinite;
  }
  .shimmer-line {
    background: linear-gradient(90deg, #f1f5f9 25%, #e2e8f0 50%, #f1f5f9 75%);
    background-size: 400px 100%;
    animation: shimmer 1.2s infinite linear;
    border-radius: 8px;
  }
`;

interface TimelineStep {
  id: string;
  label: string;
  desc: string;
  icon: React.ComponentType<{ style?: React.CSSProperties }>;
  matchStatuses: string[];
  matchEvents: string[];
}

interface StatusHero {
  bg: string;
  color: string;
  label: string;
  icon: React.ComponentType<{ style?: React.CSSProperties }>;
  title: string;
  subtitle: string;
}

interface DriverInfo {
  name?: string;
  phone?: string;
}

interface DriverLocationInfo {
  latitude: number;
  longitude: number;
}

type EtaPayload =
  | { mode: 'planned'; earliest: string; latest: string; center: string; degraded?: boolean }
  | { mode: 'live'; eta: string; driverUpdatedAt: string; distanceKm: number; freshness: 'fresh' | 'stale' }
  | { mode: 'static'; eta: string }
  | { mode: 'delivered'; at: string }
  | { mode: 'pending' };

interface TrackingInfoResponse {
  /** Live GPS is intentionally NO LONGER sent to customers; server always null. */
  driverLocation?: DriverLocationInfo | null;
  driver?: DriverInfo | null;
  /** Legacy flat ETA string — kept for backwards compatibility. Use `etaPayload`. */
  eta?: string | null;
  /** Status-driven ETA: planned slot window, locked static ETA, or final deliveredAt. */
  etaPayload?: EtaPayload;
  status?: string | null;
}

interface TrackingDelivery extends Delivery {
  confirmedDeliveryDate?: string;
  rescheduleReason?: string | null;
  rescheduledAt?: string | null;
  deliveryNumber?: string | null;
  originalDeliveryNumber?: string | null;
  /** Set by notify-arrival endpoint — used as a fallback alongside DeliveryEvent */
  arrivalNotifiedAt?: string | null;
}

interface TrackingData {
  delivery: TrackingDelivery;
  tracking: TrackingInfoResponse;
  timeline?: TrackingEvent[];
}

// ── Timeline steps ───────────────────────────────────────────────────────────
const TIMELINE_STEPS: TimelineStep[] = [
  { id: 'order_processed', label: 'Order Processed', desc: 'Your order has been received', icon: Package,
    matchStatuses: ['pending', 'uploaded'], matchEvents: ['delivery_uploaded', 'order_created'] },
  { id: 'order_scheduled', label: 'Order Scheduled', desc: 'Delivery date confirmed & order is being prepared', icon: Calendar,
    matchStatuses: ['scheduled', 'confirmed', 'scheduled-confirmed', 'rescheduled', 'pgi-done', 'pgi_done', 'pickup-confirmed', 'pickup_confirmed'], matchEvents: ['customer_confirmed', 'delivery_scheduled', 'admin_rescheduled', 'pgi_done', 'picking_confirmed'] },
  { id: 'out_for_delivery', label: 'Out for Delivery', desc: 'On its way to you', icon: Truck,
    matchStatuses: ['out-for-delivery', 'in-transit'], matchEvents: ['out_for_delivery', 'status_updated_out_for_delivery', 'delivery_started'] },
  { id: 'items_arrived', label: 'Items Arrived', desc: 'Driver is at your door', icon: MapPin,
    matchStatuses: [], matchEvents: ['driver_arrived', 'delivery_completed', 'status_updated_delivered'] },
  { id: 'order_finished', label: 'Order Finished', desc: 'All done — thank you!', icon: Star,
    matchStatuses: ['delivered', 'delivered-with-installation', 'delivered-without-installation', 'finished', 'completed', 'pod-completed'], matchEvents: ['pod_completed', 'order_finished'] },
];

/**
 * Drop timeline events that pre-date the most recent reschedule. After a
 * reschedule the prior attempt's `driver_arrived`, `delivery_started`, etc.
 * are no longer valid for the current cycle — DeliveryEvent rows are
 * append-only audit history, so we must filter them on read instead of
 * deleting them. When `rescheduledAt` is null the filter is a no-op.
 */
function filterEventsAfterReschedule(
  timeline: TrackingEvent[] | undefined,
  rescheduledAt: string | null | undefined,
): TrackingEvent[] {
  if (!timeline) return [];
  if (!rescheduledAt) return timeline;
  const cutoff = new Date(rescheduledAt).getTime();
  if (!Number.isFinite(cutoff)) return timeline;
  return timeline.filter(ev => {
    const t = ev.timestamp ? new Date(ev.timestamp as string).getTime() : NaN;
    return Number.isFinite(t) && t >= cutoff;
  });
}

function resolveCurrentStep(
  status: string | null | undefined,
  timeline: TrackingEvent[] | undefined,
  arrivalNotifiedAt?: string | null,
  rescheduledAt?: string | null,
): number {
  const s = (status || '').toLowerCase();

  // Filter out events that pre-date the most recent reschedule. Without
  // this, a `driver_arrived` event from a previous attempt would advance
  // the timeline to "Items Arrived" even after the order has been pushed
  // back to a future date and the driver hasn't started the new attempt.
  const validEvents = filterEventsAfterReschedule(timeline, rescheduledAt);

  // Compute three independent candidate step indices. -1 means "no signal".
  let byStatus = -1;
  for (let i = TIMELINE_STEPS.length - 1; i >= 0; i--) {
    if (TIMELINE_STEPS[i].matchStatuses.includes(s)) { byStatus = i; break; }
  }

  let byMetadata = -1;
  if (arrivalNotifiedAt) {
    // arrivalNotifiedAt always maps to the items_arrived step
    for (let i = 0; i < TIMELINE_STEPS.length; i++) {
      if (TIMELINE_STEPS[i].id === 'items_arrived') { byMetadata = i; break; }
    }
  }

  let byEvents = -1;
  for (let i = TIMELINE_STEPS.length - 1; i >= 0; i--) {
    if (validEvents.some(e => TIMELINE_STEPS[i].matchEvents.includes(e.type as string))) {
      byEvents = i; break;
    }
  }

  // Regression statuses force the timeline back to wherever their status
  // maps, ignoring any stale arrivalNotifiedAt or driver_arrived events
  // from a previous attempt. Without this, a delivery that was
  // rescheduled while out-for-delivery would still show "Items Arrived"
  // because the old metadata + event row are still present.
  //
  // Only statuses that genuinely *retreat* the lifecycle belong here.
  // 'cancelled', 'failed', 'returned' aren't in any matchStatuses (so
  // byStatus is -1 for them) but we still treat them as regressions so
  // a stale forward signal can't mark them as "Items Arrived".
  const REGRESSION_STATUSES = new Set([
    'rescheduled', 'cancelled', 'failed', 'returned',
  ]);
  if (REGRESSION_STATUSES.has(s)) {
    return byStatus >= 0 ? byStatus : 0;
  }

  // Forward case: take the highest index across all three signals so an
  // arrival flag (or a driver_arrived event) can advance the timeline
  // past the raw status. This is the case the user sees when the driver
  // taps "Arrived" while status is still 'out-for-delivery' — the SMS
  // fires, metadata.arrivalNotifiedAt is set, and the customer page must
  // reflect "Items Arrived" without waiting for POD completion.
  const max = Math.max(byStatus, byMetadata, byEvents);
  return max >= 0 ? max : 0;
}

function getStepTimestamp(
  step: TimelineStep,
  timeline: TrackingEvent[] | undefined,
  arrivalNotifiedAt?: string | null,
  rescheduledAt?: string | null,
): string | Date | null {
  // Same reschedule-cutoff filter as resolveCurrentStep so step timestamps
  // don't pull from a previous attempt's events. Otherwise the "Items
  // Arrived" row would render with the prior cycle's arrival time even
  // though the timeline step itself has correctly retreated.
  const validEvents = filterEventsAfterReschedule(timeline, rescheduledAt);
  for (const ev of validEvents) {
    if (step.matchEvents.includes(ev.type as string)) return ev.timestamp;
  }
  // Fallback for items_arrived: use the metadata timestamp if no event row yet
  if (step.id === 'items_arrived' && arrivalNotifiedAt) return arrivalNotifiedAt;
  return null;
}

function displayDeliveryNumberForCustomer(d: TrackingDelivery): string | null {
  const fromFile = d.originalDeliveryNumber?.trim();
  const col = d.deliveryNumber?.trim();
  if (fromFile) return fromFile;
  if (col) return col;
  return null;
}

// ── Status hero config (top card) ────────────────────────────────────────────
const STATUS_HERO: Record<number, StatusHero> = {
  0: {
    bg: '#FFFFFF',
    color: '#1D4ED8',
    label: 'Processing',
    icon: Package,
    title: 'Order received',
    subtitle: "We're preparing your items for delivery.",
  },
  1: {
    bg: '#FFFFFF',
    color: '#0891B2',
    label: 'Scheduled',
    icon: Calendar,
    title: 'Delivery date booked',
    subtitle: 'Your delivery date has been confirmed and your order is being prepared.',
  },
  2: {
    bg: '#FFFFFF',
    color: '#C2410C',
    label: 'On route',
    icon: Truck,
    title: 'Out for delivery',
    subtitle: 'Your driver is heading to your address.',
  },
  3: {
    bg: '#FFFFFF',
    color: '#15803D',
    label: 'Arrived',
    icon: MapPin,
    title: 'Your driver is here!',
    subtitle: 'Your delivery team has arrived at your address — please be ready to receive your items.',
  },
  4: {
    bg: '#FFFFFF',
    color: '#7E22CE',
    label: 'Completed',
    icon: Star,
    title: 'Order finished',
    subtitle: 'Thank you for choosing Electrolux.',
  },
};

// ── Skeleton loader ──────────────────────────────────────────────────────────
function Skeleton() {
  return (
    <div className="min-h-screen bg-gray-50">
      <style>{STYLES}</style>
      <div style={{ background: 'linear-gradient(135deg, #032145 0%, #115a96 100%)', padding: '20px 16px 24px' }}>
        <div style={{ maxWidth: 'min(680px, 100%)', margin: '0 auto' }}>
          <div className="shimmer-line" style={{ height: 28, width: 120, marginBottom: 12 }} />
          <div className="shimmer-line" style={{ height: 20, width: 180 }} />
        </div>
      </div>
      <div style={{ maxWidth: 'min(680px, 100%)', margin: '0 auto', padding: '20px 16px' }}>
        {[1,2,3].map(i => (
          <div key={i} className="card" style={{ padding: 20, marginBottom: 12 }}>
            <div className="shimmer-line" style={{ height: 16, width: '60%', marginBottom: 10 }} />
            <div className="shimmer-line" style={{ height: 12, width: '90%', marginBottom: 8 }} />
            <div className="shimmer-line" style={{ height: 12, width: '70%' }} />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function CustomerTrackingPage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [tracking, setTracking] = useState<TrackingData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>('');
  const [autoRefresh, setAutoRefresh] = useState<boolean>(true);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [routePolyline, setRoutePolyline] = useState<[number, number][] | null>(null);

  const fetchTracking = useCallback(async (manual = false): Promise<void> => {
    try {
      if (manual) setRefreshing(true);
      const response = await fetch(`/api/customer/tracking/${token}`);
      const data = await response.json() as Record<string, unknown>;
      if (!response.ok) {
        setError((data.message as string) || (data.error as string) || 'Failed to load tracking');
        return;
      }
      setTracking(data as unknown as TrackingData);
      setLastUpdated(new Date());
      setError('');
    } catch (err: unknown) {
      const e = err as { message?: string };
      setError(e.message || 'Failed to fetch tracking data');
    } finally {
      setLoading(false);
      if (manual) setTimeout(() => setRefreshing(false), 600);
    }
  }, [token]);

  useEffect(() => {
    void fetchTracking();
    if (autoRefresh) {
      const iv = setInterval(() => void fetchTracking(), 30000);
      return () => clearInterval(iv);
    }
  }, [token, autoRefresh, fetchTracking]);

  useEffect(() => {
    if (!token || !tracking?.delivery || !tracking.tracking) {
      setRoutePolyline(null);
      return;
    }
    const d = tracking.delivery;
    const loc = tracking.tracking.driverLocation;
    if (!d.lat || !d.lng || loc?.latitude == null || loc?.longitude == null) {
      setRoutePolyline(null);
      return;
    }
    const ac = new AbortController();
    void (async () => {
      try {
        const params = new URLSearchParams({
          fromLat: String(loc.latitude),
          fromLng: String(loc.longitude),
          toLat: String(d.lat),
          toLng: String(d.lng),
        });
        const res = await fetch(
          `/api/customer/driving-route/${encodeURIComponent(token)}?${params}`,
          { signal: ac.signal },
        );
        const data = (await res.json()) as { coordinates?: [number, number][] };
        if (res.ok && Array.isArray(data.coordinates) && data.coordinates.length >= 2) {
          setRoutePolyline(data.coordinates);
        } else {
          setRoutePolyline(null);
        }
      } catch (e) {
        if ((e as { name?: string }).name !== 'AbortError') {
          setRoutePolyline(null);
        }
      }
    })();
    return () => ac.abort();
  }, [token, tracking]);

  if (loading) return <Skeleton />;

  if (error && !tracking) return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gray-50">
      <style>{STYLES}</style>
      <div className="card" style={{ padding: 32, maxWidth: 400, width: '100%', textAlign: 'center' }}>
        <div className="anim-icon" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 64, height: 64, borderRadius: '50%', background: '#FEF2F2', marginBottom: 16 }}>
          <AlertCircle style={{ color: '#EF4444', width: 32, height: 32 }} />
        </div>
        <h2 style={{ fontWeight: 700, fontSize: 18, color: '#1e293b', marginBottom: 8 }}>Tracking Unavailable</h2>
        <p style={{ color: '#64748b', fontSize: 14, marginBottom: 24 }}>{error}</p>
        <button onClick={() => window.location.reload()} style={{ padding: '10px 28px', borderRadius: 50, border: 'none', background: 'linear-gradient(135deg,#032145,#115a96)', color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
          Try Again
        </button>
      </div>
    </div>
  );

  if (!tracking) return null;

  const { delivery, tracking: trackingInfo, timeline } = tracking;
  const currentStep = resolveCurrentStep(delivery.status, timeline, delivery.arrivalNotifiedAt, delivery.rescheduledAt);
  const hero = STATUS_HERO[currentStep] || STATUS_HERO[0];
  const customerDeliveryNo = displayDeliveryNumberForCustomer(delivery);

  // ── Compute ETA range text once — used in both timeline step and ETA card ──
  const fmtEtaTime = (d: Date): string => d.toLocaleTimeString('en-AE', { timeZone: 'Asia/Dubai', hour: '2-digit', minute: '2-digit' });
  /**
   * Relative Dubai-day label ("Today" / "Tomorrow" / "Wed, 25 Apr") so the
   * customer can't mistake the evening arrival for the next morning, and so
   * tomorrow's delivery doesn't look like today's once the time-of-day is
   * close to now.
   */
  const fmtEtaDateLabel = (d: Date): string => {
    const dubaiDayStr = (v: Date): string => {
      const z = new Date(v.toLocaleString('en-US', { timeZone: 'Asia/Dubai' }));
      return `${z.getFullYear()}-${String(z.getMonth() + 1).padStart(2, '0')}-${String(z.getDate()).padStart(2, '0')}`;
    };
    const today = dubaiDayStr(new Date());
    const tomorrowDt = new Date();
    tomorrowDt.setDate(tomorrowDt.getDate() + 1);
    const tomorrow = dubaiDayStr(tomorrowDt);
    const target = dubaiDayStr(d);
    if (target === today) return 'Today';
    if (target === tomorrow) return 'Tomorrow';
    return d.toLocaleDateString('en-AE', {
      timeZone: 'Asia/Dubai',
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    });
  };
  const etaRangeText: string | null = (() => {
    const payload = trackingInfo.etaPayload;
    if (!payload || payload.mode === 'pending') return null;
    if (payload.mode === 'planned') {
      const base = new Date(payload.center);
      const end = new Date(base.getTime() + 4 * 60 * 60 * 1000);
      return `${fmtEtaDateLabel(base)}, ${fmtEtaTime(base)} – ${fmtEtaTime(end)}`;
    }
    if (payload.mode === 'live') {
      // Live ETA uses the same 4-hour range format as planned/static for
      // visual parity. The live computation still runs server-side so the
      // base timestamp (and therefore the date) refreshes with driver GPS —
      // the customer just doesn't see it labelled as "Real-time".
      const base = new Date(payload.eta);
      const end = new Date(base.getTime() + 4 * 60 * 60 * 1000);
      return `${fmtEtaDateLabel(base)}, ${fmtEtaTime(base)} – ${fmtEtaTime(end)}`;
    }
    if (payload.mode === 'static') {
      const base = new Date(payload.eta);
      const end = new Date(base.getTime() + 4 * 60 * 60 * 1000);
      return `${fmtEtaDateLabel(base)}, ${fmtEtaTime(base)} – ${fmtEtaTime(end)}`;
    }
    return null;
  })();

  const mapCenter: [number, number] = delivery.lat && delivery.lng
    ? [delivery.lat, delivery.lng]
    : (trackingInfo.driverLocation
      ? [trackingInfo.driverLocation.latitude, trackingInfo.driverLocation.longitude]
      : [25.2048, 55.2708]);

  const straightFallback: [number, number][] = [];
  if (delivery.lat && delivery.lng) straightFallback.push([delivery.lat, delivery.lng]);
  if (trackingInfo.driverLocation) {
    straightFallback.push([
      trackingInfo.driverLocation.latitude,
      trackingInfo.driverLocation.longitude,
    ]);
  }
  const mapLinePositions: [number, number][] =
    routePolyline && routePolyline.length >= 2
      ? routePolyline
      : straightFallback.length === 2
        ? straightFallback
        : [];

  const rawItems = delivery.items as unknown;
  const items: Array<string | Record<string, unknown>> = Array.isArray(rawItems)
    ? rawItems as Array<string | Record<string, unknown>>
    : (rawItems ? [rawItems as string] : []);

  return (
    <div style={{ minHeight: '100vh', background: '#F8FAFC' }}>
      <style>{STYLES}</style>

      {/* ── Header ──────────────────────────────────────────────────── */}
      <div style={{ background: 'linear-gradient(135deg, #032145 0%, #115a96 100%)', padding: '14px 16px 24px' }}>
        <div style={{ maxWidth: 'min(680px, 100%)', margin: '0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <button
              onClick={() => navigate(-1)}
              style={{
                border: 'none',
                background: 'rgba(15,23,42,0.35)',
                borderRadius: 999,
                padding: '7px 11px',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                color: '#E5E7EB',
                cursor: 'pointer'
              }}
            >
              <ArrowLeft style={{ width: 16, height: 16 }} />
              <span style={{ fontSize: 12, fontWeight: 600 }}>Back</span>
            </button>
            <img src="/elect home.png" alt="Electrolux" style={{ height: 22, filter: 'brightness(0) invert(1)' }} />
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-start' }}>
            <div style={{ minWidth: 0 }}>
              <h1 style={{ color: '#fff', fontSize: 22, lineHeight: 1.12, fontWeight: 800, marginBottom: 6 }}>Delivery Tracking</h1>
              {delivery.poNumber && (
                <p style={{ display: 'inline-flex', alignItems: 'center', background: 'rgba(15,23,42,0.28)', color: 'rgba(255,255,255,0.9)', borderRadius: 999, border: '1px solid rgba(255,255,255,0.12)', padding: '3px 10px', fontSize: 11, fontWeight: 600 }}>
                  PO: {delivery.poNumber}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 'min(680px, 100%)', margin: '0 auto', padding: '0 16px 32px', marginTop: -12 }}>

        {/* ── Status Hero Card ─────────────────────────────────────── */}
        <div className="card anim-card anim-card-1" style={{ padding: '18px 18px', marginBottom: 12, background: hero.bg, border: `1px solid ${hero.color}22` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div className="anim-icon" style={{ width: 56, height: 56, borderRadius: 18, background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: '0 8px 20px rgba(15,23,42,0.12)' }}>
              <div style={{ width: 38, height: 38, borderRadius: 14, background: `linear-gradient(135deg, ${hero.color} 0%, ${hero.color}CC 100%)`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {(() => {
                  const Icon = hero.icon || Package;
                  return <Icon style={{ width: 20, height: 20, color: '#ffffff' }} />;
                })()}
              </div>
            </div>
            <div style={{ flex: 1 }}>
              <span className="status-chip" style={{ background: hero.color, color: '#fff', marginBottom: 4 }}>
                {hero.label}
              </span>
              <p style={{ fontWeight: 700, fontSize: 16, color: '#1e293b', marginTop: 4 }}>
                {hero.title}
              </p>
              <p style={{ fontSize: 13, color: '#64748b', marginTop: 2 }}>
                {hero.subtitle}
              </p>
            </div>
          </div>
        </div>

        {/* ── Rescheduled Banner ───────────────────────────────────── */}
        {(delivery.status === 'rescheduled' || delivery.rescheduledAt) && (() => {
          // Resolve reason: prefer delivery metadata, fall back to timeline event payload
          const reasonFromDelivery = delivery.rescheduleReason;
          const reasonFromEvent = timeline
            ?.filter(ev => ev.type === 'admin_rescheduled')
            .sort((a, b) => new Date(b.timestamp as string).getTime() - new Date(a.timestamp as string).getTime())
            [0]?.payload?.reason as string | undefined;
          const rescheduleReason = reasonFromDelivery || reasonFromEvent || null;
          return (
          <div className="anim-card anim-card-2" style={{
            background: '#FFFBEB',
            border: '1px solid #FCD34D',
            borderRadius: 16,
            padding: '14px 18px',
            marginBottom: 12,
            display: 'flex',
            gap: 12,
            alignItems: 'flex-start',
          }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: '#FEF3C7', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <Calendar style={{ width: 18, height: 18, color: '#D97706' }} />
            </div>
            <div style={{ flex: 1 }}>
              <p style={{ fontWeight: 700, fontSize: 14, color: '#92400E', marginBottom: 4 }}>Delivery Rescheduled</p>
              {delivery.confirmedDeliveryDate && (
                <p style={{ fontSize: 13, color: '#78350F', marginBottom: 4 }}>
                  <strong>New delivery date: </strong>
                  {new Date(delivery.confirmedDeliveryDate).toLocaleDateString('en-AE', { timeZone: 'Asia/Dubai', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                </p>
              )}
              {rescheduleReason && (
                <p style={{ fontSize: 13, color: '#78350F', marginBottom: 4 }}>
                  <strong>Reason: </strong>{rescheduleReason}
                </p>
              )}
              <p style={{ fontSize: 12, color: '#92400E' }}>
                We apologise for any inconvenience. Your order has been rescheduled by the Electrolux Delivery Team.
              </p>
            </div>
          </div>
          );
        })()}

        {/* ── 5-Step Progress Timeline ─────────────────────────────── */}
        <div className="card anim-card anim-card-2" style={{ padding: '20px', marginBottom: 12 }}>
          <h2 style={{ fontWeight: 700, fontSize: 15, color: '#1e293b', marginBottom: 20 }}>Delivery Progress</h2>
          <div style={{ position: 'relative' }}>
            {TIMELINE_STEPS.map((step, idx) => {
              const isDone    = idx < currentStep;
              const isActive  = idx === currentStep;
              const isPending = idx > currentStep;
              const Icon      = step.icon;
              const ts        = getStepTimestamp(step, timeline, delivery.arrivalNotifiedAt, delivery.rescheduledAt);
              const isLast    = idx === TIMELINE_STEPS.length - 1;

              return (
                <div key={step.id} style={{ display: 'flex', gap: 14, position: 'relative' }}>
                  {/* Connector */}
                  {!isLast && (
                    <div style={{ position: 'absolute', left: 19, top: 44, width: 2, background: isDone ? '#032145' : '#e2e8f0', bottom: 0, zIndex: 0 }}
                      className={isDone ? 'step-line-fill' : ''} />
                  )}

                  {/* Icon circle */}
                  <div style={{
                    width: 40, height: 40, borderRadius: '50%', flexShrink: 0, zIndex: 1,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: isDone ? '#032145' : isActive ? '#fff' : '#f8fafc',
                    border: isDone ? '2px solid #032145' : isActive ? '2.5px solid #032145' : '2px solid #e2e8f0',
                    boxShadow: isActive ? '0 0 0 5px rgba(3,33,69,0.12)' : 'none',
                    transition: 'all 0.3s ease',
                  }} className={isActive ? 'step-icon-current' : ''}>
                    {isDone
                      ? <CheckCircle style={{ width: 18, height: 18, color: '#fff' }} />
                      : <Icon style={{ width: 17, height: 17, color: isActive ? '#032145' : '#cbd5e1' }} />
                    }
                  </div>

                  {/* Text */}
                  <div style={{ paddingBottom: isLast ? 0 : 24, flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 700, fontSize: 14, color: isPending ? '#94a3b8' : '#1e293b' }}>
                        {step.label}
                      </span>
                      {isActive && (
                        <span style={{ padding: '2px 10px', borderRadius: 50, fontSize: 11, fontWeight: 700, background: '#032145', color: '#fff' }}>
                          Current
                        </span>
                      )}
                      {isDone && (
                        <span style={{ padding: '2px 10px', borderRadius: 50, fontSize: 11, fontWeight: 600, background: '#DCFCE7', color: '#15803D' }}>
                          Done
                        </span>
                      )}
                    </div>
                    {!isPending && (
                      <p style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{step.desc}</p>
                    )}
                    {ts && (
                      <p style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
                        {new Date(ts as string).toLocaleString('en-AE', { timeZone: 'Asia/Dubai', dateStyle: 'medium', timeStyle: 'short' })}
                      </p>
                    )}
                    {isActive && etaRangeText && (step.id === 'order_scheduled' || step.id === 'out_for_delivery') && (
                      <p style={{ fontSize: 12, fontWeight: 700, color: '#16A34A', marginTop: 4 }}>
                        ETA: {etaRangeText}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Delivery Date + Driver (compact) ─────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginBottom: 12 }}>
          {(() => {
            const payload = trackingInfo.etaPayload;
            if (!payload || payload.mode === 'pending') return null;
            // Delivered state — show actual delivery time
            if (payload.mode === 'delivered') {
              const d = new Date(payload.at);
              const fmtDT = (dt: Date): string => dt.toLocaleString('en-AE', { timeZone: 'Asia/Dubai', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
              return (
                <div className="card anim-card anim-card-3" style={{ padding: '10px 12px', border: '1.5px solid #BBF7D0', background: 'linear-gradient(135deg,#F0FDF4,#DCFCE7)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 28, height: 28, borderRadius: 8, background: '#DCFCE7', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <Navigation style={{ width: 14, height: 14, color: '#16A34A' }} />
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <p style={{ fontSize: 9, fontWeight: 700, color: '#15803D', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 2 }}>Delivered</p>
                      <p style={{ fontWeight: 700, fontSize: 12, color: '#14532D', lineHeight: 1.25 }}>{fmtDT(d)}</p>
                      <p style={{ fontSize: 10, color: '#15803D', marginTop: 1 }}>Thank you for choosing Electrolux</p>
                    </div>
                  </div>
                </div>
              );
            }
            // Planned / live / static all share the same card presentation —
            // "Estimated Arrival" with the 4-hour window. Live mode updates
            // the underlying timestamp server-side (driver GPS drives it), so
            // the date and time refresh naturally without the customer-facing
            // UI having to advertise it.
            // Once the driver has arrived (timeline step >= items_arrived),
            // the ETA is no longer meaningful — suppress the card so the
            // customer sees only "Your driver is here" / delivered state.
            const ITEMS_ARRIVED_STEP = 3;
            if (currentStep >= ITEMS_ARRIVED_STEP) return null;
            if (!etaRangeText) return null;
            const isDegraded = payload.mode === 'planned' && payload.degraded;
            return (
              <div className="card anim-card anim-card-3" style={{ padding: '10px 12px', border: '1.5px solid #BBF7D0', background: 'linear-gradient(135deg,#F0FDF4,#DCFCE7)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 28, height: 28, borderRadius: 8, background: '#DCFCE7', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <Navigation style={{ width: 14, height: 14, color: '#16A34A' }} />
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <p style={{ fontSize: 9, fontWeight: 700, color: '#15803D', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 2 }}>Estimated Arrival</p>
                    <p style={{ fontWeight: 700, fontSize: 12, color: '#14532D', lineHeight: 1.25 }}>{etaRangeText}</p>
                    {isDegraded && <p style={{ fontSize: 10, color: '#15803D', marginTop: 1 }}>Will narrow once your driver is assigned</p>}
                  </div>
                </div>
              </div>
            );
          })()}
          {delivery.confirmedDeliveryDate && (
            <div className="card anim-card anim-card-3" style={{ padding: '10px 12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 28, height: 28, borderRadius: 8, background: '#f3f6fa', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Clock style={{ width: 14, height: 14, color: '#032145' }} />
                </div>
                <div style={{ minWidth: 0 }}>
                  <p style={{ fontSize: 9, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 2 }}>Delivery date</p>
                  <p style={{ fontWeight: 700, fontSize: 12, color: '#1e293b', lineHeight: 1.25 }}>
                    {new Date(delivery.confirmedDeliveryDate).toLocaleDateString('en-AE', { timeZone: 'Asia/Dubai', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
                  </p>
                </div>
              </div>
            </div>
          )}

          {(() => {
            const statusLc = (delivery.status || '').toLowerCase();
            const isOnRoute = statusLc === 'out-for-delivery' || statusLc === 'out_for_delivery' || statusLc === 'in-transit';
            if (isOnRoute && trackingInfo.driver) {
              const driverPhone = trackingInfo.driver.phone || '+971524408687';
              const waPhone = driverPhone.replace(/[^0-9]/g, '');
              return (
                <div className="card anim-card anim-card-3" style={{ padding: '10px 12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'linear-gradient(135deg,#032145,#115a96)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 11, flexShrink: 0 }}>
                      {(trackingInfo.driver.name || 'D').charAt(0).toUpperCase()}
                    </div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <p style={{ fontSize: 9, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 2 }}>Driver</p>
                      <p style={{ fontWeight: 700, fontSize: 12, color: '#1e293b', lineHeight: 1.25 }}>{trackingInfo.driver.name}</p>
                    </div>
                  </div>
                  <div className="driver-actions">
                    <a href={`tel:${driverPhone}`} className="btn-driver-action btn-driver-action--primary">
                      <Phone style={{ width: 13, height: 13 }} />
                      Call Driver
                    </a>
                    <a href={`https://wa.me/${waPhone}`} target="_blank" rel="noopener noreferrer" className="btn-driver-action" style={{ background: '#25D366', color: '#fff', borderColor: '#25D366' }}>
                      <MessageCircle style={{ width: 13, height: 13 }} />
                      WhatsApp
                    </a>
                  </div>
                </div>
              );
            }
            // Pre-route or no driver assigned → show Delivery Team contact
            return (
              <div className="card anim-card anim-card-3" style={{ padding: '10px 12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'linear-gradient(135deg,#032145,#115a96)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <Truck style={{ width: 13, height: 13, color: '#fff' }} />
                  </div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <p style={{ fontSize: 9, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 2 }}>Delivery Team</p>
                    <p style={{ fontWeight: 700, fontSize: 12, color: '#1e293b', lineHeight: 1.25 }}>Electrolux Delivery</p>
                  </div>
                </div>
                <div className="driver-actions">
                  <a href="tel:+971524408687" className="btn-driver-action btn-driver-action--primary">
                    <Phone style={{ width: 13, height: 13 }} />
                    Call Us
                  </a>
                  <a href="https://wa.me/971524408687" target="_blank" rel="noopener noreferrer" className="btn-driver-action" style={{ background: '#25D366', color: '#fff', borderColor: '#25D366' }}>
                    <MessageCircle style={{ width: 13, height: 13 }} />
                    WhatsApp
                  </a>
                </div>
              </div>
            );
          })()}
        </div>

        {/* ── Map ─────────────────────────────────────────────────── */}
        {(delivery.lat || trackingInfo.driverLocation) && (
          <div className="card anim-card anim-card-4" style={{ overflow: 'hidden', marginBottom: 12 }}>
            <div style={{ padding: '10px 16px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Navigation style={{ width: 15, height: 15, color: '#64748b' }} />
                <span style={{ fontWeight: 700, fontSize: 14, color: '#1e293b' }}>Live Map</span>
              </div>
              <button className={`btn-refresh ${refreshing ? 'spinning' : ''}`} onClick={() => void fetchTracking(true)} style={{ paddingInline: 12 }}>
                <RefreshCw style={{ width: 13, height: 13 }} />
                <span style={{ fontSize: 12 }}>Refresh</span>
              </button>
            </div>
            <div style={{ height: 240 }}>
              <MapContainer center={mapCenter} zoom={13} style={{ width: '100%', height: '100%' }} attributionControl={false}>
                <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                {delivery.lat && delivery.lng && (
                  <Marker
                    position={[delivery.lat, delivery.lng]}
                    icon={createDeliveryIconForDelivery(delivery)}
                  >
                    <Popup><strong>Delivery Location</strong><br />{delivery.address}</Popup>
                  </Marker>
                )}
                {trackingInfo.driverLocation && (
                  <Marker
                    position={[trackingInfo.driverLocation.latitude, trackingInfo.driverLocation.longitude]}
                    icon={createDriverMarkerIcon()}
                  >
                    <Popup><strong>Driver Location</strong><br />{trackingInfo.driver?.name}</Popup>
                  </Marker>
                )}
                {mapLinePositions.length >= 2 && (
                  <Polyline positions={mapLinePositions} color="#032145" weight={4} opacity={0.78} />
                )}
              </MapContainer>
            </div>
          </div>
        )}

        {/* ── Order Info ──────────────────────────────────────────── */}
        <div className="card anim-card anim-card-5" style={{ padding: 20, marginBottom: 12 }}>
          <h3 style={{ fontWeight: 700, fontSize: 15, color: '#1e293b', marginBottom: 14 }}>Order Information</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {(delivery.poNumber || customerDeliveryNo) && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 34, height: 34, borderRadius: 10, background: '#f3f6fa', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Package style={{ width: 15, height: 15, color: '#032145' }} />
                </div>
                <div>
                  {delivery.poNumber && (
                    <>
                      <p style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>PO number</p>
                      <p style={{ fontSize: 13, fontWeight: 700, color: '#1e293b', marginTop: 2 }}>PO: {delivery.poNumber}</p>
                    </>
                  )}
                  {customerDeliveryNo && (
                    <>
                      <p style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', marginTop: delivery.poNumber ? 10 : 0 }}>Delivery number</p>
                      <p style={{ fontSize: 13, fontWeight: 700, color: '#1e293b', marginTop: 2 }}>{customerDeliveryNo}</p>
                    </>
                  )}
                </div>
              </div>
            )}
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
              <div style={{ width: 34, height: 34, borderRadius: 10, background: '#f3f6fa', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <MapPin style={{ width: 15, height: 15, color: '#032145' }} />
              </div>
              <div>
                <p style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Delivery Address</p>
                <p style={{ fontSize: 13, fontWeight: 600, color: '#1e293b', marginTop: 2 }}>{delivery.address}</p>
              </div>
            </div>
          </div>

          {items.length > 0 && (
            <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid #f1f5f9' }}>
              <p style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10 }}>Items</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {items.map((item, idx) => (
                  <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: '#F8FAFC', borderRadius: 10 }}>
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#032145', flexShrink: 0 }} />
                    <span style={{ fontSize: 13, color: '#374151', fontWeight: 500 }}>
                      {typeof item === 'string' ? item : ((item as Record<string, unknown>).name as string) || ((item as Record<string, unknown>).description as string) || ((item as Record<string, unknown>).sku as string) || 'Item'}
                    </span>
                    {typeof item === 'object' && (item as Record<string, unknown>).quantity && (
                      <span style={{ fontSize: 12, color: '#94a3b8', marginLeft: 'auto' }}>×{(item as Record<string, unknown>).quantity as number}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── Support Footer ──────────────────────────────────────── */}
        <div style={{ textAlign: 'center', padding: '8px 0 16px' }}>
          <p style={{ fontSize: 13, color: '#64748b' }}>
            Need help?{' '}
            <a href="tel:+971524408687" style={{ color: '#032145', fontWeight: 700, textDecoration: 'none' }}>+971 52 440 8687</a>
            {' '}· Electrolux Delivery Team
          </p>
          <p style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>electrolux-smart-portal.vercel.app</p>
        </div>
      </div>
    </div>
  );
}
