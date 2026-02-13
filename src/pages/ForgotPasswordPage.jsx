import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../frontend/apiClient';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    // Validate email is provided
    if (!email) {
      setError('Please enter your email address');
      setLoading(false);
      return;
    }

    try {
      await api.post('/auth/forgot-password', { email });
      setSuccess(true);
    } catch (err) {
      const errorMessage = err?.response?.data?.error || err?.response?.data?.message || 'Failed to send reset email. Please try again.';
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  if (success) {
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

          {/* Right Section - Success Message */}
          <div className="w-full lg:w-1/2 bg-white p-8 lg:p-12 flex flex-col justify-center rounded-b-3xl lg:rounded-r-3xl lg:rounded-bl-none">
            <div className="max-w-md mx-auto w-full text-center">
              <div className="mx-auto flex items-center justify-center h-16 w-16 rounded-full mb-6" style={{ backgroundColor: '#E8F5E9' }}>
                <svg className="h-8 w-8" style={{ color: '#4CAF50' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h2 className="text-3xl lg:text-4xl font-bold mb-2" style={{ color: '#000000' }}>Check Your Email</h2>
              <p className="mb-8" style={{ color: '#000000' }}>
                If an account exists with that email address, a password reset link has been sent.
              </p>
              <Link 
                to="/login" 
                className="inline-block text-white font-semibold py-3 px-6 rounded-lg transition-all duration-200"
                style={{ backgroundColor: '#011E41' }}
                onMouseEnter={(e) => e.target.style.backgroundColor = '#001529'}
                onMouseLeave={(e) => e.target.style.backgroundColor = '#011E41'}
              >
                Back to Login
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
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

        {/* Right Section - Forgot Password Form */}
        <div className="w-full lg:w-1/2 bg-white p-8 lg:p-12 flex flex-col justify-center rounded-b-3xl lg:rounded-r-3xl lg:rounded-bl-none">
          <div className="max-w-md mx-auto w-full">
            <h2 className="text-3xl lg:text-4xl font-bold mb-2" style={{ color: '#000000' }}>FORGOT PASSWORD?</h2>
            <p className="mb-8 text-sm" style={{ color: '#000000' }}>
              Enter your email address and we'll send you a link to reset your password.
            </p>
          
            {error && (
              <div className="bg-red-50 border-l-4 border-red-500 text-red-800 text-sm p-4 rounded mb-6">
                <div className="font-semibold mb-1">Error</div>
                <div>{error}</div>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Email Field */}
              <div>
                <label className="block text-sm font-medium mb-2" style={{ color: '#000000' }}>
                  Email Address
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
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
                  placeholder="Enter your email"
                  autoComplete="email"
                  required
                  disabled={loading}
                />
              </div>

              {/* Send Reset Link Button */}
              <button
                type="submit"
                disabled={loading || !email}
                className="w-full text-white font-semibold py-3 px-4 rounded-lg transition-all duration-200 disabled:opacity-60 disabled:cursor-not-allowed"
                style={{ backgroundColor: '#011E41' }}
                onMouseEnter={(e) => !loading && email && (e.target.style.backgroundColor = '#001529')}
                onMouseLeave={(e) => !loading && (e.target.style.backgroundColor = '#011E41')}
              >
                {loading ? (
                  <span className="flex items-center justify-center">
                    <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Sending...
                  </span>
                ) : (
                  'Send Reset Link'
                )}
              </button>
            </form>

            {/* Back to Login Link */}
            <div className="mt-6 text-center">
              <Link 
                to="/login" 
                className="text-sm font-medium hover:underline"
                style={{ color: '#000000' }}
              >
                Back to Login
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

