import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Upload, Database, MapPin, Zap } from 'lucide-react';
import FileUpload from '../components/Upload/FileUpload';
import SyntheticDataButton from '../components/Upload/SyntheticDataButton';
import useDeliveryStore from '../store/useDeliveryStore';

// Check if running in development mode
const isDevelopment = import.meta.env.DEV || import.meta.env.MODE === 'development';

export default function HomePage() {
  const navigate = useNavigate();
  const deliveries = useDeliveryStore((state) => state.deliveries);
  const [showUpload, setShowUpload] = useState(true); // Show upload by default

  const handleDataLoaded = () => {
    setShowUpload(false);
    // Delay navigation to allow state update
    setTimeout(() => {
      navigate('/deliveries');
    }, 500);
  };

  return (
    <div className="h-screen flex items-center justify-center px-4 overflow-hidden">
      <div className="w-full max-w-4xl max-h-[calc(100vh-40px)] overflow-auto">
      {/* Upload Section - Show First */}
      {showUpload && !deliveries.length ? (
        <div className="bg-white rounded-lg shadow-xl p-6 sm:p-10 mb-8">
          <div className="text-center mb-8">
            <h1 className="text-3xl sm:text-4xl font-bold text-gray-800 mb-2">
              Welcome to Smart Logistics
            </h1>
            <p className="text-gray-600 text-lg">
              Upload your delivery data to get started
            </p>
          </div>
          
          <FileUpload onDataLoaded={handleDataLoaded} />
          
          {/* Only show synthetic data in development */}
          {isDevelopment && (
            <div className="mt-8 pt-8 border-t">
              <p className="text-gray-600 text-center mb-6">
                Or try out the system with sample data:
              </p>
              <div className="flex justify-center">
                <SyntheticDataButton
                  onDataLoaded={handleDataLoaded}
                  className="w-full sm:w-auto"
                />
              </div>
            </div>
          )}

          {/* Quick Info */}
          <div className="mt-10 pt-8 border-t">
            <p className="text-center text-sm text-gray-500 mb-4">
              Supported formats: Excel (.xlsx, .csv) with delivery data
            </p>
          </div>
        </div>
      ) : (
        <>
          {/* Hero Section - Show when data is loaded */}
          <div className="bg-gradient-to-r from-primary-600 to-primary-700 text-white rounded-lg shadow-lg p-8 sm:p-12 mb-8">
            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold mb-4">
              Smart Logistics Management System
            </h1>
            <p className="text-base sm:text-lg opacity-90 mb-6">
              Efficiently manage deliveries, optimize routes, and track orders in real-time
            </p>
            <div className="flex flex-col sm:flex-row gap-3">
              <button
                onClick={() => setShowUpload(true)}
                className="bg-white text-primary-600 px-6 py-3 rounded-lg font-semibold hover:bg-gray-100 transition flex items-center justify-center gap-2"
              >
                <Upload className="w-5 h-5" />
                Upload New File
              </button>
              <button
                onClick={() => navigate('/deliveries')}
                className="bg-primary-500 text-white px-6 py-3 rounded-lg font-semibold hover:bg-primary-600 transition flex items-center justify-center gap-2"
              >
                <Database className="w-5 h-5" />
                View Deliveries
              </button>
            </div>
          </div>

          {/* Upload Section */}
          {showUpload && (
            <div className="bg-white rounded-lg shadow-lg p-6 sm:p-8 mb-8">
              <h2 className="text-2xl font-bold text-gray-800 mb-6">Upload New Delivery Data</h2>
              <FileUpload onDataLoaded={handleDataLoaded} />
              {/* Only show synthetic data in development */}
              {isDevelopment && (
                <div className="mt-6 pt-6 border-t">
                  <p className="text-gray-600 text-sm mb-4">
                    Or load sample data:
                  </p>
                  <SyntheticDataButton
                    onDataLoaded={handleDataLoaded}
                    className="w-full sm:w-auto"
                  />
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Features Section */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
        <div className="bg-white rounded-lg shadow-md p-6 hover:shadow-lg transition">
          <div className="flex items-center mb-4">
            <div className="w-12 h-12 bg-primary-100 rounded-lg flex items-center justify-center">
              <Upload className="w-6 h-6 text-primary-600" />
            </div>
            <h3 className="text-lg font-bold text-gray-800 ml-4">Easy Upload</h3>
          </div>
          <p className="text-gray-600 text-sm">
            Upload your Excel files with delivery data. Supports ERP, simplified, and generic formats.
          </p>
        </div>

        <div className="bg-white rounded-lg shadow-md p-6 hover:shadow-lg transition">
          <div className="flex items-center mb-4">
            <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
              <MapPin className="w-6 h-6 text-blue-600" />
            </div>
            <h3 className="text-lg font-bold text-gray-800 ml-4">Route Optimization</h3>
          </div>
          <p className="text-gray-600 text-sm">
            Automatically optimized delivery routes with visual mapping and turn-by-turn directions.
          </p>
        </div>

        <div className="bg-white rounded-lg shadow-md p-6 hover:shadow-lg transition">
          <div className="flex items-center mb-4">
            <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
              <Zap className="w-6 h-6 text-green-600" />
            </div>
            <h3 className="text-lg font-bold text-gray-800 ml-4">Real-time Tracking</h3>
          </div>
          <p className="text-gray-600 text-sm">
            Track deliveries in real-time with status updates, signatures, and photo confirmation.
          </p>
        </div>
      </div>

      {/* Current Status Section */}
      {deliveries.length > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 sm:p-8">
          <h2 className="text-xl font-bold text-blue-900 mb-4">📦 Current Deliveries Loaded</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            <div>
              <div className="text-3xl font-bold text-blue-600">{deliveries.length}</div>
              <div className="text-sm text-blue-700">Total Deliveries</div>
            </div>
            <div>
              <div className="text-3xl font-bold text-blue-600">
                {Math.round(deliveries.reduce((sum, d) => sum + (d.distanceFromWarehouse || 0), 0))}
              </div>
              <div className="text-sm text-blue-700">Total Distance (km)</div>
            </div>
            <div>
              <div className="text-3xl font-bold text-blue-600">
                {deliveries.filter(d => d.priority === 1).length}
              </div>
              <div className="text-sm text-blue-700">High Priority</div>
            </div>
          </div>
          <button
            onClick={() => navigate('/deliveries')}
            className="w-full sm:w-auto bg-blue-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-blue-700 transition"
          >
            View All Deliveries →
          </button>
        </div>
      )}

      {/* Getting Started Section */}
      {deliveries.length === 0 && (
        <div className="bg-gray-100 rounded-lg p-6 sm:p-8">
          <h2 className="text-xl font-bold text-gray-800 mb-4">Getting Started</h2>
          <ol className="space-y-3 text-gray-700">
            <li className="flex gap-4">
              <span className="flex-shrink-0 w-8 h-8 bg-primary-600 text-white rounded-full flex items-center justify-center font-bold">
                1
              </span>
              <span>
                <strong>Upload or Load Data:</strong> Click "Upload File" or "Load Sample Data" above
              </span>
            </li>
            <li className="flex gap-4">
              <span className="flex-shrink-0 w-8 h-8 bg-primary-600 text-white rounded-full flex items-center justify-center font-bold">
                2
              </span>
              <span>
                <strong>View Deliveries:</strong> See all deliveries in the list sorted by distance
              </span>
            </li>
            <li className="flex gap-4">
              <span className="flex-shrink-0 w-8 h-8 bg-primary-600 text-white rounded-full flex items-center justify-center font-bold">
                3
              </span>
              <span>
                <strong>Optimize Routes:</strong> Check the map view for optimized delivery routes
              </span>
            </li>
            <li className="flex gap-4">
                <span className="flex-shrink-0 w-8 h-8 bg-primary-600 text-white rounded-full flex items-center justify-center font-bold">
                4
              </span>
              <span>
                <strong>Manage Deliveries:</strong> Edit details, upload photos, capture signatures
              </span>
            </li>
          </ol>
        </div>
      )}
      </div>
    </div>
  );
}
