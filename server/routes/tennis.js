import { Router } from 'express';
import { query, withTransaction } from '../db.js';
import { HttpError, badRequest, notFound } from '../lib/errors.js';
import { notifyActivity } from '../lib/push.js';
import { replay } from '../lib/tennis.js';
import { parseId } from '../lib/validate.js';

const router = Router();

const STATUSES = ['in_progress', 'completed'];

// A match with its players and rounds (ordered), as one row.
const MATCH_SQL = `
  SELECT m.id, m.status, m.player1_id, m.player2_id, m.winner_id, m.created_at, m.completed_at,
         p1.name AS player1_name, p2.name AS player2_name,
         COALESCE(
           json_agg(json_build_object(
             'round_number', r.round_number,
             'player1_points', r.player1_points,
             'player2_points', r.player2_points,
             'status', r.status,
             'winner_id', r.winner_id
           ) ORDER BY r.round_number) FILTER (WHERE r.id IS NOT NULL),
           '[]'
         ) AS rounds
  FROM matches m
  JOIN players p1 ON p1.id = m.player1_id
  JOIN players p2 ON p2.id = m.player2_id
  LEFT JOIN rounds r ON r.match_id = m.id`;
const MATCH_GROUP = 'GROUP BY m.id, p1.name, p2.name';

/** Add the derived fields the scoreboard needs. */
function decorate(m) {
  const rounds = typeof m.rounds === 'string' ? JSON.parse(m.rounds) : m.rounds;
  const won = (playerId) => rounds.filter((r) => r.winner_id === playerId).length;
  const current = m.status === 'in_progress' ? rounds.find((r) => r.status === 'in_progress') : null;
  return {
    ...m,
    rounds,
    rounds_won: { player1: won(m.player1_id), player2: won(m.player2_id) },
    current_round: current?.round_number ?? null,
  };
}

async function findMatch(id, db = { query }) {
  const { rows } = await db.query(`${MATCH_SQL} WHERE m.id = $1 ${MATCH_GROUP}`, [id]);
  if (rows.length === 0) throw notFound('That match could not be found.');
  return decorate(rows[0]);
}

/** Write the replayed state to rounds + matches (inside the caller's transaction). */
async function saveState(client, match, state) {
  const playerFor = (side) => (side === 1 ? match.player1_id : side === 2 ? match.player2_id : null);
  for (const r of state.rounds) {
    await client.query(
      `INSERT INTO rounds (match_id, round_number, player1_points, player2_points, status, winner_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (match_id, round_number) DO UPDATE
       SET player1_points = EXCLUDED.player1_points, player2_points = EXCLUDED.player2_points,
           status = EXCLUDED.status, winner_id = EXCLUDED.winner_id`,
      [match.id, r.number, r.p1, r.p2, r.winner ? 'completed' : 'in_progress', playerFor(r.winner)],
    );
  }
  // An undo can take a match back out of a round it had just started.
  await client.query('DELETE FROM rounds WHERE match_id = $1 AND round_number > $2', [match.id, state.rounds.length]);
  await client.query(
    `UPDATE matches
     SET status = $2, winner_id = $3,
         completed_at = CASE WHEN $2 = 'completed' THEN COALESCE(completed_at, now()) ELSE NULL END
     WHERE id = $1`,
    [match.id, state.winner ? 'completed' : 'in_progress', playerFor(state.winner)],
  );
}

/**
 * Lock the match, change its point log with `mutate`, replay the whole log
 * through the scoring rules and save the result. Locking serialises two
 * phones scoring the same match at once.
 */
async function rescore(matchId, mutate) {
  return withTransaction(async (client) => {
    const { rows } = await client.query('SELECT * FROM matches WHERE id = $1 FOR UPDATE', [matchId]);
    if (rows.length === 0) throw notFound('That match could not be found.');
    const match = rows[0];
    const pointsOf = async () =>
      (await client.query('SELECT scorer FROM match_points WHERE match_id = $1 ORDER BY id', [matchId])).rows.map((r) => r.scorer);

    const before = replay(await pointsOf());
    await mutate(client, match, before);
    const after = replay(await pointsOf());
    await saveState(client, match, after);

    const finishedBefore = before.rounds.filter((r) => r.winner).length;
    const finishedAfter = after.rounds.filter((r) => r.winner).length;
    let event = 'point';
    if (after.winner && !before.winner) event = 'match';
    else if (finishedAfter > finishedBefore) event = 'round';
    else if (finishedAfter < finishedBefore || (before.winner && !after.winner)) event = 'reopened';

    return { match: await findMatch(matchId, client), event };
  });
}

/* ---------- Players & matches ---------- */

router.get('/players', async (_req, res) => {
  const { rows } = await query('SELECT id, name FROM players ORDER BY id');
  res.json(rows);
});

router.get('/matches', async (req, res) => {
  const { status } = req.query;
  if (status !== undefined && !STATUSES.includes(status)) throw badRequest('status must be in_progress or completed.');
  const limit = req.query.limit === undefined ? 50 : Number(req.query.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw badRequest('limit must be between 1 and 200.');

  const params = [limit];
  const where = status ? `WHERE m.status = $${params.push(status)}` : '';
  const { rows } = await query(
    `${MATCH_SQL} ${where} ${MATCH_GROUP}
     ORDER BY COALESCE(m.completed_at, m.created_at) DESC, m.id DESC LIMIT $1`,
    params,
  );
  res.json(rows.map(decorate));
});

router.get('/matches/:id', async (req, res) => {
  res.json(await findMatch(parseId(req.params.id)));
});

router.post('/matches', async (req, res) => {
  const p1 = parseId(req.body?.player1_id);
  const p2 = parseId(req.body?.player2_id);
  if (p1 === p2) throw badRequest('Choose two different players.');
  const { rows: players } = await query('SELECT id FROM players WHERE id = ANY($1::int[])', [[p1, p2]]);
  if (players.length !== 2) throw badRequest('Both players must be on the roster.');

  const id = await withTransaction(async (client) => {
    const { rows } = await client.query(
      'INSERT INTO matches (player1_id, player2_id, created_by) VALUES ($1, $2, $3) RETURNING id',
      [p1, p2, req.user.id],
    );
    await client.query('INSERT INTO rounds (match_id, round_number) VALUES ($1, 1)', [rows[0].id]);
    return rows[0].id;
  });
  res.status(201).json(await findMatch(id));
});

// Body: { player_id } — which of the match's two players won the point.
router.post('/matches/:id/point', async (req, res) => {
  const matchId = parseId(req.params.id);
  const playerId = parseId(req.body?.player_id);
  const result = await rescore(matchId, async (client, match, state) => {
    if (match.status === 'completed' || state.winner) throw new HttpError(409, 'This match is already over.');
    const scorer = playerId === match.player1_id ? 1 : playerId === match.player2_id ? 2 : null;
    if (!scorer) throw badRequest('That player isn’t in this match.');
    await client.query('INSERT INTO match_points (match_id, scorer, scored_by) VALUES ($1, $2, $3)', [matchId, scorer, req.user.id]);
  });
  res.json(result);

  if (result.event === 'match') {
    const m = result.match;
    const winnerIsP1 = m.winner_id === m.player1_id;
    const [winner, loser] = winnerIsP1 ? [m.player1_name, m.player2_name] : [m.player2_name, m.player1_name];
    const score = m.rounds.map((r) => (winnerIsP1 ? `${r.player1_points}–${r.player2_points}` : `${r.player2_points}–${r.player1_points}`));
    notifyActivity(req.user.id, '🎾 Match over', `${winner} beat ${loser} ${score.join(', ')}.`, { url: `/tennis/matches/${m.id}`, tag: 'tennis' });
  }
});

// Take back the most recent point — re-opening a round or match it had finished.
router.post('/matches/:id/undo', async (req, res) => {
  const matchId = parseId(req.params.id);
  const result = await rescore(matchId, async (client) => {
    const { rowCount } = await client.query(
      'DELETE FROM match_points WHERE id = (SELECT MAX(id) FROM match_points WHERE match_id = $1)',
      [matchId],
    );
    if (rowCount === 0) throw new HttpError(409, 'There are no points to undo.');
  });
  res.json({ ...result, event: result.event === 'reopened' ? 'reopened' : 'undo' });
});

router.delete('/matches/:id', async (req, res) => {
  const { rowCount } = await query('DELETE FROM matches WHERE id = $1', [parseId(req.params.id)]);
  if (rowCount === 0) throw notFound('That match could not be found.');
  res.status(204).end();
});

/* ---------- Stats ---------- */

// Matches count once completed; rounds count once completed, even in a match still being played.
router.get('/leaderboard', async (_req, res) => {
  const { rows } = await query(`
    SELECT p.id, p.name,
      (SELECT COUNT(*) FROM matches m
         WHERE m.status = 'completed' AND p.id IN (m.player1_id, m.player2_id)) AS matches_played,
      (SELECT COUNT(*) FROM matches m WHERE m.winner_id = p.id)                   AS matches_won,
      (SELECT COUNT(*) FROM rounds r WHERE r.status = 'completed' AND r.winner_id = p.id) AS rounds_won,
      (SELECT COUNT(*) FROM rounds r JOIN matches m ON m.id = r.match_id
         WHERE r.status = 'completed' AND p.id IN (m.player1_id, m.player2_id))  AS rounds_played
    FROM players p`);
  const board = rows
    .map((r) => ({ ...r, win_pct: r.matches_played ? Math.round((r.matches_won / r.matches_played) * 1000) / 10 : 0 }))
    .sort((a, b) => b.matches_won - a.matches_won || b.win_pct - a.win_pct || b.rounds_won - a.rounds_won || a.name.localeCompare(b.name));
  res.json(board);
});

// ?a=playerId&b=playerId
router.get('/h2h', async (req, res) => {
  const a = parseId(req.query.a);
  const b = parseId(req.query.b);
  if (a === b) throw badRequest('Choose two different players.');
  const { rows: players } = await query('SELECT id, name FROM players WHERE id = ANY($1::int[])', [[a, b]]);
  if (players.length !== 2) throw notFound('Both players must be on the roster.');

  const pair = '((m.player1_id = $1 AND m.player2_id = $2) OR (m.player1_id = $2 AND m.player2_id = $1))';
  const [{ rows: [matchRow] }, { rows: [roundRow] }] = await Promise.all([
    query(
      `SELECT COUNT(*) FILTER (WHERE m.winner_id = $1) AS a_won,
              COUNT(*) FILTER (WHERE m.winner_id = $2) AS b_won,
              COUNT(*) FILTER (WHERE m.status = 'completed') AS played,
              COUNT(*) FILTER (WHERE m.status = 'in_progress') AS in_progress
       FROM matches m WHERE ${pair}`,
      [a, b],
    ),
    query(
      `SELECT COUNT(*) FILTER (WHERE r.winner_id = $1) AS a_won,
              COUNT(*) FILTER (WHERE r.winner_id = $2) AS b_won
       FROM rounds r JOIN matches m ON m.id = r.match_id
       WHERE r.status = 'completed' AND ${pair}`,
      [a, b],
    ),
  ]);
  const name = (id) => players.find((p) => p.id === id).name;
  res.json({
    a: { id: a, name: name(a), matches_won: matchRow.a_won, rounds_won: roundRow.a_won },
    b: { id: b, name: name(b), matches_won: matchRow.b_won, rounds_won: roundRow.b_won },
    matches_played: matchRow.played,
    matches_in_progress: matchRow.in_progress,
  });
});

export default router;
