import React, { useEffect, useState } from 'react';
import api, { setAuthToken } from '../frontend/apiClient';
import DeliveryMap from '../components/MapView/DeliveryMap';
import { Package, MapPin, Clock, CheckCircle } from 'lucide-react';

function ensureAuth() {
  const token = localStorage.getItem('auth_token');
  if (token) setAuthToken(token);
}

export default function AdminDeliveryTrackingPage() {
  const [trackingData, setTrackingData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState(new Date());

  useEffect(() => {
    ensureAuth();
    loadTrackingData();

    // Refresh once when tab becomes visible again
    const handleVisChange = () => {
      if (!document.hidden) loadTrackingData();
    };
    document.addEventListener('visibilitychange', handleVisChange);

    // Refresh when deliveries are updated via app actions
    const handleDeliveriesUpdated = () => loadTrackingData();
    const handleDeliveryStatusUpdated = () => loadTrackingData();
    window.addEventListener('deliveriesUpdated', handleDeliveriesUpdated);
    window.addEventListener('deliveryStatusUpdated', handleDeliveryStatusUpdated);

    return () => {
      document.removeEventListener('visibilitychange', handleVisChange);
      window.removeEventListener('deliveriesUpdated', handleDeliveriesUpdated);
      window.removeEventListener('deliveryStatusUpdated', handleDeliveryStatusUpdated);
    };
  }, []);

  const loadTrackingData = async () => {
    try {
      const response = await api.get('/admin/tracking/deliveries');
      setTrackingData(response.data);
      setLastUpdate(new Date());
    } catch (e) {
      console.error('Error loading delivery tracking:', e);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto mb-4"></div>
          <p className="text-gray-600 dark:text-gray-400">Loading delivery tracking...</p>
        </div>
      </div>
    );
  }

  const deliveries = trackingData?.deliveries || [];
  const assignedDeliveries = deliveries.filter(d => d.tracking?.assigned);
  const inProgressDeliveries = deliveries.filter(d => d.tracking?.status === 'in_progress');
  const completedDeliveries = deliveries.filter(d => d.status?.toLowerCase() === 'delivered');

  // Prepare deliveries for map (with driver locations)
  const deliveriesForMap = deliveries.map(d => ({
    ...d,
    lat: d.lat || d.Lat || d.tracking?.lastLocation?.lat || 25.1124,
    lng: d.lng || d.Lng || d.tracking?.lastLocation?.lng || 55.1980,
  }));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
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
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-5 transition-colors">
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
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-5 transition-colors">
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
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-5 transition-colors">
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
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-5 transition-colors">
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
      {deliveriesForMap.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm overflow-hidden transition-colors">
          <DeliveryMap deliveries={deliveriesForMap} route={null} />
        </div>
      )}

      {/* Delivery List */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-5 transition-colors">
        <h2 className="text-xl font-semibold mb-4 text-gray-900 dark:text-gray-100">Delivery Status</h2>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
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
              {deliveries.slice(0, 50).map(delivery => {
                const customerName = delivery.customer || delivery.Customer || 'Unknown';
                const address = delivery.address || delivery.Address || 'N/A';
                const tracking = delivery.tracking || {};
                const location = tracking.lastLocation;

                return (
                  <tr key={delivery.id || delivery.ID} className="hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                    <td className="px-4 py-3">
                      <div>
                        <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{customerName}</div>
                        <div className="text-sm text-gray-500 dark:text-gray-400">{address}</div>
                      </div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
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
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                      {tracking.driverId || 'Unassigned'}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                      {tracking.assignedAt 
                        ? new Date(tracking.assignedAt).toLocaleString()
                        : 'N/A'
                      }
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
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
          {deliveries.length === 0 && (
            <div className="text-center py-8 text-gray-500 dark:text-gray-400">No deliveries found</div>
          )}
        </div>
      </div>
    </div>
  );
}

