// Data transformer to convert actual Excel/ERP format to system format
import { normalizeUAEPhone } from './phoneUtils';
import type { RawERPRow, TransformedDelivery, DetectedFormat } from '../types';

// Module-level flag to log available columns only once
let extractPONumberLogged = false;

function extractPONumber(row: RawERPRow | null): string | null {
  if (!row) return null;

  if (!extractPONumberLogged) {
    console.log('[dataTransformer] Available columns:', Object.keys(row));
    console.log('[dataTransformer] Looking for PO Number in columns...');
    extractPONumberLogged = true;
  }

  const exactMatches = [
    'PO Number', 'PO#', 'PO', 'Cust. PO Number', 'Purchase Order', 'PONumber',
    'PO Ref', 'PO Reference', 'Purchase Order Number', 'Order Number',
    'po number', 'po#', 'po', 'order no', 'Order No', 'ORDER NO',
    'Delivery number', 'Delivery Number', 'DeliveryNumber', 'Delivery',
  ];

  for (const colName of exactMatches) {
    if (colName in row && row[colName] !== null && row[colName] !== undefined && row[colName] !== '') {
      const val = String(row[colName]).trim();
      if (val && val !== 'null' && val !== 'undefined') {
        console.log(`[dataTransformer] Found PO Number in column "${colName}": "${val}"`);
        return val;
      }
    }
  }

  for (const [colName, value] of Object.entries(row)) {
    const trimmedCol = colName.trim();
    if (exactMatches.includes(trimmedCol) && value !== null && value !== undefined && value !== '') {
      const val = String(value).trim();
      if (val && val !== 'null' && val !== 'undefined') {
        console.log(`[dataTransformer] Found PO Number in trimmed column "${trimmedCol}": "${val}"`);
        return val;
      }
    }
  }

  for (const [colName, value] of Object.entries(row)) {
    const lowerCol = colName.toLowerCase().trim();
    if (
      (lowerCol.includes('po') || lowerCol.includes('order') || lowerCol.includes('delivery')) &&
      value !== null && value !== undefined && value !== ''
    ) {
      const val = String(value).trim();
      if (val && val !== 'null' && val !== 'undefined') {
        console.log(`[dataTransformer] Found PO Number via fuzzy match in column "${colName}": "${val}"`);
        return val;
      }
    }
  }

  console.warn('[dataTransformer] No PO Number found in row');
  return null;
}

function parseCoordinate(value: unknown): number {
  if (value === null || value === undefined) return NaN;
  if (typeof value === 'number') return value;
  let s = String(value).trim();
  s = s.replace(/,/g, '.');
  s = s.replace(/[^0-9.-]+/g, '');
  const v = parseFloat(s);
  return isNaN(v) ? NaN : v;
}

export function transformERPData(data: RawERPRow[]): TransformedDelivery[] {
  return data.map((row, index) => {
    const customer =
      row['Ship to party'] || row['Name'] || row['Payer Name'] || `Customer ${index + 1}`;
    const address =
      [row['Ship to Street'], row['City'], row['Postal code']].filter(Boolean).join(', ') ||
      'Address not available';

    const phone =
      row['Telephone1'] ||
      row['Phone'] ||
      row['Mobile'] ||
      row['Contact Phone'] ||
      row['Ship to Phone'] ||
      row['Telephone'] ||
      '';

    const items =
      [row['Description'], row['Material']].filter(Boolean).join(' - ') || 'Items not specified';

    const rowKeys = Object.keys(row || {});
    const latKeyCandidates = [
      'Ship to Latitude', 'Ship To Latitude', 'Ship-to Latitude', 'ShipToLatitude',
      'Latitude', 'Lat', 'LATITUDE', 'Lat (Dec)', 'Ship to Lat',
    ];
    const lngKeyCandidates = [
      'Ship to Longitude', 'Ship To Longitude', 'Ship-to Longitude', 'ShipToLongitude',
      'Longitude', 'Long', 'Lon', 'LON', 'Lon (Dec)', 'Ship to Long',
    ];

    const findKey = (candidates: string[]): string | null => {
      for (const c of candidates) {
        if (c in row) return c;
      }
      for (const k of rowKeys) {
        if (k.toLowerCase().includes('lat')) return k;
      }
      return null;
    };

    const latKey = findKey(latKeyCandidates);
    const lngKey = findKey(lngKeyCandidates);
    const combinedCandidates = [
      'Coordinates', 'Coord', 'Location', 'Geo', 'Ship to Coordinates', 'LatLon', 'Lat/Lon',
      'Latitude/Longitude',
    ];
    const combinedKey =
      combinedCandidates.find((c) => c in row) ||
      rowKeys.find((k) => /coord|lat.*lon|latlon|lat\/?lon/i.test(k));

    let latRaw: number;
    let lngRaw: number;

    if (latKey && lngKey) {
      latRaw = parseCoordinate(row[latKey]);
      lngRaw = parseCoordinate(row[lngKey]);
    } else if (combinedKey) {
      const v = String(row[combinedKey] || '').trim();
      const parts = v.includes(',') ? v.split(',') : v.split(/\s+/);
      if (parts.length >= 2) {
        latRaw = parseCoordinate(parts[0]);
        lngRaw = parseCoordinate(parts[1]);
      } else {
        latRaw = parseCoordinate(row['Ship to Latitude']);
        lngRaw = parseCoordinate(row['Ship to Longitude']);
      }
    } else {
      latRaw = parseCoordinate(row['Ship to Latitude']);
      lngRaw = parseCoordinate(row['Ship to Longitude']);
    }

    const lat = !isNaN(latRaw) ? latRaw : 25.1124;
    const lng = !isNaN(lngRaw) ? lngRaw : 55.198;

    const poNumber = extractPONumber(row);

    const originalRow: Record<string, unknown> = {};
    if (row && typeof row === 'object') {
      for (const [k, v] of Object.entries(row)) {
        if (v !== undefined && v !== null && v !== '') originalRow[k] = v;
      }
    }

    const rawPhone = String(phone).trim();
    const normalizedPhone = normalizeUAEPhone(rawPhone) || rawPhone;
    if (normalizedPhone !== rawPhone) {
      console.log(`[dataTransformer] Phone normalized: "${rawPhone}" → "${normalizedPhone}"`);
    }

    return {
      customer: String(customer).trim(),
      address: String(address).trim(),
      lat,
      lng,
      phone: normalizedPhone,
      items: String(items).trim(),
      poNumber,
      PONumber: poNumber,
      _usedDefaultCoords: isNaN(latRaw) || isNaN(lngRaw),
      _originalDeliveryNumber:
        (row['Delivery number'] || row['Delivery Number'] || row['DeliveryNumber']) as string | null,
      _originalPONumber: poNumber,
      _originalQuantity: (row['Confirmed quantity'] || row['Confirmed Quantity'] || row['Qty'] || row['Quantity']) as string | number | null,
      _originalCity: (row['City'] || row['city']) as string | null,
      _originalRoute: (row['Route'] || row['route']) as string | null,
      _originalRow: originalRow,
    };
  });
}

export function detectDataFormat(data: RawERPRow[]): DetectedFormat {
  if (!Array.isArray(data) || data.length === 0) {
    return { format: 'unknown', transform: null };
  }

  const firstRow = data[0];
  const keys = Object.keys(firstRow);

  const hasSimplifiedFormat =
    'customer' in firstRow &&
    'address' in firstRow &&
    'lat' in firstRow &&
    'lng' in firstRow &&
    'phone' in firstRow &&
    'items' in firstRow;

  if (hasSimplifiedFormat) {
    return { format: 'simplified', transform: null };
  }

  const hasERPFormat =
    ('Delivery number' in firstRow || 'Sales Document' in firstRow) &&
    ('Ship to party' in firstRow || 'Name' in firstRow);

  if (hasERPFormat) {
    return { format: 'erp', transform: transformERPData };
  }

  const hasCityColumn = keys.some((k) => k.toLowerCase().includes('city'));
  const hasAddressColumn = keys.some((k) => k.toLowerCase().includes('address'));
  const hasPhoneColumn = keys.some(
    (k) => k.toLowerCase().includes('phone') || k.toLowerCase().includes('telephone'),
  );

  if (hasCityColumn && (hasAddressColumn || hasPhoneColumn)) {
    return { format: 'generic', transform: transformGenericData };
  }

  return { format: 'unknown', transform: null };
}

export function transformGenericData(data: RawERPRow[]): TransformedDelivery[] {
  return data.map((row, index) => {
    const keys = Object.keys(row);

    const customerKey = keys.find(
      (k) =>
        k.toLowerCase().includes('customer') ||
        k.toLowerCase().includes('name') ||
        k.toLowerCase().includes('company'),
    );
    const addressKey = keys.find(
      (k) => k.toLowerCase().includes('address') || k.toLowerCase().includes('street'),
    );
    const cityKey = keys.find((k) => k.toLowerCase().includes('city'));
    const phoneKey = keys.find(
      (k) => k.toLowerCase().includes('phone') || k.toLowerCase().includes('telephone'),
    );
    const itemsKey = keys.find(
      (k) =>
        k.toLowerCase().includes('item') ||
        k.toLowerCase().includes('description') ||
        k.toLowerCase().includes('product'),
    );
    const latKey = keys.find((k) => k.toLowerCase().includes('lat'));
    const lngKey = keys.find(
      (k) => k.toLowerCase().includes('lng') || k.toLowerCase().includes('lon'),
    );

    const customer = (customerKey ? row[customerKey] : null) || `Customer ${index + 1}`;
    const address =
      [addressKey ? row[addressKey] : null, cityKey ? row[cityKey] : null]
        .filter(Boolean)
        .join(', ') || 'Address not available';

    const latRaw = parseCoordinate(latKey ? row[latKey] : undefined);
    const lngRaw = parseCoordinate(lngKey ? row[lngKey] : undefined);
    const lat = !isNaN(latRaw) ? latRaw : 25.1124;
    const lng = !isNaN(lngRaw) ? lngRaw : 55.198;
    const rawPhone = String(phoneKey ? (row[phoneKey] ?? '') : '').trim();
    const normalizedPhone = normalizeUAEPhone(rawPhone) || rawPhone;
    if (normalizedPhone !== rawPhone) {
      console.log(`[dataTransformer] Phone normalized: "${rawPhone}" → "${normalizedPhone}"`);
    }
    const items = (itemsKey ? row[itemsKey] : null) || 'Items not specified';
    const poNumber = extractPONumber(row);

    const originalRow: Record<string, unknown> = {};
    if (row && typeof row === 'object') {
      for (const [k, v] of Object.entries(row)) {
        if (v !== undefined && v !== null && v !== '') originalRow[k] = v;
      }
    }

    return {
      customer: String(customer).trim(),
      address: String(address).trim(),
      lat,
      lng,
      phone: normalizedPhone,
      items: String(items).trim(),
      poNumber,
      PONumber: poNumber,
      _usedDefaultCoords: isNaN(latRaw) || isNaN(lngRaw),
      _originalPONumber: poNumber,
      _originalRow: originalRow,
    };
  });
}
