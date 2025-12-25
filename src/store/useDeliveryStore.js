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
      // 1. Calculate distance from warehouse using Haversine
      const deliveriesWithDistance = data.map((delivery, index) => {
        const lat = Number.parseFloat(delivery.lat);
        const lng = Number.parseFloat(delivery.lng);
        const safeLat = Number.isFinite(lat) ? lat : 25.1124;
        const safeLng = Number.isFinite(lng) ? lng : 55.1980;

        return {
          ...delivery,
          id: `delivery-${index + 1}`,
          lat: safeLat,
          lng: safeLng,
          distanceFromWarehouse: calculateDistance(
            WAREHOUSE_LAT,
            WAREHOUSE_LNG,
            safeLat,
            safeLng
          ),
          status: 'pending',
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

