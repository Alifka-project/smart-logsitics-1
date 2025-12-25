import React from 'react';
import { MapPin, Package, Phone, Navigation, GripVertical } from 'lucide-react';
import StatusBadge from './StatusBadge';

export default function DeliveryCard({ 
  delivery, 
  index, 
  onClick,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  isDragging,
  isDragOver
}) {
  return (
    <div
      draggable
      onDragStart={() => onDragStart?.(index)}
      onDragOver={() => onDragOver?.(index)}
      onDragLeave={onDragLeave}
      onDrop={() => onDrop?.(index)}
      onClick={onClick}
      className={`flex flex-col sm:flex-row sm:items-center justify-between p-3 sm:p-4 border-l-4 rounded-lg transition-all cursor-move ${
        isDragging
          ? 'opacity-50 bg-primary-100 border-primary-400'
          : isDragOver
          ? 'bg-primary-50 border-primary-500 shadow-md scale-105'
          : 'border-primary-500 bg-gradient-to-r from-primary-50 to-white hover:shadow-lg hover:translate-x-1'
      }`}
    >
      {/* Drag Handle - Mobile optimized */}
      <div className="flex items-center gap-2 mb-2 sm:mb-0 sm:mr-3 flex-shrink-0">
        <GripVertical className="w-4 h-4 sm:w-5 sm:h-5 text-gray-400 hover:text-gray-600 transition-colors" />
        <span className="text-base sm:text-lg font-bold text-primary-600 w-6">
          {index + 1}.
        </span>
      </div>

      {/* Main Content */}
      <div className="flex-1 mb-3 sm:mb-0">
        <h3 className="text-sm sm:text-lg font-semibold text-gray-800 mb-2">
          {delivery.customer}
        </h3>
        
        <div className="space-y-1 text-xs sm:text-sm text-gray-600">
          <div className="flex items-start gap-2">
            <MapPin className="w-3 h-3 sm:w-4 sm:h-4 mt-0.5 flex-shrink-0" />
            <span className="break-words">{delivery.address}</span>
          </div>
          <div className="flex items-start gap-2">
            <Package className="w-3 h-3 sm:w-4 sm:h-4 mt-0.5 flex-shrink-0" />
            <span className="break-words">{delivery.items}</span>
          </div>
          {delivery.phone && (
            <div className="flex items-center gap-2">
              <Phone className="w-3 h-3 sm:w-4 sm:h-4 flex-shrink-0" />
              <span className="break-all">{delivery.phone}</span>
            </div>
          )}
          <div className="flex items-center gap-2">
            <Navigation className="w-3 h-3 sm:w-4 sm:h-4 flex-shrink-0" />
            <span className="font-semibold text-primary-600">
              {delivery.distanceFromWarehouse.toFixed(1)} km
            </span>
          </div>
        </div>
      </div>

      {/* Status and Priority - Mobile optimized */}
      <div className="flex flex-row gap-2 sm:flex-col sm:text-right sm:space-y-2 sm:ml-3 flex-shrink-0">
        <StatusBadge status={delivery.status} />
        <div className={`px-2 sm:px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${
          delivery.priority === 1 ? 'bg-red-100 text-red-800' :
          delivery.priority === 2 ? 'bg-orange-100 text-orange-800' :
          'bg-blue-100 text-blue-800'
        }`}>
          P{delivery.priority}
        </div>
      </div>
    </div>
  );
}

