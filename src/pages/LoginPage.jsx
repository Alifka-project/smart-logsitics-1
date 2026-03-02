import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import api, { setAuthToken } from '../frontend/apiClient';
import { setAuthData, isAuthenticated } from '../frontend/auth';
import { Eye, EyeOff } from 'lucide-react';

function SegmentedTabs({ active, onChange }) {
  return (
    <div className="mt-4 mb-6">
      <div className="inline-flex w-full max-w-xs mx-auto rounded-full border border-gray-200 bg-white p-1 shadow-sm">
        {['login', 'signup'].map((key) => {
          const isActive = active === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => onChange(key)}
              className={
                'flex-1 px-3 py-2 text-sm font-semibold rounded-full transition-colors ' +
                (isActive
                  ? 'bg-[#2563EB] text-white'
                  : 'bg-transparent text-gray-700 hover:bg-gray-50')
              }
            >
              {key === 'login' ? 'Login' : 'Sign up'}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function LoginPage() {
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [passwordErrors, setPasswordErrors] = useState([]);
  const [authMode, setAuthMode] = useState('login'); // 'login' | 'signup'

  // Force light theme on the login page so it's always readable,
  // independent from the in-app dark mode styling.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const html = document.documentElement;
    const previousClasses = Array.from(html.classList);
    const previousBg = html.style.backgroundColor;

    html.classList.remove('dark');
    if (!html.classList.contains('light')) {
      html.classList.add('light');
    }
    html.style.backgroundColor = '#F5F6FA';

    return () => {
      html.className = previousClasses.join(' ');
      html.style.backgroundColor = previousBg;
    };
  }, []);

  const loginForm = (
    <div className="w-full max-w-md mx-auto">
      {/* Title */}
      <h1 className="text-[28px] leading-tight font-bold text-center text-black mb-1">
        Welcome back
      </h1>
      <p className="text-sm text-gray-600 text-center mb-4">
        Sign in to access your deliveries.
      </p>

      {/* Segmented control: Login / Sign up */}
      <SegmentedTabs active={authMode} onChange={setAuthMode} />

      {authMode === 'login' && (
        <>
          {/* Errors */}
          {error && (
            <div className="bg-red-50 border-l-4 border-red-500 text-red-800 text-sm p-3 rounded mb-3 text-left">
              <div className="font-semibold mb-1">Error</div>
              <div>{error}</div>
            </div>
          )}

          {passwordErrors.length > 0 && (
            <div className="bg-yellow-50 border-l-4 border-yellow-500 text-yellow-800 text-xs p-3 rounded mb-3 text-left">
              <div className="font-semibold mb-1">Password requirements:</div>
              <ul className="list-disc list-inside space-y-0.5">
                {passwordErrors.map((err, idx) => (
                  <li key={idx}>{err.replace(/_/g, ' ')}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Login form */}
          <form onSubmit={submit} className="space-y-4 mt-1">
            {/* Username Field */}
            <div>
              <label className="block text-xs font-semibold text-gray-800 mb-1.5">
                Username
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-[16px] text-sm transition-all outline-none bg-white focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB33]"
                placeholder="Enter your username"
                required
                autoComplete="username"
                disabled={loading}
              />
            </div>

            {/* Password Field */}
            <div>
              <label className="block text-xs font-semibold text-gray-800 mb-1.5">
                Password
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-4 py-3 pr-11 border border-gray-300 rounded-[16px] text-sm transition-all outline-none bg-white focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB33]"
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

            {/* Remember me / Forgot password */}
            <div className="flex items-center justify-between text-xs mt-1">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="rounded border-gray-300 focus:ring-2 focus:ring-offset-0 focus:ring-[#2563EB33]"
                />
                <span className="text-gray-800">Remember me</span>
              </label>
              <Link
                to="/forgot-password"
                className="text-[#2563EB] hover:underline font-medium"
              >
                Forgot password?
              </Link>
            </div>

            {/* Primary button */}
            <button
              type="submit"
              disabled={loading}
              className="w-full mt-1 text-white font-semibold py-3 px-4 rounded-full bg-[#011E41] hover:bg-[#001529] transition-colors duration-150 disabled:opacity-60 disabled:cursor-not-allowed shadow-md"
            >
              {loading ? (
                <span className="flex items-center justify-center">
                  <svg
                    className="animate-spin -ml-1 mr-3 h-5 w-5 text-white"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    ></circle>
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    ></path>
                  </svg>
                  Signing in...
                </span>
              ) : (
                'Sign in'
              )}
            </button>
          </form>
        </>
      )}

      {authMode === 'signup' && (
        <div className="mt-4 text-sm text-gray-700 text-center">
          Sign up is not available in this portal yet. Please use the login tab with the
          credentials provided by your administrator.
        </div>
      )}
    </div>
  );

  // Redirect if already authenticated (only after proper validation)
  useEffect(() => {
    if (isAuthenticated()) {
      // Double check with server if available
      api.get('/auth/me')
        .then((response) => {
          if (response.data?.user || response.data?.driver) {
            const user = JSON.parse(localStorage.getItem('client_user') || '{}');
            if (user?.role === 'admin') {
              navigate('/admin', { replace: true });
            } else {
              navigate('/driver', { replace: true });
            }
          }
        })
        .catch(() => {
          // Server validation failed, stay on login page
          // User must log in properly
        });
    }
  }, [navigate]);

  async function submit(e) {
    e.preventDefault();
    setError(null);
    setPasswordErrors([]);
    setLoading(true);
    
    // ALWAYS require proper login - no dev mode bypass
    try {
      // Add timeout to prevent hanging
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout
      
      const res = await api.post('/auth/login', 
        { username, password },
        { signal: controller.signal }
      );
      clearTimeout(timeoutId);
      
      const { driver, clientKey, csrfToken, accessToken } = res.data;
      
      // Validate response
      if (!driver || !accessToken) {
        setError('Invalid login response from server');
        setLoading(false);
        return;
      }
      
      console.log('[LoginPage] Setting auth token and data...');
      
      // Store authentication data FIRST
      setAuthData({
        clientKey,
        driver,
        csrfToken,
        accessToken
      });
      
      // Set the Authorization header
      setAuthToken(accessToken);
      console.log('[LoginPage] Auth token set in headers');
      
      // Verify token was set
      const token = localStorage.getItem('auth_token');
      if (!token) {
        console.error('[LoginPage] Auth token not found in localStorage after setting!');
        setError('Failed to save authentication token');
        setLoading(false);
        return;
      }
      
      console.log('[LoginPage] Token saved to localStorage, redirecting...');
      
      // Redirect based on role
      if (driver?.role === 'admin') {
        window.location.href = '/admin';
      } else if (driver?.role === 'delivery_team') {
        window.location.href = '/delivery-team';
      } else {
        window.location.href = '/driver';
      }
    } catch (err) {
      console.error('[LoginPage] Login error:', err);
      console.error('[LoginPage] Error response:', err?.response);
      console.error('[LoginPage] Error status:', err?.response?.status);
      console.error('[LoginPage] Error data:', err?.response?.data);
      
      // Handle timeout/abort
      if (err.name === 'AbortError' || err.code === 'ECONNABORTED') {
        setError('Request timeout. The server is taking too long to respond. Please try again.');
        setLoading(false);
        return;
      }
      
      // Network error or server not available
      if (!err?.response) {
        setError('Cannot connect to server. Please check your internet connection or try again later.');
        setLoading(false);
        return;
      }
      
      const errorMessage = err?.response?.data?.error || err?.response?.data?.message || err?.message || 'Login failed';
      const errorDetails = err?.response?.data?.details;
      
      if (errorDetails && Array.isArray(errorDetails)) {
        // Password validation errors
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
      
      // Always stop loading
      setLoading(false);
    }
  }

  return (
    <>
      {/* ── MOBILE (< lg): 50 % image / 50 % card ─────────────────── */}
      <div className="flex flex-col h-screen min-h-screen overflow-hidden light lg:hidden">
        {/* Top 50%: picture */}
        <div
          className="flex-[0_0_50%] min-h-0 relative shrink-0"
          style={{
            backgroundImage: 'url(/elec%20login.png)',
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            backgroundRepeat: 'no-repeat',
          }}
        >
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/20 via-transparent to-transparent" />
        </div>

        {/* Bottom 50%: white card */}
        <div className="flex-[0_0_50%] min-h-0 flex flex-col bg-white rounded-t-[30px] -mt-4 relative z-10 shadow-[0_-8px_32px_rgba(15,23,42,0.12)] overflow-y-auto">
          <div className="flex-1 flex items-start justify-center px-4 pt-6 pb-8">
            <div className="w-full max-w-md">
              {loginForm}
            </div>
          </div>
        </div>
      </div>

      {/* ── DESKTOP (lg+): full-screen background + centered floating card ── */}
      <div
        className="hidden lg:flex relative min-h-screen items-center justify-center light"
        style={{
          backgroundImage: 'url(/elec%20login.png)',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
        }}
      >
        {/* Gradient overlay */}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/55 via-black/25 to-transparent" />

        {/* Floating card */}
        <div className="relative z-10 w-full max-w-md mx-auto px-4 py-10">
          <div className="bg-white rounded-[30px] shadow-[0_18px_45px_rgba(15,23,42,0.35)] px-8 pt-8 pb-9">
            {loginForm}
          </div>
        </div>
      </div>
    </>
  );
}
