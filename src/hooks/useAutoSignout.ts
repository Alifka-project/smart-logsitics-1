import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { clearAuth, isAuthenticated } from '../frontend/auth';
import api from '../frontend/apiClient';

const INACTIVITY_TIMEOUT = 15 * 60 * 1000;
const WARNING_TIME = 1 * 60 * 1000;

const ACTIVITY_EVENTS = [
  'mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart', 'click',
] as const;

export function useAutoSignout(): { resetTimer: () => void; signOut: () => Promise<void> } {
  const navigate = useNavigate();
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const warningTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastActivityRef = useRef<number>(Date.now());

  const resetTimer = (): void => {
    lastActivityRef.current = Date.now();

    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (warningTimeoutRef.current) clearTimeout(warningTimeoutRef.current);

    if (!isAuthenticated()) return;

    const warningTime = INACTIVITY_TIMEOUT - WARNING_TIME;
    warningTimeoutRef.current = setTimeout(() => {
      if (isAuthenticated()) {
        const timeRemaining = Math.ceil(
          (INACTIVITY_TIMEOUT - (Date.now() - lastActivityRef.current)) / 1000 / 60,
        );
        const confirmed = window.confirm(
          `Your session will expire in ${timeRemaining} minute(s) due to inactivity. Click OK to continue your session, or Cancel to sign out now.`,
        );
        if (confirmed) {
          resetTimer();
        } else {
          void signOut();
        }
      }
    }, warningTime);

    timeoutRef.current = setTimeout(() => {
      if (isAuthenticated()) {
        const timeSinceLastActivity = Date.now() - lastActivityRef.current;
        if (timeSinceLastActivity >= INACTIVITY_TIMEOUT - 30000) {
          void signOut();
        } else {
          resetTimer();
        }
      }
    }, INACTIVITY_TIMEOUT);
  };

  const signOut = async (): Promise<void> => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (warningTimeoutRef.current) clearTimeout(warningTimeoutRef.current);

    clearAuth();

    try {
      await api.post('/auth/logout', {}, { timeout: 2000 });
    } catch {
      // best effort
    }

    navigate('/login', { replace: true });

    if (window.location.pathname !== '/login') {
      alert('You have been signed out due to inactivity.');
    }
  };

  useEffect(() => {
    if (!isAuthenticated()) return;

    const handleActivity = (): void => {
      resetTimer();
    };

    ACTIVITY_EVENTS.forEach((event) => {
      document.addEventListener(event, handleActivity, { passive: true });
    });

    const handleVisibilityChange = (): void => {
      if (!document.hidden) {
        const timeSinceLastActivity = Date.now() - lastActivityRef.current;
        if (timeSinceLastActivity >= INACTIVITY_TIMEOUT) {
          void signOut();
        } else {
          resetTimer();
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    const handleBeforeUnload = (): void => {
      if (isAuthenticated()) {
        try {
          const token = localStorage.getItem('auth_token');
          if (token) {
            navigator.sendBeacon(
              `${window.location.origin}/api/auth/logout`,
              JSON.stringify({}),
            );
          }
        } catch {
          // ignore
        }
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    resetTimer();

    return () => {
      ACTIVITY_EVENTS.forEach((event) => {
        document.removeEventListener(event, handleActivity);
      });
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('beforeunload', handleBeforeUnload);

      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (warningTimeoutRef.current) clearTimeout(warningTimeoutRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { resetTimer, signOut };
}
