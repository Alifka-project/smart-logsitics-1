/**
 * Integration-style tests: transform → validate → payload has PO Number and all columns for DB
 */
import { describe, it, expect } from 'vitest';
import { detectDataFormat } from './dataTransformer';
import { validateDeliveryData } from './dataValidator';

describe('uploadFlow (transform + validate)', () => {
  it('ERP file: after transform and validate, validData has poNumber and _originalRow for API/DB', () => {
    const rawERP = [
      {
        'Delivery number': 'DEL-1',
        'PO Number': 'PO-555',
        'Ship to party': 'Acme',
        'Ship to Street': 'Street 1',
        'City': 'Dubai',
        'Postal code': '00000',
        'Telephone1': '555',
        'Description': 'Item',
        'Material': 'M1',
        'Route': 'R1',
        'Confirmed quantity': '5'
      }
    ];
    const { format, transform } = detectDataFormat(rawERP);
    expect(format).toBe('erp');
    const transformed = transform(rawERP);
    expect(transformed[0].poNumber).toBe('PO-555');
    expect(transformed[0]._originalRow).toBeDefined();

    const validation = validateDeliveryData(transformed);
    expect(validation.isValid).toBe(true);
    expect(validation.validData).toHaveLength(1);

    const payloadRow = validation.validData[0];
    expect(payloadRow.poNumber).toBe('PO-555');
    expect(payloadRow._originalRow).toBeDefined();
    expect(payloadRow._originalRow['PO Number']).toBe('PO-555');
    expect(payloadRow.customer).toBe('Acme');
    expect(payloadRow.address).toContain('Street 1');
  });

  it('validData row can be sent to POST /deliveries/upload with poNumber and metadata sources', () => {
    const rawERP = [
      {
        'PO Number': 'SAVE-ME',
        'Ship to party': 'Customer',
        'Ship to Street': 'Addr',
        'City': 'Dubai',
        'Telephone1': '1',
        'Description': 'D',
        'Material': 'M'
      }
    ];
    const { transform } = detectDataFormat(rawERP);
    const transformed = transform(rawERP);
    const { validData } = validateDeliveryData(transformed);
    const d = validData[0];

    const poNumberToSave = d.poNumber ?? d.PONumber ?? d._originalPONumber ?? d._originalRow?.['PO Number'] ?? null;
    expect(poNumberToSave).toBe('SAVE-ME');

    const hasOriginalRow = d._originalRow && typeof d._originalRow === 'object';
    expect(hasOriginalRow).toBe(true);
  });
});
