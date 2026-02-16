import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix Leaflet default marker icons
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: '/leaflet-images/marker-icon-2x.png',
  iconUrl: '/leaflet-images/marker-icon.png',
  shadowUrl: '/leaflet-images/marker-shadow.png',
});

export default function DeliveryMap({ deliveries, route }) {
  const mapRef = useRef(null);
  const mapInstance = useRef(null);
  const routeLayers = useRef([]);

  // Debug log
  useEffect(() => {
    console.log('DeliveryMap component received:', {
      deliveriesCount: deliveries?.length || 0,
      deliveries: deliveries,
      routeCoordinates: route?.coordinates?.length || 0
    });
  }, [deliveries, route]);

  useEffect(() => {
    if (!mapRef.current) return;

    // Initialize map with street-level zoom
    if (mapInstance.current) {
      mapInstance.current.remove();
    }

    mapInstance.current = L.map(mapRef.current).setView([25.0053, 55.0760], 13);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19,
      minZoom: 10
    }).addTo(mapInstance.current);

    // Force map to render correctly after initialization with multiple checks
    // This ensures the map properly sizes even when switching tabs
    const invalidateSizeWithRetry = () => {
      if (mapInstance.current) {
        mapInstance.current.invalidateSize();
        console.log('Map invalidateSize() called');
      }
    };

    // Call immediately
    setTimeout(invalidateSizeWithRetry, 0);
    // Call again after short delay
    setTimeout(invalidateSizeWithRetry, 100);
    // Call again after longer delay to handle tab switching
    setTimeout(invalidateSizeWithRetry, 300);
    // Final call to ensure map is properly sized
    setTimeout(invalidateSizeWithRetry, 500);

    // Track all markers for bounds calculation
    const allMarkers = [];

    // Add warehouse marker
    const warehouseMarker = L.marker([25.0053, 55.0760], {
      icon: L.icon({
        iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png',
        shadowUrl: '/leaflet-images/marker-shadow.png',
        iconSize: [25, 41],
        iconAnchor: [12, 41],
      }),
    })
      .addTo(mapInstance.current)
      .bindPopup(
        `<div style="font-family: 'Montserrat', 'Avenir', -apple-system, sans-serif; font-size: 12px;">
          <b style="font-size: 14px;">🏭 Warehouse (Start)</b><br>
          <strong>Location:</strong> Jebel Ali Free Zone<br>
          <strong>Coordinates:</strong> 25.0053, 55.0760<br>
          <strong>Status:</strong> Dispatch Point
        </div>`,
        { maxWidth: 300 }
      );
    
    allMarkers.push(warehouseMarker);

    // Add delivery markers with detailed popup info
    if (deliveries && deliveries.length > 0) {
      console.log(`Adding ${deliveries.length} delivery markers to map`);
      let successCount = 0;
      let skipCount = 0;

      deliveries.forEach((delivery, index) => {
        // Try multiple ways to get coordinates (handle different data formats)
        const latRaw = delivery.lat || delivery.Lat || delivery.latitude || delivery.Latitude;
        const lngRaw = delivery.lng || delivery.Lng || delivery.longitude || delivery.Longitude;

        // Parse coordinates
        const lat = parseFloat(latRaw);
        const lng = parseFloat(lngRaw);

        // Validate coordinates - check if they're valid numbers and within reasonable Dubai bounds
        if (!latRaw || !lngRaw || isNaN(lat) || isNaN(lng)) {
          console.warn(`Invalid coordinates for delivery ${index + 1}:`, {
            delivery,
            latRaw,
            lngRaw,
            lat,
            lng
          });
          skipCount++;
          return;
        }

        // Validate coordinates are within Dubai bounds (approximately)
        if (lat < 24.5 || lat > 25.5 || lng < 54.5 || lng > 56.0) {
          console.warn(`Coordinates out of Dubai bounds for delivery ${index + 1}:`, {
            lat,
            lng,
            delivery
          });
          // Still show it, but log a warning
        }

        const color = delivery.priority === 1 ? 'red' : delivery.priority === 2 ? 'orange' : 'blue';
        
        // Create detailed popup with address info
        const popupContent = `
          <div style="font-family: 'Montserrat', 'Avenir', -apple-system, sans-serif; font-size: 12px; min-width: 250px;">
            <b style="font-size: 14px; color: #667eea;">Stop ${index + 1}</b><br>
            <hr style="margin: 4px 0; border: none; border-top: 1px solid #ddd;">
            <div style="margin: 4px 0;">
              <strong>Customer:</strong> ${delivery.customer || 'N/A'}<br>
              <strong>Address:</strong> ${delivery.address || 'N/A'}<br>
              <strong>Coordinates:</strong> ${lat.toFixed(4)}, ${lng.toFixed(4)}<br>
              <strong>Items:</strong> ${delivery.items || 'N/A'}<br>
              <strong>Priority:</strong> 
              <span style="color: ${color === 'red' ? 'red' : color === 'orange' ? 'orange' : 'blue'}; font-weight: bold;">
                ${delivery.priority === 1 ? 'HIGH' : delivery.priority === 2 ? 'MEDIUM' : 'LOW'}
              </span><br>
              <strong>Distance from Warehouse:</strong> ${(delivery.distanceFromWarehouse || 0).toFixed(1)} km
            </div>
          </div>
        `;
        
        // Create marker with popup
        const marker = L.marker([lat, lng], {
          icon: L.icon({
            iconUrl: `https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-${color}.png`,
            shadowUrl: '/leaflet-images/marker-shadow.png',
            iconSize: [25, 41],
            iconAnchor: [12, 41],
          }),
          title: `Stop ${index + 1}: ${delivery.customer}`
        })
          .addTo(mapInstance.current)
          .bindPopup(popupContent, { maxWidth: 300, maxHeight: 300 });
        
        allMarkers.push(marker);
        successCount++;
      });
      
      console.log(`Successfully added ${successCount} delivery markers (${skipCount} skipped due to invalid coordinates) - Total markers with warehouse: ${allMarkers.length}`);
    } else {
      console.warn('No deliveries to display on map');
    }

    // Clear previous route layers
    routeLayers.current.forEach(layer => {
      if (mapInstance.current && mapInstance.current.hasLayer(layer)) {
        mapInstance.current.removeLayer(layer);
      }
    });
    routeLayers.current = [];

    // Draw route if available and has coordinates
    if (route && route.coordinates && route.coordinates.length > 0) {
      // Validate coordinates
      const validCoordinates = route.coordinates.filter(coord => {
        return Array.isArray(coord) && 
               coord.length === 2 && 
               !isNaN(coord[0]) && 
               !isNaN(coord[1]) &&
               coord[0] >= -90 && coord[0] <= 90 &&
               coord[1] >= -180 && coord[1] <= 180;
      });

      if (validCoordinates.length > 0) {
        // White outline (bottom layer)
        const outlineLayer = L.polyline(validCoordinates, {
          color: '#ffffff',
          weight: 8,
          opacity: 0.6,
          lineCap: 'round',
          lineJoin: 'round'
        }).addTo(mapInstance.current);
        routeLayers.current.push(outlineLayer);

        // Brand route (main layer)
        const routeLine = L.polyline(validCoordinates, {
          color: '#667eea',
          weight: 5,
          opacity: 0.9,
          lineCap: 'round',
          lineJoin: 'round'
        }).addTo(mapInstance.current);
        routeLayers.current.push(routeLine);

        // Animated overlay (dashed)
        const animatedLayer = L.polyline(validCoordinates, {
          color: '#764ba2',
          weight: 3,
          opacity: 0.7,
          dashArray: '15, 20',
          lineCap: 'round',
          lineJoin: 'round'
        }).addTo(mapInstance.current);
        routeLayers.current.push(animatedLayer);

        // Fit bounds to show entire route
        try {
          const bounds = routeLine.getBounds();
          if (bounds.isValid()) {
            mapInstance.current.fitBounds(bounds, { padding: [50, 50], maxZoom: 15 });
            // Force resize after fitting bounds
            setTimeout(() => mapInstance.current?.invalidateSize(), 100);
          }
        } catch (e) {
          console.warn('Could not fit route bounds:', e);
        }
      } else {
        console.warn('No valid coordinates in route');
        
        // Fit bounds to markers instead
        if (allMarkers.length > 0) {
          try {
            const group = new L.featureGroup(allMarkers);
            mapInstance.current.fitBounds(group.getBounds(), { padding: [50, 50], maxZoom: 14 });
            // Force resize after fitting bounds
            setTimeout(() => mapInstance.current?.invalidateSize(), 100);
          } catch (e) {
            console.warn('Could not fit marker bounds:', e);
          }
        }
      }
    } else {
      // No route data, fit bounds to all markers
      if (allMarkers.length > 0) {
        try {
          const group = new L.featureGroup(allMarkers);
          const bounds = group.getBounds();
          if (bounds.isValid()) {
            mapInstance.current.fitBounds(bounds, { padding: [50, 50], maxZoom: 14 });
            // Force resize after fitting bounds
            setTimeout(() => mapInstance.current?.invalidateSize(), 100);
          }
        } catch (e) {
          console.warn('Could not fit marker bounds:', e);
        }
      }
    }

    // Final invalidateSize call to ensure map is visible after all operations
    setTimeout(() => {
      if (mapInstance.current) {
        mapInstance.current.invalidateSize();
        console.log('Final map invalidateSize() called after all markers/routes added');
      }
    }, 600);

    return () => {
      routeLayers.current = [];
      if (mapInstance.current) {
        mapInstance.current.remove();
        mapInstance.current = null;
      }
    };
  }, [deliveries, route]);

  return (
    <div 
      ref={mapRef} 
      className="h-[400px] sm:h-[500px] lg:h-[600px] w-full rounded-lg bg-gray-100 dark:bg-gray-700"
      style={{ 
        position: 'relative', 
        zIndex: 1,
        minHeight: '400px',
        overflow: 'hidden'
      }}
    />
  );
}

