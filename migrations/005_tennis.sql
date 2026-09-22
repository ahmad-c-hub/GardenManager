-- 005_tennis: matches between the three fixed players, scored point by point.

CREATE TABLE IF NOT EXISTS players (
  id   SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);
-- The fixed roster. Players aren't created through the app.
INSERT INTO players (name) VALUES ('Ahmad Hammoud'), ('Ahmad Youssef'), ('Bilal Hammoud')
ON CONFLICT (name) DO NOTHING;

CREATE TABLE IF NOT EXISTS matches (
  id           SERIAL PRIMARY KEY,
  player1_id   INTEGER NOT NULL REFERENCES players(id),
  player2_id   INTEGER NOT NULL REFERENCES players(id),
  status       TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed')),
  winner_id    INTEGER REFERENCES players(id),
  created_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  CHECK (player1_id <> player2_id),
  CHECK (winner_id IS NULL OR winner_id IN (player1_id, player2_id)),
  CHECK ((status = 'completed') = (winner_id IS NOT NULL AND completed_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS matches_status_idx ON matches (status, created_at DESC);

-- player1/player2 points follow the match's player1/player2.
CREATE TABLE IF NOT EXISTS rounds (
  id             SERIAL PRIMARY KEY,
  match_id       INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  round_number   INTEGER NOT NULL CHECK (round_number BETWEEN 1 AND 3),
  player1_points INTEGER NOT NULL DEFAULT 0 CHECK (player1_points BETWEEN 0 AND 7),
  player2_points INTEGER NOT NULL DEFAULT 0 CHECK (player2_points BETWEEN 0 AND 7),
  status         TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed')),
  winner_id      INTEGER REFERENCES players(id),
  UNIQUE (match_id, round_number)
);
CREATE INDEX IF NOT EXISTS rounds_winner_idx ON rounds (winner_id) WHERE status = 'completed';

-- Every point in order: the source of truth the rounds are rebuilt from, so a
-- point can be undone exactly (including re-opening a finished round or match).
CREATE TABLE IF NOT EXISTS match_points (
  id        SERIAL PRIMARY KEY,
  match_id  INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  scorer    SMALLINT NOT NULL CHECK (scorer IN (1, 2)), -- 1 = player1, 2 = player2
  scored_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  scored_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS match_points_match_idx ON match_points (match_id, id);
