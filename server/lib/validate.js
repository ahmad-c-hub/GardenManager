import { badRequest } from './errors.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

export function isValidDate(value) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

function toNumber(value) {
  return typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
}

// Each checker returns an error message (string) or { value } with the cleaned value.
const checkers = {
  string(value, rule) {
    if (typeof value !== 'string') return 'must be text';
    const trimmed = value.trim();
    if (rule.max && trimmed.length > rule.max) return `must be at most ${rule.max} characters`;
    return { value: trimmed === '' ? null : trimmed };
  },
  number(value, rule) {
    const num = toNumber(value);
    if (typeof num !== 'number' || !Number.isFinite(num)) return 'must be a number';
    if (rule.gt !== undefined && num <= rule.gt) return `must be greater than ${rule.gt}`;
    if (rule.min !== undefined && num < rule.min) return `must be at least ${rule.min}`;
    if (rule.max !== undefined && num > rule.max) return `must be at most ${rule.max}`;
    // Store at 2 decimal places, matching the NUMERIC(…,2) columns.
    return { value: Math.round(num * 100) / 100 };
  },
  integer(value, rule) {
    const num = toNumber(value);
    if (!Number.isInteger(num)) return 'must be a whole number';
    if (rule.min !== undefined && num < rule.min) return `must be at least ${rule.min}`;
    if (rule.max !== undefined && num > rule.max) return `must be at most ${rule.max}`;
    return { value: num };
  },
  boolean(value) {
    if (typeof value !== 'boolean') return 'must be true or false';
    return { value };
  },
  id(value) {
    const num = toNumber(value);
    if (!Number.isInteger(num) || num < 1) return 'must be a valid id';
    return { value: num };
  },
  date(value) {
    if (!isValidDate(value)) return 'must be a date (YYYY-MM-DD)';
    return { value };
  },
  // An instant with an explicit offset, so there's no guessing whose "9:00" it is.
  datetime(value) {
    if (typeof value !== 'string' || !DATETIME_RE.test(value)) return 'must be a date and time with a timezone (ISO 8601)';
    const date = new Date(value);
    const year = date.getUTCFullYear();
    if (Number.isNaN(date.getTime()) || year < 2000 || year > 2100) return 'must be a real date and time';
    return { value: date.toISOString() };
  },
  enum(value, rule) {
    if (!rule.values.includes(value)) return `must be one of: ${rule.values.join(', ')}`;
    return { value };
  },
};

/**
 * Validate `input` against `schema`, returning only known, cleaned fields.
 * With { partial: true } (updates), missing fields are skipped, but fields
 * that are present are still fully validated.
 */
export function validate(schema, input, { partial = false } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw badRequest('Request body must be a JSON object.');
  }
  const out = {};
  const errors = {};

  for (const [field, rule] of Object.entries(schema)) {
    if (!Object.hasOwn(input, field)) {
      if (partial) continue;
      if (rule.required) errors[field] = 'is required';
      else out[field] = rule.default ?? null;
      continue;
    }

    const value = input[field];
    if (value === null || value === '') {
      if (rule.required) errors[field] = 'is required';
      else out[field] = null;
      continue;
    }

    const result = checkers[rule.type](value, rule);
    if (typeof result === 'string') errors[field] = result;
    else if (result.value === null && rule.required) errors[field] = 'is required';
    else out[field] = result.value;
  }

  if (Object.keys(errors).length > 0) {
    const summary = Object.entries(errors)
      .map(([field, msg]) => `${field.replaceAll('_', ' ')} ${msg}`)
      .join('; ');
    throw badRequest(summary.charAt(0).toUpperCase() + summary.slice(1) + '.', errors);
  }
  if (partial && Object.keys(out).length === 0) {
    throw badRequest('Nothing to update.');
  }
  return out;
}

export function parseId(raw) {
  const id = Number(raw);
  if (!Number.isInteger(id) || id < 1) throw badRequest('Invalid id.');
  return id;
}

export function parseQueryDate(raw, name) {
  if (raw === undefined || raw === '') return undefined;
  if (!isValidDate(raw)) throw badRequest(`${name} must be a date (YYYY-MM-DD).`);
  return raw;
}
