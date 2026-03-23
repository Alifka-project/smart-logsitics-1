import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Delivery, RouteResult } from '../../types';

// Fix Leaflet default marker icons
delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)['_getIconUrl'];
L.Icon.Default.mergeOptions({
  iconRetinaUrl: '/leaflet-images/marker-icon-2x.png',
  iconUrl: '/leaflet-images/marker-icon.png',
  shadowUrl: '/leaflet-images/marker-shadow.png',
});

interface DeliveryMapProps {
  deliveries: Delivery[];
  route?: RouteResult | null;
  highlightedIndex?: number | null;
  mapClassName?: string;
  driverLocations?: Array<{
    id?: string | number;
    name?: string;
    username?: string;
    status?: string;
    speedKmh?: number | null;
    lat?: number;
    lng?: number;
  }>;
}

function fitAllMarkersInView(map: L.Map, markers: L.Marker[]): void {
  if (!map || !markers.length) return;
  try {
    const group = L.featureGroup(markers);
    const bounds = group.getBounds();
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 14 });
      setTimeout(() => map?.invalidateSize(), 100);
    }
  } catch (e) {
    console.warn('Could not fit marker bounds:', e);
  }
}

export default function DeliveryMap({
  deliveries,
  route,
  highlightedIndex,
  mapClassName,
  driverLocations = [],
}: DeliveryMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<L.Map | null>(null);
  const routeLayers = useRef<L.Layer[]>([]);
  const deliveryMarkers = useRef<(L.Marker | null)[]>([]);

  useEffect(() => {
    if (!mapRef.current) return;

    if (mapInstance.current) {
      mapInstance.current.remove();
    }

    deliveryMarkers.current = [];

    mapInstance.current = L.map(mapRef.current).setView([25.0053, 55.076], 13);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19,
      minZoom: 10,
    }).addTo(mapInstance.current);

    const inv = (): void => { mapInstance.current?.invalidateSize(); };
    setTimeout(inv, 0);
    setTimeout(inv, 100);
    setTimeout(inv, 300);
    setTimeout(inv, 500);

    const allMarkers: L.Marker[] = [];

    const warehouseMarker = L.marker([25.0053, 55.0760], {
      icon: L.icon({
        iconUrl:
          'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png',
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
        { maxWidth: 300 },
      );

    allMarkers.push(warehouseMarker);

    if (deliveries && deliveries.length > 0) {
      deliveries.forEach((delivery, index) => {
        const d = delivery as Record<string, unknown>;
        const latRaw = (delivery.lat as unknown) || d['Lat'] || d['latitude'] || d['Latitude'];
        const lngRaw = (delivery.lng as unknown) || d['Lng'] || d['longitude'] || d['Longitude'];
        const lat = parseFloat(String(latRaw));
        const lng = parseFloat(String(lngRaw));

        if (!latRaw || !lngRaw || isNaN(lat) || isNaN(lng)) {
          deliveryMarkers.current.push(null);
          return;
        }

        const color =
          delivery.priority === 1 ? 'red' : delivery.priority === 2 ? 'orange' : 'blue';

        const popupContent = `
          <div style="font-family:'DM Sans','Inter',sans-serif;font-size:12px;min-width:250px;">
            <b style="font-size:14px;color:#667eea;">Stop ${index + 1}</b><br>
            <hr style="margin:4px 0;border:none;border-top:1px solid #ddd;">
            <div style="margin:4px 0;">
              <strong>Customer:</strong> ${delivery.customer ?? 'N/A'}<br>
              <strong>Address:</strong> ${delivery.address ?? 'N/A'}<br>
              <strong>Coordinates:</strong> ${lat.toFixed(4)}, ${lng.toFixed(4)}<br>
              <strong>Items:</strong> ${
                (delivery as unknown as { items?: string | number; itemCount?: number }).items ||
                (delivery as unknown as { items?: string | number; itemCount?: number }).itemCount ||
                'N/A'
              }<br>
              <strong>ETA:</strong> ${(delivery as unknown as { etaMinutes?: number }).etaMinutes != null ? `${(delivery as unknown as { etaMinutes?: number }).etaMinutes} min` : 'Calculating...'}<br>
              <strong>ETA / item:</strong> ${(delivery as unknown as { etaPerItemMinutes?: number }).etaPerItemMinutes != null ? `${(delivery as unknown as { etaPerItemMinutes?: number }).etaPerItemMinutes} min` : 'N/A'}<br>
              <strong>Priority:</strong>
              <span style="color:${color === 'red' ? 'red' : color === 'orange' ? 'orange' : 'blue'};font-weight:bold;">
                ${delivery.priority === 1 ? 'HIGH' : delivery.priority === 2 ? 'MEDIUM' : 'LOW'}
              </span><br>
              <strong>Distance from Warehouse:</strong> ${(delivery.distanceFromWarehouse ?? 0).toFixed(1)} km
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
          title: `Stop ${index + 1}: ${delivery.customer}`,
        })
          .addTo(mapInstance.current!)
          .bindPopup(popupContent, { maxWidth: 300, maxHeight: 300 });

        allMarkers.push(marker);
        deliveryMarkers.current.push(marker);
      });
    }

    if (driverLocations && driverLocations.length > 0) {
      driverLocations.forEach((driver) => {
        const lat = Number(driver?.lat);
        const lng = Number(driver?.lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

        const driverName = driver.name || driver.username || 'Driver';
        const truckSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#ffffff" width="20" height="20"><path d="M20 8h-3V4H3c-1.1 0-2 .9-2 2v11h2c0 1.66 1.34 3 3 3s3-1.34 3-3h6c0 1.66 1.34 3 3 3s3-1.34 3-3h2v-5l-3-4zM6 18.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm13.5-9l1.96 2.5H17V9.5h2.5zm-1.5 9c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"/></svg>';
        const marker = L.marker([lat, lng], {
          icon: L.divIcon({
            className: 'driver-truck-marker',
            html: `<div style="
              width: 42px;
              height: 42px;
              background: linear-gradient(135deg, #10b981 0%, #059669 100%);
              border: 3px solid white;
              border-radius: 10px;
              box-shadow: 0 2px 8px rgba(0,0,0,0.3);
              display: flex;
              align-items: center;
              justify-content: center;
            " title="${driverName}">${truckSvg}</div>`,
            iconSize: [42, 42],
            iconAnchor: [21, 21],
          }),
          title: driverName,
        })
          .addTo(mapInstance.current!)
          .bindPopup(
            `<div style="font-family:'DM Sans','Inter',sans-serif;font-size:12px;min-width:200px;">
              <b style="font-size:14px;">🚚 ${driverName}</b><br>
              <strong>Status:</strong> ${driver.status || 'in transit'}<br>
              <strong>Speed:</strong> ${driver.speedKmh != null ? `${driver.speedKmh} km/h` : 'N/A'}<br>
              <strong>Location:</strong> ${lat.toFixed(4)}, ${lng.toFixed(4)}
            </div>`,
            { maxWidth: 280 },
          );
        allMarkers.push(marker);
      });
    }

    routeLayers.current.forEach((layer) => {
      if (mapInstance.current?.hasLayer(layer)) mapInstance.current.removeLayer(layer);
    });
    routeLayers.current = [];

    if (route && route.coordinates && route.coordinates.length > 0) {
      const validCoordinates = route.coordinates.filter(
        (coord) =>
          Array.isArray(coord) &&
          coord.length === 2 &&
          !isNaN(coord[0]) &&
          !isNaN(coord[1]) &&
          coord[0] >= -90 &&
          coord[0] <= 90 &&
          coord[1] >= -180 &&
          coord[1] <= 180,
      ) as [number, number][];

      if (validCoordinates.length > 0) {
        const outlineLayer = L.polyline(validCoordinates, {
          color: '#ffffff',
          weight: 8,
          opacity: 0.6,
          lineCap: 'round',
          lineJoin: 'round',
        }).addTo(mapInstance.current!);
        routeLayers.current.push(outlineLayer);

        const routeLine = L.polyline(validCoordinates, {
          color: '#667eea',
          weight: 5,
          opacity: 0.9,
          lineCap: 'round',
          lineJoin: 'round',
        }).addTo(mapInstance.current!);
        routeLayers.current.push(routeLine);

        const animatedLayer = L.polyline(validCoordinates, {
          color: '#764ba2',
          weight: 3,
          opacity: 0.7,
          dashArray: '15, 20',
          lineCap: 'round',
          lineJoin: 'round',
        }).addTo(mapInstance.current!);
        routeLayers.current.push(animatedLayer);

        try {
          const bounds = routeLine.getBounds();
          if (bounds.isValid()) {
            mapInstance.current!.fitBounds(bounds, { padding: [50, 50], maxZoom: 15 });
            setTimeout(inv, 100);
          }
        } catch (e) {
          console.warn('Could not fit route bounds:', e);
        }
      } else {
        fitAllMarkersInView(mapInstance.current!, allMarkers);
      }
    } else {
      fitAllMarkersInView(mapInstance.current!, allMarkers);
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
  }, [deliveries, route, driverLocations]);

  useEffect(() => {
    if (!mapInstance.current) return;

    mapInstance.current.closePopup();

    if (highlightedIndex !== null && highlightedIndex !== undefined) {
      const marker = deliveryMarkers.current[highlightedIndex];
      if (marker) {
        mapInstance.current.panTo(marker.getLatLng(), { animate: true, duration: 0.3 });
        setTimeout(() => {
          if (marker && mapInstance.current) {
            marker.openPopup();
          }
        }, 320);
      }
    }
  }, [highlightedIndex]);

  const heightClass = mapClassName ?? 'h-[34vh] min-h-[220px] sm:h-[420px] lg:h-[600px]';

  return (
    <div
      ref={mapRef}
      className={`w-full rounded-lg bg-gray-100 dark:bg-gray-700 ${heightClass}`}
      style={{ position: 'relative', zIndex: 1, minHeight: '220px', overflow: 'hidden' }}
    />
  );
}
