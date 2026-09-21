import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Camera, ImagePlus, Leaf, RefreshCw, Sprout, Trash2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useToast } from '../lib/toast.jsx';
import { timeAgo } from '../lib/format.js';
import { ConfirmDialog, EmptyState, ErrorBanner, FormError, Modal, PageHeader } from '../components/ui.jsx';

const PAGE_SIZE = 20;
const MAX_BYTES = 8 * 1024 * 1024;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_NOTE = 1000;

/* ------------------------------------------------------------------ */
/* Share modal                                                          */
/* ------------------------------------------------------------------ */

function ShareForm({ onPosted, onCancel }) {
  const noteId = useId();
  const fileInput = useRef(null);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  // Instant local preview; the object URL is freed when replaced or unmounted.
  useEffect(() => {
    if (!file) return undefined;
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function pick(e) {
    const chosen = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file after an error
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

  async function submit(e) {
    e.preventDefault();
    if (!file || busy) return;
    setBusy(true);
    setError(null);
    try {
      const body = new FormData();
      body.append('image', file);
      if (note.trim()) body.append('note', note.trim());
      onPosted(await api.upload('/moments', body));
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
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <img src={preview} alt="Selected photo preview" />
            <button type="button" className="btn btn-secondary btn-sm moment-preview-change" onClick={() => fileInput.current?.click()} disabled={busy}>
              <RefreshCw /> Change photo
            </button>
          </motion.div>
        ) : (
          <motion.button
            key="picker"
            type="button"
            className="moment-dropzone"
            onClick={() => fileInput.current?.click()}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <span className="moment-dropzone-icon"><ImagePlus /></span>
            <strong>Choose a photo</strong>
            <span>JPEG, PNG or WebP · up to 8 MB</span>
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
/* Feed                                                                 */
/* ------------------------------------------------------------------ */

function MomentCard({ moment, index, mine, onDelete }) {
  const [loaded, setLoaded] = useState(false);

  return (
    <motion.article
      layout
      className="moment-card"
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.2 } }}
      // Stagger only within a page, so "load more" doesn't wait on earlier cards.
      transition={{ type: 'spring', stiffness: 260, damping: 30, delay: Math.min(index % PAGE_SIZE, 6) * 0.06 }}
    >
      <div className={`moment-photo ${loaded ? 'is-loaded' : ''}`}>
        <img
          src={moment.image_url}
          alt={moment.note ? `Garden photo: ${moment.note}` : `Garden photo shared by ${moment.display_name}`}
          loading={index < 2 ? 'eager' : 'lazy'}
          decoding="async"
          onLoad={() => setLoaded(true)}
        />
      </div>

      <div className="moment-body">
        {moment.note && <p className="moment-note">{moment.note}</p>}
        <footer className="moment-footer">
          <span className="moment-by">
            <Sprout aria-hidden="true" />
            <strong>{moment.display_name}</strong>
            <span aria-hidden="true">·</span>
            <time dateTime={moment.created_at} title={new Date(moment.created_at).toLocaleString()}>
              {timeAgo(moment.created_at)}
            </time>
          </span>
          {mine && (
            <button className="icon-btn danger" onClick={() => onDelete(moment)} aria-label="Delete this moment" title="Delete">
              <Trash2 />
            </button>
          )}
        </footer>
      </div>
    </motion.article>
  );
}

function FeedSkeleton() {
  return (
    <div className="moments-feed" aria-busy="true" aria-label="Loading moments">
      {[0, 1].map((i) => (
        <div key={i} className="moment-card">
          <div className="moment-photo skeleton" />
          <div className="moment-body">
            <div className="skeleton" style={{ width: '80%', height: 16, marginBottom: 10 }} />
            <div className="skeleton" style={{ width: '40%', height: 12 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function Moments() {
  const { user } = useAuth();
  const toast = useToast();
  const [moments, setMoments] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [deleting, setDeleting] = useState(null);

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

  function posted(moment) {
    setSharing(false);
    setMoments((prev) => [moment, ...(prev ?? [])]);
    toast.success('Moment shared');
  }

  async function remove() {
    await api.del(`/moments/${deleting.id}`);
    setMoments((prev) => prev.filter((m) => m.id !== deleting.id));
    setDeleting(null);
    toast.success('Moment deleted');
  }

  const shareButton = (
    <button className="btn btn-accent" onClick={() => setSharing(true)}>
      <Camera /> Share a moment
    </button>
  );

  return (
    <>
      <PageHeader
        eyebrow="Garden journal"
        eyebrowIcon={Leaf}
        title="Moments"
        subtitle="Little snapshots from the garden: first shoots, big harvests, muddy boots."
        actions={shareButton}
      />

      {error && !moments ? (
        <ErrorBanner error={error} onRetry={load} />
      ) : !moments ? (
        <FeedSkeleton />
      ) : moments.length === 0 ? (
        <div className="card card-pad">
          <EmptyState
            title="No moments yet — share the first one 🌱"
            message="Snap the seedlings, the first ripe tomato, or a quiet evening in the beds."
            action={shareButton}
          />
        </div>
      ) : (
        <>
          <div className="moments-feed">
            <AnimatePresence initial={true}>
              {moments.map((m, i) => (
                <MomentCard key={m.id} moment={m} index={i} mine={m.user_id === user?.id} onDelete={setDeleting} />
              ))}
            </AnimatePresence>
          </div>
          {hasMore && (
            <div className="moments-more">
              <button className="btn btn-secondary" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? <span className="spinner" /> : 'Show earlier moments'}
              </button>
            </div>
          )}
        </>
      )}

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
    </>
  );
}
