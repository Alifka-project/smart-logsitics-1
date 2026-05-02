import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import api, { setAuthToken } from '../frontend/apiClient';
import { getCurrentUser } from '../frontend/auth';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { calculateRouteWithOSRM } from '../services/osrmRoutingService';
import DeliveryTable from '../components/DeliveryList/DeliveryTable';
import CustomerModal from '../components/CustomerDetails/CustomerModal';
import useDeliveryStore from '../store/useDeliveryStore';
import { calculateDistance } from '../utils/distanceCalculator';
import { useToast } from '../hooks/useToast';
import { ToastContainer } from '../components/common/Toast';
import {
  MapPin, Navigation, RefreshCw, AlertCircle, CheckCircle2,
  MessageSquare, Truck, Bell, Paperclip, Send, Search, ClipboardList, ChevronLeft, PackageCheck
} from 'lucide-react';
import type { Delivery } from '../types';
import { getOnRouteDeliveriesForList, isOnRouteDeliveryListStatus, getEtaStatus, applyDeliveryListFilter } from '../utils/deliveryListFilter';
import type { DeliveryListFilter } from '../utils/deliveryListFilter';
import { isPickingListEligible, isDriverMyOrdersStatus } from '../utils/pickingListFilter';
import PickingListPanel from '../components/deliveries/PickingListPanel';
import PickingReminderModal from '../components/deliveries/PickingReminderModal';
import { usePickingReminder } from '../hooks/usePickingReminder';
import { createDriverMarkerIcon, createDeliveryIconForDelivery } from '../utils/mapIcons';

// Fix Leaflet default marker icons
delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: '/leaflet-images/marker-icon-2x.png',
  iconUrl: '/leaflet-images/marker-icon.png',
  shadowUrl: '/leaflet-images/marker-shadow.png',
});

interface LocationData {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  heading: number | null;
  speed: number | null;
  timestamp: string;
}

interface DriverRouteData {
  coordinates?: [number, number][];
  legs?: unknown[];
  [key: string]: unknown;
}

interface ContactUser {
  id: string;
  username: string;
  fullName?: string | null;
  full_name?: string | null;
  role?: string;
  account?: {
    role?: string;
    lastLogin?: string | null;
  };
}

interface DriverMessage {
  id?: string;
  text?: string;
  content?: string;
  from?: string;
  senderRole?: string;
  timestamp?: string;
  createdAt?: string;
  attachmentUrl?: string;
  attachmentType?: string;
  attachmentName?: string;
  [key: string]: unknown;
}

type EnrichedDelivery = Delivery & {
  routeIndex?: number;
  estimatedEta?: string | null;
  /** The ETA calculated on the FIRST route run — used as the on-time baseline. Never overwritten. */
  plannedEta?: string | null;
  /**
   * Static ETA (D3): locked at "Start Delivery" time.
   * = departure time + cumulative drive time + 60-min service per stop.
   * Used as the baseline for delay detection (>1 hr over staticEta = Order Delay).
   */
  staticEta?: string | null;
  eta?: string | null;
  distanceFromDriverKm?: number;
};

interface LatLng {
  lat: number;
  lng: number;
}

function ensureAuth(): void {
  const token = localStorage.getItem('auth_token');
  if (token) setAuthToken(token);
}

const WAREHOUSE_LOCATION: LatLng = { lat: 25.0053, lng: 55.0760 };

/**
 * Fields owned by the server / Zustand poll that must not be replaced by a stale
 * stop row captured when the OSRM request started (common when /driver/deliveries
 * promotes pickup-confirmed → out-for-delivery while routing is in flight).
 */
function authoritativeFieldsFromStore(inStore: Record<string, unknown> | undefined): Partial<Delivery> {
  if (!inStore) return {};
  const o: Partial<Delivery> = {};
  if (typeof inStore.status === 'string' && inStore.status.trim() !== '') {
    o.status = inStore.status as Delivery['status'];
  }
  if (inStore.confirmedDeliveryDate !== undefined) {
    o.confirmedDeliveryDate = inStore.confirmedDeliveryDate as Delivery['confirmedDeliveryDate'];
  }
  if (inStore.goodsMovementDate !== undefined) {
    o.goodsMovementDate = inStore.goodsMovementDate as Delivery['goodsMovementDate'];
  }
  return o;
}

/**
 * Distance from point P to the line segment connecting A and B, in meters.
 * Uses a cartesian projection in lat/lng space, valid for short segments at
 * moderate latitudes (Dubai is ~25°N — error stays well under 1% over the
 * sub-kilometre segments OSRM emits). Used by the routing effect's
 * deviation detector to decide whether the driver has actually wandered
 * off the planned polyline.
 */
function pointToSegmentDistanceMeters(
  pLat: number, pLng: number,
  aLat: number, aLng: number,
  bLat: number, bLng: number,
): number {
  const dLat = bLat - aLat;
  const dLng = bLng - aLng;
  if (dLat === 0 && dLng === 0) {
    return calculateDistance(pLat, pLng, aLat, aLng) * 1000;
  }
  const t = Math.max(0, Math.min(1,
    ((pLat - aLat) * dLat + (pLng - aLng) * dLng) / (dLat * dLat + dLng * dLng),
  ));
  const projLat = aLat + t * dLat;
  const projLng = aLng + t * dLng;
  return calculateDistance(pLat, pLng, projLat, projLng) * 1000;
}

// ── Driver route-state persistence (survives logout / app restart) ──────────
// The planned/static ETA and the "Start Delivery" timestamp were held only in
// React state, so a re-login reset them and the lock effectively disappeared.
// Persist them to localStorage keyed by driver ID so the driver resumes
// exactly where they left off on the same device. Auto-expires after 12 h
// so a stale state from yesterday doesn't carry into a new route.
const ROUTE_STATE_KEY_PREFIX = 'driver_route_state_';
const ROUTE_STATE_MAX_AGE_MS = 12 * 60 * 60 * 1000; // 12 hours

interface PersistedEta {
  plannedEta: string | null;
  staticEta: string | null;
}
interface PersistedRouteState {
  startedAt: number | null;
  etas: Record<string, PersistedEta>;
}

function getDriverStorageId(): string | null {
  try {
    const u = getCurrentUser();
    return u?.id ?? u?.sub ?? null;
  } catch {
    return null;
  }
}

function loadRouteState(driverId: string | null): PersistedRouteState {
  if (!driverId) return { startedAt: null, etas: {} };
  try {
    const raw = localStorage.getItem(`${ROUTE_STATE_KEY_PREFIX}${driverId}`);
    if (!raw) return { startedAt: null, etas: {} };
    const parsed = JSON.parse(raw) as Partial<PersistedRouteState> | null;
    if (!parsed || typeof parsed !== 'object') return { startedAt: null, etas: {} };
    const startedAt = typeof parsed.startedAt === 'number' ? parsed.startedAt : null;
    // Expire stale state so yesterday's route doesn't bleed into today's.
    if (startedAt != null && Date.now() - startedAt > ROUTE_STATE_MAX_AGE_MS) {
      localStorage.removeItem(`${ROUTE_STATE_KEY_PREFIX}${driverId}`);
      return { startedAt: null, etas: {} };
    }
    return {
      startedAt,
      etas: parsed.etas && typeof parsed.etas === 'object' ? parsed.etas as Record<string, PersistedEta> : {},
    };
  } catch {
    return { startedAt: null, etas: {} };
  }
}

function saveRouteState(driverId: string | null, state: PersistedRouteState): void {
  if (!driverId) return;
  try {
    localStorage.setItem(`${ROUTE_STATE_KEY_PREFIX}${driverId}`, JSON.stringify(state));
  } catch {
    // Ignore quota / disabled storage errors — persistence is best-effort.
  }
}

export default function DriverPortal() {
  const routeLocation = useLocation();
  const [location, setLocation] = useState<LocationData | null>(null);
  const [isTracking, setIsTracking] = useState<boolean>(false);
  const [locationHistory, setLocationHistory] = useState<LocationData[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [mapReady, setMapReady] = useState<boolean>(false);
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const markerAnimationRef = useRef<number | null>(null);
  const lastAutoPanAtRef = useRef<number>(0);
  /** True once the initial fitBounds has been performed on the route. Subsequent route updates only redraw the polyline without changing the view. */
  const hasInitialFitRef = useRef<boolean>(false);
  const watchIdRef = useRef<number | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isTrackingRef = useRef<boolean>(false);
  /** Ignore stale responses when multiple loadDeliveries calls overlap (poll + event). */
  const loadDeliveriesSeqRef = useRef<number>(0);

  // Tab management: Orders (map+list) and Messages
  const [activeTab, setActiveTab] = useState<string>('orders');

  // Delivery state
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [, setLoadingDeliveries] = useState<boolean>(false);

  // Separate delivery lists per type (on-route / confirmed / finished)
  const [onRouteDeliveries, setOnRouteDeliveries] = useState<Delivery[]>([]);
  const [confirmedDeliveries, setConfirmedDeliveries] = useState<Delivery[]>([]);
  const [finishedDeliveries, setFinishedDeliveries] = useState<Delivery[]>([]);
  const [pickingStageDeliveries, setPickingStageDeliveries] = useState<Delivery[]>([]);

  // D4: "Start Delivery" — wall-clock time driver departed the warehouse
  // Once set, staticEta for each stop is locked and used for 1-hr delay detection (D3)
  // Lazy initialiser reads from localStorage so a re-login restores the lock
  // on the first render — no flicker of the "Start Delivery" button.
  const [deliveryStartedAt, setDeliveryStartedAt] = useState<number | null>(
    () => loadRouteState(getDriverStorageId()).startedAt,
  );

  // Driver ID is the localStorage key for route-state persistence. Captured
  // once on mount so we keep writing to the same bucket even if the auth
  // client is mid-refresh.
  const driverStorageIdRef = useRef<string | null>(getDriverStorageId());

  // Per-delivery ETA cache loaded from localStorage. Lives in a ref (not
  // state) because we only need it inside the routing effect closure and
  // don't want it to trigger re-renders when we hydrate new values.
  const persistedEtasRef = useRef<Record<string, PersistedEta>>(
    loadRouteState(getDriverStorageId()).etas,
  );

  // Dedupe key for the "sync locked plan ETAs to backend" catch-up call —
  // avoids POSTing on every GPS tick when the plan ETAs haven't changed.
  const lastBackendEtaSyncRef = useRef<string>('');

  // Messaging state
  const [messages, setMessages] = useState<DriverMessage[]>([]);
  const [newMessage, setNewMessage] = useState<string>('');
  const [contactSearch, setContactSearch] = useState<string>('');
  const [sendingMessage, setSendingMessage] = useState<boolean>(false);
  const [loadingMessages, setLoadingMessages] = useState<boolean>(false);
  const [contacts, setContacts] = useState<ContactUser[]>([]);
  const [teamMembers, setTeamMembers] = useState<ContactUser[]>([]);
  const [selectedContact, setSelectedContact] = useState<ContactUser | null>(null);
  const [loadingContacts, setLoadingContacts] = useState<boolean>(false);
  const [attachmentPreview, setAttachmentPreview] = useState<{ url: string; type: string; name: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Routing state
  const [route, setRoute] = useState<DriverRouteData | null>(null);
  const [orderedDeliveries, setOrderedDeliveries] = useState<EnrichedDelivery[]>([]);
  const [isRouteLoading, setIsRouteLoading] = useState<boolean>(false);
  const [routeError, setRouteError] = useState<string | null>(null);
  // Tracks whether the driver has been shown a toast for the current routing
  // outage. The route status pill ("⚠ Offline") is small and easy to miss; a
  // one-shot toast on first failure makes the issue obvious. Cleared the
  // moment OSRM recovers so the next outage gets a fresh warning.
  const routeErrorToastShownRef = useRef<boolean>(false);

  // Notification state
  const [notifications, setNotifications] = useState<number>(0);

  // Orders tab: modal for POD
  const [showModal, setShowModal] = useState<boolean>(false);
  const { toasts, removeToast, success, error: toastError, warning: toastWarning } = useToast();
  const updateDeliveryOrder = useDeliveryStore((s) => s.updateDeliveryOrder);
  const setDeliveryListFilter = useDeliveryStore((s) => s.setDeliveryListFilter);
  const updateDeliveryStatus = useDeliveryStore((s) => s.updateDeliveryStatus);
  // Store deliveries carry priority (assigned by loadDeliveries) — used for priority breakdown display
  const storeDeliveries = useDeliveryStore((s) => s.deliveries);
  // Current chip filter on the delivery list — drives which deliveries end
  // up on the map so list and map always show the same set.
  const deliveryListFilter = useDeliveryStore((s) => s.deliveryListFilter);

  // ── Picking-list reminder ────────────────────────────────────────────────
  // Orders on the driver's picking list (pgi-done / rescheduled with GMD and
  // no picking.confirmedAt). Reuse isPickingListEligible so the reminder
  // count stays in sync with the tab badge.
  const pickingPendingOrders = useMemo<Delivery[]>(
    () => storeDeliveries.filter((d) => isPickingListEligible(d)),
    [storeDeliveries],
  );
  const { isVisible: reminderVisible, dismiss: dismissReminder } = usePickingReminder({
    pendingCount: pickingPendingOrders.length,
    isOnPickingTab: activeTab === 'picking',
  });
  const handleOpenPickingFromReminder = useCallback(() => {
    setActiveTab('picking');
    dismissReminder();
  }, [dismissReminder]);

  // Manual reorder tracking: when the driver drags the list, honour that order
  // instead of recalculating via nearest-neighbour.
  const manuallyOrderedRef = useRef<boolean>(false);
  const userOrderRef = useRef<Delivery[]>([]);

  // Ref mirror of deliveryStartedAt so the routing effect can read it without being a dep.
  // Initialised from the lazy state so the first routing pass after a re-login
  // sees the persisted timestamp and keeps the static ETA locked.
  const deliveryStartedAtRef = useRef<number | null>(deliveryStartedAt);

  // Lock stop order after first OSRM calc so distances decrease monotonically on GPS movement.
  // Only reset when deliveries actually change (new/completed orders).
  const committedOrderRef = useRef<Delivery[]>([]);

  const confirmedDeliveriesRef = useRef<Delivery[]>([]);
  const finishedDeliveriesRef = useRef<Delivery[]>([]);
  const pickingStageDeliveriesRef = useRef<Delivery[]>([]);

  // Tracks the chip filter from the previous effect run so we can tell a
  // chip change (reset manual-reorder, re-apply filter) apart from a store
  // refresh (respect manual order if the driver dragged).
  const prevDeliveryListFilterRef = useRef<DeliveryListFilter>(deliveryListFilter);

  // Signature of the last applied chip-filtered deliveries (id + status,
  // in order). Used to bail the chip-filter effect when a store mutation
  // doesn't actually change the visible set — without this, every store
  // write (including the one the routing effect itself emits via
  // updateDeliveryOrder) re-runs setDeliveries + resets
  // lastRouteDeliveriesRef.current = '', which forces the routing effect
  // to treat the next pass as deliveriesChanged=true and kick off another
  // OSRM call. The result was a feedback loop that left "Routing…"
  // permanently on and the polyline never settled.
  const prevFilteredSigRef = useRef<string>('');

  /**
   * Tracks which deliveries were already in the "delayed" ETA bucket on the
   * previous render so we only fire a warning toast once per *transition*
   * into delayed — not on every re-render and not for orders that were
   * already delayed when the page first loaded. `null` = first observation
   * not yet recorded (skip the toast on initial mount).
   */
  const prevDelayedIdsRef = useRef<Set<string> | null>(null);

  // Map <-> list sync. The driver portal's map should always render the same
  // set of deliveries as whichever chip is active on the list:
  //   · Today Delivery (default) → OFD + today pickup-confirmed + order-delay
  //   · Pickup Confirmed         → all pickup-confirmed orders
  //   · P1 Urgent                → priority-flagged active orders
  //   · On Time / Delayed        → active orders with ETA in that bucket
  //   · Completed                → recently delivered / cancelled
  // Previously the map hardcoded [onRoute + all-pickup-confirmed] which pinned
  // future-dated orders onto today's map and confused drivers. Driving the
  // map from the chip filter keeps list and map consistent by construction.
  useEffect(() => {
    const filtered = applyDeliveryListFilter(storeDeliveries, deliveryListFilter);
    const filteredSig = filtered.map(d => `${d.id}:${(d.status || '').toLowerCase()}`).join('|');
    const chipChanged = prevDeliveryListFilterRef.current !== deliveryListFilter;
    if (chipChanged) {
      // A new chip means a new set of stops — any manual drag-order from the
      // previous chip is no longer meaningful. Reset so the new filter can
      // render cleanly, then re-arm for dragging under the new chip.
      manuallyOrderedRef.current = false;
      userOrderRef.current = [];
      prevDeliveryListFilterRef.current = deliveryListFilter;
    }
    if (manuallyOrderedRef.current) {
      // Manual reorder takes precedence; don't override the user's order.
      // Keep prevFilteredSigRef tracking the latest store-derived signature
      // so a subsequent non-manual run can bail correctly.
      prevFilteredSigRef.current = filteredSig;
      return;
    }
    // Bail when the chip-filtered set is unchanged in shape (same IDs +
    // statuses in same order). Without this short-circuit, every store
    // mutation — including the one updateDeliveryOrder writes after every
    // OSRM success — would call setDeliveries with a new array reference,
    // which the routing effect then treats as a fresh delivery set
    // (because we reset lastRouteDeliveriesRef.current = '' below). That
    // forced the gates to bypass and a new OSRM call to fire on every
    // routing success — the loop that hid the polyline.
    if (!chipChanged && filteredSig === prevFilteredSigRef.current) {
      return;
    }
    prevFilteredSigRef.current = filteredSig;
    setDeliveries(filtered);
    // Force the routing effect to re-fetch OSRM — otherwise it may short
    // circuit when the signature by customer IDs happens to match.
    lastRouteDeliveriesRef.current = '';
  }, [storeDeliveries, deliveryListFilter]);

  // Callback passed to <DeliveryTable onReorder> so drag-reorder triggers map update
  const handleManualReorder = useCallback((newOrder: Delivery[]) => {
    manuallyOrderedRef.current = true;
    userOrderRef.current = newOrder;
    // Only keep on-route items in deliveries state (used by the routing effect).
    // The full reordered store list is handled by updateDeliveryOrder inside handleCardDrop.
    const onRouteOnly = newOrder.filter(d => isOnRouteDeliveryListStatus((d.status || '').toLowerCase()));
    setDeliveries(onRouteOnly.length > 0 ? onRouteOnly : newOrder);
    // Clear the last-origin ref so the effect does not short-circuit
    lastRouteDeliveriesRef.current = '';
  }, []);

  // Notify the driver when an order *transitions* into the delayed bucket
  // mid-route. getEtaStatus flags a delivery as 'delayed' when its live
  // estimated ETA exceeds the locked plan ETA by >60 min, so this effect
  // fires the moment GPS movement (or stop completion) pushes a stop's
  // arrival window past the threshold. Uses a ref-keyed delta so it never
  // re-fires for the same delivery, never fires on the initial mount for
  // orders that were already delayed at page load, and silently no-ops
  // when the ID set is unchanged.
  useEffect(() => {
    const currentDelayed = orderedDeliveries.filter(d => getEtaStatus(d) === 'delayed');
    const currentIds = new Set(currentDelayed.map(d => String(d.id)));

    // First observation — record baseline without notifying. Without this
    // guard the page would toast for every pre-existing delay on every
    // refresh / route-recalc / re-login.
    if (prevDelayedIdsRef.current === null) {
      prevDelayedIdsRef.current = currentIds;
      return;
    }

    const newlyDelayed = currentDelayed.filter(d => !prevDelayedIdsRef.current!.has(String(d.id)));
    prevDelayedIdsRef.current = currentIds;

    if (newlyDelayed.length === 0) return;

    if (newlyDelayed.length === 1) {
      const d = newlyDelayed[0];
      const customer = (d.customer && String(d.customer).trim()) || 'Order';
      toastWarning(
        '⚠ Order delayed',
        `${customer} is now running over an hour late.`,
        'Live ETA exceeds Plan ETA by more than 60 min.',
        7000,
      );
    } else {
      toastWarning(
        '⚠ Multiple orders delayed',
        `${newlyDelayed.length} orders are now running over an hour late.`,
        'Live ETA exceeds Plan ETA by more than 60 min.',
        7000,
      );
    }
    // toastWarning is recreated on every render by useToast; intentionally
    // omitted to avoid the effect firing on its identity change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderedDeliveries]);

  // Surface a one-shot toast when OSRM routing first fails — the small "⚠
  // Offline" status pill in the route summary is easy to miss when the
  // driver is mid-delivery. The pill stays as the persistent indicator;
  // the toast is just a kick to make the failure obvious. Reset on
  // recovery so the next outage gets its own warning instead of being
  // silently masked.
  useEffect(() => {
    if (routeError) {
      if (!routeErrorToastShownRef.current) {
        routeErrorToastShownRef.current = true;
        toastWarning(
          'Routing offline',
          'Live route preview unavailable — your delivery list is still up to date.',
          'OSRM service unreachable. The map will recover automatically when service returns.',
          7000,
        );
      }
    } else {
      routeErrorToastShownRef.current = false;
    }
    // toastWarning identity changes every render; intentionally omitted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeError]);

  // Refs for auto-scroll and polling
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const messagePollingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const routeLayersRef = useRef<L.Polyline[]>([]);
  const deliveryMarkersRef = useRef<L.Marker[]>([]);
  const lastRouteOriginRef = useRef<LatLng | null>(null);
  const lastRouteDeliveriesRef = useRef<string>('');
  /**
   * Wall-clock time (ms) of the last successful OSRM recompute. Used to
   * throttle route redraws to at most once every 10 seconds so the polyline
   * and stop order don't jitter on every GPS tick. The driver's position
   * dot still moves in real time — only the polyline/markers respect the
   * throttle. Set to 0 initially so the first route calc fires immediately.
   */
  const lastRouteAtRef = useRef<number>(0);

  /**
   * Speed-computation refs. Browser-provided `coords.speed` is unreliable —
   * iOS Safari almost always returns null, Android Chrome returns null on
   * stationary or freshly-acquired GPS samples. We compute speed from the
   * delta between successive watchPosition samples as a fallback, then
   * apply a noise floor + EMA smoothing so the displayed km/h doesn't
   * flicker when the driver is parked or the GPS jitters.
   */
  const prevPosForSpeedRef = useRef<{ lat: number; lng: number; t: number } | null>(null);
  const smoothedSpeedRef = useRef<number | null>(null);

  const scrollMessagesToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    if (!messagesEndRef.current) return;
    requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({ behavior, block: 'end' });
    });
  }, []);

  const formatMessageTimestamp = (value: string | null | undefined): string => {
    if (!value) return 'Unknown time';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Unknown time';
    return date.toLocaleString('en-GB', {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Dubai',
    });
  };

  const normalizeDeliveryCoords = (delivery: Delivery): LatLng | null => {
    const d = delivery as unknown as Record<string, unknown>;
    const latRaw = d['lat'] ?? d['Lat'] ?? d['latitude'] ?? d['Latitude'];
    const lngRaw = d['lng'] ?? d['Lng'] ?? d['longitude'] ?? d['Longitude'];
    const a = Number.parseFloat(String(latRaw));
    const b = Number.parseFloat(String(lngRaw));
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    // UAE bounding box validation + auto-correct lat/lng swap
    const inUAE = (la: number, lo: number) =>
      la >= 22.0 && la <= 26.5 && lo >= 51.0 && lo <= 56.5;
    if (inUAE(a, b)) return { lat: a, lng: b };
    if (inUAE(b, a)) return { lat: b, lng: a }; // GeoJSON swap — auto-fix
    return null; // outside UAE bounds — skip pin
  };

  const buildNearestNeighborOrder = useCallback((items: Delivery[], start: LatLng): Delivery[] => {
    const remaining = [...items];
    const ordered: Delivery[] = [];
    let current = start;

    while (remaining.length > 0) {
      let bestIndex = 0;
      let bestDistance = Infinity;

      for (let i = 0; i < remaining.length; i += 1) {
        const coords = normalizeDeliveryCoords(remaining[i]);
        if (!coords) continue;
        const distance = calculateDistance(current.lat, current.lng, coords.lat, coords.lng);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestIndex = i;
        }
      }

      const next = remaining.splice(bestIndex, 1)[0];
      ordered.push(next);
      const nextCoords = normalizeDeliveryCoords(next);
      if (nextCoords) current = nextCoords;
    }

    return ordered;
  }, []);

  const formatEta = (eta: string | null | undefined): string => {
    if (!eta) return 'N/A';
    const date = new Date(eta);
    if (Number.isNaN(date.getTime())) return 'N/A';
    return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  };

  /**
   * Relative Dubai-day label for an ETA ISO: "Today" / "Tomorrow" /
   * "Wed, 25 Apr" (further out). Returned separately from the time so
   * the big HH:MM stays glance-readable while the day is explicit.
   * Returns empty string when the ETA is missing or malformed.
   */
  const formatEtaDateLabel = (eta: string | null | undefined): string => {
    if (!eta) return '';
    const d = new Date(eta);
    if (Number.isNaN(d.getTime())) return '';
    const dubaiDayStr = (v: Date): string => {
      const z = new Date(v.toLocaleString('en-US', { timeZone: 'Asia/Dubai' }));
      return `${z.getFullYear()}-${String(z.getMonth() + 1).padStart(2, '0')}-${String(z.getDate()).padStart(2, '0')}`;
    };
    const today = dubaiDayStr(new Date());
    const tomorrow = (() => {
      const t = new Date();
      t.setDate(t.getDate() + 1);
      return dubaiDayStr(t);
    })();
    const target = dubaiDayStr(d);
    if (target === today) return 'Today';
    if (target === tomorrow) return 'Tomorrow';
    return d.toLocaleDateString('en-GB', {
      timeZone: 'Asia/Dubai',
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    });
  };

  const isContactOnline = (contact: ContactUser): boolean => {
    if (!contact?.account?.lastLogin) {
      return false;
    }
    
    const lastActive = new Date(contact.account.lastLogin);
    const now = new Date();
    const diffMinutes = (now.getTime() - lastActive.getTime()) / 1000 / 60;
    const isOnline = diffMinutes < 5; // Consider online if active within 5 minutes
    
    if (isOnline) {
      console.debug(`[Driver] Contact ${contact.fullName || contact.username} online (active ${diffMinutes.toFixed(1)}m ago)`);
    }
    
    return isOnline;
  };

  const clearTrackingWatchers = useCallback(() => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const cleanup = useCallback(() => {
    clearTrackingWatchers();
    if (markerAnimationRef.current !== null) {
      cancelAnimationFrame(markerAnimationRef.current);
      markerAnimationRef.current = null;
    }
    if (mapInstance.current) {
      mapInstance.current.remove();
      mapInstance.current = null;
    }
  }, [clearTrackingWatchers]);

  // Keep isTrackingRef in sync with state
  useEffect(() => {
    isTrackingRef.current = isTracking;
  }, [isTracking]);

  // Keep deliveryStartedAtRef in sync so the routing effect can read it without adding to deps
  useEffect(() => { deliveryStartedAtRef.current = deliveryStartedAt; }, [deliveryStartedAt]);

  useEffect(() => {
    ensureAuth();
    void loadLatestLocation();
    void loadDeliveries();
    void loadContacts();
    void loadNotificationCount();
    const notificationInterval = setInterval(() => {
      if (!document.hidden) void loadNotificationCount();
    }, 60000);
    // Periodic delivery refresh so newly assigned orders appear without manual reload
    const deliveryInterval = setInterval(() => {
      if (!document.hidden) void loadDeliveries();
    }, 30000);
    // Note: ETA refresh is handled by the OSRM routing effect which re-runs on GPS position change.
    // Auto-start GPS when driver logs in – tracking always on
    const t = setTimeout(() => {
      if (navigator.geolocation && !isTrackingRef.current) {
        requestLocationPermission();
      }
    }, 800);
    return () => {
      cleanup();
      clearInterval(notificationInterval);
      clearInterval(deliveryInterval);
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cleanup]);

  useEffect(() => {
    const params = new URLSearchParams(routeLocation.search);
    const tab = params.get('tab');
    if (tab && ['orders', 'messages'].includes(tab)) {
      setActiveTab(tab);
    }
  }, [routeLocation.search]);

  // D1: Immediately refresh deliveries after POD so the delivered item appears without waiting 30s
  useEffect(() => {
    const handlePodUpdate = () => {
      void loadDeliveries();
    };
    window.addEventListener('deliveryStatusUpdated', handlePodUpdate);
    return () => window.removeEventListener('deliveryStatusUpdated', handlePodUpdate);
   
  }, []);

  // Keep refs in sync for use inside routing effect closure without adding to deps
  useEffect(() => { confirmedDeliveriesRef.current = confirmedDeliveries; }, [confirmedDeliveries]);
  useEffect(() => { finishedDeliveriesRef.current = finishedDeliveries; }, [finishedDeliveries]);
  useEffect(() => { pickingStageDeliveriesRef.current = pickingStageDeliveries; }, [pickingStageDeliveries]);

  // Initialize map once
  useEffect(() => {
    if (!mapRef.current || mapInstance.current) return;

    const defaultCenter: [number, number] = [25.0053, 55.0760]; // Dubai warehouse default

    mapInstance.current = L.map(mapRef.current, {
      zoomControl: true,
      attributionControl: false,
    }).setView(defaultCenter, 13);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      minZoom: 10,
    }).addTo(mapInstance.current);

    // Invalidate map size to ensure it fills container properly
    const invalidateMap = () => {
      if (mapInstance.current) {
        mapInstance.current.invalidateSize();
      }
    };
    
    // Invalidate after initial render
    setTimeout(invalidateMap, 100);
    setTimeout(invalidateMap, 500);

    // Handle window resize
    const handleResize = () => {
      invalidateMap();
    };
    window.addEventListener('resize', handleResize);

    setMapReady(true);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (mapInstance.current) {
        mapInstance.current.remove();
        mapInstance.current = null;
        setMapReady(false);
      }
    };
  }, []);

  // Invalidate map size when orders tab is active
  useEffect(() => {
    if (activeTab === 'orders' && mapInstance.current && mapReady) {
      setTimeout(() => {
        if (mapInstance.current) {
          mapInstance.current.invalidateSize();
        }
      }, 100);
    }
  }, [activeTab, mapReady]);

  // Update map when location changes
  useEffect(() => {
    if (!mapInstance.current || !location || !mapReady) return;

    const { latitude, longitude } = location;
    const map = mapInstance.current;
    const targetLatLng = L.latLng(latitude, longitude);

    // Driver truck icon — shared factory so this view and the customer
    // tracking map render the same pin shape.
    const truckTrackingIcon = createDriverMarkerIcon();

    const popupHtml = `
        <div style="font-family: var(--font-sans); font-size: 13px; min-width: 200px;">
          <div style="font-weight: 600; margin-bottom: 8px; color: #1f2937;">Live Truck Location</div>
          <div style="margin-bottom: 4px;"><strong>Coordinates:</strong> ${latitude.toFixed(6)}, ${longitude.toFixed(6)}</div>
          <div style="margin-bottom: 4px;"><strong>Time:</strong> ${new Date(location.timestamp).toLocaleString()}</div>
          ${location.accuracy ? `<div style="margin-bottom: 4px;"><strong>Accuracy:</strong> ±${location.accuracy.toFixed(0)}m</div>` : ''}
          ${location.speed ? `<div><strong>Speed:</strong> ${(location.speed * 3.6).toFixed(1)} km/h</div>` : ''}
        </div>
      `;

    // Create marker once, then smoothly animate to new GPS positions.
    if (!markerRef.current) {
      markerRef.current = L.marker(targetLatLng, { icon: truckTrackingIcon })
        .addTo(map)
        .bindPopup(popupHtml);
    } else {
      markerRef.current.setIcon(truckTrackingIcon);
      markerRef.current.setPopupContent(popupHtml);
      const startLatLng = markerRef.current.getLatLng();
      const durationMs = 1200;
      const startAt = performance.now();

      if (markerAnimationRef.current !== null) {
        cancelAnimationFrame(markerAnimationRef.current);
      }

      const animateMarker = (now: number) => {
        if (!markerRef.current) return;
        const elapsed = now - startAt;
        const t = Math.min(1, elapsed / durationMs);
        // Ease-out interpolation keeps the movement smooth but responsive.
        const ease = 1 - (1 - t) * (1 - t);
        const lat = startLatLng.lat + (targetLatLng.lat - startLatLng.lat) * ease;
        const lng = startLatLng.lng + (targetLatLng.lng - startLatLng.lng) * ease;
        markerRef.current.setLatLng([lat, lng]);
        if (t < 1) {
          markerAnimationRef.current = requestAnimationFrame(animateMarker);
        } else {
          markerAnimationRef.current = null;
        }
      };

      markerAnimationRef.current = requestAnimationFrame(animateMarker);
    }

    // Smooth auto-pan: keep the driver icon on screen.
    // Throttled to avoid jumpy movement on rapid GPS updates.
    const now = Date.now();
    if (now - lastAutoPanAtRef.current > 2000) {
      const mapBounds = map.getBounds();
      const isVisible = mapBounds.contains(targetLatLng);
      if (!isVisible) {
        // Driver has moved off-screen — pan to re-center
        map.panTo(targetLatLng, { animate: true, duration: 1.0 });
      }
      // On first GPS fix (before route), zoom in if too far out
      if (!hasInitialFitRef.current && map.getZoom() < 15) {
        map.setView(targetLatLng, 15, { animate: true });
      }
      lastAutoPanAtRef.current = now;
    }

    // Add location to history
    setLocationHistory(prev => {
      const newHistory = [...prev, location];
      return newHistory.slice(-50); // Keep last 50 locations
    });
  }, [location, mapReady, route]);

  useEffect(() => {
    if (!mapInstance.current || !mapReady) return;

    deliveryMarkersRef.current.forEach((marker) => {
      if (mapInstance.current!.hasLayer(marker)) {
        mapInstance.current!.removeLayer(marker);
      }
    });
    deliveryMarkersRef.current = [];

    // Use orderedDeliveries only when its IDs still match the current deliveries.
    // If deliveries changed (e.g. a stop was completed and removed) but
    // orderedDeliveries hasn't been recalculated yet, fall back to the fresh
    // deliveries list so stale stops never appear on the map.
    const currentIds = new Set(deliveries.map(d => d.id));
    const orderedMatchesCurrent = orderedDeliveries.length > 0
      && orderedDeliveries.length === deliveries.length
      && orderedDeliveries.every(d => currentIds.has(d.id));

    const list: EnrichedDelivery[] = orderedMatchesCurrent
      ? orderedDeliveries
      : (deliveries as EnrichedDelivery[]);

    list.forEach((delivery, index) => {
      const coords = normalizeDeliveryCoords(delivery);
      if (!coords) return;

      // Teal pin for regular stops, red P1 pin for priority — shared factory
      // so admin/logistics see the same visual language when they open the
      // customer tracking map for this stop.
      const stopIcon = createDeliveryIconForDelivery(delivery, { index: index + 1 });
      const marker = L.marker([coords.lat, coords.lng], {
        title: `Stop ${index + 1}: ${delivery.customer || 'Delivery'}`,
        icon: stopIcon,
      })
        .addTo(mapInstance.current!)
        .bindPopup(
          (() => {
            const etaIso = delivery.eta ?? delivery.estimatedEta;
            const etaTime = formatEta(etaIso);
            const etaDate = formatEtaDateLabel(etaIso);
            const etaDisplay = etaDate ? `${etaDate}, ${etaTime}` : etaTime;
            return `<div style="font-family: var(--font-sans); font-size: 12px;">
              <strong>Stop ${index + 1}</strong><br />
              <strong>Customer:</strong> ${delivery.customer || 'N/A'}<br />
              <strong>Address:</strong> ${delivery.address || 'N/A'}<br />
              <strong>ETA:</strong> ${etaDisplay}
            </div>`;
          })(),
          { maxWidth: 260 }
        );

      deliveryMarkersRef.current.push(marker);
    });
  }, [deliveries, orderedDeliveries, mapReady]);

  useEffect(() => {
    if (!mapInstance.current || !mapReady) return;

    routeLayersRef.current.forEach((layer) => {
      if (mapInstance.current!.hasLayer(layer)) {
        mapInstance.current!.removeLayer(layer);
      }
    });
    routeLayersRef.current = [];

    const routeData = route as DriverRouteData | null;
    if (!routeData?.coordinates?.length) return;

    const routeLine = L.polyline(routeData.coordinates as [number, number][], {
      color: '#3b82f6',
      weight: 5,
      opacity: 0.85,
      lineCap: 'round',
      lineJoin: 'round'
    }).addTo(mapInstance.current!);

    routeLayersRef.current.push(routeLine);

    // Only fitBounds on the very first route draw so the driver gets an initial
    // overview. On subsequent route recalculations (GPS movement, refresh) the
    // map stays at the driver's current zoom/pan to avoid disruptive zoom-outs.
    if (!hasInitialFitRef.current) {
      try {
        const bounds = routeLine.getBounds();
        if (bounds.isValid()) {
          mapInstance.current!.fitBounds(bounds, { padding: [50, 50], maxZoom: 15 });
          hasInitialFitRef.current = true;
        }
      } catch (e) {
        console.warn('Unable to fit route bounds:', e);
      }
    }
  }, [route, mapReady]);
  
  // Auto-refresh messages when on messages tab - 30s, pause when hidden
  useEffect(() => {
    if (activeTab === 'messages' && selectedContact) {
      void loadMessages(selectedContact.id, true);
      messagePollingIntervalRef.current = setInterval(() => {
        if (!document.hidden) void loadMessages(selectedContact.id, true);
      }, 30000); // 30s instead of 3s
    }
    
    // Cleanup interval when tab changes or component unmounts
    return () => {
      if (messagePollingIntervalRef.current) {
        clearInterval(messagePollingIntervalRef.current);
        messagePollingIntervalRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, selectedContact]);
  
  // Auto-scroll to bottom when messages change or tab becomes active
  useEffect(() => {
    if (activeTab !== 'messages') return;
    scrollMessagesToBottom('smooth');
  }, [messages, activeTab, scrollMessagesToBottom]);

  useEffect(() => {
    if (deliveries.length === 0) {
      setRoute(null);
      setOrderedDeliveries([]);
      return;
    }

    const origin: LatLng = location
      ? { lat: location.latitude, lng: location.longitude }
      : WAREHOUSE_LOCATION;

    const deliverySignature = deliveries.map(d => {
      const m = (d as unknown as { metadata?: Record<string, unknown> }).metadata ?? {};
      const st = (d.status || '').toLowerCase();
      return `${d.id}:${st}:${m.isPriority ? '1' : '0'}`;
    }).join('|');
    const originMovedKm = lastRouteOriginRef.current
      ? calculateDistance(origin.lat, origin.lng, lastRouteOriginRef.current.lat, lastRouteOriginRef.current.lng)
      : Infinity;
    const deliveriesChanged = deliverySignature !== lastRouteDeliveriesRef.current;

    // When deliveries actually change, reset committed order so we re-optimise
    if (deliveriesChanged) committedOrderRef.current = [];

    // Deviation detector — measure how far the driver has drifted from the
    // existing polyline. If they're more than 250 m off the planned route
    // they've genuinely deviated (wrong turn, traffic detour, etc.) and we
    // need a fresh OSRM call regardless of the time/movement throttles.
    // While they stay within 250 m, periodic recomputes are wasted OSRM
    // calls — the polyline shape doesn't change just because the driver
    // moved 50 m along it.
    const offRouteM = (() => {
      const coords = route?.coordinates;
      if (!coords || coords.length < 2) return 0;
      let minDistM = Infinity;
      for (let i = 0; i < coords.length - 1; i++) {
        const [lat1, lng1] = coords[i];
        const [lat2, lng2] = coords[i + 1];
        const distM = pointToSegmentDistanceMeters(origin.lat, origin.lng, lat1, lng1, lat2, lng2);
        if (distM < minDistM) minDistM = distM;
        if (minDistM < 50) break; // close to the line — early exit
      }
      return minDistM === Infinity ? 0 : minDistM;
    })();
    const offRoute = offRouteM > 250;

    // Time throttle: 30 s minimum between recomputes (was 10 s — too noisy
    // for city driving where the driver hits the movement gate every few
    // seconds). Bypassed on delivery-set changes or off-route.
    const MIN_RECALC_INTERVAL_MS = 30000;
    const sinceLastRecalcMs = Date.now() - lastRouteAtRef.current;
    if (!deliveriesChanged && !offRoute && route && sinceLastRecalcMs < MIN_RECALC_INTERVAL_MS) {
      return;
    }

    // Movement gate: require ≥ 150 m of straight-line origin movement (was
    // 20 m). Below that the driver is still on the same stretch of the
    // existing polyline and a recompute returns essentially the same
    // shape — wasted OSRM call + visible polyline jitter.
    if (!deliveriesChanged && !offRoute && originMovedKm < 0.15 && route) {
      return;
    }

    // Foreground vs background: show the "Routing…" badge only when the
    // recompute is meaningful — first calc, delivery-set change, or
    // genuine off-route. Routine periodic refreshes happen silently so
    // the status badge doesn't flicker every 30 s while driving.
    const isBackgroundRefresh = !!route && !deliveriesChanged && !offRoute;

    // Priority is owned by Delivery Team / Admin via metadata.isPriority.
    // Manual priority bubbles to the front; everything else keeps its distance-based order.
    const sortByPriority = (arr: Delivery[]) => {
      const score = (d: Delivery): number => {
        const m = (d as unknown as { metadata?: Record<string, unknown> }).metadata ?? {};
        return m.isPriority === true ? 0 : 1;
      };
      return [...arr].sort((a, b) => score(a) - score(b));
    };

    const withCoords = sortByPriority(deliveries.filter(d => normalizeDeliveryCoords(d)));
    const withoutCoords = deliveries.filter(d => !normalizeDeliveryCoords(d));
    // If driver manually reordered, respect their order; otherwise use nearest-neighbour optimisation.
    // After first OSRM calc, re-use committed order on GPS movement to prevent stop-order jumping.
    const orderedWithCoords = manuallyOrderedRef.current
      ? withCoords
      : committedOrderRef.current.length > 0 && !deliveriesChanged
          // Use committed order on GPS movement — prevents stop-order jumping
          ? committedOrderRef.current.filter(d => normalizeDeliveryCoords(d))
          : buildNearestNeighborOrder(withCoords, origin);
    const routeLocations = [origin, ...orderedWithCoords.map(d => normalizeDeliveryCoords(d)!).filter(Boolean)];

    if (routeLocations.length < 2) {
      setRoute(null);
      const snap = useDeliveryStore.getState().deliveries;
      const snapById = new Map(snap.map(d => [String(d.id), d as Record<string, unknown>]));
      const fallback = [...orderedWithCoords, ...withoutCoords].map((d) => {
        const st = snapById.get(String(d.id));
        return {
          ...(st ?? {}),
          ...d,
          ...authoritativeFieldsFromStore(st),
        } as EnrichedDelivery;
      });
      setOrderedDeliveries(fallback);
      const fbIds = new Set(fallback.map(d => d.id));
      const pickingNoDupes = pickingStageDeliveriesRef.current.filter(d => !fbIds.has(d.id));
      updateDeliveryOrder([...fallback, ...pickingNoDupes, ...confirmedDeliveriesRef.current, ...finishedDeliveriesRef.current]);
      return;
    }

    if (!isBackgroundRefresh) setIsRouteLoading(true);
    setRouteError(null);

    calculateRouteWithOSRM(routeLocations)
      .then((routeData) => {
        setRoute(routeData as unknown as DriverRouteData);
        const legs = (routeData.legs || []) as Array<{ duration?: number; distance?: number }>;
        let cumulativeSeconds = 0;
        let cumulativeMeters = 0;
        const baseTime = Date.now();

        // Look up current store deliveries so we can preserve priority and plannedEta
        // that were assigned by loadDeliveries but are not returned by the API.
        const storeDeliveries = useDeliveryStore.getState().deliveries;
        const storeById = new Map(storeDeliveries.map(d => [String(d.id), d as Record<string, unknown>]));

        // D3: 60-min service time per stop (30min install + 30min delivery)
        const SERVICE_TIME_SEC = 60 * 60; // 3600 s

        // Planned ETA anchor: 08:00 Dubai on each delivery's *own* delivery date.
        // Priority: confirmedDeliveryDate (customer reply / manual reschedule) >
        // goodsMovementDate (warehouse PGI day) > today's date as last resort.
        // Reading Y/M/D in Asia/Dubai TZ avoids the off-by-one when a date stored
        // as 2026-04-29T20:00:00Z (= 30 Apr Dubai) gets read as 29 Apr UTC.
        const DUBAI_OFFSET_H = 4;
        const planned8amTodayMs = (() => {
          const parts = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Dubai',
            year: 'numeric', month: '2-digit', day: '2-digit',
          }).format(new Date()).split('-');
          return Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]), 8 - DUBAI_OFFSET_H, 0, 0, 0);
        })();
        const plannedBaseFor = (d: Record<string, unknown>): number => {
          const cdd = d.confirmedDeliveryDate as string | Date | null | undefined;
          const gmd = d.goodsMovementDate as string | Date | null | undefined;
          const raw = cdd ?? gmd ?? null;
          if (!raw) return planned8amTodayMs;
          const dt = raw instanceof Date ? raw : new Date(String(raw));
          if (isNaN(dt.getTime())) return planned8amTodayMs;
          const parts = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Dubai',
            year: 'numeric', month: '2-digit', day: '2-digit',
          }).format(dt).split('-');
          return Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]), 8 - DUBAI_OFFSET_H, 0, 0, 0);
        };

        // D4: If "Start Delivery" was clicked, staticEta base is deliveryStartedAtRef.current;
        // otherwise fall back to the current baseTime (route first calculated = now).
        const staticBaseTime = deliveryStartedAtRef.current ?? baseTime;

        const enriched: EnrichedDelivery[] = orderedWithCoords.map((delivery, index) => {
          cumulativeSeconds += legs[index]?.duration || 0;
          cumulativeMeters += legs[index]?.distance || 0;
          const stopCoords = normalizeDeliveryCoords(delivery);
          const fallbackDistanceKm = stopCoords
            ? calculateDistance(origin.lat, origin.lng, stopCoords.lat, stopCoords.lng)
            : null;

          const inStore = storeById.get(String(delivery.id));
          const auth = authoritativeFieldsFromStore(inStore);
          const rowForPlanning: Record<string, unknown> = {
            ...(inStore ?? {}),
            ...delivery,
            ...auth,
          };
          const plannedDayMs = plannedBaseFor(rowForPlanning);

          // Plan-ETA anchor: max(deliveryDate @ 08:00, picking.confirmedAt).
          // Mirrors the ETD rule in src/utils/etd.ts. For an urgent same-day order
          // picked up after 08:00, the pickup time wins so Plan ETA reflects the
          // actual departure (e.g., picked at 17:28 → Plan starts ~17:28, not 08:00).
          // For a future-day delivery that's been picked early, pickup.confirmedAt
          // < tomorrow @ 08:00, so the 08:00 anchor still wins — unchanged behavior.
          const plannedAnchorMs = (() => {
            const meta = rowForPlanning.metadata as Record<string, unknown> | null | undefined;
            const picking = meta?.picking as { confirmedAt?: string } | null | undefined;
            const raw = picking?.confirmedAt;
            if (typeof raw !== 'string') return plannedDayMs;
            const ms = new Date(raw).getTime();
            return !isNaN(ms) && ms > plannedDayMs ? ms : plannedDayMs;
          })();

          // Dynamic ETA: pure driving time from current GPS position.
          // For pickup-confirmed orders dated on a future Dubai day, anchor to
          // that day's 08:00 instead of `now` — otherwise the orange chip
          // shows "ETA Today, 07:39" on a tomorrow's order and confuses the
          // driver. Today-flow statuses (out-for-delivery, in-transit, and
          // today's pickup-confirmed) keep `now` as the anchor — that's what
          // makes the GPS-based estimate "live".
          const status = (delivery.status || '').toLowerCase();
          const isPickupConfirmed = status === 'pickup-confirmed' || status === 'pickup_confirmed';
          const liveBaseTime = isPickupConfirmed && plannedDayMs > planned8amTodayMs
            ? plannedDayMs
            : baseTime;
          const computedEta = new Date(liveBaseTime + cumulativeSeconds * 1000).toISOString();
          // Static ETA (D3): driving time + 60-min service × stops completed before this one
          const staticComputedEta = new Date(
            staticBaseTime + cumulativeSeconds * 1000 + index * SERVICE_TIME_SEC * 1000
          ).toISOString();

          // Planned ETA: anchored at max(deliveryDay @ 08:00, picking.confirmedAt)
          // + cumulative drive time + service time per stop (queue position
          // determines hour). Urgent same-day picks anchor to the pickup moment
          // rather than 08:00; future-day picks still anchor to 08:00.
          const planned8amEta = new Date(
            plannedAnchorMs
              + cumulativeSeconds * 1000
              + index * SERVICE_TIME_SEC * 1000
          ).toISOString();

          const persisted = persistedEtasRef.current[String(delivery.id)];
          // plannedEta: anchored to max(deliveryDate @ 08:00 Dubai, picking.confirmedAt).
          // Recomputed each route update so a reschedule (which changes
          // confirmedDeliveryDate) or an urgent late-day pickup flows through
          // immediately, instead of carrying forward a stale anchor from a prior compute.
          // staticEta is locked when "Start Delivery" is clicked; once set, never change.
          const existingStaticEta =
            (inStore?.['staticEta'] as string | null | undefined)
            ?? persisted?.staticEta
            ?? null;
          const newStaticEta = deliveryStartedAtRef.current
            ? (existingStaticEta ?? staticComputedEta)
            : null;
          return {
            ...(inStore ?? {}),
            ...delivery,
            ...auth,
            routeIndex: index + 1,
            estimatedEta: computedEta,
            plannedEta: planned8amEta,
            staticEta: newStaticEta,
            distanceFromDriverKm: cumulativeMeters > 0 ? cumulativeMeters / 1000 : (fallbackDistanceKm ?? undefined)
          };
        });

        const trailing: EnrichedDelivery[] = withoutCoords.map((delivery, index) => {
          const inStore = storeById.get(String(delivery.id));
          const auth = authoritativeFieldsFromStore(inStore);
          return {
            ...(inStore ?? {}),
            ...delivery,
            ...auth,
            routeIndex: enriched.length + index + 1,
            estimatedEta: (delivery as EnrichedDelivery).eta || null,
            distanceFromDriverKm: undefined
          };
        });

        const final = [...enriched, ...trailing];
        setOrderedDeliveries(final);
        // Merge enriched on-route items with picking-stage+confirmed+finished so the store has all delivery types.
        // Exclude pickup-confirmed from pickingStage since they're already enriched in `final`.
        const finalIds = new Set(final.map(d => d.id));
        const pickingWithoutDupes = pickingStageDeliveriesRef.current.filter(d => !finalIds.has(d.id));
        updateDeliveryOrder([...final, ...pickingWithoutDupes, ...confirmedDeliveriesRef.current, ...finishedDeliveriesRef.current]);
        // Commit the order if this was a fresh optimisation (not just a GPS position update reusing existing order)
        if (committedOrderRef.current.length === 0 || deliveriesChanged) {
          committedOrderRef.current = orderedWithCoords;
        }
        lastRouteOriginRef.current = origin;
        lastRouteDeliveriesRef.current = deliverySignature;
        // Stamp the throttle timer only on a successful OSRM recompute — a
        // failed route (caught below) should not block the next retry for 15 s.
        lastRouteAtRef.current = Date.now();

        // Persist the now-locked planned/static ETAs + startedAt so a re-login
        // restores the exact same schedule without recomputing from scratch.
        const nextPersisted: Record<string, PersistedEta> = {};
        for (const d of final) {
          if (!d.id) continue;
          if (d.plannedEta || d.staticEta) {
            nextPersisted[String(d.id)] = {
              plannedEta: d.plannedEta ?? null,
              staticEta: d.staticEta ?? null,
            };
          }
        }
        persistedEtasRef.current = nextPersisted;
        saveRouteState(driverStorageIdRef.current, {
          startedAt: deliveryStartedAtRef.current,
          etas: nextPersisted,
        });

        // Push the freshly-computed Plan ETA to the server so the customer
        // tracking page can show the driver's REAL arrival estimate
        // (e.g. "16:06 today") instead of the generic noon-Dubai fallback.
        //
        // Used to be gated on `deliveryStartedAtRef.current` — i.e. only
        // synced after the driver tapped "Start Delivery". That button was
        // removed in favour of auto-dispatch, so the gate stopped the
        // sync from ever firing and metadata.plannedEta stayed null →
        // customer tracking fell through to the noon fallback. Removing
        // the gate makes the sync run on every routing recompute (GPS
        // movement, store change, drag-reorder), de-duped via syncKey so
        // we don't hammer the backend when nothing actually changed.
        //
        // Targets the new /route/sync-eta endpoint (NOT /route/start) so
        // status / assignment / SMS are untouched — this is a routine
        // metadata write, not a dispatch action.
        if (Object.keys(nextPersisted).length > 0) {
          const syncKey = JSON.stringify(
            Object.entries(nextPersisted).sort().map(([id, e]) => `${id}:${e.plannedEta || ''}:${e.staticEta || ''}`),
          );
          if (syncKey !== lastBackendEtaSyncRef.current) {
            lastBackendEtaSyncRef.current = syncKey;
            const stopsForServer = Object.entries(nextPersisted).map(([deliveryId, e]) => ({
              deliveryId,
              plannedEta: e.plannedEta,
              staticEta: e.staticEta,
            }));
            api.post('/deliveries/driver/route/sync-eta', {
              stops: stopsForServer,
            }).catch((err: unknown) => {
              console.warn('[DriverPortal] route/sync-eta failed:', (err as Error).message);
            });
          }
        }
      })
      .catch((routeErr: unknown) => {
        console.error('Failed to calculate driver route:', routeErr);
        setRoute(null);
        setRouteError('Routing unavailable');
        const snap = useDeliveryStore.getState().deliveries;
        const snapById = new Map(snap.map(d => [String(d.id), d as Record<string, unknown>]));
        const fallback = [...orderedWithCoords, ...withoutCoords].map((d) => {
          const st = snapById.get(String(d.id));
          return {
            ...(st ?? {}),
            ...d,
            ...authoritativeFieldsFromStore(st),
          } as EnrichedDelivery;
        });
        setOrderedDeliveries(fallback);
        const fbIds2 = new Set(fallback.map(d => d.id));
        const pickingNoDupes2 = pickingStageDeliveriesRef.current.filter(d => !fbIds2.has(d.id));
        updateDeliveryOrder([...fallback, ...pickingNoDupes2, ...confirmedDeliveriesRef.current, ...finishedDeliveriesRef.current]);
      })
      .finally(() => {
        setIsRouteLoading(false);
      });
  }, [deliveries, location, buildNearestNeighborOrder, updateDeliveryOrder]);

  const loadLatestLocation = async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.get('/driver/me/live').catch(() => null);
      if (response && response.data) {
        setLocation({
          latitude: response.data.latitude as number,
          longitude: response.data.longitude as number,
          timestamp: (response.data.recorded_at as string) || new Date().toISOString(),
          accuracy: (response.data.accuracy as number | null) || null,
          speed: (response.data.speed as number | null) || null,
          heading: null,
        });
      }
    } catch (e: unknown) {
      console.error('Error loading latest location:', e);
      setError('Failed to load latest location. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const loadDeliveries = async (): Promise<void> => {
    const seq = ++loadDeliveriesSeqRef.current;
    setLoadingDeliveries(true);
    // Reset so routing effect recalculates from scratch on every fresh load (prevents stale route on re-login)
    lastRouteDeliveriesRef.current = '';
    try {
      // Fetch active and finished deliveries in parallel
      const [activeRes, finishedRes] = await Promise.all([
        api.get('/driver/deliveries'),
        api.get('/driver/deliveries/finished').catch(() => ({ data: { deliveries: [] } })),
      ]);
      if (seq !== loadDeliveriesSeqRef.current) return;

      const activeDeliveries = (activeRes.data?.deliveries as Delivery[]) || [];
      const fetchedFinished = (finishedRes.data?.deliveries as Delivery[]) || [];

      // Categorise active deliveries into on-route vs confirmed-pending vs picking-stage
      const onRoute = getOnRouteDeliveriesForList(activeDeliveries);
      const confirmed = activeDeliveries.filter((d) => {
        const s = (d.status || '').toLowerCase();
        return s === 'confirmed' || s === 'scheduled-confirmed';
      });
      const pickingStage = activeDeliveries.filter((d) => {
        const s = (d.status || '').toLowerCase();
        return s === 'pgi-done' || s === 'pgi_done' || s === 'rescheduled'
          || s === 'pickup-confirmed' || s === 'pickup_confirmed';
      });

      // Persist lists so tab-switching can reload store without an extra API call
      setOnRouteDeliveries(onRoute);
      setConfirmedDeliveries(confirmed);
      setFinishedDeliveries(fetchedFinished);
      setPickingStageDeliveries(pickingStage);

      // Reset manual drag state on a full refresh — a dedicated useEffect
      // below keeps the map's `deliveries` state in sync with whichever chip
      // the driver has selected on the list (Today Delivery, Pickup Confirmed,
      // On Time, Delayed, etc). That effect reads from the store, so we only
      // need to hydrate the store here.
      manuallyOrderedRef.current = false;
      userOrderRef.current = [];

      // Load EVERY active delivery into the store (not just on-route + confirmed)
      // so the Picking List tab can see pgi-done / pickup-confirmed / rescheduled
      // rows, and the unified My Orders table can filter across any status chip.
      useDeliveryStore.getState().loadDeliveries([...activeDeliveries, ...fetchedFinished]);

      const pickingStageCount = activeDeliveries.filter((d) => {
        const s = (d.status || '').toLowerCase();
        return s === 'pgi-done' || s === 'pgi_done' || s === 'rescheduled' || s === 'pickup-confirmed' || s === 'pickup_confirmed';
      }).length;
      console.log(`✓ Loaded ${activeDeliveries.length} active (${onRoute.length} on-route, ${confirmed.length} confirmed, ${pickingStageCount} picking-stage) + ${fetchedFinished.length} finished`);
    } catch (deliveryErr: unknown) {
      console.error('Failed to load deliveries:', deliveryErr);
      if (seq === loadDeliveriesSeqRef.current) {
        setDeliveries([]);
      }
    } finally {
      if (seq === loadDeliveriesSeqRef.current) {
        setLoadingDeliveries(false);
      }
    }
  };

  const loadContacts = async (): Promise<void> => {
    try {
      setLoadingContacts(true);
      const response = await api.get('/messages/contacts');
      const allContacts = (response.data?.contacts || []) as ContactUser[];
      // Separate team members (admin, delivery_team) from drivers
      const team = allContacts.filter(c => c.account?.role === 'admin' || c.account?.role === 'delivery_team');
      setTeamMembers(team);
      setContacts(allContacts);
      // Auto-select the contact with the most recent message; fall back to first
      if (!selectedContact && allContacts.length > 0) {
        try {
          const msgResp = await api.get('/messages/driver');
          const recentMsgs = (msgResp.data?.messages || []) as DriverMessage[];
          if (recentMsgs.length > 0) {
            const lastMsg = recentMsgs[recentMsgs.length - 1];
            const recentAdminId = lastMsg.adminId as string | undefined;
            const matched = recentAdminId ? allContacts.find(c => c.id === recentAdminId) : undefined;
            setSelectedContact(matched ?? allContacts[0]);
          } else {
            setSelectedContact(allContacts[0]);
          }
        } catch {
          setSelectedContact(allContacts[0]);
        }
      }
    } catch (contactErr: unknown) {
      console.error('Failed to load contacts:', contactErr);
      setContacts([]);
      setTeamMembers([]);
    } finally {
      setLoadingContacts(false);
    }
  };

  const loadMessages = async (contactId: string | null = null, silent = false): Promise<void> => {
    const targetContactId = contactId || selectedContact?.id;
    if (!targetContactId) return;
    
    if (!silent) setLoadingMessages(true);
    try {
      const response = await api.get(`/messages/driver/${targetContactId}`);
      setMessages((response.data?.messages || []) as DriverMessage[]);
      void loadNotificationCount();
      if (!silent) console.log(`✓ Loaded ${response.data?.messages?.length || 0} messages`);
    } catch (msgErr: unknown) {
      if (!silent) console.error('Failed to load messages:', msgErr);
      setMessages([]);
    } finally {
      if (!silent) setLoadingMessages(false);
    }
  };

  const loadNotificationCount = async (): Promise<void> => {
    try {
      const response = await api.get('/messages/driver/notifications/count');
      setNotifications((response.data?.count as number) || 0);
    } catch (notifErr: unknown) {
      console.error('Failed to load notification count:', notifErr);
    }
  };

  const handleSendMessage = async (): Promise<void> => {
    if ((!newMessage.trim() && !attachmentPreview) || !selectedContact) return;

    const messageText = newMessage.trim();
    setSendingMessage(true);

    try {
      const payload: Record<string, string> = {
        recipientId: selectedContact.id
      };
      if (messageText) payload.content = messageText;
      if (attachmentPreview) {
        payload.attachmentUrl = attachmentPreview.url;
        payload.attachmentType = attachmentPreview.type;
        payload.attachmentName = attachmentPreview.name;
      }

      const response = await api.post('/messages/driver/send', payload);

      if (response.data?.message) {
        const apiMsg = response.data.message as DriverMessage;
        setMessages(prev => [...prev, {
          ...apiMsg,
          from: 'driver',
          senderRole: 'driver',
          text: apiMsg.content
        }]);
        console.log('✓ Message sent successfully');
      }

      setNewMessage('');
      setAttachmentPreview(null);
    } catch (sendErr: unknown) {
      const e = sendErr as { message?: string; response?: { data?: { error?: string } } };
      console.error('Failed to send message:', sendErr);
      alert(`Failed to send message: ${e.response?.data?.error || e.message}`);
    } finally {
      setSendingMessage(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0];
    if (!file) return;
    const MAX_SIZE = 5 * 1024 * 1024; // 5 MB
    if (file.size > MAX_SIZE) {
      alert('File is too large. Maximum size is 5 MB.');
      e.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setAttachmentPreview({
        url: reader.result as string,
        type: file.type,
        name: file.name
      });
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  /**
   * Returns the effective speed (m/s) for a fresh GPS sample. Trusts the
   * browser's `coords.speed` whenever it is a finite, non-negative number;
   * otherwise computes speed from the position delta against the previous
   * sample, with a 5 m noise floor (decays toward zero so a parked driver
   * eventually shows 0 km/h) and a 0.4 EMA so successive readings don't
   * jump around. Returns null only on the very first call when no previous
   * sample is available and the browser declined to provide a value.
   */
  const enrichSpeed = useCallback((lat: number, lng: number, tMs: number, browserSpeed: number | null): number | null => {
    if (browserSpeed != null && Number.isFinite(browserSpeed) && browserSpeed >= 0) {
      smoothedSpeedRef.current = browserSpeed;
      prevPosForSpeedRef.current = { lat, lng, t: tMs };
      return browserSpeed;
    }
    const prev = prevPosForSpeedRef.current;
    prevPosForSpeedRef.current = { lat, lng, t: tMs };
    if (!prev) return smoothedSpeedRef.current;
    const dtSec = (tMs - prev.t) / 1000;
    if (dtSec < 0.5) return smoothedSpeedRef.current;
    if (dtSec > 30) return null; // gap too long — sample is stale
    const distanceM = calculateDistance(prev.lat, prev.lng, lat, lng) * 1000;
    if (distanceM < 5) {
      // Within typical GPS jitter — decay toward zero so a parked driver returns to 0 km/h
      smoothedSpeedRef.current = (smoothedSpeedRef.current ?? 0) * 0.5;
      return smoothedSpeedRef.current;
    }
    const rawMps = Math.min(distanceM / dtSec, 70); // cap at ~250 km/h to swallow GPS jumps
    const prevSmoothed = smoothedSpeedRef.current ?? rawMps;
    const smoothed = 0.4 * rawMps + 0.6 * prevSmoothed;
    smoothedSpeedRef.current = smoothed;
    return smoothed;
  }, []);

  const sendLocationToServer = useCallback(async (locationData: LocationData): Promise<void> => {
    try {
      await api.post('/driver/me/location', {
        latitude: locationData.latitude,
        longitude: locationData.longitude,
        heading: locationData.heading || null,
        speed: locationData.speed || null,
        accuracy: locationData.accuracy || null,
        recorded_at: locationData.timestamp
      });
    } catch (e: unknown) {
      console.error('Error sending location to server:', e);
      // Don't show error to user for background sync failures
    }
  }, []);

  const startTracking = useCallback(() => {
    if (!navigator.geolocation) {
      setError('Geolocation is not supported by your browser. Please use a modern browser.');
      return;
    }

    clearTrackingWatchers();
    setError(null);
    setIsTracking(true);
    setLoading(true);

    // Balanced defaults: high-accuracy GPS can time out on desktop/indoors.
    const watchOptions: PositionOptions = {
      enableHighAccuracy: true,
      timeout: 30000,
      maximumAge: 10000
    };

    // Watch position for real-time updates
    watchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
        const { latitude, longitude, accuracy, heading, speed } = position.coords;
        const tsMs = Date.now();
        const newLocation: LocationData = {
          latitude,
          longitude,
          accuracy: accuracy || null,
          heading: heading || null,
          speed: enrichSpeed(latitude, longitude, tsMs, speed),
          timestamp: new Date(tsMs).toISOString()
        };

        setLocation(newLocation);
        setLoading(false);
        void sendLocationToServer(newLocation);
      },
      (err: GeolocationPositionError) => {
        console.error('Geolocation error:', err);
        let errorMessage = 'Location tracking error: ';
        switch (err.code) {
          case err.PERMISSION_DENIED:
            errorMessage += 'Permission denied. Please enable location access in your browser settings.';
            setIsTracking(false);
            break;
          case err.POSITION_UNAVAILABLE:
            errorMessage += 'Location unavailable. Please check your device settings.';
            setIsTracking(false);
            break;
          case err.TIMEOUT:
            errorMessage += 'Location update timed out. Retrying automatically...';
            break;
          default:
            errorMessage += err.message;
        }
        setError(errorMessage);
        setLoading(false);
      },
      watchOptions
    );

    // Periodic backup location sync every 30 seconds
    intervalRef.current = setInterval(() => {
      if (!isTrackingRef.current) {
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
        return;
      }

      navigator.geolocation.getCurrentPosition(
        (position) => {
          const { latitude, longitude, accuracy, heading, speed } = position.coords;
          const locationData: LocationData = {
            latitude,
            longitude,
            accuracy: accuracy || null,
            heading: heading || null,
            speed: speed || null,
            timestamp: new Date().toISOString()
          };
          void sendLocationToServer(locationData);
        },
        (err: GeolocationPositionError) => console.error('Periodic location error:', err),
        {
          enableHighAccuracy: false,
          timeout: 30000,
          maximumAge: 60000
        }
      );
    }, 30000);
  }, [clearTrackingWatchers, sendLocationToServer, enrichSpeed]);

  const stopTracking = useCallback(() => {
    clearTrackingWatchers();
    setIsTracking(false);
    setLoading(false);
  }, [clearTrackingWatchers]);

  const requestLocationPermission = (): void => {
    if (!navigator.geolocation) {
      setError('Geolocation is not supported by your browser');
      return;
    }

    setLoading(true);
    navigator.geolocation.getCurrentPosition(
      () => {
        setError(null);
        setLoading(false);
        startTracking();
      },
      (err: GeolocationPositionError) => {
        let errorMessage = 'Location access error: ';
        switch (err.code) {
          case err.PERMISSION_DENIED:
            errorMessage += 'Please enable location services in your browser settings.';
            break;
          case err.POSITION_UNAVAILABLE:
            errorMessage += 'Location unavailable. Please check your device.';
            break;
          case err.TIMEOUT:
            errorMessage += 'Request timed out. Please try again in an open area or disable strict GPS mode on your device.';
            break;
          default:
            errorMessage += err.message;
        }
        setError(errorMessage);
        setLoading(false);
      },
      { enableHighAccuracy: false, timeout: 30000, maximumAge: 60000 }
    );
  };

  /**
   * Auto-arrival SMS trigger.
   *
   * Rationale: sometimes a delivery's geocoded pin lands a few hundred metres
   * off the real doorway (low-quality Nominatim match, POI vs street, etc.)
   * — see geocodingService. So we don't require the driver to sit exactly on
   * the pin; instead we fire a one-time "driver is arriving shortly" SMS when
   * the GPS comes within 2 km of the stop.
   *
   * Idempotency is enforced three ways:
   *  - in-memory Set so we don't spam within the same tab session
   *  - metadata.arrivalNotifiedAt check so reload-then-re-enter-zone is safe
   *  - the server endpoint itself rejects a second send with alreadyNotified=true
   */
  const ARRIVAL_RADIUS_KM = 2;
  const autoArrivalSentRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!location || !deliveries.length) return;
    const driverLat = location.latitude;
    const driverLng = location.longitude;
    if (!isFinite(driverLat) || !isFinite(driverLng)) return;

    deliveries.forEach((d) => {
      if (!d.id || !d.phone) return;
      const status = (d.status || '').toLowerCase();
      if (!['out-for-delivery', 'in-transit', 'in-progress'].includes(status)) return;

      const meta = (d.metadata as { arrivalNotifiedAt?: string } | null | undefined) || null;
      if (meta?.arrivalNotifiedAt) return;                     // already sent (persisted)
      if (autoArrivalSentRef.current.has(String(d.id))) return; // already firing in this session

      const dLat = typeof d.lat === 'number' ? d.lat : parseFloat(String(d.lat));
      const dLng = typeof d.lng === 'number' ? d.lng : parseFloat(String(d.lng));
      if (!isFinite(dLat) || !isFinite(dLng)) return;

      const distanceKm = calculateDistance(driverLat, driverLng, dLat, dLng);
      if (distanceKm > ARRIVAL_RADIUS_KM) return;

      // Claim the slot synchronously before the network call so a second
      // effect run (GPS fires frequently) can't double-fire while we're awaiting.
      autoArrivalSentRef.current.add(String(d.id));
      (async () => {
        try {
          const res = await api.post(
            `/deliveries/${encodeURIComponent(String(d.id))}/notify-arrival`,
            { trigger: 'auto_2km_proximity', distanceKm: Number(distanceKm.toFixed(3)) },
          );
          const data = res.data as { ok?: boolean; arrivalNotifiedAt?: string; alreadyNotified?: boolean };
          if (data?.ok && data.arrivalNotifiedAt) {
            // Mirror the flag into the store so the card instantly shows "Customer Notified"
            updateDeliveryStatus(String(d.id), d.status || '', {
              metadata: {
                ...((d.metadata as Record<string, unknown>) || {}),
                arrivalNotifiedAt: data.arrivalNotifiedAt,
                arrivalNotifiedTrigger: 'auto_2km_proximity',
              } as Delivery['metadata'],
            });
            if (!data.alreadyNotified) {
              success(`Arrival SMS sent — ${d.customer || 'customer'} (${distanceKm.toFixed(1)} km)`);
            }
          }
        } catch (err) {
          // On failure, drop the slot so a later GPS tick retries
          autoArrivalSentRef.current.delete(String(d.id));
          console.warn('[DriverPortal] Auto-arrival notify failed for', d.id, err);
        }
      })();
    });
  }, [location, deliveries, updateDeliveryStatus, success]);

  // Start Delivery button removed — dispatch is now automatic on picking confirm
  // when the delivery date matches today (server-side in picking/confirm endpoint).

  const hasRoute = !!(route as DriverRouteData | null)?.coordinates?.length;
  const routeStats = route as DriverRouteData | null;
  const nextStop = (orderedDeliveries[0] || deliveries[0]) as EnrichedDelivery | undefined;
  const nextEtaIso = nextStop?.eta ?? nextStop?.estimatedEta ?? null;
  const nextPlannedEtaIso = nextStop?.plannedEta ?? nextStop?.staticEta ?? nextStop?.estimatedEta ?? null;
  const nextLiveEtaIso = nextStop?.estimatedEta ?? nextStop?.eta ?? null;
  const nextEta = nextStop ? formatEta(nextEtaIso) : 'N/A';
  // Planned ETA: first route calculation (never changes) — shows baseline before/after Start Delivery
  const nextPlannedEta = nextStop ? formatEta(nextPlannedEtaIso) : 'N/A';
  // Live ETA: current GPS-based estimate (updates as driver moves)
  const nextLiveEta = nextStop ? formatEta(nextLiveEtaIso) : 'N/A';
  // Date labels for the same ETAs so driver knows "today / tomorrow / Wed 25 Apr"
  // and doesn't confuse an evening route with a next-morning departure.
  const nextEtaDate = nextStop ? formatEtaDateLabel(nextEtaIso) : '';
  const nextPlannedEtaDate = nextStop ? formatEtaDateLabel(nextPlannedEtaIso) : '';
  const nextLiveEtaDate = nextStop ? formatEtaDateLabel(nextLiveEtaIso) : '';
  const speedKmh = location?.speed != null ? (location.speed * 3.6).toFixed(1) : 'N/A';

  return (
    <div className="space-y-3 md:space-y-5 w-full min-w-0">
      {/* Header Section - responsive and touch-friendly */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl sm:text-3xl font-bold text-gray-900 dark:text-gray-100">Driver Portal</h1>
            <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 mt-0.5">Your orders, route, and POD — GPS on when logged in</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            {notifications > 0 && (
              <div className="flex items-center gap-2 px-3 py-2.5 min-h-[44px] bg-red-50 text-red-700 rounded-lg border border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-800 touch-manipulation">
                <Bell className="w-4 h-4 flex-shrink-0" />
                <span className="text-sm font-semibold">{notifications}</span>
              </div>
            )}
          </div>
      </div>

      {/* Tab Navigation - Orders (map+list) and Messages */}
      <div className="pp-sticky-tab-rail pp-card px-2 py-2 mt-0 mb-3 md:mb-4 overflow-x-auto">
        <nav className="flex flex-nowrap gap-2 min-w-max md:min-w-0">
          {[
            { id: 'orders', label: 'My Orders', icon: ClipboardList },
            { id: 'picking', label: 'Picking List', icon: PackageCheck },
            { id: 'messages', label: 'Messages', icon: MessageSquare },
          ].map(tab => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`pp-nav-pill min-h-[46px] px-4 touch-manipulation ${activeTab === tab.id ? 'active' : ''}`}
              >
                <Icon className="w-5 h-5" />
                {tab.label}
                {tab.id === 'orders' && (() => {
                  // Count from the store (contains every active status) — the local
                  // `deliveries` state is narrowed to on-route for the map, so it
                  // would under-count anything already in motion.
                  const onRouteCount = storeDeliveries.filter(d => isOnRouteDeliveryListStatus((d.status || '').toLowerCase())).length;
                  return onRouteCount > 0 ? (
                    <span className="ml-2 bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 text-xs font-semibold px-2 py-0.5 rounded-full">
                      {onRouteCount}
                    </span>
                  ) : null;
                })()}
                {tab.id === 'picking' && (() => {
                  // Must read from storeDeliveries: the local `deliveries` state is
                  // on-route-only, so it will never contain pgi-done / rescheduled
                  // rows that belong on the picking list.
                  const pickingCount = storeDeliveries.filter(d => isPickingListEligible(d)).length;
                  return pickingCount > 0 ? (
                    <span className="ml-2 bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 text-xs font-semibold px-2 py-0.5 rounded-full">
                      {pickingCount}
                    </span>
                  ) : null;
                })()}
                {tab.id === 'messages' && notifications > 0 && (
                  <span className="ml-2 bg-red-500 text-white text-xs rounded-full px-2 py-0.5">
                    {notifications}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Tab content — kept mounted to prevent Leaflet map teardown */}
      <div>

      {/* Orders Tab - map + order list (POD, customer contact, route) */}
      <div className={`space-y-4 md:space-y-6${activeTab !== 'orders' ? ' hidden' : ''}`}>
          {/* Error Message */}
          {error && (
            <div className="bg-red-50 border-l-4 border-red-400 rounded-lg p-4 shadow-sm dark:bg-red-900/20 dark:border-red-600">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-300 mt-0.5 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-red-800 dark:text-red-200 font-semibold mb-1">GPS error</div>
                  <div className="text-red-700 dark:text-red-300 text-sm">{error}</div>
                  <button
                    onClick={requestLocationPermission}
                    className="mt-2 text-sm font-medium text-red-700 dark:text-red-300 hover:underline"
                  >
                    Retry enabling location
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Full-width map first (desktop + mobile) */}
          <div className="pp-card overflow-hidden w-full">
            <div className="p-3 sm:p-4 bg-gradient-to-r from-gray-50 to-gray-100 border-b border-gray-200 dark:from-gray-800 dark:to-gray-900 dark:border-gray-700">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <MapPin className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0" />
                  <h3 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-gray-100">Location Map</h3>
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-300">
                  {isRouteLoading ? 'Routing...' : routeError ? routeError : hasRoute ? 'Route updated' : 'No route'}
                </div>
              </div>
            </div>
            <div className="relative w-full" style={{ width: '100%', margin: 0, padding: 0 }}>
              <div
                ref={mapRef}
                className="h-[300px] sm:h-[420px] lg:h-[560px] bg-gray-100 dark:bg-gray-900"
                style={{ width: '100%', position: 'relative', zIndex: 1, margin: 0, padding: 0 }}
              />
              {!location && mapReady && (
                <div className="absolute inset-0 flex items-center justify-center bg-gray-50 bg-opacity-90 z-[1000] dark:bg-gray-900/80">
                  <div className="pp-card text-center p-4 max-w-sm mx-4">
                    <MapPin className="w-9 h-9 text-gray-400 dark:text-gray-500 mx-auto mb-2" />
                    <p className="text-gray-700 dark:text-gray-200 font-medium text-sm">Waiting for GPS…</p>
                  </div>
                </div>
              )}
              {!mapReady && (
                <div className="absolute inset-0 flex items-center justify-center bg-gray-50 dark:bg-gray-900">
                  <div className="text-center">
                    <RefreshCw className="w-8 h-8 text-gray-400 dark:text-gray-500 mx-auto mb-2 animate-spin" />
                    <p className="text-gray-600 dark:text-gray-300 text-sm">Loading map...</p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Two columns below map: 65% order list, 35% ETA/telemetry */}
          <div className="grid grid-cols-1 lg:grid-cols-[65%_35%] gap-3 md:gap-6 items-start">
            {/* Left column: order list */}
            <div className="pp-card p-3 sm:p-6 min-h-[520px]">
              <div className="flex items-center justify-between gap-2 mb-2">
                <h2 className="text-lg sm:text-xl font-semibold text-gray-900 dark:text-gray-100">Order List</h2>
              </div>
              <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 mb-2">Tap an order to update POD, call customer, or check details</p>
              <div className="max-h-[68vh] md:max-h-[560px] overflow-y-auto pr-1">
                <DeliveryTable
                  onSelectDelivery={() => setShowModal(true)}
                  onCloseDetailModal={() => setShowModal(false)}
                  onReorder={handleManualReorder}
                  isDriverPortal={true}
                />
              </div>
              {location && (
                <div className="mt-4 flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                  <CheckCircle2 className="w-4 h-4 text-green-600 dark:text-green-400 flex-shrink-0" />
                  <span>GPS active — Admin can track your location</span>
                </div>
              )}
            </div>

            {/* Right column: route + live telemetry */}
            <div className="space-y-4">
              {/* Mobile quick status strip */}
              <div className="lg:hidden pp-card p-3">
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-lg bg-blue-50 dark:bg-blue-900/20 p-2">
                    <div className="text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400">ETA</div>
                    <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{nextEta}</div>
                    {nextEtaDate && (
                      <div className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">{nextEtaDate}</div>
                    )}
                  </div>
                  <div className="rounded-lg bg-blue-50 dark:bg-blue-900/20 p-2">
                    <div className="text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400">Priority</div>
                    <div className="text-sm font-semibold text-red-600 dark:text-red-400">
                      {storeDeliveries.filter(d => {
                        if (!isDriverMyOrdersStatus(d.status)) return false;
                        if (isPickingListEligible(d)) return false;
                        const meta = (d as unknown as { metadata?: { isPriority?: boolean } }).metadata;
                        return meta?.isPriority === true;
                      }).length || 0}
                    </div>
                  </div>
                  <div className="rounded-lg bg-blue-50 dark:bg-blue-900/20 p-2">
                    <div className="text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400">Speed</div>
                    <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{speedKmh}</div>
                  </div>
                </div>
              </div>

              {(() => {
                // Priority is owned by Delivery Team / Admin and stored in metadata.isPriority.
                // Distance-based priority (1/2/3) is routing-only and must NOT surface as "Priority" in the UI.
                const priorityCount = storeDeliveries.filter(d => {
                  if (!isDriverMyOrdersStatus(d.status)) return false;
                  if (isPickingListEligible(d)) return false;
                  const meta = (d as unknown as { metadata?: { isPriority?: boolean } }).metadata;
                  return meta?.isPriority === true;
                }).length;
                const delayedCount = orderedDeliveries.filter(d => getEtaStatus(d) === 'delayed').length;
                const routeStatusLabel = isRouteLoading
                  ? 'Routing…'
                  : routeError
                    ? '⚠ Offline'
                    : !hasRoute
                      ? 'No route'
                      : delayedCount > 0
                        ? `⚠ ${delayedCount} Delayed`
                        : '✓ On Track';
                const routeStatusCls = isRouteLoading || !hasRoute
                  ? 'text-gray-900 dark:text-gray-100'
                  : routeError
                    ? 'text-red-600 dark:text-red-400'
                    : delayedCount > 0
                      ? 'text-orange-600 dark:text-orange-400'
                      : 'text-green-600 dark:text-green-400';
                return (
                  <div className="pp-card p-4 sm:p-5">
                    <h3 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-gray-100 mb-3">Routing & ETA</h3>
                    <div className="grid grid-cols-2 gap-2 sm:gap-3 text-sm">
                      <div className="pp-card p-3">
                        <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">Planned ETA</div>
                        <div className="font-semibold text-gray-900 dark:text-gray-100">{nextPlannedEta}</div>
                        {nextPlannedEtaDate && (
                          <div className="text-[11px] font-medium text-gray-600 dark:text-gray-300 mt-0.5">{nextPlannedEtaDate}</div>
                        )}
                        <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">
                          {deliveryStartedAt ? '🔒 Locked at start' : 'First route calc'}
                        </div>
                      </div>
                      <div className="pp-card p-3">
                        <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">Live ETA</div>
                        <div className="font-semibold text-blue-600 dark:text-blue-400">{nextLiveEta}</div>
                        {nextLiveEtaDate && (
                          <div className="text-[11px] font-medium text-gray-600 dark:text-gray-300 mt-0.5">{nextLiveEtaDate}</div>
                        )}
                        <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">Real-time GPS</div>
                      </div>
                      <div className="pp-card p-3">
                        <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">Priority Orders</div>
                        <div className="font-semibold text-xs sm:text-sm">
                          {priorityCount === 0
                            ? <span className="text-gray-400 dark:text-gray-500">None</span>
                            : <span className="text-red-600 dark:text-red-400">
                                {priorityCount} order{priorityCount > 1 ? 's' : ''}
                              </span>
                          }
                        </div>
                      </div>
                      <div className="pp-card p-3">
                        <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">Total Stops</div>
                        <div className="font-semibold text-gray-900 dark:text-gray-100">{deliveries.length}</div>
                      </div>
                      <div className="pp-card p-3">
                        <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">Route Status</div>
                        <div className={`font-semibold ${routeStatusCls}`}>
                          {routeStatusLabel}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })()}

              <div className="pp-card p-4 sm:p-5">
                <h3 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-gray-100 mb-3">Live Coordinate & Speed</h3>
                <div className="space-y-2 sm:space-y-3 text-sm">
                  <div className="pp-card p-3">
                    <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">Latitude</div>
                    <div className="font-mono font-semibold text-gray-900 dark:text-gray-100">{location ? location.latitude.toFixed(6) : 'N/A'}</div>
                  </div>
                  <div className="pp-card p-3">
                    <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">Longitude</div>
                    <div className="font-mono font-semibold text-gray-900 dark:text-gray-100">{location ? location.longitude.toFixed(6) : 'N/A'}</div>
                  </div>
                  <div className="pp-card p-3">
                    <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">Speed</div>
                    <div className="font-semibold text-gray-900 dark:text-gray-100">{speedKmh} km/h</div>
                  </div>
                </div>
              </div>

            </div>
          </div>

      <ToastContainer toasts={toasts} onRemove={removeToast} />
      <CustomerModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        onSaveContactSuccess={(msg: string) => success(msg)}
        onSaveContactError={(msg: string) => toastError(msg)}
        useDriverEndpoint
      />
        </div>

      {/* Picking List Tab — per-item checklist for pgi-done orders */}
      <div className={`space-y-4${activeTab !== 'picking' ? ' hidden' : ''}`}>
        <div className="pp-card p-4">
          <div className="flex items-center gap-2 mb-1">
            <PackageCheck className="w-5 h-5 text-amber-600 dark:text-amber-400" />
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Picking List</h2>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Check every line item against what's on the pallet. Report any mispick before confirming.
            Once confirmed, the order moves to your delivery list and will be dispatched automatically on the delivery date.
          </p>
        </div>
        <PickingListPanel
          deliveries={storeDeliveries}
          onConfirmed={() => { void loadDeliveries(); }}
        />
      </div>

      {/* Messages Tab — mobile style: list then open chat card */}
      <div className={`rounded-xl overflow-hidden border border-gray-200 dark:border-gray-700 shadow-sm bg-white dark:bg-gray-800${activeTab !== 'messages' ? ' hidden' : ''}`} style={{height: 'max(520px, calc(100dvh - 220px))' }}>
          {!selectedContact ? (
            <div className="h-full flex flex-col">
              <div className="px-4 pt-4 pb-3 border-b border-gray-200 dark:border-gray-700">
                <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-3">Messages</h3>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                  <input
                    type="text"
                    placeholder="Search contacts…"
                    value={contactSearch}
                    onChange={e => setContactSearch(e.target.value)}
                    className="w-full pl-9 pr-3 py-2.5 text-sm rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 border-0 focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                </div>
              </div>
              <div className="flex-1 overflow-y-auto">
                {loadingContacts ? (
                  <div className="flex flex-col items-center justify-center h-32 text-gray-400 dark:text-gray-500 text-sm gap-2">
                    <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                    Loading…
                  </div>
                ) : (
                  <>
                    {teamMembers.length > 0 && (
                      <>
                        <div className="px-4 pt-3 pb-1">
                          <span className="text-[10px] font-bold tracking-widest text-gray-400 dark:text-gray-500 uppercase">Team</span>
                        </div>
                        {teamMembers.filter(m => {
                          if (!contactSearch.trim()) return true;
                          const q = contactSearch.toLowerCase();
                          return (m.fullName || '').toLowerCase().includes(q) || (m.username || '').toLowerCase().includes(q);
                        }).map(member => {
                          const isOnline = isContactOnline(member);
                          const initials = (member.fullName || member.username || '?')[0].toUpperCase();
                          const roleLabel = member.account?.role === 'admin' ? 'Admin'
                            : member.account?.role === 'delivery_team' ? 'Delivery'
                            : member.role || '';
                          return (
                            <button
                              key={member.id}
                              onClick={() => { setSelectedContact(member); void loadMessages(member.id); }}
                              className="w-full flex items-center gap-3 px-4 py-3.5 text-left transition-colors border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/40"
                            >
                              <div className="relative flex-shrink-0">
                                <div className="w-11 h-11 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white font-semibold text-sm shadow-sm">
                                  {initials}
                                </div>
                                <div className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-white dark:border-gray-800 ${isOnline ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'}`} />
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between gap-1">
                                  <span className="font-semibold text-sm text-gray-900 dark:text-gray-100 truncate">
                                    {member.fullName || member.username}
                                  </span>
                                  {roleLabel && (
                                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 flex-shrink-0 font-medium">
                                      {roleLabel}
                                    </span>
                                  )}
                                </div>
                                <p className={`text-xs mt-0.5 truncate font-medium ${isOnline ? 'text-green-600 dark:text-green-400' : 'text-gray-400 dark:text-gray-500'}`}>
                                  {isOnline ? '● Active now' : '○ Offline'}
                                </p>
                              </div>
                            </button>
                          );
                        })}
                      </>
                    )}
                    {contacts.length === 0 && (
                      <div className="flex flex-col items-center justify-center h-40 text-gray-400 dark:text-gray-500 text-sm gap-2 px-4 text-center">
                        <MessageSquare className="w-8 h-8 opacity-40" />
                        No contacts available
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          ) : (
            <div className="h-full flex flex-col bg-gray-50 dark:bg-gray-900 min-w-0">
              <>
                {/* Chat header */}
                <div className="flex items-center justify-between px-3 sm:px-5 py-3 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 shadow-sm flex-shrink-0">
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => setSelectedContact(null)}
                      className="w-9 h-9 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center justify-center"
                      title="Back to messages"
                    >
                      <ChevronLeft className="w-5 h-5 text-gray-600 dark:text-gray-300" />
                    </button>
                    <div className="relative">
                      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white font-semibold shadow-sm">
                        {(selectedContact.fullName || selectedContact.username || '?')[0].toUpperCase()}
                      </div>
                      {isContactOnline(selectedContact) && (
                        <div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 bg-green-500 rounded-full border-2 border-white dark:border-gray-800" />
                      )}
                    </div>
                    <div>
                      <h3 className="font-semibold text-gray-900 dark:text-gray-100 leading-tight">
                        {selectedContact.fullName || selectedContact.username}
                      </h3>
                      <p className="text-xs mt-0.5">
                        {isContactOnline(selectedContact)
                          ? <span className="text-green-600 dark:text-green-400 font-medium">Active now</span>
                          : <span className="text-gray-400 dark:text-gray-500">Offline</span>}
                        {selectedContact.account?.role && (
                          <span className="text-gray-400 dark:text-gray-500">
                            {' '}·{' '}
                            {selectedContact.account.role === 'admin' ? 'Admin'
                              : selectedContact.account.role === 'delivery_team' ? 'Delivery Team'
                              : 'Driver'}
                          </span>
                        )}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => void loadMessages(selectedContact.id)}
                    title="Refresh messages"
                    className="p-2 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                  >
                    <RefreshCw className="w-4 h-4" />
                  </button>
                </div>

                {/* Messages area */}
                <div className="flex-1 overflow-y-auto px-3 sm:px-5 py-4 space-y-3">
                  {loadingMessages && messages.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-gray-400 dark:text-gray-500 gap-2">
                      <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                      <span className="text-sm">Loading messages…</span>
                    </div>
                  ) : messages.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-gray-400 dark:text-gray-500 gap-3">
                      <div className="w-16 h-16 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
                        <MessageSquare className="w-8 h-8 opacity-40" />
                      </div>
                      <div className="text-center">
                        <p className="font-medium text-gray-600 dark:text-gray-400">No messages yet</p>
                        <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">Send a message to start the conversation</p>
                      </div>
                    </div>
                  ) : (
                    messages.map((msg, idx) => {
                      // For the driver portal: the current user IS the driver.
                      // - senderRole === 'driver' OR from === 'driver' → sent by me → RIGHT
                      // - any other senderRole (admin, delivery_team, etc.) → from the contact → LEFT
                      // The 'from' field is set locally right after sending before a reload.
                      const isFromOther = !(msg.senderRole === 'driver' || msg.from === 'driver');
                      const messageText = msg.text || msg.content || '';
                      const messageTime = msg.timestamp || msg.createdAt;
                      const roleConfig: Record<string, { label: string; color: string }> = {
                        admin: { label: 'Admin', color: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300' },
                        delivery_team: { label: 'Delivery', color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' },
                        sales_ops: { label: 'Sales', color: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300' },
                        manager: { label: 'Manager', color: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300' }
                      };
                      const roleBadge = roleConfig[msg.senderRole ?? ''] || { label: msg.senderRole ?? '', color: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300' };
                      return (
                        <div key={idx} className={`chat-message-enter flex items-end gap-2 ${isFromOther ? 'justify-start' : 'justify-end'}`}>
                          {isFromOther && (
                            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-gray-400 to-gray-600 flex-shrink-0 flex items-center justify-center text-white text-xs font-semibold shadow-sm">
                              {(selectedContact.fullName || selectedContact.username || '?')[0].toUpperCase()}
                            </div>
                          )}
                          <div className="max-w-[90%] sm:max-w-[75%]">
                            {isFromOther && roleBadge.label && (
                              <span className={`inline-block text-[10px] px-2 py-0.5 rounded-full font-semibold mb-1 ${roleBadge.color}`}>
                                {roleBadge.label}
                              </span>
                            )}
                            <div className={`px-4 py-2.5 shadow-sm ${
                              isFromOther
                                ? 'bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border border-gray-200 dark:border-gray-700 rounded-2xl rounded-tl-sm'
                                : 'bg-blue-700 dark:bg-blue-500 text-white rounded-2xl rounded-tr-sm'
                            }`}>
                              {/* Attachment rendering */}
                              {msg.attachmentUrl && msg.attachmentType?.startsWith('image/') && (
                                <a href={msg.attachmentUrl as string} target="_blank" rel="noopener noreferrer" className="block mb-2">
                                  <img
                                    src={msg.attachmentUrl as string}
                                    alt={(msg.attachmentName as string) || 'attachment'}
                                    className="max-w-full rounded-lg max-h-48 object-cover cursor-pointer hover:opacity-90 transition-opacity"
                                  />
                                </a>
                              )}
                              {msg.attachmentUrl && !msg.attachmentType?.startsWith('image/') && (
                                <a
                                  href={msg.attachmentUrl as string}
                                  download={(msg.attachmentName as string) || 'file'}
                                  className={`flex items-center gap-2 mb-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                                    isFromOther
                                      ? 'bg-gray-100 dark:bg-gray-700 text-blue-600 dark:text-blue-400 hover:bg-gray-200'
                                      : 'bg-blue-500 text-white hover:bg-blue-400'
                                  }`}
                                >
                                  <Paperclip className="w-4 h-4 flex-shrink-0" />
                                  <span className="truncate">{(msg.attachmentName as string) || 'Download file'}</span>
                                </a>
                              )}
                              {messageText && <p className="text-sm leading-relaxed font-medium">{messageText}</p>}
                            </div>
                            <p className={`text-[11px] mt-1 px-1 ${isFromOther ? 'text-left text-gray-400 dark:text-gray-500' : 'text-right text-gray-400 dark:text-gray-500'}`}>
                              {formatMessageTimestamp(messageTime)}
                            </p>
                          </div>
                        </div>
                      );
                    })
                  )}
                  <div ref={messagesEndRef} />
                </div>

                {/* Message input */}
                <div className="flex-shrink-0 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700">
                  {/* Attachment preview */}
                  {attachmentPreview && (
                    <div className="px-4 pt-3 flex items-center gap-3">
                      <div className="relative flex items-center gap-2 bg-gray-100 dark:bg-gray-700 rounded-xl px-3 py-2 max-w-xs">
                        {attachmentPreview.type.startsWith('image/') ? (
                          <img src={attachmentPreview.url} alt="preview" className="h-10 w-10 object-cover rounded-lg flex-shrink-0" />
                        ) : (
                          <div className="h-10 w-10 bg-blue-100 dark:bg-blue-900/30 rounded-lg flex items-center justify-center flex-shrink-0">
                            <Paperclip className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                          </div>
                        )}
                        <span className="text-xs text-gray-700 dark:text-gray-300 truncate max-w-[140px]">{attachmentPreview.name}</span>
                        <button
                          onClick={() => setAttachmentPreview(null)}
                          className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-gray-500 hover:bg-red-500 text-white rounded-full flex items-center justify-center text-xs transition-colors"
                        >✕</button>
                      </div>
                    </div>
                  )}
                  <div className="flex items-center gap-2 px-3 sm:px-4 py-3">
                    {/* Hidden file input */}
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt"
                      className="hidden"
                      onChange={handleFileSelect}
                    />
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      disabled={sendingMessage}
                      title="Attach file or image"
                      className="flex-shrink-0 w-9 h-9 flex items-center justify-center text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full transition-colors disabled:opacity-40"
                    >
                      <Paperclip className="w-5 h-5" />
                    </button>
                    <div className="flex-1 flex items-center gap-3 bg-gray-100 dark:bg-gray-700 rounded-full px-4 py-2.5 focus-within:ring-2 focus-within:ring-blue-500 transition-all">
                      <input
                        type="text"
                        value={newMessage}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewMessage(e.target.value)}
                        onKeyPress={(e: React.KeyboardEvent<HTMLInputElement>) => {
                          if (e.key === 'Enter' && (newMessage.trim() || attachmentPreview) && !sendingMessage) {
                            void handleSendMessage();
                          }
                        }}
                        placeholder="Type a message…"
                        disabled={sendingMessage}
                        className="flex-1 bg-transparent text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 outline-none disabled:opacity-50"
                      />
                    </div>
                    <button
                      onClick={() => void handleSendMessage()}
                      disabled={(!newMessage.trim() && !attachmentPreview) || sendingMessage}
                      className="flex-shrink-0 w-9 h-9 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-full flex items-center justify-center transition-colors shadow-sm"
                    >
                      {sendingMessage
                        ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        : <Send className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>
              </>
            </div>
          )}
        </div>

      </div>{/* end tab wrapper */}

      <PickingReminderModal
        isOpen={reminderVisible}
        onDismiss={dismissReminder}
        onOpenPickingList={handleOpenPickingFromReminder}
        pendingOrders={pickingPendingOrders}
      />
    </div>
  );
}
