export const isProduction = process.env.NODE_ENV === 'production';

/** Extra origins allowed to call the API cross-origin (comma-separated ALLOWED_ORIGIN). */
export const allowedOrigins = new Set(
  (process.env.ALLOWED_ORIGIN ?? '')
    .split(',')
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter(Boolean),
);

export const AUTH_COOKIE = 'gm_session';
// 2 years. Removing a user still revokes access at once (requireAuth re-checks the user on
// every request). Note: Chrome caps cookie lifetimes at 400 days, so there the cookie
// itself expires after ~13 months even though the token inside is valid for longer.
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 365 * 2; // 2 years

export function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('JWT_SECRET must be set in .env and be at least 32 characters long.');
  }
  return secret;
}

/** IANA timezone the garden lives in: reminder times and recurring work items use it. */
export const GARDEN_TIMEZONE = process.env.REMINDER_TIMEZONE || 'UTC';
