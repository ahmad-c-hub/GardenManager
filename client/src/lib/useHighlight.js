import { useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';

const FLASH_MS = 2400;

/**
 * Deep link from a tapped notification. A push carries a URL like
 * `/savings?highlight=42`; this scrolls that row into view, flashes it, then
 * tidies the parameter out of the URL so a reload doesn't jump again.
 *
 * Rows opt in by rendering `data-entry-id={id}`. Pass `ready` as false while
 * the list is still loading — otherwise we'd look for a row that isn't there
 * yet and the link would silently do nothing.
 */
export function useHighlight(ready, param = 'highlight') {
  const [params, setParams] = useSearchParams();
  const id = params.get(param);
  const handled = useRef(null);

  useEffect(() => {
    if (!id || !ready || handled.current === id) return;
    handled.current = id;

    // One frame so the freshly-rendered list has actually painted.
    requestAnimationFrame(() => {
      const el = document.querySelector(`[data-entry-id="${CSS.escape(id)}"]`);
      if (el) {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        el.classList.add('is-highlighted');
        setTimeout(() => el.classList.remove('is-highlighted'), FLASH_MS);
      }
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete(param);
          return next;
        },
        { replace: true },
      );
    });
  }, [id, ready, param, setParams]);
}
