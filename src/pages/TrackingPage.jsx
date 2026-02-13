import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../frontend/apiClient';
import { CheckCircle, XCircle, Clock, Package } from 'lucide-react';

export default function TrackingPage() {
  const { deliveryId } = useParams();
  const navigate = useNavigate();
  const [delivery] = useState(null);
  const [code, setCode] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    loadDelivery();
  }, [deliveryId]);

  const loadDelivery = async () => {
    try {
      // Try to get delivery info (this would need to be a public endpoint)
      // For now, we'll just show the confirmation form
    } catch (e) {
      console.error('Error loading delivery:', e);
    }
  };

  const handleConfirm = async (e) => {
    e.preventDefault();
    if (!code || code.length !== 4) {
      setError('Please enter a valid 4-digit code');
      return;
    }

    setConfirming(true);
    setError(null);

    try {
      await api.post('/sms/confirm', { deliveryId, code });
      setConfirmed(true);
    } catch (e) {
      setError(e?.response?.data?.error || 'Invalid confirmation code. Please try again.');
    } finally {
      setConfirming(false);
    }
  };

  const getStatusInfo = (status) => {
    const statusMap = {
      'scheduled': { icon: Clock, text: 'Scheduled', color: 'text-purple-600' },
      'scheduled-confirmed': { icon: CheckCircle, text: 'Confirmed', color: 'text-blue-600' },
      'out-for-delivery': { icon: Package, text: 'Out for Delivery', color: 'text-indigo-600' },
      'delivered-with-installation': { icon: CheckCircle, text: 'Delivered (With Installation)', color: 'text-green-600' },
      'delivered-without-installation': { icon: CheckCircle, text: 'Delivered (No Installation)', color: 'text-green-600' },
      'delivered': { icon: CheckCircle, text: 'Delivered', color: 'text-green-600' },
      'cancelled': { icon: XCircle, text: 'Cancelled', color: 'text-red-600' },
      'rejected': { icon: XCircle, text: 'Rejected', color: 'text-red-600' },
      'rescheduled': { icon: Clock, text: 'Rescheduled', color: 'text-orange-600' },
    };

    return statusMap[status?.toLowerCase()] || { icon: Clock, text: 'Pending', color: 'text-gray-600' };
  };

  if (confirmed) {
    const statusInfo = getStatusInfo(delivery?.status);
    const Icon = statusInfo.icon;

    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-8 text-center">
          <div className={`mx-auto w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mb-4`}>
            <CheckCircle className="w-10 h-10 text-green-600" />
          </div>
          <h1 className="text-2xl font-bold text-gray-800 mb-2">Delivery Confirmed!</h1>
          <p className="text-gray-600 mb-6">
            Thank you for confirming your delivery. We'll keep you updated on the status.
          </p>
          {delivery && (
            <div className="bg-gray-50 rounded-lg p-4 mb-6">
              <div className="flex items-center justify-center gap-2 mb-2">
                <Icon className={`w-5 h-5 ${statusInfo.color}`} />
                <span className={`font-semibold ${statusInfo.color}`}>{statusInfo.text}</span>
              </div>
              <div className="text-sm text-gray-600">
                Delivery ID: {deliveryId}
              </div>
            </div>
          )}
          <button
            onClick={() => navigate('/')}
            className="w-full px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-8">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold text-gray-800 mb-2">Confirm Your Delivery</h1>
          <p className="text-gray-600">
            Please enter the 4-digit confirmation code sent to your phone
          </p>
        </div>

        <form onSubmit={handleConfirm} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Confirmation Code
            </label>
            <input
              type="text"
              value={code}
              onChange={(e) => {
                const value = e.target.value.replace(/\D/g, '').slice(0, 4);
                setCode(value);
                setError(null);
              }}
              className="w-full px-4 py-3 text-center text-2xl font-mono tracking-widest border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              placeholder="0000"
              maxLength={4}
              autoFocus
            />
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
              <div className="flex items-center gap-2 text-red-600">
                <XCircle className="w-5 h-5" />
                <span className="text-sm">{error}</span>
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={confirming || code.length !== 4}
            className="w-full px-4 py-3 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed font-semibold"
          >
            {confirming ? 'Confirming...' : 'Confirm Delivery'}
          </button>
        </form>

        <div className="mt-6 text-center">
          <p className="text-sm text-gray-500">
            Delivery ID: <span className="font-mono">{deliveryId}</span>
          </p>
        </div>
      </div>
    </div>
  );
}

