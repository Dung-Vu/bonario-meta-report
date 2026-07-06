function aggregateDaily(dailyRows, since, until) {
  if (!dailyRows || dailyRows.length === 0) return null;
  let s = 0, imps = 0, r = 0, c = 0, p = 0, tmc = 0, nmc = 0;
  let count = 0;
  for (const d of dailyRows) {
    if (since && d.date < since) continue;
    if (until && d.date > until) continue;
    s += d.spend;
    imps += d.impressions;
    r += d.reach;
    c += d.clicks;
    p += d.purchases || 0;
    tmc += d.totalMsgContacts || 0;
    nmc += d.newMsgContacts || 0;
    count++;
  }
  if (count === 0) return null;
  return {
    spend: s,
    impressions: imps,
    reach: r,
    clicks: c,
    purchases: p,
    totalMsgContacts: tmc,
    newMsgContacts: nmc,
    ctr: imps > 0 ? (c / imps * 100) : 0,
    cpc: c > 0 ? s / c : 0,
    frequency: r > 0 ? imps / r : 0,
    conversions: p,
    costPerConversion: p > 0 ? s / p : 0
  };
}

export function applyFilters(campaigns, activeFilters) {
  if (!campaigns) return [];

  const hasDateFilter = activeFilters.since || activeFilters.until;

  const filtered = campaigns.filter(campaign => {
    if (activeFilters.status && campaign.status !== activeFilters.status) return false;
    if (activeFilters.objective && campaign.objective !== activeFilters.objective) return false;
    if (activeFilters.campaigns && activeFilters.campaigns.length > 0) {
      if (!activeFilters.campaigns.includes(campaign.id)) return false;
    }
    if (activeFilters.adSet) {
      const hasAdSet = (campaign.adSets || []).some(as_ => as_.id === activeFilters.adSet);
      if (!hasAdSet) return false;
    }
    if (activeFilters.budgetMin != null || activeFilters.budgetMax != null) {
      const budgets = (campaign.adSets || [])
        .map(as_ => as_.daily_budget || as_.lifetime_budget)
        .filter(Boolean);
      if (budgets.length === 0) return false;
      const hasInRange = budgets.some(b => {
        if (activeFilters.budgetMin != null && b < activeFilters.budgetMin) return false;
        if (activeFilters.budgetMax != null && b > activeFilters.budgetMax) return false;
        return true;
      });
      if (!hasInRange) return false;
    }
    return true;
  });

  if (!hasDateFilter) return filtered;

  return filtered.map(campaign => {
    if (!campaign.daily_insights || campaign.daily_insights.length === 0) {
      return campaign;
    }
    const dailyComputed = aggregateDaily(campaign.daily_insights, activeFilters.since, activeFilters.until);
    if (!dailyComputed) return null;
    return { ...campaign, insights: dailyComputed };
  }).filter(Boolean);
}

export function sortCampaigns(campaigns, sortBy, sortDirection) {
  if (!campaigns) return [];
  return [...campaigns].sort((a, b) => {
    const aVal = a.insights?.[sortBy] ?? 0;
    const bVal = b.insights?.[sortBy] ?? 0;
    return sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
  });
}

/**
 * Expand campaigns into ad-level rows. Uses ad.adset_id (the canonical
 * Meta field) to link each ad to its parent ad set.
 */
export function expandToAds(campaigns) {
  const rows = [];
  for (const campaign of campaigns || []) {
    const adSetsById = new Map();
    for (const as_ of campaign.adSets || []) {
      adSetsById.set(as_.id, as_);
    }
    for (const ad of campaign.ads || []) {
      let adSetName = '';
      let adSetId = ad.adset_id || '';
      if (adSetId && adSetsById.has(adSetId)) {
        adSetName = adSetsById.get(adSetId).name || '';
      } else if (campaign.adSets && campaign.adSets.length > 0) {
        adSetId = campaign.adSets[0].id;
        adSetName = campaign.adSets[0].name || '';
      }
      rows.push({
        adId: ad.id,
        adName: ad.name,
        adStatus: ad.status,
        campaignId: campaign.id,
        campaignName: campaign.name,
        campaignStatus: campaign.status,
        objective: campaign.objective,
        adSetId,
        adSetName,
        insights: campaign.insights || {}
      });
    }
  }
  return rows;
}

export function sortAds(ads, sortBy, sortDirection) {
  if (!ads) return [];
  return [...ads].sort((a, b) => {
    const aVal = a.insights?.[sortBy] ?? 0;
    const bVal = b.insights?.[sortBy] ?? 0;
    return sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
  });
}

export default { applyFilters, sortCampaigns, expandToAds, sortAds, aggregateDaily };