import { allowedOrigins } from '../lib/config.js';

/**
 * CORS for extra origins listed in ALLOWED_ORIGIN (e.g. a future Android app's
 * WebView). The web app itself is served by Express from the same origin, so it
 * never needs CORS. With no ALLOWED_ORIGIN set, no CORS headers are sent at all
 * and browsers block every cross-origin read, which is the safe default.
 */
export function cors(req, res, next) {
  const origin = req.get('Origin');
  if (!origin || !allowedOrigins.has(origin)) return next();

  res.vary('Origin');
  res.set('Access-Control-Allow-Origin', origin);
  // The session is a cookie, so cross-origin callers must send credentials.
  res.set('Access-Control-Allow-Credentials', 'true');

  if (req.method === 'OPTIONS') {
    res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    res.set('Access-Control-Max-Age', '600');
    return res.sendStatus(204);
  }
  next();
}
