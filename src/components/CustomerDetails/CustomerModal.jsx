import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom';
import { X } from 'lucide-react';
import api from '../../frontend/apiClient';
import useDeliveryStore from '../../store/useDeliveryStore';
import MultipleFileUpload from './MultipleFileUpload';
import SignaturePad from './SignaturePad';
import StatusUpdateForm from './StatusUpdateForm';
import { geocodeAddress } from '../../services/geocodingService';

export default function CustomerModal({ isOpen, onClose, onSaveContactSuccess, onSaveContactError }) {
  const selectedDelivery = useDeliveryStore((state) => state.selectedDelivery);
  const updateDeliveryStatus = useDeliveryStore((state) => state.updateDeliveryStatus);
  const updateDeliveryContact = useDeliveryStore((state) => state.updateDeliveryContact);
  
  const [driverSignature, setDriverSignature] = useState('');
  const [customerSignature, setCustomerSignature] = useState('');
  const [photos, setPhotos] = useState([]);
  const [status, setStatus] = useState('');
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [editAddress, setEditAddress] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [isSavingContact, setIsSavingContact] = useState(false);
  const [contactError, setContactError] = useState('');
  const [contactSaved, setContactSaved] = useState(false);

  useEffect(() => {
    if (selectedDelivery) {
      setEditAddress(selectedDelivery.address || '');
      setEditPhone(selectedDelivery.phone || '');
      setContactError('');
      setContactSaved(false);
    }
  }, [selectedDelivery]);

  if (!isOpen || !selectedDelivery) return null;

  const handleSaveContact = async () => {
    if (!editAddress && !editPhone) {
      setContactError('Please provide at least an address or phone number');
      return;
    }

    setIsSavingContact(true);
    setContactError('');
    setContactSaved(false);

    try {
      let geo = null;

      // Only geocode when address actually changed
      if (editAddress && editAddress.trim() !== (selectedDelivery.address || '').trim()) {
        geo = await geocodeAddress(editAddress, 'Dubai, UAE');
      }

      const payload = {
        customer: selectedDelivery.customer,
        address: editAddress,
        phone: editPhone,
      };

      if (geo && geo.lat != null && geo.lng != null) {
        payload.lat = geo.lat;
        payload.lng = geo.lng;
      }

      const response = await api.put(`/deliveries/admin/${selectedDelivery.id}/contact`, payload);
      const updated = response.data?.delivery || {};

      updateDeliveryContact(selectedDelivery.id, {
        customer: updated.customer ?? payload.customer,
        address: updated.address ?? payload.address,
        phone: updated.phone ?? payload.phone,
        lat: updated.lat ?? payload.lat,
        lng: updated.lng ?? payload.lng,
      });

      setContactSaved(true);
      const message = 'Contact saved and route recalculated.';
      onSaveContactSuccess?.(message);

      // Notify other dashboards / map views
      window.dispatchEvent(new CustomEvent('deliveriesUpdated', {
        detail: { updatedId: selectedDelivery.id }
      }));
    } catch (error) {
      console.error('[CustomerModal] Error updating contact:', error);
      const errMsg =
        error.response?.data?.detail ||
        error.response?.data?.error ||
        error.message ||
        'Failed to update contact details';
      setContactError(errMsg);
      onSaveContactError?.(errMsg);
    } finally {
      setIsSavingContact(false);
    }
  };

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
        actualTime: new Date().toISOString(),
        customer: selectedDelivery.customer,
        address: selectedDelivery.address
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

  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget) onClose();
  };

  const shortId = selectedDelivery.id?.length > 12
    ? `${selectedDelivery.id.slice(0, 8)}…`
    : selectedDelivery.id;

  return ReactDOM.createPortal(
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-[9999] p-0 sm:p-4"
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="delivery-confirmation-title"
    >
      <div
        className="bg-white dark:bg-gray-900 shadow-2xl max-w-4xl w-full h-full sm:h-auto sm:max-h-[90vh] flex flex-col transition-colors rounded-none sm:rounded-lg min-h-0"
        style={{ maxHeight: '100dvh' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Sticky Header - does not scroll, touch-friendly close */}
        <div className="flex-shrink-0 flex items-center justify-between gap-2 px-3 py-3 sm:p-4 sm:px-6 border-b border-primary-700/60 bg-gradient-to-r from-primary-600 to-primary-700 text-white rounded-t-none sm:rounded-t-lg">
          <h2 id="delivery-confirmation-title" className="text-base sm:text-xl lg:text-2xl font-bold truncate min-w-0 flex-1">
            Delivery Confirmation
          </h2>
          <button type="button" onClick={onClose} className="flex-shrink-0 hover:bg-primary-800/90 p-2.5 sm:p-2 rounded-lg touch-manipulation min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 flex items-center justify-center" aria-label="Close">
            <X className="w-5 h-5 sm:w-6 sm:h-6" />
          </button>
        </div>

        {/* Scrollable body only - comfortable padding on all screens */}
        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-3 sm:p-6 space-y-4 sm:space-y-6 bg-gray-50 dark:bg-gray-900 transition-colors">
          {/* Error Message */}
          {submitError && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 sm:p-4 flex items-start gap-3">
              <div className="flex-shrink-0 text-red-600 dark:text-red-400 font-semibold">⚠</div>
              <p className="text-sm text-red-700 dark:text-red-300">{submitError}</p>
            </div>
          )}

          {/* Customer Details */}
          <div className="bg-primary-50 dark:bg-primary-900/20 rounded-lg p-3 sm:p-4 space-y-2">
            <h3 className="text-base sm:text-xl font-bold text-primary-800 dark:text-primary-300 mb-3 sm:mb-4 break-words">
              <span className="text-primary-600 dark:text-primary-400 font-medium">Stop </span>
              <span className="truncate sm:inline" title={selectedDelivery.id}>{shortId}</span>
              {': '}{selectedDelivery.customer}
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 text-sm">
              <div>
                <span className="font-semibold text-gray-700 dark:text-gray-200">Address:</span>
                <textarea
                  value={editAddress}
                  onChange={(e) => { setEditAddress(e.target.value); setContactSaved(false); }}
                  rows={2}
                  className="mt-1 w-full px-2 py-1.5 rounded-md border border-primary-200 dark:border-primary-700 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary-500"
                  placeholder="Delivery address"
                />
              </div>
              <div>
                <span className="font-semibold text-gray-700 dark:text-gray-200">Phone:</span>
                <input
                  type="tel"
                  value={editPhone}
                  onChange={(e) => { setEditPhone(e.target.value); setContactSaved(false); }}
                  className="mt-1 w-full px-2 py-1.5 rounded-md border border-primary-200 dark:border-primary-700 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  placeholder="Customer phone number"
                />
              </div>
              <div>
                <span className="font-semibold text-gray-700 dark:text-gray-200">Items:</span>
                <p className="text-gray-600 dark:text-gray-300 break-words">{selectedDelivery.items}</p>
              </div>
              <div>
                <span className="font-semibold text-gray-700 dark:text-gray-200">Distance:</span>
                <p className="text-gray-600 dark:text-gray-300">
                  {(selectedDelivery.distanceFromWarehouse ?? 0).toFixed(1)} km
                </p>
              </div>
            </div>

            {contactError && (
              <div className="mt-2 text-xs text-red-700 dark:text-red-300">
                ⚠ {contactError}
              </div>
            )}
            {contactSaved && !contactError && (
              <div className="mt-2 text-xs text-green-700 dark:text-green-400 font-medium">
                ✓ Contact details saved and route updated
              </div>
            )}

            <div className="mt-3 flex justify-end">
              <button
                type="button"
                onClick={handleSaveContact}
                disabled={isSavingContact}
                className="px-4 py-3 sm:px-3 sm:py-1.5 text-xs sm:text-sm rounded-lg bg-white text-primary-700 border border-primary-300 hover:bg-primary-50 disabled:opacity-60 disabled:cursor-not-allowed dark:bg-gray-800 dark:text-primary-300 dark:border-primary-700 dark:hover:bg-primary-900/30 touch-manipulation min-h-[44px] sm:min-h-0"
              >
                {isSavingContact ? 'Saving…' : 'Save Contact & Recalculate Route'}
              </button>
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

          {/* Submit Button - touch-friendly on mobile */}
          <button
            onClick={handleSubmit}
            disabled={!status || !driverSignature || !customerSignature || isSubmitting}
            className="w-full py-3.5 sm:py-3 min-h-[48px] bg-gradient-to-r from-primary-600 to-primary-700 text-white font-bold rounded-lg hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed transition-all touch-manipulation text-base sm:text-base"
          >
            {isSubmitting ? '⏳ Updating...' : '✓ Complete Delivery'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

