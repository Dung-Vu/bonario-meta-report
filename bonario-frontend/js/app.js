import api, { setRefreshSecret } from './api-client.js';
import { updateCharts } from './charts.js';
import { applyFilters, sortCampaigns, expandToAds, sortAds } from './filters.js';
import { renderFunnelKpis, updateFunnelFreshness, clearFunnelKpis } from './funnel.js';
import {
  formatNumber, formatCurrency, formatDate, formatDateShort,
  formatObjective, showToast, getStatusClass,
  setCurrency, getCurrency, downloadCSV
} from './utils.js';

const state = {
  rawData: [],
  filterOptions: null,
  history: [],
  accountDaily: [],
  insights: null,
  rateLimit: null,
  currency: 'USD',
  lastUpdated: null,
  funnel: null,
  funnelUpdatedAt: null,
  odooFilter: { since: null, until: null },
  activeFilters: {
    since: null, until: null, campaigns: [], status: '',
    objective: '', adSet: '', budgetMin: null, budgetMax: null
  },
  sortBy: 'spend',
  sortDirection: 'desc',
  currentPage: 'overview',
  detailPage: 0,
  detailPageSize: 50
};

const loadingState = document.getElementById('loadingState');
const errorState = document.getElementById('errorState');
const dashboardContent = document.getElementById('dashboardContent');
const connectionStatusEl = document.getElementById('connectionStatus');
const refreshBtn = document.getElementById('refreshBtn');
const refreshCrmBtn = document.getElementById('refreshCrmBtn');

function showState(s) {
  loadingState.classList.add('hidden');
  errorState.classList.add('hidden');
  dashboardContent.classList.add('hidden');
  if (s === 'loading') loadingState.classList.remove('hidden');
  else if (s === 'error') errorState.classList.remove('hidden');
  else if (s === 'dashboard') dashboardContent.classList.remove('hidden');
}

function updateConnectionStatus(connected, message) {
  if (connected) {
    connectionStatusEl.textContent = 'Connected';
    connectionStatusEl.className = 'status-badge status-connected';
  } else {
    connectionStatusEl.textContent = message || 'Disconnected';
    connectionStatusEl.className = 'status-badge status-disconnected';
  }
}

function freshnessLabel(timestamp) {
  if (!timestamp) return '--';
  const ageMin = Math.round((Date.now() - new Date(timestamp).getTime()) / 60000);
  if (ageMin < 1) return 'just now';
  if (ageMin < 60) return `${ageMin} min ago`;
  const ageH = Math.round(ageMin / 60);
  if (ageH < 24) return `${ageH}h ago`;
  return `${Math.round(ageH / 24)}d ago`;
}

function updateFreshness() {
  const el = document.getElementById('freshnessLabel');
  if (!el) return;
  el.textContent = state.lastUpdated ? freshnessLabel(state.lastUpdated) : '--';
  el.title = state.lastUpdated ? new Date(state.lastUpdated).toLocaleString() : '';
}

function updateKPIs(campaigns) {
  let totalSpend = 0, totalImpressions = 0, totalReach = 0, totalClicks = 0;
  let totalPurchases = 0, totalMsgContacts = 0, totalNewMsgContacts = 0;

  const since = state.activeFilters.since;
  const until = state.activeFilters.until;
  const dateFilterActive = !!(since || until);

  // When date filter is active, prefer the account-level daily breakdown
  // (the only daily data we have). Fall back to campaign-level insights otherwise.
  if (dateFilterActive && state.accountDaily.length > 0) {
    for (const d of state.accountDaily) {
      if (since && d.date < since) continue;
      if (until && d.date > until) continue;
      totalSpend += d.spend || 0;
      totalImpressions += d.impressions || 0;
      totalReach += d.reach || 0;
      totalClicks += d.clicks || 0;
      totalPurchases += d.purchases || 0;
      totalMsgContacts += d.totalMsgContacts || 0;
      totalNewMsgContacts += d.newMsgContacts || 0;
    }
  } else {
    for (const c of campaigns) {
      const i = c.insights || {};
      totalSpend += i.spend || 0;
      totalImpressions += i.impressions || 0;
      totalReach += i.reach || 0;
      totalClicks += i.clicks || 0;
      totalPurchases += i.purchases || 0;
      totalMsgContacts += i.totalMsgContacts || 0;
      totalNewMsgContacts += i.newMsgContacts || 0;
    }
  }
  const avgCtr = totalImpressions > 0 ? (totalClicks / totalImpressions * 100) : 0;
  const avgCpc = totalClicks > 0 ? (totalSpend / totalClicks) : 0;
  const avgFreq = totalReach > 0 ? (totalImpressions / totalReach) : 0;

  document.getElementById('kpiSpend').textContent = formatCurrency(totalSpend);
  document.getElementById('kpiImpressions').textContent = formatNumber(totalImpressions);
  document.getElementById('kpiReach').textContent = formatNumber(totalReach);
  document.getElementById('kpiClicks').textContent = formatNumber(totalClicks);
  document.getElementById('kpiCtr').textContent = formatNumber(avgCtr, 2) + '%';
  document.getElementById('kpiCpc').textContent = formatCurrency(avgCpc);
  document.getElementById('kpiFreq').textContent = formatNumber(avgFreq, 2);
  document.getElementById('kpiPurchases').textContent = formatNumber(totalPurchases);
  document.getElementById('kpiMsgConversations').textContent = formatNumber(totalMsgContacts);
  document.getElementById('kpiNewMsgContacts').textContent = formatNumber(totalNewMsgContacts);
  document.getElementById('kpiConversions').textContent = formatNumber(totalPurchases);

  state.insights = {
    totalSpend, totalImpressions, totalReach, totalClicks,
    totalPurchases, totalMsgContacts, totalNewMsgContacts,
    avgCtr, avgCpc, avgFreq
  };
}

function renderDetailTable(campaigns) {
  const ads = expandToAds(campaigns);
  const sorted = sortAds(ads, state.sortBy, state.sortDirection);
  const tbody = document.getElementById('detailTableBody');

  const total = sorted.length;
  const start = state.detailPage * state.detailPageSize;
  const end = Math.min(start + state.detailPageSize, total);
  const page = sorted.slice(start, end);

  document.getElementById('resultCount').textContent =
    total === 0 ? '0 ads' : `${start + 1}-${end} of ${total} ads`;

  const prevBtn = document.getElementById('detailPrev');
  const nextBtn = document.getElementById('detailNext');
  if (prevBtn) prevBtn.disabled = state.detailPage <= 0;
  if (nextBtn) nextBtn.disabled = end >= total;
  const pageInfo = document.getElementById('detailPageInfo');
  if (pageInfo) pageInfo.textContent = total === 0 ? '' : `Page ${state.detailPage + 1} / ${Math.ceil(total / state.detailPageSize)}`;

  while (tbody.firstChild) tbody.removeChild(tbody.firstChild);

  if (total === 0) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 14;
    td.style.cssText = 'text-align:center;padding:2rem;color:var(--text-secondary);';
    td.textContent = 'No ads match the current filters';
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }

  const frag = document.createDocumentFragment();
  for (const ad of page) {
    const i = ad.insights || {};
    const statusClass = getStatusClass(ad.adStatus || ad.campaignStatus);
    const tr = document.createElement('tr');

    const adNameTd = document.createElement('td');
    const adNameSpan = document.createElement('span');
    adNameSpan.className = 'ad-name';
    adNameSpan.textContent = ad.adName || 'Unknown';
    adNameTd.appendChild(adNameSpan);

    const campaignRefTd = document.createElement('td');
    const campaignRefSpan = document.createElement('span');
    campaignRefSpan.className = 'campaign-ref';
    campaignRefSpan.textContent = ad.campaignName || '';
    campaignRefTd.appendChild(campaignRefSpan);

    const adSetRefTd = document.createElement('td');
    const adSetRefSpan = document.createElement('span');
    adSetRefSpan.className = 'adset-ref';
    adSetRefSpan.textContent = ad.adSetName || '';
    adSetRefTd.appendChild(adSetRefSpan);

    const statusTd = document.createElement('td');
    const statusSpan = document.createElement('span');
    statusSpan.className = 'campaign-status ' + statusClass;
    statusSpan.textContent = ad.adStatus || ad.campaignStatus || 'UNKNOWN';
    statusTd.appendChild(statusSpan);

    const rightAligned = [
      formatCurrency(i.spend),
      formatNumber(i.impressions),
      formatNumber(i.reach),
      formatNumber(i.clicks),
      formatNumber(i.ctr, 2) + '%',
      formatCurrency(i.cpc),
      formatNumber(i.purchases),
      formatNumber(i.totalMsgContacts),
      formatCurrency(i.costPerConversion || i.costPerPurchase)
    ];
    const tds = [adNameTd, campaignRefTd, adSetRefTd, statusTd];
    for (const text of rightAligned) {
      const td = document.createElement('td');
      td.textContent = text;
      td.style.textAlign = 'right';
      tds.push(td);
    }
    for (const td of tds) tr.appendChild(td);
    frag.appendChild(tr);
  }
  tbody.appendChild(frag);
}

function exportCurrentAdsToCSV() {
  const ads = expandToAds(state.rawData);
  const sorted = sortAds(ads, state.sortBy, state.sortDirection);
  const cur = getCurrency();
  const rows = [
    ['Ad Name', 'Campaign', 'Ad Set', 'Status', `Spend (${cur})`, 'Impressions', 'Reach', 'Clicks', 'CTR (%)', `CPC (${cur})`, 'Purchases', 'Msg Contacts', `Cost/Purchase (${cur})`]
  ];
  for (const ad of sorted) {
    const i = ad.insights || {};
    rows.push([
      ad.adName || '',
      ad.campaignName || '',
      ad.adSetName || '',
      ad.adStatus || ad.campaignStatus || '',
      (i.spend || 0).toFixed(0),
      i.impressions || 0,
      i.reach || 0,
      i.clicks || 0,
      (i.ctr || 0).toFixed(2),
      (i.cpc || 0).toFixed(0),
      i.purchases || 0,
      i.totalMsgContacts || 0,
      (i.costPerPurchase || 0).toFixed(0)
    ]);
  }
  const filename = `bonario-ads-${new Date().toISOString().split('T')[0]}.csv`;
  downloadCSV(filename, rows);
  showToast(`Exported ${sorted.length} ads to ${filename}`, 'success');
}

function getFilteredCampaigns() {
  return applyFilters(state.rawData, state.activeFilters);
}

function render() {
  const filtered = getFilteredCampaigns();
  updateKPIs(filtered);

  if (state.currentPage === 'overview') {
    updateCharts(filtered, state.insights, state.history, state.accountDaily);
  }

  renderDetailTable(filtered);
  updateFreshness();
}

function navigateToPage(page) {
  state.currentPage = page;

  document.querySelectorAll('.page').forEach(el => {
    el.classList.remove('active', 'hidden');
  });
  const target = document.getElementById('page-' + page);
  if (target) target.classList.add('active');
  const otherPage = page === 'overview' ? 'detail' : 'overview';
  const other = document.getElementById('page-' + otherPage);
  if (other) other.classList.add('hidden');

  document.querySelectorAll('.nav-link').forEach(el => {
    el.classList.toggle('active', el.dataset.page === page);
  });

  if (page === 'overview') {
    const filtered = getFilteredCampaigns();
    updateCharts(filtered, state.insights, state.history, state.accountDaily);
  }
}

function handleHashChange() {
  const hash = window.location.hash.replace('#', '');
  if (hash === 'detail') navigateToPage('detail');
  else navigateToPage('overview');
}

function populateFilterDropdowns() {
  const opts = state.filterOptions;
  if (!opts) return;

  const campaignSelect = document.getElementById('filterCampaign');
  const objectiveSelect = document.getElementById('filterObjective');
  const adSetSelect = document.getElementById('filterAdSet');

  const currentCampaign = campaignSelect.value;
  const currentObjective = objectiveSelect.value;
  const currentAdSet = adSetSelect.value;

  campaignSelect.innerHTML = '<option value="">All</option>';
  for (const c of opts.campaigns || []) {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.name;
    campaignSelect.appendChild(opt);
  }

  objectiveSelect.innerHTML = '<option value="">All</option>';
  for (const o of opts.objectives || []) {
    const opt = document.createElement('option');
    opt.value = o;
    opt.textContent = formatObjective(o);
    objectiveSelect.appendChild(opt);
  }

  adSetSelect.innerHTML = '<option value="">All</option>';
  for (const as_ of opts.adSets || []) {
    const opt = document.createElement('option');
    opt.value = as_.id;
    opt.textContent = as_.name;
    adSetSelect.appendChild(opt);
  }

  if (currentCampaign) campaignSelect.value = currentCampaign;
  if (currentObjective) objectiveSelect.value = currentObjective;
  if (currentAdSet) adSetSelect.value = currentAdSet;

  if (opts.budgetRange) {
    const minEl = document.getElementById('filterBudgetMin');
    const maxEl = document.getElementById('filterBudgetMax');
    if (opts.budgetRange.min > 0 && !minEl.value) minEl.placeholder = Math.round(opts.budgetRange.min).toLocaleString();
    if (opts.budgetRange.max > 0 && !maxEl.value) maxEl.placeholder = Math.round(opts.budgetRange.max).toLocaleString();
  }
}

function applyDatePreset(preset) {
  const today = new Date();
  const fmt = d => d.toISOString().split('T')[0];
  let since = null, until = null;

  if (preset === '7d') {
    since = fmt(new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000));
    until = fmt(today);
  } else if (preset === '30d') {
    since = fmt(new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000));
    until = fmt(today);
  } else if (preset === '90d') {
    since = fmt(new Date(today.getTime() - 90 * 24 * 60 * 60 * 1000));
    until = fmt(today);
  } else if (preset === 'month') {
    since = fmt(new Date(today.getFullYear(), today.getMonth(), 1));
    until = fmt(today);
  } else if (preset === 'all') {
    since = null;
    until = null;
  }

  document.getElementById('filterSince').value = since || '';
  document.getElementById('filterUntil').value = until || '';
  handleApplyFilters();
}

function handleApplyFilters() {
  state.activeFilters.status = document.getElementById('filterStatus').value;
  state.activeFilters.objective = document.getElementById('filterObjective').value;
  state.activeFilters.adSet = document.getElementById('filterAdSet').value;

  const campaignVal = document.getElementById('filterCampaign').value;
  state.activeFilters.campaigns = campaignVal ? [campaignVal] : [];

  const budgetMin = document.getElementById('filterBudgetMin').value;
  const budgetMax = document.getElementById('filterBudgetMax').value;
  state.activeFilters.budgetMin = budgetMin ? parseFloat(budgetMin) : null;
  state.activeFilters.budgetMax = budgetMax ? parseFloat(budgetMax) : null;

  const since = document.getElementById('filterSince').value || null;
  const until = document.getElementById('filterUntil').value || null;
  state.activeFilters.since = since;
  state.activeFilters.until = until;

  state.detailPage = 0;
  render();
}

function handleClearFilters() {
  document.getElementById('filterStatus').value = '';
  document.getElementById('filterObjective').value = '';
  document.getElementById('filterCampaign').value = '';
  document.getElementById('filterAdSet').value = '';
  document.getElementById('filterBudgetMin').value = '';
  document.getElementById('filterBudgetMax').value = '';
  document.getElementById('filterSince').value = '';
  document.getElementById('filterUntil').value = '';

  state.activeFilters = {
    since: null, until: null, campaigns: [], status: '',
    objective: '', adSet: '', budgetMin: null, budgetMax: null
  };
  state.detailPage = 0;
  render();
}

function handleSortChange() {
  state.sortBy = document.getElementById('sortBy').value;
  state.detailPage = 0;
  render();
}

function handleSortDirection(direction) {
  state.sortDirection = direction;
  document.getElementById('sortAsc').classList.toggle('active', direction === 'asc');
  document.getElementById('sortDesc').classList.toggle('active', direction === 'desc');
  state.detailPage = 0;
  render();
}

function handlePager(direction) {
  const ads = expandToAds(getFilteredCampaigns());
  const sorted = sortAds(ads, state.sortBy, state.sortDirection);
  const totalPages = Math.max(1, Math.ceil(sorted.length / state.detailPageSize));
  state.detailPage = Math.max(0, Math.min(totalPages - 1, state.detailPage + direction));
  render();
}

function updateRateLimitBadge() {
  const el = document.getElementById('rateLimitBadge');
  if (!el || !state.rateLimit) return;
  const pct = state.rateLimit.maxUsagePct || 0;
  const calls = state.rateLimit.callsInLastHour || 0;
  const max = state.rateLimit.maxCallsPerHour || 400;
  el.textContent = `API: ${calls}/${max}`;
  el.title = `Max usage: ${pct.toFixed(0)}%`;
  el.classList.toggle('warn', pct >= 60);
  el.classList.toggle('danger', pct >= 80);
}

async function pollRateLimit() {
  try {
    state.rateLimit = await api.getRateLimit();
    updateRateLimitBadge();
  } catch {}
}

async function loadFunnel() {
  try {
    const { since, until } = state.odooFilter;
    const funnel = await api.getFunnel({ since, until });
    if (funnel && funnel.companies) {
      state.funnel = funnel;
      state.funnelUpdatedAt = funnel.fetchedAt || null;
      renderFunnelKpis(funnel);
      updateFunnelFreshness(funnel.fetchedAt);
    } else {
      clearFunnelKpis();
    }
  } catch (error) {
    console.warn('[Bonario] Failed to load funnel:', error.message);
    clearFunnelKpis();
  }
}

function applyOdooFilterFromInputs() {
  const since = document.getElementById('odooFilterSince').value || null;
  const until = document.getElementById('odooFilterUntil').value || null;
  if (since && until && since > until) {
    showToast('Odoo: From date must be ≤ To date', 'error');
    return;
  }
  state.odooFilter = { since, until };
  loadFunnel();
}

function clearOdooFilter() {
  document.getElementById('odooFilterSince').value = '';
  document.getElementById('odooFilterUntil').value = '';
  state.odooFilter = { since: null, until: null };
  loadFunnel();
}

function applyOdooDatePreset(preset) {
  const today = new Date();
  const fmt = d => d.toISOString().split('T')[0];
  let since = null, until = null;

  if (preset === '7d') {
    since = fmt(new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000));
    until = fmt(today);
  } else if (preset === '30d') {
    since = fmt(new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000));
    until = fmt(today);
  } else if (preset === '90d') {
    since = fmt(new Date(today.getTime() - 90 * 24 * 60 * 60 * 1000));
    until = fmt(today);
  } else if (preset === 'month') {
    since = fmt(new Date(today.getFullYear(), today.getMonth(), 1));
    until = fmt(today);
  } else if (preset === 'all') {
    since = null;
    until = null;
  }

  document.getElementById('odooFilterSince').value = since || '';
  document.getElementById('odooFilterUntil').value = until || '';
  applyOdooFilterFromInputs();
}

async function loadData() {
  showState('loading');
  try {
    const dev = await api.getDevSecret();
    if (dev?.secret) setRefreshSecret(dev.secret);

    const status = await api.getStatus();
    state.currency = status.currency || 'USD';
    setCurrency(state.currency);
    state.lastUpdated = status.lastUpdated;
    state.accountDaily = status.accountDaily || [];
    updateConnectionStatus(true);

    const [campaignsResult, historyResult, filterOptionsResult, funnelResult] = await Promise.all([
      api.getCampaigns(),
      api.getHistory(),
      api.getFilterOptions(),
      api.getFunnel({ since: state.odooFilter.since, until: state.odooFilter.until }).catch(() => null)
    ]);

    state.rawData = campaignsResult.campaigns || [];
    state.history = historyResult.history || [];
    state.filterOptions = filterOptionsResult || null;

    if (funnelResult && funnelResult.companies) {
      state.funnel = funnelResult;
      state.funnelUpdatedAt = funnelResult.fetchedAt || null;
      renderFunnelKpis(funnelResult);
      updateFunnelFreshness(funnelResult.fetchedAt);
    } else {
      clearFunnelKpis();
    }

    populateFilterDropdowns();
    render();

    showState('dashboard');

    if (status.lastUpdated) {
      let footerText = 'Last updated: ' + formatDateShort(status.lastUpdated);
      if (status.dateRange) {
        footerText = `Date: ${status.dateRange.since} to ${status.dateRange.until} | ${footerText}`;
      }
      document.getElementById('footerDate').textContent = footerText;
    }
    if (status.accountName) {
      const el = document.getElementById('accountName');
      if (el) el.textContent = status.accountName;
    }

    pollRateLimit();
  } catch (error) {
    console.error('[Bonario] Failed to load data:', error);
    document.getElementById('errorMessage').textContent = error.message || 'Failed to load data';
    updateConnectionStatus(false, 'Load failed');
    showState('error');
  }
}

async function handleRefresh() {
  const btnLabel = refreshBtn.querySelector('.btn-label');
  const originalText = btnLabel.textContent;

  refreshBtn.disabled = true;
  btnLabel.textContent = 'Starting...';

  try {
    const since = document.getElementById('filterSince').value;
    const until = document.getElementById('filterUntil').value;
    const dateRange = (since && until) ? { since, until } : undefined;
    const result = await api.forceRefresh(dateRange);

    if (result.success) {
      if (result.status === 'already_running') {
        showToast('Refresh already in progress, please wait', 'warning');
        btnLabel.textContent = originalText;
        refreshBtn.disabled = false;
        return;
      }

      showToast('Refresh started — polling for completion...', 'success');

      let attempts = 0;
      const maxAttempts = 90;
      const pollInterval = setInterval(async () => {
        attempts++;
        try {
          const status = await api.getRefreshStatus();
          if (!status.isPulling) {
            clearInterval(pollInterval);
            if (status.lastPullError) {
              showToast('Refresh failed: ' + status.lastPullError, 'error', 6000);
            } else {
              showToast('Data refreshed successfully', 'success');
              await loadData();
            }
            btnLabel.textContent = originalText;
            refreshBtn.disabled = false;
          } else if (attempts >= maxAttempts) {
            clearInterval(pollInterval);
            showToast('Refresh taking longer than expected, check back later', 'warning');
            btnLabel.textContent = originalText;
            refreshBtn.disabled = false;
          } else {
            btnLabel.textContent = 'Refreshing... (' + (attempts * 2) + 's)';
          }
        } catch (e) {
          clearInterval(pollInterval);
          showToast('Error checking refresh status', 'error');
          btnLabel.textContent = originalText;
          refreshBtn.disabled = false;
        }
      }, 2000);
    } else {
      showToast(result.message || 'Refresh failed', 'error');
      btnLabel.textContent = originalText;
      refreshBtn.disabled = false;
    }
  } catch (error) {
    if (error.status === 401) {
      const input = prompt('Authentication required. Please enter the BONARIO_REFRESH_SECRET:');
      if (input !== null) {
        const secret = input.trim();
        if (secret) {
          setRefreshSecret(secret);
          showToast('Secret saved. Click refresh again to execute.', 'success');
        } else {
          setRefreshSecret(null);
        }
      } else {
        showToast('Refresh requires authentication (server secret mismatch)', 'error', 6000);
      }
    } else {
      showToast('Refresh failed: ' + error.message, 'error');
    }
    btnLabel.textContent = originalText;
    refreshBtn.disabled = false;
  }
}

async function handleRefreshCrm() {
  if (!refreshCrmBtn) return;
  const btnLabel = refreshCrmBtn.querySelector('.btn-label');
  const originalText = btnLabel.textContent;

  refreshCrmBtn.disabled = true;
  btnLabel.textContent = 'Starting...';

  try {
    const { since, until } = state.odooFilter;
    const result = await api.forceFunnelRefresh({ since, until });
    if (result.success) {
      if (result.status === 'already_running') {
        showToast('CRM refresh already in progress', 'warning');
        btnLabel.textContent = originalText;
        refreshCrmBtn.disabled = false;
        return;
      }
      showToast('CRM refresh started — polling for completion...', 'success');

      let attempts = 0;
      const maxAttempts = 30; // ~60s; Odoo pull is much faster than Meta
      const pollInterval = setInterval(async () => {
        attempts++;
        try {
          const status = await api.getFunnelRefreshStatus();
          if (!status.isPulling) {
            clearInterval(pollInterval);
            if (status.lastPullError) {
              showToast('CRM refresh failed: ' + status.lastPullError, 'error', 6000);
            } else {
              showToast('CRM funnel refreshed', 'success');
              await loadFunnel();
            }
            btnLabel.textContent = originalText;
            refreshCrmBtn.disabled = false;
          } else if (attempts >= maxAttempts) {
            clearInterval(pollInterval);
            showToast('CRM refresh taking longer than expected', 'warning');
            btnLabel.textContent = originalText;
            refreshCrmBtn.disabled = false;
          } else {
            btnLabel.textContent = 'Refreshing... (' + attempts * 2 + 's)';
          }
        } catch (e) {
          clearInterval(pollInterval);
          showToast('Error checking CRM refresh status', 'error');
          btnLabel.textContent = originalText;
          refreshCrmBtn.disabled = false;
        }
      }, 2000);
    } else {
      showToast(result.message || 'CRM refresh failed', 'error');
      btnLabel.textContent = originalText;
      refreshCrmBtn.disabled = false;
    }
  } catch (error) {
    if (error.status === 401) {
      const input = prompt('Authentication required. Please enter the BONARIO_REFRESH_SECRET:');
      if (input !== null) {
        const secret = input.trim();
        if (secret) {
          setRefreshSecret(secret);
          showToast('Secret saved. Click refresh again to execute.', 'success');
        } else {
          setRefreshSecret(null);
        }
      } else {
        showToast('CRM refresh requires authentication (server secret mismatch)', 'error', 6000);
      }
    } else {
      showToast('CRM refresh failed: ' + error.message, 'error');
    }
    btnLabel.textContent = originalText;
    refreshCrmBtn.disabled = false;
  }
}

function initApp() {
  if (window.location.protocol === 'file:') {
    updateConnectionStatus(false, 'Server required');
    document.getElementById('errorMessage').textContent = 'Run: npm run start, then visit http://localhost:3001';
    showState('error');
    return;
  }

  refreshBtn.addEventListener('click', handleRefresh);
  refreshCrmBtn?.addEventListener('click', handleRefreshCrm);
  document.getElementById('applyFilters').addEventListener('click', handleApplyFilters);
  document.getElementById('clearFilters').addEventListener('click', handleClearFilters);
  document.getElementById('applyOdooFilters')?.addEventListener('click', applyOdooFilterFromInputs);
  document.getElementById('clearOdooFilters')?.addEventListener('click', clearOdooFilter);
  document.getElementById('sortBy').addEventListener('change', handleSortChange);
  document.getElementById('sortAsc').addEventListener('click', () => handleSortDirection('asc'));
  document.getElementById('sortDesc').addEventListener('click', () => handleSortDirection('desc'));

  document.querySelectorAll('[data-preset]').forEach(btn => {
    btn.addEventListener('click', () => applyDatePreset(btn.dataset.preset));
  });

  document.querySelectorAll('[data-odoo-preset]').forEach(btn => {
    btn.addEventListener('click', () => applyOdooDatePreset(btn.dataset.odooPreset));
  });

  document.getElementById('detailPrev')?.addEventListener('click', () => handlePager(-1));
  document.getElementById('detailNext')?.addEventListener('click', () => handlePager(1));

  document.getElementById('exportCsv')?.addEventListener('click', exportCurrentAdsToCSV);

  document.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const page = link.dataset.page;
      window.location.hash = page === 'overview' ? '' : page;
      navigateToPage(page);
    });
  });

  window.addEventListener('hashchange', handleHashChange);
  handleHashChange();

  setInterval(() => {
    updateFreshness();
    updateFunnelFreshness(state.funnelUpdatedAt);
    pollRateLimit();
  }, 30_000);

  loadData();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}