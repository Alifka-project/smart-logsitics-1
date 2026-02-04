import React, { useEffect, useRef } from 'react';
import { Navigate } from 'react-router-dom';
import { clearAuth } from '../../frontend/auth';
import api from '../../frontend/apiClient';
import { useAutoSignout } from '../../hooks/useAutoSignout';

const SESSION_VALIDATION_TIMEOUT_MS = 15000; // 15s max — avoid infinite "Validating session..."

export default function ProtectedRoute({ children }) {
  // Enable auto-signout on inactivity and tab close
  useAutoSignout();
  const [isValidating, setIsValidating] = React.useState(true);
  const [isValid, setIsValid] = React.useState(false);
  const mountedRef = useRef(true);
  const settledRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    settledRef.current = false;

    function applyResult(valid) {
      if (!mountedRef.current || settledRef.current) return;
      settledRef.current = true;
      setIsValid(valid);
      setIsValidating(false);
      if (!valid) clearAuth();
    }

    async function validateSession() {
      const token = localStorage.getItem('auth_token');
      const user = localStorage.getItem('client_user');
      const clientKey = localStorage.getItem('client_key');

      if (!token || !user || !clientKey) {
        console.log('[ProtectedRoute] No valid tokens found, redirecting to login');
        applyResult(false);
        return;
      }

      const timeoutId = setTimeout(() => {
        console.warn('[ProtectedRoute] Session validation timed out, redirecting to login');
        applyResult(false);
      }, SESSION_VALIDATION_TIMEOUT_MS);

      try {
        const response = await api.get('/auth/me', { timeout: 12000 });
        clearTimeout(timeoutId);
        if (settledRef.current) return;
        if (!mountedRef.current) return;
        if (response.data && response.data.user) {
          console.log('[ProtectedRoute] ✓ User authenticated with valid session');
          applyResult(true);
        } else {
          console.log('[ProtectedRoute] Invalid session response, redirecting to login');
          applyResult(false);
        }
      } catch (error) {
        clearTimeout(timeoutId);
        if (settledRef.current) return;
        if (!mountedRef.current) return;
        console.log('[ProtectedRoute] Session validation failed:', error.response?.status ?? error.code ?? error.message);
        applyResult(false);
      }
    }

    validateSession();
    return () => {
      mountedRef.current = false;
    };
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
