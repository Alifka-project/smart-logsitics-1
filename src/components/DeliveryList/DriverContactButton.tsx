import React, { useState } from 'react';
import { Phone, MessageCircle, Mail } from 'lucide-react';
import type { Driver } from '../../types';

interface DriverContactButtonProps {
  driver: Driver | null | undefined;
}

export default function DriverContactButton({ driver }: DriverContactButtonProps) {
  const [sendingSms, setSendingSms] = useState(false);

  if (!driver) return null;

  const driverRaw = driver as unknown as Record<string, unknown>;
  const phone = driver.phone || (driverRaw['Phone'] as string | undefined);
  const email = driver.email || (driverRaw['Email'] as string | undefined);

  const handleCall = (): void => {
    if (phone) {
      window.location.href = `tel:${phone}`;
    }
  };

  const handleSms = async (): Promise<void> => {
    if (!phone) return;
    setSendingSms(true);
    try {
      window.location.href = `sms:${phone}`;
    } catch (e) {
      console.error('Error opening SMS:', e);
    } finally {
      setSendingSms(false);
    }
  };

  const handleEmail = (): void => {
    if (email) {
      window.location.href = `mailto:${email}`;
    }
  };

  const driverName =
    driver.full_name ||
    (driverRaw['name'] as string | undefined) ||
    'driver';

  return (
    <div className="flex items-center gap-2">
      {phone && (
        <>
          <button
            onClick={handleCall}
            className="p-2 bg-green-100 text-green-600 rounded-lg hover:bg-green-200 transition-colors"
            title={`Call ${driverName}`}
          >
            <Phone className="w-4 h-4" />
          </button>
          <button
            onClick={() => void handleSms()}
            disabled={sendingSms}
            className="p-2 bg-blue-100 text-blue-600 rounded-lg hover:bg-blue-200 transition-colors disabled:opacity-50"
            title={`Send SMS to ${driverName}`}
          >
            <MessageCircle className="w-4 h-4" />
          </button>
        </>
      )}
      {email && (
        <button
          onClick={handleEmail}
          className="p-2 bg-purple-100 text-purple-600 rounded-lg hover:bg-purple-200 transition-colors"
          title={`Email ${driverName}`}
        >
          <Mail className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}
