import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Database, MapPin, Zap, List, ClipboardList, RefreshCw, Upload, HelpCircle, X } from 'lucide-react';
import DeliveryTable from '../components/DeliveryList/DeliveryTable';
import CustomerModal from '../components/CustomerDetails/CustomerModal';
import ManageTab from '../components/deliveries/ManageTab';
import DeliveryMap from '../components/MapView/DeliveryMap';
import { calculateRoute, generateFallbackRoute } from '../services/advancedRoutingService';
import useDeliveryStore from '../store/useDeliveryStore';
import {
  applyDeliveryListFilter,
  excludeTeamPortalGarbageDeliveries,
  getOnRouteDeliveriesForList,
} from '../utils/deliveryListFilter';
import { useToast } from '../hooks/useToast';
import { ToastContainer } from '../components/common/Toast';
import { AlertCircle, AlertTriangle } from 'lucide-react';
import { clearDeliveriesCache, showCacheWarning } from '../utils/clearCacheAndReload';
import api from '../frontend/apiClient';
import { getCurrentUser } from '../frontend/auth';
import type { Delivery } from '../types';
import { exportAsXlsx, exportAsCsv } from '../utils/exportDeliveries';
import type { LucideIcon } from 'lucide-react';

// Terminal statuses that should NOT appear on the Live Maps sub-tab in embedded portals.
// Mirrors the filter used by the Logistics portal Live Maps tab.
const PORTAL_MAP_TERMINAL = new Set([
  'delivered', 'cancelled', 'failed', 'returned', 'pod-completed',
  'delivered-with-installation', 'delivered-without-installation',
  'finished', 'completed', 'cancelled-failed',
]);

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
  icon: LucideIcon | React.ComponentType<{ className?: string }>;
}

/** Same roles that use /admin/tracking/deliveries on Delivery & Logistics portals. */
function isTeamPortalOperationalRole(): boolean {
  const r = (getCurrentUser()?.role ?? '').toLowerCase();
  return r === 'admin' || r === 'delivery_team' || r === 'logistics_team';
}

interface ExtraTab {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  content: React.ReactNode;
}

interface DeliveryManagementPageProps {
  /** When true (e.g. Driver Portal), hide Manage Delivery Order tab; show only Deliveries view */
  hideManageTab?: boolean;
  /** When true (e.g. embedded in Logistics Portal), hide the Deliveries sub-tab; show only Manage Delivery Order */
  hideDeliveriesTab?: boolean;
  /** When true (e.g. embedded in team portals), hide the main page title for a cleaner layout */
  hidePageTitle?: boolean;
  /** When true, hide bad import rows (e.g. PO "removed", placeholder "Customer N") from map + Manage tab */
  excludeGarbageUploadRows?: boolean;
  /** When true (logistics_team role), hide file upload controls in ManageTab */
  hideUpload?: boolean;
  /** Extra tabs appended to the tab rail (e.g. Manage Dispatch, Live Tracking from parent portal) */
  extraTabs?: ExtraTab[];
  /** Externally-controlled active tab — parent sets this to navigate programmatically */
  forceTab?: string;
  /** Called when user clicks any tab, so parent can sync its own state */
  onTabChange?: (tabId: string) => void;
  /** Logistics-only: toggle the priority flag */
  onTogglePriority?: (orderId: string, newIsPriority: boolean) => void;
  /** Logistics-only: driver capacity hint provider */
  getDriverCapacity?: (orderId: string, driverId: string) => { used: number; max: number; remaining: number; full: boolean } | null;
  /** Logistics-only: enable Today + date range filters in the orders table */
  enableDispatchFilters?: boolean;
  /**
   * Controls sidebar cards. true = Logistics view (Needs Attention etc.).
   * false = Delivery Team view (Today's Summary + How to Use).
   * Defaults to enableDispatchFilters when omitted.
   */
  showActionCards?: boolean;
  /** Logistics-only: pre-loaded driver list (avoids a second API call inside ManageTab) */
  driverList?: { id: string; fullName?: string | null; username: string }[];
  /** Logistics-only: per-date per-driver capacity for the sidebar Truck Capacity card */
  driverCapacityByDate?: Record<string, Record<string, { used: number; remaining: number; max: number; full: boolean }>>;
  /** Logistics-only: set of online driver IDs for the sidebar status dot */
  onlineDriverIds?: Set<string>;
  /** Delivery Team Portal: add Material (PNC) column to the manage orders table */
  showMaterialColumn?: boolean;
  /** Delivery Team Portal: add Qty column to the manage orders table */
  showQtyColumn?: boolean;
  /** Delivery Team Portal: show plain driver name only in Driver column (no icon/dropdown) */
  simpleDriverDisplay?: boolean;
  /** When true, show Upload Excel + How to Use buttons on the right side of the tab rail */
  showTabRailUpload?: boolean;
  /** Called when a file is selected via the tab-rail Upload Excel button */
  onTabRailFileSelected?: (file: File) => void;
  /** Whether a file upload is currently in progress (disables the Upload button) */
  tabRailUploading?: boolean;
}

export default function DeliveryManagementPage({
  hideManageTab = false,
  hideDeliveriesTab = false,
  hidePageTitle = false,
  excludeGarbageUploadRows = false,
  hideUpload = false,
  extraTabs = [],
  forceTab,
  onTabChange,
  onTogglePriority,
  getDriverCapacity,
  enableDispatchFilters = false,
  showActionCards,
  driverList,
  driverCapacityByDate,
  onlineDriverIds,
  showMaterialColumn = false,
  showQtyColumn = false,
  simpleDriverDisplay = false,
  showTabRailUpload = false,
  onTabRailFileSelected,
  tabRailUploading = false,
}: DeliveryManagementPageProps) {
  const deliveries = useDeliveryStore((state) => state.deliveries ?? []);
  const deliveryListFilter = useDeliveryStore((state) => state.deliveryListFilter ?? 'all');
  const manageTabFilter = useDeliveryStore((state) => state.manageTabFilter);
  const loadDeliveries = useDeliveryStore((state) => state.loadDeliveries);
  const addCompletedUpload = useDeliveryStore((state) => state.addCompletedUpload);
  /** Standalone /deliveries for admin & team: same garbage filter + API as embedded portal pages. */
  const effectiveExcludeGarbage = excludeGarbageUploadRows || isTeamPortalOperationalRole();
  /** Embedded team portals: sequence + map only on-route — not new uploads awaiting customer. */
  const onRouteSequenceOnly = excludeGarbageUploadRows;
  const [activeTab, setActiveTab] = useState<string>(hideManageTab ? 'deliveries' : 'manage');

  // Tab-rail upload button state
  const tabRailFileInputRef = useRef<HTMLInputElement>(null);
  const [showHowToUse, setShowHowToUse] = useState(false);
  const [pendingUploadFile, setPendingUploadFile] = useState<File | null>(null);

  // Bridge: when parent's onTabRailFileSelected fires, store the file so ManageTab can pick it up
  const handleTabRailFile = useCallback((file: File) => {
    setPendingUploadFile(file);
    onTabRailFileSelected?.(file);
  }, [onTabRailFileSelected]);

  // When a Needs Attention card sets a filter, switch to the manage sub-tab so the OrdersTable shows
  useEffect(() => {
    if (manageTabFilter && !hideManageTab) {
      setActiveTab('manage');
      onTabChange?.('manage');
    }
  }, [manageTabFilter, hideManageTab]); // eslint-disable-line react-hooks/exhaustive-deps

  // Respond to external tab navigation (e.g. from notification click or URL param)
  useEffect(() => {
    if (forceTab) {
      setActiveTab(forceTab);
    }
  }, [forceTab]);

  const displayDeliveries = useMemo(() => {
    if (deliveryListFilter === 'delivered') {
      let list = applyDeliveryListFilter(deliveries, 'delivered');
      if (effectiveExcludeGarbage) list = excludeTeamPortalGarbageDeliveries(list);
      return list;
    }
    const base = onRouteSequenceOnly ? getOnRouteDeliveriesForList(deliveries) : deliveries;
    let list = applyDeliveryListFilter(base, deliveryListFilter);
    if (effectiveExcludeGarbage) list = excludeTeamPortalGarbageDeliveries(list);
    return list;
  }, [deliveries, deliveryListFilter, effectiveExcludeGarbage, onRouteSequenceOnly]);

  // Live Maps sub-tab: in embedded team portals, show ALL non-terminal deliveries from DB
  // (same logic as Logistics portal Live Maps — not limited to on-route-sequence only).
  const mapDisplayDeliveries = useMemo((): Delivery[] => {
    if (!excludeGarbageUploadRows) return displayDeliveries;
    let list = deliveries.filter(
      (d) => !PORTAL_MAP_TERMINAL.has((d.status || '').toLowerCase()),
    );
    if (effectiveExcludeGarbage) {
      list = excludeTeamPortalGarbageDeliveries(list as Record<string, unknown>[]) as Delivery[];
    }
    return list;
  }, [deliveries, displayDeliveries, excludeGarbageUploadRows, effectiveExcludeGarbage]);

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

  const syncOperationalListFromTracking = useCallback(async (): Promise<void> => {
    try {
      const res = await api.get('/admin/tracking/deliveries');
      const raw = (res.data?.deliveries ?? []) as Delivery[];
      const list = effectiveExcludeGarbage
        ? excludeTeamPortalGarbageDeliveries(raw as Record<string, unknown>[]) as Delivery[]
        : raw;
      loadDeliveries(list);
    } catch (err: unknown) {
      console.warn('[DeliveryManagement] Tracking sync failed:', err);
    }
  }, [loadDeliveries, effectiveExcludeGarbage]);

  // Admin / delivery_team / logistics_team: always replace store from tracking (same as portals).
  // Avoids stale localStorage from initializeFromStorage() skipping fetch when length > 0.
  useEffect(() => {
    if (!isTeamPortalOperationalRole()) return;
    void syncOperationalListFromTracking();
  }, [syncOperationalListFromTracking]);

  useEffect(() => {
    const handler = (): void => { void syncOperationalListFromTracking(); };
    window.addEventListener('deliveriesUpdated', handler);
    window.addEventListener('deliveryStatusUpdated', handler);
    return () => {
      window.removeEventListener('deliveriesUpdated', handler);
      window.removeEventListener('deliveryStatusUpdated', handler);
    };
  }, [syncOperationalListFromTracking]);

  useEffect(() => {
    if (!isTeamPortalOperationalRole()) return;
    const id = setInterval(() => {
      if (!document.hidden) void syncOperationalListFromTracking();
    }, 60000);
    return () => clearInterval(id);
  }, [syncOperationalListFromTracking]);

  // Other roles: auto-fetch when store is empty (tracking if allowed, else /deliveries).
  useEffect(() => {
    if (isTeamPortalOperationalRole()) return;
    if (useDeliveryStore.getState().deliveries.length > 0) return;
    const fetchInitial = async () => {
      try {
        const res = await api.get('/admin/tracking/deliveries');
        const raw = (res.data?.deliveries ?? []) as Delivery[];
        const list = excludeTeamPortalGarbageDeliveries(raw as Record<string, unknown>[]) as Delivery[];
        if (list.length > 0) {
          loadDeliveries(list);
          addCompletedUpload('Auto-loaded from server', list.length);
        }
      } catch {
        try {
          const res = await api.get('/deliveries?includeFinished=false');
          const list = (res.data?.deliveries ?? []) as Delivery[];
          if (list.length > 0) {
            loadDeliveries(list);
            addCompletedUpload('Auto-loaded from server', list.length);
          }
        } catch {
          /* user can Reload manually */
        }
      }
    };
    void fetchInitial();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Recalculate route when the visible delivery list changes while on the deliveries tab
  // (Upload → loadDeliveries updates store → mapDisplayDeliveries changes → route recalculates)
  useEffect(() => {
    if (activeTab === 'deliveries' && mapDisplayDeliveries.length > 0) {
      void loadRoute();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, mapDisplayDeliveries, deliveryListFilter]);

  const loadRoute = async (): Promise<void> => {
    if (mapDisplayDeliveries.length === 0) return;

    setIsLoadingRoute(true);
    setRouteError(null);
    setIsFallback(false);
    setIsOptimized(false);

    try {
      const locations = [
        { lat: 25.0053, lng: 55.0760 },
        ...mapDisplayDeliveries.map((d: Delivery) => ({ lat: d.lat, lng: d.lng }))
      ];

      try {
        const routeData = (await calculateRoute(locations, mapDisplayDeliveries, true)) as unknown as AdvancedRouteResult;
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
        ...mapDisplayDeliveries.map((d: Delivery) => ({ lat: d.lat, lng: d.lng }))
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
    // Switch to Deliveries tab so user sees updated list and route immediately
    setActiveTab('deliveries');
  };

  const handleReloadFromDatabase = async (): Promise<void> => {
    try {
      setIsReloading(true);
      clearDeliveriesCache();

      if (isTeamPortalOperationalRole()) {
        const response = await api.get('/admin/tracking/deliveries');
        const raw = (response.data?.deliveries ?? []) as Delivery[];
        const freshDeliveries = excludeTeamPortalGarbageDeliveries(raw as Record<string, unknown>[]) as Delivery[];
        loadDeliveries(freshDeliveries);
        addCompletedUpload('Operations list reload', freshDeliveries.length);
        const currentUser = getCurrentUser();
        if (currentUser?.role === 'admin' && freshDeliveries.length > 0) {
          try {
            const ids = freshDeliveries.map((d) => d.id).filter(Boolean);
            if (ids.length > 0) {
              await api.post('/deliveries/bulk-assign', { deliveryIds: ids });
            }
          } catch (assignErr: unknown) {
            const e = assignErr as { message?: string };
            console.warn('Bulk auto-assign after reload failed:', e.message || assignErr);
          }
        }
        success(`✓ Reloaded ${freshDeliveries.length} deliveries (same live list as Delivery / Logistics portal).`);
        setShowCacheAlert(false);
        return;
      }

      const response = await api.get('/deliveries?includeFinished=false');
      if (response.data && response.data.deliveries) {
        const freshDeliveries = response.data.deliveries as Delivery[];
        loadDeliveries(freshDeliveries);
        addCompletedUpload('Database reload', freshDeliveries.length);

        const currentUser = getCurrentUser();
        if (currentUser?.role === 'admin') {
          try {
            const ids = freshDeliveries.map((d) => d.id).filter(Boolean);
            if (ids.length > 0) {
              await api.post('/deliveries/bulk-assign', { deliveryIds: ids });
            }
          } catch (assignErr: unknown) {
            const e = assignErr as { message?: string };
            console.warn('Bulk auto-assign after DB reload failed:', e.message || assignErr);
          }
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

  /**
   * Export the orders that the user is currently looking at — i.e. the subset
   * of `deliveries` whose IDs match the filter state inside OrdersTable.
   * The IDs are passed up by the Export button so the page doesn't need to
   * duplicate the table's filter logic; whatever the table renders, the
   * spreadsheet contains. With no IDs supplied (legacy callers) we keep the
   * old "export everything" behaviour as a safe default.
   */
  const handleExport = (
    filteredIds: string[] = [],
    format: 'xlsx' | 'csv' = 'xlsx',
  ): void => {
    if (deliveries.length === 0) {
      error('No deliveries to export');
      return;
    }
    const subset = filteredIds.length > 0
      ? (() => {
          const idSet = new Set(filteredIds.map(String));
          return deliveries.filter(d => idSet.has(String(d.id)));
        })()
      : deliveries;
    if (subset.length === 0) {
      error('No deliveries match the current filters — adjust filters before exporting.');
      return;
    }
    if (format === 'csv') {
      exportAsCsv(subset);
      success(`Exported ${subset.length} deliveries as CSV`);
    } else {
      exportAsXlsx(subset);
      success(`Exported ${subset.length} deliveries as Excel`);
    }
  };

  const baseTabs: Tab[] = hideManageTab
    ? [{ id: 'deliveries', label: 'Live Maps', icon: MapPin }]
    : hideDeliveriesTab
    ? [{ id: 'manage', label: 'Manage Delivery Order', icon: ClipboardList }]
    : [
        { id: 'manage', label: 'Manage Delivery Order', icon: ClipboardList },
        { id: 'deliveries', label: 'Live Maps', icon: MapPin },
      ];
  const tabs: Tab[] = [...baseTabs, ...extraTabs.map(t => ({ id: t.id, label: t.label, icon: t.icon }))];

  const noDeliveriesForDeliveriesTab =
    effectiveExcludeGarbage && !hideManageTab
      ? mapDisplayDeliveries.length === 0
      : deliveries.length === 0;

  return (
    <div className={hidePageTitle ? 'space-y-2 overflow-x-hidden' : 'space-y-4 overflow-x-hidden'}>
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
                <RefreshCw className={`h-5 w-5 flex-shrink-0 ${isReloading ? 'animate-spin' : ''}`} />
                {isReloading ? 'Reloading...' : 'Reload from Database (Fix SMS)'}
              </button>
            </div>
            <button onClick={() => setShowCacheAlert(false)} className="flex-shrink-0 p-2 min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 flex items-center justify-center text-red-600 hover:text-red-800 rounded-lg touch-manipulation" aria-label="Dismiss">✕</button>
          </div>
        </div>
      )}

      {/* Header - stacked on mobile, row on desktop; buttons wrap and are touch-friendly */}
      {!hidePageTitle && (
        <div className="flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-3 mb-2">
          <div className="min-w-0">
            <h1 className="pp-page-title text-xl sm:text-3xl">Delivery Management</h1>
            <p className="pp-page-subtitle text-xs sm:text-sm">Manage deliveries, view routes, and track status</p>
          </div>
          <div className="flex flex-wrap gap-2 sm:flex-nowrap" />
        </div>
      )}

      {/* Tab Navigation - hidden when only Deliveries (Driver Portal) or only one tab */}
      {/* Inside team portals we omit the page title; keep this rail non-sticky so it does not
          stack over Manage tab content (portal already has a sticky tab bar). */}
      {!hideManageTab && tabs.length > 1 && (
      <div
        className={
          hidePageTitle
            ? 'relative z-10 mb-6 mt-2 md:mt-4 rounded-2xl border border-gray-200/60 bg-gray-100/80 p-1.5 dark:border-white/[0.07] dark:bg-white/[0.06]'
            : 'pp-sticky-tab-rail mb-4 mt-4 rounded-2xl border border-gray-200/60 bg-gray-100/80 p-1.5 dark:border-white/[0.07] dark:bg-white/[0.06] md:mb-6 md:mt-6'
        }
      >
        <nav className="flex flex-nowrap items-center gap-1 overflow-x-auto pb-1">
          <div className="flex flex-nowrap gap-1">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => {
                    setActiveTab(tab.id);
                    onTabChange?.(tab.id);
                    if (tab.id === 'deliveries' && displayDeliveries.length > 0) {
                      void loadRoute();
                    }
                  }}
                  className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium whitespace-nowrap rounded-xl min-h-[44px] touch-manipulation transition-all ${
                    activeTab === tab.id
                      ? 'bg-white dark:bg-slate-800 text-blue-600 dark:text-blue-400 shadow-sm'
                      : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 hover:bg-white/60 dark:hover:bg-slate-700/50'
                  }`}
                >
                  <Icon className="w-5 h-5" />
                  {tab.label}
                </button>
              );
            })}
          </div>

          {/* Upload Excel + How to Use — Delivery Team Portal only */}
          {showTabRailUpload && (
            <div className="ml-auto flex flex-nowrap items-center gap-1.5 pl-2">
              <input
                ref={tabRailFileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleTabRailFile(file);
                  e.target.value = '';
                }}
              />
              <button
                type="button"
                onClick={() => tabRailFileInputRef.current?.click()}
                disabled={tabRailUploading}
                className={`flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-medium whitespace-nowrap min-h-[44px] touch-manipulation transition-all ${
                  tabRailUploading
                    ? 'opacity-50 pointer-events-none bg-gray-200 dark:bg-gray-700 text-gray-400'
                    : 'bg-[#032145] text-white hover:bg-[#021432] shadow-sm'
                }`}
              >
                <Upload className="w-4 h-4" />
                {tabRailUploading ? 'Uploading...' : 'Upload Excel'}
              </button>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowHowToUse((v) => !v)}
                  className={`flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium whitespace-nowrap min-h-[44px] touch-manipulation transition-all ${
                    showHowToUse
                      ? 'bg-white dark:bg-slate-800 text-blue-600 dark:text-blue-400 shadow-sm'
                      : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 hover:bg-white/60 dark:hover:bg-slate-700/50'
                  }`}
                >
                  <HelpCircle className="w-4 h-4" />
                  How to Use
                </button>
                {showHowToUse && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setShowHowToUse(false)} />
                    <div className="absolute right-0 top-full mt-2 z-50 w-72 rounded-xl bg-white dark:bg-gray-800 shadow-xl border border-gray-200 dark:border-gray-700 p-4">
                      <div className="flex items-center justify-between mb-3">
                        <h3 className="font-semibold text-sm text-gray-900 dark:text-white">How to Use</h3>
                        <button
                          type="button"
                          onClick={() => setShowHowToUse(false)}
                          className="p-1 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                      <div className="space-y-3">
                        {[
                          { num: 1, text: 'Upload Excel with orders',        color: 'bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-300' },
                          { num: 2, text: 'System sends SMS to customer',    color: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-300' },
                          { num: 3, text: 'Customer confirms delivery date', color: 'bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-300' },
                          { num: 4, text: 'Assign driver & set GMD date',   color: 'bg-indigo-100 text-indigo-600 dark:bg-indigo-900/40 dark:text-indigo-300' },
                          { num: 5, text: 'Driver delivers & submits POD',   color: 'bg-purple-100 text-purple-600 dark:bg-purple-900/40 dark:text-purple-300' },
                        ].map((step) => (
                          <div key={step.num} className="flex items-center gap-2">
                            <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-semibold shrink-0 ${step.color}`}>
                              {step.num}
                            </span>
                            <span className="text-xs text-gray-600 dark:text-gray-300">{step.text}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </nav>
      </div>
      )}

      {/* ── MANAGE DELIVERY ORDER TAB ── */}
      {!hideManageTab && activeTab === 'manage' && (
        <ManageTab
          compactVerticalSpacing={hidePageTitle}
          excludeGarbageDeliveries={effectiveExcludeGarbage}
          hideUpload={hideUpload || showTabRailUpload}
          onSwitchToDeliveriesTab={() => setActiveTab('deliveries')}
          onUploadSuccess={handleFileSuccess}
          onUploadError={handleFileError}
          onDuplicateFile={() =>
            error('Already uploaded', 'This file was already uploaded. Duplicates are skipped.')
          }
          onToastError={(msg) => error(msg)}
          onNotifySuccess={(title, message) => success(title, message ?? '')}
          onExportDeliveries={handleExport}
          onTogglePriority={onTogglePriority}
          getDriverCapacity={getDriverCapacity}
          enableDispatchFilters={enableDispatchFilters}
          showActionCards={showActionCards}
          driverList={driverList}
          driverCapacityByDate={driverCapacityByDate}
          onlineDriverIds={onlineDriverIds}
          showMaterialColumn={showMaterialColumn}
          showQtyColumn={showQtyColumn}
          simpleDriverDisplay={simpleDriverDisplay}
          enableForceDispatch={true}
          pendingUploadFile={pendingUploadFile}
          clearPendingUploadFile={() => setPendingUploadFile(null)}
        />
      )}

      {/* ── DELIVERIES TAB (combined split view) ── */}
      {activeTab === 'deliveries' && (
        <div
          className={
            hideManageTab ? 'mt-4 md:mt-6' : hidePageTitle ? 'mt-1' : 'mt-2'
          }
        >
          {noDeliveriesForDeliveriesTab ? (
            <div className="pp-dash-card p-8 text-center transition-colors">
              <Database className="w-16 h-16 text-gray-400 dark:text-gray-500 mx-auto mb-4" />
              <p className="text-gray-600 dark:text-gray-400 text-lg mb-4">
                {hideManageTab
                  ? 'No deliveries assigned yet.'
                  : excludeGarbageUploadRows
                  ? 'No active deliveries to display.'
                  : 'No deliveries loaded'}
              </p>
              {/* Only show Upload button on the standalone /deliveries page, not inside team portals */}
              {!hideManageTab && !excludeGarbageUploadRows && (
                <button
                  onClick={() => setActiveTab('manage')}
                  className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  Upload Delivery Data
                </button>
              )}
              {hideManageTab && (
                <p className="text-sm text-gray-500 dark:text-gray-400">Contact your supervisor to assign deliveries.</p>
              )}
              {!hideManageTab && excludeGarbageUploadRows && (
                <p className="text-sm text-gray-500 dark:text-gray-400">On-route and confirmed deliveries appear here automatically.</p>
              )}
            </div>
          ) : (
            <>
              {/* Container: mobile = auto height (page can scroll), desktop = fixed viewport height (no page scroll) */}
              <div
                className="flex flex-col md:flex-row gap-4 md:gap-5 items-stretch md:items-start flex-1 min-h-0 min-h-[320px] sm:min-h-[400px] md:min-h-[400px] lg:h-[calc(100vh-300px)] lg:max-h-[calc(100vh-300px)]"
              >
                {/* ── Map: top on mobile (fixed height), left on desktop ── */}
                <div
                  className="relative rounded-xl overflow-hidden shadow-lg border border-gray-200 dark:border-gray-700 w-full md:w-[58%] flex-shrink-0 md:flex-shrink h-[40vh] sm:h-[45vh] md:h-full min-h-[220px] md:min-h-0"
                >
                {isLoadingRoute && !route ? (
                  <div className="h-full flex items-center justify-center bg-white dark:bg-gray-800">
                    <div className="text-center">
                      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4" />
                      <p className="text-gray-600 dark:text-gray-400 text-sm">
                        Calculating route for {mapDisplayDeliveries.length} stops…
                      </p>
                    </div>
                  </div>
                ) : (
                  <DeliveryMap
                    deliveries={mapDisplayDeliveries}
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
                className="w-full md:w-[42%] flex-1 min-h-0 md:h-full flex flex-col gap-4 min-w-0 overflow-hidden"
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
                        <div className="text-lg font-bold">{mapDisplayDeliveries.length}</div>
                        <div className="text-[10px] opacity-80">Stops</div>
                      </div>
                      <div>
                        <div className="text-lg font-bold">{route.distanceKm.toFixed(1)}</div>
                        <div className="text-[10px] opacity-80">km total</div>
                      </div>
                      <div>
                        <div className="text-lg font-bold">{(route.timeHours + mapDisplayDeliveries.length).toFixed(1)}</div>
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
                    onRouteSequenceOnly={onRouteSequenceOnly}
                  />
                </div>
              </div>
            </div>
            </>
          )}
        </div>
      )}

      {/* ── EXTRA TABS (e.g. Manage Dispatch, Live Tracking from parent portal) ── */}
      {extraTabs.map(tab => activeTab === tab.id && (
        <React.Fragment key={tab.id}>{tab.content}</React.Fragment>
      ))}

      {/* Customer Details Modal */}
      <CustomerModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        onSaveContactSuccess={(msg: string) => success(msg)}
        onSaveContactError={(msg: string) => error(msg)}
        useDriverEndpoint={hideManageTab}
      />
    </div>
  );
}
