import React from 'react';
import { Truck } from 'lucide-react';

export default function Header() {
  return (
    <header className="bg-gradient-to-r from-purple-600 to-purple-800 text-white shadow-lg">
      <div className="container mx-auto px-4 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Truck className="w-8 h-8" />
            <div>
              <h1 className="text-2xl font-bold">Dubai Logistics System</h1>
              <p className="text-sm text-purple-200">Warehouse: Jebel Ali Free Zone</p>
            </div>
          </div>
          <div className="text-right">
            <div className="text-sm text-purple-200">
              {new Date().toLocaleDateString('en-GB', {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric'
              })}
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}

