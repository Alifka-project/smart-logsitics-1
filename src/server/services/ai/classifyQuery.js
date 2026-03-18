/**
 * Classify natural language into a structured plan for deterministic execution.
 * Uses normalization, keyword mapping, and rule-based parsing (no LLM required).
 */

const { intentToStatus } = require('../../domain/statusMap.js');
const { inferDateRangeFromQuery } = require('./dateFilters.js');

const INTENTS = Object.freeze({
  LOOKUP: 'lookup',
  COUNT: 'count',
  RANKING: 'ranking',
  TREND: 'trend',
  NAVIGATION: 'navigation',
});

const ENTITIES = Object.freeze({ DELIVERIES: 'deliveries', DRIVERS: 'drivers' });
const DIMENSIONS = Object.freeze({ CUSTOMER: 'customer', PRODUCT: 'product', STATUS: 'status' });

/** Synonyms for "customer" in ranking questions */
const CUSTOMER_SYNONYMS = ['customer', 'customers', 'client', 'clients', 'buyer', 'party'];
/** Synonyms for "product/item" in ranking questions */
const PRODUCT_SYNONYMS = ['product', 'products', 'item', 'items', 'selling', 'sold', 'sales'];
/** Count intent triggers */
const COUNT_TRIGGERS = ['how many', 'number of', 'count of', 'total', 'how much', 'amount of'];
/** Navigation triggers */
const NAV_TRIGGERS = ['where is', 'where are', 'where can', 'how to', 'show me', 'open', 'go to', 'navigate', 'find (the )?pod', 'pod report', 'proof of delivery'];

function normalizeQuery(q) {
  return String(q || '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Returns structured plan: { intent, entity, metric, dimension, filters, topN, rawQuery }.
 * filters: { status: canonical | null, dateRange: { from, to, label } | null }
 */
function classifyQuery(rawQuery) {
  const q = normalizeQuery(rawQuery);
  const dateRange = inferDateRangeFromQuery(q);

  // --- Navigation ---
  for (const trigger of NAV_TRIGGERS) {
    const re = new RegExp(trigger.replace(/\s+/g, '\\s+'), 'i');
    if (re.test(q)) {
      return {
        intent: INTENTS.NAVIGATION,
        entity: ENTITIES.DELIVERIES,
        metric: null,
        dimension: null,
        filters: { status: null, dateRange },
        topN: null,
        rawQuery: rawQuery.trim(),
      };
    }
  }

  // --- Count (e.g. how many pending today, how many delivered this week) ---
  const isCount =
    COUNT_TRIGGERS.some(t => q.includes(t)) ||
    /^(how many|number of|total)\s+(pending|delivered|cancelled|in transit|orders?|deliveries?)/i.test(q);
  const statusForCount = intentToStatus(q);
  if (isCount) {
    const countDateRange = dateRange || (q.includes('today') ? inferDateRangeFromQuery('today') : null);
    return {
      intent: INTENTS.COUNT,
      entity: ENTITIES.DELIVERIES,
      metric: 'count',
      dimension: DIMENSIONS.STATUS,
      filters: { status: statusForCount || null, dateRange: countDateRange },
      topN: null,
      rawQuery: rawQuery.trim(),
    };
  }

  // --- Ranking: top customer / top product ---
  const hasRanking =
    /\b(top|best|leading|biggest|highest|most)\s*(\d*)\s*(customer|client|product|item)/i.test(q) ||
    /\b(customer|client)s?\s+(with\s+)?(most|highest|top)\s+(orders?|deliveries?)/i.test(q) ||
    /\b(highest|most|top)\s+(order|orders|delivery|deliveries)\s+(customer|client)/i.test(q) ||
    /\bwho\s+(is|are)\s+(the\s+)?(top|best)\s+(customer|customers|client)/i.test(q) ||
    /\bmost\s+(orders?|deliveries?|sold?|selling)\s*(by\s+)?(customer|product|item)?/i.test(q) ||
    /\b(most|best|top)\s+selling\b/i.test(q) ||
    /\b(sales?|selling)\s+by\s+(product|item)/i.test(q) ||
    /\b(top|best)\s+(product|item)s?\b/i.test(q);

  if (hasRanking) {
    const topNMatch = q.match(/(?:top|best)\s*(\d+)/i) || q.match(/top\s*(\d+)/i);
    const topN = topNMatch ? Math.min(parseInt(topNMatch[1], 10) || 10, 20) : 10;

    const isProduct =
      PRODUCT_SYNONYMS.some(s => q.includes(s)) ||
      /\b(most\s+sold?|most\s+selling|best\s+selling)\b/i.test(q) ||
      /\b(product|item)s?\s+(selling|sold)/i.test(q);

    if (isProduct) {
      return {
        intent: INTENTS.RANKING,
        entity: ENTITIES.DELIVERIES,
        metric: 'count',
        dimension: DIMENSIONS.PRODUCT,
        filters: { status: null, dateRange: dateRange || inferDateRangeFromQuery('this month') },
        topN,
        rawQuery: rawQuery.trim(),
      };
    }

    return {
      intent: INTENTS.RANKING,
      entity: ENTITIES.DELIVERIES,
      metric: 'count',
      dimension: DIMENSIONS.CUSTOMER,
      filters: { status: null, dateRange: dateRange || null },
      topN,
      rawQuery: rawQuery.trim(),
    };
  }

  // --- Trend (e.g. delivered vs cancelled last 30 days) ---
  if (/\b(trend|over time|by (day|week|month)|delivered vs|vs cancelled)\b/i.test(q) || (q.includes('last') && (q.includes('day') || q.includes('month')) && (q.includes('delivered') || q.includes('cancelled')))) {
    return {
      intent: INTENTS.TREND,
      entity: ENTITIES.DELIVERIES,
      metric: 'count',
      dimension: DIMENSIONS.STATUS,
      filters: { status: null, dateRange: dateRange || inferDateRangeFromQuery('last 30 days') },
      topN: null,
      rawQuery: rawQuery.trim(),
    };
  }

  // --- Default: lookup (text search for deliveries, address, PO, customer) ---
  return {
    intent: INTENTS.LOOKUP,
    entity: ENTITIES.DELIVERIES,
    metric: null,
    dimension: null,
    filters: { status: intentToStatus(q) || null, dateRange },
    topN: null,
    rawQuery: rawQuery.trim(),
  };
}

module.exports = {
  classifyQuery,
  INTENTS,
  ENTITIES,
  DIMENSIONS,
};
