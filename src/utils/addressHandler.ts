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
