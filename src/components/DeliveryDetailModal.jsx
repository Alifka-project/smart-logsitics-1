import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { X, Camera, Signature, Loader } from 'lucide-react';
import api from '../frontend/apiClient';

export default function DeliveryDetailModal({ delivery, isOpen, onClose, onStatusUpdate }) {
  const [newStatus, setNewStatus] = useState(delivery?.status || 'pending');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [podPhotos, setPodPhotos] = useState([]);
  const [driverSignature, setDriverSignature] = useState(null);
  const [customerSignature, setCustomerSignature] = useState(null);
  const [podFetched, setPodFetched] = useState(false);
  const [podLoading, setPodLoading] = useState(false);

  useEffect(() => {
    if (delivery && isOpen) {
      setNewStatus(delivery.status || 'pending');
      setError('');
      setSuccess('');
      setPodFetched(false);
      // Use inline POD if present
      const photos = delivery.photos && Array.isArray(delivery.photos) ? delivery.photos : [];
      const firstPhoto = photos[0];
      const firstPhotoData = typeof firstPhoto === 'string' ? firstPhoto : (firstPhoto?.data || null);
      if (firstPhotoData || delivery.driverSignature || delivery.customerSignature) {
        setPodPhotos(photos.map((p) => (typeof p === 'string' ? p : (p?.data || p))).filter(Boolean));
        setDriverSignature(delivery.driverSignature || null);
        setCustomerSignature(delivery.customerSignature || null);
        setPodFetched(true);
      } else if (delivery.id || delivery.ID) {
        setPodLoading(true);
        api.get(`/deliveries/${delivery.id || delivery.ID}/pod`)
          .then((res) => {
            if (res.data?.ok && res.data?.pod) {
              const pod = res.data.pod;
              const photoList = (pod.photos && Array.isArray(pod.photos))
                ? pod.photos.map((p) => (typeof p === 'string' ? p : (p?.data || p))).filter(Boolean)
                : [];
              setPodPhotos(photoList);
              setDriverSignature(pod.driverSignature || null);
              setCustomerSignature(pod.customerSignature || null);
            }
          })
          .catch(() => {})
          .finally(() => {
            setPodLoading(false);
            setPodFetched(true);
          });
      } else {
        setPodFetched(true);
      }
    }
  }, [delivery, isOpen]);

  const handleStatusChange = async (newStatusValue) => {
    setNewStatus(newStatusValue);
    setLoading(true);
    setError('');
    setSuccess('');
    
    try {
      const response = await api.put(`/deliveries/admin/${delivery.id || delivery.ID}/status`, {
        status: newStatusValue
      });
      
      if (response.data.success || response.status === 200) {
        setSuccess('Status updated successfully!');
        setTimeout(() => setSuccess(''), 3000);
        window.dispatchEvent(new CustomEvent('deliveryStatusUpdated', {
          detail: { deliveryId: delivery.id || delivery.ID, newStatus: newStatusValue }
        }));
        if (onStatusUpdate) {
          onStatusUpdate(delivery.id || delivery.ID, newStatusValue);
        }
      } else {
        setError(response.data.message || 'Failed to update status');
        setNewStatus(delivery.status || 'pending');
      }
    } catch (err) {
      const errorMsg = err.response?.data?.message || err.message || 'Error updating delivery status';
      setError(errorMsg);
      setNewStatus(delivery.status || 'pending');
      console.error('Error updating status:', err);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen || !delivery) return null;

  const status = (delivery.status || 'pending').toLowerCase();
  const statusColors = {
    delivered: 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300 border-green-300 dark:border-green-700',
    pending: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300 border-yellow-300 dark:border-yellow-700',
    cancelled: 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300 border-red-300 dark:border-red-700',
    'out-for-delivery': 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300 border-blue-300 dark:border-blue-700',
    'delivered-without-installation': 'bg-orange-100 dark:bg-orange-900/30 text-orange-800 dark:text-orange-300 border-orange-300 dark:border-orange-700',
    default: 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-300 border-gray-300 dark:border-gray-600'
  };

  const statusOptions = ['pending', 'out-for-delivery', 'delivered', 'delivered-without-installation', 'cancelled'];

  const modalContent = (
    <div 
      className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" 
      style={{
        zIndex: 9998,
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0
      }}
      onClick={onClose}
    >
      <div 
        className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto transform transition-all"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-gradient-to-r from-blue-600 to-blue-700 dark:from-blue-800 dark:to-blue-900 border-b border-blue-200 dark:border-blue-700 px-6 py-5 flex items-center justify-between rounded-t-lg">
          <h2 className="text-2xl font-bold text-white">
            Delivery Details
          </h2>
          <button
            onClick={onClose}
            className="text-white hover:text-blue-100 transition-colors"
          >
            <X size={24} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Success Message */}
          {success && (
            <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4">
              <p className="text-green-800 dark:text-green-300 font-medium">✓ {success}</p>
            </div>
          )}

          {/* Error Message */}
          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
              <p className="text-red-800 dark:text-red-300 font-medium">✕ {error}</p>
            </div>
          )}

          {/* Basic Information */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-gray-50 dark:bg-gray-700/30 p-4 rounded-lg border border-gray-200 dark:border-gray-700">
              <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide mb-2">
                PO Number
              </label>
              <p className="text-gray-900 dark:text-gray-100 font-mono text-lg">
                {delivery.poNumber || delivery.PONumber || 'N/A'}
              </p>
            </div>

            <div className="bg-gray-50 dark:bg-gray-700/30 p-4 rounded-lg border border-gray-200 dark:border-gray-700">
              <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide mb-2">
                Customer
              </label>
              <p className="text-gray-900 dark:text-gray-100 font-medium">
                {delivery.customer || delivery.Customer || delivery.customerName || 'N/A'}
              </p>
            </div>

            <div className="bg-gray-50 dark:bg-gray-700/30 p-4 rounded-lg border border-gray-200 dark:border-gray-700">
              <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide mb-2">
                Driver
              </label>
              <p className="text-gray-900 dark:text-gray-100 font-medium">
                {delivery.driverName || 'Unassigned'}
              </p>
            </div>

            <div className="bg-gray-50 dark:bg-gray-700/30 p-4 rounded-lg border border-gray-200 dark:border-gray-700">
              <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide mb-2">
                Date
              </label>
              <p className="text-gray-900 dark:text-gray-100 font-medium">
                {delivery.created_at || delivery.createdAt || delivery.created
                  ? new Date(delivery.created_at || delivery.createdAt || delivery.created).toLocaleString()
                  : 'N/A'}
              </p>
            </div>
          </div>

          {/* Delivery Address */}
          {(delivery.address || delivery.deliveryAddress) && (
            <div className="bg-gray-50 dark:bg-gray-700/30 p-4 rounded-lg border border-gray-200 dark:border-gray-700">
              <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide mb-2">
                📍 Delivery Address
              </label>
              <p className="text-gray-900 dark:text-gray-100">
                {delivery.address || delivery.deliveryAddress}
              </p>
            </div>
          )}

          {/* Status Section - Direct Dropdown */}
          <div className="bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 p-6 rounded-lg border border-blue-200 dark:border-blue-700">
            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2">
              <span>📦 Delivery Status</span>
              {loading && <Loader size={16} className="animate-spin text-blue-600" />}
            </label>

            <select
              value={newStatus}
              onChange={(e) => handleStatusChange(e.target.value)}
              disabled={loading}
              className="w-full px-4 py-3 border-2 border-blue-300 dark:border-blue-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 font-medium focus:outline-none focus:border-blue-500 dark:focus:border-blue-400 transition-colors disabled:opacity-50"
            >
              {statusOptions.map((opt) => (
                <option key={opt} value={opt}>
                  {opt.charAt(0).toUpperCase() + opt.slice(1).replace(/-/g, ' ')}
                </option>
              ))}
            </select>
          </div>

          {/* POD Section - photos and signatures from DB */}
          {(podLoading || podPhotos.length > 0 || driverSignature || customerSignature || podFetched) && (
            <div className="border-t border-gray-200 dark:border-gray-700 pt-6">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4 flex items-center gap-2">
                <Signature size={20} className="text-blue-600" />
                Proof of Delivery
                {podLoading && <Loader size={18} className="animate-spin text-blue-600" />}
              </h3>

              {podLoading && podPhotos.length === 0 && !driverSignature && !customerSignature && (
                <p className="text-sm text-gray-500 dark:text-gray-400">Loading POD data...</p>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* POD Photos (all uploaded images) */}
                {podPhotos.length > 0 && (
                  <div className="md:col-span-2">
                    <div className="flex items-center gap-2 mb-3">
                      <Camera size={18} className="text-blue-600 dark:text-blue-400" />
                      <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                        POD Photos ({podPhotos.length})
                      </span>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      {podPhotos.map((src, idx) => (
                        <div key={idx} className="relative bg-gray-100 dark:bg-gray-700 rounded-lg overflow-hidden border-2 border-gray-300 dark:border-gray-600">
                          <img
                            src={src}
                            alt={`POD ${idx + 1}`}
                            className="w-full h-40 object-cover"
                            onError={(e) => {
                              e.target.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"%3E%3Crect fill="%23e5e7eb" width="400" height="300"/%3E%3Ctext x="50%25" y="50%25" text-anchor="middle" dy=".3em" fill="%23999" font-size="16"%3EImage not available%3C/text%3E%3C/svg%3E';
                            }}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Driver Signature */}
                {driverSignature && (
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <Signature size={18} className="text-blue-600 dark:text-blue-400" />
                      <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                        Driver Signature
                      </span>
                    </div>
                    <div className="bg-gray-100 dark:bg-gray-700 rounded-lg overflow-hidden border-2 border-gray-300 dark:border-gray-600">
                      <img
                        src={driverSignature}
                        alt="Driver signature"
                        className="w-full h-auto max-h-48 object-contain"
                        onError={(e) => {
                          e.target.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200"%3E%3Crect fill="%23e5e7eb" width="400" height="200"/%3E%3Ctext x="50%25" y="50%25" text-anchor="middle" dy=".3em" fill="%23999" font-size="16"%3ESignature not available%3C/text%3E%3C/svg%3E';
                        }}
                      />
                    </div>
                  </div>
                )}

                {/* Customer Signature */}
                {customerSignature && (
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <Signature size={18} className="text-blue-600 dark:text-blue-400" />
                      <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                        Customer Signature
                      </span>
                    </div>
                    <div className="bg-gray-100 dark:bg-gray-700 rounded-lg overflow-hidden border-2 border-gray-300 dark:border-gray-600">
                      <img
                        src={customerSignature}
                        alt="Customer signature"
                        className="w-full h-auto max-h-48 object-contain"
                        onError={(e) => {
                          e.target.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200"%3E%3Crect fill="%23e5e7eb" width="400" height="200"/%3E%3Ctext x="50%25" y="50%25" text-anchor="middle" dy=".3em" fill="%23999" font-size="16"%3ESignature not available%3C/text%3E%3C/svg%3E';
                        }}
                      />
                    </div>
                  </div>
                )}
              </div>

              {!podLoading && podPhotos.length === 0 && !driverSignature && !customerSignature && (
                <p className="text-sm text-gray-500 dark:text-gray-400 italic">No POD uploaded yet.</p>
              )}
            </div>
          )}

          {/* Additional Details */}
          {(delivery.notes || delivery.specialInstructions) && (
            <div className="border-t border-gray-200 dark:border-gray-700 pt-6">
              <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                📝 Notes
              </label>
              <p className="text-gray-900 dark:text-gray-100 bg-gray-50 dark:bg-gray-700/30 p-3 rounded border border-gray-200 dark:border-gray-700">
                {delivery.notes || delivery.specialInstructions}
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-gray-200 dark:border-gray-700 px-6 py-4 bg-gray-50 dark:bg-gray-700/50 flex justify-end rounded-b-lg">
          <button
            onClick={onClose}
            className="px-6 py-2 bg-blue-600 hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-600 text-white font-medium rounded-lg transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );

  // Use React Portal to render modal at document root level
  if (!isOpen || !delivery) return null;
  return ReactDOM.createPortal(modalContent, document.body);
}
