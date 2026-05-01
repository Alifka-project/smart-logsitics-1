/**
 * Server-side geocoder.
 *
 * Used by:
 *   - /api/ingest/file (batch geocoding rows that lack coordinates)
 *   - /api/deliveries/admin/:id/status (re-geocode when an admin edits address)
 *
 * Provider cascade (first available wins per row):
 *   1. Mapbox        — env MAPBOX_TOKEN     (best; matches portal primary)
 *   2. Google Maps   — env GOOGLE_GEOCODING_KEY
 *   3. Nominatim     — free, no key, uses OpenStreetMap
 *
 * If none of the keyed providers are configured, Nominatim is used
 * automatically. No configuration required for the free fallback.
 *
 * UAE-wide coverage (mirrors src/services/geocodingService.ts on the client):
 *   - Each provider asks for top 3 candidates, not 1.
 *   - Broad-area matches (country/state/city/locality) are rejected — only
 *     street/POI-level results are accepted, otherwise we keep cascading.
 *   - Result lat/lng is validated against the UAE bounding box even when the
 *     provider claimed it honored our bbox/region filter (defensive).
 *   - When the address text mentions an emirate, the query is augmented with
 *     that emirate as context (e.g. "Al Ain Mall" → "Al Ain Mall, Al Ain,
 *     Abu Dhabi, UAE") so providers don't bias toward Dubai for ambiguous
 *     names. We try the augmented query first, then the raw text as fallback.
 *
 * Rate limits handled:
 *   - Mapbox / Google: parallel-safe (no throttling needed for batch < 50)
 *   - Nominatim: 1 req/sec per their usage policy (enforced via sleep)
 *
 * In-memory cache per-process prevents duplicate lookups within a batch.
 * The cache resets on each server restart, so a redeploy after a logic
 * change naturally invalidates any prior poisoned entries.
 */

import axios from 'axios';

const MAPBOX_URL = 'https://api.mapbox.com/geocoding/v5/mapbox.places';
const GOOGLE_URL = 'https://maps.googleapis.com/maps/api/geocode/json';
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';

// UAE bounding box — covers all 7 emirates + Al Ain.
const UAE_BBOX = { minLng: 51.5, maxLng: 56.4, minLat: 22.6, maxLat: 26.1 } as const;
const UAE_BOUNDS_GOOGLE = `${UAE_BBOX.minLat},${UAE_BBOX.minLng}|${UAE_BBOX.maxLat},${UAE_BBOX.maxLng}`;
const UAE_BBOX_MAPBOX = `${UAE_BBOX.minLng},${UAE_BBOX.minLat},${UAE_BBOX.maxLng},${UAE_BBOX.maxLat}`;
const UAE_BBOX_NOMINATIM = `${UAE_BBOX.minLng},${UAE_BBOX.maxLat},${UAE_BBOX.maxLng},${UAE_BBOX.minLat}`;

// Place types we never accept — these are too broad to pin a delivery.
const TOO_BROAD_TYPES = new Set([
  'country', 'state', 'county', 'region', 'province',
  'administrative', 'city', 'town', 'village', 'municipality', 'locality',
]);

interface GeocodeHit {
  lat: number;
  lng: number;
  provider: 'mapbox' | 'google' | 'nominatim';
}

const cache = new Map<string, GeocodeHit | null>();

function normalizeKey(address: string): string {
  return String(address).trim().replace(/\s+/g, ' ').toLowerCase();
}

function inUAE(lat: number, lng: number): boolean {
  if (!isFinite(lat) || !isFinite(lng)) return false;
  return (
    lat >= UAE_BBOX.minLat && lat <= UAE_BBOX.maxLat &&
    lng >= UAE_BBOX.minLng && lng <= UAE_BBOX.maxLng
  );
}

/**
 * Detect a UAE emirate name in the address text and return a context suffix
 * suitable for appending to the geocoder query. Order matters — multi-word
 * names ("ras al khaimah", "umm al quwain", "al ain") must be checked before
 * single-word substrings to avoid e.g. "ajman" matching inside "ras al khaimah".
 */
function detectEmirateContext(text: string): string {
  const t = text.toLowerCase();
  if (t.includes('ras al khaimah') || /\brak\b/.test(t)) return 'Ras Al Khaimah, UAE';
  if (t.includes('umm al quwain') || /\buaq\b/.test(t)) return 'Umm Al Quwain, UAE';
  if (t.includes('al ain')) return 'Al Ain, Abu Dhabi, UAE';
  if (t.includes('abu dhabi')) return 'Abu Dhabi, UAE';
  if (t.includes('sharjah')) return 'Sharjah, UAE';
  if (t.includes('ajman')) return 'Ajman, UAE';
  if (t.includes('fujairah')) return 'Fujairah, UAE';
  if (t.includes('dubai')) return 'Dubai, UAE';
  return '';
}

/**
 * Build the ordered list of query variants to try. Each variant is a single
 * string we send to the provider. Variants are deduplicated.
 */
function buildQueryVariants(address: string): string[] {
  const raw = address.trim();
  const ctx = detectEmirateContext(raw);
  const variants: string[] = [];

  // Already includes the emirate? Send as-is first; otherwise prepend the
  // emirate context to bias the provider away from Dubai-default ambiguity.
  if (ctx && !raw.toLowerCase().includes(ctx.split(',')[0].toLowerCase())) {
    variants.push(`${raw}, ${ctx}`);
  }
  variants.push(raw);

  // Drop unit/floor/parens noise as a last attempt.
  const stripped = raw
    .replace(/\b(flat|apt|apartment|unit|suite|ste|building|bldg|floor|fl)\b[^,]*/gi, '')
    .replace(/#\d+/g, '')
    .replace(/\([^)]*\)|\[[^\]]*\]/g, '')
    .trim();
  if (stripped && stripped !== raw) {
    if (ctx && !stripped.toLowerCase().includes(ctx.split(',')[0].toLowerCase())) {
      variants.push(`${stripped}, ${ctx}`);
    } else {
      variants.push(stripped);
    }
  }

  return Array.from(new Set(variants));
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

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

interface MapboxFeature { center?: number[]; place_type?: string[]; place_name?: string }

async function tryMapbox(query: string): Promise<GeocodeHit | null> {
  const token = mapboxToken();
  if (!token) return null;
  try {
    const url = `${MAPBOX_URL}/${encodeURIComponent(query)}.json`;
    const { data } = await axios.get(url, {
      params: {
        access_token: token,
        bbox: UAE_BBOX_MAPBOX,
        country: 'ae',
        limit: 3,
        types: 'address,poi,place,neighborhood,locality',
      },
      timeout: 10000,
    });
    const features: MapboxFeature[] = data?.features || [];
    for (const feat of features) {
      const center = feat.center;
      if (!center || center.length < 2) continue;
      const lng = center[0];
      const lat = center[1];
      if (!inUAE(lat, lng)) continue;
      const type = (feat.place_type?.[0] || '').toLowerCase();
      if (TOO_BROAD_TYPES.has(type)) continue;
      return { lat, lng, provider: 'mapbox' };
    }
    return null;
  } catch (e) {
    console.warn(`[Geocoder/Mapbox] "${query}": ${(e as Error).message}`);
    return null;
  }
}

interface GoogleResult {
  geometry?: { location?: { lat: number; lng: number } };
  types?: string[];
  formatted_address?: string;
}

async function tryGoogle(query: string): Promise<GeocodeHit | null> {
  const key = googleKey();
  if (!key) return null;
  try {
    const { data } = await axios.get(GOOGLE_URL, {
      params: { address: query, key, components: 'country:AE', bounds: UAE_BOUNDS_GOOGLE },
      timeout: 10000,
    });
    if (data?.status !== 'OK') return null;
    const results: GoogleResult[] = data.results || [];
    // Prefer street-level / premise; fall back to any non-broad UAE result.
    const isSpecific = (types: string[]): boolean =>
      types.includes('street_address') || types.includes('premise') ||
      types.includes('subpremise') || types.includes('route');
    const isBroad = (types: string[]): boolean => types.some((t) => TOO_BROAD_TYPES.has(t));

    let pick: GoogleResult | null = null;
    for (const r of results) {
      const loc = r.geometry?.location;
      if (!loc || !inUAE(loc.lat, loc.lng)) continue;
      const types = r.types || [];
      if (isSpecific(types)) { pick = r; break; }
      if (!pick && !isBroad(types)) pick = r;
    }
    if (!pick?.geometry?.location) return null;
    return { lat: pick.geometry.location.lat, lng: pick.geometry.location.lng, provider: 'google' };
  } catch (e) {
    console.warn(`[Geocoder/Google] "${query}": ${(e as Error).message}`);
    return null;
  }
}

interface NominatimResult { lat: string; lon: string; addresstype?: string; type?: string }

let lastNominatimAt = 0;
async function tryNominatim(query: string): Promise<GeocodeHit | null> {
  const elapsed = Date.now() - lastNominatimAt;
  if (elapsed < 1100) await sleep(1100 - elapsed);
  lastNominatimAt = Date.now();

  try {
    const { data } = await axios.get(NOMINATIM_URL, {
      params: {
        q: query,
        format: 'json',
        countrycodes: 'ae',
        viewbox: UAE_BBOX_NOMINATIM,
        bounded: 1,
        addressdetails: 1,
        limit: 3,
      },
      headers: {
        'User-Agent': 'Electrolux-Smart-Logistics/1.0 (auto-ingest)',
      },
      timeout: 15000,
    });
    if (!Array.isArray(data) || data.length === 0) return null;
    for (const r of data as NominatimResult[]) {
      const lat = parseFloat(r.lat);
      const lng = parseFloat(r.lon);
      if (isNaN(lat) || isNaN(lng) || !inUAE(lat, lng)) continue;
      const type = (r.addresstype || r.type || '').toLowerCase();
      if (TOO_BROAD_TYPES.has(type)) continue;
      return { lat, lng, provider: 'nominatim' };
    }
    return null;
  } catch (e) {
    console.warn(`[Geocoder/Nominatim] "${query}": ${(e as Error).message}`);
    return null;
  }
}

/**
 * Geocode a single address using the provider cascade.
 *
 * For each query variant (emirate-augmented first, then raw, then unit-stripped),
 * try Mapbox → Google → Nominatim. First specific UAE-bounded hit wins.
 */
export async function geocodeOne(addressRaw: string): Promise<GeocodeHit | null> {
  if (!addressRaw) return null;
  const key = normalizeKey(addressRaw);
  if (cache.has(key)) return cache.get(key) ?? null;

  const variants = buildQueryVariants(addressRaw);
  let hit: GeocodeHit | null = null;
  for (const q of variants) {
    hit = (await tryMapbox(q)) || (await tryGoogle(q)) || (await tryNominatim(q));
    if (hit) break;
  }

  cache.set(key, hit);
  if (hit) {
    console.log(`[Geocoder] "${addressRaw}" → ${hit.lat},${hit.lng} via ${hit.provider}`);
  } else {
    console.warn(`[Geocoder] No specific UAE match for "${addressRaw}" across any provider`);
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
