import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { X, Send, Loader, CheckCircle, AlertCircle, MessageCircle, Link2 } from 'lucide-react';
import api from '../../frontend/apiClient';

export default function SMSConfirmationModal({ delivery, onClose, onSuccess }) {
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const [smsData, setSmsData] = useState(null);

  // Prevent body scrolling when modal is open
  useEffect(() => {
    // Save current body overflow style
    const originalOverflow = document.body.style.overflow;
    const originalPaddingRight = document.body.style.paddingRight;
    
    // Get scrollbar width
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    
    // Prevent scrolling and add padding to prevent layout shift
    document.body.style.overflow = 'hidden';
    if (scrollbarWidth > 0) {
      document.body.style.paddingRight = `${scrollbarWidth}px`;
    }
    
    // Restore on cleanup
    return () => {
      document.body.style.overflow = originalOverflow;
      document.body.style.paddingRight = originalPaddingRight;
    };
  }, []);

  const handleSendSMS = async () => {
    try {
      setLoading(true);
      setError('');

      // Ensure delivery.id is properly formatted
      const deliveryId = String(delivery.id || delivery.ID || '').trim();
      
      if (!deliveryId) {
        setError('Delivery ID is missing');
        setLoading(false);
        return;
      }

      console.log('[SMS Modal] Sending SMS for delivery:', deliveryId, 'Customer:', delivery.customer);

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

  const modalContent = (
    <div 
      className="fixed inset-0 bg-black/70 dark:bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto" 
      style={{ 
        zIndex: 99999,
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0
      }}
      onClick={onClose}
    >
      <div 
        className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl max-w-lg w-full relative my-8 mx-auto border border-gray-200 dark:border-gray-700"
        style={{ maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-3">
            <MessageCircle className="w-6 h-6 text-blue-600 dark:text-blue-400" />
            <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">Send Confirmation SMS</h2>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4 overflow-y-auto flex-1">
          {!success ? (
            <>
              {/* Delivery Info */}
              <div className="bg-gray-50 dark:bg-gray-700 p-4 rounded-lg space-y-2">
                <div>
                  <p className="text-sm text-gray-600 dark:text-gray-400">Customer</p>
                  <p className="font-semibold text-gray-800 dark:text-gray-100">{delivery.customer}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600 dark:text-gray-400">Phone</p>
                  <p className="font-semibold text-gray-800 dark:text-gray-100">{delivery.phone}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600 dark:text-gray-400">Address</p>
                  <p className="font-semibold text-gray-800 dark:text-gray-100 text-sm">{delivery.address}</p>
                </div>
              </div>

              {/* SMS Message Preview */}
              <div>
                <p className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-2">Message Preview:</p>
                <div className="bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 p-3 rounded-lg text-sm text-gray-700 dark:text-gray-200 space-y-2">
                  <p>Hi {delivery.customer || 'there'},</p>
                  <p>Your order from Electrolux is ready for delivery confirmation.</p>
                  <p>Click to confirm and select your delivery date:</p>
                  <p className="text-blue-600 dark:text-blue-300 font-semibold break-all">[Confirmation Link]</p>
                  <p>This link expires in 48 hours.</p>
                </div>
              </div>

              {error && (
                <div className="bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 p-3 rounded-lg flex items-start gap-2">
                  <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex gap-3 pt-2">
                <button
                  onClick={onClose}
                  className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors font-semibold"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSendSMS}
                  disabled={loading}
                  className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 dark:disabled:bg-gray-600 text-white rounded-lg transition-colors font-semibold flex items-center justify-center gap-2"
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
                  <div className="bg-green-100 dark:bg-green-950 p-3 rounded-full border border-green-200 dark:border-green-800">
                    <CheckCircle className="w-8 h-8 text-green-600 dark:text-green-400" />
                  </div>
                </div>
                
                <h3 className="text-lg font-bold text-gray-800 dark:text-gray-100 mb-2">SMS Sent Successfully!</h3>
                
                <div className="bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 p-4 rounded-lg space-y-3 mb-4 text-left">
                  <div>
                    <p className="text-xs text-gray-600 dark:text-gray-300 mb-1">Confirmation Link Expires:</p>
                    <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">
                      {smsData?.expiresAt ? new Date(smsData.expiresAt).toLocaleString() : '48 hours from now'}
                    </p>
                  </div>
                  
                  {smsData?.token && (
                    <div>
                      <p className="text-xs text-gray-600 dark:text-gray-300 mb-1 flex items-center gap-1">
                        <Link2 className="w-3 h-3" />
                        Share Link (copy-paste):
                      </p>
                      <input
                        type="text"
                        value={`${window.location.origin}/confirm-delivery/${smsData.token}`}
                        readOnly
                        className="w-full text-xs px-2 py-1 border border-green-300 dark:border-green-700 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 rounded font-mono"
                      />
                    </div>
                  )}
                </div>

                <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
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

  // Use React Portal to render modal at document root level
  return ReactDOM.createPortal(modalContent, document.body);
}
