// Tennis scoring rules. Pure functions: the routes replay a match's point log
// through these, so the server alone decides when rounds and matches are won.

export const ROUNDS_TO_WIN = 2; // best of 3
const MAX_ROUNDS = 3;

/**
 * Winner of a round at this score (1 or 2), or null if play continues.
 * A round ends at 6–0…6–4, or — once it has reached 5–5 — at 7–5 or 7–6.
 * So 6–5 and 6–6 are still in progress.
 */
export function roundWinner(p1, p2) {
  const hi = Math.max(p1, p2);
  const lo = Math.min(p1, p2);
  const done = (hi === 6 && lo <= 4) || (hi === 7 && (lo === 5 || lo === 6));
  if (!done) return null;
  return p1 > p2 ? 1 : 2;
}

/**
 * Replay a match from its points, in order (each 1 = player1, 2 = player2).
 * Returns { rounds: [{ number, p1, p2, winner }], winner, roundsWon: [p1, p2] }.
 * `winner` (per round and for the match) is 1, 2 or null. While the match is
 * open, the last round is the one in play. Throws if a point comes after the
 * match was already decided — callers must not record one.
 */
export function replay(points) {
  const rounds = [{ number: 1, p1: 0, p2: 0, winner: null }];
  const roundsWon = [0, 0];
  let winner = null;

  for (const scorer of points) {
    if (winner) throw new Error('The match is already over.');
    if (scorer !== 1 && scorer !== 2) throw new Error(`Invalid scorer ${scorer}.`);
    const round = rounds.at(-1);
    if (scorer === 1) round.p1 += 1;
    else round.p2 += 1;

    round.winner = roundWinner(round.p1, round.p2);
    if (!round.winner) continue;
    roundsWon[round.winner - 1] += 1;
    if (roundsWon[round.winner - 1] === ROUNDS_TO_WIN) winner = round.winner;
    else if (rounds.length < MAX_ROUNDS) rounds.push({ number: rounds.length + 1, p1: 0, p2: 0, winner: null });
  }

  return { rounds, winner, roundsWon };
}
