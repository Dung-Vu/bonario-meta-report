# STORY-20260709-01: Include Archived Leads + Pagination

**Lane**: normal (bug fix to STORY-20260705-02)
**Type**: change-request
**Status**: done
**Created**: 2026-07-09
**Updated**: 2026-07-09

## Context

After shipping STORY-20260705-02, user compared dashboard 192's June 2026 numbers
against the pulled snapshot and found a 4.5× discrepancy:

| Stage | Dashboard 192 (Bon Jun 2026) | Old pull | New pull |
|---|---|---|---|
| Tổng Lead CRM | 598 | 132 | **598** |
| Trừ tự động | 291 | 111 | **291** |
| MKT Qualified | 122 | 87 | **122** |
| Sales Qualified | 48 | 43 | **48** |

Two bugs hidden inside `fetchCompanyLeads()`:

### Bug 1 — `active` clause missing
The spreadsheet specifies `active_test = false` (R51) which means "include archived
leads". Odoo's `search_read` defaults `active=true` when no filter is given, silently
excluding ~470 archived Bon leads per month. Adding `['active','in',[true,false]]`
initially looked correct but Odoo 19's `Domain()` parser rejects it as malformed.

**Fix**: use explicit OR in Polish notation:
```
['|', ['active','=',true], ['active','=',false]]
```
Test confirmed this form works on both `search_count` and `search_read`.

### Bug 2 — Pagination missing
Ordinaire all-time returns 19,205 leads; previous code limited to 5,000 per
`search_read` and stopped there. The funnel "all-time" totals reported 5,000 —
off by 4×.

**Fix**: loop with `offset` incrementing by 5,000 until a short page is returned.

## Acceptance Criteria

- [x] AC1: `fetchCompanyLeads()` includes `['|', ['active','=',true], ['active','=',false]]`
  clause in Polish notation. Rejected `['active','in',[T,F]]` form is gone.
- [x] AC2: `fetchCompanyLeads()` paginates via offset loop until short page. Ordinaire
  all-time (19,205 leads) and Bon all-time (9,385 leads) both fully captured.
- [x] AC3: Live test — Bon June 2026 = **598 / 291 / 122 / 48** (matches dashboard 192 exactly).
- [x] AC4: Live test — Ord June 2026 = **628 / 580 / 137 / 106** (matches dashboard 192 exactly).
- [x] AC5: All-time totals now match `search_count` from Odoo (9385 Bon, 19205 Ord).
- [x] AC6: 93/93 tests pass, including new live test that asserts Bon June = 598.

## Affected Surface

- `bonario-server/services/odoo-crm.js` — fix `fetchCompanyLeads()` (active clause + pagination)
- `bonario-server/services/__tests__/odoo-crm.test.js` — added 3 new tests
- `bonario-output/odoo/latest.json` — re-pulled with corrected logic

## Validation Evidence

```
=== /api/funnel June 2026 ===
bon: 598 291 122 48
ord: 628 580 137 106

=== Dashboard 192 expectation ===
BON: 598 291 122 48
ORD: 628 580 137 106

=== /api/funnel all-time ===
bon: 9385 6315 1665 823      (was 5000 — 4× off)
ord: 19205 16258 1527 809    (was 5000 — 4× off)
```

## Rollback

Revert `fetchCompanyLeads()` to old single-page form (with `['active','in',[true,false]]`
if desired — but that errors out in Odoo 19). Loss: archived leads + any rows past 5000.

## Trace

- Implemented by: pi session 2026-07-09
- User-reported: comparison with dashboard 192 + screenshot showed 4.5× divergence