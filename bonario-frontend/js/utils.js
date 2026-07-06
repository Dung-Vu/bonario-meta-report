// ── currency ───────────────────────────────────────────────────
// Currency code is loaded from /api/status (pull data). All formatters
// accept a currency code and use Intl.NumberFormat for correct localization.

let activeCurrency = 'USD';

export function setCurrency(code) {
  activeCurrency = (code || 'USD').toUpperCase();
}

export function getCurrency() {
  return activeCurrency;
}

const CURRENCY_LOCALE = {
  VND: 'vi-VN',
  USD: 'en-US',
  JPY: 'ja-JP',
  EUR: 'de-DE',
  GBP: 'en-GB',
  AUD: 'en-AU',
  SGD: 'en-SG',
  THB: 'th-TH',
  IDR: 'id-ID',
  PHP: 'en-PH',
  KRW: 'ko-KR'
};

function localeFor(code) {
  return CURRENCY_LOCALE[code] || 'en-US';
}

const ZERO_DECIMAL_CURRENCIES = new Set(['VND', 'JPY', 'KRW', 'IDR']);

function decimalsFor(code) {
  return ZERO_DECIMAL_CURRENCIES.has(code) ? 0 : 2;
}

export function formatNumber(num, decimals) {
  if (num === null || num === undefined || isNaN(num)) return '0';
  const d = decimals != null ? decimals : decimalsFor(activeCurrency);
  return Number(num).toLocaleString(localeFor(activeCurrency), {
    minimumFractionDigits: d,
    maximumFractionDigits: d
  });
}

export function formatCurrency(num) {
  if (num === null || num === undefined || isNaN(num)) return `0 ${activeCurrency}`;
  const d = decimalsFor(activeCurrency);
  const formatted = Number(num).toLocaleString(localeFor(activeCurrency), {
    minimumFractionDigits: d,
    maximumFractionDigits: d
  });
  return `${formatted} ${activeCurrency}`;
}

export function formatCompactCurrency(num) {
  const value = Number(num) || 0;
  const symbol = activeCurrency;
  if (Math.abs(value) >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B ${symbol}`;
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M ${symbol}`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(0)}K ${symbol}`;
  return `${formatNumber(value, decimalsFor(activeCurrency))} ${symbol}`;
}

export function formatDate(dateString) {
  if (!dateString) return '--';
  const date = new Date(dateString);
  return date.toLocaleString(localeFor(activeCurrency), {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
  });
}

export function formatDateShort(dateString) {
  if (!dateString) return '--';
  const date = new Date(dateString);
  return date.toLocaleDateString(localeFor(activeCurrency), {
    day: '2-digit', month: '2-digit', year: 'numeric'
  });
}

export function formatObjective(value) {
  if (!value) return 'Not specified';
  return value
    .toLowerCase()
    .replaceAll('_', ' ')
    .replace(/\b\w/g, char => char.toUpperCase());
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function showToast(message, type = 'error', durationMs = 3200) {
  const existing = document.querySelector('.notification');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = 'notification';
  toast.textContent = message;
  toast.style.cssText = `
    position: fixed;
    right: 20px;
    bottom: 20px;
    padding: 14px 18px;
    background: ${type === 'success' ? '#1A7A3A' : type === 'warning' ? '#F7B928' : '#C80A28'};
    color: #FFFFFF;
    z-index: 10000;
    border-radius: 8px;
    box-shadow: 0 8px 24px rgba(0,0,0,0.12);
    font-size: 0.875rem;
    max-width: 320px;
  `;
  document.body.appendChild(toast);
  setTimeout(() => { toast.remove(); }, durationMs);
}

export function getStatusClass(status) {
  const normalized = (status || '').toLowerCase();
  if (normalized === 'active') return 'active';
  if (normalized === 'paused') return 'paused';
  return 'archived';
}

export function downloadCSV(filename, rows) {
  const csv = rows.map(r => r.map(cell => {
    const s = String(cell ?? '');
    return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  }).join(',')).join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 0);
}

export default {
  setCurrency, getCurrency,
  formatNumber, formatCurrency, formatCompactCurrency,
  formatDate, formatDateShort, formatObjective,
  escapeHtml, showToast, getStatusClass, downloadCSV
};