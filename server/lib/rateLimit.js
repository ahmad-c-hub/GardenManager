import { HttpError } from './errors.js';

/**
 * Minimal in-memory fixed-window limiter, keyed per request.
 * Good enough for a single-process app with a handful of users.
 */
export function rateLimit({ windowMs, max, key, message }) {
  const hits = new Map();

  setInterval(() => {
    const now = Date.now();
    for (const [k, entry] of hits) if (entry.resetAt <= now) hits.delete(k);
  }, windowMs).unref();

  return (req, res, next) => {
    const k = key(req);
    const now = Date.now();
    let entry = hits.get(k);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(k, entry);
    }
    entry.count += 1;
    if (entry.count > max) {
      res.set('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)));
      throw new HttpError(429, message);
    }
    next();
  };
}
