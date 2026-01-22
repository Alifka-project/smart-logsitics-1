import React from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { 
  LayoutDashboard, 
  Settings, 
  FileText, 
  Users,
  Database
} from 'lucide-react';

export default function Navigation() {
  const location = useLocation();
  const clientUser = (() => { 
    try { 
      return JSON.parse(localStorage.getItem('client_user') || 'null'); 
    } catch(e) { 
      return null; 
    } 
  })();
  
  const isAdmin = clientUser && clientUser.role === 'admin';
  
  if (!isAdmin) return null;

  const navItems = [
    { icon: LayoutDashboard, label: 'Dashboard', path: '/admin', exact: true },
    { icon: Database, label: 'Delivery Management', path: '/deliveries', exact: false },
    { icon: Settings, label: 'Operations', path: '/admin/operations' },
    { icon: FileText, label: 'Reports', path: '/admin/reports' },
    { icon: Users, label: 'Users', path: '/admin/users' },
  ];

  return (
    <nav className="bg-white dark:bg-gray-800 shadow-sm border-b border-gray-200 dark:border-gray-700 transition-colors">
      <div className="container mx-auto px-3 sm:px-3 md:px-3 lg:px-3 xl:px-4 2xl:px-5 max-w-7xl">
        <div className="flex gap-1.5 overflow-x-auto py-1.5">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = item.exact 
              ? location.pathname === item.path
              : location.pathname.startsWith(item.path);

            return (
              <NavLink
                key={item.path}
                to={item.path}
                className={`
                  flex items-center gap-2.5 px-5 py-2.5 font-medium transition-all duration-300 ease-out text-xs sm:text-sm whitespace-nowrap relative group rounded-xl
                  ${isActive
                    ? 'text-white bg-gradient-to-r from-primary-600 via-primary-500 to-primary-600 shadow-lg shadow-primary-500/50 hover:shadow-xl hover:shadow-primary-500/60 scale-105'
                    : 'text-gray-700 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400 bg-white/50 dark:bg-gray-800/50 backdrop-blur-sm hover:bg-gradient-to-r hover:from-primary-50 hover:to-primary-100 dark:hover:from-primary-900/30 dark:hover:to-primary-800/30 hover:scale-[1.02] hover:shadow-md'
                  }
                `}
              >
                {/* Glow effect for active state */}
                {isActive && (
                  <div className="absolute inset-0 rounded-xl bg-gradient-to-r from-primary-400/20 via-primary-500/30 to-primary-400/20 blur-sm -z-10 animate-pulse"></div>
                )}
                
                {/* Icon with modern minimal style */}
                <Icon className={`w-5 h-5 transition-all duration-300 flex-shrink-0 ${
                  isActive 
                    ? 'text-white drop-shadow-lg' 
                    : 'text-gray-600 dark:text-gray-300 group-hover:text-primary-600 dark:group-hover:text-primary-400 group-hover:scale-110 group-hover:rotate-3'
                }`} />
                
                {/* Label with modern typography */}
                <span className={`hidden sm:inline transition-all duration-300 ${
                  isActive 
                    ? 'font-semibold drop-shadow-sm' 
                    : 'font-medium group-hover:font-semibold'
                }`}>
                  {item.label}
                </span>
                
                {/* Active indicator line */}
                {isActive && (
                  <div className="absolute bottom-0 left-1/2 transform -translate-x-1/2 w-8 h-0.5 bg-white rounded-full shadow-lg"></div>
                )}
              </NavLink>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
