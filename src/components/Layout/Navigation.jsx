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
                  flex items-center gap-2.5 px-4 py-2.5 font-medium transition-all duration-300 ease-out text-xs sm:text-sm whitespace-nowrap relative group rounded-lg overflow-hidden
                  ${isActive
                    ? 'text-primary-600 dark:text-primary-400 bg-white dark:bg-gray-800 shadow-[0_1px_2px_rgba(0,0,0,0.05)]'
                    : 'text-gray-700 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400 hover:bg-gray-50 dark:hover:bg-gray-700/50 hover:scale-[1.02] hover:shadow-sm'
                  }
                `}
              >
                {/* Web3 animated underline - slides in */}
                <div className={`absolute bottom-0 left-0 h-0.5 bg-gradient-to-r from-primary-600 via-primary-400 to-primary-600 dark:from-primary-400 dark:via-primary-300 dark:to-primary-400 rounded-t-full transition-all duration-300 ${
                  isActive ? 'w-full opacity-100' : 'w-0 opacity-0 group-hover:w-full group-hover:opacity-50'
                }`}></div>
                
                {/* Shimmer effect on active */}
                {isActive && (
                  <div className="absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-1000 ease-in-out bg-gradient-to-r from-transparent via-white/20 to-transparent"></div>
                )}
                
                {/* Icon with web3 animations */}
                <Icon className={`w-5 h-5 transition-all duration-300 flex-shrink-0 ${
                  isActive 
                    ? 'text-primary-600 dark:text-primary-400 scale-110' 
                    : 'text-gray-600 dark:text-gray-400 group-hover:text-primary-600 dark:group-hover:text-primary-400 group-hover:scale-110 group-hover:rotate-12'
                }`} />
                
                {/* Label with smooth transitions */}
                <span className={`hidden sm:inline transition-all duration-300 relative z-10 ${
                  isActive 
                    ? 'font-medium translate-x-0' 
                    : 'font-normal group-hover:font-medium group-hover:translate-x-0.5'
                }`}>
                  {item.label}
                </span>
                
                {/* Subtle glow on hover */}
                {!isActive && (
                  <div className="absolute inset-0 rounded-lg bg-primary-500/0 group-hover:bg-primary-500/5 dark:group-hover:bg-primary-400/5 transition-all duration-300 -z-10"></div>
                )}
              </NavLink>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
