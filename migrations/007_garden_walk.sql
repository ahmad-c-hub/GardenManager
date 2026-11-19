-- 007_garden_walk: a photo of the garden with pinned "spots", each holding
-- photos/videos. Files live on Cloudinary (uploaded straight from the browser);
-- only URLs and public ids (needed to delete them) are stored here.
-- The current map is the most recent garden_maps row.

CREATE TABLE IF NOT EXISTS garden_maps (
  id         SERIAL PRIMARY KEY,
  image_url  TEXT NOT NULL CHECK (image_url LIKE 'https://%'),
  -- Unique so two rows can never share (and later double-delete) one asset.
  public_id  TEXT NOT NULL UNIQUE,
  width      INTEGER,
  height     INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS garden_pins (
  id         SERIAL PRIMARY KEY,
  map_id     INTEGER NOT NULL REFERENCES garden_maps(id) ON DELETE CASCADE,
  label      TEXT NOT NULL CHECK (char_length(label) BETWEEN 1 AND 80),
  x_percent  NUMERIC(5,2) NOT NULL CHECK (x_percent BETWEEN 0 AND 100),
  y_percent  NUMERIC(5,2) NOT NULL CHECK (y_percent BETWEEN 0 AND 100),
  note       TEXT CHECK (note IS NULL OR char_length(note) <= 1000),
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS garden_pins_map_idx ON garden_pins (map_id);

CREATE TABLE IF NOT EXISTS garden_pin_media (
  id         SERIAL PRIMARY KEY,
  pin_id     INTEGER NOT NULL REFERENCES garden_pins(id) ON DELETE CASCADE,
  media_url  TEXT NOT NULL CHECK (media_url LIKE 'https://%'),
  public_id  TEXT NOT NULL UNIQUE,
  media_type TEXT NOT NULL CHECK (media_type IN ('image', 'video')),
  width      INTEGER,
  height     INTEGER,
  duration   NUMERIC,
  position   INTEGER NOT NULL CHECK (position >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS garden_pin_media_pin_idx ON garden_pin_media (pin_id, position);
