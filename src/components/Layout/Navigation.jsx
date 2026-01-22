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
                    ? 'text-primary-600 dark:text-primary-400'
                    : 'text-gray-700 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400'
                  }
                `}
              >
                {/* Soft web3-style shadow highlight for active state */}
                {isActive && (
                  <>
                    {/* Soft glow background */}
                    <div className="absolute inset-0 rounded-xl bg-gradient-to-r from-primary-500/15 via-primary-400/20 to-primary-500/15 dark:from-primary-400/15 dark:via-primary-300/20 dark:to-primary-400/15 -z-10"></div>
                    {/* Soft shadow glow effect */}
                    <div className="absolute inset-0 rounded-xl shadow-[0_0_20px_rgba(17,74,118,0.4),0_0_40px_rgba(17,74,118,0.2)] dark:shadow-[0_0_20px_rgba(96,165,250,0.4),0_0_40px_rgba(96,165,250,0.2)] -z-10"></div>
                    {/* Subtle inner glow */}
                    <div className="absolute inset-[2px] rounded-xl bg-primary-500/5 dark:bg-primary-400/5 -z-10"></div>
                  </>
                )}
                
                {/* Icon with modern minimal style */}
                <Icon className={`w-5 h-5 transition-all duration-300 flex-shrink-0 ${
                  isActive 
                    ? 'text-primary-600 dark:text-primary-400 drop-shadow-[0_2px_8px_rgba(17,74,118,0.4)]' 
                    : 'text-gray-600 dark:text-gray-300 group-hover:text-primary-600 dark:group-hover:text-primary-400 group-hover:scale-110 group-hover:rotate-3'
                }`} />
                
                {/* Label with modern typography */}
                <span className={`hidden sm:inline transition-all duration-300 relative z-10 ${
                  isActive 
                    ? 'font-semibold' 
                    : 'font-medium group-hover:font-semibold'
                }`}>
                  {item.label}
                </span>
              </NavLink>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
