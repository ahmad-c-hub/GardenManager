-- 001_init: core schema for GardenManager

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  email         TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  display_name  TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Case-insensitive uniqueness: "Me@x.com" and "me@x.com" are the same account.
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_idx ON users (lower(email));

CREATE TABLE IF NOT EXISTS beds (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  location   TEXT,
  size_sqm   NUMERIC(8,2) CHECK (size_sqm IS NULL OR size_sqm >= 0),
  notes      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS plants (
  id                    SERIAL PRIMARY KEY,
  bed_id                INTEGER REFERENCES beds(id) ON DELETE SET NULL,
  name                  TEXT NOT NULL,
  variety               TEXT,
  planted_date          DATE,
  expected_harvest_date DATE,
  status                TEXT NOT NULL DEFAULT 'planted'
                        CHECK (status IN ('planted', 'growing', 'harvested', 'removed')),
  notes                 TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS plants_bed_id_idx ON plants (bed_id);
CREATE INDEX IF NOT EXISTS plants_status_idx ON plants (status);

-- Money deposited into the garden fund.
CREATE TABLE IF NOT EXISTS savings (
  id         SERIAL PRIMARY KEY,
  amount     NUMERIC(10,2) NOT NULL CHECK (amount > 0),
  note       TEXT,
  saved_on   DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS savings_saved_on_idx ON savings (saved_on);

-- Money spent from the garden fund.
CREATE TABLE IF NOT EXISTS expenses (
  id          SERIAL PRIMARY KEY,
  category    TEXT NOT NULL
              CHECK (category IN ('seeds', 'soil', 'tools', 'water', 'fertilizer', 'other')),
  amount      NUMERIC(10,2) NOT NULL CHECK (amount > 0),
  description TEXT,
  plant_id    INTEGER REFERENCES plants(id) ON DELETE SET NULL,
  spent_on    DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS expenses_spent_on_idx ON expenses (spent_on);
CREATE INDEX IF NOT EXISTS expenses_category_idx ON expenses (category);
CREATE INDEX IF NOT EXISTS expenses_plant_id_idx ON expenses (plant_id);

CREATE TABLE IF NOT EXISTS harvests (
  id           SERIAL PRIMARY KEY,
  plant_id     INTEGER REFERENCES plants(id) ON DELETE SET NULL,
  bed_id       INTEGER REFERENCES beds(id) ON DELETE SET NULL,
  crop_name    TEXT NOT NULL,
  quantity_kg  NUMERIC(10,2) NOT NULL CHECK (quantity_kg > 0),
  harvested_on DATE NOT NULL DEFAULT CURRENT_DATE,
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS harvests_harvested_on_idx ON harvests (harvested_on);
CREATE INDEX IF NOT EXISTS harvests_plant_id_idx ON harvests (plant_id);
CREATE INDEX IF NOT EXISTS harvests_bed_id_idx ON harvests (bed_id);
