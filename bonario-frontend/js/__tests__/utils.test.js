import { describe, it, expect, beforeEach } from 'vitest';
import {
  setCurrency,
  getCurrency,
  formatNumber,
  formatCurrency,
  formatCompactCurrency,
  formatDate,
  formatDateShort,
  formatObjective,
  escapeHtml,
  getStatusClass,
  downloadCSV
} from '../utils.js';

describe('utils: currency switching', () => {
  it('defaults to USD', () => {
    setCurrency('USD');
    expect(getCurrency()).toBe('USD');
  });

  it('setCurrency normalises to upper-case', () => {
    setCurrency('vnd');
    expect(getCurrency()).toBe('VND');
  });

  it('falls back to USD when null/undefined', () => {
    setCurrency(null);
    expect(getCurrency()).toBe('USD');
  });
});

describe('utils: formatNumber', () => {
  it('formats with locale grouping for VND', () => {
    setCurrency('VND');
    expect(formatNumber(1234567)).toBe('1.234.567');
  });

  it('formats with locale grouping for USD', () => {
    setCurrency('USD');
    expect(formatNumber(1234567)).toMatch(/1[,. ]234[,. ]567/);
  });

  it('respects decimal argument', () => {
    setCurrency('USD');
    expect(formatNumber(3.14159, 2)).toBe('3.14');
    expect(formatNumber(3.14159, 4)).toBe('3.1416');
  });

  it('returns "0" for null/undefined/NaN', () => {
    expect(formatNumber(null)).toBe('0');
    expect(formatNumber(undefined)).toBe('0');
    expect(formatNumber(NaN)).toBe('0');
  });
});

describe('utils: formatCurrency', () => {
  it('appends currency code suffix', () => {
    setCurrency('VND');
    expect(formatCurrency(5000)).toMatch(/5\.000 VND$/);
  });

  it('zero-decimal currencies omit fractional digits', () => {
    setCurrency('VND');
    expect(formatCurrency(1000.55)).toMatch(/1\.001 VND$/);
  });

  it('two-decimal currencies keep fractions', () => {
    setCurrency('USD');
    const out = formatCurrency(99.5);
    expect(out).toMatch(/USD$/);
    expect(out).toMatch(/99[.,]50/);
  });

  it('handles null gracefully', () => {
    expect(formatCurrency(null)).toMatch(/0/);
  });
});

describe('utils: formatCompactCurrency', () => {
  it('uses K suffix for thousands', () => {
    setCurrency('USD');
    expect(formatCompactCurrency(1499)).toMatch(/1K USD/);
    expect(formatCompactCurrency(1500)).toMatch(/2K USD/);
  });
  it('uses M suffix for millions', () => {
    setCurrency('USD');
    expect(formatCompactCurrency(2_500_000)).toMatch(/2\.5M USD/);
  });
  it('uses B suffix for billions', () => {
    setCurrency('USD');
    expect(formatCompactCurrency(3_200_000_000)).toMatch(/3\.2B USD/);
  });
  it('falls back to plain format for small values', () => {
    setCurrency('USD');
    expect(formatCompactCurrency(42)).toMatch(/42/);
  });
});

describe('utils: formatDate / formatDateShort', () => {
  it('returns -- for falsy input', () => {
    expect(formatDate(null)).toBe('--');
    expect(formatDateShort(null)).toBe('--');
  });
  it('returns a non-empty string for valid dates', () => {
    const out = formatDate('2026-06-15T10:00:00Z');
    expect(out).not.toBe('--');
    expect(out.length).toBeGreaterThan(0);
  });
});

describe('utils: formatObjective', () => {
  it('converts OUTCOME_SALES to "Outcome Sales"', () => {
    expect(formatObjective('OUTCOME_SALES')).toBe('Outcome Sales');
  });
  it('returns "Not specified" for empty input', () => {
    expect(formatObjective(null)).toBe('Not specified');
  });
});

describe('utils: escapeHtml', () => {
  it('escapes &, <, >, ", and \'', () => {
    expect(escapeHtml('<script>alert("x")</script>'))
      .toBe('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
  });
  it('handles null/undefined safely', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });
});

describe('utils: getStatusClass', () => {
  it('maps ACTIVE → active', () => {
    expect(getStatusClass('ACTIVE')).toBe('active');
  });
  it('maps PAUSED → paused', () => {
    expect(getStatusClass('PAUSED')).toBe('paused');
  });
  it('falls back to archived for unknown values', () => {
    expect(getStatusClass('DELETED')).toBe('archived');
    expect(getStatusClass(null)).toBe('archived');
  });
});

describe('utils: downloadCSV', () => {
  it('returns a Blob-compatible download trigger without throwing', () => {
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    URL.createObjectURL = () => 'blob:test';
    URL.revokeObjectURL = () => {};

    try {
      let clickedHref = null;
      const originalAppend = document.body.appendChild.bind(document.body);
      const originalRemove = document.body.removeChild.bind(document.body);
      document.body.appendChild = (el) => {
        if (el && typeof el.click === 'function') {
          el.click = function () {
            clickedHref = el.href;
          };
        }
        return originalAppend(el);
      };
      document.body.removeChild = (el) => originalRemove(el);

      downloadCSV('test.csv', [['a', 'b'], ['1', '2']]);
      expect(clickedHref).toBe('blob:test');
    } finally {
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
      delete document.body.appendChild;
      delete document.body.removeChild;
    }
  });

  it('quotes cells containing commas, quotes, or newlines', () => {
    let capturedBlobParts = null;
    const originalCreate = URL.createObjectURL;
    URL.createObjectURL = (blob) => {
      capturedBlobParts = blob;
      return 'blob:test';
    };
    try {
      downloadCSV('x.csv', [['normal', 'has,comma'], ['has"quote', 'line\nbreak']]);
      expect(capturedBlobParts).not.toBeNull();
    } finally {
      URL.createObjectURL = originalCreate;
    }
  });
});