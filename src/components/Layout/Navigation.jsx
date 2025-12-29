import React from 'react';
import { NavLink } from 'react-router-dom';
import { Home, List, Map, BarChart3, FileText, Users, Navigation as NavigationIcon } from 'lucide-react';

export default function Navigation() {
  return (
    <nav className="bg-white shadow-md border-b">
      <div className="container mx-auto px-4">
        <div className="flex gap-2 sm:gap-4 overflow-x-auto">
          <NavLink
            to="/"
            className={({ isActive }) =>
              `flex items-center gap-1 sm:gap-2 px-3 sm:px-6 py-3 sm:py-4 font-medium transition-colors text-sm sm:text-base whitespace-nowrap ${
                isActive
                  ? 'text-primary-600 border-b-2 border-primary-600'
                  : 'text-gray-600 hover:text-primary-600'
              }`
            }
          >
            <Home className="w-4 h-4 sm:w-5 sm:h-5" />
            <span className="hidden xs:inline">Home</span>
          </NavLink>
          <NavLink
            to="/deliveries"
            className={({ isActive }) =>
              `flex items-center gap-1 sm:gap-2 px-3 sm:px-6 py-3 sm:py-4 font-medium transition-colors text-sm sm:text-base whitespace-nowrap ${
                isActive
                  ? 'text-primary-600 border-b-2 border-primary-600'
                  : 'text-gray-600 hover:text-primary-600'
              }`
            }
          >
            <List className="w-4 h-4 sm:w-5 sm:h-5" />
            <span className="hidden xs:inline">Delivery List</span>
            <span className="xs:hidden">List</span>
          </NavLink>
          <NavLink
            to="/map"
            className={({ isActive }) =>
              `flex items-center gap-1 sm:gap-2 px-3 sm:px-6 py-3 sm:py-4 font-medium transition-colors text-sm sm:text-base whitespace-nowrap ${
                isActive
                  ? 'text-primary-600 border-b-2 border-primary-600'
                  : 'text-gray-600 hover:text-primary-600'
              }`
            }
          >
            <Map className="w-4 h-4 sm:w-5 sm:h-5" />
            <span className="hidden xs:inline">Map View</span>
            <span className="xs:hidden">Map</span>
          </NavLink>
          <NavLink
            to="/admin"
            className={({ isActive }) =>
              `flex items-center gap-1 sm:gap-2 px-3 sm:px-6 py-3 sm:py-4 font-medium transition-colors text-sm sm:text-base whitespace-nowrap ${
                isActive
                  ? 'text-primary-600 border-b-2 border-primary-600'
                  : 'text-gray-600 hover:text-primary-600'
              }`
            }
          >
            <BarChart3 className="w-4 h-4 sm:w-5 sm:h-5" />
            <span className="hidden xs:inline">Dashboard</span>
            <span className="xs:hidden">Dash</span>
          </NavLink>
          <NavLink
            to="/admin/tracking/deliveries"
            className={({ isActive }) =>
              `flex items-center gap-1 sm:gap-2 px-3 sm:px-6 py-3 sm:py-4 font-medium transition-colors text-sm sm:text-base whitespace-nowrap ${
                isActive
                  ? 'text-primary-600 border-b-2 border-primary-600'
                  : 'text-gray-600 hover:text-primary-600'
              }`
            }
          >
            <NavigationIcon className="w-4 h-4 sm:w-5 sm:h-5" />
            <span className="hidden sm:inline">Delivery Tracking</span>
            <span className="sm:hidden">Tracking</span>
          </NavLink>
          <NavLink
            to="/admin/tracking/drivers"
            className={({ isActive }) =>
              `flex items-center gap-1 sm:gap-2 px-3 sm:px-6 py-3 sm:py-4 font-medium transition-colors text-sm sm:text-base whitespace-nowrap ${
                isActive
                  ? 'text-primary-600 border-b-2 border-primary-600'
                  : 'text-gray-600 hover:text-primary-600'
              }`
            }
          >
            <Users className="w-4 h-4 sm:w-5 sm:h-5" />
            <span className="hidden sm:inline">Driver Tracking</span>
            <span className="sm:hidden">Drivers</span>
          </NavLink>
          <NavLink
            to="/admin/reports"
            className={({ isActive }) =>
              `flex items-center gap-1 sm:gap-2 px-3 sm:px-6 py-3 sm:py-4 font-medium transition-colors text-sm sm:text-base whitespace-nowrap ${
                isActive
                  ? 'text-primary-600 border-b-2 border-primary-600'
                  : 'text-gray-600 hover:text-primary-600'
              }`
            }
          >
            <FileText className="w-4 h-4 sm:w-5 sm:h-5" />
            <span className="hidden xs:inline">Reports</span>
            <span className="xs:hidden">Reports</span>
          </NavLink>
        </div>
      </div>
    </nav>
  );
}

