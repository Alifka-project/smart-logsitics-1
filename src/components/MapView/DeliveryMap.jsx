import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix Leaflet default marker icons
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
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

    // Track all markers for bounds calculation
    const allMarkers = [];

    // Add warehouse marker
    const warehouseMarker = L.marker([25.0053, 55.0760], {
      icon: L.icon({
        iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png',
        shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
        iconSize: [25, 41],
        iconAnchor: [12, 41],
      }),
    })
      .addTo(mapInstance.current)
      .bindPopup(
        `<div style="font-family: Arial; font-size: 12px;">
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
        // Validate delivery has coordinates
        if (!delivery.lat || !delivery.lng || isNaN(delivery.lat) || isNaN(delivery.lng)) {
          console.warn(`Invalid coordinates for delivery ${index + 1}:`, delivery);
          skipCount++;
          return;
        }

        const lat = parseFloat(delivery.lat);
        const lng = parseFloat(delivery.lng);
        const color = delivery.priority === 1 ? 'red' : delivery.priority === 2 ? 'orange' : 'blue';
        
        // Create detailed popup with address info
        const popupContent = `
          <div style="font-family: Arial; font-size: 12px; min-width: 250px;">
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
            shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
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
          }
        } catch (e) {
          console.warn('Could not fit marker bounds:', e);
        }
      }
    }

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
      className="h-[400px] sm:h-[500px] lg:h-[600px] w-full rounded-lg bg-gray-100"
      style={{ position: 'relative' }}
    />
  );
}

