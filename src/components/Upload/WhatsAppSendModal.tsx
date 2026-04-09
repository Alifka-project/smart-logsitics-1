/**
 * WhatsApp Send Modal — Auto-send confirmation links after file upload.
 *
 * TEMPORARY — replaces D7 SMS/WhatsApp API while compliance approval is pending.
 * Once D7 is approved: remove this component, restore smsAdapter.sendSms() calls.
 *
 * Flow:
 *  1. Portal uploads file → backend generates wa.me links for new/unconfirmed deliveries
 *  2. FileUpload.tsx dispatches window event `whatsappConfirmationsReady`
 *  3. This modal opens automatically
 *  4. Staff clicks ONE button → WhatsApp opens for each customer (pre-filled message)
 *  5. Staff taps Send in WhatsApp for each customer
 */
import React, { useEffect, useState, useCallback, useRef } from 'react';
import ReactDOM from 'react-dom';
import { MessageCircle, X, Send, CheckCircle, ChevronDown, ChevronUp, Phone, ExternalLink } from 'lucide-react';

interface ConfirmationReady {
  deliveryId: string;
  customerName: string;
  phone: string;
  confirmationLink: string;
  whatsappUrl: string;
}

export default function WhatsAppSendModal() {
  const [confirmations, setConfirmations] = useState<ConfirmationReady[]>([]);
  const [sent, setSent] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);
  const [showList, setShowList] = useState(false);
  const currentIndexRef = useRef(0);

  useEffect(() => {
    const handleEvent = (e: Event) => {
      const detail = (e as CustomEvent<{ confirmations: ConfirmationReady[] }>).detail;
      if (detail?.confirmations?.length) {
        setConfirmations(detail.confirmations);
        setSent(new Set());
        setSending(false);
        setShowList(false);
        currentIndexRef.current = 0;
      }
    };
    window.addEventListener('whatsappConfirmationsReady', handleEvent);
    return () => window.removeEventListener('whatsappConfirmationsReady', handleEvent);
  }, []);

  const handleSendSingle = useCallback((c: ConfirmationReady) => {
    window.open(c.whatsappUrl, '_blank');
    setSent(prev => new Set([...prev, c.deliveryId]));
  }, []);

  /**
   * Open all WhatsApp tabs sequentially.
   * Must be called directly from a user click (not setTimeout) to avoid popup blocking.
   * We open them all at once — browser will stack tabs; staff can work through each.
   */
  const handleSendAll = useCallback(() => {
    setSending(true);
    const unsent = confirmations.filter(c => !sent.has(c.deliveryId));
    const newSent = new Set(sent);
    // Open all immediately (user click context — popups won't be blocked)
    unsent.forEach(c => {
      window.open(c.whatsappUrl, '_blank');
      newSent.add(c.deliveryId);
    });
    setSent(newSent);
    setSending(false);
  }, [confirmations, sent]);

  const dismiss = useCallback(() => setConfirmations([]), []);

  if (confirmations.length === 0) return null;

  const sentCount = sent.size;
  const total = confirmations.length;
  const allSent = sentCount === total;

  const modal = (
    <div
      className="fixed inset-0 z-[99999] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => { if (e.target === e.currentTarget) dismiss(); }}
    >
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        {/* Header */}
        <div className={`px-5 py-4 ${allSent ? 'bg-green-600' : 'bg-[#25D366]'} text-white`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center flex-shrink-0">
                <MessageCircle className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-bold leading-tight">
                  {allSent ? 'All WhatsApp Confirmations Sent!' : 'Send WhatsApp Confirmations'}
                </h2>
                <p className="text-xs text-white/80 mt-0.5">
                  {allSent
                    ? `${total} customer${total > 1 ? 's' : ''} notified`
                    : `${total} customer${total > 1 ? 's' : ''} awaiting confirmation`}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={dismiss}
              className="p-1.5 rounded-full hover:bg-white/20 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="px-5 py-5">
          {!allSent ? (
            <>
              <p className="text-sm text-gray-600 dark:text-gray-300 mb-4 leading-relaxed">
                WhatsApp confirmation links are ready. Click <strong>"Send All via WhatsApp"</strong> — WhatsApp will open for each customer with the message pre-filled. Tap <strong>Send</strong> in each chat.
              </p>

              {/* MAIN SEND ALL BUTTON */}
              <button
                type="button"
                onClick={handleSendAll}
                disabled={sending || allSent}
                className="w-full flex items-center justify-center gap-2.5 px-4 py-3.5 rounded-xl font-bold text-white text-sm transition-all disabled:opacity-60"
                style={{ background: sending ? '#999' : 'linear-gradient(135deg,#25D366,#128C7E)', boxShadow: '0 4px 16px rgba(37,211,102,0.4)' }}
              >
                <Send className="w-4 h-4" />
                {sending ? 'Opening WhatsApp…' : `Send All (${total - sentCount}) via WhatsApp`}
              </button>

              {sentCount > 0 && sentCount < total && (
                <p className="text-xs text-center text-amber-600 dark:text-amber-400 mt-2 font-medium">
                  {sentCount}/{total} sent — click to send remaining {total - sentCount}
                </p>
              )}
            </>
          ) : (
            <div className="text-center py-2">
              <div className="w-14 h-14 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto mb-3">
                <CheckCircle className="w-7 h-7 text-green-600" />
              </div>
              <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
                WhatsApp opened for all {total} customers. Please check each tab and tap <strong>Send</strong> if not already done.
              </p>
            </div>
          )}

          {/* Toggle individual list */}
          <button
            type="button"
            onClick={() => setShowList(v => !v)}
            className="w-full mt-3 flex items-center justify-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors py-1"
          >
            {showList ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            {showList ? 'Hide' : 'Show'} individual customers ({total})
          </button>

          {showList && (
            <div className="mt-2 border border-gray-100 dark:border-gray-700 rounded-xl divide-y divide-gray-50 dark:divide-gray-800 max-h-52 overflow-y-auto">
              {confirmations.map(c => {
                const isSent = sent.has(c.deliveryId);
                return (
                  <div key={c.deliveryId} className="flex items-center gap-3 px-3 py-2.5">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold ${isSent ? 'bg-green-100 dark:bg-green-900/40 text-green-600' : 'bg-gray-100 dark:bg-gray-800 text-gray-500'}`}>
                      {isSent ? <CheckCircle className="w-4 h-4" /> : c.customerName.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-gray-900 dark:text-gray-100 truncate">{c.customerName}</p>
                      <div className="flex items-center gap-1 mt-0.5">
                        <Phone className="w-3 h-3 text-gray-400" />
                        <p className="text-[10px] text-gray-500 dark:text-gray-400">{c.phone}</p>
                      </div>
                    </div>
                    {isSent ? (
                      <span className="text-[10px] text-green-600 font-semibold flex-shrink-0">Sent ✓</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleSendSingle(c)}
                        className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold text-white flex-shrink-0 transition-colors"
                        style={{ background: '#25D366' }}
                      >
                        <ExternalLink className="w-3 h-3" /> Send
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 pb-4">
          <button
            type="button"
            onClick={dismiss}
            className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm font-semibold text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            {allSent ? 'Done' : 'Dismiss (send later via Send SMS button)'}
          </button>
        </div>
      </div>
    </div>
  );

  return ReactDOM.createPortal(modal, document.body);
}
