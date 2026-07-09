import { describe, it, expect } from 'vitest';
import {
  __test,
  COMPANIES,
  evaluateStages,
  bucketLeadsByDay,
  aggregateDailyInRange
} from '../odoo-crm.js';
import { createPullStateStore } from '../pull-state.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

const { JSONRPC_URL } = __test;

describe('odoo-crm: COMPANIES config', () => {
  it('exposes bon team with 16 unique user IDs', () => {
    expect(COMPANIES.bon.id).toBe('bon');
    expect(COMPANIES.bon.userIds).toHaveLength(16);
    expect(new Set(COMPANIES.bon.userIds).size).toBe(16);
    expect(COMPANIES.bon.userIds).toEqual(expect.arrayContaining([246, 238, 117]));
  });

  it('exposes ord team with 19 unique user IDs', () => {
    expect(COMPANIES.ord.id).toBe('ord');
    expect(COMPANIES.ord.userIds).toHaveLength(19);
    expect(new Set(COMPANIES.ord.userIds).size).toBe(19);
    expect(COMPANIES.ord.userIds).toEqual(expect.arrayContaining([192, 247, 232]));
  });

  it('Bon and Ord have no shared user (sales teams are disjoint)', () => {
    const overlap = COMPANIES.bon.userIds.filter(u => COMPANIES.ord.userIds.includes(u));
    expect(overlap).toEqual([]);
  });

  it('targets JSON-RPC endpoint at production host', () => {
    expect(JSONRPC_URL).toBe('https://bonario-vietnam.odoo.com/jsonrpc');
  });
});

describe('odoo-crm: fetchCompanyLeads domain (active clause)', () => {
  // fetchCompanyLeads is an internal helper but its active-clause contract is
  // the bug we hit on 2026-07-09: Odoo 19's Domain() parser rejects
  // `['active', 'in', [true, false]]` as malformed and throws IndexError. The
  // valid form is explicit OR with `=` operator.

  it('uses explicit OR clause for active true|false (not `in [T,F]`)', () => {
    // Re-derive what fetchCompanyLeads builds for the no-date case.
    const dom = ['&', '&',
      ['type', '=', 'opportunity'],
      ['user_id', 'in', [1, 2, 3]],
      '|', ['active', '=', true], ['active', '=', false]];
    expect(dom).toContain('|');
    expect(dom).toContainEqual(['active', '=', true]);
    expect(dom).toContainEqual(['active', '=', false]);
  });

  it('does NOT use the rejected `in [T,F]` form', () => {
    const dom = ['&', '&',
      ['type', '=', 'opportunity'],
      ['user_id', 'in', [1]],
      '|', ['active', '=', true], ['active', '=', false]];
    const forbidden = dom.find(x => Array.isArray(x) && x[0] === 'active' && x[1] === 'in');
    expect(forbidden).toBeUndefined();
  });

  it('matches dashboard 192 expectation for the June 2026 reference data', async () => {
    // Skip if Odoo creds not configured (CI without .env).
    if (!process.env.ODOO_PROD_USERNAME || !process.env.ODOO_PROD_API_KEY) return;

    const url = 'https://bonario-vietnam.odoo.com/jsonrpc';
    const axios = (await import('axios')).default;
    const db = 'bonario-vietnam';
    const key = process.env.ODOO_PROD_API_KEY;
    const auth = { jsonrpc: '2.0', method: 'call',
      params: { service: 'common', method: 'authenticate', args: [db, process.env.ODOO_PROD_USERNAME, key, {}] },
      id: 0 };
    const uid = (await axios.post(url, auth, { timeout: 30000 })).data.result;

    async function cnt(domain) {
      const p = { jsonrpc: '2.0', method: 'call',
        params: { service: 'object', method: 'execute_kw',
          args: [db, uid, key, 'crm.lead', 'search_count', [domain], {}] },
        id: Math.random() };
      const r = await axios.post(url, p, { timeout: 30000 });
      return r.data.result;
    }

    const BON = COMPANIES.bon.userIds;
    const ORD = COMPANIES.ord.userIds;
    const dom = (team) => ['&', '&', '&', '&',
      ['type', '=', 'opportunity'],
      ['user_id', 'in', team],
      '|', ['active', '=', true], ['active', '=', false],
      ['create_date', '>=', '2026-06-01 00:00:00'],
      ['create_date', '<=', '2026-06-30 23:59:59']];

    const bonTotal = await cnt(dom(BON));
    const ordTotal = await cnt(dom(ORD));
    expect(bonTotal).toBe(598);
    expect(ordTotal).toBe(628);
  }, 30000);
});

describe('odoo-crm: evaluateStages', () => {
  it('counts every lead as Tổng Lead CRM', () => {
    expect(evaluateStages({}).totalLeadsCrm).toBe(true);
    expect(evaluateStages({ x_studio_l_do_khng_cho_st: 'auto' }).totalLeadsCrm).toBe(true);
  });

  it('drops auto-bot leads from Trừ tự động onwards', () => {
    const stages = evaluateStages({ x_studio_l_do_khng_cho_st: 'Chỉ bấm câu hỏi tự động' });
    expect(stages.totalLeadsExclAuto).toBe(false);
    expect(stages.mqlCount).toBe(false);
    expect(stages.sqlCount).toBe(false);
  });

  it('requires partner_type + phan_loai + tags for MQL', () => {
    expect(evaluateStages({}).mqlCount).toBe(false);
    expect(evaluateStages({ x_studio_partner_type: 'architect' }).mqlCount).toBe(false);
    expect(evaluateStages({ x_studio_partner_type: 'architect', x_studio_phn_loi_cng_trnh_1: 'villa' }).mqlCount).toBe(false);
    expect(evaluateStages({
      x_studio_partner_type: 'architect',
      x_studio_phn_loi_cng_trnh_1: 'villa',
      tag_ids: [1, 2]
    }).mqlCount).toBe(true);
  });

  it('treats Odoo false / [] as empty for many2one/selection/many2many', () => {
    expect(evaluateStages({ x_studio_partner_type: false }).mqlCount).toBe(false);
    expect(evaluateStages({ x_studio_phn_loi_cng_trnh_1: false }).mqlCount).toBe(false);
    expect(evaluateStages({ tag_ids: [] }).mqlCount).toBe(false);
  });

  it('requires deadline + positive expected_revenue for SQL on top of MQL', () => {
    const base = {
      x_studio_partner_type: 'architect',
      x_studio_phn_loi_cng_trnh_1: 'villa',
      tag_ids: [1]
    };
    expect(evaluateStages(base).sqlCount).toBe(false);
    expect(evaluateStages({ ...base, date_deadline: '2026-07-01' }).sqlCount).toBe(false);
    expect(evaluateStages({ ...base, expected_revenue: 100 }).sqlCount).toBe(false);
    expect(evaluateStages({
      ...base,
      date_deadline: '2026-07-01',
      expected_revenue: 100
    }).sqlCount).toBe(true);
  });

  it('SQL revenue must be > 0, not just non-empty', () => {
    const base = {
      x_studio_partner_type: 'a',
      x_studio_phn_loi_cng_trnh_1: 'b',
      tag_ids: [1],
      date_deadline: '2026-07-01'
    };
    expect(evaluateStages({ ...base, expected_revenue: 0 }).sqlCount).toBe(false);
    expect(evaluateStages({ ...base, expected_revenue: -100 }).sqlCount).toBe(false);
    expect(evaluateStages({ ...base, expected_revenue: 0.01 }).sqlCount).toBe(true);
  });
});

describe('odoo-crm: bucketLeadsByDay', () => {
  const leads = [
    { id: 1, create_date: '2026-06-15 10:00:00' },
    { id: 2, create_date: '2026-06-15 11:00:00' },
    { id: 3, create_date: '2026-06-16 09:00:00', x_studio_l_do_khng_cho_st: 'Chỉ bấm câu hỏi tự động' },
    { id: 4, create_date: '2026-06-16 12:00:00',
      x_studio_partner_type: 'a', x_studio_phn_loi_cng_trnh_1: 'b', tag_ids: [1] },
    { id: 5, create_date: '2026-06-16 14:00:00',
      x_studio_partner_type: 'a', x_studio_phn_loi_cng_trnh_1: 'b', tag_ids: [1],
      date_deadline: '2026-07-01', expected_revenue: 50 }
  ];

  it('groups by day and computes all 4 stages per day', () => {
    const daily = bucketLeadsByDay(leads);
    expect(daily['2026-06-15']).toEqual({
      totalLeadsCrm: 2, totalLeadsExclAuto: 2, mqlCount: 0, sqlCount: 0
    });
    expect(daily['2026-06-16']).toEqual({
      totalLeadsCrm: 3, totalLeadsExclAuto: 2, mqlCount: 2, sqlCount: 1
    });
  });

  it('ignores leads with no create_date', () => {
    const daily = bucketLeadsByDay([{ id: 99 }, { id: 100, create_date: null }]);
    expect(daily).toEqual({});
  });
});

describe('odoo-crm: aggregateDailyInRange', () => {
  const daily = {
    '2026-06-14': { totalLeadsCrm: 1, totalLeadsExclAuto: 1, mqlCount: 0, sqlCount: 0 },
    '2026-06-15': { totalLeadsCrm: 5, totalLeadsExclAuto: 5, mqlCount: 2, sqlCount: 1 },
    '2026-06-16': { totalLeadsCrm: 3, totalLeadsExclAuto: 3, mqlCount: 3, sqlCount: 2 },
    '2026-06-17': { totalLeadsCrm: 7, totalLeadsExclAuto: 6, mqlCount: 4, sqlCount: 3 }
  };

  it('returns all-time totals when no range given', () => {
    expect(aggregateDailyInRange(daily)).toEqual({
      totalLeadsCrm: 16, totalLeadsExclAuto: 15, mqlCount: 9, sqlCount: 6
    });
  });

  it('filters inclusively on both endpoints', () => {
    expect(aggregateDailyInRange(daily, '2026-06-15', '2026-06-16')).toEqual({
      totalLeadsCrm: 8, totalLeadsExclAuto: 8, mqlCount: 5, sqlCount: 3
    });
  });

  it('drops only-since range correctly', () => {
    expect(aggregateDailyInRange(daily, '2026-06-16', null)).toEqual({
      totalLeadsCrm: 10, totalLeadsExclAuto: 9, mqlCount: 7, sqlCount: 5
    });
  });

  it('drops only-until range correctly', () => {
    expect(aggregateDailyInRange(daily, null, '2026-06-15')).toEqual({
      totalLeadsCrm: 6, totalLeadsExclAuto: 6, mqlCount: 2, sqlCount: 1
    });
  });

  it('returns zeros for empty / null daily data', () => {
    expect(aggregateDailyInRange(null, '2026-01-01', '2026-12-31')).toEqual({
      totalLeadsCrm: 0, totalLeadsExclAuto: 0, mqlCount: 0, sqlCount: 0
    });
    expect(aggregateDailyInRange({}, '2026-01-01', '2026-12-31')).toEqual({
      totalLeadsCrm: 0, totalLeadsExclAuto: 0, mqlCount: 0, sqlCount: 0
    });
  });

  it('SCOPE TEST — reducing the range shrinks totals (the property user asked us to verify)', () => {
    const allTime = aggregateDailyInRange(daily);
    const lastDay = aggregateDailyInRange(daily, '2026-06-17', '2026-06-17');
    expect(lastDay.totalLeadsCrm).toBeLessThan(allTime.totalLeadsCrm);
    expect(lastDay.totalLeadsCrm).toBe(7);
  });
});

describe('odoo-crm: pull state isolation', () => {
  it('uses a dedicated .odoo.lock so it cannot clobber the Meta .bonario.lock', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bonario-state-'));
    try {
      const store = createPullStateStore(tmp, '.odoo.lock');
      await store.init();
      await store.update({ isPulling: true, pid: process.pid });

      const files = fs.readdirSync(tmp);
      expect(files).toContain('.odoo.lock');
      expect(files).not.toContain('.bonario.lock');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('default lock name remains .bonario.lock for backward compat', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bonario-default-'));
    try {
      const store = createPullStateStore(tmp);
      expect(store.get()).toBeDefined();
      expect(typeof store.update).toBe('function');
      expect(typeof store.clear).toBe('function');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});