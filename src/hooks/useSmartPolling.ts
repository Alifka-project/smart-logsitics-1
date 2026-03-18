import { useEffect, useRef, useCallback } from 'react';

interface SmartPollingOptions {
  baseInterval?: number;
  maxInterval?: number;
  minInterval?: number;
  enabled?: boolean;
  immediate?: boolean;
  changeDetectionKey?: string | null;
  pauseWhenHidden?: boolean;
}

interface SmartPollingReturn {
  forcePoll: () => Promise<void>;
}

export function useSmartPolling(
  fetchFn: () => Promise<void>,
  options: SmartPollingOptions = {},
): SmartPollingReturn {
  const {
    baseInterval = 30000,
    maxInterval = 120000,
    minInterval = 15000,
    enabled = true,
    immediate = true,
    changeDetectionKey = null,
    pauseWhenHidden = true,
  } = options;

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentIntervalRef = useRef(baseInterval);
  const previousKeyRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  const fetchFnRef = useRef(fetchFn);
  const isVisibleRef = useRef(!document.hidden);

  useEffect(() => {
    fetchFnRef.current = fetchFn;
  }, [fetchFn]);

  useEffect(() => {
    if (changeDetectionKey === null) return;

    if (previousKeyRef.current !== null && changeDetectionKey !== previousKeyRef.current) {
      currentIntervalRef.current = Math.max(minInterval, currentIntervalRef.current * 0.6);
    } else if (previousKeyRef.current !== null) {
      currentIntervalRef.current = Math.min(maxInterval, currentIntervalRef.current * 1.3);
    }
    previousKeyRef.current = changeDetectionKey;
  }, [changeDetectionKey, minInterval, maxInterval]);

  const scheduleNext = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    if (!mountedRef.current || !enabled) return;
    if (pauseWhenHidden && !isVisibleRef.current) return;

    timerRef.current = setTimeout(async () => {
      if (!mountedRef.current || !enabled) return;
      if (pauseWhenHidden && !isVisibleRef.current) return;

      try {
        await fetchFnRef.current();
      } catch {
        currentIntervalRef.current = Math.min(maxInterval, currentIntervalRef.current * 1.5);
      }

      scheduleNext();
    }, currentIntervalRef.current);
  }, [enabled, maxInterval, pauseWhenHidden]);

  useEffect(() => {
    mountedRef.current = true;

    const handleVisibilityChange = () => {
      isVisibleRef.current = !document.hidden;

      if (!document.hidden) {
        if (enabled) {
          fetchFnRef.current().catch(() => {});
          scheduleNext();
        }
      } else {
        if (timerRef.current) {
          clearTimeout(timerRef.current);
          timerRef.current = null;
        }
      }
    };

    if (pauseWhenHidden) {
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }

    if (immediate && enabled) {
      fetchFnRef.current().catch(() => {});
    }

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

  const forcePoll = useCallback(async () => {
    currentIntervalRef.current = baseInterval;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    try {
      await fetchFnRef.current();
    } catch {
      // ignore
    }
    if (enabled) {
      scheduleNext();
    }
  }, [baseInterval, enabled, scheduleNext]);

  return { forcePoll };
}

export default useSmartPolling;
