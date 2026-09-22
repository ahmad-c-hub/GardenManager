// Display helpers for the tennis pages. The server enforces every rule; the
// copy of roundWinner here only powers hints like "Match point".

/** "Ahmad Hammoud" -> "Ahmad H" (both Ahmads need their initial). */
export function shortName(name = '') {
  const [first, ...rest] = name.trim().split(/\s+/);
  const last = rest.at(-1);
  return last ? `${first} ${last[0]}` : first;
}

/** "Ahmad Hammoud" -> "AH". */
export function initials(name = '') {
  return name.trim().split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
}

/** Each player keeps one colour everywhere: forest, clay, ochre. */
const TONES = ['tone-forest', 'tone-clay', 'tone-ochre'];
export function playerTone(playerId, players = []) {
  const i = players.findIndex((p) => p.id === playerId);
  return TONES[(i < 0 ? playerId : i) % TONES.length];
}

export function roundWinner(p1, p2) {
  const hi = Math.max(p1, p2);
  const lo = Math.min(p1, p2);
  if ((hi === 6 && lo <= 4) || (hi === 7 && (lo === 5 || lo === 6))) return p1 > p2 ? 1 : 2;
  return null;
}

/** 'Match point' / 'Round point' for a side (1 or 2) one point from winning, else null. */
export function pointHint(match, side) {
  if (match.status !== 'in_progress') return null;
  const round = match.rounds.find((r) => r.status === 'in_progress');
  if (!round) return null;
  const p1 = round.player1_points + (side === 1 ? 1 : 0);
  const p2 = round.player2_points + (side === 2 ? 1 : 0);
  if (roundWinner(p1, p2) !== side) return null;
  const won = side === 1 ? match.rounds_won.player1 : match.rounds_won.player2;
  return won === 1 ? 'Match point' : 'Round point';
}

/** Scores from one player's side, e.g. ['6–3', '5–7', '7–6']. */
export function scoreLine(match, playerId) {
  const mine = playerId === match.player2_id ? 'player2_points' : 'player1_points';
  const theirs = mine === 'player1_points' ? 'player2_points' : 'player1_points';
  return match.rounds.filter((r) => r.player1_points + r.player2_points > 0).map((r) => `${r[mine]}–${r[theirs]}`);
}
