import { useCallback, useState } from 'react';

/**
 * Tiny form-state helper.
 *   const form = useForm({ amount: '' });
 *   <input {...form.bind('amount')} />
 *   form.submit(async (values) => { ... })  // handles busy + error state
 */
export function useForm(initial) {
  const [values, setValues] = useState(initial);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const set = useCallback((field, value) => setValues((v) => ({ ...v, [field]: value })), []);

  const bind = (field) => ({
    name: field,
    value: values[field] ?? '',
    onChange: (e) => set(field, e.target.value),
  });

  const reset = useCallback((next = initial) => {
    setValues(next);
    setError(null);
  }, [initial]);

  const submit = (handler) => async (e) => {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await handler(values);
    } catch (err) {
      setError(err.message || 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  return { values, setValues, set, bind, reset, submit, error, setError, busy };
}

/** Turn '' into null and numeric strings into numbers for the API. */
export function clean(values, numericFields = []) {
  const out = {};
  for (const [k, v] of Object.entries(values)) {
    if (v === '' || v === undefined) out[k] = null;
    else if (numericFields.includes(k)) out[k] = Number(v);
    else out[k] = v;
  }
  return out;
}
