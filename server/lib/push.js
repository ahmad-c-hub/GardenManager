import webpush from 'web-push';
import { query } from '../db.js';

const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;

/** Push is optional: without VAPID keys the app runs, it just can't notify. */
export const pushEnabled = Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY && VAPID_SUBJECT);
export const vapidPublicKey = pushEnabled ? VAPID_PUBLIC_KEY : null;

if (pushEnabled) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
} else {
  console.warn('Web push is off: set VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT to enable it.');
}

// The push service says the subscription is gone for good.
const EXPIRED_STATUSES = new Set([404, 410]);

/**
 * Send one notification to every device `userId` has subscribed.
 * `data.url` is the in-app path opened when the notification is tapped.
 * Subscriptions the push service reports as expired are deleted.
 * Never throws; returns how many devices accepted the message.
 */
export async function sendPushToUser(userId, title, body, data = {}) {
  if (!pushEnabled) return 0;

  const { rows } = await query('SELECT id, subscription FROM push_subscriptions WHERE user_id = $1', [userId]);
  const payload = JSON.stringify({ title, body, data });

  const results = await Promise.allSettled(
    rows.map((row) => webpush.sendNotification(row.subscription, payload, { TTL: 60 * 60 * 24 })),
  );

  const expired = [];
  let delivered = 0;
  results.forEach((result, i) => {
    if (result.status === 'fulfilled') {
      delivered += 1;
    } else if (EXPIRED_STATUSES.has(result.reason?.statusCode)) {
      expired.push(rows[i].id);
    } else {
      console.error(`Push to subscription #${rows[i].id} failed:`, result.reason?.statusCode ?? '', result.reason?.message);
    }
  });

  if (expired.length > 0) {
    await query('DELETE FROM push_subscriptions WHERE id = ANY($1::int[])', [expired]).catch((err) =>
      console.error('Could not prune expired push subscriptions:', err.message),
    );
  }
  return delivered;
}

/**
 * Tell everyone except `actorId` that something happened, if they opted in to
 * activity alerts. Fire-and-forget: errors are logged, never thrown, so a
 * push failure can't break the request that triggered it.
 */
export function notifyActivity(actorId, title, body, data) {
  if (!pushEnabled) return;
  (async () => {
    const { rows } = await query(
      `SELECT DISTINCT ps.user_id
       FROM push_subscriptions ps
       LEFT JOIN reminder_settings rs ON rs.user_id = ps.user_id
       WHERE ps.user_id <> $1 AND COALESCE(rs.notify_activity, true)`,
      [actorId],
    );
    await Promise.all(rows.map((r) => sendPushToUser(r.user_id, title, body, data)));
  })().catch((err) => console.error('Activity notification failed:', err.message));
}
