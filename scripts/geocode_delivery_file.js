#!/usr/bin/env node
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');

const transformer = require('../src/utils/dataTransformer');
const validator = require('../src/utils/dataValidator');
const geocode = require('../src/services/geocodingService');

async function run(filePath) {
  if (!fs.existsSync(filePath)) {
    console.error('File not found:', filePath);
    process.exit(2);
  }
  console.log('Parsing file:', filePath);
  const workbook = XLSX.readFile(filePath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const json = XLSX.utils.sheet_to_json(sheet, {defval: null});
  console.log('Rows:', json.length);
  const detected = transformer.detectDataFormat(json);
  console.log('Detected format:', detected.format);
  let transformed = json;
  if (detected.transform) transformed = detected.transform(json);

  // Build addresses list using Ship to Street if present and capture related fields
  const addresses = transformed.map(r => ({
    address: r.address || r['Ship to Street'] || r['Ship to street'] || r['Ship To Street'] || '',
    city: r.city || r.City || r['Ship to City'] || r['Ship to city'] || r['City'] || '',
    original: r
  }));

  console.log('Starting geocoding for', addresses.length, 'addresses (rate-limited)');
  const results = [];

  // Helper: clean address string
  function cleanAddress(raw) {
    if (!raw) return '';
    let s = String(raw);
    // Remove Excel artifact tokens and control chars
    s = s.replace(/_x000D_/gi, ' ');
    s = s.replace(/[\u0000-\u001F]/g, ' ');
    // Remove common placeholder postal codes like 00000
    s = s.replace(/\b0{3,}\b/g, '');
    // Remove generic 5-digit postal placeholders
    s = s.replace(/\b\d{5}\b/g, '');
    // Remove phone numbers (loose patterns)
    s = s.replace(/\b\+?\d[\d\s\-()]{6,}\b/g, '');
    // Remove common instruction tokens
    s = s.replace(/\b(call|please call|please|call customer|customer before|call before|contact|tel|telephone|phone)\b/gi, '');
    // Remove TRN, VAT or similar tax numbers
    s = s.replace(/\b(TRN|TRN:)\s*\d+\b/gi, '');
    // Remove words like 'TRN 123456' or long alphanumeric tokens
    s = s.replace(/\b[A-Z0-9]{6,}\b/g, '');
    // Remove repeated commas and extra spaces
    s = s.replace(/[\r\n]+/g, ' ');
    s = s.replace(/[,]{2,}/g, ',');
    s = s.replace(/\s+/g, ' ').trim();
    // Remove leading/trailing punctuation
    s = s.replace(/^[-,.:\s]+|[-,.:\s]+$/g, '');
    return s;
  }

  // Try to detect emirate/region from text
  function detectEmirate(text) {
    if (!text) return '';
    const emirates = ['dubai','abu dhabi','sharjah','ajman','ras al khaimah','fujairah','umm al quwain'];
    const lower = text.toLowerCase();
    for (const e of emirates) if (lower.includes(e)) return e;
    return '';
  }

  // Helper: attempt multiple fallback queries for one address
  async function geocodeWithFallback(a) {
    const orig = a.address || '';
    const city = a.city || 'Dubai, UAE';

    const attempts = [];

    // 1) Full cleaned address + city
    const cleaned = cleanAddress(orig);
    if (cleaned) attempts.push({q: cleaned, ctx: city});

    // detect emirate/area token from cleaned address
    const detectedEmirate = detectEmirate(cleaned) || detectEmirate(city);
    const areaToken = (cleaned.split('-')[0] || cleaned.split(',')[1] || '').trim();

    // If there is an area token (like 'Al Barsha') try area + emirate early
    if (areaToken && detectedEmirate) attempts.push({q: `${areaToken}, ${detectedEmirate}`, ctx: ''});

    // 2) Strip unit/apartment/building qualifiers and retry
    const stripUnit = cleaned.replace(/\b(flat|apt|apartment|unit|suite|ste|building|bldg|floor|fl)\b[^,]*/gi, '').replace(/#\d+/g, '').trim();
    if (stripUnit && stripUnit !== cleaned) attempts.push({q: stripUnit, ctx: city});

    // 3) Remove parenthesis and bracket contents
    const noParens = cleaned.replace(/\([^)]*\)|\[[^\]]*\]/g, '').trim();
    if (noParens && noParens !== cleaned && noParens !== stripUnit) attempts.push({q: noParens, ctx: city});

    // 4) Try street + city if available (extract up to comma)
    const firstPart = (cleaned.split(',')[0] || '').trim();
    if (firstPart && firstPart !== cleaned) attempts.push({q: `${firstPart}`, ctx: city});

    // 5) Try street only (no city)
    if (firstPart) attempts.push({q: firstPart, ctx: ''});

    // 6) Try area only (if detected)
    if (areaToken) attempts.push({q: areaToken, ctx: detectedEmirate || city});

    // 7) Finally try city only (centroid)
    if (city) attempts.push({q: city, ctx: ''});

    for (let att of attempts) {
      try {
        const res = await geocode.geocodeAddress(att.q, att.ctx || 'Dubai, UAE');
        if (res && res.lat !== null) {
          return {query: att.q, ctx: att.ctx, res};
        }
      } catch (e) {
        // continue to next attempt
      }
    }

    return null;
  }

  for (let i=0;i<addresses.length;i++){
    const a = addresses[i];
    try{
      const attempt = await geocodeWithFallback(a);
      if (attempt && attempt.res) {
        const r = attempt.res;
        results.push({index: i, address: a.address, queryUsed: attempt.query, context: attempt.ctx, lat: r.lat, lng: r.lng, accuracy: r.accuracy, display: r.displayName});
        console.log(`${i+1}/${addresses.length}: ${a.address} -> ${r.lat},${r.lng} (${r.accuracy}) [via: ${attempt.query}]`);
      } else {
        // no match; write nulls
        results.push({index:i,address:a.address,lat:null,lng:null,accuracy:'FAILED'});
        console.log(`${i+1}/${addresses.length}: ${a.address} -> null,null (FAILED)`);
      }
    }catch(e){
      console.error('Error geocoding', a.address, e.message);
      results.push({index:i,address:a.address,lat:null,lng:null,accuracy:'FAILED'});
    }
  }
  // summarize
  const ok = results.filter(r=>r.lat!==null).length;
  console.log('Geocoding complete:', ok, '/', results.length, 'succeeded');
  // write to file
  const out = path.join(process.cwd(),'geocode_results.json');
  fs.writeFileSync(out, JSON.stringify(results,null,2));
  console.log('Results written to', out);
}

const file = process.argv[2] || path.join(__dirname,'..','Delivery format.xlsx');
run(file).catch(e=>{console.error(e); process.exit(1);});
