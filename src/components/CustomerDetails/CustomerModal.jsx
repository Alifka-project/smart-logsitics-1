import React, { useState } from 'react';
import { X } from 'lucide-react';
import api from '../../frontend/apiClient';
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
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  if (!isOpen || !selectedDelivery) return null;

  const handleSubmit = async () => {
    setIsSubmitting(true);
    setSubmitError('');

    if (!status) {
      setSubmitError('Please select a status');
      setIsSubmitting(false);
      return;
    }

    if (!driverSignature || !customerSignature) {
      setSubmitError('Please provide both driver and customer signatures');
      setIsSubmitting(false);
      return;
    }

    try {
      console.log('[CustomerModal] Starting status update...');
      console.log('[CustomerModal] Delivery ID:', selectedDelivery.id);
      console.log('[CustomerModal] Status:', status);
      
      // Update to database via API
      const response = await api.put(`/deliveries/admin/${selectedDelivery.id}/status`, {
        status: status,
        notes: notes,
        driverSignature: driverSignature,
        customerSignature: customerSignature,
        photos: photos,
        actualTime: new Date().toISOString()
      });

      console.log('[CustomerModal] API Response:', response.data);

      if (response.data && response.data.ok) {
        console.log('[CustomerModal] ✓✓✓ Delivery status updated successfully in database');
        console.log('[CustomerModal] Updated delivery:', response.data.delivery);
        
        // Also update local store for UI feedback
        updateDeliveryStatus(selectedDelivery.id, status, {
          driverSignature,
          customerSignature,
          photos,
          notes,
          actualTime: new Date(),
        });

        // Dispatch event to notify dashboard of changes
        window.dispatchEvent(new CustomEvent('deliveryStatusUpdated', {
          detail: {
            deliveryId: selectedDelivery.id,
            status: status,
            updatedAt: new Date()
          }
        }));

        console.log('[CustomerModal] Event dispatched: deliveryStatusUpdated');
        
        // Show success message briefly before closing
        setTimeout(() => {
          // Reset form
          setDriverSignature('');
          setCustomerSignature('');
          setPhotos([]);
          setStatus('');
          setNotes('');
          onClose();
        }, 500);
      } else {
        console.error('[CustomerModal] API response not ok:', response.data);
        setSubmitError(response.data?.error || 'Failed to update delivery status');
      }
    } catch (error) {
      console.error('[CustomerModal] Error updating delivery status:', error);
      console.error('[CustomerModal] Error details:', {
        message: error.message,
        response: error.response?.data,
        status: error.response?.status,
        config: error.config
      });
      setSubmitError(
        error.response?.data?.detail || 
        error.response?.data?.error || 
        error.message ||
        'Failed to update delivery status'
      );
    } finally {
      setIsSubmitting(false);
    }
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
          {/* Error Message */}
          {submitError && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 sm:p-4 flex items-start gap-3">
              <div className="flex-shrink-0 text-red-600 dark:text-red-400 font-semibold">⚠</div>
              <p className="text-sm text-red-700 dark:text-red-300">{submitError}</p>
            </div>
          )}

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
            disabled={!status || !driverSignature || !customerSignature || isSubmitting}
            className="w-full py-3 bg-gradient-to-r from-primary-600 to-primary-700 text-white font-bold rounded-lg hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            {isSubmitting ? '⏳ Updating...' : '✓ Complete Delivery'}
          </button>
        </div>
      </div>
    </div>
  );
}

