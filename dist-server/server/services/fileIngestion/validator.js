"use strict";
/**
 * Server-side delivery row validation — mirror of src/utils/dataValidator.ts.
 * Kept separate from the frontend version so server builds don't depend on
 * frontend code paths. Both versions must stay in sync when validation rules
 * change.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateDeliveryData = validateDeliveryData;
const REQUIRED_COLUMNS = ['customer', 'address', 'lat', 'lng', 'items'];
// Dubai bounding box — same values as frontend validator
const DUBAI_LAT_MIN = 24.7;
const DUBAI_LAT_MAX = 25.5;
const DUBAI_LNG_MIN = 54.8;
const DUBAI_LNG_MAX = 55.7;
function validateDeliveryData(data) {
    const errors = [];
    const warnings = [];
    if (!Array.isArray(data) || data.length === 0) {
        return { isValid: false, errors: ['File is empty or no data found'], warnings: [], validData: [] };
    }
    const firstRow = data[0];
    const missingColumns = REQUIRED_COLUMNS.filter((col) => !(col in firstRow));
    if (missingColumns.length > 0) {
        return {
            isValid: false,
            errors: [`Missing required columns: ${missingColumns.join(', ')}`],
            warnings: [],
            validData: [],
        };
    }
    const validData = [];
    data.forEach((rawRow, rowIndex) => {
        const row = rawRow;
        const rowNum = rowIndex + 2; // +1 for header, +1 for 1-based
        const rowErrors = [];
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
        }
        else {
            if (lat < DUBAI_LAT_MIN || lat > DUBAI_LAT_MAX || lng < DUBAI_LNG_MIN || lng > DUBAI_LNG_MAX) {
                warnings.push(`Row ${rowNum}: Coordinates (${lat}, ${lng}) may be outside Dubai area.`);
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
                    status: row.status || 'pending',
                });
            }
        }
        if (rowErrors.length > 0)
            errors.push(...rowErrors);
    });
    return {
        isValid: errors.length === 0 && validData.length > 0,
        errors,
        warnings,
        validData,
    };
}
