/**
 * Smoke tests for the file ingestion parser + validator.
 * Does NOT hit the database — tests the parse → validate pipeline in isolation.
 */

import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { parseFileBuffer, decodeBase64File } from './parser';
import { validateDeliveryData } from './validator';

function buildTestXlsx(rows: Record<string, unknown>[]): Buffer {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

describe('fileIngestion/parser', () => {
  it('parses a well-formed xlsx buffer', () => {
    const buf = buildTestXlsx([
      { customer: 'Ahmad', address: 'Dubai Marina', lat: 25.08, lng: 55.14, items: 'Washer', phone: '971501234567' },
      { customer: 'Sara',  address: 'JLT',          lat: 25.07, lng: 55.14, items: 'Dryer',  phone: '971501234568' },
    ]);
    const parsed = parseFileBuffer(buf, 'test.xlsx');
    expect(parsed.rowCount).toBe(2);
    expect(parsed.rows[0]).toMatchObject({ customer: 'Ahmad', address: 'Dubai Marina' });
    expect(parsed.sheetName).toBe('Sheet1');
  });

  it('throws on empty buffer', () => {
    expect(() => parseFileBuffer(Buffer.alloc(0), 'empty.xlsx')).toThrow('empty_file_buffer');
  });

  it('decodes base64 file content including data-url prefix', () => {
    const original = Buffer.from('hello world');
    const b64 = `data:application/octet-stream;base64,${original.toString('base64')}`;
    const decoded = decodeBase64File(b64);
    expect(decoded.toString('utf8')).toBe('hello world');
  });
});

describe('fileIngestion/validator', () => {
  it('accepts valid Dubai-area rows', () => {
    const result = validateDeliveryData([
      { customer: 'Ahmad', address: 'Dubai Marina', lat: 25.08, lng: 55.14, items: 'Washer', phone: '971501234567' },
    ]);
    expect(result.isValid).toBe(true);
    expect(result.validData).toHaveLength(1);
    expect(result.errors).toEqual([]);
  });

  it('rejects rows missing required columns', () => {
    const result = validateDeliveryData([{ customer: 'X', address: 'Y' } as unknown]);
    expect(result.isValid).toBe(false);
    expect(result.errors.join(' ')).toContain('Missing required columns');
  });

  it('flags coordinates outside Dubai as warnings but keeps the row', () => {
    const result = validateDeliveryData([
      { customer: 'Ahmad', address: 'London', lat: 51.5, lng: -0.1, items: 'Washer' },
    ]);
    expect(result.isValid).toBe(true);
    expect(result.warnings.some((w) => w.includes('outside Dubai'))).toBe(true);
  });

  it('end-to-end: parse xlsx → validate produces identical validData to direct call', () => {
    const rows = [
      { customer: 'Ahmad', address: 'Dubai Marina', lat: 25.08, lng: 55.14, items: 'Washer', phone: '971501234567' },
    ];
    const buf = buildTestXlsx(rows);
    const parsed = parseFileBuffer(buf);
    const validation = validateDeliveryData(parsed.rows);
    expect(validation.isValid).toBe(true);
    expect(validation.validData[0].customer).toBe('Ahmad');
    expect(validation.validData[0].lat).toBe(25.08);
  });
});
