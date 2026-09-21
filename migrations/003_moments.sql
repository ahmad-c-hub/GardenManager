-- 003_moments: garden photos with a note. The image itself lives on Cloudinary;
-- only its URL (and public id, needed to delete it) is stored here.

CREATE TABLE IF NOT EXISTS moments (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  image_url       TEXT NOT NULL CHECK (image_url LIKE 'https://%'),
  image_public_id TEXT NOT NULL,
  note            TEXT CHECK (note IS NULL OR char_length(note) <= 1000),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS moments_created_idx ON moments (created_at DESC, id DESC);
