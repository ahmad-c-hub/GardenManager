import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertCircle, CheckCircle2 } from 'lucide-react';

const ToastContext = createContext(null);
let nextId = 1;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const dismiss = useCallback((id) => setToasts((all) => all.filter((t) => t.id !== id)), []);

  const push = useCallback(
    (message, tone = 'success') => {
      const id = nextId++;
      setToasts((all) => [...all.slice(-2), { id, message, tone }]);
      setTimeout(() => dismiss(id), 3200);
    },
    [dismiss],
  );

  const value = useMemo(
    () => ({ success: (m) => push(m, 'success'), error: (m) => push(m, 'error') }),
    [push],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-region" role="status" aria-live="polite">
        <AnimatePresence initial={false}>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              layout
              className={`toast ${t.tone === 'error' ? 'error' : ''}`}
              initial={{ opacity: 0, y: 16, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.96, transition: { duration: 0.15 } }}
              transition={{ type: 'spring', stiffness: 420, damping: 32 }}
              onClick={() => dismiss(t.id)}
            >
              {t.tone === 'error' ? <AlertCircle /> : <CheckCircle2 />}
              <span>{t.message}</span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}
