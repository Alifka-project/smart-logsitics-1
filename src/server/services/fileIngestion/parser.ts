/**
 * Server-side file parser — converts raw .xlsx / .csv bytes into row objects.
 * Uses the same `xlsx` library that the frontend uses so the output shape is
 * identical to what `FileUpload.tsx` produces before validation.
 */

import * as XLSX from 'xlsx';

export interface ParseResult {
  rows: Record<string, unknown>[];
  sheetName: string;
  columnCount: number;
  rowCount: number;
}

export function parseFileBuffer(buffer: Buffer, filename?: string): ParseResult {
  if (!buffer || buffer.length === 0) {
    throw new Error('empty_file_buffer');
  }

  // XLSX.read auto-detects both .xlsx and .csv from the buffer contents.
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    throw new Error('no_sheets_in_workbook');
  }

  const sheet = workbook.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' }) as Record<string, unknown>[];

  const columnCount = rows.length > 0 ? Object.keys(rows[0]).length : 0;

  console.log(
    `[fileIngestion/parser] Parsed ${filename || 'buffer'}: ${rows.length} rows, ${columnCount} columns, sheet="${firstSheetName}"`,
  );

  return {
    rows,
    sheetName: firstSheetName,
    columnCount,
    rowCount: rows.length,
  };
}

/** Decode a base64-encoded file body into a Buffer. */
export function decodeBase64File(base64: string): Buffer {
  // Strip common prefixes like "data:application/...;base64,"
  const clean = base64.includes(',') ? base64.split(',')[1] : base64;
  return Buffer.from(clean, 'base64');
}
