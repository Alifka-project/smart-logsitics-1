/**
 * Address Handler Utility
 * Validates addresses and ensures geocoding fallback for missing coordinates
 */

/**
 * Extract city from address or use default
 */
export function extractCity(address) {
  if (!address) return 'Dubai, UAE';
  
  const address_str = String(address).toLowerCase();
  
  // Common Dubai cities/areas
  const dubaiAreas = [
    'downtown', 'marina', 'jumeirah', 'deira', 'bur dubai',
    'al baraha', 'al khawaneej', 'al quoz', 'business bay',
    'creek harbour', 'downtown dubai', 'dubai investment park',
    'dubai marina', 'dubai sports city', 'dubai studio city',
    'emirates hills', 'festival city', 'jebel ali', 'lake alquoz',
    'mina jebel ali', 'palm jumeirah', 'ras al khor', 'sports city'
  ];
  
  // Check if any known Dubai area is in the address
  for (const area of dubaiAreas) {
    if (address_str.includes(area)) {
      return `${area}, Dubai, UAE`;
    }
  }
  
  // If address mentions Dubai already
  if (address_str.includes('dubai')) {
    return 'Dubai, UAE';
  }
  
  // Check for Emirates mentioned
  if (address_str.includes('emirates')) {
    return 'United Arab Emirates';
  }
  
  // Default to Dubai
  return 'Dubai, UAE';
}

/**
 * Validate address format
 */
export function isValidAddress(address) {
  if (!address) return false;
  const addr = String(address).trim();
  return addr.length >= 3 && addr.length <= 200;
}

/**
 * Patterns that indicate an address is not an actual delivery location.
 * Deliveries with these addresses are sorted to the end of the delivery list.
 */
const UNRECOGNIZABLE_PATTERNS = [
  /^(call|call\s+for\s+(delivery|pickup|address|location)|call\s+customer)$/i,
  /^(tbd|to\s+be\s+(confirmed|determined|advised)|n\/a|na|none|nil|-)$/i,
  /^(pickup|warehouse|collect|collection\s+point)$/i,
  /^(see\s+notes?|as\s+instructed|contact\s+(customer|driver|office))$/i,
  /^(unknown|unspecified|no\s+address|no\s+delivery\s+address)$/i,
  /^(refer\s+to|check\s+with|pending|awaiting)$/i,
];

/**
 * Returns true when the address string cannot reliably be used for routing/sorting.
 * These deliveries should be placed at the END of the delivery sequence.
 */
export function isUnrecognizableAddress(address) {
  if (!address || typeof address !== 'string') return true;
  const trimmed = address.trim();
  if (trimmed.length < 5) return true;
  // Match known non-address patterns
  for (const pattern of UNRECOGNIZABLE_PATTERNS) {
    if (pattern.test(trimmed)) return true;
  }
  // Any address that starts with "call" is likely "call for delivery" style
  if (/^call\b/i.test(trimmed)) return true;
  return false;
}

/**
 * Check if coordinates are present and valid
 */
export function hasValidCoordinates(lat, lng) {
  const lat_num = parseFloat(lat);
  const lng_num = parseFloat(lng);

  if (isNaN(lat_num) || isNaN(lng_num)) return false;
  // Treat explicit zeros as invalid
  if (lat_num === 0 || lng_num === 0) return false;

  // Treat known default placeholder coordinates as invalid so they trigger geocoding
  const DEFAULT_LAT = 25.1124;
  const DEFAULT_LNG = 55.1980;
  const EPS = 0.0001;
  if (Math.abs(lat_num - DEFAULT_LAT) < EPS && Math.abs(lng_num - DEFAULT_LNG) < EPS) return false;

  return true;
}

/**
 * Prepare delivery for geocoding (extract what we need from original data)
 */
export function prepareAddressForGeocoding(delivery) {
  return {
    address: String(delivery.address || '').trim(),
    city: extractCity(delivery.address),
    hasCoordinates: hasValidCoordinates(delivery.lat, delivery.lng),
    originalLat: delivery.lat,
    originalLng: delivery.lng
  };
}

/**
 * Merge geocoded result with original delivery
 */
export function mergeGeocodedResult(delivery, geocodeResult) {
  // If geocoding failed or no result, use original coordinates if available
  if (geocodeResult.lat === null || geocodeResult.lng === null) {
    return {
      ...delivery,
      geocoded: false,
      geocodeAccuracy: 'FAILED',
      geocodeError: geocodeResult.error || 'Geocoding failed',
      // Keep original coordinates if available, otherwise use default
      lat: parseFloat(delivery.lat) || 25.1124,
      lng: parseFloat(delivery.lng) || 55.1980
    };
  }

  return {
    ...delivery,
    lat: geocodeResult.lat,
    lng: geocodeResult.lng,
    geocoded: true,
    geocodeAccuracy: geocodeResult.accuracy,
    geocodeDisplayName: geocodeResult.displayName,
    geocodeAddressType: geocodeResult.addresstype
  };
}

/**
 * Validate and clean delivery data with geocoding status
 */
export function validateAddressData(delivery, requireGeocoding = false) {
  const errors = [];
  const warnings = [];

  // Check required fields
  if (!delivery.customer || String(delivery.customer).trim() === '') {
    errors.push('Customer name required');
  }

  if (!isValidAddress(delivery.address)) {
    errors.push('Valid address required (3-200 characters)');
  }

  if (!delivery.items || String(delivery.items).trim() === '') {
    errors.push('Items description required');
  }

  // Check coordinates
  if (!hasValidCoordinates(delivery.lat, delivery.lng)) {
    if (requireGeocoding) {
      errors.push('Geocoding required - no valid coordinates found');
    } else {
      warnings.push('No coordinates provided - will need geocoding');
    }
  }

  // Check if geocoding was successful
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
    accuracy: delivery.geocodeAccuracy || 'UNKNOWN'
  };
}

/**
 * Sort deliveries by geocoding accuracy
 */
export function sortByGeocodeAccuracy(deliveries, order = 'desc') {
  const accuracyLevels = { 'HIGH': 3, 'MEDIUM': 2, 'LOW': 1, 'FAILED': 0, 'UNKNOWN': -1 };
  
  const sorted = [...deliveries].sort((a, b) => {
    const accuracyA = accuracyLevels[a.geocodeAccuracy] || -1;
    const accuracyB = accuracyLevels[b.geocodeAccuracy] || -1;
    
    return order === 'desc' ? accuracyB - accuracyA : accuracyA - accuracyB;
  });

  return sorted;
}

/**
 * Generate geocoding summary for batch operations
 */
export function generateGeocodeSummary(deliveries) {
  const total = deliveries.length;
  const geocoded = deliveries.filter(d => d.geocoded === true).length;
  const failed = deliveries.filter(d => d.geocoded === false).length;
  const skipped = deliveries.filter(d => d.geocoded === undefined).length;
  
  const byAccuracy = {
    HIGH: deliveries.filter(d => d.geocodeAccuracy === 'HIGH').length,
    MEDIUM: deliveries.filter(d => d.geocodeAccuracy === 'MEDIUM').length,
    LOW: deliveries.filter(d => d.geocodeAccuracy === 'LOW').length,
    FAILED: failed
  };

  return {
    total,
    geocoded,
    failed,
    skipped,
    successRate: total > 0 ? ((geocoded / total) * 100).toFixed(1) : 0,
    byAccuracy
  };
}
