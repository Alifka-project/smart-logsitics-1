import React, { useState } from 'react';
import { X } from 'lucide-react';
import useDeliveryStore from '../../store/useDeliveryStore';
import MultipleFileUpload from './MultipleFileUpload';
import SignaturePad from './SignaturePad';
import StatusUpdateForm from './StatusUpdateForm';

export default function CustomerModal({ isOpen, onClose }) {
  const selectedDelivery = useDeliveryStore((state) => state.selectedDelivery);
  const updateDeliveryStatus = useDeliveryStore((state) => state.updateDeliveryStatus);
  
  const [driverSignature, setDriverSignature] = useState('');
  const [customerSignature, setCustomerSignature] = useState('');
  const [photos, setPhotos] = useState([]);
  const [status, setStatus] = useState('');
  const [notes, setNotes] = useState('');

  if (!isOpen || !selectedDelivery) return null;

  const handleSubmit = () => {
    updateDeliveryStatus(selectedDelivery.id, status, {
      driverSignature,
      customerSignature,
      photos,
      notes,
      actualTime: new Date(),
    });
    
    // Reset form
    setDriverSignature('');
    setCustomerSignature('');
    setPhotos([]);
    setStatus('');
    setNotes('');
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-2 sm:p-4">
      <div className="bg-white dark:bg-gray-900 rounded-lg shadow-2xl max-w-4xl w-full max-h-[95vh] sm:max-h-[90vh] overflow-y-auto transition-colors">
        {/* Header */}
        <div className="flex items-center justify-between p-4 sm:p-6 border-b border-primary-700/60 bg-gradient-to-r from-primary-600 to-primary-700 text-white">
          <h2 className="text-lg sm:text-xl lg:text-2xl font-bold">Delivery Confirmation</h2>
          <button onClick={onClose} className="hover:bg-primary-800/90 p-2 rounded transition-colors">
            <X className="w-5 h-5 sm:w-6 sm:h-6" />
          </button>
        </div>

        <div className="p-4 sm:p-6 space-y-4 sm:space-y-6 bg-gray-50 dark:bg-gray-900 transition-colors">
          {/* Customer Details */}
          <div className="bg-primary-50 dark:bg-primary-900/20 rounded-lg p-3 sm:p-4 space-y-2">
            <h3 className="text-lg sm:text-xl font-bold text-primary-800 dark:text-primary-300 mb-3 sm:mb-4">
              Stop {selectedDelivery.id}: {selectedDelivery.customer}
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 text-sm">
              <div>
                <span className="font-semibold text-gray-700 dark:text-gray-200">Address:</span>
                <p className="text-gray-600 dark:text-gray-300 break-words">{selectedDelivery.address}</p>
              </div>
              <div>
                <span className="font-semibold text-gray-700 dark:text-gray-200">Phone:</span>
                <p className="text-gray-600 dark:text-gray-300 break-all">
                  {selectedDelivery.phone && selectedDelivery.phone.trim() 
                    ? selectedDelivery.phone 
                    : <span className="text-gray-400 italic">Not available</span>}
                </p>
              </div>
              <div>
                <span className="font-semibold text-gray-700 dark:text-gray-200">Items:</span>
                <p className="text-gray-600 dark:text-gray-300 break-words">{selectedDelivery.items}</p>
              </div>
              <div>
                <span className="font-semibold text-gray-700 dark:text-gray-200">Distance:</span>
                <p className="text-gray-600 dark:text-gray-300">
                  {selectedDelivery.distanceFromWarehouse.toFixed(1)} km
                </p>
              </div>
            </div>
          </div>

          {/* Multiple Photos Upload */}
          <MultipleFileUpload
            photos={photos}
            setPhotos={setPhotos}
          />

          {/* Signatures */}
          <SignaturePad
            title="✍️ Driver Signature"
            value={driverSignature}
            onChange={setDriverSignature}
          />
          
          <SignaturePad
            title="✍️ Customer Signature"
            value={customerSignature}
            onChange={setCustomerSignature}
          />

          {/* Status Update */}
          <StatusUpdateForm
            status={status}
            setStatus={setStatus}
            notes={notes}
            setNotes={setNotes}
            deliveryStatus={selectedDelivery.status}
          />

          {/* Submit Button */}
          <button
            onClick={handleSubmit}
            disabled={!status || !driverSignature || !customerSignature}
            className="w-full py-3 bg-gradient-to-r from-primary-600 to-primary-700 text-white font-bold rounded-lg hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            ✓ Complete Delivery
          </button>
        </div>
      </div>
    </div>
  );
}

