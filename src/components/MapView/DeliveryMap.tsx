import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Delivery, RouteResult } from '../../types';
import type { DriverRoute } from '../../services/advancedRoutingService';

// UAE bounding box (covers all 7 emirates + a small margin)
const UAE_LAT_MIN = 22.0, UAE_LAT_MAX = 26.5;
const UAE_LNG_MIN = 51.0, UAE_LNG_MAX = 56.5;

/**
 * Validates coordinates against the UAE bounding box.
 * Auto-corrects the common GeoJSON lat/lng swap bug:
 *   some importers store coordinates as [lng, lat] instead of [lat, lng].
 * Returns [lat, lng] or null when coordinates cannot be resolved to UAE.
 */
function resolveUAECoords(a: number, b: number): [number, number] | null {
  const inUAE = (la: number, lo: number) =>
    la >= UAE_LAT_MIN && la <= UAE_LAT_MAX && lo >= UAE_LNG_MIN && lo <= UAE_LNG_MAX;
  if (inUAE(a, b)) return [a, b];        // already correct
  if (inUAE(b, a)) return [b, a];        // lat/lng swapped — auto-fix
  return null;                            // not in UAE bounding box
}

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
  /** Per-driver OSRM routes — each rendered with the driver's distinct color. */
  driverRoutes?: DriverRoute[];
}

export default function DeliveryMap({
  deliveries,
  route,
  highlightedIndex,
  mapClassName,
  driverLocations = [],
  driverRoutes = [],
}: DeliveryMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<L.Map | null>(null);
  const routeLayers = useRef<L.Layer[]>([]);
  const driverRouteLayers = useRef<L.Layer[]>([]);
  const deliveryMarkers = useRef<(L.Marker | null)[]>([]);
  const driverMarkersRef = useRef<L.Marker[]>([]);
  // Auto-fit on first data load — never again once user has panned/zoomed.
  const hasInitialFit = useRef(false);
  // Set to true when a real user gesture (drag/scroll-zoom/pinch) is detected.
  // After that, we stop calling fitBounds on any live update.
  const userInteracted = useRef(false);

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
        `<div style="font-family:var(--font-sans);font-size:12px;">
          <b style="font-size:14px;">🏭 Warehouse (Start)</b><br>
          <strong>Location:</strong> Jebel Ali Free Zone<br>
          <strong>Coordinates:</strong> 25.0053, 55.0760<br>
          <strong>Status:</strong> Dispatch Point
        </div>`,
        { maxWidth: 300 },
      );

    mapInstance.current = map;
    setTimeout(() => map.invalidateSize(), 100);

    // Detect real user interaction via native DOM events attached to Leaflet's
    // movestart/zoomstart events.  Programmatic calls (fitBounds, panTo) also
    // fire these events but WITHOUT an originalEvent, so we can tell them apart.
    const onMoveStart = (e: L.LeafletEvent & { originalEvent?: Event }) => {
      if (e.originalEvent) userInteracted.current = true;
    };
    const onZoomStart = (e: L.LeafletEvent & { originalEvent?: Event }) => {
      if (e.originalEvent) userInteracted.current = true;
    };
    map.on('movestart', onMoveStart as L.LeafletEventHandlerFn);
    map.on('zoomstart', onZoomStart as L.LeafletEventHandlerFn);

    return () => {
      try { map.stop(); } catch { /* ignore */ }
      map.remove();
      mapInstance.current = null;
      hasInitialFit.current = false;
      userInteracted.current = false;
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
      const latRaw = (delivery.lat as unknown) ?? d['Lat'] ?? d['latitude'] ?? d['Latitude'];
      const lngRaw = (delivery.lng as unknown) ?? d['Lng'] ?? d['longitude'] ?? d['Longitude'];
      const latParsed = parseFloat(String(latRaw));
      const lngParsed = parseFloat(String(lngRaw));

      // Validate UAE bounds and auto-correct lat/lng swap
      if (isNaN(latParsed) || isNaN(lngParsed)) {
        newMarkers.push(null);
        return;
      }
      const resolved = resolveUAECoords(latParsed, lngParsed);
      if (!resolved) {
        newMarkers.push(null);
        return;
      }
      const [lat, lng] = resolved;

      const isPriorityMeta = (delivery as unknown as { metadata?: { isPriority?: boolean } }).metadata?.isPriority === true;
      const color = isPriorityMeta ? 'red' : 'blue';

      const priorityLabel = isPriorityMeta ? 'URGENT' : 'NORMAL';

      const popupContent = `
        <div style="font-family:var(--font-sans);font-size:12px;min-width:250px;">
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
            <span style="color:${color === 'red' ? 'red' : 'blue'};font-weight:bold;">
              ${priorityLabel}
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

    // Fit bounds only on first data load, and only if the user hasn't already
    // panned or zoomed (userInteracted guards against late-arriving data
    // resetting a zoom the user manually set).
    if (!hasInitialFit.current && !userInteracted.current && validForFit.length > 0) {
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
      const st = String(driver.status || '').toLowerCase();
      const isLiveSession = st === 'online' || st === 'in transit' || st === 'in_progress' || st === 'in-progress';
      const pinGradient = isLiveSession
        ? 'linear-gradient(135deg,#10b981 0%,#059669 100%)'
        : 'linear-gradient(135deg,#f59e0b 0%,#d97706 100%)';
      const marker = L.marker([lat, lng], {
        icon: L.divIcon({
          className: 'driver-truck-marker',
          html: `<div style="
            width:42px;height:42px;
            background:${pinGradient};
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
          `<div style="font-family:var(--font-sans);font-size:12px;min-width:200px;">
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

  // ── Effect 4: update aggregate route polyline when route changes ─────────
  useEffect(() => {
    const map = mapInstance.current;
    if (!map) return;

    routeLayers.current.forEach((layer) => {
      if (map.hasLayer(layer)) map.removeLayer(layer);
    });
    routeLayers.current = [];

    // When per-driver routes are present the aggregate route is suppressed
    // to avoid overloading the map with two sets of lines.
    if (driverRoutes.length > 0) return;

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

    // Only fit to route on first load — skip if user has already panned/zoomed.
    if (!hasInitialFit.current && !userInteracted.current) {
      hasInitialFit.current = true;
      try {
        const bounds = line.getBounds();
        if (bounds.isValid()) {
          map.fitBounds(bounds, { padding: [50, 50], maxZoom: 15, animate: false });
        }
      } catch { /* ignore */ }
    }
  }, [route, driverRoutes]);

  // ── Effect 4b: per-driver colored route polylines ────────────────────────
  useEffect(() => {
    const map = mapInstance.current;
    if (!map) return;

    driverRouteLayers.current.forEach((layer) => {
      if (map.hasLayer(layer)) map.removeLayer(layer);
    });
    driverRouteLayers.current = [];

    if (!driverRoutes.length) return;

    driverRoutes.forEach((dr) => {
      if (!dr.coordinates.length) return;

      const valid = dr.coordinates.filter(
        (c) =>
          Array.isArray(c) &&
          c.length === 2 &&
          !isNaN(c[0]) && !isNaN(c[1]) &&
          c[0] >= -90 && c[0] <= 90 &&
          c[1] >= -180 && c[1] <= 180,
      ) as [number, number][];

      if (valid.length < 2) return;

      const outline = L.polyline(valid, {
        color: '#ffffff', weight: 7, opacity: 0.5, lineCap: 'round', lineJoin: 'round',
      }).addTo(map);
      const line = L.polyline(valid, {
        color: dr.color, weight: 4, opacity: 0.9, lineCap: 'round', lineJoin: 'round',
      }).addTo(map);
      line.bindPopup(
        `<div style="font-family:var(--font-sans);font-size:12px;">
          <b style="color:${dr.color};">🚚 ${dr.name}</b><br>
          <small>Route from current GPS position</small>
        </div>`,
        { maxWidth: 240 },
      );

      driverRouteLayers.current.push(outline, line);
    });

    if (!hasInitialFit.current && !userInteracted.current) {
      hasInitialFit.current = true;
      try {
        const allCoords = driverRoutes.flatMap((dr) => dr.coordinates) as [number, number][];
        if (allCoords.length > 0) {
          const bounds = L.latLngBounds(allCoords);
          if (bounds.isValid()) {
            map.fitBounds(bounds, { padding: [50, 50], maxZoom: 15, animate: false });
          }
        }
      } catch { /* ignore */ }
    }
  }, [driverRoutes]);

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
