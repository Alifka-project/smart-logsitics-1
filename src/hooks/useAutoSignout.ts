import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { clearAuth, isAuthenticated } from '../frontend/auth';
import api from '../frontend/apiClient';

const INACTIVITY_TIMEOUT = 15 * 60 * 1000;
const WARNING_TIME = 2 * 60 * 1000; // Show warning 2 minutes before expiry

const ACTIVITY_EVENTS = [
  'mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart', 'click',
] as const;

export interface AutoSignoutState {
  showWarning: boolean;
  timeRemaining: number; // seconds remaining until auto sign-out
  continueSession: () => void;
  signOut: () => Promise<void>;
}

export function useAutoSignout(): AutoSignoutState {
  const navigate = useNavigate();
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const warningTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastActivityRef = useRef<number>(Date.now());
  // Mirror of showWarning in a ref so activity handlers can read it without stale closure
  const showWarningRef = useRef(false);
  const [showWarning, setShowWarning] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState(WARNING_TIME / 1000);

  const stopCountdown = (): void => {
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
  };

  const startCountdown = (): void => {
    stopCountdown();
    const expiresAt = lastActivityRef.current + INACTIVITY_TIMEOUT;
    setTimeRemaining(Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000)));
    countdownRef.current = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
      setTimeRemaining(remaining);
      if (remaining <= 0) stopCountdown();
    }, 1000);
  };

  const resetTimer = (): void => {
    lastActivityRef.current = Date.now();

    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (warningTimeoutRef.current) clearTimeout(warningTimeoutRef.current);
    stopCountdown();

    // Hide the warning popup whenever the timer is reset
    if (showWarningRef.current) {
      showWarningRef.current = false;
      setShowWarning(false);
    }

    if (!isAuthenticated()) return;

    const warningTime = INACTIVITY_TIMEOUT - WARNING_TIME;
    warningTimeoutRef.current = setTimeout(() => {
      if (isAuthenticated()) {
        showWarningRef.current = true;
        setShowWarning(true);
        startCountdown();
      }
    }, warningTime);

    timeoutRef.current = setTimeout(() => {
      if (isAuthenticated()) {
        const timeSinceLastActivity = Date.now() - lastActivityRef.current;
        if (timeSinceLastActivity >= INACTIVITY_TIMEOUT - 30000) {
          showWarningRef.current = false;
          setShowWarning(false);
          stopCountdown();
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
    stopCountdown();

    showWarningRef.current = false;
    setShowWarning(false);
    clearAuth();

    try {
      await api.post('/auth/logout', {}, { timeout: 2000 });
    } catch {
      // best effort
    }

    navigate('/login', { replace: true });
  };

  const continueSession = (): void => {
    showWarningRef.current = false;
    setShowWarning(false);
    stopCountdown();
    resetTimer();
  };

  useEffect(() => {
    if (!isAuthenticated()) return;

    const handleActivity = (): void => {
      // Do NOT reset the timer while the warning popup is visible — let the user decide
      if (showWarningRef.current) return;
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
          resetTimer(); // also hides popup if it was showing
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
      stopCountdown();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { showWarning, timeRemaining, continueSession, signOut };
}
