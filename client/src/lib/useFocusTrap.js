import { useEffect } from 'react';

// Keeps Tab / Shift+Tab inside the topmost open dialog. Dialogs can stack
// (a confirm over the gallery), so only the most recently opened one traps.
const stack = [];

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'video[controls]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function focusables(root) {
  return [...root.querySelectorAll(FOCUSABLE)].filter(
    (el) => !el.closest('[inert]') && !el.closest('[aria-hidden="true"]') && el.getClientRects().length > 0,
  );
}

function onKeyDown(e) {
  if (e.key !== 'Tab') return;
  const root = stack.at(-1)?.current;
  if (!root) return;
  const items = focusables(root);
  if (items.length === 0) {
    e.preventDefault();
    return;
  }
  const first = items[0];
  const last = items.at(-1);
  const active = document.activeElement;
  if (!root.contains(active)) {
    e.preventDefault();
    first.focus();
  } else if (e.shiftKey && active === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && active === last) {
    e.preventDefault();
    first.focus();
  }
}

/** While `active`, Tab cycles within `ref.current`. */
export function useFocusTrap(ref, active) {
  useEffect(() => {
    if (!active) return undefined;
    stack.push(ref);
    if (stack.length === 1) document.addEventListener('keydown', onKeyDown);
    return () => {
      const i = stack.lastIndexOf(ref);
      if (i >= 0) stack.splice(i, 1);
      if (stack.length === 0) document.removeEventListener('keydown', onKeyDown);
    };
  }, [ref, active]);
}
