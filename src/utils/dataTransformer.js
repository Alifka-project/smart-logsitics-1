// Data transformer to convert actual Excel format to system format
/**
 * Extract PO Number from row with multiple fallback strategies
 */
function extractPONumber(row) {
  if (!row) return null;
  
  // Log all available columns for debugging (only for first row)
  if (!extractPONumber.logged) {
    console.log('[dataTransformer] Available columns:', Object.keys(row));
    console.log('[dataTransformer] Looking for PO Number in columns...');
    extractPONumber.logged = true;
  }
  
  // Try exact column name matches first (with trimmed keys)
  const exactMatches = [
    'PO Number', 'PO#', 'PO', 'Cust. PO Number', 'Purchase Order', 'PONumber',
    'PO Ref', 'PO Reference', 'Purchase Order Number', 'Order Number',
    'po number', 'po#', 'po', 'order no', 'Order No', 'ORDER NO',
    'Delivery number', 'Delivery Number', 'DeliveryNumber', 'Delivery'
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
  
  // Try trimmed keys (Excel sometimes adds spaces)
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
  
  // Try case-insensitive search in all columns
  for (const [colName, value] of Object.entries(row)) {
    const lowerCol = colName.toLowerCase().trim();
    if ((lowerCol.includes('po') || lowerCol.includes('order') || lowerCol.includes('delivery')) && 
        value !== null && value !== undefined && value !== '') {
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

/**
 * Parse a coordinate value from various Excel/CVS formats to a float.
 * Accepts numbers, strings with comma decimals ("25,1124"), extraneous spaces,
 * and will strip non-numeric characters where reasonable.
 */
function parseCoordinate(value) {
  if (value === null || value === undefined) return NaN;
  if (typeof value === 'number') return value;
  let s = String(value).trim();
  // Replace comma decimal separators with dot
  s = s.replace(/,/g, '.');
  // Remove any characters except digits, dot, minus
  s = s.replace(/[^0-9.\-]+/g, '');
  const v = parseFloat(s);
  return isNaN(v) ? NaN : v;
}
export function transformERPData(data) {
  /**
   * Transform SAP/ERP delivery data to simplified delivery format
   * Maps real delivery data columns to system-expected columns
   */
  return data.map((row, index) => {
    // Map ERP columns to system columns
    const customer = row['Ship to party'] || row['Name'] || row['Payer Name'] || `Customer ${index + 1}`;
    const address = [
      row['Ship to Street'],
      row['City'],
      row['Postal code']
    ].filter(Boolean).join(', ') || 'Address not available';
    
    // Check multiple phone column variations
    const phone = row['Telephone1'] || 
                  row['Phone'] || 
                  row['Mobile'] || 
                  row['Contact Phone'] ||
                  row['Ship to Phone'] ||
                  row['Telephone'] ||
                  '';
    
    // Create item description from material info
    const items = [
      row['Description'],
      row['Material']
    ].filter(Boolean).join(' - ') || 'Items not specified';

        // Resolve possible latitude/longitude column names (ERP exports vary)
        const rowKeys = Object.keys(row || {});
        const latKeyCandidates = [
          'Ship to Latitude', 'Ship To Latitude', 'Ship-to Latitude', 'ShipToLatitude',
          'Latitude', 'Lat', 'LATITUDE', 'Lat (Dec)', 'Ship to Lat'
        ];
        const lngKeyCandidates = [
          'Ship to Longitude', 'Ship To Longitude', 'Ship-to Longitude', 'ShipToLongitude',
          'Longitude', 'Long', 'Lon', 'LON', 'Lon (Dec)', 'Ship to Long'
        ];

        const findKey = (candidates) => {
          for (const c of candidates) {
            if (c in row) return c;
          }
          // fallback: find any key containing "lat" / "lon" case-insensitive
          for (const k of rowKeys) {
            if (k.toLowerCase().includes('lat')) return k;
          }
          return null;
        };

        const latKey = findKey(latKeyCandidates);
        const lngKey = findKey(lngKeyCandidates);
        // Also support combined coordinate fields like "Coordinates" => "25.1124,55.1980"
        const combinedCandidates = ['Coordinates', 'Coord', 'Location', 'Geo', 'Ship to Coordinates', 'LatLon', 'Lat/Lon', 'Latitude/Longitude'];
        const combinedKey = combinedCandidates.find(c => c in row) || rowKeys.find(k => /coord|lat.*lon|latlon|lat\/?lon/i.test(k));

        let latRaw, lngRaw;
        if (latKey && lngKey) {
          latRaw = parseCoordinate(row[latKey]);
          lngRaw = parseCoordinate(row[lngKey]);
        } else if (combinedKey) {
          const v = String(row[combinedKey] || '').trim();
          // Try splitting by comma or space
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
        const lat = !isNaN(latRaw) ? latRaw : 25.1124; // Default to Dubai area
        const lng = !isNaN(lngRaw) ? lngRaw : 55.1980;

    // Extract PO Number for this delivery
    const poNumber = extractPONumber(row);
    
    return {
      customer: String(customer).trim(),
      address: String(address).trim(),
      lat,
      lng,
      phone: String(phone).trim(),
      items: String(items).trim(),
      // Map PO Number to the expected field name
      poNumber: poNumber,
      PONumber: poNumber, // Also support uppercase variant
      // Indicate whether defaults were applied because parsing failed
      _usedDefaultCoords: isNaN(latRaw) || isNaN(lngRaw),
      // Store original data for reference
      _originalDeliveryNumber: row['Delivery number'] || row['Delivery Number'] || row['DeliveryNumber'],
      _originalPONumber: poNumber,
      _originalQuantity: row['Confirmed quantity'] || row['Confirmed Quantity'] || row['Qty'] || row['Quantity'],
      _originalCity: row['City'] || row['city'],
      _originalRoute: row['Route'] || row['route']
    };
  });
}

export function detectDataFormat(data) {
  /**
   * Detect if the uploaded data is in ERP format or simplified format
   * Returns the format type and transformation function if needed
   */
  if (!Array.isArray(data) || data.length === 0) {
    return { format: 'unknown', transform: null };
  }

  const firstRow = data[0];
  const keys = Object.keys(firstRow);

  // Check for simplified format (expected by system)
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

  // Check for SAP/ERP format
  const hasERPFormat = 
    ('Delivery number' in firstRow || 'Sales Document' in firstRow) &&
    ('Ship to party' in firstRow || 'Name' in firstRow);

  if (hasERPFormat) {
    return { format: 'erp', transform: transformERPData };
  }

  // Check for other common formats
  const hasCityColumn = keys.some(k => k.toLowerCase().includes('city'));
  const hasAddressColumn = keys.some(k => k.toLowerCase().includes('address'));
  const hasPhoneColumn = keys.some(k => k.toLowerCase().includes('phone') || k.toLowerCase().includes('telephone'));

  if (hasCityColumn && (hasAddressColumn || hasPhoneColumn)) {
    return { format: 'generic', transform: transformGenericData };
  }

  return { format: 'unknown', transform: null };
}

export function transformGenericData(data) {
  /**
   * Transform generic delivery data with flexible column mapping
   */
  return data.map((row, index) => {
    const keys = Object.keys(row);
    
    // Find columns by matching common patterns
    const customerKey = keys.find(k => k.toLowerCase().includes('customer') || k.toLowerCase().includes('name') || k.toLowerCase().includes('company'));
    const addressKey = keys.find(k => k.toLowerCase().includes('address') || k.toLowerCase().includes('street'));
    const cityKey = keys.find(k => k.toLowerCase().includes('city'));
    const phoneKey = keys.find(k => k.toLowerCase().includes('phone') || k.toLowerCase().includes('telephone'));
    const itemsKey = keys.find(k => k.toLowerCase().includes('item') || k.toLowerCase().includes('description') || k.toLowerCase().includes('product'));
    const latKey = keys.find(k => k.toLowerCase().includes('lat'));
    const lngKey = keys.find(k => k.toLowerCase().includes('lng') || k.toLowerCase().includes('lon'));

    const customer = row[customerKey] || `Customer ${index + 1}`;
    const address = [
      row[addressKey],
      row[cityKey]
    ].filter(Boolean).join(', ') || 'Address not available';
    
    const latRaw = parseCoordinate(row[latKey]);
    const lngRaw = parseCoordinate(row[lngKey]);
    const lat = !isNaN(latRaw) ? latRaw : 25.1124;
    const lng = !isNaN(lngRaw) ? lngRaw : 55.1980;
    const phone = row[phoneKey] || '';
    const items = row[itemsKey] || 'Items not specified';
    
    // Extract PO Number
    const poNumber = extractPONumber(row);

    return {
      customer: String(customer).trim(),
      address: String(address).trim(),
      lat,
      lng,
      phone: String(phone).trim(),
      items: String(items).trim(),
      // Map PO Number to the expected field name
      poNumber: poNumber,
      PONumber: poNumber, // Also support uppercase variant
      _usedDefaultCoords: isNaN(latRaw) || isNaN(lngRaw),
      // Store original data for reference
      _originalPONumber: poNumber
    };
  });
}
