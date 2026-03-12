import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { X, Send, Loader, CheckCircle, AlertCircle, MessageCircle, Link2 } from 'lucide-react';
import api from '../../frontend/apiClient';

export default function SMSConfirmationModal({ delivery, onClose, onSuccess }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null); // { ok, message, token, confirmationLink, d7Status, error }

  useEffect(() => {
    const orig = document.body.style.overflow;
    const origPad = document.body.style.paddingRight;
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = 'hidden';
    if (scrollbarWidth > 0) document.body.style.paddingRight = `${scrollbarWidth}px`;
    return () => {
      document.body.style.overflow = orig;
      document.body.style.paddingRight = origPad;
    };
  }, []);

  const handleSendSMS = async () => {
    try {
      setLoading(true);
      setResult(null);

      const deliveryId = String(delivery.id || delivery.ID || '').trim();
      if (!deliveryId) {
        setResult({ ok: false, error: 'Delivery ID is missing' });
        return;
      }

      console.log('[SMS Modal] Sending SMS for delivery:', deliveryId, 'Phone:', delivery.phone);

      const response = await api.post(`/deliveries/${encodeURIComponent(deliveryId)}/send-sms`, {});
      setResult({ ok: true, ...response.data });

      if (onSuccess) onSuccess(response.data);
    } catch (err) {
      const msg = err.response?.data?.message || err.message || 'Failed to send SMS';
      setResult({ ok: false, error: msg, ...err.response?.data });
      console.error('[SMS Modal] Error:', err);
    } finally {
      setLoading(false);
    }
  };

  const modalContent = (
    <div
      className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      style={{ zIndex: 99999, position: 'fixed', top: 0, left: 0, right: 0, bottom: 0 }}
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl max-w-lg w-full relative my-8 mx-auto border border-gray-200 dark:border-gray-700"
        style={{ maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-3">
            <MessageCircle className="w-6 h-6 text-blue-600 dark:text-blue-400" />
            <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">Send Confirmation SMS</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors">
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4 overflow-y-auto flex-1">
          {!result ? (
            <>
              {/* Delivery Info */}
              <div className="bg-gray-50 dark:bg-gray-700 p-4 rounded-lg space-y-2">
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Customer</p>
                  <p className="font-semibold text-gray-800 dark:text-gray-100">{delivery.customer}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Phone</p>
                  <p className="font-semibold text-gray-800 dark:text-gray-100">{delivery.phone}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Address</p>
                  <p className="font-semibold text-gray-800 dark:text-gray-100 text-sm">{delivery.address}</p>
                </div>
              </div>

              {/* Message Preview */}
              <div>
                <p className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-2">Message that will be sent:</p>
                <div className="bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 p-3 rounded-lg text-sm text-gray-700 dark:text-gray-200 space-y-2">
                  <p>Hi {delivery.customer || 'there'},</p>
                  <p>Your Electrolux order is ready for delivery!</p>
                  <p>Please confirm your delivery date by clicking the link below:</p>
                  <p className="text-blue-600 dark:text-blue-300 font-semibold">[Confirmation Link]</p>
                  <p>Link expires in 48 hours.</p>
                  <p>- Electrolux Delivery Team</p>
                </div>
              </div>

              {/* Buttons */}
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
                  className="flex-1 px-4 py-2 bg-primary-800 hover:bg-primary-900 disabled:bg-gray-400 text-white rounded-lg transition-colors font-semibold flex items-center justify-center gap-2"
                >
                  {loading ? (
                    <><Loader className="w-4 h-4 animate-spin" />Sending...</>
                  ) : (
                    <><Send className="w-4 h-4" />Send SMS</>
                  )}
                </button>
              </div>
            </>
          ) : result.ok ? (
            /* ── Success ── */
            <>
              <div className="text-center py-4">
                <div className="flex justify-center mb-4">
                  <div className="p-3 rounded-full bg-green-100 dark:bg-green-950 border border-green-200 dark:border-green-800">
                    <CheckCircle className="w-8 h-8 text-green-600 dark:text-green-400" />
                  </div>
                </div>
                <h3 className="text-lg font-bold text-gray-800 dark:text-gray-100 mb-1">SMS Sent via D7 Networks</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                  Sent to <span className="font-semibold text-gray-800 dark:text-gray-100">{delivery.phone}</span>
                  {result.d7Status && <> · D7 status: <span className="font-semibold">{result.d7Status}</span></>}
                </p>

                {/* Confirmation Link */}
                {result.token && (
                  <div className="bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 p-4 rounded-lg text-left space-y-3">
                    <div>
                      <p className="text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">Link Expires:</p>
                      <p className="text-sm text-gray-800 dark:text-gray-100">
                        {result.expiresAt ? new Date(result.expiresAt).toLocaleString() : '48 hours from now'}
                      </p>
                    </div>
                    <div className="border-t border-green-200 dark:border-green-800 pt-3">
                      <p className="text-xs font-semibold text-gray-600 dark:text-gray-400 mb-2 flex items-center gap-1">
                        <Link2 className="w-3 h-3" /> Confirmation Link (also sent in SMS):
                      </p>
                      <input
                        type="text"
                        value={result.confirmationLink || `${window.location.origin}/confirm-delivery/${result.token}`}
                        readOnly
                        onClick={e => e.target.select()}
                        className="w-full text-xs px-2 py-1.5 border border-green-300 dark:border-green-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 rounded font-mono cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700"
                        title="Click to select and copy"
                      />
                    </div>
                  </div>
                )}
              </div>

              <button
                onClick={onClose}
                className="w-full px-4 py-2 bg-primary-800 hover:bg-primary-900 text-white rounded-lg transition-colors font-semibold"
              >
                Done
              </button>
            </>
          ) : (
            /* ── Error ── */
            <>
              <div className="text-center py-4">
                <div className="flex justify-center mb-4">
                  <div className="p-3 rounded-full bg-red-100 dark:bg-red-950 border border-red-200 dark:border-red-800">
                    <AlertCircle className="w-8 h-8 text-red-600 dark:text-red-400" />
                  </div>
                </div>
                <h3 className="text-lg font-bold text-gray-800 dark:text-gray-100 mb-2">SMS Failed</h3>
                <p className="text-sm text-red-600 dark:text-red-400 mb-2">{result.message || result.error}</p>
                {result.d7Detail && (
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-4 break-all font-mono bg-gray-100 dark:bg-gray-800 p-2 rounded">{result.d7Detail}</p>
                )}

                {result.token && (
                  <div className="bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 p-3 rounded-lg text-left">
                    <p className="text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1 flex items-center gap-1">
                      <Link2 className="w-3 h-3" /> Confirmation Link (copy and share manually):
                    </p>
                    <input
                      type="text"
                      value={result.confirmationLink || `${window.location.origin}/confirm-delivery/${result.token}`}
                      readOnly
                      onClick={e => e.target.select()}
                      className="w-full text-xs px-2 py-1.5 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded font-mono cursor-pointer"
                      title="Click to select and copy"
                    />
                  </div>
                )}
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setResult(null)}
                  className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors font-semibold"
                >
                  Try Again
                </button>
                <button
                  onClick={onClose}
                  className="flex-1 px-4 py-2 bg-primary-800 hover:bg-primary-900 text-white rounded-lg transition-colors font-semibold"
                >
                  Close
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );

  return ReactDOM.createPortal(modalContent, document.body);
}
