import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Upload, Database, MapPin, Zap } from 'lucide-react';
import FileUpload from '../components/Upload/FileUpload';
import useDeliveryStore from '../store/useDeliveryStore';

export default function HomePage() {
  const navigate = useNavigate();
  const deliveries = useDeliveryStore((state) => state.deliveries);
  const [showUpload, setShowUpload] = useState(true);

  const handleDataLoaded = (): void => {
    setShowUpload(false);
    setTimeout(() => {
      void navigate('/deliveries');
    }, 500);
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-4 sm:py-6 overflow-x-hidden">
      <div className="w-full max-w-4xl max-h-[calc(100dvh-32px)] sm:max-h-[calc(100vh-40px)] overflow-auto">
        {showUpload && !deliveries.length ? (
          <div className="pp-dash-card shadow-xl p-6 sm:p-10 mb-8">
            <div className="text-center mb-8">
              <h1 className="text-3xl sm:text-4xl font-bold text-primary-900 dark:text-primary-100 mb-2">
                Welcome to Smart Logistics
              </h1>
              <p className="text-gray-600 dark:text-gray-300 text-lg">Upload your delivery data to get started</p>
            </div>

            <FileUpload onSuccess={handleDataLoaded} />

            <div className="mt-10 pt-8 border-t border-gray-200 dark:border-gray-700">
              <p className="text-center text-sm text-gray-500 dark:text-gray-400 mb-4">
                Supported formats: Excel (.xlsx, .csv) with delivery data
              </p>
            </div>
          </div>
        ) : (
          <>
            {/* Hero — Deep Navy gradient with Warm Gold accent stripe */}
            <div
              className="relative overflow-hidden text-white rounded-2xl shadow-lg p-8 sm:p-12 mb-8"
              style={{
                background:
                  'linear-gradient(135deg, var(--primary) 0%, var(--primary-h) 55%, #0a4478 100%)',
                boxShadow: '0 10px 32px rgba(3,33,69,0.38)',
              }}
            >
              {/* Warm Gold corner accent — subtle brand signature */}
              <div
                aria-hidden
                className="pointer-events-none absolute -top-24 -right-24 w-64 h-64 rounded-full opacity-40"
                style={{
                  background:
                    'radial-gradient(circle, rgba(216,184,115,0.55) 0%, rgba(216,184,115,0) 70%)',
                }}
              />
              <h1 className="relative text-3xl sm:text-4xl lg:text-5xl font-bold mb-4">
                Smart Logistics Management System
              </h1>
              <p className="relative text-base sm:text-lg opacity-90 mb-6">
                Efficiently manage deliveries, optimize routes, and track orders in real-time
              </p>
              <div className="relative flex flex-col sm:flex-row gap-3">
                <button
                  onClick={() => setShowUpload(true)}
                  className="bg-white text-primary-900 px-6 py-3 rounded-xl font-semibold hover:bg-gold-50 hover:text-primary-900 transition-colors flex items-center justify-center gap-2 shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-400"
                >
                  <Upload className="w-5 h-5" />
                  Upload New File
                </button>
                <button
                  onClick={() => void navigate('/deliveries')}
                  className="pp-btn-gold flex items-center justify-center gap-2"
                >
                  <Database className="w-5 h-5" />
                  View Deliveries
                </button>
              </div>
            </div>

            {showUpload && (
              <div className="pp-dash-card shadow-lg p-6 sm:p-8 mb-8">
                <h2 className="text-2xl font-bold text-primary-900 dark:text-primary-100 mb-6">Upload New Delivery Data</h2>
                <FileUpload onSuccess={handleDataLoaded} />
              </div>
            )}
          </>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
          <div className="pp-dash-card p-6 transition">
            <div className="flex items-center mb-4">
              <div className="pp-icon-badge pp-icon-badge-blue w-12 h-12">
                <Upload className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-bold text-gray-800 dark:text-gray-100 ml-4">Easy Upload</h3>
            </div>
            <p className="text-gray-600 dark:text-gray-300 text-sm">
              Upload your Excel files with delivery data. Supports ERP, simplified, and generic
              formats.
            </p>
          </div>

          <div className="pp-dash-card p-6 transition">
            <div className="flex items-center mb-4">
              <div className="pp-icon-badge pp-icon-badge-gold w-12 h-12">
                <MapPin className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-bold text-gray-800 dark:text-gray-100 ml-4">Route Optimization</h3>
            </div>
            <p className="text-gray-600 dark:text-gray-300 text-sm">
              Automatically optimized delivery routes with visual mapping and turn-by-turn
              directions.
            </p>
          </div>

          <div className="pp-dash-card p-6 transition">
            <div className="flex items-center mb-4">
              <div className="pp-icon-badge pp-icon-badge-sage w-12 h-12">
                <Zap className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-bold text-gray-800 dark:text-gray-100 ml-4">Real-time Tracking</h3>
            </div>
            <p className="text-gray-600 dark:text-gray-300 text-sm">
              Track deliveries in real-time with status updates, signatures, and photo
              confirmation.
            </p>
          </div>
        </div>

        {deliveries.length > 0 && (
          <div className="pp-dash-soft-gradient p-6 sm:p-8">
            <h2 className="text-xl font-bold text-primary-900 dark:text-primary-100 mb-4">📦 Current Deliveries Loaded</h2>
            <div className="pp-kpi-grid mb-6">
              <div className="min-w-0 max-w-[280px]">
                <div className="text-3xl font-bold text-primary-700 dark:text-primary-300">{deliveries.length}</div>
                <div className="text-sm text-primary-800 dark:text-primary-200">Total Deliveries</div>
              </div>
              <div className="min-w-0 max-w-[280px]">
                <div className="text-3xl font-bold text-primary-700 dark:text-primary-300">
                  {Math.round(
                    deliveries.reduce((sum, d) => sum + (d.distanceFromWarehouse ?? 0), 0),
                  )}
                </div>
                <div className="text-sm text-primary-800 dark:text-primary-200">Total Distance (km)</div>
              </div>
              <div className="min-w-0 max-w-[280px]">
                <div className="text-3xl font-bold text-primary-700 dark:text-primary-300">
                  {deliveries.filter((d) => {
                    const meta = (d as unknown as { metadata?: { isPriority?: boolean } }).metadata;
                    return meta?.isPriority === true;
                  }).length}
                </div>
                <div className="text-sm text-primary-800 dark:text-primary-200">High Priority</div>
              </div>
            </div>
            <button
              onClick={() => void navigate('/deliveries')}
              className="pp-btn-primary"
            >
              View All Deliveries →
            </button>
          </div>
        )}

        {deliveries.length === 0 && (
          <div className="pp-dash-card p-6 sm:p-8 bg-gray-50/80 dark:bg-transparent">
            <h2 className="text-xl font-bold text-primary-900 dark:text-primary-100 mb-4">Getting Started</h2>
            <ol className="space-y-3 text-gray-700 dark:text-gray-200">
              {[
                { step: 1, label: 'Upload or Load Data', desc: 'Click "Upload File" or "Load Sample Data" above' },
                { step: 2, label: 'View Deliveries', desc: 'See all deliveries in the list sorted by distance' },
                { step: 3, label: 'Optimize Routes', desc: 'Check the map view for optimized delivery routes' },
                { step: 4, label: 'Manage Deliveries', desc: 'Edit details, upload photos, capture signatures' },
              ].map(({ step, label, desc }) => (
                <li key={step} className="flex gap-4">
                  <span
                    className="flex-shrink-0 w-8 h-8 text-white rounded-full flex items-center justify-center font-bold shadow-sm"
                    style={{ background: 'var(--primary)' }}
                  >
                    {step}
                  </span>
                  <span>
                    <strong className="text-primary-900 dark:text-primary-100">{label}:</strong> {desc}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </div>
  );
}
