function getCssVar(name, fallback) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

import { getCurrency } from './utils.js';

const colors = {
  primary: () => getCssVar('--bonario-blue', '#0064E0'),
  primaryLight: () => getCssVar('--bonario-blue-light', '#47A5FA'),
  white: () => getCssVar('--white', '#FFFFFF'),
  muted: () => getCssVar('--text-secondary', '#5D6C7B')
};

Chart.defaults.font.family = "'Inter', system-ui, -apple-system, sans-serif";
Chart.defaults.color = 'rgba(255,255,255,0.55)';

let spendChartInstance = null;
let comparisonChartInstance = null;

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

export function initSpendTrendChart(canvasId, history, insights) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  if (spendChartInstance) {
    spendChartInstance.destroy();
  }

  const locale = chartLocale();
  const currency = getCurrency();
  const sortedHistory = [...(history || [])].reverse();
  const labels = sortedHistory.map(item => {
    const timestamp = new Date(item.timestamp);
    return timestamp.toLocaleDateString(locale, { day: '2-digit', month: '2-digit' });
  });
  const spendData = sortedHistory.map(item => item.summary?.totalSpend || 0);

  if (labels.length === 0) {
    labels.push('Latest');
    spendData.push(insights?.totalSpend || insights?.summary?.totalSpend || 0);
  }

  const context = canvas.getContext('2d');
  const gradient = context.createLinearGradient(0, 0, 0, 320);
  gradient.addColorStop(0, 'rgba(71, 165, 250, 0.38)');
  gradient.addColorStop(1, 'rgba(71, 165, 250, 0.02)');

  spendChartInstance = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Total Spend',
        data: spendData,
        borderColor: colors.primaryLight(),
        backgroundColor: gradient,
        fill: true,
        tension: 0.35,
        borderWidth: 2.5,
        pointRadius: 4,
        pointHoverRadius: 6,
        pointBackgroundColor: colors.primary(),
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
          titleFont: { size: 13, weight: '600' },
          bodyFont: { size: 12 },
          padding: 12,
          cornerRadius: 8,
          displayColors: false,
          callbacks: {
            label: context => `${context.parsed.y.toLocaleString(locale)} ${currency}`
          }
        }
      },
      scales: {
        x: {
          grid: { display: false, drawBorder: false },
          ticks: { color: 'rgba(255, 255, 255, 0.72)', font: { size: 11 } }
        },
        y: {
          beginAtZero: true,
          grid: { color: 'rgba(255, 255, 255, 0.12)', drawBorder: false },
          ticks: {
            color: 'rgba(255, 255, 255, 0.72)',
            font: { size: 11 },
            callback: value => formatAxisCurrency(value)
          }
        }
      }
    }
  });

  return spendChartInstance;
}

export function initCampaignComparisonChart(canvasId, campaigns) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  if (comparisonChartInstance) {
    comparisonChartInstance.destroy();
  }

  const topCampaigns = [...(campaigns || [])]
    .sort((a, b) => (b.insights?.spend || 0) - (a.insights?.spend || 0))
    .slice(0, 5);

  const locale = chartLocale();
  const currency = getCurrency();
  const labels = topCampaigns.map(campaign => {
    const name = campaign.name || '';
    return name.length > 24 ? `${name.slice(0, 22)}...` : name;
  });
  const spendData = topCampaigns.map(campaign => campaign.insights?.spend || 0);

  comparisonChartInstance = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Spend',
        data: spendData,
        backgroundColor: [
          'rgba(71, 165, 250, 0.95)',
          'rgba(49, 162, 76, 0.85)',
          'rgba(247, 185, 40, 0.85)',
          'rgba(214, 49, 31, 0.78)',
          'rgba(255, 255, 255, 0.42)'
        ],
        borderRadius: 8,
        borderSkipped: false,
        barPercentage: 0.72,
        categoryPercentage: 0.72
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
          titleFont: { size: 13, weight: '600' },
          bodyFont: { size: 12 },
          padding: 12,
          cornerRadius: 8,
          callbacks: {
            label(context) {
              const campaign = topCampaigns[context.dataIndex];
              const ctr = campaign?.insights?.ctr || 0;
              const clicks = campaign?.insights?.clicks || 0;
              return [
                `${context.parsed.x.toLocaleString(locale)} ${currency}`,
                `CTR ${ctr.toFixed(2)}%`,
                `${clicks.toLocaleString(locale)} clicks`
              ];
            }
          }
        }
      },
      scales: {
        x: {
          grid: { color: 'rgba(255, 255, 255, 0.1)', drawBorder: false },
          ticks: {
            color: 'rgba(255, 255, 255, 0.72)',
            font: { size: 10 },
            callback: value => formatAxisCurrency(value)
          }
        },
        y: {
          grid: { display: false, drawBorder: false },
          ticks: { color: 'rgba(255, 255, 255, 0.72)', font: { size: 11 } }
        }
      }
    }
  });

  return comparisonChartInstance;
}

const _chartInstances = new Map();

function getChartInstance(canvasId) {
  return _chartInstances.get(canvasId) || null;
}
function setChartInstance(canvasId, instance) {
  const existing = _chartInstances.get(canvasId);
  if (existing) existing.destroy();
  _chartInstances.set(canvasId, instance);
}

function formatObjective(obj) {
  const map = {
    OUTCOME_SALES: 'Sales',
    OUTCOME_LEADS: 'Leads',
    OUTCOME_AWARENESS: 'Awareness',
    OUTCOME_ENGAGEMENT: 'Engagement',
    OUTCOME_TRAFFIC: 'Traffic',
    OUTCOME_APP_INSTALLS: 'App Installs',
    VISITS: 'Visits',
    REACH: 'Reach'
  };
  return map[obj] || obj;
}

let objectiveChartInstance = null;
let statusChartInstance = null;
let scatterChartInstance = null;
let actionsChartInstance = null;

const chartPalette = [
  '#4a9eff',
  '#34b87b',
  '#f5a623',
  '#e05555',
  '#a78bfa',
  '#f97316',
  '#22d3ee',
  '#f472b6'
];

function buildObjectiveLabels(campaigns) {
  const map = new Map();
  for (const c of campaigns) {
    const obj = c.objective || 'UNKNOWN';
    map.set(obj, (map.get(obj) || 0) + (c.insights?.spend || 0));
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

function buildStatusLabels(campaigns) {
  const map = new Map();
  for (const c of campaigns) {
    const s = c.status || 'UNKNOWN';
    map.set(s, (map.get(s) || 0) + (c.insights?.spend || 0));
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

function buildScatterData(campaigns) {
  return campaigns
    .filter(c => (c.insights?.impressions || 0) > 0)
    .map(c => {
      const i = c.insights;
      const ctr = (i.clicks / i.impressions * 100) || 0;
      const cpc = i.clicks > 0 ? i.spend / i.clicks : 0;
      return {
        x: parseFloat(ctr.toFixed(3)),
        y: parseFloat(cpc.toFixed(2)),
        r: Math.max(Math.sqrt(i.spend) / 40, 3),
        label: c.name || 'Unknown'
      };
    });
}

function buildActionsData(campaigns) {
  const map = new Map();
  for (const c of campaigns) {
    const actions = c.insights?.actions || [];
    for (const a of actions) {
      const actionType = a.action_type || 'unknown';
      if (actionType === 'link_click' || actionType === 'offsite_conversion' || actionType === 'like') {
        const short = actionType === 'link_click' ? 'Link Clicks'
          : actionType === 'like' ? 'Page Likes'
          : a.action_type;
        map.set(short, (map.get(short) || 0) + (a.value || 0));
      }
    }
  }
  const sorted = [...map.entries()].sort((a, b) => b[1] - a[1]);
  return sorted.slice(0, 6);
}

export function initObjectiveDonut(canvasId, campaigns) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const data = buildObjectiveLabels(campaigns);
  if (data.length === 0) return;

  const locale = chartLocale();
  const currency = getCurrency();
  const instance = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: data.map(d => formatObjective(d[0])),
      datasets: [{
        data: data.map(d => d[1]),
        backgroundColor: chartPalette.slice(0, data.length),
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
  objectiveChartInstance = instance;
  return instance;
}

export function initStatusDonut(canvasId, campaigns) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const data = buildStatusLabels(campaigns);
  if (data.length === 0) return;

  const locale = chartLocale();
  const currency = getCurrency();
  const statusInstance = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: data.map(d => d[0]),
      datasets: [{
        data: data.map(d => d[1]),
        backgroundColor: ['#007d1e', '#f7b928', '#c80a28', '#65676b'].slice(0, data.length),
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
  statusChartInstance = statusInstance;
  return statusInstance;
}

export function initScatterChart(canvasId, campaigns) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const points = buildScatterData(campaigns);
  if (points.length === 0) return;

  const locale = chartLocale();
  const currency = getCurrency();
  const scatterInst = new Chart(canvas, {
    type: 'bubble',
    data: {
      datasets: [{
        label: 'Campaigns',
        data: points,
        backgroundColor: 'rgba(74, 158, 255, 0.4)',
        borderColor: 'rgba(74, 158, 255, 0.7)',
        borderWidth: 1.5,
        hoverRadius: 8
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
            title(items) {
              const pt = items[0]?.raw;
              return pt?.label || '';
            },
            label: ctx => [
              `CTR: ${ctx.parsed.x}%`,
              `CPC: ${ctx.parsed.y.toLocaleString(locale)} ${currency}`,
              `Spend: bubble size`
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
          ticks: { color: 'rgba(255,255,255,0.6)', font: { size: 10 },
            callback: v => formatAxisCurrency(v) }
        }
      }
    }
  });
  scatterChartInstance = scatterInst;
  return scatterInst;
}

export function initActionsChart(canvasId, campaigns) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const data = buildActionsData(campaigns);
  if (data.length === 0) {
    // Fallback: show total conversions as a single bar
    let totalConversions = 0;
    for (const c of campaigns) totalConversions += c.insights?.conversions || 0;
    if (totalConversions === 0) return;
    const fallbackInst = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: ['Conversions'],
        datasets: [{ data: [totalConversions], backgroundColor: '#4a9eff', borderRadius: 8, barPercentage: 0.4 }]
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
    actionsChartInstance = fallbackInst;
    return;
  }

  const actionsInst = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: data.map(d => d[0]),
      datasets: [{
        data: data.map(d => d[1]),
        backgroundColor: chartPalette.slice(0, data.length),
        borderRadius: 8,
        barPercentage: 0.6
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(15, 23, 29, 0.95)',
          padding: 12,
          cornerRadius: 8,
          callbacks: {
            label: ctx => ` ${ctx.parsed.x.toLocaleString(chartLocale())}`
          }
        }
      },
      scales: {
        x: {
          grid: { color: 'rgba(255,255,255,0.08)' },
          ticks: { color: 'rgba(255,255,255,0.6)', font: { size: 10 },
            callback: v => v >= 1000 ? (v / 1000).toFixed(1) + 'K' : v }
        },
        y: {
          grid: { display: false },
          ticks: { color: 'rgba(255,255,255,0.72)', font: { size: 11 } }
        }
      }
    }
  });
  actionsChartInstance = actionsInst;
}

let msgDailyChartInstance = null;
let msgWeeklyChartInstance = null;

function groupByWeek(accountDaily) {
  const weeks = {};
  for (const d of accountDaily) {
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

export function initMsgDailyChart(canvasId, accountDaily) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || !accountDaily || accountDaily.length === 0) return;

  if (msgDailyChartInstance) msgDailyChartInstance.destroy();

  const locale = chartLocale();
  const sorted = [...accountDaily].sort((a, b) => a.date.localeCompare(b.date));
  const labels = sorted.map(d => {
    const date = new Date(d.date);
    return date.toLocaleDateString(locale, { day: '2-digit', month: '2-digit' });
  });
  const totalData = sorted.map(d => d.totalMsgContacts || 0);
  const newData = sorted.map(d => d.newMsgContacts || 0);

  msgDailyChartInstance = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Total Msg Contacts',
          data: totalData,
          borderColor: '#4a9eff',
          backgroundColor: 'rgba(74,158,255,0.1)',
          fill: true,
          tension: 0.3,
          borderWidth: 2,
          pointRadius: 2
        },
        {
          label: 'New Msg Contacts',
          data: newData,
          borderColor: '#34b87b',
          backgroundColor: 'rgba(52,184,123,0.1)',
          fill: true,
          tension: 0.3,
          borderWidth: 2,
          pointRadius: 2
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          labels: { color: 'rgba(255,255,255,0.6)', font: { size: 11 }, usePointStyle: true, boxWidth: 8 }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: 'rgba(255,255,255,0.55)', font: { size: 10 }, maxTicksLimit: 15 }
        },
        y: {
          beginAtZero: true,
          grid: { color: 'rgba(255,255,255,0.08)' },
          ticks: { color: 'rgba(255,255,255,0.55)', font: { size: 10 } }
        }
      }
    }
  });
}

export function initMsgWeeklyChart(canvasId, accountDaily) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || !accountDaily || accountDaily.length === 0) return;

  if (msgWeeklyChartInstance) msgWeeklyChartInstance.destroy();

  const locale = chartLocale();
  const weeks = groupByWeek(accountDaily);
  const labels = weeks.map(w => {
    const d = new Date(w.week);
    return d.toLocaleDateString(locale, { day: '2-digit', month: '2-digit' });
  });

  msgWeeklyChartInstance = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Total Msg Contacts',
          data: weeks.map(w => w.totalMsg),
          backgroundColor: 'rgba(74,158,255,0.7)',
          borderRadius: 6
        },
        {
          label: 'New Msg Contacts',
          data: weeks.map(w => w.newMsg),
          backgroundColor: 'rgba(52,184,123,0.7)',
          borderRadius: 6
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          labels: { color: 'rgba(255,255,255,0.6)', font: { size: 11 }, usePointStyle: true, boxWidth: 8 }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: 'rgba(255,255,255,0.55)', font: { size: 10 } }
        },
        y: {
          beginAtZero: true,
          grid: { color: 'rgba(255,255,255,0.08)' },
          ticks: { color: 'rgba(255,255,255,0.55)', font: { size: 10 } }
        }
      }
    }
  });
}

export function updateCharts(campaigns, insights, history, accountDaily) {
  if (objectiveChartInstance) { objectiveChartInstance.destroy(); objectiveChartInstance = null; }
  if (statusChartInstance) { statusChartInstance.destroy(); statusChartInstance = null; }
  if (scatterChartInstance) { scatterChartInstance.destroy(); scatterChartInstance = null; }
  if (actionsChartInstance) { actionsChartInstance.destroy(); actionsChartInstance = null; }
  if (msgDailyChartInstance) { msgDailyChartInstance.destroy(); msgDailyChartInstance = null; }
  if (msgWeeklyChartInstance) { msgWeeklyChartInstance.destroy(); msgWeeklyChartInstance = null; }

  initSpendTrendChart('spendTrendChart', history, insights);
  initCampaignComparisonChart('campaignComparisonChart', campaigns);
  initObjectiveDonut('objectiveChart', campaigns);
  initStatusDonut('statusChart', campaigns);
  initScatterChart('scatterChart', campaigns);
  initActionsChart('actionsChart', campaigns);
  initMsgDailyChart('msgDailyChart', accountDaily);
  initMsgWeeklyChart('msgWeeklyChart', accountDaily);
}

export default {
  initSpendTrendChart,
  initCampaignComparisonChart,
  initObjectiveDonut,
  initStatusDonut,
  initScatterChart,
  initActionsChart,
  initMsgDailyChart,
  initMsgWeeklyChart,
  updateCharts
};
