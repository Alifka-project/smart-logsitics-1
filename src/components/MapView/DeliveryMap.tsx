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
  // Accept any object that carries coordinates — callers don't need to fill
  // the full RouteResult shape since only .coordinates is used for rendering.
  route?: { coordinates: [number, number][] } | RouteResult | null;
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
  const driverMarkersRef = useRef<L.Marker[]>([]);
  // Only auto-fit bounds once on initial data load — never again so the user
  // can freely zoom/pan without being reset every 5 s.
  const hasInitialFit = useRef(false);

  // ── Effect 1: create the map ONCE, clean up on unmount ────────────────────
  useEffect(() => {
    if (!mapRef.current) return;

    const map = L.map(mapRef.current, {
      // Disable CSS zoom animation entirely so there is no in-flight transition
      // that can be interrupted when markers are updated during live polling.
      zoomAnimation: false,
    }).setView([25.0053, 55.076], 13);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19,
      minZoom: 10,
    }).addTo(map);

    // Warehouse marker (permanent, lives with the map)
    L.marker([25.0053, 55.076], {
      icon: L.icon({
        iconUrl:
          'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png',
        shadowUrl: '/leaflet-images/marker-shadow.png',
        iconSize: [25, 41],
        iconAnchor: [12, 41],
      }),
    })
      .addTo(map)
      .bindPopup(
        `<div style="font-family:'DM Sans','Inter',sans-serif;font-size:12px;">
          <b style="font-size:14px;">🏭 Warehouse (Start)</b><br>
          <strong>Location:</strong> Jebel Ali Free Zone<br>
          <strong>Coordinates:</strong> 25.0053, 55.0760<br>
          <strong>Status:</strong> Dispatch Point
        </div>`,
        { maxWidth: 300 },
      );

    mapInstance.current = map;
    setTimeout(() => map.invalidateSize(), 100);

    return () => {
      try { map.stop(); } catch { /* ignore */ }
      map.remove();
      mapInstance.current = null;
      hasInitialFit.current = false;
    };
  }, []); // run once

  // ── Effect 2: update delivery markers when deliveries change ──────────────
  useEffect(() => {
    const map = mapInstance.current;
    if (!map) return;

    // Remove old delivery markers
    deliveryMarkers.current.forEach((m) => { if (m) map.removeLayer(m); });
    deliveryMarkers.current = [];

    const newMarkers: (L.Marker | null)[] = [];
    const validForFit: L.Marker[] = [];

    deliveries.forEach((delivery, index) => {
      const d = delivery as Record<string, unknown>;
      const latRaw = (delivery.lat as unknown) || d['Lat'] || d['latitude'] || d['Latitude'];
      const lngRaw = (delivery.lng as unknown) || d['Lng'] || d['longitude'] || d['Longitude'];
      const lat = parseFloat(String(latRaw));
      const lng = parseFloat(String(lngRaw));

      if (!latRaw || !lngRaw || isNaN(lat) || isNaN(lng)) {
        newMarkers.push(null);
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
              (delivery as unknown as { items?: string | number }).items ?? 'N/A'
            }<br>
            <strong>ETA:</strong> ${(delivery as unknown as { etaMinutes?: number }).etaMinutes != null ? `${(delivery as unknown as { etaMinutes?: number }).etaMinutes} min` : 'Calculating...'}<br>
            <strong>Priority:</strong>
            <span style="color:${color === 'red' ? 'red' : color === 'orange' ? 'orange' : 'blue'};font-weight:bold;">
              ${delivery.priority === 1 ? 'HIGH' : delivery.priority === 2 ? 'MEDIUM' : 'LOW'}
            </span>
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
        .addTo(map)
        .bindPopup(popupContent, { maxWidth: 300, maxHeight: 300 });

      newMarkers.push(marker);
      validForFit.push(marker);
    });

    deliveryMarkers.current = newMarkers;

    // Fit bounds only on the first time we have delivery data
    if (!hasInitialFit.current && validForFit.length > 0) {
      hasInitialFit.current = true;
      try {
        const group = L.featureGroup(validForFit);
        const bounds = group.getBounds();
        if (bounds.isValid()) {
          map.fitBounds(bounds, { padding: [50, 50], maxZoom: 14, animate: false });
        }
      } catch { /* ignore */ }
    }
  }, [deliveries]);

  // ── Effect 3: update driver markers when driverLocations change ───────────
  useEffect(() => {
    const map = mapInstance.current;
    if (!map) return;

    driverMarkersRef.current.forEach((m) => map.removeLayer(m));
    driverMarkersRef.current = [];

    const truckSvg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#ffffff" width="20" height="20"><path d="M20 8h-3V4H3c-1.1 0-2 .9-2 2v11h2c0 1.66 1.34 3 3 3s3-1.34 3-3h6c0 1.66 1.34 3 3 3s3-1.34 3-3h2v-5l-3-4zM6 18.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm13.5-9l1.96 2.5H17V9.5h2.5zm-1.5 9c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"/></svg>';

    driverLocations.forEach((driver) => {
      const lat = Number(driver?.lat);
      const lng = Number(driver?.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

      const driverName = driver.name || driver.username || 'Driver';
      const marker = L.marker([lat, lng], {
        icon: L.divIcon({
          className: 'driver-truck-marker',
          html: `<div style="
            width:42px;height:42px;
            background:linear-gradient(135deg,#10b981 0%,#059669 100%);
            border:3px solid white;border-radius:10px;
            box-shadow:0 2px 8px rgba(0,0,0,.3);
            display:flex;align-items:center;justify-content:center;
          " title="${driverName}">${truckSvg}</div>`,
          iconSize: [42, 42],
          iconAnchor: [21, 21],
        }),
        title: driverName,
      })
        .addTo(map)
        .bindPopup(
          `<div style="font-family:'DM Sans','Inter',sans-serif;font-size:12px;min-width:200px;">
            <b style="font-size:14px;">🚚 ${driverName}</b><br>
            <strong>Status:</strong> ${driver.status || 'in transit'}<br>
            <strong>Speed:</strong> ${driver.speedKmh != null ? `${driver.speedKmh} km/h` : 'N/A'}<br>
            <strong>Location:</strong> ${lat.toFixed(4)}, ${lng.toFixed(4)}
          </div>`,
          { maxWidth: 280 },
        );

      driverMarkersRef.current.push(marker);
    });
  }, [driverLocations]);

  // ── Effect 4: update route polyline when route changes ────────────────────
  useEffect(() => {
    const map = mapInstance.current;
    if (!map) return;

    routeLayers.current.forEach((layer) => {
      if (map.hasLayer(layer)) map.removeLayer(layer);
    });
    routeLayers.current = [];

    if (!route?.coordinates?.length) return;

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

    if (!validCoordinates.length) return;

    const outline = L.polyline(validCoordinates, {
      color: '#ffffff', weight: 8, opacity: 0.6, lineCap: 'round', lineJoin: 'round',
    }).addTo(map);
    const line = L.polyline(validCoordinates, {
      color: '#667eea', weight: 5, opacity: 0.9, lineCap: 'round', lineJoin: 'round',
    }).addTo(map);
    const animated = L.polyline(validCoordinates, {
      color: '#764ba2', weight: 3, opacity: 0.7,
      dashArray: '15, 20', lineCap: 'round', lineJoin: 'round',
    }).addTo(map);

    routeLayers.current = [outline, line, animated];

    // Only fit to route on first load (hasInitialFit not yet set means no
    // deliveries arrived first; otherwise keep the user's current viewport).
    if (!hasInitialFit.current) {
      hasInitialFit.current = true;
      try {
        const bounds = line.getBounds();
        if (bounds.isValid()) {
          map.fitBounds(bounds, { padding: [50, 50], maxZoom: 15, animate: false });
        }
      } catch { /* ignore */ }
    }
  }, [route]);

  // ── Effect 5: pan to highlighted delivery marker ──────────────────────────
  useEffect(() => {
    if (!mapInstance.current) return;
    mapInstance.current.closePopup();
    if (highlightedIndex !== null && highlightedIndex !== undefined) {
      const marker = deliveryMarkers.current[highlightedIndex];
      if (marker) {
        mapInstance.current.panTo(marker.getLatLng(), { animate: false });
        setTimeout(() => {
          if (marker && mapInstance.current) marker.openPopup();
        }, 50);
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
