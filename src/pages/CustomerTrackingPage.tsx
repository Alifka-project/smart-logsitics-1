import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  AlertCircle, Loader, MapPin, Truck, Clock, Package,
  Phone, CheckCircle, Navigation, Star, RefreshCw, ChevronRight, ArrowLeft,
  MessageSquare, Calendar
} from 'lucide-react';
import { MapContainer, TileLayer, Marker, Popup, Polyline } from 'react-leaflet';
import L from 'leaflet';
import type { Delivery, TrackingEvent } from '../types';

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
    background: linear-gradient(135deg, #003057 0%, #0056a3 100%);
    color: #fff; border: none; cursor: pointer;
    transition: transform 0.2s, box-shadow 0.2s;
    animation: ripple 2s infinite;
    text-decoration: none;
    flex-shrink: 0;
  }
  .btn-call:hover { transform: scale(1.08); box-shadow: 0 4px 16px rgba(0,48,87,0.4); }
  .btn-call:active { transform: scale(0.97); }

  .btn-refresh {
    display: flex; align-items: center; gap: 6px;
    padding: 8px 16px; border-radius: 50px;
    border: 1.5px solid #e2e8f0; background: #fff;
    font-size: 12px; font-weight: 600; color: #475569;
    cursor: pointer; transition: all 0.2s ease;
  }
  .btn-refresh:hover { border-color: #003057; color: #003057; background: #f0f7ff; }
  .btn-refresh:active { transform: scale(0.97); }
  .btn-refresh.spinning svg { animation: spin 1s linear infinite; }
  @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

  .step-line-fill {
    width: 2px; background: #003057;
    animation: progressLine 0.7s ease both;
    animation-delay: 0.3s;
  }
  .toggle-track {
    width: 44px; height: 24px; border-radius: 50px;
    background: #e2e8f0; position: relative;
    cursor: pointer; transition: background 0.3s ease;
  }
  .toggle-track.on { background: linear-gradient(135deg, #003057, #0056a3); }
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
    0%   { transform: scale(1);   box-shadow: 0 0 0 0 rgba(0,48,87,0.25); }
    40%  { transform: scale(1.08); box-shadow: 0 0 0 8px rgba(0,48,87,0); }
    100% { transform: scale(1);   box-shadow: 0 0 0 0 rgba(0,48,87,0); }
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

interface TrackingInfoResponse {
  driverLocation?: DriverLocationInfo | null;
  driver?: DriverInfo | null;
}

interface TrackingDelivery extends Delivery {
  confirmedDeliveryDate?: string;
  rescheduleReason?: string | null;
  rescheduledAt?: string | null;
}

interface TrackingData {
  delivery: TrackingDelivery;
  tracking: TrackingInfoResponse;
  timeline?: TrackingEvent[];
}

// ── Timeline steps ───────────────────────────────────────────────────────────
const TIMELINE_STEPS: TimelineStep[] = [
  { id: 'order_processed', label: 'Order Processed', desc: 'Received & being prepared', icon: Package,
    matchStatuses: ['pending', 'uploaded'], matchEvents: ['delivery_uploaded', 'order_created'] },
  { id: 'order_scheduled', label: 'Order Scheduled', desc: 'Delivery date confirmed', icon: Calendar,
    matchStatuses: ['scheduled', 'confirmed', 'scheduled-confirmed', 'rescheduled'], matchEvents: ['customer_confirmed', 'delivery_scheduled', 'admin_rescheduled'] },
  { id: 'out_for_delivery', label: 'Out for Delivery', desc: 'On its way to you', icon: Truck,
    matchStatuses: ['out-for-delivery', 'in-transit'], matchEvents: ['out_for_delivery', 'status_updated_out_for_delivery'] },
  { id: 'items_arrived', label: 'Items Arrived', desc: 'Delivered to your address', icon: MapPin,
    matchStatuses: ['delivered', 'delivered-with-installation', 'delivered-without-installation'], matchEvents: ['delivery_completed', 'status_updated_delivered'] },
  { id: 'order_finished', label: 'Order Finished', desc: 'All done — thank you!', icon: Star,
    matchStatuses: ['finished', 'completed', 'pod-completed'], matchEvents: ['pod_completed', 'order_finished'] },
];

function resolveCurrentStep(status: string | null | undefined, timeline: TrackingEvent[] | undefined): number {
  const s = (status || '').toLowerCase();
  for (let i = TIMELINE_STEPS.length - 1; i >= 0; i--) {
    const step = TIMELINE_STEPS[i];
    if (step.matchStatuses.includes(s)) return i;
    if (timeline?.some(e => step.matchEvents.includes(e.type as string))) return i;
  }
  return 0;
}

function getStepTimestamp(step: TimelineStep, timeline: TrackingEvent[] | undefined): string | Date | null {
  if (!timeline) return null;
  for (const ev of timeline) {
    if (step.matchEvents.includes(ev.type as string)) return ev.timestamp;
  }
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
    subtitle: 'Your delivery date has been confirmed.',
  },
  2: {
    bg: '#FFFFFF',
    color: '#C2410C',
    label: 'In transit',
    icon: Truck,
    title: 'Out for delivery',
    subtitle: 'Your driver is heading to your address.',
  },
  3: {
    bg: '#FFFFFF',
    color: '#15803D',
    label: 'Delivered',
    icon: MapPin,
    title: 'Your order has arrived',
    subtitle: 'Delivered to your address successfully.',
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
      <div style={{ background: 'linear-gradient(135deg, #003057 0%, #005082 100%)', padding: '20px 16px 24px' }}>
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
        <button onClick={() => window.location.reload()} style={{ padding: '10px 28px', borderRadius: 50, border: 'none', background: 'linear-gradient(135deg,#003057,#005082)', color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
          Try Again
        </button>
      </div>
    </div>
  );

  if (!tracking) return null;

  const { delivery, tracking: trackingInfo, timeline } = tracking;
  const currentStep = resolveCurrentStep(delivery.status, timeline);
  const hero = STATUS_HERO[currentStep] || STATUS_HERO[0];

  const mapCenter: [number, number] = delivery.lat && delivery.lng
    ? [delivery.lat, delivery.lng]
    : (trackingInfo.driverLocation
      ? [trackingInfo.driverLocation.latitude, trackingInfo.driverLocation.longitude]
      : [25.2048, 55.2708]);

  const coordinates: [number, number][] = [];
  if (delivery.lat && delivery.lng) coordinates.push([delivery.lat, delivery.lng]);
  if (trackingInfo.driverLocation) coordinates.push([trackingInfo.driverLocation.latitude, trackingInfo.driverLocation.longitude]);

  const rawItems = delivery.items as unknown;
  const items: Array<string | Record<string, unknown>> = Array.isArray(rawItems)
    ? rawItems as Array<string | Record<string, unknown>>
    : (rawItems ? [rawItems as string] : []);

  return (
    <div style={{ minHeight: '100vh', background: '#F8FAFC' }}>
      <style>{STYLES}</style>

      {/* ── Header ──────────────────────────────────────────────────── */}
      <div style={{ background: 'linear-gradient(135deg, #003057 0%, #005082 100%)', padding: '18px 16px 28px' }}>
        <div style={{ maxWidth: 'min(680px, 100%)', margin: '0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <button
              onClick={() => navigate(-1)}
              style={{
                border: 'none',
                background: 'rgba(15,23,42,0.35)',
                borderRadius: 999,
                padding: '6px 10px',
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
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(255,255,255,0.15)', borderRadius: 50, padding: '5px 12px' }}>
              <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#4ADE80', animation: 'ripple 2s infinite' }} />
              <span style={{ color: '#fff', fontSize: 12, fontWeight: 600 }}>Live Tracking</span>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6 }}>
            <img src="/elect home.png" alt="Electrolux" style={{ height: 26, filter: 'brightness(0) invert(1)' }} />
            <div>
              <h1 style={{ color: '#fff', fontSize: 20, fontWeight: 800, marginBottom: 0 }}>Delivery Tracking</h1>
              {delivery.poNumber && <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12 }}>PO: {delivery.poNumber}</p>}
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
        {delivery.status === 'rescheduled' && (
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
                  {new Date(delivery.confirmedDeliveryDate).toLocaleDateString('en-AE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                </p>
              )}
              {delivery.rescheduleReason && (
                <p style={{ fontSize: 13, color: '#78350F', marginBottom: 4 }}>
                  <strong>Reason: </strong>{delivery.rescheduleReason}
                </p>
              )}
              <p style={{ fontSize: 12, color: '#92400E' }}>
                We apologise for any inconvenience. Your order has been rescheduled by the Electrolux Delivery Team.
              </p>
            </div>
          </div>
        )}

        {/* ── 5-Step Progress Timeline ─────────────────────────────── */}
        <div className="card anim-card anim-card-2" style={{ padding: '20px', marginBottom: 12 }}>
          <h2 style={{ fontWeight: 700, fontSize: 15, color: '#1e293b', marginBottom: 20 }}>Delivery Progress</h2>
          <div style={{ position: 'relative' }}>
            {TIMELINE_STEPS.map((step, idx) => {
              const isDone    = idx < currentStep;
              const isActive  = idx === currentStep;
              const isPending = idx > currentStep;
              const Icon      = step.icon;
              const ts        = getStepTimestamp(step, timeline);
              const isLast    = idx === TIMELINE_STEPS.length - 1;

              return (
                <div key={step.id} style={{ display: 'flex', gap: 14, position: 'relative' }}>
                  {/* Connector */}
                  {!isLast && (
                    <div style={{ position: 'absolute', left: 19, top: 44, width: 2, background: isDone ? '#003057' : '#e2e8f0', bottom: 0, zIndex: 0 }}
                      className={isDone ? 'step-line-fill' : ''} />
                  )}

                  {/* Icon circle */}
                  <div style={{
                    width: 40, height: 40, borderRadius: '50%', flexShrink: 0, zIndex: 1,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: isDone ? '#003057' : isActive ? '#fff' : '#f8fafc',
                    border: isDone ? '2px solid #003057' : isActive ? '2.5px solid #003057' : '2px solid #e2e8f0',
                    boxShadow: isActive ? '0 0 0 5px rgba(0,48,87,0.12)' : 'none',
                    transition: 'all 0.3s ease',
                  }} className={isActive ? 'step-icon-current' : ''}>
                    {isDone
                      ? <CheckCircle style={{ width: 18, height: 18, color: '#fff' }} />
                      : <Icon style={{ width: 17, height: 17, color: isActive ? '#003057' : '#cbd5e1' }} />
                    }
                  </div>

                  {/* Text */}
                  <div style={{ paddingBottom: isLast ? 0 : 24, flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 700, fontSize: 14, color: isPending ? '#94a3b8' : '#1e293b' }}>
                        {step.label}
                      </span>
                      {isActive && (
                        <span style={{ padding: '2px 10px', borderRadius: 50, fontSize: 11, fontWeight: 700, background: '#003057', color: '#fff' }}>
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
                        {new Date(ts as string).toLocaleString('en-AE', { dateStyle: 'medium', timeStyle: 'short' })}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Delivery Date + Driver ───────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 12 }}>
          {delivery.confirmedDeliveryDate && (
            <div className="card anim-card anim-card-3" style={{ padding: 16 }}>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: '#EFF6FF', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 10 }}>
                <Clock style={{ width: 18, height: 18, color: '#003057' }} />
              </div>
              <p style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>Delivery Date</p>
              <p style={{ fontWeight: 700, fontSize: 13, color: '#1e293b' }}>
                {new Date(delivery.confirmedDeliveryDate).toLocaleDateString('en-AE', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
              </p>
            </div>
          )}

          {trackingInfo.driver ? (
            <div className="card anim-card anim-card-3" style={{ padding: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'linear-gradient(135deg,#003057,#0056a3)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 14 }}>
                  {(trackingInfo.driver.name || 'D').charAt(0).toUpperCase()}
                </div>
                {trackingInfo.driver.phone && (
                  <a href={`tel:${trackingInfo.driver.phone}`} className="btn-call">
                    <Phone style={{ width: 16, height: 16 }} />
                  </a>
                )}
              </div>
              <p style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 2 }}>Driver</p>
              <p style={{ fontWeight: 700, fontSize: 13, color: '#1e293b' }}>{trackingInfo.driver.name}</p>
            </div>
          ) : !delivery.confirmedDeliveryDate ? null : (
            <div className="card anim-card anim-card-3" style={{ padding: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <p style={{ fontSize: 12, color: '#94a3b8', textAlign: 'center' }}>Driver not yet assigned</p>
            </div>
          )}
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
              <MapContainer center={mapCenter} zoom={13} style={{ width: '100%', height: '100%' }}>
                <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution='&copy; OpenStreetMap' />
                {delivery.lat && delivery.lng && (
                  <Marker position={[delivery.lat, delivery.lng]}>
                    <Popup><strong>Delivery Location</strong><br />{delivery.address}</Popup>
                  </Marker>
                )}
                {trackingInfo.driverLocation && (
                  <Marker position={[trackingInfo.driverLocation.latitude, trackingInfo.driverLocation.longitude]}>
                    <Popup><strong>Driver Location</strong><br />{trackingInfo.driver?.name}</Popup>
                  </Marker>
                )}
                {coordinates.length === 2 && <Polyline positions={coordinates} color="#003057" weight={3} opacity={0.7} />}
              </MapContainer>
            </div>
          </div>
        )}

        {/* ── Order Info ──────────────────────────────────────────── */}
        <div className="card anim-card anim-card-5" style={{ padding: 20, marginBottom: 12 }}>
          <h3 style={{ fontWeight: 700, fontSize: 15, color: '#1e293b', marginBottom: 14 }}>Order Information</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {(delivery.poNumber || delivery.id) && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 34, height: 34, borderRadius: 10, background: '#F0F7FF', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Package style={{ width: 15, height: 15, color: '#003057' }} />
                </div>
                <div>
                  <p style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>PO Number</p>
                  {delivery.poNumber && (
                    <p style={{ fontSize: 13, fontWeight: 700, color: '#1e293b', marginTop: 2 }}>PO: {delivery.poNumber}</p>
                  )}
                  {delivery.id && (
                    <p style={{ fontSize: 12, fontWeight: 500, color: '#64748b' }}>Delivery No: #{String(delivery.id).slice(0, 8)}</p>
                  )}
                </div>
              </div>
            )}
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
              <div style={{ width: 34, height: 34, borderRadius: 10, background: '#F0F7FF', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <MapPin style={{ width: 15, height: 15, color: '#003057' }} />
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
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#003057', flexShrink: 0 }} />
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
            <a href="tel:+971524408687" style={{ color: '#003057', fontWeight: 700, textDecoration: 'none' }}>+971 52 440 8687</a>
            {' '}· Electrolux Delivery Team
          </p>
          <p style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>electrolux-smart-portal.vercel.app</p>
        </div>
      </div>
    </div>
  );
}
