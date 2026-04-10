/**
 * Road-following route between two points (Valhalla → OSRM fallback).
 * Used for public customer map polyline (token-gated) and can be shared with admin routing.
 */
import axios from 'axios';

const VALHALLA_BASE = 'https://valhalla1.openstreetmap.de';
const OSRM_BASE = 'https://router.project-osrm.org';

interface ValhallaLeg {
  shape: string | { type: string; coordinates: [number, number][] };
}

interface ValhallaResponse {
  trip?: {
    legs?: ValhallaLeg[];
    summary?: { length: number; time: number };
  };
}

function decodePolyline6(encoded: string): [number, number][] {
  const coords: [number, number][] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  while (index < encoded.length) {
    let b: number;
    let shift = 0;
    let result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    shift = 0;
    result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;
    coords.push([lat / 1e6, lng / 1e6]);
  }
  return coords;
}

export interface DrivingRouteResult {
  coordinates: [number, number][];
  source: 'valhalla' | 'osrm';
  distanceM: number;
  durationS: number;
}

/**
 * Returns [lat, lng][] along roads from A to B, or null if all providers fail.
 */
export async function fetchDrivingRouteBetweenPoints(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
): Promise<DrivingRouteResult | null> {
  const a = { lat: Number(from.lat), lng: Number(from.lng) };
  const b = { lat: Number(to.lat), lng: Number(to.lng) };
  if (![a.lat, a.lng, b.lat, b.lng].every((n) => Number.isFinite(n))) {
    return null;
  }

  try {
    const valhallaRes = await axios.post<ValhallaResponse>(
      `${VALHALLA_BASE}/route`,
      {
        locations: [
          { lon: a.lng, lat: a.lat },
          { lon: b.lng, lat: b.lat },
        ],
        costing: 'auto',
        directions_options: { language: 'en-US' },
      },
      { timeout: 45000 },
    );

    const trip = valhallaRes.data?.trip;
    if (trip?.legs?.length) {
      let allCoords: [number, number][] = [];
      for (const leg of trip.legs) {
        if (typeof leg.shape === 'string') {
          allCoords = allCoords.concat(decodePolyline6(leg.shape));
        } else if (leg.shape && typeof leg.shape === 'object') {
          const geoCoords = (leg.shape as { coordinates: [number, number][] }).coordinates.map(
            ([lon, latVal]) => [latVal, lon] as [number, number],
          );
          allCoords = allCoords.concat(geoCoords);
        }
      }
      if (allCoords.length) {
        const distanceM = (trip.summary?.length ?? 0) * 1000;
        const durationS = trip.summary?.time ?? 0;
        return { coordinates: allCoords, source: 'valhalla', distanceM, durationS };
      }
    }
  } catch {
    // fall through to OSRM
  }

  try {
    const coordinates = `${a.lng},${a.lat};${b.lng},${b.lat}`;
    const url = `${OSRM_BASE}/route/v1/driving/${coordinates}?overview=full&geometries=geojson&steps=true`;

    const response = await axios.get<{
      code?: string;
      routes?: Array<{
        distance: number;
        duration: number;
        geometry: { coordinates: [number, number][] };
      }>;
    }>(url, { timeout: 45000 });

    if (response.data?.code !== 'Ok') return null;
    const route = response.data.routes?.[0];
    if (!route?.geometry?.coordinates?.length) return null;

    const coords: [number, number][] = route.geometry.coordinates.map(
      (c) => [c[1], c[0]] as [number, number],
    );
    return {
      coordinates: coords,
      source: 'osrm',
      distanceM: route.distance,
      durationS: route.duration,
    };
  } catch {
    return null;
  }
}
