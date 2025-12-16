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

/**
 * Geocode a single address using Nominatim API
 * @param {string} address - The address to geocode
 * @param {string} city - Optional city name for better accuracy (e.g., "Dubai")
 * @returns {Promise<{lat: number, lng: number, accuracy: string, displayName: string}>}
 */
export async function geocodeAddress(address, city = 'Dubai, UAE') {
  const normalizedAddress = normalizeAddress(address);
  
  // Check cache first
  if (geocodeCache.has(normalizedAddress)) {
    console.log(`[Geocode Cache HIT] ${address}`);
    return geocodeCache.get(normalizedAddress);
  }

  try {
    // Rate limiting - wait if needed
    const timeSinceLastRequest = Date.now() - lastRequestTime;
    if (timeSinceLastRequest < REQUEST_DELAY) {
      await new Promise(resolve => 
        setTimeout(resolve, REQUEST_DELAY - timeSinceLastRequest)
      );
    }
    lastRequestTime = Date.now();

    // Build search query with city context
    const searchQuery = `${address}, ${city}`;
    
    console.log(`[Geocoding] Searching for: ${searchQuery}`);
    
    const response = await axios.get('https://nominatim.openstreetmap.org/search', {
      params: {
        q: searchQuery,
        format: 'json',
        limit: 1,
        // Bias results towards UAE
        countrycodes: 'ae',
        // Include display name for verification
        addressdetails: 1,
        // Add timeout
        timeout: 10000
      },
      headers: {
        'User-Agent': 'SmartLogistics/1.0'
      }
    });

    if (!response.data || response.data.length === 0) {
      console.warn(`[Geocoding] No results for: ${address}`);
      return {
        lat: null,
        lng: null,
        accuracy: 'FAILED',
        displayName: address,
        error: 'Address not found'
      };
    }

    const result = response.data[0];
    const geocodeResult = {
      lat: parseFloat(result.lat),
      lng: parseFloat(result.lon),
      accuracy: result.importance > 0.7 ? 'HIGH' : result.importance > 0.4 ? 'MEDIUM' : 'LOW',
      displayName: result.display_name,
      boundingbox: result.boundingbox,
      addresstype: result.addresstype,
      type: result.type
    };

    console.log(`[Geocoding SUCCESS] ${address} -> Lat: ${geocodeResult.lat.toFixed(4)}, Lng: ${geocodeResult.lng.toFixed(4)}`);
    
    // Cache the result
    geocodeCache.set(normalizedAddress, geocodeResult);
    
    return geocodeResult;
  } catch (error) {
    console.error(`[Geocoding ERROR] ${address}:`, {
      message: error.message,
      status: error.response?.status
    });

    return {
      lat: null,
      lng: null,
      accuracy: 'FAILED',
      displayName: address,
      error: error.message
    };
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
