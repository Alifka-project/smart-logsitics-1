import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Driver } from '../../types';

delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)['_getIconUrl'];
L.Icon.Default.mergeOptions({
  iconRetinaUrl: '/leaflet-images/marker-icon-2x.png',
  iconUrl: '/leaflet-images/marker-icon.png',
  shadowUrl: '/leaflet-images/marker-shadow.png',
});

interface DriverTrackingMapProps {
  drivers: Driver[];
}

export default function DriverTrackingMap({ drivers }: DriverTrackingMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<L.Map | null>(null);
  const markersRef = useRef<Record<string, L.Marker>>({});

  useEffect(() => {
    if (!mapRef.current) return;

    if (mapInstance.current) {
      mapInstance.current.remove();
    }

    mapInstance.current = L.map(mapRef.current).setView([25.0053, 55.076], 12);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19,
      minZoom: 10,
    }).addTo(mapInstance.current);

    return () => {
      if (mapInstance.current) {
        mapInstance.current.remove();
        mapInstance.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!mapInstance.current || !drivers) return;

    Object.values(markersRef.current).forEach((marker) => {
      if (mapInstance.current && mapInstance.current.hasLayer(marker)) {
        mapInstance.current.removeLayer(marker);
      }
    });
    markersRef.current = {};

    const validMarkers: L.Marker[] = [];
    drivers.forEach((driver) => {
      const isOnline = driver.tracking?.online;
      if (driver.tracking?.location && isOnline) {
        const { lat, lng, heading } = driver.tracking.location;
        const driverRaw = driver as unknown as Record<string, unknown>;
        const driverName =
          driver.full_name ||
          (driverRaw['name'] as string | undefined) ||
          (driverRaw['username'] as string | undefined) ||
          'Unknown Driver';

        const icon = L.divIcon({
          className: 'driver-marker',
          html: `<div style="
            width: 32px;
            height: 32px;
            background: #10b981;
            border: 3px solid white;
            border-radius: 50%;
            box-shadow: 0 2px 4px rgba(0,0,0,0.3);
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-weight: bold;
            font-size: 14px;
          ">${driverName.charAt(0).toUpperCase()}</div>`,
          iconSize: [32, 32],
          iconAnchor: [16, 16],
        });

        const speedKmh = driver.tracking.location.speed
          ? (driver.tracking.location.speed * 3.6).toFixed(0)
          : null;

        const marker = L.marker([lat, lng], { icon })
          .addTo(mapInstance.current!)
          .bindPopup(
            `<div style="font-family: 'DM Sans', 'Inter', -apple-system, sans-serif; font-size: 12px; min-width: 200px;">
              <b style="font-size: 14px;">🚚 ${driverName}</b><br>
              <hr style="margin: 4px 0; border: none; border-top: 1px solid #ddd;">
              <div style="margin: 4px 0;">
                <strong>Status:</strong>
                <span style="color: #10b981; font-weight: bold;">
                  ${driver.tracking.status ?? 'unknown'}
                </span><br>
                <strong>Location:</strong> ${lat.toFixed(4)}, ${lng.toFixed(4)}<br>
                ${heading ? `<strong>Heading:</strong> ${heading.toFixed(0)}°<br>` : ''}
                ${speedKmh ? `<strong>Speed:</strong> ${speedKmh} km/h<br>` : ''}
                <strong>Last Update:</strong> ${new Date(driver.tracking.location.timestamp ?? '').toLocaleTimeString()}<br>
                ${driver.phone ? `<strong>Phone:</strong> ${driver.phone}<br>` : ''}
              </div>
            </div>`,
            { maxWidth: 250 },
          );

        markersRef.current[driver.id ?? ''] = marker;
        validMarkers.push(marker);
      }
    });

    if (validMarkers.length > 0) {
      try {
        const group = L.featureGroup(validMarkers);
        mapInstance.current!.fitBounds(group.getBounds(), { padding: [50, 50], maxZoom: 14 });
      } catch (e) {
        console.warn('Could not fit driver bounds:', e);
      }
    }
  }, [drivers]);

  return (
    <div
      ref={mapRef}
      className="h-[36vh] min-h-[240px] sm:h-[420px] lg:h-[500px] w-full rounded-lg bg-gray-100"
      style={{ position: 'relative' }}
    />
  );
}
