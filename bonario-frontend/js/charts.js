function getCssVar(name, fallback) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

import { getCurrency, formatNumber } from './utils.js';

const colors = {
  primary: () => getCssVar('--bonario-blue', '#0064E0'),
  primaryLight: () => getCssVar('--bonario-blue-light', '#47A5FA'),
  white: () => getCssVar('--white', '#FFFFFF'),
  muted: () => getCssVar('--text-secondary', '#5D6C7B'),
  bonAccent: '#5998ea',
  ordAccent: '#aa64c8'
};

Chart.defaults.font.family = "'Inter', system-ui, -apple-system, sans-serif";
Chart.defaults.color = 'rgba(255,255,255,0.55)';

// One Chart.js instance per canvasId. Multiple canvases per chart type
// (e.g. `bonSpendTrendChart` + `ordSpendTrendChart`) coexist.
const chartInstances = new Map();
function getOrCreate(canvasId) {
  const existing = chartInstances.get(canvasId);
  if (existing) {
    existing.destroy();
    chartInstances.delete(canvasId);
  }
  const canvas = document.getElementById(canvasId);
  if (!canvas) return null;
  return canvas;
}

function chartLocale() {
  const cur = getCurrency();
  if (cur === 'VND') return 'vi-VN';
  if (cur === 'JPY') return 'ja-JP';
  return 'en-US';
}

function formatAxisCurrency(value) {
  if (value >= 1000000000) return `${(value / 1000000000).toFixed(1)}B`;
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(0)}K`;
  return `${value}`;
}

function makeGradient(canvas, r, g, b) {
  const ctx = canvas.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, 320);
  grad.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0.38)`);
  grad.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0.02)`);
  return grad;
}

// ── Trend (per campaign history) ────────────────────────────────────────────
//
// We don't have a per-campaign daily breakdown in the snapshot, only
// history-level totals. Per-company trend therefore aggregates the latest
// pull's spend-over-time for that company by re-fetching history filtered
// by company. For snapshot pulls, we approximate the trend from the
// daily_insights array on each campaign by summing across the company's
// campaigns.
function buildPerCompanyDailySeries(campaigns) {
  // Each campaign.daily_insights = [{date, ...per-stage}]
  // Sum per-date across campaigns to get a company-level series.
  const byDate = new Map();
  for (const c of campaigns || []) {
    const rows = c.daily_insights || [];
    for (const row of rows) {
      const day = row.date;
      if (!byDate.has(day)) {
        byDate.set(day, { date: day, spend: 0, impressions: 0, reach: 0, clicks: 0, purchases: 0 });
      }
      const bucket = byDate.get(day);
      bucket.spend += row.spend || 0;
      bucket.impressions += row.impressions || 0;
      bucket.reach += row.reach || 0;
      bucket.clicks += row.clicks || 0;
      bucket.purchases += row.purchases || 0;
    }
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function renderSpendTrendFor(canvasId, campaigns, accentRgb) {
  const canvas = getOrCreate(canvasId);
  if (!canvas) return;

  const series = buildPerCompanyDailySeries(campaigns);
  const locale = chartLocale();
  const currency = getCurrency();
  const labels = series.map(s => {
    const d = new Date(s.date);
    return d.toLocaleDateString(locale, { day: '2-digit', month: '2-digit' });
  });
  const data = series.map(s => s.spend);
  if (labels.length === 0) {
    labels.push('—');
    data.push(0);
  }

  const [r, g, b] = accentRgb;
  const accent = `rgb(${r}, ${g}, ${b})`;
  const accentLight = `rgba(${r}, ${g}, ${b}, 0.7)`;

  const instance = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Total Spend',
        data,
        borderColor: accentLight,
        backgroundColor: makeGradient(canvas, r, g, b),
        fill: true,
        tension: 0.35,
        borderWidth: 2.5,
        pointRadius: 3,
        pointHoverRadius: 5,
        pointBackgroundColor: accent,
        pointBorderColor: colors.white(),
        pointBorderWidth: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(15, 23, 29, 0.95)',
          padding: 12,
          cornerRadius: 8,
          callbacks: {
            label: ctx => `${ctx.parsed.y.toLocaleString(locale)} ${currency}`
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: 'rgba(255, 255, 255, 0.72)', font: { size: 10 }, maxTicksLimit: 12 }
        },
        y: {
          beginAtZero: true,
          grid: { color: 'rgba(255, 255, 255, 0.1)' },
          ticks: {
            color: 'rgba(255, 255, 255, 0.72)',
            font: { size: 10 },
            callback: v => formatAxisCurrency(v)
          }
        }
      }
    }
  });
  chartInstances.set(canvasId, instance);
}

// ── Top Campaigns (horizontal bar) ──────────────────────────────────────────
export function renderTopCampaignsChart(canvasId, campaigns, accentRgb) {
  const canvas = getOrCreate(canvasId);
  if (!canvas) return;

  const top = [...(campaigns || [])]
    .sort((a, b) => (b.insights?.spend || 0) - (a.insights?.spend || 0))
    .slice(0, 5);

  const locale = chartLocale();
  const currency = getCurrency();
  const labels = top.map(c => {
    const n = c.name || '';
    return n.length > 24 ? `${n.slice(0, 22)}…` : n;
  });
  const data = top.map(c => c.insights?.spend || 0);

  const [r, g, b] = accentRgb;
  const accent = `rgb(${r}, ${g}, ${b})`;

  const instance = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Spend',
        data,
        backgroundColor: accent,
        borderRadius: 6,
        borderSkipped: false,
        barPercentage: 0.7,
        categoryPercentage: 0.85
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(15, 23, 29, 0.95)',
          padding: 12,
          cornerRadius: 8,
          callbacks: {
            label(ctx) {
              const c = top[ctx.dataIndex];
              const ctr = c?.insights?.ctr || 0;
              return [
                `${ctx.parsed.x.toLocaleString(locale)} ${currency}`,
                `CTR ${ctr.toFixed(2)}%`
              ];
            }
          }
        }
      },
      scales: {
        x: {
          grid: { color: 'rgba(255, 255, 255, 0.1)' },
          ticks: {
            color: 'rgba(255, 255, 255, 0.72)',
            font: { size: 10 },
            callback: v => formatAxisCurrency(v)
          }
        },
        y: {
          grid: { display: false },
          ticks: { color: 'rgba(255, 255, 255, 0.72)', font: { size: 10 } }
        }
      }
    }
  });
  chartInstances.set(canvasId, instance);
}

// ── Donut: Spend by Objective ───────────────────────────────────────────────
const objectiveMap = {
  OUTCOME_SALES: 'Sales', OUTCOME_LEADS: 'Leads', OUTCOME_AWARENESS: 'Awareness',
  OUTCOME_ENGAGEMENT: 'Engagement', OUTCOME_TRAFFIC: 'Traffic', OUTCOME_APP_INSTALLS: 'App Installs',
  VISITS: 'Visits', REACH: 'Reach'
};
function formatObjective(obj) {
  return objectiveMap[obj] || obj || 'Unknown';
}
function buildObjectiveLabels(campaigns) {
  const map = new Map();
  for (const c of campaigns || []) {
    const obj = c.objective || 'UNKNOWN';
    map.set(obj, (map.get(obj) || 0) + (c.insights?.spend || 0));
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

export function renderObjectiveDonutFor(canvasId, campaigns, accentRgb) {
  const canvas = getOrCreate(canvasId);
  if (!canvas) return;
  const data = buildObjectiveLabels(campaigns);
  if (data.length === 0) return;

  const locale = chartLocale();
  const currency = getCurrency();
  const palette = ['#4a9eff', '#34b87b', '#f5a623', '#e05555', '#a78bfa', '#f97316', '#22d3ee', '#f472b6'];
  const instance = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: data.map(d => formatObjective(d[0])),
      datasets: [{
        data: data.map(d => d[1]),
        backgroundColor: palette.slice(0, data.length),
        borderColor: '#1b1938',
        borderWidth: 3,
        hoverOffset: 8
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '60%',
      plugins: {
        legend: {
          position: 'right',
          labels: { color: 'rgba(255,255,255,0.6)', font: { size: 11, weight: '540' }, padding: 10, boxWidth: 10, usePointStyle: true, pointStyleWidth: 10 }
        },
        tooltip: {
          backgroundColor: 'rgba(15, 23, 29, 0.95)',
          padding: 12,
          cornerRadius: 8,
          callbacks: {
            label: ctx => ` ${ctx.parsed.toLocaleString(locale)} ${currency}`
          }
        }
      }
    }
  });
  chartInstances.set(canvasId, instance);
}

// ── Donut: Spend by Status ──────────────────────────────────────────────────
function buildStatusLabels(campaigns) {
  const map = new Map();
  for (const c of campaigns || []) {
    const s = c.status || 'UNKNOWN';
    map.set(s, (map.get(s) || 0) + (c.insights?.spend || 0));
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

export function renderStatusDonutFor(canvasId, campaigns) {
  const canvas = getOrCreate(canvasId);
  if (!canvas) return;
  const data = buildStatusLabels(campaigns);
  if (data.length === 0) return;

  const locale = chartLocale();
  const currency = getCurrency();
  const palette = ['#007d1e', '#f7b928', '#c80a28', '#65676b'];
  const instance = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: data.map(d => d[0]),
      datasets: [{
        data: data.map(d => d[1]),
        backgroundColor: palette.slice(0, data.length),
        borderColor: '#1b1938',
        borderWidth: 3,
        hoverOffset: 8
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '60%',
      plugins: {
        legend: {
          position: 'right',
          labels: { color: 'rgba(255,255,255,0.6)', font: { size: 11, weight: '540' }, padding: 10, boxWidth: 10, usePointStyle: true, pointStyleWidth: 10 }
        },
        tooltip: {
          backgroundColor: 'rgba(15, 23, 29, 0.95)',
          padding: 12,
          cornerRadius: 8,
          callbacks: {
            label: ctx => ` ${ctx.parsed.toLocaleString(locale)} ${currency}`
          }
        }
      }
    }
  });
  chartInstances.set(canvasId, instance);
}

// ── Bubble: CTR vs CPC ──────────────────────────────────────────────────────
function buildScatterData(campaigns) {
  return (campaigns || [])
    .filter(c => (c.insights?.impressions || 0) > 0)
    .map(c => {
      const i = c.insights;
      const ctr = (i.clicks / i.impressions * 100) || 0;
      const cpc = i.clicks > 0 ? i.spend / i.clicks : 0;
      return {
        x: parseFloat(ctr.toFixed(3)),
        y: parseFloat(cpc.toFixed(2)),
        r: Math.max(Math.sqrt(i.spend || 0) / 40, 3),
        label: c.name || 'Unknown'
      };
    });
}

export function renderScatterFor(canvasId, campaigns, accentRgb) {
  const canvas = getOrCreate(canvasId);
  if (!canvas) return;
  const points = buildScatterData(campaigns);
  if (points.length === 0) return;

  const locale = chartLocale();
  const currency = getCurrency();
  const [r, g, b] = accentRgb;
  const instance = new Chart(canvas, {
    type: 'bubble',
    data: {
      datasets: [{
        label: 'Campaigns',
        data: points,
        backgroundColor: `rgba(${r}, ${g}, ${b}, 0.4)`,
        borderColor: `rgba(${r}, ${g}, ${b}, 0.8)`,
        borderWidth: 1.5
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(15, 23, 29, 0.95)',
          padding: 12,
          cornerRadius: 8,
          callbacks: {
            title: (items) => items[0]?.raw?.label || '',
            label: ctx => [
              `CTR: ${ctx.parsed.x}%`,
              `CPC: ${ctx.parsed.y.toLocaleString(locale)} ${currency}`
            ]
          }
        }
      },
      scales: {
        x: {
          title: { display: true, text: 'CTR (%)', color: 'rgba(255,255,255,0.6)' },
          grid: { color: 'rgba(255,255,255,0.08)' },
          ticks: { color: 'rgba(255,255,255,0.6)', font: { size: 10 } }
        },
        y: {
          title: { display: true, text: `CPC (${currency})`, color: 'rgba(255,255,255,0.6)' },
          grid: { color: 'rgba(255,255,255,0.08)' },
          ticks: {
            color: 'rgba(255,255,255,0.6)', font: { size: 10 },
            callback: v => formatAxisCurrency(v)
          }
        }
      }
    }
  });
  chartInstances.set(canvasId, instance);
}

// ── Top by CTR (bar) ────────────────────────────────────────────────────────
export function renderTopCtrChart(canvasId, campaigns, accentRgb) {
  const canvas = getOrCreate(canvasId);
  if (!canvas) return;

  const top = [...(campaigns || [])]
    .filter(c => (c.insights?.impressions || 0) > 0)
    .map(c => {
      const i = c.insights;
      const ctr = (i.clicks / i.impressions * 100) || 0;
      return { name: c.name, ctr, spend: i.spend || 0 };
    })
    .sort((a, b) => b.ctr - a.ctr)
    .slice(0, 5);

  if (top.length === 0) return;

  const labels = top.map(c => c.name.length > 22 ? `${c.name.slice(0, 20)}…` : c.name);
  const [r, g, b] = accentRgb;

  const instance = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'CTR %',
        data: top.map(c => parseFloat(c.ctr.toFixed(2))),
        backgroundColor: `rgba(${r}, ${g}, ${b}, 0.85)`,
        borderRadius: 6,
        barPercentage: 0.7,
        categoryPercentage: 0.85
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { backgroundColor: 'rgba(15, 23, 29, 0.95)', padding: 12, cornerRadius: 8 }
      },
      scales: {
        x: {
          grid: { color: 'rgba(255, 255, 255, 0.1)' },
          ticks: { color: 'rgba(255, 255, 255, 0.72)', font: { size: 10 }, callback: v => v.toFixed(1) + '%' }
        },
        y: {
          grid: { display: false },
          ticks: { color: 'rgba(255, 255, 255, 0.72)', font: { size: 10 } }
        }
      }
    }
  });
  chartInstances.set(canvasId, instance);
}

// ── Account-level: Msg Daily / Weekly / Actions ────────────────────────────
function groupByWeek(accountDaily) {
  const weeks = {};
  for (const d of accountDaily || []) {
    const date = new Date(d.date);
    const dayOfWeek = date.getDay();
    const monday = new Date(date);
    monday.setDate(date.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
    const weekKey = monday.toISOString().split('T')[0];
    if (!weeks[weekKey]) weeks[weekKey] = { totalMsg: 0, newMsg: 0 };
    weeks[weekKey].totalMsg += d.totalMsgContacts || 0;
    weeks[weekKey].newMsg += d.newMsgContacts || 0;
  }
  return Object.keys(weeks).sort().map(k => ({ week: k, ...weeks[k] }));
}

export function renderMsgDailyChart(canvasId, accountDaily) {
  const canvas = getOrCreate(canvasId);
  if (!canvas) return;

  const locale = chartLocale();
  const sorted = [...(accountDaily || [])].sort((a, b) => a.date.localeCompare(b.date));
  const labels = sorted.map(d => {
    const date = new Date(d.date);
    return date.toLocaleDateString(locale, { day: '2-digit', month: '2-digit' });
  });
  const totalData = sorted.map(d => d.totalMsgContacts || 0);
  const newData = sorted.map(d => d.newMsgContacts || 0);

  const instance = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Total Msg Contacts', data: totalData, borderColor: '#4a9eff', backgroundColor: 'rgba(74,158,255,0.1)', fill: true, tension: 0.3, borderWidth: 2, pointRadius: 2 },
        { label: 'New Msg Contacts', data: newData, borderColor: '#34b87b', backgroundColor: 'rgba(52,184,123,0.1)', fill: true, tension: 0.3, borderWidth: 2, pointRadius: 2 }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { labels: { color: 'rgba(255,255,255,0.6)', font: { size: 11 }, usePointStyle: true, boxWidth: 8 } }
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: 'rgba(255,255,255,0.55)', font: { size: 10 }, maxTicksLimit: 15 } },
        y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.08)' }, ticks: { color: 'rgba(255,255,255,0.55)', font: { size: 10 } } }
      }
    }
  });
  chartInstances.set(canvasId, instance);
}

export function renderMsgWeeklyChart(canvasId, accountDaily) {
  const canvas = getOrCreate(canvasId);
  if (!canvas) return;

  const locale = chartLocale();
  const weeks = groupByWeek(accountDaily);
  const labels = weeks.map(w => {
    const d = new Date(w.week);
    return d.toLocaleDateString(locale, { day: '2-digit', month: '2-digit' });
  });
  const instance = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Total Msg Contacts', data: weeks.map(w => w.totalMsg), backgroundColor: 'rgba(74,158,255,0.7)', borderRadius: 6 },
        { label: 'New Msg Contacts', data: weeks.map(w => w.newMsg), backgroundColor: 'rgba(52,184,123,0.7)', borderRadius: 6 }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { labels: { color: 'rgba(255,255,255,0.6)', font: { size: 11 }, usePointStyle: true, boxWidth: 8 } }
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: 'rgba(255,255,255,0.55)', font: { size: 10 } } },
        y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.08)' }, ticks: { color: 'rgba(255,255,255,0.55)', font: { size: 10 } } }
      }
    }
  });
  chartInstances.set(canvasId, instance);
}

function buildActionsData(campaigns) {
  const map = new Map();
  for (const c of campaigns || []) {
    const actions = c.insights?.actions || [];
    for (const a of actions) {
      const actionType = a.action_type || 'unknown';
      if (actionType === 'link_click' || actionType === 'offsite_conversion' || actionType === 'like') {
        const short = actionType === 'link_click' ? 'Link Clicks'
          : actionType === 'like' ? 'Page Likes' : 'Offsite Conv.';
        map.set(short, (map.get(short) || 0) + (a.value || 0));
      }
    }
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
}

export function renderActionsChart(canvasId, campaigns) {
  const canvas = getOrCreate(canvasId);
  if (!canvas) return;
  const data = buildActionsData(campaigns);
  if (data.length === 0) return;
  const instance = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: data.map(d => d[0]),
      datasets: [{
        data: data.map(d => d[1]),
        backgroundColor: ['#4a9eff', '#34b87b', '#f5a623', '#e05555', '#a78bfa', '#22d3ee'].slice(0, data.length),
        borderRadius: 6,
        barPercentage: 0.6
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { color: 'rgba(255,255,255,0.08)' }, ticks: { color: 'rgba(255,255,255,0.6)', font: { size: 10 } } },
        y: { grid: { display: false }, ticks: { color: 'rgba(255,255,255,0.72)', font: { size: 11 } } }
      }
    }
  });
  chartInstances.set(canvasId, instance);
}

// ── Top-level dispatcher (used by app.js render()) ──────────────────────────
const BON_RGB = [89, 152, 234];
const ORD_RGB = [170, 100, 200];

export function renderCompanySections({ bonCampaigns, ordCampaigns, accountDaily }) {
  renderSpendTrendFor('bonSpendTrendChart', bonCampaigns, BON_RGB);
  renderTopCampaignsChart('bonTopCampaignsChart', bonCampaigns, BON_RGB);
  renderObjectiveDonutFor('bonObjectiveChart', bonCampaigns, BON_RGB);
  renderStatusDonutFor('bonStatusChart', bonCampaigns);
  renderScatterFor('bonScatterChart', bonCampaigns, BON_RGB);
  renderTopCtrChart('bonTopCtrChart', bonCampaigns, BON_RGB);

  renderSpendTrendFor('ordSpendTrendChart', ordCampaigns, ORD_RGB);
  renderTopCampaignsChart('ordTopCampaignsChart', ordCampaigns, ORD_RGB);
  renderObjectiveDonutFor('ordObjectiveChart', ordCampaigns, ORD_RGB);
  renderStatusDonutFor('ordStatusChart', ordCampaigns);
  renderScatterFor('ordScatterChart', ordCampaigns, ORD_RGB);
  renderTopCtrChart('ordTopCtrChart', ordCampaigns, ORD_RGB);

  renderMsgDailyChart('msgDailyChart', accountDaily);
  renderMsgWeeklyChart('msgWeeklyChart', accountDaily);
  renderActionsChart('actionsChart', accountDaily);  // actions split can't derive; account-level
}

export default {
  renderCompanySections,
  renderSpendTrendFor, renderTopCampaignsChart, renderObjectiveDonutFor,
  renderStatusDonutFor, renderScatterFor, renderTopCtrChart,
  renderMsgDailyChart, renderMsgWeeklyChart, renderActionsChart
};
