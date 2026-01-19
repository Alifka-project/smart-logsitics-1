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
    // Validate session - check local storage only (don't call /api/auth/me)
    async function validateSession() {
      // Check if we have authentication tokens at all
      const token = localStorage.getItem('auth_token');
      const user = localStorage.getItem('client_user');
      const clientKey = localStorage.getItem('client_key');
      
      // If we have all required tokens, we're good
      if (token && user && clientKey) {
        console.log('[ProtectedRoute] ✓ User authenticated with valid tokens');
        setIsValid(true);
      } else {
        // Missing tokens - not authenticated
        console.log('[ProtectedRoute] No valid tokens found, redirecting to login');
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
