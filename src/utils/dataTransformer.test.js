/**
 * Tests for dataTransformer: PO Number extraction, ERP/generic transform, _originalRow preservation
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { transformERPData, detectDataFormat, transformGenericData } from './dataTransformer';

describe('dataTransformer', () => {
  beforeEach(() => {
    // Reset the "logged" flag on extractPONumber so console doesn't spam in tests
    if (typeof globalThis !== 'undefined' && globalThis.extractPONumberLogged !== undefined) {
      delete globalThis.extractPONumberLogged;
    }
  });

  describe('detectDataFormat', () => {
    it('detects ERP format when Ship to party and Delivery number present', () => {
      const data = [
        { 'Delivery number': '123', 'Ship to party': 'Acme', 'Ship to Street': 'Street 1', 'City': 'Dubai', 'PO Number': 'PO-001' }
      ];
      const { format, transform } = detectDataFormat(data);
      expect(format).toBe('erp');
      expect(transform).toBe(transformERPData);
    });

    it('detects simplified format when customer, address, lat, lng, phone, items present', () => {
      const data = [
        { customer: 'Acme', address: 'Dubai', lat: 25.1, lng: 55.2, phone: '123', items: 'Widgets' }
      ];
      const { format, transform } = detectDataFormat(data);
      expect(format).toBe('simplified');
      expect(transform).toBeNull();
    });

    it('returns unknown for empty array', () => {
      const { format, transform } = detectDataFormat([]);
      expect(format).toBe('unknown');
      expect(transform).toBeNull();
    });
  });

  describe('transformERPData', () => {
    it('extracts PO Number from "PO Number" column and stores in poNumber and _originalRow', () => {
      const data = [
        {
          'Ship to party': 'Acme Corp',
          'Ship to Street': 'Sheikh Zayed Rd',
          'City': 'Dubai',
          'Postal code': '12345',
          'Telephone1': '+971501234567',
          'Description': 'Item A',
          'Material': 'MAT-1',
          'PO Number': 'PO-12345',
          'Delivery number': 'DEL-001',
          'Route': 'R1',
          'Confirmed quantity': '10'
        }
        // No lat/lng - will use defaults
      ];
      const result = transformERPData(data);
      expect(result).toHaveLength(1);
      expect(result[0].poNumber).toBe('PO-12345');
      expect(result[0].PONumber).toBe('PO-12345');
      expect(result[0]._originalPONumber).toBe('PO-12345');
      expect(result[0]._originalRow).toBeDefined();
      expect(result[0]._originalRow['PO Number']).toBe('PO-12345');
      expect(result[0]._originalRow['Delivery number']).toBe('DEL-001');
      expect(result[0].customer).toBe('Acme Corp');
      expect(result[0].address).toContain('Sheikh Zayed Rd');
    });

    it('falls back to Cust. PO Number when PO Number is empty', () => {
      const data = [
        {
          'Ship to party': 'Beta Inc',
          'Ship to Street': 'Al Wasl',
          'City': 'Dubai',
          'Cust. PO Number': 'CUST-PO-999',
          'Delivery number': 'D2',
          'Description': 'X',
          'Material': 'Y'
        }
      ];
      const result = transformERPData(data);
      expect(result[0].poNumber).toBe('CUST-PO-999');
      expect(result[0]._originalRow['Cust. PO Number']).toBe('CUST-PO-999');
    });

    it('includes all non-empty original columns in _originalRow', () => {
      const data = [
        {
          'Document Date': '2025-01-01',
          'Sales Document': 'SO-1',
          'Delivery number': 'DN-1',
          'PO Number': 'P-1',
          'Ship to party': 'Customer',
          'Ship to Street': 'St',
          'City': 'DXB',
          'Telephone1': '555',
          'Description': 'D',
          'Material': 'M',
          'Route': 'R1'
        }
      ];
      const result = transformERPData(data);
      const row = result[0]._originalRow;
      expect(row['Document Date']).toBe('2025-01-01');
      expect(row['Sales Document']).toBe('SO-1');
      expect(row['PO Number']).toBe('P-1');
      expect(row['Route']).toBe('R1');
    });
  });

  describe('transformGenericData', () => {
    it('extracts PO Number and preserves _originalRow', () => {
      const data = [
        {
          Customer: 'Generic Co',
          Address: 'Main St',
          City: 'Dubai',
          Phone: '123',
          'PO Number': 'GEN-PO-1',
          Lat: 25.1,
          Lng: 55.2,
          Items: 'Product'
        }
      ];
      const result = transformGenericData(data);
      expect(result[0].poNumber).toBe('GEN-PO-1');
      expect(result[0]._originalRow).toBeDefined();
      expect(result[0]._originalRow['PO Number']).toBe('GEN-PO-1');
    });
  });
});
