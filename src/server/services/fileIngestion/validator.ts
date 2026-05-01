/**
 * Server-side delivery row validation — mirror of src/utils/dataValidator.ts.
 * Kept separate from the frontend version so server builds don't depend on
 * frontend code paths. Both versions must stay in sync when validation rules
 * change.
 */

export interface ValidatedDelivery {
  customer: string;
  address: string;
  phone: string;
  items: string;
  lat: number;
  lng: number;
  status: string;
  [key: string]: unknown; // preserves extra transformed fields like _originalPONumber
}

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  validData: ValidatedDelivery[];
}

const REQUIRED_COLUMNS = ['customer', 'address', 'lat', 'lng', 'items'] as const;

// UAE-wide bounding box — same values as frontend validator. Covers all 7
// emirates + Al Ain so legitimate non-Dubai deliveries don't warn falsely.
const UAE_LAT_MIN = 22.6;
const UAE_LAT_MAX = 26.1;
const UAE_LNG_MIN = 51.5;
const UAE_LNG_MAX = 56.4;

export function validateDeliveryData(data: unknown[]): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!Array.isArray(data) || data.length === 0) {
    return { isValid: false, errors: ['File is empty or no data found'], warnings: [], validData: [] };
  }

  const firstRow = data[0] as Record<string, unknown>;
  const missingColumns = REQUIRED_COLUMNS.filter((col) => !(col in firstRow));
  if (missingColumns.length > 0) {
    return {
      isValid: false,
      errors: [`Missing required columns: ${missingColumns.join(', ')}`],
      warnings: [],
      validData: [],
    };
  }

  const validData: ValidatedDelivery[] = [];

  data.forEach((rawRow, rowIndex) => {
    const row = rawRow as Record<string, unknown>;
    const rowNum = rowIndex + 2; // +1 for header, +1 for 1-based
    const rowErrors: string[] = [];

    if (!row.customer || String(row.customer).trim() === '') {
      rowErrors.push(`Row ${rowNum}: Customer name is required`);
    }
    if (!row.address || String(row.address).trim() === '') {
      rowErrors.push(`Row ${rowNum}: Address is required`);
    }
    if (!row.items || String(row.items).trim() === '') {
      rowErrors.push(`Row ${rowNum}: Items description is required`);
    }

    const lat = parseFloat(String(row.lat));
    const lng = parseFloat(String(row.lng));
    const coordsMissing = isNaN(lat) || isNaN(lng);

    // Missing coords are NOT a hard error — the auto-ingest geocoder
    // (geocodeMissingCoords) fills them in from the address text after this
    // validation step. The address-required check above already blocks rows
    // that have nothing for the geocoder to work with.
    if (coordsMissing) {
      warnings.push(`Row ${rowNum}: Coordinates missing — will be geocoded from address.`);
    } else if (lat < UAE_LAT_MIN || lat > UAE_LAT_MAX || lng < UAE_LNG_MIN || lng > UAE_LNG_MAX) {
      warnings.push(
        `Row ${rowNum}: Coordinates (${lat}, ${lng}) may be outside UAE.`,
      );
    }

    if (rowErrors.length === 0) {
      validData.push({
        ...row,
        customer: String(row.customer).trim(),
        address: String(row.address).trim(),
        lat,
        lng,
        phone: row.phone != null && row.phone !== '' ? String(row.phone).trim() : '',
        items: String(row.items).trim(),
        status: (row.status as string) || 'pending',
      } as ValidatedDelivery);
    }

    if (rowErrors.length > 0) errors.push(...rowErrors);
  });

  return {
    isValid: errors.length === 0 && validData.length > 0,
    errors,
    warnings,
    validData,
  };
}
