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
  /** Set by Driver Assignment clicks to pre-filter the table by driver + date. Cleared after use. */
  manageTabPreset: { driverId?: string; dateFrom?: string; dateTo?: string } | null;
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

  /** Optimistic: toggle a per-item picking checkbox (metadata.picking.itemsChecked). */
  togglePickingItem: (deliveryId: string, itemIndex: number, checked: boolean) => void;
  /** Optimistic: record/clear a mispick note locally (metadata.picking.mispickReported). */
  reportMispick: (deliveryId: string, itemIndex: number, note: string | null) => void;
  /** Optimistic: flip a delivery to pickup-confirmed and stamp metadata.picking.confirmedAt. */
  confirmPickingList: (deliveryId: string, confirmedBy?: string) => void;

  calculateRoute: () => Promise<void>;
  setRoute: (route: RouteResult) => void;
  setDeliveryListFilter: (filter: DeliveryListFilter) => void;
  setManageTabFilter: (filter: string | null) => void;
  setManageTabPreset: (preset: { driverId?: string; dateFrom?: string; dateTo?: string } | null) => void;

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
  manageTabPreset: null,
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

      // Carry-forward map of OSRM-derived per-delivery fields that the API
      // never returns (computed in DriverPortal's routing effect). Without
      // this, every 30s loadDeliveries poll wholesale-replaced the store and
      // wiped plannedEta / staticEta / estimatedEta / distanceFromDriverKm,
      // which is why the ETA chip on the order card disappeared briefly
      // every refresh tick. Other portals (Admin, Delivery Team) do not set
      // these fields, so the merge below is a no-op for them.
      const prevById = new Map(
        get().deliveries.map(d => [String(d.id), d as Record<string, unknown>]),
      );

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

        // Preserve actual geocoded coordinates; leave as 0 for ungeocodable
        // so the map can skip them instead of pinning to a wrong default
        const safeLat = isFinite(lat) && lat !== 0 ? lat : 0;
        const safeLng = isFinite(lng) && lng !== 0 ? lng : 0;

        if (!delivery.id) {
          console.warn(`[Store] ⚠️ Delivery ${index + 1} missing ID! Generating fake ID: ${finalId}`);
          console.warn('[Store] This should not happen if data came from database!');
        }

        // Carry forward OSRM-derived fields the API doesn't return so the
        // ETA chips on the driver portal's order cards don't blank out on
        // every poll tick. For other portals these fields are simply absent
        // on both sides and the spread is a no-op.
        const prev = prevById.get(finalId);
        const carryOver = prev
          ? {
              plannedEta: prev['plannedEta'] as string | null | undefined,
              staticEta: prev['staticEta'] as string | null | undefined,
              estimatedEta: prev['estimatedEta'] as string | null | undefined,
              distanceFromDriverKm: prev['distanceFromDriverKm'] as number | undefined,
              routeIndex: prev['routeIndex'] as number | undefined,
            }
          : {};

        deliveriesWithDistance.push({
          ...carryOver,
          ...delivery,
          // If the API row already carried these fields, prefer them; otherwise
          // fall back to the previously enriched values from the store.
          plannedEta:
            (delivery as Record<string, unknown>)['plannedEta'] as string | null | undefined
            ?? carryOver.plannedEta ?? null,
          staticEta:
            (delivery as Record<string, unknown>)['staticEta'] as string | null | undefined
            ?? carryOver.staticEta ?? null,
          estimatedEta:
            (delivery as Record<string, unknown>)['estimatedEta'] as string | null | undefined
            ?? carryOver.estimatedEta ?? null,
          distanceFromDriverKm:
            (delivery as Record<string, unknown>)['distanceFromDriverKm'] as number | undefined
            ?? carryOver.distanceFromDriverKm,
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
        const { metadata: _drop, notes, ...restUpdate } = (updateData || {}) as
          Partial<Delivery> & { notes?: string };
        // Mirror the driver's comment (passed as `notes` by CustomerModal) into
        // the persisted DB columns so the local view surfaces the rejection
        // reason immediately — without waiting for the next tracking refetch.
        const notesFields = notes !== undefined
          ? { notes, deliveryNotes: notes, conditionNotes: notes }
          : {};
        return {
          ...delivery,
          status,
          ...restUpdate,
          ...notesFields,
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

      // Preserve actual geocoded coordinates; leave as 0 for ungeocodable
      const safeLat = isFinite(lat) && lat !== 0 ? lat : 0;
      const safeLng = isFinite(lng) && lng !== 0 ? lng : 0;

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
    // The function's job is to ORDER (and merge field updates for) the items
    // in the input list. Items that exist in the store but are NOT in the
    // input list must be PRESERVED — otherwise callers that legitimately
    // pass a partial list (e.g. the Driver Portal routing effect, which
    // only enriches the chip-filtered + on-route subset) would silently
    // wipe the rest of the store. Polling masks the symptom for ~30 s
    // until the next refresh, but during that window the chip counts and
    // the visible list shrink, producing a flicker on every routing
    // recompute.
    //
    // Behaviour:
    //   1. Items in `reorderedDeliveries` are merged with their existing
    //      store entry (existing fields preserved, input fields layered on
    //      top, priority / plannedEta / priorityLabel explicitly kept when
    //      the input doesn't supply them) — same merge semantics as before.
    //   2. The merged input list is placed first, in its input order, so
    //      drag-reorder and routing-driven ordering still wins.
    //   3. Items present in the store but NOT in the input are appended
    //      after the merged input items, preserving their relative order.
    //      This is what fixes the flicker — they stop falling out of the
    //      store on every partial update.
    //   4. The input is deduplicated by ID, keeping the first occurrence —
    //      callers concatenate several arrays (final + picking + confirmed +
    //      finished) and the same delivery can legitimately appear in more
    //      than one (a rescheduled row visible in both picking-stage and
    //      finished, a delivered row visible in both routing-final and
    //      finished). Without this dedup, duplicates feed back into the
    //      filtered signature check, the routing effect re-runs, and the
    //      duplicates compound on each tick — chip counts climbed unboundedly
    //      (160 → 390 → 540) on the driver portal Completed chip.
    const existing = get().deliveries;
    const seenInputIds = new Set<string>();
    const dedupedInput: Delivery[] = [];
    for (const d of reorderedDeliveries) {
      const idStr = String(d.id);
      if (seenInputIds.has(idStr)) continue;
      seenInputIds.add(idStr);
      dedupedInput.push(d);
    }
    const existingMap = new Map(existing.map(d => [String(d.id), d as Record<string, unknown>]));
    const mergedInputItems = dedupedInput.map(d => {
      const ex = existingMap.get(String(d.id));
      if (!ex) return d;
      const nd = d as Record<string, unknown>;
      return {
        ...ex,
        ...nd,
        priority: nd['priority'] ?? ex['priority'],
        plannedEta: nd['plannedEta'] ?? ex['plannedEta'],
        priorityLabel: nd['priorityLabel'] ?? ex['priorityLabel'],
      };
    }) as Delivery[];
    const preservedTail = existing.filter(d => !seenInputIds.has(String(d.id)));
    const merged = [...mergedInputItems, ...preservedTail];
    set({ deliveries: merged });
    get().saveToStorage(merged);
  },

  clearDeliveries: (): void => {
    set({ deliveries: [], selectedDelivery: null });
    localStorage.removeItem(scopedKey(STORAGE_KEY_BASE));
  },

  // ── Picking state (optimistic) ──────────────────────────────────────────
  // These mutate metadata.picking locally so the driver's Picking List tab
  // reacts instantly to checkbox taps, mispick notes, and the final confirm.
  // The server is the authority — the next loadDeliveries() / refetch will
  // reconcile and overwrite these optimistic values.

  togglePickingItem: (deliveryId: string, itemIndex: number, checked: boolean): void => {
    if (!Number.isInteger(itemIndex) || itemIndex < 0) return;
    const deliveries = get().deliveries;
    const updated = deliveries.map((d) => {
      if (d.id !== deliveryId) return d;
      const meta = (d.metadata && typeof d.metadata === 'object')
        ? { ...(d.metadata as Record<string, unknown>) }
        : {} as Record<string, unknown>;
      const picking = (meta.picking && typeof meta.picking === 'object')
        ? { ...(meta.picking as Record<string, unknown>) }
        : {} as Record<string, unknown>;
      const prev = Array.isArray(picking.itemsChecked)
        ? (picking.itemsChecked as number[]).filter((n) => Number.isInteger(n))
        : [];
      const setNext = new Set<number>(prev);
      if (checked) setNext.add(itemIndex);
      else setNext.delete(itemIndex);
      picking.itemsChecked = Array.from(setNext).sort((a, b) => a - b);
      meta.picking = picking;
      return { ...d, metadata: meta as Delivery['metadata'], updatedAt: new Date().toISOString() };
    });
    set({ deliveries: updated });
    get().saveToStorage(updated);
  },

  reportMispick: (deliveryId: string, itemIndex: number, note: string | null): void => {
    if (!Number.isInteger(itemIndex) || itemIndex < 0) return;
    const deliveries = get().deliveries;
    const updated = deliveries.map((d) => {
      if (d.id !== deliveryId) return d;
      const meta = (d.metadata && typeof d.metadata === 'object')
        ? { ...(d.metadata as Record<string, unknown>) }
        : {} as Record<string, unknown>;
      const picking = (meta.picking && typeof meta.picking === 'object')
        ? { ...(meta.picking as Record<string, unknown>) }
        : {} as Record<string, unknown>;
      const prev = Array.isArray(picking.mispickReported)
        ? (picking.mispickReported as Array<{ itemIndex?: number; note?: string | null }>).filter(
            (m) => m && Number.isInteger(m.itemIndex),
          )
        : [];
      const withoutIdx = prev.filter((m) => m.itemIndex !== itemIndex);
      const next = note && note.trim()
        ? [...withoutIdx, { itemIndex, note: note.trim() }]
        : withoutIdx;
      picking.mispickReported = next;
      meta.picking = picking;
      return { ...d, metadata: meta as Delivery['metadata'], updatedAt: new Date().toISOString() };
    });
    set({ deliveries: updated });
    get().saveToStorage(updated);
  },

  confirmPickingList: (deliveryId: string, confirmedBy?: string): void => {
    const deliveries = get().deliveries;
    const updated = deliveries.map((d) => {
      if (d.id !== deliveryId) return d;
      const meta = (d.metadata && typeof d.metadata === 'object')
        ? { ...(d.metadata as Record<string, unknown>) }
        : {} as Record<string, unknown>;
      const picking = (meta.picking && typeof meta.picking === 'object')
        ? { ...(meta.picking as Record<string, unknown>) }
        : {} as Record<string, unknown>;
      picking.confirmedAt = new Date().toISOString();
      if (confirmedBy) picking.confirmedBy = confirmedBy;
      meta.picking = picking;
      return {
        ...d,
        status: 'pickup-confirmed',
        metadata: meta as Delivery['metadata'],
        updatedAt: new Date().toISOString(),
      };
    });
    set({ deliveries: updated });
    get().saveToStorage(updated);
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

  setManageTabPreset: (preset): void => {
    set({ manageTabPreset: preset });
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
