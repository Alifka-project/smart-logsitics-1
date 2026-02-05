import React, { useEffect, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { AlertCircle, Loader, MapPin, Truck, Clock, Package, Phone, Navigation } from 'lucide-react';
import { MapContainer, TileLayer, Marker, Popup, Polyline } from 'react-leaflet';
import L from 'leaflet';

// Fix for default marker icons in react-leaflet
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.3.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.3.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.3.1/images/marker-shadow.png',
});

const statusColors = {
  'pending': 'bg-yellow-100 text-yellow-800 border-yellow-300',
  'confirmed': 'bg-blue-100 text-blue-800 border-blue-300',
  'scheduled': 'bg-blue-100 text-blue-800 border-blue-300',
  'in-transit': 'bg-purple-100 text-purple-800 border-purple-300',
  'out-for-delivery': 'bg-orange-100 text-orange-800 border-orange-300',
  'delivered': 'bg-green-100 text-green-800 border-green-300',
  'failed': 'bg-red-100 text-red-800 border-red-300',
};

const statusIcons = {
  'pending': Clock,
  'confirmed': Package,
  'scheduled': Package,
  'in-transit': Truck,
  'out-for-delivery': Navigation,
  'delivered': MapPin,
  'failed': AlertCircle,
};

export default function CustomerTrackingPage() {
  const { token } = useParams();
  const [tracking, setTracking] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(new Date());

  // Fetch tracking data
  const fetchTracking = useCallback(async () => {
    try {
      const response = await fetch(`/api/customer/tracking/${token}`);
      const data = await response.json();

      if (!response.ok) {
        setError(data.message || data.error || 'Failed to load tracking');
        return;
      }

      setTracking(data);
      setLastUpdated(new Date());
      setError('');
    } catch (err) {
      console.error('Fetch error:', err);
      setError(err.message || 'Failed to fetch tracking data');
    } finally {
      setLoading(false);
    }
  }, [token]);

  // Initial fetch and auto-refresh
  useEffect(() => {
    fetchTracking();

    // Auto-refresh every 30 seconds if enabled
    if (autoRefresh) {
      const interval = setInterval(fetchTracking, 30000);
      return () => clearInterval(interval);
    }
  }, [token, autoRefresh, fetchTracking]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-blue-100 flex items-center justify-center p-4">
        <div className="text-center">
          <Loader className="w-12 h-12 text-blue-600 animate-spin mx-auto mb-4" />
          <p className="text-gray-700 text-lg">Loading tracking information...</p>
        </div>
      </div>
    );
  }

  if (error && !tracking) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-red-50 to-red-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-lg shadow-xl p-8 max-w-md w-full text-center">
          <AlertCircle className="w-16 h-16 text-red-600 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-gray-800 mb-4">Error</h1>
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

  if (!tracking) return null;

  const { delivery, tracking: trackingInfo, timeline } = tracking;
  const statusClass = statusColors[delivery.status] || statusColors['pending'];
  const StatusIcon = statusIcons[delivery.status] || Clock;

  // Prepare coordinates for map
  const coordinates = [];
  if (delivery.lat && delivery.lng) {
    coordinates.push([delivery.lat, delivery.lng]); // Delivery location
  }
  if (trackingInfo.driverLocation) {
    coordinates.push([trackingInfo.driverLocation.latitude, trackingInfo.driverLocation.longitude]); // Driver location
  }

  // Map center (default to delivery location or driver location)
  const mapCenter = delivery.lat && delivery.lng 
    ? [delivery.lat, delivery.lng] 
    : (trackingInfo.driverLocation 
        ? [trackingInfo.driverLocation.latitude, trackingInfo.driverLocation.longitude]
        : [25.2048, 55.2708]); // Dubai default

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="bg-white rounded-lg shadow-lg p-6 mb-8">
          <div className="flex items-center justify-between mb-4 flex-wrap gap-4">
            <div>
              <img 
                src="/elect home.png" 
                alt="Electrolux" 
                className="h-10 mb-2"
              />
              <h1 className="text-3xl font-bold text-gray-800">Real-Time Tracking</h1>
            </div>
            
            <div className="text-right">
              <div className={`inline-block px-4 py-2 rounded-lg border-2 font-semibold flex items-center gap-2 ${statusClass}`}>
                <StatusIcon className="w-5 h-5" />
                {delivery.status.charAt(0).toUpperCase() + delivery.status.slice(1).replace('-', ' ')}
              </div>
            </div>
          </div>

          {error && (
            <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded mb-4">
              <p className="text-red-700">{error}</p>
            </div>
          )}

          <div className="text-sm text-gray-600">
            Last updated: {lastUpdated.toLocaleTimeString()}
            <button
              onClick={fetchTracking}
              className="ml-4 text-blue-600 hover:text-blue-800 font-semibold"
            >
              Refresh Now
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Main Content */}
          <div className="lg:col-span-2 space-y-8">
            {/* Map Section */}
            {(delivery.lat || trackingInfo.driverLocation) && (
              <div className="bg-white rounded-lg shadow-lg overflow-hidden">
                <div className="h-96 relative">
                  <MapContainer
                    center={mapCenter}
                    zoom={13}
                    className="w-full h-full"
                  >
                    <TileLayer
                      url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                      attribution='&copy; OpenStreetMap contributors'
                    />
                    
                    {/* Delivery location */}
                    {delivery.lat && delivery.lng && (
                      <Marker position={[delivery.lat, delivery.lng]}>
                        <Popup>
                          <div className="text-sm">
                            <p className="font-bold">Delivery Location</p>
                            <p>{delivery.address}</p>
                          </div>
                        </Popup>
                      </Marker>
                    )}

                    {/* Driver location */}
                    {trackingInfo.driverLocation && (
                      <Marker position={[trackingInfo.driverLocation.latitude, trackingInfo.driverLocation.longitude]}>
                        <Popup>
                          <div className="text-sm">
                            <p className="font-bold">Driver Location</p>
                            {trackingInfo.driver && (
                              <p>{trackingInfo.driver.name}</p>
                            )}
                          </div>
                        </Popup>
                      </Marker>
                    )}

                    {/* Route line */}
                    {coordinates.length === 2 && (
                      <Polyline positions={coordinates} color="blue" weight={3} opacity={0.7} />
                    )}
                  </MapContainer>
                </div>
              </div>
            )}

            {/* Order Information */}
            <div className="bg-white rounded-lg shadow-lg p-6">
              <h2 className="text-2xl font-bold text-gray-800 mb-4">Order Information</h2>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <p className="text-sm text-gray-600 mb-1">PO Number</p>
                  <p className="font-semibold text-lg text-gray-800">{delivery.poNumber || delivery.PONumber || 'N/A'}</p>
                </div>

                <div>
                  <p className="text-sm text-gray-600 mb-1">Delivery Address</p>
                  <p className="font-semibold text-gray-800">{delivery.address}</p>
                </div>

                {delivery.confirmedDeliveryDate && (
                  <div>
                    <p className="text-sm text-gray-600 mb-1">Confirmed Delivery Date</p>
                    <p className="font-semibold text-gray-800">
                      {new Date(delivery.confirmedDeliveryDate).toLocaleDateString()}
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Items */}
            {delivery.items && delivery.items.length > 0 && (
              <div className="bg-white rounded-lg shadow-lg p-6">
                <h2 className="text-2xl font-bold text-gray-800 mb-4 flex items-center">
                  <Package className="w-6 h-6 mr-2 text-blue-600" />
                  Items
                </h2>
                
                <div className="space-y-3">
                  {Array.isArray(delivery.items) ? (
                    delivery.items.map((item, idx) => (
                      <div key={idx} className="flex items-center p-4 bg-gray-50 rounded-lg border border-gray-200">
                        <div className="flex-1">
                          <p className="font-semibold text-gray-800">
                            {typeof item === 'string' ? item : (item.name || item.description || 'Item')}
                          </p>
                          {typeof item === 'object' && (
                            <div className="text-sm text-gray-600 mt-1">
                              {item.quantity && <p>Quantity: {item.quantity}</p>}
                              {item.sku && <p>SKU: {item.sku}</p>}
                            </div>
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
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Driver Information */}
            {trackingInfo.driver && (
              <div className="bg-white rounded-lg shadow-lg p-6">
                <h3 className="text-xl font-bold text-gray-800 mb-4 flex items-center">
                  <Truck className="w-5 h-5 mr-2 text-blue-600" />
                  Driver
                </h3>
                
                <div className="space-y-3">
                  <div>
                    <p className="text-sm text-gray-600">Name</p>
                    <p className="font-semibold text-gray-800">{trackingInfo.driver.name}</p>
                  </div>

                  {trackingInfo.driver.phone && (
                    <div>
                      <p className="text-sm text-gray-600 flex items-center mb-1">
                        <Phone className="w-4 h-4 mr-1" />
                        Contact
                      </p>
                      <a 
                        href={`tel:${trackingInfo.driver.phone}`}
                        className="font-semibold text-blue-600 hover:text-blue-800"
                      >
                        {trackingInfo.driver.phone}
                      </a>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ETA */}
            {trackingInfo.eta && (
              <div className="bg-white rounded-lg shadow-lg p-6">
                <h3 className="text-xl font-bold text-gray-800 mb-4 flex items-center">
                  <Clock className="w-5 h-5 mr-2 text-blue-600" />
                  Estimated Arrival
                </h3>
                
                <p className="text-3xl font-bold text-blue-600">
                  {new Date(trackingInfo.eta).toLocaleTimeString([], { 
                    hour: '2-digit', 
                    minute: '2-digit' 
                  })}
                </p>
                <p className="text-sm text-gray-600 mt-2">
                  {new Date(trackingInfo.eta).toLocaleDateString()}
                </p>
              </div>
            )}

            {/* Auto-Refresh Toggle */}
            <div className="bg-white rounded-lg shadow-lg p-6">
              <label className="flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoRefresh}
                  onChange={(e) => setAutoRefresh(e.target.checked)}
                  className="w-5 h-5 text-blue-600 rounded focus:ring-blue-500"
                />
                <span className="ml-3 font-semibold text-gray-800">
                  Auto-refresh (30s)
                </span>
              </label>
            </div>
          </div>
        </div>

        {/* Timeline */}
        {timeline && timeline.length > 0 && (
          <div className="bg-white rounded-lg shadow-lg p-6 mt-8">
            <h2 className="text-2xl font-bold text-gray-800 mb-6">Delivery Timeline</h2>
            
            <div className="space-y-4">
              {timeline.map((event, idx) => (
                <div key={idx} className="flex gap-4">
                  <div className="flex flex-col items-center">
                    <div className="w-4 h-4 bg-blue-600 rounded-full border-2 border-white"></div>
                    {idx < timeline.length - 1 && (
                      <div className="w-1 h-12 bg-blue-200 mt-2"></div>
                    )}
                  </div>
                  
                  <div className="pb-8">
                    <p className="font-semibold text-gray-800 capitalize">
                      {event.type.replace(/_/g, ' ')}
                    </p>
                    <p className="text-sm text-gray-600">
                      {new Date(event.timestamp).toLocaleString()}
                    </p>
                    {event.details && (
                      <p className="text-sm text-gray-700 mt-1 bg-gray-50 p-2 rounded">
                        {typeof event.details === 'object' 
                          ? JSON.stringify(event.details, null, 2) 
                          : event.details}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Support Footer */}
        <div className="mt-8 text-center text-gray-600">
          <p className="text-sm">
            Need help? Contact us at support@electrolux-logistics.com
          </p>
        </div>
      </div>
    </div>
  );
}
