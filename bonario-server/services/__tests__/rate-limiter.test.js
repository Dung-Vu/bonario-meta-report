import { describe, it, expect, beforeEach } from 'vitest';
import {
  recordApiCall,
  getCallsInLastHour,
  getMaxCallsPerHour,
  updateFromHeaders,
  getMaxUsagePct,
  getRegainMinutes,
  isRateLimitError,
  isServerError,
  RATE_LIMIT_CONFIG
} from '../rate-limiter.js';

describe('rate-limiter: header parsing', () => {
  it('parses X-App-Usage JSON header', () => {
    const snap = updateFromHeaders({
      'x-app-usage': JSON.stringify({ call_count: 25, total_cputime: 12, total_time: 18 })
    });
    expect(snap.app).toEqual({ call_count: 25, total_cputime: 12, total_time: 18 });
  });

  it('parses X-App-Usage as object when already parsed', () => {
    const snap = updateFromHeaders({
      'x-app-usage': { call_count: 50, total_cputime: 0, total_time: 0 }
    });
    expect(snap.app.call_count).toBe(50);
  });

  it('parses X-Business-Use-Case-Usage JSON header', () => {
    const buc = {
      '12345': [
        { type: 'ads_management', call_count: 80, total_cputime: 10, total_time: 5, estimated_time_to_regain_access: 3 }
      ]
    };
    const snap = updateFromHeaders({ 'x-business-use-case-usage': buc });
    expect(snap.buc).toHaveLength(1);
    expect(snap.buc[0].call_count).toBe(80);
    expect(snap.buc[0].estimated_time_to_regain_access).toBe(3);
  });

  it('returns empty snapshot when headers missing', () => {
    const snap = updateFromHeaders({});
    expect(snap.app).toBeNull();
    expect(snap.buc).toEqual([]);
  });

  it('handles malformed JSON header without throwing', () => {
    const snap = updateFromHeaders({ 'x-app-usage': 'not json{{{' });
    // Falls through to parseFlat which yields an empty object (no `k=v` pairs)
    expect(snap.app).toEqual({});
  });
});

describe('rate-limiter: usage calculation', () => {
  beforeEach(() => {
    updateFromHeaders({});
  });

  it('returns 0 usage when no snapshot exists', () => {
    updateFromHeaders({});
    expect(getMaxUsagePct()).toBe(0);
  });

  it('returns max call_count from X-App-Usage', () => {
    updateFromHeaders({
      'x-app-usage': { call_count: 45, total_cputime: 20, total_time: 30 }
    });
    expect(getMaxUsagePct()).toBe(45);
  });

  it('returns max call_count from BUC entries', () => {
    updateFromHeaders({
      'x-business-use-case-usage': {
        a: [{ call_count: 35, total_cputime: 0, total_time: 0 }],
        b: [{ call_count: 88, total_cputime: 0, total_time: 0 }]
      }
    });
    expect(getMaxUsagePct()).toBe(88);
  });

  it('returns max across app + buc', () => {
    updateFromHeaders({
      'x-app-usage': { call_count: 60, total_cputime: 0, total_time: 0 },
      'x-business-use-case-usage': {
        a: [{ call_count: 92, total_cputime: 0, total_time: 0 }]
      }
    });
    expect(getMaxUsagePct()).toBe(92);
  });
});

describe('rate-limiter: regain minutes', () => {
  it('returns 0 with no snapshot', () => {
    updateFromHeaders({});
    expect(getRegainMinutes()).toBe(0);
  });

  it('returns the max estimated_time_to_regain_access across BUC', () => {
    updateFromHeaders({
      'x-business-use-case-usage': {
        a: [{ call_count: 0, total_cputime: 0, total_time: 0, estimated_time_to_regain_access: 5 }],
        b: [{ call_count: 0, total_cputime: 0, total_time: 0, estimated_time_to_regain_access: 12 }],
        c: [{ call_count: 0, total_cputime: 0, total_time: 0, estimated_time_to_regain_access: 3 }]
      }
    });
    expect(getRegainMinutes()).toBe(12);
  });
});

describe('rate-limiter: call log', () => {
  beforeEach(() => {
    updateFromHeaders({});
  });

  it('records calls and reports total in window', () => {
    const before = getCallsInLastHour();
    recordApiCall();
    recordApiCall();
    expect(getCallsInLastHour()).toBe(before + 2);
  });

  it('returns MAX_CALLS_PER_HOUR_DEFAULT', () => {
    expect(getMaxCallsPerHour()).toBe(400);
  });
});

describe('rate-limiter: error classification', () => {
  it('flags Meta platform code 4 (rate limit)', () => {
    expect(isRateLimitError({ response: { status: 400, data: { error: { code: 4 } } } })).toBe(true);
  });

  it('flags code 17', () => {
    expect(isRateLimitError({ response: { status: 400, data: { error: { code: 17 } } } })).toBe(true);
  });

  it('flags code 32 (BUC ad account limit)', () => {
    expect(isRateLimitError({ response: { status: 400, data: { error: { code: 32 } } } })).toBe(true);
  });

  it('flags code 429 (HTTP too many requests)', () => {
    expect(isRateLimitError({ response: { status: 429, data: { error: { code: 429 } } } })).toBe(true);
  });

  it('flags code 613 (rate limit reached)', () => {
    expect(isRateLimitError({ response: { status: 400, data: { error: { code: 613 } } } })).toBe(true);
  });

  it('flags BUC codes 80000/80001/80002/80003/80004/80005/80006/80008/80009/80014', () => {
    for (const code of [80000, 80001, 80002, 80003, 80004, 80005, 80006, 80008, 80009, 80014]) {
      expect(isRateLimitError({ response: { status: 400, data: { error: { code } } } })).toBe(true);
    }
  });

  it('flags subcode 2446079', () => {
    expect(isRateLimitError({
      response: { status: 400, data: { error: { code: 1, error_subcode: 2446079 } } }
    })).toBe(true);
  });

  it('does not flag unrelated errors', () => {
    expect(isRateLimitError({ response: { status: 400, data: { error: { code: 100 } } } })).toBe(false);
    expect(isRateLimitError({ response: { status: 200, data: {} } })).toBe(false);
    expect(isRateLimitError(new Error('network'))).toBe(false);
    expect(isRateLimitError(null)).toBe(false);
    expect(isRateLimitError(undefined)).toBe(false);
  });

  it('isServerError identifies 5xx', () => {
    expect(isServerError({ response: { status: 500 } })).toBe(true);
    expect(isServerError({ response: { status: 502 } })).toBe(true);
    expect(isServerError({ response: { status: 599 } })).toBe(true);
  });

  it('isServerError rejects non-5xx', () => {
    expect(isServerError({ response: { status: 400 } })).toBe(false);
    expect(isServerError({ response: { status: 404 } })).toBe(false);
    expect(isServerError({ response: { status: 429 } })).toBe(false);
    expect(isServerError(new Error('boom'))).toBe(false);
  });
});

describe('rate-limiter: config exports', () => {
  it('exposes sensible defaults', () => {
    expect(RATE_LIMIT_CONFIG.SOFT_LIMIT_PCT).toBe(80);
    expect(RATE_LIMIT_CONFIG.HARD_LIMIT_PCT).toBe(95);
    expect(RATE_LIMIT_CONFIG.MAX_COOLDOWN_MS).toBe(5 * 60 * 1000);
    expect(RATE_LIMIT_CONFIG.WINDOW_MS).toBe(60 * 60 * 1000);
    expect(RATE_LIMIT_CONFIG.MAX_CALLS_PER_HOUR_DEFAULT).toBe(400);
  });
});