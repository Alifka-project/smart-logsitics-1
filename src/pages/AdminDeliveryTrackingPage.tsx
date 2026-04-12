import React, { useEffect, useState, useRef } from 'react';
import api, { setAuthToken } from '../frontend/apiClient';
import PaginationBar from '../components/common/PaginationBar';
import DeliveryMap from '../components/MapView/DeliveryMap';
import { Package, MapPin, Clock, CheckCircle } from 'lucide-react';
import { computePerDriverRoutes } from '../services/advancedRoutingService';
import type { DriverRoute } from '../services/advancedRoutingService';

interface TrackingLocation {
  lat: number;
  lng: number;
  timestamp?: string;
}

interface TrackingInfo {
  assigned?: boolean;
  status?: string;
  driverId?: string;
  assignedAt?: string;
  lastLocation?: TrackingLocation;
}

interface TrackingDelivery {
  id?: string;
  ID?: string;
  customer?: string;
  Customer?: string;
  address?: string;
  Address?: string;
  status?: string;
  lat?: number;
  Lat?: number;
  lng?: number;
  Lng?: number;
  tracking?: TrackingInfo;
  [key: string]: unknown;
}

interface TrackingData {
  deliveries?: TrackingDelivery[];
}

interface TrackingDriver {
  id: string;
  username?: string | null;
  fullName?: string | null;
  full_name?: string | null;
  tracking?: {
    online?: boolean;
    location?: { lat: number; lng: number; speed?: number | null } | null;
  };
}

function ensureAuth(): void {
  const token = localStorage.getItem('auth_token');
  if (token) setAuthToken(token);
}

const TRACK_PAGE_SIZE = 20;

export default function AdminDeliveryTrackingPage(): React.ReactElement {
  const [trackingData, setTrackingData] = useState<TrackingData | null>(null);
  const [drivers, setDrivers] = useState<TrackingDriver[]>([]);
  const [driverRoutes, setDriverRoutes] = useState<DriverRoute[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  const [trackPage, setTrackPage] = useState(1);
  const trackTableRef = useRef<HTMLDivElement | null>(null);
  const driverRouteKeyRef = useRef<string>('');

  useEffect(() => {
    ensureAuth();
    void loadTrackingData();

    const handleVisChange = (): void => {
      if (!document.hidden) void loadTrackingData();
    };
    document.addEventListener('visibilitychange', handleVisChange);

    const handleDeliveriesUpdated = (): void => { void loadTrackingData(); };
    const handleDeliveryStatusUpdated = (): void => { void loadTrackingData(); };
    window.addEventListener('deliveriesUpdated', handleDeliveriesUpdated);
    window.addEventListener('deliveryStatusUpdated', handleDeliveryStatusUpdated);

    // Fast driver GPS poll (10s)
    const driverInterval = setInterval(async () => {
      if (document.hidden) return;
      try {
        const r = await api.get('/admin/tracking/drivers');
        const list = (r.data?.drivers || []) as TrackingDriver[];
        setDrivers(list);
      } catch { /* silent */ }
    }, 10_000);

    return () => {
      document.removeEventListener('visibilitychange', handleVisChange);
      window.removeEventListener('deliveriesUpdated', handleDeliveriesUpdated);
      window.removeEventListener('deliveryStatusUpdated', handleDeliveryStatusUpdated);
      clearInterval(driverInterval);
    };
  }, []);

  // Recompute per-driver OSRM routes when driver GPS or deliveries change
  useEffect(() => {
    const deliveries = trackingData?.deliveries ?? [];
    const key = drivers
      .filter((d) => d.tracking?.location)
      .map((d) => {
        const loc = d.tracking!.location!;
        return `${d.id}:${loc.lat.toFixed(4)},${loc.lng.toFixed(4)}`;
      })
      .join(';');
    if (key === driverRouteKeyRef.current) return;
    driverRouteKeyRef.current = key;
    if (!key) { setDriverRoutes([]); return; }
    void computePerDriverRoutes(drivers as Parameters<typeof computePerDriverRoutes>[0], deliveries as Parameters<typeof computePerDriverRoutes>[1]).then(setDriverRoutes);
  }, [drivers, trackingData]);

  const loadTrackingData = async (): Promise<void> => {
    try {
      const [delRes, drvRes] = await Promise.all([
        api.get('/admin/tracking/deliveries'),
        api.get('/admin/tracking/drivers').catch(() => ({ data: { drivers: [] } })),
      ]);
      setTrackingData(delRes.data as TrackingData);
      setDrivers((drvRes.data?.drivers || []) as TrackingDriver[]);
      setLastUpdate(new Date());
    } catch (err: unknown) {
      console.error('Error loading delivery tracking:', err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600 dark:text-gray-400">Loading delivery tracking...</p>
        </div>
      </div>
    );
  }

  const deliveries: TrackingDelivery[] = trackingData?.deliveries || [];
  const trackTotalPages = Math.max(1, Math.ceil(deliveries.length / TRACK_PAGE_SIZE));
  const goToPage = (n: number): void => {
    setTrackPage(Math.max(1, Math.min(n, trackTotalPages)));
    trackTableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const assignedDeliveries = deliveries.filter(d => d.tracking?.assigned);
  const inProgressDeliveries = deliveries.filter(d => d.tracking?.status === 'in_progress');
  const completedDeliveries = deliveries.filter(d => (d.status || '').toLowerCase() === 'delivered');

  const deliveriesForMap = deliveries.map(d => ({
    ...d,
    lat: d.lat || d.Lat || d.tracking?.lastLocation?.lat || 25.1124,
    lng: d.lng || d.Lng || d.tracking?.lastLocation?.lng || 55.1980,
  }));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="pp-page-header flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
        <div>
          <h1 className="pp-page-title">Real-Time Delivery Tracking</h1>
          <p className="pp-page-subtitle">
            Last updated: {lastUpdate.toLocaleTimeString()}
            <span className="ml-2 text-green-600 dark:text-green-400">● Live</span>
          </p>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="pp-dash-card p-5 transition-colors">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-gray-600 dark:text-gray-400 mb-1">Total Deliveries</div>
              <div className="text-3xl font-bold" style={{color:'var(--text)'}}>{deliveries.length}</div>
            </div>
            <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
              <Package className="w-6 h-6 text-blue-600 dark:text-blue-400" />
            </div>
          </div>
        </div>
        <div className="pp-dash-card p-5 transition-colors">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-gray-600 dark:text-gray-400 mb-1">Assigned</div>
              <div className="text-3xl font-bold text-purple-600 dark:text-purple-400">{assignedDeliveries.length}</div>
            </div>
            <div className="p-3 bg-purple-50 dark:bg-purple-900/20 rounded-lg">
              <MapPin className="w-6 h-6 text-purple-600 dark:text-purple-400" />
            </div>
          </div>
        </div>
        <div className="pp-dash-card p-5 transition-colors">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-gray-600 dark:text-gray-400 mb-1">In Progress</div>
              <div className="text-3xl font-bold text-yellow-600 dark:text-yellow-400">{inProgressDeliveries.length}</div>
            </div>
            <div className="p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg">
              <Clock className="w-6 h-6 text-yellow-600 dark:text-yellow-400" />
            </div>
          </div>
        </div>
        <div className="pp-dash-card p-5 transition-colors">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-gray-600 dark:text-gray-400 mb-1">Completed</div>
              <div className="text-3xl font-bold text-green-600 dark:text-green-400">{completedDeliveries.length}</div>
            </div>
            <div className="p-3 bg-green-50 dark:bg-green-900/20 rounded-lg">
              <CheckCircle className="w-6 h-6 text-green-600 dark:text-green-400" />
            </div>
          </div>
        </div>
      </div>

      {/* Map */}
      {(deliveriesForMap.length > 0 || drivers.length > 0) && (
        <div className="pp-dash-card overflow-hidden transition-colors">
          <DeliveryMap
            deliveries={deliveriesForMap as unknown as import('../types').Delivery[]}
            route={null}
            driverRoutes={driverRoutes}
            driverLocations={drivers
              .filter((d) => d.tracking?.location && Number.isFinite(d.tracking.location.lat) && Number.isFinite(d.tracking.location.lng))
              .map((d) => ({
                id: d.id,
                name: d.fullName || d.full_name || d.username || 'Driver',
                status: d.tracking?.online ? 'online' : 'offline',
                speedKmh: d.tracking?.location?.speed != null ? Math.round(d.tracking.location.speed * 3.6) : null,
                lat: d.tracking!.location!.lat,
                lng: d.tracking!.location!.lng,
              }))}
          />
        </div>
      )}

      {/* Delivery List */}
      <div className="pp-dash-card p-5 transition-colors" ref={trackTableRef}>
        <h2 className="text-xl font-semibold mb-4 text-gray-900 dark:text-gray-100">Delivery Status</h2>
        <div className="overflow-x-auto">
          <table className="pp-mobile-stack-table min-w-[840px] divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-700">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Delivery</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Driver</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Assigned At</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Location</th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
              {deliveries.slice((trackPage - 1) * TRACK_PAGE_SIZE, trackPage * TRACK_PAGE_SIZE).map(delivery => {
                const customerName = delivery.customer || delivery.Customer || 'Unknown';
                const address = delivery.address || delivery.Address || 'N/A';
                const tracking = delivery.tracking || {};
                const location = tracking.lastLocation;

                return (
                  <tr key={(delivery.id || delivery.ID) as string} className="hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                    <td className="px-4 py-3" data-label="Delivery">
                      <div>
                        <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{customerName}</div>
                        <div className="text-sm text-gray-500 dark:text-gray-400">{address}</div>
                      </div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap" data-label="Status">
                      <span className={`px-2 py-1 text-xs font-semibold rounded-full ${
                        tracking.status === 'in_progress'
                          ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300'
                          : tracking.assigned
                          ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300'
                          : 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-300'
                      }`}>
                        {tracking.status || delivery.status || 'unassigned'}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400" data-label="Driver">
                      {tracking.driverId || 'Unassigned'}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400" data-label="Assigned At">
                      {tracking.assignedAt
                        ? new Date(tracking.assignedAt).toLocaleString()
                        : 'N/A'
                      }
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400" data-label="Location">
                      {location ? (
                        <div>
                          <div>{location.lat.toFixed(4)}, {location.lng.toFixed(4)}</div>
                          {location.timestamp && (
                            <div className="text-xs text-gray-400 dark:text-gray-500">{new Date(location.timestamp).toLocaleTimeString()}</div>
                          )}
                        </div>
                      ) : (
                        <span className="text-gray-400 dark:text-gray-500">No location</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <PaginationBar
            page={trackPage}
            totalPages={trackTotalPages}
            pageSize={TRACK_PAGE_SIZE}
            total={deliveries.length}
            onPageChange={goToPage}
          />
          {deliveries.length === 0 && (
            <div className="text-center py-8 text-gray-500 dark:text-gray-400">No deliveries found</div>
          )}
        </div>
      </div>
    </div>
  );
}
