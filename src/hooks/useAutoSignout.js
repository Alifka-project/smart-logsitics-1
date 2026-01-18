/**
 * Auto Signout Hook
 * Automatically signs out users on inactivity or tab close
 */

import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { clearAuth, isAuthenticated } from '../frontend/auth';
import api from '../frontend/apiClient';

// Configuration
const INACTIVITY_TIMEOUT = 15 * 60 * 1000; // 15 minutes in milliseconds
const WARNING_TIME = 1 * 60 * 1000; // Show warning 1 minute before timeout

export function useAutoSignout() {
  const navigate = useNavigate();
  const timeoutRef = useRef(null);
  const warningTimeoutRef = useRef(null);
  const lastActivityRef = useRef(Date.now());

  const resetTimer = () => {
    lastActivityRef.current = Date.now();
    
    // Clear existing timers
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    if (warningTimeoutRef.current) {
      clearTimeout(warningTimeoutRef.current);
    }

    // Only set timers if user is authenticated
    if (!isAuthenticated()) {
      return;
    }

    // Show warning before timeout
    const warningTime = INACTIVITY_TIMEOUT - WARNING_TIME;
    warningTimeoutRef.current = setTimeout(() => {
      if (isAuthenticated()) {
        const timeRemaining = Math.ceil((INACTIVITY_TIMEOUT - (Date.now() - lastActivityRef.current)) / 1000 / 60);
        const confirmed = window.confirm(
          `Your session will expire in ${timeRemaining} minute(s) due to inactivity. Click OK to continue your session, or Cancel to sign out now.`
        );
        
        if (confirmed) {
          // User wants to continue - reset timer
          resetTimer();
        } else {
          // User wants to sign out now
          signOut();
        }
      }
    }, warningTime);

    // Set main timeout for auto signout
    timeoutRef.current = setTimeout(() => {
      if (isAuthenticated()) {
        // Double check if user was active recently (within last 30 seconds)
        const timeSinceLastActivity = Date.now() - lastActivityRef.current;
        if (timeSinceLastActivity >= INACTIVITY_TIMEOUT - 30000) {
          signOut();
        } else {
          // User was active, reset timer
          resetTimer();
        }
      }
    }, INACTIVITY_TIMEOUT);
  };

  const signOut = async () => {
    // Clear timers
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    if (warningTimeoutRef.current) {
      clearTimeout(warningTimeoutRef.current);
    }

    // Clear auth data
    clearAuth();

    // Try to notify server (best effort, don't block)
    try {
      await api.post('/auth/logout', {}, { timeout: 2000 });
    } catch (e) {
      // Ignore errors - client-side cleanup is sufficient
    }

    // Redirect to login
    navigate('/login', { replace: true });
    
    // Show message
    if (window.location.pathname !== '/login') {
      alert('You have been signed out due to inactivity.');
    }
  };

  // Track user activity
  const activityEvents = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart', 'click'];

  useEffect(() => {
    // Only set up if authenticated
    const checkAuth = () => isAuthenticated();
    if (!checkAuth()) {
      return;
    }

    // Reset timer on any activity
    const handleActivity = () => {
      resetTimer();
    };

    // Add event listeners
    activityEvents.forEach(event => {
      document.addEventListener(event, handleActivity, { passive: true });
    });

    // Handle visibility change (tab switch)
    const handleVisibilityChange = () => {
      if (document.hidden) {
        // Tab hidden - check when it comes back
      } else {
        // Tab visible again - check if too much time passed
        const timeSinceLastActivity = Date.now() - lastActivityRef.current;
        if (timeSinceLastActivity >= INACTIVITY_TIMEOUT) {
          signOut();
        } else {
          resetTimer();
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Handle beforeunload (tab close/refresh)
    const handleBeforeUnload = (e) => {
      if (isAuthenticated()) {
        // Try to notify server (best effort)
        // Using sendBeacon for reliability
        try {
          const token = localStorage.getItem('auth_token');
          if (token) {
            navigator.sendBeacon(
              `${window.location.origin}/api/auth/logout`,
              JSON.stringify({})
            );
          }
        } catch (e) {
          // Ignore errors
        }
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    // Initialize timer
    resetTimer();

    // Cleanup
    return () => {
      activityEvents.forEach(event => {
        document.removeEventListener(event, handleActivity);
      });
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      if (warningTimeoutRef.current) {
        clearTimeout(warningTimeoutRef.current);
      }
    };
    
    // Cleanup function only - don't track isAuthenticated() in dependencies
    // The effect will re-run when component remounts which is sufficient
  }, []); // Only run once on mount

  return { resetTimer, signOut };
}

