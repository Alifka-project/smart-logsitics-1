import React, { useEffect, useState, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { isAuthenticated, getCurrentUser, clearAuth } from '../../frontend/auth';
import { LogOut, User, Settings, ChevronDown, Bell, Sun, Moon, X, Camera, Save } from 'lucide-react';
import api from '../../frontend/apiClient';
import { useToast } from '../../hooks/useToast';
import { ToastContainer } from '../common/Toast';


export default function Header({ isAdmin = false, onMenuOpen }) {
  const [loggedIn, setLoggedIn] = useState(isAuthenticated());
  const [user, setUser] = useState(getCurrentUser());
  const [showDropdown, setShowDropdown] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const adminNotificationFetchKey = 'admin_notification_last_fetch';
  const { toasts, removeToast, addToast, info } = useToast();
  const hasLoadedNotificationsRef = useRef(false);
  const prevMessageUnreadRef = useRef(0);
  const prevDeliveryNotificationIdsRef = useRef(new Set());
  const prevMessageNotificationsRef = useRef([]);
  const [theme, setTheme] = useState(() => {
    // Default to dark theme for modern web3-style design
    if (typeof window !== 'undefined') {
      const savedTheme = localStorage.getItem('theme');
      if (savedTheme) return savedTheme;
    }
    return 'dark';
  });
  const [profileData, setProfileData] = useState({
    fullName: '',
    email: '',
    phone: '',
    profilePicture: null,
    profilePicturePreview: null
  });
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [passwordData, setPasswordData] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  });
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState(false);
  
  const dropdownRef = useRef(null);
  const notificationRef = useRef(null);
  const navigate = useNavigate();

  const playNotificationSound = () => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    if (document.hidden) return;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      const context = new AudioContext();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = 880;
      gain.gain.value = 0.06;
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.18);
      oscillator.onended = () => context.close();
    } catch (error) {
      console.warn('Notification sound blocked:', error);
    }
  };

  useEffect(() => {
    function refresh() {
      setLoggedIn(isAuthenticated());
      const currentUser = getCurrentUser();
      setUser(currentUser);
      if (currentUser) {
        setProfileData({
          fullName: currentUser.full_name || currentUser.fullName || currentUser.username || '',
          email: currentUser.email || '',
          phone: currentUser.phone || '',
          profilePicture: null,
          profilePicturePreview: currentUser.profile_picture || currentUser.profilePicture || null
        });
      }
    }
    window.addEventListener('storage', refresh);
    window.addEventListener('focus', refresh);
    refresh();
    return () => {
      window.removeEventListener('storage', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, []);

  // Apply theme to document on mount and when theme changes
  useEffect(() => {
    if (typeof document !== 'undefined') {
      // Remove both classes first
      document.documentElement.classList.remove('light', 'dark');
      // Add the current theme class
      document.documentElement.classList.add(theme);
      // Save to localStorage
      localStorage.setItem('theme', theme);
    }
  }, [theme]);

  // Close dropdowns when clicking outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setShowDropdown(false);
      }
      if (notificationRef.current && !notificationRef.current.contains(event.target)) {
        setShowNotifications(false);
      }
    }

    if (showDropdown || showNotifications) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showDropdown, showNotifications]);

  // Load notifications - poll every 60 seconds, pause when tab hidden
  useEffect(() => {
    if (!loggedIn) return;

    let timer = null;
    let isVisible = !document.hidden;

    const poll = () => {
      loadNotifications();
      schedulePoll();
    };

    const schedulePoll = () => {
      if (timer) clearTimeout(timer);
      if (!isVisible) return; // Don't poll when tab is hidden
      timer = setTimeout(poll, 60000); // 60 seconds instead of 10
    };

    const handleVisibility = () => {
      isVisible = !document.hidden;
      if (isVisible) {
        loadNotifications(); // Fetch once when tab becomes visible
        schedulePoll();
      } else {
        if (timer) { clearTimeout(timer); timer = null; }
      }
    };

    const handleStatusUpdated = (e) => {
      const updatedId = e.detail?.deliveryId;
      // Remove notifications for this delivery immediately
      setNotifications(prev => prev.filter(n => !updatedId || String(n.deliveryId) !== String(updatedId)));
      // Re-fetch to pick up any remaining overdue items
      loadNotifications();
    };

    // Initial load + start polling
    loadNotifications();
    schedulePoll();

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('deliveryStatusUpdated', handleStatusUpdated);

    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('deliveryStatusUpdated', handleStatusUpdated);
    };
  }, [loggedIn]);

  // Cache contacts list for notification display names (avoid fetching every poll)
  const contactsCacheRef = React.useRef({ data: null, fetchedAt: 0 });

  const loadNotifications = async () => {
    try {
      const currentUser = getCurrentUser();
      const userRole = currentUser?.account?.role || currentUser?.role || 'driver';
      
      let unreadCount = 0;
      let deliveryNotifications = [];
      let messageNotifications = [];

      // Driver: use driver-specific unread count API (1 DB query)
      if (userRole === 'driver') {
        try {
          const response = await api.get('/messages/driver/notifications/count');
          const count = Number(response.data?.count) || 0;
          unreadCount = count;
          if (count > 0) {
            messageNotifications = [{
              id: 'messages-driver-admin',
              type: 'message',
              count,
              senderId: 'admin',
              senderRole: 'admin',
              title: `${count} unread message${count !== 1 ? 's' : ''} from Admin`,
              message: 'Open Messages tab to read',
              timestamp: new Date(),
              read: false
            }];
          }
        } catch (e) {
          console.error('Failed to load driver message notifications:', e);
        }
      } else {
        // Admin: load unread counts per driver (1 DB query)
        try {
          const response = await api.get('/messages/unread');
          const countsBySender = response.data || {};
          const senderEntries = Object.entries(countsBySender)
            .map(([senderId, count]) => [senderId, Number(count) || 0])
            .filter(([, count]) => count > 0);

          unreadCount = senderEntries.reduce((sum, [, count]) => sum + count, 0);

          if (senderEntries.length) {
            // Reuse cached contacts for 5 minutes instead of fetching every poll
            let userLookup = new Map();
            const cacheAge = Date.now() - contactsCacheRef.current.fetchedAt;
            if (contactsCacheRef.current.data && cacheAge < 5 * 60 * 1000) {
              userLookup = contactsCacheRef.current.data;
            } else {
              try {
                const usersResponse = await api.get('/messages/contacts');
                const usersList = usersResponse.data?.contacts || [];
                usersList.forEach((user) => {
                  if (user?.id != null) {
                    userLookup.set(String(user.id), user);
                  }
                });
                contactsCacheRef.current = { data: userLookup, fetchedAt: Date.now() };
              } catch (userError) {
                console.error('Failed to load contacts for notifications:', userError);
              }
            }

            messageNotifications = senderEntries.map(([senderId, count]) => {
              const sender = userLookup.get(String(senderId));
              const displayName = sender?.fullName || sender?.full_name || sender?.username || `User ${String(senderId).slice(0, 6)}`;
              const senderRole = sender?.account?.role || 'user';
              return {
                id: `messages-${senderId}`,
                type: 'message',
                count,
                senderId,
                senderRole,
                title: `${count} unread message${count !== 1 ? 's' : ''} from ${displayName}`,
                message: `Open chat with ${displayName}`,
                timestamp: new Date(),
                read: false
              };
            });
          }
        } catch (e) {
          console.error('Failed to load message notifications:', e);
        }
      }

      // Admin: fetch real-time alerts + overdue deliveries (>24h pending) + unconfirmed SMS deliveries
      if (userRole === 'admin') {
        try {
          const [alertsRes, overdueRes, unconfirmedRes] = await Promise.allSettled([
            api.get('/admin/notifications/alerts'),
            api.get('/admin/notifications/overdue-deliveries'),
            api.get('/admin/notifications/unconfirmed-deliveries')
          ]);

          const dbAlerts = alertsRes.status === 'fulfilled'
            ? (alertsRes.value.data?.notifications || [])
            : [];

          const overdueDeliveries = overdueRes.status === 'fulfilled'
            ? (overdueRes.value.data?.deliveries || [])
            : [];

          const unconfirmedDeliveries = unconfirmedRes.status === 'fulfilled'
            ? (unconfirmedRes.value.data?.deliveries || [])
            : [];

          const overdueNotifs = overdueDeliveries.map(d => ({
            id: `overdue-${d.id}`,
            type: 'delivery',
            status: 'overdue',
            deliveryId: d.id,
            title: `Overdue (${d.hoursOverdue}h): ${d.customer || 'Unknown'}`,
            message: `${d.address || 'No address'} — Status: ${d.status}`,
            timestamp: d.createdAt,
            read: false
          }));

          const unconfirmedNotifs = unconfirmedDeliveries.map(d => ({
            id: `sms-unconfirmed-${d.id}`,
            type: 'delivery',
            status: 'sms_unconfirmed',
            title: `SMS Unconfirmed (>24h): ${d.customer || 'Unknown'}`,
            message: d.address || 'No address',
            timestamp: d.smsSentAt || d.createdAt,
            read: false,
            _smsDeliveryId: d.id
          }));

          const alertNotifs = dbAlerts.map(n => ({
            id: `alert-${n.id}`,
            type: 'delivery',
            status: n.type,
            title: n.title,
            message: n.message,
            timestamp: n.createdAt,
            read: false,
            _adminAlertId: n.id
          }));

          // Order: real-time alerts first, then overdue, then SMS unconfirmed
          deliveryNotifications = [...alertNotifs, ...overdueNotifs, ...unconfirmedNotifs];
        } catch (e) {
          console.error('Failed to load admin alert notifications:', e);
          deliveryNotifications = [];
        }
      }

      let shouldPlaySound = false;
      let newDeliveryCount = 0;
      
      // Check for new delivery notifications
      if (deliveryNotifications.length > 0) {
        const newDeliveryIds = new Set(deliveryNotifications.map(n => n.id));
        if (hasLoadedNotificationsRef.current) {
          deliveryNotifications.forEach((notif) => {
            if (!prevDeliveryNotificationIdsRef.current.has(notif.id)) {
              newDeliveryCount++;
            }
          });
        }
        prevDeliveryNotificationIdsRef.current = newDeliveryIds;
      }
      
      if (hasLoadedNotificationsRef.current) {
        const messageDelta = unreadCount - prevMessageUnreadRef.current;
        console.log('[Notification Check]', { messageDelta, unreadCount, prev: prevMessageUnreadRef.current });
        
        if (messageDelta > 0) {
          console.log('[TOAST] Showing new message notification:', messageDelta);
          
          // Show detailed toast based on role and who sent the message
          if ((userRole === 'admin' || userRole === 'delivery_team') && messageNotifications.length > 0) {
            // Admin/Delivery Team receiving messages from drivers - show driver name
            const prevNotifications = prevMessageNotificationsRef.current;
            const newMessages = messageNotifications.filter(notif => {
              const prevNotif = prevNotifications.find(p => p.id === notif.id);
              return !prevNotif || (notif.count > (prevNotif.count || 0));
            });
            
            newMessages.forEach(notif => {
              const driver = notif.title.match(/from (.+)$/)?.[1] || 'a driver';
              addToast(
                `Message from ${driver}`,
                'message',
                `You have ${notif.count} unread message${notif.count !== 1 ? 's' : ''}`,
                'Click notification bell to view',
                7000
              );
            });
          } else if (userRole === 'driver') {
            // Driver receiving messages from admin
            addToast(
              'New Message from Admin',
              'message',
              `You have ${messageDelta} new message${messageDelta !== 1 ? 's' : ''}`,
              'Check the Messages tab to read',
              7000
            );
          }
          
          shouldPlaySound = true;
        }
        
        if (newDeliveryCount > 0) {
          console.log('[TOAST] Showing new delivery notification:', newDeliveryCount);
          const deliveryTypes = deliveryNotifications
            .filter(n => !prevDeliveryNotificationIdsRef.current.has(n.id))
            .map(n => n.status || 'updated')
            .slice(0, 2);
          
          addToast(
            'Delivery Status Update',
            'delivery',
            `${newDeliveryCount} delivery${newDeliveryCount !== 1 ? ' updates' : ' update'}: ${deliveryTypes.join(', ')}`,
            'Click notification bell to view details',
            7000
          );
          
          shouldPlaySound = true;
        }
      }
      
      // Store current message notifications for next comparison
      prevMessageNotificationsRef.current = messageNotifications;
      console.log('[Notification] Final state - shouldPlaySound:', shouldPlaySound, 'hasLoaded:', hasLoadedNotificationsRef.current);
      prevMessageUnreadRef.current = unreadCount;
      if (!hasLoadedNotificationsRef.current) {
        hasLoadedNotificationsRef.current = true;
      }
      if (shouldPlaySound) {
        playNotificationSound();
      }

      setNotifications((prev) => {
        const previousById = new Map(prev.map((item) => [item.id, item]));
        const next = [];

        messageNotifications.forEach((notification) => {
          const existing = previousById.get(notification.id);
          next.push({
            ...notification,
            read: existing?.read ?? false
          });
        });

        const newDeliveryIds = new Set();
        if ((userRole === 'admin' || userRole === 'delivery_team') && deliveryNotifications.length) {
          deliveryNotifications.forEach((notif) => {
            newDeliveryIds.add(notif.id);
            const existing = previousById.get(notif.id);
            next.push({
              ...notif,
              read: existing?.read ?? false
            });
          });
        }

        prev.forEach((item) => {
          if (item.type === 'delivery' && !newDeliveryIds.has(item.id)) {
            next.push(item);
          }
        });

        next.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        return next.slice(0, 50);
      });
    } catch (error) {
      console.error('Failed to load notifications:', error);
    }
  };

  const toggleTheme = () => {
    setTheme(prev => prev === 'light' ? 'dark' : 'light');
  };

  async function handleLogout() {
    try {
      await api.post('/auth/logout').catch(() => {});
    } catch (e) {
      console.error('Logout error:', e);
    } finally {
      clearAuth();
    setLoggedIn(false);
      setUser(null);
      setShowDropdown(false);
      navigate('/login');
    }
  }

  // Compress image to max 400x400, JPEG 0.8, to avoid localStorage quota and keep payload small
  const compressProfileImage = (dataUrl, maxSize = 400, quality = 0.8) => {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let { width, height } = img;
        if (width > maxSize || height > maxSize) {
          if (width > height) {
            height = Math.round((height * maxSize) / width);
            width = maxSize;
          } else {
            width = Math.round((width * maxSize) / height);
            height = maxSize;
          }
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        try {
          const compressed = canvas.toDataURL('image/jpeg', quality);
          resolve(compressed);
        } catch (e) {
          resolve(dataUrl);
        }
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    });
  };

  const handleProfilePictureChange = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = async () => {
        const dataUrl = reader.result;
        const compressed = await compressProfileImage(dataUrl);
        setProfileData(prev => ({
          ...prev,
          profilePicture: file,
          profilePicturePreview: compressed
        }));
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSaveProfile = async () => {
    try {
      const payload = {
        fullName: profileData.fullName?.trim() || user?.full_name || user?.fullName || '',
        email: profileData.email?.trim() || null,
        phone: profileData.phone?.trim() || null
      };
      if (profileData.profilePicturePreview) payload.profilePicture = profileData.profilePicturePreview;

      const { data } = await api.patch('/auth/profile', payload);

      const updatedUser = {
        ...user,
        ...(data?.user || {}),
        full_name: data?.user?.full_name ?? profileData.fullName,
        fullName: data?.user?.fullName ?? profileData.fullName,
        email: data?.user?.email ?? profileData.email,
        phone: data?.user?.phone ?? profileData.phone,
        profile_picture: data?.user?.profile_picture ?? data?.user?.profilePicture ?? profileData.profilePicturePreview,
        profilePicture: data?.user?.profilePicture ?? data?.user?.profile_picture ?? profileData.profilePicturePreview
      };
      localStorage.setItem('client_user', JSON.stringify(updatedUser));
      setUser(updatedUser);
      setShowProfileModal(false);
      alert('Profile updated successfully!');
    } catch (error) {
      console.error('Failed to update profile:', error);
      const msg = error.response?.data?.message || error.response?.data?.error || error.message;
      alert(msg || 'Failed to update profile. Please try again.');
    }
  };

  const handleChangePassword = async () => {
    setPasswordError('');
    setPasswordSuccess(false);
    
    // Validation
    if (!passwordData.currentPassword || !passwordData.newPassword || !passwordData.confirmPassword) {
      setPasswordError('All password fields are required');
      return;
    }
    
    if (passwordData.newPassword !== passwordData.confirmPassword) {
      setPasswordError('New password and confirmation do not match');
      return;
    }
    
    if (passwordData.newPassword.length < 8) {
      setPasswordError('New password must be at least 8 characters long');
      return;
    }
    
    try {
      await api.post('/auth/change-password', {
        currentPassword: passwordData.currentPassword,
        newPassword: passwordData.newPassword
      });
      
      setPasswordSuccess(true);
      setPasswordData({ currentPassword: '', newPassword: '', confirmPassword: '' });
      
      // Auto close after 2 seconds and redirect to login
      setTimeout(() => {
        setShowChangePassword(false);
        setShowProfileModal(false);
        handleLogout();
      }, 2000);
    } catch (error) {
      const errorMsg = error?.response?.data?.error || error?.response?.data?.message || 'Failed to change password';
      if (errorMsg === 'invalid_current_password') {
        setPasswordError('Current password is incorrect');
      } else if (errorMsg === 'password_validation_failed') {
        const details = error?.response?.data?.details || [];
        setPasswordError('Password requirements: ' + details.join(', '));
      } else {
        setPasswordError(errorMsg);
      }
    }
  };

  const markNotificationAsRead = async (notification) => {
    try {
      if (!notification || notification.type === 'message') {
        return;
      }
      // Mark admin DB alert as read
      if (notification._adminAlertId) {
        await api.put(`/admin/notifications/alerts/${notification._adminAlertId}/read`).catch(() => {});
      }
      setNotifications(prev =>
        prev.map(n => n.id === notification.id ? { ...n, read: true } : n)
      );
    } catch (error) {
      console.error('Failed to mark notification as read:', error);
    }
  };

  const handleNotificationClick = (notification) => {
    if (!notification) return;
    const currentUser = getCurrentUser();
    const userRole = currentUser?.account?.role || currentUser?.role || 'driver';

    if (notification.type === 'message') {
      setShowNotifications(false);
      if (userRole === 'admin') {
        const userQuery = notification.senderId ? `&userId=${encodeURIComponent(notification.senderId)}` : '';
        navigate(`/admin/operations?tab=communication${userQuery}`);
        return;
      }
      if (userRole === 'delivery_team') {
        const contactQuery = notification.senderId ? `?tab=communication&contact=${encodeURIComponent(notification.senderId)}` : '?tab=communication';
        navigate(`/delivery-team${contactQuery}`);
        return;
      }
      navigate('/driver?tab=messages');
      return;
    }

    if (notification.type === 'delivery' && (userRole === 'admin' || userRole === 'delivery_team')) {
      setShowNotifications(false);
      const deliveryQuery = notification.deliveryId ? `&delivery=${encodeURIComponent(notification.deliveryId)}` : '';
      if (userRole === 'delivery_team') {
        navigate(`/delivery-team?tab=control${deliveryQuery}`);
      } else {
        navigate(`/admin?tab=deliveries${deliveryQuery}&viewAll=1`);
      }
      markNotificationAsRead(notification);
      return;
    }
    markNotificationAsRead(notification);
  };

  const getInitials = () => {
    if (!user) return 'U';
    const fullName = user.full_name || user.fullName || user.username || '';
    const parts = fullName.split(' ');
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return (fullName[0] || user.username?.[0] || 'U').toUpperCase();
  };

  const getUserDisplayName = () => {
    if (!user) return 'User';
    return user.full_name || user.fullName || user.username || 'User';
  };

  const getUserEmail = () => {
    if (!user) return '';
    return user.email || '';
  };

  const getUserRole = () => {
    if (!user) return '';
    const role = user.role || '';
    return role.charAt(0).toUpperCase() + role.slice(1);
  };

  const unreadCount = notifications.reduce((total, notification) => {
    if (notification.read) return total;
    if (notification.type === 'message') {
      return total + (Number(notification.count) || 0);
    }
    return total + 1;
  }, 0);

  const handleLogoClick = () => {
    // Redirect to appropriate dashboard based on user role
    if (user?.role === 'admin') {
      navigate('/admin');
    } else if (user?.role === 'delivery_team') {
      navigate('/delivery-team');
    } else if (user?.role === 'driver') {
      navigate('/driver');
    } else {
      navigate('/deliveries');
    }
  };

  /* ─────────────────────────────────────────────────────
     Shared notification / user dropdown JSX helpers
     Called as {renderNotifDropdown()} not as <Component />
     to avoid inner-component remount anti-pattern
  ───────────────────────────────────────────────────── */
  const renderNotifDropdown = () => (showNotifications && (
      <div
        className="absolute right-0 mt-2 w-80 sm:w-96 rounded-xl shadow-2xl overflow-hidden z-50"
        style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}
      >
        <div
          className="px-4 py-3 flex items-center justify-between"
          style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)' }}
        >
          <h3 className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>Notifications</h3>
          {unreadCount > 0 && (
            <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: 'var(--accent-glow)', color: 'var(--accent)' }}>
              {unreadCount} unread
            </span>
          )}
        </div>
        <div className="max-h-96 overflow-y-auto">
          {notifications.length === 0 ? (
            <div className="p-8 text-center" style={{ color: 'var(--text-muted)' }}>
              <Bell className="w-10 h-10 mx-auto mb-2 opacity-30" />
              <p className="text-sm">No notifications</p>
            </div>
          ) : (
            notifications.map(n => (
              <div
                key={n.id}
                onClick={() => handleNotificationClick(n)}
                className="px-4 py-3 cursor-pointer transition-colors"
                style={{
                  borderBottom: '1px solid var(--border)',
                  background: !n.read ? 'rgba(79,112,245,0.05)' : 'transparent',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = !n.read ? 'rgba(79,112,245,0.05)' : 'transparent'; }}
              >
                <div className="flex items-start gap-3">
                  <div
                    className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0"
                    style={{ background: !n.read ? 'var(--accent)' : 'transparent' }}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{n.title}</p>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>{n.message}</p>
                    <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{new Date(n.timestamp).toLocaleString()}</p>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    ));

  const renderUserDropdown = () => (showDropdown && (
      <div
        className="absolute right-0 mt-2 w-64 rounded-xl shadow-2xl overflow-hidden z-50"
        style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}
      >
        <div
          className="px-4 py-4 flex items-center gap-3"
          style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)' }}
        >
          <div
            className="w-11 h-11 rounded-full flex items-center justify-center text-white font-semibold text-sm overflow-hidden flex-shrink-0"
            style={{ background: 'var(--accent)' }}
          >
            {(profileData.profilePicturePreview || user?.profile_picture || user?.profilePicture)
              ? <img src={profileData.profilePicturePreview || user.profile_picture || user.profilePicture} alt={getUserDisplayName()} className="w-full h-full object-cover" />
              : <span>{getInitials()}</span>}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm truncate" style={{ color: 'var(--text-primary)' }}>{getUserDisplayName()}</p>
            {getUserEmail() && <p className="text-xs truncate mt-0.5" style={{ color: 'var(--text-muted)' }}>{getUserEmail()}</p>}
            <span
              className="inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded mt-1 capitalize"
              style={{ background: 'var(--accent-glow)', color: 'var(--accent)' }}
            >{getUserRole()}</span>
          </div>
        </div>
        <div className="py-1.5">
          <button
            onClick={() => { setShowProfileModal(true); setShowDropdown(false); }}
            className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left transition-colors"
            style={{ color: 'var(--text-secondary)' }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.color = 'var(--text-primary)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
          >
            <User className="w-4 h-4" /> Edit Profile
          </button>
          <div style={{ borderTop: '1px solid var(--border)', margin: '4px 0' }} />
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left transition-colors text-red-400"
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.08)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
          >
            <LogOut className="w-4 h-4" /> Sign Out
          </button>
        </div>
      </div>
    ));

  return (
    <>
      {isAdmin ? (
        /* ── Admin slim top-bar ── */
        <header
          className="sticky top-0 z-30 h-14 flex items-center px-4 gap-3"
          style={{
            background: 'var(--bg-surface)',
            borderBottom: '1px solid var(--border)',
          }}
        >
          {/* Mobile hamburger */}
          <button
            onClick={onMenuOpen}
            className="md:hidden p-2 rounded-lg transition-colors"
            style={{ color: 'var(--text-muted)' }}
            title="Open menu"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>

          {/* Date */}
          <span className="hidden sm:block text-sm" style={{ color: 'var(--text-muted)' }}>
            {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </span>

          <div className="flex-1" />

          {/* Theme toggle */}
          {loggedIn && (
            <button
              onClick={toggleTheme}
              className="p-2 rounded-lg transition-colors"
              style={{ color: 'var(--text-muted)' }}
              title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.color = 'var(--text-primary)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-muted)'; }}
            >
              {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </button>
          )}

          {/* Notifications */}
          {loggedIn && (
            <div className="relative" ref={notificationRef}>
              <button
                onClick={() => setShowNotifications(!showNotifications)}
                className="relative p-2 rounded-lg transition-colors"
                style={{ color: 'var(--text-muted)' }}
                onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.color = 'var(--text-primary)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-muted)'; }}
              >
                <Bell className="w-5 h-5" />
                {unreadCount > 0 && (
                  <span className="absolute top-1 right-1 min-w-[16px] h-4 bg-red-500 rounded-full flex items-center justify-center text-[10px] font-bold text-white px-0.5">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </button>
              { renderNotifDropdown() }
            </div>
          )}

          {/* User avatar */}
          {loggedIn && user && (
            <div className="relative" ref={dropdownRef}>
              <button
                onClick={() => setShowDropdown(!showDropdown)}
                className="flex items-center gap-2 px-2 py-1 rounded-xl transition-colors"
                onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
              >
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold overflow-hidden"
                  style={{ background: 'var(--accent)' }}
                >
                  {(profileData.profilePicturePreview || user.profile_picture || user.profilePicture)
                    ? <img src={profileData.profilePicturePreview || user.profile_picture || user.profilePicture} alt="" className="w-full h-full object-cover" />
                    : <span>{getInitials()}</span>}
                </div>
                <div className="hidden sm:block text-left">
                  <p className="text-sm font-semibold leading-tight" style={{ color: 'var(--text-primary)' }}>{getUserDisplayName()}</p>
                  <p className="text-[10px] capitalize" style={{ color: 'var(--text-muted)' }}>{getUserRole()}</p>
                </div>
                <ChevronDown
                  className={`w-4 h-4 transition-transform ${showDropdown ? 'rotate-180' : ''}`}
                  style={{ color: 'var(--text-muted)' }}
                />
              </button>
              { renderUserDropdown() }
            </div>
          )}
        </header>
      ) : (
        /* ── Non-admin full header ── */
        <header className="bg-gradient-to-r from-primary-600 to-primary-800 text-white shadow-lg sticky top-0 z-50">
          <div className="container mx-auto px-4 sm:px-6 py-2.5 max-w-7xl">
            <div className="flex items-center justify-between">
              <button onClick={handleLogoClick} className="flex items-center hover:opacity-80 transition-opacity" title="Go to Dashboard">
                <img src="/elect home.png" alt="Electrolux Logo" className="h-10 sm:h-12 lg:h-14 w-auto object-contain" />
              </button>

              <div className="flex items-center gap-3">
                <div className="text-right hidden sm:block">
                  <div className="text-sm text-white/90">
                    {new Date().toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                  </div>
                </div>

                {loggedIn && (
                  <button onClick={toggleTheme} className="p-2 rounded-lg hover:bg-white/10 transition-colors text-white"
                    title={theme === 'light' ? 'Dark mode' : 'Light mode'}>
                    {theme === 'light' ? <Moon className="w-5 h-5" /> : <Sun className="w-5 h-5" />}
                  </button>
                )}

                {loggedIn && (
                  <div className="relative" ref={notificationRef}>
                    <button onClick={() => setShowNotifications(!showNotifications)}
                      className="relative p-2 rounded-lg hover:bg-white/10 transition-colors text-white">
                      <Bell className="w-5 h-5" />
                      {unreadCount > 0 && (
                        <span className="absolute top-1 right-1 w-4 h-4 bg-red-500 rounded-full flex items-center justify-center text-xs font-bold">
                          {unreadCount > 9 ? '9+' : unreadCount}
                        </span>
                      )}
                    </button>
                    { renderNotifDropdown() }
                  </div>
                )}

                {loggedIn && user ? (
                  <div className="relative" ref={dropdownRef}>
                    <button onClick={() => setShowDropdown(!showDropdown)}
                      className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-white/10 transition-colors">
                      <div className="w-9 h-9 rounded-full bg-white/20 border-2 border-white/30 overflow-hidden flex items-center justify-center text-white font-semibold text-sm">
                        {(profileData.profilePicturePreview || user.profile_picture || user.profilePicture)
                          ? <img src={profileData.profilePicturePreview || user.profile_picture || user.profilePicture} alt="" className="w-full h-full object-cover" />
                          : <span>{getInitials()}</span>}
                      </div>
                      <div className="hidden md:block text-left">
                        <div className="text-sm font-semibold text-white">{getUserDisplayName()}</div>
                        <div className="text-xs text-white/80">{getUserRole()}</div>
                      </div>
                      <ChevronDown className={`w-4 h-4 text-white transition-transform ${showDropdown ? 'rotate-180' : ''}`} />
                    </button>
                    { renderUserDropdown() }
                  </div>
                ) : (
                  <Link to="/login" className="bg-white text-primary-900 px-4 py-2 rounded-lg font-medium hover:bg-gray-100 transition-colors shadow-sm">
                    Sign in
                  </Link>
                )}
              </div>
            </div>
          </div>
        </header>
      )}
      <ToastContainer toasts={toasts} onRemove={removeToast} />

      {/* Profile Edit Modal */}
      {showProfileModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full max-h-[90vh] overflow-y-auto transition-colors">
            <div className="sticky top-0 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-4 flex items-center justify-between">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Edit Profile</h2>
              <button
                onClick={() => setShowProfileModal(false)}
                className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            <div className="p-6 space-y-6">
              {/* Profile Picture Upload */}
              <div className="flex flex-col items-center">
                <div className="relative">
                  <div className="w-24 h-24 rounded-full bg-primary-100 flex items-center justify-center text-primary-600 font-semibold text-2xl border-4 border-white shadow-lg overflow-hidden">
                    {profileData.profilePicturePreview ? (
                      <img
                        src={profileData.profilePicturePreview}
                        alt="Profile"
                        className="w-full h-full rounded-full object-cover"
                      />
                    ) : (
                      <span>{getInitials()}</span>
                    )}
                  </div>
                  <label className="absolute bottom-0 right-0 bg-primary-600 text-white p-2 rounded-full cursor-pointer hover:bg-primary-700 transition-colors shadow-lg">
                    <Camera className="w-4 h-4" />
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleProfilePictureChange}
                      className="hidden"
                    />
                  </label>
                </div>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">Click camera icon to change photo</p>
              </div>

              {/* Form Fields */}
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Full Name
                  </label>
                  <input
                    type="text"
                    value={profileData.fullName}
                    onChange={(e) => setProfileData(prev => ({ ...prev, fullName: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Email
                  </label>
                  <input
                    type="email"
                    value={profileData.email}
                    onChange={(e) => setProfileData(prev => ({ ...prev, email: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Phone
                  </label>
                  <input
                    type="tel"
                    value={profileData.phone}
                    onChange={(e) => setProfileData(prev => ({ ...prev, phone: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Role
                  </label>
                  <input
                    type="text"
                    value={getUserRole()}
                    disabled
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700 text-gray-500 dark:text-gray-400"
                  />
                </div>

                {/* Change Password Button */}
                <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
                  <button
                    onClick={() => setShowChangePassword(!showChangePassword)}
                    className="w-full flex items-center justify-between px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                  >
                    <span className="font-medium">Change Password</span>
                    <Settings className="w-4 h-4" />
                  </button>
                </div>

                {/* Change Password Section */}
                {showChangePassword && (
                  <div className="space-y-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                    {passwordSuccess ? (
                      <div className="p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
                        <p className="text-green-800 dark:text-green-200 text-sm font-medium">
                          ✓ Password changed successfully! Redirecting to login...
                        </p>
                      </div>
                    ) : (
                      <>
                        {passwordError && (
                          <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                            <p className="text-red-800 dark:text-red-200 text-sm">{passwordError}</p>
                          </div>
                        )}
                        
                        <div>
                          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                            Current Password
                          </label>
                          <input
                            type="password"
                            value={passwordData.currentPassword}
                            onChange={(e) => setPasswordData(prev => ({ ...prev, currentPassword: e.target.value }))}
                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                          />
                        </div>

                        <div>
                          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                            New Password
                          </label>
                          <input
                            type="password"
                            value={passwordData.newPassword}
                            onChange={(e) => setPasswordData(prev => ({ ...prev, newPassword: e.target.value }))}
                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                          />
                        </div>

                        <div>
                          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                            Confirm New Password
                          </label>
                          <input
                            type="password"
                            value={passwordData.confirmPassword}
                            onChange={(e) => setPasswordData(prev => ({ ...prev, confirmPassword: e.target.value }))}
                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                          />
                        </div>

                        <button
                          onClick={handleChangePassword}
                          className="w-full px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors font-medium"
                        >
                          Update Password
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div className="flex gap-3 pt-4 border-t border-gray-200 dark:border-gray-700">
                <button
                  onClick={() => setShowProfileModal(false)}
                  className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveProfile}
                  className="flex-1 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors flex items-center justify-center gap-2"
                >
                  <Save className="w-4 h-4" />
                  Save Changes
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
