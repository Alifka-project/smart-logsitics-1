import React, { useState } from 'react';
import { MapPin, Package, Phone, Navigation, GripVertical, MessageCircle } from 'lucide-react';
import StatusBadge from './StatusBadge';
import SMSConfirmationModal from './SMSConfirmationModal';

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
  const [showSMSModal, setShowSMSModal] = useState(false);

  const handleSMSClick = (e) => {
    e.stopPropagation();
    if (delivery.phone) {
      setShowSMSModal(true);
    }
  };
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
          ? 'opacity-50 bg-primary-100 dark:bg-primary-900/30 border-primary-400 dark:border-primary-500'
          : isDragOver
          ? 'bg-primary-50 dark:bg-primary-900/20 border-primary-500 dark:border-primary-400 shadow-md scale-105'
          : 'border-primary-500 dark:border-primary-400 bg-gradient-to-r from-primary-50 dark:from-primary-900/20 to-white dark:to-gray-800 hover:shadow-lg hover:translate-x-1'
      }`}
    >
      {/* Drag Handle - Mobile optimized */}
      <div className="flex items-center gap-2 mb-2 sm:mb-0 sm:mr-3 flex-shrink-0">
        <GripVertical className="w-4 h-4 sm:w-5 sm:h-5 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-400 transition-colors" />
        <span className="text-base sm:text-lg font-bold text-primary-600 dark:text-primary-400 w-6">
          {index + 1}.
        </span>
      </div>

      {/* Main Content */}
      <div className="flex-1 mb-3 sm:mb-0">
        <h3 className="text-sm sm:text-lg font-semibold text-gray-800 dark:text-gray-100 mb-2">
          {delivery.customer}
        </h3>
        
        <div className="space-y-1 text-xs sm:text-sm text-gray-600 dark:text-gray-400">
          <div className="flex items-start gap-2">
            <MapPin className="w-3 h-3 sm:w-4 sm:h-4 mt-0.5 flex-shrink-0 text-gray-600 dark:text-gray-400" />
            <span className="break-words">{delivery.address}</span>
          </div>
          <div className="flex items-start gap-2">
            <Package className="w-3 h-3 sm:w-4 sm:h-4 mt-0.5 flex-shrink-0 text-gray-600 dark:text-gray-400" />
            <span className="break-words">{delivery.items}</span>
          </div>
          {delivery.phone && (
            <div className="flex items-center gap-2">
              <Phone className="w-3 h-3 sm:w-4 sm:h-4 flex-shrink-0 text-gray-600 dark:text-gray-400" />
              <span className="break-all">{delivery.phone}</span>
            </div>
          )}
          <div className="flex items-center gap-2">
            <Navigation className="w-3 h-3 sm:w-4 sm:h-4 flex-shrink-0 text-gray-600 dark:text-gray-400" />
            <span className="font-semibold text-primary-600 dark:text-primary-400">
              {delivery.distanceFromWarehouse.toFixed(1)} km
            </span>
          </div>
        </div>
      </div>

      {/* Status and Priority - Mobile optimized */}
      <div className="flex flex-row gap-2 sm:flex-col sm:text-right sm:space-y-2 sm:ml-3 flex-shrink-0">
        <StatusBadge status={delivery.status} />
        <div className={`px-2 sm:px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${
          delivery.priority === 1 ? 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300' :
          delivery.priority === 2 ? 'bg-orange-100 dark:bg-orange-900/30 text-orange-800 dark:text-orange-300' :
          'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300'
        }`}>
          P{delivery.priority}
        </div>
        
        {/* SMS Button */}
        {delivery.phone && (
          <button
            onClick={handleSMSClick}
            className="px-2 sm:px-3 py-1 bg-blue-500 hover:bg-blue-600 text-white rounded-full text-xs font-semibold flex items-center gap-1 whitespace-nowrap transition-colors"
            title="Send confirmation SMS"
          >
            <MessageCircle className="w-3 h-3 sm:w-4 sm:h-4" />
            <span className="hidden sm:inline">SMS</span>
          </button>
        )}
      </div>

      {/* SMS Modal */}
      {showSMSModal && (
        <SMSConfirmationModal
          delivery={delivery}
          onClose={() => setShowSMSModal(false)}
          onSuccess={() => {
            // Optional: refresh delivery status or show notification
            setTimeout(() => setShowSMSModal(false), 2000);
          }}
        />
      )}
    </div>
  );
}

