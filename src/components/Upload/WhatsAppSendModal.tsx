/**
 * WhatsApp Notification Status Toast
 *
 * TEMPORARY — shows a brief status notification after file upload while
 * D7 SMS compliance approval is pending.
 *
 * When WHATSAPP_INSTANCE_ID + WHATSAPP_TOKEN are set in env:
 *   → Backend sends WhatsApp silently to all customers (no popup, no action needed)
 *   → This component shows a brief "✓ X customers notified" toast
 *
 * When API is not configured (fallback mode):
 *   → Backend generates wa.me deep-links
 *   → Staff must manually open each customer's WhatsApp via "Send SMS" button in the table
 *   → This component shows a reminder notification
 *
 * Once D7 SMS is approved: remove this component entirely, restore smsAdapter calls.
 * DO NOT delete — SMS logic is preserved in smsService.ts (commented out).
 */
import React, { useEffect, useState, useCallback } from 'react';
import ReactDOM from 'react-dom';
import { CheckCircle, MessageCircle, X, AlertCircle } from 'lucide-react';

interface ConfirmationReady {
  deliveryId: string;
  customerName: string;
  phone: string;
  confirmationLink: string;
  whatsappUrl: string;
  sent: boolean;  // true = API sent silently; false = fallback, needs manual send
}

export default function WhatsAppSendModal() {
  const [confirmations, setConfirmations] = useState<ConfirmationReady[]>([]);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const handleEvent = (e: Event) => {
      const detail = (e as CustomEvent<{ confirmations: ConfirmationReady[] }>).detail;
      if (detail?.confirmations?.length) {
        setConfirmations(detail.confirmations);
        setVisible(true);
        // Auto-dismiss after 6 seconds for silent sends
        const allSent = detail.confirmations.every(c => c.sent);
        if (allSent) {
          setTimeout(() => setVisible(false), 6000);
        }
      }
    };
    window.addEventListener('whatsappConfirmationsReady', handleEvent);
    return () => window.removeEventListener('whatsappConfirmationsReady', handleEvent);
  }, []);

  const dismiss = useCallback(() => {
    setVisible(false);
    setConfirmations([]);
  }, []);

  if (!visible || confirmations.length === 0) return null;

  const silentlySent = confirmations.filter(c => c.sent).length;
  const needsManual = confirmations.filter(c => !c.sent).length;
  const allSilent = needsManual === 0;

  const toast = (
    <div
      style={{
        position: 'fixed',
        bottom: 24,
        right: 24,
        zIndex: 99999,
        maxWidth: 380,
        width: 'calc(100vw - 48px)',
        borderRadius: 16,
        background: allSilent ? '#fff' : '#fffbeb',
        border: `1.5px solid ${allSilent ? '#d1fae5' : '#fde68a'}`,
        boxShadow: '0 8px 32px rgba(0,0,0,0.15)',
        padding: '16px 18px',
        display: 'flex',
        gap: 14,
        alignItems: 'flex-start',
      }}
    >
      {/* Icon */}
      <div style={{
        width: 40, height: 40, borderRadius: '50%', flexShrink: 0,
        background: allSilent ? '#dcfce7' : '#fef3c7',
        display: 'flex', alignItems: 'center', justifyContent: 'center'
      }}>
        {allSilent
          ? <CheckCircle size={20} style={{ color: '#16a34a' }} />
          : <AlertCircle size={20} style={{ color: '#d97706' }} />}
      </div>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ margin: 0, fontWeight: 700, fontSize: 14, color: '#111' }}>
          {allSilent
            ? `WhatsApp Sent — ${silentlySent} customer${silentlySent !== 1 ? 's' : ''} notified`
            : `WhatsApp — ${needsManual} pending manual send`}
        </p>
        <p style={{ margin: '4px 0 0', fontSize: 12, color: '#555', lineHeight: 1.4 }}>
          {allSilent
            ? 'Confirmation messages delivered silently in the background.'
            : `API not configured — use the "Send SMS" button next to each order to notify customers manually.`}
        </p>
        {needsManual > 0 && silentlySent > 0 && (
          <p style={{ margin: '4px 0 0', fontSize: 11, color: '#888' }}>
            {silentlySent} sent silently · {needsManual} need manual send
          </p>
        )}
      </div>

      {/* Dismiss */}
      <button
        type="button"
        onClick={dismiss}
        style={{ background: 'none', border: 'none', padding: 2, cursor: 'pointer', flexShrink: 0 }}
        aria-label="Dismiss"
      >
        <X size={16} style={{ color: '#999' }} />
      </button>
    </div>
  );

  return ReactDOM.createPortal(toast, document.body);
}
