import React, { useEffect, useState, useRef, useCallback } from 'react';
import { NavLink, Link, useNavigate, useLocation } from 'react-router-dom';
import { isAuthenticated, getCurrentUser, clearAuth } from '../../frontend/auth';
import {
  LogOut, User, Settings, ChevronDown, Bell, Sun, Moon, X, Camera, Save, Menu,
  Search, Sparkles, Package, TruckIcon, CheckCircle2, Users,
  Zap, Clock,
} from 'lucide-react';
import api from '../../frontend/apiClient';
import { useToast } from '../../hooks/useToast';
import { ToastContainer } from '../common/Toast';

/* ─── Admin top navigation items ────────────────────────── */
const ADMIN_NAV = [
  { label: 'Dashboard',  path: '/admin',            exact: true  },
  { label: 'Deliveries', path: '/deliveries',       exact: false },
  { label: 'Operations', path: '/admin/operations', exact: false },
  { label: 'Reports',    path: '/admin/reports',    exact: false },
  { label: 'Users',      path: '/admin/users',      exact: false },
];

/* ─── Quick search suggestion pills ─────────────────────── */
const SEARCH_SUGGESTIONS = [
  'Pending deliveries',
  'Out for delivery',
  'Overdue deliveries',
  'Active drivers',
];

export default function Header({ isAdmin = false }) {
  /* ── Auth state ── */
  const [loggedIn, setLoggedIn] = useState(isAuthenticated());
  const [user,     setUser]     = useState(getCurrentUser());

  /* ── UI state ── */
  const [showDropdown,      setShowDropdown]      = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showProfileModal,  setShowProfileModal]  = useState(false);
  const [mobileNavOpen,     setMobileNavOpen]     = useState(false);

  /* ── Notifications ── */
  const [notifications, setNotifications] = useState([]);
  const { toasts, removeToast, addToast } = useToast();
  const hasLoadedRef            = useRef(false);
  const prevMsgUnreadRef        = useRef(0);
  const prevDeliveryIdsRef      = useRef(new Set());
  const prevMsgNotificationsRef = useRef([]);
  const contactsCacheRef        = useRef({ data: null, fetchedAt: 0 });

  /* ── AI Search ── */
  const [searchQuery,   setSearchQuery]   = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [showSearch,    setShowSearch]    = useState(false);
  const searchRef       = useRef(null);
  const searchInputRef  = useRef(null);

  /* ── Navbar stats ── */
  const [navStats, setNavStats] = useState(null);

  /* ── Theme ── */
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem('theme') || 'dark'; } catch { return 'dark'; }
  });

  /* ── Profile ── */
  const [profileData, setProfileData] = useState({
    fullName: '', email: '', phone: '', profilePicture: null, profilePicturePreview: null,
  });
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [passwordData, setPasswordData] = useState({
    currentPassword: '', newPassword: '', confirmPassword: '',
  });
  const [passwordError,   setPasswordError]   = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState(false);

  const dropdownRef    = useRef(null);
  const notifRef       = useRef(null);
  const navigate       = useNavigate();
  const location       = useLocation();

  /* ──────────────────── Effects ──────────────────── */
  useEffect(() => {
    function refresh() {
      setLoggedIn(isAuthenticated());
      const u = getCurrentUser();
      setUser(u);
      if (u) {
        setProfileData({
          fullName:              u.full_name || u.fullName || u.username || '',
          email:                 u.email  || '',
          phone:                 u.phone  || '',
          profilePicture:        null,
          profilePicturePreview: u.profile_picture || u.profilePicture || null,
        });
      }
    }
    window.addEventListener('storage', refresh);
    window.addEventListener('focus',   refresh);
    refresh();
    return () => {
      window.removeEventListener('storage', refresh);
      window.removeEventListener('focus',   refresh);
    };
  }, []);

  useEffect(() => {
    try {
      document.documentElement.classList.remove('light', 'dark');
      document.documentElement.classList.add(theme);
      document.documentElement.style.removeProperty('background-color');
      localStorage.setItem('theme', theme);
    } catch {}
  }, [theme]);

  /* Close dropdowns on outside click */
  useEffect(() => {
    function onOutside(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target))
        setShowDropdown(false);
      if (notifRef.current && !notifRef.current.contains(e.target))
        setShowNotifications(false);
      if (searchRef.current && !searchRef.current.contains(e.target))
        setShowSearch(false);
    }
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, []);

  /* Close mobile nav drawer on route change */
  useEffect(() => { setMobileNavOpen(false); }, [location.pathname]);

  /* Keyboard shortcut: Ctrl/Cmd+K focuses search, Esc closes */
  useEffect(() => {
    const onKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
        setShowSearch(true);
      }
      if (e.key === 'Escape') {
        setShowSearch(false);
        searchInputRef.current?.blur();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  /* Notification polling */
  useEffect(() => {
    if (!loggedIn) return;
    let timer = null;
    let visible = !document.hidden;
    const poll = () => { loadNotifications(); schedule(); };
    const schedule = () => {
      if (timer) clearTimeout(timer);
      if (visible) timer = setTimeout(poll, 15000);
    };
    const onVisibility = () => {
      visible = !document.hidden;
      if (visible) { loadNotifications(); schedule(); }
      else { clearTimeout(timer); timer = null; }
    };
    const onStatusUpdate = (e) => {
      const id = e.detail?.deliveryId;
      setNotifications(prev => prev.filter(n => !id || String(n.deliveryId) !== String(id)));
      loadNotifications();
    };
    loadNotifications();
    schedule();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('deliveryStatusUpdated', onStatusUpdate);
    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('deliveryStatusUpdated', onStatusUpdate);
    };
  }, [loggedIn]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Navbar stats polling — every 60 s */
  useEffect(() => {
    if (!loggedIn) return;
    const fetchStats = async () => {
      try {
        const { data } = await api.get('/ai/navbar-stats');
        setNavStats(data);
      } catch {}
    };
    fetchStats();
    const iv = setInterval(fetchStats, 60000);
    return () => clearInterval(iv);
  }, [loggedIn]);

  /* ──────────────────── Helpers ──────────────────── */
  const playSound = () => {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const ctx  = new Ctx();
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine'; osc.frequency.value = 880; gain.gain.value = 0.06;
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(); osc.stop(ctx.currentTime + 0.18);
      osc.onended = () => ctx.close();
    } catch {}
  };

  const loadNotifications = async () => {
    try {
      const cu       = getCurrentUser();
      const userRole = cu?.account?.role || cu?.role || 'driver';
      let unreadCount = 0, deliveryNotifs = [], msgNotifs = [];

      if (userRole === 'driver') {
        try {
          const r = await api.get('/messages/driver/notifications/count');
          const c = Number(r.data?.count) || 0;
          unreadCount = c;
          if (c > 0) msgNotifs = [{ id: 'messages-driver-admin', type: 'message', count: c, senderId: 'admin', senderRole: 'admin', title: `${c} unread message${c !== 1 ? 's' : ''} from Admin`, message: 'Open Messages tab to read', timestamp: new Date(), read: false }];
        } catch {}
      } else {
        try {
          const r = await api.get('/messages/unread');
          const entries = Object.entries(r.data || {}).map(([id, c]) => [id, Number(c)||0]).filter(([,c]) => c > 0);
          unreadCount = entries.reduce((s,[,c]) => s+c, 0);
          if (entries.length) {
            let lookup = new Map();
            const age = Date.now() - contactsCacheRef.current.fetchedAt;
            if (contactsCacheRef.current.data && age < 5*60*1000) {
              lookup = contactsCacheRef.current.data;
            } else {
              try {
                const ur = await api.get('/messages/contacts');
                (ur.data?.contacts||[]).forEach(u => { if (u?.id != null) lookup.set(String(u.id), u); });
                contactsCacheRef.current = { data: lookup, fetchedAt: Date.now() };
              } catch {}
            }
            msgNotifs = entries.map(([sid, c]) => {
              const s = lookup.get(String(sid));
              const name = s?.fullName || s?.full_name || s?.username || `User ${String(sid).slice(0,6)}`;
              return { id: `messages-${sid}`, type: 'message', count: c, senderId: sid, senderRole: s?.account?.role||'user', title: `${c} unread message${c!==1?'s':''} from ${name}`, message: `Open chat with ${name}`, timestamp: new Date(), read: false };
            });
          }
        } catch {}
      }

      if (userRole === 'admin') {
        try {
          const [ar, or, ur] = await Promise.allSettled([
            api.get('/admin/notifications/alerts'),
            api.get('/admin/notifications/overdue-deliveries'),
            api.get('/admin/notifications/unconfirmed-deliveries'),
          ]);
          const alerts      = ar.status==='fulfilled' ? ar.value.data?.notifications||[]  : [];
          const overdue     = or.status==='fulfilled' ? or.value.data?.deliveries||[]     : [];
          const unconfirmed = ur.status==='fulfilled' ? ur.value.data?.deliveries||[]     : [];
          deliveryNotifs = [
            ...alerts.map(n    => ({ id:`alert-${n.id}`,           type:'delivery', status:n.type,           title:n.title,                                              message:n.message,                 timestamp:n.createdAt,           read:false, _adminAlertId:n.id })),
            ...overdue.map(d   => ({ id:`overdue-${d.id}`,         type:'delivery', status:'overdue',         title:`Overdue (${d.hoursOverdue}h): ${d.customer||'?'}`,   message:`${d.address||''} — ${d.status}`, timestamp:d.createdAt, read:false, deliveryId:d.id })),
            ...unconfirmed.map(d=>({ id:`sms-unconfirmed-${d.id}`, type:'delivery', status:'sms_unconfirmed', title:`SMS Unconfirmed (>24h): ${d.customer||'?'}`,         message:d.address||'',             timestamp:d.smsSentAt||d.createdAt, read:false })),
          ];
        } catch {}
      }

      let playBell = false, newDelCount = 0;
      if (deliveryNotifs.length) {
        const newIds = new Set(deliveryNotifs.map(n=>n.id));
        if (hasLoadedRef.current) deliveryNotifs.forEach(n => { if (!prevDeliveryIdsRef.current.has(n.id)) newDelCount++; });
        prevDeliveryIdsRef.current = newIds;
      }
      if (hasLoadedRef.current) {
        const delta = unreadCount - prevMsgUnreadRef.current;
        if (delta > 0) {
          if ((userRole==='admin'||userRole==='delivery_team') && msgNotifs.length) {
            const prev = prevMsgNotificationsRef.current;
            msgNotifs.filter(n => { const p=prev.find(x=>x.id===n.id); return !p||(n.count>(p.count||0)); })
              .forEach(n => addToast(`Message from ${n.title.match(/from (.+)$/)?.[1]||'someone'}`, 'message', `${n.count} unread message${n.count!==1?'s':''}`, 'Click notification bell', 7000));
          } else if (userRole==='driver') {
            addToast('New Message from Admin','message',`${delta} new message${delta!==1?'s':''}`, 'Check Messages tab', 7000);
          }
          playBell = true;
        }
        if (newDelCount > 0) {
          addToast('Delivery Status Update','delivery',`${newDelCount} delivery update${newDelCount!==1?'s':''}`, 'Click notification bell', 7000);
          playBell = true;
        }
      }
      prevMsgNotificationsRef.current = msgNotifs;
      prevMsgUnreadRef.current = unreadCount;
      if (!hasLoadedRef.current) hasLoadedRef.current = true;
      if (playBell) playSound();

      setNotifications(prev => {
        const map  = new Map(prev.map(i => [i.id, i]));
        const next = [];
        msgNotifs.forEach(n => next.push({ ...n, read: map.get(n.id)?.read ?? false }));
        const newDelIds = new Set();
        if ((userRole==='admin'||userRole==='delivery_team') && deliveryNotifs.length) {
          deliveryNotifs.forEach(n => { newDelIds.add(n.id); next.push({ ...n, read: map.get(n.id)?.read ?? false }); });
        }
        prev.forEach(i => { if (i.type==='delivery' && !newDelIds.has(i.id)) next.push(i); });
        return next.sort((a,b) => new Date(b.timestamp)-new Date(a.timestamp)).slice(0, 50);
      });
    } catch {}
  };

  const markRead = async (n) => {
    if (!n || n.type==='message') return;
    if (n._adminAlertId) await api.put(`/admin/notifications/alerts/${n._adminAlertId}/read`).catch(()=>{});
    setNotifications(prev => prev.map(x => x.id===n.id ? {...x, read:true} : x));
  };

  const handleNotifClick = (n) => {
    if (!n) return;
    const role = getCurrentUser()?.account?.role || getCurrentUser()?.role || 'driver';
    setShowNotifications(false);
    if (n.type==='message') {
      if (role==='admin') navigate(`/admin/operations?tab=communication${n.senderId?`&userId=${n.senderId}`:''}`);
      else if (role==='delivery_team') navigate(`/delivery-team?tab=communication${n.senderId?`&contact=${n.senderId}`:''}`);
      else navigate('/driver?tab=messages');
      return;
    }
    if (n.type==='delivery' && (role==='admin'||role==='delivery_team')) {
      const q = n.deliveryId ? `&delivery=${n.deliveryId}` : '';
      if (role==='delivery_team') navigate(`/delivery-team?tab=control${q}`);
      else navigate(`/admin?tab=deliveries${q}&viewAll=1`);
      markRead(n);
    }
  };

  /* ── AI Search ── */
  const handleSearch = useCallback(async (e) => {
    if (e?.preventDefault) e.preventDefault();
    const q = searchQuery.trim();
    if (!q) return;
    setSearchLoading(true);
    setShowSearch(true);
    try {
      const { data } = await api.post('/ai/search', { query: q });
      setSearchResults(data);
    } catch {
      setSearchResults({ answer: 'Search failed. Please try again.', results: [], drivers: [] });
    } finally {
      setSearchLoading(false);
    }
  }, [searchQuery]);

  const triggerSuggestion = useCallback(async (text) => {
    setSearchQuery(text);
    setSearchLoading(true);
    setShowSearch(true);
    try {
      const { data } = await api.post('/ai/search', { query: text });
      setSearchResults(data);
    } catch {
      setSearchResults({ answer: 'Search failed. Please try again.', results: [], drivers: [] });
    } finally {
      setSearchLoading(false);
    }
  }, []);

  const handleResultClick = useCallback((result, type) => {
    setShowSearch(false);
    setSearchQuery('');
    setSearchResults(null);
    const role = user?.role || user?.account?.role || 'driver';
    if (type === 'delivery') {
      if (role === 'admin') navigate(`/admin?tab=deliveries&delivery=${result.id}&viewAll=1`);
      else if (role === 'delivery_team') navigate(`/delivery-team?tab=control&delivery=${result.id}`);
      else navigate(`/driver?tab=deliveries`);
    } else if (type === 'driver') {
      navigate('/admin/users');
    }
  }, [user, navigate]);

  const clearSearch = () => {
    setSearchQuery('');
    setSearchResults(null);
    setShowSearch(false);
  };

  /* ── Profile helpers ── */
  const compressImage = (dataUrl, maxSize=400, quality=0.8) => new Promise(res => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let { width, height } = img;
      if (width>maxSize||height>maxSize) {
        if (width>height) { height=Math.round(height*maxSize/width); width=maxSize; }
        else              { width=Math.round(width*maxSize/height);  height=maxSize; }
      }
      canvas.width=width; canvas.height=height;
      canvas.getContext('2d').drawImage(img,0,0,width,height);
      try { res(canvas.toDataURL('image/jpeg', quality)); } catch { res(dataUrl); }
    };
    img.onerror = () => res(dataUrl);
    img.src = dataUrl;
  });

  const handlePicChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = async () => {
      const compressed = await compressImage(reader.result);
      setProfileData(p => ({ ...p, profilePicture: file, profilePicturePreview: compressed }));
    };
    reader.readAsDataURL(file);
  };

  const handleSaveProfile = async () => {
    try {
      const payload = {
        fullName: profileData.fullName?.trim() || user?.full_name || '',
        email:    profileData.email?.trim()    || null,
        phone:    profileData.phone?.trim()    || null,
      };
      if (profileData.profilePicturePreview) payload.profilePicture = profileData.profilePicturePreview;
      const { data } = await api.patch('/auth/profile', payload);
      const u2 = { ...user, ...(data?.user||{}), full_name: data?.user?.full_name ?? profileData.fullName, fullName: data?.user?.fullName ?? profileData.fullName, email: data?.user?.email ?? profileData.email, phone: data?.user?.phone ?? profileData.phone, profile_picture: data?.user?.profile_picture ?? profileData.profilePicturePreview, profilePicture: data?.user?.profilePicture ?? profileData.profilePicturePreview };
      localStorage.setItem('client_user', JSON.stringify(u2));
      setUser(u2);
      setShowProfileModal(false);
      alert('Profile updated successfully!');
    } catch (err) {
      alert(err.response?.data?.message || err.message || 'Failed to update profile');
    }
  };

  const handleChangePassword = async () => {
    setPasswordError(''); setPasswordSuccess(false);
    if (!passwordData.currentPassword || !passwordData.newPassword || !passwordData.confirmPassword) { setPasswordError('All fields are required'); return; }
    if (passwordData.newPassword !== passwordData.confirmPassword) { setPasswordError('Passwords do not match'); return; }
    if (passwordData.newPassword.length < 8) { setPasswordError('Min 8 characters required'); return; }
    try {
      await api.post('/auth/change-password', { currentPassword: passwordData.currentPassword, newPassword: passwordData.newPassword });
      setPasswordSuccess(true);
      setPasswordData({ currentPassword:'', newPassword:'', confirmPassword:'' });
      setTimeout(() => { setShowChangePassword(false); setShowProfileModal(false); handleLogout(); }, 2000);
    } catch (err) {
      const msg = err?.response?.data?.error || err?.response?.data?.message || 'Failed to change password';
      setPasswordError(msg === 'invalid_current_password' ? 'Current password is incorrect' : msg);
    }
  };

  const handleLogout = async () => {
    try { await api.post('/auth/logout').catch(()=>{}); } catch {}
    clearAuth(); setLoggedIn(false); setUser(null); setShowDropdown(false); navigate('/login');
  };

  const getInitials = () => {
    const name  = user?.full_name || user?.fullName || user?.username || '';
    const parts = name.split(' ').filter(Boolean);
    return parts.length >= 2 ? (parts[0][0]+parts[1][0]).toUpperCase() : (name[0]||'U').toUpperCase();
  };
  const displayName = () => user?.full_name || user?.fullName || user?.username || 'User';
  const userEmail   = () => user?.email || '';
  const userRole    = () => { const r = user?.role||''; return r.charAt(0).toUpperCase()+r.slice(1); };
  const avatarSrc   = () => profileData.profilePicturePreview || user?.profile_picture || user?.profilePicture || null;

  const unreadCount = notifications.reduce((t, n) => {
    if (n.read) return t;
    return n.type==='message' ? t+(Number(n.count)||0) : t+1;
  }, 0);

  const isNavActive = (path, exact) => exact ? location.pathname === path : location.pathname.startsWith(path);

  const [isMobileViewport, setIsMobileViewport] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.innerWidth <= 640;
  });

  useEffect(() => {
    const handleResize = () => {
      if (typeof window === 'undefined') return;
      setIsMobileViewport(window.innerWidth <= 640);
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  /* Smooth theme toggle */
  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    const applyTheme = () => {
      document.documentElement.classList.remove('light', 'dark');
      document.documentElement.classList.add(next);
      document.documentElement.style.removeProperty('background-color');
      localStorage.setItem('theme', next);
      setTheme(next);
    };
    if (typeof document.startViewTransition === 'function') {
      document.startViewTransition(applyTheme);
    } else {
      document.documentElement.classList.add('theme-changing');
      applyTheme();
      setTimeout(() => document.documentElement.classList.remove('theme-changing'), 500);
    }
  };

  /* ──────────────────── Colour tokens (computed from theme) ──────────────────── */
  const MUTED   = theme === 'dark' ? '#9CA3C4' : '#6b7280';
  const PRIMARY = theme === 'dark' ? '#E8EAF6' : '#1A1D3B';

  /* ──────────────────── Reusable icon-button style ──────────────────── */
  const iconBtn  = { width:'34px', height:'34px', borderRadius:'8px', display:'flex', alignItems:'center', justifyContent:'center', background:'transparent', border:'none', cursor:'pointer', color:MUTED, transition:'background 0.15s, color 0.15s', flexShrink:0 };
  const onHover  = { background: theme==='dark' ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.05)', color: PRIMARY };
  const offHover = { background:'transparent', color: MUTED };

  /* ──────────────────── STATUS COLOUR helper ──────────────────── */
  const statusColor = (s='') => {
    const st = s.toLowerCase();
    if (st==='delivered')        return { bg:'rgba(34,197,94,0.12)',    color:'#22c55e' };
    if (st==='out-for-delivery') return { bg:'rgba(59,130,246,0.12)',   color:'#3b82f6' };
    if (st==='pending')          return { bg:'rgba(249,115,22,0.12)',   color:'#f97316' };
    if (st==='cancelled')        return { bg:'rgba(239,68,68,0.10)',    color:'#ef4444' };
    return { bg:'rgba(156,163,196,0.12)', color:MUTED };
  };

  /* ──────────────────── AI Search Bar ──────────────────── */
  const AISearchBar = ({ flex = '1 1 280px', maxWidth = '420px' }) => (
    <div
      ref={searchRef}
      style={{ position:'relative', flex, maxWidth, minWidth:'140px' }}
    >
      <form onSubmit={handleSearch}>
        <div style={{
          display:'flex', alignItems:'center', gap:'7px',
          background: theme==='dark' ? 'var(--surface2)' : '#f0f1f8',
          border:`1px solid ${showSearch||searchQuery ? 'var(--primary)' : 'var(--border)'}`,
          borderRadius:'999px', padding:'6px 11px 6px 10px',
          transition:'border-color 0.2s, box-shadow 0.2s',
          boxShadow: showSearch||searchQuery ? '0 0 0 3px var(--primary-glow)' : 'none',
        }}>
          {searchLoading
            ? <div style={{ width:'14px', height:'14px', border:'2px solid var(--border)', borderTopColor:'var(--primary)', borderRadius:'50%', animation:'spin 0.7s linear infinite', flexShrink:0 }} />
            : <Search size={13} style={{ color:MUTED, flexShrink:0 }} />
          }
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            onFocus={() => setShowSearch(true)}
            placeholder="AI Search… ⌘K"
            style={{ flex:1, background:'transparent', border:'none', outline:'none', fontSize:'13px', color:'var(--text)', minWidth:0 }}
          />
          {searchQuery
            ? <button type="button" onClick={clearSearch}
                style={{ background:'transparent', border:'none', cursor:'pointer', color:MUTED, padding:0, display:'flex' }}>
                <X size={13} />
              </button>
            : <span style={{ fontSize:'10px', color:MUTED, background:'var(--surface)', border:'1px solid var(--border)', padding:'1px 5px', borderRadius:'4px', flexShrink:0, whiteSpace:'nowrap', display:'flex', alignItems:'center', gap:'2px' }}>
                <Sparkles size={8} /> AI
              </span>
          }
        </div>
      </form>

      {/* ── Results Panel ── */}
      {showSearch && (
        <div style={{
          position:'absolute', top:'calc(100% + 10px)', left:'50%', transform:'translateX(-50%)',
          width:'min(540px, 95vw)',
          background:'var(--surface)', border:'1px solid var(--border)',
          borderRadius:'16px', boxShadow:'var(--shadow3)',
          overflow:'hidden', zIndex:9999,
          animation:'ai-panel-in 0.18s cubic-bezier(0.34,1.56,0.64,1)',
        }}>

          {/* Loading */}
          {searchLoading && (
            <div style={{ padding:'28px', textAlign:'center', color:MUTED }}>
              <div style={{ width:'22px', height:'22px', border:'2px solid var(--border)', borderTopColor:'var(--primary)', borderRadius:'50%', animation:'spin 0.7s linear infinite', margin:'0 auto 10px' }} />
              <p style={{ fontSize:'13px' }}>Analysing with AI…</p>
            </div>
          )}

          {/* Results */}
          {!searchLoading && searchResults && (
            <>
              {/* AI Answer */}
              <div style={{ padding:'14px 16px', background: theme==='dark' ? 'linear-gradient(135deg, rgba(78,136,185,0.12) 0%, transparent 100%)' : 'linear-gradient(135deg, rgba(1,30,65,0.05) 0%, transparent 100%)', borderBottom:'1px solid var(--border)' }}>
                <div style={{ display:'flex', alignItems:'center', gap:'8px', marginBottom:'7px' }}>
                  <div style={{ width:'24px', height:'24px', borderRadius:'7px', background:'var(--primary)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                    <Sparkles size={13} color="white" />
                  </div>
                  <span style={{ fontSize:'11px', fontWeight:700, color:'var(--primary)', textTransform:'uppercase', letterSpacing:'0.06em' }}>AI Insight</span>
                </div>
                <p style={{ fontSize:'13px', color:'var(--text)', lineHeight:1.55 }}>{searchResults.answer}</p>
              </div>

              {/* Delivery results */}
              {searchResults.results?.length > 0 && (
                <div style={{ maxHeight:'220px', overflowY:'auto' }}>
                  <div style={{ padding:'9px 16px 4px', fontSize:'11px', fontWeight:700, color:MUTED, textTransform:'uppercase', letterSpacing:'0.05em', display:'flex', alignItems:'center', gap:'6px' }}>
                    <Package size={11} /> Deliveries ({searchResults.totalCount ?? searchResults.results.length})
                  </div>
                  {searchResults.results.map(d => {
                    const sc = statusColor(d.status);
                    return (
                      <div key={d.id}
                        onClick={() => handleResultClick(d, 'delivery')}
                        style={{ padding:'10px 16px', cursor:'pointer', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', gap:'12px', transition:'background 0.1s' }}
                        onMouseEnter={e => e.currentTarget.style.background='var(--surface2)'}
                        onMouseLeave={e => e.currentTarget.style.background='transparent'}
                      >
                        <div style={{ flex:1, minWidth:0 }}>
                          <p style={{ fontSize:'13px', fontWeight:600, color:'var(--text)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{d.customer || 'Unknown'}</p>
                          <p style={{ fontSize:'11px', color:MUTED, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', marginTop:'2px' }}>{d.address || 'No address'}</p>
                        </div>
                        <span style={{ fontSize:'10px', fontWeight:700, padding:'2px 8px', borderRadius:'999px', background:sc.bg, color:sc.color, whiteSpace:'nowrap', textTransform:'capitalize', flexShrink:0 }}>
                          {d.status}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Driver results (admin only) */}
              {searchResults.drivers?.length > 0 && (
                <div style={{ maxHeight:'160px', overflowY:'auto' }}>
                  <div style={{ padding:'9px 16px 4px', fontSize:'11px', fontWeight:700, color:MUTED, textTransform:'uppercase', letterSpacing:'0.05em', display:'flex', alignItems:'center', gap:'6px' }}>
                    <Users size={11} /> Drivers ({searchResults.drivers.length})
                  </div>
                  {searchResults.drivers.map(d => (
                    <div key={d.id}
                      onClick={() => handleResultClick(d, 'driver')}
                      style={{ padding:'10px 16px', cursor:'pointer', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', gap:'12px', transition:'background 0.1s' }}
                      onMouseEnter={e => e.currentTarget.style.background='var(--surface2)'}
                      onMouseLeave={e => e.currentTarget.style.background='transparent'}
                    >
                      <div style={{ width:'32px', height:'32px', borderRadius:'50%', background:'var(--primary)', display:'flex', alignItems:'center', justifyContent:'center', color:'white', fontSize:'12px', fontWeight:700, flexShrink:0 }}>
                        {(d.fullName || d.username || 'D')[0].toUpperCase()}
                      </div>
                      <div style={{ flex:1, minWidth:0 }}>
                        <p style={{ fontSize:'13px', fontWeight:600, color:'var(--text)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{d.fullName || d.username}</p>
                        <p style={{ fontSize:'11px', color:MUTED, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{d.email || d.phone || ''}</p>
                      </div>
                      <span style={{ fontSize:'10px', fontWeight:700, padding:'2px 7px', borderRadius:'999px', background: d.active ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.1)', color: d.active ? '#22c55e' : '#ef4444', flexShrink:0 }}>
                        {d.active ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {(!searchResults.results?.length && !searchResults.drivers?.length) && (
                <div style={{ padding:'28px', textAlign:'center', color:MUTED }}>
                  <Search size={28} style={{ margin:'0 auto 8px', opacity:0.3 }} />
                  <p style={{ fontSize:'13px' }}>No records found for "{searchQuery}"</p>
                </div>
              )}
            </>
          )}

          {/* Empty state / suggestions */}
          {!searchLoading && !searchResults && (
            <div style={{ padding:'14px' }}>
              <p style={{ fontSize:'11px', fontWeight:700, color:MUTED, textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:'8px', padding:'0 4px' }}>Try asking…</p>
              {SEARCH_SUGGESTIONS.map(s => (
                <button key={s}
                  onClick={() => triggerSuggestion(s)}
                  style={{ display:'flex', alignItems:'center', gap:'8px', width:'100%', textAlign:'left', padding:'8px 12px', borderRadius:'8px', background:'transparent', border:'none', cursor:'pointer', fontSize:'13px', color:'var(--text2)', marginBottom:'2px' }}
                  onMouseEnter={e => e.currentTarget.style.background='var(--surface2)'}
                  onMouseLeave={e => e.currentTarget.style.background='transparent'}
                >
                  <Zap size={12} style={{ color:MUTED, flexShrink:0 }} />
                  {s}
                </button>
              ))}
            </div>
          )}

          {/* Footer */}
          <div style={{ padding:'8px 16px', borderTop:'1px solid var(--border)', background:'var(--surface2)', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
            <span style={{ fontSize:'10px', color:MUTED }}>↵ Enter to search · Esc to close</span>
            <span style={{ fontSize:'10px', color:MUTED, display:'flex', alignItems:'center', gap:'3px' }}>
              <Sparkles size={9} /> Powered by GPT-4o
            </span>
          </div>
        </div>
      )}
    </div>
  );

  /* ──────────────────── Live Stats Chips ──────────────────── */
  const NavStatsChips = () => {
    if (!navStats) return null;
    const role = navStats.role;

    if (role === 'admin') {
      return (
        <div className="hidden xl:flex items-center gap-1.5 mr-1 shrink-0">
          {navStats.pending > 0 && (
            <NavLink to="/deliveries" style={{ textDecoration:'none' }} title={`${navStats.pending} pending deliveries`}>
              <span style={{ display:'flex', alignItems:'center', gap:'4px', fontSize:'11px', fontWeight:600, padding:'3px 9px', borderRadius:'999px', background:'rgba(249,115,22,0.12)', color:'#f97316', border:'1px solid rgba(249,115,22,0.2)', cursor:'pointer', whiteSpace:'nowrap' }}>
                <Clock size={10} /> {navStats.pending} Pending
              </span>
            </NavLink>
          )}
          {navStats.inTransit > 0 && (
            <span style={{ display:'flex', alignItems:'center', gap:'4px', fontSize:'11px', fontWeight:600, padding:'3px 9px', borderRadius:'999px', background:'rgba(59,130,246,0.12)', color:'#3b82f6', border:'1px solid rgba(59,130,246,0.2)', whiteSpace:'nowrap' }}
              title={`${navStats.inTransit} deliveries out for delivery`}>
              <TruckIcon size={10} /> {navStats.inTransit} In Transit
            </span>
          )}
          {navStats.deliveredToday > 0 && (
            <span style={{ display:'flex', alignItems:'center', gap:'4px', fontSize:'11px', fontWeight:600, padding:'3px 9px', borderRadius:'999px', background:'rgba(34,197,94,0.12)', color:'#22c55e', border:'1px solid rgba(34,197,94,0.2)', whiteSpace:'nowrap' }}
              title={`${navStats.deliveredToday} delivered today`}>
              <CheckCircle2 size={10} /> {navStats.deliveredToday} Today
            </span>
          )}
          {navStats.activeDrivers > 0 && (
            <span style={{ display:'flex', alignItems:'center', gap:'4px', fontSize:'11px', fontWeight:600, padding:'3px 9px', borderRadius:'999px', background:'rgba(168,85,247,0.12)', color:'#a855f7', border:'1px solid rgba(168,85,247,0.2)', whiteSpace:'nowrap' }}
              title={`${navStats.activeDrivers} active drivers`}>
              <Users size={10} /> {navStats.activeDrivers} Drivers
            </span>
          )}
        </div>
      );
    }

    if (role === 'driver' || role === 'delivery_team') {
      return (
        <div className="hidden md:flex items-center gap-1.5 mr-1 shrink-0">
          {navStats.assigned > 0 && (
            <span style={{ display:'flex', alignItems:'center', gap:'4px', fontSize:'11px', fontWeight:600, padding:'3px 9px', borderRadius:'999px', background:'rgba(59,130,246,0.12)', color:'#3b82f6', border:'1px solid rgba(59,130,246,0.2)', whiteSpace:'nowrap' }}>
              <Package size={10} /> {navStats.assigned} Assigned
            </span>
          )}
          {navStats.deliveredToday > 0 && (
            <span style={{ display:'flex', alignItems:'center', gap:'4px', fontSize:'11px', fontWeight:600, padding:'3px 9px', borderRadius:'999px', background:'rgba(34,197,94,0.12)', color:'#22c55e', border:'1px solid rgba(34,197,94,0.2)', whiteSpace:'nowrap' }}>
              <CheckCircle2 size={10} /> {navStats.deliveredToday} Done
            </span>
          )}
        </div>
      );
    }

    return null;
  };

  /* ──────────────────── Notification panel ──────────────────── */
  const NotifPanel = () => {
    const isMobile = isMobileViewport;
    const baseStyle = isMobile
      ? { position:'fixed', left:'8px', right:'8px', top:'72px', maxHeight:'calc(100vh - 88px)', background:'var(--surface)', border:'1px solid var(--border)', borderRadius:'var(--radius-lg)', boxShadow:'var(--shadow3)', overflow:'hidden', zIndex:9999 }
      : { position:'absolute', right:'8px', top:'calc(100% + 8px)', width:'min(360px, calc(100vw - 24px))', maxWidth:'calc(100vw - 16px)', background:'var(--surface)', border:'1px solid var(--border)', borderRadius:'var(--radius-lg)', boxShadow:'var(--shadow3)', overflow:'hidden', zIndex:9999 };

    const containerStyle = {
      ...baseStyle,
      opacity: showNotifications ? 1 : 0,
      transform: showNotifications ? 'translateY(0) scale(1)' : 'translateY(-10px) scale(0.95)',
      transformOrigin: 'top right',
      pointerEvents: showNotifications ? 'auto' : 'none',
      transition: 'opacity 0.2s ease, transform 0.22s cubic-bezier(0.34,1.56,0.64,1)',
    };

    const listMaxHeight = isMobile ? 'calc(100vh - 88px - 48px)' : 'min(380px, calc(100vh - 96px))';

    return (
      <div style={containerStyle}>
        <div style={{ padding:'14px 16px', background:'var(--surface2)', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <span style={{ fontWeight:700, fontSize:'14px', color:'var(--text)' }}>Notifications</span>
          {unreadCount>0 && <span style={{ fontSize:'11px', fontWeight:600, padding:'2px 8px', borderRadius:'20px', background:'var(--primary-glow)', color:'var(--primary)' }}>{unreadCount} unread</span>}
        </div>
        <div style={{ maxHeight:listMaxHeight, overflowY:'auto' }}>
          {notifications.length===0 ? (
            <div style={{ padding:'40px', textAlign:'center', color:'var(--muted)' }}>
              <Bell size={32} style={{ margin:'0 auto 8px', opacity:0.3 }} />
              <p style={{ fontSize:'13px' }}>No notifications</p>
            </div>
          ) : notifications.map(n => (
            <div key={n.id} onClick={() => handleNotifClick(n)}
              style={{ padding:'12px 16px', borderBottom:'1px solid var(--border)', cursor:'pointer', background: !n.read ? 'rgba(1,30,65,0.05)' : 'transparent', transition:'background 0.15s' }}
              onMouseEnter={e=>e.currentTarget.style.background='var(--surface2)'}
              onMouseLeave={e=>e.currentTarget.style.background=!n.read?'rgba(1,30,65,0.05)':'transparent'}
            >
              <div style={{ display:'flex', gap:'10px', alignItems:'flex-start' }}>
                <div style={{ width:'7px', height:'7px', borderRadius:'50%', background: n.read?'transparent':'var(--primary)', flexShrink:0, marginTop:'5px' }} />
                <div style={{ flex:1, minWidth:0 }}>
                  <p style={{ fontSize:'13px', fontWeight:600, color:'var(--text)' }}>{n.title}</p>
                  <p style={{ fontSize:'12px', color:'var(--text2)', marginTop:'2px' }}>{n.message}</p>
                  <p style={{ fontSize:'11px', color:'var(--muted)', marginTop:'4px' }}>{new Date(n.timestamp).toLocaleString()}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  /* ──────────────────── User dropdown panel ──────────────────── */
  const UserPanel = () => (
    <div style={{
      position:'absolute', right:0, top:'calc(100% + 8px)', width:'240px',
      background:'var(--surface)', border:'1px solid var(--border)',
      borderRadius:'var(--radius-lg)', boxShadow:'var(--shadow3)', overflow:'hidden', zIndex:9999,
      opacity: showDropdown ? 1 : 0,
      transform: showDropdown ? 'translateY(0) scale(1)' : 'translateY(-8px) scale(0.95)',
      transformOrigin: 'top right',
      pointerEvents: showDropdown ? 'auto' : 'none',
      transition: 'opacity 0.18s ease, transform 0.22s cubic-bezier(0.34,1.56,0.64,1)',
    }}>
      <div style={{ padding:'16px', background:'var(--surface2)', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', gap:'12px' }}>
        <div style={{ width:'44px', height:'44px', borderRadius:'50%', background:'var(--primary)', display:'flex', alignItems:'center', justifyContent:'center', color:'white', fontWeight:700, fontSize:'14px', overflow:'hidden', flexShrink:0 }}>
          {avatarSrc() ? <img src={avatarSrc()} alt="" style={{ width:'100%', height:'100%', objectFit:'cover' }} /> : getInitials()}
        </div>
        <div style={{ flex:1, minWidth:0 }}>
          <p style={{ fontWeight:700, fontSize:'13px', color:'var(--text)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{displayName()}</p>
          {userEmail() && <p style={{ fontSize:'11px', color:'var(--muted)', marginTop:'2px', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{userEmail()}</p>}
          <span style={{ display:'inline-block', marginTop:'4px', fontSize:'10px', fontWeight:700, padding:'2px 7px', borderRadius:'999px', background:'var(--primary-glow)', color:'var(--primary)', textTransform:'capitalize' }}>{userRole()}</span>
        </div>
      </div>
      <div style={{ padding:'6px' }}>
        <button onClick={() => { setShowProfileModal(true); setShowDropdown(false); }}
          style={{ width:'100%', display:'flex', alignItems:'center', gap:'10px', padding:'10px 12px', borderRadius:'var(--radius-sm)', fontSize:'13px', color:'var(--text2)', background:'transparent', border:'none', cursor:'pointer', textAlign:'left' }}
          onMouseEnter={e=>{e.currentTarget.style.background='var(--surface2)';e.currentTarget.style.color='var(--text)'}}
          onMouseLeave={e=>{e.currentTarget.style.background='transparent';e.currentTarget.style.color='var(--text2)'}}>
          <User size={15} /> Edit Profile
        </button>
        <div style={{ height:'1px', background:'var(--border)', margin:'4px 0' }} />
        <button onClick={handleLogout}
          style={{ width:'100%', display:'flex', alignItems:'center', gap:'10px', padding:'10px 12px', borderRadius:'var(--radius-sm)', fontSize:'13px', color:'#ef4444', background:'transparent', border:'none', cursor:'pointer', textAlign:'left' }}
          onMouseEnter={e=>e.currentTarget.style.background='rgba(239,68,68,0.07)'}
          onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
          <LogOut size={15} /> Sign Out
        </button>
      </div>
    </div>
  );

  /* ──────────────────── Mobile side drawer ──────────────────── */
  function MobileDrawer({ children }) {
    if (!mobileNavOpen) return null;
    return (
      <>
        <div className="fixed inset-0 md:hidden"
          style={{ background:'rgba(0,0,0,0.55)', zIndex:9997 }}
          onClick={() => setMobileNavOpen(false)}
        />
        <div className="fixed top-0 left-0 h-full md:hidden flex flex-col animate-slide-in-left"
          style={{ width:'min(78vw, 290px)', zIndex:9998, background:'var(--bg)', boxShadow:'4px 0 40px rgba(0,0,0,0.35)' }}
        >
          {/* Drawer header */}
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'14px 16px', borderBottom:'1px solid var(--border)' }}>
            <img src="/elect home.png" alt="Electrolux" style={{ height:'26px', objectFit:'contain', filter: theme==='dark' ? 'none' : 'brightness(0) saturate(100%)' }} />
            <button onClick={() => setMobileNavOpen(false)}
              style={{ width:'34px', height:'34px', borderRadius:'8px', display:'flex', alignItems:'center', justifyContent:'center', background:'transparent', border:'none', cursor:'pointer', color:MUTED }}>
              <X size={20} />
            </button>
          </div>

          {/* Mobile search */}
          <div style={{ padding:'12px 14px', borderBottom:'1px solid var(--border)' }}>
            <form onSubmit={(e) => { setMobileNavOpen(false); handleSearch(e); }}>
              <div style={{ display:'flex', alignItems:'center', gap:'8px', background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:'10px', padding:'8px 12px' }}>
                <Search size={14} style={{ color:MUTED, flexShrink:0 }} />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Search deliveries, drivers…"
                  style={{ flex:1, background:'transparent', border:'none', outline:'none', fontSize:'13px', color:'var(--text)' }}
                />
              </div>
            </form>
          </div>

          {/* Mobile stats */}
          {navStats && (
            <div style={{ padding:'10px 14px', borderBottom:'1px solid var(--border)', display:'flex', flexWrap:'wrap', gap:'6px' }}>
              {navStats.role === 'admin' && <>
                {navStats.pending > 0 && <span style={{ fontSize:'11px', fontWeight:600, padding:'3px 9px', borderRadius:'999px', background:'rgba(249,115,22,0.12)', color:'#f97316', border:'1px solid rgba(249,115,22,0.2)' }}>{navStats.pending} Pending</span>}
                {navStats.inTransit > 0 && <span style={{ fontSize:'11px', fontWeight:600, padding:'3px 9px', borderRadius:'999px', background:'rgba(59,130,246,0.12)', color:'#3b82f6', border:'1px solid rgba(59,130,246,0.2)' }}>{navStats.inTransit} In Transit</span>}
                {navStats.deliveredToday > 0 && <span style={{ fontSize:'11px', fontWeight:600, padding:'3px 9px', borderRadius:'999px', background:'rgba(34,197,94,0.12)', color:'#22c55e', border:'1px solid rgba(34,197,94,0.2)' }}>{navStats.deliveredToday} Done Today</span>}
              </>}
              {(navStats.role === 'driver' || navStats.role === 'delivery_team') && <>
                {navStats.assigned > 0 && <span style={{ fontSize:'11px', fontWeight:600, padding:'3px 9px', borderRadius:'999px', background:'rgba(59,130,246,0.12)', color:'#3b82f6', border:'1px solid rgba(59,130,246,0.2)' }}>{navStats.assigned} Assigned</span>}
                {navStats.deliveredToday > 0 && <span style={{ fontSize:'11px', fontWeight:600, padding:'3px 9px', borderRadius:'999px', background:'rgba(34,197,94,0.12)', color:'#22c55e', border:'1px solid rgba(34,197,94,0.2)' }}>{navStats.deliveredToday} Done</span>}
              </>}
            </div>
          )}

          {/* Nav links */}
          <nav style={{ flex:1, overflowY:'auto', padding:'10px' }}>
            {children}
          </nav>

          {/* User info + sign out */}
          <div style={{ padding:'14px 16px', borderTop:'1px solid var(--border)' }}>
            <div style={{ display:'flex', alignItems:'center', gap:'10px', marginBottom:'12px' }}>
              <div style={{ width:'38px', height:'38px', borderRadius:'50%', background:'var(--primary)', overflow:'hidden', flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center', color:'white', fontWeight:700, fontSize:'13px' }}>
                {avatarSrc() ? <img src={avatarSrc()} alt="" style={{ width:'100%', height:'100%', objectFit:'cover' }} /> : getInitials()}
              </div>
              <div style={{ flex:1, minWidth:0 }}>
                <p style={{ fontSize:'13px', fontWeight:600, color:'var(--text)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{displayName()}</p>
                <p style={{ fontSize:'11px', color:'var(--muted)', textTransform:'capitalize', marginTop:'2px' }}>{userRole()}</p>
              </div>
            </div>
            <button onClick={() => { setMobileNavOpen(false); setShowProfileModal(true); }}
              style={{ width:'100%', display:'flex', alignItems:'center', gap:'8px', padding:'9px 12px', borderRadius:'8px', background:'var(--surface2)', border:'none', cursor:'pointer', color:'var(--text2)', fontSize:'13px', fontWeight:500, marginBottom:'6px' }}>
              <User size={15} /> Edit Profile
            </button>
            <button onClick={() => { setMobileNavOpen(false); handleLogout(); }}
              style={{ width:'100%', display:'flex', alignItems:'center', gap:'8px', padding:'9px 12px', borderRadius:'8px', background:'rgba(239,68,68,0.1)', border:'none', cursor:'pointer', color:'#ef4444', fontSize:'13px', fontWeight:500 }}>
              <LogOut size={15} /> Sign Out
            </button>
          </div>
        </div>
      </>
    );
  }

  /* ──────────────────── Pill nav style ──────────────────── */
  const pillStyle = (active) => ({
    display:'inline-flex', alignItems:'center', gap:'5px',
    padding:'7px 14px', borderRadius:'999px', fontSize:'13px',
    fontWeight: active ? 600 : 500,
    color: active ? PRIMARY : MUTED,
    background: active ? (theme==='dark' ? 'var(--surface2)' : '#ffffff') : 'transparent',
    boxShadow: active ? 'var(--shadow1)' : 'none',
    textDecoration:'none', border:'none', cursor:'pointer',
    transition:'background 0.15s, color 0.15s, box-shadow 0.15s',
    whiteSpace:'nowrap', flexShrink:0,
  });

  /* ──────────────────── ADMIN HEADER ──────────────────── */
  if (isAdmin) {
    return (
      <>
        <header className="min-h-[64px] md:min-h-[76px] sticky top-0 z-[900] shrink-0"
          style={{ background:'var(--bg)', paddingTop:'env(safe-area-inset-top, 0px)' }}>
          <div className="header-inner">

            {/* Hamburger — mobile only */}
            <button className="flex md:hidden items-center justify-center shrink-0 mr-2"
              onClick={() => setMobileNavOpen(v => !v)}
              style={{ width:'34px', height:'34px', borderRadius:'8px', background:'transparent', border:'none', cursor:'pointer', color:MUTED }}
              aria-label="Open menu">
              <Menu size={20} />
            </button>

            {/* Logo */}
            <Link to="/admin" className="flex items-center shrink-0 mr-3 md:mr-4" style={{ textDecoration:'none' }}>
              <img src="/elect home.png" alt="Electrolux"
                className="h-8 w-auto md:h-[34px] object-contain block"
                style={{ filter: theme==='dark' ? 'none' : 'brightness(0) saturate(100%)' }} />
            </Link>

            {/* Nav pills + Search Bar (desktop) */}
            <nav className="nav-scroll h-full hidden md:flex" style={{ gap:'0', alignItems:'center', justifyContent:'flex-start' }}>
              {/* Pills */}
              <div style={{ display:'flex', alignItems:'center', gap:'2px', flexShrink:0 }}>
                {ADMIN_NAV.map(item => (
                  <NavLink key={item.path} to={item.path} end={item.exact}
                    style={({ isActive }) => pillStyle(isActive)}
                    onMouseEnter={e => { if (!isNavActive(item.path, item.exact)) Object.assign(e.currentTarget.style, onHover); }}
                    onMouseLeave={e => { if (!isNavActive(item.path, item.exact)) Object.assign(e.currentTarget.style, offHover); }}>
                    {item.label}
                  </NavLink>
                ))}
              </div>

              {/* Spacer */}
              <div style={{ flex:1, minWidth:'12px' }} />

              {/* AI Search Bar */}
              <AISearchBar flex="1 1 200px" maxWidth="360px" />

              {/* Spacer */}
              <div style={{ width:'8px', flexShrink:0 }} />
            </nav>

            {/* Right controls */}
            <div style={{ display:'flex', alignItems:'center', gap:'4px', flexShrink:0, marginLeft:'auto' }}>

              {/* Live stats chips (xl+) */}
              <NavStatsChips />

              {/* Separator */}
              <div className="hidden xl:block" style={{ width:'1px', height:'20px', background:'var(--border)', margin:'0 4px', flexShrink:0 }} />

              {/* Theme toggle */}
              <button onClick={toggleTheme} style={iconBtn}
                title={theme==='dark' ? 'Light mode' : 'Dark mode'}
                onMouseEnter={e => Object.assign(e.currentTarget.style, onHover)}
                onMouseLeave={e => Object.assign(e.currentTarget.style, offHover)}>
                {theme==='dark' ? <Sun size={17} /> : <Moon size={17} />}
              </button>

              {/* Bell */}
              <div style={{ position:'relative' }} ref={notifRef}>
                <button onClick={() => setShowNotifications(v => !v)}
                  style={{ ...iconBtn, position:'relative' }}
                  onMouseEnter={e => Object.assign(e.currentTarget.style, onHover)}
                  onMouseLeave={e => Object.assign(e.currentTarget.style, offHover)}>
                  <Bell size={17} />
                  {unreadCount > 0 && (
                    <span style={{ position:'absolute', top:'4px', right:'4px', minWidth:'15px', height:'15px', background:'#ef4444', borderRadius:'8px', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'9px', fontWeight:700, color:'white', padding:'0 2px' }}>
                      {unreadCount > 9 ? '9+' : unreadCount}
                    </span>
                  )}
                </button>
                {NotifPanel()}
              </div>

              {/* User pill */}
              <div style={{ position:'relative', marginLeft:'4px' }} ref={dropdownRef}>
                <button onClick={() => setShowDropdown(v => !v)} style={{
                  display:'flex', alignItems:'center', gap:'9px',
                  padding:'5px 12px 5px 5px', borderRadius:'999px',
                  background: theme==='dark' ? 'var(--surface2)' : '#ffffff',
                  border:'1px solid var(--border)', boxShadow:'var(--shadow1)', cursor:'pointer',
                }}>
                  <div style={{ width:'30px', height:'30px', borderRadius:'50%', background:'var(--primary)', overflow:'hidden', flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center', color:'white', fontWeight:700, fontSize:'12px' }}>
                    {avatarSrc() ? <img src={avatarSrc()} alt="" style={{ width:'100%', height:'100%', objectFit:'cover' }} /> : getInitials()}
                  </div>
                  <div className="hidden sm:block" style={{ textAlign:'left', lineHeight:1 }}>
                    <p style={{ fontSize:'13px', fontWeight:600, color:PRIMARY }}>{displayName()}</p>
                    <p style={{ fontSize:'11px', color:MUTED, marginTop:'3px', textTransform:'capitalize' }}>{userRole()}</p>
                  </div>
                  <ChevronDown size={13} style={{ color:MUTED, transform: showDropdown ? 'rotate(180deg)' : 'none', transition:'transform 0.2s' }} />
                </button>
                {UserPanel()}
              </div>
            </div>
          </div>
        </header>

        {/* Mobile drawer */}
        <MobileDrawer>
          {ADMIN_NAV.map(item => (
            <NavLink key={item.path} to={item.path} end={item.exact}
              onClick={() => setMobileNavOpen(false)}
              style={({ isActive }) => ({
                display:'flex', alignItems:'center', padding:'11px 14px',
                borderRadius:'10px', fontSize:'14px', fontWeight: isActive ? 600 : 400,
                color: isActive ? 'var(--primary)' : 'var(--text2)',
                background: isActive ? 'var(--primary-glow)' : 'transparent',
                textDecoration:'none', marginBottom:'2px',
              })}>
              {item.label}
            </NavLink>
          ))}
        </MobileDrawer>

        <ToastContainer toasts={toasts} onRemove={removeToast} />
        <ProfileModal />
      </>
    );
  }


  /* ──────────────────── NON-ADMIN HEADER (Driver / Delivery Team) ──────────────────── */
  const logoTo = user?.role === 'delivery_team' ? '/delivery-team' : '/driver';

  return (
    <>
      <header className="min-h-[64px] md:min-h-[76px] sticky top-0 z-[900] shrink-0"
        style={{ background:'var(--bg)', paddingTop:'env(safe-area-inset-top, 0px)' }}>
        <div className="header-inner">

          {/* Hamburger — mobile */}
          <button className="flex md:hidden items-center justify-center shrink-0 mr-2"
            onClick={() => setMobileNavOpen(v => !v)}
            style={{ width:'34px', height:'34px', borderRadius:'8px', background:'transparent', border:'none', cursor:'pointer', color:MUTED }}
            aria-label="Open menu">
            <Menu size={20} />
          </button>

          {/* Logo */}
          <Link to={logoTo} className="flex items-center shrink-0 mr-3 md:mr-4" style={{ textDecoration:'none' }}>
            <img src="/elect home.png" alt="Electrolux"
              className="h-8 w-auto md:h-[34px] object-contain block"
              style={{ filter: theme==='dark' ? 'none' : 'brightness(0) saturate(100%)' }} />
          </Link>

          {/* Search bar — fills centre space on desktop */}
          <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', minWidth:0, padding:'0 12px' }}>
            <div className="hidden md:flex" style={{ width:'100%', maxWidth:'420px' }}>
              <AISearchBar flex="1 1 auto" maxWidth="100%" />
            </div>
          </div>

          {/* Right controls */}
          <div style={{ display:'flex', alignItems:'center', gap:'4px', flexShrink:0 }}>

            {/* Live stats chips */}
            <NavStatsChips />

            {/* Separator */}
            <div className="hidden md:block" style={{ width:'1px', height:'20px', background:'var(--border)', margin:'0 4px', flexShrink:0 }} />

            {/* Theme */}
            <button onClick={toggleTheme} style={iconBtn}
              title={theme==='dark' ? 'Light mode' : 'Dark mode'}
              onMouseEnter={e => Object.assign(e.currentTarget.style, onHover)}
              onMouseLeave={e => Object.assign(e.currentTarget.style, offHover)}>
              {theme==='dark' ? <Sun size={17} /> : <Moon size={17} />}
            </button>

            {/* Bell */}
            <div style={{ position:'relative' }} ref={notifRef}>
              <button onClick={() => setShowNotifications(v => !v)}
                style={{ ...iconBtn, position:'relative' }}
                onMouseEnter={e => Object.assign(e.currentTarget.style, onHover)}
                onMouseLeave={e => Object.assign(e.currentTarget.style, offHover)}>
                <Bell size={17} />
                {unreadCount > 0 && (
                  <span style={{ position:'absolute', top:'4px', right:'4px', minWidth:'15px', height:'15px', background:'#ef4444', borderRadius:'8px', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'9px', fontWeight:700, color:'white', padding:'0 2px' }}>
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </button>
              {NotifPanel()}
            </div>

            {/* User pill */}
            {loggedIn && user ? (
              <div style={{ position:'relative', marginLeft:'4px' }} ref={dropdownRef}>
                <button onClick={() => setShowDropdown(v => !v)} style={{
                  display:'flex', alignItems:'center', gap:'9px',
                  padding:'5px 12px 5px 5px', borderRadius:'999px',
                  background: theme==='dark' ? 'var(--surface2)' : '#ffffff',
                  border:'1px solid var(--border)', boxShadow:'var(--shadow1)', cursor:'pointer',
                }}>
                  <div style={{ width:'30px', height:'30px', borderRadius:'50%', background:'var(--primary)', overflow:'hidden', flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center', color:'white', fontWeight:700, fontSize:'12px' }}>
                    {avatarSrc() ? <img src={avatarSrc()} alt="" style={{ width:'100%', height:'100%', objectFit:'cover' }} /> : getInitials()}
                  </div>
                  <div className="hidden sm:block" style={{ textAlign:'left', lineHeight:1 }}>
                    <p style={{ fontSize:'13px', fontWeight:600, color:PRIMARY }}>{displayName()}</p>
                    <p style={{ fontSize:'11px', color:MUTED, marginTop:'3px', textTransform:'capitalize' }}>{userRole()}</p>
                  </div>
                  <ChevronDown size={13} style={{ color:MUTED, transform: showDropdown ? 'rotate(180deg)' : 'none', transition:'transform 0.2s' }} />
                </button>
                {UserPanel()}
              </div>
            ) : (
              <Link to="/login" className="pp-btn-primary" style={{ textDecoration:'none' }}>Sign In</Link>
            )}
          </div>
        </div>
      </header>

      {/* Mobile drawer — non-admin */}
      <MobileDrawer>
        <div style={{ padding:'4px 14px 12px', fontSize:'12px', color:'var(--muted)' }}>
          Use the tabs inside your portal to navigate.
        </div>
      </MobileDrawer>

      <ToastContainer toasts={toasts} onRemove={removeToast} />
      <ProfileModal />
    </>
  );

  /* ──────────────────── Profile Modal ──────────────────── */
  function ProfileModal() {
    if (!showProfileModal) return null;
    return (
      <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.6)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000, padding:'16px' }}>
        <div style={{ background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:'16px', boxShadow:'0 24px 60px rgba(0,0,0,0.5)', width:'100%', maxWidth:'440px', maxHeight:'90vh', overflowY:'auto' }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'20px 24px', borderBottom:'1px solid var(--border)', position:'sticky', top:0, background:'var(--bg-card)' }}>
            <h2 style={{ fontSize:'18px', fontWeight:700, color:'var(--text-primary)' }}>Edit Profile</h2>
            <button onClick={() => setShowProfileModal(false)} style={{ background:'transparent', border:'none', cursor:'pointer', color:'var(--text-muted)', padding:'4px' }}>
              <X size={20} />
            </button>
          </div>
          <div style={{ padding:'24px', display:'flex', flexDirection:'column', gap:'20px' }}>
            {/* Avatar */}
            <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:'8px' }}>
              <div style={{ position:'relative' }}>
                <div style={{ width:'80px', height:'80px', borderRadius:'50%', background:'var(--accent)', display:'flex', alignItems:'center', justifyContent:'center', color:'white', fontWeight:700, fontSize:'24px', overflow:'hidden', border:'3px solid var(--bg-hover)' }}>
                  {avatarSrc() ? <img src={avatarSrc()} alt="" style={{ width:'100%', height:'100%', objectFit:'cover' }} /> : getInitials()}
                </div>
                <label style={{ position:'absolute', bottom:0, right:0, width:'26px', height:'26px', background:'var(--accent)', borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer' }}>
                  <Camera size={13} color="white" />
                  <input type="file" accept="image/*" onChange={handlePicChange} style={{ display:'none' }} />
                </label>
              </div>
              <p style={{ fontSize:'12px', color:'var(--text-muted)' }}>Click camera to change photo</p>
            </div>
            {[['Full Name','text',profileData.fullName,'fullName'],['Email','email',profileData.email,'email'],['Phone','tel',profileData.phone,'phone']].map(([label,type,val,key]) => (
              <div key={key}>
                <label style={{ display:'block', fontSize:'12px', fontWeight:600, color:'var(--text-secondary)', marginBottom:'6px' }}>{label}</label>
                <input type={type} value={val} onChange={e => setProfileData(p=>({...p,[key]:e.target.value}))}
                  style={{ width:'100%', padding:'10px 12px', background:'var(--bg-surface)', border:'1px solid var(--border)', borderRadius:'10px', fontSize:'14px', color:'var(--text-primary)', outline:'none' }}
                  onFocus={e=>e.target.style.borderColor='var(--accent)'}
                  onBlur={e=>e.target.style.borderColor='var(--border)'} />
              </div>
            ))}
            <div>
              <label style={{ display:'block', fontSize:'12px', fontWeight:600, color:'var(--text-secondary)', marginBottom:'6px' }}>Role</label>
              <input value={userRole()} disabled style={{ width:'100%', padding:'10px 12px', background:'var(--bg-hover)', border:'1px solid var(--border)', borderRadius:'10px', fontSize:'14px', color:'var(--text-muted)' }} />
            </div>
            <div style={{ borderTop:'1px solid var(--border)', paddingTop:'16px' }}>
              <button onClick={() => setShowChangePassword(v=>!v)}
                style={{ width:'100%', display:'flex', alignItems:'center', justifyContent:'space-between', padding:'10px 12px', background:'var(--bg-hover)', border:'1px solid var(--border)', borderRadius:'10px', cursor:'pointer', color:'var(--text-primary)', fontSize:'14px', fontWeight:500 }}>
                <span>Change Password</span> <Settings size={15} style={{ color:'var(--text-muted)' }} />
              </button>
              {showChangePassword && (
                <div style={{ marginTop:'12px', display:'flex', flexDirection:'column', gap:'12px' }}>
                  {passwordSuccess ? (
                    <div style={{ padding:'12px', background:'rgba(34,197,94,0.1)', border:'1px solid rgba(34,197,94,0.3)', borderRadius:'10px' }}>
                      <p style={{ color:'#22c55e', fontSize:'13px', fontWeight:600 }}>✓ Password changed! Redirecting to login…</p>
                    </div>
                  ) : (
                    <>
                      {passwordError && <div style={{ padding:'10px 12px', background:'rgba(239,68,68,0.1)', border:'1px solid rgba(239,68,68,0.3)', borderRadius:'10px' }}><p style={{ color:'#ef4444', fontSize:'13px' }}>{passwordError}</p></div>}
                      {[['Current Password','currentPassword'],['New Password','newPassword'],['Confirm New Password','confirmPassword']].map(([lbl,key]) => (
                        <div key={key}>
                          <label style={{ display:'block', fontSize:'12px', fontWeight:600, color:'var(--text-secondary)', marginBottom:'6px' }}>{lbl}</label>
                          <input type="password" value={passwordData[key]} onChange={e=>setPasswordData(p=>({...p,[key]:e.target.value}))}
                            style={{ width:'100%', padding:'10px 12px', background:'var(--bg-surface)', border:'1px solid var(--border)', borderRadius:'10px', fontSize:'14px', color:'var(--text-primary)', outline:'none' }}
                            onFocus={e=>e.target.style.borderColor='var(--accent)'}
                            onBlur={e=>e.target.style.borderColor='var(--border)'} />
                        </div>
                      ))}
                      <button onClick={handleChangePassword} style={{ padding:'11px', background:'#d97706', color:'white', border:'none', borderRadius:'10px', cursor:'pointer', fontSize:'14px', fontWeight:600 }}>
                        Update Password
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
            <div style={{ display:'flex', gap:'10px', paddingTop:'4px' }}>
              <button onClick={() => setShowProfileModal(false)} style={{ flex:1, padding:'11px', background:'transparent', border:'1px solid var(--border)', borderRadius:'10px', cursor:'pointer', color:'var(--text-secondary)', fontSize:'14px', fontWeight:500 }}>
                Cancel
              </button>
              <button onClick={handleSaveProfile} style={{ flex:1, padding:'11px', background:'var(--accent)', color:'white', border:'none', borderRadius:'10px', cursor:'pointer', fontSize:'14px', fontWeight:600, display:'flex', alignItems:'center', justifyContent:'center', gap:'6px' }}>
                <Save size={14} /> Save Changes
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }
}
