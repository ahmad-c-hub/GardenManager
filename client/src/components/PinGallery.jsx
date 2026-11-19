import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { AnimatePresence, animate, motion, useDragControls, useMotionValue, useReducedMotion } from 'framer-motion';
import {
  ChevronLeft,
  ChevronRight,
  EllipsisVertical,
  Footprints,
  ImagePlus,
  Move,
  Pencil,
  Trash2,
  X,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { useToast } from '../lib/toast.jsx';
import { imageVariant } from '../lib/cloudinary.js';
import { checkUpload, mediaKindOf, uploadToCloudinary } from '../lib/uploadToCloudinary.js';
import { runLimited } from '../lib/gardenWalk.js';
import { ConfirmDialog, FormError, Modal } from './ui.jsx';

const EASE = [0.22, 1, 0.36, 1];
const MAX_LABEL = 80;
const MAX_NOTE = 1000;
const MAX_FILES = 20;
const UPLOAD_CONCURRENCY = 2;
// Touches this close to a video's bottom edge belong to its native controls (scrubber, play, volume), not the carousel.
const VIDEO_CONTROLS_ZONE = 72;
const MAX_DOTS = 12;

const fullDate = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

/* ------------------------------------------------------------------ */
/* Shared bits (also used by the map page)                              */
/* ------------------------------------------------------------------ */

export function UploadStatus({ upload, label, savingLabel = 'Laying it out…' }) {
  const pct = Math.round(upload.progress * 100);
  return (
    <div className="gw-upload-status">
      <span>{upload.saving ? savingLabel : `${label}… ${pct}%`}</span>
      <span className="gw-progress" aria-hidden="true">
        <span style={{ transform: `scaleX(${upload.saving ? 1 : upload.progress})` }} />
      </span>
    </div>
  );
}

/** A small "⋯" menu. `placement="up"` opens it above the button (for bottom bars). */
export function OverflowMenu({ items, disabled, placement = 'down', className = 'btn btn-secondary', onOpenChange }) {
  const [open, setOpenState] = useState(false);
  const ref = useRef(null);
  const menuId = useId();
  const setOpen = useCallback(
    (value) => {
      setOpenState(value);
      onOpenChange?.(value);
    },
    [onOpenChange],
  );

  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => !ref.current?.contains(e.target) && setOpen(false);
    const key = (e) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setOpen(false);
    };
    document.addEventListener('pointerdown', away);
    window.addEventListener('keydown', key, true);
    ref.current?.querySelector('[role="menuitem"]')?.focus();
    return () => {
      document.removeEventListener('pointerdown', away);
      window.removeEventListener('keydown', key, true);
    };
  }, [open, setOpen]);

  return (
    <div className={`gw-menu is-${placement}`} ref={ref}>
      <button
        type="button"
        className={`${className} gw-menu-btn`}
        onClick={() => setOpen(!open)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label="More options"
        disabled={disabled}
      >
        <EllipsisVertical />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            id={menuId}
            className="gw-menu-list"
            role="menu"
            initial={{ opacity: 0, y: placement === 'up' ? 6 : -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.12 } }}
            transition={{ type: 'spring', stiffness: 520, damping: 34 }}
          >
            {items.map(({ label, icon: Icon, onSelect, danger }) => (
              <button
                key={label}
                type="button"
                role="menuitem"
                className={danger ? 'is-danger' : undefined}
                onClick={() => {
                  setOpen(false);
                  onSelect();
                }}
              >
                <Icon /> {label}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Carousel                                                             */
/* ------------------------------------------------------------------ */

function ImageSlide({ item, label }) {
  return (
    <img
      className="gwg-media"
      src={imageVariant(item.media_url, 'c_limit,w_1600')}
      alt={`Photo of ${label}`}
      loading="lazy"
      decoding="async"
      draggable={false}
    />
  );
}

function VideoSlide({ item, label, active }) {
  const ref = useRef(null);
  // Swiping away (or walking on) pauses; unmounting on close stops it anyway.
  useEffect(() => {
    if (!active) ref.current?.pause();
  }, [active]);
  return (
    <video
      ref={ref}
      className="gwg-media"
      src={item.media_url}
      poster={item.poster_url}
      // Real dimensions give the element the video's shape, so the controls sit on the video's bottom edge.
      width={item.width ?? undefined}
      height={item.height ?? undefined}
      controls
      playsInline
      preload="metadata"
      aria-label={`Video of ${label}`}
    />
  );
}

/**
 * Swipeable track. Only the current slide and its neighbours are mounted, so a
 * pin with dozens of items stays light. Touch swipes drive it; a mouse uses the
 * arrow buttons and keys, so clicking a video never turns into a drag.
 */
function Carousel({ media, index, onIndex, label }) {
  const reduce = useReducedMotion();
  const viewport = useRef(null);
  const [width, setWidth] = useState(0);
  const x = useMotionValue(0);
  const dragControls = useDragControls();
  const count = media.length;

  useLayoutEffect(() => {
    const el = viewport.current;
    if (!el) return undefined;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const settle = useCallback(
    (to, instant = false) => {
      if (instant || reduce) x.set(-to * width);
      else animate(x, -to * width, { type: 'spring', stiffness: 340, damping: 36 });
    },
    [x, width, reduce],
  );

  // Snap without animating on resize; glide on a slide change.
  const lastWidth = useRef(width);
  useEffect(() => {
    settle(index, lastWidth.current !== width);
    lastWidth.current = width;
  }, [index, width, settle]);

  function pointerDown(e) {
    if (e.pointerType === 'mouse' || count < 2) return;
    const video = e.target.closest?.('video');
    if (video && e.clientY > video.getBoundingClientRect().bottom - VIDEO_CONTROLS_ZONE) return;
    dragControls.start(e);
  }

  function dragEnd(_e, { offset, velocity }) {
    let to = index;
    if ((offset.x < -width * 0.2 || velocity.x < -500) && index < count - 1) to = index + 1;
    else if ((offset.x > width * 0.2 || velocity.x > 500) && index > 0) to = index - 1;
    if (to === index) settle(index);
    else onIndex(to);
  }

  return (
    <div className="gwg-carousel">
      <div className="gwg-viewport" ref={viewport}>
        <motion.div
          className="gwg-track"
          style={{ x }}
          drag={count > 1 ? 'x' : false}
          dragListener={false}
          dragControls={dragControls}
          dragConstraints={{ left: -(count - 1) * width, right: 0 }}
          dragElastic={0.16}
          dragMomentum={false}
          onPointerDown={pointerDown}
          onDragEnd={dragEnd}
        >
          {media.map((item, i) => {
            const near = Math.abs(i - index) <= 1;
            return (
              <div
                key={item.id}
                className="gwg-slide"
                aria-hidden={i !== index}
                inert={i !== index ? true : undefined}
              >
                {near &&
                  (item.media_type === 'video' ? (
                    <VideoSlide item={item} label={label} active={i === index} />
                  ) : (
                    <ImageSlide item={item} label={label} />
                  ))}
              </div>
            );
          })}
        </motion.div>

        {index > 0 && (
          <button type="button" className="gwg-slide-btn prev" onClick={() => onIndex(index - 1)} aria-label="Previous photo">
            <ChevronLeft />
          </button>
        )}
        {index < count - 1 && (
          <button type="button" className="gwg-slide-btn next" onClick={() => onIndex(index + 1)} aria-label="Next photo">
            <ChevronRight />
          </button>
        )}
      </div>

      {count > 1 && (
        <div className="gwg-pager">
          {count <= MAX_DOTS && (
            <div className="gwg-dots">
              {media.map((item, i) => (
                <button
                  key={item.id}
                  type="button"
                  className={i === index ? 'is-active' : undefined}
                  onClick={() => onIndex(i)}
                  aria-label={`Show item ${i + 1} of ${count}`}
                  aria-current={i === index ? 'true' : undefined}
                />
              ))}
            </div>
          )}
          <span className="gwg-counter" aria-live="polite">
            {index + 1} / {count}
          </span>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Header                                                               */
/* ------------------------------------------------------------------ */

function PinHeader({ pin }) {
  const noteRef = useRef(null);
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);

  useLayoutEffect(() => {
    const el = noteRef.current;
    if (!el || expanded) return;
    setOverflowing(el.scrollHeight > el.clientHeight + 1);
  }, [pin.note, expanded]);

  return (
    <header className="gwg-header">
      <h2>{pin.label}</h2>
      {pin.note && (
        <div className="gwg-note-wrap">
          <p ref={noteRef} className={`gwg-note ${expanded ? 'is-expanded' : ''}`}>
            {pin.note}
          </p>
          {(overflowing || expanded) && (
            <button type="button" className="gwg-note-toggle" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
              {expanded ? 'Show less' : 'Show more'}
            </button>
          )}
        </div>
      )}
      <p className="gwg-byline">
        {pin.created_by_name ? `by ${pin.created_by_name} · ` : ''}
        <time dateTime={pin.created_at}>{fullDate.format(new Date(pin.created_at))}</time>
      </p>
    </header>
  );
}

/* ------------------------------------------------------------------ */
/* Edit form                                                            */
/* ------------------------------------------------------------------ */

function EditPinForm({ pin, onSaved, onCancel }) {
  const labelId = useId();
  const noteId = useId();
  const [label, setLabel] = useState(pin.label);
  const [note, setNote] = useState(pin.note ?? '');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (!label.trim()) return setError('Give this spot a name.');
    setBusy(true);
    setError(null);
    try {
      onSaved(await api.put(`/garden-walk/pins/${pin.id}`, { label: label.trim(), note: note.trim() || null }));
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <form className="gw-form" onSubmit={submit} noValidate>
      <div className="field">
        <label className="field-label" htmlFor={labelId}>Name</label>
        <input id={labelId} className="input" maxLength={MAX_LABEL} value={label} onChange={(e) => setLabel(e.target.value)} disabled={busy} autoComplete="off" />
      </div>
      <div className="field mt-4">
        <label className="field-label" htmlFor={noteId}>
          Note <span className="optional">optional</span>
        </label>
        <textarea id={noteId} className="textarea" rows={4} maxLength={MAX_NOTE} value={note} onChange={(e) => setNote(e.target.value)} disabled={busy} />
      </div>
      <div className="mt-4">
        <FormError error={error} />
      </div>
      <div className="form-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={busy || !label.trim()}>
          {busy ? <span className="spinner" /> : 'Save changes'}
        </button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* Gallery                                                              */
/* ------------------------------------------------------------------ */

const shortName = (pin) => (pin.label.length > 22 ? `${pin.label.slice(0, 21)}…` : pin.label);

/**
 * Full-screen (phones) / large centred (desktop) gallery for one pin, with the
 * walk controls. Mounted inside <AnimatePresence custom={origin}> by the page:
 * it opens from, and closes back into, the pin on the map.
 */
export function PinGallery({ pin, origin, prevPin, nextPin, travel, onPrev, onNext, onClose, onPinChange, onPinDeleted, onMove }) {
  const reduce = useReducedMotion();
  const toast = useToast();
  const closeRef = useRef(null);
  const fileInput = useRef(null);
  const abortRef = useRef(null);
  const [view, setView] = useState({ pinId: pin.id, index: 0 });
  const [dialog, setDialog] = useState(null); // null | 'media' | 'last' | 'pin' | 'edit'
  const [menuOpen, setMenuOpen] = useState(false);
  const [upload, setUpload] = useState(null); // { progress, done, total }

  // Each pin opens on its first item; a walk to another pin starts over.
  const index = view.pinId === pin.id ? Math.min(view.index, pin.media.length - 1) : 0;
  const setIndex = useCallback((i) => setView({ pinId: pin.id, index: i }), [pin.id]);
  const current = pin.media[index];
  // Stable, so Modal doesn't re-run its focus/scroll-lock effect on every render.
  const closeDialog = useCallback(() => setDialog(null), []);
  const suspended = dialog !== null || menuOpen;
  const busy = upload !== null;

  useEffect(() => {
    const previouslyFocused = document.activeElement;
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus({ preventScroll: true });
    return () => {
      document.body.style.overflow = overflow;
      abortRef.current?.abort();
      previouslyFocused?.focus?.({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    if (suspended) return undefined; // a dialog or menu owns the keyboard
    const onKey = (e) => {
      if (e.target.closest?.('input, textarea, video')) return;
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft' && index > 0) setIndex(index - 1);
      else if (e.key === 'ArrowRight' && index < pin.media.length - 1) setIndex(index + 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [suspended, index, pin.media.length, setIndex, onClose]);

  async function addMedia(fileList) {
    const files = [...fileList];
    if (files.length === 0) return;
    const problems = [];
    const ok = [];
    for (const file of files) {
      const kind = mediaKindOf(file);
      const problem = checkUpload(file, kind ?? 'image');
      if (problem) problems.push(problem);
      else ok.push({ file, kind, progress: 0 });
    }
    if (ok.length > MAX_FILES) {
      problems.push(`Add up to ${MAX_FILES} files at a time.`);
      ok.length = MAX_FILES;
    }
    if (problems.length) toast.error(problems.join(' '));
    if (ok.length === 0) return;

    const controller = new AbortController();
    abortRef.current = controller;
    const progressOf = () => ok.reduce((s, f) => s + f.progress, 0) / ok.length;
    const results = new Array(ok.length);
    let done = 0;
    setUpload({ progress: 0, done, total: ok.length });
    try {
      await runLimited(ok.map((f, i) => ({ ...f, i })), UPLOAD_CONCURRENCY, async (item) => {
        results[item.i] = await uploadToCloudinary(
          item.file,
          item.kind,
          (p) => {
            ok[item.i].progress = p;
            setUpload((u) => u && { ...u, progress: progressOf() });
          },
          { signal: controller.signal },
        );
        done += 1;
        setUpload((u) => u && { ...u, done });
      });
      setUpload((u) => u && { ...u, saving: true });
      const firstNew = pin.media.length;
      const updated = await api.post(`/garden-walk/pins/${pin.id}/media`, { media: results });
      onPinChange(updated);
      setView({ pinId: pin.id, index: firstNew });
      toast.success(ok.length === 1 ? 'Added to the spot' : `${ok.length} files added`);
    } catch (err) {
      if (err.name !== 'AbortError') toast.error(err.message);
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setUpload(null);
    }
  }

  async function deleteCurrent() {
    await api.del(`/garden-walk/pins/${pin.id}/media/${current.id}`);
    const media = pin.media.filter((m) => m.id !== current.id).map((m, i) => ({ ...m, position: i }));
    onPinChange({ ...pin, media, media_count: media.length });
    setView({ pinId: pin.id, index: Math.min(index, media.length - 1) });
    setDialog(null);
    toast.success(current.media_type === 'video' ? 'Video deleted' : 'Photo deleted');
  }

  async function deletePin() {
    await api.del(`/garden-walk/pins/${pin.id}`);
    setDialog(null);
    onPinDeleted(pin);
    toast.success(`“${pin.label}” removed`);
  }

  // Content slides in from the direction of travel on the map.
  const shift = { x: travel.x * 90, y: travel.y * 60 };
  const contentVariants = reduce
    ? { enter: { opacity: 0 }, center: { opacity: 1, x: 0, y: 0 }, leave: { opacity: 0 } }
    : {
        enter: (t) => ({ opacity: 0, x: t.x, y: t.y }),
        center: { opacity: 1, x: 0, y: 0 },
        leave: (t) => ({ opacity: 0, x: -t.x, y: -t.y }),
      };

  const walkPrev = prevPin && (
    <button type="button" className="gwg-walk prev" onClick={onPrev} disabled={busy} aria-label={`Back to ${prevPin.label}`}>
      <ChevronLeft />
      <span>
        <small>Back</small>
        {shortName(prevPin)}
      </span>
    </button>
  );
  const walkNext = nextPin && (
    <button type="button" className="gwg-walk next" onClick={onNext} disabled={busy} aria-label={`Next: ${nextPin.label}`}>
      <span>
        <small>Next</small>
        {shortName(nextPin)}
      </span>
      <ChevronRight />
    </button>
  );

  return (
    <>
      <motion.div
        className="gwg-scrim"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0, transition: { duration: 0.25 } }}
        transition={{ duration: 0.3 }}
        onClick={onClose}
      />
      <motion.div
        className="gwg"
        role="dialog"
        aria-modal="true"
        aria-label={pin.label}
        custom={origin}
        variants={{
          closed: (o) =>
            reduce || !o
              ? { opacity: 0 }
              : { opacity: 0, scale: 0.2, x: o.x - window.innerWidth / 2, y: o.y - window.innerHeight / 2 },
          open: { opacity: 1, scale: 1, x: 0, y: 0 },
        }}
        initial="closed"
        animate="open"
        exit="closed"
        transition={reduce ? { duration: 0.2 } : { type: 'spring', stiffness: 300, damping: 32, mass: 0.9 }}
      >
        <div className="gwg-top">
          <span className="gwg-eyebrow">
            <Footprints aria-hidden="true" /> Garden walk
          </span>
          <button ref={closeRef} type="button" className="gwg-icon-btn" onClick={onClose} aria-label="Close">
            <X />
          </button>
        </div>

        <div className="gwg-stage">
          <AnimatePresence initial={false} custom={shift}>
            <motion.div
              key={pin.id}
              className="gwg-content"
              custom={shift}
              variants={contentVariants}
              initial="enter"
              animate="center"
              exit="leave"
              transition={reduce ? { duration: 0.2 } : { type: 'spring', stiffness: 260, damping: 30 }}
            >
              <PinHeader pin={pin} />
              <Carousel media={pin.media} index={index} onIndex={setIndex} label={pin.label} />
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Desktop: the walk lives at the panel's sides. */}
        <div className="gwg-side prev">{walkPrev}</div>
        <div className="gwg-side next">{walkNext}</div>

        <div className="gwg-bottom">
          {(prevPin || nextPin) && (
            <div className="gwg-walk-row">
              {walkPrev ?? <span />}
              {walkNext ?? <span />}
            </div>
          )}

          <div className="gwg-actions">
            {busy ? (
              <div className="gwg-uploading" role="status">
                <UploadStatus upload={upload} label={`Uploading ${Math.min(upload.done + 1, upload.total)} of ${upload.total}`} savingLabel="Adding to the spot…" />
                <button type="button" className="gwg-icon-btn" onClick={() => abortRef.current?.abort()} aria-label="Cancel upload">
                  <X />
                </button>
              </div>
            ) : (
              <button type="button" className="gwg-action primary" onClick={() => fileInput.current?.click()}>
                <ImagePlus /> <span>Add photo/video</span>
              </button>
            )}
            <button
              type="button"
              className="gwg-action"
              onClick={() => setDialog(pin.media.length === 1 ? 'last' : 'media')}
              disabled={busy || !current}
              aria-label={current?.media_type === 'video' ? 'Delete this video' : 'Delete this photo'}
            >
              <Trash2 />
            </button>
            <OverflowMenu
              placement="up"
              className="gwg-action"
              disabled={busy}
              onOpenChange={setMenuOpen}
              items={[
                { label: 'Edit pin', icon: Pencil, onSelect: () => setDialog('edit') },
                { label: 'Move pin', icon: Move, onSelect: () => onMove(pin) },
                { label: 'Delete pin', icon: Trash2, onSelect: () => setDialog('pin'), danger: true },
              ]}
            />
          </div>
        </div>

        <input
          ref={fileInput}
          className="visually-hidden"
          type="file"
          multiple
          accept="image/*,video/*"
          onChange={(e) => {
            const files = e.target.files ?? [];
            addMedia(files);
            e.target.value = '';
          }}
          tabIndex={-1}
          aria-hidden="true"
        />
      </motion.div>

      <ConfirmDialog
        open={dialog === 'media'}
        title={current?.media_type === 'video' ? 'Delete this video?' : 'Delete this photo?'}
        message={`It will be removed from “${pin.label}” for everyone. This can’t be undone.`}
        onConfirm={deleteCurrent}
        onCancel={closeDialog}
      />
      <ConfirmDialog
        open={dialog === 'last'}
        title="Delete the whole spot?"
        message={`This is the only photo or video in “${pin.label}”, and every spot needs at least one. Delete the spot from the map instead?`}
        confirmLabel="Delete spot"
        onConfirm={deletePin}
        onCancel={closeDialog}
      />
      <ConfirmDialog
        open={dialog === 'pin'}
        title={`Delete “${pin.label}”?`}
        message={`The pin and its ${pin.media_count} ${pin.media_count === 1 ? 'photo or video' : 'photos and videos'} will be removed for everyone. This can’t be undone.`}
        confirmLabel="Delete pin"
        onConfirm={deletePin}
        onCancel={closeDialog}
      />
      <Modal open={dialog === 'edit'} onClose={closeDialog} title="Edit spot">
        {dialog === 'edit' && (
          <EditPinForm
            pin={pin}
            onCancel={closeDialog}
            onSaved={(updated) => {
              onPinChange(updated);
              setDialog(null);
              toast.success('Spot updated');
            }}
          />
        )}
      </Modal>
    </>
  );
}
