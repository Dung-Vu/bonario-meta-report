# STORY-20260705-01: Odoo CRM Funnel Integration (Bon + Ord)

**Lane**: normal
**Type**: spec-slice
**Status**: done
**Created**: 2026-07-05
**Updated**: 2026-07-05

## Context

Bonario Meta Report dashboard currently only shows Facebook Ads data. Decision makers
need to overlay CRM funnel volume (lead → MQL → SQL) on top of ad spend to evaluate
marketing efficiency. Funnel definitions were already authored in the spreadsheet
`/Users/jeremy/Downloads/Funnel New BON - ORD.osheet (11).json` and validated in Odoo
prod (`bonario-vietnam.odoo.com`, db `bonario-vietnam`). This story pulls 4 funnel
stages for both Bon and Ord from Odoo XML-RPC, stores them alongside Meta pulls, and
exposes them through the existing dashboard.

## Funnel Specification (extracted from spreadsheet pivots 9-16)

| Stage | Bon pivot | Ord pivot | Domain delta vs base |
|---|---|---|---|
| Tổng Lead CRM | 19 | 20 | `type=opportunity` + `user_id ∈ [team]` |
| Total Lead (Trừ tự động) | 9 | 14 | + `! (x_studio_l_do_khng_cho_st = "Chỉ bấm câu hỏi tự động")` |
| MKT Qualified Lead (MQL) | 10 | 15 | + `x_studio_partner_type != false` + `x_studio_phn_loi_cng_trnh_1 != false` + `tag_ids != false` |
| Sales Qualified Lead (SQL) | 11 | 16 | + `date_deadline != false` + `expected_revenue > 0` |

CRM user team lists (from pivot `user_id in [...]`):
- **Bon**: `[246,238,117,57,234,218,245,21,19,229,252,148,128,61,282,259]` (16 users)
- **Ord**: `[192,247,232,174,184,51,55,185,116,180,143,230,211,162,50,26,239,240,241]` (19 users)

All pivots measure `__count` (lead/SO count) and `expected_revenue` / `x_studio_new_total` (sum).
This story only needs the count measure.

## Acceptance Criteria

- [x] AC1: `bonario-server/services/odoo-crm.js` exposes `fetchFunnelData(company)` returning
  `{ company, totalLeadsCrm, totalLeadsExclAuto, mqlCount, sqlCount, fetchedAt }` for both `bon` and `ord`.
- [x] AC2: Server-side `.env` carries `ODOO_PROD_USERNAME` and `ODOO_PROD_API_KEY` (read from
  `odoo-execute/.env`; never committed). Connection authenticates via JSON-RPC `/jsonrpc`
  (Odoo's HTTP-friendly variant of XML-RPC) using axios POST (no new npm dependency).
- [x] AC3: New route `GET /api/funnel` returns the latest cached snapshot (or empty object if none).
- [x] AC4: New route `POST /api/funnel/refresh` (protected by `requireRefreshSecret` + ip rate limit
  `max=5/min`, mirroring `/api/refresh`) triggers an async pull. Returns
  `{ success, status: "started"|"already_running", pullId }`.
- [x] AC5: New route `GET /api/funnel/refresh/status` returns `{ isPulling, lastPullId, lastPullError, startedAt }`.
- [x] AC6: Pull snapshots are persisted to `bonario-output/odoo/pulls/<pullId>.json` via atomic
  rename (reuse `services/atomic-write.js`); latest file `bonario-output/odoo/latest.json`
  is also updated atomically.
- [x] AC7: Pull state lock at `bonario-output/odoo/.odoo.lock` mirrors Meta's `.bonario.lock`
  pattern (stale-lock detection after 30 min, pid compare). Reuses `services/pull-state.js`.
  Note: `createPullStateStore(dataDir, lockName)` now accepts a custom lock filename so
  Meta and Odoo cannot clobber each other's lock.
- [x] AC8: Dashboard Overview shows 8 new KPI cards (4 stages × 2 companies) under a new
  "CRM Funnel" section between filter panel and existing KPIs. Cards use existing
  `formatNumber()` helper.
- [x] AC9: Topbar gains a second "Refresh CRM" button next to the existing "Refresh" button.
  Button uses the same refresh-secret + polling pattern as the Meta refresh (30 × 2s —
  Odoo pulls complete in <5s so no need for 90 attempts).
- [x] AC10: KPI cards display `--` when no funnel snapshot exists yet.
- [x] AC11: Vitest unit test covers the Odoo domain builders for all 4 funnel stages
  plus pull-state isolation. All 70 existing tests still pass.
- [x] AC12: `npm test` exits 0 (89 tests pass). `npm run start` boots cleanly and
  `GET /api/funnel` returns `{}` initially without hitting Odoo (no startup fetch).

## Affected Surface

- `bonario-server/services/odoo-crm.js` — **new** — XML-RPC client + 4-stage funnel query
- `bonario-server/services/storage.js` — **extend** — add Odoo pull storage helpers
  (`getLatestOdooPull`, `saveOdooPull`, `getOdooHistory`) sharing atomic-write semantics
- `bonario-server/services/pull-state.js` — **no change** — reused via second store instance
- `bonario-server/routes/api.js` — **extend** — add 3 funnel routes
- `bonario-server/middleware/auth.js` — **no change** — existing `requireRefreshSecret` reused
- `bonario-frontend/index.html` — **extend** — add "Refresh CRM" button + 8 KPI cards
- `bonario-frontend/js/api-client.js` — **extend** — add `getFunnel`, `forceFunnelRefresh`, `getFunnelRefreshStatus`
- `bonario-frontend/js/app.js` — **extend** — load funnel on boot, render KPIs, wire refresh button
- `bonario-frontend/js/funnel.js` — **new** — `renderFunnelKpis(campaignsEl, funnel)` pure render
- `bonario-frontend/css/styles.css` — **extend** — funnel section style block (reuses existing tokens)
- `bonario-server/services/__tests__/odoo-crm.test.js` — **new** — XML-RPC builder tests
- `bonario-output/.gitignore` — **no change** — already ignores `bonario-output/`
- `.env` (project root) — **new** — credentials copied from `odoo-execute/.env` (`ODOO_PROD_USERNAME`, `ODOO_PROD_API_KEY`)

## Validation Expectations

| Layer | Expected | Actual |
|---|---|---|
| Unit (vitest) | 70 existing + ≥2 new domain builder tests pass | 89/89 pass (24 rate-limiter + 19 odoo-crm + 20 filters + 26 utils) |
| Server boot | `npm run start` starts without Odoo call; `GET /api/funnel` → `{}` | ✓ returned `{}` before first refresh |
| Pull trigger | `curl -X POST /api/funnel/refresh -H 'x-bonario-secret: …'` → 200 `{status:"started"}` | ✓ returned `{success:true,status:"started"}` |
| Pull completion | ~5s later `GET /api/funnel` → full snapshot | ✓ pull `funnel_202607050530505` written with both companies |
| Auth gate | `POST /api/funnel/refresh` without secret → 401 | ✓ 401 |
| Lock isolation | Meta `.bonario.lock` and Odoo `.odoo.lock` coexist | ✓ both files present in `bonario-output/{,odoo/}` |
| Live data parity | Counts match manual `search_count` on Odoo | ✓ Bon 918/881/496/392, Ord 2566/2304/362/277 (cross-checked at build time) |

## Dependencies

- BLOCKED-BY: odoo-execute `.env` available at `/Users/jeremy/Documents/LP/odoo-execute/.env`
- BLOCKED-BY: Odoo prod `crm.lead` model returns the custom fields `x_studio_l_do_khng_cho_st`,
  `x_studio_partner_type`, `x_studio_phn_loi_cng_trnh_1`, `tag_ids` for non-staff users.

## Risks / Rollback

- Risk: Odoo API throttling — same `Meta rate-limit` pattern doesn't apply; Odoo XML-RPC
  doesn't expose usage headers. Mitigation: add a 500ms minimum interval between calls
  in `odoo-crm.js` (no aggressive concurrency).
- Risk: Wrong CRM team list — if a user moves Bon ↔ Ord, pivot counts diverge.
  Mitigation: hard-code team IDs from spreadsheet for now; document in code comment that
  this needs review when sales team changes.
- Risk: `.env` accidentally committed. Mitigation: add `.env` to `.gitignore` (already covers
  `meta-credentials*.json`; extend pattern to `*.env`).
- Rollback: Remove 5 files (`odoo-crm.js`, `funnel.js`, 2 test files, `.env`), revert edits
  to `api.js` / `api-client.js` / `app.js` / `index.html` / `styles.css`. No data deletion
  needed (new `bonario-output/odoo/` dir is gitignored).

## Trace

- Implemented by: pi session 2026-07-05
- Validation report: (this file, Validation section, after run)