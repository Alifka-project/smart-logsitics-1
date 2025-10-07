import React from 'react';
import { MapPin, Package, Phone, Navigation } from 'lucide-react';
import StatusBadge from './StatusBadge';

export default function DeliveryCard({ delivery, index, onClick }) {
  return (
    <div
      onClick={onClick}
      className="flex items-center justify-between p-4 border-l-4 border-purple-500 bg-gradient-to-r from-purple-50 to-white rounded-lg hover:shadow-lg cursor-pointer transition-all hover:translate-x-1"
    >
      <div className="flex-1">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-lg font-bold text-purple-600">
            {index + 1}.
          </span>
          <h3 className="text-lg font-semibold text-gray-800">
            {delivery.customer}
          </h3>
        </div>
        
        <div className="space-y-1 text-sm text-gray-600">
          <div className="flex items-center gap-2">
            <MapPin className="w-4 h-4" />
            {delivery.address}
          </div>
          <div className="flex items-center gap-2">
            <Package className="w-4 h-4" />
            {delivery.items}
          </div>
          <div className="flex items-center gap-2">
            <Phone className="w-4 h-4" />
            {delivery.phone}
          </div>
          <div className="flex items-center gap-2">
            <Navigation className="w-4 h-4" />
            <span className="font-semibold text-purple-600">
              {delivery.distanceFromWarehouse.toFixed(1)} km from warehouse
            </span>
          </div>
        </div>
      </div>

      <div className="text-right space-y-2">
        <StatusBadge status={delivery.status} />
        <div className={`inline-block px-3 py-1 rounded-full text-xs font-semibold ${
          delivery.priority === 1 ? 'bg-red-100 text-red-800' :
          delivery.priority === 2 ? 'bg-orange-100 text-orange-800' :
          'bg-blue-100 text-blue-800'
        }`}>
          Priority {delivery.priority}
        </div>
        <div className="text-xs text-gray-500 mt-1">
          {delivery.priorityLabel}
        </div>
      </div>
    </div>
  );
}

