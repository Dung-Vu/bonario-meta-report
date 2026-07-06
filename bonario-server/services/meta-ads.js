import axios from 'axios';
import path from 'path';
import { fileURLToPath } from 'url';
import { readFile, readdir, unlink } from 'fs/promises';
import { existsSync } from 'fs';
import { savePull, getCampaignsFromLatest, getInsightsFromLatest } from './storage.js';
import rateLimiter from './rate-limiter.js';
import { createPullStateStore } from './pull-state.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const META_API_BASE = 'https://graph.facebook.com';
const MIN_API_INTERVAL = 300; // minimum ms between calls
const MAX_RETRIES = 4;
const RETRY_BACKOFF_MS = 2000; // base for exponential backoff
const SERVER_ERROR_BACKOFF_MS = 1500;
const PULL_RETENTION_DAYS = 30;

let lastApiCallTime = 0;
let credentialsCache = null;
let credentialsCacheAt = 0;
const CREDENTIALS_TTL_MS = 60_000;

// ── persistent pull state ─────────────────────────────────────
const DATA_DIR = path.join(__dirname, '../../bonario-output');
const pullState = createPullStateStore(DATA_DIR);

// ── credentials loader (cached) ───────────────────────────────
async function loadCredentials() {
  const accessToken = process.env.META_ACCESS_TOKEN;
  const adAccountId = process.env.META_AD_ACCOUNT_ID;
  const apiVersion = process.env.META_API_VERSION || 'v22.0';

  if (accessToken && adAccountId) {
    return {
      access_token: accessToken,
      ad_account_id: adAccountId,
      api_version: apiVersion
    };
  }

  const now = Date.now();
  if (credentialsCache && (now - credentialsCacheAt) < CREDENTIALS_TTL_MS) {
    return credentialsCache;
  }
  const credPath = path.join(__dirname, '../../meta-credentials_3.json');
  try {
    const data = await readFile(credPath, 'utf8');
    credentialsCache = JSON.parse(data);
    credentialsCacheAt = now;
    return credentialsCache;
  } catch (error) {
    console.error('[Bonario] Error loading credentials from environment or file:', error);
    throw new Error('Failed to load Meta API credentials. Set META_ACCESS_TOKEN and META_AD_ACCOUNT_ID in environment, or provide meta-credentials_3.json file.');
  }
}

// ── throttle + record ─────────────────────────────────────────
async function throttleApiCall() {
  await rateLimiter.beforeCall();
  const now = Date.now();
  const elapsed = now - lastApiCallTime;
  if (elapsed < MIN_API_INTERVAL) {
    await new Promise(r => setTimeout(r, MIN_API_INTERVAL - elapsed));
  }
  lastApiCallTime = Date.now();
}

// ── HTTP layer with retry + header capture ────────────────────
async function fetchMetaApiWithRetry(endpoint, params = {}, retries = MAX_RETRIES, axiosOpts = {}) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      await throttleApiCall();
      const creds = await loadCredentials();
      const url = `${META_API_BASE}/${creds.api_version}/${endpoint}`;
      const queryParams = { access_token: creds.access_token, ...params };
      const response = await axios.get(url, {
        params: queryParams,
        timeout: 30000,
        ...axiosOpts
      });

      if (response.headers) {
        rateLimiter.updateFromHeaders(response.headers);
      }
      return response.data;
    } catch (error) {
      const rateLimited = rateLimiter.isRateLimitError(error);
      const serverError = rateLimiter.isServerError(error);

      if (error.response?.headers) {
        rateLimiter.updateFromHeaders(error.response.headers);
      }

      if (rateLimited) {
        const regainMin = rateLimiter.getRegainMinutes();
        const waitMs = Math.max(
          Math.pow(2, attempt + 1) * RETRY_BACKOFF_MS,
          regainMin * 60 * 1000
        );
        console.warn(`[Bonario] Rate limited (attempt ${attempt + 1}/${retries}) — sleeping ${(waitMs / 1000).toFixed(1)}s, regain=${regainMin}min`);
        await new Promise(r => setTimeout(r, Math.min(waitMs, 5 * 60 * 1000)));
        continue;
      }

      if (serverError && attempt < retries) {
        const waitMs = Math.pow(2, attempt + 1) * SERVER_ERROR_BACKOFF_MS;
        console.warn(`[Bonario] 5xx error (attempt ${attempt + 1}/${retries}) — sleeping ${(waitMs / 1000).toFixed(1)}s`);
        await new Promise(r => setTimeout(r, waitMs));
        continue;
      }

      if (error.response) {
        const errorData = error.response.data;
        console.error('[Bonario] Meta API Error:', errorData);
        throw new Error(`Meta API Error: ${errorData.error?.message || 'Unknown error'}`);
      }
      throw error;
    }
  }
  throw new Error('Meta API: exhausted retries');
}

async function fetchMetaApi(endpoint, params = {}, axiosOpts = {}) {
  return fetchMetaApiWithRetry(endpoint, params, MAX_RETRIES, axiosOpts);
}

// ── date helpers ──────────────────────────────────────────────
function getDefaultDateRange() {
  const until = new Date();
  const since = new Date();
  since.setMonth(since.getMonth() - 3);
  return {
    since: since.toISOString().split('T')[0],
    until: until.toISOString().split('T')[0]
  };
}

function formatDate(date) {
  if (typeof date === 'string') date = new Date(date);
  return date.toISOString().split('T')[0];
}

// ── currency detection ────────────────────────────────────────
async function fetchAccountCurrency() {
  try {
    const creds = await loadCredentials();
    const data = await fetchMetaApi(creds.ad_account_id, {
      fields: 'currency,account_status,name'
    });
    return {
      currency: data.currency || 'USD',
      accountName: data.name || '',
      accountStatus: data.account_status || null
    };
  } catch (err) {
    console.warn('[Bonario] Could not fetch account currency:', err.message);
    return { currency: 'USD', accountName: '', accountStatus: null };
  }
}

// ── bulk insights ─────────────────────────────────────────────
async function fetchBulkInsights(dateRange, onProgress) {
  const creds = await loadCredentials();
  const { since, until } = dateRange || getDefaultDateRange();

  const fields = [
    'campaign_id', 'campaign_name', 'date_start', 'date_stop',
    'spend', 'impressions', 'reach', 'clicks', 'ctr', 'cpc', 'frequency',
    'actions', 'cost_per_action_type', 'cost_per_conversion', 'currency'
  ].join(',');

  const months = [];
  const cursor = new Date(since);
  const end = new Date(until);
  while (cursor <= end) {
    const monthStart = cursor.toISOString().split('T')[0];
    cursor.setMonth(cursor.getMonth() + 1);
    cursor.setDate(1);
    const monthEnd = new Date(Math.min(cursor.getTime(), end.getTime())).toISOString().split('T')[0];
    months.push({ since: monthStart, until: monthEnd });
  }

  console.log(`[Bonario] Fetching daily campaign insights across ${months.length} month(s)...`);
  let allData = [];

  for (let mi = 0; mi < months.length; mi++) {
    const month = months[mi];
    if (onProgress) onProgress({ phase: 'insights', monthIndex: mi, totalMonths: months.length });
    console.log(`[Bonario]   Fetching ${month.since} to ${month.until}...`);

    try {
      const firstResponse = await fetchMetaApi(
        `${creds.ad_account_id}/insights`,
        {
          fields,
          time_range: JSON.stringify({ since: month.since, until: month.until }),
          time_increment: 1,
          level: 'campaign',
          limit: 500
        },
        { timeout: 120000 }
      );

      const data1 = firstResponse.data || [];
      allData = allData.concat(data1);
      let nextUrl = firstResponse.paging?.next || null;
      let pageCount = 1;

      while (nextUrl) {
        pageCount++;
        await rateLimiter.beforeCall();
        const response = await axios.get(nextUrl, { timeout: 120000 });
        if (response.headers) rateLimiter.updateFromHeaders(response.headers);
        const data = response.data.data || [];
        allData = allData.concat(data);
        nextUrl = response.data.paging?.next || null;
      }
      console.log(`[Bonario]   Page ${pageCount}: ${data1.length} rows, total so far: ${allData.length}`);
    } catch (error) {
      console.warn(`[Bonario]   Could not fetch ${month.since}-${month.until}:`, error.message);
    }
  }

  console.log(`[Bonario] Fetched ${allData.length} daily rows total`);
  return allData;
}

async function fetchAccountInsights(dateRange) {
  const creds = await loadCredentials();
  const { since, until } = dateRange || getDefaultDateRange();

  const fields = ['date_start', 'spend', 'impressions', 'reach', 'clicks', 'actions'].join(',');

  const months = [];
  const cursor = new Date(since);
  const end = new Date(until);
  while (cursor <= end) {
    const monthStart = cursor.toISOString().split('T')[0];
    cursor.setMonth(cursor.getMonth() + 1);
    cursor.setDate(1);
    const monthEnd = new Date(Math.min(cursor.getTime(), end.getTime())).toISOString().split('T')[0];
    months.push({ since: monthStart, until: monthEnd });
  }

  console.log(`[Bonario] Fetching account-level daily metrics across ${months.length} month(s)...`);
  let allData = [];

  for (const month of months) {
    try {
      await throttleApiCall();
      const response = await fetchMetaApi(
        `${creds.ad_account_id}/insights`,
        {
          fields,
          time_range: JSON.stringify({ since: month.since, until: month.until }),
          time_increment: 1,
          level: 'account',
          limit: 500
        },
        { timeout: 60000 }
      );
      const data = response.data || [];
      allData = allData.concat(data);
    } catch (error) {
      console.warn(`[Bonario]   Account insights ${month.since}-${month.until}:`, error.message);
    }
  }

  console.log(`[Bonario] Fetched ${allData.length} account-level daily rows`);

  return allData.map(row => {
    let purchases = 0, totalMsgContacts = 0, newMsgContacts = 0;
    if (row.actions) {
      for (const a of row.actions) {
        if (a.action_type === 'onsite_conversion.purchase' || a.action_type === 'purchase') {
          purchases = Math.max(purchases, parseInt(a.value) || 0);
        }
        if (a.action_type === 'onsite_conversion.total_messaging_connection') totalMsgContacts = parseInt(a.value) || 0;
        if (a.action_type === 'onsite_conversion.messaging_first_reply') newMsgContacts = parseInt(a.value) || 0;
      }
    }
    return {
      date: row.date_start,
      spend: parseFloat(row.spend) || 0,
      impressions: parseInt(row.impressions) || 0,
      reach: parseInt(row.reach) || 0,
      clicks: parseInt(row.clicks) || 0,
      purchases,
      totalMsgContacts,
      newMsgContacts
    };
  });
}

async function fetchCampaigns(dateRange) {
  const creds = await loadCredentials();
  const { since, until } = dateRange || getDefaultDateRange();

  // Include adset_id on ads so frontend can correlate without guessing.
  const fields = [
    'id', 'name', 'status', 'objective', 'created_time', 'start_time', 'stop_time',
    'adsets{id,name,status,daily_budget,lifetime_budget}',
    'ads{id,name,status,adset_id,creative}'
  ].join(',');

  console.log(`[Bonario] Fetching campaigns (with adSets + ads) for ${since} to ${until}...`);

  const response = await fetchMetaApi(
    `${creds.ad_account_id}/campaigns`,
    {
      fields,
      time_range: JSON.stringify({ since, until }),
      limit: 100
    }
  );

  return response.data || [];
}

async function fetchCampaignInsights(campaignId, dateRange) {
  const { since, until } = dateRange || getDefaultDateRange();

  const fields = [
    'spend', 'impressions', 'reach', 'clicks', 'ctr', 'cpc', 'frequency',
    'actions', 'cost_per_action_type', 'cost_per_conversion'
  ].join(',');

  try {
    const response = await fetchMetaApi(
      `${campaignId}/insights`,
      { fields, time_range: JSON.stringify({ since, until }), limit: 100 }
    );
    return response.data?.[0] || null;
  } catch (error) {
    console.warn(`[Bonario] Could not fetch insights for campaign ${campaignId}:`, error.message);
    return null;
  }
}

async function fetchAdSets(campaignId) {
  const fields = ['id', 'name', 'status', 'daily_budget', 'lifetime_budget'].join(',');
  try {
    const response = await fetchMetaApi(`${campaignId}/adsets`, { fields, limit: 100 });
    return response.data || [];
  } catch (error) {
    console.warn(`[Bonario] Could not fetch ad sets for campaign ${campaignId}:`, error.message);
    return [];
  }
}

async function fetchAds(campaignId) {
  const fields = ['id', 'name', 'status', 'adset_id', 'creative'].join(',');
  try {
    const response = await fetchMetaApi(`${campaignId}/ads`, { fields, limit: 100 });
    return response.data || [];
  } catch (error) {
    console.warn(`[Bonario] Could not fetch ads for campaign ${campaignId}:`, error.message);
    return [];
  }
}

// ── cleanup old pulls (best-effort, non-blocking) ─────────────
async function cleanupOldPulls() {
  const pullsDir = path.join(DATA_DIR, 'pulls');
  try {
    if (!existsSync(pullsDir)) return 0;
    const files = await readdir(pullsDir);
    const cutoff = Date.now() - PULL_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    let deleted = 0;
    for (const f of files) {
      if (!f.startsWith('pull_') || !f.endsWith('.json')) continue;
      const tsMatch = f.match(/pull_(\d{4})(\d{2})(\d{2})_/);
      if (!tsMatch) continue;
      const fileDate = new Date(`${tsMatch[1]}-${tsMatch[2]}-${tsMatch[3]}`).getTime();
      if (fileDate < cutoff) {
        try {
          await unlink(path.join(pullsDir, f));
          deleted++;
        } catch {}
      }
    }
    if (deleted > 0) console.log(`[Bonario] Cleanup: removed ${deleted} old pull files`);
    return deleted;
  } catch (err) {
    console.warn('[Bonario] Cleanup failed:', err.message);
    return 0;
  }
}

// ── main pull orchestrator ────────────────────────────────────
export async function fetchAllData(dateRange, onProgress) {
  dateRange = dateRange || getDefaultDateRange();
  const timestamp = new Date().toISOString();
  const pullId = `pull_${formatDate(timestamp).replace(/-/g, '')}_${timestamp.split('T')[1].substring(0, 8).replace(/:/g, '')}`;

  console.log(`[Bonario] Starting data pull: ${pullId}`);

  if (onProgress) onProgress({ phase: 'account', pullId });
  const accountInfo = await fetchAccountCurrency();
  console.log(`[Bonario] Account currency: ${accountInfo.currency}`);

  if (onProgress) onProgress({ phase: 'campaigns' });
  const campaigns = await fetchCampaigns(dateRange);
  console.log(`[Bonario] Found ${campaigns.length} campaigns`);

  if (onProgress) onProgress({ phase: 'insights', campaigns: campaigns.length });
  const bulkInsights = await fetchBulkInsights(dateRange, onProgress);
  console.log(`[Bonario] Fetched ${bulkInsights.length} daily insight rows`);

  if (onProgress) onProgress({ phase: 'accountDaily' });
  const accountDaily = await fetchAccountInsights(dateRange);

  const dailyByCampaign = {};
  for (const row of bulkInsights) {
    const cid = row.campaign_id;
    if (!dailyByCampaign[cid]) dailyByCampaign[cid] = [];
    let purchases = 0, totalMsgContacts = 0, newMsgContacts = 0;
    if (row.actions) {
      for (const a of row.actions) {
        if (a.action_type === 'onsite_conversion.purchase' || a.action_type === 'purchase') {
          purchases = Math.max(purchases, parseInt(a.value) || 0);
        }
        if (a.action_type === 'onsite_conversion.total_messaging_connection') totalMsgContacts = parseInt(a.value) || 0;
        if (a.action_type === 'onsite_conversion.messaging_first_reply') newMsgContacts = parseInt(a.value) || 0;
      }
    }
    dailyByCampaign[cid].push({
      date: row.date_start,
      spend: parseFloat(row.spend) || 0,
      impressions: parseInt(row.impressions) || 0,
      reach: parseInt(row.reach) || 0,
      clicks: parseInt(row.clicks) || 0,
      ctr: parseFloat(row.ctr) || 0,
      cpc: parseFloat(row.cpc) || 0,
      frequency: parseFloat(row.frequency) || 0,
      purchases,
      totalMsgContacts,
      newMsgContacts
    });
  }

  function aggregateDaily(dailyRows) {
    if (!dailyRows || dailyRows.length === 0) {
      return { spend: 0, impressions: 0, reach: 0, clicks: 0, ctr: 0, cpc: 0, frequency: 0, purchases: 0, totalMsgContacts: 0, newMsgContacts: 0 };
    }
    let s = 0, i = 0, r = 0, c = 0, p = 0, tmc = 0, nmc = 0;
    for (const d of dailyRows) {
      s += d.spend;
      i += d.impressions;
      r += d.reach;
      c += d.clicks;
      p += d.purchases || 0;
      tmc += d.totalMsgContacts || 0;
      nmc += d.newMsgContacts || 0;
    }
    return {
      spend: s,
      impressions: i,
      reach: r,
      clicks: c,
      purchases: p,
      totalMsgContacts: tmc,
      newMsgContacts: nmc,
      ctr: i > 0 ? (c / i * 100) : 0,
      cpc: c > 0 ? s / c : 0,
      frequency: r > 0 ? i / r : 0,
      costPerPurchase: p > 0 ? s / p : 0
    };
  }

  const campaignsWithInsights = [];
  for (const campaign of campaigns) {
    const dailyRows = dailyByCampaign[campaign.id] || [];
    const aggregated = aggregateDaily(dailyRows);

    campaignsWithInsights.push({
      id: campaign.id,
      name: campaign.name,
      status: campaign.status,
      objective: campaign.objective,
      created_time: campaign.created_time,
      insights: aggregated,
      daily_insights: dailyRows,
      adSets: campaign.adsets?.data || [],
      ads: campaign.ads?.data || []
    });
  }

  let totalSpend = 0, totalImpressions = 0, totalReach = 0, totalClicks = 0;
  let totalPurchases = 0, totalMsgContacts = 0, totalNewMsgContacts = 0;
  for (const campaign of campaignsWithInsights) {
    totalSpend += campaign.insights.spend;
    totalImpressions += campaign.insights.impressions;
    totalReach += campaign.insights.reach;
    totalClicks += campaign.insights.clicks;
    totalPurchases += campaign.insights.purchases || 0;
    totalMsgContacts += campaign.insights.totalMsgContacts || 0;
    totalNewMsgContacts += campaign.insights.newMsgContacts || 0;
  }

  let accountReach = 0, accountPurchases = 0, accountMsgContacts = 0, accountNewMsg = 0;
  let accountSpend = 0, accountImpressions = 0, accountClicks = 0;
  for (const d of accountDaily) {
    accountReach += d.reach;
    accountPurchases += d.purchases || 0;
    accountMsgContacts += d.totalMsgContacts || 0;
    accountNewMsg += d.newMsgContacts || 0;
    accountSpend += d.spend || 0;
    accountImpressions += d.impressions || 0;
    accountClicks += d.clicks || 0;
  }

  const pullData = {
    pullId,
    timestamp,
    dateRange,
    currency: accountInfo.currency,
    accountName: accountInfo.accountName,
    accountStatus: accountInfo.accountStatus,
    campaigns: campaignsWithInsights,
    account_daily: accountDaily,
    summary: {
      totalSpend: totalSpend || accountSpend,
      totalImpressions: totalImpressions || accountImpressions,
      totalReach: accountReach || totalReach,
      totalClicks: totalClicks || accountClicks,
      totalPurchases: accountPurchases || totalPurchases,
      totalMsgContacts: accountMsgContacts || totalMsgContacts,
      totalNewMsgContacts: accountNewMsg || totalNewMsgContacts,
      averageCtr: totalImpressions > 0 ? (totalClicks / totalImpressions * 100) : (accountImpressions > 0 ? (accountClicks / accountImpressions * 100) : 0),
      averageCpc: totalClicks > 0 ? totalSpend / totalClicks : (accountClicks > 0 ? accountSpend / accountClicks : 0),
      costPerPurchase: (accountPurchases || totalPurchases) > 0 ? (totalSpend || accountSpend) / (totalPurchases || accountPurchases) : 0
    }
  };

  if (onProgress) onProgress({ phase: 'save', pullId });
  await savePull(pullData);

  cleanupOldPulls().catch(() => {});

  console.log(`[Bonario] Data pull completed: ${pullId}`);
  return pullData;
}

// ── background refresh entrypoint ─────────────────────────────
export async function forceRefresh(dateRange, onProgress) {
  const state = pullState.get();
  if (state.isPulling) {
    return { status: 'already_running', pullId: state.lastPullId };
  }

  await pullState.update({
    isPulling: true,
    lastPullError: null,
    startedAt: new Date().toISOString(),
    pid: process.pid
  });

  console.log('[Bonario] Starting background pull...');

  fetchAllData(dateRange, onProgress)
    .then(async (result) => {
      await pullState.update({
        isPulling: false,
        lastPullId: result.pullId,
        lastPullTimestamp: result.timestamp,
        lastPullError: null
      });
      console.log(`[Bonario] Background pull completed: ${result.pullId}`);
    })
    .catch(async (error) => {
      await pullState.update({
        isPulling: false,
        lastPullError: error.message
      });
      console.error('[Bonario] Background pull failed:', error.message);
    });

  return { status: 'started' };
}

export function getPullState() {
  return pullState.get();
}

export async function getCampaigns() {
  return await getCampaignsFromLatest();
}

export async function getCampaignById(campaignId) {
  const campaigns = await getCampaigns();
  return campaigns.find(c => c.id === campaignId) || null;
}

export async function getInsights(since, until) {
  return await getInsightsFromLatest(since, until);
}

pullState.init().catch(err => console.warn('[Bonario] pullState init:', err.message));

export default {
  fetchAllData,
  forceRefresh,
  getCampaigns,
  getCampaignById,
  getInsights,
  getPullState
};