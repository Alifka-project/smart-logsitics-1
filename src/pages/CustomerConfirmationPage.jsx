import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { AlertCircle, CheckCircle, Calendar, Package, MapPin, Phone, FileText, Loader } from 'lucide-react';
import api from '../frontend/apiClient';

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

  // Fetch delivery details
  useEffect(() => {
    fetchDeliveryDetails();
  }, [token]);

  const fetchDeliveryDetails = async () => {
    try {
      setLoading(true);
      setError('');

      // Use fetch instead of api client to avoid authentication headers
      const response = await fetch(`/api/customer/confirm-delivery/${token}`);
      const data = await response.json();

      if (!response.ok) {
        setError(data.message || data.error || 'Failed to load delivery details');
        return;
      }

      setDelivery(data.delivery);
      setAvailableDates(data.availableDates || []);
      setIsAlreadyConfirmed(data.isAlreadyConfirmed || false);

      // Set first available date as default
      if (data.availableDates && data.availableDates.length > 0) {
        setSelectedDate(data.availableDates[0]);
      }
    } catch (err) {
      setError(err.message || 'Failed to fetch delivery details');
      console.error('Fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmDelivery = async (e) => {
    e.preventDefault();

    if (!selectedDate) {
      setError('Please select a delivery date');
      return;
    }

    try {
      setConfirming(true);
      setError('');

      const response = await fetch(`/api/customer/confirm-delivery/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deliveryDate: selectedDate })
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.message || data.error || 'Failed to confirm delivery');
        return;
      }

      setSuccess(true);
      setDelivery(data.delivery);

      // Redirect to tracking page after 3 seconds
      setTimeout(() => {
        navigate(`/customer-tracking/${token}`);
      }, 3000);
    } catch (err) {
      setError(err.message || 'Failed to confirm delivery');
      console.error('Confirm error:', err);
    } finally {
      setConfirming(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-blue-100 flex items-center justify-center p-4">
        <div className="text-center">
          <Loader className="w-12 h-12 text-blue-600 animate-spin mx-auto mb-4" />
          <p className="text-gray-700 text-lg">Loading your delivery details...</p>
        </div>
      </div>
    );
  }

  if (error && !delivery) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-red-50 to-red-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-lg shadow-xl p-8 max-w-md w-full text-center">
          <AlertCircle className="w-16 h-16 text-red-600 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-gray-800 mb-4">Oops!</h1>
          <p className="text-gray-600 mb-6">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-6 rounded-lg transition-colors"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-blue-100 py-8 px-4">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <img 
            src="/elect home.png" 
            alt="Electrolux" 
            className="h-12 mx-auto mb-4"
          />
          <h1 className="text-3xl md:text-4xl font-bold text-gray-800 mb-2">
            Delivery Confirmation
          </h1>
          <p className="text-gray-600">
            {isAlreadyConfirmed ? 'Your delivery is confirmed' : 'Please confirm your delivery and select a date'}
          </p>
        </div>

        {success && (
          <div className="mb-6 bg-green-50 border-l-4 border-green-500 p-4 rounded-lg">
            <div className="flex items-start">
              <CheckCircle className="w-6 h-6 text-green-500 mt-0.5 mr-3 flex-shrink-0" />
              <div>
                <h3 className="font-semibold text-green-800">Delivery Confirmed!</h3>
                <p className="text-green-700">
                  Thank you for confirming your delivery. You'll be redirected to tracking shortly.
                </p>
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="mb-6 bg-red-50 border-l-4 border-red-500 p-4 rounded-lg">
            <div className="flex items-start">
              <AlertCircle className="w-6 h-6 text-red-500 mt-0.5 mr-3 flex-shrink-0" />
              <div>
                <h3 className="font-semibold text-red-800">Error</h3>
                <p className="text-red-700">{error}</p>
              </div>
            </div>
          </div>
        )}

        {delivery && (
          <div className="bg-white rounded-lg shadow-lg overflow-hidden">
            {/* Order Details Section */}
            <div className="bg-gradient-to-r from-blue-600 to-blue-700 text-white p-6">
              <h2 className="text-2xl font-bold mb-4">Order Details</h2>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="flex items-start">
                  <FileText className="w-5 h-5 mt-1 mr-3 flex-shrink-0" />
                  <div>
                    <p className="text-blue-100 text-sm">Order ID</p>
                    <p className="font-semibold text-lg">{delivery.id}</p>
                  </div>
                </div>

                {delivery.poNumber && (
                  <div className="flex items-start">
                    <FileText className="w-5 h-5 mt-1 mr-3 flex-shrink-0" />
                    <div>
                      <p className="text-blue-100 text-sm">PO Number</p>
                      <p className="font-semibold text-lg">{delivery.poNumber}</p>
                    </div>
                  </div>
                )}

                <div className="flex items-start">
                  <MapPin className="w-5 h-5 mt-1 mr-3 flex-shrink-0" />
                  <div>
                    <p className="text-blue-100 text-sm">Delivery Address</p>
                    <p className="font-semibold">{delivery.address}</p>
                  </div>
                </div>

                {delivery.phone && (
                  <div className="flex items-start">
                    <Phone className="w-5 h-5 mt-1 mr-3 flex-shrink-0" />
                    <div>
                      <p className="text-blue-100 text-sm">Phone</p>
                      <p className="font-semibold">{delivery.phone}</p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Items Section */}
            {delivery.items && delivery.items.length > 0 && (
              <div className="border-b p-6">
                <div className="flex items-center mb-4">
                  <Package className="w-6 h-6 text-blue-600 mr-2" />
                  <h3 className="text-xl font-bold text-gray-800">Items</h3>
                </div>
                
                <div className="space-y-3">
                  {Array.isArray(delivery.items) ? (
                    delivery.items.map((item, idx) => (
                      <div key={idx} className="flex items-center p-3 bg-gray-50 rounded-lg">
                        <div className="flex-1">
                          <p className="font-semibold text-gray-800">
                            {typeof item === 'string' ? item : (item.name || item.description || 'Item')}
                          </p>
                          {typeof item === 'object' && item.quantity && (
                            <p className="text-sm text-gray-600">Qty: {item.quantity}</p>
                          )}
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="text-gray-600">{delivery.items}</p>
                  )}
                </div>
              </div>
            )}

            {/* Confirmation Form Section */}
            {!isAlreadyConfirmed && !success && (
              <form onSubmit={handleConfirmDelivery} className="p-6 border-t">
                <div className="mb-6">
                  <label className="flex items-center mb-3">
                    <Calendar className="w-5 h-5 text-blue-600 mr-2" />
                    <span className="font-semibold text-gray-800">Select Delivery Date</span>
                  </label>
                  
                  <select
                    value={selectedDate}
                    onChange={(e) => setSelectedDate(e.target.value)}
                    className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:outline-none focus:border-blue-500 bg-white text-gray-800 font-medium"
                  >
                    <option value="">-- Choose a date --</option>
                    {availableDates.map((date) => (
                      <option key={date} value={date}>
                        {new Date(date + 'T00:00:00').toLocaleDateString('en-US', {
                          weekday: 'long',
                          year: 'numeric',
                          month: 'long',
                          day: 'numeric'
                        })}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-start mb-6 p-4 bg-blue-50 rounded-lg border border-blue-200">
                  <input
                    type="checkbox"
                    id="confirm-checkbox"
                    required
                    className="w-5 h-5 text-blue-600 rounded focus:ring-blue-500 mt-0.5 mr-3"
                  />
                  <label htmlFor="confirm-checkbox" className="text-sm text-gray-700">
                    I confirm this order and the selected delivery date. I understand that I will receive tracking information via SMS.
                  </label>
                </div>

                <button
                  type="submit"
                  disabled={confirming || !selectedDate}
                  className="w-full bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 disabled:from-gray-400 disabled:to-gray-500 text-white font-bold py-3 px-6 rounded-lg transition-all duration-200 transform hover:scale-105 disabled:scale-100 disabled:cursor-not-allowed flex items-center justify-center"
                >
                  {confirming ? (
                    <>
                      <Loader className="w-5 h-5 animate-spin mr-2" />
                      Confirming...
                    </>
                  ) : (
                    <>
                      <CheckCircle className="w-5 h-5 mr-2" />
                      Confirm Delivery
                    </>
                  )}
                </button>
              </form>
            )}

            {isAlreadyConfirmed && (
              <div className="p-6 border-t bg-green-50">
                <div className="flex items-start">
                  <CheckCircle className="w-6 h-6 text-green-600 mt-1 mr-3 flex-shrink-0" />
                  <div>
                    <h3 className="font-bold text-green-800 mb-1">Delivery Confirmed</h3>
                    <p className="text-green-700">
                      Your delivery has been confirmed for{' '}
                      <span className="font-semibold">
                        {delivery.confirmedDate ? new Date(delivery.confirmedDate).toLocaleDateString() : 'the selected date'}
                      </span>
                    </p>
                    <button
                      onClick={() => navigate(`/customer-tracking/${token}`)}
                      className="mt-3 text-green-700 hover:text-green-800 font-semibold underline"
                    >
                      View Real-Time Tracking →
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Footer Info */}
        <div className="mt-8 text-center text-gray-600">
          <p className="text-sm">
            Questions? Contact us at support@electrolux-logistics.com
          </p>
        </div>
      </div>
    </div>
  );
}
