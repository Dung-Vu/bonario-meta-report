const API_BASE = '/api';

let refreshSecret = null;

export function setRefreshSecret(s) {
  refreshSecret = s;
}

async function apiRequest(endpoint, options = {}) {
  const url = `${API_BASE}${endpoint}`;
  const config = {
    headers: {
      'Content-Type': 'application/json',
      ...(refreshSecret ? { 'x-bonario-secret': refreshSecret } : {}),
      ...options.headers
    },
    ...options
  };

  try {
    const response = await fetch(url, config);

    if (!response.ok) {
      let payload = null;
      try { payload = await response.json(); } catch {}
      const err = new Error(payload?.error || payload?.message || `HTTP ${response.status}`);
      err.status = response.status;
      err.payload = payload;
      throw err;
    }

    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      return await response.json();
    }
    return await response.text();
  } catch (error) {
    console.error(`[Bonario] API Error [${endpoint}]:`, error);
    throw error;
  }
}

export const api = {
  async getStatus() {
    return await apiRequest('/status');
  },

  async getCampaigns() {
    return await apiRequest('/campaigns');
  },

  async getCampaign(id) {
    return await apiRequest(`/campaigns/${id}`);
  },

  async getInsights(since, until) {
    const params = new URLSearchParams();
    if (since) params.append('since', since);
    if (until) params.append('until', until);
    const queryString = params.toString();
    return await apiRequest(`/insights${queryString ? '?' + queryString : ''}`);
  },

  async getHistory() {
    return await apiRequest('/history');
  },

  async getPull(pullId) {
    return await apiRequest(`/history/${pullId}`);
  },

  async getFilterOptions() {
    return await apiRequest('/filters/options');
  },

  async getRateLimit() {
    return await apiRequest('/rate-limit');
  },

  async getDevSecret() {
    try {
      return await apiRequest('/auth/dev-secret');
    } catch {
      return null;
    }
  },

  async forceRefresh(dateRange) {
    const options = { method: 'POST' };
    if (dateRange && dateRange.since && dateRange.until) {
      options.body = JSON.stringify(dateRange);
    }
    return await apiRequest('/refresh', options);
  },

  async getRefreshStatus() {
    return await apiRequest('/refresh/status');
  },

  async getFunnel({ since, until } = {}) {
    const params = new URLSearchParams();
    if (since) params.append('since', since);
    if (until) params.append('until', until);
    const qs = params.toString();
    return await apiRequest(`/funnel${qs ? '?' + qs : ''}`);
  },

  async getFunnelHistory() {
    return await apiRequest('/funnel/history');
  },

  async forceFunnelRefresh({ since, until } = {}) {
    const options = { method: 'POST' };
    if (since || until) {
      options.body = JSON.stringify({ since: since || null, until: until || null });
    }
    return await apiRequest('/funnel/refresh', options);
  },

  async getFunnelRefreshStatus() {
    return await apiRequest('/funnel/refresh/status');
  }
};

export default api;