"use strict";
/**
 * Server-side file parser — converts raw .xlsx / .csv bytes into row objects.
 * Uses the same `xlsx` library that the frontend uses so the output shape is
 * identical to what `FileUpload.tsx` produces before validation.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseFileBuffer = parseFileBuffer;
exports.decodeBase64File = decodeBase64File;
const XLSX = __importStar(require("xlsx"));
function parseFileBuffer(buffer, filename) {
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
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
    const columnCount = rows.length > 0 ? Object.keys(rows[0]).length : 0;
    console.log(`[fileIngestion/parser] Parsed ${filename || 'buffer'}: ${rows.length} rows, ${columnCount} columns, sheet="${firstSheetName}"`);
    return {
        rows,
        sheetName: firstSheetName,
        columnCount,
        rowCount: rows.length,
    };
}
/** Decode a base64-encoded file body into a Buffer. */
function decodeBase64File(base64) {
    // Strip common prefixes like "data:application/...;base64,"
    const clean = base64.includes(',') ? base64.split(',')[1] : base64;
    return Buffer.from(clean, 'base64');
}
