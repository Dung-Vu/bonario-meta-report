import express from 'express';
import { getCampaigns, getCampaignById, getInsights, forceRefresh, getPullState } from '../services/meta-ads.js';
import { forceFunnelRefresh, getOdooPullState } from '../services/odoo-crm.js';
import {
  getHistory,
  getPullById,
  getLatestPull,
  getFilterOptions,
  invalidateFilterOptionsCache,
  getLatestOdooPull,
  getOdooHistory,
  getOdooPullById,
  getFunnelView
} from '../services/storage.js';
import { getUsageSnapshot } from '../services/rate-limiter.js';
import { requireRefreshSecret, ipRateLimit, getRefreshSecret } from '../middleware/auth.js';

const router = express.Router();

router.get('/status', async (req, res) => {
  try {
    const latestPull = await getLatestPull();
    res.json({
      status: 'connected',
      lastUpdated: latestPull?.timestamp || null,
      pullId: latestPull?.pullId || null,
      campaignCount: latestPull?.campaigns?.length || 0,
      dateRange: latestPull?.dateRange || null,
      currency: latestPull?.currency || 'USD',
      accountName: latestPull?.accountName || null,
      accountStatus: latestPull?.accountStatus || null,
      accountDaily: latestPull?.account_daily || null
    });
  } catch (error) {
    console.error('[Bonario] Status check error:', error);
    res.status(500).json({ error: 'Failed to get status' });
  }
});

router.get('/campaigns', async (req, res) => {
  try {
    const campaigns = await getCampaigns();
    res.json({ campaigns });
  } catch (error) {
    console.error('[Bonario] Get campaigns error:', error);
    res.status(500).json({ error: 'Failed to get campaigns' });
  }
});

router.get('/campaigns/:id', async (req, res) => {
  try {
    const campaign = await getCampaignById(req.params.id);
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }
    res.json({ campaign });
  } catch (error) {
    console.error('[Bonario] Get campaign error:', error);
    res.status(500).json({ error: 'Failed to get campaign' });
  }
});

router.get('/insights', async (req, res) => {
  try {
    const { since, until } = req.query;
    const insights = await getInsights(since, until);
    res.json({ insights });
  } catch (error) {
    console.error('[Bonario] Get insights error:', error);
    res.status(500).json({ error: 'Failed to get insights' });
  }
});

router.get('/history', async (req, res) => {
  try {
    const history = await getHistory();
    res.json({ history });
  } catch (error) {
    console.error('[Bonario] Get history error:', error);
    res.status(500).json({ error: 'Failed to get history' });
  }
});

router.get('/history/:pullId', async (req, res) => {
  try {
    const pull = await getPullById(req.params.pullId);
    if (!pull) {
      return res.status(404).json({ error: 'Pull not found' });
    }
    res.json({ pull });
  } catch (error) {
    console.error('[Bonario] Get pull error:', error);
    res.status(500).json({ error: 'Failed to get pull' });
  }
});

router.get('/filters/options', async (req, res) => {
  try {
    const opts = await getFilterOptions();
    res.json(opts);
  } catch (error) {
    console.error('[Bonario] Get filter options error:', error);
    res.status(500).json({ error: 'Failed to get filter options' });
  }
});

router.get('/rate-limit', async (req, res) => {
  res.json(getUsageSnapshot());
});

// ── Protected write endpoints ─────────────────────────────────
router.post('/refresh',
  ipRateLimit({ windowMs: 60_000, max: 5 }),
  requireRefreshSecret,
  async (req, res) => {
    try {
      const { since, until } = req.body || {};
      const dateRange = (since && until) ? { since, until } : undefined;
      console.log('[Bonario] Manual refresh triggered...', dateRange ? `for ${since} to ${until}` : 'with default range');

      invalidateFilterOptionsCache();

      const result = await forceRefresh(dateRange);
      res.json({
        success: true,
        message: result.status === 'started' ? 'Data refresh started — it may take a few minutes' : 'Data refresh is already running',
        status: result.status,
        pullId: result.pullId || null
      });
    } catch (error) {
      console.error('[Bonario] Force refresh error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to refresh data',
        message: error.message
      });
    }
  }
);

router.get('/refresh/status', (req, res) => {
  try {
    const state = getPullState();
    res.json({
      isPulling: state.isPulling,
      lastPullId: state.lastPullId,
      lastPullTimestamp: state.lastPullTimestamp,
      lastPullError: state.lastPullError,
      startedAt: state.startedAt
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get refresh status' });
  }
});

router.get('/auth/dev-secret', (req, res) => {
  if (process.env.BONARIO_REFRESH_SECRET) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.json({ secret: getRefreshSecret(), note: 'Dev only — set BONARIO_REFRESH_SECRET in production' });
});

// ── Odoo CRM funnel endpoints ───────────────────────────────────────────────

router.get('/funnel', async (req, res) => {
  try {
    const since = req.query.since || null;
    const until = req.query.until || null;
    if (since && !/^\d{4}-\d{2}-\d{2}$/.test(since)) {
      return res.status(400).json({ error: 'Invalid `since` format (expected YYYY-MM-DD)' });
    }
    if (until && !/^\d{4}-\d{2}-\d{2}$/.test(until)) {
      return res.status(400).json({ error: 'Invalid `until` format (expected YYYY-MM-DD)' });
    }
    if (since && until && since > until) {
      return res.status(400).json({ error: '`since` must be ≤ `until`' });
    }
    const view = await getFunnelView({ since, until });
    if (!view) return res.json({});
    res.json(view);
  } catch (error) {
    console.error('[Bonario] Get funnel error:', error);
    res.status(500).json({ error: 'Failed to get funnel data' });
  }
});

router.get('/funnel/history', async (req, res) => {
  try {
    const history = await getOdooHistory();
    res.json({ history });
  } catch (error) {
    console.error('[Bonario] Get funnel history error:', error);
    res.status(500).json({ error: 'Failed to get funnel history' });
  }
});

router.get('/funnel/history/:pullId', async (req, res) => {
  try {
    const pull = await getOdooPullById(req.params.pullId);
    if (!pull) return res.status(404).json({ error: 'Funnel pull not found' });
    res.json({ pull });
  } catch (error) {
    console.error('[Bonario] Get funnel pull error:', error);
    res.status(500).json({ error: 'Failed to get funnel pull' });
  }
});

router.post('/funnel/refresh',
  ipRateLimit({ windowMs: 60_000, max: 5 }),
  requireRefreshSecret,
  async (req, res) => {
    try {
      const since = req.body?.since || null;
      const until = req.body?.until || null;
      if (since && !/^\d{4}-\d{2}-\d{2}$/.test(since)) {
        return res.status(400).json({ error: 'Invalid `since` format (expected YYYY-MM-DD)' });
      }
      if (until && !/^\d{4}-\d{2}-\d{2}$/.test(until)) {
        return res.status(400).json({ error: 'Invalid `until` format (expected YYYY-MM-DD)' });
      }
      if (since && until && since > until) {
        return res.status(400).json({ error: '`since` must be ≤ `until`' });
      }
      console.log(`[Bonario] Odoo funnel refresh triggered${since ? ` since=${since}` : ''}${until ? ` until=${until}` : ''}...`);
      const result = await forceFunnelRefresh({ since, until });
      res.json({
        success: true,
        message: result.status === 'started'
          ? 'Funnel refresh started — usually completes in a few seconds'
          : 'Funnel refresh is already running',
        status: result.status,
        pullId: result.pullId || null
      });
    } catch (error) {
      console.error('[Bonario] Force funnel refresh error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to refresh funnel data',
        message: error.message
      });
    }
  }
);

router.get('/funnel/refresh/status', (req, res) => {
  try {
    const state = getOdooPullState();
    res.json({
      isPulling: state.isPulling,
      lastPullId: state.lastPullId,
      lastPullTimestamp: state.lastPullTimestamp,
      lastPullError: state.lastPullError,
      startedAt: state.startedAt
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get funnel refresh status' });
  }
});

export default router;