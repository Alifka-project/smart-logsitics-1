// Validation utility for delivery data
import type { Delivery, ValidationResult } from '../types';

const REQUIRED_COLUMNS = ['customer', 'address', 'lat', 'lng', 'items'] as const;

// UAE-wide bounding box — covers all 7 emirates + Al Ain. Tightening this to
// Dubai-only would warn on every legitimate Abu Dhabi/Sharjah/RAK delivery.
const UAE_LAT_MIN = 22.6;
const UAE_LAT_MAX = 26.1;
const UAE_LNG_MIN = 51.5;
const UAE_LNG_MAX = 56.4;

export function validateDeliveryData(data: unknown[]): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!Array.isArray(data) || data.length === 0) {
    return {
      isValid: false,
      errors: ['File is empty or no data found'],
      warnings: [],
      validData: [],
    };
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

  const validData: Delivery[] = [];

  data.forEach((rawRow, rowIndex) => {
    const row = rawRow as Record<string, unknown>;
    const rowNum = rowIndex + 2;
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

    if (isNaN(lat) || isNaN(lng)) {
      rowErrors.push(`Row ${rowNum}: Latitude and Longitude must be valid numbers`);
    } else {
      if (lat < UAE_LAT_MIN || lat > UAE_LAT_MAX || lng < UAE_LNG_MIN || lng > UAE_LNG_MAX) {
        warnings.push(
          `Row ${rowNum}: Coordinates (${lat}, ${lng}) may be outside UAE. ` +
            `Expected range: Lat ${UAE_LAT_MIN}-${UAE_LAT_MAX}, Lng ${UAE_LNG_MIN}-${UAE_LNG_MAX}`,
        );
      }

      if (rowErrors.length === 0) {
        validData.push({
          ...row,
          customer: String(row.customer).trim(),
          address: String(row.address).trim(),
          lat,
          lng,
          phone:
            row.phone != null && row.phone !== ''
              ? String(row.phone).trim()
              : (row.phone as string) || '',
          items: String(row.items).trim(),
          status: (row.status as string) || 'pending',
        } as Delivery);
      }
    }

    if (rowErrors.length > 0) {
      errors.push(...rowErrors);
    }
  });

  return {
    isValid: errors.length === 0 && validData.length > 0,
    errors,
    warnings,
    validData,
  };
}

export function formatValidationError(validation: ValidationResult): string {
  const parts: string[] = [];

  if (validation.errors.length > 0) {
    parts.push(`Errors:\n• ${validation.errors.join('\n• ')}`);
  }

  if (validation.warnings.length > 0) {
    parts.push(`Warnings:\n• ${validation.warnings.join('\n• ')}`);
  }

  return parts.join('\n\n');
}
