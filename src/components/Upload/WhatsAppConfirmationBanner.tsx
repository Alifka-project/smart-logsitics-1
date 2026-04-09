/**
 * WhatsApp Confirmation Banner
 *
 * Listens for the `whatsappConfirmationsReady` custom event (fired by FileUpload.tsx
 * after upload) and displays a dismissable banner with clickable "Send via WhatsApp"
 * buttons for each new pending delivery.
 *
 * TEMPORARY — used while D7 SMS/WhatsApp API compliance is pending.
 * Once approved, remove this component and restore the auto-send API call.
 */
import React, { useEffect, useState } from 'react';
import { MessageCircle, X, Send, ChevronDown, ChevronUp } from 'lucide-react';

interface ConfirmationReady {
  deliveryId: string;
  customerName: string;
  phone: string;
  confirmationLink: string;
  whatsappUrl: string;
}

export default function WhatsAppConfirmationBanner() {
  const [confirmations, setConfirmations] = useState<ConfirmationReady[]>([]);
  const [expanded, setExpanded] = useState(true);
  const [sent, setSent] = useState<Set<string>>(new Set());

  useEffect(() => {
    const handleEvent = (e: Event) => {
      const detail = (e as CustomEvent<{ confirmations: ConfirmationReady[] }>).detail;
      if (detail?.confirmations?.length) {
        setConfirmations(detail.confirmations);
        setExpanded(true);
        setSent(new Set());
      }
    };
    window.addEventListener('whatsappConfirmationsReady', handleEvent);
    return () => window.removeEventListener('whatsappConfirmationsReady', handleEvent);
  }, []);

  if (confirmations.length === 0) return null;

  const sentCount = sent.size;
  const remaining = confirmations.length - sentCount;

  const handleSend = (c: ConfirmationReady) => {
    window.open(c.whatsappUrl, '_blank');
    setSent(prev => new Set([...prev, c.deliveryId]));
  };

  const handleSendAll = () => {
    confirmations.forEach((c, i) => {
      setTimeout(() => {
        window.open(c.whatsappUrl, '_blank');
        setSent(prev => new Set([...prev, c.deliveryId]));
      }, i * 600); // stagger to avoid popup blocking
    });
  };

  return (
    <div className="fixed bottom-4 right-4 z-50 w-80 shadow-2xl rounded-xl overflow-hidden border border-green-300 dark:border-green-700">
      {/* Header */}
      <div className="bg-green-600 text-white px-4 py-3 flex items-center gap-3">
        <MessageCircle className="w-5 h-5 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold leading-tight">WhatsApp Confirmation</p>
          <p className="text-xs text-green-100">
            {remaining > 0
              ? `${remaining} of ${confirmations.length} customers pending`
              : 'All sent ✓'}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setExpanded(v => !v)}
            className="p-1 rounded hover:bg-green-500 transition-colors"
            title={expanded ? 'Collapse' : 'Expand'}
          >
            {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
          </button>
          <button
            type="button"
            onClick={() => setConfirmations([])}
            className="p-1 rounded hover:bg-green-500 transition-colors"
            title="Dismiss"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="bg-white dark:bg-gray-900 max-h-72 overflow-y-auto">
          {/* Send All button */}
          {remaining > 1 && (
            <div className="px-3 py-2 border-b border-gray-100 dark:border-gray-700">
              <button
                type="button"
                onClick={handleSendAll}
                className="w-full flex items-center justify-center gap-2 px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-xs font-semibold rounded-lg transition-colors"
              >
                <Send className="w-3.5 h-3.5" /> Send All ({remaining}) via WhatsApp
              </button>
            </div>
          )}

          {/* Individual customer rows */}
          <div className="divide-y divide-gray-50 dark:divide-gray-800">
            {confirmations.map(c => {
              const isSent = sent.has(c.deliveryId);
              return (
                <div key={c.deliveryId} className={`px-3 py-2.5 flex items-center gap-2.5 ${isSent ? 'opacity-50' : ''}`}>
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold ${isSent ? 'bg-green-100 text-green-600' : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300'}`}>
                    {isSent ? '✓' : c.customerName.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-gray-900 dark:text-gray-100 truncate">{c.customerName}</p>
                    <p className="text-[10px] text-gray-500 dark:text-gray-400">{c.phone}</p>
                  </div>
                  {isSent ? (
                    <span className="text-[10px] text-green-600 font-semibold">Sent</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleSend(c)}
                      className="flex items-center gap-1 px-2 py-1 bg-green-600 hover:bg-green-700 text-white text-[10px] font-semibold rounded-lg transition-colors flex-shrink-0"
                    >
                      <MessageCircle className="w-3 h-3" /> Send
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
