/**
 * Tests for dataValidator: preserve all row fields (poNumber, _originalRow, etc.) in validData
 */
import { describe, it, expect } from 'vitest';
import { validateDeliveryData, formatValidationError } from './dataValidator';

describe('dataValidator', () => {
  const validRow = {
    customer: 'Test Customer',
    address: '123 Dubai Street, Dubai',
    lat: 25.1,
    lng: 55.2,
    phone: '+971501234567',
    items: 'Widgets',
    poNumber: 'PO-999',
    PONumber: 'PO-999',
    _originalPONumber: 'PO-999',
    _originalRow: { 'PO Number': 'PO-999', 'Delivery number': 'D1' }
  };

  it('preserves all row fields in validData including poNumber and _originalRow', () => {
    const data = [{ ...validRow }];
    const result = validateDeliveryData(data);
    expect(result.isValid).toBe(true);
    expect(result.validData).toHaveLength(1);
    const out = result.validData[0];
    expect(out.poNumber).toBe('PO-999');
    expect(out.PONumber).toBe('PO-999');
    expect(out._originalPONumber).toBe('PO-999');
    expect(out._originalRow).toEqual({ 'PO Number': 'PO-999', 'Delivery number': 'D1' });
    expect(out.customer).toBe('Test Customer');
    expect(out.address).toBe('123 Dubai Street, Dubai');
    expect(out.lat).toBe(25.1);
    expect(out.lng).toBe(55.2);
    expect(out.items).toBe('Widgets');
  });

  it('returns invalid for empty array', () => {
    const result = validateDeliveryData([]);
    expect(result.isValid).toBe(false);
    expect(result.validData).toEqual([]);
    expect(result.errors).toContain('File is empty or no data found');
  });

  it('returns invalid when required columns are missing', () => {
    const result = validateDeliveryData([{ customer: 'Only' }]);
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('Missing required columns'))).toBe(true);
  });

  it('returns invalid when customer is empty', () => {
    const data = [{ ...validRow, customer: '' }];
    const result = validateDeliveryData(data);
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('Customer name is required'))).toBe(true);
  });

  it('normalizes customer, address, items but keeps extra fields', () => {
    const data = [
      {
        ...validRow,
        customer: '  Trimmed  ',
        address: '  Address  ',
        items: '  Items  ',
        customField: 'preserved'
      }
    ];
    const result = validateDeliveryData(data);
    expect(result.isValid).toBe(true);
    const out = result.validData[0];
    expect(out.customer).toBe('Trimmed');
    expect(out.address).toBe('Address');
    expect(out.items).toBe('Items');
    expect(out.customField).toBe('preserved');
  });

  it('formatValidationError includes errors and warnings', () => {
    const validation = {
      errors: ['Error 1'],
      warnings: ['Warning 1']
    };
    const str = formatValidationError(validation);
    expect(str).toContain('Error 1');
    expect(str).toContain('Warning 1');
  });
});
