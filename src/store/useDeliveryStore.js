import { create } from 'zustand';
import { calculateDistance } from '../utils/distanceCalculator';
import { assignPriorities } from '../utils/priorityCalculator';

const WAREHOUSE_LAT = 25.0053;
const WAREHOUSE_LNG = 55.0760;

const useDeliveryStore = create((set, get) => ({
  // State
  deliveries: [],
  selectedDelivery: null,
  route: null,
  isLoading: false,
  currentPage: 'list',
  
  // Actions
  loadDeliveries: (data) => {
    // 1. Calculate distance from warehouse using Haversine
    const deliveriesWithDistance = data.map((delivery, index) => ({
      ...delivery,
      id: `delivery-${index + 1}`,
      distanceFromWarehouse: calculateDistance(
        WAREHOUSE_LAT,
        WAREHOUSE_LNG,
        delivery.lat,
        delivery.lng
      ),
      status: 'pending',
      estimatedTime: new Date(Date.now() + (index + 1) * 75 * 60 * 1000), // 75 min per stop
    }));

    // 2. Sort by distance and assign priorities
    const prioritized = assignPriorities(deliveriesWithDistance);
    
    set({ deliveries: prioritized });
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
  },
  
  selectDelivery: (id) => {
    const delivery = get().deliveries.find(d => d.id === id);
    set({ selectedDelivery: delivery });
  },
  
  calculateRoute: async () => {
    // This will be called by the map page component
    set({ isLoading: true });
    // Route calculation is handled in MapViewPage
    set({ isLoading: false });
  },
}));

export default useDeliveryStore;

