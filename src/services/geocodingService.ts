import axios from 'axios';
import type { GeocodeAccuracy, GeocodeResult } from '../types';
import { extractCity } from '../utils/addressHandler';

// In-memory cache for geocoding results
const geocodeCache = new Map<string, GeocodeResult>();
const REQUEST_DELAY = 1000;
let lastRequestTime = 0;

const MAPBOX_TOKEN: string =
  typeof import.meta !== 'undefined' && import.meta.env?.VITE_MAPBOX_TOKEN
    ? (import.meta.env.VITE_MAPBOX_TOKEN as string)
    : '';
const GOOGLE_GEOCODING_KEY: string =
  typeof import.meta !== 'undefined' && import.meta.env?.VITE_GOOGLE_GEOCODING_KEY
    ? (import.meta.env.VITE_GOOGLE_GEOCODING_KEY as string)
    : '';

export function normalizeAddress(address: string | null | undefined): string {
  if (!address) return '';
  return String(address).trim().replace(/\s+/g, ' ').toLowerCase();
}

function cleanAddress(raw: unknown): string {
  if (!raw) return '';
  let s = String(raw);
  s = s.replace(/_x000D_/gi, ' ');
   
  s = s.replace(/[\x00-\x1F]/g, ' ');
  s = s.replace(/\b0{3,}\b/g, '');
  s = s.replace(/\b\d{5}\b/g, '');
  s = s.replace(/\b\+?\d[\d\s\-()]{6,}\b/g, '');
  s = s.replace(
    /\b(call|please call|please|call customer|customer before|call before|contact|tel|telephone|phone)\b/gi,
    '',
  );
  s = s.replace(/\b(TRN|TRN:)\s*\d+\b/gi, '');
  s = s.replace(/\b[A-Z0-9]{6,}\b/g, '');
  s = s.replace(/[\r\n]+/g, ' ');
  s = s.replace(/[,]{2,}/g, ',');
  s = s.replace(/\s+/g, ' ').trim();
  s = s.replace(/^[-,.:\s]+|[-,.:\s]+$/g, '');
  return s;
}

function detectEmirate(text: string | null | undefined): string {
  if (!text) return '';
  const emirates = [
    'dubai', 'abu dhabi', 'sharjah', 'ajman', 'ras al khaimah', 'fujairah',
    'umm al quwain',
  ];
  const lower = String(text).toLowerCase();
  for (const e of emirates) if (lower.includes(e)) return e;
  return '';
}

interface NominatimResult {
  lat: string;
  lon: string;
  importance: number;
  display_name: string;
  boundingbox?: string[];
  addresstype?: string;
  type?: string;
}

// UAE-wide bounding box covering all 7 emirates (Dubai, Abu Dhabi, Sharjah,
// Ajman, Umm Al Quwain, Ras Al Khaimah, Fujairah) plus Al Ain.
// Order for Nominatim viewbox: left,top,right,bottom (lng,lat,lng,lat).
const UAE_BBOX = { minLng: 51.5, maxLng: 56.4, minLat: 22.6, maxLat: 26.1 } as const;
const UAE_VIEWBOX = `${UAE_BBOX.minLng},${UAE_BBOX.maxLat},${UAE_BBOX.maxLng},${UAE_BBOX.minLat}`;

// Address types that represent too broad a region to be useful for a
// street-level delivery — if a geocoder returns these we treat the match
// as low confidence and keep searching.
const TOO_BROAD_TYPES = new Set([
  'country', 'state', 'county', 'region', 'province',
  'administrative', 'city', 'town', 'village', 'municipality',
]);

function inUAE(lat: number | null | undefined, lng: number | null | undefined): boolean {
  if (lat == null || lng == null || !isFinite(lat) || !isFinite(lng)) return false;
  return (
    lat >= UAE_BBOX.minLat && lat <= UAE_BBOX.maxLat &&
    lng >= UAE_BBOX.minLng && lng <= UAE_BBOX.maxLng
  );
}

async function tryQuery(q: string, ctx: string): Promise<GeocodeResult | null> {
  const timeSinceLastRequest = Date.now() - lastRequestTime;
  if (timeSinceLastRequest < REQUEST_DELAY) {
    await new Promise((resolve) => setTimeout(resolve, REQUEST_DELAY - timeSinceLastRequest));
  }
  lastRequestTime = Date.now();

  const searchQuery = ctx ? `${q}, ${ctx}` : q;
  console.log(`[Geocoding] Searching for: ${searchQuery}`);

  // Ask for top 3, constrained to UAE viewbox, then pick the first result
  // that passes bbox + addresstype validation. `bounded=1` forces Nominatim
  // to return ONLY results inside the viewbox.
  const response = await axios.get<NominatimResult[]>(
    'https://nominatim.openstreetmap.org/search',
    {
      params: {
        q: searchQuery,
        format: 'json',
        limit: 3,
        countrycodes: 'ae',
        addressdetails: 1,
        viewbox: UAE_VIEWBOX,
        bounded: 1,
      },
      headers: { 'User-Agent': 'SmartLogistics/1.0' },
      timeout: 10000,
    },
  );

  if (!response.data || response.data.length === 0) return null;

  // Filter to candidates that are actually inside Dubai and specific enough
  // to be a real delivery target (not just "city of Dubai").
  // NEVER accept city/district-level results — they cause wrong pins.
  const specific = response.data.filter((r) => {
    const lat = parseFloat(r.lat);
    const lng = parseFloat(r.lon);
    const type = (r.addresstype || r.type || '').toLowerCase();
    return inUAE(lat, lng) && !TOO_BROAD_TYPES.has(type);
  });

  const candidate = specific[0];
  if (!candidate) {
    const broadCount = response.data.filter((r) => TOO_BROAD_TYPES.has((r.addresstype || r.type || '').toLowerCase())).length;
    console.warn(`[Geocoding] Nominatim returned ${response.data.length} results (${broadCount} too broad) — none specific enough inside UAE for: ${searchQuery}`);
    return null;
  }

  const lat = parseFloat(candidate.lat);
  const lng = parseFloat(candidate.lon);
  const type = (candidate.addresstype || candidate.type || '').toLowerCase();
  const isBroad = TOO_BROAD_TYPES.has(type);
  // Downgrade broad-area matches so downstream code can prefer a street-level fallback.
  const baseAccuracy: GeocodeAccuracy =
    candidate.importance > 0.7 ? 'HIGH' : candidate.importance > 0.4 ? 'MEDIUM' : 'LOW';
  const accuracy: GeocodeAccuracy = isBroad ? 'LOW' : baseAccuracy;

  return {
    lat,
    lng,
    accuracy,
    displayName: candidate.display_name,
    addresstype: candidate.addresstype,
  };
}

async function tryMapbox(q: string, ctx: string): Promise<GeocodeResult | null> {
  if (!MAPBOX_TOKEN) return null;
  try {
    const search = encodeURIComponent((q + (ctx ? `, ${ctx}` : '')).trim());
    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${search}.json`;
    // Mapbox bbox format: minLng,minLat,maxLng,maxLat — constrains results to UAE
    const res = await axios.get<{ features?: Array<{ center?: number[]; relevance?: number; place_name?: string; place_type?: string[] }> }>(url, {
      params: {
        access_token: MAPBOX_TOKEN,
        limit: 3,
        country: 'ae',
        bbox: `${UAE_BBOX.minLng},${UAE_BBOX.minLat},${UAE_BBOX.maxLng},${UAE_BBOX.maxLat}`,
        types: 'address,poi,place,neighborhood,locality',
      },
      timeout: 8000,
    });
    const features = res.data?.features || [];
    if (!features.length) return null;

    // Pick the first feature that is inside Dubai and specific enough.
    // NEVER fall back to broad city/district-level results.
    const candidate = features.find((f) => {
      const [lng, lat] = f.center || [];
      const type = (f.place_type?.[0] || '').toLowerCase();
      return inUAE(parseFloat(String(lat)), parseFloat(String(lng))) && !TOO_BROAD_TYPES.has(type);
    });

    if (!candidate) return null;
    const [lng, lat] = candidate.center || [];
    const relevance = candidate.relevance || 0;
    const type = (candidate.place_type?.[0] || '').toLowerCase();
    const isBroad = TOO_BROAD_TYPES.has(type);
    const baseAccuracy: GeocodeAccuracy =
      relevance > 0.85 ? 'HIGH' : relevance > 0.55 ? 'MEDIUM' : 'LOW';
    return {
      lat: parseFloat(String(lat)),
      lng: parseFloat(String(lng)),
      accuracy: (isBroad ? 'LOW' : baseAccuracy) as GeocodeAccuracy,
      displayName: candidate.place_name,
      addresstype: candidate.place_type?.[0] || 'unknown',
    };
  } catch {
    return null;
  }
}

async function tryGoogle(q: string, ctx: string): Promise<GeocodeResult | null> {
  if (!GOOGLE_GEOCODING_KEY) return null;
  try {
    const addr = encodeURIComponent((q + (ctx ? `, ${ctx}` : '')).trim());
    // bounds format: south,west|north,east — biases (not restricts) to UAE
    const bounds = `${UAE_BBOX.minLat},${UAE_BBOX.minLng}|${UAE_BBOX.maxLat},${UAE_BBOX.maxLng}`;
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${addr}&key=${GOOGLE_GEOCODING_KEY}&components=country:AE&bounds=${encodeURIComponent(bounds)}`;
    const res = await axios.get<{ results?: Array<{ geometry: { location: { lat: number; lng: number } }; formatted_address: string; types?: string[] }> }>(url, { timeout: 8000 });
    const results = res.data?.results || [];
    if (!results.length) return null;

    // Prefer a street/premise match inside UAE, else any UAE result.
    const specific = results.find((r) => {
      const lat = r.geometry.location.lat;
      const lng = r.geometry.location.lng;
      const types = r.types || [];
      const isSpecific = types.includes('street_address') || types.includes('premise') || types.includes('subpremise') || types.includes('route');
      return inUAE(lat, lng) && isSpecific;
    });
    const fallback = results.find((r) => inUAE(r.geometry.location.lat, r.geometry.location.lng));
    const r = specific || fallback;
    if (!r) return null;

    const types = r.types || [];
    const accuracy = (types.includes('street_address') || types.includes('premise')
      ? 'HIGH'
      : types.includes('route') || types.includes('subpremise')
      ? 'MEDIUM'
      : types.some((t) => TOO_BROAD_TYPES.has(t))
      ? 'LOW'
      : 'MEDIUM') as GeocodeAccuracy;
    return {
      lat: r.geometry.location.lat,
      lng: r.geometry.location.lng,
      accuracy,
      displayName: r.formatted_address,
      addresstype: types[0] || 'unknown',
    };
  } catch {
    return null;
  }
}

function cacheToLocalStorage(key: string, result: GeocodeResult): void {
  try {
    const ls = (window as Window & { localStorage?: Storage })?.localStorage?.getItem('geocode_cache_v1');
    const parsed: Record<string, GeocodeResult> = ls ? JSON.parse(ls) : {};
    parsed[key] = result;
    (window as Window & { localStorage?: Storage })?.localStorage?.setItem('geocode_cache_v1', JSON.stringify(parsed));
  } catch {
    // ignore
  }
}

export async function geocodeAddress(address: string, city?: string): Promise<GeocodeResult> {
  const cleaned = cleanAddress(address);
  // Derive emirate context from the address text when the caller didn't pass one,
  // so non-Dubai addresses (Abu Dhabi, Al Ain, Sharjah, etc.) aren't mis-biased.
  const resolvedCity = city && city.trim() ? city : extractCity(cleaned);
  const cacheKey = `${normalizeAddress(cleaned)}|${normalizeAddress(resolvedCity)}`;

  try {
    const ls = (window as Window & { localStorage?: Storage })?.localStorage?.getItem('geocode_cache_v1');
    if (ls) {
      const parsed: Record<string, GeocodeResult> = JSON.parse(ls);
      if (parsed[cacheKey]) {
        console.log(`[Geocode Cache HIT - localStorage] ${address}`);
        geocodeCache.set(cacheKey, parsed[cacheKey]);
        return parsed[cacheKey];
      }
    }
  } catch {
    // ignore
  }

  if (geocodeCache.has(cacheKey)) {
    console.log(`[Geocode Cache HIT] ${address}`);
    return geocodeCache.get(cacheKey)!;
  }

  try {
    if (MAPBOX_TOKEN) {
      try {
        const mb = await tryMapbox(cleaned, resolvedCity);
        if (mb?.lat != null) {
          geocodeCache.set(cacheKey, mb);
          cacheToLocalStorage(cacheKey, mb);
          console.log(`[Geocoding MAPBOX] ${address} -> ${mb.lat},${mb.lng}`);
          return mb;
        }
      } catch { /* ignore */ }
    }

    if (!MAPBOX_TOKEN && GOOGLE_GEOCODING_KEY) {
      try {
        const gg = await tryGoogle(cleaned, resolvedCity);
        if (gg?.lat != null) {
          geocodeCache.set(cacheKey, gg);
          cacheToLocalStorage(cacheKey, gg);
          console.log(`[Geocoding GOOGLE] ${address} -> ${gg.lat},${gg.lng}`);
          return gg;
        }
      } catch { /* ignore */ }
    }

    const attempts: Array<{ q: string; ctx: string }> = [];
    if (cleaned) attempts.push({ q: cleaned, ctx: resolvedCity });
    const stripUnit = cleaned
      .replace(/\b(flat|apt|apartment|unit|suite|ste|building|bldg|floor|fl)\b[^,]*/gi, '')
      .replace(/#\d+/g, '')
      .trim();
    if (stripUnit && stripUnit !== cleaned) attempts.push({ q: stripUnit, ctx: resolvedCity });
    const noParens = cleaned.replace(/\([^)]*\)|\[[^\]]*\]/g, '').trim();
    if (noParens && noParens !== cleaned && noParens !== stripUnit) attempts.push({ q: noParens, ctx: resolvedCity });
    const firstPart = (cleaned.split(',')[0] || '').trim();
    if (firstPart && firstPart !== cleaned) attempts.push({ q: firstPart, ctx: resolvedCity });
    if (firstPart) attempts.push({ q: firstPart, ctx: '' });
    // Area token attempt — only if it looks like a real neighborhood name (2+ words or known area)
    const detectedEmirate = detectEmirate(cleaned) || detectEmirate(resolvedCity);
    const areaToken = (cleaned.split('-')[0] || cleaned.split(',')[1] || '').trim();
    if (areaToken && areaToken.length > 4 && detectedEmirate) attempts.push({ q: areaToken, ctx: detectedEmirate });
    // NOTE: We intentionally do NOT add { q: city, ctx: '' } as a last resort.
    // Geocoding just "Dubai" returns city-center coordinates which are wrong for deliveries.

    for (const att of attempts) {
      try {
        const r = await tryQuery(att.q, att.ctx || 'UAE');
        if (r?.lat !== null && r?.lat !== undefined) {
          geocodeCache.set(cacheKey, r);
          cacheToLocalStorage(cacheKey, r);
          console.log(`[Geocoding SUCCESS] ${address} -> Lat: ${r.lat!.toFixed(4)}, Lng: ${r.lng!.toFixed(4)}`);
          return r;
        }
      } catch { /* continue */ }
    }

    console.warn(`[Geocoding] No results for: ${address}`);
    const failed: GeocodeResult = { lat: null, lng: null, accuracy: 'FAILED', displayName: address, error: 'Address not found' };
    geocodeCache.set(cacheKey, failed);
    return failed;
  } catch (error: unknown) {
    const err = error as { message?: string; response?: { status?: number } };
    console.error(`[Geocoding ERROR] ${address}:`, { message: err.message, status: err.response?.status });
    return { lat: null, lng: null, accuracy: 'FAILED', displayName: address, error: err.message };
  }
}

interface AddressInput { address: string; city?: string }
interface BatchGeocodeResult extends GeocodeResult { index: number; address: string }

export async function geocodeAddressesBatch(addresses: AddressInput[]): Promise<BatchGeocodeResult[]> {
  const results: BatchGeocodeResult[] = [];
  console.log(`[Batch Geocoding] Starting ${addresses.length} requests`);

  for (let i = 0; i < addresses.length; i++) {
    const { address, city } = addresses[i];
    try {
      // Pass undefined when no city was provided so geocodeAddress derives the
      // emirate from the address text (handles all UAE emirates, not just Dubai).
      const result = await geocodeAddress(address, city);
      results.push({ index: i, address, ...result });
      console.log(`[Batch Progress] ${i + 1}/${addresses.length} completed`);
    } catch (error: unknown) {
      const err = error as { message?: string };
      console.error(`[Batch Error] Address ${i}:`, err.message);
      results.push({ index: i, address, lat: null, lng: null, accuracy: 'FAILED', error: err.message });
    }
  }

  console.log(`[Batch Geocoding] Completed ${results.length} results`);
  return results;
}

export function filterGeocodeResults(
  results: BatchGeocodeResult[],
  minAccuracy: GeocodeAccuracy = 'LOW',
): { valid: BatchGeocodeResult[]; invalid: Array<BatchGeocodeResult & { reason: string }> } {
  const accuracyLevels: Record<string, number> = { LOW: 0, MEDIUM: 1, HIGH: 2 };
  const minLevel = accuracyLevels[minAccuracy] || 0;
  const valid: BatchGeocodeResult[] = [];
  const invalid: Array<BatchGeocodeResult & { reason: string }> = [];

  results.forEach((result) => {
    const resultLevel = accuracyLevels[result.accuracy ?? 'FAILED'] ?? -1;
    if (result.lat !== null && result.lng !== null && resultLevel >= minLevel) {
      valid.push(result);
    } else {
      invalid.push({ ...result, reason: result.error || `Accuracy too low (${result.accuracy})` });
    }
  });

  return { valid, invalid };
}

export function isValidUAECoordinates(lat: number, lng: number): boolean {
  return inUAE(lat, lng);
}

/** @deprecated Use isValidUAECoordinates — kept for backward compatibility */
export const isValidDubaiCoordinates = isValidUAECoordinates;

export function clearGeocodeCache(): void {
  geocodeCache.clear();
  console.log('[Geocoding Cache] Cleared');
}

export function getGeocachStats(): { cacheSize: number; cachedAddresses: string[] } {
  return { cacheSize: geocodeCache.size, cachedAddresses: Array.from(geocodeCache.keys()) };
}
