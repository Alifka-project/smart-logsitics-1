import React, { useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { isAuthenticated, clearAuth } from '../../frontend/auth';
import api from '../../frontend/apiClient';
import { useAutoSignout } from '../../hooks/useAutoSignout';

export default function ProtectedRoute({ children }) {
  // Enable auto-signout on inactivity and tab close
  useAutoSignout();
  const [isValidating, setIsValidating] = React.useState(true);
  const [isValid, setIsValid] = React.useState(false);

  useEffect(() => {
    // Validate session with server to ensure tokens are valid and not expired
    async function validateSession() {
      // First check if we have authentication tokens at all
      const token = localStorage.getItem('auth_token');
      const user = localStorage.getItem('client_user');
      const clientKey = localStorage.getItem('client_key');
      
      // If we don't have all required tokens, redirect to login
      if (!token || !user || !clientKey) {
        console.log('[ProtectedRoute] No valid tokens found, redirecting to login');
        clearAuth();
        setIsValid(false);
        setIsValidating(false);
        return;
      }

      // Validate tokens with server to ensure they're still valid
      try {
        const response = await api.get('/auth/me');
        if (response.data && response.data.user) {
          console.log('[ProtectedRoute] ✓ User authenticated with valid session');
          setIsValid(true);
        } else {
          console.log('[ProtectedRoute] Invalid session response, redirecting to login');
          clearAuth();
          setIsValid(false);
        }
      } catch (error) {
        // Server rejected the authentication (401, 403, etc.)
        console.log('[ProtectedRoute] Session validation failed:', error.response?.status || error.message);
        clearAuth();
        setIsValid(false);
      }
      
      setIsValidating(false);
    }

    validateSession();
  }, []);

  if (isValidating) {
    // Show loading state while validating
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
          <p className="text-gray-600 font-medium">Validating session...</p>
        </div>
      </div>
    );
  }

  if (!isValid) {
    // Clear any stale authentication data
    clearAuth();
    return <Navigate to="/login" replace />;
  }

  return children;
}
