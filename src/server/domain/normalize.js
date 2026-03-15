/**
 * Normalize business dimensions for consistent analytics and search.
 * Used by analytics executor and search executor.
 */

/**
 * Normalize text: lowercase, trim, collapse punctuation to space, collapse spaces.
 */
function normalizeText(value = '') {
  return String(value)
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * For display / grouping key: trim and collapse spaces, keep original case for display.
 */
function normalizeForKey(value = '') {
  return String(value)
    .trim()
    .replace(/\s+/g, ' ');
}

function customerNormalized(value = '') {
  const s = normalizeForKey(value);
  return s || 'Unknown';
}

function productNormalized(value = '') {
  const s = normalizeForKey(value);
  return s || 'Unspecified';
}

/**
 * Parse delivery.items (string or JSON) into product name(s) for aggregation.
 */
function parseProductNames(itemsField) {
  const names = [];
  if (itemsField == null || String(itemsField).trim() === '') return names;
  const raw = typeof itemsField === 'string' ? itemsField : JSON.stringify(itemsField);
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      parsed.forEach(p => {
        const d = p && (p.description || p.name || p.item || p.Description || p.Name);
        if (d) names.push(String(d).replace(/\s*x\s*\d+\s*$/i, '').trim());
      });
      return names.filter(Boolean);
    }
  } catch (_) { /* not JSON */ }
  const parts = raw.split(/[,;\n]|\s+-\s+/).map(s => String(s).replace(/\s*x\s*\d+\s*$/i, '').trim()).filter(Boolean);
  if (parts.length) return parts;
  const single = raw.replace(/\s*x\s*\d+\s*$/i, '').trim();
  if (single) return [single];
  return names;
}

module.exports = {
  normalizeText,
  normalizeForKey,
  customerNormalized,
  productNormalized,
  parseProductNames,
};
