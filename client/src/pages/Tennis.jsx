import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronRight, Crown, Plus, Swords, Trophy } from 'lucide-react';
import { api } from '../lib/api.js';
import { useCollection } from '../lib/useCollection.js';
import { fadeUp, stagger } from '../lib/motion.js';
import { timeAgo } from '../lib/format.js';
import { initials, playerTone, shortName } from '../lib/tennis.js';
import { EmptyState, ErrorBanner, FormError, Modal, PageHeader, SkeletonRows } from '../components/ui.jsx';

const ORDINALS = ['1st', '2nd', '3rd'];

export function Avatar({ player, players, size = '' }) {
  return (
    <span className={`tn-avatar ${size} ${playerTone(player.id, players)}`} aria-hidden="true">
      {initials(player.name)}
    </span>
  );
}

/* ---------- New match ---------- */

export function NewMatchForm({ players, initial = [], onCancel }) {
  const navigate = useNavigate();
  const [picked, setPicked] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  function toggle(id) {
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id].slice(-2)));
  }

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const match = await api.post('/tennis/matches', { player1_id: picked[0], player2_id: picked[1] });
      navigate(`/tennis/matches/${match.id}`);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  const [a, b] = picked.map((id) => players.find((p) => p.id === id));
  return (
    <div>
      <div className="tn-pick" role="group" aria-label="Choose two players">
        {players.map((p) => {
          const on = picked.includes(p.id);
          return (
            <button key={p.id} type="button" className={`tn-pick-player ${on ? 'is-on' : ''}`} aria-pressed={on} onClick={() => toggle(p.id)}>
              <Avatar player={p} players={players} size="lg" />
              <span>{p.name}</span>
              {on && (
                <motion.span className="tn-pick-order" initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}>
                  {picked.indexOf(p.id) + 1}
                </motion.span>
              )}
            </button>
          );
        })}
      </div>
      <p className="tn-versus" aria-live="polite">
        {a && b ? (
          <>
            <strong>{shortName(a.name)}</strong> <em>vs</em> <strong>{shortName(b.name)}</strong>
          </>
        ) : (
          `Pick ${picked.length === 0 ? 'two players' : 'one more player'}`
        )}
      </p>
      <div className="mt-4"><FormError error={error} /></div>
      <div className="form-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>
        <button type="button" className="btn btn-primary" disabled={picked.length !== 2 || busy} onClick={start}>
          {busy ? <span className="spinner" /> : <><Trophy /> Start match</>}
        </button>
      </div>
    </div>
  );
}

/* ---------- Sections ---------- */

function LiveMatches({ matches, players }) {
  const navigate = useNavigate();
  if (!matches?.length) return null;
  return (
    <section className="tn-section">
      <h2 className="tn-heading">
        <span className="tn-live-dot" aria-hidden="true" /> In play
        <span className="tn-count">{matches.length}</span>
      </h2>
      <div className="tn-live-grid">
        {matches.map((m) => {
          const round = m.rounds.find((r) => r.status === 'in_progress');
          const finished = m.rounds.filter((r) => r.status === 'completed');
          return (
            <button
              key={m.id}
              type="button"
              className="card tn-live-card"
              onClick={() => navigate(`/tennis/matches/${m.id}`)}
              aria-label={`Resume ${m.player1_name} versus ${m.player2_name}, round ${m.current_round}, ${round?.player1_points ?? 0}–${round?.player2_points ?? 0}`}
            >
              {[1, 2].map((side) => {
                const player = { id: m[`player${side}_id`], name: m[`player${side}_name`] };
                return (
                  <span key={side} className="tn-live-row">
                    <Avatar player={player} players={players} size="sm" />
                    <span className="tn-live-name">{shortName(player.name)}</span>
                    {/* Finished rounds, small; the round being played, large. */}
                    <span className="tn-live-sets">
                      {finished.map((r) => (
                        <span key={r.round_number} className={r.winner_id === player.id ? 'is-won' : ''}>
                          {r[`player${side}_points`]}
                        </span>
                      ))}
                    </span>
                    <span className="tn-live-score">{round ? round[`player${side}_points`] : '–'}</span>
                  </span>
                );
              })}
              <span className="tn-live-foot">
                Round {m.current_round} · started {timeAgo(m.created_at)}
                <span className="tn-resume">Resume <ChevronRight /></span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function Standings({ board, players }) {
  return (
    <section className="tn-section">
      <h2 className="tn-heading"><Crown /> Standings</h2>
      <motion.ol className="tn-standings" variants={stagger} initial="hidden" animate="show">
        {board.map((p, i) => {
          const leader = i === 0 && p.matches_won > 0;
          return (
            <motion.li key={p.id} variants={fadeUp} className={`card tn-stand ${leader ? 'is-leader' : ''}`}>
              <div className="tn-stand-top">
                <span className="tn-rank">{ORDINALS[i]}</span>
                {leader && <span className="tn-crown"><Crown /> Leading</span>}
              </div>
              <div className="tn-stand-who">
                <Avatar player={p} players={players} size="lg" />
                <div>
                  <h3>{p.name}</h3>
                  <p>{p.matches_played} {p.matches_played === 1 ? 'match' : 'matches'} played</p>
                </div>
              </div>
              <dl className="tn-stand-stats">
                <div className="is-main">
                  <dt>Matches won</dt>
                  <dd>{p.matches_won}</dd>
                </div>
                <div>
                  <dt>Rounds won</dt>
                  <dd>{p.rounds_won}</dd>
                </div>
                <div>
                  <dt>Win rate</dt>
                  <dd>{p.matches_played ? `${Math.round(p.win_pct)}%` : '—'}</dd>
                </div>
              </dl>
              <div className="tn-bar" aria-hidden="true">
                <motion.span
                  className={playerTone(p.id, players)}
                  initial={{ width: 0 }}
                  animate={{ width: `${p.win_pct}%` }}
                  transition={{ duration: 1, ease: [0.22, 1, 0.36, 1], delay: 0.2 + i * 0.08 }}
                />
              </div>
            </motion.li>
          );
        })}
      </motion.ol>
    </section>
  );
}

function SplitBar({ a, b, tones }) {
  const total = a + b;
  const pct = total ? (a / total) * 100 : 50;
  return (
    <div className={`tn-split ${total ? '' : 'is-empty'}`} aria-hidden="true">
      <motion.span className={tones[0]} animate={{ width: `${pct}%` }} transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }} />
      <motion.span className={tones[1]} animate={{ width: `${100 - pct}%` }} transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }} />
    </div>
  );
}

function HeadToHead({ players }) {
  const pairs = useMemo(() => {
    const out = [];
    for (let i = 0; i < players.length; i += 1) for (let j = i + 1; j < players.length; j += 1) out.push([players[i], players[j]]);
    return out;
  }, [players]);
  const [stats, setStats] = useState(null);
  const [error, setError] = useState(null);
  const [featured, setFeatured] = useState(0);
  const [pick, setPick] = useState(null); // [aId, bId] chosen in the selects

  useEffect(() => {
    let alive = true;
    Promise.all(pairs.map(([a, b]) => api.get('/tennis/h2h', { a: a.id, b: b.id })))
      .then((all) => alive && setStats(all))
      .catch((err) => alive && setError(err));
    return () => { alive = false; };
  }, [pairs]);

  if (error) return <ErrorBanner error={error} />;
  if (!stats) return <div className="card card-pad"><SkeletonRows rows={2} /></div>;

  const [aId, bId] = pick ?? [pairs[featured][0].id, pairs[featured][1].id];
  const index = pairs.findIndex(([x, y]) => (x.id === aId && y.id === bId) || (x.id === bId && y.id === aId));
  const raw = stats[index];
  const flipped = raw.a.id !== aId;
  const A = flipped ? raw.b : raw.a;
  const B = flipped ? raw.a : raw.b;
  const tones = [playerTone(A.id, players), playerTone(B.id, players)];

  function choose(side, id) {
    const next = side === 0 ? [id, bId === id ? aId : bId] : [aId === id ? bId : aId, id];
    setPick(next);
  }

  return (
    <section className="tn-section">
      <h2 className="tn-heading"><Swords /> Head to head</h2>
      <div className="tn-h2h">
        <div className="card tn-h2h-main">
          <div className="tn-h2h-players">
            {[A, B].map((p, side) => (
              <div key={side} className={`tn-h2h-side ${side ? 'is-right' : ''}`}>
                <Avatar player={p} players={players} size="xl" />
                <select
                  className="select tn-h2h-select"
                  value={p.id}
                  onChange={(e) => choose(side, Number(e.target.value))}
                  aria-label={side ? 'Second player' : 'First player'}
                >
                  {players.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </select>
              </div>
            ))}
          </div>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={`${A.id}-${B.id}`}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.25 }}
            >
              <p className="tn-h2h-score" aria-label={`Matches: ${shortName(A.name)} ${A.matches_won}, ${shortName(B.name)} ${B.matches_won}`}>
                <span>{A.matches_won}</span>
                <em>–</em>
                <span>{B.matches_won}</span>
              </p>
              <p className="tn-h2h-caption">matches won</p>
              <SplitBar a={A.matches_won} b={B.matches_won} tones={tones} />
              <div className="tn-h2h-rounds">
                <span><strong>{A.rounds_won}</strong> rounds</span>
                <span className="tn-h2h-mid">
                  {raw.matches_played} played{raw.matches_in_progress ? ` · ${raw.matches_in_progress} in play` : ''}
                </span>
                <span><strong>{B.rounds_won}</strong> rounds</span>
              </div>
              <SplitBar a={A.rounds_won} b={B.rounds_won} tones={tones} />
            </motion.div>
          </AnimatePresence>
        </div>

        <ul className="tn-pairs">
          {pairs.map(([x, y], i) => {
            const s = stats[i];
            const active = i === index;
            return (
              <li key={`${x.id}-${y.id}`}>
                <button
                  type="button"
                  className={`tn-pair ${active ? 'is-active' : ''}`}
                  aria-pressed={active}
                  onClick={() => { setPick(null); setFeatured(i); }}
                >
                  <span className="tn-pair-name">{shortName(x.name)}</span>
                  <span className="tn-pair-score">{s.a.matches_won}<em>–</em>{s.b.matches_won}</span>
                  <span className="tn-pair-name is-right">{shortName(y.name)}</span>
                  <span className="tn-pair-rounds">Rounds {s.a.rounds_won}–{s.b.rounds_won}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

const dateFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });

function RecentMatches({ matches, players }) {
  const navigate = useNavigate();
  if (!matches?.length) return null;
  return (
    <section className="tn-section">
      <h2 className="tn-heading"><Trophy /> Recent matches</h2>
      <div className="card tn-recent">
        {matches.map((m) => (
          <button key={m.id} type="button" className="tn-result" onClick={() => navigate(`/tennis/matches/${m.id}`)}>
            <span className="tn-result-date">{dateFmt.format(new Date(m.completed_at))}</span>
            <span className="tn-result-board">
              {[1, 2].map((side) => {
                const id = m[`player${side}_id`];
                const winner = m.winner_id === id;
                return (
                  <span key={side} className={`tn-result-row ${winner ? 'is-winner' : ''}`}>
                    <Avatar player={{ id, name: m[`player${side}_name`] }} players={players} size="xs" />
                    <span className="tn-result-name">{shortName(m[`player${side}_name`])}</span>
                    {winner && <Trophy className="tn-result-trophy" aria-label="Winner" />}
                    <span className="tn-result-sets">
                      {m.rounds.map((r) => (
                        <span key={r.round_number} className={r.winner_id === id ? 'is-won' : ''}>
                          {r[`player${side}_points`]}
                        </span>
                      ))}
                    </span>
                  </span>
                );
              })}
            </span>
            <ChevronRight className="tn-result-chev" aria-hidden="true" />
          </button>
        ))}
      </div>
    </section>
  );
}

/* ---------- Page ---------- */

export default function Tennis() {
  const [starting, setStarting] = useState(false);
  const { data: players, error: playersError, reload: reloadPlayers } = useCollection('/tennis/players');
  const { data: board, error: boardError, reload: reloadBoard } = useCollection('/tennis/leaderboard');
  const { data: live } = useCollection('/tennis/matches', { status: 'in_progress' });
  const { data: recent } = useCollection('/tennis/matches', { status: 'completed', limit: 12 });

  const error = playersError || boardError;
  const retry = () => { reloadPlayers(); reloadBoard(); };

  const noMatches = recent?.length === 0 && live?.length === 0;

  return (
    <>
      <PageHeader
        eyebrow="Friendly rivalry"
        eyebrowIcon={Trophy}
        title={<>On the <em>court</em></>}
        subtitle="Best of three rounds between Ahmad H, Ahmad Y and Bilal — scored point by point."
        actions={<button className="btn btn-primary" onClick={() => setStarting(true)} disabled={!players}><Plus /> New match</button>}
      />

      {error && !board ? (
        <ErrorBanner error={error} onRetry={retry} />
      ) : !players || !board ? (
        <div className="card card-pad"><SkeletonRows rows={3} /></div>
      ) : (
        <div className="tn-page">
          <LiveMatches matches={live} players={players} />
          {noMatches ? (
            <div className="card">
              <EmptyState
                title="No matches yet"
                message="Start the first match and score it point by point from the court."
                action={<button className="btn btn-primary" onClick={() => setStarting(true)}><Plus /> New match</button>}
              />
            </div>
          ) : (
            <>
              <Standings board={board} players={players} />
              <HeadToHead players={players} />
              <RecentMatches matches={recent} players={players} />
            </>
          )}
        </div>
      )}

      <Modal open={starting} onClose={() => setStarting(false)} title="New match" description="Pick the two players. First to win two rounds takes it.">
        {starting && players && <NewMatchForm players={players} onCancel={() => setStarting(false)} />}
      </Modal>
    </>
  );
}
