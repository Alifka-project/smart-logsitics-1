import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import api, { setAuthToken } from '../frontend/apiClient';
import { setAuthData, isAuthenticated } from '../frontend/auth';
import { Eye, EyeOff } from 'lucide-react';

export default function LoginPage() {
  const navigate = useNavigate();
  const [username, setUsername]           = useState('');
  const [password, setPassword]           = useState('');
  const [showPassword, setShowPassword]   = useState(false);
  const [rememberMe, setRememberMe]       = useState(false);
  const [error, setError]                 = useState(null);
  const [loading, setLoading]             = useState(false);
  const [passwordErrors, setPasswordErrors] = useState([]);

  // Force light theme on the login page
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const html = document.documentElement;
    const previousClasses = Array.from(html.classList);
    const previousBg = html.style.backgroundColor;
    html.classList.remove('dark');
    if (!html.classList.contains('light')) html.classList.add('light');
    html.style.backgroundColor = '#ffffff';
    return () => {
      html.className = previousClasses.join(' ');
      html.style.backgroundColor = previousBg;
    };
  }, []);

  // Redirect if already authenticated
  useEffect(() => {
    if (isAuthenticated()) {
      api.get('/auth/me')
        .then((response) => {
          if (response.data?.user || response.data?.driver) {
            const user = JSON.parse(localStorage.getItem('client_user') || '{}');
            navigate(user?.role === 'admin' ? '/admin' : '/driver', { replace: true });
          }
        })
        .catch(() => {});
    }
  }, [navigate]);

  async function submit(e) {
    e.preventDefault();
    setError(null);
    setPasswordErrors([]);
    setLoading(true);
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);
      const res = await api.post('/auth/login', { username, password }, { signal: controller.signal });
      clearTimeout(timeoutId);

      const { driver, clientKey, csrfToken, accessToken } = res.data;
      if (!driver || !accessToken) {
        setError('Invalid login response from server');
        setLoading(false);
        return;
      }
      setAuthData({ clientKey, driver, csrfToken, accessToken });
      setAuthToken(accessToken);
      const token = localStorage.getItem('auth_token');
      if (!token) {
        setError('Failed to save authentication token');
        setLoading(false);
        return;
      }
      if (driver?.role === 'admin') {
        window.location.href = '/admin';
      } else if (driver?.role === 'delivery_team') {
        window.location.href = '/delivery-team';
      } else {
        window.location.href = '/driver';
      }
    } catch (err) {
      if (err.name === 'AbortError' || err.code === 'ECONNABORTED') {
        setError('Request timeout. Please try again.');
        setLoading(false);
        return;
      }
      if (!err?.response) {
        setError('Cannot connect to server. Please check your internet connection.');
        setLoading(false);
        return;
      }
      const errorMessage = err?.response?.data?.error || err?.response?.data?.message || err?.message || 'Login failed';
      const errorDetails = err?.response?.data?.details;
      if (errorDetails && Array.isArray(errorDetails)) {
        setPasswordErrors(errorDetails);
        setError('Please fix the password requirements');
      } else if (err?.response?.status === 423) {
        setError(err.response.data.message || 'Account locked due to too many failed attempts');
      } else if (err?.response?.status === 429) {
        setError('Too many login attempts. Please wait 15 minutes and try again.');
      } else if (err?.response?.status === 401) {
        setError('Invalid username or password. Please check your credentials and try again.');
      } else if (err?.response?.status >= 500) {
        setError('Server error. Please try again later.');
      } else if (err?.response?.status === 400) {
        setError(errorMessage || 'Invalid request. Please check your input.');
      } else {
        setError('Login failed. Please check your credentials.');
      }
      setLoading(false);
    }
  }

  /* ── Shared form content (used in both layouts) ── */
  const formContent = (
    <>
      {error && (
        <div className="bg-red-50 border-l-4 border-red-500 text-red-800 text-sm p-3 rounded mb-4 text-left">
          <div className="font-semibold mb-1">Error</div>
          <div>{error}</div>
        </div>
      )}
      {passwordErrors.length > 0 && (
        <div className="bg-yellow-50 border-l-4 border-yellow-500 text-yellow-800 text-xs p-3 rounded mb-4 text-left">
          <div className="font-semibold mb-1">Password requirements:</div>
          <ul className="list-disc list-inside space-y-0.5">
            {passwordErrors.map((err, idx) => (
              <li key={idx}>{err.replace(/_/g, ' ')}</li>
            ))}
          </ul>
        </div>
      )}
      <form onSubmit={submit} className="space-y-5">
        <div>
          <label className="block text-sm font-medium text-gray-800 mb-1.5">Username</label>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="w-full px-4 py-3 border border-gray-300 rounded-xl text-sm outline-none bg-white transition-all focus:border-[#011E41] focus:ring-2 focus:ring-[#011E4122]"
            placeholder="Enter your username"
            required
            autoComplete="username"
            disabled={loading}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-800 mb-1.5">Password</label>
          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-3 pr-11 border border-gray-300 rounded-xl text-sm outline-none bg-white transition-all focus:border-[#011E41] focus:ring-2 focus:ring-[#011E4122]"
              placeholder="Enter your password"
              required
              autoComplete="current-password"
              disabled={loading}
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 focus:outline-none"
              tabIndex={-1}
            >
              {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
            </button>
          </div>
        </div>
        <div className="flex items-center justify-between text-xs">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={rememberMe}
              onChange={(e) => setRememberMe(e.target.checked)}
              className="rounded border-gray-300"
              style={{ accentColor: '#011E41' }}
            />
            <span className="text-gray-700">Remember me</span>
          </label>
          <Link to="/forgot-password" className="text-[#2563EB] hover:underline font-medium">
            Forgot password?
          </Link>
        </div>
        <button
          type="submit"
          disabled={loading}
          className="w-full text-white font-semibold py-3 px-4 rounded-xl bg-[#011E41] hover:bg-[#001529] transition-colors duration-150 disabled:opacity-60 disabled:cursor-not-allowed shadow-md"
        >
          {loading ? (
            <span className="flex items-center justify-center">
              <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              Signing in...
            </span>
          ) : (
            'Sign in'
          )}
        </button>
      </form>
    </>
  );

  return (
    <>
      {/* ════════════════════════════════════════
          MOBILE  (< lg) — top 50% image, bottom 50% card
          ════════════════════════════════════════ */}
      <div className="relative h-screen min-h-screen overflow-hidden light lg:hidden">
        {/* Top 50% — image */}
        <div
          className="absolute inset-x-0 top-0 h-[50%]"
          style={{
            backgroundImage: 'url(/elec%20login.png)',
            backgroundSize: '100% auto',
            backgroundPosition: 'center top',
            backgroundRepeat: 'no-repeat',
          }}
        >
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/20 via-transparent to-transparent" />
        </div>

        {/* Card — 60% height, anchored to bottom, overlaps image by 10% */}
        <div className="absolute inset-x-0 bottom-0 h-[60%] bg-white rounded-t-[30px] shadow-[0_-8px_40px_rgba(15,23,42,0.18)] z-10 flex flex-col">
          <div className="px-5 pt-6 pb-6 flex flex-col h-full">
            <h2 className="text-2xl font-bold text-black mb-1">Welcome back</h2>
            <p className="text-sm text-gray-500 mb-5">Sign in to access your deliveries.</p>
            {formContent}
          </div>
        </div>
      </div>

      {/* ════════════════════════════════════════
          DESKTOP  (lg+) — image left, form right
          ════════════════════════════════════════ */}
      <div
        className="hidden lg:flex min-h-screen items-center justify-center px-4 py-8 light"
        style={{
          backgroundImage: 'url(/elec%20login.png)',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
        }}
      >
        {/* Outer card — image left | form right */}
        <div className="w-full max-w-6xl bg-white rounded-3xl border-4 border-white shadow-2xl overflow-hidden flex flex-row">

          {/* Left — image panel */}
          <div
            className="w-1/2 relative min-h-[600px]"
            style={{
              backgroundImage: 'url(/elec%20login.png)',
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              backgroundRepeat: 'no-repeat',
            }}
          />

          {/* Right — login form */}
          <div className="w-1/2 bg-white px-12 py-14 flex flex-col justify-center">
            <div className="max-w-md w-full mx-auto">
              <h2 className="text-4xl font-bold text-black mb-2">Welcome back</h2>
              <p className="text-gray-500 text-sm mb-8">Sign in to access your deliveries.</p>
              {formContent}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
