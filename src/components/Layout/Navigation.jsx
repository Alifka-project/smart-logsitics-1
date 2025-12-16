import React from 'react';
import { NavLink } from 'react-router-dom';
import { Home, List, Map } from 'lucide-react';

export default function Navigation() {
  return (
    <nav className="bg-white shadow-md border-b">
      <div className="container mx-auto px-4">
        <div className="flex gap-2 sm:gap-4">
          <NavLink
            to="/"
            className={({ isActive }) =>
              `flex items-center gap-1 sm:gap-2 px-3 sm:px-6 py-3 sm:py-4 font-medium transition-colors text-sm sm:text-base ${
                isActive
                  ? 'text-purple-600 border-b-2 border-purple-600'
                  : 'text-gray-600 hover:text-purple-600'
              }`
            }
          >
            <Home className="w-4 h-4 sm:w-5 sm:h-5" />
            <span className="hidden xs:inline">Home</span>
          </NavLink>
          <NavLink
            to="/deliveries"
            className={({ isActive }) =>
              `flex items-center gap-1 sm:gap-2 px-3 sm:px-6 py-3 sm:py-4 font-medium transition-colors text-sm sm:text-base ${
                isActive
                  ? 'text-purple-600 border-b-2 border-purple-600'
                  : 'text-gray-600 hover:text-purple-600'
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
              `flex items-center gap-1 sm:gap-2 px-3 sm:px-6 py-3 sm:py-4 font-medium transition-colors text-sm sm:text-base ${
                isActive
                  ? 'text-purple-600 border-b-2 border-purple-600'
                  : 'text-gray-600 hover:text-purple-600'
              }`
            }
          >
            <Map className="w-4 h-4 sm:w-5 sm:h-5" />
            <span className="hidden xs:inline">Map View</span>
            <span className="xs:hidden">Map</span>
          </NavLink>
        </div>
      </div>
    </nav>
  );
}

