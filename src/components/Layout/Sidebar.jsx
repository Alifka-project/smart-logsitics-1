import React from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Package, Settings, FileText, Users,
  Truck, MapPin, ChevronLeft, ChevronRight, LogOut,
  FileBarChart, Navigation as NavIcon
} from 'lucide-react';
import { getCurrentUser, clearAuth } from '../../frontend/auth';
import api from '../../frontend/apiClient';

const NAV_ITEMS = [
  { icon: LayoutDashboard, label: 'Dashboard',         path: '/admin',                    exact: true },
  { icon: Package,         label: 'Deliveries',        path: '/deliveries',               exact: false },
  { icon: Settings,        label: 'Operations',         path: '/admin/operations',         exact: false },
  { icon: FileBarChart,    label: 'Reports',            path: '/admin/reports',            exact: false },
  { icon: Truck,           label: 'Driver Tracking',    path: '/admin/tracking/drivers',   exact: false },
  { icon: NavIcon,         label: 'Delivery Tracking',  path: '/admin/tracking/deliveries',exact: false },
  { icon: Users,           label: 'Users',              path: '/admin/users',              exact: false },
];

export default function Sidebar({ collapsed, onToggle, mobileOpen, onMobileClose }) {
  const navigate  = useNavigate();
  const location  = useLocation();
  const user      = getCurrentUser();

  const displayName = user?.full_name || user?.fullName || user?.username || 'User';
  const role        = user?.role || 'admin';
  const initials    = displayName.split(' ').filter(Boolean).map(p => p[0]).slice(0, 2).join('').toUpperCase() || 'U';
  const avatar      = user?.profile_picture || user?.profilePicture || null;

  const handleLogout = async () => {
    try { await api.post('/auth/logout').catch(() => {}); } catch {}
    clearAuth();
    navigate('/login');
  };

  const isActive = (path, exact) =>
    exact ? location.pathname === path : location.pathname.startsWith(path);

  const SidebarContent = () => (
    <div className="flex flex-col h-full">
      {/* Logo / Brand */}
      <div className={`flex items-center h-16 border-b border-white/10 flex-shrink-0 ${collapsed ? 'justify-center px-3' : 'px-5'}`}>
        {collapsed ? (
          <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center shadow-lg">
            <span className="text-white font-bold text-base">E</span>
          </div>
        ) : (
          <img src="/elect home.png" alt="Electrolux" className="h-10 w-auto object-contain" />
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-3 px-2 overflow-y-auto overflow-x-hidden space-y-0.5">
        {NAV_ITEMS.map(({ icon: Icon, label, path, exact }) => {
          const active = isActive(path, exact);
          return (
            <NavLink
              key={path}
              to={path}
              onClick={() => { if (mobileOpen && onMobileClose) onMobileClose(); }}
              className={`group relative flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 ${
                active
                  ? 'bg-blue-600/20 text-blue-400'
                  : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
              }`}
            >
              {/* Active left accent */}
              {active && (
                <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-6 bg-blue-400 rounded-r-full" />
              )}
              <Icon className={`w-[18px] h-[18px] flex-shrink-0 ${active ? 'text-blue-400' : 'text-slate-500 group-hover:text-slate-200'}`} />
              {!collapsed && (
                <span className={`text-sm leading-none whitespace-nowrap ${active ? 'font-semibold' : 'font-medium'}`}>
                  {label}
                </span>
              )}
              {/* Tooltip when collapsed */}
              {collapsed && (
                <div className="absolute left-full ml-3 px-2.5 py-1.5 bg-slate-700 text-white text-xs font-medium rounded-lg shadow-lg opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity duration-150 whitespace-nowrap z-50">
                  {label}
                  <div className="absolute right-full top-1/2 -translate-y-1/2 border-4 border-transparent border-r-slate-700" />
                </div>
              )}
            </NavLink>
          );
        })}
      </nav>

      {/* Bottom: User + Collapse */}
      <div className="flex-shrink-0 border-t border-white/10 p-3 space-y-2">
        {/* User profile row */}
        <div className={`flex items-center gap-2.5 ${collapsed ? 'justify-center' : ''}`}>
          <div className="w-8 h-8 rounded-full flex-shrink-0 overflow-hidden bg-blue-600 flex items-center justify-center border border-white/10">
            {avatar
              ? <img src={avatar} alt={displayName} className="w-full h-full object-cover" />
              : <span className="text-white text-xs font-bold">{initials}</span>}
          </div>
          {!collapsed && (
            <>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-white truncate leading-tight">{displayName}</p>
                <p className="text-xs text-slate-400 capitalize leading-tight mt-0.5">{role}</p>
              </div>
              <button
                onClick={handleLogout}
                className="p-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-400/10 transition-colors flex-shrink-0"
                title="Sign out"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </>
          )}
        </div>

        {/* Collapse toggle (desktop only) */}
        <button
          onClick={onToggle}
          className="hidden md:flex w-full items-center justify-center gap-2 py-1.5 text-slate-500 hover:text-slate-200 hover:bg-white/5 rounded-lg transition-colors text-xs"
        >
          {collapsed
            ? <ChevronRight className="w-4 h-4" />
            : <><ChevronLeft className="w-4 h-4" /><span>Collapse</span></>}
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop sidebar */}
      <aside
        className={`fixed left-0 top-0 h-screen bg-slate-900 transition-all duration-300 z-40 hidden md:block ${
          collapsed ? 'w-[68px]' : 'w-[240px]'
        }`}
      >
        <SidebarContent />
      </aside>

      {/* Mobile overlay */}
      {mobileOpen && (
        <>
          <div
            className="fixed inset-0 bg-black/50 z-40 md:hidden"
            onClick={onMobileClose}
          />
          <aside className="fixed left-0 top-0 h-screen w-[240px] bg-slate-900 z-50 md:hidden shadow-2xl">
            <SidebarContent />
          </aside>
        </>
      )}
    </>
  );
}
