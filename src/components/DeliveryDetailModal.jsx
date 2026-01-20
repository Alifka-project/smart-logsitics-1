import React, { useState, useEffect } from 'react';
import { X, Camera, Signature, Edit2, Save, X as XIcon } from 'lucide-react';
import api from '../frontend/apiClient';

export default function DeliveryDetailModal({ delivery, isOpen, onClose, onStatusUpdate }) {
  const [isEditing, setIsEditing] = useState(false);
  const [newStatus, setNewStatus] = useState(delivery?.status || 'pending');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [podImage, setPodImage] = useState(null);
  const [signature, setSignature] = useState(null);

  useEffect(() => {
    if (delivery && isOpen) {
      setNewStatus(delivery.status || 'pending');
      setPodImage(delivery.proofOfDelivery?.image || delivery.podImage || null);
      setSignature(delivery.signature || delivery.podSignature || null);
    }
  }, [delivery, isOpen]);

  const handleStatusUpdate = async () => {
    setLoading(true);
    setError('');
    
    try {
      const response = await api.put(`/admin/delivery/${delivery.id || delivery.ID}/status`, {
        status: newStatus
      });
      
      if (response.data.success) {
        setIsEditing(false);
        if (onStatusUpdate) {
          onStatusUpdate(delivery.id || delivery.ID, newStatus);
        }
      } else {
        setError(response.data.message || 'Failed to update status');
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Error updating delivery status');
      console.error('Error updating status:', err);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen || !delivery) return null;

  const status = (delivery.status || 'pending').toLowerCase();
  const statusColors = {
    delivered: 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300',
    pending: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300',
    cancelled: 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300',
    'out-for-delivery': 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300',
    'delivered-without-installation': 'bg-orange-100 dark:bg-orange-900/30 text-orange-800 dark:text-orange-300',
    default: 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-300'
  };

  const statusOptions = ['pending', 'out-for-delivery', 'delivered', 'delivered-without-installation', 'cancelled'];

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-4 flex items-center justify-between">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            Delivery Details
          </h2>
          <button
            onClick={onClose}
            className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
          >
            <X size={24} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Error Message */}
          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
              <p className="text-red-800 dark:text-red-300">{error}</p>
            </div>
          )}

          {/* Basic Information */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                Delivery ID
              </label>
              <p className="text-gray-900 dark:text-gray-100 font-mono">
                #{String(delivery.id || delivery.ID || 'N/A').slice(0, 12)}
              </p>
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                Customer
              </label>
              <p className="text-gray-900 dark:text-gray-100">
                {delivery.customer || delivery.Customer || delivery.customerName || 'N/A'}
              </p>
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                Driver
              </label>
              <p className="text-gray-900 dark:text-gray-100">
                {delivery.driverName || 'Unassigned'}
              </p>
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                Date
              </label>
              <p className="text-gray-900 dark:text-gray-100">
                {delivery.created_at || delivery.createdAt || delivery.created
                  ? new Date(delivery.created_at || delivery.createdAt || delivery.created).toLocaleString()
                  : 'N/A'}
              </p>
            </div>
          </div>

          {/* Delivery Address */}
          {(delivery.address || delivery.deliveryAddress) && (
            <div>
              <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                Delivery Address
              </label>
              <p className="text-gray-900 dark:text-gray-100">
                {delivery.address || delivery.deliveryAddress}
              </p>
            </div>
          )}

          {/* Status Section */}
          <div className="border-t border-gray-200 dark:border-gray-700 pt-6">
            <div className="flex items-center justify-between mb-4">
              <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300">
                Status
              </label>
              {!isEditing && (
                <button
                  onClick={() => setIsEditing(true)}
                  className="flex items-center gap-2 text-primary-600 dark:text-primary-400 hover:underline text-sm"
                >
                  <Edit2 size={16} />
                  Edit
                </button>
              )}
            </div>

            {isEditing ? (
              <div className="space-y-4">
                <select
                  value={newStatus}
                  onChange={(e) => setNewStatus(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                >
                  {statusOptions.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt.charAt(0).toUpperCase() + opt.slice(1).replace(/-/g, ' ')}
                    </option>
                  ))}
                </select>

                <div className="flex gap-3">
                  <button
                    onClick={handleStatusUpdate}
                    disabled={loading || newStatus === delivery.status}
                    className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white rounded-lg transition-colors"
                  >
                    <Save size={16} />
                    {loading ? 'Saving...' : 'Save'}
                  </button>
                  <button
                    onClick={() => {
                      setIsEditing(false);
                      setNewStatus(delivery.status || 'pending');
                    }}
                    className="flex items-center gap-2 px-4 py-2 bg-gray-300 dark:bg-gray-600 hover:bg-gray-400 dark:hover:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg transition-colors"
                  >
                    <XIcon size={16} />
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <span className={`inline-block px-3 py-1 text-sm font-semibold rounded-full ${statusColors[status] || statusColors.default}`}>
                {delivery.status || 'Pending'}
              </span>
            )}
          </div>

          {/* POD Section */}
          {(podImage || signature) && (
            <div className="border-t border-gray-200 dark:border-gray-700 pt-6">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
                Proof of Delivery
              </h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* POD Image */}
                {podImage && (
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <Camera size={18} className="text-gray-600 dark:text-gray-400" />
                      <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                        POD Photo
                      </span>
                    </div>
                    <div className="relative bg-gray-100 dark:bg-gray-700 rounded-lg overflow-hidden">
                      <img
                        src={podImage}
                        alt="Proof of Delivery"
                        className="w-full h-auto max-h-96 object-cover"
                        onError={(e) => {
                          e.target.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"%3E%3Crect fill="%23e5e7eb" width="400" height="300"/%3E%3Ctext x="50%25" y="50%25" text-anchor="middle" dy=".3em" fill="%23999" font-family="Arial" font-size="20"%3EImage not available%3C/text%3E%3C/svg%3E';
                        }}
                      />
                    </div>
                  </div>
                )}

                {/* Signature */}
                {signature && (
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <Signature size={18} className="text-gray-600 dark:text-gray-400" />
                      <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                        Signature
                      </span>
                    </div>
                    <div className="bg-gray-100 dark:bg-gray-700 rounded-lg overflow-hidden">
                      <img
                        src={signature}
                        alt="Delivery Signature"
                        className="w-full h-auto max-h-96 object-cover"
                        onError={(e) => {
                          e.target.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"%3E%3Crect fill="%23e5e7eb" width="400" height="300"/%3E%3Ctext x="50%25" y="50%25" text-anchor="middle" dy=".3em" fill="%23999" font-family="Arial" font-size="20"%3ESignature not available%3C/text%3E%3C/svg%3E';
                        }}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Additional Details */}
          {(delivery.notes || delivery.specialInstructions) && (
            <div className="border-t border-gray-200 dark:border-gray-700 pt-6">
              <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                Notes
              </label>
              <p className="text-gray-900 dark:text-gray-100">
                {delivery.notes || delivery.specialInstructions}
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-gray-200 dark:border-gray-700 px-6 py-4 bg-gray-50 dark:bg-gray-700/50 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-300 dark:bg-gray-600 hover:bg-gray-400 dark:hover:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
