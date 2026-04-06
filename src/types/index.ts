// ─── Canonical shared types for the Dubai Logistics System ──────────────────
// All domain objects should use these types to ensure consistency across
// frontend (React), API client, Zustand store, and backend (Express/Prisma).

// ─── Delivery ────────────────────────────────────────────────────────────────

export type DeliveryStatus =
  | 'pending'
  | 'uploaded'
  | 'scheduled'
  | 'confirmed'
  | 'scheduled-confirmed'
  | 'out-for-delivery'
  | 'in-transit'
  | 'delivered'
  | 'delivered-with-installation'
  | 'delivered-without-installation'
  | 'finished'
  | 'completed'
  | 'pod-completed'
  | 'cancelled'
  | 'rescheduled'
  | 'returned'
  | 'order-delay'
  | string; // allow future statuses

export type GeocodeAccuracy = 'HIGH' | 'MEDIUM' | 'LOW' | 'FAILED' | 'UNKNOWN';

export interface DeliveryMetadata {
  originalDeliveryNumber?: string | null;
  originalPONumber?: string | null;
  originalQuantity?: string | number | null;
  originalCity?: string | null;
  originalRoute?: string | null;
  originalRow?: Record<string, unknown>;
  statusUpdatedAt?: string;
  statusUpdatedBy?: string;
  actualTime?: string | null;
  [key: string]: unknown;
}

/** Raw delivery object returned from the API */
export interface Delivery {
  id: string;
  customer: string | null;
  address: string | null;
  phone: string | null;
  lat: number | null;
  lng: number | null;
  status: DeliveryStatus;
  items: string | null;
  metadata: DeliveryMetadata | null;
  poNumber: string | null;
  // Date fields (API may return any of these aliases)
  createdAt?: string | Date | null;
  created_at?: string | Date | null;
  created?: string | Date | null;
  updatedAt?: string | Date | null;
  // Assignment info (flattened from relations)
  assignedDriverId?: string | null;
  driverName?: string | null;
  assignmentStatus?: string;
  // POD fields
  driverSignature?: string | null;
  customerSignature?: string | null;
  photos?: Array<{ data: string; name?: string | null }> | null;
  conditionNotes?: string | null;
  deliveryNotes?: string | null;
  deliveredBy?: string | null;
  deliveredAt?: string | Date | null;
  podCompletedAt?: string | Date | null;
  // Confirmation / tracking
  confirmationToken?: string | null;
  tokenExpiresAt?: string | Date | null;
  confirmationStatus?: string | null;
  confirmedDeliveryDate?: string | Date | null;
  customerConfirmedAt?: string | Date | null;
  deliveryNumber?: string | null;
  goodsMovementDate?: string | Date | null;
  smsSentAt?: string | Date | null;
  // Computed/enriched fields added on frontend
  distanceFromWarehouse?: number;
  priority?: number;
  priorityLabel?: string;
  addressUnresolvable?: boolean;
  estimatedTime?: Date;
  originalLat?: number | string | null;
  originalLng?: number | string | null;
  geocoded?: boolean;
  geocodeAccuracy?: GeocodeAccuracy;
  geocodeDisplayName?: string;
  geocodeAddressType?: string;
  geocodeError?: string;
  _usedDefaultCoords?: boolean;
  _originalDeliveryNumber?: string | null;
  _originalPONumber?: string | null;
  _originalQuantity?: string | number | null;
  _originalCity?: string | null;
  _originalRoute?: string | null;
  _originalRow?: Record<string, unknown>;
  // Allow extra fields from ERP/SAP data
  [key: string]: unknown;
}

/** Delivery enriched with computed fields used in the store */
export interface EnrichedDelivery extends Delivery {
  distanceFromWarehouse: number;
  priority: number;
  priorityLabel: string;
  estimatedTime: Date;
}

// ─── Driver ──────────────────────────────────────────────────────────────────

export type DriverStatus = 'available' | 'busy' | 'offline' | 'on_break' | string;

export interface DriverLocation {
  lat: number;
  lng: number;
  heading?: number | null;
  speed?: number | null;
  accuracy?: number | null;
  timestamp?: string | Date | null;
}

export interface DriverTracking {
  online: boolean;
  location: DriverLocation | null;
  status: DriverStatus;
  lastUpdate: string | Date | null;
  assignmentId?: string | null;
}

export interface Driver {
  id: string;
  username: string;
  email: string | null;
  phone: string | null;
  fullName: string | null;
  full_name?: string | null; // alias
  active: boolean;
  role?: string;
  tracking?: DriverTracking;
}

// ─── Auth / User ──────────────────────────────────────────────────────────────

export type UserRole = 'admin' | 'driver' | 'delivery_team' | string;

export interface AuthUser {
  id?: string;
  sub?: string;
  username: string;
  email?: string | null;
  role: UserRole;
  exp?: number;
  iat?: number;
  type?: 'access' | 'refresh';
}

export interface AuthData {
  clientKey?: string;
  driver?: AuthUser;
  accessToken?: string;
  csrfToken?: string;
}

// ─── Tracking / Timeline ─────────────────────────────────────────────────────

export type TrackingEventType =
  | 'delivery_uploaded'
  | 'order_created'
  | 'customer_confirmed'
  | 'delivery_scheduled'
  | 'out_for_delivery'
  | 'status_updated_out_for_delivery'
  | 'delivery_completed'
  | 'status_updated_delivered'
  | 'pod_completed'
  | 'order_finished'
  | 'status_updated'
  | 'duplicate_upload'
  | 'uploaded'
  | string;

export interface TrackingEvent {
  type: TrackingEventType;
  timestamp: string | Date;
  description?: string;
  actorType?: string;
  actorId?: string;
  payload?: Record<string, unknown>;
}

export interface CustomerTrackingData {
  delivery: Delivery;
  timeline: TrackingEvent[];
  driverLocation?: DriverLocation | null;
  estimatedArrival?: string | null;
}

// ─── Upload / Data transformation ────────────────────────────────────────────

export interface RawERPRow {
  [key: string]: string | number | null | undefined;
}

export interface TransformedDelivery {
  customer: string;
  address: string;
  lat: number;
  lng: number;
  phone: string;
  items: string;
  poNumber: string | null;
  PONumber: string | null;
  _usedDefaultCoords: boolean;
  _originalDeliveryNumber?: string | null;
  _originalPONumber?: string | null;
  _originalQuantity?: string | number | null;
  _originalCity?: string | null;
  _originalRoute?: string | null;
  _originalRow: Record<string, unknown>;
  _goodsMovementDate?: string | null;
  _deliveryNumber?: string | null;
}

export type DataFormat = 'simplified' | 'erp' | 'generic' | 'unknown';

export interface DetectedFormat {
  format: DataFormat;
  transform: ((data: RawERPRow[]) => TransformedDelivery[]) | null;
}

// ─── Validation ──────────────────────────────────────────────────────────────

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  validData: Delivery[];
}

export interface AddressValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  isGeocoded: boolean;
  accuracy: GeocodeAccuracy;
}

// ─── Geocoding ────────────────────────────────────────────────────────────────

export interface GeocodeResult {
  lat: number | null;
  lng: number | null;
  accuracy?: GeocodeAccuracy;
  displayName?: string;
  addresstype?: string;
  error?: string;
}

export interface PreparedAddress {
  address: string;
  city: string;
  hasCoordinates: boolean;
  originalLat: number | string | null | undefined;
  originalLng: number | string | null | undefined;
}

export interface GeocodeSummary {
  total: number;
  geocoded: number;
  failed: number;
  skipped: number;
  successRate: string | number;
  byAccuracy: {
    HIGH: number;
    MEDIUM: number;
    LOW: number;
    FAILED: number;
  };
}

// ─── Routing ─────────────────────────────────────────────────────────────────

export interface RouteSegment {
  from: [number, number];
  to: [number, number];
  distance: number;
  duration: number;
  geometry?: [number, number][];
}

export interface RouteResult {
  // OSRM / segment-based shape
  segments?: RouteSegment[];
  totalDistance?: number;
  totalDuration?: number;
  waypoints?: [number, number][];
  geometry?: [number, number][];
  // Advanced routing service shape
  coordinates?: [number, number][];
  distance?: number;
  distanceKm: number;
  time?: number;
  timeHours: number;
  legs?: unknown[];
  instructions?: unknown[];
  locationsCount?: number;
  isFallback?: boolean;
  optimization?: { sequence?: number[]; explanation?: string; estimatedDistance?: number | null; estimatedTime?: number | null; isFallback?: boolean } | null;
  optimized?: boolean;
  isMultiLeg?: boolean;
  chunkCount?: number;
  [key: string]: unknown;
}

// ─── Toast ────────────────────────────────────────────────────────────────────

export type ToastType = 'success' | 'error' | 'warning' | 'info' | 'message' | 'delivery' | string;

export interface Toast {
  id: number;
  title: string;
  message: string;
  type: ToastType;
  metadata: string;
}

// ─── Priority ────────────────────────────────────────────────────────────────

export interface PrioritizedDelivery extends Delivery {
  priority: number;
  priorityLabel: string;
  distanceFromWarehouse: number;
}

// ─── API Responses ────────────────────────────────────────────────────────────

export interface ApiResponse<T = unknown> {
  ok?: boolean;
  data?: T;
  error?: string;
  detail?: string;
  message?: string;
}

export interface DeliveriesListResponse {
  deliveries: Delivery[];
  count: number;
  timestamp?: string;
}

export interface TrackingDeliveriesResponse {
  deliveries: Delivery[];
  timestamp: string;
}

export interface TrackingDriversResponse {
  drivers: Driver[];
  timestamp: string;
}

export interface UploadDeliveriesResponse {
  success: boolean;
  count: number;
  saved: number;
  assigned: number;
  results: UploadResult[];
  deliveries: Delivery[];
}

export interface UploadResult {
  deliveryId: string;
  saved: boolean;
  deduplicated?: boolean;
  assigned?: boolean;
  driverId?: string | null;
  driverName?: string | null;
  assignmentError?: string | null;
  error?: string;
}

