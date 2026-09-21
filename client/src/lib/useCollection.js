import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.js';

/**
 * Loads GET /api{path}?{params} and keeps it fresh.
 * Returns { data, loading, error, reload }.
 */
export function useCollection(path, params) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const key = JSON.stringify(params ?? {});
  const requestId = useRef(0);

  const reload = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    try {
      const result = await api.get(path, JSON.parse(key));
      // Ignore responses that arrive after a newer request (e.g. fast filter changes).
      if (id === requestId.current) {
        setData(result);
        setError(null);
      }
    } catch (err) {
      if (id === requestId.current) setError(err);
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [path, key]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { data, loading, error, reload };
}
