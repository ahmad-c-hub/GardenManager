import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useInView, useDragControls, useMotionValue, useReducedMotion, useTransform } from 'framer-motion';
import { Camera, ChevronLeft, ChevronRight, ImagePlus, Leaf, RefreshCw, Sprout, Trash2, X } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useToast } from '../lib/toast.jsx';
import { timeAgo } from '../lib/format.js';
import { feedSrcSet, imageVariant, isCloudinary, largeVariant, tinyVariant } from '../lib/cloudinary.js';
import { ConfirmDialog, ErrorBanner, FormError, Modal, PageHeader } from '../components/ui.jsx';
import { CornerFrond, JournalArt, Sprig } from '../components/Botanical.jsx';

const PAGE_SIZE = 20;
const MAX_BYTES = 8 * 1024 * 1024;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_NOTE = 1000;
const EASE = [0.22, 1, 0.36, 1];

/* ------------------------------------------------------------------ */
/* Photo shapes                                                         */
/* ------------------------------------------------------------------ */

// Each photo's aspect ratio is learned from a tiny (~1 KB) copy before its card
// is placed, so the masonry never reshuffles as full-size images stream in.
// The same tiny copy is the blurred placeholder. Kept across visits to the page.
const FALLBACK_RATIO = 4 / 5;
const shapes = new Map(); // image_url -> { ratio, placeholder }
const probing = new Set();
const clampRatio = (r) => (Number.isFinite(r) && r > 0 ? Math.min(Math.max(r, 0.5), 2) : FALLBACK_RATIO);

function useImageShapes(moments) {
  const [, rerender] = useState(0);
  useEffect(() => {
    for (const { image_url: url } of moments ?? []) {
      if (shapes.has(url) || probing.has(url)) continue;
      probing.add(url);
      const img = new Image();
      const settle = (ratio, placeholder) => {
        clearTimeout(timer);
        probing.delete(url);
        if (!shapes.has(url)) shapes.set(url, { ratio, placeholder });
        rerender((n) => n + 1);
      };
      // A slow probe mustn't hold the feed back: fall back to a portrait shape.
      const timer = setTimeout(() => settle(FALLBACK_RATIO, false), 4000);
      img.onload = () => settle(clampRatio(img.naturalWidth / img.naturalHeight), true);
      img.onerror = () => settle(FALLBACK_RATIO, false);
      img.src = tinyVariant(url);
    }
  }, [moments]);
}

/* ------------------------------------------------------------------ */
/* Sections + masonry                                                   */
/* ------------------------------------------------------------------ */

const monthYear = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' });
const fullDate = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const clockTime = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

function sectionLabel(timestamp, now) {
  const d = new Date(timestamp);
  if (now - d < 7 * 86_400_000) return 'This week';
  if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()) return 'Earlier this month';
  return monthYear.format(d);
}

/** Newest-first moments -> [{ label, items }], contiguous by label. */
function groupSections(moments) {
  const now = new Date();
  const sections = [];
  for (const m of moments) {
    const label = sectionLabel(m.created_at, now);
    if (sections.at(-1)?.label !== label) sections.push({ label, items: [] });
    sections.at(-1).items.push(m);
  }
  return sections;
}

/** Column count from the page's own width (the sidebar eats into the viewport). */
function useColumnCount(ref) {
  const [cols, setCols] = useState(1);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const measure = (w) => setCols(w >= 880 ? 3 : w >= 560 ? 2 : 1);
    measure(el.clientWidth);
    const ro = new ResizeObserver(([entry]) => measure(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return cols;
}

/**
 * Greedy masonry: each card goes to the currently shortest column, in feed
 * order, so the newest moments read across the top. Heights are in "card
 * widths". Appending cards never moves the ones already placed.
 */
function distribute(items, cols) {
  const columns = Array.from({ length: cols }, () => []);
  const heights = new Array(cols).fill(0);
  for (const m of items) {
    let c = 0;
    for (let k = 1; k < cols; k += 1) if (heights[k] < heights[c] - 0.01) c = k;
    const ratio = shapes.get(m.image_url)?.ratio ?? FALLBACK_RATIO;
    heights[c] += 1 / ratio + (m.note ? 0.3 : 0) + 0.1;
    columns[c].push(m);
  }
  return columns;
}

/* ------------------------------------------------------------------ */
/* Feed                                                                 */
/* ------------------------------------------------------------------ */

// Cards animate in once; a re-layout (resize, new post) mustn't replay it.
const revealed = new Set();

function MomentCard({ moment, column, onOpen }) {
  const reduce = useReducedMotion();
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: '0px 0px -10% 0px' });
  const [loaded, setLoaded] = useState(false);
  const [skipReveal] = useState(() => reduce || revealed.has(moment.id));
  const shape = shapes.get(moment.image_url);
  const url = moment.image_url;

  useEffect(() => {
    if (inView) revealed.add(moment.id);
  }, [inView, moment.id]);

  return (
    <motion.article
      ref={ref}
      className="moment"
      initial={skipReveal ? false : { opacity: 0, y: 28 }}
      animate={skipReveal || inView ? { opacity: 1, y: 0 } : undefined}
      // A gentle left-to-right stagger across each row.
      transition={{ duration: 0.9, ease: EASE, delay: column * 0.09 }}
    >
      <button type="button" className="moment-card" onClick={() => onOpen(moment.id)}>
        <span className={`moment-photo ${loaded ? 'is-loaded' : ''}`} style={{ aspectRatio: shape?.ratio ?? FALLBACK_RATIO }}>
          {shape?.placeholder && <img className="moment-placeholder" src={tinyVariant(url)} alt="" aria-hidden="true" />}
          <img
            className="moment-img"
            src={imageVariant(url, 'c_limit,w_800,f_auto,q_auto')}
            srcSet={feedSrcSet(url)}
            sizes="(max-width: 640px) 100vw, (max-width: 1280px) 50vw, 420px"
            alt={`Garden photo shared by ${moment.display_name}`}
            loading="lazy"
            decoding="async"
            onLoad={() => setLoaded(true)}
          />
          <span className="moment-scrim" aria-hidden="true" />
          <span className="moment-meta">
            <Sprout aria-hidden="true" />
            <strong>{moment.display_name}</strong>
            <span className="moment-meta-dot" aria-hidden="true" />
            <time dateTime={moment.created_at} title={new Date(moment.created_at).toLocaleString()}>
              {timeAgo(moment.created_at)}
            </time>
          </span>
        </span>
        {moment.note && <span className="moment-caption">{moment.note}</span>}
      </button>
    </motion.article>
  );
}

function Section({ label, items, cols, onOpen }) {
  const headingId = useId();
  return (
    <section className="moments-section" aria-labelledby={headingId}>
      <header className="moments-section-head">
        <Sprig className="moments-sprig" />
        <h2 id={headingId}>{label}</h2>
        <span className="moments-rule" aria-hidden="true" />
        <span className="moments-count">
          {items.length} {items.length === 1 ? 'moment' : 'moments'}
        </span>
      </header>
      <div className="masonry">
        {distribute(items, cols).map((column, c) => (
          <div className="masonry-col" key={c}>
            {column.map((m) => (
              <MomentCard key={m.id} moment={m} column={c} onOpen={onOpen} />
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

const SKELETON_RATIOS = [0.8, 1.3, 0.75, 1.1, 0.9, 1.4];

function FeedSkeleton({ cols }) {
  const columns = distribute(SKELETON_RATIOS.map((r, i) => ({ id: i, image_url: `skeleton-${i}`, r })), cols);
  return (
    <div className="moments-section" aria-busy="true" aria-label="Loading moments">
      <div className="moments-section-head">
        <div className="skeleton" style={{ width: 140, height: 22 }} />
      </div>
      <div className="masonry">
        {columns.map((column, c) => (
          <div className="masonry-col" key={c}>
            {column.map((s) => (
              <div key={s.id} className="moment-card is-skeleton">
                <div className="moment-photo skeleton" style={{ aspectRatio: s.r }} />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function EmptyJournal({ onShare }) {
  return (
    <motion.div
      className="moments-empty"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.8, ease: EASE }}
    >
      <JournalArt />
      <h2>The journal is waiting for its first page</h2>
      <p>
        Snap the seedlings, the first ripe tomato, or a quiet evening in the beds. Every moment you share
        lands here for everyone to enjoy.
      </p>
      <ShareButton onClick={onShare} label="Share the first moment" />
    </motion.div>
  );
}

function ShareButton({ onClick, label = 'Share a moment', className = '' }) {
  return (
    <button type="button" className={`btn moments-share ${className}`} onClick={onClick}>
      <Camera /> {label}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Lightbox                                                             */
/* ------------------------------------------------------------------ */

function Lightbox({ moments, index, onIndex, onClose, userId, onDelete, suspended }) {
  const moment = moments[index];
  const reduce = useReducedMotion();
  const closeRef = useRef(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  // The backdrop thins out as the photo is swiped down, like a native viewer.
  const scrimOpacity = useTransform(y, [0, 320], [1, 0.3]);
  // Swipes are for fingers; a mouse gets the arrow buttons and keys instead.
  const dragControls = useDragControls();
  const hasPrev = index > 0;
  const hasNext = index < moments.length - 1;
  const shape = shapes.get(moment.image_url);
  const created = new Date(moment.created_at);
  const mine = moment.user_id === userId;

  useEffect(() => {
    const previouslyFocused = document.activeElement;
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = overflow;
      previouslyFocused?.focus?.({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    if (suspended) return undefined; // the delete confirmation owns the keyboard
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft' && hasPrev) onIndex(index - 1);
      else if (e.key === 'ArrowRight' && hasNext) onIndex(index + 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [suspended, index, hasPrev, hasNext, onClose, onIndex]);

  function onDragEnd(_e, { offset, velocity }) {
    if (Math.abs(offset.x) > Math.abs(offset.y)) {
      if ((offset.x < -70 || velocity.x < -600) && hasNext) onIndex(index + 1);
      else if ((offset.x > 70 || velocity.x > 600) && hasPrev) onIndex(index - 1);
    } else if (offset.y > 110 || velocity.y > 700) {
      onClose();
    }
  }

  return (
    <motion.div
      className="lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={`Photo shared by ${moment.display_name}`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.22 } }}
      transition={{ duration: 0.3 }}
    >
      <motion.div className="lightbox-scrim" style={{ opacity: scrimOpacity }} onClick={onClose} />

      <button ref={closeRef} type="button" className="lightbox-btn lightbox-close" onClick={onClose} aria-label="Close">
        <X />
      </button>

      <motion.div
        className="lightbox-body"
        initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.94, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.96, transition: { duration: 0.2 } }}
        transition={{ type: 'spring', stiffness: 260, damping: 30 }}
      >
        <div className="lightbox-stage" onClick={(e) => e.target === e.currentTarget && onClose()}>
          <motion.div
            className="lightbox-photo"
            style={{ x, y, '--ratio': shape?.ratio ?? FALLBACK_RATIO }}
            drag
            dragListener={false}
            dragControls={dragControls}
            onPointerDown={(e) => e.pointerType === 'touch' && dragControls.start(e)}
            dragDirectionLock
            dragConstraints={{ left: 0, right: 0, top: 0, bottom: 0 }}
            dragElastic={{ left: 0.5, right: 0.5, top: 0.08, bottom: 0.9 }}
            onDragEnd={onDragEnd}
          >
            {shape?.placeholder && (
              <img className="lightbox-placeholder" src={tinyVariant(moment.image_url)} alt="" aria-hidden="true" draggable={false} />
            )}
            <AnimatePresence initial={false}>
              <motion.img
                key={moment.id}
                src={largeVariant(moment.image_url)}
                alt={moment.note ? `Garden photo: ${moment.note}` : `Garden photo shared by ${moment.display_name}`}
                draggable={false}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.35 }}
              />
            </AnimatePresence>
          </motion.div>

          {hasPrev && (
            <button type="button" className="lightbox-btn lightbox-nav prev" onClick={() => onIndex(index - 1)} aria-label="Previous photo">
              <ChevronLeft />
            </button>
          )}
          {hasNext && (
            <button type="button" className="lightbox-btn lightbox-nav next" onClick={() => onIndex(index + 1)} aria-label="Next photo">
              <ChevronRight />
            </button>
          )}
        </div>

        <aside className="lightbox-info">
          <div className="lightbox-poster">
            <span className="avatar" aria-hidden="true">
              {(moment.display_name || '?').trim().charAt(0).toUpperCase()}
            </span>
            <div>
              <strong>{moment.display_name}</strong>
              <time dateTime={moment.created_at}>{timeAgo(moment.created_at)}</time>
            </div>
          </div>
          {moment.note ? (
            <p className="lightbox-note">{moment.note}</p>
          ) : (
            <p className="lightbox-note is-empty">A quiet moment, no words needed.</p>
          )}
          <div className="lightbox-foot">
            <span className="lightbox-date">
              <Leaf aria-hidden="true" />
              {fullDate.format(created)} · {clockTime.format(created)}
            </span>
            {mine && (
              <button type="button" className="btn btn-ghost btn-sm lightbox-delete" onClick={() => onDelete(moment)}>
                <Trash2 /> Delete
              </button>
            )}
          </div>
        </aside>
      </motion.div>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* Share modal                                                          */
/* ------------------------------------------------------------------ */

function ShareForm({ onPosted, onCancel }) {
  const noteId = useId();
  const fileInput = useRef(null);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [ratio, setRatio] = useState(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);

  // Instant local preview; the object URL is freed when replaced or unmounted.
  useEffect(() => {
    if (!file) return undefined;
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function accept(chosen) {
    if (!chosen) return;
    if (!IMAGE_TYPES.includes(chosen.type)) {
      setError('Please choose a JPEG, PNG or WebP image.');
      return;
    }
    if (chosen.size > MAX_BYTES) {
      setError(`That photo is ${(chosen.size / 1024 / 1024).toFixed(1)} MB — the limit is 8 MB.`);
      return;
    }
    setError(null);
    setFile(chosen);
  }

  function pick(e) {
    const chosen = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file after an error
    accept(chosen);
  }

  function drop(e) {
    e.preventDefault();
    setDragging(false);
    if (!busy) accept(e.dataTransfer.files?.[0]);
  }

  async function submit(e) {
    e.preventDefault();
    if (!file || busy) return;
    setBusy(true);
    setError(null);
    try {
      const body = new FormData();
      body.append('image', file);
      if (note.trim()) body.append('note', note.trim());
      onPosted(await api.upload('/moments', body), ratio);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate>
      <AnimatePresence mode="wait" initial={false}>
        {preview ? (
          <motion.div
            key="preview"
            className="moment-preview"
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.3, ease: EASE }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={drop}
          >
            <img
              src={preview}
              alt="Selected photo preview"
              onLoad={(e) => setRatio(clampRatio(e.currentTarget.naturalWidth / e.currentTarget.naturalHeight))}
            />
            <AnimatePresence>
              {busy ? (
                <motion.div
                  key="uploading"
                  className="moment-uploading"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  role="status"
                >
                  <span className="moment-uploading-bar" aria-hidden="true" />
                  <span>Pressing it into the journal…</span>
                </motion.div>
              ) : (
                <motion.button
                  key="change"
                  type="button"
                  className="btn btn-secondary btn-sm moment-preview-change"
                  onClick={() => fileInput.current?.click()}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                >
                  <RefreshCw /> Change photo
                </motion.button>
              )}
            </AnimatePresence>
          </motion.div>
        ) : (
          <motion.button
            key="picker"
            type="button"
            className={`moment-dropzone ${dragging ? 'is-dragging' : ''}`}
            onClick={() => fileInput.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={drop}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <span className="moment-dropzone-icon"><ImagePlus /></span>
            <strong>Choose a photo</strong>
            <span>or drop it here · JPEG, PNG or WebP up to 8 MB</span>
          </motion.button>
        )}
      </AnimatePresence>

      {/* After the visible controls, so the modal's auto-focus lands on the picker. */}
      <input
        ref={fileInput}
        className="visually-hidden"
        type="file"
        accept={IMAGE_TYPES.join(',')}
        onChange={pick}
        disabled={busy}
        tabIndex={-1}
        aria-hidden="true"
      />

      <div className="field mt-5">
        <label className="field-label" htmlFor={noteId}>
          A note <span className="optional">optional</span>
        </label>
        <textarea
          id={noteId}
          className="textarea moment-note-input"
          rows={3}
          maxLength={MAX_NOTE}
          placeholder="First tomatoes blushing red on the south fence…"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          disabled={busy}
        />
        {note.length > MAX_NOTE * 0.8 && (
          <span className="field-hint">{MAX_NOTE - note.length} characters left</span>
        )}
      </div>

      <div className="mt-4">
        <FormError error={error} />
      </div>

      <div className="form-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={!file || busy}>
          {busy ? (
            <>
              <span className="spinner" /> Posting…
            </>
          ) : (
            <>
              <Leaf /> Post moment
            </>
          )}
        </button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                 */
/* ------------------------------------------------------------------ */

export default function Moments() {
  const { user } = useAuth();
  const toast = useToast();
  const pageRef = useRef(null);
  const cols = useColumnCount(pageRef);
  const [moments, setMoments] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [openId, setOpenId] = useState(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await api.get('/moments', { limit: PAGE_SIZE, offset: 0 });
      setMoments(data.moments);
      setHasMore(data.hasMore);
    } catch (err) {
      setError(err);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  useImageShapes(moments);

  // Only moments whose shape is known are laid out — always a prefix of the feed.
  let ready = 0;
  while (moments && ready < moments.length && shapes.has(moments[ready].image_url)) ready += 1;
  const visible = useMemo(() => moments?.slice(0, ready) ?? [], [moments, ready]);
  const sections = useMemo(() => groupSections(visible), [visible]);
  const openIndex = visible.findIndex((m) => m.id === openId);

  async function loadMore() {
    setLoadingMore(true);
    try {
      const data = await api.get('/moments', { limit: PAGE_SIZE, offset: moments.length });
      // Skip anything already shown (a new post can shift the offsets).
      setMoments((prev) => {
        const seen = new Set(prev.map((m) => m.id));
        return [...prev, ...data.moments.filter((m) => !seen.has(m.id))];
      });
      setHasMore(data.hasMore);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoadingMore(false);
    }
  }

  function posted(moment, ratio) {
    // We already know its shape from the local preview: no need to wait for a probe.
    if (ratio) shapes.set(moment.image_url, { ratio, placeholder: isCloudinary(moment.image_url) });
    setSharing(false);
    setMoments((prev) => [moment, ...(prev ?? [])]);
    toast.success('Moment shared');
  }

  async function remove() {
    await api.del(`/moments/${deleting.id}`);
    setMoments((prev) => prev.filter((m) => m.id !== deleting.id));
    setDeleting(null);
    setOpenId(null);
    toast.success('Moment deleted');
  }

  const closeLightbox = useCallback(() => setOpenId(null), []);
  const showIndex = useCallback((i) => setOpenId(visible[i]?.id ?? null), [visible]);
  const openShare = () => setSharing(true);
  const settling = moments && ready < moments.length;

  return (
    <div className="moments-page" ref={pageRef}>
      <div className="moments-hero">
        <CornerFrond className="moments-hero-art" color="#b7cbb0" />
        <PageHeader
          eyebrow="Garden journal"
          eyebrowIcon={Leaf}
          title={<>Moments <em>from the garden</em></>}
          subtitle="Little snapshots from the beds: first shoots, big harvests, muddy boots and golden evenings."
          actions={moments?.length > 0 && <ShareButton onClick={openShare} className="moments-share-header" />}
        />
      </div>

      {error && !moments ? (
        <ErrorBanner error={error} onRetry={load} />
      ) : !moments || (moments.length > 0 && ready === 0) ? (
        <FeedSkeleton cols={cols} />
      ) : moments.length === 0 ? (
        <EmptyJournal onShare={openShare} />
      ) : (
        <>
          <div className="moments-feed">
            {sections.map((s) => (
              <Section key={s.label} label={s.label} items={s.items} cols={cols} onOpen={setOpenId} />
            ))}
          </div>

          {hasMore || settling ? (
            <div className="moments-more">
              <span className="moments-rule" aria-hidden="true" />
              <button className="btn btn-secondary" onClick={loadMore} disabled={loadingMore || settling}>
                {loadingMore || settling ? <span className="spinner" /> : 'Show earlier moments'}
              </button>
              <span className="moments-rule" aria-hidden="true" />
            </div>
          ) : (
            <p className="moments-end">
              <Sprig className="moments-sprig" />
              The first page of our journal
            </p>
          )}
        </>
      )}

      {/* On phones the share action floats within thumb reach. */}
      {moments?.length > 0 && (
        <motion.button
          type="button"
          className="moments-fab"
          onClick={openShare}
          initial={{ opacity: 0, y: 24, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ delay: 0.4, duration: 0.6, ease: EASE }}
        >
          <Camera /> Share a moment
        </motion.button>
      )}

      <AnimatePresence>
        {openIndex >= 0 && (
          <Lightbox
            key="lightbox"
            moments={visible}
            index={openIndex}
            onIndex={showIndex}
            onClose={closeLightbox}
            userId={user?.id}
            onDelete={setDeleting}
            suspended={!!deleting}
          />
        )}
      </AnimatePresence>

      <Modal
        open={sharing}
        onClose={() => setSharing(false)}
        title="Share a moment"
        description="A photo from the garden, with a few words if you like."
      >
        {sharing && <ShareForm onPosted={posted} onCancel={() => setSharing(false)} />}
      </Modal>

      <ConfirmDialog
        open={!!deleting}
        title="Delete this moment?"
        message="The photo and its note will be removed for everyone. This can’t be undone."
        onConfirm={remove}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
