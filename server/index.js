import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';

import { getJwtSecret, isProduction } from './lib/config.js';
import { HttpError } from './lib/errors.js';
import { requireAuth } from './middleware/auth.js';
import { cors } from './middleware/cors.js';
import { errorHandler, notFoundHandler } from './middleware/errors.js';
import authRouter from './routes/auth.js';
import dashboardRouter from './routes/dashboard.js';
import { notificationsRouter, pushRouter } from './routes/notifications.js';
import momentsRouter from './routes/moments.js';
import { startReminderJobs } from './jobs/reminders.js';
import { bedsRouter, expensesRouter, harvestsRouter, plantsRouter, savingsRouter } from './routes/resources.js';

getJwtSecret(); // Fail fast at startup if the secret is missing or weak.

const app = express();
app.disable('x-powered-by');
// Behind Render's load balancer, trust one proxy hop so req.ip is the real
// client (the login rate limiter keys on it). Locally, only trust loopback.
app.set('trust proxy', isProduction ? 1 : 'loopback');

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        'font-src': ["'self'", 'https://fonts.gstatic.com'],
        // Moment photos come from Cloudinary; blob: is the local preview before upload.
        'img-src': ["'self'", 'data:', 'blob:', 'https://res.cloudinary.com'],
      },
    },
  }),
);
app.use('/api', cors);
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());

// CSRF defence (alongside SameSite=Lax cookies): state-changing API calls must be
// JSON, which a cross-site HTML form cannot send without a CORS preflight.
// req.is() returns null when there is no body at all (e.g. logout) and false
// for any non-JSON body — including an empty form post, which sends Content-Length: 0.
// Photo uploads must be multipart, which a form *can* send cross-site, so they
// also need a custom header — and custom headers always force a preflight.
app.use('/api', (req, _res, next) => {
  const photoUpload =
    req.method === 'POST' && req.path === '/moments' && req.is('multipart/form-data') && req.get('X-Requested-With') === 'fetch';
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && req.is('application/json') === false && !photoUpload) {
    return next(new HttpError(415, 'Requests must be sent as JSON.'));
  }
  next();
});

// Public: sign in / sign out only. /me is protected inside the router.
app.use('/api/auth', authRouter);

// Everything else under /api requires a signed-in user.
app.use('/api', requireAuth);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/beds', bedsRouter);
app.use('/api/plants', plantsRouter);
app.use('/api/savings', savingsRouter);
app.use('/api/expenses', expensesRouter);
app.use('/api/harvests', harvestsRouter);
app.use('/api/push', pushRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/moments', momentsRouter);
app.use('/api', notFoundHandler);

// In production, serve the built React app. The SPA itself shows only the
// login page until /api/auth/me succeeds, and holds no data of its own.
const clientDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../client/dist');
if (isProduction && existsSync(clientDist)) {
  app.use(
    express.static(clientDist, {
      index: false,
      maxAge: '1h',
      setHeaders(res, filePath) {
        // The service worker and manifest must be re-checked on every load so
        // updates reach installed apps promptly.
        if (['sw.js', 'manifest.json'].includes(path.basename(filePath))) res.setHeader('Cache-Control', 'no-cache');
      },
    }),
  );
  app.get('/{*splat}', (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
}

app.use(errorHandler);

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  console.log(`🌱 GardenManager API listening on http://localhost:${port}`);
});

startReminderJobs();
