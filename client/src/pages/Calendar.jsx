import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertCircle,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Fence,
  List,
  Plus,
  Repeat,
  Sprout,
  Trash2,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { useCollection } from '../lib/useCollection.js';
import { useForm } from '../lib/useForm.js';
import { useToast } from '../lib/toast.jsx';
import { listItem } from '../lib/motion.js';
import { parseISODate, todayISO } from '../lib/format.js';
import { ConfirmDialog, EmptyState, ErrorBanner, Field, FormError, Modal, PageHeader, SkeletonRows } from '../components/ui.jsx';
import { Sprig } from '../components/Botanical.jsx';

const RECURRENCES = [
  { value: 'none', label: 'Once' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
];
const AGENDA_BACK_DAYS = 30; // how far back overdue items are looked for
const AGENDA_WEEKS_STEP = 4; // the agenda looks ahead this many weeks at a time
const AGENDA_MAX_WEEKS = 52;
const MAX_PILLS = 3;

/* ---------- Dates (all local, as 'YYYY-MM-DD') ---------- */

const pad = (n) => String(n).padStart(2, '0');
const isoOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
function addDays(iso, n) {
  const d = parseISODate(iso);
  d.setDate(d.getDate() + n);
  return isoOf(d);
}
const monthStart = (iso) => `${iso.slice(0, 7)}-01`;
function addMonths(iso, n) {
  const d = parseISODate(monthStart(iso));
  d.setMonth(d.getMonth() + n);
  return isoOf(d);
}
/** Monday on or before `iso`. */
function weekStart(iso) {
  const d = parseISODate(iso);
  return addDays(iso, -((d.getDay() + 6) % 7));
}
/** The Monday-first weeks covering a month: 4–6 rows of 7 dates. */
function monthWeeks(month) {
  const first = weekStart(month);
  const nextMonth = addMonths(month, 1);
  const weeks = [];
  for (let day = first; day < nextMonth; day = addDays(day, 7)) {
    weeks.push(Array.from({ length: 7 }, (_, i) => addDays(day, i)));
  }
  return weeks;
}
const localDateOf = (timestamp) => isoOf(new Date(timestamp));

const weekdayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
const WEEKDAYS = Array.from({ length: 7 }, (_, i) => weekdayFmt.format(new Date(2024, 0, 1 + i))); // 1 Jan 2024 was a Monday
const monthNameFmt = new Intl.DateTimeFormat(undefined, { month: 'long' });
const dayLabelFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
const longDayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

function dayLabel(iso, today) {
  if (iso === today) return 'Today';
  if (iso === addDays(today, 1)) return 'Tomorrow';
  if (iso === addDays(today, -1)) return 'Yesterday';
  return dayLabelFmt.format(parseISODate(iso));
}

/** "9:00 AM" -> { time: '9:00', period: 'AM' } for the agenda's time column. */
function splitTime(timestamp) {
  const parts = timeFmt.formatToParts(new Date(timestamp));
  const period = parts.find((p) => p.type === 'dayPeriod')?.value ?? '';
  const time = parts.filter((p) => p.type !== 'dayPeriod').map((p) => p.value).join('').trim();
  return { time, period };
}

const occurrenceKey = (o) => `${o.id}:${o.occurrence_date}`;
const isOverdue = (o, now) => !o.completed && new Date(o.occurs_at) < now;

/* ---------- Form ---------- */

function WorkItemForm({ initial, beds, plants, submitLabel, onSubmit, onCancel, onDelete }) {
  const form = useForm(initial);
  const { values } = form;

  const handle = form.submit(async (v) => {
    const at = new Date(`${v.date}T${v.time || '09:00'}`);
    if (Number.isNaN(at.getTime())) throw new Error('Please choose a date and time.');
    await onSubmit({
      title: v.title,
      description: v.description || null,
      scheduled_at: at.toISOString(),
      recurrence: v.recurrence,
      bed_id: v.bed_id ? Number(v.bed_id) : null,
      plant_id: v.plant_id ? Number(v.plant_id) : null,
    });
  });

  // Picking a plant fills in its bed, which can still be changed.
  function choosePlant(e) {
    const id = e.target.value;
    const plant = plants.find((p) => String(p.id) === id);
    form.setValues((v) => ({ ...v, plant_id: id, bed_id: plant?.bed_id ? String(plant.bed_id) : v.bed_id }));
  }

  return (
    <form onSubmit={handle} noValidate>
      <div className="form-grid">
        <Field label="What needs doing" className="span-2">
          {(id) => <input id={id} className="input" maxLength={200} placeholder="e.g. Prune tomatoes" {...form.bind('title')} />}
        </Field>
        <Field label="Date">
          {(id) => <input id={id} className="input" type="date" {...form.bind('date')} />}
        </Field>
        <Field label="Time">
          {(id) => <input id={id} className="input" type="time" step="300" {...form.bind('time')} />}
        </Field>
        <div className="field span-2">
          <span className="field-label" id="repeat-label">Repeats</span>
          <div className="segmented work-repeat" role="radiogroup" aria-labelledby="repeat-label">
            {RECURRENCES.map((r) => (
              <button
                key={r.value}
                type="button"
                role="radio"
                aria-checked={values.recurrence === r.value}
                aria-pressed={values.recurrence === r.value}
                onClick={() => form.set('recurrence', r.value)}
              >
                {values.recurrence === r.value && (
                  <motion.span layoutId="work-repeat-seg" className="seg-pill" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />
                )}
                <span className="seg-label">{r.label}</span>
              </button>
            ))}
          </div>
        </div>
        <Field label="Bed" optional>
          {(id) => (
            <select id={id} className="select" {...form.bind('bed_id')}>
              <option value="">—</option>
              {beds.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          )}
        </Field>
        <Field label="Plant" optional>
          {(id) => (
            <select id={id} className="select" value={values.plant_id} onChange={choosePlant}>
              <option value="">—</option>
              {plants.map((p) => (
                <option key={p.id} value={p.id}>{p.name}{p.variety ? ` · ${p.variety}` : ''}</option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Notes" optional className="span-2">
          {(id) => <textarea id={id} className="textarea" rows={3} maxLength={2000} placeholder="Anything to remember — tools, amounts, which rows…" {...form.bind('description')} />}
        </Field>
      </div>
      <div className="mt-4"><FormError error={form.error} /></div>
      <div className="form-actions work-actions">
        {onDelete && (
          <button type="button" className="btn btn-ghost work-delete" onClick={onDelete}>
            <Trash2 /> Delete
          </button>
        )}
        <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={form.busy || !values.title.trim() || !values.date}>
          {form.busy ? <span className="spinner" /> : submitLabel}
        </button>
      </div>
    </form>
  );
}

const blankItem = (date) => ({
  title: '',
  description: '',
  date: date ?? todayISO(),
  time: '09:00',
  recurrence: 'none',
  bed_id: '',
  plant_id: '',
});

function itemToForm(item) {
  const start = new Date(item.scheduled_at);
  return {
    title: item.title,
    description: item.description ?? '',
    date: isoOf(start),
    time: `${pad(start.getHours())}:${pad(start.getMinutes())}`,
    recurrence: item.recurrence,
    bed_id: item.bed_id ? String(item.bed_id) : '',
    plant_id: item.plant_id ? String(item.plant_id) : '',
  };
}

/* ---------- Pieces ---------- */

function CheckButton({ checked, onToggle, label }) {
  return (
    <button
      type="button"
      className={`work-check ${checked ? 'is-checked' : ''}`}
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
    >
      <AnimatePresence initial={false}>
        {checked && (
          <motion.span
            key="tick"
            className="work-check-tick"
            initial={{ scale: 0.4, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.4, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 520, damping: 26 }}
          >
            <Check />
          </motion.span>
        )}
      </AnimatePresence>
    </button>
  );
}

function RecurrenceBadge({ recurrence }) {
  if (recurrence === 'none') return null;
  return (
    <span className="work-badge">
      <Repeat /> {recurrence === 'weekly' ? 'Weekly' : 'Monthly'}
    </span>
  );
}

function WorkCard({ occ, now, onOpen, onToggle, showDate }) {
  const { time, period } = splitTime(occ.occurs_at);
  const overdue = isOverdue(occ, now);
  return (
    <motion.li layout className={`work-card ${occ.completed ? 'is-done' : ''} ${overdue ? 'is-overdue' : ''}`} {...listItem}>
      <CheckButton
        checked={occ.completed}
        onToggle={() => onToggle(occ)}
        label={`${occ.completed ? 'Mark not done' : 'Mark done'}: ${occ.title}`}
      />
      <button type="button" className="work-card-main" onClick={() => onOpen(occ)}>
        <span className="work-time">
          {time}
          {period && <small>{period}</small>}
        </span>
        <span className="work-body">
          <span className="work-title">{occ.title}</span>
          <span className="work-meta">
            {showDate && <span>{dayLabelFmt.format(parseISODate(localDateOf(occ.occurs_at)))}</span>}
            {overdue && <span className="work-overdue"><AlertCircle /> Overdue</span>}
            {occ.bed_name && <span className="meta-icon"><Fence size={13} /> {occ.bed_name}</span>}
            {occ.plant_name && <span className="meta-icon"><Sprout size={13} /> {occ.plant_name}</span>}
            <RecurrenceBadge recurrence={occ.recurrence} />
          </span>
        </span>
      </button>
    </motion.li>
  );
}

/* ---------- Month view ---------- */

function MonthGrid({ month, direction, today, selected, byDate, now, onSelect, onOpen }) {
  const weeks = monthWeeks(month);
  return (
    <div className="cal-grid-wrap">
      <div className="cal-weekdays" aria-hidden="true">
        {WEEKDAYS.map((d) => <span key={d}>{d}</span>)}
      </div>
      <AnimatePresence mode="popLayout" initial={false} custom={direction}>
        <motion.div
          key={month}
          className="cal-grid"
          role="grid"
          aria-label={`${monthNameFmt.format(parseISODate(month))} ${month.slice(0, 4)}`}
          custom={direction}
          initial={{ opacity: 0, x: direction * 28 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: direction * -28 }}
          transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
        >
          {weeks.map((week) => (
            <div className="cal-week" role="row" key={week[0]}>
              {week.map((day) => {
                const items = byDate.get(day) ?? [];
                const outside = day.slice(0, 7) !== month.slice(0, 7);
                const label = `${longDayFmt.format(parseISODate(day))}${items.length ? `, ${items.length} item${items.length === 1 ? '' : 's'}` : ''}`;
                return (
                  <div
                    key={day}
                    role="gridcell"
                    aria-selected={day === selected}
                    className={[
                      'cal-day',
                      outside && 'is-outside',
                      day === today && 'is-today',
                      day === selected && 'is-selected',
                      items.length > 0 && 'has-items',
                    ].filter(Boolean).join(' ')}
                    onClick={() => onSelect(day)}
                  >
                    <button type="button" className="cal-date" onClick={(e) => { e.stopPropagation(); onSelect(day); }} aria-label={label}>
                      {Number(day.slice(8))}
                    </button>
                    {items.length > 0 && (
                      <>
                        <div className="cal-pills">
                          {items.slice(0, MAX_PILLS).map((o) => (
                            <button
                              key={occurrenceKey(o)}
                              type="button"
                              className={`cal-pill ${o.completed ? 'is-done' : ''} ${isOverdue(o, now) ? 'is-overdue' : ''}`}
                              onClick={(e) => { e.stopPropagation(); onOpen(o); }}
                              title={`${timeFmt.format(new Date(o.occurs_at))} · ${o.title}`}
                            >
                              <span className="cal-pill-time">{splitTime(o.occurs_at).time}</span>
                              {o.title}
                            </button>
                          ))}
                          {items.length > MAX_PILLS && <span className="cal-more">+{items.length - MAX_PILLS} more</span>}
                        </div>
                        {/* Phones: quiet dots instead of pills; the day's list sits below. */}
                        <div className="cal-dots" aria-hidden="true">
                          {items.slice(0, 3).map((o) => (
                            <span key={occurrenceKey(o)} className={`cal-dot ${o.completed ? 'is-done' : ''} ${isOverdue(o, now) ? 'is-overdue' : ''}`} />
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function DayPanel({ day, today, items, now, onOpen, onToggle, onAdd }) {
  return (
    <aside className="card card-pad cal-daypanel" aria-live="polite">
      <div className="cal-daypanel-head">
        <div>
          <p className="cal-daypanel-eyebrow">{day === today ? 'Today' : dayLabel(day, today)}</p>
          <h3>{longDayFmt.format(parseISODate(day))}</h3>
        </div>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => onAdd(day)}>
          <Plus /> Add
        </button>
      </div>
      {items.length === 0 ? (
        <p className="cal-daypanel-empty">
          <Sprig className="cal-sprig" />
          Nothing planned — a free day in the garden.
        </p>
      ) : (
        <ul className="work-list">
          <AnimatePresence initial={false}>
            {items.map((o) => (
              <WorkCard key={occurrenceKey(o)} occ={o} now={now} onOpen={onOpen} onToggle={onToggle} />
            ))}
          </AnimatePresence>
        </ul>
      )}
    </aside>
  );
}

/* ---------- Agenda view ---------- */

function Agenda({ occurrences, today, now, weeks, onMore, loadingMore, onOpen, onToggle, onAdd }) {
  const groups = useMemo(() => {
    const overdue = [];
    const days = new Map();
    for (const o of occurrences) {
      const day = localDateOf(o.occurs_at);
      if (day < today) {
        if (!o.completed) overdue.push(o);
        continue;
      }
      if (!days.has(day)) days.set(day, []);
      days.get(day).push(o);
    }
    return { overdue, days: [...days.entries()] };
  }, [occurrences, today]);

  if (groups.overdue.length === 0 && groups.days.length === 0) {
    return (
      <div className="card">
        <EmptyState
          title="Nothing on the calendar"
          message="Plan the next bit of garden work — pruning, feeding, sowing — and everyone gets a nudge the day before."
          action={<button className="btn btn-primary" onClick={() => onAdd(today)}><Plus /> Add work item</button>}
        />
      </div>
    );
  }

  return (
    <div className="agenda">
      {groups.overdue.length > 0 && (
        <section className="agenda-day is-overdue">
          <header className="agenda-head">
            <h3><AlertCircle /> Overdue</h3>
            <span>{groups.overdue.length} still to do</span>
          </header>
          <ul className="work-list">
            <AnimatePresence initial={false}>
              {groups.overdue.map((o) => (
                <WorkCard key={occurrenceKey(o)} occ={o} now={now} onOpen={onOpen} onToggle={onToggle} showDate />
              ))}
            </AnimatePresence>
          </ul>
        </section>
      )}
      {groups.days.map(([day, items]) => (
        <section key={day} className={`agenda-day ${day === today ? 'is-today' : ''}`}>
          <header className="agenda-head">
            <h3>{dayLabel(day, today)}</h3>
            <span>{day === today || day === addDays(today, 1) ? longDayFmt.format(parseISODate(day)) : `${items.length} item${items.length === 1 ? '' : 's'}`}</span>
          </header>
          <ul className="work-list">
            <AnimatePresence initial={false}>
              {items.map((o) => (
                <WorkCard key={occurrenceKey(o)} occ={o} now={now} onOpen={onOpen} onToggle={onToggle} />
              ))}
            </AnimatePresence>
          </ul>
        </section>
      ))}
      <div className="agenda-end">
        <Sprig className="cal-sprig" />
        <p>That’s everything for the next {weeks} weeks.</p>
        {weeks < AGENDA_MAX_WEEKS && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={onMore} disabled={loadingMore}>
            {loadingMore ? <span className="spinner" /> : `Show ${AGENDA_WEEKS_STEP} more weeks`}
          </button>
        )}
      </div>
    </div>
  );
}

/* ---------- Page ---------- */

const VIEW_KEY = 'gm.calendar.view';
function initialView() {
  try {
    return localStorage.getItem(VIEW_KEY) === 'agenda' ? 'agenda' : 'month';
  } catch {
    return 'month';
  }
}

export default function Calendar() {
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const today = todayISO();
  const [view, setView] = useState(initialView);
  const [month, setMonth] = useState(() => monthStart(params.get('date') || today));
  const [direction, setDirection] = useState(1);
  const [selected, setSelected] = useState(() => params.get('date') || today);
  const [modal, setModal] = useState(null); // { mode: 'create', date } | { mode: 'edit', occ }
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [overrides, setOverrides] = useState({}); // optimistic completion, by occurrence key
  const [now, setNow] = useState(() => new Date());
  const [agendaWeeks, setAgendaWeeks] = useState(AGENDA_WEEKS_STEP);

  const { data: beds } = useCollection('/beds');
  const { data: plants } = useCollection('/plants');

  const range = useMemo(() => {
    if (view === 'agenda') return { from: addDays(today, -AGENDA_BACK_DAYS), to: addDays(today, agendaWeeks * 7) };
    const weeks = monthWeeks(month);
    return { from: weeks[0][0], to: weeks.at(-1)[6] };
  }, [view, month, today, agendaWeeks]);
  const { data, loading, error, reload } = useCollection('/work-items', range);

  // A notification link (?date=…) jumps to that day once, then tidies the URL.
  useEffect(() => {
    const date = params.get('date');
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    setMonth(monthStart(date));
    setSelected(date);
    setParams({}, { replace: true });
  }, [params, setParams]);

  // Keep "overdue" honest if the page stays open.
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    try { localStorage.setItem(VIEW_KEY, view); } catch { /* private mode */ }
  }, [view]);

  // Fresh data replaces any optimistic ticks.
  useEffect(() => setOverrides({}), [data]);

  const occurrences = useMemo(
    () => (data ?? []).map((o) => (occurrenceKey(o) in overrides ? { ...o, completed: overrides[occurrenceKey(o)] } : o)),
    [data, overrides],
  );
  const byDate = useMemo(() => {
    const map = new Map();
    for (const o of occurrences) {
      const day = localDateOf(o.occurs_at);
      if (!map.has(day)) map.set(day, []);
      map.get(day).push(o);
    }
    return map;
  }, [occurrences]);

  function goMonth(step) {
    const next = addMonths(month, step);
    setDirection(step);
    setMonth(next);
    setSelected(next.slice(0, 7) === today.slice(0, 7) ? today : next);
  }
  function goToday() {
    setDirection(today > month ? 1 : -1);
    setMonth(monthStart(today));
    setSelected(today);
  }
  function select(day) {
    setSelected(day);
    if (day.slice(0, 7) !== month.slice(0, 7)) {
      setDirection(day > month ? 1 : -1);
      setMonth(monthStart(day));
    }
  }

  async function toggle(occ) {
    const key = occurrenceKey(occ);
    const completed = !occ.completed;
    setOverrides((o) => ({ ...o, [key]: completed }));
    try {
      await api.patch(`/work-items/${occ.id}/complete`, {
        completed,
        ...(occ.recurrence !== 'none' && { occurrence_date: occ.occurrence_date }),
      });
      if (completed) toast.success(`Done: ${occ.title}`);
      reload();
    } catch (err) {
      setOverrides((o) => {
        const { [key]: _, ...rest } = o;
        return rest;
      });
      toast.error(err.message);
    }
  }

  async function save(values) {
    if (modal.mode === 'edit') {
      await api.put(`/work-items/${modal.occ.id}`, values);
      toast.success('Work item updated');
    } else {
      await api.post('/work-items', values);
      toast.success(`${values.title} added to the calendar`);
    }
    setModal(null);
    reload();
  }

  async function remove() {
    await api.del(`/work-items/${confirmDelete.id}`);
    setConfirmDelete(null);
    setModal(null);
    toast.success('Work item deleted');
    reload();
  }

  const openItem = (occ) => setModal({ mode: 'edit', occ });
  const addOn = (date) => setModal({ mode: 'create', date });
  const editing = modal?.mode === 'edit' ? modal.occ : null;
  const editingLive = editing && (occurrences.find((o) => occurrenceKey(o) === occurrenceKey(editing)) ?? editing);

  return (
    <>
      <PageHeader
        eyebrow="Garden calendar"
        eyebrowIcon={CalendarDays}
        title={<>What’s <em>coming up</em></>}
        subtitle="Shared garden work — pruning, feeding, sowing — with a nudge for everyone the day before and on the morning."
        actions={<button className="btn btn-primary" onClick={() => addOn(view === 'month' ? selected : today)}><Plus /> Add work item</button>}
      />

      <div className="toolbar">
        <div className="segmented" role="group" aria-label="Calendar view">
          {[
            ['month', 'Month', CalendarDays],
            ['agenda', 'Agenda', List],
          ].map(([value, label, Icon]) => (
            <button key={value} aria-pressed={view === value} onClick={() => setView(value)}>
              {view === value && <motion.span layoutId="cal-view-seg" className="seg-pill" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
              <span className="seg-label cal-seg-label"><Icon size={15} /> {label}</span>
            </button>
          ))}
        </div>
        {view === 'agenda' && data && (
          <span className="greeting-date">
            {occurrences.filter((o) => !o.completed && localDateOf(o.occurs_at) >= today).length} to do · next {agendaWeeks} weeks
          </span>
        )}
      </div>

      {error && !data ? (
        <ErrorBanner error={error} onRetry={reload} />
      ) : view === 'month' ? (
        <div className="cal-layout">
          <div className={`card cal-card ${loading ? 'is-loading' : ''}`}>
            <header className="cal-head">
              <h2 className="cal-title">
                {monthNameFmt.format(parseISODate(month))} <em>{month.slice(0, 4)}</em>
              </h2>
              <div className="cal-nav">
                <button type="button" className="icon-btn" onClick={() => goMonth(-1)} aria-label="Previous month"><ChevronLeft /></button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={goToday} disabled={month === monthStart(today) && selected === today}>Today</button>
                <button type="button" className="icon-btn" onClick={() => goMonth(1)} aria-label="Next month"><ChevronRight /></button>
              </div>
            </header>
            <MonthGrid
              month={month}
              direction={direction}
              today={today}
              selected={selected}
              byDate={byDate}
              now={now}
              onSelect={select}
              onOpen={openItem}
            />
          </div>
          <DayPanel
            day={selected}
            today={today}
            items={byDate.get(selected) ?? []}
            now={now}
            onOpen={openItem}
            onToggle={toggle}
            onAdd={addOn}
          />
        </div>
      ) : !data ? (
        <div className="card card-pad"><SkeletonRows /></div>
      ) : (
        <Agenda
          occurrences={occurrences}
          today={today}
          now={now}
          weeks={agendaWeeks}
          onMore={() => setAgendaWeeks((w) => Math.min(w + AGENDA_WEEKS_STEP, AGENDA_MAX_WEEKS))}
          loadingMore={loading}
          onOpen={openItem}
          onToggle={toggle}
          onAdd={addOn}
        />
      )}

      <Modal
        open={!!modal}
        onClose={() => setModal(null)}
        title={editing ? 'Work item' : 'Add work item'}
        description={editing ? undefined : 'Shared with everyone, with a reminder the day before and on the morning.'}
      >
        {editingLive && (
          <div className={`work-occurrence ${editingLive.completed ? 'is-done' : ''}`}>
            <div>
              <p className="work-occurrence-when">
                {longDayFmt.format(new Date(editingLive.occurs_at))} · {timeFmt.format(new Date(editingLive.occurs_at))}
              </p>
              <p className="work-occurrence-sub">
                {editingLive.recurrence === 'none'
                  ? editingLive.created_by_name ? `Added by ${editingLive.created_by_name}` : 'One-off task'
                  : `Repeats ${editingLive.recurrence} · edits below apply to every occurrence`}
              </p>
            </div>
            <button
              type="button"
              className={`btn btn-sm ${editingLive.completed ? 'btn-secondary' : 'btn-primary'}`}
              onClick={() => toggle(editingLive)}
            >
              <Check /> {editingLive.completed ? 'Done' : 'Mark done'}
            </button>
          </div>
        )}
        {modal && (
          <WorkItemForm
            key={editing ? occurrenceKey(editing) : `new-${modal.date}`}
            initial={editing ? itemToForm(editing) : blankItem(modal.date)}
            beds={beds ?? []}
            plants={plants ?? []}
            submitLabel={editing ? 'Save changes' : 'Add to calendar'}
            onSubmit={save}
            onCancel={() => setModal(null)}
            onDelete={editing ? () => setConfirmDelete(editing) : undefined}
          />
        )}
      </Modal>

      <ConfirmDialog
        open={!!confirmDelete}
        title={`Delete “${confirmDelete?.title}”?`}
        message={
          confirmDelete?.recurrence !== 'none'
            ? 'This removes every occurrence of this repeating task, for everyone.'
            : 'This removes the task from the calendar for everyone.'
        }
        onConfirm={remove}
        onCancel={() => setConfirmDelete(null)}
      />
    </>
  );
}
