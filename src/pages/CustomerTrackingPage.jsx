import React, { useEffect, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { AlertCircle, Loader, MapPin, Truck, Clock, Package, Phone, CheckCircle, Navigation, Star } from 'lucide-react';
import { MapContainer, TileLayer, Marker, Popup, Polyline } from 'react-leaflet';
import L from 'leaflet';

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: '/leaflet-images/marker-icon-2x.png',
  iconUrl: '/leaflet-images/marker-icon.png',
  shadowUrl: '/leaflet-images/marker-shadow.png',
});

// ── Timeline Step Definition ────────────────────────────────────────────────
// Maps raw delivery status / event types → the 5-step customer-facing flow.
const TIMELINE_STEPS = [
  {
    id: 'order_processed',
    label: 'Order Processed',
    description: 'Your order has been received and is being prepared.',
    icon: Package,
    matchStatuses: ['pending', 'uploaded'],
    matchEvents: ['delivery_uploaded', 'order_created'],
  },
  {
    id: 'order_scheduled',
    label: 'Order Scheduled',
    description: 'Delivery date confirmed. Your order is scheduled.',
    icon: Clock,
    matchStatuses: ['scheduled', 'confirmed', 'scheduled-confirmed'],
    matchEvents: ['customer_confirmed', 'delivery_scheduled'],
  },
  {
    id: 'out_for_delivery',
    label: 'Out for Delivery',
    description: 'Your order is on its way to you.',
    icon: Truck,
    matchStatuses: ['out-for-delivery', 'in-transit'],
    matchEvents: ['out_for_delivery', 'status_updated_out_for_delivery'],
  },
  {
    id: 'items_arrived',
    label: 'Items Arrived',
    description: 'Your items have been delivered to your address.',
    icon: MapPin,
    matchStatuses: ['delivered', 'delivered-with-installation', 'delivered-without-installation'],
    matchEvents: ['delivery_completed', 'status_updated_delivered'],
  },
  {
    id: 'order_finished',
    label: 'Order Finished',
    description: 'Delivery complete. Thank you for choosing Electrolux!',
    icon: Star,
    matchStatuses: ['finished', 'completed', 'pod-completed'],
    matchEvents: ['pod_completed', 'order_finished'],
  },
];

function resolveCurrentStep(deliveryStatus, timeline) {
  const status = (deliveryStatus || '').toLowerCase();
  // Walk steps from last to first — return the highest step matched
  for (let i = TIMELINE_STEPS.length - 1; i >= 0; i--) {
    const step = TIMELINE_STEPS[i];
    if (step.matchStatuses.includes(status)) return i;
    if (timeline?.some(e => step.matchEvents.includes(e.type))) return i;
  }
  return 0; // Default: order processed
}

function getStepTimestamp(step, timeline) {
  if (!timeline) return null;
  for (const event of timeline) {
    if (step.matchEvents.includes(event.type)) return event.timestamp;
  }
  return null;
}

export default function CustomerTrackingPage() {
  const { token } = useParams();
  const [tracking, setTracking] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(new Date());

  const fetchTracking = useCallback(async () => {
    try {
      const response = await fetch(`/api/customer/tracking/${token}`);
      const data = await response.json();
      if (!response.ok) { setError(data.message || data.error || 'Failed to load tracking'); return; }
      setTracking(data);
      setLastUpdated(new Date());
      setError('');
    } catch (err) {
      setError(err.message || 'Failed to fetch tracking data');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchTracking();
    if (autoRefresh) {
      const interval = setInterval(fetchTracking, 30000);
      return () => clearInterval(interval);
    }
  }, [token, autoRefresh, fetchTracking]);

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #003057 0%, #005082 100%)' }}>
      <div className="text-center">
        <Loader className="w-12 h-12 text-white animate-spin mx-auto mb-4" />
        <p className="text-white text-lg font-medium">Loading tracking information...</p>
      </div>
    </div>
  );

  if (error && !tracking) return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: 'linear-gradient(135deg, #003057 0%, #005082 100%)' }}>
      <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-md w-full text-center">
        <AlertCircle className="w-14 h-14 text-red-500 mx-auto mb-4" />
        <h1 className="text-xl font-bold text-gray-800 mb-3">Unable to Load Tracking</h1>
        <p className="text-gray-600 text-sm mb-6">{error}</p>
        <button onClick={() => window.location.reload()} className="px-6 py-2.5 rounded-xl text-white font-semibold text-sm" style={{ background: '#003057' }}>
          Try Again
        </button>
      </div>
    </div>
  );

  if (!tracking) return null;

  const { delivery, tracking: trackingInfo, timeline } = tracking;
  const currentStep = resolveCurrentStep(delivery.status, timeline);

  const mapCenter = delivery.lat && delivery.lng
    ? [delivery.lat, delivery.lng]
    : (trackingInfo.driverLocation
      ? [trackingInfo.driverLocation.latitude, trackingInfo.driverLocation.longitude]
      : [25.2048, 55.2708]);

  const coordinates = [];
  if (delivery.lat && delivery.lng) coordinates.push([delivery.lat, delivery.lng]);
  if (trackingInfo.driverLocation) coordinates.push([trackingInfo.driverLocation.latitude, trackingInfo.driverLocation.longitude]);

  return (
    <div className="min-h-screen" style={{ background: 'linear-gradient(160deg, #f0f4f8 0%, #e8edf2 100%)' }}>
      {/* Header */}
      <div className="w-full py-5 px-4" style={{ background: 'linear-gradient(135deg, #003057 0%, #005082 100%)' }}>
        <div className="max-w-2xl mx-auto">
          <div className="flex items-center justify-between">
            <img src="/elect home.png" alt="Electrolux" className="h-8 brightness-0 invert" />
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
              <span className="text-white text-xs font-medium">Live Tracking</span>
            </div>
          </div>
          <h1 className="text-xl font-bold text-white mt-3">Delivery Tracking</h1>
          {delivery.poNumber && <p className="text-blue-200 text-sm mt-0.5">PO: {delivery.poNumber}</p>}
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-5 space-y-4">

        {/* ── 5-Step Progress Timeline ─────────────────────────────────── */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
          <h2 className="font-bold text-gray-800 text-base mb-5">Delivery Progress</h2>

          <div className="relative">
            {TIMELINE_STEPS.map((step, idx) => {
              const isDone = idx < currentStep;
              const isActive = idx === currentStep;
              const isPending = idx > currentStep;
              const Icon = step.icon;
              const ts = getStepTimestamp(step, timeline);
              const isLast = idx === TIMELINE_STEPS.length - 1;

              return (
                <div key={step.id} className="flex gap-4 relative">
                  {/* Connector line */}
                  {!isLast && (
                    <div className="absolute left-[19px] top-10 bottom-0 w-0.5 z-0" style={{ height: 'calc(100% - 10px)', background: isDone ? '#003057' : '#e5e7eb' }} />
                  )}

                  {/* Icon circle */}
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 z-10 border-2 transition-all ${
                    isDone ? 'border-transparent text-white' :
                    isActive ? 'border-blue-900 text-blue-900 bg-white' :
                    'border-gray-300 text-gray-400 bg-white'
                  }`} style={isDone ? { background: '#003057' } : isActive ? { boxShadow: '0 0 0 4px #dbeafe' } : {}}>
                    {isDone ? <CheckCircle className="w-5 h-5" /> : <Icon className="w-5 h-5" />}
                  </div>

                  {/* Content */}
                  <div className={`pb-6 flex-1 ${isLast ? 'pb-0' : ''}`}>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`font-semibold text-sm ${isDone ? 'text-gray-700' : isActive ? 'text-blue-900' : 'text-gray-400'}`}>
                        {step.label}
                      </span>
                      {isActive && (
                        <span className="px-2 py-0.5 rounded-full text-xs font-bold text-white" style={{ background: '#003057' }}>
                          Current
                        </span>
                      )}
                      {isDone && (
                        <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-700">Done</span>
                      )}
                    </div>
                    <p className={`text-xs mt-0.5 ${isActive ? 'text-blue-700' : isPending ? 'text-gray-400' : 'text-gray-500'}`}>
                      {isActive || isDone ? step.description : '—'}
                    </p>
                    {ts && (
                      <p className="text-xs text-gray-400 mt-0.5">{new Date(ts).toLocaleString('en-AE', { dateStyle: 'medium', timeStyle: 'short' })}</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Delivery Date & Driver ───────────────────────────────────── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {delivery.confirmedDeliveryDate && (
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: '#e8f0fe' }}>
                <Clock className="w-5 h-5" style={{ color: '#003057' }} />
              </div>
              <div>
                <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">Delivery Date</p>
                <p className="font-bold text-gray-800 text-sm">{new Date(delivery.confirmedDeliveryDate).toLocaleDateString('en-AE', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</p>
              </div>
            </div>
          )}

          {trackingInfo.driver && (
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: '#e8f0fe' }}>
                <Truck className="w-5 h-5" style={{ color: '#003057' }} />
              </div>
              <div className="flex-1">
                <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">Driver</p>
                <p className="font-bold text-gray-800 text-sm">{trackingInfo.driver.name}</p>
                {trackingInfo.driver.phone && (
                  <a href={`tel:${trackingInfo.driver.phone}`} className="text-xs text-blue-600 font-medium flex items-center gap-1 mt-0.5">
                    <Phone className="w-3 h-3" />{trackingInfo.driver.phone}
                  </a>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ── Map ─────────────────────────────────────────────────────── */}
        {(delivery.lat || trackingInfo.driverLocation) && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
              <Navigation className="w-4 h-4 text-gray-500" />
              <h3 className="font-bold text-gray-800 text-sm">Live Map</h3>
            </div>
            <div className="h-64">
              <MapContainer center={mapCenter} zoom={13} className="w-full h-full">
                <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution='&copy; OpenStreetMap' />
                {delivery.lat && delivery.lng && (
                  <Marker position={[delivery.lat, delivery.lng]}>
                    <Popup><p className="font-bold text-sm">Delivery Location</p><p className="text-xs">{delivery.address}</p></Popup>
                  </Marker>
                )}
                {trackingInfo.driverLocation && (
                  <Marker position={[trackingInfo.driverLocation.latitude, trackingInfo.driverLocation.longitude]}>
                    <Popup><p className="font-bold text-sm">Driver Location</p><p className="text-xs">{trackingInfo.driver?.name}</p></Popup>
                  </Marker>
                )}
                {coordinates.length === 2 && <Polyline positions={coordinates} color="#003057" weight={3} opacity={0.7} />}
              </MapContainer>
            </div>
          </div>
        )}

        {/* ── Order Info ──────────────────────────────────────────────── */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
          <h3 className="font-bold text-gray-800 text-base mb-4">Order Information</h3>
          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <MapPin className="w-4 h-4 text-gray-400 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-xs text-gray-500">Delivery Address</p>
                <p className="text-sm font-semibold text-gray-800">{delivery.address}</p>
              </div>
            </div>
            {delivery.poNumber && (
              <div className="flex items-start gap-3">
                <Package className="w-4 h-4 text-gray-400 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-xs text-gray-500">PO Number</p>
                  <p className="text-sm font-semibold text-gray-800">{delivery.poNumber}</p>
                </div>
              </div>
            )}
          </div>

          {/* Items */}
          {delivery.items?.length > 0 && (
            <div className="mt-4 pt-4 border-t border-gray-100">
              <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Items</p>
              <div className="space-y-1.5">
                {(Array.isArray(delivery.items) ? delivery.items : [delivery.items]).map((item, idx) => (
                  <div key={idx} className="flex items-center gap-2 text-sm text-gray-700">
                    <div className="w-1.5 h-1.5 rounded-full bg-gray-400 flex-shrink-0" />
                    <span>{typeof item === 'string' ? item : (item.name || item.description || item.sku || 'Item')}</span>
                    {typeof item === 'object' && item.quantity && <span className="text-gray-400">× {item.quantity}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── Auto-refresh control ────────────────────────────────────── */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 px-4 py-3 flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-gray-700">Auto-refresh</p>
            <p className="text-xs text-gray-400">Last updated: {lastUpdated.toLocaleTimeString()}</p>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={fetchTracking} className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50">
              Refresh
            </button>
            <label className="relative inline-flex items-center cursor-pointer">
              <input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} className="sr-only peer" />
              <div className="w-10 h-6 bg-gray-200 peer-checked:bg-blue-900 rounded-full peer transition-colors" />
              <div className="absolute left-1 top-1 w-4 h-4 bg-white rounded-full shadow peer-checked:translate-x-4 transition-transform" />
            </label>
          </div>
        </div>

        {/* Footer */}
        <div className="text-center py-3">
          <p className="text-xs text-gray-500">
            Need help?{' '}
            <a href="tel:+971524408687" className="font-semibold" style={{ color: '#003057' }}>+971 52 440 8687</a>
            {' '}· Electrolux Delivery Team
          </p>
          <p className="text-xs text-gray-400 mt-1">electrolux-smart-portal.vercel.app</p>
        </div>
      </div>
    </div>
  );
}
