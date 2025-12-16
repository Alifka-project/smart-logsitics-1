import React, { useState } from 'react';
import api, { setAuthToken } from '../frontend/apiClient';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    try {
      const res = await api.post('/auth/login', { username, password });
      const { token } = res.data;
      localStorage.setItem('auth_token', token);
      setAuthToken(token);
      window.location.href = '/admin';
    } catch (err) {
      setError(err?.response?.data?.error || 'login_failed');
    }
  }

  return (
    <div className="max-w-md mx-auto bg-white p-6 rounded shadow">
      <h2 className="text-xl font-semibold mb-4">Sign In</h2>
      {error && <div className="text-red-600 mb-2">{error}</div>}
      <form onSubmit={submit}>
        <label className="block mb-2">
          <div className="text-sm">Username</div>
          <input value={username} onChange={(e)=>setUsername(e.target.value)} className="border p-2 w-full" />
        </label>
        <label className="block mb-4">
          <div className="text-sm">Password</div>
          <input type="password" value={password} onChange={(e)=>setPassword(e.target.value)} className="border p-2 w-full" />
        </label>
        <button className="bg-blue-600 text-white px-4 py-2 rounded">Sign in</button>
      </form>
    </div>
  );
}
