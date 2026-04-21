/**
 * Server-side geocoder for the auto-ingest path.
 *
 * Used ONLY by /api/ingest/file when an incoming row has no usable
 * coordinates (transformer marked `_usedDefaultCoords: true`). Does not
 * affect manual upload — which continues to use the browser-side
 * src/services/geocodingService.ts with an interactive modal.
 *
 * Provider cascade (first available wins per row):
 *   1. Mapbox        — env MAPBOX_TOKEN     (best; matches portal primary)
 *   2. Google Maps   — env GOOGLE_GEOCODING_KEY
 *   3. Nominatim     — free, no key, uses OpenStreetMap
 *
 * If none of the keyed providers are configured, Nominatim is used
 * automatically. No configuration required for the free fallback.
 *
 * Rate limits handled:
 *   - Mapbox / Google: parallel-safe (no throttling needed for batch < 50)
 *   - Nominatim: 1 req/sec per their usage policy (enforced via sleep)
 *
 * In-memory cache per-instance prevents duplicate lookups in a batch.
 */

import axios from 'axios';

const MAPBOX_URL = 'https://api.mapbox.com/geocoding/v5/mapbox.places';
const GOOGLE_URL = 'https://maps.googleapis.com/maps/api/geocode/json';
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';

const DUBAI_BOUNDS_GOOGLE = '24.7,54.8|25.5,55.7';
const DUBAI_BBOX_MAPBOX = '54.8,24.7,55.7,25.5';     // minLng,minLat,maxLng,maxLat
const DUBAI_BBOX_NOMINATIM = '54.8,25.5,55.7,24.7'; // left,top,right,bottom

interface GeocodeHit {
  lat: number;
  lng: number;
  provider: 'mapbox' | 'google' | 'nominatim';
}

const cache = new Map<string, GeocodeHit | null>();

function normalizeKey(address: string): string {
  return String(address).trim().replace(/\s+/g, ' ').toLowerCase();
}

function mapboxToken(): string {
  return (process.env.MAPBOX_TOKEN || process.env.VITE_MAPBOX_TOKEN || '').trim();
}

function googleKey(): string {
  return (
    process.env.GOOGLE_GEOCODING_KEY ||
    process.env.GOOGLE_MAPS_API_KEY ||
    process.env.VITE_GOOGLE_GEOCODING_KEY ||
    ''
  ).trim();
}

/** Returns list of provider names currently available. */
export function availableProviders(): string[] {
  const p: string[] = [];
  if (mapboxToken()) p.push('mapbox');
  if (googleKey()) p.push('google');
  p.push('nominatim'); // always available
  return p;
}

// Simple sleep helper — Nominatim requires 1 req/sec
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function tryMapbox(address: string): Promise<GeocodeHit | null> {
  const token = mapboxToken();
  if (!token) return null;
  try {
    const url = `${MAPBOX_URL}/${encodeURIComponent(address)}.json`;
    const { data } = await axios.get(url, {
      params: { access_token: token, bbox: DUBAI_BBOX_MAPBOX, country: 'ae', limit: 1 },
      timeout: 10000,
    });
    const feat = data?.features?.[0];
    if (!feat?.center || feat.center.length < 2) return null;
    return { lng: feat.center[0], lat: feat.center[1], provider: 'mapbox' };
  } catch (e) {
    console.warn(`[Geocoder/Mapbox] "${address}": ${(e as Error).message}`);
    return null;
  }
}

async function tryGoogle(address: string): Promise<GeocodeHit | null> {
  const key = googleKey();
  if (!key) return null;
  try {
    const { data } = await axios.get(GOOGLE_URL, {
      params: { address, key, components: 'country:AE', bounds: DUBAI_BOUNDS_GOOGLE },
      timeout: 10000,
    });
    if (data?.status !== 'OK') return null;
    const loc = data.results?.[0]?.geometry?.location;
    if (!loc) return null;
    return { lat: loc.lat, lng: loc.lng, provider: 'google' };
  } catch (e) {
    console.warn(`[Geocoder/Google] "${address}": ${(e as Error).message}`);
    return null;
  }
}

// Throttle Nominatim — they require 1 req/sec max. Module-scope timestamp.
let lastNominatimAt = 0;
async function tryNominatim(address: string): Promise<GeocodeHit | null> {
  const elapsed = Date.now() - lastNominatimAt;
  if (elapsed < 1100) await sleep(1100 - elapsed);
  lastNominatimAt = Date.now();

  try {
    const { data } = await axios.get(NOMINATIM_URL, {
      params: {
        q: address,
        format: 'json',
        countrycodes: 'ae',
        viewbox: DUBAI_BBOX_NOMINATIM,
        bounded: 1,
        limit: 1,
      },
      headers: {
        // Nominatim requires a valid User-Agent identifying the app
        'User-Agent': 'Electrolux-Smart-Logistics/1.0 (auto-ingest)',
      },
      timeout: 15000,
    });
    if (!Array.isArray(data) || data.length === 0) return null;
    const r = data[0];
    const lat = parseFloat(r.lat);
    const lng = parseFloat(r.lon);
    if (isNaN(lat) || isNaN(lng)) return null;
    return { lat, lng, provider: 'nominatim' };
  } catch (e) {
    console.warn(`[Geocoder/Nominatim] "${address}": ${(e as Error).message}`);
    return null;
  }
}

/** Geocode a single address using the provider cascade. */
export async function geocodeOne(addressRaw: string): Promise<GeocodeHit | null> {
  if (!addressRaw) return null;
  const key = normalizeKey(addressRaw);
  if (cache.has(key)) return cache.get(key) ?? null;

  // Try in order of best → cheapest
  const hit =
    (await tryMapbox(addressRaw)) ||
    (await tryGoogle(addressRaw)) ||
    (await tryNominatim(addressRaw));

  cache.set(key, hit);
  if (hit) {
    console.log(`[Geocoder] "${addressRaw}" → ${hit.lat},${hit.lng} via ${hit.provider}`);
  } else {
    console.warn(`[Geocoder] No match for "${addressRaw}" across any provider`);
  }
  return hit;
}

/**
 * Geocode a batch of rows that have _usedDefaultCoords: true.
 * Mutates rows in-place; rows that fail keep default coords.
 */
export async function geocodeMissingCoords<
  T extends { address?: string; lat?: number; lng?: number; _usedDefaultCoords?: boolean }
>(rows: T[]): Promise<{ attempted: number; succeeded: number; failed: number; providers: string[] }> {
  const providers = availableProviders();
  let succeeded = 0;
  let failed = 0;
  let attempted = 0;

  for (const row of rows) {
    if (!row._usedDefaultCoords) continue;
    attempted += 1;
    const addr = String(row.address || '').trim();
    if (!addr) {
      failed += 1;
      continue;
    }
    const hit = await geocodeOne(addr);
    if (hit) {
      row.lat = hit.lat;
      row.lng = hit.lng;
      row._usedDefaultCoords = false;
      succeeded += 1;
    } else {
      failed += 1;
    }
  }

  if (attempted > 0) {
    console.log(
      `[Geocoder] Batch done — attempted=${attempted}, succeeded=${succeeded}, failed=${failed}, providers=[${providers.join(',')}]`,
    );
  }
  return { attempted, succeeded, failed, providers };
}

// Legacy alias kept for backwards compat with any caller that may use it.
export function isGeocoderConfigured(): boolean {
  // Always true now — Nominatim is always available as last resort.
  return true;
}
