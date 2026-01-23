import React, { useState } from 'react';
import { X, Send, Loader, CheckCircle, AlertCircle, MessageCircle, Link2 } from 'lucide-react';
import api from '../../frontend/apiClient';

export default function SMSConfirmationModal({ delivery, onClose, onSuccess }) {
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const [smsData, setSmsData] = useState(null);

  const handleSendSMS = async () => {
    try {
      setLoading(true);
      setError('');

      // Ensure delivery.id is properly formatted
      const deliveryId = String(delivery.id || delivery.ID).trim();
      
      if (!deliveryId) {
        setError('Delivery ID is missing');
        setLoading(false);
        return;
      }

      const response = await api.post(`/deliveries/${encodeURIComponent(deliveryId)}/send-sms`);
      
      setSmsData(response.data);
      setSuccess(true);

      // Call onSuccess callback
      if (onSuccess) {
        onSuccess(response.data);
      }
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Failed to send SMS');
      console.error('SMS error:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg shadow-2xl max-w-md w-full">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b">
          <div className="flex items-center gap-3">
            <MessageCircle className="w-6 h-6 text-blue-600" />
            <h2 className="text-xl font-bold">Send Confirmation SMS</h2>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          {!success ? (
            <>
              {/* Delivery Info */}
              <div className="bg-gray-50 p-4 rounded-lg space-y-2">
                <div>
                  <p className="text-sm text-gray-600">Customer</p>
                  <p className="font-semibold text-gray-800">{delivery.customer}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Phone</p>
                  <p className="font-semibold text-gray-800">{delivery.phone}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Address</p>
                  <p className="font-semibold text-gray-800 text-sm">{delivery.address}</p>
                </div>
              </div>

              {/* SMS Message Preview */}
              <div>
                <p className="text-sm font-semibold text-gray-700 mb-2">Message Preview:</p>
                <div className="bg-blue-50 border border-blue-200 p-3 rounded-lg text-sm text-gray-700 space-y-2">
                  <p>Hi {delivery.customer || 'there'},</p>
                  <p>Your order from Electrolux is ready for delivery confirmation.</p>
                  <p>Click to confirm and select your delivery date:</p>
                  <p className="text-blue-600 font-semibold break-all">[Confirmation Link]</p>
                  <p>This link expires in 48 hours.</p>
                </div>
              </div>

              {error && (
                <div className="bg-red-50 border border-red-200 p-3 rounded-lg flex items-start gap-2">
                  <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-red-700">{error}</p>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex gap-3 pt-2">
                <button
                  onClick={onClose}
                  className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors font-semibold"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSendSMS}
                  disabled={loading}
                  className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white rounded-lg transition-colors font-semibold flex items-center justify-center gap-2"
                >
                  {loading ? (
                    <>
                      <Loader className="w-4 h-4 animate-spin" />
                      Sending...
                    </>
                  ) : (
                    <>
                      <Send className="w-4 h-4" />
                      Send SMS
                    </>
                  )}
                </button>
              </div>
            </>
          ) : (
            <>
              {/* Success State */}
              <div className="text-center py-4">
                <div className="flex justify-center mb-4">
                  <div className="bg-green-100 p-3 rounded-full">
                    <CheckCircle className="w-8 h-8 text-green-600" />
                  </div>
                </div>
                
                <h3 className="text-lg font-bold text-gray-800 mb-2">SMS Sent Successfully!</h3>
                
                <div className="bg-green-50 border border-green-200 p-4 rounded-lg space-y-3 mb-4 text-left">
                  <div>
                    <p className="text-xs text-gray-600 mb-1">Confirmation Link Expires:</p>
                    <p className="text-sm font-semibold text-gray-800">
                      {smsData?.expiresAt ? new Date(smsData.expiresAt).toLocaleString() : '48 hours from now'}
                    </p>
                  </div>
                  
                  {smsData?.token && (
                    <div>
                      <p className="text-xs text-gray-600 mb-1 flex items-center gap-1">
                        <Link2 className="w-3 h-3" />
                        Share Link (copy-paste):
                      </p>
                      <input
                        type="text"
                        value={`${window.location.origin}/confirm-delivery/${smsData.token}`}
                        readOnly
                        className="w-full text-xs px-2 py-1 border border-green-300 bg-white rounded font-mono"
                      />
                    </div>
                  )}
                </div>

                <p className="text-sm text-gray-600 mb-4">
                  Customer will receive the confirmation link via SMS to {delivery.phone}
                </p>
              </div>

              {/* Close Button */}
              <button
                onClick={onClose}
                className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors font-semibold"
              >
                Done
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
