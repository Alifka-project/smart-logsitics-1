import React, { useEffect, useState } from 'react';
import api, { setAuthToken } from '../frontend/apiClient';

function ensureAuth() {
  const token = localStorage.getItem('auth_token');
  if (token) setAuthToken(token);
}

export default function AdminDashboardPage() {
  const [data, setData] = useState(null);

  useEffect(() => {
    ensureAuth();
    api.get('/admin/dashboard')
      .then(r => setData(r.data))
      .catch(e => setData({ error: e?.response?.data?.error || 'fetch_failed' }));
  }, []);

  if (!data) return <div>Loading...</div>;
  if (data.error) return <div className="text-red-600">{data.error}</div>;

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-4">Admin Dashboard</h1>
      <div className="grid grid-cols-3 gap-4">
        <div className="p-4 bg-white rounded shadow">Drivers: <strong>{data.drivers}</strong></div>
        <div className="p-4 bg-white rounded shadow">Recent locations (1h): <strong>{data.recentLocations}</strong></div>
        <div className="p-4 bg-white rounded shadow">SMS last 24h: <strong>{data.smsRecent}</strong></div>
      </div>
      <div className="mt-6">
        <h2 className="text-lg font-medium">Pending deliveries</h2>
        <div className="p-4 bg-white rounded shadow mt-2">{data.pendingDeliveries === null ? 'N/A (no deliveries table)' : data.pendingDeliveries}</div>
      </div>
    </div>
  );
}
