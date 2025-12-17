import React, { useState } from 'react';
import api, { setAuthToken } from '../frontend/apiClient';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await api.post('/auth/login', { username, password });
      const { token, driver } = res.data;
      localStorage.setItem('auth_token', token);
      setAuthToken(token);
      // Redirect based on role
      if (driver?.role === 'admin') window.location.href = '/admin';
      else window.location.href = '/driver';
    } catch (err) {
      setError(err?.response?.data?.error || 'Login failed');
      setLoading(false);
    }
  }

  return (
    <div className="max-w-md mx-auto bg-white p-8 rounded shadow-lg">
      <h2 className="text-2xl font-semibold mb-4">Sign In to Dubai Logistics</h2>
      <p className="text-sm text-gray-600 mb-4">Enter your company credentials to continue.</p>
      {error && <div className="text-red-600 mb-2">{error}</div>}
      <form onSubmit={submit}>
        <label className="block mb-3">
          <div className="text-sm font-medium mb-1">Username</div>
          <input value={username} onChange={(e)=>setUsername(e.target.value)} className="border p-3 w-full rounded" placeholder="Enter username" />
        </label>
        <label className="block mb-4">
          <div className="text-sm font-medium mb-1">Password</div>
          <input type="password" value={password} onChange={(e)=>setPassword(e.target.value)} className="border p-3 w-full rounded" placeholder="Enter password" />
        </label>
        <div className="flex items-center justify-between">
          <button disabled={loading} className="bg-purple-600 disabled:opacity-60 text-white px-6 py-2 rounded font-medium">{loading? 'Signing in...' : 'Sign in'}</button>
          <a href="#" className="text-sm text-gray-600">Forgot password?</a>
        </div>
      </form>
    </div>
  );
}
