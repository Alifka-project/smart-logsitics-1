import React, { useState, useEffect } from 'react';
import { Upload, Database, MapPin, Zap, List, LayoutDashboard, Download, RefreshCw } from 'lucide-react';
import FileUpload from '../components/Upload/FileUpload';
import SyntheticDataButton from '../components/Upload/SyntheticDataButton';
import DeliveryTable from '../components/DeliveryList/DeliveryTable';
import CustomerModal from '../components/CustomerDetails/CustomerModal';
import StatsCards from '../components/Analytics/StatsCards';
import DeliveryMap from '../components/MapView/DeliveryMap';
import { calculateRoute, generateFallbackRoute } from '../services/advancedRoutingService';
import useDeliveryStore from '../store/useDeliveryStore';
import { useToast } from '../hooks/useToast';
import { ToastContainer } from '../components/common/Toast';
import { AlertCircle, AlertTriangle } from 'lucide-react';
import { clearDeliveriesCache, showCacheWarning } from '../utils/clearCacheAndReload';
import api from '../frontend/apiClient';

export default function DeliveryManagementPage() {
  const deliveries = useDeliveryStore((state) => state.deliveries);
  const loadDeliveries = useDeliveryStore((state) => state.loadDeliveries);
  const [activeTab, setActiveTab] = useState('overview');
  const [showUpload, setShowUpload] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [route, setRoute] = useState(null);
  const [isLoadingRoute, setIsLoadingRoute] = useState(false);
  const [routeError, setRouteError] = useState(null);
  const [isFallback, setIsFallback] = useState(false);
  const [isOptimized, setIsOptimized] = useState(false);
  const [showCacheAlert, setShowCacheAlert] = useState(false);
  const [isReloading, setIsReloading] = useState(false);
  const [hoveredDeliveryIndex, setHoveredDeliveryIndex] = useState(null);
  const { toasts, removeToast, success, error, warning } = useToast();

  useEffect(() => {
    const hasFake = showCacheWarning();
    setShowCacheAlert(hasFake);
  }, []);

  // Recalculate route whenever deliveries change while on the deliveries tab
  useEffect(() => {
    if (activeTab === 'deliveries' && deliveries.length > 0) {
      loadRoute();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, deliveries]);

  const loadRoute = async () => {
    if (deliveries.length === 0) return;

    setIsLoadingRoute(true);
    setRouteError(null);
    setIsFallback(false);
    setIsOptimized(false);

    try {
      const locations = [
        { lat: 25.0053, lng: 55.0760 },
        ...deliveries.map(d => ({ lat: d.lat, lng: d.lng }))
      ];

      try {
        const routeData = await calculateRoute(locations, deliveries, true);
        setRoute(routeData);
        setIsOptimized(routeData.optimized === true);
      } catch (apiError) {
        console.warn('⚠️ Route calculation failed, using fallback:', apiError.message);
        setRouteError('Using simplified route (road routing unavailable)');
        setIsFallback(true);
        const fallbackRoute = generateFallbackRoute(locations);
        setRoute(fallbackRoute);
      }
    } catch (err) {
      console.error('❌ Fatal error loading route:', err);
      setRouteError('Failed to generate route. Showing delivery locations only.');
      const locations = [
        { lat: 25.0053, lng: 55.0760 },
        ...deliveries.map(d => ({ lat: d.lat, lng: d.lng }))
      ];
      setRoute(generateFallbackRoute(locations));
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
    setShowCacheAlert(false);
    if (deliveries.length === 0) {
      setTimeout(() => setActiveTab('deliveries'), 500);
    }
  };

  const handleReloadFromDatabase = async () => {
    try {
      setIsReloading(true);
      clearDeliveriesCache();
      const response = await api.get('/deliveries');
      if (response.data && response.data.deliveries) {
        loadDeliveries(response.data.deliveries);
        success(`✓ Reloaded ${response.data.deliveries.length} deliveries from database with real UUIDs!`);
        setShowCacheAlert(false);
      } else {
        error('No deliveries found in database. Please upload deliveries first.');
      }
    } catch (err) {
      error(`Failed to reload: ${err.response?.data?.message || err.message}`);
    } finally {
      setIsReloading(false);
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
    setTimeout(() => setActiveTab('deliveries'), 500);
  };

  const handleDataLoaded = () => {
    setShowUpload(false);
    setTimeout(() => setActiveTab('deliveries'), 500);
  };

  const handleExport = () => {
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
    { id: 'deliveries', label: 'Deliveries', icon: List },
  ];

  return (
    <div className="space-y-2">
      <ToastContainer toasts={toasts} onRemove={removeToast} />

      {/* Cache Alert - responsive and touch-friendly */}
      {showCacheAlert && (
        <div className="bg-red-50 dark:bg-red-900/20 border-l-4 border-red-500 p-3 sm:p-4 rounded">
          <div className="flex items-start gap-3 flex-wrap">
            <AlertTriangle className="w-5 h-5 sm:w-6 sm:h-6 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-semibold text-red-800 dark:text-red-200">Old Cached Data Detected!</h3>
              <p className="text-xs sm:text-sm text-red-700 dark:text-red-300 mt-1 break-words">
                Your browser has old deliveries with fake IDs. These don't exist in the database and will cause SMS to fail.
              </p>
              <button
                onClick={handleReloadFromDatabase}
                disabled={isReloading}
                className="mt-3 flex items-center justify-center gap-2 px-4 py-2.5 min-h-[44px] bg-red-600 hover:bg-red-700 disabled:bg-red-400 text-white rounded-lg transition-colors text-sm font-medium touch-manipulation w-full sm:w-auto"
              >
                <RefreshCw className={`w-4 h-4 flex-shrink-0 ${isReloading ? 'animate-spin' : ''}`} />
                {isReloading ? 'Reloading...' : 'Reload from Database (Fix SMS)'}
              </button>
            </div>
            <button onClick={() => setShowCacheAlert(false)} className="flex-shrink-0 p-2 min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 flex items-center justify-center text-red-600 hover:text-red-800 rounded-lg touch-manipulation" aria-label="Dismiss">✕</button>
          </div>
        </div>
      )}

      {/* Header - stacked on mobile, row on desktop; buttons wrap and are touch-friendly */}
      <div className="flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-3 mb-1">
        <div className="min-w-0">
          <h1 className="pp-page-title text-xl sm:text-3xl">Delivery Management</h1>
          <p className="pp-page-subtitle text-xs sm:text-sm">Manage deliveries, view routes, and track status</p>
        </div>
        <div className="flex flex-wrap gap-2 sm:flex-nowrap">
          <button
            onClick={handleReloadFromDatabase}
            disabled={isReloading}
            className="flex-1 sm:flex-none min-h-[44px] px-4 py-2.5 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-green-400 flex items-center justify-center gap-2 text-sm touch-manipulation"
            title="Reload deliveries from database with real UUIDs"
          >
            <RefreshCw className={`w-4 h-4 flex-shrink-0 ${isReloading ? 'animate-spin' : ''}`} />
            <span className="truncate">{isReloading ? 'Loading...' : 'Reload DB'}</span>
          </button>
          <button
            onClick={() => setShowUpload(true)}
            className="flex-1 sm:flex-none min-h-[44px] px-4 py-2.5 bg-primary-600 text-white rounded-lg hover:bg-primary-700 flex items-center justify-center gap-2 text-sm touch-manipulation"
          >
            <Upload className="w-4 h-4 flex-shrink-0" />
            Upload
          </button>
          {deliveries.length > 0 && (
            <button
              onClick={handleExport}
              className="flex-1 sm:flex-none min-h-[44px] px-4 py-2.5 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center justify-center gap-2 text-sm touch-manipulation"
            >
              <Download className="w-4 h-4 flex-shrink-0" />
              Export
            </button>
          )}
        </div>
      </div>

      {/* Tab Navigation - bigger gap above (from header) and below (to content) on desktop */}
      <div className="border-b border-gray-200 dark:border-gray-700 -mx-2 px-2 sm:mx-0 sm:px-0 overflow-x-auto mt-4 md:mt-6 mb-4 md:mb-6">
        <nav className="flex space-x-6 sm:space-x-8 min-w-max sm:min-w-0">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => {
                  setActiveTab(tab.id);
                  if (tab.id === 'deliveries' && deliveries.length > 0) {
                    loadRoute();
                  }
                }}
                className={`
                  flex items-center gap-2 py-3 sm:py-2.5 px-2 sm:px-1 border-b-2 font-medium text-sm whitespace-nowrap touch-manipulation min-h-[44px] sm:min-h-0
                  ${activeTab === tab.id
                    ? 'border-blue-500 dark:border-blue-400 text-blue-600 dark:text-blue-400'
                    : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600'
                  }
                `}
              >
                <Icon className="w-5 h-5" />
                {tab.label}
                {tab.id === 'deliveries' && deliveries.length > 0 && (
                  <span className="ml-1 bg-primary-100 dark:bg-primary-900/40 text-primary-700 dark:text-primary-300 text-xs font-semibold px-2 py-0.5 rounded-full">
                    {deliveries.length}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* ── OVERVIEW TAB ── */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          {(showUpload || deliveries.length === 0) && (
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-4 sm:p-6 lg:p-8 transition-colors">
              <div className="flex justify-between items-center gap-2 mb-4 sm:mb-6">
                <h2 className="text-lg sm:text-2xl font-bold text-gray-800 dark:text-gray-100 truncate min-w-0">
                  {deliveries.length === 0 ? 'Upload Delivery Data' : 'Upload New Data'}
                </h2>
                {deliveries.length > 0 && (
                  <button onClick={() => setShowUpload(false)} className="text-gray-500 hover:text-gray-700">✕</button>
                )}
              </div>
              <FileUpload onSuccess={handleFileSuccess} onError={handleFileError} onDataLoaded={handleDataLoaded} />
              <div className="mt-6 pt-6 border-t border-gray-200 dark:border-gray-700">
                <p className="text-gray-600 dark:text-gray-400 text-sm mb-4">Or load sample data:</p>
                <SyntheticDataButton onLoadSuccess={handleSyntheticSuccess} onDataLoaded={handleDataLoaded} className="w-full sm:w-auto" />
              </div>
            </div>
          )}

          {deliveries.length > 0 && (
            <>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-5 transition-colors">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm text-gray-600 dark:text-gray-400 mb-1">Total Deliveries</div>
                      <div className="text-3xl font-bold" style={{color:'var(--text)'}}>{deliveries.length}</div>
                    </div>
                    <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                      <Database className="w-6 h-6 text-blue-600 dark:text-blue-400" />
                    </div>
                  </div>
                </div>
                <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-5 transition-colors">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm text-gray-600 dark:text-gray-400 mb-1">Total Distance</div>
                      <div className="text-3xl font-bold" style={{color:'var(--text)'}}>
                        {Math.round(deliveries.reduce((sum, d) => sum + (d.distanceFromWarehouse || 0), 0))} km
                      </div>
                    </div>
                    <div className="p-3 bg-green-50 dark:bg-green-900/20 rounded-lg">
                      <MapPin className="w-6 h-6 text-green-600 dark:text-green-400" />
                    </div>
                  </div>
                </div>
                <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-5 transition-colors">
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
                <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-5 transition-colors">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm text-gray-600 dark:text-gray-400 mb-1">Quick Actions</div>
                      <div className="flex gap-2 mt-2">
                        <button
                          onClick={() => setActiveTab('deliveries')}
                          className="px-3 py-1 bg-primary-600 text-white text-xs rounded hover:bg-primary-700"
                        >
                          Manage
                        </button>
                      </div>
                    </div>
                    <div className="p-3 bg-purple-50 dark:bg-purple-900/20 rounded-lg">
                      <Zap className="w-6 h-6 text-purple-600 dark:text-purple-400" />
                    </div>
                  </div>
                </div>
              </div>

              <StatsCards />

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

          {deliveries.length === 0 && !showUpload && (
            <div className="bg-gray-100 dark:bg-gray-800 rounded-lg p-6 sm:p-8 transition-colors">
              <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100 mb-4">Getting Started</h2>
              <ol className="space-y-3 text-gray-700 dark:text-gray-300">
                <li className="flex gap-4">
                  <span className="flex-shrink-0 w-8 h-8 bg-primary-600 text-white rounded-full flex items-center justify-center font-bold">1</span>
                  <span><strong>Upload or Load Data:</strong> Click "Upload" button above or use the upload section</span>
                </li>
                <li className="flex gap-4">
                  <span className="flex-shrink-0 w-8 h-8 bg-primary-600 text-white rounded-full flex items-center justify-center font-bold">2</span>
                  <span><strong>View &amp; Manage:</strong> Switch to "Deliveries" tab — drag to reorder and see the route update live on the map</span>
                </li>
                <li className="flex gap-4">
                  <span className="flex-shrink-0 w-8 h-8 bg-primary-600 text-white rounded-full flex items-center justify-center font-bold">3</span>
                  <span><strong>Hover to Highlight:</strong> Hover any delivery card to highlight it on the map</span>
                </li>
                <li className="flex gap-4">
                  <span className="flex-shrink-0 w-8 h-8 bg-primary-600 text-white rounded-full flex items-center justify-center font-bold">4</span>
                  <span><strong>Manage Deliveries:</strong> Edit details, upload photos, capture signatures from the list</span>
                </li>
              </ol>
            </div>
          )}
        </div>
      )}

      {/* ── DELIVERIES TAB (combined split view) ── */}
      {activeTab === 'deliveries' && (
        <>
          {deliveries.length === 0 ? (
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-8 text-center transition-colors">
              <Database className="w-16 h-16 text-gray-400 dark:text-gray-500 mx-auto mb-4" />
              <p className="text-gray-600 dark:text-gray-400 text-lg mb-4">No deliveries loaded</p>
              <button
                onClick={() => { setShowUpload(true); setActiveTab('overview'); }}
                className="px-6 py-3 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
              >
                Upload Delivery Data
              </button>
            </div>
          ) : (
            <>
              {/* Container: mobile = auto height (page can scroll), desktop = fixed viewport height (no page scroll) */}
              <div
                className="flex flex-col md:flex-row gap-3 sm:gap-4 items-stretch md:items-start flex-1 min-h-0 min-h-[320px] sm:min-h-[400px] md:min-h-[380px] md:h-[calc(100vh-260px)] md:max-h-[calc(100vh-260px)]"
              >
                {/* ── Map: top on mobile (fixed height), left on desktop ── */}
                <div
                  className="relative rounded-xl overflow-hidden shadow-lg border border-gray-200 dark:border-gray-700 w-full md:w-[58%] flex-shrink-0 md:flex-shrink h-[34vh] md:h-full min-h-[220px] md:min-h-0"
                >
                {isLoadingRoute && !route ? (
                  <div className="h-full flex items-center justify-center bg-white dark:bg-gray-800">
                    <div className="text-center">
                      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto mb-4" />
                      <p className="text-gray-600 dark:text-gray-400 text-sm">
                        Calculating route for {deliveries.length} stops…
                      </p>
                    </div>
                  </div>
                ) : (
                  <DeliveryMap
                    deliveries={deliveries}
                    route={route}
                    highlightedIndex={hoveredDeliveryIndex}
                    mapClassName="h-full"
                  />
                )}

                {/* Updating route overlay (while map is already visible) */}
                {isLoadingRoute && route && (
                  <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-white dark:bg-gray-800 rounded-full px-4 py-2 shadow-lg flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 z-[1000] border border-gray-200 dark:border-gray-600">
                    <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-primary-600" />
                    Updating route…
                  </div>
                )}

                {/* Fallback route warning overlay */}
                {routeError && isFallback && (
                  <div className="absolute bottom-3 left-3 right-3 bg-yellow-50 dark:bg-yellow-900/40 border border-yellow-200 dark:border-yellow-700 rounded-lg p-2 text-xs text-yellow-700 dark:text-yellow-300 flex items-center gap-2 z-[1000]">
                    <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                    {routeError}
                  </div>
                )}

                {/* Map legend */}
                <div className="absolute top-3 right-3 bg-white/90 dark:bg-gray-800/90 backdrop-blur-sm rounded-lg px-3 py-2 shadow text-xs text-gray-700 dark:text-gray-300 z-[1000] space-y-1">
                  <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-green-500 inline-block" /> Warehouse</div>
                  <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-red-500 inline-block" /> High priority</div>
                  <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-orange-400 inline-block" /> Medium</div>
                  <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-blue-500 inline-block" /> Low</div>
                </div>
                </div>

              {/* ── List: bottom on mobile (scrollable), right on desktop ── */}
              <div
                className="w-full md:w-[42%] flex-1 min-h-0 md:h-full flex flex-col gap-3 min-w-0 overflow-hidden"
              >

                {/* Compact Route Stats Card */}
                {isLoadingRoute && !route ? (
                  <div className="flex-shrink-0 bg-blue-50 dark:bg-blue-900/20 rounded-xl p-3 flex items-center gap-3 border border-blue-200 dark:border-blue-800">
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600 flex-shrink-0" />
                    <span className="text-sm text-blue-700 dark:text-blue-300">Calculating optimized route…</span>
                  </div>
                ) : route ? (
                  <div className="flex-shrink-0 bg-gradient-to-r from-primary-600 to-primary-700 text-white rounded-xl p-3 shadow-sm">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <MapPin className="w-3.5 h-3.5" />
                        <span className="font-semibold text-xs">Optimized Route</span>
                        {isOptimized && (
                          <span className="flex items-center gap-1 bg-green-500 px-1.5 py-0.5 rounded-full text-[10px] font-semibold">
                            <Zap className="w-2.5 h-2.5" /> AI
                          </span>
                        )}
                      </div>
                      <button
                        onClick={loadRoute}
                        disabled={isLoadingRoute}
                        className="p-1 bg-white/20 hover:bg-white/30 rounded transition-colors disabled:opacity-50"
                        title="Recalculate route"
                      >
                        <RefreshCw className={`w-3 h-3 ${isLoadingRoute ? 'animate-spin' : ''}`} />
                      </button>
                    </div>
                    <div className="grid grid-cols-3 gap-1.5 text-center">
                      <div>
                        <div className="text-lg font-bold">{deliveries.length}</div>
                        <div className="text-[10px] opacity-80">Stops</div>
                      </div>
                      <div>
                        <div className="text-lg font-bold">{route.distanceKm.toFixed(1)}</div>
                        <div className="text-[10px] opacity-80">km total</div>
                      </div>
                      <div>
                        <div className="text-lg font-bold">{(route.timeHours + deliveries.length).toFixed(1)}</div>
                        <div className="text-[10px] opacity-80">hrs est.</div>
                      </div>
                    </div>
                    {isFallback && (
                      <p className="text-[10px] opacity-75 mt-1.5 flex items-center gap-1">
                        <AlertTriangle className="w-2.5 h-2.5" />
                        Simplified route — road routing unavailable
                      </p>
                    )}
                  </div>
                ) : null}

                {/* Route error (non-fallback) */}
                {routeError && !isFallback && (
                  <div className="flex-shrink-0 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-lg p-3 flex items-center gap-2 text-sm text-red-700 dark:text-red-300">
                    <AlertCircle className="w-4 h-4 flex-shrink-0" />
                    {routeError}
                  </div>
                )}

                {/* Hint text - compact so list gets more space */}
                <p className="flex-shrink-0 text-[11px] text-gray-500 dark:text-gray-400 px-0">
                  ↕ Drag to reorder — route updates automatically.
                  <span className="hidden md:inline"> Hover a card to highlight on the map.</span>
                  <span className="md:hidden"> Map on top, list below. Tap a card to view details.</span>
                </p>

                {/* Scrollable delivery list */}
                <div className="flex-1 overflow-y-auto min-h-0">
                  <DeliveryTable
                    onSelectDelivery={() => setShowModal(true)}
                    onCloseDetailModal={() => setShowModal(false)}
                    onHoverDelivery={setHoveredDeliveryIndex}
                  />
                </div>
              </div>
            </div>
            </>
          )}
        </>
      )}

      {/* Customer Details Modal */}
      <CustomerModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        onSaveContactSuccess={(msg) => success(msg)}
        onSaveContactError={(msg) => error(msg)}
      />
    </div>
  );
}
