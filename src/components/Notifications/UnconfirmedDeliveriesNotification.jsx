import React, { useState, useEffect } from 'react';
import { AlertCircle, Clock, Send, X, RefreshCw } from 'lucide-react';
import api from '../../frontend/apiClient';

export default function UnconfirmedDeliveriesNotification() {
  const [unconfirmedDeliveries, setUnconfirmedDeliveries] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [resendingId, setResendingId] = useState(null);

  const fetchUnconfirmed = async () => {
    try {
      setLoading(true);
      const response = await api.get('/notifications/unconfirmed-deliveries');
      setUnconfirmedDeliveries(response.data.deliveries || []);
    } catch (error) {
      console.error('Failed to fetch unconfirmed deliveries:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUnconfirmed();
    // Refresh every 5 minutes
    const interval = setInterval(fetchUnconfirmed, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  const handleResendSms = async (deliveryId) => {
    try {
      setResendingId(deliveryId);
      await api.post(`/notifications/resend-sms/${deliveryId}`);
      alert('SMS resent successfully!');
      fetchUnconfirmed(); // Refresh list
    } catch (error) {
      console.error('Failed to resend SMS:', error);
      alert('Failed to resend SMS: ' + (error.response?.data?.error || error.message));
    } finally {
      setResendingId(null);
    }
  };

  if (unconfirmedDeliveries.length === 0) {
    return null; // Don't show if no unconfirmed deliveries
  }

  return (
    <>
      {/* Notification Badge */}
      <button
        onClick={() => setShowModal(true)}
        className="relative p-2 text-yellow-600 hover:bg-yellow-50 dark:hover:bg-yellow-900/20 rounded-lg transition-colors"
        title={`${unconfirmedDeliveries.length} unconfirmed deliveries (>24h)`}
      >
        <AlertCircle className="w-6 h-6" />
        {unconfirmedDeliveries.length > 0 && (
          <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
            {unconfirmedDeliveries.length > 9 ? '9+' : unconfirmedDeliveries.length}
          </span>
        )}
      </button>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-4xl w-full max-h-[80vh] overflow-hidden flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-6 h-6 text-yellow-600" />
                <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
                  Unconfirmed Deliveries ({unconfirmedDeliveries.length})
                </h2>
              </div>
              <button
                onClick={() => setShowModal(false)}
                className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Description */}
            <div className="p-4 bg-yellow-50 dark:bg-yellow-900/20 border-b border-yellow-200 dark:border-yellow-800">
              <p className="text-sm text-yellow-800 dark:text-yellow-200">
                <Clock className="w-4 h-4 inline mr-1" />
                These deliveries had SMS sent but customers haven't confirmed within 24 hours.
              </p>
            </div>

            {/* Deliveries List */}
            <div className="flex-1 overflow-y-auto p-4">
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <RefreshCw className="w-8 h-8 animate-spin text-gray-400" />
                </div>
              ) : (
                <div className="space-y-4">
                  {unconfirmedDeliveries.map((delivery) => (
                    <div
                      key={delivery.id}
                      className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4 border border-gray-200 dark:border-gray-600"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            <span className="font-semibold text-gray-900 dark:text-gray-100">
                              {delivery.customer}
                            </span>
                            {delivery.poNumber && (
                              <span className="text-sm text-gray-500 dark:text-gray-400 font-mono">
                                PO: {delivery.poNumber}
                              </span>
                            )}
                          </div>
                          <p className="text-sm text-gray-600 dark:text-gray-300 mb-2">
                            {delivery.address}
                          </p>
                          <div className="flex items-center gap-4 text-xs text-gray-500 dark:text-gray-400">
                            <span>
                              <Clock className="w-3 h-3 inline mr-1" />
                              SMS sent: {delivery.hoursSinceSms}h ago
                            </span>
                            <span>
                              Phone: {delivery.phone}
                            </span>
                          </div>
                          {delivery.tokenExpiresAt && (
                            <p className="text-xs text-red-600 dark:text-red-400 mt-1">
                              Link expires: {new Date(delivery.tokenExpiresAt).toLocaleString()}
                            </p>
                          )}
                        </div>
                        <button
                          onClick={() => handleResendSms(delivery.id)}
                          disabled={resendingId === delivery.id}
                          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm font-medium"
                        >
                          {resendingId === delivery.id ? (
                            <>
                              <RefreshCw className="w-4 h-4 animate-spin" />
                              Sending...
                            </>
                          ) : (
                            <>
                              <Send className="w-4 h-4" />
                              Resend SMS
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <button
                onClick={fetchUnconfirmed}
                className="flex items-center gap-2 px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
              >
                <RefreshCw className="w-4 h-4" />
                Refresh
              </button>
              <button
                onClick={() => setShowModal(false)}
                className="px-6 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
