import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Bell, X, CheckCheck, MapPin, RefreshCw, AlertTriangle } from 'lucide-react';
import api from '../../frontend/apiClient';

const TYPE_CONFIG = {
  driver_arrived: {
    emoji: '📍',
    color: 'text-green-600 dark:text-green-400',
    bg: 'bg-green-50 dark:bg-green-900/20',
    border: 'border-green-200 dark:border-green-800',
    label: 'Driver Arrived'
  },
  status_changed: {
    emoji: '🔄',
    color: 'text-blue-600 dark:text-blue-400',
    bg: 'bg-blue-50 dark:bg-blue-900/20',
    border: 'border-blue-200 dark:border-blue-800',
    label: 'Status Changed'
  },
  overdue: {
    emoji: '⏰',
    color: 'text-red-600 dark:text-red-400',
    bg: 'bg-red-50 dark:bg-red-900/20',
    border: 'border-red-200 dark:border-red-800',
    label: 'Overdue Delivery'
  },
  default: {
    emoji: '🔔',
    color: 'text-gray-600 dark:text-gray-400',
    bg: 'bg-gray-50 dark:bg-gray-900/20',
    border: 'border-gray-200 dark:border-gray-700',
    label: 'Notification'
  }
};

function timeAgo(dateStr) {
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export default function AdminNotificationBell() {
  const [notifications, setNotifications] = useState([]);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [ringing, setRinging] = useState(false);
  const prevCountRef = useRef(0);
  const panelRef = useRef(null);

  const unreadCount = notifications.length;

  const fetchAlerts = useCallback(async (silent = true) => {
    if (!silent) setLoading(true);
    try {
      const res = await api.get('/admin/notifications/alerts');
      const incoming = res.data?.notifications || [];

      // If new notifications arrived, animate the bell
      if (incoming.length > prevCountRef.current && prevCountRef.current >= 0) {
        setRinging(true);
        setTimeout(() => setRinging(false), 1500);
      }
      prevCountRef.current = incoming.length;
      setNotifications(incoming);
    } catch (_err) {
      // Silently fail — don't disrupt the admin UI
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    fetchAlerts(false);
  }, [fetchAlerts]);

  // Poll every 15 seconds when tab is visible
  useEffect(() => {
    let timer;
    const schedule = () => {
      timer = setTimeout(() => {
        if (!document.hidden) fetchAlerts(true);
        schedule();
      }, 15000);
    };

    const onVisibility = () => {
      if (!document.hidden) fetchAlerts(true);
    };

    schedule();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [fetchAlerts]);

  // Close panel on click outside
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen]);

  const markRead = async (id) => {
    try {
      await api.put(`/admin/notifications/alerts/${id}/read`);
      setNotifications(prev => prev.filter(n => n.id !== id));
      prevCountRef.current = Math.max(0, prevCountRef.current - 1);
    } catch (err) {
      console.error('[AdminNotificationBell] markRead failed:', err.message);
    }
  };

  const markAllRead = async () => {
    try {
      await api.post('/admin/notifications/alerts/mark-all-read');
      setNotifications([]);
      prevCountRef.current = 0;
    } catch (err) {
      console.error('[AdminNotificationBell] markAllRead failed:', err.message);
    }
  };

  return (
    <div className="relative" ref={panelRef}>
      {/* Bell button */}
      <button
        onClick={() => setIsOpen(o => !o)}
        className={`relative p-2 rounded-lg hover:bg-white/10 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-white/50 text-white ${ringing ? 'animate-bounce' : ''}`}
        title="Admin Alerts"
      >
        <Bell className={`w-5 h-5 text-white ${ringing ? 'drop-shadow-[0_0_6px_rgba(250,204,21,0.8)]' : ''}`} />
        {unreadCount > 0 && (
          <span className="absolute top-0.5 right-0.5 min-w-[18px] h-[18px] bg-orange-500 rounded-full flex items-center justify-center text-[10px] font-bold text-white px-1 shadow-lg">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown panel */}
      {isOpen && (
        <div className="absolute right-0 top-full mt-2 w-96 max-w-[calc(100vw-2rem)] bg-white dark:bg-gray-800 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 z-50 flex flex-col overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50">
            <div className="flex items-center gap-2">
              <Bell className="w-4 h-4 text-orange-500" />
              <span className="font-semibold text-gray-900 dark:text-gray-100 text-sm">
                Admin Alerts
                {unreadCount > 0 && (
                  <span className="ml-1.5 px-1.5 py-0.5 bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 rounded-full text-xs font-bold">
                    {unreadCount}
                  </span>
                )}
              </span>
            </div>
            <div className="flex items-center gap-1">
              {unreadCount > 0 && (
                <button
                  onClick={markAllRead}
                  className="flex items-center gap-1 px-2 py-1 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
                  title="Mark all as read"
                >
                  <CheckCheck className="w-3 h-3" />
                  All read
                </button>
              )}
              <button
                onClick={() => fetchAlerts(false)}
                className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
                title="Refresh"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              </button>
              <button
                onClick={() => setIsOpen(false)}
                className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Notification list */}
          <div className="overflow-y-auto max-h-80">
            {loading && notifications.length === 0 ? (
              <div className="flex items-center justify-center py-10">
                <RefreshCw className="w-5 h-5 animate-spin text-gray-400" />
              </div>
            ) : notifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-gray-400 dark:text-gray-500">
                <Bell className="w-8 h-8 mb-2 opacity-30" />
                <p className="text-sm">No new alerts</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-100 dark:divide-gray-700">
                {notifications.map(notif => {
                  const cfg = TYPE_CONFIG[notif.type] || TYPE_CONFIG.default;
                  return (
                    <div
                      key={notif.id}
                      className={`flex items-start gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors ${cfg.bg}`}
                    >
                      <div className={`mt-0.5 text-xl flex-shrink-0`}>{cfg.emoji}</div>
                      <div className="flex-1 min-w-0">
                        <p className={`text-xs font-semibold uppercase tracking-wide ${cfg.color}`}>
                          {cfg.label}
                        </p>
                        <p className="text-sm font-medium text-gray-900 dark:text-gray-100 leading-snug mt-0.5 truncate">
                          {notif.title}
                        </p>
                        <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5 line-clamp-2">
                          {notif.message}
                        </p>
                        <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-1">
                          {timeAgo(notif.createdAt)}
                        </p>
                      </div>
                      <button
                        onClick={() => markRead(notif.id)}
                        className="flex-shrink-0 p-1 text-gray-300 hover:text-gray-500 dark:text-gray-600 dark:hover:text-gray-400 hover:bg-white dark:hover:bg-gray-700 rounded transition-colors"
                        title="Dismiss"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Footer hint */}
          {notifications.length > 0 && (
            <div className="px-4 py-2 border-t border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/30">
              <p className="text-[10px] text-gray-400 dark:text-gray-500 text-center">
                Refreshes every 15 seconds • Click × to dismiss each alert
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
