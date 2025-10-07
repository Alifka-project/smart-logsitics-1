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

  useEffect(() => {
    if (!mapRef.current) return;

    // Initialize map
    mapInstance.current = L.map(mapRef.current).setView([25.0053, 55.0760], 11);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
    }).addTo(mapInstance.current);

    // Add warehouse marker
    L.marker([25.0053, 55.0760], {
      icon: L.icon({
        iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png',
        shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
        iconSize: [25, 41],
        iconAnchor: [12, 41],
      }),
    })
      .addTo(mapInstance.current)
      .bindPopup('<b>🏭 Warehouse</b><br>Jebel Ali Free Zone');

    // Add delivery markers
    deliveries.forEach((delivery, index) => {
      const color = delivery.priority === 1 ? 'red' : delivery.priority === 2 ? 'orange' : 'blue';
      
      L.marker([delivery.lat, delivery.lng], {
        icon: L.icon({
          iconUrl: `https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-${color}.png`,
          shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
          iconSize: [25, 41],
          iconAnchor: [12, 41],
        }),
      })
        .addTo(mapInstance.current)
        .bindPopup(
          `<b>Stop ${index + 1}: ${delivery.customer}</b><br>
          ${delivery.address}<br>
          Priority: ${delivery.priority}<br>
          📦 ${delivery.items}<br>
          🚗 ${delivery.distanceFromWarehouse.toFixed(1)} km from warehouse`
        );
    });

    // Draw route if available
    if (route && route.coordinates) {
      // White outline
      L.polyline(route.coordinates, {
        color: '#ffffff',
        weight: 8,
        opacity: 0.6,
      }).addTo(mapInstance.current);

      // Purple route
      const routeLine = L.polyline(route.coordinates, {
        color: '#667eea',
        weight: 5,
        opacity: 0.9,
      }).addTo(mapInstance.current);

      // Animated overlay
      L.polyline(route.coordinates, {
        color: '#764ba2',
        weight: 3,
        opacity: 0.7,
        dashArray: '15, 20',
      }).addTo(mapInstance.current);

      // Fit bounds
      mapInstance.current.fitBounds(routeLine.getBounds(), { padding: [50, 50] });
    }

    return () => {
      if (mapInstance.current) {
        mapInstance.current.remove();
      }
    };
  }, [deliveries, route]);

  return <div ref={mapRef} className="h-[600px] w-full rounded-lg" />;
}

