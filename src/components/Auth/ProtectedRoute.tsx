import React, { useEffect, useRef } from 'react';
import { Navigate } from 'react-router-dom';
import { clearAuth } from '../../frontend/auth';
import api from '../../frontend/apiClient';
import { useAutoSignout } from '../../hooks/useAutoSignout';

const SESSION_VALIDATION_TIMEOUT_MS = 8000;

interface ProtectedRouteProps {
  children: React.ReactNode;
}

export default function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { showWarning, timeRemaining, continueSession, signOut } = useAutoSignout();
  const [isValidating, setIsValidating] = React.useState(true);
  const [isValid, setIsValid] = React.useState(false);
  const mountedRef = useRef(true);
  const settledRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    settledRef.current = false;

    function applyResult(valid: boolean): void {
      if (!mountedRef.current || settledRef.current) return;
      settledRef.current = true;
      setIsValid(valid);
      setIsValidating(false);
      if (!valid) clearAuth();
    }

    async function validateSession(): Promise<void> {
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
        const response = await api.get<{ user?: unknown }>('/auth/me', { timeout: 12000 });
        clearTimeout(timeoutId);
        if (settledRef.current) return;
        if (!mountedRef.current) return;
        if (response.data?.user) {
          console.log('[ProtectedRoute] ✓ User authenticated with valid session');
          applyResult(true);
        } else {
          console.log('[ProtectedRoute] Invalid session response, redirecting to login');
          applyResult(false);
        }
      } catch (error: unknown) {
        clearTimeout(timeoutId);
        if (settledRef.current) return;
        if (!mountedRef.current) return;
        const err = error as { response?: { status?: number }; code?: string; message?: string };
        console.log(
          '[ProtectedRoute] Session validation failed:',
          err.response?.status ?? err.code ?? err.message,
        );
        applyResult(false);
      }
    }

    void validateSession();
    return () => {
      mountedRef.current = false;
    };
  }, []);

  if (isValidating) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4" />
          <p className="text-gray-600 font-medium">Validating session...</p>
        </div>
      </div>
    );
  }

  if (!isValid) {
    clearAuth();
    return <Navigate to="/login" replace />;
  }

  return (
    <>
      {children}
      {showWarning && (
        <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
                <svg className="w-5 h-5 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                </svg>
              </div>
              <h2 className="text-base font-semibold text-gray-900">Session Expiring Soon</h2>
            </div>
            <p className="text-sm text-gray-600 mb-6">
              Your session will expire in{' '}
              <span className="font-semibold text-gray-900">
                {timeRemaining} minute{timeRemaining !== 1 ? 's' : ''}
              </span>{' '}
              due to inactivity. Would you like to continue?
            </p>
            <div className="flex gap-3">
              <button
                onClick={continueSession}
                className="flex-1 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white text-sm font-medium py-2.5 px-4 rounded-xl transition-colors"
              >
                Continue Session
              </button>
              <button
                onClick={() => void signOut()}
                className="flex-1 bg-gray-100 hover:bg-gray-200 active:bg-gray-300 text-gray-700 text-sm font-medium py-2.5 px-4 rounded-xl transition-colors"
              >
                Sign Out
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
