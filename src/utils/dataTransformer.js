// Data transformer to convert actual Excel format to system format
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
    
    const phone = row['Telephone1'] || '';
    
    // Create item description from material info
    const items = [
      row['Description'],
      row['Material']
    ].filter(Boolean).join(' - ') || 'Items not specified';

    // Use default Dubai coordinates if not available
    // In a real scenario, you'd geocode the address
    const lat = parseFloat(row['Ship to Latitude']) || 25.1124; // Default to Dubai area
    const lng = parseFloat(row['Ship to Longitude']) || 55.1980;

    return {
      customer: String(customer).trim(),
      address: String(address).trim(),
      lat,
      lng,
      phone: String(phone).trim(),
      items: String(items).trim(),
      // Store original data for reference
      _originalDeliveryNumber: row['Delivery number'],
      _originalPONumber: row['PO Number'],
      _originalQuantity: row['Confirmed quantity'],
      _originalCity: row['City'],
      _originalRoute: row['Route']
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
    
    const lat = parseFloat(row[latKey]) || 25.1124;
    const lng = parseFloat(row[lngKey]) || 55.1980;
    const phone = row[phoneKey] || '';
    const items = row[itemsKey] || 'Items not specified';

    return {
      customer: String(customer).trim(),
      address: String(address).trim(),
      lat,
      lng,
      phone: String(phone).trim(),
      items: String(items).trim()
    };
  });
}
