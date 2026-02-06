// Validation utility for delivery data
const REQUIRED_COLUMNS = ['customer', 'address', 'lat', 'lng', 'items'];
const OPTIONAL_COLUMNS = ['phone'];
const DUBAI_LAT_MIN = 24.7;
const DUBAI_LAT_MAX = 25.5;
const DUBAI_LNG_MIN = 54.8;
const DUBAI_LNG_MAX = 55.7;

export function validateDeliveryData(data) {
  const errors = [];
  const warnings = [];

  if (!Array.isArray(data) || data.length === 0) {
    return {
      isValid: false,
      errors: ['File is empty or no data found'],
      warnings: [],
      validData: []
    };
  }

  // Check if all required columns exist
  const firstRow = data[0];
  const missingColumns = REQUIRED_COLUMNS.filter(col => !(col in firstRow));
  
  if (missingColumns.length > 0) {
    return {
      isValid: false,
      errors: [`Missing required columns: ${missingColumns.join(', ')}`],
      warnings: [],
      validData: []
    };
  }

  // Validate each row
  const validData = [];
  data.forEach((row, rowIndex) => {
    const rowNum = rowIndex + 2; // +2 because row 1 is header, +1 for 1-based indexing
    const rowErrors = [];

    // Validate required fields
    if (!row.customer || String(row.customer).trim() === '') {
      rowErrors.push(`Row ${rowNum}: Customer name is required`);
    }

    if (!row.address || String(row.address).trim() === '') {
      rowErrors.push(`Row ${rowNum}: Address is required`);
    }

    // Phone is optional - only warn if provided but empty string
    // Skip validation for phone completely

    if (!row.items || String(row.items).trim() === '') {
      rowErrors.push(`Row ${rowNum}: Items description is required`);
    }

    // Validate coordinates
    const lat = parseFloat(row.lat);
    const lng = parseFloat(row.lng);

    if (isNaN(lat) || isNaN(lng)) {
      rowErrors.push(`Row ${rowNum}: Latitude and Longitude must be valid numbers`);
    } else {
      // Validate Dubai coordinates
      if (lat < DUBAI_LAT_MIN || lat > DUBAI_LAT_MAX || lng < DUBAI_LNG_MIN || lng > DUBAI_LNG_MAX) {
        warnings.push(
          `Row ${rowNum}: Coordinates (${lat}, ${lng}) may be outside Dubai area. ` +
          `Expected range: Lat ${DUBAI_LAT_MIN}-${DUBAI_LAT_MAX}, Lng ${DUBAI_LNG_MIN}-${DUBAI_LNG_MAX}`
        );
      }

      // If row is otherwise valid, add it to validData — preserve ALL row fields (poNumber, metadata, etc.)
      if (rowErrors.length === 0) {
        validData.push({
          ...row,
          customer: String(row.customer).trim(),
          address: String(row.address).trim(),
          lat,
          lng,
          phone: row.phone != null && row.phone !== '' ? String(row.phone).trim() : (row.phone || ''),
          items: String(row.items).trim()
        });
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
    validData
  };
}

export function formatValidationError(validation) {
  const parts = [];
  
  if (validation.errors.length > 0) {
    parts.push(`Errors:\n• ${validation.errors.join('\n• ')}`);
  }
  
  if (validation.warnings.length > 0) {
    parts.push(`Warnings:\n• ${validation.warnings.join('\n• ')}`);
  }

  return parts.join('\n\n');
}
