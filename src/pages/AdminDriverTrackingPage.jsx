import React, { useEffect, useState } from 'react';
import api, { setAuthToken } from '../frontend/apiClient';
import DriverTrackingMap from '../components/Tracking/DriverTrackingMap';
import { MapPin, Activity, Users, Radio } from 'lucide-react';

function ensureAuth() {
  const token = localStorage.getItem('auth_token');
}

export default function AdminDriverTrackingPage() {
  const [drivers, setDrivers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastUpdate, setLastUpdate] = useState(new Date());

  useEffect(() => {
    ensureAuth();
    loadDriverTracking();

    if (autoRefresh) {
      const interval = setInterval(() => {
        loadDriverTracking();
      }, 5000); // Refresh every 5 seconds

      return () => clearInterval(interval);
    }
  }, [autoRefresh]);

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
          <p className="text-gray-600">Loading driver tracking...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-800">Real-Time Driver Tracking</h1>
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
            onClick={loadDriverTracking}
            className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm"
          >
            Refresh Now
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-gray-600 mb-1">Total Drivers</div>
              <div className="text-3xl font-bold text-gray-800">{drivers.length}</div>
            </div>
            <div className="p-3 bg-blue-50 rounded-lg">
              <Users className="w-6 h-6 text-blue-600" />
            </div>
          </div>
        </div>
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-gray-600 mb-1">Online Drivers</div>
              <div className="text-3xl font-bold text-green-600">{onlineDrivers.length}</div>
            </div>
            <div className="p-3 bg-green-50 rounded-lg">
              <Activity className="w-6 h-6 text-green-600" />
            </div>
          </div>
        </div>
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-gray-600 mb-1">With Location</div>
              <div className="text-3xl font-bold text-purple-600">{driversWithLocation.length}</div>
            </div>
            <div className="p-3 bg-purple-50 rounded-lg">
              <MapPin className="w-6 h-6 text-purple-600" />
            </div>
          </div>
        </div>
      </div>

      {/* Map */}
      <div className="bg-white rounded-lg shadow-lg overflow-hidden">
        <DriverTrackingMap drivers={drivers} />
      </div>

      {/* Driver List */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-xl font-semibold mb-4">Driver Status</h2>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Driver</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Location</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Last Update</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {drivers.map(driver => {
                const driverName = driver.full_name || driver.name || driver.username || 'Unknown';
                const isOnline = driver.tracking?.online;
                const location = driver.tracking?.location;

                return (
                  <tr key={driver.id}>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="flex items-center">
                        <div className={`w-3 h-3 rounded-full mr-3 ${isOnline ? 'bg-green-500' : 'bg-gray-400'}`}></div>
                        <div>
                          <div className="text-sm font-medium text-gray-900">{driverName}</div>
                          {driver.phone && (
                            <div className="text-sm text-gray-500">{driver.phone}</div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className={`px-2 py-1 text-xs font-semibold rounded-full ${
                        isOnline 
                          ? 'bg-green-100 text-green-800' 
                          : 'bg-gray-100 text-gray-800'
                      }`}>
                        {driver.tracking?.status || 'offline'}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                      {location ? (
                        <div>
                          <div>{location.lat.toFixed(4)}, {location.lng.toFixed(4)}</div>
                          {location.speed && (
                            <div className="text-xs">{(location.speed * 3.6).toFixed(0)} km/h</div>
                          )}
                        </div>
                      ) : (
                        <span className="text-gray-400">No location</span>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
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
            <div className="text-center py-8 text-gray-500">No drivers found</div>
          )}
        </div>
      </div>
    </div>
  );
}

