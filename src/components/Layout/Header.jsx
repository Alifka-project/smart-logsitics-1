import React, { useEffect, useState, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { isAuthenticated, getCurrentUser, clearAuth } from '../../frontend/auth';
import { LogOut, User, Settings, ChevronDown, Bell, Sun, Moon, X, Camera, Save } from 'lucide-react';
import api from '../../frontend/apiClient';

export default function Header() {
  const [loggedIn, setLoggedIn] = useState(isAuthenticated());
  const [user, setUser] = useState(getCurrentUser());
  const [showDropdown, setShowDropdown] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [theme, setTheme] = useState(() => {
    // Get theme from localStorage, system preference, or default to light
    if (typeof window !== 'undefined') {
      const savedTheme = localStorage.getItem('theme');
      if (savedTheme) return savedTheme;
      // Check system preference
      if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
        return 'dark';
      }
      return 'light';
    }
    return 'light';
  });
  const [profileData, setProfileData] = useState({
    fullName: '',
    email: '',
    phone: '',
    profilePicture: null,
    profilePicturePreview: null
  });
  
  const dropdownRef = useRef(null);
  const notificationRef = useRef(null);
  const navigate = useNavigate();

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

  // Load notifications
  useEffect(() => {
    if (loggedIn) {
      loadNotifications();
      // Poll for new notifications every 30 seconds
      const interval = setInterval(loadNotifications, 30000);
      return () => clearInterval(interval);
    }
  }, [loggedIn]);

  const loadNotifications = async () => {
    try {
      const currentUser = getCurrentUser();
      const userRole = currentUser?.account?.role || currentUser?.role || 'driver';
      
      let unreadCount = 0;
      
      // Load unread messages based on user role
      if (userRole === 'admin') {
        // Admin: get unread messages count
        try {
          const response = await api.get('/messages/unread');
          // Count total unread messages across all drivers
          const counts = Object.values(response.data || {});
          unreadCount = counts.reduce((sum, count) => sum + count, 0);
        } catch (e) {
          console.error('Failed to load admin notifications:', e);
        }
      } else if (userRole === 'driver') {
        // Driver: get their unread messages count
        try {
          const response = await api.get('/driver/notifications/count');
          unreadCount = response.data?.count || 0;
        } catch (e) {
          console.error('Failed to load driver notifications:', e);
        }
      }
      
      // Convert count to notifications array
      const notificationsArray = unreadCount > 0 
        ? [{
            id: 'messages',
            type: 'message',
            title: `${unreadCount} unread message${unreadCount !== 1 ? 's' : ''}`,
            message: userRole === 'admin' ? 'You have unread messages from drivers' : 'You have unread messages from admin',
            timestamp: new Date(),
            read: false
          }]
        : [];
      
      setNotifications(notificationsArray);
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

  const handleProfilePictureChange = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setProfileData(prev => ({
          ...prev,
          profilePicture: file,
          profilePicturePreview: reader.result
        }));
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSaveProfile = async () => {
    try {
      // TODO: Implement actual profile update API
      // const formData = new FormData();
      // formData.append('fullName', profileData.fullName);
      // formData.append('email', profileData.email);
      // formData.append('phone', profileData.phone);
      // if (profileData.profilePicture) {
      //   formData.append('profilePicture', profileData.profilePicture);
      // }
      // await api.put('/admin/profile', formData);
      
      // Update local storage
      const updatedUser = {
        ...user,
        full_name: profileData.fullName,
        fullName: profileData.fullName,
        email: profileData.email,
        phone: profileData.phone,
        profile_picture: profileData.profilePicturePreview,
        profilePicture: profileData.profilePicturePreview
      };
      localStorage.setItem('client_user', JSON.stringify(updatedUser));
      setUser(updatedUser);
      setShowProfileModal(false);
      
      alert('Profile updated successfully!');
    } catch (error) {
      console.error('Failed to update profile:', error);
      alert('Failed to update profile. Please try again.');
    }
  };

  const markNotificationAsRead = async (notificationId) => {
    try {
      // TODO: Implement API call
      // await api.post(`/admin/notifications/${notificationId}/read`);
      setNotifications(prev =>
        prev.map(n => n.id === notificationId ? { ...n, read: true } : n)
      );
    } catch (error) {
      console.error('Failed to mark notification as read:', error);
    }
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

  const unreadCount = notifications.filter(n => !n.read).length;

  const handleLogoClick = () => {
    // Redirect to appropriate dashboard based on user role
    if (user?.role === 'admin') {
      navigate('/admin');
    } else if (user?.role === 'driver') {
      navigate('/driver');
    } else {
      navigate('/deliveries');
    }
  };

  return (
    <>
      <header className="bg-gradient-to-r from-primary-600 to-primary-800 text-white shadow-lg sticky top-0 z-50">
      <div className="container mx-auto px-3 sm:px-3 md:px-3 lg:px-3 xl:px-4 2xl:px-5 py-2 sm:py-2.5 max-w-7xl">
        <div className="flex items-center justify-between">
          <button 
            onClick={handleLogoClick}
            className="flex items-center hover:opacity-80 transition-opacity cursor-pointer bg-none border-none p-0"
            title="Go to Dashboard"
          >
            <img 
              src="/elect home.png" 
              alt="Electrolux Logo" 
              className="h-10 sm:h-12 lg:h-14 w-auto object-contain"
            />
          </button>
            
            <div className="flex items-center gap-3 sm:gap-4">
              {/* Date Display - Desktop */}
            <div className="text-right hidden sm:block">
                <div className="text-sm text-white/90">
                {new Date().toLocaleDateString('en-GB', {
                  weekday: 'long',
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric'
                })}
              </div>
            </div>

              {/* Theme Toggle */}
              {loggedIn && (
                <button
                  onClick={toggleTheme}
                  className="p-2 rounded-lg hover:bg-white/10 transition-colors focus:outline-none focus:ring-2 focus:ring-white/50 text-white"
                  title={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
                >
                  {theme === 'light' ? (
                    <Moon className="w-5 h-5 text-white" />
                  ) : (
                    <Sun className="w-5 h-5 text-white" />
                  )}
                </button>
              )}

              {/* Notifications */}
              {loggedIn && (
                <div className="relative" ref={notificationRef}>
                  <button
                    onClick={() => setShowNotifications(!showNotifications)}
                    className="relative p-2 rounded-lg hover:bg-white/10 transition-colors focus:outline-none focus:ring-2 focus:ring-white/50 text-white"
                    title="Notifications"
                  >
                    <Bell className="w-5 h-5 text-white" />
                    {unreadCount > 0 && (
                      <span className="absolute top-1 right-1 w-4 h-4 bg-red-500 rounded-full flex items-center justify-center text-xs font-bold">
                        {unreadCount > 9 ? '9+' : unreadCount}
                      </span>
                    )}
                  </button>

                  {/* Notifications Dropdown */}
                  {showNotifications && (
                    <div className="absolute right-0 mt-2 w-80 sm:w-96 bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 overflow-hidden z-50 transition-colors">
                      <div className="px-4 py-3 bg-gray-50 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-600 flex items-center justify-between">
                        <h3 className="font-semibold text-gray-900 dark:text-gray-100">Notifications</h3>
                        {unreadCount > 0 && (
                          <span className="text-xs text-gray-500 dark:text-gray-400">{unreadCount} unread</span>
                        )}
                      </div>
                      <div className="max-h-96 overflow-y-auto">
                        {notifications.length === 0 ? (
                          <div className="p-8 text-center text-gray-500 dark:text-gray-400">
                            <Bell className="w-12 h-12 mx-auto mb-2 opacity-50" />
                            <p>No notifications</p>
                          </div>
                        ) : (
                          notifications.map(notification => (
                            <div
                              key={notification.id}
                              onClick={() => markNotificationAsRead(notification.id)}
                              className={`px-4 py-3 border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer transition-colors ${
                                !notification.read ? 'bg-blue-50/50 dark:bg-blue-900/20' : ''
                              }`}
                            >
                              <div className="flex items-start gap-3">
                                <div className={`w-2 h-2 rounded-full mt-2 flex-shrink-0 ${
                                  !notification.read ? 'bg-primary-600' : 'bg-transparent'
                                }`}></div>
                                <div className="flex-1 min-w-0">
                                  <div className="font-medium text-gray-900 dark:text-gray-100 text-sm">
                                    {notification.title}
                                  </div>
                                  <div className="text-sm text-gray-600 dark:text-gray-300 mt-1">
                                    {notification.message}
                                  </div>
                                  <div className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                                    {new Date(notification.timestamp).toLocaleString()}
                                  </div>
                                </div>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* User Profile Dropdown */}
              {loggedIn && user ? (
                <div className="relative" ref={dropdownRef}>
                  <button
                    onClick={() => setShowDropdown(!showDropdown)}
                    className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-white/10 transition-colors focus:outline-none focus:ring-2 focus:ring-white/50"
                  >
                    {/* Profile Picture - Circle */}
                    <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center text-white font-semibold text-sm border-2 border-white/30 overflow-hidden">
                      {profileData.profilePicturePreview || user.profile_picture || user.profilePicture ? (
                        <img
                          src={profileData.profilePicturePreview || user.profile_picture || user.profilePicture}
                          alt={getUserDisplayName()}
                          className="w-full h-full rounded-full object-cover"
                        />
                      ) : (
                        <span>{getInitials()}</span>
                      )}
                    </div>
                    
                    {/* User Info - Desktop */}
                    <div className="hidden md:block text-left">
                      <div className="text-sm font-semibold text-white">{getUserDisplayName()}</div>
                      <div className="text-xs text-white/90">{getUserRole()}</div>
                    </div>
                    
                    <ChevronDown 
                      className={`w-4 h-4 transition-transform text-white ${showDropdown ? 'rotate-180' : ''}`}
                    />
                  </button>

                  {/* Dropdown Menu */}
                  {showDropdown && (
                    <div className="absolute right-0 mt-2 w-72 bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 overflow-hidden z-50 transition-colors">
                      {/* User Info Section */}
                      <div className="px-4 py-4 bg-gradient-to-r from-primary-50 to-primary-100 dark:from-primary-900/30 dark:to-primary-800/30 border-b border-gray-200 dark:border-gray-700">
                        <div className="flex items-center gap-3">
                          <div className="relative">
                            <div className="w-16 h-16 rounded-full bg-primary-600 flex items-center justify-center text-white font-semibold text-lg border-4 border-white dark:border-gray-800 shadow-lg overflow-hidden">
                              {profileData.profilePicturePreview || user.profile_picture || user.profilePicture ? (
                                <img
                                  src={profileData.profilePicturePreview || user.profile_picture || user.profilePicture}
                                  alt={getUserDisplayName()}
                                  className="w-full h-full rounded-full object-cover"
                                />
                              ) : (
                                <span>{getInitials()}</span>
                              )}
                            </div>
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="font-bold text-gray-900 dark:text-gray-100 truncate text-base">
                              {getUserDisplayName()}
                            </div>
                            {getUserEmail() && (
                              <div className="text-sm text-gray-600 dark:text-gray-400 truncate">
                                {getUserEmail()}
                              </div>
                            )}
                            <div className="text-xs text-primary-700 dark:text-primary-400 font-medium mt-1">
                              {getUserRole()}
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Menu Items */}
                      <div className="py-2">
                        <button
                          onClick={() => {
                            setShowProfileModal(true);
                            setShowDropdown(false);
                          }}
                          className="w-full flex items-center gap-3 px-4 py-2.5 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors text-left"
                        >
                          <User className="w-5 h-5 text-gray-500 dark:text-gray-400" />
                          <span className="font-medium">Edit Profile</span>
                        </button>
                        
                        <div className="border-t border-gray-200 dark:border-gray-700 my-2"></div>
                        
                        <button
                          onClick={handleLogout}
                          className="w-full flex items-center gap-3 px-4 py-2.5 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors text-left"
                        >
                          <LogOut className="w-5 h-5" />
                          <span className="font-medium">Sign Out</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <Link 
                  to="/login" 
                  className="bg-white text-primary-900 px-4 py-2 rounded-lg font-medium hover:bg-gray-100 transition-colors shadow-sm"
                >
                  Sign in
                </Link>
              )}
            </div>

            {/* Date Display - Mobile */}
          <div className="text-right sm:hidden">
              <div className="text-xs text-white/90">
              {new Date().toLocaleDateString('en-GB', {
                day: 'numeric',
                month: 'short'
              })}
            </div>
          </div>
        </div>
      </div>
    </header>

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
