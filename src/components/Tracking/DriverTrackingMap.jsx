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

export default function DriverTrackingMap({ drivers }) {
  const mapRef = useRef(null);
  const mapInstance = useRef(null);
  const markersRef = useRef({});

  useEffect(() => {
    if (!mapRef.current) return;

    // Initialize map
    if (mapInstance.current) {
      mapInstance.current.remove();
    }

    mapInstance.current = L.map(mapRef.current).setView([25.0053, 55.0760], 12);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19,
      minZoom: 10
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

    // Remove old markers
    Object.values(markersRef.current).forEach(marker => {
      if (mapInstance.current && mapInstance.current.hasLayer(marker)) {
        mapInstance.current.removeLayer(marker);
      }
    });
    markersRef.current = {};

    // Add markers for drivers with locations
    const validMarkers = [];
    drivers.forEach(driver => {
      if (driver.tracking?.location) {
        const { lat, lng, heading } = driver.tracking.location;
        const driverName = driver.full_name || driver.name || driver.username || 'Unknown Driver';
        const isOnline = driver.tracking.online;

        // Create custom icon
        const icon = L.divIcon({
          className: 'driver-marker',
          html: `<div style="
            width: 32px;
            height: 32px;
            background: ${isOnline ? '#10b981' : '#6b7280'};
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
          iconAnchor: [16, 16]
        });

        const marker = L.marker([lat, lng], { icon })
          .addTo(mapInstance.current)
          .bindPopup(`
            <div style="font-family: Arial; font-size: 12px; min-width: 200px;">
              <b style="font-size: 14px;">🚚 ${driverName}</b><br>
              <hr style="margin: 4px 0; border: none; border-top: 1px solid #ddd;">
              <div style="margin: 4px 0;">
                <strong>Status:</strong> 
                <span style="color: ${isOnline ? '#10b981' : '#6b7280'}; font-weight: bold;">
                  ${driver.tracking.status || 'unknown'}
                </span><br>
                <strong>Location:</strong> ${lat.toFixed(4)}, ${lng.toFixed(4)}<br>
                ${heading ? `<strong>Heading:</strong> ${heading.toFixed(0)}°<br>` : ''}
                ${driver.tracking.location.speed ? `<strong>Speed:</strong> ${(driver.tracking.location.speed * 3.6).toFixed(0)} km/h<br>` : ''}
                <strong>Last Update:</strong> ${new Date(driver.tracking.location.timestamp).toLocaleTimeString()}<br>
                ${driver.phone ? `<strong>Phone:</strong> ${driver.phone}<br>` : ''}
              </div>
            </div>
          `, { maxWidth: 250 });

        markersRef.current[driver.id] = marker;
        validMarkers.push(marker);
      }
    });

    // Fit bounds to show all drivers
    if (validMarkers.length > 0) {
      try {
        const group = new L.featureGroup(validMarkers);
        mapInstance.current.fitBounds(group.getBounds(), { padding: [50, 50], maxZoom: 14 });
      } catch (e) {
        console.warn('Could not fit driver bounds:', e);
      }
    }
  }, [drivers]);

  return (
    <div 
      ref={mapRef} 
      className="h-[500px] w-full rounded-lg bg-gray-100"
      style={{ position: 'relative' }}
    />
  );
}

