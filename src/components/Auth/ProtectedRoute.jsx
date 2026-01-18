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
    // Validate session - STRICT authentication required
    async function validateSession() {
      // FIRST: Check if we have authentication tokens at all
      const token = localStorage.getItem('auth_token');
      const user = localStorage.getItem('client_user');
      const clientKey = localStorage.getItem('client_key');
      
      // NO TOKENS = NO ACCESS - redirect to login immediately
      if (!token || !user || !clientKey) {
        clearAuth();
        setIsValid(false);
        setIsValidating(false);
        return;
      }

      // We have tokens - validate with server
      try {
        const response = await api.get('/auth/me');
        
        if (response?.data?.user || response?.data?.driver) {
          // Server validated - session is valid
          if (response.data.csrfToken) {
            try {
              localStorage.setItem('csrf_token', response.data.csrfToken);
            } catch (e) {
              console.error('Failed to update CSRF token:', e);
            }
          }
          setIsValid(true);
        } else {
          // Server says invalid
          clearAuth();
          setIsValid(false);
        }
      } catch (error) {
        // Server validation failed
        // If it's a network error (server unavailable), we allow access if tokens exist
        // This is for development/offline scenarios
        // BUT if it's a 401/403, it means tokens are invalid - clear and redirect
        if (error?.response?.status === 401 || error?.response?.status === 403) {
          // Invalid tokens - clear and redirect to login
          clearAuth();
          setIsValid(false);
        } else {
          // Network error or server unavailable
          // Allow access if we have tokens (for offline/development)
          // But user MUST have logged in properly before (tokens exist)
          setIsValid(true);
        }
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
