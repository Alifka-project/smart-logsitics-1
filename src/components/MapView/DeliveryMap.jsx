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

export default function DeliveryMap({ deliveries, route, highlightedIndex, mapClassName }) {
  const mapRef = useRef(null);
  const mapInstance = useRef(null);
  const routeLayers = useRef([]);
  const deliveryMarkers = useRef([]); // refs to delivery markers (indexed same as deliveries array)

  // ── Map initialisation ── runs when deliveries or route changes
  useEffect(() => {
    if (!mapRef.current) return;

    if (mapInstance.current) {
      mapInstance.current.remove();
    }

    deliveryMarkers.current = [];

    mapInstance.current = L.map(mapRef.current).setView([25.0053, 55.0760], 13);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19,
      minZoom: 10
    }).addTo(mapInstance.current);

    // Staggered invalidateSize calls — needed when map is inside a flex/grid container
    const inv = () => mapInstance.current?.invalidateSize();
    setTimeout(inv, 0);
    setTimeout(inv, 100);
    setTimeout(inv, 300);
    setTimeout(inv, 500);

    const allMarkers = [];

    // Warehouse marker
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
        `<div style="font-family:'DM Sans','Inter',sans-serif;font-size:12px;">
          <b style="font-size:14px;">🏭 Warehouse (Start)</b><br>
          <strong>Location:</strong> Jebel Ali Free Zone<br>
          <strong>Coordinates:</strong> 25.0053, 55.0760<br>
          <strong>Status:</strong> Dispatch Point
        </div>`,
        { maxWidth: 300 }
      );

    allMarkers.push(warehouseMarker);

    // Delivery markers
    if (deliveries && deliveries.length > 0) {
      deliveries.forEach((delivery, index) => {
        const latRaw = delivery.lat || delivery.Lat || delivery.latitude || delivery.Latitude;
        const lngRaw = delivery.lng || delivery.Lng || delivery.longitude || delivery.Longitude;
        const lat = parseFloat(latRaw);
        const lng = parseFloat(lngRaw);

        if (!latRaw || !lngRaw || isNaN(lat) || isNaN(lng)) {
          deliveryMarkers.current.push(null); // keep index alignment
          return;
        }

        const color = delivery.priority === 1 ? 'red' : delivery.priority === 2 ? 'orange' : 'blue';

        const popupContent = `
          <div style="font-family:'DM Sans','Inter',sans-serif;font-size:12px;min-width:250px;">
            <b style="font-size:14px;color:#667eea;">Stop ${index + 1}</b><br>
            <hr style="margin:4px 0;border:none;border-top:1px solid #ddd;">
            <div style="margin:4px 0;">
              <strong>Customer:</strong> ${delivery.customer || 'N/A'}<br>
              <strong>Address:</strong> ${delivery.address || 'N/A'}<br>
              <strong>Coordinates:</strong> ${lat.toFixed(4)}, ${lng.toFixed(4)}<br>
              <strong>Items:</strong> ${delivery.items || 'N/A'}<br>
              <strong>Priority:</strong>
              <span style="color:${color === 'red' ? 'red' : color === 'orange' ? 'orange' : 'blue'};font-weight:bold;">
                ${delivery.priority === 1 ? 'HIGH' : delivery.priority === 2 ? 'MEDIUM' : 'LOW'}
              </span><br>
              <strong>Distance from Warehouse:</strong> ${(delivery.distanceFromWarehouse || 0).toFixed(1)} km
            </div>
          </div>
        `;

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
        deliveryMarkers.current.push(marker);
      });
    }

    // Clear previous route layers
    routeLayers.current.forEach(layer => {
      if (mapInstance.current?.hasLayer(layer)) mapInstance.current.removeLayer(layer);
    });
    routeLayers.current = [];

    // Draw route
    if (route && route.coordinates && route.coordinates.length > 0) {
      const validCoordinates = route.coordinates.filter(coord =>
        Array.isArray(coord) &&
        coord.length === 2 &&
        !isNaN(coord[0]) &&
        !isNaN(coord[1]) &&
        coord[0] >= -90 && coord[0] <= 90 &&
        coord[1] >= -180 && coord[1] <= 180
      );

      if (validCoordinates.length > 0) {
        const outlineLayer = L.polyline(validCoordinates, {
          color: '#ffffff', weight: 8, opacity: 0.6, lineCap: 'round', lineJoin: 'round'
        }).addTo(mapInstance.current);
        routeLayers.current.push(outlineLayer);

        const routeLine = L.polyline(validCoordinates, {
          color: '#667eea', weight: 5, opacity: 0.9, lineCap: 'round', lineJoin: 'round'
        }).addTo(mapInstance.current);
        routeLayers.current.push(routeLine);

        const animatedLayer = L.polyline(validCoordinates, {
          color: '#764ba2', weight: 3, opacity: 0.7, dashArray: '15, 20', lineCap: 'round', lineJoin: 'round'
        }).addTo(mapInstance.current);
        routeLayers.current.push(animatedLayer);

        try {
          const bounds = routeLine.getBounds();
          if (bounds.isValid()) {
            mapInstance.current.fitBounds(bounds, { padding: [50, 50], maxZoom: 15 });
            setTimeout(inv, 100);
          }
        } catch (e) {
          console.warn('Could not fit route bounds:', e);
        }
      } else {
        fitAllMarkersInView(mapInstance.current, allMarkers);
      }
    } else {
      fitAllMarkersInView(mapInstance.current, allMarkers);
    }

    setTimeout(() => {
      mapInstance.current?.invalidateSize();
    }, 600);

    return () => {
      routeLayers.current = [];
      deliveryMarkers.current = [];
      if (mapInstance.current) {
        mapInstance.current.remove();
        mapInstance.current = null;
      }
    };
  }, [deliveries, route]);

  // ── Hover highlight ── runs only when highlightedIndex changes, no map reinit
  useEffect(() => {
    if (!mapInstance.current) return;

    mapInstance.current.closePopup();

    if (highlightedIndex !== null && highlightedIndex !== undefined) {
      const marker = deliveryMarkers.current[highlightedIndex];
      if (marker) {
        mapInstance.current.panTo(marker.getLatLng(), { animate: true, duration: 0.3 });
        // Small delay so pan finishes before popup appears
        setTimeout(() => {
          if (marker && mapInstance.current) {
            marker.openPopup();
          }
        }, 320);
      }
    }
  }, [highlightedIndex]);

  const heightClass = mapClassName || 'h-[400px] sm:h-[500px] lg:h-[600px]';

  return (
    <div
      ref={mapRef}
      className={`w-full rounded-lg bg-gray-100 dark:bg-gray-700 ${heightClass}`}
      style={{ position: 'relative', zIndex: 1, minHeight: '400px', overflow: 'hidden' }}
    />
  );
}

function fitAllMarkersInView(map, markers) {
  if (!map || !markers.length) return;
  try {
    const group = new L.featureGroup(markers);
    const bounds = group.getBounds();
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 14 });
      setTimeout(() => map?.invalidateSize(), 100);
    }
  } catch (e) {
    console.warn('Could not fit marker bounds:', e);
  }
}
