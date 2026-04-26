/**
 * Server-side data transformer.
 *
 * Exact copy of src/utils/dataTransformer.ts with imports re-pointed for the
 * server build. Used ONLY by the auto-ingest path (/api/ingest/file).
 * Does not affect manual upload, which continues to use the frontend version.
 *
 * When the frontend transformer changes, mirror the change here.
 */
import { normalizeUAEPhone } from '../../utils/phoneUtils';

// Inline type shims — frontend src/types is not in server build scope.
export type RawERPRow = Record<string, unknown>;
export interface TransformedDelivery {
  customer: string;
  address: string;
  lat: number;
  lng: number;
  phone: string;
  items: string;
  poNumber: string | null;
  PONumber: string | null;
  _usedDefaultCoords: boolean;
  _originalDeliveryNumber?: string | null;
  _originalPONumber?: string | null;
  _originalQuantity?: string | number | null;
  _originalCity?: string | null;
  _originalRoute?: string | null;
  _originalRow?: Record<string, unknown>;
  _goodsMovementDate?: string | null;
  _requestedDeliveryDate?: string | null;
  _isB2B?: boolean;
  _deliveryNumber?: string | null;
}
export interface DetectedFormat {
  format: 'erp' | 'generic' | 'simplified' | 'unknown';
  transform: ((data: RawERPRow[]) => TransformedDelivery[]) | null;
}

// Module-level flag to log available columns only once
let extractPONumberLogged = false;

/** Values that SAP/ERP often put in "delivery status" / category columns — never treat as a PO. */
const NON_PO_VALUE = new Set(
  [
    'removed', 'deleted', 'cancelled', 'canceled', 'open', 'closed', 'yes', 'no', 'active', 'inactive',
    'pending', 'completed', 'partial', 'full', 'none', 'n/a', 'na', '-', '—', '',
  ].map((s) => s.toLowerCase()),
);

/**
 * When the column name contains "order" or "delivery" but not a clear PO hint, require a value
 * that looks like an identifier (avoids picking "removed" from "Overall delivery status").
 */
function looksLikePurchaseOrderValue(raw: string): boolean {
  const v = raw.trim();
  if (!v || v.length > 120) return false;
  const lower = v.toLowerCase();
  if (NON_PO_VALUE.has(lower)) return false;
  if (/^(true|false)$/i.test(v)) return false;
  if (/\d/.test(v)) return true;
  return /^[A-Z0-9][A-Z0-9./\-_]{3,}$/i.test(v);
}

/** Column substrings that indicate the field is not a PO / order id (fuzzy match only). */
const FUZZY_PO_COLUMN_BLOCK =
  /status|reason|block|category|indicator|date|time|priority|qty|quantity|amount|line\s*item|item\s*no|net\s*val|gross|weight|volume|route|plant|storage|ship\s*point|picking|loading|partner|incoterms|description|material|text|note|comment/i;

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
        // "Delivery" alone is ambiguous; reject obvious status words so we can fall through to a real PO column.
        if (colName === 'Delivery' && !looksLikePurchaseOrderValue(val)) {
          continue;
        }
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
        if (trimmedCol === 'Delivery' && !looksLikePurchaseOrderValue(val)) {
          continue;
        }
        console.log(`[dataTransformer] Found PO Number in trimmed column "${trimmedCol}": "${val}"`);
        return val;
      }
    }
  }

  // Fuzzy: prefer columns that clearly refer to PO / purchase order
  for (const [colName, value] of Object.entries(row)) {
    if (value === null || value === undefined || value === '') continue;
    const val = String(value).trim();
    if (!val || val === 'null' || val === 'undefined') continue;
    const lowerCol = colName.toLowerCase().trim();
    const poish =
      lowerCol.includes('po') ||
      lowerCol.includes('purchase order') ||
      lowerCol.includes('cust. po') ||
      lowerCol.includes('p.o.');
    if (poish && !FUZZY_PO_COLUMN_BLOCK.test(colName) && looksLikePurchaseOrderValue(val)) {
      console.log(`[dataTransformer] Found PO Number via fuzzy match (PO-ish column) in "${colName}": "${val}"`);
      return val;
    }
  }

  // Fuzzy: "order" / "delivery" in header — strict value + exclude status-style columns
  for (const [colName, value] of Object.entries(row)) {
    if (value === null || value === undefined || value === '') continue;
    const val = String(value).trim();
    if (!val || val === 'null' || val === 'undefined') continue;
    const lowerCol = colName.toLowerCase().trim();
    const mentionsOrderOrDelivery = lowerCol.includes('order') || lowerCol.includes('delivery');
    const mentionsPo = lowerCol.includes('po') || lowerCol.includes('purchase');
    if (!mentionsOrderOrDelivery || mentionsPo) continue;
    if (FUZZY_PO_COLUMN_BLOCK.test(colName)) continue;
    if (!looksLikePurchaseOrderValue(val)) continue;
    console.log(`[dataTransformer] Found PO Number via fuzzy match in column "${colName}": "${val}"`);
    return val;
  }

  console.warn('[dataTransformer] No PO Number found in row');
  return null;
}

/**
 * Extract and parse the Goods Movement Date (GMD) from an ERP row.
 * GMD = the date the warehouse physically dispatched / issued the goods.
 * When filled it acts as the dispatch signal; when blank the order is not yet dispatched.
 *
 * Handles: ISO strings, DD.MM.YYYY, MM/DD/YYYY, Excel serial numbers.
 */
function parseGoodsMovementDate(row: RawERPRow | null): string | null {
  if (!row) return null;

  const candidates = [
    'Goods Movement Date', 'GoodsMovementDate', 'goods_movement_date', 'GMD',
    'Goods Mvt Date', 'Goods Issue Date', 'GI Date', 'Actual GI Date',
    'Movement Date', 'Mvt Date', 'Dispatch Date', 'Dispatched Date',
    'Actual Goods Movement Date', 'GoodsIssuedDate', 'GI_Date',
    'Posting Date', 'Post Date',
  ];

  for (const col of candidates) {
    const val = row[col];
    if (val === null || val === undefined || val === '') continue;
    const result = convertToIsoDate(val);
    if (result) return result;
  }

  // Fuzzy match: any column whose name contains 'movement', 'dispatch', or 'goods issue'
  for (const [col, val] of Object.entries(row)) {
    const lc = col.toLowerCase();
    if ((lc.includes('movement') || lc.includes('dispatch') || lc.includes('goods issue') || lc.includes('gi date')) && val !== null && val !== undefined && val !== '') {
      const result = convertToIsoDate(val);
      if (result) return result;
    }
  }

  return null;
}

// B2B orders skip SMS confirmation; the customer's preferred delivery date comes
// straight from the uploaded file's "Requested Deliv. Date" column. Used to seed
// confirmedDeliveryDate so Plan ETA anchors correctly without a customer reply.
function parseRequestedDeliveryDate(row: RawERPRow | null): string | null {
  if (!row) return null;

  const candidates = [
    'Requested Deliv. Date', 'Requested Delivery Date', 'RequestedDeliveryDate',
    'Requested Deliv Date', 'Req. Delivery Date', 'Req Delivery Date',
    'Customer Requested Date', 'CustomerRequestedDate',
    'Delivery Date', 'DeliveryDate',
    'Requested Date', 'Req Date',
  ];

  for (const col of candidates) {
    const val = row[col];
    if (val === null || val === undefined || val === '') continue;
    const result = convertToIsoDate(val);
    if (result) return result;
  }

  // Fuzzy match: any column header that contains 'request' AND 'date' (covers
  // SAP variants like "Requested deliv.date" with no space, or "Req'd Date").
  for (const [col, val] of Object.entries(row)) {
    const lc = col.toLowerCase();
    if (lc.includes('request') && lc.includes('date') && val !== null && val !== undefined && val !== '') {
      const result = convertToIsoDate(val);
      if (result) return result;
    }
  }

  return null;
}

function convertToIsoDate(val: unknown): string | null {
  if (val === null || val === undefined || val === '') return null;

  // Excel serial number (number of days since 1900-01-01)
  if (typeof val === 'number') {
    if (val < 1000 || val > 200000) return null; // Not a plausible date serial
    // Subtract 25569 (days from 1900-01-01 to 1970-01-01), account for Excel 1900 leap year bug
    const ms = (val - 25569) * 86400000;
    const d = new Date(ms);
    if (!isNaN(d.getTime())) return d.toISOString();
    return null;
  }

  const str = String(val).trim();
  if (!str) return null;

  // Already ISO or recognisable by Date constructor (YYYY-MM-DD, YYYY/MM/DD, etc.)
  let d = new Date(str);
  if (!isNaN(d.getTime())) return d.toISOString();

  // DD.MM.YYYY (common in SAP/ERP exports)
  const dmyDot = str.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (dmyDot) {
    d = new Date(`${dmyDot[3]}-${dmyDot[2].padStart(2, '0')}-${dmyDot[1].padStart(2, '0')}`);
    if (!isNaN(d.getTime())) return d.toISOString();
  }

  // DD/MM/YYYY
  const dmySlash = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmySlash) {
    d = new Date(`${dmySlash[3]}-${dmySlash[2].padStart(2, '0')}-${dmySlash[1].padStart(2, '0')}`);
    if (!isNaN(d.getTime())) return d.toISOString();
  }

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
    // B2C: personal name present → individual customer
    // B2B: no personal name → company (Ship-to Party)
    const rawName = row['Name'];
    const nameVal = rawName != null ? String(rawName).trim() : '';
    const shipToVal = (
      row['Ship-to Party'] ||
      row['Ship To Party'] ||
      row['Ship to Party'] ||
      row['Ship to party'] ||
      row['Ship-to party'] ||
      row['SHIP TO PARTY']
    );
    const customer = nameVal || (shipToVal != null ? String(shipToVal).trim() : '') || `Customer ${index + 1}`;
    const address =
      [row['Ship to Street'], row['Ship-to Street'], row['Street'], row['Address'], row['City'], row['Postal code']]
        .filter(Boolean)
        .join(', ') ||
      'Address not available';

    const phone =
      row['Telephone1'] ||
      row['Phone'] ||
      row['Mobile'] ||
      row['Contact Phone'] ||
      row['Ship to Phone'] ||
      row['Telephone'] ||
      row['Phone Number'] ||
      row['phone_number'] ||
      row['phone'] ||
      row['Tel'] ||
      row['Tel.'] ||
      row['Contact No'] ||
      row['Contact No.'] ||
      row['HP'] ||
      row['Handphone'] ||
      row['Whatsapp'] ||
      row['WhatsApp'] ||
      row['No HP'] ||
      row['No. HP'] ||
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

    // B2B detection: any Ship-to Name variant present means this is a company order.
    // B2B orders skip the SMS confirmation step entirely — their delivery date
    // comes from the "Requested Deliv. Date" column in the uploaded file.
    const shipToName =
      row['Ship-to Name'] ?? row['Ship to Name'] ?? row['ShipToName'] ?? row['Ship-To Name'];
    const isB2B = shipToName != null && String(shipToName).trim().length > 0;

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
      _goodsMovementDate: parseGoodsMovementDate(row),
      _requestedDeliveryDate: parseRequestedDeliveryDate(row),
      _isB2B: isB2B,
      _deliveryNumber:
        ((row['Delivery number'] ||
          row['Delivery Number'] ||
          row['DeliveryNumber'] ||
          row['Delivery No'] ||
          row['Del. No'] ||
          row['Del No'] ||
          row['DeliveryNo'] ||
          row['DN'] ||
          row['Del#']) as string | null) || null,
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

  const hasDeliveryOrSalesKey =
    'Delivery number' in firstRow ||
    'Delivery Number' in firstRow ||
    'DeliveryNumber' in firstRow ||
    'Sales Document' in firstRow;
  const hasErpCustomerKey =
    'Ship-to Party' in firstRow ||
    'Ship To Party' in firstRow ||
    'Ship to Party' in firstRow ||
    'Ship to party' in firstRow ||
    'Ship-to party' in firstRow ||
    'SHIP TO PARTY' in firstRow ||
    'Sold-to party' in firstRow ||
    'Customer' in firstRow ||
    'Customer Name' in firstRow ||
    'Customer name' in firstRow ||
    'Name' in firstRow;

  const hasERPFormat = hasDeliveryOrSalesKey && hasErpCustomerKey;

  if (hasERPFormat) {
    return { format: 'erp', transform: transformERPData };
  }

  const hasCityColumn = keys.some((k) => k.toLowerCase().includes('city'));
  const hasAddressColumn = keys.some((k) => {
    const l = k.toLowerCase();
    return l.includes('address') || l.includes('street') || l.includes('location');
  });
  const hasPhoneColumn = keys.some(
    (k) => k.toLowerCase().includes('phone') || k.toLowerCase().includes('telephone') || k.toLowerCase().includes('mobile'),
  );

  if (hasCityColumn && (hasAddressColumn || hasPhoneColumn)) {
    return { format: 'generic', transform: transformGenericData };
  }

  return { format: 'unknown', transform: null };
}

export function transformGenericData(data: RawERPRow[]): TransformedDelivery[] {
  return data.map((row, index) => {
    const keys = Object.keys(row);

    const customerKey = keys.find((k) => {
      const l = k.toLowerCase();
      return (
        l.includes('customer') ||
        l.includes('ship to party') ||
        l.includes('ship-to party') ||
        l.includes('sold-to') ||
        l.includes('recipient') ||
        (l.includes('name') && !l.includes('material') && !l.includes('user')) ||
        l.includes('company')
      );
    });
    const addressKey = keys.find((k) => {
      const l = k.toLowerCase();
      return l.includes('address') || l.includes('street') || l.includes('location') || l.includes('ship to street');
    });
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
    const deliveryNumberKey = keys.find((k) => {
      const l = k.toLowerCase().replace(/\s+/g, ' ').trim();
      if (l.includes('delivery') && l.includes('number')) return true;
      if (l === 'deliverynumber') return true;
      if (l === 'dn') return true;
      if (/^del\.?\s*no\.?$/i.test(k.trim())) return true;
      return false;
    });

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

    // GMD: check for goods movement date column
    const gmdKey = keys.find(k => {
      const lc = k.toLowerCase();
      return lc.includes('movement') || lc.includes('dispatch') || lc.includes('goods issue') || lc === 'gmd' || lc.includes('gi date');
    });
    const rawGmd = gmdKey ? row[gmdKey] : null;

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
      _goodsMovementDate: rawGmd != null ? convertToIsoDate(rawGmd) : null,
      _deliveryNumber: (() => {
        if (!deliveryNumberKey) return null;
        const v = row[deliveryNumberKey];
        if (v == null || v === '') return null;
        const s = String(v).trim();
        return s ? s : null;
      })(),
    };
  });
}
