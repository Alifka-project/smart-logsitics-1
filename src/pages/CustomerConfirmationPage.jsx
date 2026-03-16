import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { AlertCircle, CheckCircle, Calendar, Package, MapPin, Phone, Loader, ChevronRight } from 'lucide-react';

export default function CustomerConfirmationPage() {
  const { token } = useParams();
  const navigate = useNavigate();
  const [delivery, setDelivery] = useState(null);
  const [availableDates, setAvailableDates] = useState([]);
  const [selectedDate, setSelectedDate] = useState('');
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [isAlreadyConfirmed, setIsAlreadyConfirmed] = useState(false);

  useEffect(() => { fetchDeliveryDetails(); }, [token]);

  const fetchDeliveryDetails = async () => {
    try {
      setLoading(true);
      setError('');
      const response = await fetch(`/api/customer/confirm-delivery/${token}`);
      const data = await response.json();
      if (!response.ok) { setError(data.message || data.error || 'Failed to load delivery details'); return; }
      setDelivery(data.delivery);
      setAvailableDates(data.availableDates || []);
      setIsAlreadyConfirmed(data.isAlreadyConfirmed || false);
      if (data.availableDates?.length > 0) setSelectedDate(data.availableDates[0]);
    } catch (err) {
      setError(err.message || 'Failed to fetch delivery details');
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmDelivery = async (e) => {
    e.preventDefault();
    if (!selectedDate) { setError('Please select a delivery date'); return; }
    try {
      setConfirming(true);
      setError('');
      const response = await fetch(`/api/customer/confirm-delivery/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deliveryDate: selectedDate })
      });
      const data = await response.json();
      if (!response.ok) { setError(data.message || data.error || 'Failed to confirm delivery'); return; }
      setSuccess(true);
      setDelivery(data.delivery);
      setTimeout(() => navigate(`/customer-tracking/${token}`), 3000);
    } catch (err) {
      setError(err.message || 'Failed to confirm delivery');
    } finally {
      setConfirming(false);
    }
  };

  const formatDate = (dateStr) => new Date(dateStr + 'T00:00:00').toLocaleDateString('en-AE', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #003057 0%, #005082 100%)' }}>
      <div className="text-center">
        <Loader className="w-12 h-12 text-white animate-spin mx-auto mb-4" />
        <p className="text-white text-lg font-medium">Loading your delivery details...</p>
      </div>
    </div>
  );

  if (error && !delivery) return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: 'linear-gradient(135deg, #003057 0%, #005082 100%)' }}>
      <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-md w-full text-center">
        <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <AlertCircle className="w-9 h-9 text-red-600" />
        </div>
        <h1 className="text-xl font-bold text-gray-800 mb-3">Link Unavailable</h1>
        <p className="text-gray-600 mb-6 text-sm">{error}</p>
        <p className="text-sm text-gray-500">For assistance, call <a href="tel:+971524408687" className="text-blue-600 font-semibold">+971 52 440 8687</a></p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen" style={{ background: 'linear-gradient(160deg, #f0f4f8 0%, #e8edf2 100%)' }}>
      {/* Header */}
      <div className="w-full py-6 px-4" style={{ background: 'linear-gradient(135deg, #003057 0%, #005082 100%)' }}>
        <div className="max-w-2xl mx-auto flex flex-col items-center">
          <img src="/elect home.png" alt="Electrolux" className="h-10 mb-3 brightness-0 invert" />
          <h1 className="text-2xl font-bold text-white tracking-wide">Delivery Confirmation</h1>
          <p className="text-blue-200 text-sm mt-1">
            {isAlreadyConfirmed ? 'Your delivery is confirmed' : 'Please confirm your delivery and select a date'}
          </p>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        {/* Success Banner */}
        {success && (
          <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex items-start gap-3">
            <div className="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0">
              <CheckCircle className="w-5 h-5 text-green-600" />
            </div>
            <div>
              <p className="font-semibold text-green-800">Delivery Confirmed!</p>
              <p className="text-green-700 text-sm">Thank you. Redirecting you to tracking shortly...</p>
            </div>
          </div>
        )}

        {/* Error Banner */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
            <p className="text-red-700 text-sm">{error}</p>
          </div>
        )}

        {delivery && (
          <>
            {/* Order Details Card */}
            <div className="bg-white rounded-2xl shadow-sm overflow-hidden border border-gray-100">
              <div className="px-5 py-4 border-b border-gray-100">
                <h2 className="font-bold text-gray-800 text-base">Order Details</h2>
              </div>
              <div className="p-5 space-y-4">
                {delivery.poNumber && (
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: '#e8f0fe' }}>
                      <Package className="w-4 h-4" style={{ color: '#003057' }} />
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">PO Number</p>
                      <p className="font-bold text-gray-800">{delivery.poNumber}</p>
                    </div>
                  </div>
                )}
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5" style={{ background: '#e8f0fe' }}>
                    <MapPin className="w-4 h-4" style={{ color: '#003057' }} />
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">Delivery Address</p>
                    <p className="font-semibold text-gray-800 text-sm">{delivery.address}</p>
                  </div>
                </div>
                {delivery.phone && (
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: '#e8f0fe' }}>
                      <Phone className="w-4 h-4" style={{ color: '#003057' }} />
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">Phone</p>
                      <p className="font-semibold text-gray-800">{delivery.phone}</p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Items Card */}
            {delivery.items?.length > 0 && (
              <div className="bg-white rounded-2xl shadow-sm overflow-hidden border border-gray-100">
                <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
                  <Package className="w-4 h-4 text-gray-500" />
                  <h2 className="font-bold text-gray-800 text-base">Items</h2>
                </div>
                <div className="divide-y divide-gray-50">
                  {(Array.isArray(delivery.items) ? delivery.items : [delivery.items]).map((item, idx) => (
                    <div key={idx} className="px-5 py-3 flex items-center gap-3">
                      <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: '#003057' }} />
                      <p className="text-sm font-medium text-gray-700">
                        {typeof item === 'string' ? item : (item.name || item.description || item.sku || 'Item')}
                        {typeof item === 'object' && item.quantity && <span className="text-gray-400 ml-2">× {item.quantity}</span>}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Date Selection / Confirmed State */}
            {!isAlreadyConfirmed && !success ? (
              <div className="bg-white rounded-2xl shadow-sm overflow-hidden border border-gray-100">
                <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-gray-500" />
                  <h2 className="font-bold text-gray-800 text-base">Select Delivery Date</h2>
                </div>
                <form onSubmit={handleConfirmDelivery} className="p-5 space-y-4">
                  <div className="grid grid-cols-1 gap-2">
                    {availableDates.map((date) => (
                      <label
                        key={date}
                        className={`flex items-center gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all ${
                          selectedDate === date
                            ? 'border-blue-600 bg-blue-50'
                            : 'border-gray-200 hover:border-blue-300 bg-white'
                        }`}
                      >
                        <input
                          type="radio"
                          name="delivery-date"
                          value={date}
                          checked={selectedDate === date}
                          onChange={() => setSelectedDate(date)}
                          className="sr-only"
                        />
                        <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                          selectedDate === date ? 'border-blue-600' : 'border-gray-300'
                        }`}>
                          {selectedDate === date && <div className="w-2.5 h-2.5 rounded-full bg-blue-600" />}
                        </div>
                        <span className={`text-sm font-medium ${selectedDate === date ? 'text-blue-800' : 'text-gray-700'}`}>
                          {formatDate(date)}
                        </span>
                      </label>
                    ))}
                  </div>

                  <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-xl">
                    <input type="checkbox" id="confirm-cb" required className="w-4 h-4 mt-0.5 rounded" style={{ accentColor: '#003057' }} />
                    <label htmlFor="confirm-cb" className="text-xs text-gray-600 leading-relaxed">
                      I confirm this order and agree to the selected delivery date.
                    </label>
                  </div>

                  <button
                    type="submit"
                    disabled={confirming || !selectedDate}
                    className="w-full py-3.5 px-6 rounded-xl font-bold text-white text-sm flex items-center justify-center gap-2 transition-opacity disabled:opacity-50"
                    style={{ background: confirming || !selectedDate ? '#9ca3af' : 'linear-gradient(135deg, #003057 0%, #005082 100%)' }}
                  >
                    {confirming ? (
                      <><Loader className="w-4 h-4 animate-spin" />Confirming...</>
                    ) : (
                      <><CheckCircle className="w-4 h-4" />Confirm Delivery<ChevronRight className="w-4 h-4 ml-auto" /></>
                    )}
                  </button>
                </form>
              </div>
            ) : isAlreadyConfirmed ? (
              <div className="bg-white rounded-2xl shadow-sm border border-green-200 overflow-hidden">
                <div className="p-5 flex items-start gap-3">
                  <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0">
                    <CheckCircle className="w-6 h-6 text-green-600" />
                  </div>
                  <div className="flex-1">
                    <p className="font-bold text-green-800">Delivery Already Confirmed</p>
                    {delivery.confirmedDate && (
                      <p className="text-sm text-green-700 mt-1">
                        Scheduled for <strong>{new Date(delivery.confirmedDate).toLocaleDateString('en-AE', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</strong>
                      </p>
                    )}
                    <button
                      onClick={() => navigate(`/customer-tracking/${token}`)}
                      className="mt-3 text-sm font-semibold flex items-center gap-1"
                      style={{ color: '#003057' }}
                    >
                      View Tracking <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
          </>
        )}

        {/* Footer */}
        <div className="text-center py-4">
          <p className="text-xs text-gray-500">
            Need help?{' '}
            <a href="tel:+971524408687" className="font-semibold" style={{ color: '#003057' }}>
              +971 52 440 8687
            </a>
            {' '}· Electrolux Delivery Team
          </p>
          <p className="text-xs text-gray-400 mt-1">electrolux-smart-portal.vercel.app</p>
        </div>
      </div>
    </div>
  );
}
