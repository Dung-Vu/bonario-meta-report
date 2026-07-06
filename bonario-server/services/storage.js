import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { atomicWriteJSON } from './atomic-write.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, '../../bonario-output');
const PULLS_DIR = path.join(DATA_DIR, 'pulls');
const LATEST_FILE = path.join(DATA_DIR, 'latest.json');

const ODOO_DATA_DIR = path.join(DATA_DIR, 'odoo');
const ODOO_PULLS_DIR = path.join(ODOO_DATA_DIR, 'pulls');
const ODOO_LATEST_FILE = path.join(ODOO_DATA_DIR, 'latest.json');

async function ensureDataDirs() {
  try {
    await fs.mkdir(PULLS_DIR, { recursive: true });
    await fs.mkdir(DATA_DIR, { recursive: true });
  } catch (error) {
    console.error('Error creating data directories:', error);
  }
}

export async function getHistory() {
  await ensureDataDirs();

  try {
    const files = await fs.readdir(PULLS_DIR);
    const pulls = files
      .filter(f => f.startsWith('pull_') && f.endsWith('.json'))
      .map(f => f.replace('.json', ''))
      .sort()
      .reverse();

    const summaryPromises = pulls.slice(0, 30).map(async (pullId) => {
      try {
        const pull = await getPullById(pullId);
        if (!pull) return null;
        return {
          pullId: pull.pullId,
          timestamp: pull.timestamp,
          campaignCount: pull.campaigns?.length || 0,
          dateRange: pull.dateRange,
          currency: pull.currency || 'USD',
          summary: pull.summary || null
        };
      } catch (e) {
        console.warn(`Could not read pull ${pullId}:`, e.message);
        return null;
      }
    });

    const settled = await Promise.all(summaryPromises);
    return settled.filter(Boolean);
  } catch (error) {
    console.error('Error reading history:', error);
    return [];
  }
}

export async function getPullById(pullId) {
  await ensureDataDirs();

  const filePath = path.join(PULLS_DIR, `${pullId}.json`);

  try {
    const data = await fs.readFile(filePath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

export async function getLatestPull() {
  await ensureDataDirs();

  try {
    const data = await fs.readFile(LATEST_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

export async function savePull(pullData) {
  await ensureDataDirs();

  const { pullId } = pullData;

  const historyFile = path.join(PULLS_DIR, `${pullId}.json`);
  await atomicWriteJSON(historyFile, pullData);
  await atomicWriteJSON(LATEST_FILE, pullData);

  console.log(`[Bonario] Saved pull: ${pullId}`);
  return pullData;
}

export async function getCampaignsFromLatest() {
  const latestPull = await getLatestPull();
  return latestPull?.campaigns || [];
}

export async function getInsightsFromLatest(since, until) {
  const latestPull = await getLatestPull();

  if (!latestPull) {
    return null;
  }

  const campaigns = latestPull.campaigns || [];
  const accountDaily = latestPull.account_daily || [];
  const currency = latestPull.currency || 'USD';

  // If date filter applied, recompute totals from daily rows
  if (since || until) {
    let spend = 0, imps = 0, reach = 0, clicks = 0, purchases = 0;
    let msgContacts = 0, newMsgContacts = 0;
    for (const d of accountDaily) {
      if (since && d.date < since) continue;
      if (until && d.date > until) continue;
      spend += d.spend || 0;
      imps += d.impressions || 0;
      reach += d.reach || 0;
      clicks += d.clicks || 0;
      purchases += d.purchases || 0;
      msgContacts += d.totalMsgContacts || 0;
      newMsgContacts += d.newMsgContacts || 0;
    }
    return {
      currency,
      summary: {
        totalSpend: spend,
        totalImpressions: imps,
        totalReach: reach,
        totalClicks: clicks,
        totalPurchases: purchases,
        totalMsgContacts: msgContacts,
        totalNewMsgContacts: newMsgContacts,
        averageCtr: imps > 0 ? (clicks / imps * 100) : 0,
        averageCpc: clicks > 0 ? spend / clicks : 0,
        costPerPurchase: purchases > 0 ? spend / purchases : 0
      },
      dateRange: { since, until },
      timestamp: latestPull.timestamp
    };
  }

  // Prefer account-level daily totals (Meta returns these even for inactive/old campaigns);
  // fall back to per-campaign aggregation when account_daily is missing.
  let totalSpend = 0, totalImpressions = 0, totalReach = 0, totalClicks = 0;
  let totalPurchases = 0, totalMsgContacts = 0, totalNewMsgContacts = 0;

  if (accountDaily.length > 0) {
    for (const d of accountDaily) {
      totalSpend += d.spend || 0;
      totalImpressions += d.impressions || 0;
      totalReach += d.reach || 0;
      totalClicks += d.clicks || 0;
      totalPurchases += d.purchases || 0;
      totalMsgContacts += d.totalMsgContacts || 0;
      totalNewMsgContacts += d.newMsgContacts || 0;
    }
  } else {
    for (const campaign of campaigns) {
      const insights = campaign.insights || {};
      totalSpend += insights.spend || 0;
      totalImpressions += insights.impressions || 0;
      totalReach += insights.reach || 0;
      totalClicks += insights.clicks || 0;
      totalPurchases += insights.purchases || 0;
      totalMsgContacts += insights.totalMsgContacts || 0;
      totalNewMsgContacts += insights.newMsgContacts || 0;
    }
  }

  return {
    currency,
    summary: {
      totalSpend,
      totalImpressions,
      totalReach,
      totalClicks,
      totalPurchases,
      totalMsgContacts,
      totalNewMsgContacts,
      averageCtr: totalImpressions > 0 ? (totalClicks / totalImpressions * 100) : 0,
      averageCpc: totalClicks > 0 ? totalSpend / totalClicks : 0,
      costPerPurchase: totalPurchases > 0 ? totalSpend / totalPurchases : 0
    },
    dateRange: latestPull.dateRange,
    timestamp: latestPull.timestamp
  };
}

// ── in-memory cache for filter options (TTL 5 min) ────────────
let filterOptionsCache = null;
let filterOptionsCacheAt = 0;
const FILTER_OPTIONS_TTL_MS = 5 * 60 * 1000;

export async function getFilterOptions() {
  const now = Date.now();
  if (filterOptionsCache && (now - filterOptionsCacheAt) < FILTER_OPTIONS_TTL_MS) {
    return filterOptionsCache;
  }

  const campaigns = await getCampaignsFromLatest();

  const adSets = [];
  for (const c of campaigns) {
    if (c.adSets) {
      for (const as_ of c.adSets) {
        adSets.push({ id: as_.id, name: as_.name, campaignId: c.id, campaignName: c.name });
      }
    }
  }

  const statuses = [...new Set(campaigns.map(c => c.status))].filter(Boolean).sort();
  const objectives = [...new Set(campaigns.map(c => c.objective))].filter(Boolean).sort();

  let budgetMin = Infinity;
  let budgetMax = 0;
  for (const c of campaigns) {
    for (const as_ of c.adSets || []) {
      const budget = as_.daily_budget || as_.lifetime_budget;
      if (budget) {
        budgetMin = Math.min(budgetMin, budget);
        budgetMax = Math.max(budgetMax, budget);
      }
    }
  }
  if (budgetMin === Infinity) { budgetMin = 0; budgetMax = 0; }

  filterOptionsCache = {
    campaigns: campaigns.map(c => ({ id: c.id, name: c.name })),
    statuses,
    objectives,
    adSets,
    budgetRange: { min: budgetMin, max: budgetMax }
  };
  filterOptionsCacheAt = now;
  return filterOptionsCache;
}

export function invalidateFilterOptionsCache() {
  filterOptionsCache = null;
  filterOptionsCacheAt = 0;
}

// ── Odoo CRM funnel storage ─────────────────────────────────────────────────
// Snapshots live under bonario-output/odoo/ and are independent of the Meta
// pulls so they can be refreshed, restored, or wiped without touching Meta data.

export async function getOdooHistory() {
  await ensureOdooDirs();
  try {
    const files = await fs.readdir(ODOO_PULLS_DIR);
    const pulls = files
      .filter(f => f.startsWith('funnel_') && f.endsWith('.json'))
      .map(f => f.replace('.json', ''))
      .sort()
      .reverse();

    const summaries = await Promise.all(pulls.slice(0, 30).map(async (pullId) => {
      const pull = await getOdooPullById(pullId);
      if (!pull) return null;
      return {
        pullId: pull.pullId,
        timestamp: pull.fetchedAt,
        companies: pull.companies || {}
      };
    }));
    return summaries.filter(Boolean);
  } catch (error) {
    console.error('Error reading odoo history:', error);
    return [];
  }
}

export async function getOdooPullById(pullId) {
  await ensureOdooDirs();
  const filePath = path.join(ODOO_PULLS_DIR, `${pullId}.json`);
  try {
    const data = await fs.readFile(filePath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

export async function getLatestOdooPull() {
  await ensureOdooDirs();
  try {
    const data = await fs.readFile(ODOO_LATEST_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

// Build a date-filtered view from the latest snapshot. Snapshots written by
// the previous (totals-only) schema still work — we treat missing `daily` as
// a single all-time row.
export async function getFunnelView({ since, until } = {}) {
  const latest = await getLatestOdooPull();
  if (!latest) return null;
  const companies = latest.companies || {};
  const view = { fetchedAt: latest.fetchedAt, pullId: latest.pullId, scope: { since: since || null, until: until || null }, companies: {} };
  for (const companyId of Object.keys(companies)) {
    const c = companies[companyId];
    if (c.daily && typeof c.daily === 'object') {
      const filtered = aggregateDailyFromDaily(c.daily, since, until);
      view.companies[companyId] = {
        company: c.company,
        label: c.label,
        ...filtered
      };
    } else {
      // Legacy snapshot: flat totals already in the right shape.
      view.companies[companyId] = {
        company: c.company || companyId,
        label: c.label || companyId.toUpperCase(),
        totalLeadsCrm: c.totalLeadsCrm || 0,
        totalLeadsExclAuto: c.totalLeadsExclAuto || 0,
        mqlCount: c.mqlCount || 0,
        sqlCount: c.sqlCount || 0,
        legacy: true
      };
    }
  }
  return view;
}

function aggregateDailyFromDaily(daily, since, until) {
  const out = { totalLeadsCrm: 0, totalLeadsExclAuto: 0, mqlCount: 0, sqlCount: 0 };
  for (const [date, counts] of Object.entries(daily)) {
    if (since && date < since) continue;
    if (until && date > until) continue;
    for (const k of Object.keys(out)) out[k] += counts[k] || 0;
  }
  return out;
}

export async function saveOdooPull(pullData) {
  await ensureOdooDirs();
  const { pullId } = pullData;
  const historyFile = path.join(ODOO_PULLS_DIR, `${pullId}.json`);
  await atomicWriteJSON(historyFile, pullData);
  await atomicWriteJSON(ODOO_LATEST_FILE, pullData);
  console.log(`[Bonario][odoo] Saved funnel pull: ${pullId}`);
  return pullData;
}

async function ensureOdooDirs() {
  try {
    await fs.mkdir(ODOO_PULLS_DIR, { recursive: true });
    await fs.mkdir(ODOO_DATA_DIR, { recursive: true });
  } catch (error) {
    console.error('Error creating odoo data directories:', error);
  }
}

export default {
  getHistory,
  getPullById,
  getLatestPull,
  savePull,
  getCampaignsFromLatest,
  getInsightsFromLatest,
  getFilterOptions,
  invalidateFilterOptionsCache,
  saveOdooPull,
  getLatestOdooPull,
  getOdooHistory,
  getOdooPullById,
  getFunnelView
};