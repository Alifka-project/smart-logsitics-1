# Dubai Logistics System — UX & Bug Audit

**Date:** 21 April 2026
**Scope:** `dubai-logistics-system` (synced to origin/main, commit `fcfe705`)
**Method:** Read-only code review of pages, shared components, styles, and backend APIs. No code was changed.
**Why this was done:** Client and internal team report the app is hard to use, the dashboard shows too much information, and there are lingering bugs.

---

## 1. Executive Summary

The app is feature-rich but **overloaded**. The core UX pain is not any single screen — it is that **every screen tries to be a dashboard, control centre, table, and communication tool at once**. On top of that, four different portals (Admin, Logistics Team, Delivery Team, Driver) duplicate ~70% of the same logic, UI, filters, and polling timers, so every fix has to be made in 3–4 places and often isn't, which is the source of most of the functional bugs.

**Top 5 things the client and team are actually reacting to:**

1. **Admin dashboard is too dense.** 7 tabs, 7 KPI cards, 9 trend charts, 6 filters, all on one page. Users can't find what matters.
2. **Filters are scattered and don't persist.** Date pickers are raw text inputs in some portals, filters reset when you switch tabs, and there is no "clear all" affordance in most places.
3. **Modals stack on modals.** Edit-order and reschedule modals both use very high z-index values and have no unsaved-changes warning, so users lose work.
4. **Too many colours.** Around 18 status pill colours, several with poor contrast in dark mode, and the brand-navy migration is only half-done — which is why it looks inconsistent.
5. **Optimistic updates are missing.** When a user updates status or assigns a driver, the UI waits for a full re-poll (30–60 s). People think it didn't work and click again.

The rest of this document lists the specific findings with file references so the team can triage.

---

## 2. UI / UX Findings

### 2.1 Admin Dashboard — information overload

The Admin Dashboard (`src/pages/AdminDashboardPage.tsx`, 3,508 lines) is the single biggest offender. On Overview tab alone: 7 KPI cards + 1 hero chart + 3 side widgets + a response table. On Trends tab: 9 independent charts. On Customers tab: 1 composed chart + 1 scatter matrix + 1 detail table + a spotlight panel.

Concrete problems:

- **Same metric shown multiple ways.** Success Rate appears in the Overview KPI card, the Overview hero chart, the Trends tab "Success Rate" chart, and again as a column inside the Customers and Areas tables. This is the main cause of "there are too many numbers."
- **Driver outcomes shown twice** — `driverPanelAnalytics` pie on the Drivers tab and the performance donut on the Deliveries tab. One should be removed.
- **Top Customers data appears 4 times** — in a KPI card, a composed chart, a scatter chart, and a full table. Pick one primary view.
- **Trends tab** stacks 9 charts at ~220 px each ≈ 3,000 px of scroll. Users never see the bottom.
- **Deliveries tab filter bar** holds 6 independent controls (search + status + 2 date inputs + attention filter + sort) in one row that wraps awkwardly on tablet.

**Recommendation.** On Overview, cap at 4 KPI cards + 1 hero chart + 1 prioritised list ("Needs Attention"). Move the 9 Trends charts into three collapsible groups: **Demand**, **Quality**, **Operations**. Hide advanced filters behind a "More filters" toggle with a visible "Apply / Reset" button.

### 2.2 Team portals — same problem, four times

`DeliveryTeamPortal.tsx` (3,104 lines), `LogisticsTeamPortal.tsx` (2,181 lines), `DriverPortal.tsx` (1,780 lines), and `AdminOperationsPage.tsx` (1,720 lines) are each doing monitoring + control + communication + reporting on a single page.

- Each portal has **30–40 `useState` hooks**. The sheer volume of state is why saving/filtering feels inconsistent.
- Delivery Team portal tab-state resets on navigation: `opsSearch`, `opsStatusFilter`, `opsDateFrom/To`, `opsSortCol/Dir` are not stored in the URL, so switching between "Reports" and "Operations" wipes filters.
- Date range inputs in the portals (`opsDateFrom`, `opsDateTo`) are raw `<input>` strings — no date picker, no validation, no "Today / This Week" presets.
- `LogisticsTeamPortal` uses **five names for one concept**: `manage-orders`, `manage-dispatch`, `manage`, `live-tracking`, `live-maps`. Users don't know which to pick.
- Both Delivery Team and Logistics Team portals can assign drivers and change delivery status; if both act at once, there is no conflict handling on the client side.

### 2.3 Navigation

- `Sidebar.tsx` and `Navigation.tsx` are **two separate nav hierarchies** with overlapping items. Sidebar has 7 flat items with no grouping (Dashboard, Deliveries, Operations, Reports, Driver Tracking, Delivery Tracking, Users).
- Sidebar active-state tooltip background is hardcoded `#2d2f52`, invisible in light mode (`Sidebar.tsx:85`).
- Sidebar collapse toggle is hidden on mobile (`Sidebar.tsx:117`) and there is no gesture/affordance hint for the drawer.

**Recommendation.** Merge into one nav. Group items into "Operations" (Deliveries, Tracking) and "Admin" (Reports, Users). Move the two tracking pages into a single "Live Tracking" with a toggle.

### 2.4 Modals and forms

- `OrderEditModal.tsx` is up to 780 px tall with 8+ fields stacked: POD gallery, 2×2 info grid, phone + SMS button, address, status dropdown, 3 date fields, reschedule, dispatch, notes. Users must scroll inside the modal to see everything.
- **No unsaved-changes warning** anywhere in the edit modal — users lose edits if they close by accident (`OrderEditModal.tsx:42–453`).
- Modal inputs are uncontrolled after `delivery` prop changes — `phone`/`address` are set once at init and never synced, so re-opening on a different row can show stale values (`OrderEditModal.tsx:64–76`).
- `RescheduleModal` and `OrderEditModal` both use `z-[10050]`; `DateRangePicker` uses `z-[9999]`; `Header AISearchBar` uses `z-9999`. If a date picker is opened from inside the edit modal, it is clipped underneath. There is no shared z-index map.
- Several reschedule inputs are missing `htmlFor`/`id` pairs, so screen-readers don't announce them (`OrderEditModal.tsx:363–375`).

**Recommendation.** Split `OrderEditModal` into tabs: **Details / Status & Dates / POD**. Add a dirty-state "Discard changes?" prompt on close. Create a single `zIndex.ts` constant.

### 2.5 Tables

- `OrdersTable.tsx` can show 50+ columns and has no virtualization. On lists of 100+ orders it renders 1,000+ DOM nodes and scroll jank is visible.
- `OrdersTable` takes 22 props from its parent — prop drilling is so deep that changing one action breaks compile in multiple call sites.
- Many list renders use `key={idx}` (e.g. `AdminDashboardPage.tsx:1961, 2849`). If rows reorder or filter, React re-uses the wrong DOM node and UI flickers.

**Recommendation.** Introduce `react-window` virtualization. Default the order table to 5 essential columns (Customer, Status, Dates, Driver, Action) with a column-toggle. Replace `key={idx}` with stable business keys (`d.id`, PO number).

### 2.6 Status colours and visual hierarchy

- 18 status colours defined in `src/config/statusColors.ts` across 14 statuses. Several are near-identical (scheduled vs rescheduled vs next-shipment all use amber/orange family).
- Hardcoded `#032145` (Electrolux Deep Navy) appears directly in several components instead of `var(--primary)` (`Header.tsx:89–98`, `OrderEditModal.tsx:136/199`, `RescheduleModal.tsx:114`). This is why the brand-migration (commit `50d6f8f`) still looks inconsistent — it's only half-applied.
- Several dark-mode status pills are under WCAG AA contrast (`statusColors.ts:119–127`, `out-for-delivery` bg `#032145/8` on dark).
- KPI cards and action badges use the same colour treatment, so users can't tell at a glance what's clickable.

**Recommendation.** Reduce to 6 canonical statuses (Pending, Scheduled, In Transit, Delivered, Cancelled, Failed). Route every colour through CSS tokens. Use filled pills for metrics, outlined pills for actions.

### 2.7 Accessibility

- Tab buttons on the dashboard use `<button onClick>` without `aria-current`/`aria-selected` (`AdminDashboardPage.tsx:1803–1816`).
- Status dropdowns lack `aria-label` describing the delivery they control.
- Several clickable `<div>`/`<span>` elements (`DeliveryCard.tsx:173`, `DateRangePicker.tsx:137–145`) are not focusable.
- Status badges rely on colour alone with no icon or text pattern.
- Driver online/offline indicator is a coloured dot only (`AdminDashboardPage.tsx:3379–3382`).

### 2.8 CSS hygiene

- `src/index.css` is 1,243 lines with ~35 `!important` declarations (lines 344–423, 979–1188). The dark-mode section is especially aggressive (`table { width:100% !important; position:relative !important }`). Any future override has to fight specificity wars.
- Hardcoded pixel widths break tablets (`Header.tsx:101` `maxWidth: 420px`; `OrderEditModal` `max-h-[min(92vh,780px)]`).

**Recommendation.** Move the hand-rolled overrides into `@layer` blocks and remove `!important`. Use viewport-relative sizes for the search bar and modals.

---

## 3. Functional Bugs

These are ordered by business impact.

### 3.1 High impact

- **Status update has no rollback on failure.** `AdminDashboardPage.tsx:2689–2700` optimistically updates the UI, catches the error, and logs it — but does not revert. Customers see the new status locally while the backend still shows the old one.
- **Ingest batch has no transaction.** `src/server/services/fileIngestion/processor.ts:108–185` upserts row by row. If row 50 fails, rows 1–49 are already committed and rows 51+ keep going. This produces partially imported files.
- **`POST /apply-pending-migrations` is unauthenticated** (`api/index.js:168`). Any unauthenticated caller can trigger DDL. This should not be exposed in production.
- **`status === 'rejected'` is double-counted in reports.** `src/server/api/reports.ts:225` buckets rejected into `cancelled` inside `dailyBreakdown`, while line 171 also tracks `rejected` separately. Cancellation KPI is inflated.
- **"Completed" filter inconsistent between places.** `src/utils/deliveryListFilter.ts:94–97` excludes rejected; `reports.ts:551–558` (POD) includes rejected. Same word, two meanings — this is the root cause of the POD/completed discrepancies the driver portal fix just patched.
- **Timezone drift between reports.** Main report uses `new Date(startDate)` (UTC), POD uses `Asia/Dubai`. Anything spanning midnight local time falls into the wrong bucket.
- **Manual 4-hour offset for Dubai time** in `DeliveryTeamPortal.tsx:133` (`Date.now() + 4*60*60*1000`) — this is a fixed offset and doesn't account for DST or system-clock drift. Should be replaced with `date-fns-tz` + `Asia/Dubai`.

### 3.2 Medium impact

- **Multiple polling timers stacking.** Each team portal independently runs `setInterval` for deliveries (60 s), drivers (60 s), unread (60 s), messages (30 s). If a user opens two portals in two tabs, the API is hit 4× more than necessary. No `document.hidden` pause is coordinated.
- **Race condition on live-map polling.** `AdminOperationsPage.tsx:465–480` rebuilds the whole routing key whenever any one driver moves, so OSRM is called for every driver on every tick.
- **`loadUnreadCounts` captured with empty deps** (`AdminOperationsPage.tsx:456`) — `useCallback(…, [])` produces a stale closure that never sees updated state.
- **Set of online users typed as `Set<any>`** (`AdminOperationsPage.tsx:196`), then compared with mixed `string | number | toString()` forms in `isContactOnline` — normalising IDs once would halve this code.
- **Geolocation failures are silent** in `DriverPortal.tsx:88–90`. If the driver denies GPS, the map is blank and no error is shown.
- **OSRM route fetch fails silently** — `AdminOperationsPage.tsx:486–541` sets `route = null` on failure with no user message.
- **File-ingest size check after decode** (`ingest.ts:76–89`) — a large base64 payload is already in memory before the cap is checked.
- **Ingest filename not validated** (`ingest.ts:68`) — accepts `../../etc/passwd` style inputs even if they only affect metadata.
- **No HTML escaping of customer name in email** (`server/sms/emailNotification.ts:87`) — any `<` in a customer name renders as HTML.
- **CSV export does not escape newlines** (`reports.ts:303–305`).
- **Pagination `take: 1000` hardcoded** with no client cap (`reports.ts:56`) — a crafted request can ask for millions.

### 3.3 Lower impact but worth cleaning

- `TERMINAL_STATUSES` is redefined in 3 portal files; next backend change will break 2 of them.
- `console.error('[Dashboard] Error:', err.message)` assumes `err.message` exists (`AdminDashboardPage.tsx:700`).
- Heatmap is hardcoded to 24 hours (`AdminDashboardPage.tsx:707–710`); shifts are 12 h in many cases.
- Division risk guarded inconsistently — sometimes returns `null`, sometimes `0` (`AdminDashboardPage.tsx:1026, 1229`).
- Deliveries / drivers / contacts state is local to each portal — no shared store — which is the real reason refreshes feel laggy between tabs.

---

## 4. Performance Observations

- Admin dashboard recomputes large memoised arrays (`trend5TopItems`, `trend8AreasStacked`, `filteredDeliveries`) against the full deliveries list on every filter keystroke. With 10 k orders this is noticeably slow.
- Charts on the dashboard are not wrapped in `React.memo`; editing a single input re-renders all 9 trend charts.
- `Header.tsx` is 881 lines with an inline memoised `AISearchBar` — because the parent has 10+ state variables, the memo rarely helps.
- `OrdersTable` re-renders all rows (no virtualization, no row `React.memo`).
- Driver portal rebuilds all markers on any list change (`DriverPortal.tsx:545–564`) instead of diffing.
- OSRM is called on every GPS tick with no debouncing (`DriverPortal.tsx:625–769`).

---

## 5. Recommended Priority

Ordered for biggest user-visible improvement per unit of engineering effort.

1. **Dashboard declutter** — reduce Overview to 4 KPIs + hero chart + Needs Attention panel, collapse Trends into 3 groups, move advanced filters behind a toggle. (High UX, low risk.)
2. **Shared filter state in URL** — so tab-switching doesn't nuke filters. Add visible "Apply / Reset" controls. (High UX.)
3. **One canonical status set** — consolidate `TERMINAL_STATUSES` into `src/types/statuses.ts`, reduce colour palette to 6, fix the reports double-count, align `deliveryListFilter.ts` with the POD logic. (Fixes multiple bugs at once.)
4. **Optimistic updates + error toasts** — for status change, dispatch, driver assign. Rollback on failure. (Stops the "it didn't work, let me click again" loop.)
5. **z-index + dirty-state for modals** — introduce `zIndex.ts`, add "Discard changes?" prompts in OrderEditModal and RescheduleModal, fix uncontrolled input sync. (Stops data loss.)
6. **Ingest pipeline hardening** — wrap batch in transaction, validate filename, size-check post-decode, protect the migration endpoint. (Data-integrity.)
7. **Single polling engine** — one hook at the app root subscribes all portals to a shared cache; pause on `document.hidden`. (Backend load + UI freshness.)
8. **Timezone unification** — one `Asia/Dubai` helper used everywhere; retire the manual 4-hour offset. (DST-safe.)
9. **Virtualized tables + column toggle** — for `OrdersTable` and the POD table. (Perceived speed.)
10. **Accessibility pass** — add `aria-` attributes, focus traps in modals, text/icon redundancy for colour-coded states. (Compliance + usability.)

---

## 6. Out-of-scope observations

- The outer `Logistics-system` folder contains both the main repo and a `.DS_Store`/`.cursor`/multiple `.env.bak*` files checked into the git workspace. `.env.bak`, `.env.bak2`, and `.env.prisma` likely contain old credentials and should be scrubbed from history.
- There are 20 k+ lines across `src/pages/` alone. A follow-up refactor to extract shared hooks (`usePortalData`, `useStatusUpdate`, `useOnlinePresence`) would halve the code and eliminate most duplication bugs in one pass.

---

*This report is advisory. No code has been changed. When you're ready to act on it, we can work through the priority list one item at a time.*
