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
    <nav className="fixed top-14 left-0 right-0 bg-white dark:bg-gray-800 shadow-sm border-b border-gray-200 dark:border-gray-700 transition-colors z-40">
      <div className="h-full flex">
        <div className="mx-auto w-full px-4 sm:px-6 flex gap-1.5 overflow-x-auto py-1.5">
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
                  flex items-center gap-2 px-3.5 py-2 font-medium transition-all duration-200 ease-out text-xs sm:text-sm whitespace-nowrap relative group rounded-full
                  ${isActive
                    ? 'text-white bg-primary-600 shadow-md scale-[1.02]'
                    : 'text-gray-700 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400 hover:bg-gray-50 dark:hover:bg-gray-700 hover:scale-[1.01]'
                  }
                `}
              >
                {/* Icon with circular background */}
                <div className={`
                  flex items-center justify-center w-7 h-7 rounded-full transition-all duration-200 flex-shrink-0
                  ${isActive
                    ? 'bg-white/20'
                    : 'bg-gray-100 dark:bg-gray-700 group-hover:bg-primary-100 dark:group-hover:bg-primary-900'
                  }
                `}>
                  <Icon className={`w-4 h-4 transition-all duration-200 ${
                    isActive 
                      ? 'text-white' 
                      : 'text-gray-600 dark:text-gray-300 group-hover:text-primary-600 dark:group-hover:text-primary-400 group-hover:scale-110'
                  }`} />
                </div>
                
                {/* Label */}
                <span className={`hidden sm:inline transition-all duration-200 ${
                  isActive ? 'font-semibold' : 'font-medium group-hover:font-semibold'
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
