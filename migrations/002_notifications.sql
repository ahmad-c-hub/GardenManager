-- 002_notifications: web push subscriptions and per-user reminder settings

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id           SERIAL PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- The browser's PushSubscription as JSON: { endpoint, expirationTime, keys: { p256dh, auth } }
  subscription JSONB NOT NULL CHECK (subscription ? 'endpoint'),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- One row per browser/device. Re-subscribing (or another person signing in on
-- the same device) updates the row instead of duplicating it.
CREATE UNIQUE INDEX IF NOT EXISTS push_subscriptions_endpoint_idx
  ON push_subscriptions ((subscription->>'endpoint'));
CREATE INDEX IF NOT EXISTS push_subscriptions_user_idx ON push_subscriptions (user_id);

CREATE TABLE IF NOT EXISTS reminder_settings (
  id                     SERIAL PRIMARY KEY,
  user_id                INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  watering_interval_days INTEGER CHECK (watering_interval_days IS NULL OR watering_interval_days BETWEEN 1 AND 60),
  harvest_lead_days      INTEGER NOT NULL DEFAULT 3 CHECK (harvest_lead_days BETWEEN 0 AND 60),
  notify_harvest         BOOLEAN NOT NULL DEFAULT true,
  notify_savings_monthly BOOLEAN NOT NULL DEFAULT true,
  notify_activity        BOOLEAN NOT NULL DEFAULT true,
  -- Bookkeeping for the daily job: when the last watering reminder went out.
  last_watering_sent_on  DATE
);

-- Which harvest reminders have already been sent, so the daily job reminds
-- once per plant rather than every day of the lead window. Keyed on the
-- expected date too, so moving the date later earns a fresh reminder.
CREATE TABLE IF NOT EXISTS harvest_reminders_sent (
  user_id               INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plant_id              INTEGER NOT NULL REFERENCES plants(id) ON DELETE CASCADE,
  expected_harvest_date DATE NOT NULL,
  sent_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, plant_id, expected_harvest_date)
);
