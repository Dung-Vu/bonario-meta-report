/**
 * rate-limiter.js
 *
 * Tracks Meta Graph API rate-limit headers and proactively throttles
 * before we hit the hard ceiling. Meta returns usage percentages in:
 *   - X-App-Usage: { call_count, total_cputime, total_time }
 *   - X-Business-Use-Case-Usage: [{ type, call_count, total_cputime,
 *                                   total_time, estimated_time_to_regain_access }]
 *
 * We pause outgoing calls when any metric exceeds SOFT_LIMIT_PCT, then
 * sleep for the greater of (1) cooldown suggested by Meta and (2) the
 * time needed for that axis to drop back below HARD_LIMIT_PCT.
 *
 * Reference: https://developers.facebook.com/docs/graph-api/overview/rate-limiting
 */

const SOFT_LIMIT_PCT = 80;   // start slowing at 80%
const HARD_LIMIT_PCT = 95;   // hard pause at 95%
const MAX_COOLDOWN_MS = 5 * 60 * 1000; // never sleep longer than 5 min per call

// Sliding-window counters — used as a fallback when headers are absent.
const callLog = []; // [{ ts }]
const WINDOW_MS = 60 * 60 * 1000; // 1 hour
const MAX_CALLS_PER_HOUR_DEFAULT = 400; // safe ceiling below Marketing standard tier

let lastUsageSnapshot = null;

export function recordApiCall() {
  callLog.push({ ts: Date.now() });
  pruneCallLog();
}

function pruneCallLog() {
  const cutoff = Date.now() - WINDOW_MS;
  while (callLog.length && callLog[0].ts < cutoff) {
    callLog.shift();
  }
}

export function getCallsInLastHour() {
  pruneCallLog();
  return callLog.length;
}

export function getMaxCallsPerHour() {
  return MAX_CALLS_PER_HOUR_DEFAULT;
}

/**
 * Update internal state from response headers and return the highest usage
 * percentage seen across all tracked axes.
 */
export function updateFromHeaders(headers = {}) {
  const snapshot = {
    app: null,
    buc: [],
    capturedAt: Date.now()
  };

  // ── X-App-Usage ─────────────────────────────────────────────
  const appHeader = headers['x-app-usage'];
  if (appHeader) {
    try {
      snapshot.app = typeof appHeader === 'string'
        ? JSON.parse(appHeader)
        : appHeader;
    } catch {
      snapshot.app = parseFlat(appHeader);
    }
  }

  // ── X-Business-Use-Case-Usage ───────────────────────────────
  const bucHeader = headers['x-business-use-case-usage'];
  if (bucHeader) {
    try {
      const parsed = typeof bucHeader === 'string'
        ? JSON.parse(bucHeader)
        : bucHeader;
      snapshot.buc = Object.values(parsed).flat();
    } catch {
      snapshot.buc = [];
    }
  }

  lastUsageSnapshot = snapshot;
  return snapshot;
}

function parseFlat(str) {
  const obj = {};
  for (const part of String(str).split(',')) {
    const [k, v] = part.split('=');
    if (k && v != null) obj[k.trim()] = parseFloat(v);
  }
  return obj;
}

/**
 * Return the highest usage percentage across app + BUC axes (0-100).
 */
export function getMaxUsagePct() {
  if (!lastUsageSnapshot) return 0;
  let max = 0;
  if (lastUsageSnapshot.app) {
    const a = lastUsageSnapshot.app;
    max = Math.max(max, a.call_count || 0, a.total_cputime || 0, a.total_time || 0);
  }
  for (const entry of lastUsageSnapshot.buc || []) {
    max = Math.max(max, entry.call_count || 0, entry.total_cputime || 0, entry.total_time || 0);
  }
  return max;
}

/**
 * Return minutes Meta estimates we should wait before regaining access.
 */
export function getRegainMinutes() {
  if (!lastUsageSnapshot) return 0;
  let max = 0;
  for (const entry of lastUsageSnapshot.buc || []) {
    const m = parseInt(entry.estimated_time_to_regain_access) || 0;
    if (m > max) max = m;
  }
  return max;
}

export function getUsageSnapshot() {
  return {
    callsInLastHour: getCallsInLastHour(),
    maxCallsPerHour: getMaxCallsPerHour(),
    maxUsagePct: getMaxUsagePct(),
    regainMinutes: getRegainMinutes(),
    appUsage: lastUsageSnapshot?.app || null,
    bucUsage: lastUsageSnapshot?.buc || []
  };
}

/**
 * Wait until we're below the soft usage ceiling. Returns the actual sleep
 * duration so callers can log it.
 */
export async function waitForSafeUsage() {
  const usage = getMaxUsagePct();
  const regainMin = getRegainMinutes();

  if (usage < SOFT_LIMIT_PCT && getCallsInLastHour() < getMaxCallsPerHour()) {
    return 0;
  }

  const regainMs = regainMin * 60 * 1000;
  const overageMs = Math.max(0, usage - SOFT_LIMIT_PCT) * 1500;
  const sleepMs = Math.min(MAX_COOLDOWN_MS, Math.max(regainMs, overageMs));

  if (sleepMs > 0) {
    console.warn(`[Bonario][rate-limit] usage=${usage.toFixed(1)}% calls/h=${getCallsInLastHour()} — sleeping ${(sleepMs / 1000).toFixed(1)}s`);
    await new Promise(r => setTimeout(r, sleepMs));
  }
  return sleepMs;
}

/**
 * Combined pre-call gate: waits if needed, then records the call.
 */
export async function beforeCall() {
  await waitForSafeUsage();
  recordApiCall();
}

/**
 * Decide whether a thrown Meta error is a retryable rate-limit signal.
 * Covers both platform (codes 4/17/32/429/613) and Business-Use-Case
 * (80000/80004/80003/80002/80005/80006/80014/80009) throttles.
 */
export function isRateLimitError(err) {
  const data = err?.response?.data?.error;
  if (!data) return false;
  const code = data.code;
  const subcode = data.error_subcode;
  const status = err?.response?.status;

  if (code === 4 || code === 17 || code === 32 || code === 429 || code === 613) return true;
  if (subcode === 2446079) return true;
  if (status === 429) return true;

  if (code === 80000 || code === 80004 || code === 80003 ||
      code === 80002 || code === 80005 || code === 80006 ||
      code === 80014 || code === 80009 || code === 80008 || code === 80001) {
    return true;
  }

  return false;
}

export function isServerError(err) {
  const s = err?.response?.status;
  return s >= 500 && s < 600;
}

export const RATE_LIMIT_CONFIG = {
  SOFT_LIMIT_PCT,
  HARD_LIMIT_PCT,
  MAX_COOLDOWN_MS,
  WINDOW_MS,
  MAX_CALLS_PER_HOUR_DEFAULT
};

export default {
  recordApiCall,
  getCallsInLastHour,
  getMaxCallsPerHour,
  updateFromHeaders,
  getMaxUsagePct,
  getRegainMinutes,
  getUsageSnapshot,
  waitForSafeUsage,
  beforeCall,
  isRateLimitError,
  isServerError,
  RATE_LIMIT_CONFIG
};