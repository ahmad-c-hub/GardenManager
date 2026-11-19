import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { AlertCircle, Check, Film, Footprints, ImagePlus, ImageUp, MapPinPlus, Maximize, Minus, Move, Plus, RotateCcw, X } from 'lucide-react';
import { TransformComponent, TransformWrapper, useControls } from 'react-zoom-pan-pinch';
import { ApiError, api } from '../lib/api.js';
import { useToast } from '../lib/toast.jsx';
import { imageVariant, isCloudinary } from '../lib/cloudinary.js';
import { checkUpload, mediaKindOf, uploadToCloudinary } from '../lib/uploadToCloudinary.js';
import { nextInWalk, runLimited, travelVector } from '../lib/gardenWalk.js';
import { useFocusTrap } from '../lib/useFocusTrap.js';
import { ConfirmDialog, ErrorBanner, FormError, Modal, PageHeader } from '../components/ui.jsx';
import { GardenPlanArt } from '../components/Botanical.jsx';
import { OverflowMenu, PinGallery, UploadStatus } from '../components/PinGallery.jsx';

const EASE = [0.22, 1, 0.36, 1];
const MAX_LABEL = 80;
const MAX_NOTE = 1000;
const MAX_FILES = 20; // the server accepts up to 20 per request
const UPLOAD_CONCURRENCY = 2;
const MAP_WIDTHS = [800, 1200, 1600];

const clamp = (v) => Math.min(100, Math.max(0, v));
const round2 = (v) => Math.round(v * 100) / 100;

/** Percent coordinates of a viewport point on the map IMAGE (not its container). */
function pointOnImage(img, clientX, clientY) {
  const r = img.getBoundingClientRect();
  return {
    x: round2(clamp(((clientX - r.left) / r.width) * 100)),
    y: round2(clamp(((clientY - r.top) / r.height) * 100)),
  };
}

/** Labels near the left/right edge hang inwards so they're never cut off. */
const labelSide = (x) => (x < 18 ? 'start' : x > 82 ? 'end' : 'center');

const mapSrcSet = (url) =>
  isCloudinary(url) ? MAP_WIDTHS.map((w) => `${imageVariant(url, `c_limit,w_${w}`)} ${w}w`).join(', ') : undefined;

/* ------------------------------------------------------------------ */
/* Marker                                                               */
/* ------------------------------------------------------------------ */

/** Terracotta teardrop with a cream ring and a leaf; its tip is the bottom-centre of the box. */
function MarkerArt() {
  return (
    <svg className="gw-marker-art" viewBox="0 0 28 36" aria-hidden="true">
      <path
        className="gw-marker-body"
        d="M14 34.5C14 34.5 2.5 22 2.5 13.5a11.5 11.5 0 0 1 23 0C25.5 22 14 34.5 14 34.5Z"
      />
      <path className="gw-marker-leaf" d="M9.2 17.6c0-5.2 3.6-8.6 9.4-8.8 0 5.6-3.6 8.8-9.4 8.8Z" />
      <path className="gw-marker-vein" d="M10.4 16.4l5.6-5.2" />
    </svg>
  );
}

function PinMarker({ pin, delay, selected, inert, onSelect }) {
  const reduce = useReducedMotion();
  return (
    <button
      type="button"
      className={`gw-pin ${selected ? 'is-selected' : ''}`}
      style={{ left: `${pin.x_percent}%`, top: `${pin.y_percent}%` }}
      data-side={labelSide(pin.x_percent)}
      data-pin-id={pin.id}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(pin, e);
      }}
      tabIndex={inert ? -1 : 0}
      aria-haspopup="dialog"
      aria-label={`${pin.label}, ${pin.media_count} ${pin.media_count === 1 ? 'photo or video' : 'photos and videos'}`}
    >
      <motion.span
        className="gw-pin-drop"
        initial={reduce ? false : { y: -26, opacity: 0, scale: 0.6 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        transition={{ type: 'spring', stiffness: 520, damping: 20, mass: 0.8, delay }}
      >
        <MarkerArt />
      </motion.span>
      <span className="gw-pin-label">{pin.label}</span>
    </button>
  );
}

/** The pin being placed. Draggable to fine-tune; keeps the grab offset so the tip doesn't jump to the finger. */
function GhostPin({ point, imageRef, draggable, onMove, onDragged }) {
  const drag = useRef(null);

  function down(e) {
    if (!draggable) return;
    e.preventDefault();
    e.stopPropagation();
    const r = imageRef.current.getBoundingClientRect();
    drag.current = {
      dx: e.clientX - (r.left + (point.x / 100) * r.width),
      dy: e.clientY - (r.top + (point.y / 100) * r.height),
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function move(e) {
    const d = drag.current;
    if (!d) return;
    if (Math.abs(e.clientX - d.startX) + Math.abs(e.clientY - d.startY) > 3) d.moved = true;
    onMove(pointOnImage(imageRef.current, e.clientX - d.dx, e.clientY - d.dy));
  }
  function up() {
    if (drag.current?.moved) onDragged();
    drag.current = null;
  }

  return (
    <motion.div
      className={`gw-pin gw-ghost ${draggable ? 'is-draggable' : ''}`}
      style={{ left: `${point.x}%`, top: `${point.y}%` }}
      data-side={labelSide(point.x)}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onClick={(e) => e.stopPropagation()}
      aria-hidden="true"
    >
      <motion.span
        className="gw-pin-drop"
        initial={{ y: -22, opacity: 0, scale: 0.7 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.6, transition: { duration: 0.15 } }}
        transition={{ type: 'spring', stiffness: 520, damping: 22 }}
      >
        <MarkerArt />
      </motion.span>
      {draggable && (
        <span className="gw-pin-label gw-ghost-hint">
          <Move /> Drag
        </span>
      )}
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* Map                                                                  */
/* ------------------------------------------------------------------ */

// Elements that handle their own taps and drags: the zoom library must leave them alone.
const ZOOM_EXCLUDED = ['gw-pin', 'gw-ghost', 'gw-zoom-controls', 'gw-chooser'];
const MAX_ZOOM = 6;

const contains = (r, x, y) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;

function ZoomControls({ zoomed }) {
  const { zoomIn, zoomOut, resetTransform } = useControls();
  return (
    <div className="gw-zoom-controls" role="group" aria-label="Map zoom">
      <button type="button" onClick={() => zoomIn(0.6)} aria-label="Zoom in">
        <Plus />
      </button>
      <button type="button" onClick={() => zoomOut(0.6)} disabled={!zoomed} aria-label="Zoom out">
        <Minus />
      </button>
      {zoomed && (
        <button type="button" onClick={() => resetTransform()} aria-label="Reset zoom">
          <Maximize />
        </button>
      )}
    </div>
  );
}

/** Small menu for a tap that lands where two or more pins' touch areas overlap. */
function PinChooser({ chooser, frameWidth, onPick, onClose }) {
  const ref = useRef(null);
  useFocusTrap(ref, true);
  useEffect(() => {
    const previouslyFocused = document.activeElement;
    ref.current?.querySelector('button')?.focus({ preventScroll: true });
    const away = (e) => !ref.current?.contains(e.target) && onClose();
    const key = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('pointerdown', away, true);
    window.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', away, true);
      window.removeEventListener('keydown', key);
      previouslyFocused?.focus?.({ preventScroll: true });
    };
  }, [onClose]);

  const width = Math.min(240, frameWidth - 16);
  const left = Math.min(Math.max(8, chooser.x - width / 2), frameWidth - width - 8);
  return (
    <motion.div
      ref={ref}
      className="gw-chooser"
      role="dialog"
      aria-label="Choose a spot"
      style={{ left, top: chooser.y + 12, width }}
      initial={{ opacity: 0, y: -6, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.12 } }}
      transition={{ type: 'spring', stiffness: 520, damping: 34 }}
    >
      <p className="gw-chooser-title">{chooser.pins.length} spots here</p>
      {chooser.pins.map((pin) => (
        <button key={pin.id} type="button" onClick={() => onPick(pin)}>
          <MarkerArt />
          <span>
            <strong>{pin.label}</strong>
            <small>
              {pin.media_count} {pin.media_count === 1 ? 'item' : 'items'}
            </small>
          </span>
        </button>
      ))}
    </motion.div>
  );
}

function GardenMap({ map, pins, stage, ghost, setGhost, onTap, activeId, trail, movingId, onSelect, mapUpload }) {
  const reduce = useReducedMotion();
  const frameRef = useRef(null);
  const imageRef = useRef(null);
  const justDragged = useRef(false);
  const panned = useRef(false);
  const [ready, setReady] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  const [chooser, setChooser] = useState(null); // { x, y, pins } in frame coordinates
  // Pins on screen at first paint drop in one after another; pins added later just drop.
  const firstPins = useRef(null);
  if (ready && firstPins.current === null) firstPins.current = new Set(pins.map((p) => p.id));

  useEffect(() => {
    if (imageRef.current?.complete && imageRef.current.naturalWidth > 0) setReady(true);
  }, [map.id]);

  const adding = stage !== 'idle';
  const ratio = map.width && map.height ? map.width / map.height : null;
  // Lower pins are drawn over higher ones, as on a real map. The pin being moved is shown as the ghost instead.
  const ordered = pins.filter((p) => p.id !== movingId).sort((a, b) => a.y_percent - b.y_percent);
  const closeChooser = useCallback(() => setChooser(null), []);
  const zoomRef = useRef(null);

  // Double-tap (or double-click) resets the zoom. Handled here rather than by the zoom
  // library: after a tap, phones send compatibility mouse events whose mousedown starts a
  // "pan" that cancels the library's reset animation. Cancelling the second tap's touchend
  // suppresses those, and the reset runs a frame later, after the library's own touchend.
  useEffect(() => {
    const wrapper = frameRef.current?.querySelector('.gw-zoom');
    if (!wrapper) return undefined;
    const excluded = (target) => target.closest?.(ZOOM_EXCLUDED.map((c) => `.${c}`).join(','));
    const reset = () => requestAnimationFrame(() => zoomRef.current?.resetTransform());
    let last = null;
    let start = null;
    let moved = false;
    const touchStart = (e) => {
      if (e.touches.length !== 1) {
        last = null;
        start = null;
        return;
      }
      start = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      moved = false;
    };
    const touchMove = (e) => {
      const t = e.touches[0];
      if (start && t && Math.hypot(t.clientX - start.x, t.clientY - start.y) > 10) moved = true;
    };
    const touchEnd = (e) => {
      if (e.touches.length > 0 || !start) return;
      if (moved || excluded(e.target)) {
        last = null;
        return;
      }
      const t = e.changedTouches[0];
      if (last && e.timeStamp - last.time < 320 && Math.hypot(t.clientX - last.x, t.clientY - last.y) < 32) {
        e.preventDefault();
        last = null;
        reset();
      } else {
        last = { time: e.timeStamp, x: t.clientX, y: t.clientY };
      }
    };
    const dblClick = (e) => !excluded(e.target) && reset();
    wrapper.addEventListener('touchstart', touchStart, { passive: true });
    wrapper.addEventListener('touchmove', touchMove, { passive: true });
    wrapper.addEventListener('touchend', touchEnd, { passive: false });
    wrapper.addEventListener('dblclick', dblClick);
    return () => {
      wrapper.removeEventListener('touchstart', touchStart);
      wrapper.removeEventListener('touchmove', touchMove);
      wrapper.removeEventListener('touchend', touchEnd);
      wrapper.removeEventListener('dblclick', dblClick);
    };
  }, []);

  // Pins counter-scale (via --zoom) so they stay the same size on screen at any zoom.
  const onTransform = useCallback((_ref, { scale }) => {
    frameRef.current?.style.setProperty('--zoom', String(scale));
    setZoomed(scale > 1.01);
  }, []);

  function tap(e) {
    if (panned.current) {
      panned.current = false; // the end of a pan, not a tap
      return;
    }
    if (!adding || stage === 'details') return;
    if (justDragged.current) {
      justDragged.current = false;
      return;
    }
    // The image's live rect already includes the zoom and pan.
    onTap(pointOnImage(imageRef.current, e.clientX, e.clientY));
  }

  function pinTap(pin, e) {
    // Keyboard activation has no position: open the focused pin.
    if (e.detail === 0) return onSelect(pin);
    const { clientX: x, clientY: y } = e;
    const els = [...frameRef.current.querySelectorAll('.gw-pin[data-pin-id]')];
    const hits = els.filter((el) => contains(el.getBoundingClientRect(), x, y));
    if (hits.length <= 1) return onSelect(pin);
    // Right on one marker's drawing: that's the one meant.
    const onMarker = hits.filter((el) => contains(el.querySelector('.gw-marker-art').getBoundingClientRect(), x, y));
    const byId = (el) => pins.find((p) => p.id === Number(el.dataset.pinId));
    if (onMarker.length === 1) return onSelect(byId(onMarker[0]));
    const fr = frameRef.current.getBoundingClientRect();
    setChooser({ x: x - fr.left, y: y - fr.top, pins: hits.map(byId).filter(Boolean) });
  }

  return (
    <div
      ref={frameRef}
      className={`gw-frame ${adding ? 'is-adding' : ''} ${activeId ? 'is-walking' : ''} ${zoomed ? 'is-zoomed' : ''}`}
      role="group"
      aria-label={`Garden map with ${pins.length} ${pins.length === 1 ? 'spot' : 'spots'}`}
    >
      <TransformWrapper
        ref={zoomRef}
        minScale={1}
        maxScale={MAX_ZOOM}
        limitToBounds
        centerZoomedOut
        // At 1× there's nothing to pan, and a pan handler would block the page from scrolling.
        panning={{ disabled: !zoomed, excluded: ZOOM_EXCLUDED }}
        pinch={{ excluded: ['gw-ghost'] }}
        // A mouse wheel keeps scrolling the page; zoom with the buttons or a trackpad pinch.
        wheel={{ wheelDisabled: true, excluded: ZOOM_EXCLUDED }}
        trackPadPanning={{ disabled: true }}
        doubleClick={{ disabled: true }} // see the double-tap effect above
        onTransform={onTransform}
        onPanningStart={() => {
          panned.current = false;
          closeChooser();
        }}
        onPanning={() => {
          panned.current = true;
        }}
        onPinchStart={closeChooser}
        onZoomStart={closeChooser}
      >
        <TransformComponent wrapperClass="gw-zoom" contentClass="gw-zoom-content">
          <div
            className={`gw-canvas ${ratio ? 'has-ratio' : ''} ${ready ? '' : 'skeleton'}`}
            style={ratio ? { aspectRatio: ratio, '--ratio': ratio } : undefined}
            onClick={tap}
          >
            <img
              ref={imageRef}
              className={`gw-map-img ${ready ? 'is-ready' : ''}`}
              src={imageVariant(map.image_url, 'c_limit,w_1200')}
              srcSet={mapSrcSet(map.image_url)}
              // Zoomed in, fetch the full-resolution copy so detail stays sharp.
              sizes={zoomed ? '1600px' : '(max-width: 960px) 100vw, 1180px'}
              width={map.width ?? undefined}
              height={map.height ?? undefined}
              alt="Layout of the garden"
              draggable={false}
              onLoad={() => setReady(true)}
            />

            {/* The last step of the walk, as a faint dashed path between pins. Percent
                coordinates map straight onto the stretched viewBox; strokes stay crisp. */}
            {ready && (
              <svg className="gw-trail" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                <AnimatePresence>
                  {trail && (
                    <motion.line
                      key={`${trail.from.id}-${trail.to.id}`}
                      x1={trail.from.x_percent}
                      y1={trail.from.y_percent}
                      vectorEffect="non-scaling-stroke"
                      // Grow the line from the previous pin (not pathLength, which would replace the dashes).
                      initial={{ opacity: 0, x2: reduce ? trail.to.x_percent : trail.from.x_percent, y2: reduce ? trail.to.y_percent : trail.from.y_percent }}
                      animate={{ opacity: 1, x2: trail.to.x_percent, y2: trail.to.y_percent }}
                      exit={{ opacity: 0, transition: { duration: 0.3 } }}
                      transition={{ duration: reduce ? 0.2 : 0.7, ease: EASE }}
                    />
                  )}
                </AnimatePresence>
              </svg>
            )}

            {ready &&
              ordered.map((pin, i) => (
                <PinMarker
                  key={pin.id}
                  pin={pin}
                  delay={firstPins.current?.has(pin.id) ? 0.15 + i * 0.07 : 0}
                  selected={pin.id === activeId}
                  inert={adding}
                  onSelect={pinTap}
                />
              ))}

            <AnimatePresence>
              {ghost && (
                <GhostPin
                  key="ghost"
                  point={ghost}
                  imageRef={imageRef}
                  draggable={stage === 'dropping' || stage === 'adjusting' || stage === 'moving'}
                  onMove={setGhost}
                  onDragged={() => {
                    justDragged.current = true;
                  }}
                />
              )}
            </AnimatePresence>
          </div>
        </TransformComponent>
        {ready && <ZoomControls zoomed={zoomed} />}
      </TransformWrapper>

      <AnimatePresence>
        {chooser && (
          <PinChooser
            key="chooser"
            chooser={chooser}
            frameWidth={frameRef.current?.clientWidth ?? 320}
            onClose={closeChooser}
            onPick={(pin) => {
              setChooser(null);
              onSelect(pin);
            }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {mapUpload && (
          <motion.div
            className="gw-map-uploading"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            role="status"
          >
            <UploadStatus upload={mapUpload} label="Uploading the new layout" />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** A failed map upload, with the same file one tap away from another try. */
function UploadFailed({ failure, onRetry, onDismiss }) {
  return (
    <div className="gw-failed" role="alert">
      <AlertCircle aria-hidden="true" />
      <span>
        <strong>The layout didn’t upload.</strong> {failure.message}
      </span>
      <button type="button" className="btn btn-primary btn-sm" onClick={onRetry}>
        <RotateCcw /> Try again
      </button>
      <button type="button" className="icon-btn" onClick={onDismiss} aria-label="Dismiss">
        <X />
      </button>
    </div>
  );
}

function MapSkeleton() {
  return (
    <div className="gw-frame" aria-busy="true" aria-label="Loading the garden map">
      <div className="skeleton gw-skeleton" />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Empty state                                                          */
/* ------------------------------------------------------------------ */

function EmptyGarden({ onUpload, upload }) {
  return (
    <motion.div
      className="gw-empty"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.8, ease: EASE }}
    >
      <GardenPlanArt />
      <h2>Lay out your garden</h2>
      <p>
        Add a photo or sketch of the whole garden, seen from above. Then drop pins on the beds and corners you
        want to remember, and fill each one with photos and videos.
      </p>
      {upload ? (
        <div className="gw-empty-upload" role="status">
          <UploadStatus upload={upload} label="Uploading" />
        </div>
      ) : (
        <button type="button" className="btn btn-accent gw-cta" onClick={onUpload}>
          <ImageUp /> Upload garden layout
        </button>
      )}
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* New pin form                                                         */
/* ------------------------------------------------------------------ */

let nextFileId = 1;
const blankDraft = () => ({ label: '', note: '', files: [] });

function revokeAll(files) {
  for (const f of files) URL.revokeObjectURL(f.url);
}

function FileThumb({ item, disabled, onRemove }) {
  const [broken, setBroken] = useState(false); // e.g. HEIC outside Safari can't be previewed
  const pct = Math.round(item.progress * 100);
  return (
    <motion.li
      className={`gw-thumb is-${item.status}`}
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.15 } }}
      transition={{ type: 'spring', stiffness: 460, damping: 32 }}
    >
      {broken ? (
        <span className="gw-thumb-fallback">{item.file.name.split('.').pop()?.toUpperCase()}</span>
      ) : item.kind === 'video' ? (
        // #t= nudges iOS into rendering the first frame instead of a blank box.
        <video src={`${item.url}#t=0.1`} muted playsInline preload="metadata" onError={() => setBroken(true)} />
      ) : (
        <img src={item.url} alt="" onError={() => setBroken(true)} />
      )}
      {item.kind === 'video' && (
        <span className="gw-thumb-badge" aria-hidden="true">
          <Film />
        </span>
      )}
      {item.status === 'done' && (
        <span className="gw-thumb-done" aria-hidden="true">
          <Check />
        </span>
      )}
      {(item.status === 'uploading' || item.status === 'done') && (
        <span className="gw-thumb-progress" aria-hidden="true">
          <span style={{ transform: `scaleX(${item.progress})` }} />
        </span>
      )}
      <span className="visually-hidden">
        {item.file.name}
        {item.status === 'uploading' && `, uploading ${pct}%`}
        {item.status === 'done' && ', uploaded'}
        {item.status === 'error' && ', upload failed'}
      </span>
      <button
        type="button"
        className="gw-thumb-remove"
        onClick={() => onRemove(item.id)}
        disabled={disabled}
        aria-label={`Remove ${item.file.name}`}
      >
        <X />
      </button>
    </motion.li>
  );
}

function PinForm({ draft, setDraft, point, onCreated, onCancel, onAdjust, onBusyChange }) {
  const labelId = useId();
  const noteId = useId();
  const fileInput = useRef(null);
  const abortRef = useRef(null);
  const [error, setError] = useState(null);
  const [phase, setPhase] = useState(null); // null | 'uploading' | 'saving'
  const busy = phase !== null;

  // Leaving the form (cancel, close) stops any uploads still in flight.
  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(() => onBusyChange(busy), [busy, onBusyChange]);

  const patchFile = (id, patch) =>
    setDraft((d) => ({ ...d, files: d.files.map((f) => (f.id === id ? { ...f, ...patch } : f)) }));

  function addFiles(list) {
    const chosen = [...list];
    const problems = [];
    const accepted = [];
    for (const file of chosen) {
      const kind = mediaKindOf(file);
      const problem = kind ? checkUpload(file, kind) : checkUpload(file, 'image');
      if (problem) problems.push(problem);
      else accepted.push({ id: nextFileId++, file, kind, url: URL.createObjectURL(file), progress: 0, status: 'idle', result: null });
    }
    const room = MAX_FILES - draft.files.length;
    if (accepted.length > room) {
      revokeAll(accepted.splice(room));
      problems.push(`A spot can hold up to ${MAX_FILES} files at a time.`);
    }
    setError(problems.length ? problems.join(' ') : null);
    if (accepted.length) setDraft((d) => ({ ...d, files: [...d.files, ...accepted] }));
  }

  function removeFile(id) {
    setDraft((d) => {
      const gone = d.files.find((f) => f.id === id);
      if (gone) URL.revokeObjectURL(gone.url);
      return { ...d, files: d.files.filter((f) => f.id !== id) };
    });
  }

  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    const label = draft.label.trim();
    if (!label) return setError('Give this spot a name.');
    if (draft.files.length === 0) return setError('Add at least one photo or video.');

    setError(null);
    const controller = new AbortController();
    abortRef.current = controller;
    // Results are tracked here as well as in state, which updates asynchronously.
    const results = new Map(draft.files.filter((f) => f.result).map((f) => [f.id, f.result]));

    try {
      setPhase('uploading');
      const pending = draft.files.filter((f) => !f.result);
      await runLimited(pending, UPLOAD_CONCURRENCY, async (item) => {
        patchFile(item.id, { status: 'uploading', progress: 0 });
        try {
          const result = await uploadToCloudinary(item.file, item.kind, (p) => patchFile(item.id, { progress: p }), {
            signal: controller.signal,
          });
          results.set(item.id, result);
          patchFile(item.id, { status: 'done', progress: 1, result });
        } catch (err) {
          patchFile(item.id, { status: 'error' });
          throw err;
        }
      });

      setPhase('saving');
      const pin = await api.post('/garden-walk/pins', {
        label,
        note: draft.note.trim() || null,
        x_percent: point.x,
        y_percent: point.y,
        media: draft.files.map((f) => results.get(f.id)),
      });
      onCreated(pin);
    } catch (err) {
      if (err.name === 'AbortError') return;
      // The server rejected the files themselves: it may have deleted some, so upload afresh next time.
      if (err instanceof ApiError && err.status >= 400 && err.status < 500) {
        setDraft((d) => ({ ...d, files: d.files.map((f) => ({ ...f, result: null, status: 'idle', progress: 0 })) }));
      }
      setError(err.message);
      setPhase(null);
    }
  }

  const total = draft.files.length;
  const doneCount = draft.files.filter((f) => f.status === 'done').length;
  const overall = total ? draft.files.reduce((sum, f) => sum + f.progress, 0) / total : 0;

  return (
    <form className="gw-form" onSubmit={submit} noValidate>
      <div className="field">
        <label className="field-label" htmlFor={labelId}>
          Name
        </label>
        <input
          id={labelId}
          className="input"
          maxLength={MAX_LABEL}
          placeholder="e.g. Tomato bed by the fence"
          value={draft.label}
          onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
          disabled={busy}
          enterKeyHint="next"
          autoComplete="off"
        />
      </div>

      <div className="field mt-4">
        <label className="field-label" htmlFor={noteId}>
          Note <span className="optional">optional</span>
        </label>
        <textarea
          id={noteId}
          className="textarea"
          rows={2}
          maxLength={MAX_NOTE}
          placeholder="What’s growing here, what to watch for…"
          value={draft.note}
          onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))}
          disabled={busy}
        />
        {draft.note.length > MAX_NOTE * 0.8 && (
          <span className="field-hint">{MAX_NOTE - draft.note.length} characters left</span>
        )}
      </div>

      <div className="field mt-4">
        <span className="field-label" id={`${labelId}-media`}>
          Photos &amp; videos
        </span>
        <ul className="gw-thumbs" aria-labelledby={`${labelId}-media`}>
          <AnimatePresence initial={false}>
            {draft.files.map((item) => (
              <FileThumb key={item.id} item={item} disabled={busy} onRemove={removeFile} />
            ))}
          </AnimatePresence>
          {draft.files.length < MAX_FILES && (
            <li className="gw-thumb-add-wrap">
              <button type="button" className="gw-thumb-add" onClick={() => fileInput.current?.click()} disabled={busy}>
                <ImagePlus />
                <span>{draft.files.length ? 'Add more' : 'Add photos or videos'}</span>
              </button>
            </li>
          )}
        </ul>
        <span className="field-hint">Photos up to 8 MB · videos up to 50 MB (MP4, MOV, WebM)</span>
        <input
          ref={fileInput}
          className="visually-hidden"
          type="file"
          multiple
          accept="image/*,video/*"
          onChange={(e) => {
            addFiles(e.target.files ?? []);
            e.target.value = ''; // allow picking the same file again
          }}
          tabIndex={-1}
          aria-hidden="true"
        />
      </div>

      {busy && (
        <div className="gw-form-progress mt-4" role="status">
          <UploadStatus
            upload={{ progress: overall, saving: phase === 'saving' }}
            savingLabel="Saving the spot…"
            label={`Uploading ${Math.min(doneCount + 1, total)} of ${total}`}
          />
        </div>
      )}

      <div className="mt-4">
        <FormError error={error} />
      </div>

      <div className="form-actions gw-form-actions">
        <button type="button" className="btn btn-ghost gw-adjust" onClick={onAdjust} disabled={busy}>
          <Move /> Adjust position
        </button>
        <span className="gw-form-spacer" />
        <button type="button" className="btn btn-secondary" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={busy || !draft.label.trim() || total === 0}>
          {busy ? (
            <>
              <span className="spinner" /> {phase === 'saving' ? 'Saving…' : 'Uploading…'}
            </>
          ) : (
            <>
              {error ? <RotateCcw /> : <MapPinPlus />} {error ? 'Try again' : 'Add spot'}
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

// Add-pin flow: idle → placing (tap the map) → dropping (ghost lands, still draggable)
// → details (form open) ⇄ adjusting (form hidden, drag the ghost) → idle on save.
// Moving a pin: idle → moving (the pin becomes a draggable ghost) → idle on Save/Cancel.

/** Viewport centre of a pin's marker, for the gallery to open from and close into. */
function pinOrigin(id) {
  const el = document.querySelector(`.gw-pin[data-pin-id="${id}"] .gw-marker-art`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

export default function GardenWalk() {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [stage, setStage] = useState('idle');
  const [ghost, setGhost] = useState(null);
  const [draft, setDraft] = useState(blankDraft);
  const [formBusy, setFormBusy] = useState(false);
  const [movingPin, setMovingPin] = useState(null);
  const [savingMove, setSavingMove] = useState(false);
  // The walk session: pins visited in order (the last is open), and which way we last travelled.
  const [walk, setWalk] = useState(null); // { history: number[], visited: Set<number>, travel: {x, y} }
  const [origin, setOrigin] = useState(null);
  const [mapUpload, setMapUpload] = useState(null); // { progress, saving } while a layout uploads
  const [mapFailure, setMapFailure] = useState(null); // { file, message } after a failed upload
  const [confirmReplace, setConfirmReplace] = useState(false);
  const mapInput = useRef(null);
  const dropTimer = useRef(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await api.get('/garden-walk/map'));
    } catch (err) {
      setError(err);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  // Free preview URLs when leaving the page.
  useEffect(() => () => {
    clearTimeout(dropTimer.current);
    revokeAll(draftRef.current.files);
  }, []);

  const pins = useMemo(() => data?.pins ?? [], [data]);
  const ratio = data?.map?.width && data?.map?.height ? data.map.width / data.map.height : 1;
  const byId = useMemo(() => new Map(pins.map((p) => [p.id, p])), [pins]);
  const currentId = walk?.history.at(-1) ?? null;
  const currentPin = currentId ? byId.get(currentId) : null;
  const prevPin = walk && walk.history.length > 1 ? byId.get(walk.history.at(-2)) : null;
  const nextPin = useMemo(
    () => (walk && currentId ? nextInWalk(pins, currentId, walk.visited, ratio) : null),
    [walk, currentId, pins, ratio],
  );
  const trail = prevPin && currentPin ? { from: prevPin, to: currentPin } : null;

  const openPin = useCallback((pin) => {
    setOrigin(pinOrigin(pin.id));
    setWalk({ history: [pin.id], visited: new Set([pin.id]), travel: { x: 0, y: 0 } });
  }, []);

  // Closing ends the walk session; the gallery shrinks back into the pin it's showing.
  const closeWalk = useCallback(() => {
    setOrigin(currentId ? pinOrigin(currentId) : null);
    setWalk(null);
  }, [currentId]);

  function walkTo(target, history) {
    setOrigin(pinOrigin(target.id));
    setWalk((w) => ({
      history,
      visited: new Set([...w.visited, target.id]),
      travel: travelVector(currentPin, target, ratio),
    }));
  }
  const walkNext = () => nextPin && walkTo(nextPin, [...walk.history, nextPin.id]);
  const walkBack = () => prevPin && walkTo(prevPin, walk.history.slice(0, -1));

  // A "new spot" notification links to /garden-walk?pin=<id>: open it once the map is drawn.
  const [params, setParams] = useSearchParams();
  const wanted = Number(params.get('pin')) || null;
  useEffect(() => {
    if (!wanted || !byId.has(wanted)) return undefined;
    const t = setTimeout(() => {
      openPin(byId.get(wanted));
      setParams({}, { replace: true });
    }, 600);
    return () => clearTimeout(t);
  }, [wanted, byId, openPin, setParams]);

  /** Update one pin with `fn(pin)`; always applied to the latest data, so optimistic edits and rollbacks compose. */
  const patchPin = useCallback((id, fn) => {
    setData((d) => ({ ...d, pins: d.pins.map((p) => (p.id === id ? fn(p) : p)) }));
  }, []);
  const updatePin = useCallback((pin) => patchPin(pin.id, () => pin), [patchPin]);

  const removePin = useCallback((pin) => {
    setOrigin(null);
    setWalk(null);
    setData((d) => ({ ...d, pins: d.pins.filter((p) => p.id !== pin.id) }));
  }, []);

  const endAdding = useCallback((nextStage = 'idle') => {
    clearTimeout(dropTimer.current);
    // After the sheet's exit animation, which still shows the thumbnails.
    const files = draftRef.current.files;
    setTimeout(() => revokeAll(files), 400);
    setDraft(blankDraft());
    setGhost(null);
    setMovingPin(null);
    setStage(nextStage);
  }, []);

  // Escape backs out of placing or moving a pin (the modal handles its own Escape).
  useEffect(() => {
    if (stage === 'idle' || stage === 'details') return undefined;
    const onKey = (e) => e.key === 'Escape' && !savingMove && endAdding();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [stage, endAdding, savingMove]);

  function toggleAdding() {
    if (stage === 'idle') setStage('placing');
    else endAdding();
  }

  function tapMap(point) {
    setGhost(point);
    if (stage === 'placing') {
      // Let the ghost visibly land before the form slides over it.
      setStage('dropping');
      dropTimer.current = setTimeout(() => setStage('details'), 550);
    }
  }

  function created(pin) {
    setData((d) => ({ ...d, pins: [...d.pins, pin] }));
    endAdding();
    toast.success(`“${pin.label}” added to the walk`);
  }

  function startMove(pin) {
    closeWalk();
    setMovingPin(pin);
    setGhost({ x: pin.x_percent, y: pin.y_percent });
    setStage('moving');
  }

  async function saveMove() {
    setSavingMove(true);
    try {
      updatePin(await api.put(`/garden-walk/pins/${movingPin.id}`, { x_percent: ghost.x, y_percent: ghost.y }));
      toast.success(`“${movingPin.label}” moved`);
      endAdding();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSavingMove(false);
    }
  }

  // Closing the form (Cancel, ×, Escape, backdrop) drops this pin but stays in add mode.
  const closeForm = useCallback(() => endAdding('placing'), [endAdding]);
  // Modal re-runs its focus handling whenever onClose changes, so keep this one stable.
  const formBusyRef = useRef(false);
  formBusyRef.current = formBusy;
  const dismissForm = useCallback(() => !formBusyRef.current && closeForm(), [closeForm]);

  async function uploadMap(file) {
    if (!file) return;
    const problem = checkUpload(file, 'map');
    if (problem) return toast.error(problem);
    const replacing = Boolean(data?.map);
    setMapFailure(null);
    setMapUpload({ progress: 0 });
    try {
      const up = await uploadToCloudinary(file, 'map', (progress) => setMapUpload({ progress }));
      setMapUpload({ progress: 1, saving: true });
      const { map } = await api.post('/garden-walk/map', { public_id: up.public_id });
      setData((d) => ({ map, pins: d?.pins ?? [] }));
      toast.success(replacing ? 'Garden layout replaced' : 'Garden layout added');
    } catch (err) {
      setMapFailure({ file, message: err.message });
    } finally {
      setMapUpload(null);
    }
  }

  const adding = stage !== 'idle';
  const hint =
    stage === 'placing'
      ? 'Tap the map to drop a pin'
      : stage === 'dropping' || stage === 'adjusting'
        ? 'Drag the pin to fine-tune its spot'
        : stage === 'moving'
          ? `Drag “${movingPin?.label}” to its new spot`
          : null;

  return (
    <div className={`gw-page ${adding ? 'is-adding' : ''}`}>
      <PageHeader
        eyebrow="Garden walk"
        eyebrowIcon={Footprints}
        title={<>Garden <em>walk</em></>}
        subtitle={data?.map ? 'Every bed and corner, pinned where it grows. Tap a pin to start walking.' : undefined}
        actions={
          data?.map && (
            <>
              <button
                type="button"
                className={`btn ${adding ? 'btn-secondary' : 'btn-primary'} gw-add-btn`}
                onClick={toggleAdding}
                aria-pressed={adding}
                disabled={Boolean(mapUpload) || savingMove}
              >
                {adding ? (
                  <>
                    <X /> {stage === 'moving' ? 'Cancel move' : 'Cancel pin'}
                  </>
                ) : (
                  <>
                    <MapPinPlus /> Add pin
                  </>
                )}
              </button>
              <OverflowMenu
                disabled={adding || Boolean(mapUpload)}
                items={[{ label: 'Replace map image', icon: ImageUp, onSelect: () => setConfirmReplace(true) }]}
              />
            </>
          )
        }
      />

      <AnimatePresence>
        {hint && (
          <motion.p
            key="hint"
            className="gw-hint"
            role="status"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6, transition: { duration: 0.15 } }}
            transition={{ duration: 0.25, ease: EASE }}
          >
            {stage === 'moving' ? <Move aria-hidden="true" /> : <MapPinPlus aria-hidden="true" />} {hint}
          </motion.p>
        )}
      </AnimatePresence>

      {error && !data ? (
        <ErrorBanner error={error} onRetry={load} />
      ) : !data ? (
        <MapSkeleton />
      ) : !data.map ? (
        <>
          {mapFailure && (
            <UploadFailed failure={mapFailure} onRetry={() => uploadMap(mapFailure.file)} onDismiss={() => setMapFailure(null)} />
          )}
          <EmptyGarden onUpload={() => mapInput.current?.click()} upload={mapUpload} />
        </>
      ) : (
        <>
          {mapFailure && (
            <UploadFailed failure={mapFailure} onRetry={() => uploadMap(mapFailure.file)} onDismiss={() => setMapFailure(null)} />
          )}
          <GardenMap
            map={data.map}
            pins={pins}
            stage={stage}
            ghost={ghost}
            setGhost={setGhost}
            onTap={tapMap}
            activeId={currentId}
            trail={trail}
            movingId={movingPin?.id}
            onSelect={openPin}
            mapUpload={mapUpload}
          />
          <p className="gw-zoom-hint">
            <span className="on-touch">Pinch to zoom in on busy corners · double-tap to reset</span>
            <span className="on-pointer">Zoom with + and − or a trackpad pinch · double-click to reset</span>
          </p>
          {pins.length === 0 && stage === 'idle' && (
            <p className="gw-first-pin">
              No spots yet. Choose <strong>Add pin</strong> and tap a bed to start the walk.
            </p>
          )}
        </>
      )}

      {/* While fine-tuning or moving, the way out stays within thumb reach. */}
      <AnimatePresence>
        {(stage === 'adjusting' || stage === 'moving') && (
          <motion.div
            key={stage}
            className="gw-adjust-bar"
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16, transition: { duration: 0.15 } }}
            transition={{ type: 'spring', stiffness: 420, damping: 34 }}
          >
            {stage === 'adjusting' ? (
              <>
                <span>Drag the pin, or tap a new spot.</span>
                <button type="button" className="btn btn-primary btn-sm" onClick={() => setStage('details')}>
                  <Check /> Done
                </button>
              </>
            ) : (
              <>
                <button type="button" className="btn btn-sm gw-bar-cancel" onClick={() => endAdding()} disabled={savingMove}>
                  Cancel
                </button>
                <button type="button" className="btn btn-primary btn-sm gw-bar-save" onClick={saveMove} disabled={savingMove}>
                  {savingMove ? <span className="spinner" /> : <Check />} Save position
                </button>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <input
        ref={mapInput}
        className="visually-hidden"
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          uploadMap(file);
        }}
        tabIndex={-1}
        aria-hidden="true"
      />

      <AnimatePresence custom={origin}>
        {currentPin && (
          <PinGallery
            key="gallery"
            pin={currentPin}
            origin={origin}
            prevPin={prevPin}
            nextPin={nextPin}
            travel={walk.travel}
            onPrev={walkBack}
            onNext={walkNext}
            onClose={closeWalk}
            onPinChange={updatePin}
            onPinPatch={patchPin}
            onPinDeleted={removePin}
            onMove={startMove}
          />
        )}
      </AnimatePresence>

      <Modal
        open={stage === 'details'}
        onClose={dismissForm}
        title="New spot"
        description="Name this spot and add what it looks like today."
      >
        {ghost && (
          <PinForm
            draft={draft}
            setDraft={setDraft}
            point={ghost}
            onCreated={created}
            onCancel={closeForm}
            onAdjust={() => setStage('adjusting')}
            onBusyChange={setFormBusy}
          />
        )}
      </Modal>

      <ConfirmDialog
        open={confirmReplace}
        title="Replace the map image?"
        message="Pins keep their positions as percentages — if the new image has a different layout, pins will be misplaced."
        confirmLabel="Choose new image"
        onConfirm={() => {
          // Still inside the click, so the browser allows opening the file picker.
          mapInput.current?.click();
          setConfirmReplace(false);
        }}
        onCancel={() => setConfirmReplace(false)}
      />
    </div>
  );
}
