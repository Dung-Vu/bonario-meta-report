import { describe, it, expect } from 'vitest';
import { applyFilters, expandToAds, sortAds, sortCampaigns } from '../filters.js';

const sampleCampaigns = [
  {
    id: 'c1',
    name: 'Spring Sale',
    status: 'ACTIVE',
    objective: 'OUTCOME_SALES',
    daily_budget: 100000,
    adSets: [
      { id: 'as1', name: 'AdSet A', daily_budget: 50000 },
      { id: 'as2', name: 'AdSet B', daily_budget: 75000 }
    ],
    ads: [
      { id: 'ad1', name: 'Ad One', status: 'ACTIVE', adset_id: 'as1' },
      { id: 'ad2', name: 'Ad Two', status: 'PAUSED', adset_id: 'as2' }
    ],
    insights: { spend: 5000, impressions: 100000, clicks: 500 }
  },
  {
    id: 'c2',
    name: 'Brand Awareness',
    status: 'PAUSED',
    objective: 'OUTCOME_AWARENESS',
    adSets: [
      { id: 'as3', name: 'AdSet C', daily_budget: 200000 }
    ],
    ads: [
      { id: 'ad3', name: 'Ad Three', status: 'PAUSED', adset_id: 'as3' }
    ],
    insights: { spend: 12000, impressions: 250000, clicks: 800 }
  },
  {
    id: 'c3',
    name: 'Holiday Push',
    status: 'ACTIVE',
    objective: 'OUTCOME_SALES',
    adSets: [],
    ads: [],
    insights: { spend: 0, impressions: 0, clicks: 0 }
  }
];

describe('applyFilters: status', () => {
  it('filters by status ACTIVE', () => {
    const out = applyFilters(sampleCampaigns, { status: 'ACTIVE', campaigns: [] });
    expect(out.map(c => c.id)).toEqual(['c1', 'c3']);
  });
  it('filters by status PAUSED', () => {
    const out = applyFilters(sampleCampaigns, { status: 'PAUSED', campaigns: [] });
    expect(out.map(c => c.id)).toEqual(['c2']);
  });
  it('returns all when status is empty', () => {
    const out = applyFilters(sampleCampaigns, { status: '', campaigns: [] });
    expect(out).toHaveLength(3);
  });
});

describe('applyFilters: campaign id', () => {
  it('keeps only specified campaign', () => {
    const out = applyFilters(sampleCampaigns, { campaigns: ['c2'] });
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('c2');
  });
  it('returns all when campaigns empty', () => {
    const out = applyFilters(sampleCampaigns, { campaigns: [] });
    expect(out).toHaveLength(3);
  });
});

describe('applyFilters: objective', () => {
  it('filters by objective', () => {
    const out = applyFilters(sampleCampaigns, { objective: 'OUTCOME_AWARENESS', campaigns: [] });
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('c2');
  });
});

describe('applyFilters: adSet', () => {
  it('keeps campaigns that contain the ad set', () => {
    const out = applyFilters(sampleCampaigns, { adSet: 'as3', campaigns: [] });
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('c2');
  });
  it('drops campaigns that do not contain the ad set', () => {
    const out = applyFilters(sampleCampaigns, { adSet: 'as1', campaigns: [] });
    expect(out.map(c => c.id)).toEqual(['c1']);
  });
});

describe('applyFilters: budget range', () => {
  it('filters by min budget', () => {
    const out = applyFilters(sampleCampaigns, { budgetMin: 60000, campaigns: [] });
    expect(out.map(c => c.id)).toEqual(['c1', 'c2']);
  });
  it('filters by max budget', () => {
    const out = applyFilters(sampleCampaigns, { budgetMax: 60000, campaigns: [] });
    expect(out.map(c => c.id)).toEqual(['c1']);
  });
  it('drops campaigns with no ad set budgets', () => {
    const out = applyFilters(sampleCampaigns, { budgetMin: 1, campaigns: [] });
    expect(out.find(c => c.id === 'c3')).toBeUndefined();
  });
});

describe('expandToAds', () => {
  it('expands campaigns into per-ad rows', () => {
    const rows = expandToAds(sampleCampaigns);
    expect(rows).toHaveLength(3);
    expect(rows[0].adId).toBe('ad1');
    expect(rows[1].adId).toBe('ad2');
  });

  it('links ad to its ad set via adset_id', () => {
    const rows = expandToAds(sampleCampaigns);
    const ad1 = rows.find(r => r.adId === 'ad1');
    expect(ad1.adSetId).toBe('as1');
    expect(ad1.adSetName).toBe('AdSet A');
    const ad2 = rows.find(r => r.adId === 'ad2');
    expect(ad2.adSetId).toBe('as2');
    expect(ad2.adSetName).toBe('AdSet B');
  });

  it('carries campaign metadata to each ad row', () => {
    const rows = expandToAds(sampleCampaigns);
    const ad1 = rows.find(r => r.adId === 'ad1');
    expect(ad1.campaignId).toBe('c1');
    expect(ad1.campaignName).toBe('Spring Sale');
    expect(ad1.campaignStatus).toBe('ACTIVE');
  });

  it('falls back to first ad set when ad.adset_id missing', () => {
    const data = [{
      id: 'c9',
      name: 'No Adset Id',
      status: 'ACTIVE',
      adSets: [{ id: 'asX', name: 'Only Set' }],
      ads: [{ id: 'ad9', name: 'Mystery', status: 'ACTIVE' }],
      insights: {}
    }];
    const rows = expandToAds(data);
    expect(rows[0].adSetId).toBe('asX');
    expect(rows[0].adSetName).toBe('Only Set');
  });

  it('handles empty input', () => {
    expect(expandToAds([])).toEqual([]);
    expect(expandToAds(null)).toEqual([]);
  });
});

describe('sortCampaigns', () => {
  it('sorts by spend descending', () => {
    const out = sortCampaigns(sampleCampaigns, 'spend', 'desc');
    expect(out[0].id).toBe('c2');
    expect(out[1].id).toBe('c1');
  });
  it('sorts by spend ascending', () => {
    const out = sortCampaigns(sampleCampaigns, 'spend', 'asc');
    expect(out[0].id).toBe('c3');
  });
  it('handles null input', () => {
    expect(sortCampaigns(null, 'spend', 'desc')).toEqual([]);
  });
});

describe('sortAds', () => {
  it('sorts ad rows by clicks descending', () => {
    const rows = expandToAds(sampleCampaigns);
    const out = sortAds(rows, 'clicks', 'desc');
    expect(out[0].adId).toBe('ad3');
  });
});