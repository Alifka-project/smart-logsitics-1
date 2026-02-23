import { useEffect, useRef, useCallback } from 'react';

/**
 * Smart polling hook that dramatically reduces database operations by:
 * 
 * 1. Pausing when tab is not visible (visibility API)
 * 2. Using exponential backoff when data hasn't changed
 * 3. Speeding up when data changes are detected
 * 4. Respecting a minimum interval floor
 * 
 * @param {Function} fetchFn - Async function to call on each poll
 * @param {Object} options
 * @param {number} options.baseInterval - Starting interval in ms (default: 30000 = 30s)
 * @param {number} options.maxInterval - Maximum interval in ms (default: 120000 = 2min)
 * @param {number} options.minInterval - Minimum interval in ms (default: 15000 = 15s)
 * @param {boolean} options.enabled - Whether polling is active (default: true)
 * @param {boolean} options.immediate - Whether to call fetchFn immediately on mount (default: true)
 * @param {string} options.changeDetectionKey - JSON string to detect data changes (optional)
 * @param {boolean} options.pauseWhenHidden - Pause when tab not visible (default: true)
 */
export function useSmartPolling(fetchFn, options = {}) {
  const {
    baseInterval = 30000,
    maxInterval = 120000,
    minInterval = 15000,
    enabled = true,
    immediate = true,
    changeDetectionKey = null,
    pauseWhenHidden = true,
  } = options;

  const timerRef = useRef(null);
  const currentIntervalRef = useRef(baseInterval);
  const previousKeyRef = useRef(null);
  const mountedRef = useRef(true);
  const fetchFnRef = useRef(fetchFn);
  const isVisibleRef = useRef(!document.hidden);

  // Keep fetchFn ref up to date without causing re-renders
  useEffect(() => {
    fetchFnRef.current = fetchFn;
  }, [fetchFn]);

  // Track data changes for adaptive interval
  useEffect(() => {
    if (changeDetectionKey === null) return;

    if (previousKeyRef.current !== null && changeDetectionKey !== previousKeyRef.current) {
      // Data changed - speed up polling
      currentIntervalRef.current = Math.max(minInterval, currentIntervalRef.current * 0.6);
    } else if (previousKeyRef.current !== null) {
      // No change - slow down polling
      currentIntervalRef.current = Math.min(maxInterval, currentIntervalRef.current * 1.3);
    }
    previousKeyRef.current = changeDetectionKey;
  }, [changeDetectionKey, minInterval, maxInterval]);

  const scheduleNext = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    if (!mountedRef.current || !enabled) return;
    
    // Don't schedule if tab is hidden and pauseWhenHidden is true
    if (pauseWhenHidden && !isVisibleRef.current) return;

    timerRef.current = setTimeout(async () => {
      if (!mountedRef.current || !enabled) return;
      if (pauseWhenHidden && !isVisibleRef.current) return;

      try {
        await fetchFnRef.current();
      } catch (err) {
        // On error, slow down to avoid hammering a broken endpoint
        currentIntervalRef.current = Math.min(maxInterval, currentIntervalRef.current * 1.5);
      }
      
      // Schedule next poll
      scheduleNext();
    }, currentIntervalRef.current);
  }, [enabled, maxInterval, pauseWhenHidden]);

  useEffect(() => {
    mountedRef.current = true;

    // Visibility change handler
    const handleVisibilityChange = () => {
      isVisibleRef.current = !document.hidden;

      if (!document.hidden) {
        // Tab became visible - do an immediate fetch and resume polling
        if (enabled) {
          fetchFnRef.current().catch(() => {});
          scheduleNext();
        }
      } else {
        // Tab hidden - cancel pending timer
        if (timerRef.current) {
          clearTimeout(timerRef.current);
          timerRef.current = null;
        }
      }
    };

    if (pauseWhenHidden) {
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }

    // Initial fetch
    if (immediate && enabled) {
      fetchFnRef.current().catch(() => {});
    }

    // Start polling
    if (enabled) {
      scheduleNext();
    }

    return () => {
      mountedRef.current = false;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      if (pauseWhenHidden) {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      }
    };
  }, [enabled, immediate, pauseWhenHidden, scheduleNext]);

  // Return a function to force an immediate poll (useful for manual refresh buttons)
  const forcePoll = useCallback(async () => {
    // Reset interval to base when user manually refreshes
    currentIntervalRef.current = baseInterval;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    try {
      await fetchFnRef.current();
    } catch (err) {
      // ignore
    }
    if (enabled) {
      scheduleNext();
    }
  }, [baseInterval, enabled, scheduleNext]);

  return { forcePoll };
}

export default useSmartPolling;
