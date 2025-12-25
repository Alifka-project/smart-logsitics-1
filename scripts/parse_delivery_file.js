#!/usr/bin/env node
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const transformer = require('../src/utils/dataTransformer');
const validator = require('../src/utils/dataValidator');

const filePath = process.argv[2] || path.join(__dirname, '..', 'Delivery format.xlsx');
if (!fs.existsSync(filePath)) {
  console.error('File not found:', filePath);
  process.exit(2);
}

console.log('Parsing file:', filePath);
const workbook = XLSX.readFile(filePath);
const sheet = workbook.Sheets[workbook.SheetNames[0]];
const json = XLSX.utils.sheet_to_json(sheet, {defval: null});
console.log('Rows in sheet:', json.length);

const detected = transformer.detectDataFormat(json);
console.log('Detected format:', detected.format);
let transformed = json;
if (detected.transform) transformed = detected.transform(json);

const validation = validator.validateDeliveryData(transformed);
console.log('Validation: isValid=', validation.isValid);
console.log('Valid rows:', validation.validData.length);
console.log('Errors:', validation.errors.length);
console.log('Warnings:', validation.warnings.length);

// count _usedDefaultCoords
const fallbackCount = (transformed || []).filter(r => r && r._usedDefaultCoords).length;
console.log('Rows using default coords:', fallbackCount);

console.log('\nSample parsed coordinates (first 10 valid rows):');
validation.validData.slice(0,10).forEach((r,i)=>{
  console.log(i+1, r.customer, r.address, r.lat, r.lng, r._usedDefaultCoords ? '(used default)' : '');
});

process.exit(0);
