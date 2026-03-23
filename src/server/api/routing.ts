/**
 * Routing API - Road-following route proxy
 * Primary: Valhalla (valhalla.openstreetmap.de) — free, reliable, great UAE coverage
 * Fallback: OSRM public demo server
 */
import { Router } from 'express';
import axios from 'axios';
import { requireRole } from '../auth.js';

const router = Router();
const VALHALLA_BASE = 'https://valhalla.openstreetmap.de';
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

/** Decode Valhalla's polyline6 encoded shape into [lat, lng] pairs */
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

/**
 * POST /api/routing/osrm
 * Body: { locations: [{ lat, lng }] }
 * Returns road-following route coordinates (tries Valhalla first, falls back to OSRM)
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
router.post('/osrm', requireRole('admin'), async (req: any, res: any): Promise<void> => {
  const locations = req.body?.locations as Array<{ lat?: number; lng?: number }> | undefined;
  if (!Array.isArray(locations) || locations.length < 2) {
    res.status(400).json({ error: 'At least 2 locations required' });
    return;
  }

  const valid = locations.filter((loc) => {
    const lat = Number(loc?.lat);
    const lng = Number(loc?.lng);
    return Number.isFinite(lat) && Number.isFinite(lng);
  });

  if (valid.length < 2) {
    res.status(400).json({ error: 'Invalid coordinates' });
    return;
  }

  // ── Primary: Valhalla ─────────────────────────────────────────────────────
  try {
    const valhallaLocations = valid.map((loc) => ({
      lon: Number(loc.lng),
      lat: Number(loc.lat),
    }));

    const valhallaRes = await axios.post<ValhallaResponse>(
      `${VALHALLA_BASE}/route`,
      {
        locations: valhallaLocations,
        costing: 'auto',
        directions_options: { language: 'en-US' },
      },
      { timeout: 45000 },
    );

    const trip = valhallaRes.data?.trip;
    if (!trip?.legs?.length) throw new Error('Empty Valhalla response');

    let allCoords: [number, number][] = [];
    for (const leg of trip.legs) {
      if (typeof leg.shape === 'string') {
        allCoords = allCoords.concat(decodePolyline6(leg.shape));
      } else if (leg.shape && typeof leg.shape === 'object') {
        // GeoJSON shape — coordinates are [lon, lat]
        const geoCoords = (leg.shape as { coordinates: [number, number][] }).coordinates.map(
          ([lon, latVal]) => [latVal, lon] as [number, number],
        );
        allCoords = allCoords.concat(geoCoords);
      }
    }

    if (!allCoords.length) throw new Error('No coordinates from Valhalla');

    const distanceM = (trip.summary?.length ?? 0) * 1000;
    const durationS = trip.summary?.time ?? 0;

    console.log(`[Routing] Valhalla OK — ${allCoords.length} points, ${(distanceM / 1000).toFixed(1)} km`);
    res.json({
      coordinates: allCoords,
      distance: distanceM,
      duration: durationS,
      legs: trip.legs,
      source: 'valhalla',
    });
    return;
  } catch (valhallaErr: unknown) {
    console.warn('[Routing] Valhalla failed, trying OSRM:', (valhallaErr as { message?: string }).message);
  }

  // ── Fallback: OSRM public server ──────────────────────────────────────────
  try {
    const coordinates = valid.map((loc) => `${Number(loc.lng)},${Number(loc.lat)}`).join(';');
    const url = `${OSRM_BASE}/route/v1/driving/${coordinates}?overview=full&geometries=geojson&steps=true`;

    const response = await axios.get<{
      code?: string;
      routes?: Array<{
        distance: number;
        duration: number;
        geometry: { coordinates: [number, number][] };
        legs?: unknown[];
      }>;
    }>(url, { timeout: 45000 });

    if (!response.data || response.data.code !== 'Ok') {
      throw new Error(`OSRM routing failed: ${response.data?.code || 'Unknown'}`);
    }

    const route = response.data.routes?.[0];
    if (!route?.geometry?.coordinates) throw new Error('Invalid OSRM response');

    const coords: [number, number][] = route.geometry.coordinates.map(
      (c) => [c[1], c[0]] as [number, number],
    );

    console.log(`[Routing] OSRM fallback OK — ${coords.length} points`);
    res.json({
      coordinates: coords,
      distance: route.distance,
      duration: route.duration,
      legs: route.legs || [],
      source: 'osrm',
    });
  } catch (err: unknown) {
    const e = err as { message?: string };
    console.error('[Routing] All routing providers failed:', e.message);
    res.status(502).json({
      error: 'Routing service unavailable',
      message: e.message || 'Unknown error',
    });
  }
});

export default router;
