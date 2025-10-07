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
      <div className="bg-white rounded-lg shadow-2xl max-w-4xl w-full max-h-[95vh] sm:max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-4 sm:p-6 border-b bg-gradient-to-r from-purple-600 to-purple-700 text-white">
          <h2 className="text-lg sm:text-xl lg:text-2xl font-bold">Delivery Confirmation</h2>
          <button onClick={onClose} className="hover:bg-purple-800 p-2 rounded">
            <X className="w-5 h-5 sm:w-6 sm:h-6" />
          </button>
        </div>

        <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
          {/* Customer Details */}
          <div className="bg-purple-50 rounded-lg p-3 sm:p-4 space-y-2">
            <h3 className="text-lg sm:text-xl font-bold text-purple-800 mb-3 sm:mb-4">
              Stop {selectedDelivery.id}: {selectedDelivery.customer}
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 text-sm">
              <div>
                <span className="font-semibold text-gray-700">Address:</span>
                <p className="text-gray-600 break-words">{selectedDelivery.address}</p>
              </div>
              <div>
                <span className="font-semibold text-gray-700">Phone:</span>
                <p className="text-gray-600 break-all">{selectedDelivery.phone}</p>
              </div>
              <div>
                <span className="font-semibold text-gray-700">Items:</span>
                <p className="text-gray-600 break-words">{selectedDelivery.items}</p>
              </div>
              <div>
                <span className="font-semibold text-gray-700">Distance:</span>
                <p className="text-gray-600">
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
          />

          {/* Submit Button */}
          <button
            onClick={handleSubmit}
            disabled={!status || !driverSignature || !customerSignature}
            className="w-full py-3 bg-gradient-to-r from-purple-600 to-purple-700 text-white font-bold rounded-lg hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            ✓ Complete Delivery
          </button>
        </div>
      </div>
    </div>
  );
}

