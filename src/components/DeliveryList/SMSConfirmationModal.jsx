import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { X, Send, Loader, CheckCircle, AlertCircle, MessageCircle, Link2, Mail } from 'lucide-react';
import api from '../../frontend/apiClient';

export default function SMSConfirmationModal({ delivery, onClose, onSuccess }) {
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const [smsData, setSmsData] = useState(null);
  const [customerEmail, setCustomerEmail] = useState(delivery.email || '');

  // Detect UAE numbers — UAE carriers block all unregistered senders
  const rawPhone = delivery.phone || '';
  const isUAENumber = rawPhone.startsWith('+971') || rawPhone.startsWith('971') || rawPhone.startsWith('05') || rawPhone.startsWith('5');

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

      const response = await api.post(`/deliveries/${encodeURIComponent(deliveryId)}/send-sms`, {
        email: customerEmail || undefined
      });
      
      setSmsData(response.data);
      // ok:true means the token was generated — treat as success even if SMS itself failed
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

              {/* UAE Warning Banner */}
              {isUAENumber && (
                <div className="bg-amber-50 dark:bg-amber-950 border border-amber-300 dark:border-amber-700 rounded-lg p-4">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-bold text-amber-800 dark:text-amber-200 mb-1">UAE Number — SMS Not Available Yet</p>
                      <p className="text-xs text-amber-700 dark:text-amber-300 mb-2">
                        UAE carriers block SMS from unregistered senders. Clicking the button below will generate the confirmation link — you can then <strong>copy and share it via WhatsApp</strong> directly to the customer.
                      </p>
                      <p className="text-xs text-amber-600 dark:text-amber-400">
                        To enable automatic SMS: register sender ID "Electrolux" at <strong>app.d7networks.com → SMS → Sender IDs</strong> (free, 3–7 days).
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Customer Email (optional fallback) */}
              {!isUAENumber && (
                <div>
                  <label className="block text-sm font-semibold text-gray-700 dark:text-gray-200 mb-1">
                    Customer Email <span className="font-normal text-gray-400">(optional — used if SMS fails)</span>
                  </label>
                  <div className="flex items-center gap-2">
                    <Mail className="w-4 h-4 text-gray-400 flex-shrink-0" />
                    <input
                      type="email"
                      value={customerEmail}
                      onChange={e => setCustomerEmail(e.target.value)}
                      placeholder="customer@example.com"
                      className="flex-1 px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
              )}

              {/* Message Preview */}
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
                <div className="bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 p-4 rounded-lg space-y-2">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-red-700 dark:text-red-300 mb-1">Error Sending SMS</p>
                      <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
                    </div>
                  </div>
                  
                  {/* Helpful troubleshooting info */}
                  <div className="bg-red-100 dark:bg-red-900/30 p-3 rounded border border-red-300 dark:border-red-800">
                    <p className="text-xs text-red-700 dark:text-red-300 font-semibold mb-2">Troubleshooting:</p>
                    <ul className="text-xs text-red-600 dark:text-red-400 space-y-1 list-disc list-inside">
                      <li>Check if this delivery exists in the database</li>
                      <li>Verify the delivery has a valid phone number</li>
                      <li>Ensure Twilio credentials are set on Vercel</li>
                      <li>Check server logs for detailed error</li>
                    </ul>
                    <p className="text-xs text-red-700 dark:text-red-300 mt-2">
                      <strong>Delivery ID:</strong> <code className="bg-red-200 dark:bg-red-900 px-1 py-0.5 rounded">{delivery.id || delivery.ID || 'unknown'}</code>
                    </p>
                  </div>
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
                  className="flex-1 px-4 py-2 bg-primary-800 hover:bg-primary-900 disabled:bg-gray-400 dark:disabled:bg-gray-600 text-white rounded-lg transition-colors font-semibold flex items-center justify-center gap-2"
                >
                  {loading ? (
                    <>
                      <Loader className="w-4 h-4 animate-spin" />
                      {isUAENumber ? 'Generating Link...' : 'Sending...'}
                    </>
                  ) : (
                    <>
                      <Send className="w-4 h-4" />
                      {isUAENumber ? 'Generate Confirmation Link' : 'Send SMS'}
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
                  <div className={`p-3 rounded-full border ${smsData?.smsSent ? 'bg-green-100 dark:bg-green-950 border-green-200 dark:border-green-800' : 'bg-yellow-100 dark:bg-yellow-950 border-yellow-200 dark:border-yellow-800'}`}>
                    {smsData?.smsSent
                      ? <CheckCircle className="w-8 h-8 text-green-600 dark:text-green-400" />
                      : <AlertCircle className="w-8 h-8 text-yellow-600 dark:text-yellow-400" />
                    }
                  </div>
                </div>
                
                <h3 className="text-lg font-bold text-gray-800 dark:text-gray-100 mb-2">
                  {smsData?.smsSent
                    ? 'SMS Sent Successfully!'
                    : smsData?.emailSent
                      ? 'Confirmation Email Sent!'
                      : 'Confirmation Link Ready'}
                </h3>

                {/* Delivery channel badge */}
                {smsData?.smsSent && (
                  <p className="text-sm text-gray-600 dark:text-gray-300 mb-2">
                    Sent via <strong>SMS</strong> to <span className="font-semibold text-gray-800 dark:text-gray-100">{delivery.phone}</span>
                  </p>
                )}
                {smsData?.emailSent && !smsData?.smsSent && (
                  <p className="text-sm text-gray-600 dark:text-gray-300 mb-2">
                    Sent via <strong>Email</strong> to <span className="font-semibold text-gray-800 dark:text-gray-100">{customerEmail}</span>
                  </p>
                )}

                {/* UAE notice — shown when neither SMS nor email was sent */}
                {!smsData?.smsSent && !smsData?.emailSent && isUAENumber && (
                  <div className="mb-4 bg-amber-50 dark:bg-amber-950 border border-amber-300 dark:border-amber-700 rounded-lg p-3 text-left">
                    <p className="text-xs font-bold text-amber-800 dark:text-amber-200 mb-1">UAE number — share this link via WhatsApp</p>
                    <p className="text-xs text-amber-700 dark:text-amber-300">
                      Copy the confirmation link below and paste it into a WhatsApp message to the customer. UAE SMS requires sender ID registration (free at app.d7networks.com → SMS → Sender IDs).
                    </p>
                  </div>
                )}

                {smsData?.smsWarning && smsData?.smsSent === false && !isUAENumber && (
                  <div className="mb-4 bg-yellow-50 dark:bg-yellow-950 border border-yellow-300 dark:border-yellow-700 rounded-lg p-3 text-left">
                    <p className="text-xs font-semibold text-yellow-800 dark:text-yellow-200 mb-1">
                      {smsData?.emailSent ? 'SMS blocked — email sent instead' : 'SMS could not be delivered'}
                    </p>
                    <p className="text-xs text-yellow-700 dark:text-yellow-300">{smsData.smsWarning}</p>
                  </div>
                )}

                <div className="bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 p-4 rounded-lg space-y-4 mb-4 text-left">
                  {/* Expiration Time */}
                  <div>
                    <p className="text-xs text-gray-600 dark:text-gray-400 mb-1 font-semibold">Link Expires:</p>
                    <p className="text-sm text-gray-800 dark:text-gray-100">
                      {smsData?.expiresAt ? new Date(smsData.expiresAt).toLocaleString() : '48 hours from now'}
                    </p>
                  </div>
                  
                  {/* Confirmation Link */}
                  {smsData?.token && (
                    <>
                      <div className="border-t border-green-200 dark:border-green-800 pt-3">
                        <p className="text-xs text-gray-600 dark:text-gray-400 mb-2 flex items-center gap-1 font-semibold">
                          <Link2 className="w-3 h-3" />
                          Customer Confirmation Link:
                        </p>
                        <a
                          href={`${window.location.origin}/confirm-delivery/${smsData.token}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block w-full text-sm px-3 py-2 bg-blue-50 dark:bg-blue-950 border border-blue-300 dark:border-blue-700 text-blue-600 dark:text-blue-300 rounded hover:bg-blue-100 dark:hover:bg-blue-900 transition-colors font-medium break-all text-center"
                        >
                          Open Confirmation Page →
                        </a>
                        <input
                          type="text"
                          value={`${window.location.origin}/confirm-delivery/${smsData.token}`}
                          readOnly
                          onClick={(e) => e.target.select()}
                          className="mt-2 w-full text-xs px-2 py-1.5 border border-green-300 dark:border-green-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 rounded font-mono cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700"
                          title="Click to select and copy"
                        />
                      </div>

                      {/* Tracking Link */}
                      <div className="border-t border-green-200 dark:border-green-800 pt-3">
                        <p className="text-xs text-gray-600 dark:text-gray-400 mb-2 flex items-center gap-1 font-semibold">
                          <Link2 className="w-3 h-3" />
                          Customer Tracking Link:
                        </p>
                        <a
                          href={`${window.location.origin}/tracking/${smsData.token}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block w-full text-sm px-3 py-2 bg-purple-50 dark:bg-purple-950 border border-purple-300 dark:border-purple-700 text-purple-600 dark:text-purple-300 rounded hover:bg-purple-100 dark:hover:bg-purple-900 transition-colors font-medium break-all text-center"
                        >
                          Open Tracking Page →
                        </a>
                        <input
                          type="text"
                          value={`${window.location.origin}/tracking/${smsData.token}`}
                          readOnly
                          onClick={(e) => e.target.select()}
                          className="mt-2 w-full text-xs px-2 py-1.5 border border-green-300 dark:border-green-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 rounded font-mono cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700"
                          title="Click to select and copy"
                        />
                      </div>
                    </>
                  )}
                </div>

                {/* WhatsApp share button — prominent for UAE numbers */}
                {smsData?.token && (
                  <a
                    href={`https://wa.me/${rawPhone.replace(/[^0-9]/g, '')}?text=${encodeURIComponent(`Hi ${delivery.customer || 'there'},\n\nYour Electrolux order is ready for delivery confirmation.\n\nClick to confirm your delivery date:\n${window.location.origin}/confirm-delivery/${smsData.token}\n\nLink expires in 48 hours.\n- Electrolux Delivery Team`)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-2 w-full px-4 py-2.5 bg-green-500 hover:bg-green-600 text-white rounded-lg transition-colors font-semibold text-sm"
                  >
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                    Send via WhatsApp
                  </a>
                )}

                <div className="bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 p-3 rounded-lg">
                  <p className="text-xs text-blue-700 dark:text-blue-300">
                    💡 <span className="font-semibold">Tip:</span> The WhatsApp button above opens WhatsApp with the message pre-filled. Just tap Send.
                  </p>
                </div>
              </div>

              {/* Close Button */}
              <button
                onClick={onClose}
                className="w-full px-4 py-2 bg-primary-800 hover:bg-primary-900 text-white rounded-lg transition-colors font-semibold"
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
