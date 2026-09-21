import jwt from 'jsonwebtoken';
import { query } from '../db.js';
import { AUTH_COOKIE, getJwtSecret } from '../lib/config.js';
import { unauthorized } from '../lib/errors.js';

/**
 * Rejects the request unless it carries a valid session cookie for a user
 * that still exists. On success, sets req.user = { id, email, display_name }.
 */
export async function requireAuth(req, _res, next) {
  const token = req.cookies?.[AUTH_COOKIE];
  if (!token) throw unauthorized();

  let payload;
  try {
    payload = jwt.verify(token, getJwtSecret(), { algorithms: ['HS256'] });
  } catch {
    throw unauthorized('Your session has expired. Please sign in again.');
  }

  // Re-check the user on every request so removing a user from the
  // database revokes their access immediately.
  const { rows } = await query(
    'SELECT id, email, display_name FROM users WHERE id = $1',
    [Number(payload.sub)],
  );
  if (rows.length === 0) throw unauthorized();

  req.user = rows[0];
  next();
}
