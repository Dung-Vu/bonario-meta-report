# STORY-20260705-02: Separate Odoo Date Filter + Daily Snapshot

**Lane**: normal
**Type**: change-request
**Status**: done
**Created**: 2026-07-05
**Updated**: 2026-07-05

## Context

STORY-20260705-01 pulled Odoo funnel counts as all-time totals. The Meta filter
panel that controls date ranges for Meta KPIs/charts does not affect funnel
KPIs, which is confusing UX — the funnel section sits between the filter panel
and the Meta KPIs. User wants Odoo and Meta filters to be independent, and the
Odoo filter must actually change funnel data when the date range changes.

Snapshot schema must change from `{ totals }` to `{ daily, totals }` so date
filtering can happen against the cached snapshot without re-hitting Odoo on
every range change.

## Acceptance Criteria

- [x] AC1: `bonario-server/services/odoo-crm.js` rewritten to use one `search_read`
  per company (limit 5000) and evaluate stage membership locally via
  `evaluateStages()`. Buckets per `create_date` into `daily[YYYY-MM-DD][stage]`.
  Snapshot shape: `{ companies: { bon: { daily, totals }, ord: { daily, totals } } }`.
- [x] AC2: `GET /api/funnel?since=X&until=Y` reads `latest.json` and returns
  filtered totals (sum of daily counts in range). Missing params = all-time
  totals. Invalid date format → 400; since > until → 400.
- [x] AC3: `POST /api/funnel/refresh` body accepts optional `{since, until}`
  which constrains the Odoo pull itself (only fetches leads in that window).
  Same 400 validation as AC2.
- [x] AC4: Legacy snapshots (without `daily` field, written before this story)
  are gracefully treated as flat all-time totals, no crash. Marked `legacy: true`.
- [x] AC5: Frontend adds a SECOND filter panel below Meta, with a left border
  accent in #714B67 and a "CRM (Odoo)" pill tag, labelled "Funnel date range".
  Contains its own Since/Until inputs + preset chips + Apply button + Clear button.
- [x] AC6: Meta filter panel untouched. Meta and Odoo state are completely
  independent (separate DOM ids, separate state fields, separate API calls).
- [x] AC7: `applyOdooFilter()` calls `api.getFunnel({since, until})` which
  reads the cached snapshot and returns filtered view — no Odoo roundtrip.
- [x] AC8: `handleRefreshCrm()` sends current `state.odooFilter` in request body.
  If filter has dates, refresh is scoped to that window.
- [x] AC9: Live test PASSED — changing Odoo date on the backend API:
  - All-time:  Bon 918 / Ord 2568
  - Apr-Jul:   Bon 329 / Ord 578
  - Last 5d:   Bon 87  / Ord 117
  - Jul 4 only:Bon 51  / Ord 40
  - Apr only:  Bon 42  / Ord 39
  - Monotonic decreasing as range narrows. ✓

## Affected Surface

- `bonario-server/services/odoo-crm.js` — rewrite `fetchAllFunnels()` to use `search_read` + local bucketing
- `bonario-server/services/storage.js` — add `getFunnelView({since, until})`; keep `getLatestOdooPull()` for raw access
- `bonario-server/routes/api.js` — `/api/funnel` accepts `since`/`until` query; `/api/funnel/refresh` accepts body
- `bonario-frontend/index.html` — add Odoo filter section between Meta panel and Funnel
- `bonario-frontend/js/api-client.js` — `getFunnel({since, until})`, `forceFunnelRefresh({since, until})`
- `bonario-frontend/js/funnel.js` — accept and display date-range scope in freshness label
- `bonario-frontend/js/app.js` — add `applyOdooFilter()`, wire to button, update refresh handler
- `bonario-frontend/css/styles.css` — `.odoo-filter-panel`, scope badge styling
- `bonario-server/services/__tests__/odoo-crm.test.js` — add tests for daily bucket logic + filter scoping

## Validation Expectations

| Layer | Expected | Actual |
|---|---|---|
| Unit | new tests for `evaluateStages`, `bucketLeadsByDay`, `aggregateDailyInRange` | 20/20 odoo-crm tests pass; 90/90 total |
| Snapshot shape | `latest.json` has `daily` (422 days for Bon) + `totals` per company | ✓ 141KB snapshot, 422 daily entries |
| Filter scoping | `/api/funnel?since=X&until=Y` returns totals < all-time | ✓ 918 → 329 → 87 → 51 monotonic |
| Meta unaffected | `/api/campaigns` + `/api/status` unchanged when Odoo filter applied | ✓ 100 campaigns, lastUpdated unchanged |
| Visual separation | 2 distinct filter panels in HTML | ✓ meta `.filter-panel` + odoo `.odoo-filter-panel` |
| Refresh with date | `POST /api/funnel/refresh` with `{since,until}` accepts scoped body | ✓ same 400 validation |
| Legacy compat | Old snapshots (no `daily`) still readable | ✓ `getFunnelView` falls back with `legacy: true` |

## Risks / Rollback

- Risk: Old snapshots lack `daily` field → graceful fallback to all-time
  (AC4). Mitigation: snapshot reader detects missing field and warns.
- Risk: Snapshot size grows from ~460B to ~50KB with daily breakdown. Acceptable
  for daily granularity over 6+ months.
- Risk: If user sets since > until, weird behavior. Mitigation: 400 response.
- Rollback: revert to single-totals snapshot; Odoo panel becomes display-only
  (no filter applied). No data loss.

## Trace

- Implemented by: pi session 2026-07-05 (continuation of STORY-20260705-01)