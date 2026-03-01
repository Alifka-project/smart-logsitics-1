import React, { useEffect, useState } from 'react';
import api, { setAuthToken } from '../frontend/apiClient';
import DriverTrackingMap from '../components/Tracking/DriverTrackingMap';
import { MapPin, Activity, Users, Radio } from 'lucide-react';

function ensureAuth() {
  const token = localStorage.getItem('auth_token');
  if (token) setAuthToken(token);
}

export default function AdminDriverTrackingPage() {
  const [drivers, setDrivers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState(new Date());

  useEffect(() => {
    ensureAuth();
    loadDriverTracking();

    // Refresh once when tab becomes visible again
    const handleVisChange = () => {
      if (!document.hidden) loadDriverTracking();
    };
    document.addEventListener('visibilitychange', handleVisChange);

    // Refresh when deliveries/drivers are updated via app actions
    const handleDeliveriesUpdated = () => loadDriverTracking();
    const handleDeliveryStatusUpdated = () => loadDriverTracking();
    window.addEventListener('deliveriesUpdated', handleDeliveriesUpdated);
    window.addEventListener('deliveryStatusUpdated', handleDeliveryStatusUpdated);

    return () => {
      document.removeEventListener('visibilitychange', handleVisChange);
      window.removeEventListener('deliveriesUpdated', handleDeliveriesUpdated);
      window.removeEventListener('deliveryStatusUpdated', handleDeliveryStatusUpdated);
    };
  }, []);

  const loadDriverTracking = async () => {
    try {
      const response = await api.get('/admin/tracking/drivers');
      setDrivers(response.data.drivers || []);
      setLastUpdate(new Date());
    } catch (e) {
      console.error('Error loading driver tracking:', e);
    } finally {
      setLoading(false);
    }
  };

  const onlineDrivers = drivers.filter(d => d.tracking?.online);
  const driversWithLocation = drivers.filter(d => d.tracking?.location);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto mb-4"></div>
          <p className="text-gray-600 dark:text-gray-400">Loading driver tracking...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="pp-page-title">Real-Time Driver Tracking</h1>
          <p className="pp-page-subtitle">
            Last updated: {lastUpdate.toLocaleTimeString()}
            <span className="ml-2 text-green-600 dark:text-green-400">● Live</span>
          </p>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-5 transition-colors">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-gray-600 dark:text-gray-400 mb-1">Total Drivers</div>
              <div className="text-3xl font-bold" style={{color:'var(--text)'}}>{drivers.length}</div>
            </div>
            <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
              <Users className="w-6 h-6 text-blue-600 dark:text-blue-400" />
            </div>
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-5 transition-colors">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-gray-600 dark:text-gray-400 mb-1">Online Drivers</div>
              <div className="text-3xl font-bold text-green-600 dark:text-green-400">{onlineDrivers.length}</div>
            </div>
            <div className="p-3 bg-green-50 dark:bg-green-900/20 rounded-lg">
              <Activity className="w-6 h-6 text-green-600 dark:text-green-400" />
            </div>
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-5 transition-colors">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-gray-600 dark:text-gray-400 mb-1">With Location</div>
              <div className="text-3xl font-bold text-purple-600 dark:text-purple-400">{driversWithLocation.length}</div>
            </div>
            <div className="p-3 bg-purple-50 dark:bg-purple-900/20 rounded-lg">
              <MapPin className="w-6 h-6 text-purple-600 dark:text-purple-400" />
            </div>
          </div>
        </div>
      </div>

      {/* Map */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm overflow-hidden transition-colors">
        <DriverTrackingMap drivers={drivers} />
      </div>

      {/* Driver List */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-5 transition-colors">
        <h2 className="text-xl font-semibold mb-4 text-gray-900 dark:text-gray-100">Driver Status</h2>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-700">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Driver</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Location</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Last Update</th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
              {drivers.map(driver => {
                const driverName = driver.full_name || driver.name || driver.username || 'Unknown';
                const isOnline = driver.tracking?.online;
                const location = driver.tracking?.location;

                return (
                  <tr key={driver.id} className="hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="flex items-center">
                        <div className={`w-3 h-3 rounded-full mr-3 ${isOnline ? 'bg-green-500' : 'bg-gray-400'}`}></div>
                        <div>
                          <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{driverName}</div>
                          {driver.phone && (
                            <div className="text-sm text-gray-500 dark:text-gray-400">{driver.phone}</div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className={`px-2 py-1 text-xs font-semibold rounded-full ${
                        isOnline 
                          ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300' 
                          : 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-300'
                      }`}>
                        {driver.tracking?.status || 'offline'}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                      {location ? (
                        <div>
                          <div>{location.lat.toFixed(4)}, {location.lng.toFixed(4)}</div>
                          {location.speed && (
                            <div className="text-xs text-gray-400 dark:text-gray-500">{(location.speed * 3.6).toFixed(0)} km/h</div>
                          )}
                        </div>
                      ) : (
                        <span className="text-gray-400 dark:text-gray-500">No location</span>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                      {location?.timestamp 
                        ? new Date(location.timestamp).toLocaleTimeString()
                        : driver.tracking?.lastUpdate
                          ? new Date(driver.tracking.lastUpdate).toLocaleTimeString()
                          : 'N/A'
                      }
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {drivers.length === 0 && (
            <div className="text-center py-8 text-gray-500 dark:text-gray-400">No drivers found</div>
          )}
        </div>
      </div>
    </div>
  );
}

