/**
 * WhatsApp Send Modal — Auto-send confirmation links after file upload.
 *
 * TEMPORARY — replaces D7 SMS/WhatsApp API while compliance approval is pending.
 * Once D7 is approved: remove this component, restore smsAdapter.sendSms() calls.
 *
 * Auto-send logic:
 *   When the `whatsappConfirmationsReady` event fires after upload, this component
 *   immediately opens a WhatsApp tab for every customer using the anchor-click
 *   technique (bypasses popup blockers better than window.open in async context).
 *   A visual modal is shown as confirmation/fallback if any tab was blocked.
 */
import React, { useEffect, useState, useCallback, useRef } from 'react';
import ReactDOM from 'react-dom';
import { MessageCircle, X, Send, CheckCircle, ChevronDown, ChevronUp, Phone, ExternalLink, Loader } from 'lucide-react';

interface ConfirmationReady {
  deliveryId: string;
  customerName: string;
  phone: string;
  confirmationLink: string;
  whatsappUrl: string;
}

/**
 * Opens a URL in a new tab using anchor-click technique.
 * This approach has more lenient popup-blocking policies than window.open()
 * when called outside a synchronous user-gesture handler.
 */
function openInNewTab(url: string): void {
  try {
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    // Clean up after a tick
    setTimeout(() => { document.body.removeChild(a); }, 100);
  } catch {
    // Fallback to window.open
    window.open(url, '_blank');
  }
}

export default function WhatsAppSendModal() {
  const [confirmations, setConfirmations] = useState<ConfirmationReady[]>([]);
  const [sent, setSent] = useState<Set<string>>(new Set());
  const [showList, setShowList] = useState(false);
  const [autoSendDone, setAutoSendDone] = useState(false);
  const autoSendRef = useRef(false);  // prevent double-fire on StrictMode

  // ── Receive new confirmations from upload ──────────────────────────────────
  useEffect(() => {
    const handleEvent = (e: Event) => {
      const detail = (e as CustomEvent<{ confirmations: ConfirmationReady[] }>).detail;
      if (detail?.confirmations?.length) {
        autoSendRef.current = false;  // reset so auto-send runs for new upload
        setAutoSendDone(false);
        setSent(new Set());
        setShowList(false);
        setConfirmations(detail.confirmations);
      }
    };
    window.addEventListener('whatsappConfirmationsReady', handleEvent);
    return () => window.removeEventListener('whatsappConfirmationsReady', handleEvent);
  }, []);

  // ── AUTO-SEND: open WhatsApp for every customer as soon as confirmations arrive
  // Uses anchor-click technique which has less strict popup policies than window.open.
  // If the browser blocks some tabs, the modal shows a fallback "Send Remaining" button.
  useEffect(() => {
    if (confirmations.length === 0 || autoSendRef.current) return;
    autoSendRef.current = true;

    const newSent = new Set<string>();
    confirmations.forEach((c, i) => {
      // Stagger slightly so browser handles multiple tabs gracefully
      setTimeout(() => {
        openInNewTab(c.whatsappUrl);
        newSent.add(c.deliveryId);
        if (i === confirmations.length - 1) {
          setSent(new Set(newSent));
          setAutoSendDone(true);
        }
      }, i * 150);
    });
  }, [confirmations]);

  const handleSendSingle = useCallback((c: ConfirmationReady) => {
    openInNewTab(c.whatsappUrl);
    setSent(prev => new Set([...prev, c.deliveryId]));
  }, []);

  const handleSendRemaining = useCallback(() => {
    const unsent = confirmations.filter(c => !sent.has(c.deliveryId));
    const newSent = new Set(sent);
    unsent.forEach((c, i) => {
      setTimeout(() => {
        openInNewTab(c.whatsappUrl);
        newSent.add(c.deliveryId);
      }, i * 150);
    });
    setSent(newSent);
  }, [confirmations, sent]);

  const dismiss = useCallback(() => setConfirmations([]), []);

  if (confirmations.length === 0) return null;

  const sentCount = sent.size;
  const total = confirmations.length;
  const allSent = sentCount === total;
  const remaining = total - sentCount;

  const modal = (
    <div
      className="fixed inset-0 z-[99999] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => { if (e.target === e.currentTarget) dismiss(); }}
    >
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">

        {/* Header */}
        <div className={`px-5 py-4 text-white ${allSent ? 'bg-green-600' : 'bg-[#25D366]'}`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center flex-shrink-0">
                {autoSendDone ? <CheckCircle className="w-5 h-5" /> : <Loader className="w-5 h-5 animate-spin" />}
              </div>
              <div>
                <h2 className="text-base font-bold leading-tight">
                  {allSent ? 'WhatsApp Confirmations Sent!' : 'Sending WhatsApp Confirmations…'}
                </h2>
                <p className="text-xs text-white/80 mt-0.5">
                  {autoSendDone
                    ? allSent
                      ? `${total} customer${total !== 1 ? 's' : ''} notified automatically`
                      : `${sentCount}/${total} sent — ${remaining} may be blocked by browser`
                    : `Opening WhatsApp for ${total} customer${total !== 1 ? 's' : ''}…`}
                </p>
              </div>
            </div>
            <button type="button" onClick={dismiss} className="p-1.5 rounded-full hover:bg-white/20 transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="px-5 py-5 space-y-4">

          {!autoSendDone ? (
            <div className="flex items-center justify-center gap-3 py-4">
              <Loader className="w-5 h-5 animate-spin text-[#25D366]" />
              <p className="text-sm text-gray-600 dark:text-gray-300">
                Automatically opening WhatsApp for {total} customer{total !== 1 ? 's' : ''}…
              </p>
            </div>
          ) : allSent ? (
            <div className="text-center py-2">
              <div className="w-14 h-14 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto mb-3">
                <CheckCircle className="w-7 h-7 text-green-600" />
              </div>
              <p className="text-sm text-gray-700 dark:text-gray-200 font-semibold">WhatsApp opened for all {total} customers.</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                Please check each WhatsApp tab and tap <strong>Send</strong> if not already done.
              </p>
            </div>
          ) : (
            <>
              <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl p-3">
                <p className="text-xs text-amber-700 dark:text-amber-300 leading-relaxed">
                  <strong>{remaining} WhatsApp tab{remaining !== 1 ? 's were' : ' was'} blocked</strong> by your browser popup blocker.
                  Click <strong>"Send Remaining"</strong> to open them (requires a direct click).
                </p>
              </div>
              <button
                type="button"
                onClick={handleSendRemaining}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-bold text-white text-sm transition-all"
                style={{ background: 'linear-gradient(135deg,#25D366,#128C7E)', boxShadow: '0 4px 16px rgba(37,211,102,0.35)' }}
              >
                <Send className="w-4 h-4" />
                Send Remaining ({remaining}) via WhatsApp
              </button>
            </>
          )}

          {/* Individual customer list (collapsible) */}
          <button
            type="button"
            onClick={() => setShowList(v => !v)}
            className="w-full flex items-center justify-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors py-1"
          >
            {showList ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            {showList ? 'Hide' : 'View'} customers ({total})
          </button>

          {showList && (
            <div className="border border-gray-100 dark:border-gray-700 rounded-xl divide-y divide-gray-50 dark:divide-gray-800 max-h-52 overflow-y-auto">
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
                        className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold text-white flex-shrink-0"
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
        <div className="px-5 pb-5">
          <button
            type="button"
            onClick={dismiss}
            className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm font-semibold text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            {allSent ? 'Done' : 'Dismiss'}
          </button>
        </div>
      </div>
    </div>
  );

  return ReactDOM.createPortal(modal, document.body);
}
