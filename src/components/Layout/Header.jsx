import React, { useEffect, useState, useRef } from 'react';
import { NavLink, Link, useNavigate, useLocation } from 'react-router-dom';
import { isAuthenticated, getCurrentUser, clearAuth } from '../../frontend/auth';
import {
  LogOut, User, Settings, ChevronDown, Bell, Sun, Moon, X, Camera, Save, Menu
} from 'lucide-react';
import api from '../../frontend/apiClient';
import { useToast } from '../../hooks/useToast';
import { ToastContainer } from '../common/Toast';

/* ─── Admin top navigation items ────────────────────────── */
const ADMIN_NAV = [
  { label: 'Dashboard',  path: '/admin',                    exact: true  },
  { label: 'Deliveries', path: '/deliveries',               exact: false },
  { label: 'Operations', path: '/admin/operations',         exact: false },
  { label: 'Reports',    path: '/admin/reports',            exact: false },
  {
    label: 'Tracking',
    dropdown: [
      { label: 'Driver Tracking',   path: '/admin/tracking/drivers'    },
      { label: 'Delivery Tracking', path: '/admin/tracking/deliveries' },
    ],
  },
  { label: 'Users', path: '/admin/users', exact: false },
];

export default function Header({ isAdmin = false }) {
  /* ── Auth state ── */
  const [loggedIn,  setLoggedIn]  = useState(isAuthenticated());
  const [user,      setUser]      = useState(getCurrentUser());

  /* ── UI state ── */
  const [showDropdown,      setShowDropdown]      = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showProfileModal,  setShowProfileModal]  = useState(false);
  const [mobileNavOpen,     setMobileNavOpen]     = useState(false);
  const [trackingOpen,      setTrackingOpen]      = useState(false);

  /* ── Notifications ── */
  const [notifications, setNotifications] = useState([]);
  const { toasts, removeToast, addToast } = useToast();
  const hasLoadedRef              = useRef(false);
  const prevMsgUnreadRef          = useRef(0);
  const prevDeliveryIdsRef        = useRef(new Set());
  const prevMsgNotificationsRef   = useRef([]);
  const contactsCacheRef          = useRef({ data: null, fetchedAt: 0 });

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

  const dropdownRef     = useRef(null);
  const notifRef        = useRef(null);
  const trackingRef     = useRef(null);
  const navigate        = useNavigate();
  const location        = useLocation();

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
      if (theme === 'dark') document.documentElement.style.backgroundColor = '#0d0e1a';
      else                  document.documentElement.style.backgroundColor = '#f0f2f8';
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
      if (trackingRef.current && !trackingRef.current.contains(e.target))
        setTrackingOpen(false);
    }
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, []);

  /* Notification polling */
  useEffect(() => {
    if (!loggedIn) return;
    let timer = null;
    let visible = !document.hidden;
    const poll = () => { loadNotifications(); schedule(); };
    const schedule = () => {
      if (timer) clearTimeout(timer);
      if (visible) timer = setTimeout(poll, 60000);
    };
    const onVisibility = () => {
      visible = !document.hidden;
      if (visible) { loadNotifications(); schedule(); } else { clearTimeout(timer); timer = null; }
    };
    const onStatusUpdate = (e) => {
      const id = e.detail?.deliveryId;
      setNotifications(prev => prev.filter(n => !id || String(n.deliveryId) !== String(id)));
      loadNotifications();
    };
    loadNotifications();
    schedule();
    document.addEventListener('visibilitychange', onStatusUpdate);
    window.addEventListener('deliveryStatusUpdated', onStatusUpdate);
    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('deliveryStatusUpdated', onStatusUpdate);
    };
  }, [loggedIn]); // eslint-disable-line react-hooks/exhaustive-deps

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
          const alerts      = ar.status==='fulfilled' ? ar.value.data?.notifications||[]        : [];
          const overdue     = or.status==='fulfilled' ? or.value.data?.deliveries||[]           : [];
          const unconfirmed = ur.status==='fulfilled' ? ur.value.data?.deliveries||[]           : [];
          deliveryNotifs = [
            ...alerts.map(n    => ({ id:`alert-${n.id}`,          type:'delivery', status:n.type,         title:n.title,                                             message:n.message,            timestamp:n.createdAt,          read:false, _adminAlertId:n.id })),
            ...overdue.map(d   => ({ id:`overdue-${d.id}`,        type:'delivery', status:'overdue',       title:`Overdue (${d.hoursOverdue}h): ${d.customer||'?'}`, message:`${d.address||''} — ${d.status}`, timestamp:d.createdAt, read:false, deliveryId:d.id })),
            ...unconfirmed.map(d=>({ id:`sms-unconfirmed-${d.id}`,type:'delivery', status:'sms_unconfirmed',title:`SMS Unconfirmed (>24h): ${d.customer||'?'}`,      message:d.address||'',        timestamp:d.smsSentAt||d.createdAt, read:false })),
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
        const map = new Map(prev.map(i => [i.id, i]));
        const next = [];
        msgNotifs.forEach(n => next.push({ ...n, read: map.get(n.id)?.read ?? false }));
        const newDelIds = new Set();
        if ((userRole==='admin'||userRole==='delivery_team') && deliveryNotifs.length) {
          deliveryNotifs.forEach(n => {
            newDelIds.add(n.id);
            next.push({ ...n, read: map.get(n.id)?.read ?? false });
          });
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
    const name = user?.full_name || user?.fullName || user?.username || '';
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
  const isTrackingActive = ADMIN_NAV.find(i=>i.dropdown)?.dropdown.some(d => location.pathname.startsWith(d.path));

  /* ──────────────────── Shared dropdown panels ──────────────────── */
  const NotifPanel = () => !showNotifications ? null : (
    <div style={{ position:'absolute', right:0, top:'calc(100% + 8px)', width:'360px', background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:'14px', boxShadow:'0 12px 40px rgba(0,0,0,0.4)', overflow:'hidden', zIndex:100 }}>
      <div style={{ padding:'14px 16px', background:'var(--bg-surface)', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
        <span style={{ fontWeight:700, fontSize:'14px', color:'var(--text-primary)' }}>Notifications</span>
        {unreadCount>0 && <span style={{ fontSize:'11px', fontWeight:600, padding:'2px 8px', borderRadius:'20px', background:'var(--accent-glow)', color:'var(--accent)' }}>{unreadCount} unread</span>}
      </div>
      <div style={{ maxHeight:'380px', overflowY:'auto' }}>
        {notifications.length===0 ? (
          <div style={{ padding:'40px', textAlign:'center', color:'var(--text-muted)' }}>
            <Bell size={32} style={{ margin:'0 auto 8px', opacity:0.3 }} />
            <p style={{ fontSize:'13px' }}>No notifications</p>
          </div>
        ) : notifications.map(n => (
          <div key={n.id} onClick={() => handleNotifClick(n)} style={{ padding:'12px 16px', borderBottom:'1px solid var(--border)', cursor:'pointer', background: !n.read ? 'rgba(79,112,245,0.05)' : 'transparent', transition:'background 0.15s' }}
            onMouseEnter={e=>e.currentTarget.style.background='var(--bg-hover)'}
            onMouseLeave={e=>e.currentTarget.style.background=!n.read?'rgba(79,112,245,0.05)':'transparent'}
          >
            <div style={{ display:'flex', gap:'10px', alignItems:'flex-start' }}>
              <div style={{ width:'7px', height:'7px', borderRadius:'50%', background: n.read?'transparent':'var(--accent)', flexShrink:0, marginTop:'5px' }} />
              <div style={{ flex:1, minWidth:0 }}>
                <p style={{ fontSize:'13px', fontWeight:600, color:'var(--text-primary)' }}>{n.title}</p>
                <p style={{ fontSize:'12px', color:'var(--text-secondary)', marginTop:'2px' }}>{n.message}</p>
                <p style={{ fontSize:'11px', color:'var(--text-muted)', marginTop:'4px' }}>{new Date(n.timestamp).toLocaleString()}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  const UserPanel = () => !showDropdown ? null : (
    <div style={{ position:'absolute', right:0, top:'calc(100% + 8px)', width:'240px', background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:'14px', boxShadow:'0 12px 40px rgba(0,0,0,0.4)', overflow:'hidden', zIndex:100 }}>
      <div style={{ padding:'16px', background:'var(--bg-surface)', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', gap:'12px' }}>
        <div style={{ width:'44px', height:'44px', borderRadius:'50%', background:'var(--accent)', display:'flex', alignItems:'center', justifyContent:'center', color:'white', fontWeight:700, fontSize:'14px', overflow:'hidden', flexShrink:0 }}>
          {avatarSrc() ? <img src={avatarSrc()} alt="" style={{ width:'100%', height:'100%', objectFit:'cover' }} /> : getInitials()}
        </div>
        <div style={{ flex:1, minWidth:0 }}>
          <p style={{ fontWeight:700, fontSize:'13px', color:'var(--text-primary)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{displayName()}</p>
          {userEmail() && <p style={{ fontSize:'11px', color:'var(--text-muted)', marginTop:'2px', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{userEmail()}</p>}
          <span style={{ display:'inline-block', marginTop:'4px', fontSize:'10px', fontWeight:700, padding:'1px 6px', borderRadius:'4px', background:'var(--accent-glow)', color:'var(--accent)', textTransform:'capitalize' }}>{userRole()}</span>
        </div>
      </div>
      <div style={{ padding:'6px' }}>
        <button onClick={() => { setShowProfileModal(true); setShowDropdown(false); }} style={{ width:'100%', display:'flex', alignItems:'center', gap:'10px', padding:'10px 12px', borderRadius:'8px', fontSize:'13px', color:'var(--text-secondary)', background:'transparent', border:'none', cursor:'pointer', textAlign:'left' }}
          onMouseEnter={e=>{e.currentTarget.style.background='var(--bg-hover)';e.currentTarget.style.color='var(--text-primary)'}}
          onMouseLeave={e=>{e.currentTarget.style.background='transparent';e.currentTarget.style.color='var(--text-secondary)'}}>
          <User size={15} /> Edit Profile
        </button>
        <div style={{ height:'1px', background:'var(--border)', margin:'4px 0' }} />
        <button onClick={handleLogout} style={{ width:'100%', display:'flex', alignItems:'center', gap:'10px', padding:'10px 12px', borderRadius:'8px', fontSize:'13px', color:'#ef4444', background:'transparent', border:'none', cursor:'pointer', textAlign:'left' }}
          onMouseEnter={e=>e.currentTarget.style.background='rgba(239,68,68,0.08)'}
          onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
          <LogOut size={15} /> Sign Out
        </button>
      </div>
    </div>
  );

  /* ──────────────────── ADMIN TOP NAV ──────────────────── */
  if (isAdmin) {
    /* Shared nav link style fn */
    const navLinkStyle = (active) => ({
      display: 'flex', alignItems: 'center', height: '60px',
      padding: '0 14px', textDecoration: 'none', cursor: 'pointer',
      color: active ? 'var(--text-primary)' : 'var(--text-muted)',
      fontWeight: active ? 600 : 500, fontSize: '14px',
      borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
      transition: 'color 0.15s, border-color 0.15s',
      whiteSpace: 'nowrap',
    });
    const iconBtnStyle = {
      width: '36px', height: '36px', borderRadius: '8px', display: 'flex',
      alignItems: 'center', justifyContent: 'center', background: 'transparent',
      border: 'none', cursor: 'pointer', color: 'var(--text-muted)',
      transition: 'background 0.15s, color 0.15s',
    };

    return (
      <>
        <header style={{ background: 'var(--bg-surface)', borderBottom: '1px solid var(--border)', position: 'sticky', top: 0, zIndex: 40 }}>
          <div style={{ display: 'flex', alignItems: 'center', height: '60px', padding: '0 24px', gap: '8px', maxWidth: '1600px', margin: '0 auto' }}>

            {/* ── Logo ── */}
            <Link to="/admin" style={{ display: 'flex', alignItems: 'center', gap: '10px', textDecoration: 'none', flexShrink: 0, marginRight: '12px' }}>
              <div style={{ width: '30px', height: '30px', borderRadius: '8px', background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 800, fontSize: '13px', boxShadow: '0 0 12px rgba(79,112,245,0.3)' }}>E</div>
              <div className="hidden sm:block">
                <p style={{ color: 'var(--text-primary)', fontWeight: 700, fontSize: '14px', lineHeight: 1 }}>Electrolux</p>
                <p style={{ color: 'var(--text-muted)', fontSize: '10px', marginTop: '2px' }}>Smart Portal</p>
              </div>
            </Link>

            {/* ── Desktop nav ── */}
            <nav className="hidden md:flex" style={{ alignItems: 'center', height: '100%', flex: 1, gap: '0' }}>
              {ADMIN_NAV.map(item => {
                if (item.dropdown) {
                  return (
                    <div key={item.label} style={{ position: 'relative', height: '100%', display: 'flex', alignItems: 'center' }} ref={trackingRef}>
                      <button
                        onClick={() => setTrackingOpen(v => !v)}
                        style={{ ...navLinkStyle(isTrackingActive), display: 'flex', alignItems: 'center', gap: '5px', background: 'transparent', border: 'none', borderBottom: isTrackingActive ? '2px solid var(--accent)' : '2px solid transparent', cursor: 'pointer', height: '60px', padding: '0 14px' }}
                        onMouseEnter={e => { if (!isTrackingActive) e.currentTarget.style.color = 'var(--text-primary)'; }}
                        onMouseLeave={e => { if (!isTrackingActive) e.currentTarget.style.color = 'var(--text-muted)'; }}
                      >
                        {item.label}
                        <ChevronDown size={13} style={{ transform: trackingOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
                      </button>
                      {trackingOpen && (
                        <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px', padding: '6px', minWidth: '200px', boxShadow: '0 12px 30px rgba(0,0,0,0.35)', zIndex: 100 }}>
                          {item.dropdown.map(d => (
                            <NavLink key={d.path} to={d.path} onClick={() => setTrackingOpen(false)}
                              style={({ isActive }) => ({
                                display: 'block', padding: '9px 12px', borderRadius: '8px',
                                color: isActive ? 'var(--accent)' : 'var(--text-secondary)',
                                fontWeight: isActive ? 600 : 500, fontSize: '13px', textDecoration: 'none',
                                background: isActive ? 'var(--accent-glow)' : 'transparent',
                              })}
                              onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)'; }}
                              onMouseLeave={e => { e.currentTarget.style.background = isNavActive(d.path,false) ? 'var(--accent-glow)' : 'transparent'; }}
                            >
                              {d.label}
                            </NavLink>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                }
                return (
                  <NavLink key={item.path} to={item.path} end={item.exact}
                    style={({ isActive }) => navLinkStyle(isActive)}
                    onMouseEnter={e => { if (e.currentTarget.style.color === 'var(--text-muted)') e.currentTarget.style.color = 'var(--text-primary)'; }}
                    onMouseLeave={e => { if (!isNavActive(item.path, item.exact)) e.currentTarget.style.color = 'var(--text-muted)'; }}
                  >
                    {item.label}
                  </NavLink>
                );
              })}
            </nav>

            {/* ── Mobile hamburger ── */}
            <button className="md:hidden" onClick={() => setMobileNavOpen(true)} style={iconBtnStyle}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.color = 'var(--text-primary)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-muted)'; }}
            >
              <Menu size={18} />
            </button>

            {/* Spacer */}
            <div style={{ flex: 1 }} className="md:hidden" />

            {/* ── Right controls ── */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '2px', flexShrink: 0 }}>
              {/* Theme toggle */}
              <button onClick={() => setTheme(t => t==='dark'?'light':'dark')} style={iconBtnStyle}
                title={theme==='dark'?'Light mode':'Dark mode'}
                onMouseEnter={e=>{e.currentTarget.style.background='var(--bg-hover)';e.currentTarget.style.color='var(--text-primary)'}}
                onMouseLeave={e=>{e.currentTarget.style.background='transparent';e.currentTarget.style.color='var(--text-muted)'}}>
                {theme==='dark' ? <Sun size={17} /> : <Moon size={17} />}
              </button>

              {/* Bell */}
              <div style={{ position: 'relative' }} ref={notifRef}>
                <button onClick={() => setShowNotifications(v=>!v)} style={{ ...iconBtnStyle, position: 'relative' }}
                  onMouseEnter={e=>{e.currentTarget.style.background='var(--bg-hover)';e.currentTarget.style.color='var(--text-primary)'}}
                  onMouseLeave={e=>{e.currentTarget.style.background='transparent';e.currentTarget.style.color='var(--text-muted)'}}>
                  <Bell size={17} />
                  {unreadCount > 0 && (
                    <span style={{ position:'absolute', top:'4px', right:'4px', minWidth:'15px', height:'15px', background:'#ef4444', borderRadius:'8px', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'9px', fontWeight:700, color:'white', padding:'0 2px' }}>
                      {unreadCount>9?'9+':unreadCount}
                    </span>
                  )}
                </button>
                <NotifPanel />
              </div>

              {/* User menu */}
              <div style={{ position: 'relative' }} ref={dropdownRef}>
                <button onClick={() => setShowDropdown(v=>!v)} style={{ display:'flex', alignItems:'center', gap:'8px', padding:'5px 10px', borderRadius:'10px', background:'transparent', border:'none', cursor:'pointer' }}
                  onMouseEnter={e=>e.currentTarget.style.background='var(--bg-hover)'}
                  onMouseLeave={e=>e.currentTarget.style.background='transparent'}
                >
                  <div style={{ width:'32px', height:'32px', borderRadius:'50%', background:'var(--accent)', display:'flex', alignItems:'center', justifyContent:'center', color:'white', fontWeight:700, fontSize:'12px', overflow:'hidden', flexShrink:0 }}>
                    {avatarSrc() ? <img src={avatarSrc()} alt="" style={{ width:'100%', height:'100%', objectFit:'cover' }} /> : getInitials()}
                  </div>
                  <div className="hidden sm:block" style={{ textAlign: 'left' }}>
                    <p style={{ fontSize:'13px', fontWeight:600, color:'var(--text-primary)', lineHeight:1 }}>{displayName()}</p>
                    <p style={{ fontSize:'10px', color:'var(--text-muted)', marginTop:'2px', textTransform:'capitalize' }}>{userRole()}</p>
                  </div>
                  <ChevronDown size={13} style={{ color:'var(--text-muted)', transform: showDropdown?'rotate(180deg)':'none', transition:'transform 0.2s' }} />
                </button>
                <UserPanel />
              </div>
            </div>
          </div>
        </header>

        {/* ── Mobile Nav Drawer ── */}
        {mobileNavOpen && (
          <>
            <div onClick={() => setMobileNavOpen(false)} style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.6)', zIndex:50 }} />
            <div style={{ position:'fixed', top:0, left:0, bottom:0, width:'260px', background:'var(--bg-surface)', borderRight:'1px solid var(--border)', zIndex:60, display:'flex', flexDirection:'column', padding:'0' }}>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'16px 20px', borderBottom:'1px solid var(--border)' }}>
                <div style={{ display:'flex', alignItems:'center', gap:'10px' }}>
                  <div style={{ width:'28px', height:'28px', borderRadius:'7px', background:'var(--accent)', display:'flex', alignItems:'center', justifyContent:'center', color:'white', fontWeight:800, fontSize:'12px' }}>E</div>
                  <span style={{ fontWeight:700, fontSize:'14px', color:'var(--text-primary)' }}>Electrolux</span>
                </div>
                <button onClick={() => setMobileNavOpen(false)} style={{ background:'transparent', border:'none', cursor:'pointer', color:'var(--text-muted)' }}>
                  <X size={18} />
                </button>
              </div>
              <nav style={{ flex:1, padding:'12px', overflowY:'auto' }}>
                {ADMIN_NAV.map(item => {
                  if (item.dropdown) {
                    return item.dropdown.map(d => (
                      <NavLink key={d.path} to={d.path} onClick={() => setMobileNavOpen(false)}
                        style={({ isActive }) => ({ display:'block', padding:'11px 14px', borderRadius:'10px', fontSize:'14px', fontWeight: isActive?600:500, color: isActive?'var(--accent)':'var(--text-secondary)', background: isActive?'var(--accent-glow)':'transparent', textDecoration:'none', marginBottom:'2px' })}
                      >
                        {d.label}
                      </NavLink>
                    ));
                  }
                  return (
                    <NavLink key={item.path} to={item.path} end={item.exact} onClick={() => setMobileNavOpen(false)}
                      style={({ isActive }) => ({ display:'block', padding:'11px 14px', borderRadius:'10px', fontSize:'14px', fontWeight: isActive?600:500, color: isActive?'var(--accent)':'var(--text-secondary)', background: isActive?'var(--accent-glow)':'transparent', textDecoration:'none', marginBottom:'2px' })}
                    >
                      {item.label}
                    </NavLink>
                  );
                })}
              </nav>
            </div>
          </>
        )}

        <ToastContainer toasts={toasts} onRemove={removeToast} />
        <ProfileModal />
      </>
    );
  }

  /* ──────────────────── NON-ADMIN HEADER ──────────────────── */
  const handleLogoClick = () => {
    const role = user?.role;
    if (role==='delivery_team') navigate('/delivery-team');
    else if (role==='driver')   navigate('/driver');
    else                        navigate('/deliveries');
  };

  return (
    <>
      <header style={{ background: 'linear-gradient(135deg, #0a3254, #114a76)', borderBottom: '1px solid rgba(255,255,255,0.1)', position: 'sticky', top: 0, zIndex: 40, boxShadow: '0 2px 12px rgba(0,0,0,0.3)' }}>
        <div style={{ display: 'flex', alignItems: 'center', height: '60px', padding: '0 24px', maxWidth: '1400px', margin: '0 auto' }}>
          <button onClick={handleLogoClick} style={{ display:'flex', alignItems:'center', background:'none', border:'none', cursor:'pointer' }}>
            <img src="/elect home.png" alt="Electrolux" style={{ height: '44px', objectFit: 'contain' }} />
          </button>
          <div style={{ flex: 1 }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span className="hidden sm:block" style={{ fontSize: '13px', color: 'rgba(255,255,255,0.7)' }}>
              {new Date().toLocaleDateString('en-GB', { weekday:'long', day:'numeric', month:'long', year:'numeric' })}
            </span>
            <button onClick={() => setTheme(t=>t==='dark'?'light':'dark')} style={{ width:'36px', height:'36px', borderRadius:'8px', background:'rgba(255,255,255,0.1)', border:'none', cursor:'pointer', color:'white', display:'flex', alignItems:'center', justifyContent:'center' }}>
              {theme==='dark' ? <Sun size={17} /> : <Moon size={17} />}
            </button>
            <div style={{ position:'relative' }} ref={notifRef}>
              <button onClick={() => setShowNotifications(v=>!v)} style={{ width:'36px', height:'36px', borderRadius:'8px', background:'rgba(255,255,255,0.1)', border:'none', cursor:'pointer', color:'white', display:'flex', alignItems:'center', justifyContent:'center', position:'relative' }}>
                <Bell size={17} />
                {unreadCount>0 && <span style={{ position:'absolute', top:'4px', right:'4px', minWidth:'14px', height:'14px', background:'#ef4444', borderRadius:'7px', fontSize:'9px', fontWeight:700, color:'white', display:'flex', alignItems:'center', justifyContent:'center' }}>{unreadCount>9?'9+':unreadCount}</span>}
              </button>
              <NotifPanel />
            </div>
            {loggedIn && user ? (
              <div style={{ position:'relative' }} ref={dropdownRef}>
                <button onClick={() => setShowDropdown(v=>!v)} style={{ display:'flex', alignItems:'center', gap:'8px', padding:'6px 10px', borderRadius:'10px', background:'rgba(255,255,255,0.1)', border:'none', cursor:'pointer' }}>
                  <div style={{ width:'32px', height:'32px', borderRadius:'50%', background:'rgba(255,255,255,0.2)', border:'2px solid rgba(255,255,255,0.3)', overflow:'hidden', display:'flex', alignItems:'center', justifyContent:'center', color:'white', fontWeight:700, fontSize:'12px' }}>
                    {avatarSrc() ? <img src={avatarSrc()} alt="" style={{ width:'100%', height:'100%', objectFit:'cover' }} /> : getInitials()}
                  </div>
                  <div className="hidden md:block" style={{ textAlign:'left' }}>
                    <p style={{ fontSize:'13px', fontWeight:600, color:'white', lineHeight:1 }}>{displayName()}</p>
                    <p style={{ fontSize:'10px', color:'rgba(255,255,255,0.7)', marginTop:'2px', textTransform:'capitalize' }}>{userRole()}</p>
                  </div>
                  <ChevronDown size={13} style={{ color:'rgba(255,255,255,0.7)' }} />
                </button>
                <UserPanel />
              </div>
            ) : (
              <Link to="/login" style={{ padding:'8px 16px', background:'white', color:'#0a3254', borderRadius:'8px', fontWeight:600, fontSize:'13px', textDecoration:'none' }}>Sign In</Link>
            )}
          </div>
        </div>
      </header>
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
          {/* Header */}
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
            {/* Fields */}
            {[['Full Name','text',profileData.fullName,'fullName'],['Email','email',profileData.email,'email'],['Phone','tel',profileData.phone,'phone']].map(([label,type,val,key]) => (
              <div key={key}>
                <label style={{ display:'block', fontSize:'12px', fontWeight:600, color:'var(--text-secondary)', marginBottom:'6px' }}>{label}</label>
                <input type={type} value={val} onChange={e => setProfileData(p=>({...p,[key]:e.target.value}))}
                  style={{ width:'100%', padding:'10px 12px', background:'var(--bg-surface)', border:'1px solid var(--border)', borderRadius:'10px', fontSize:'14px', color:'var(--text-primary)', outline:'none' }}
                  onFocus={e=>e.target.style.borderColor='var(--accent)'}
                  onBlur={e=>e.target.style.borderColor='var(--border)'}
                />
              </div>
            ))}
            <div>
              <label style={{ display:'block', fontSize:'12px', fontWeight:600, color:'var(--text-secondary)', marginBottom:'6px' }}>Role</label>
              <input value={userRole()} disabled style={{ width:'100%', padding:'10px 12px', background:'var(--bg-hover)', border:'1px solid var(--border)', borderRadius:'10px', fontSize:'14px', color:'var(--text-muted)' }} />
            </div>
            {/* Change password */}
            <div style={{ borderTop:'1px solid var(--border)', paddingTop:'16px' }}>
              <button onClick={() => setShowChangePassword(v=>!v)} style={{ width:'100%', display:'flex', alignItems:'center', justifyContent:'space-between', padding:'10px 12px', background:'var(--bg-hover)', border:'1px solid var(--border)', borderRadius:'10px', cursor:'pointer', color:'var(--text-primary)', fontSize:'14px', fontWeight:500 }}>
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
                            onBlur={e=>e.target.style.borderColor='var(--border)'}
                          />
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
            {/* Action buttons */}
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
