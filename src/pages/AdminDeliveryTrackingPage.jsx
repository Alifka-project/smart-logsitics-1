import React, { useEffect, useState } from 'react';
import api, { setAuthToken } from '../frontend/apiClient';
import DeliveryMap from '../components/MapView/DeliveryMap';
import { Package, MapPin, Clock, CheckCircle } from 'lucide-react';

function ensureAuth() {
  const token = localStorage.getItem('auth_token');
}

export default function AdminDeliveryTrackingPage() {
  const [trackingData, setTrackingData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastUpdate, setLastUpdate] = useState(new Date());

  useEffect(() => {
    ensureAuth();
    loadTrackingData();

    if (autoRefresh) {
      const interval = setInterval(() => {
        loadTrackingData();
      }, 5000); // Refresh every 5 seconds

      return () => clearInterval(interval);
    }
  }, [autoRefresh]);

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
          <p className="text-gray-600">Loading delivery tracking...</p>
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
          <h1 className="text-3xl font-bold text-gray-800">Real-Time Delivery Tracking</h1>
          <p className="text-sm text-gray-500 mt-1">
            Last updated: {lastUpdate.toLocaleTimeString()}
            {autoRefresh && <span className="ml-2 text-green-600">● Live</span>}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="rounded"
            />
            <span className="text-sm text-gray-700">Auto-refresh</span>
          </label>
          <button
            onClick={loadTrackingData}
            className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm"
          >
            Refresh Now
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-gray-600 mb-1">Total Deliveries</div>
              <div className="text-3xl font-bold text-gray-800">{deliveries.length}</div>
            </div>
            <div className="p-3 bg-blue-50 rounded-lg">
              <Package className="w-6 h-6 text-blue-600" />
            </div>
          </div>
        </div>
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-gray-600 mb-1">Assigned</div>
              <div className="text-3xl font-bold text-purple-600">{assignedDeliveries.length}</div>
            </div>
            <div className="p-3 bg-purple-50 rounded-lg">
              <MapPin className="w-6 h-6 text-purple-600" />
            </div>
          </div>
        </div>
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-gray-600 mb-1">In Progress</div>
              <div className="text-3xl font-bold text-yellow-600">{inProgressDeliveries.length}</div>
            </div>
            <div className="p-3 bg-yellow-50 rounded-lg">
              <Clock className="w-6 h-6 text-yellow-600" />
            </div>
          </div>
        </div>
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-gray-600 mb-1">Completed</div>
              <div className="text-3xl font-bold text-green-600">{completedDeliveries.length}</div>
            </div>
            <div className="p-3 bg-green-50 rounded-lg">
              <CheckCircle className="w-6 h-6 text-green-600" />
            </div>
          </div>
        </div>
      </div>

      {/* Map */}
      {deliveriesForMap.length > 0 && (
        <div className="bg-white rounded-lg shadow-lg overflow-hidden">
          <DeliveryMap deliveries={deliveriesForMap} route={null} />
        </div>
      )}

      {/* Delivery List */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-xl font-semibold mb-4">Delivery Status</h2>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Delivery</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Driver</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Assigned At</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Location</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {deliveries.slice(0, 50).map(delivery => {
                const customerName = delivery.customer || delivery.Customer || 'Unknown';
                const address = delivery.address || delivery.Address || 'N/A';
                const tracking = delivery.tracking || {};
                const location = tracking.lastLocation;

                return (
                  <tr key={delivery.id || delivery.ID}>
                    <td className="px-4 py-3">
                      <div>
                        <div className="text-sm font-medium text-gray-900">{customerName}</div>
                        <div className="text-sm text-gray-500">{address}</div>
                      </div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className={`px-2 py-1 text-xs font-semibold rounded-full ${
                        tracking.status === 'in_progress'
                          ? 'bg-yellow-100 text-yellow-800'
                          : tracking.assigned
                          ? 'bg-blue-100 text-blue-800'
                          : 'bg-gray-100 text-gray-800'
                      }`}>
                        {tracking.status || delivery.status || 'unassigned'}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                      {tracking.driverId || 'Unassigned'}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                      {tracking.assignedAt 
                        ? new Date(tracking.assignedAt).toLocaleString()
                        : 'N/A'
                      }
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                      {location ? (
                        <div>
                          <div>{location.lat.toFixed(4)}, {location.lng.toFixed(4)}</div>
                          {location.timestamp && (
                            <div className="text-xs">{new Date(location.timestamp).toLocaleTimeString()}</div>
                          )}
                        </div>
                      ) : (
                        <span className="text-gray-400">No location</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {deliveries.length === 0 && (
            <div className="text-center py-8 text-gray-500">No deliveries found</div>
          )}
        </div>
      </div>
    </div>
  );
}

