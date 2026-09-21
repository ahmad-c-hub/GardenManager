import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { query } from '../db.js';
import { AUTH_COOKIE, SESSION_TTL_SECONDS, getJwtSecret, isProduction } from '../lib/config.js';
import { HttpError } from '../lib/errors.js';
import { rateLimit } from '../lib/rateLimit.js';
import { validate } from '../lib/validate.js';
import { requireAuth } from '../middleware/auth.js';

// There is intentionally no sign-up route: accounts are created with `npm run add-user`.
const router = Router();

const cookieOptions = {
  httpOnly: true,
  secure: isProduction,
  sameSite: 'lax',
  path: '/',
};

// Compared against when the email is unknown, so a miss takes as long as a
// wrong password and response timing doesn't reveal which emails exist.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 12);

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  key: (req) => `${req.ip}|${String(req.body?.email ?? '').toLowerCase()}`,
  message: 'Too many sign-in attempts. Please wait a few minutes and try again.',
});

const loginSchema = {
  email: { type: 'string', required: true, max: 254 },
  password: { type: 'string', required: true, max: 200 },
};

router.post('/login', loginLimiter, async (req, res) => {
  const { email } = validate(loginSchema, req.body);
  // validate() trims strings; compare the raw password so spaces stay significant.
  const password = req.body.password;

  const { rows } = await query(
    'SELECT id, email, display_name, password_hash FROM users WHERE lower(email) = lower($1)',
    [email],
  );
  const user = rows[0];
  const ok = await bcrypt.compare(password, user?.password_hash ?? DUMMY_HASH);
  if (!user || !ok) {
    throw new HttpError(401, 'That email and password combination didn’t match.');
  }

  const token = jwt.sign({ sub: String(user.id) }, getJwtSecret(), {
    algorithm: 'HS256',
    expiresIn: SESSION_TTL_SECONDS,
  });
  res.cookie(AUTH_COOKIE, token, { ...cookieOptions, maxAge: SESSION_TTL_SECONDS * 1000 });
  res.json({ user: { id: user.id, email: user.email, display_name: user.display_name } });
});

router.post('/logout', (_req, res) => {
  res.clearCookie(AUTH_COOKIE, cookieOptions);
  res.status(204).end();
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

export default router;
