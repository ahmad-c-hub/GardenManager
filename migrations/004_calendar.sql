-- 004_calendar: shared garden work items on a calendar, with push reminders.

CREATE TABLE IF NOT EXISTS work_items (
  id           SERIAL PRIMARY KEY,
  title        TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  description  TEXT CHECK (description IS NULL OR char_length(description) <= 2000),
  -- First (or only) occurrence. Recurrences repeat its wall-clock time in the
  -- garden's timezone (REMINDER_TIMEZONE), so 09:00 stays 09:00 across DST.
  scheduled_at TIMESTAMPTZ NOT NULL,
  recurrence   TEXT NOT NULL DEFAULT 'none' CHECK (recurrence IN ('none', 'weekly', 'monthly')),
  bed_id       INTEGER REFERENCES beds(id) ON DELETE SET NULL,
  plant_id     INTEGER REFERENCES plants(id) ON DELETE SET NULL,
  created_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  -- Completion of a one-off item. Recurring items are completed per
  -- occurrence in work_item_completions, so ticking this week's watering
  -- doesn't tick off every future week too.
  completed    BOOLEAN NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS work_items_scheduled_at_idx ON work_items (scheduled_at);

CREATE TABLE IF NOT EXISTS work_item_completions (
  work_item_id    INTEGER NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
  occurrence_date DATE NOT NULL,
  completed_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  completed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (work_item_id, occurrence_date)
);

-- One row per reminder sent, so the hourly job never sends the same one twice.
CREATE TABLE IF NOT EXISTS work_item_reminders_sent (
  id              SERIAL PRIMARY KEY,
  work_item_id    INTEGER NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
  occurrence_date DATE NOT NULL,
  kind            TEXT NOT NULL CHECK (kind IN ('day_before', 'day_of')),
  sent_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (work_item_id, occurrence_date, kind)
);

ALTER TABLE reminder_settings ADD COLUMN IF NOT EXISTS notify_calendar BOOLEAN NOT NULL DEFAULT true;
