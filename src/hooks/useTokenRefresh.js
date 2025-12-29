import { useEffect, useRef } from 'react';
import api, { setAuthToken } from '../frontend/apiClient';
import { getToken, getTokenExpirationTime, isTokenExpired } from '../frontend/auth';

/**
 * Hook to automatically refresh access tokens before they expire
 */
export function useTokenRefresh() {
  const refreshIntervalRef = useRef(null);

  useEffect(() => {
    function refreshTokenIfNeeded() {
      const token = getToken();
      if (!token) return;

      const expirationTime = getTokenExpirationTime();
      if (!expirationTime) return;

      // Check if token expires in less than 2 minutes
      const timeUntilExpiry = expirationTime - Date.now();
      const twoMinutes = 2 * 60 * 1000;

      if (timeUntilExpiry < twoMinutes && !isTokenExpired()) {
        // Refresh token proactively
        api.post('/auth/refresh')
          .then((response) => {
            const { accessToken } = response.data;
            setAuthToken(accessToken);
          })
          .catch((error) => {
            console.error('Token refresh failed:', error);
            // Token refresh failed, user will be redirected to login by interceptor
          });
      }
    }

    // Check every 30 seconds
    refreshIntervalRef.current = setInterval(refreshTokenIfNeeded, 30 * 1000);

    // Initial check
    refreshTokenIfNeeded();

    return () => {
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
      }
    };
  }, []);

  return null;
}

