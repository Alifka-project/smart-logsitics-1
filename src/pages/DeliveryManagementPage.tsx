import React, { useState, useEffect, useMemo } from 'react';
import { Database, MapPin, Zap, List, ClipboardList, Download, RefreshCw } from 'lucide-react';
import DeliveryTable from '../components/DeliveryList/DeliveryTable';
import CustomerModal from '../components/CustomerDetails/CustomerModal';
import ManageTab from '../components/deliveries/ManageTab';
import DeliveryMap from '../components/MapView/DeliveryMap';
import { calculateRoute, generateFallbackRoute } from '../services/advancedRoutingService';
import useDeliveryStore from '../store/useDeliveryStore';
import { applyDeliveryListFilter } from '../utils/deliveryListFilter';
import { useToast } from '../hooks/useToast';
import { ToastContainer } from '../components/common/Toast';
import { AlertCircle, AlertTriangle } from 'lucide-react';
import { clearDeliveriesCache, showCacheWarning } from '../utils/clearCacheAndReload';
import api from '../frontend/apiClient';
import type { Delivery } from '../types';
import { exportAsXlsx, exportAsCsv } from '../utils/exportDeliveries';
import type { LucideIcon } from 'lucide-react';

// Route result shape returned by advancedRoutingService
interface AdvancedRouteResult {
  distanceKm: number;
  timeHours: number;
  optimized?: boolean;
  coordinates?: [number, number][];
  [key: string]: unknown;
}

interface FileUploadResult {
  count: number;
  warnings?: string[];
}

interface FileErrorResult {
  errors?: string[];
}

interface Tab {
  id: string;
  label: string;
  icon: LucideIcon;
}

export default function DeliveryManagementPage() {
  const deliveries = useDeliveryStore((state) => state.deliveries ?? []);
  const deliveryListFilter = useDeliveryStore((state) => state.deliveryListFilter ?? 'all');
  const loadDeliveries = useDeliveryStore((state) => state.loadDeliveries);
  const addCompletedUpload = useDeliveryStore((state) => state.addCompletedUpload);
  const [activeTab, setActiveTab] = useState<string>('manage');

  const displayDeliveries = useMemo(
    () => applyDeliveryListFilter(deliveries, deliveryListFilter),
    [deliveries, deliveryListFilter],
  );
  const [showModal, setShowModal] = useState<boolean>(false);
  const [route, setRoute] = useState<AdvancedRouteResult | null>(null);
  const [isLoadingRoute, setIsLoadingRoute] = useState<boolean>(false);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [isFallback, setIsFallback] = useState<boolean>(false);
  const [isOptimized, setIsOptimized] = useState<boolean>(false);
  const [showCacheAlert, setShowCacheAlert] = useState<boolean>(false);
  const [isReloading, setIsReloading] = useState<boolean>(false);
  const [hoveredDeliveryIndex, setHoveredDeliveryIndex] = useState<number | null>(null);
  const { toasts, removeToast, success, error, warning } = useToast();

  useEffect(() => {
    const hasFake = showCacheWarning();
    setShowCacheAlert(hasFake);
  }, []);

  // Recalculate route when the visible delivery list changes while on the deliveries tab
  useEffect(() => {
    if (activeTab === 'deliveries' && displayDeliveries.length > 0) {
      void loadRoute();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, displayDeliveries, deliveryListFilter]);

  const loadRoute = async (): Promise<void> => {
    if (displayDeliveries.length === 0) return;

    setIsLoadingRoute(true);
    setRouteError(null);
    setIsFallback(false);
    setIsOptimized(false);

    try {
      const locations = [
        { lat: 25.0053, lng: 55.0760 },
        ...displayDeliveries.map((d: Delivery) => ({ lat: d.lat, lng: d.lng }))
      ];

      try {
        const routeData = (await calculateRoute(locations, displayDeliveries, true)) as unknown as AdvancedRouteResult;
        setRoute(routeData);
        setIsOptimized(routeData.optimized === true);
      } catch (apiError: unknown) {
        const e = apiError as { message?: string };
        console.warn('⚠️ Route calculation failed, using fallback:', e.message);
        setRouteError('Using simplified route (road routing unavailable)');
        setIsFallback(true);
        const fallbackRoute = generateFallbackRoute(locations) as unknown as AdvancedRouteResult;
        setRoute(fallbackRoute);
      }
    } catch (err: unknown) {
      const e = err as { message?: string };
      console.error('❌ Fatal error loading route:', e);
      setRouteError('Failed to generate route. Showing delivery locations only.');
      const locations = [
        { lat: 25.0053, lng: 55.0760 },
        ...displayDeliveries.map((d: Delivery) => ({ lat: d.lat, lng: d.lng }))
      ];
      setRoute(generateFallbackRoute(locations) as unknown as AdvancedRouteResult);
    } finally {
      setIsLoadingRoute(false);
    }
  };

  const handleFileSuccess = (result: FileUploadResult): void => {
    success(`✓ Successfully loaded ${result.count} deliveries`);
    if (result.warnings && result.warnings.length > 0) {
      warning(`⚠ ${result.warnings.length} warning(s) found during validation`);
    }
    setShowCacheAlert(false);
  };

  const handleReloadFromDatabase = async (): Promise<void> => {
    try {
      setIsReloading(true);
      clearDeliveriesCache();
      // Only load "active" deliveries (exclude delivered/cancelled/rescheduled history)
      const response = await api.get('/deliveries?includeFinished=false');
      if (response.data && response.data.deliveries) {
        const freshDeliveries = response.data.deliveries as Delivery[];
        loadDeliveries(freshDeliveries);
        addCompletedUpload('Database reload', freshDeliveries.length);

        // Trigger backend bulk auto-assignment so Operations Control reflects assignments
        try {
          const ids = freshDeliveries.map((d) => d.id).filter(Boolean);
          if (ids.length > 0) {
            await api.post('/deliveries/bulk-assign', { deliveryIds: ids });
          }
        } catch (assignErr: unknown) {
          const e = assignErr as { message?: string };
          console.warn('Bulk auto-assign after DB reload failed:', e.message || assignErr);
        }

        success(`✓ Reloaded ${freshDeliveries.length} deliveries from database with real UUIDs!`);
        setShowCacheAlert(false);
      } else {
        error('No deliveries found in database. Please upload deliveries first.');
      }
    } catch (err: unknown) {
      const e = err as { message?: string; response?: { data?: { message?: string } } };
      error(`Failed to reload: ${e.response?.data?.message || e.message}`);
    } finally {
      setIsReloading(false);
    }
  };

  const handleFileError = (result: FileErrorResult): void => {
    if (result.errors && result.errors.length > 0) {
      error(`Validation failed:\n${result.errors.join('\n')}`);
    } else {
      error('Failed to process file');
    }
  };

  const handleExport = (format: 'xlsx' | 'csv' = 'xlsx'): void => {
    if (deliveries.length === 0) {
      error('No deliveries to export');
      return;
    }
    if (format === 'csv') {
      exportAsCsv(deliveries);
      success(`Exported ${deliveries.length} deliveries as CSV`);
    } else {
      exportAsXlsx(deliveries);
      success(`Exported ${deliveries.length} deliveries as Excel`);
    }
  };

  const tabs: Tab[] = [
    { id: 'manage', label: 'Manage Delivery Order', icon: ClipboardList },
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
                onClick={() => void handleReloadFromDatabase()}
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
            onClick={() => void handleReloadFromDatabase()}
            disabled={isReloading}
            className="flex-1 sm:flex-none min-h-[44px] px-4 py-2.5 bg-[#002D5B] text-white rounded-lg hover:bg-[#001f3f] disabled:opacity-50 flex items-center justify-center gap-2 text-sm touch-manipulation"
            title="Reload deliveries from database with real UUIDs"
          >
            <RefreshCw className={`w-4 h-4 flex-shrink-0 ${isReloading ? 'animate-spin' : ''}`} />
            <span className="truncate">{isReloading ? 'Loading...' : 'Reload DB'}</span>
          </button>
          {deliveries.length > 0 && (
            <button
              onClick={() => handleExport('xlsx')}
              className="flex-1 sm:flex-none min-h-[44px] px-4 py-2.5 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center justify-center gap-2 text-sm touch-manipulation"
            >
              <Download className="w-4 h-4 flex-shrink-0" />
              Export Excel
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
                    void loadRoute();
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
                  <span className="ml-1 bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 text-xs font-semibold px-2 py-0.5 rounded-full">
                    {deliveries.length}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* ── MANAGE DELIVERY ORDER TAB ── */}
      {activeTab === 'manage' && (
        <ManageTab
          onSwitchToDeliveriesTab={() => setActiveTab('deliveries')}
          onUploadSuccess={handleFileSuccess}
          onUploadError={handleFileError}
          onDuplicateFile={() =>
            error('Already uploaded', 'This file was already uploaded. Duplicates are skipped.')
          }
          onToastError={(msg) => error(msg)}
          onNotifySuccess={(title, message) => success(title, message ?? '')}
          onReloadFromDatabase={() => void handleReloadFromDatabase()}
          onExportDeliveries={handleExport}
          isReloadingDatabase={isReloading}
        />
      )}

      {/* ── DELIVERIES TAB (combined split view) ── */}
      {activeTab === 'deliveries' && (
        <>
          {deliveries.length === 0 ? (
            <div className="pp-dash-card p-8 text-center transition-colors">
              <Database className="w-16 h-16 text-gray-400 dark:text-gray-500 mx-auto mb-4" />
              <p className="text-gray-600 dark:text-gray-400 text-lg mb-4">No deliveries loaded</p>
              <button
                onClick={() => setActiveTab('manage')}
                className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
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
                      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4" />
                      <p className="text-gray-600 dark:text-gray-400 text-sm">
                        Calculating route for {displayDeliveries.length} stops…
                      </p>
                    </div>
                  </div>
                ) : (
                  <DeliveryMap
                    deliveries={displayDeliveries}
                    route={route as unknown as import('../types').RouteResult}
                    highlightedIndex={hoveredDeliveryIndex}
                    mapClassName="h-full"
                  />
                )}

                {/* Updating route overlay (while map is already visible) */}
                {isLoadingRoute && route && (
                  <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-white dark:bg-gray-800 rounded-full px-4 py-2 shadow-lg flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 z-[1000] border border-gray-200 dark:border-gray-600">
                    <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-blue-600" />
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
                  <div className="flex-shrink-0 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-xl p-3 shadow-sm">
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
                        onClick={() => void loadRoute()}
                        disabled={isLoadingRoute}
                        className="p-1 bg-white/20 hover:bg-white/30 rounded transition-colors disabled:opacity-50"
                        title="Recalculate route"
                      >
                        <RefreshCw className={`w-3 h-3 ${isLoadingRoute ? 'animate-spin' : ''}`} />
                      </button>
                    </div>
                    <div className="grid grid-cols-3 gap-1.5 text-center">
                      <div>
                        <div className="text-lg font-bold">{displayDeliveries.length}</div>
                        <div className="text-[10px] opacity-80">Stops</div>
                      </div>
                      <div>
                        <div className="text-lg font-bold">{route.distanceKm.toFixed(1)}</div>
                        <div className="text-[10px] opacity-80">km total</div>
                      </div>
                      <div>
                        <div className="text-lg font-bold">{(route.timeHours + displayDeliveries.length).toFixed(1)}</div>
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
        onSaveContactSuccess={(msg: string) => success(msg)}
        onSaveContactError={(msg: string) => error(msg)}
      />
    </div>
  );
}
