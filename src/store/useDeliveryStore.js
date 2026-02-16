import { create } from 'zustand';
import { calculateDistance } from '../utils/distanceCalculator';
import { assignPriorities } from '../utils/priorityCalculator';

const WAREHOUSE_LAT = 25.0053;
const WAREHOUSE_LNG = 55.0760;
const STORAGE_KEY = 'deliveries_data';

const useDeliveryStore = create((set, get) => ({
  // State
  deliveries: [],
  selectedDelivery: null,
  route: null,
  isLoading: false,
  currentPage: 'list',
  
  // Initialize from localStorage
  initializeFromStorage: () => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const deliveries = JSON.parse(stored);
        
        // ✅ CHECK: If deliveries have fake IDs (delivery-1, delivery-2), clear them
        const hasFakeIds = deliveries.some(d => {
          const id = d.id || '';
          // Check if ID is in format "delivery-X" (fake ID) instead of UUID
          return id.match(/^delivery-\d+$/);
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

  // Save to localStorage
  saveToStorage: (deliveries) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(deliveries));
    } catch (error) {
      console.error('Failed to save to localStorage:', error);
    }
  },

  // Actions
  loadDeliveries: (data) => {
    try {
      console.log(`[Store] Loading ${data.length} deliveries...`);
      
      // Check first delivery ID to see if we have database UUIDs or fake IDs
      if (data.length > 0) {
        const firstId = data[0].id || '';
        const isUUID = firstId.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
        console.log(`[Store] First delivery ID: ${firstId} (${isUUID ? 'UUID ✓' : 'NOT UUID ✗'})`);
      }
      
      // 1. Calculate distance from warehouse using Haversine
      const deliveriesWithDistance = data.map((delivery, index) => {
        // Try multiple ways to get coordinates (handle different data formats)
        const latRaw = delivery.lat || delivery.Lat || delivery.latitude || delivery.Latitude;
        const lngRaw = delivery.lng || delivery.Lng || delivery.longitude || delivery.Longitude;
        
        const lat = Number.parseFloat(latRaw);
        const lng = Number.parseFloat(lngRaw);
        
        // Use provided coordinates if valid, otherwise use defaults
        const safeLat = (Number.isFinite(lat) && lat !== 0) ? lat : 25.1124;
        const safeLng = (Number.isFinite(lng) && lng !== 0) ? lng : 55.1980;

        // ⚠️ WARNING: Only generate fake ID if NO ID exists (should not happen with database data)
        const finalId = delivery.id || `delivery-${index + 1}`;
        if (!delivery.id) {
          console.warn(`[Store] ⚠️ Delivery ${index + 1} missing ID! Generating fake ID: ${finalId}`);
          console.warn('[Store] This should not happen if data came from database!');
        }

        return {
          ...delivery,
          id: finalId,
          lat: safeLat,
          lng: safeLng,
          // Preserve original coordinates if they exist
          originalLat: latRaw !== undefined ? latRaw : null,
          originalLng: lngRaw !== undefined ? lngRaw : null,
          distanceFromWarehouse: calculateDistance(
            WAREHOUSE_LAT,
            WAREHOUSE_LNG,
            safeLat,
            safeLng
          ),
          status: delivery.status || 'pending',
          estimatedTime: new Date(Date.now() + (index + 1) * 75 * 60 * 1000), // 75 min per stop
        };
      });

      // 2. Sort by distance and assign priorities
      const prioritized = assignPriorities(deliveriesWithDistance);
      
      set({ deliveries: prioritized });
      
      // Save to localStorage
      get().saveToStorage(prioritized);
    } catch (error) {
      console.error('Error loading deliveries:', error);
      throw error;
    }
  },
  
  updateDeliveryStatus: (id, status, updateData) => {
    const deliveries = get().deliveries;
    const updated = deliveries.map(delivery => {
      if (delivery.id === id) {
        return {
          ...delivery,
          status,
          ...updateData,
          updatedAt: new Date(),
        };
      }
      return delivery;
    });
    
    set({ deliveries: updated });
    
    // Save updated deliveries to localStorage
    get().saveToStorage(updated);
  },
  
  selectDelivery: (id) => {
    const delivery = get().deliveries.find(d => d.id === id);
    set({ selectedDelivery: delivery });
  },

  updateDeliveryOrder: (reorderedDeliveries) => {
    set({ deliveries: reorderedDeliveries });
    // Save updated order to localStorage
    get().saveToStorage(reorderedDeliveries);
  },
  
  clearDeliveries: () => {
    set({ deliveries: [], selectedDelivery: null });
    localStorage.removeItem(STORAGE_KEY);
  },
  
  calculateRoute: async () => {
    // This will be called by the map page component
    set({ isLoading: true });
    // Route calculation is handled in MapViewPage
    set({ isLoading: false });
  },
  // Set route into store (used by upload flow to precompute route)
  setRoute: (route) => {
    set({ route });
  },
}));

export default useDeliveryStore;

