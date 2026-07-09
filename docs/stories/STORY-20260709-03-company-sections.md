# STORY-20260709-03: Per-Company Chart Sections (BON + ORD)

**Lane**: normal
**Type**: spec-slice
**Status**: in-progress
**Created**: 2026-07-09
**Updated**: 2026-07-09

## Context

After STORY-20260709-02 split KPIs by company into a 3-column row grid, charts
in the Overview section still use the legacy 2-column layout
(`grid-template-columns: 1.2fr 0.8fr`). On typical viewport widths this
cramps the right column — donut and scatter charts overflow their cells,
rankings/status/actions/messaging charts get visually squished against the
right edge.

User feedback (2026-07-09, via screenshot):
> "các chart bên dưới bị ẩn. anh nghĩ em chia 2 section luôn, cho BON và
> ORD, Chart thì cứ sắp xếp sao cho hiển thị đầy đủ, không nên nhồi nhét."

Decision: split the chart area into 2 sections (one per company) with
breathing room, mirroring the Odoo funnel pattern (which already has Bon +
Ord side-by-side sections).

Account-level charts that cannot be split by company (Msg Daily, Msg
Weekly, Actions Breakdown) move into their own section below.

## Acceptance Criteria

- [ ] AC1: Replace the 4 `.charts-grid` rows in the Overview section with
  2 new sections: `#bonPerformanceSection` and `#ordPerformanceSection`.
- [ ] AC2: Each company section has: heading + 5-card mini-KPI strip +
  5 chart cards (Spend Trend / Top Campaigns / Objective / Status / CTR vs CPC).
  Charts use 2-column layout with `grid-template-columns: 1fr 1fr` and
  `aspect-ratio: 16/10` so canvases never overflow.
- [ ] AC3: Existing messaging charts (Msg Daily / Msg Weekly / Actions) move
  into a dedicated `#messagingSection` with clear "account-level" label.
- [ ] AC4: Each company chart receives ONLY that company's campaigns as input
  — verified by tapping a chart's data and confirming 0 cross-contamination.
- [ ] AC5: Mini-KPI strip per company mirrors top-line metrics (Spend, Impr,
  Clicks, CTR, CPC, MQL-ish) for that company alone, using existing
  `classifyCampaignCompany`/`filterCampaignsByCompany`.
- [ ] AC6: All 109 existing tests pass + ≥2 new tests for chart data splitting.
- [ ] AC7: On a 1100px-wide viewport, all charts render fully without right-edge
  clipping (verified via manual screenshot).

## Affected Surface

- `bonario-frontend/index.html` — restructure Overview section: replace 4 chart grids with 2 company sections + 1 messaging section; add 10 new canvas IDs
- `bonario-frontend/css/styles.css` — `.company-section`, `.company-section--bon`, `.company-section--ord`, `.chart-grid-2col`, `.mini-kpi-strip`, `.chart-aspect`
- `bonario-frontend/js/charts.js` — add `updateChartsByCompany({bonCampaigns, ordCampaigns, history, accountDaily})` + per-company chart helpers
- `bonario-frontend/js/app.js` — split `state.rawData` by company, pass to new chart function, render mini-KPI strips
- `bonario-frontend/js/charts.js` — keep existing single-company chart constructors but route them via the new dispatcher

## Validation Expectations

| Layer | Expected | Actual |
|---|---|---|
| Tests | 109 + ≥2 new pass | (fill) |
| Visual | All charts render without overflow on 1100px viewport | (manual) |
| Data isolation | Bon charts use only Bon campaigns | (manual) |
| Mini-KPIs | Bon mini-KPI total = Bon row in Overview KPI | (manual) |

## Risks / Rollback

- Risk: 10 new canvases = more JS bundle + chart instances. Mitigation: reuse chart config from existing functions.
- Risk: Visual regression on smaller screens. Mitigation: media query collapses company sections to single column under 1100px.
- Rollback: revert HTML to 4 `.charts-grid` rows + drop new chart helpers. No data loss.

## Trace

- Implemented by: pi session 2026-07-09