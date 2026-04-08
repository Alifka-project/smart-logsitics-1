import { create } from 'zustand';
import { calculateDistance } from '../utils/distanceCalculator';
import { assignPriorities } from '../utils/priorityCalculator';
import { isUnrecognizableAddress } from '../utils/addressHandler';
import type { Delivery, RouteResult } from '../types';
import type { DeliveryListFilter } from '../utils/deliveryListFilter';

const WAREHOUSE_LAT = 25.0053;
const WAREHOUSE_LNG = 55.076;

/**
 * Storage keys scoped to the current user's ID so different accounts on the
 * same browser cannot see each other's delivery lists or upload histories.
 */
function getCurrentUserId(): string {
  try {
    const raw = localStorage.getItem('client_user');
    if (!raw) return 'anonymous';
    const u = JSON.parse(raw) as { id?: string; sub?: string };
    return u?.id || u?.sub || 'anonymous';
  } catch {
    return 'anonymous';
  }
}

function scopedKey(base: string): string {
  return `${base}:${getCurrentUserId()}`;
}

const STORAGE_KEY_BASE = 'deliveries_data';
const RECENT_UPLOADS_KEY_BASE = 'delivery_recent_uploads';
const HASHES_KEY_BASE = 'delivery_uploaded_file_hashes';


export type UploadRecordStatus = 'processing' | 'completed' | 'error';

/** One row in upload history (file uploads, DB reload, etc.). */
export interface UploadRecord {
  id: string;
  filename: string;
  /** SHA-256 hex; empty for non-file sources (e.g. DB reload). */
  fileHash: string;
  orderCount: number;
  uploadedAt: string;
  status: UploadRecordStatus;
}

/** @deprecated Use UploadRecord */
export type RecentUploadEntry = UploadRecord;

interface DeliveryStore {
  deliveries: Delivery[];
  selectedDelivery: Delivery | null;
  route: RouteResult | null;
  isLoading: boolean;
  currentPage: string;
  deliveryListFilter: DeliveryListFilter;
  /** Set by Needs Attention cards to pre-filter the ManageTab OrdersTable. Cleared after use. */
  manageTabFilter: string | null;
  recentUploads: UploadRecord[];
  /** Successful file upload hashes (duplicate file prevention). */
  uploadedFileHashes: string[];

  initializeFromStorage: () => Delivery[];
  saveToStorage: (deliveries: Delivery[]) => void;
  loadDeliveries: (data: Delivery[]) => void;
  updateDeliveryStatus: (id: string, status: string, updateData?: Partial<Delivery>) => void;
  updateDeliveryContact: (id: string, contactData: Partial<Delivery>) => void;
  selectDelivery: (id: string) => void;
  updateDeliveryOrder: (reorderedDeliveries: Delivery[]) => void;
  clearDeliveries: () => void;
  calculateRoute: () => Promise<void>;
  setRoute: (route: RouteResult) => void;
  setDeliveryListFilter: (filter: DeliveryListFilter) => void;
  setManageTabFilter: (filter: string | null) => void;

  beginUploadRecord: (filename: string, fileHash: string) => string;
  completeUploadRecord: (id: string, orderCount: number, fileHash: string) => void;
  failUploadRecord: (id: string) => void;
  removeUploadRecord: (id: string) => void;
  updateUploadRecordStatus: (id: string, status: UploadRecordStatus) => void;

  isFileAlreadyUploaded: (hash: string) => boolean;
  registerUploadedFileHash: (hash: string) => void;

  addCompletedUpload: (filename: string, orderCount: number, fileHash?: string) => void;
}

function loadHashesFromStorage(): string[] {
  try {
    const raw = localStorage.getItem(scopedKey(HASHES_KEY_BASE));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === 'string' && x.length > 0)
      : [];
  } catch {
    return [];
  }
}

function persistHashes(hashes: string[]): void {
  try {
    localStorage.setItem(scopedKey(HASHES_KEY_BASE), JSON.stringify(hashes.slice(0, 500)));
  } catch {
    /* ignore */
  }
}

function normalizeUploadsFromStorage(parsed: unknown): UploadRecord[] {
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((row: Record<string, unknown>) => {
      const id = String(row.id ?? '');
      if (!id) return null;
      const st = row.status;
      const status: UploadRecordStatus =
        st === 'processing' || st === 'completed' || st === 'error' ? st : 'completed';
      return {
        id,
        filename: String(row.filename ?? 'Upload'),
        fileHash: typeof row.fileHash === 'string' ? row.fileHash : '',
        orderCount: Number(row.orderCount) || 0,
        uploadedAt:
          typeof row.uploadedAt === 'string' ? row.uploadedAt : new Date().toISOString(),
        status,
      } satisfies UploadRecord;
    })
    .filter((x): x is UploadRecord => x !== null);
}

function loadRecentUploadsFromStorage(): UploadRecord[] {
  try {
    const raw = localStorage.getItem(scopedKey(RECENT_UPLOADS_KEY_BASE));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return normalizeUploadsFromStorage(parsed);
  } catch {
    return [];
  }
}

function persistRecentUploads(entries: UploadRecord[]): void {
  try {
    localStorage.setItem(scopedKey(RECENT_UPLOADS_KEY_BASE), JSON.stringify(entries.slice(0, 20)));
  } catch {
    /* ignore */
  }
}

const useDeliveryStore = create<DeliveryStore>((set, get) => ({
  deliveries: [],
  selectedDelivery: null,
  route: null,
  isLoading: false,
  currentPage: 'list',
  deliveryListFilter: 'all',
  manageTabFilter: null,
  recentUploads: loadRecentUploadsFromStorage(),
  uploadedFileHashes: loadHashesFromStorage(),

  initializeFromStorage: (): Delivery[] => {
    try {
      const key = scopedKey(STORAGE_KEY_BASE);
      const stored = localStorage.getItem(key);
      if (stored) {
        const deliveries: Delivery[] = JSON.parse(stored);

        const hasFakeIds = deliveries.some((d) => {
          const id = d.id || '';
          return /^delivery-\d+$/.test(id);
        });

        if (hasFakeIds) {
          console.warn('[Store] ⚠️ Detected old fake IDs (delivery-1, etc). Clearing localStorage.');
          console.warn('[Store] Please re-upload your deliveries to get database UUIDs.');
          localStorage.removeItem(key);
          set({ deliveries: [] });
          return [];
        }

        console.log(`[Store] ✓ Loaded ${deliveries.length} deliveries from localStorage with valid UUIDs`);
        set({ deliveries });
        if (deliveries.length > 0) {
          const uploads = get().recentUploads ?? [];
          if (uploads.length === 0) {
            get().addCompletedUpload('Browser saved session', deliveries.length, '');
          }
        }
        return deliveries;
      }
    } catch (error) {
      console.error('Failed to load from localStorage:', error);
    }
    return [];
  },

  saveToStorage: (deliveries: Delivery[]): void => {
    try {
      localStorage.setItem(scopedKey(STORAGE_KEY_BASE), JSON.stringify(deliveries));
    } catch (error) {
      console.error('Failed to save to localStorage:', error);
    }
  },

  loadDeliveries: (data: Delivery[]): void => {
    try {
      console.log(`[Store] Loading ${data.length} deliveries...`);

      if (data.length > 0) {
        const firstId = data[0].id || '';
        const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(firstId);
        console.log(`[Store] First delivery ID: ${firstId} (${isUUID ? 'UUID ✓' : 'NOT UUID ✗'})`);
      }

      const seenIds = new Set<string>();
      const deliveriesWithDistance: Delivery[] = [];

      data.forEach((delivery, index) => {
        const finalId = delivery.id || `delivery-${index + 1}`;
        if (seenIds.has(finalId)) {
          console.warn(`[Store] ⚠️ Skipping duplicate delivery with ID ${finalId} at index ${index}`);
          return;
        }
        seenIds.add(finalId);

        const latRaw =
          delivery.lat ??
          (delivery as Record<string, unknown>)['Lat'] ??
          (delivery as Record<string, unknown>)['latitude'] ??
          (delivery as Record<string, unknown>)['Latitude'];
        const lngRaw =
          delivery.lng ??
          (delivery as Record<string, unknown>)['Lng'] ??
          (delivery as Record<string, unknown>)['longitude'] ??
          (delivery as Record<string, unknown>)['Longitude'];

        const lat = parseFloat(String(latRaw));
        const lng = parseFloat(String(lngRaw));

        const safeLat = isFinite(lat) && lat !== 0 ? lat : 25.1124;
        const safeLng = isFinite(lng) && lng !== 0 ? lng : 55.198;

        if (!delivery.id) {
          console.warn(`[Store] ⚠️ Delivery ${index + 1} missing ID! Generating fake ID: ${finalId}`);
          console.warn('[Store] This should not happen if data came from database!');
        }

        deliveriesWithDistance.push({
          ...delivery,
          id: finalId,
          lat: safeLat,
          lng: safeLng,
          originalLat: latRaw as number | null,
          originalLng: lngRaw as number | null,
          distanceFromWarehouse: calculateDistance(WAREHOUSE_LAT, WAREHOUSE_LNG, safeLat, safeLng),
          status: delivery.status || 'pending',
          estimatedTime: new Date(
            Date.now() + (deliveriesWithDistance.length + 1) * 75 * 60 * 1000,
          ),
        });
      });

      const prioritized = assignPriorities(deliveriesWithDistance);

      const deliveriesWithContact: Delivery[] = [];
      const deliveriesMissingContact: Delivery[] = [];

      prioritized.forEach((d) => {
        const phoneStr = d.phone != null ? String(d.phone).trim() : '';
        const hasPhone = phoneStr.length > 0;
        const badAddress = isUnrecognizableAddress(d.address);

        if (!hasPhone || badAddress) {
          deliveriesMissingContact.push(d);
        } else {
          deliveriesWithContact.push(d);
        }
      });

      const finalDeliveries = [...deliveriesWithContact, ...deliveriesMissingContact];

      set({ deliveries: finalDeliveries });
      get().saveToStorage(finalDeliveries);
    } catch (error) {
      console.error('Error loading deliveries:', error);
      throw error;
    }
  },

  updateDeliveryStatus: (
    id: string,
    status: string,
    updateData?: Partial<Delivery>,
  ): void => {
    const deliveries = get().deliveries;
    const updated = deliveries.map((delivery) => {
      if (delivery.id === id) {
        const mergedMeta =
          updateData?.metadata && typeof updateData.metadata === 'object'
            ? {
                ...((delivery.metadata as Record<string, unknown>) || {}),
                ...(updateData.metadata as Record<string, unknown>),
              }
            : delivery.metadata;
        const { metadata: _drop, ...restUpdate } = updateData || {};
        return {
          ...delivery,
          status,
          ...restUpdate,
          metadata: mergedMeta as Delivery['metadata'],
          updatedAt: new Date().toISOString(),
        };
      }
      return delivery;
    });

    set({ deliveries: updated });
    get().saveToStorage(updated);
  },

  updateDeliveryContact: (id: string, contactData: Partial<Delivery>): void => {
    const deliveries = get().deliveries || [];

    const updatedDeliveries = deliveries.map((delivery) => {
      if (delivery.id !== id) return delivery;

      const latRaw = contactData.lat ?? delivery.lat;
      const lngRaw = contactData.lng ?? delivery.lng;

      const lat = parseFloat(String(latRaw));
      const lng = parseFloat(String(lngRaw));

      const safeLat = isFinite(lat) && lat !== 0 ? lat : 25.1124;
      const safeLng = isFinite(lng) && lng !== 0 ? lng : 55.198;

      return {
        ...delivery,
        ...contactData,
        lat: safeLat,
        lng: safeLng,
        distanceFromWarehouse: calculateDistance(WAREHOUSE_LAT, WAREHOUSE_LNG, safeLat, safeLng),
      };
    });

    const deliveriesWithContact: Delivery[] = [];
    const deliveriesMissingContact: Delivery[] = [];

    updatedDeliveries.forEach((d) => {
      const phoneStr = d.phone != null ? String(d.phone).trim() : '';
      const hasPhone = phoneStr.length > 0;
      const badAddress = isUnrecognizableAddress(d.address);

      if (!hasPhone || badAddress) {
        deliveriesMissingContact.push(d);
      } else {
        deliveriesWithContact.push(d);
      }
    });

    const finalDeliveries = [...deliveriesWithContact, ...deliveriesMissingContact];

    const currentSelected = get().selectedDelivery;
    if (currentSelected?.id === id) {
      const updatedSelected = finalDeliveries.find((d) => d.id === id);
      if (updatedSelected) set({ selectedDelivery: updatedSelected });
    }

    set({ deliveries: finalDeliveries });
    get().saveToStorage(finalDeliveries);
  },

  selectDelivery: (id: string): void => {
    const delivery = get().deliveries.find((d) => d.id === id);
    set({ selectedDelivery: delivery ?? null });
  },

  updateDeliveryOrder: (reorderedDeliveries: Delivery[]): void => {
    set({ deliveries: reorderedDeliveries });
    get().saveToStorage(reorderedDeliveries);
  },

  clearDeliveries: (): void => {
    set({ deliveries: [], selectedDelivery: null });
    localStorage.removeItem(scopedKey(STORAGE_KEY_BASE));
  },

  calculateRoute: async (): Promise<void> => {
    set({ isLoading: true });
    set({ isLoading: false });
  },

  setRoute: (route: RouteResult): void => {
    set({ route });
  },

  setDeliveryListFilter: (filter: DeliveryListFilter): void => {
    set({ deliveryListFilter: filter });
  },

  setManageTabFilter: (filter: string | null): void => {
    set({ manageTabFilter: filter });
  },

  isFileAlreadyUploaded: (hash: string): boolean => {
    if (!hash) return false;
    return get().uploadedFileHashes.includes(hash);
  },

  registerUploadedFileHash: (hash: string): void => {
    if (!hash) return;
    const prev = get().uploadedFileHashes;
    if (prev.includes(hash)) return;
    const next = [...prev, hash];
    set({ uploadedFileHashes: next });
    persistHashes(next);
  },

  beginUploadRecord: (filename: string, fileHash: string): string => {
    const id =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `up-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const entry: UploadRecord = {
      id,
      filename,
      fileHash,
      orderCount: 0,
      uploadedAt: new Date().toISOString(),
      status: 'processing',
    };
    const next = [entry, ...get().recentUploads].slice(0, 20);
    set({ recentUploads: next });
    persistRecentUploads(next);
    return id;
  },

  completeUploadRecord: (id: string, orderCount: number, fileHash: string): void => {
    let hashes = [...get().uploadedFileHashes];
    if (fileHash && !hashes.includes(fileHash)) {
      hashes = [...hashes, fileHash];
    }
    const next = get().recentUploads.map((u) =>
      u.id === id ? { ...u, orderCount, status: 'completed' as const, fileHash: fileHash || u.fileHash } : u,
    );
    set({ recentUploads: next, uploadedFileHashes: hashes });
    persistRecentUploads(next);
    persistHashes(hashes);
  },

  failUploadRecord: (id: string): void => {
    const next = get().recentUploads.map((u) =>
      u.id === id ? { ...u, status: 'error' as const } : u,
    );
    set({ recentUploads: next });
    persistRecentUploads(next);
  },

  updateUploadRecordStatus: (id: string, status: UploadRecordStatus): void => {
    const next = get().recentUploads.map((u) => (u.id === id ? { ...u, status } : u));
    set({ recentUploads: next });
    persistRecentUploads(next);
  },

  removeUploadRecord: (id: string): void => {
    const next = get().recentUploads.filter((u) => u.id !== id);
    set({ recentUploads: next });
    persistRecentUploads(next);
  },

  addCompletedUpload: (filename: string, orderCount: number, fileHash = ''): void => {
    const id =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `up-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const entry: UploadRecord = {
      id,
      filename,
      fileHash,
      orderCount,
      uploadedAt: new Date().toISOString(),
      status: 'completed',
    };
    const prev = get().recentUploads ?? [];
    const next = [entry, ...prev].slice(0, 20);
    set({ recentUploads: next });
    persistRecentUploads(next);
    if (fileHash) {
      get().registerUploadedFileHash(fileHash);
    }
  },
}));

export default useDeliveryStore;
