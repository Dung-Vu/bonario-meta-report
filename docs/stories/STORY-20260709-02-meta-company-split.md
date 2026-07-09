# STORY-20260709-02: Meta Split by Company + Ad-Set Detail Granularity

**Lane**: normal
**Type**: spec-slice
**Status**: done
**Created**: 2026-07-09
**Updated**: 2026-07-09

## Context

Meta Ads dashboard currently aggregates all 100 campaigns as one bucket. The
Odoo funnel already splits Bon / Ord / Rev side-by-side, so users now want
the same visibility for paid media. Classification is by campaign name
(96/100 campaigns follow `AT | <date> | <COMPANY>` pattern; rest contain
"Bon" / "Ord" / "Ordinaire" / "Rev" as substrings).

The per-ad detail table currently shows one row per ad with Campaign + Ad
Set as columns. User wants the granularity flipped: one row per ad set with
Campaign as a column. A toggle should let them drill back to per-ad view
when investigating a specific ad set.

## Acceptance Criteria

- [x] AC1: `classifyCampaignCompany(name)` returns bon/ord/rev/unknown. 98/100 prod
  campaigns classified correctly; only 2 unknown ("New Leads Campaign", "AT | 05.05.25 | IG TRAFFIC").
- [x] AC2: 6 vitest tests cover classifier (case-insensitive, priority overlap, non-string safety).
- [x] AC3: Meta filter panel has "Campaign Company" dropdown (All / Bonario / Ordinaire / Reverie / Unknown).
- [x] AC4: KPI grid restructured to 3-column layout (Bon / Ord / Rev) with dimming when
  one company is filtered out. Date-filter mode falls back to "—" for company cells
  (accountDaily has no campaign id).
- [x] AC5: Detail table defaults to per-ad-set. 956 ad rows collapse to 99 ad sets.
- [x] AC6: View toggle "Ad Set | Ad" switches granularity, resets pagination.
- [x] AC7: All filter/pagination/CSV-export behavior preserved.
- [x] AC8: 109/109 tests pass (16 new).

## Live verification

After fresh Meta pull (2025-01-01 → 2026-12-31), 97/100 campaigns have non-zero spend:
```
By company [count, spend VND, impressions, clicks]:
  bon:     23 campaigns | spend:   145,711,737 | impr:  3,041,451 | clicks:  91,131
  ord:     69 campaigns | spend:   901,991,955 | impr: 13,714,993 | clicks: 358,770
  rev:      4 campaigns | spend:    18,149,072 | impr:    873,220 | clicks:  14,688
  unknown:  1 campaigns | spend:       517,201 | impr:     14,805 | clicks:     612
```
Total 1,066,369,965 VND matches snapshot summary.

## Side-finding

The previous default 3-month Meta pull was producing all-zero per-campaign spend
even though `accountDaily` showed 304M VND total. Cause: the bulkInsights query
paginates per-month and only ran 3 months. Re-pulling with wider range populates
per-campaign data. Recommend widening the default range in `meta-ads.js`
`getDefaultDateRange()` — out of scope for this story.

## Affected Surface

- `bonario-frontend/js/filters.js` — add `classifyCampaignCompany()` + `aggregateByAdSet()`
- `bonario-frontend/js/__tests__/filters.test.js` — add classifier + aggregator tests
- `bonario-frontend/index.html` — Campaign Company dropdown in Meta filter; 3-column KPI cells; granularity toggle
- `bonario-frontend/js/app.js` — `state.companyFilter`, `state.detailGranularity`, wiring updateKPIs + renderDetailTable
- `bonario-frontend/css/styles.css` — KPI grid 3-col layout, toggle button styles

## Validation Expectations

| Layer | Expected | Actual |
|---|---|---|
| Unit | classifier tests pass (4-6 cases) | (fill) |
| Dashboard | Overview shows 3-column KPI cards; numbers sum to all-time totals | (manual) |
| Toggle | Switching Ad Set ↔ Ad updates table without errors | (manual) |
| Filter | Selecting Bonario filters KPIs and charts down to Bon campaigns | (manual) |

## Risks / Rollback

- Risk: Classifier mis-tags campaigns with substring overlaps ("AT | 09.25 | REV | ENGAGEMENT" might false-positive if a future campaign name contains "ord" without meaning Ordinaire).
  Mitigation: priority order is ord → bon → rev so more specific terms win;
  user can override via the dropdown by picking the intended company.
- Risk: Ad-set granularity hides the per-ad detail for users who previously browsed ads.
  Mitigation: toggle is one click away; default behavior can be flipped if feedback demands.
- Rollback: Revert `classifyCampaignCompany` invocations + remove dropdown + restore per-ad default in `renderDetailTable`.

## Trace

- Implemented by: pi session 2026-07-09