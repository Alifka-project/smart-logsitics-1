import axios from 'axios';

/**
 * Geocoding Service using OpenStreetMap Nominatim API
 * Converts addresses to precise latitude/longitude coordinates
 * Includes caching to minimize API calls
 */

// In-memory cache for geocoding results
const geocodeCache = new Map();
// Rate limiting: max 1 request per second to respect Nominatim TOS
const REQUEST_DELAY = 1000;
let lastRequestTime = 0;

// Optional commercial geocoding keys (exposed via Vite env)
const MAPBOX_TOKEN = typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_MAPBOX_TOKEN ? import.meta.env.VITE_MAPBOX_TOKEN : '';
const GOOGLE_GEOCODING_KEY = typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_GOOGLE_GEOCODING_KEY ? import.meta.env.VITE_GOOGLE_GEOCODING_KEY : '';

/**
 * Normalize address by removing extra whitespace and standardizing format
 */
export function normalizeAddress(address) {
  if (!address) return '';
  return String(address)
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function cleanAddress(raw) {
  if (!raw) return '';
  let s = String(raw);
  s = s.replace(/_x000D_/gi, ' ');
  // Strip ASCII control characters (0x00-0x1F) - intentional for address cleaning
  // eslint-disable-next-line no-control-regex
  s = s.replace(/[\x00-\x1F]/g, ' ');
  s = s.replace(/\b0{3,}\b/g, '');
  s = s.replace(/\b\d{5}\b/g, '');
  s = s.replace(/\b\+?\d[\d\s\-()]{6,}\b/g, '');
  s = s.replace(/\b(call|please call|please|call customer|customer before|call before|contact|tel|telephone|phone)\b/gi, '');
  s = s.replace(/\b(TRN|TRN:)\s*\d+\b/gi, '');
  s = s.replace(/\b[A-Z0-9]{6,}\b/g, '');
  s = s.replace(/[\r\n]+/g, ' ');
  s = s.replace(/[,]{2,}/g, ',');
  s = s.replace(/\s+/g, ' ').trim();
  s = s.replace(/^[-,.:\s]+|[-,.:\s]+$/g, '');
  return s;
}

function detectEmirate(text) {
  if (!text) return '';
  const emirates = ['dubai','abu dhabi','sharjah','ajman','ras al khaimah','fujairah','umm al quwain'];
  const lower = String(text).toLowerCase();
  for (const e of emirates) if (lower.includes(e)) return e;
  return '';
}

/**
 * Geocode a single address using Nominatim API
 * @param {string} address - The address to geocode
 * @param {string} city - Optional city name for better accuracy (e.g., "Dubai")
 * @returns {Promise<{lat: number, lng: number, accuracy: string, displayName: string}>}
 */
export async function geocodeAddress(address, city = 'Dubai, UAE') {
  const cleaned = cleanAddress(address);

  // Check cache first (use cleaned + city)
  const cacheKey = `${normalizeAddress(cleaned)}|${normalizeAddress(city)}`;
  // try localStorage cache as well
  try {
    const ls = window?.localStorage?.getItem('geocode_cache_v1');
    if (ls) {
      const parsed = JSON.parse(ls);
      if (parsed[cacheKey]) {
        console.log(`[Geocode Cache HIT - localStorage] ${address}`);
        geocodeCache.set(cacheKey, parsed[cacheKey]);
        return parsed[cacheKey];
      }
    }
  } catch (e) {
    // ignore
  }

  if (geocodeCache.has(cacheKey)) {
    console.log(`[Geocode Cache HIT] ${address}`);
    return geocodeCache.get(cacheKey);
  }

  async function tryQuery(q, ctx) {
    const timeSinceLastRequest = Date.now() - lastRequestTime;
    if (timeSinceLastRequest < REQUEST_DELAY) {
      await new Promise(resolve => setTimeout(resolve, REQUEST_DELAY - timeSinceLastRequest));
    }
    lastRequestTime = Date.now();

    const searchQuery = ctx ? `${q}, ${ctx}` : q;
    console.log(`[Geocoding] Searching for: ${searchQuery}`);

    const response = await axios.get('https://nominatim.openstreetmap.org/search', {
      params: {
        q: searchQuery,
        format: 'json',
        limit: 1,
        countrycodes: 'ae',
        addressdetails: 1
      },
      headers: { 'User-Agent': 'SmartLogistics/1.0' },
      timeout: 10000
    });

    if (!response.data || response.data.length === 0) return null;
    const result = response.data[0];
    return {
      lat: parseFloat(result.lat),
      lng: parseFloat(result.lon),
      accuracy: result.importance > 0.7 ? 'HIGH' : result.importance > 0.4 ? 'MEDIUM' : 'LOW',
      displayName: result.display_name,
      boundingbox: result.boundingbox,
      addresstype: result.addresstype,
      type: result.type
    };
  }

  // Try Mapbox geocoding when token present (preferred commercial provider)
  async function tryMapbox(q, ctx) {
    if (!MAPBOX_TOKEN) return null;
    try {
      const search = encodeURIComponent((q + (ctx ? `, ${ctx}` : '')).trim());
      const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${search}.json`;
      const res = await axios.get(url, {
        params: {
          access_token: MAPBOX_TOKEN,
          limit: 1,
          country: 'ae'
        },
        timeout: 8000
      });
      const feature = res.data?.features?.[0];
      if (!feature) return null;
      const [lng, lat] = feature.center || [];
      const relevance = feature.relevance || 0;
      return {
        lat: parseFloat(lat),
        lng: parseFloat(lng),
        accuracy: relevance > 0.85 ? 'HIGH' : relevance > 0.55 ? 'MEDIUM' : 'LOW',
        displayName: feature.place_name,
        addresstype: feature.place_type?.[0] || 'unknown'
      };
    } catch (e) {
      return null;
    }
  }

  // Try Google Geocoding when key present
  async function tryGoogle(q, ctx) {
    if (!GOOGLE_GEOCODING_KEY) return null;
    try {
      const address = encodeURIComponent((q + (ctx ? `, ${ctx}` : '')).trim());
      const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${address}&key=${GOOGLE_GEOCODING_KEY}&components=country:AE`;
      const res = await axios.get(url, { timeout: 8000 });
      const r = res.data?.results?.[0];
      if (!r) return null;
      const lat = r.geometry.location.lat;
      const lng = r.geometry.location.lng;
      // Determine accuracy from types
      const types = r.types || [];
      const accuracy = types.includes('street_address') || types.includes('premise') ? 'HIGH' : types.includes('locality') ? 'MEDIUM' : 'LOW';
      return {
        lat: parseFloat(lat),
        lng: parseFloat(lng),
        accuracy,
        displayName: r.formatted_address,
        addresstype: types[0] || 'unknown'
      };
    } catch (e) {
      return null;
    }
  }

  try {
    // Try commercial providers first (prefer Mapbox, then Google)
    if (MAPBOX_TOKEN) {
      try {
        const mb = await tryMapbox(cleaned, city);
        if (mb && mb.lat != null) {
          geocodeCache.set(cacheKey, mb);
          try {
            const ls = window?.localStorage?.getItem('geocode_cache_v1');
            const parsed = ls ? JSON.parse(ls) : {};
            parsed[cacheKey] = mb;
            window?.localStorage?.setItem('geocode_cache_v1', JSON.stringify(parsed));
          } catch (e) {}
          console.log(`[Geocoding MAPBOX] ${address} -> ${mb.lat},${mb.lng}`);
          return mb;
        }
      } catch (e) {}
    }

    if (!MAPBOX_TOKEN && GOOGLE_GEOCODING_KEY) {
      try {
        const gg = await tryGoogle(cleaned, city);
        if (gg && gg.lat != null) {
          geocodeCache.set(cacheKey, gg);
          try {
            const ls = window?.localStorage?.getItem('geocode_cache_v1');
            const parsed = ls ? JSON.parse(ls) : {};
            parsed[cacheKey] = gg;
            window?.localStorage?.setItem('geocode_cache_v1', JSON.stringify(parsed));
          } catch (e) {}
          console.log(`[Geocoding GOOGLE] ${address} -> ${gg.lat},${gg.lng}`);
          return gg;
        }
      } catch (e) {}
    }
    const attempts = [];
    if (cleaned) attempts.push({ q: cleaned, ctx: city });
    const stripUnit = cleaned.replace(/\b(flat|apt|apartment|unit|suite|ste|building|bldg|floor|fl)\b[^,]*/gi, '').replace(/#\d+/g, '').trim();
    if (stripUnit && stripUnit !== cleaned) attempts.push({ q: stripUnit, ctx: city });
    const noParens = cleaned.replace(/\([^)]*\)|\[[^\]]*\]/g, '').trim();
    if (noParens && noParens !== cleaned && noParens !== stripUnit) attempts.push({ q: noParens, ctx: city });
    const firstPart = (cleaned.split(',')[0] || '').trim();
    if (firstPart && firstPart !== cleaned) attempts.push({ q: firstPart, ctx: city });
    if (firstPart) attempts.push({ q: firstPart, ctx: '' });
    const detectedEmirate = detectEmirate(cleaned) || detectEmirate(city);
    const areaToken = (cleaned.split('-')[0] || cleaned.split(',')[1] || '').trim();
    if (areaToken && detectedEmirate) attempts.push({ q: `${areaToken}`, ctx: detectedEmirate });
    if (city) attempts.push({ q: city, ctx: '' });

    for (const att of attempts) {
      try {
        const r = await tryQuery(att.q, att.ctx || 'Dubai, UAE');
        if (r && r.lat !== null) {
          geocodeCache.set(cacheKey, r);
          try {
            const ls = window?.localStorage?.getItem('geocode_cache_v1');
            const parsed = ls ? JSON.parse(ls) : {};
            parsed[cacheKey] = r;
            window?.localStorage?.setItem('geocode_cache_v1', JSON.stringify(parsed));
          } catch (e) {}
          console.log(`[Geocoding SUCCESS] ${address} -> Lat: ${r.lat.toFixed(4)}, Lng: ${r.lng.toFixed(4)}`);
          return r;
        }
      } catch (e) {
        // continue
      }
    }

    console.warn(`[Geocoding] No results for: ${address}`);
    const failed = { lat: null, lng: null, accuracy: 'FAILED', displayName: address, error: 'Address not found' };
    geocodeCache.set(cacheKey, failed);
    return failed;
  } catch (error) {
    console.error(`[Geocoding ERROR] ${address}:`, { message: error.message, status: error.response?.status });
    return { lat: null, lng: null, accuracy: 'FAILED', displayName: address, error: error.message };
  }
}

/**
 * Geocode multiple addresses in sequence with rate limiting
 * @param {Array<{address: string, city?: string}>} addresses - Array of addresses to geocode
 * @returns {Promise<Array>} - Array of geocoding results
 */
export async function geocodeAddressesBatch(addresses) {
  const results = [];
  
  console.log(`[Batch Geocoding] Starting ${addresses.length} requests`);
  
  for (let i = 0; i < addresses.length; i++) {
    const { address, city = 'Dubai, UAE' } = addresses[i];
    try {
      const result = await geocodeAddress(address, city);
      results.push({
        index: i,
        address,
        ...result
      });
      
      // Show progress
      console.log(`[Batch Progress] ${i + 1}/${addresses.length} completed`);
    } catch (error) {
      console.error(`[Batch Error] Address ${i}:`, error.message);
      results.push({
        index: i,
        address,
        lat: null,
        lng: null,
        accuracy: 'FAILED',
        error: error.message
      });
    }
  }

  console.log(`[Batch Geocoding] Completed ${results.length} results`);
  return results;
}

/**
 * Filter and validate geocoding results
 * @param {Array} results - Geocoding results
 * @param {string} minAccuracy - Minimum acceptable accuracy ('LOW', 'MEDIUM', 'HIGH')
 * @returns {Object} - {valid: [], invalid: []}
 */
export function filterGeocodeResults(results, minAccuracy = 'LOW') {
  const accuracyLevels = { 'LOW': 0, 'MEDIUM': 1, 'HIGH': 2 };
  const minLevel = accuracyLevels[minAccuracy] || 0;

  const valid = [];
  const invalid = [];

  results.forEach(result => {
    const resultLevel = accuracyLevels[result.accuracy] || -1;
    
    if (result.lat !== null && result.lng !== null && resultLevel >= minLevel) {
      valid.push(result);
    } else {
      invalid.push({
        ...result,
        reason: result.error || `Accuracy too low (${result.accuracy})`
      });
    }
  });

  return { valid, invalid };
}

/**
 * Validate if coordinates are within Dubai area
 * @param {number} lat - Latitude
 * @param {number} lng - Longitude
 * @returns {boolean}
 */
export function isValidDubaiCoordinates(lat, lng) {
  const DUBAI_LAT_MIN = 24.7;
  const DUBAI_LAT_MAX = 25.5;
  const DUBAI_LNG_MIN = 54.8;
  const DUBAI_LNG_MAX = 55.7;

  return lat >= DUBAI_LAT_MIN && 
         lat <= DUBAI_LAT_MAX && 
         lng >= DUBAI_LNG_MIN && 
         lng <= DUBAI_LNG_MAX;
}

/**
 * Clear the geocoding cache
 */
export function clearGeocodeCache() {
  geocodeCache.clear();
  console.log('[Geocoding Cache] Cleared');
}

/**
 * Get cache statistics
 */
export function getGeocachStats() {
  return {
    cacheSize: geocodeCache.size,
    cachedAddresses: Array.from(geocodeCache.keys())
  };
}
