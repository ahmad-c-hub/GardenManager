export const isProduction = process.env.NODE_ENV === 'production';

/** Extra origins allowed to call the API cross-origin (comma-separated ALLOWED_ORIGIN). */
export const allowedOrigins = new Set(
  (process.env.ALLOWED_ORIGIN ?? '')
    .split(',')
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter(Boolean),
);

export const AUTH_COOKIE = 'gm_session';
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

export function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('JWT_SECRET must be set in .env and be at least 32 characters long.');
  }
  return secret;
}
