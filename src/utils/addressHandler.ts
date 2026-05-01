import type { Delivery, GeocodeAccuracy, GeocodeResult, PreparedAddress, AddressValidationResult, GeocodeSummary } from '../types';

/**
 * Address Handler Utility
 * Validates addresses and ensures geocoding fallback for missing coordinates
 */

export function extractCity(address: string | null | undefined): string {
  if (!address) return 'UAE';

  const address_str = String(address).toLowerCase();

  // Dubai areas
  const dubaiAreas = [
    'downtown', 'marina', 'jumeirah', 'deira', 'bur dubai',
    'al baraha', 'al khawaneej', 'al quoz', 'business bay',
    'creek harbour', 'downtown dubai', 'dubai investment park',
    'dubai marina', 'dubai sports city', 'dubai studio city',
    'emirates hills', 'festival city', 'jebel ali', 'lake alquoz',
    'mina jebel ali', 'palm jumeirah', 'ras al khor', 'sports city',
  ];

  for (const area of dubaiAreas) {
    if (address_str.includes(area)) {
      return `${area}, Dubai, UAE`;
    }
  }

  if (address_str.includes('dubai')) return 'Dubai, UAE';

  // Abu Dhabi areas
  const abuDhabiAreas = [
    'yas island', 'saadiyat', 'al reem', 'khalifa city', 'musaffah',
    'mussafah', 'al raha', 'corniche', 'al maryah', 'al bateen',
    'mohammed bin zayed', 'mbz', 'khalidiyah', 'tourist club',
    'hamdan street', 'electra', 'al nahyan', 'al shamkha',
  ];
  for (const area of abuDhabiAreas) {
    if (address_str.includes(area)) return `${area}, Abu Dhabi, UAE`;
  }
  if (address_str.includes('abu dhabi')) return 'Abu Dhabi, UAE';

  // Al Ain
  if (address_str.includes('al ain')) return 'Al Ain, Abu Dhabi, UAE';

  // Sharjah
  if (address_str.includes('sharjah')) return 'Sharjah, UAE';

  // Other emirates
  if (address_str.includes('ajman')) return 'Ajman, UAE';
  if (address_str.includes('ras al khaimah') || address_str.includes('rak')) return 'Ras Al Khaimah, UAE';
  if (address_str.includes('fujairah')) return 'Fujairah, UAE';
  if (address_str.includes('umm al quwain') || address_str.includes('uaq')) return 'Umm Al Quwain, UAE';

  if (address_str.includes('emirates') || address_str.includes('uae')) return 'United Arab Emirates';
  return 'UAE';
}

/**
 * UAE emirate / major-area centroid lookup. Used as a graceful-degradation
 * fallback when the geocoder cannot resolve a specific street/POI for an
 * address — e.g. "Yas Island, Abu Dhabi" returns the Yas Island centroid
 * (real area-level pin) and bare "Abu Dhabi" returns the Abu Dhabi city
 * centroid. The order in which these substrings are tested matters: longer
 * / multi-word names must come before single-word substrings to avoid
 * "ras al khaimah" matching as "ajman" inside another string.
 */
const EMIRATE_AREA_CENTROIDS: Array<{ keyword: string; lat: number; lng: number; label: string; query: string }> = [
  // Specific neighborhoods / islands first — these win over their parent emirate
  { keyword: 'yas island',    lat: 24.4675, lng: 54.6038, label: 'Yas Island, Abu Dhabi',     query: 'Yas Island, Abu Dhabi, UAE' },
  { keyword: 'saadiyat',      lat: 24.5312, lng: 54.4288, label: 'Saadiyat Island, Abu Dhabi', query: 'Saadiyat Island, Abu Dhabi, UAE' },
  { keyword: 'al reem',       lat: 24.4994, lng: 54.4036, label: 'Al Reem Island, Abu Dhabi', query: 'Al Reem Island, Abu Dhabi, UAE' },
  { keyword: 'khalifa city',  lat: 24.4189, lng: 54.5786, label: 'Khalifa City, Abu Dhabi',   query: 'Khalifa City, Abu Dhabi, UAE' },
  { keyword: 'mussafah',      lat: 24.3585, lng: 54.5031, label: 'Mussafah, Abu Dhabi',       query: 'Mussafah, Abu Dhabi, UAE' },
  { keyword: 'musaffah',      lat: 24.3585, lng: 54.5031, label: 'Musaffah, Abu Dhabi',       query: 'Mussafah, Abu Dhabi, UAE' },
  { keyword: 'al ain',        lat: 24.2075, lng: 55.7447, label: 'Al Ain',                    query: 'Al Ain, UAE' },
  { keyword: 'mohammed bin zayed', lat: 24.4047, lng: 54.5717, label: 'MBZ City, Abu Dhabi',  query: 'Mohammed Bin Zayed City, Abu Dhabi, UAE' },
  { keyword: 'palm jumeirah', lat: 25.1124, lng: 55.1390, label: 'Palm Jumeirah, Dubai',      query: 'Palm Jumeirah, Dubai, UAE' },
  { keyword: 'jebel ali',     lat: 24.9858, lng: 55.0683, label: 'Jebel Ali, Dubai',          query: 'Jebel Ali, Dubai, UAE' },
  { keyword: 'business bay',  lat: 25.1863, lng: 55.2664, label: 'Business Bay, Dubai',       query: 'Business Bay, Dubai, UAE' },
  { keyword: 'downtown',      lat: 25.1972, lng: 55.2744, label: 'Downtown Dubai',            query: 'Downtown Dubai, UAE' },
  { keyword: 'marina',        lat: 25.0800, lng: 55.1350, label: 'Dubai Marina',              query: 'Dubai Marina, UAE' },
  { keyword: 'jumeirah',      lat: 25.2048, lng: 55.2381, label: 'Jumeirah, Dubai',           query: 'Jumeirah, Dubai, UAE' },
  { keyword: 'deira',         lat: 25.2695, lng: 55.3266, label: 'Deira, Dubai',              query: 'Deira, Dubai, UAE' },
  // Multi-word emirate names before single-word fallbacks
  { keyword: 'ras al khaimah', lat: 25.7889, lng: 55.9758, label: 'Ras Al Khaimah',           query: 'Ras Al Khaimah, UAE' },
  { keyword: 'umm al quwain',  lat: 25.5644, lng: 55.5550, label: 'Umm Al Quwain',            query: 'Umm Al Quwain, UAE' },
  { keyword: 'abu dhabi',     lat: 24.4539, lng: 54.3773, label: 'Abu Dhabi',                 query: 'Abu Dhabi, UAE' },
  { keyword: 'sharjah',       lat: 25.3463, lng: 55.4209, label: 'Sharjah',                   query: 'Sharjah, UAE' },
  { keyword: 'ajman',         lat: 25.4111, lng: 55.4354, label: 'Ajman',                     query: 'Ajman, UAE' },
  { keyword: 'fujairah',      lat: 25.1288, lng: 56.3265, label: 'Fujairah',                  query: 'Fujairah, UAE' },
  { keyword: 'rak',           lat: 25.7889, lng: 55.9758, label: 'Ras Al Khaimah',            query: 'Ras Al Khaimah, UAE' },
  { keyword: 'uaq',           lat: 25.5644, lng: 55.5550, label: 'Umm Al Quwain',             query: 'Umm Al Quwain, UAE' },
  { keyword: 'dubai',         lat: 25.2048, lng: 55.2708, label: 'Dubai',                     query: 'Dubai, UAE' },
];

/**
 * Returns the best-effort centroid for an address text. Specific neighborhoods
 * win over the parent emirate ("yas island" → Yas Island, not Abu Dhabi city).
 * Returns null when no UAE keyword is detected — caller should treat as truly
 * unresolvable rather than substituting a Dubai default.
 */
export function getEmirateCentroid(
  address: string | null | undefined,
): { lat: number; lng: number; label: string } | null {
  if (!address) return null;
  const text = String(address).toLowerCase();
  for (const entry of EMIRATE_AREA_CENTROIDS) {
    if (text.includes(entry.keyword)) {
      return { lat: entry.lat, lng: entry.lng, label: entry.label };
    }
  }
  return null;
}

/**
 * If the address mentions a known UAE area, return a clean provider-friendly
 * query for it ("Yas Island, Abu Dhabi, UAE"). Useful as an extra geocoder
 * variant: noisy real-world inputs ("YS3 01\nياس جنوب 3 01\nYas Island - Abu
 * Dhabi") often confuse providers, but the synthesized clean query resolves
 * to a specific island/suburb instead of falling all the way to the centroid.
 */
export function getCleanAreaQuery(address: string | null | undefined): string | null {
  if (!address) return null;
  const text = String(address).toLowerCase();
  for (const entry of EMIRATE_AREA_CENTROIDS) {
    if (text.includes(entry.keyword)) return entry.query;
  }
  return null;
}

export function isValidAddress(address: string | null | undefined): boolean {
  if (!address) return false;
  const addr = String(address).trim();
  return addr.length >= 3 && addr.length <= 200;
}

const UNRECOGNIZABLE_PATTERNS: RegExp[] = [
  /^(call|call\s+for\s+(delivery|pickup|address|location)|call\s+customer)$/i,
  /^(tbd|to\s+be\s+(confirmed|determined|advised)|n\/a|na|none|nil|-)$/i,
  /^(pickup|warehouse|collect|collection\s+point)$/i,
  /^(see\s+notes?|as\s+instructed|contact\s+(customer|driver|office))$/i,
  /^(unknown|unspecified|no\s+address|no\s+delivery\s+address)$/i,
  /^(refer\s+to|check\s+with|pending|awaiting)$/i,
];

export function isUnrecognizableAddress(address: string | null | undefined): boolean {
  if (!address || typeof address !== 'string') return true;
  const trimmed = address.trim();
  if (trimmed.length < 5) return true;
  for (const pattern of UNRECOGNIZABLE_PATTERNS) {
    if (pattern.test(trimmed)) return true;
  }
  if (/^call\b/i.test(trimmed)) return true;
  return false;
}

export function hasValidCoordinates(
  lat: number | string | null | undefined,
  lng: number | string | null | undefined,
): boolean {
  const lat_num = parseFloat(String(lat));
  const lng_num = parseFloat(String(lng));

  if (isNaN(lat_num) || isNaN(lng_num)) return false;
  if (lat_num === 0 || lng_num === 0) return false;

  const DEFAULT_LAT = 25.1124;
  const DEFAULT_LNG = 55.198;
  const EPS = 0.0001;
  if (Math.abs(lat_num - DEFAULT_LAT) < EPS && Math.abs(lng_num - DEFAULT_LNG) < EPS) return false;

  return true;
}

export function prepareAddressForGeocoding(delivery: Delivery): PreparedAddress {
  return {
    address: String(delivery.address || '').trim(),
    city: extractCity(delivery.address),
    hasCoordinates: hasValidCoordinates(delivery.lat, delivery.lng),
    originalLat: delivery.lat,
    originalLng: delivery.lng,
  };
}

export function mergeGeocodedResult(delivery: Delivery, geocodeResult: GeocodeResult): Delivery {
  if (geocodeResult.lat === null || geocodeResult.lng === null) {
    // Keep original coords if valid; otherwise leave as NaN — never hardcode defaults
    const origLat = parseFloat(String(delivery.lat));
    const origLng = parseFloat(String(delivery.lng));
    return {
      ...delivery,
      geocoded: false,
      geocodeAccuracy: 'FAILED',
      geocodeError: geocodeResult.error || 'Geocoding failed',
      lat: isFinite(origLat) && origLat !== 0 ? origLat : undefined as unknown as number,
      lng: isFinite(origLng) && origLng !== 0 ? origLng : undefined as unknown as number,
    };
  }

  return {
    ...delivery,
    lat: geocodeResult.lat,
    lng: geocodeResult.lng,
    geocoded: true,
    geocodeAccuracy: geocodeResult.accuracy,
    geocodeDisplayName: geocodeResult.displayName,
    geocodeAddressType: geocodeResult.addresstype,
  };
}

export function validateAddressData(
  delivery: Delivery,
  requireGeocoding = false,
): AddressValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!delivery.customer || String(delivery.customer).trim() === '') {
    errors.push('Customer name required');
  }

  if (!isValidAddress(delivery.address)) {
    errors.push('Valid address required (3-200 characters)');
  }

  if (!delivery.items || String(delivery.items).trim() === '') {
    errors.push('Items description required');
  }

  if (!hasValidCoordinates(delivery.lat, delivery.lng)) {
    if (requireGeocoding) {
      errors.push('Geocoding required - no valid coordinates found');
    } else {
      warnings.push('No coordinates provided - will need geocoding');
    }
  }

  if (delivery.geocoded === false) {
    warnings.push(`Address geocoding failed: ${delivery.geocodeError}`);
  } else if (delivery.geocodeAccuracy === 'LOW') {
    warnings.push(`Address geocoding accuracy is low - ${delivery.geocodeDisplayName}`);
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    isGeocoded: delivery.geocoded === true,
    accuracy: (delivery.geocodeAccuracy as GeocodeAccuracy) || 'UNKNOWN',
  };
}

export function sortByGeocodeAccuracy(
  deliveries: Delivery[],
  order: 'asc' | 'desc' = 'desc',
): Delivery[] {
  const accuracyLevels: Record<string, number> = {
    HIGH: 3,
    MEDIUM: 2,
    LOW: 1,
    FAILED: 0,
    UNKNOWN: -1,
  };

  return [...deliveries].sort((a, b) => {
    const accuracyA = accuracyLevels[a.geocodeAccuracy ?? 'UNKNOWN'] ?? -1;
    const accuracyB = accuracyLevels[b.geocodeAccuracy ?? 'UNKNOWN'] ?? -1;
    return order === 'desc' ? accuracyB - accuracyA : accuracyA - accuracyB;
  });
}

export function generateGeocodeSummary(deliveries: Delivery[]): GeocodeSummary {
  const total = deliveries.length;
  const geocoded = deliveries.filter((d) => d.geocoded === true).length;
  const failed = deliveries.filter((d) => d.geocoded === false).length;
  const skipped = deliveries.filter((d) => d.geocoded === undefined).length;

  const byAccuracy = {
    HIGH: deliveries.filter((d) => d.geocodeAccuracy === 'HIGH').length,
    MEDIUM: deliveries.filter((d) => d.geocodeAccuracy === 'MEDIUM').length,
    LOW: deliveries.filter((d) => d.geocodeAccuracy === 'LOW').length,
    FAILED: failed,
  };

  return {
    total,
    geocoded,
    failed,
    skipped,
    successRate: total > 0 ? ((geocoded / total) * 100).toFixed(1) : 0,
    byAccuracy,
  };
}
