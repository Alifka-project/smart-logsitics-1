import React from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Package, Settings, Users,
  Truck, ChevronLeft, ChevronRight, LogOut,
  FileBarChart, Navigation as NavIcon, Activity
} from 'lucide-react';
import { getCurrentUser, clearAuth } from '../../frontend/auth';
import api from '../../frontend/apiClient';

const NAV_ITEMS = [
  { icon: LayoutDashboard, label: 'Dashboard',          path: '/admin',                     exact: true  },
  { icon: Package,         label: 'Deliveries',          path: '/deliveries',                exact: false },
  { icon: Activity,        label: 'Operations',          path: '/admin/operations',          exact: false },
  { icon: FileBarChart,    label: 'Reports',             path: '/admin/reports',             exact: false },
  { icon: Truck,           label: 'Driver Tracking',     path: '/admin/tracking/drivers',    exact: false },
  { icon: NavIcon,         label: 'Delivery Tracking',   path: '/admin/tracking/deliveries', exact: false },
  { icon: Users,           label: 'Users',               path: '/admin/users',               exact: false },
];

export default function Sidebar({ collapsed, onToggle, mobileOpen, onMobileClose }) {
  const navigate = useNavigate();
  const location = useLocation();
  const user     = getCurrentUser();

  const displayName = user?.full_name || user?.fullName || user?.username || 'User';
  const role        = user?.role ? user.role.charAt(0).toUpperCase() + user.role.slice(1) : 'Admin';
  const initials    = displayName.split(' ').filter(Boolean).map(p => p[0]).slice(0, 2).join('').toUpperCase() || 'U';
  const avatar      = user?.profile_picture || user?.profilePicture || null;

  const handleLogout = async () => {
    try { await api.post('/auth/logout').catch(() => {}); } catch {}
    clearAuth();
    navigate('/login');
  };

  const isActive = (path, exact) =>
    exact ? location.pathname === path : location.pathname.startsWith(path);

  /* ── Sidebar inner content ── */
  const SidebarContent = () => (
    <div className="flex flex-col h-full">

      {/* ── Logo ── */}
      <div
        className="flex items-center h-[60px] border-b flex-shrink-0"
        style={{ borderColor: 'var(--border)', padding: collapsed ? '0 12px' : '0 20px' }}
      >
        {collapsed ? (
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center font-bold text-white text-sm shadow-glow"
            style={{ background: 'var(--accent)' }}
          >
            E
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <div
              className="w-8 h-8 rounded-xl flex items-center justify-center font-bold text-white text-sm shadow-glow flex-shrink-0"
              style={{ background: 'var(--accent)' }}
            >
              E
            </div>
            <div>
              <p className="text-sm font-bold leading-none" style={{ color: 'var(--text-primary)' }}>Electrolux</p>
              <p className="text-[10px] mt-0.5 font-medium" style={{ color: 'var(--text-muted)' }}>Smart Logistics</p>
            </div>
          </div>
        )}
      </div>

      {/* ── Navigation ── */}
      <nav className="flex-1 py-4 overflow-y-auto overflow-x-hidden" style={{ padding: '16px 10px' }}>
        <div className="space-y-0.5">
          {NAV_ITEMS.map(({ icon: Icon, label, path, exact }) => {
            const active = isActive(path, exact);
            return (
              <NavLink
                key={path}
                to={path}
                onClick={() => { if (mobileOpen && onMobileClose) onMobileClose(); }}
                className="group relative flex items-center gap-3 rounded-xl transition-all duration-200 cursor-pointer"
                style={{
                  padding: collapsed ? '10px 12px' : '10px 14px',
                  background: active ? 'var(--accent-glow)' : 'transparent',
                  color: active ? 'var(--accent)' : 'var(--text-muted)',
                  border: active ? '1px solid rgba(79,112,245,0.2)' : '1px solid transparent',
                }}
                onMouseEnter={e => {
                  if (!active) {
                    e.currentTarget.style.background = 'var(--bg-hover)';
                    e.currentTarget.style.color = 'var(--text-primary)';
                  }
                }}
                onMouseLeave={e => {
                  if (!active) {
                    e.currentTarget.style.background = 'transparent';
                    e.currentTarget.style.color = 'var(--text-muted)';
                  }
                }}
              >
                {/* Active indicator */}
                {active && (
                  <div
                    className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full"
                    style={{ background: 'var(--accent)' }}
                  />
                )}

                <Icon
                  className="flex-shrink-0 transition-colors"
                  size={17}
                  style={{ color: active ? 'var(--accent)' : 'inherit' }}
                />

                {!collapsed && (
                  <span className={`text-sm whitespace-nowrap leading-none ${active ? 'font-semibold' : 'font-medium'}`}>
                    {label}
                  </span>
                )}

                {/* Tooltip when collapsed */}
                {collapsed && (
                  <div
                    className="absolute left-full ml-3 px-3 py-1.5 text-xs font-medium rounded-lg shadow-lg opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity duration-150 whitespace-nowrap z-50"
                    style={{ background: '#2d2f52', color: 'var(--text-primary)' }}
                  >
                    {label}
                    <div
                      className="absolute right-full top-1/2 -translate-y-1/2 border-4 border-transparent"
                      style={{ borderRightColor: '#2d2f52' }}
                    />
                  </div>
                )}
              </NavLink>
            );
          })}
        </div>
      </nav>

      {/* ── User + collapse ── */}
      <div
        className="flex-shrink-0 border-t"
        style={{ borderColor: 'var(--border)', padding: '12px 10px' }}
      >
        {/* User row */}
        {!collapsed && (
          <div
            className="flex items-center gap-3 rounded-xl px-3 py-2.5 mb-2 transition-colors cursor-pointer"
            style={{ background: 'var(--bg-hover)' }}
          >
            {avatar ? (
              <img src={avatar} alt={displayName} className="w-8 h-8 rounded-full object-cover flex-shrink-0" />
            ) : (
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
                style={{ background: 'var(--accent)' }}
              >
                {initials}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{displayName}</p>
              <p className="text-[10px] capitalize" style={{ color: 'var(--text-muted)' }}>{role}</p>
            </div>
            <button
              onClick={handleLogout}
              className="p-1 rounded-lg transition-colors flex-shrink-0"
              title="Sign out"
              style={{ color: 'var(--text-muted)' }}
              onMouseEnter={e => { e.currentTarget.style.color = '#ef4444'; }}
              onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)'; }}
            >
              <LogOut size={14} />
            </button>
          </div>
        )}

        {/* Collapsed: just logout icon */}
        {collapsed && (
          <button
            onClick={handleLogout}
            className="w-full flex items-center justify-center py-2 rounded-xl transition-colors mb-2"
            title="Sign out"
            style={{ color: 'var(--text-muted)' }}
            onMouseEnter={e => { e.currentTarget.style.color = '#ef4444'; e.currentTarget.style.background = 'rgba(239,68,68,0.08)'; }}
            onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.background = 'transparent'; }}
          >
            <LogOut size={16} />
          </button>
        )}

        {/* Collapse toggle — desktop only */}
        <button
          onClick={onToggle}
          className="hidden md:flex w-full items-center justify-center py-1.5 rounded-xl transition-colors text-xs font-medium gap-1.5"
          style={{ color: 'var(--text-muted)', background: 'transparent' }}
          onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.color = 'var(--text-primary)'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-muted)'; }}
        >
          {collapsed ? <ChevronRight size={14} /> : <><ChevronLeft size={14} /><span>Collapse</span></>}
        </button>
      </div>
    </div>
  );

  /* ─────────────────────────────────────── */
  return (
    <>
      {/* Desktop sidebar */}
      <aside
        className="hidden md:flex flex-col fixed inset-y-0 left-0 z-40 transition-all duration-300"
        style={{
          width: collapsed ? '68px' : '240px',
          background: 'var(--bg-surface)',
          borderRight: '1px solid var(--border)',
        }}
      >
        <SidebarContent />
      </aside>

      {/* Mobile overlay */}
      {mobileOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/60 md:hidden"
            onClick={onMobileClose}
          />
          <aside
            className="fixed inset-y-0 left-0 z-50 w-64 flex flex-col md:hidden"
            style={{
              background: 'var(--bg-surface)',
              borderRight: '1px solid var(--border)',
            }}
          >
            <SidebarContent />
          </aside>
        </>
      )}
    </>
  );
}
