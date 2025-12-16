import React, { useEffect, useState } from 'react';
import api, { setAuthToken } from '../frontend/apiClient';

function ensureAuth() {
  const token = localStorage.getItem('auth_token');
  if (token) setAuthToken(token);
}

export default function DriverPortal() {
  const [loc, setLoc] = useState(null);

  useEffect(() => {
    ensureAuth();
    // fetch latest location for driver
    async function load() {
      try {
        // driver id is embedded in token subject, but for simplicity try /api/driver/me/live if available
        const r = await api.get('/driver/me/live').catch(()=>null);
        if (r && r.data) setLoc(r.data);
      } catch (e) {}
    }
    load();
  }, []);

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-4">Driver Portal</h1>
      <div className="p-4 bg-white rounded shadow">
        <div>Latest location:</div>
        <pre className="mt-2">{loc ? JSON.stringify(loc, null, 2) : 'No location recorded'}</pre>
      </div>
    </div>
  );
}
