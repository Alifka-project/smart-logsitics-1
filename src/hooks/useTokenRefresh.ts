import { useEffect, useRef } from 'react';
import api, { setAuthToken } from '../frontend/apiClient';
import { getToken, getTokenExpirationTime, isTokenExpired } from '../frontend/auth';

export function useTokenRefresh(): null {
  const refreshIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    function refreshTokenIfNeeded(): void {
      const token = getToken();
      if (!token) return;

      const expirationTime = getTokenExpirationTime();
      if (!expirationTime) return;

      const timeUntilExpiry = expirationTime - Date.now();
      const twoMinutes = 2 * 60 * 1000;

      if (timeUntilExpiry < twoMinutes && !isTokenExpired()) {
        api
          .post<{ accessToken: string }>('/auth/refresh')
          .then((response) => {
            const { accessToken } = response.data;
            setAuthToken(accessToken);
          })
          .catch((error: unknown) => {
            console.error('Token refresh failed:', error);
          });
      }
    }

    refreshIntervalRef.current = setInterval(refreshTokenIfNeeded, 30 * 1000);
    refreshTokenIfNeeded();

    return () => {
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
      }
    };
  }, []);

  return null;
}
