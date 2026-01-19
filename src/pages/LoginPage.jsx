import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import api, { setAuthToken } from '../frontend/apiClient';
import { setAuthData, isAuthenticated } from '../frontend/auth';
import { Eye, EyeOff } from 'lucide-react';

export default function LoginPage() {
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [passwordErrors, setPasswordErrors] = useState([]);

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
      const res = await api.post('/auth/login', { username, password });
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
      } else {
        window.location.href = '/driver';
      }
    } catch (err) {
      // Network error or server not available
      if (!err?.response) {
        setError('Cannot connect to server. Please ensure the backend server is running.');
        setLoading(false);
        return;
      }
      
      const errorMessage = err?.response?.data?.error || err?.message || 'Login failed. Please check your credentials.';
      const errorDetails = err?.response?.data?.details;
      
      if (errorDetails && Array.isArray(errorDetails)) {
        // Password validation errors
        setPasswordErrors(errorDetails);
        setError('Please fix the password requirements');
      } else if (err?.response?.status === 423) {
        // Account locked
        setError(err.response.data.message || 'Account locked due to too many failed attempts');
      } else if (err?.response?.status === 401) {
        setError('Invalid username or password');
      } else if (err?.response?.status >= 500) {
        setError('Server error. Please try again later.');
      } else if (err?.response?.status === 400) {
        setError(errorMessage || 'Invalid request. Please check your input.');
      } else {
        setError(errorMessage);
      }
      setLoading(false);
    }
  }

  return (
    <div 
      className="min-h-screen flex items-center justify-center px-4 py-8 light"
      style={{
        backgroundImage: 'url(/elec%20login.png)',
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat'
      }}
    >
      {/* Main Container */}
      <div className="w-full max-w-6xl bg-white rounded-3xl border-4 border-white shadow-2xl overflow-hidden flex flex-col lg:flex-row">
        {/* Left Section - Promotional */}
        <div 
          className="w-full lg:w-1/2 relative overflow-hidden p-4 lg:p-6 flex flex-col justify-between rounded-t-3xl lg:rounded-l-3xl lg:rounded-tr-none"
          style={{
            backgroundImage: 'url(/elec%20login.png)',
            backgroundSize: 'cover',
            backgroundPosition: 'top left',
            backgroundRepeat: 'no-repeat',
            minHeight: '600px'
          }}
        >
        </div>

        {/* Right Section - Login Form */}
        <div className="w-full lg:w-1/2 bg-white p-8 lg:p-12 flex flex-col justify-center rounded-b-3xl lg:rounded-r-3xl lg:rounded-bl-none">
          <div className="max-w-md mx-auto w-full">
            <h2 className="text-3xl lg:text-4xl font-bold text-black mb-2" style={{ color: '#000000' }}>WELCOME BACK!</h2>
            <p className="text-black text-sm mb-8" style={{ color: '#000000' }}>Welcome back! Please enter your details.</p>
          
          {error && (
            <div className="bg-red-50 border-l-4 border-red-500 text-red-800 text-sm p-4 rounded mb-6">
              <div className="font-semibold mb-1">Error</div>
              <div>{error}</div>
            </div>
          )}
          
          {passwordErrors.length > 0 && (
            <div className="bg-yellow-50 border-l-4 border-yellow-500 text-yellow-800 text-sm p-4 rounded mb-6">
              <div className="font-semibold mb-2">Password Requirements:</div>
              <ul className="list-disc list-inside space-y-1 text-xs">
                {passwordErrors.map((err, idx) => (
                  <li key={idx}>{err.replace(/_/g, ' ')}</li>
                ))}
              </ul>
            </div>
          )}
          
            <form onSubmit={submit} className="space-y-6">
              {/* Username Field */}
            <div>
                <label className="block text-sm font-medium text-black mb-2" style={{ color: '#000000' }}>
                  Username
                </label>
              <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg transition-all outline-none bg-white"
                  style={{
                    '--focus-color': '#011E41'
                  }}
                  onFocus={(e) => {
                    e.target.style.borderColor = '#011E41';
                    e.target.style.boxShadow = '0 0 0 2px rgba(1, 30, 65, 0.2)';
                  }}
                  onBlur={(e) => {
                    e.target.style.borderColor = '#d1d5db';
                    e.target.style.boxShadow = 'none';
                  }}
                  placeholder="Enter your username"
                  required
                  autoComplete="username"
                  disabled={loading}
                />
            </div>
            
              {/* Password Field */}
            <div>
                <label className="block text-sm font-medium text-black mb-2" style={{ color: '#000000' }}>
                Password
              </label>
                <div className="relative">
              <input
                    type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                    className="w-full px-4 py-3 pr-12 border border-gray-300 rounded-lg transition-all outline-none bg-white"
                style={{
                  '--focus-color': '#011E41'
                }}
                onFocus={(e) => {
                  e.target.style.borderColor = '#011E41';
                  e.target.style.boxShadow = '0 0 0 2px rgba(1, 30, 65, 0.2)';
                }}
                onBlur={(e) => {
                  e.target.style.borderColor = '#d1d5db';
                  e.target.style.boxShadow = 'none';
                }}
                placeholder="Enter your password"
                required
                autoComplete="current-password"
                disabled={loading}
              />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-500 hover:text-gray-700 focus:outline-none"
                    tabIndex={-1}
                  >
                    {showPassword ? (
                      <EyeOff className="w-5 h-5" />
                    ) : (
                      <Eye className="w-5 h-5" />
                    )}
                  </button>
                </div>
            </div>
            
              {/* Remember me */}
            <div className="flex items-center justify-between text-sm">
              <label className="flex items-center">
                  <input 
                    type="checkbox" 
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                    className="rounded border-gray-300 focus:ring-2 focus:ring-offset-0"
                    style={{
                      accentColor: '#011E41'
                    }}
                  />
                  <span className="ml-2 text-black" style={{ color: '#000000' }}>Remember me</span>
              </label>
              <Link 
                to="/forgot-password"
                className="text-black hover:underline"
                style={{ color: '#000000' }}
              >
                Forgot password?
              </Link>
            </div>
            
              {/* Sign in Button */}
            <button
              type="submit"
              disabled={loading}
                className="w-full text-white font-semibold py-3 px-4 rounded-lg transition-all duration-200 disabled:opacity-60 disabled:cursor-not-allowed"
                style={{ backgroundColor: '#011E41' }}
                onMouseEnter={(e) => !loading && (e.target.style.backgroundColor = '#001529')}
                onMouseLeave={(e) => !loading && (e.target.style.backgroundColor = '#011E41')}
            >
              {loading ? (
                <span className="flex items-center justify-center">
                  <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Signing in...
                </span>
              ) : (
                  'Sign in'
              )}
            </button>
          </form>
          </div>
        </div>
      </div>
    </div>
  );
}
