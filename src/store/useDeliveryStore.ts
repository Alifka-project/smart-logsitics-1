import { create } from 'zustand';
import { calculateDistance } from '../utils/distanceCalculator';
import { assignPriorities } from '../utils/priorityCalculator';
import { isUnrecognizableAddress } from '../utils/addressHandler';
import type { Delivery, RouteResult } from '../types';

const WAREHOUSE_LAT = 25.0053;
const WAREHOUSE_LNG = 55.076;
const STORAGE_KEY = 'deliveries_data';

interface DeliveryStore {
  // State
  deliveries: Delivery[];
  selectedDelivery: Delivery | null;
  route: RouteResult | null;
  isLoading: boolean;
  currentPage: string;

  // Actions
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
}

const useDeliveryStore = create<DeliveryStore>((set, get) => ({
  // State
  deliveries: [],
  selectedDelivery: null,
  route: null,
  isLoading: false,
  currentPage: 'list',

  initializeFromStorage: (): Delivery[] => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const deliveries: Delivery[] = JSON.parse(stored);

        const hasFakeIds = deliveries.some((d) => {
          const id = d.id || '';
          return /^delivery-\d+$/.test(id);
        });

        if (hasFakeIds) {
          console.warn('[Store] ⚠️ Detected old fake IDs (delivery-1, etc). Clearing localStorage.');
          console.warn('[Store] Please re-upload your deliveries to get database UUIDs.');
          localStorage.removeItem(STORAGE_KEY);
          set({ deliveries: [] });
          return [];
        }

        console.log(`[Store] ✓ Loaded ${deliveries.length} deliveries from localStorage with valid UUIDs`);
        set({ deliveries });
        return deliveries;
      }
    } catch (error) {
      console.error('Failed to load from localStorage:', error);
    }
    return [];
  },

  saveToStorage: (deliveries: Delivery[]): void => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(deliveries));
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
        return {
          ...delivery,
          status,
          ...updateData,
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
    localStorage.removeItem(STORAGE_KEY);
  },

  calculateRoute: async (): Promise<void> => {
    set({ isLoading: true });
    set({ isLoading: false });
  },

  setRoute: (route: RouteResult): void => {
    set({ route });
  },
}));

export default useDeliveryStore;
