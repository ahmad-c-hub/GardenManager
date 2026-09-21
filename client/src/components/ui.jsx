import { useEffect, useId, useRef, useState } from 'react';
import { AnimatePresence, animate, motion, useReducedMotion } from 'framer-motion';
import { AlertCircle, X } from 'lucide-react';
import { PotArt } from './Botanical.jsx';

export function PageHeader({ eyebrow, eyebrowIcon: EyebrowIcon, title, subtitle, actions }) {
  return (
    <header className="page-header">
      <div className="page-header-text">
        {eyebrow && (
          <p className="eyebrow">
            {EyebrowIcon && <EyebrowIcon />}
            {eyebrow}
          </p>
        )}
        <h1>{title}</h1>
        {subtitle && <p className="page-subtitle">{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

/** Animates a number from its previous value to `value`. */
export function CountUp({ value, format }) {
  const reduce = useReducedMotion();
  const [display, setDisplay] = useState(reduce ? value : 0);
  const from = useRef(reduce ? value : 0);

  useEffect(() => {
    if (reduce) {
      setDisplay(value);
      return undefined;
    }
    const controls = animate(from.current, value, {
      duration: 1.1,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: setDisplay,
    });
    from.current = value;
    return () => controls.stop();
  }, [value, reduce]);

  return <>{format(display)}</>;
}

export function Field({ label, hint, optional, children, className = '' }) {
  const id = useId();
  // Give the single child control an id so the label is associated with it.
  const child = typeof children === 'function' ? children(id) : children;
  return (
    <div className={`field ${className}`}>
      {label && (
        <label className="field-label" htmlFor={id}>
          {label}
          {optional && <span className="optional">optional</span>}
        </label>
      )}
      {child}
      {hint && <span className="field-hint">{hint}</span>}
    </div>
  );
}

export function FormError({ error }) {
  return (
    <AnimatePresence>
      {error && (
        <motion.div
          className="form-error"
          role="alert"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto', x: [0, -6, 6, -3, 3, 0] }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.35 }}
        >
          <AlertCircle />
          <span>{error}</span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function Modal({ open, onClose, title, description, children, size }) {
  const panelRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const previouslyFocused = document.activeElement;
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    // Focus the first field once the panel has mounted.
    const t = setTimeout(() => {
      panelRef.current?.querySelector('input, select, textarea, button:not(.icon-btn)')?.focus();
    }, 60);
    return () => {
      clearTimeout(t);
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      previouslyFocused?.focus?.();
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onMouseDown={(e) => e.target === e.currentTarget && onClose()}
        >
          <motion.div
            ref={panelRef}
            className={`modal ${size === 'sm' ? 'modal-sm' : ''}`}
            role="dialog"
            aria-modal="true"
            aria-label={typeof title === 'string' ? title : undefined}
            initial={{ opacity: 0, y: 24, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98, transition: { duration: 0.15 } }}
            transition={{ type: 'spring', stiffness: 380, damping: 32 }}
          >
            <div className="modal-header">
              <div>
                <h2>{title}</h2>
                {description && <p>{description}</p>}
              </div>
              <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
                <X />
              </button>
            </div>
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function ConfirmDialog({ open, title, message, confirmLabel = 'Delete', onConfirm, onCancel }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (open) setError(null);
  }, [open]);

  async function handleConfirm() {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onCancel} title={title} size="sm">
      <p className="confirm-message">{message}</p>
      <div className="mt-4">
        <FormError error={error} />
      </div>
      <div className="form-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="btn btn-danger" onClick={handleConfirm} disabled={busy}>
          {busy ? <span className="spinner" /> : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

export function EmptyState({ title, message, action }) {
  return (
    <div className="empty">
      <PotArt />
      <h3>{title}</h3>
      <p>{message}</p>
      {action}
    </div>
  );
}

export function ErrorBanner({ error, onRetry }) {
  return (
    <div className="error-banner" role="alert">
      <span>{error.message || 'Something went wrong.'}</span>
      {onRetry && (
        <button className="btn btn-secondary btn-sm" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function SkeletonRows({ rows = 4 }) {
  return (
    <div aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} style={{ display: 'flex', gap: 16, alignItems: 'center', padding: '14px 0' }}>
          <div className="skeleton" style={{ width: 40, height: 40, borderRadius: 12 }} />
          <div style={{ flex: 1 }}>
            <div className="skeleton" style={{ width: '45%', height: 14, marginBottom: 8 }} />
            <div className="skeleton" style={{ width: '28%', height: 12 }} />
          </div>
          <div className="skeleton" style={{ width: 70, height: 16 }} />
        </div>
      ))}
    </div>
  );
}

export function StatusBadge({ status }) {
  return (
    <span className={`badge badge-${status}`}>
      <span className="dot" />
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}
