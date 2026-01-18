import React, { useState, useEffect } from 'react';
import { Upload, Database, MapPin, Zap, List, LayoutDashboard, Download } from 'lucide-react';
import FileUpload from '../components/Upload/FileUpload';
import SyntheticDataButton from '../components/Upload/SyntheticDataButton';
import DeliveryTable from '../components/DeliveryList/DeliveryTable';
import CustomerModal from '../components/CustomerDetails/CustomerModal';
import StatsCards from '../components/Analytics/StatsCards';
import DeliveryMap from '../components/MapView/DeliveryMap';
import DirectionsPanel from '../components/MapView/DirectionsPanel';
import { calculateRoute, generateFallbackRoute } from '../services/advancedRoutingService';
import { calculateRouteWithOSRM } from '../services/osrmRoutingService';
import useDeliveryStore from '../store/useDeliveryStore';
import { useToast } from '../hooks/useToast';
import { ToastContainer } from '../components/common/Toast';
import { AlertCircle, AlertTriangle } from 'lucide-react';

export default function DeliveryManagementPage() {
  const deliveries = useDeliveryStore((state) => state.deliveries);
  const [activeTab, setActiveTab] = useState('overview');
  const [showUpload, setShowUpload] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [route, setRoute] = useState(null);
  const [isLoadingRoute, setIsLoadingRoute] = useState(false);
  const [routeError, setRouteError] = useState(null);
  const [isFallback, setIsFallback] = useState(false);
  const [isOptimized, setIsOptimized] = useState(false);
  const { toasts, removeToast, success, error, warning } = useToast();

  // Load route when deliveries change and Map tab is active
  useEffect(() => {
    if (activeTab === 'map' && deliveries.length > 0 && !route) {
      loadRoute();
    }
  }, [activeTab, deliveries.length]);

  const loadRoute = async () => {
    if (deliveries.length === 0) return;
    
    setIsLoadingRoute(true);
    setRouteError(null);
    setIsFallback(false);
    setIsOptimized(false);
    
    try {
      const locations = [
        { lat: 25.0053, lng: 55.0760 }, // Warehouse
        ...deliveries.map(d => ({ lat: d.lat, lng: d.lng }))
      ];
      
      try {
        const routeData = await calculateRoute(locations, deliveries, true);
        setRoute(routeData);
        setIsOptimized(routeData.optimized === true);
      } catch (apiError) {
        console.warn('Advanced route calculation failed, trying OSRM routing:', apiError.message);
        
        // Try OSRM as backup (road-following)
        try {
          const osrmRoute = await calculateRouteWithOSRM(locations);
          setRoute(osrmRoute);
          setRouteError('Using OSRM routing (Valhalla unavailable)');
          setIsFallback(false); // OSRM is still road-following, not a straight-line fallback
          console.log('OSRM routing successful:', { distance: osrmRoute.distanceKm.toFixed(2) });
        } catch (osrmError) {
          console.error('OSRM routing also failed, using fallback:', osrmError.message);
          setRouteError('Using simplified route (road routing unavailable)');
          setIsFallback(true);
          const fallbackRoute = generateFallbackRoute(locations);
          setRoute(fallbackRoute);
        }
      }
    } catch (err) {
      console.error('Fatal error loading route:', err);
      setRouteError('Failed to generate route. Please try again.');
    } finally {
      setIsLoadingRoute(false);
    }
  };

  const handleFileSuccess = (result) => {
    success(`✓ Successfully loaded ${result.count} deliveries`);
    if (result.warnings && result.warnings.length > 0) {
      warning(`⚠ ${result.warnings.length} warning(s) found during validation`);
    }
    setShowUpload(false);
    // Switch to list view after loading
    if (deliveries.length === 0) {
      setTimeout(() => setActiveTab('list'), 500);
    }
  };

  const handleFileError = (result) => {
    if (result.errors && result.errors.length > 0) {
      error(`Validation failed:\n${result.errors.join('\n')}`);
    } else {
      error('Failed to process file');
    }
  };

  const handleSyntheticSuccess = (result) => {
    success(`✓ Successfully loaded ${result.count} test deliveries`);
    setShowUpload(false);
    setTimeout(() => setActiveTab('list'), 500);
  };

  const handleDataLoaded = () => {
    setShowUpload(false);
    setTimeout(() => setActiveTab('list'), 500);
  };

  const handleExport = () => {
    // Export functionality - can be enhanced later
    const dataStr = JSON.stringify(deliveries, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `deliveries-${new Date().toISOString()}.json`;
    link.click();
    success('Deliveries exported successfully');
  };

  const tabs = [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard },
    { id: 'list', label: 'List View', icon: List },
    { id: 'map', label: 'Map View', icon: MapPin },
  ];

  return (
    <div className="space-y-6">
      <ToastContainer toasts={toasts} onRemove={removeToast} />

      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-800 dark:text-gray-100">Delivery Management</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Manage deliveries, view routes, and track status
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowUpload(true)}
            className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 flex items-center gap-2 text-sm"
          >
            <Upload className="w-4 h-4" />
            Upload
          </button>
          {deliveries.length > 0 && (
            <button
              onClick={handleExport}
              className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 flex items-center gap-2 text-sm"
            >
              <Download className="w-4 h-4" />
              Export
            </button>
          )}
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="border-b border-gray-200 dark:border-gray-700">
        <nav className="flex space-x-8">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => {
                  setActiveTab(tab.id);
                  if (tab.id === 'map' && deliveries.length > 0 && !route) {
                    loadRoute();
                  }
                }}
                className={`
                  flex items-center gap-2 py-4 px-1 border-b-2 font-medium text-sm
                  ${activeTab === tab.id
                    ? 'border-primary-600 dark:border-primary-400 text-primary-600 dark:text-primary-400'
                    : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600'
                  }
                `}
              >
                <Icon className="w-5 h-5" />
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Tab Content */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          {/* Upload Section - Show if no deliveries or if explicitly opened */}
          {(showUpload || deliveries.length === 0) && (
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6 sm:p-8 transition-colors">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-100">
                  {deliveries.length === 0 ? 'Upload Delivery Data' : 'Upload New Data'}
                </h2>
                {deliveries.length > 0 && (
                  <button
                    onClick={() => setShowUpload(false)}
                    className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
                  >
                    ✕
                  </button>
                )}
              </div>
              <FileUpload 
                onSuccess={handleFileSuccess} 
                onError={handleFileError}
                onDataLoaded={handleDataLoaded}
              />
              <div className="mt-6 pt-6 border-t border-gray-200 dark:border-gray-700">
                <p className="text-gray-600 dark:text-gray-400 text-sm mb-4">Or load sample data:</p>
                <SyntheticDataButton 
                  onLoadSuccess={handleSyntheticSuccess}
                  onDataLoaded={handleDataLoaded}
                  className="w-full sm:w-auto"
                />
              </div>
            </div>
          )}

          {/* Quick Stats */}
          {deliveries.length > 0 && (
            <>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 transition-colors">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm text-gray-600 dark:text-gray-400 mb-1">Total Deliveries</div>
                      <div className="text-3xl font-bold text-gray-800 dark:text-gray-100">{deliveries.length}</div>
                    </div>
                    <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                      <Database className="w-6 h-6 text-blue-600 dark:text-blue-400" />
                    </div>
                  </div>
                </div>
                <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 transition-colors">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm text-gray-600 dark:text-gray-400 mb-1">Total Distance</div>
                      <div className="text-3xl font-bold text-gray-800 dark:text-gray-100">
                        {Math.round(deliveries.reduce((sum, d) => sum + (d.distanceFromWarehouse || 0), 0))} km
                      </div>
                    </div>
                    <div className="p-3 bg-green-50 dark:bg-green-900/20 rounded-lg">
                      <MapPin className="w-6 h-6 text-green-600 dark:text-green-400" />
                    </div>
                  </div>
                </div>
                <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 transition-colors">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm text-gray-600 dark:text-gray-400 mb-1">High Priority</div>
                      <div className="text-3xl font-bold text-red-600 dark:text-red-400">
                        {deliveries.filter(d => d.priority === 1).length}
                      </div>
                    </div>
                    <div className="p-3 bg-red-50 dark:bg-red-900/20 rounded-lg">
                      <AlertCircle className="w-6 h-6 text-red-600 dark:text-red-400" />
                    </div>
                  </div>
                </div>
                <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 transition-colors">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm text-gray-600 dark:text-gray-400 mb-1">Quick Actions</div>
                      <div className="flex gap-2 mt-2">
                        <button
                          onClick={() => setActiveTab('list')}
                          className="px-3 py-1 bg-primary-600 text-white text-xs rounded hover:bg-primary-700"
                        >
                          View List
                        </button>
                        <button
                          onClick={() => setActiveTab('map')}
                          className="px-3 py-1 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 text-xs rounded hover:bg-gray-300 dark:hover:bg-gray-600"
                        >
                          View Map
                        </button>
                      </div>
                    </div>
                    <div className="p-3 bg-purple-50 dark:bg-purple-900/20 rounded-lg">
                      <Zap className="w-6 h-6 text-purple-600 dark:text-purple-400" />
                    </div>
                  </div>
                </div>
              </div>

              {/* Analytics Cards */}
              <StatsCards />

              {/* Features Section */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 hover:shadow-lg transition">
                  <div className="flex items-center mb-4">
                    <div className="w-12 h-12 bg-primary-100 dark:bg-primary-900/30 rounded-lg flex items-center justify-center">
                      <Upload className="w-6 h-6 text-primary-600 dark:text-primary-400" />
                    </div>
                    <h3 className="text-lg font-bold text-gray-800 dark:text-gray-100 ml-4">Easy Upload</h3>
                  </div>
                  <p className="text-gray-600 dark:text-gray-400 text-sm">
                    Upload your Excel files with delivery data. Supports ERP, simplified, and generic formats.
                  </p>
                </div>

                <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 hover:shadow-lg transition">
                  <div className="flex items-center mb-4">
                    <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900/30 rounded-lg flex items-center justify-center">
                      <MapPin className="w-6 h-6 text-blue-600 dark:text-blue-400" />
                    </div>
                    <h3 className="text-lg font-bold text-gray-800 dark:text-gray-100 ml-4">Route Optimization</h3>
                  </div>
                  <p className="text-gray-600 dark:text-gray-400 text-sm">
                    Automatically optimized delivery routes with visual mapping and turn-by-turn directions.
                  </p>
                </div>

                <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 hover:shadow-lg transition">
                  <div className="flex items-center mb-4">
                    <div className="w-12 h-12 bg-green-100 dark:bg-green-900/30 rounded-lg flex items-center justify-center">
                      <Zap className="w-6 h-6 text-green-600 dark:text-green-400" />
                    </div>
                    <h3 className="text-lg font-bold text-gray-800 dark:text-gray-100 ml-4">Real-time Tracking</h3>
                  </div>
                  <p className="text-gray-600 dark:text-gray-400 text-sm">
                    Track deliveries in real-time with status updates, signatures, and photo confirmation.
                  </p>
                </div>
              </div>
            </>
          )}

          {/* Getting Started (when no deliveries) */}
          {deliveries.length === 0 && !showUpload && (
            <div className="bg-gray-100 dark:bg-gray-800 rounded-lg p-6 sm:p-8 transition-colors">
              <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100 mb-4">Getting Started</h2>
              <ol className="space-y-3 text-gray-700 dark:text-gray-300">
                <li className="flex gap-4">
                  <span className="flex-shrink-0 w-8 h-8 bg-primary-600 text-white rounded-full flex items-center justify-center font-bold">
                    1
                  </span>
                  <span>
                    <strong>Upload or Load Data:</strong> Click "Upload" button above or use the upload section
                  </span>
                </li>
                <li className="flex gap-4">
                  <span className="flex-shrink-0 w-8 h-8 bg-primary-600 text-white rounded-full flex items-center justify-center font-bold">
                    2
                  </span>
                  <span>
                    <strong>View Deliveries:</strong> Switch to "List View" tab to see all deliveries
                  </span>
                </li>
                <li className="flex gap-4">
                  <span className="flex-shrink-0 w-8 h-8 bg-primary-600 text-white rounded-full flex items-center justify-center font-bold">
                    3
                  </span>
                  <span>
                    <strong>Optimize Routes:</strong> Switch to "Map View" tab for optimized delivery routes
                  </span>
                </li>
                <li className="flex gap-4">
                  <span className="flex-shrink-0 w-8 h-8 bg-primary-600 text-white rounded-full flex items-center justify-center font-bold">
                    4
                  </span>
                  <span>
                    <strong>Manage Deliveries:</strong> Edit details, upload photos, capture signatures from the list view
                  </span>
                </li>
              </ol>
            </div>
          )}
        </div>
      )}

      {activeTab === 'list' && (
        <div className="space-y-4 sm:space-y-6">
          {/* Analytics */}
          {deliveries.length > 0 && <StatsCards />}

          {/* Delivery List */}
          {deliveries.length > 0 ? (
            <DeliveryTable onSelectDelivery={() => setShowModal(true)} />
          ) : (
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-8 text-center transition-colors">
              <Database className="w-16 h-16 text-gray-400 dark:text-gray-500 mx-auto mb-4" />
              <p className="text-gray-600 dark:text-gray-400 text-lg mb-4">No deliveries loaded</p>
              <button
                onClick={() => setShowUpload(true)}
                className="px-6 py-3 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
              >
                Upload Delivery Data
              </button>
            </div>
          )}
        </div>
      )}

      {activeTab === 'map' && (
        <div className="space-y-4 sm:space-y-6">
          {deliveries.length === 0 ? (
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-8 text-center transition-colors">
              <MapPin className="w-16 h-16 text-gray-400 dark:text-gray-500 mx-auto mb-4" />
              <p className="text-gray-600 dark:text-gray-400 text-lg mb-4">No deliveries loaded</p>
              <p className="text-gray-500 dark:text-gray-500 text-sm mb-6">
                Upload delivery data to view routes on the map
              </p>
              <button
                onClick={() => {
                  setShowUpload(true);
                  setActiveTab('overview');
                }}
                className="px-6 py-3 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
              >
                Upload Delivery Data
              </button>
            </div>
          ) : (
            <>
              {/* Route Info */}
              <div className="bg-gradient-to-r from-primary-600 to-primary-700 text-white rounded-lg shadow-lg p-4 sm:p-6">
                <div className="flex items-center justify-between mb-3 sm:mb-4">
                  <h2 className="text-xl sm:text-2xl font-bold">📍 Optimized Delivery Route</h2>
                  {isOptimized && (
                    <div className="flex items-center gap-1 bg-green-500 px-3 py-1 rounded-full text-xs sm:text-sm font-semibold">
                      <Zap className="w-4 h-4" /> AI Optimized
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 text-center">
                  <div>
                    <div className="text-2xl sm:text-3xl font-bold">{deliveries.length}</div>
                    <div className="text-xs sm:text-sm opacity-90">Total Stops</div>
                  </div>
                  <div>
                    <div className="text-2xl sm:text-3xl font-bold">
                      {route ? route.distanceKm.toFixed(1) : '...'} km
                    </div>
                    <div className="text-xs sm:text-sm opacity-90">Total Distance</div>
                  </div>
                  <div>
                    <div className="text-2xl sm:text-3xl font-bold">
                      {route ? (route.timeHours + deliveries.length * 1).toFixed(1) : '...'} hrs
                    </div>
                    <div className="text-xs sm:text-sm opacity-90">Est. Time (with installation)</div>
                  </div>
                </div>
                <div className="mt-3 sm:mt-4 space-y-1">
                  <p className="text-xs sm:text-sm opacity-90">
                    ✓ Starting Point: Jebel Ali Free Zone, Dubai
                  </p>
                  <p className="text-xs sm:text-sm opacity-90">
                    ✓ Route {isOptimized ? 'optimized by AI' : 'calculated by distance'}
                  </p>
                  <p className="text-xs sm:text-sm opacity-90">
                    ✓ Includes 1 hour installation time per stop
                  </p>
                  {route?.isMultiLeg && (
                    <p className="text-xs sm:text-sm opacity-90">
                      ℹ Multi-leg route: {route.chunkCount} segments (large dataset optimization)
                    </p>
                  )}
                  {route?.optimization && (
                    <p className="text-xs sm:text-sm opacity-90 italic">
                      💡 {route.optimization.explanation}
                    </p>
                  )}
                </div>
              </div>

              {/* Error Message */}
              {routeError && (
                <div className={`border-l-4 rounded-lg p-4 flex items-start gap-3 ${
                  isFallback 
                    ? 'bg-yellow-50 border-yellow-500' 
                    : 'bg-red-50 border-red-500'
                }`}>
                  {isFallback ? (
                    <AlertTriangle className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
                  ) : (
                    <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                  )}
                  <div className={`text-sm ${isFallback ? 'text-yellow-700' : 'text-red-700'}`}>
                    <p className="font-semibold mb-1">
                      {isFallback ? 'Using Simplified Route' : 'Route Calculation Error'}
                    </p>
                    <p>{routeError}</p>
                  </div>
                </div>
              )}

              {/* Map */}
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg overflow-hidden transition-colors">
                {isLoadingRoute ? (
                  <div className="h-[400px] sm:h-[500px] lg:h-[600px] flex items-center justify-center">
                    <div className="text-center">
                      <div className="animate-spin rounded-full h-12 w-12 sm:h-16 sm:w-16 border-b-2 border-primary-600 mx-auto mb-4"></div>
                      <p className="text-gray-600 dark:text-gray-400 text-sm sm:text-base">Calculating route for {deliveries.length} deliveries...</p>
                      {deliveries.length > 50 && (
                        <p className="text-gray-500 dark:text-gray-500 text-xs mt-2">Large dataset - may take a minute</p>
                      )}
                    </div>
                  </div>
                ) : (
                  <DeliveryMap deliveries={deliveries} route={route} />
                )}
              </div>

              {/* Turn-by-turn Directions */}
              {route && <DirectionsPanel route={route} />}
            </>
          )}
        </div>
      )}

      {/* Customer Details Modal */}
      <CustomerModal 
        isOpen={showModal} 
        onClose={() => setShowModal(false)} 
      />
    </div>
  );
}

