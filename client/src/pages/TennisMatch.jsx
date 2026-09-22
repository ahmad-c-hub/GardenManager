import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ChevronLeft, RotateCcw, Trash2, Trophy, Undo2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { useCollection } from '../lib/useCollection.js';
import { useToast } from '../lib/toast.jsx';
import { timeAgo } from '../lib/format.js';
import { playerTone, pointHint, scoreLine, shortName } from '../lib/tennis.js';
import { ConfirmDialog, ErrorBanner, SkeletonRows } from '../components/ui.jsx';
import { Avatar } from './Tennis.jsx';

const EASE = [0.22, 1, 0.36, 1];

/** A small burst of leaves when the match is won. */
function LeafBurst() {
  const reduce = useReducedMotion();
  if (reduce) return null;
  const leaves = Array.from({ length: 14 }, (_, i) => {
    const angle = (i / 14) * Math.PI * 2 + (i % 2 ? 0.2 : -0.1);
    const dist = 110 + (i % 3) * 40;
    return { i, x: Math.cos(angle) * dist, y: Math.sin(angle) * dist * 0.7, r: (i * 47) % 360 };
  });
  return (
    <div className="tn-burst" aria-hidden="true">
      {leaves.map((l) => (
        <motion.svg
          key={l.i}
          viewBox="0 0 20 10"
          className={`tn-leaf ${l.i % 3 === 0 ? 'is-clay' : l.i % 3 === 1 ? 'is-sage' : 'is-ochre'}`}
          initial={{ x: 0, y: 0, opacity: 0, scale: 0.4, rotate: l.r }}
          animate={{ x: l.x, y: l.y, opacity: [0, 1, 0], scale: 1, rotate: l.r + 90 }}
          transition={{ duration: 1.6, ease: EASE, delay: 0.1 + (l.i % 4) * 0.04 }}
        >
          <path d="M0 5 C 5 -1 15 -1 20 5 C 15 11 5 11 0 5 Z" />
        </motion.svg>
      ))}
    </div>
  );
}

function RollingNumber({ value }) {
  return (
    <span className="tn-roll">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={value}
          initial={{ y: '45%', opacity: 0 }}
          animate={{ y: '0%', opacity: 1 }}
          exit={{ y: '-45%', opacity: 0 }}
          transition={{ duration: 0.32, ease: EASE }}
        >
          {value}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

function RoundsStrip({ match }) {
  const done = match.status === 'completed';
  return (
    <ol className="tn-rounds">
      {[1, 2, 3].map((n) => {
        const r = match.rounds.find((x) => x.round_number === n);
        if (!r && done) return null; // a 2–0 match never needs round 3
        const state = !r ? 'upcoming' : r.status === 'completed' ? 'done' : 'live';
        const winner = r?.winner_id === match.player1_id ? 1 : r?.winner_id === match.player2_id ? 2 : null;
        return (
          <li key={n} className={`tn-round is-${state}`}>
            <span className="tn-round-label">Round {n}</span>
            {r ? (
              <span className="tn-round-score">
                <span className={winner === 1 ? 'is-won' : ''}>{r.player1_points}</span>
                <em>–</em>
                <span className={winner === 2 ? 'is-won' : ''}>{r.player2_points}</span>
              </span>
            ) : (
              <span className="tn-round-score is-muted">—</span>
            )}
            <span className="tn-round-note">
              {state === 'live' ? 'in progress' : state === 'done' ? shortName(match[`player${winner}_name`]) : 'to play'}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * One live scoreboard per match. Keyed by id, so moving between matches (a
 * rematch, a notification) starts a fresh board: nothing — queued taps,
 * in-flight responses, timers — can carry over from another match.
 */
export default function TennisMatchPage() {
  const { matchId } = useParams();
  return <TennisMatch key={matchId} matchId={matchId} />;
}

function TennisMatch({ matchId }) {
  const navigate = useNavigate();
  const toast = useToast();
  const { data: players } = useCollection('/tennis/players');
  const [match, setMatch] = useState(null);
  const [error, setError] = useState(null);
  const [banner, setBanner] = useState(null); // { title, sub }
  const [celebrate, setCelebrate] = useState(false);
  const [pending, setPending] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [rematching, setRematching] = useState(false);
  const queue = useRef(Promise.resolve());
  const latest = useRef(null);
  const pendingRef = useRef(0);
  const bannerTimer = useRef(null);

  const show = useCallback((m) => {
    latest.current = m;
    setMatch(m);
  }, []);

  const load = useCallback(async () => {
    try {
      show(await api.get(`/tennis/matches/${matchId}`));
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, [matchId, show]);

  useEffect(() => {
    load();
  }, [load]);

  // Someone may be scoring on another phone: refresh quietly while the match is live.
  useEffect(() => {
    if (match?.status !== 'in_progress') return undefined;
    const t = setInterval(() => {
      if (!document.hidden && pendingRef.current === 0) load();
    }, 5000);
    return () => clearInterval(t);
  }, [match?.status, load]);

  useEffect(() => () => clearTimeout(bannerTimer.current), []);

  function announce(event, next) {
    if (event === 'round') {
      const r = next.rounds.filter((x) => x.status === 'completed').at(-1);
      const winnerIs1 = r.winner_id === next.player1_id;
      const name = shortName(winnerIs1 ? next.player1_name : next.player2_name);
      const [hi, lo] = winnerIs1 ? [r.player1_points, r.player2_points] : [r.player2_points, r.player1_points];
      setBanner({ title: `Round ${r.round_number} to ${name}`, sub: `${hi}–${lo} · round ${r.round_number + 1} begins` });
      clearTimeout(bannerTimer.current);
      bannerTimer.current = setTimeout(() => setBanner(null), 3200);
    } else if (event === 'match') {
      setBanner(null);
      setCelebrate(true);
    } else if (event === 'reopened') {
      setCelebrate(false);
      toast.success('Point undone — back into the round');
    }
  }

  /** Taps are queued, so fast double-taps are all recorded, in order. */
  function send(action, body) {
    navigator.vibrate?.(8);
    pendingRef.current += 1;
    setPending((p) => p + 1);
    queue.current = queue.current.then(async () => {
      try {
        if (action === 'point' && latest.current?.status === 'completed') return; // the match ended mid-queue
        const { match: next, event } = await api.post(`/tennis/matches/${matchId}/${action}`, body);
        show(next);
        announce(event, next);
      } catch (err) {
        toast.error(err.message);
        load();
      } finally {
        pendingRef.current -= 1;
        setPending((p) => p - 1);
      }
    });
  }

  async function rematch() {
    setRematching(true);
    try {
      const next = await api.post('/tennis/matches', { player1_id: match.player1_id, player2_id: match.player2_id });
      navigate(`/tennis/matches/${next.id}`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setRematching(false);
    }
  }

  async function remove() {
    await api.del(`/tennis/matches/${matchId}`);
    toast.success('Match deleted');
    navigate('/tennis');
  }

  if (error && !match) {
    return (
      <>
        <Link to="/tennis" className="tn-back"><ChevronLeft /> Tennis</Link>
        <ErrorBanner error={error} onRetry={load} />
      </>
    );
  }
  if (!match || !players) {
    return <div className="card card-pad"><SkeletonRows rows={4} /></div>;
  }

  const done = match.status === 'completed';
  const round = match.rounds.find((r) => r.status === 'in_progress');
  const hasPoints = match.rounds.some((r) => r.player1_points + r.player2_points > 0);
  const sides = [1, 2].map((n) => ({
    n,
    id: match[`player${n}_id`],
    name: match[`player${n}_name`],
    roundsWon: n === 1 ? match.rounds_won.player1 : match.rounds_won.player2,
    points: round ? round[`player${n}_points`] : 0,
    hint: pointHint(match, n),
  }));
  const winner = sides.find((s) => s.id === match.winner_id);
  const loser = sides.find((s) => s.id !== match.winner_id);

  return (
    <div className="tn-match">
      <Link to="/tennis" className="tn-back"><ChevronLeft /> Tennis</Link>
      <header className="tn-match-head">
        <h1>
          {shortName(sides[0].name)} <em>vs</em> {shortName(sides[1].name)}
        </h1>
        <p>{done ? `Finished ${timeAgo(match.completed_at)}` : `Started ${timeAgo(match.created_at)}`} · best of three rounds</p>
      </header>

      <motion.section
        className={`tn-board ${done ? 'is-final' : ''}`}
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: EASE }}
        aria-label="Scoreboard"
      >
        <div className="tn-court" aria-hidden="true" />
        <div className="tn-board-head">
          <span className="tn-board-round">{done ? 'Final · rounds won' : `Round ${match.current_round}`}</span>
          {done ? (
            <span className="tn-chip is-final"><Trophy /> Match over</span>
          ) : (
            <span className="tn-chip is-live"><span className="tn-live-dot" /> Live</span>
          )}
        </div>

        <div className="tn-board-players" aria-live="polite">
          {sides.map((s) => (
            <div key={s.n} className={`tn-board-side ${done && s.id === match.winner_id ? 'is-winner' : ''} ${done && s.id !== match.winner_id ? 'is-loser' : ''}`}>
              <Avatar player={s} players={players} size="lg" />
              <span className="tn-board-name">{shortName(s.name)}</span>
              <span className="tn-pips" aria-label={`${s.roundsWon} rounds won`}>
                {[0, 1].map((i) => <span key={i} className={`tn-pip ${i < s.roundsWon ? 'is-on' : ''}`} />)}
              </span>
              <span className="tn-board-score" aria-label={`${shortName(s.name)}: ${done ? s.roundsWon : s.points}`}>
                <RollingNumber value={done ? s.roundsWon : s.points} />
              </span>
              <span className="tn-hint">
                <AnimatePresence>
                  {s.hint && (
                    <motion.span key={s.hint} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                      {s.hint}
                    </motion.span>
                  )}
                </AnimatePresence>
              </span>
            </div>
          ))}
        </div>

        <RoundsStrip match={match} />

        <AnimatePresence>
          {banner && (
            <motion.div
              key={banner.title}
              className="tn-banner"
              role="status"
              initial={{ opacity: 0, y: -12, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ type: 'spring', stiffness: 380, damping: 30 }}
            >
              <strong>{banner.title}</strong>
              <span>{banner.sub}</span>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {done && winner && (
            <motion.div
              key="won"
              className="tn-won"
              role="status"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.6, ease: EASE, delay: celebrate ? 0.25 : 0 }}
            >
              {celebrate && <LeafBurst />}
              <span className="tn-won-icon"><Trophy /></span>
              <strong>{winner.name} wins</strong>
              <span>
                {winner.roundsWon}–{loser.roundsWon} in rounds · {scoreLine(match, winner.id).join(', ')}
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.section>

      {!done ? (
        <div className="tn-controls">
          {sides.map((s) => (
            <motion.button
              key={s.n}
              type="button"
              className={`tn-plus ${playerTone(s.id, players)}`}
              whileTap={{ scale: 0.96 }}
              onClick={() => send('point', { player_id: s.id })}
              aria-label={`Point to ${s.name}`}
            >
              <span className="tn-plus-num">+1</span>
              <span className="tn-plus-name">{shortName(s.name)}</span>
            </motion.button>
          ))}
        </div>
      ) : (
        <div className="tn-after">
          <button type="button" className="btn btn-primary" onClick={rematch} disabled={rematching}>
            {rematching ? <span className="spinner" /> : <><RotateCcw /> Rematch</>}
          </button>
          <Link to="/tennis" className="btn btn-secondary">Standings</Link>
        </div>
      )}

      <div className="tn-subcontrols">
        <button type="button" className="btn btn-secondary" onClick={() => send('undo')} disabled={!hasPoints && pending === 0}>
          <Undo2 /> Undo last point
        </button>
        <span className="tn-sync" aria-live="polite">
          {pending > 0 && <><span className="spinner" /> Saving…</>}
        </span>
        <button type="button" className="btn btn-ghost btn-sm tn-delete" onClick={() => setConfirmDelete(true)}>
          <Trash2 /> Delete match
        </button>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title="Delete this match?"
        message="Every point and round of this match will be removed, and the standings will no longer count it."
        onConfirm={remove}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}
