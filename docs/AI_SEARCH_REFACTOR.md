# AI Search Refactor – Summary

## What was changed

The AI/search flow was refactored so that **business analytics are deterministic** (database aggregation) and **AI is used only for summarization**. The previous implementation mixed navigation, text search, and analytics in one place and relied on narrow regex, so queries like "most selling", "who is the top customer", and "how many pending today" often failed or returned weak results.

### Architecture (new)

1. **Query classification** – `classifyQuery.js` turns natural language into a structured plan: `intent` (lookup | count | ranking | trend | navigation), `entity`, `metric`, `dimension` (customer | product | status), `filters` (status, dateRange), `topN`.
2. **Deterministic execution**
   - **Analytics** – `analyticsExecutor.js`: `countDeliveries`, `getTopCustomers`, `getTopProducts`, `getStatusBreakdown`, `getDeliveryTrend` (all Prisma, no text search).
   - **Lookup** – `searchExecutor.js`: `searchDeliveries`, `searchDrivers` (normalized text search).
   - **Navigation** – `navigationMap.js`: `findNavigationTarget(query, userRole)`.
3. **AI summarization** – `summarizeInsight.js`: given executor output, optionally call OpenAI to generate 2–3 insight bullets; if unavailable, response still returns the deterministic answer.
4. **Unified status** – `statusMap.js`: single taxonomy and `intentToStatus` / `toCanonicalStatus` used by classification and analytics.
5. **Normalization** – `normalize.js`: `normalizeText`, `customerNormalized`, `productNormalized`, `parseProductNames` for consistent grouping and search.

### API response shape (backward compatible)

- **New fields:** `success`, `intent`, `plan`, `kpis`, `table`, `chart`, `insights`.
- **Unchanged:** `answer`, `results`, `drivers`, `totalCount`, `navSuggestions`, `insightOnly`, `insight` (still used for chart in the UI).

Example for "top 5 customers this month":

```json
{
  "success": true,
  "intent": "ranking",
  "answer": "For this month, the top customer is ABC Trading with 42 deliveries. Next: 2. XYZ (35); ...",
  "plan": {
    "intent": "ranking",
    "entity": "deliveries",
    "metric": "count",
    "dimension": "customer",
    "filters": { "status": null, "dateRange": { "from": "...", "to": "...", "label": "this month" } },
    "topN": 5
  },
  "kpis": { "leader": "ABC Trading", "leaderCount": 42 },
  "table": [
    { "customer": "ABC Trading", "deliveries": 42 },
    { "customer": "XYZ Retail", "deliveries": 35 }
  ],
  "chart": { "type": "bar", "xKey": "customer", "yKey": "deliveries", "data": [...] },
  "insights": [
    "ABC Trading contributes 18% of this month's deliveries.",
    "Top 3 customers account for 46% of volume."
  ],
  "results": [],
  "drivers": [],
  "totalCount": 0,
  "navSuggestions": [],
  "insightOnly": true,
  "insight": { "type": "top_customers", "chartData": [...], "period": "this month" }
}
```

---

## Files created

| Path | Purpose |
|------|--------|
| `src/server/domain/statusMap.js` | Status taxonomy, `toCanonicalStatus`, `intentToStatus`, `prismaStatusWhere` |
| `src/server/domain/normalize.js` | `normalizeText`, `customerNormalized`, `productNormalized`, `parseProductNames` |
| `src/server/services/ai/dateFilters.js` | `inferDateRangeFromQuery` (today, this month, last 7/30 days, etc.) |
| `src/server/services/ai/classifyQuery.js` | `classifyQuery(rawQuery)` → structured plan |
| `src/server/services/ai/analyticsExecutor.js` | `countDeliveries`, `getTopCustomers`, `getTopProducts`, `getStatusBreakdown`, `getDeliveryTrend` |
| `src/server/services/ai/searchExecutor.js` | `searchDeliveries`, `searchDrivers` |
| `src/server/services/ai/navigationMap.js` | `NAVIGATION_MAP`, `findNavigationTarget` |
| `src/server/services/ai/summarizeInsight.js` | `summarizeInsight(payload)` → 2–3 insight bullets (optional OpenAI) |
| `src/server/services/ai/classifyQuery.test.js` | Unit tests for classification (16 cases) |
| `src/server/services/ai/analyticsExecutor.test.js` | Shape tests for executor (4 cases, require DB) |
| `docs/AI_SEARCH_REFACTOR.md` | This summary |

## Files modified

| Path | Changes |
|------|--------|
| `src/server/api/ai.js` | Replaced single search handler with: classify → execute (analytics / lookup / navigation) → optional summarize; returns unified shape; kept `GET /navbar-stats`, `POST /optimize` |
| `src/components/Layout/Header.jsx` | Uses `searchResults.insight?.chartData` or `searchResults.chart?.data`; shows KPI line when `kpis.leader`; shows `insights` list; chart supports status breakdown (status/count) and top customers/products (name/count) |

---

## Migrations / index changes

- **None.** All analytics use existing Prisma schema and indexes (`status`, `createdAt`, `customer`, `items`, etc.). No schema or migration changes.

---

## Assumptions

- DB stores canonical statuses: `pending`, `out-for-delivery`, `delivered`, `cancelled`. `statusMap.js` supports aliases (e.g. `done`, `canceled`) for future or legacy data.
- `OPENAI_API_KEY` is optional; if missing or summarization fails, the API still returns the deterministic `answer`, `table`, `chart`, and `insights: []`.
- Frontend continues to use `answer`, `results`, `drivers`, `insight`, `insightOnly`; new fields (`kpis`, `insights`, `chart`) are additive.
- Product aggregation uses `delivery.items` (string/JSON) and optional `metadata.originalRow.Description`; product names are normalized for grouping.

---

## Example API requests and responses

**1. Who is the top customer**

- Request: `POST /api/ai/search` body `{ "query": "who is the top customer" }`
- Response: `intent: "ranking"`, `dimension: "customer"`, `answer` with top customer name and count, `table` and `chart.data` with top 10, `insightOnly: true`.

**2. Most selling product this month**

- Request: `POST /api/ai/search` body `{ "query": "most selling product this month" }`
- Response: `intent: "ranking"`, `dimension: "product"`, `answer` with top product, `table`/`chart` by product, `insight.type: "top_products"`.

**3. How many pending today**

- Request: `POST /api/ai/search` body `{ "query": "how many pending today" }`
- Response: `intent: "count"`, `answer` e.g. "For today, there are 78 pending deliveries.", `kpis`, `table`/`chart` with status breakdown.

**4. Where is POD report**

- Request: `POST /api/ai/search` body `{ "query": "where is POD report" }`
- Response: `intent: "navigation"`, `answer` with label and path to POD Report, `navSuggestions` array.

**5. Deliveries to dubai marina (lookup)**

- Request: `POST /api/ai/search` body `{ "query": "deliveries to dubai marina" }`
- Response: `intent: "lookup"`, `results` (deliveries matching "dubai marina"), `answer` e.g. "Found N deliveries matching ...".

---

## Recommended next steps

1. **Reports/dashboard** – Use `statusMap.js` and the same canonical statuses in `reports.js` and admin dashboard so counts match AI answers.
2. **Search relevance** – Add simple relevance scoring (e.g. customer/PO match higher than address) in `searchDeliveries` and order by score then `createdAt`.
3. **Indexes** – If lookup by address/customer is slow, consider composite or GIN indexes for text search (e.g. `pg_trgm` on `customer`, `address`).
4. **Optional LLM planner** – For rare or ambiguous queries, an optional second step could call an LLM to suggest a plan; the executor would still run deterministically from that plan.
