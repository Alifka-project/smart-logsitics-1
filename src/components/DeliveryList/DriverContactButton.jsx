import React, { useState } from 'react';
import { Phone, MessageCircle, Mail } from 'lucide-react';
import api from '../../frontend/apiClient';

export default function DriverContactButton({ driver }) {
  const [sendingSms, setSendingSms] = useState(false);

  if (!driver) return null;

  const phone = driver.phone || driver.Phone;
  const email = driver.email || driver.Email;

  const handleCall = () => {
    if (phone) {
      window.location.href = `tel:${phone}`;
    }
  };

  const handleSms = async () => {
    if (!phone) return;
    
    setSendingSms(true);
    try {
      // Open SMS app with pre-filled number
      window.location.href = `sms:${phone}`;
    } catch (e) {
      console.error('Error opening SMS:', e);
    } finally {
      setSendingSms(false);
    }
  };

  const handleEmail = () => {
    if (email) {
      window.location.href = `mailto:${email}`;
    }
  };

  return (
    <div className="flex items-center gap-2">
      {phone && (
        <>
          <button
            onClick={handleCall}
            className="p-2 bg-green-100 text-green-600 rounded-lg hover:bg-green-200 transition-colors"
            title={`Call ${driver.full_name || driver.name || 'driver'}`}
          >
            <Phone className="w-4 h-4" />
          </button>
          <button
            onClick={handleSms}
            disabled={sendingSms}
            className="p-2 bg-blue-100 text-blue-600 rounded-lg hover:bg-blue-200 transition-colors disabled:opacity-50"
            title={`Send SMS to ${driver.full_name || driver.name || 'driver'}`}
          >
            <MessageCircle className="w-4 h-4" />
          </button>
        </>
      )}
      {email && (
        <button
          onClick={handleEmail}
          className="p-2 bg-purple-100 text-purple-600 rounded-lg hover:bg-purple-200 transition-colors"
          title={`Email ${driver.full_name || driver.name || 'driver'}`}
        >
          <Mail className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}

