import { formatNumber, formatDateShort } from './utils.js';

// Maps DOM element id → server payload field name. Server returns a flat
// shape per company: { company, label, totalLeadsCrm, totalLeadsExclAuto,
// mqlCount, sqlCount } (after the funnel view filters the snapshot's daily
// breakdown).
const FIELD_MAP = {
  bonTongLeadCrm: 'totalLeadsCrm',
  bonTotalLeadExclAuto: 'totalLeadsExclAuto',
  bonMqlCount: 'mqlCount',
  bonSqlCount: 'sqlCount',
  ordTongLeadCrm: 'totalLeadsCrm',
  ordTotalLeadExclAuto: 'totalLeadsExclAuto',
  ordMqlCount: 'mqlCount',
  ordSqlCount: 'sqlCount'
};

export function renderFunnelKpis(funnelData) {
  const companies = funnelData?.companies || {};

  for (const [elementId, fieldName] of Object.entries(FIELD_MAP)) {
    const el = document.getElementById(elementId);
    if (!el) continue;
    const companyId = elementId.startsWith('bon') ? 'bon' : 'ord';
    const value = companies[companyId]?.[fieldName];
    el.textContent = value === undefined || value === null ? '--' : formatNumber(value);
  }

  // Update scope badge so user can see at a glance which date range is applied
  const badge = document.getElementById('odooScopeBadge');
  if (badge) {
    const scope = funnelData?.scope || {};
    if (scope.since || scope.until) {
      badge.hidden = false;
      badge.textContent = `${scope.since || '...'} → ${scope.until || '...'}`;
    } else {
      badge.hidden = false;
      badge.textContent = 'All time';
    }
  }

  const note = document.getElementById('funnelNote');
  if (note) {
    const scope = funnelData?.scope || {};
    if (scope.since || scope.until) {
      note.innerHTML = `Scope: leads created <strong>${formatDateShort(scope.since) || '—'}</strong> to <strong>${formatDateShort(scope.until) || '—'}</strong>. <a href="#" id="funnelRefreshHint">Pull from Odoo</a> for fresh snapshot.`;
    } else {
      note.innerHTML = `Scope: <strong>all time</strong>. <a href="#" id="funnelRefreshHint">Pull from Odoo</a> to refresh snapshot.`;
    }
    const hint = document.getElementById('funnelRefreshHint');
    if (hint) hint.addEventListener('click', (e) => {
      e.preventDefault();
      document.getElementById('refreshCrmBtn')?.click();
    });
  }
}

export function updateFunnelFreshness(timestamp) {
  const el = document.getElementById('funnelFreshnessLabel');
  if (!el) return;
  if (!timestamp) {
    el.textContent = 'No data yet';
    el.title = '';
    return;
  }
  const ageMin = Math.round((Date.now() - new Date(timestamp).getTime()) / 60000);
  let label;
  if (ageMin < 1) label = 'just now';
  else if (ageMin < 60) label = `${ageMin} min ago`;
  else {
    const ageH = Math.round(ageMin / 60);
    if (ageH < 24) label = `${ageH}h ago`;
    else label = `${Math.round(ageH / 24)}d ago`;
  }
  el.textContent = label;
  el.title = new Date(timestamp).toLocaleString();
}

export function clearFunnelKpis() {
  for (const elementId of Object.keys(FIELD_MAP)) {
    const el = document.getElementById(elementId);
    if (el) el.textContent = '--';
  }
  updateFunnelFreshness(null);
  const badge = document.getElementById('odooScopeBadge');
  if (badge) badge.hidden = true;
}

export default { renderFunnelKpis, updateFunnelFreshness, clearFunnelKpis };