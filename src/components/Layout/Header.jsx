import React from 'react';
import { Truck } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function Header() {
  return (
    <header className="bg-gradient-to-r from-purple-600 to-purple-800 text-white shadow-lg">
      <div className="container mx-auto px-4 py-3 sm:py-4">
        <div className="flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2 sm:gap-3 hover:opacity-80 transition-opacity">
            <Truck className="w-6 h-6 sm:w-8 sm:h-8" />
            <div>
              <h1 className="text-lg sm:text-xl lg:text-2xl font-bold">Dubai Logistics System</h1>
              <p className="text-xs sm:text-sm text-purple-200">Warehouse: Jebel Ali Free Zone</p>
            </div>
          </Link>
          <div className="text-right hidden sm:block">
            <div className="text-sm text-purple-200">
              {new Date().toLocaleDateString('en-GB', {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric'
              })}
            </div>
          </div>
          <div className="text-right sm:hidden">
            <div className="text-xs text-purple-200">
              {new Date().toLocaleDateString('en-GB', {
                day: 'numeric',
                month: 'short'
              })}
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}

