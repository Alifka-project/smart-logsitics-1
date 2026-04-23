import { useEffect, useRef, useState, useCallback } from 'react';

/**
 * Driver picking-list reminder timer.
 *
 * Rule:
 *   - Fire once shortly after login (LOGIN_FIRE_DELAY_MS).
 *   - Fire every FIRE_INTERVAL_MS after that while the tab is open.
 *   - Skip the fire when the reminder is not actionable:
 *       • pendingCount is 0 (nothing to nudge about)
 *       • driver is already on the Picking List tab (they're acting)
 *       • document is hidden (defer to next tick rather than queueing a popup
 *         the driver won't see)
 *   - Dismissal resets the timer so the next fire is exactly 2 hours away,
 *     not whatever was left on the previous cycle.
 *
 * The hook returns the visible flag + a dismiss callback. No persistence
 * across sessions — a fresh login fires the login reminder again, which is
 * the intended behaviour per product spec.
 */

const FIRE_INTERVAL_MS = 2 * 60 * 60 * 1000; // 2 hours
const LOGIN_FIRE_DELAY_MS = 1500;            // tiny delay so initial data load completes first

interface UsePickingReminderParams {
  pendingCount: number;
  isOnPickingTab: boolean;
}

interface UsePickingReminderResult {
  isVisible: boolean;
  dismiss: () => void;
}

export function usePickingReminder({
  pendingCount,
  isOnPickingTab,
}: UsePickingReminderParams): UsePickingReminderResult {
  const [isVisible, setIsVisible] = useState<boolean>(false);
  const scheduledRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef<boolean>(false);

  // Keep a ref to the latest gate values so the scheduled callback always
  // reads current props without needing to rebuild the timer on every render.
  const gateRef = useRef({ pendingCount, isOnPickingTab });
  gateRef.current = { pendingCount, isOnPickingTab };

  const canFireNow = useCallback((): boolean => {
    const { pendingCount: count, isOnPickingTab: onTab } = gateRef.current;
    if (count <= 0) return false;
    if (onTab) return false;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return false;
    return true;
  }, []);

  const schedule = useCallback((delayMs: number) => {
    if (scheduledRef.current) clearTimeout(scheduledRef.current);
    scheduledRef.current = setTimeout(() => {
      if (canFireNow()) {
        setIsVisible(true);
      } else {
        // Suppressed for now — reschedule one full interval from now rather
        // than popping the reminder retroactively. Keeps the cadence stable.
        schedule(FIRE_INTERVAL_MS);
      }
    }, delayMs);
  }, [canFireNow]);

  useEffect(() => {
    if (mountedRef.current) return;
    mountedRef.current = true;
    schedule(LOGIN_FIRE_DELAY_MS);
    return () => {
      if (scheduledRef.current) {
        clearTimeout(scheduledRef.current);
        scheduledRef.current = null;
      }
    };
  }, [schedule]);

  const dismiss = useCallback(() => {
    setIsVisible(false);
    schedule(FIRE_INTERVAL_MS);
  }, [schedule]);

  return { isVisible, dismiss };
}
