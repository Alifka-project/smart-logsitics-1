import React, { useState } from 'react';
import { MessageCircle, CheckCircle, XCircle } from 'lucide-react';
import api from '../../frontend/apiClient';

export default function SMSConfirmationButton({ delivery, onSuccess }) {
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(null);

  const handleSendConfirmation = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await api.post('/sms/send-confirmation', {
        deliveryId: delivery.id || delivery.ID
      });

      setSent(true);
      if (onSuccess) {
        onSuccess(response.data);
      }
    } catch (e) {
      console.error('Error sending confirmation SMS:', e);
      setError(e?.response?.data?.error || 'Failed to send SMS');
    } finally {
      setLoading(false);
    }
  };

  const isConfirmed = delivery.status === 'scheduled-confirmed';

  if (isConfirmed) {
    return (
      <div className="flex items-center gap-2 text-green-600">
        <CheckCircle className="w-4 h-4" />
        <span className="text-sm">Confirmed</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        onClick={handleSendConfirmation}
        disabled={loading || sent}
        className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
          sent
            ? 'bg-green-100 text-green-700'
            : 'bg-blue-100 text-blue-700 hover:bg-blue-200'
        } disabled:opacity-50`}
      >
        {loading ? (
          <>
            <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
            <span>Sending...</span>
          </>
        ) : sent ? (
          <>
            <CheckCircle className="w-4 h-4" />
            <span>SMS Sent</span>
          </>
        ) : (
          <>
            <MessageCircle className="w-4 h-4" />
            <span>Send Confirmation SMS</span>
          </>
        )}
      </button>
      {error && (
        <div className="flex items-center gap-1 text-red-600 text-xs">
          <XCircle className="w-3 h-3" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}

