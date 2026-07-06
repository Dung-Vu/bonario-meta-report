/**
 * middleware/auth.js
 *
 * Lightweight header-secret auth. Required for write endpoints (refresh)
 * to prevent random visitors from spamming the Meta API and triggering
 * rate-limit / ban scenarios. Public read endpoints stay open.
 *
 * Configure via env: BONARIO_REFRESH_SECRET
 * If unset, uses a generated ephemeral secret logged at startup.
 */

import crypto from 'crypto';

let EPHEMERAL_SECRET = null;

function getSecret() {
  const fromEnv = process.env.BONARIO_REFRESH_SECRET;
  if (fromEnv && fromEnv.length >= 8) return fromEnv;
  if (!EPHEMERAL_SECRET) {
    EPHEMERAL_SECRET = crypto.randomBytes(24).toString('hex');
    console.log(`[Bonario][auth] BONARIO_REFRESH_SECRET not set — using ephemeral secret: ${EPHEMERAL_SECRET}`);
  }
  return EPHEMERAL_SECRET;
}

export function getRefreshSecret() {
  return getSecret();
}

export function requireRefreshSecret(req, res, next) {
  const provided = req.get('x-bonario-secret');
  const expected = getSecret();
  if (!provided) {
    console.warn(`[Bonario][auth] Rejected refresh from ip=${req.ip} (no secret)`);
    return res.status(401).json({ error: 'Unauthorized — set x-bonario-secret header' });
  }
  const providedBuf = Buffer.from(provided);
  const expectedBuf = Buffer.from(expected);
  if (providedBuf.length !== expectedBuf.length ||
      !crypto.timingSafeEqual(providedBuf, expectedBuf)) {
    console.warn(`[Bonario][auth] Rejected refresh from ip=${req.ip} (bad secret)`);
    return res.status(401).json({ error: 'Unauthorized — invalid secret' });
  }
  next();
}

export function ipRateLimit({ windowMs = 60_000, max = 10 } = {}) {
  const hits = new Map();

  return (req, res, next) => {
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';
    const now = Date.now();
    const arr = hits.get(ip) || [];
    const fresh = arr.filter(h => now - h.ts < windowMs);
    fresh.push({ ts: now });
    hits.set(ip, fresh);

    if (hits.size > 500) {
      for (const [k, v] of hits) {
        if (!v.some(h => now - h.ts < windowMs)) hits.delete(k);
      }
    }

    if (fresh.length > max) {
      return res.status(429).json({ error: `Too many requests — max ${max} per ${windowMs / 1000}s` });
    }
    next();
  };
}

export default { requireRefreshSecret, ipRateLimit, getRefreshSecret };