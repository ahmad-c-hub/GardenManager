import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AnimatePresence, MotionConfig, motion, useReducedMotion } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  ArrowLeft,
  ArrowUp,
  Camera,
  History,
  ImagePlus,
  MessageSquarePlus,
  MessagesSquare,
  Plus,
  Sprout,
  Trash2,
  X,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { useToast } from '../lib/toast.jsx';
import { timeAgo } from '../lib/format.js';
import { imageVariant, largeVariant } from '../lib/cloudinary.js';
import { ConfirmDialog } from '../components/ui.jsx';
import { BrandMark, CornerFrond, Frond, RoundLeafStem, Sprig } from '../components/Botanical.jsx';

const EASE = [0.22, 1, 0.36, 1];
const MAX_TEXT = 4000;
const MAX_EDGE = 1600; // photos are resized on the phone before upload
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const STARTERS = [
  { label: 'What should I plant this month?', text: 'What should I plant this month?' },
  { label: 'Companion plants for my tomatoes?', text: 'What are good companion plants for my tomatoes?' },
  { label: 'Identify this plant 📷', text: 'Identify this plant', photo: true },
  { label: 'What’s wrong with these leaves? 📷', text: 'What’s wrong with these leaves?', photo: true },
];

const isTouch = () => window.matchMedia('(hover: none) and (pointer: coarse)').matches;

function seasonLabel(date = new Date()) {
  const m = date.getMonth() + 1;
  const season = ['Winter', 'Spring', 'Summer', 'Autumn'][Math.floor((m % 12) / 3)];
  return `${['Early', 'Mid', 'Late'][m % 3]} ${season.toLowerCase()}`;
}

/* ------------------------------------------------------------------ */
/* Photos                                                               */
/* ------------------------------------------------------------------ */

/** Downscale big phone photos (and normalise orientation) before upload. */
async function preparePhoto(file) {
  if (!file.type.startsWith('image/')) throw new Error('Please choose a photo.');
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size <= 1.5 * 1024 * 1024 && IMAGE_TYPES.includes(file.type)) {
      bitmap.close();
      return file;
    }
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; // transparent PNGs become JPEGs
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.86));
    if (!blob) throw new Error('encode failed');
    return new File([blob], 'photo.jpg', { type: 'image/jpeg' });
  } catch {
    if (IMAGE_TYPES.includes(file.type) && file.size <= 8 * 1024 * 1024) return file;
    throw new Error('That photo couldn’t be read. Try a JPEG, PNG or WebP image.');
  }
}

const bubbleSrc = (m) => m.localUrl ?? imageVariant(m.image_url, 'c_limit,w_640,f_auto,q_auto');

function Lightbox({ src, onClose }) {
  const closeRef = useRef(null);
  useEffect(() => {
    const previouslyFocused = document.activeElement;
    closeRef.current?.focus();
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      previouslyFocused?.focus?.({ preventScroll: true });
    };
  }, [onClose]);

  return createPortal(
    <motion.div
      className="lightbox assistant-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label="Photo"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.2 } }}
      onClick={onClose}
    >
      <div className="lightbox-scrim" />
      <button ref={closeRef} type="button" className="lightbox-btn lightbox-close" onClick={onClose} aria-label="Close">
        <X />
      </button>
      <motion.img
        src={src}
        alt=""
        initial={{ opacity: 0, scale: 0.94, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97 }}
        transition={{ type: 'spring', stiffness: 260, damping: 30 }}
      />
    </motion.div>,
    document.body,
  );
}

/* ------------------------------------------------------------------ */
/* Messages                                                             */
/* ------------------------------------------------------------------ */

const markdownComponents = {
  a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />,
  table: ({ node: _node, ...props }) => (
    <div className="md-table">
      <table {...props} />
    </div>
  ),
};

function LeafAvatar() {
  return (
    <span className="chat-avatar" aria-hidden="true">
      <BrandMark />
    </span>
  );
}

function TypingIndicator({ photo }) {
  return (
    <span className="chat-typing" role="status">
      <span className="chat-typing-dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <span className="chat-typing-label">{photo ? 'Looking closely at your photo…' : 'Walking through your garden…'}</span>
    </span>
  );
}

function Message({ message, onOpenPhoto, lookingAtPhoto }) {
  const reduce = useReducedMotion();
  const mine = message.role === 'user';
  const hasImage = Boolean(message.localUrl || message.image_url);

  return (
    <motion.div
      className={`chat-row ${mine ? 'is-user' : 'is-assistant'}`}
      initial={message.fresh ? (reduce ? { opacity: 0 } : { opacity: 0, y: 14, scale: 0.98 }) : false}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: 'spring', stiffness: 320, damping: 30 }}
    >
      {!mine && <LeafAvatar />}
      <div className={`chat-bubble ${message.streaming ? 'is-streaming' : ''}`}>
        {hasImage && (
          <button type="button" className="chat-photo" onClick={() => onOpenPhoto(message)} aria-label="View photo">
            <img src={bubbleSrc(message)} alt="Photo you sent" loading="lazy" decoding="async" />
          </button>
        )}
        {mine ? (
          message.content ? (
            <p className="chat-user-text">{message.content}</p>
          ) : (
            !hasImage && <p className="chat-user-text chat-photo-missing">📷 Photo (not kept in history)</p>
          )
        ) : message.content ? (
          <div className="chat-md">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
              {message.content}
            </ReactMarkdown>
          </div>
        ) : (
          <TypingIndicator photo={lookingAtPhoto} />
        )}
      </div>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* Empty state                                                          */
/* ------------------------------------------------------------------ */

function GreenhouseArt() {
  return (
    <svg className="assistant-hero-art" viewBox="0 0 240 200" aria-hidden="true">
      <defs>
        <clipPath id="assistant-arch">
          <path d="M64 176V96a56 56 0 0 1 112 0v80Z" />
        </clipPath>
        <radialGradient id="assistant-glow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0%" stopColor="#e8b08a" stopOpacity="0.5" />
          <stop offset="100%" stopColor="#e8b08a" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="120" cy="92" r="96" fill="url(#assistant-glow)" />
      <ellipse cx="120" cy="182" rx="92" ry="7" fill="#e3d8c4" opacity="0.8" />
      <path d="M64 176V96a56 56 0 0 1 112 0v80Z" fill="#f1f5ec" />
      <g clipPath="url(#assistant-arch)">
        <circle cx="146" cy="78" r="22" fill="#f6ebcf" />
        <circle cx="146" cy="78" r="10" fill="#d4a94f" opacity="0.55" />
        <Frond x={104} y={182} rotate={-12} length={112} bend={-18} leaves={10} leafSize={30} color="#3f8a5a" sway={1.4} duration={8} />
        <Frond x={134} y={184} rotate={14} length={84} bend={16} leaves={8} leafSize={24} color="#9dbb93" sway={1.8} duration={6.5} delay={0.6} />
        <RoundLeafStem x={156} y={182} rotate={10} length={62} count={6} color="#b7cbb0" />
      </g>
      <path d="M64 176V96a56 56 0 0 1 112 0v80" fill="none" stroke="#cfc1a8" strokeWidth="2" />
      <path d="M120 40v136M64 124h112" stroke="#cfc1a8" strokeWidth="1.2" opacity="0.55" />
      <path d="M56 176h128" stroke="#b25c31" strokeWidth="5" strokeLinecap="round" />
      {[
        [40, 70, 2.4],
        [200, 56, 2],
        [26, 128, 1.8],
        [214, 120, 2.6],
      ].map(([cx, cy, r], i) => (
        <circle key={i} cx={cx} cy={cy} r={r} fill="#9dbb93" opacity="0.5">
          <animate attributeName="cy" values={`${cy};${cy - 8};${cy}`} dur={`${6 + i}s`} repeatCount="indefinite" />
        </circle>
      ))}
    </svg>
  );
}

function EmptyChat({ onStarter, enabled }) {
  return (
    <motion.div
      className="assistant-empty"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.7, ease: EASE }}
    >
      <GreenhouseArt />
      <p className="assistant-season">
        <Sprig className="assistant-season-sprig" />
        {seasonLabel()} · Bekaa Valley
      </p>
      <h2>
        What are we <em>growing</em> today?
      </h2>
      <p className="assistant-empty-lede">
        Ask about sowing times, companions, soil or pests. I know your beds, what’s in them and what you’ve harvested,
        and I can look at a photo too.
      </p>
      {enabled === false && (
        <p className="assistant-offline">The assistant isn’t switched on yet: the server needs a GEMINI_API_KEY.</p>
      )}
      <motion.div
        className="assistant-starters"
        initial="hidden"
        animate="show"
        variants={{ hidden: {}, show: { transition: { staggerChildren: 0.06, delayChildren: 0.25 } } }}
      >
        {STARTERS.map((s) => (
          <motion.button
            key={s.label}
            type="button"
            className="assistant-chip"
            variants={{ hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: EASE } } }}
            whileTap={{ scale: 0.96 }}
            onClick={() => onStarter(s)}
          >
            {s.photo && <Camera aria-hidden="true" />}
            <span>{s.label.replace(' 📷', '')}</span>
          </motion.button>
        ))}
      </motion.div>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* Conversation list                                                    */
/* ------------------------------------------------------------------ */

function ConversationList({ conversations, activeId, onSelect, onNew, onDelete, onClose }) {
  return (
    <>
      <div className="convo-head">
        <div>
          <p className="convo-eyebrow">Planting Assistant</p>
          <h2>Conversations</h2>
        </div>
        {onClose && (
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close conversations">
            <X />
          </button>
        )}
      </div>
      <button type="button" className="btn btn-primary btn-block convo-new" onClick={onNew}>
        <Plus /> New chat
      </button>

      <div className="convo-scroll">
        {conversations === null ? (
          <div className="convo-skeleton" aria-busy="true" aria-label="Loading conversations">
            {[70, 55, 80, 60].map((w, i) => (
              <div key={i} className="skeleton" style={{ width: `${w}%` }} />
            ))}
          </div>
        ) : conversations.length === 0 ? (
          <p className="convo-empty">
            <MessagesSquare aria-hidden="true" />
            Your chats will gather here.
          </p>
        ) : (
          <ul className="convo-list">
            <AnimatePresence initial={false}>
              {conversations.map((c) => {
                const active = c.id === activeId;
                return (
                  <motion.li
                    key={c.id}
                    layout="position"
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, x: -16, transition: { duration: 0.16 } }}
                    className={`convo-item ${active ? 'active' : ''}`}
                  >
                    {active && <motion.span layoutId="convo-active" className="convo-active-bg" transition={{ type: 'spring', stiffness: 460, damping: 38 }} />}
                    <button type="button" className="convo-link" onClick={() => onSelect(c.id)} aria-current={active ? 'page' : undefined}>
                      <span className="convo-title">{c.title}</span>
                      <time className="convo-time" dateTime={c.updated_at}>
                        {timeAgo(c.updated_at)}
                      </time>
                    </button>
                    <button type="button" className="icon-btn danger convo-delete" onClick={() => onDelete(c)} aria-label={`Delete “${c.title}”`}>
                      <Trash2 />
                    </button>
                  </motion.li>
                );
              })}
            </AnimatePresence>
          </ul>
        )}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Composer                                                             */
/* ------------------------------------------------------------------ */

function Composer({ draft, setDraft, attachment, onAttach, onRemoveAttachment, onSend, busy, textareaRef, cameraRef, libraryRef }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  const canSend = !busy && (draft.trim() !== '' || attachment);

  // Grow with the text, up to a comfortable maximum.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [draft, textareaRef]);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const close = (e) => !menuRef.current?.contains(e.target) && setMenuOpen(false);
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [menuOpen]);

  function onKeyDown(e) {
    // Enter sends on a keyboard; on a phone it's a new line and the button sends.
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && !isTouch()) {
      e.preventDefault();
      onSend();
    }
  }

  function attach() {
    if (isTouch()) setMenuOpen((o) => !o);
    else libraryRef.current?.click();
  }

  const pick = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    setMenuOpen(false);
    if (file) onAttach(file);
  };

  return (
    <form
      className="composer"
      onSubmit={(e) => {
        e.preventDefault();
        onSend();
      }}
    >
      <AnimatePresence>
        {attachment && (
          <motion.div
            className="composer-attachment"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25, ease: EASE }}
          >
            <div className="composer-thumb">
              <img src={attachment.url} alt="Photo to send" />
              <button type="button" onClick={onRemoveAttachment} aria-label="Remove photo">
                <X />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="composer-bar">
        <div className="composer-attach" ref={menuRef}>
          <motion.button
            type="button"
            className="composer-icon"
            onClick={attach}
            whileTap={{ scale: 0.9 }}
            aria-label="Add a photo"
            aria-expanded={isTouch() ? menuOpen : undefined}
            title="Add a photo"
          >
            <ImagePlus />
          </motion.button>
          <AnimatePresence>
            {menuOpen && (
              <motion.div
                className="composer-menu"
                initial={{ opacity: 0, y: 8, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 6, scale: 0.97, transition: { duration: 0.12 } }}
                transition={{ type: 'spring', stiffness: 480, damping: 32 }}
              >
                <button type="button" onClick={() => cameraRef.current?.click()}>
                  <Camera /> Take a photo
                </button>
                <button type="button" onClick={() => libraryRef.current?.click()}>
                  <ImagePlus /> Choose from library
                </button>
              </motion.div>
            )}
          </AnimatePresence>
          <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={pick} />
          <input ref={libraryRef} type="file" accept="image/*" hidden onChange={pick} />
        </div>

        <textarea
          ref={textareaRef}
          className="composer-input"
          rows={1}
          value={draft}
          maxLength={MAX_TEXT}
          placeholder={attachment ? 'Add a question about this photo…' : 'Ask about your garden…'}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          aria-label="Message the Planting Assistant"
          enterKeyHint={isTouch() ? 'enter' : 'send'}
        />

        <motion.button
          type="submit"
          className="composer-send"
          disabled={!canSend}
          whileHover={canSend ? { scale: 1.06 } : undefined}
          whileTap={canSend ? { scale: 0.9 } : undefined}
          aria-label="Send"
        >
          <ArrowUp />
        </motion.button>
      </div>
      <p className="composer-note">Advice is AI-generated. Double-check anything critical, like sprays or edibility.</p>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                 */
/* ------------------------------------------------------------------ */

/**
 * Keeps the chat exactly inside what's visible on a phone, even with the
 * keyboard up (iOS shrinks only the visual viewport, not the layout one).
 */
function useViewportFit(ref) {
  useLayoutEffect(() => {
    const el = ref.current;
    const vv = window.visualViewport;
    if (!el) return undefined;
    const update = () => {
      el.style.setProperty('--vvh', `${vv ? vv.height : window.innerHeight}px`);
      el.style.setProperty('--vv-top', `${vv ? Math.max(0, vv.offsetTop) : 0}px`);
      el.style.setProperty('--topbar-h', `${document.querySelector('.topbar')?.offsetHeight ?? 0}px`);
    };
    update();
    const topbar = document.querySelector('.topbar');
    const ro = topbar ? new ResizeObserver(update) : null;
    ro?.observe(topbar);
    vv?.addEventListener('resize', update);
    vv?.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    return () => {
      ro?.disconnect();
      vv?.removeEventListener('resize', update);
      vv?.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [ref]);
}

/* ------------------------------------------------------------------ */
/* Coming soon                                                          */
/* ------------------------------------------------------------------ */

const SOON_PREVIEW = [
  { icon: Sprout, text: 'Sowing times for your own beds' },
  { icon: Camera, text: 'Point the camera at a leaf for a diagnosis' },
  { icon: MessagesSquare, text: 'Companions, soil and pests, season by season' },
];

/**
 * Placeholder shown in place of the chat while the assistant is being finished.
 * The whole chat below is still here and still works: swap the default export
 * back to <AssistantChat /> to switch it on.
 */
function ComingSoon() {
  return (
    <MotionConfig transition={{ duration: 0.6, ease: EASE }}>
      <div className="assistant-soon">
        <CornerFrond className="assistant-soon-frond" color="#e6eedf" />
        <motion.div
          className="assistant-soon-inner"
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: EASE }}
        >
          <GreenhouseArt />

          <p className="assistant-soon-badge">
            <Sprig className="assistant-season-sprig" />
            Coming soon
          </p>

          <h1>
            The <em>Planting Assistant</em> is still sprouting
          </h1>
          <p className="assistant-soon-lede">
            A garden-savvy helper that knows your beds, what’s in them and what you’ve harvested. It’s nearly ready —
            we’re letting it settle in before opening the greenhouse door.
          </p>

          <motion.ul
            className="assistant-soon-list"
            initial="hidden"
            animate="show"
            variants={{ hidden: {}, show: { transition: { staggerChildren: 0.08, delayChildren: 0.3 } } }}
          >
            {SOON_PREVIEW.map(({ icon: Icon, text }) => (
              <motion.li
                key={text}
                variants={{ hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: EASE } } }}
              >
                <span className="assistant-soon-tile" aria-hidden="true"><Icon /></span>
                {text}
              </motion.li>
            ))}
          </motion.ul>

          <Link to="/" className="btn btn-secondary assistant-soon-back">
            <ArrowLeft /> Back to the dashboard
          </Link>
        </motion.div>
      </div>
    </MotionConfig>
  );
}

export default function Assistant() {
  return <AssistantChat />;
}

function AssistantChat() {
  const { conversationId } = useParams();
  const activeId = conversationId ? Number(conversationId) : null;
  const navigate = useNavigate();
  const toast = useToast();
  const reduce = useReducedMotion();

  const [conversations, setConversations] = useState(null);
  const [enabled, setEnabled] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loadingThread, setLoadingThread] = useState(false);
  const [draft, setDraft] = useState('');
  const [attachment, setAttachment] = useState(null); // { file, url }
  const [busy, setBusy] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [lightbox, setLightbox] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);

  const rootRef = useRef(null);
  const scrollRef = useRef(null);
  const textareaRef = useRef(null);
  const cameraRef = useRef(null);
  const libraryRef = useRef(null);
  const stickToBottom = useRef(true);
  const viewing = useRef(activeId);
  const justCreated = useRef(null);
  const pendingPhotoPrompt = useRef(false);
  viewing.current = activeId;

  useViewportFit(rootRef);

  const current = conversations?.find((c) => c.id === activeId);

  // Conversation list
  useEffect(() => {
    api
      .get('/assistant/conversations')
      .then((data) => {
        setConversations(data.conversations);
        setEnabled(data.enabled);
      })
      .catch((err) => {
        setConversations([]);
        toast.error(err.message);
      });
  }, [toast]);

  // Messages for the open conversation
  useEffect(() => {
    setDrawerOpen(false);
    if (!activeId) {
      setMessages([]);
      return undefined;
    }
    if (justCreated.current === activeId) return undefined; // already showing it, mid-stream
    let cancelled = false;
    setLoadingThread(true);
    setMessages([]);
    api
      .get(`/assistant/conversations/${activeId}`)
      .then((data) => {
        if (cancelled) return;
        stickToBottom.current = true;
        setMessages(data.messages);
      })
      .catch((err) => {
        if (cancelled) return;
        toast.error(err.status === 404 ? 'That conversation no longer exists.' : err.message);
        navigate('/assistant', { replace: true });
      })
      .finally(() => !cancelled && setLoadingThread(false));
    return () => {
      cancelled = true;
    };
  }, [activeId, navigate, toast]);

  // Follow the conversation as it grows, unless the reader has scrolled up.
  const lastCount = useRef(0);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const grew = messages.length !== lastCount.current;
    lastCount.current = messages.length;
    if (!stickToBottom.current) return;
    el.scrollTo({ top: el.scrollHeight, behavior: grew && !reduce && messages.some((m) => m.fresh) ? 'smooth' : 'auto' });
  }, [messages, reduce]);

  function onScroll() {
    const el = scrollRef.current;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 90;
  }

  // Composer draft and photo
  const clearAttachment = useCallback(() => {
    setAttachment((a) => {
      if (a) URL.revokeObjectURL(a.url);
      return null;
    });
  }, []);

  async function attachPhoto(file) {
    try {
      const prepared = await preparePhoto(file);
      setAttachment((a) => {
        if (a) URL.revokeObjectURL(a.url);
        return { file: prepared, url: URL.createObjectURL(prepared) };
      });
      textareaRef.current?.focus({ preventScroll: true });
    } catch (err) {
      toast.error(err.message);
    }
  }

  function onStarter(starter) {
    if (starter.photo) {
      setDraft(starter.text);
      pendingPhotoPrompt.current = true;
      (isTouch() ? cameraRef : libraryRef).current?.click();
    } else {
      send(starter.text);
    }
  }

  function newChat() {
    setDrawerOpen(false);
    navigate('/assistant');
    setTimeout(() => textareaRef.current?.focus({ preventScroll: true }), 50);
  }

  function upsertConversation(id, patch) {
    setConversations((list) => {
      const rest = (list ?? []).filter((c) => c.id !== id);
      const existing = (list ?? []).find((c) => c.id === id);
      return [{ ...existing, ...patch, id }, ...rest];
    });
  }

  async function send(textOverride) {
    const text = (textOverride ?? draft).trim();
    const photo = attachment;
    if (busy || (!text && !photo)) return;

    setBusy(true);
    stickToBottom.current = true;
    pendingPhotoPrompt.current = false;
    const userTemp = { id: `u-${Date.now()}`, role: 'user', content: text, localUrl: photo?.url, fresh: true };
    const replyTemp = { id: `a-${Date.now()}`, role: 'assistant', content: '', streaming: true, fresh: true, photo: Boolean(photo) };
    setMessages((m) => [...m, userTemp, replyTemp]);
    setDraft('');
    setAttachment(null); // its object URL lives on in the bubble

    let convId = activeId;
    let created = false;
    let pending = '';
    let frame = 0;
    const onThisThread = () => viewing.current === convId;
    const flush = () => {
      frame = 0;
      const chunk = pending;
      pending = '';
      if (chunk && onThisThread()) {
        setMessages((m) => m.map((x) => (x.id === replyTemp.id ? { ...x, content: x.content + chunk } : x)));
      }
    };
    const fail = (message) => {
      cancelAnimationFrame(frame);
      if (onThisThread()) setMessages((m) => m.filter((x) => x.id !== userTemp.id && x.id !== replyTemp.id));
      // Give the words (and photo) back so nothing is lost.
      setDraft((d) => d || text);
      if (photo) setAttachment((a) => a ?? photo);
      toast.error(message);
    };

    try {
      if (!convId) {
        const conversation = await api.post('/assistant/conversations');
        convId = conversation.id;
        created = true;
        justCreated.current = convId;
        upsertConversation(convId, conversation);
        navigate(`/assistant/${convId}`);
      }

      const form = new FormData();
      form.append('text', text);
      if (photo) form.append('image', photo.file, photo.file.name || 'photo.jpg');

      let failed = null;
      await api.stream(`/assistant/conversations/${convId}/chat`, form, (event) => {
        if (event.type === 'start') {
          if (onThisThread()) {
            setMessages((m) => m.map((x) => (x.id === userTemp.id ? { ...event.message, localUrl: photo?.url, fresh: true } : x)));
          }
        } else if (event.type === 'delta') {
          pending += event.text;
          if (!frame) frame = requestAnimationFrame(flush);
        } else if (event.type === 'done') {
          cancelAnimationFrame(frame);
          flush();
          if (onThisThread()) {
            setMessages((m) => m.map((x) => (x.id === replyTemp.id ? { ...event.message, fresh: true } : x)));
          }
          upsertConversation(convId, { updated_at: event.message.created_at });
          // The stream stays open a little longer for the title; don't hold the composer for it.
          setBusy(false);
        } else if (event.type === 'title') {
          setConversations((list) => list?.map((c) => (c.id === convId ? { ...c, title: event.title } : c)));
        } else if (event.type === 'error') {
          failed = event.error;
        }
      });
      if (failed) throw new Error(failed);
    } catch (err) {
      fail(err.message);
      if (created) {
        // Don't leave an empty conversation behind.
        api.del(`/assistant/conversations/${convId}`).catch(() => {});
        setConversations((list) => list?.filter((c) => c.id !== convId));
        if (onThisThread()) navigate('/assistant', { replace: true });
      }
    } finally {
      setBusy(false);
      if (justCreated.current === convId) justCreated.current = null;
    }
  }

  async function deleteConversation() {
    const target = confirmDelete;
    await api.del(`/assistant/conversations/${target.id}`);
    setConversations((list) => list.filter((c) => c.id !== target.id));
    setConfirmDelete(null);
    if (target.id === activeId) navigate('/assistant', { replace: true });
    toast.success('Conversation deleted.');
  }

  // Close the drawer / lightbox with Escape.
  useEffect(() => {
    if (!drawerOpen) return undefined;
    const onKey = (e) => e.key === 'Escape' && setDrawerOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

  const closeLightbox = useCallback(() => setLightbox(null), []);
  const showEmpty = !activeId && messages.length === 0;
  const list = (
    <ConversationList
      conversations={conversations}
      activeId={activeId}
      onSelect={(id) => navigate(`/assistant/${id}`)}
      onNew={newChat}
      onDelete={setConfirmDelete}
    />
  );

  return (
    <MotionConfig reducedMotion="user">
      <div className="assistant" ref={rootRef}>
        <aside className="convo-pane" aria-label="Conversations">
          {list}
        </aside>

        <AnimatePresence>
          {drawerOpen && (
            <>
              <motion.div
                className="convo-backdrop"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setDrawerOpen(false)}
              />
              <motion.aside
                className="convo-drawer"
                aria-label="Conversations"
                initial={{ x: '-105%' }}
                animate={{ x: 0 }}
                exit={{ x: '-105%' }}
                transition={{ type: 'spring', stiffness: 380, damping: 38 }}
              >
                <ConversationList
                  conversations={conversations}
                  activeId={activeId}
                  onSelect={(id) => navigate(`/assistant/${id}`)}
                  onNew={newChat}
                  onDelete={setConfirmDelete}
                  onClose={() => setDrawerOpen(false)}
                />
              </motion.aside>
            </>
          )}
        </AnimatePresence>

        <section className="chat-pane" aria-label="Chat">
          <header className="chat-head">
            <button type="button" className="icon-btn chat-head-btn" onClick={() => setDrawerOpen(true)} aria-label="Show conversations">
              <History />
            </button>
            <div className="chat-head-text">
              <AnimatePresence mode="wait" initial={false}>
                <motion.h1
                  key={current?.title ?? 'new'}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.2 }}
                >
                  {activeId ? current?.title ?? 'Conversation' : 'Planting Assistant'}
                </motion.h1>
              </AnimatePresence>
              <p>
                <span className="chat-head-dot" aria-hidden="true" />
                <span className="chat-head-sub">Knows your beds · tuned to the Bekaa Valley</span>
              </p>
            </div>
            <button type="button" className="icon-btn chat-head-btn" onClick={newChat} aria-label="New chat">
              <MessageSquarePlus />
            </button>
          </header>

          <div className="chat-scroll" ref={scrollRef} onScroll={onScroll}>
            <div className="chat-thread" aria-live="polite" aria-busy={loadingThread || busy}>
              {showEmpty ? (
                <EmptyChat onStarter={onStarter} enabled={enabled} />
              ) : loadingThread ? (
                <div className="chat-loading" aria-label="Loading conversation">
                  <div className="skeleton" style={{ width: '46%', height: 44, marginLeft: 'auto', borderRadius: 18 }} />
                  <div className="skeleton" style={{ width: '78%', height: 120, borderRadius: 18 }} />
                  <div className="skeleton" style={{ width: '38%', height: 44, marginLeft: 'auto', borderRadius: 18 }} />
                </div>
              ) : (
                messages.map((m) => (
                  <Message
                    key={m.id}
                    message={m}
                    lookingAtPhoto={m.photo}
                    onOpenPhoto={(msg) => setLightbox(msg.localUrl ?? largeVariant(msg.image_url))}
                  />
                ))
              )}
            </div>
          </div>

          <Composer
            draft={draft}
            setDraft={setDraft}
            attachment={attachment}
            onAttach={attachPhoto}
            onRemoveAttachment={() => {
              clearAttachment();
              if (pendingPhotoPrompt.current) {
                pendingPhotoPrompt.current = false;
                setDraft('');
              }
            }}
            onSend={() => send()}
            busy={busy}
            textareaRef={textareaRef}
            cameraRef={cameraRef}
            libraryRef={libraryRef}
          />
        </section>
      </div>

      <AnimatePresence>{lightbox && <Lightbox src={lightbox} onClose={closeLightbox} />}</AnimatePresence>

      {createPortal(
        <ConfirmDialog
          open={Boolean(confirmDelete)}
          title="Delete this conversation?"
          message={confirmDelete ? `“${confirmDelete.title}” and its photos will be removed for good.` : ''}
          onConfirm={deleteConversation}
          onCancel={() => setConfirmDelete(null)}
        />,
        document.body,
      )}
    </MotionConfig>
  );
}
