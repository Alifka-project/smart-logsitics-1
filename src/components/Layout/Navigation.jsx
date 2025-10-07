import React from 'react';
import { NavLink } from 'react-router-dom';
import { List, Map } from 'lucide-react';

export default function Navigation() {
  return (
    <nav className="bg-white shadow-md border-b">
      <div className="container mx-auto px-4">
        <div className="flex gap-4">
          <NavLink
            to="/deliveries"
            className={({ isActive }) =>
              `flex items-center gap-2 px-6 py-4 font-medium transition-colors ${
                isActive
                  ? 'text-purple-600 border-b-2 border-purple-600'
                  : 'text-gray-600 hover:text-purple-600'
              }`
            }
          >
            <List className="w-5 h-5" />
            Delivery List
          </NavLink>
          <NavLink
            to="/map"
            className={({ isActive }) =>
              `flex items-center gap-2 px-6 py-4 font-medium transition-colors ${
                isActive
                  ? 'text-purple-600 border-b-2 border-purple-600'
                  : 'text-gray-600 hover:text-purple-600'
              }`
            }
          >
            <Map className="w-5 h-5" />
            Map View
          </NavLink>
        </div>
      </div>
    </nav>
  );
}

