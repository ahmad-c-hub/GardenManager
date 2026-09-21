const CURRENCY = import.meta.env.VITE_CURRENCY || 'USD';

const money = new Intl.NumberFormat(undefined, { style: 'currency', currency: CURRENCY });
const moneyRound = new Intl.NumberFormat(undefined, {
  style: 'currency',
  currency: CURRENCY,
  maximumFractionDigits: 0,
});
const moneyCompact = new Intl.NumberFormat(undefined, {
  style: 'currency',
  currency: CURRENCY,
  notation: 'compact',
  maximumFractionDigits: 1,
});
const kg = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
const kgShort = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });

export const formatMoney = (n) => money.format(Number(n) || 0);
export const formatMoneyRound = (n) => moneyRound.format(Number(n) || 0);
export const formatMoneyCompact = (n) => moneyCompact.format(Number(n) || 0);
export const formatKg = (n) => kg.format(Number(n) || 0);
export const formatKgShort = (n) => kgShort.format(Number(n) || 0);

/** The currency symbol on its own, e.g. "$" or "€" (for input prefixes). */
export const currencySymbol =
  money.formatToParts(0).find((p) => p.type === 'currency')?.value ?? CURRENCY;

/** 'YYYY-MM-DD' -> local Date at midnight (no timezone drift). */
export function parseISODate(value) {
  if (!value) return null;
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d || 1);
}

export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const dateFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const dateShortFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });
const monthFmt = new Intl.DateTimeFormat(undefined, { month: 'short' });
const monthYearFmt = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' });
const monthShortYearFmt = new Intl.DateTimeFormat(undefined, { month: 'short', year: 'numeric' });
const longDateFmt = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long' });

export const formatDate = (iso) => (iso ? dateFmt.format(parseISODate(iso)) : '—');
export const formatDateShort = (iso) => (iso ? dateShortFmt.format(parseISODate(iso)) : '—');
export const formatMonth = (ym) => monthFmt.format(parseISODate(ym));
export const formatMonthYear = (ym) => monthYearFmt.format(parseISODate(ym));
export const formatMonthShortYear = (ym) => monthShortYearFmt.format(parseISODate(ym));
export const formatLongToday = () => longDateFmt.format(new Date());

/** Whole days from today until `iso` (negative = in the past). */
export function daysUntil(iso) {
  const target = parseISODate(iso);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target - today) / 86_400_000);
}

export function relativeDays(iso) {
  const n = daysUntil(iso);
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n === -1) return 'yesterday';
  if (n > 0) return n < 60 ? `in ${n} days` : `in ${Math.round(n / 30)} months`;
  return -n < 60 ? `${-n} days ago` : `${Math.round(-n / 30)} months ago`;
}

const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
const TIME_STEPS = [
  ['year', 365 * 86_400],
  ['month', 30 * 86_400],
  ['week', 7 * 86_400],
  ['day', 86_400],
  ['hour', 3_600],
  ['minute', 60],
];

/** "just now", "5 minutes ago", "yesterday", "2 days ago" for a timestamp. */
export function timeAgo(timestamp) {
  const seconds = Math.round((new Date(timestamp) - Date.now()) / 1000);
  if (Math.abs(seconds) < 45) return 'just now';
  for (const [unit, size] of TIME_STEPS) {
    if (Math.abs(seconds) >= size) return rtf.format(Math.round(seconds / size), unit);
  }
  return rtf.format(Math.round(seconds / 60), 'minute');
}

/** Group rows by the 'YYYY-MM' of a date field, keeping order. */
export function groupByMonth(rows, dateField) {
  const groups = [];
  const index = new Map();
  for (const row of rows) {
    const key = row[dateField].slice(0, 7);
    if (!index.has(key)) {
      index.set(key, groups.length);
      groups.push({ month: key, rows: [] });
    }
    groups[index.get(key)].rows.push(row);
  }
  return groups;
}

export function greeting() {
  const h = new Date().getHours();
  if (h < 5) return 'Good evening';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}
