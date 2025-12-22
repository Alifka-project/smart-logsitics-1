import React, { useEffect, useState } from 'react';
import api, { setAuthToken } from '../frontend/apiClient';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

function ensureAuth() {
  const token = localStorage.getItem('auth_token');
    // Session is server-side via HttpOnly cookie; ensure client_key header will be sent by apiClient interceptor
}

export default function AdminDashboardPage() {
  const [data, setData] = useState(null);
  const [sapResp, setSapResp] = useState(null);

  useEffect(() => {
    ensureAuth();
    api.get('/admin/dashboard')
      .then(r => setData(r.data))
      .catch(e => setData({ error: e?.response?.data?.error || 'fetch_failed' }));
  }, []);

  if (!data) return <div>Loading...</div>;
  if (data.error) return <div className="text-red-600">{data.error}</div>;

  const totals = data.totals || { total: 0, delivered: 0, cancelled: 0, rescheduled: 0, pending: 0 };
  const recent = data.recentCounts || { delivered: 0, cancelled: 0, rescheduled: 0 };
  const chartData = [
    { name: 'Delivered', value: totals.delivered },
    { name: 'Cancelled', value: totals.cancelled },
    { name: 'Rescheduled', value: totals.rescheduled },
    { name: 'Pending', value: totals.pending },
  ];

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-4">Admin Dashboard</h1>
      <div className="grid grid-cols-4 gap-4">
        <div className="p-4 bg-white rounded shadow">
          <div className="text-sm text-gray-500">Total Deliveries</div>
          <div className="text-2xl font-bold">{totals.total}</div>
        </div>
        <div className="p-4 bg-white rounded shadow">
          <div className="text-sm text-gray-500">Delivered</div>
          <div className="text-2xl font-bold text-green-600">{totals.delivered}</div>
        </div>
        <div className="p-4 bg-white rounded shadow">
          <div className="text-sm text-gray-500">Cancelled</div>
          <div className="text-2xl font-bold text-red-600">{totals.cancelled}</div>
        </div>
        <div className="p-4 bg-white rounded shadow">
          <div className="text-sm text-gray-500">Rescheduled</div>
          <div className="text-2xl font-bold text-yellow-600">{totals.rescheduled}</div>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-4">
        <div className="p-4 bg-white rounded shadow">
          <h2 className="text-lg font-medium">Status Breakdown</h2>
          <div style={{ width: '100%', height: 240 }} className="mt-2">
            <ResponsiveContainer>
              <BarChart data={chartData}>
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="value" fill="#2563EB" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="p-4 bg-white rounded shadow">
          <h2 className="text-lg font-medium">Recent (24h)</h2>
          <div className="mt-2">
            <div>Delivered: <strong>{recent.delivered}</strong></div>
            <div>Cancelled: <strong>{recent.cancelled}</strong></div>
            <div>Rescheduled: <strong>{recent.rescheduled}</strong></div>
          </div>
        </div>
      </div>
      <div className="mt-6">
        <h2 className="text-lg font-medium">SAP</h2>
        <div className="mt-2">
          <button
            className="px-3 py-2 bg-blue-600 text-white rounded"
            onClick={async () => {
              try {
                setSapResp('loading');
                const r = await api.get('/sap/ping');
                setSapResp(JSON.stringify(r.data));
              } catch (e) {
                setSapResp(e?.response?.data || e.message);
              }
            }}
          >Ping SAP</button>
          <div className="mt-2 text-sm text-gray-700">{sapResp && <pre className="whitespace-pre-wrap">{typeof sapResp === 'string' ? sapResp : JSON.stringify(sapResp)}</pre>}</div>
        </div>
      </div>
    </div>
  );
}
