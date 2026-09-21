import { Router } from 'express';
import { query } from '../db.js';
import { HttpError, badRequest } from '../lib/errors.js';
import { pushEnabled, sendPushToUser, vapidPublicKey } from '../lib/push.js';
import { validate } from '../lib/validate.js';

export const pushRouter = Router();
export const notificationsRouter = Router();

function requirePush() {
  if (!pushEnabled) throw new HttpError(503, 'Notifications aren’t set up on this server yet.');
}

/** Pull a storable PushSubscription out of the request body, or throw 400. */
function parseSubscription(body) {
  const sub = body?.subscription;
  const endpoint = sub?.endpoint;
  if (typeof endpoint !== 'string' || !/^https:\/\//.test(endpoint) || endpoint.length > 2000) {
    throw badRequest('subscription.endpoint must be an https URL.');
  }
  const { p256dh, auth } = sub.keys ?? {};
  if (typeof p256dh !== 'string' || typeof auth !== 'string' || p256dh.length > 200 || auth.length > 100) {
    throw badRequest('subscription.keys must include p256dh and auth.');
  }
  const expirationTime = Number.isFinite(sub.expirationTime) ? sub.expirationTime : null;
  // Store only the fields web-push needs, never arbitrary client JSON.
  return { endpoint, expirationTime, keys: { p256dh, auth } };
}

// The client needs the public key to subscribe. It is public by design.
pushRouter.get('/public-key', (_req, res) => {
  res.json({ enabled: pushEnabled, publicKey: vapidPublicKey });
});

pushRouter.post('/subscribe', async (req, res) => {
  requirePush();
  const subscription = parseSubscription(req.body);
  // Same endpoint = same device: keep one row and hand it to whoever is signed in now.
  await query(
    `INSERT INTO push_subscriptions (user_id, subscription) VALUES ($1, $2)
     ON CONFLICT ((subscription->>'endpoint'))
     DO UPDATE SET user_id = EXCLUDED.user_id, subscription = EXCLUDED.subscription`,
    [req.user.id, subscription],
  );
  res.status(201).json({ subscribed: true });
});

pushRouter.post('/unsubscribe', async (req, res) => {
  const endpoint = req.body?.endpoint ?? req.body?.subscription?.endpoint;
  if (typeof endpoint !== 'string' || endpoint === '') throw badRequest('endpoint is required.');
  await query(
    `DELETE FROM push_subscriptions WHERE user_id = $1 AND subscription->>'endpoint' = $2`,
    [req.user.id, endpoint],
  );
  res.status(204).end();
});

// Lets the settings page confirm the whole chain works end to end.
pushRouter.post('/test', async (req, res) => {
  requirePush();
  const delivered = await sendPushToUser(req.user.id, 'Garden Manager', 'Notifications are working. 🌱', {
    url: '/notifications',
    tag: 'test',
  });
  if (delivered === 0) throw new HttpError(409, 'No subscribed devices. Enable notifications on this device first.');
  res.json({ delivered });
});

const settingsSchema = {
  watering_interval_days: { type: 'integer', min: 1, max: 60 },
  harvest_lead_days: { type: 'integer', min: 0, max: 60, required: true },
  notify_harvest: { type: 'boolean', required: true },
  notify_savings_monthly: { type: 'boolean', required: true },
  notify_activity: { type: 'boolean', required: true },
};
const SETTINGS_COLUMNS = Object.keys(settingsSchema);

// Users who never saved settings get the table defaults.
const DEFAULT_SETTINGS = {
  watering_interval_days: null,
  harvest_lead_days: 3,
  notify_harvest: true,
  notify_savings_monthly: true,
  notify_activity: true,
};

async function loadSettings(userId) {
  const { rows } = await query(
    `SELECT ${SETTINGS_COLUMNS.join(', ')} FROM reminder_settings WHERE user_id = $1`,
    [userId],
  );
  const { rows: subs } = await query('SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = $1', [userId]);
  return { ...DEFAULT_SETTINGS, ...rows[0], push_enabled: pushEnabled, device_count: subs[0].n };
}

notificationsRouter.get('/settings', async (req, res) => {
  res.json(await loadSettings(req.user.id));
});

notificationsRouter.put('/settings', async (req, res) => {
  const data = validate(settingsSchema, req.body, { partial: true });
  const cols = Object.keys(data);
  const values = Object.values(data);
  const updates = cols.map((col) => `${col} = EXCLUDED.${col}`);
  // Changing the interval restarts the watering schedule: the next daily run
  // sends one, then every N days after that.
  if (Object.hasOwn(data, 'watering_interval_days')) updates.push('last_watering_sent_on = NULL');
  await query(
    `INSERT INTO reminder_settings (user_id, ${cols.join(', ')})
     VALUES ($1, ${cols.map((_, i) => `$${i + 2}`).join(', ')})
     ON CONFLICT (user_id) DO UPDATE SET ${updates.join(', ')}`,
    [req.user.id, ...values],
  );
  res.json(await loadSettings(req.user.id));
});
