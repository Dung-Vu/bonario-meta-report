/**
 * odoo-crm.js
 *
 * Odoo CRM funnel queries via JSON-RPC (Odoo's HTTP-friendly variant of XML-RPC
 * — same wire protocol but Content-Type: application/json, which pairs nicely
 * with axios). Pulls 4 funnel stages × 2 companies (Bon + Ord) and writes
 * atomic snapshots under bonario-output/odoo/.
 *
 * Funnel domain logic mirrors the spreadsheet pivots 9-11, 14-16 in
 * /Users/jeremy/Downloads/Funnel New BON - ORD.osheet (11).json. CRM user
 * team IDs are hard-coded from the same source — review when sales team
 * membership changes.
 *
 * Architecture (STORY-20260705-02): we evaluate stage membership locally after
 * a single search_read per company because Odoo 19's read_group rejects
 * __count as an aggregate field. This also produces a daily breakdown that
 * lets the frontend slice by date range without re-hitting Odoo on every
 * filter change.
 *
 * Auth: ODOO_PROD_USERNAME + ODOO_PROD_API_KEY (env). Read-only access to
 * crm.lead via the user's XML-RPC API key.
 */

import axios from 'axios';
import path from 'path';
import { fileURLToPath } from 'url';
import { atomicWriteJSON } from './atomic-write.js';
import { createPullStateStore } from './pull-state.js';
import { saveOdooPull } from './storage.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getJsonRpcUrl() {
  const url = process.env.ODOO_URL || 'https://bonario-vietnam.odoo.com';
  return `${url.replace(/\/$/, '')}/jsonrpc`;
}

// Minimum interval between RPC calls — Odoo XML-RPC has no usage headers,
// so we self-throttle to stay friendly with their backend.
const MIN_API_INTERVAL = 500;
const MAX_RETRIES = 3;
const RETRY_BACKOFF_MS = 1500;

let lastApiCallTime = 0;

// ── Credentials (lazy, with TTL cache) ──────────────────────────────────────
let credsCache = null;
function loadCreds() {
  if (credsCache) return credsCache;
  const db = process.env.ODOO_DB || 'bonario-vietnam';
  const userIdStr = process.env.ODOO_USER_ID;
  const apiKey = process.env.ODOO_API_KEY;

  if (!userIdStr || !apiKey) {
    throw new Error('ODOO_USER_ID and ODOO_API_KEY must be set in .env');
  }

  const uid = parseInt(userIdStr, 10);
  if (isNaN(uid)) {
    throw new Error('ODOO_USER_ID must be a valid number');
  }

  credsCache = { uid, db, apiKey };
  return credsCache;
}

// ── Throttling ──────────────────────────────────────────────────────────────
async function throttle() {
  const now = Date.now();
  const elapsed = now - lastApiCallTime;
  if (elapsed < MIN_API_INTERVAL) {
    await new Promise(r => setTimeout(r, MIN_API_INTERVAL - elapsed));
  }
  lastApiCallTime = Date.now();
}

// ── JSON-RPC transport ──────────────────────────────────────────────────────
async function jsonRpcCall(service, method, args, kwargs = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      await throttle();
      const res = await axios.post(getJsonRpcUrl(), {
        jsonrpc: '2.0',
        method: 'call',
        params: { service, method, args, ...(Object.keys(kwargs).length ? { kwargs } : {}) },
        id: Date.now() + Math.random()
      }, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 30000
      });

      if (res.data?.error) {
        const e = res.data.error;
        throw new Error(`Odoo JSON-RPC error: ${e.message || JSON.stringify(e)}`);
      }
      return res.data.result;
    } catch (error) {
      lastErr = error;
      const status = error.response?.status;
      const retriable = status === 429 || (status >= 500 && status < 600);
      if (retriable && attempt < MAX_RETRIES) {
        const wait = Math.pow(2, attempt) * RETRY_BACKOFF_MS;
        console.warn(`[Bonario][odoo] ${method} attempt ${attempt + 1} failed (${status}) — retry in ${wait}ms`);
        await new Promise(r => setTimeout(r, wait));
        continue;
      }
      throw error;
    }
  }
  throw lastErr;
}

// ── Connection (authenticate bypassed via local credentials) ────────────────
let authCache = null;
async function authenticate(force = false) {
  if (authCache && !force) return authCache;
  const { db, uid, apiKey } = loadCreds();
  authCache = { uid, db, apiKey };
  return authCache;
}

export function clearAuthCache() {
  authCache = null;
}

// ── Generic execute_kw ──────────────────────────────────────────────────────
async function executeKw(model, method, args, kwargs = {}) {
  const { uid, db, apiKey } = await authenticate();
  return await jsonRpcCall('object', 'execute_kw', [db, uid, apiKey, model, method, args, kwargs]);
}

// ── Funnel constants ────────────────────────────────────────────────────────

export const COMPANIES = {
  bon: {
    id: 'bon',
    label: 'Bonario',
    userIds: [246,238,117,57,234,218,245,21,19,229,252,148,128,61,282,259]
  },
  ord: {
    id: 'ord',
    label: 'Ordinaire',
    userIds: [192,247,232,174,184,51,55,185,116,180,143,230,211,162,50,26,239,240,241]
  }
};

const LEAD_FIELDS = [
  'id', 'create_date',
  'x_studio_l_do_khng_cho_st',
  'x_studio_partner_type',
  'x_studio_phn_loi_cng_trnh_1',
  'tag_ids',
  'date_deadline',
  'expected_revenue'
];

// ── Local stage evaluation ──────────────────────────────────────────────────
// Mirrors pivots 9-11, 14-16 domain logic. All pivots share
// `type='opportunity' + user_id IN team` plus auto-exclusion. MQL adds three
// "is set" checks; SQL further requires deadline + positive revenue.

function isEmpty(val) {
  // Odoo returns false for empty many2one/selection/char/datetime fields,
  // and [] for empty many2many.
  return val === false || val === null || val === undefined || val === '' ||
         (Array.isArray(val) && val.length === 0);
}

export function evaluateStages(lead) {
  const isAuto = lead.x_studio_l_do_khng_cho_st === 'Chỉ bấm câu hỏi tự động';
  const hasPartnerType = !isEmpty(lead.x_studio_partner_type);
  const hasPhanLoai = !isEmpty(lead.x_studio_phn_loi_cng_trnh_1);
  const hasTags = !isEmpty(lead.tag_ids);
  const hasDeadline = !isEmpty(lead.date_deadline);
  const hasRevenue = (Number(lead.expected_revenue) || 0) > 0;

  return {
    totalLeadsCrm: true,
    totalLeadsExclAuto: !isAuto,
    mqlCount: !isAuto && hasPartnerType && hasPhanLoai && hasTags,
    sqlCount: !isAuto && hasPartnerType && hasPhanLoai && hasTags && hasDeadline && hasRevenue
  };
}

export function bucketLeadsByDay(leads) {
  // Output: { 'YYYY-MM-DD': { totalLeadsCrm, totalLeadsExclAuto, mqlCount, sqlCount } }
  const daily = {};
  for (const lead of leads) {
    const day = (lead.create_date || '').slice(0, 10);
    if (!day) continue;
    const stages = evaluateStages(lead);
    if (!daily[day]) {
      daily[day] = { totalLeadsCrm: 0, totalLeadsExclAuto: 0, mqlCount: 0, sqlCount: 0 };
    }
    for (const [stage, hit] of Object.entries(stages)) {
      if (hit) daily[day][stage]++;
    }
  }
  return daily;
}

export function aggregateDailyInRange(daily, since, until) {
  const out = { totalLeadsCrm: 0, totalLeadsExclAuto: 0, mqlCount: 0, sqlCount: 0 };
  if (!daily) return out;
  for (const [date, counts] of Object.entries(daily)) {
    if (since && date < since) continue;
    if (until && date > until) continue;
    for (const k of Object.keys(out)) out[k] += counts[k] || 0;
  }
  return out;
}

function totalsFromDaily(daily) {
  return aggregateDailyInRange(daily, null, null);
}

// ── Fetch leads for one company ──────────────────────────────────────────────
async function fetchCompanyLeads(company, { since, until } = {}) {
  const domain = ['&', ['type', '=', 'opportunity'], ['user_id', 'in', company.userIds]];
  if (since) domain.push(['create_date', '>=', `${since} 00:00:00`]);
  if (until) domain.push(['create_date', '<=', `${until} 23:59:59`]);

  const result = await executeKw('crm.lead', 'search_read', [domain, LEAD_FIELDS], { limit: 5000 });
  return Array.isArray(result) ? result : [];
}

// ── Fetch single company funnel (with daily breakdown) ──────────────────────
async function fetchFunnelForCompany(company, opts) {
  const leads = await fetchCompanyLeads(company, opts);
  const daily = bucketLeadsByDay(leads);
  const totals = totalsFromDaily(daily);
  return {
    company: company.id,
    label: company.label,
    daily,
    totals
  };
}

// ── Fetch both companies ────────────────────────────────────────────────────
export async function fetchAllFunnels({ since, until } = {}) {
  const bon = await fetchFunnelForCompany(COMPANIES.bon, { since, until });
  const ord = await fetchFunnelForCompany(COMPANIES.ord, { since, until });
  return {
    fetchedAt: new Date().toISOString(),
    dateRange: { since: since || null, until: until || null },
    companies: { bon, ord }
  };
}

// ── Pull state store ─────────────────────────────────────────────────────────
const ODOO_DATA_DIR = path.join(__dirname, '../../bonario-output/odoo');
const odooPullState = createPullStateStore(ODOO_DATA_DIR, '.odoo.lock');
odooPullState.init().catch(err => console.warn('[Bonario][odoo] pullState init:', err.message));

// ── Background refresh entrypoint (mirrors meta-ads.forceRefresh) ───────────
export async function forceFunnelRefresh({ since, until } = {}) {
  const state = odooPullState.get();
  if (state.isPulling) {
    return { status: 'already_running', pullId: state.lastPullId };
  }

  await odooPullState.update({
    isPulling: true,
    lastPullError: null,
    startedAt: new Date().toISOString(),
    pid: process.pid
  });

  console.log(`[Bonario][odoo] Starting background funnel pull${since ? ` since=${since}` : ''}${until ? ` until=${until}` : ''}...`);

  fetchAllFunnels({ since, until })
    .then(async (result) => {
      const pullId = `funnel_${new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 15)}`;
      await saveOdooPull({ pullId, ...result });
      await odooPullState.update({
        isPulling: false,
        lastPullId: pullId,
        lastPullTimestamp: result.fetchedAt,
        lastPullError: null
      });
      console.log(`[Bonario][odoo] Background pull completed: ${pullId}`);
    })
    .catch(async (error) => {
      await odooPullState.update({
        isPulling: false,
        lastPullError: error.message
      });
      console.error('[Bonario][odoo] Background pull failed:', error.message);
    });

  return { status: 'started' };
}

export function getOdooPullState() {
  return odooPullState.get();
}

// Expose helpers for testing / introspection
export const __test = {
  COMPANIES,
  evaluateStages,
  bucketLeadsByDay,
  aggregateDailyInRange,
  get JSONRPC_URL() { return getJsonRpcUrl(); }
};

export default {
  COMPANIES,
  fetchAllFunnels,
  fetchFunnelForCompany,
  forceFunnelRefresh,
  getOdooPullState,
  clearAuthCache
};