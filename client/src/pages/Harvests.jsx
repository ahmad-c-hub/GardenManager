import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Fence, Pencil, Plus, Scale, Sprout, Trash2, Wheat } from 'lucide-react';
import { api } from '../lib/api.js';
import { useCollection } from '../lib/useCollection.js';
import { useHighlight } from '../lib/useHighlight.js';
import { clean, useForm } from '../lib/useForm.js';
import { useToast } from '../lib/toast.jsx';
import { formatDate, formatKg, formatMonthYear, groupByMonth, todayISO } from '../lib/format.js';
import { listItem } from '../lib/motion.js';
import {
  ConfirmDialog,
  EmptyState,
  ErrorBanner,
  Field,
  FormError,
  Modal,
  PageHeader,
  SkeletonRows,
} from '../components/ui.jsx';

const blank = () => ({ crop_name: '', quantity_kg: '', harvested_on: todayISO(), plant_id: '', bed_id: '', notes: '' });

function HarvestForm({ initial, plants, beds, submitLabel, onSubmit, onCancel }) {
  const form = useForm(initial);
  const handle = form.submit(async (values) => onSubmit(clean(values, ['quantity_kg', 'plant_id', 'bed_id'])));

  // Picking a plant fills in the crop name and its bed, which can still be changed.
  function choosePlant(e) {
    const id = e.target.value;
    const plant = plants.find((p) => String(p.id) === id);
    form.setValues((v) => ({
      ...v,
      plant_id: id,
      crop_name: plant && !v.crop_name ? plant.name : v.crop_name,
      bed_id: plant?.bed_id ? String(plant.bed_id) : v.bed_id,
    }));
  }

  const cropNames = [...new Set(plants.map((p) => p.name))];
  const listId = useId();

  return (
    <form onSubmit={handle} noValidate>
      <div className="form-grid">
        <Field label="Crop" className="span-2">
          {(id) => (
            <>
              <input id={id} className="input" maxLength={120} list={listId} placeholder="e.g. Tomatoes" {...form.bind('crop_name')} />
              <datalist id={listId}>
                {cropNames.map((n) => <option key={n} value={n} />)}
              </datalist>
            </>
          )}
        </Field>
        <Field label="Weight">
          {(id) => (
            <div className="input-wrap">
              <input id={id} className="input has-suffix tabular" type="number" inputMode="decimal" min="0.01" step="0.01" placeholder="0.00" {...form.bind('quantity_kg')} />
              <span className="input-unit">kg</span>
            </div>
          )}
        </Field>
        <Field label="Date">
          {(id) => <input id={id} className="input" type="date" max={todayISO()} {...form.bind('harvested_on')} />}
        </Field>
        <Field label="From plant" optional>
          {(id) => (
            <select id={id} className="select" value={form.values.plant_id} onChange={choosePlant}>
              <option value="">—</option>
              {plants.map((p) => (
                <option key={p.id} value={p.id}>{p.name}{p.variety ? ` · ${p.variety}` : ''}</option>
              ))}
            </select>
          )}
        </Field>
        <Field label="From bed" optional>
          {(id) => (
            <select id={id} className="select" {...form.bind('bed_id')}>
              <option value="">—</option>
              {beds.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          )}
        </Field>
        <Field label="Notes" optional className="span-2">
          {(id) => <input id={id} className="input" maxLength={2000} placeholder="Taste, size, anything notable" {...form.bind('notes')} />}
        </Field>
      </div>
      <div className="mt-4"><FormError error={form.error} /></div>
      <div className="form-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>
        <button
          type="submit"
          className="btn btn-primary"
          disabled={form.busy || !form.values.crop_name.trim() || !form.values.quantity_kg}
        >
          {form.busy ? <span className="spinner" /> : submitLabel}
        </button>
      </div>
    </form>
  );
}

/* ---------- Totals by crop ---------- */

const BREAKDOWN_PREVIEW = 6;

function rangeLabel(from, to) {
  if (from && to) return `${formatDate(from)} – ${formatDate(to)}`;
  if (from) return `since ${formatDate(from)}`;
  if (to) return `up to ${formatDate(to)}`;
  return 'all time';
}

/** Total and per-entry breakdown for one crop. Remounts per crop; `version` bumps refetch. */
function CropSummary({ crop, from, to, version }) {
  const { data, loading, error, reload } = useCollection('/harvests/summary', { crop, from, to });
  const [showAll, setShowAll] = useState(false);

  // Re-fetch after a harvest is logged, edited or removed (skipping the initial mount).
  const seenVersion = useRef(version);
  useEffect(() => {
    if (seenVersion.current === version) return;
    seenVersion.current = version;
    reload();
  }, [version, reload]);

  if (error && !data) return <ErrorBanner error={error} onRetry={reload} />;
  if (!data) return <SkeletonRows rows={2} />;

  const entries = showAll ? data.entries : data.entries.slice(0, BREAKDOWN_PREVIEW);

  return (
    <div className={`crop-summary ${loading ? 'is-refreshing' : ''}`} aria-live="polite">
      <div className="crop-total">
        <div className="crop-total-label">{data.crop}</div>
        <div className="crop-total-value">
          {formatKg(data.total_kg)} <small>kg</small>
        </div>
        <div className="crop-total-sub">
          harvested {rangeLabel(data.from, data.to)} · {data.count} {data.count === 1 ? 'entry' : 'entries'}
        </div>
      </div>

      {data.entries.length === 0 ? (
        <p className="crop-empty">No {data.crop} harvests in this range.</p>
      ) : (
        <>
          <h3 className="crop-breakdown-title">Breakdown</h3>
          <ul className="crop-entries">
            {entries.map((e) => (
              <li key={e.id} className="crop-entry">
                <div className="crop-entry-main">
                  <span className="crop-entry-date">{formatDate(e.harvested_on)}</span>
                  {e.notes && <p className="crop-entry-note">{e.notes}</p>}
                </div>
                <span className="kg-value tabular">{formatKg(e.quantity_kg)}<small>kg</small></span>
              </li>
            ))}
          </ul>
          {data.entries.length > BREAKDOWN_PREVIEW && (
            <button type="button" className="btn btn-ghost btn-sm btn-block mt-4" onClick={() => setShowAll((v) => !v)}>
              {showAll ? 'Show fewer' : `Show all ${data.entries.length} entries`}
            </button>
          )}
        </>
      )}
    </div>
  );
}

function CropTotals({ crops, defaultCrop, version }) {
  const [picked, setPicked] = useState('');
  const [range, setRange] = useState('all'); // 'all' | 'custom'
  const [dates, setDates] = useState({ from: '', to: '' });

  // Fall back to the default when nothing is picked or the picked crop no longer exists.
  const crop = crops?.includes(picked) ? picked : (defaultCrop ?? crops?.[0] ?? '');
  // Pin the fallback so the view doesn't jump when the top crop changes later.
  useEffect(() => {
    if (crop && crop !== picked) setPicked(crop);
  }, [crop, picked]);
  const from = range === 'custom' ? dates.from : '';
  const to = range === 'custom' ? dates.to : '';

  return (
    <div className="card card-pad sticky-col">
      <div className="card-header">
        <div>
          <h2 className="card-title">Totals by crop</h2>
          <p className="card-subtitle">How much each crop has given us</p>
        </div>
        <span className="icon-tile tone-kg"><Scale /></span>
      </div>

      {!crops ? (
        <SkeletonRows rows={2} />
      ) : crops.length === 0 ? (
        <p className="crop-empty">Log a harvest to see totals by crop.</p>
      ) : (
        <>
          <div className="crop-filters">
            <Field label="Crop">
              {(id) => (
                <select id={id} className="select" value={crop} onChange={(e) => setPicked(e.target.value)}>
                  {crops.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              )}
            </Field>
            <div className="segmented crop-range" role="group" aria-label="Date range">
              {[
                ['all', 'All time'],
                ['custom', 'Date range'],
              ].map(([value, label]) => (
                <button key={value} type="button" aria-pressed={range === value} onClick={() => setRange(value)}>
                  {range === value && <motion.span layoutId="crop-range-seg" className="seg-pill" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
                  <span className="seg-label">{label}</span>
                </button>
              ))}
            </div>
            {range === 'custom' && (
              <div className="crop-dates">
                <Field label="From">
                  {(id) => <input id={id} className="input" type="date" value={dates.from} max={dates.to || undefined} onChange={(e) => setDates((d) => ({ ...d, from: e.target.value }))} />}
                </Field>
                <Field label="To">
                  {(id) => <input id={id} className="input" type="date" value={dates.to} min={dates.from || undefined} onChange={(e) => setDates((d) => ({ ...d, to: e.target.value }))} />}
                </Field>
              </div>
            )}
          </div>
          {crop && <CropSummary key={crop} crop={crop} from={from} to={to} version={version} />}
        </>
      )}
    </div>
  );
}

export default function Harvests() {
  const toast = useToast();
  const { data: rows, loading, error, reload } = useCollection('/harvests');
  const { data: plants } = useCollection('/plants');
  const { data: beds } = useCollection('/beds');
  const crops = useCollection('/harvests/crops');
  const [logging, setLogging] = useState(false);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [version, setVersion] = useState(0); // bumps so the crop summary refetches

  const reloadAll = () => {
    reload();
    crops.reload();
    setVersion((v) => v + 1);
  };

  const stats = useMemo(() => {
    if (!rows) return null;
    const year = String(new Date().getFullYear());
    const total = rows.reduce((s, r) => s + r.quantity_kg, 0);
    const thisYear = rows.filter((r) => r.harvested_on.startsWith(year)).reduce((s, r) => s + r.quantity_kg, 0);
    const byCrop = {};
    for (const r of rows) byCrop[r.crop_name] = (byCrop[r.crop_name] ?? 0) + r.quantity_kg;
    const top = Object.entries(byCrop).sort((a, b) => b[1] - a[1]);
    return { total, thisYear, top };
  }, [rows]);

  const groups = useMemo(() => (rows ? groupByMonth(rows, 'harvested_on') : []), [rows]);
  useHighlight(Boolean(rows)); // ?highlight=<id> from a "new harvest" notification

  async function create(values) {
    await api.post('/harvests', values);
    setLogging(false);
    toast.success(`Logged ${formatKg(values.quantity_kg)} kg of ${values.crop_name}`);
    reloadAll();
  }
  async function update(values) {
    await api.put(`/harvests/${editing.id}`, values);
    setEditing(null);
    toast.success('Harvest updated');
    reloadAll();
  }
  async function remove() {
    await api.del(`/harvests/${deleting.id}`);
    setDeleting(null);
    toast.success('Harvest removed');
    reloadAll();
  }

  return (
    <>
      <PageHeader
        eyebrow="What we grew"
        eyebrowIcon={Wheat}
        title="Harvests"
        subtitle="Every basket that came in from the garden, weighed in kilograms."
        actions={<button className="btn btn-primary" onClick={() => setLogging(true)}><Plus /> Log a harvest</button>}
      />

      <div className="split split-form">
        <CropTotals crops={crops.data} defaultCrop={stats?.top[0]?.[0]} version={version} />

        <div className="stack">
          {stats && (
            <div className="summary-strip">
              <div className="summary-item">
                <div className="label">All time</div>
                <div className="value">{formatKg(stats.total)} <small className="unit-small">kg</small></div>
                <div className="sub">{rows.length} harvests</div>
              </div>
              <div className="summary-item">
                <div className="label">This year</div>
                <div className="value">{formatKg(stats.thisYear)} <small className="unit-small">kg</small></div>
              </div>
              <div className="summary-item">
                <div className="label">Top crop</div>
                <div className="value">{stats.top[0]?.[0] ?? '—'}</div>
                {stats.top[0] && <div className="sub">{formatKg(stats.top[0][1])} kg</div>}
              </div>
            </div>
          )}

          <div className="card card-pad">
            {error && !rows ? (
              <ErrorBanner error={error} onRetry={reload} />
            ) : loading && !rows ? (
              <SkeletonRows />
            ) : rows.length === 0 ? (
              <EmptyState
                title="The first harvest awaits"
                message="When something comes in from the garden, weigh it and log it here."
                action={<button className="btn btn-primary" onClick={() => setLogging(true)}><Plus /> Log a harvest</button>}
              />
            ) : (
              groups.map((g) => (
                <section key={g.month}>
                  <div className="group-heading">
                    <h3>{formatMonthYear(g.month)}</h3>
                    <span>{formatKg(g.rows.reduce((s, r) => s + r.quantity_kg, 0))} kg</span>
                  </div>
                  <ul className="list">
                    <AnimatePresence initial={false}>
                      {g.rows.map((r) => (
                        <motion.li layout className="list-row" key={r.id} data-entry-id={r.id} {...listItem}>
                          <span className="icon-tile sm tone-kg"><Wheat /></span>
                          <div className="list-main">
                            <div className="list-title">{r.crop_name}</div>
                            <div className="list-meta">
                              <span>{formatDate(r.harvested_on)}</span>
                              {r.bed_name && (
                                <>
                                  <span className="sep" />
                                  <span className="meta-icon"><Fence size={13} /> {r.bed_name}</span>
                                </>
                              )}
                              {r.plant_name && r.plant_name !== r.crop_name && (
                                <>
                                  <span className="sep" />
                                  <span className="meta-icon"><Sprout size={13} /> {r.plant_name}</span>
                                </>
                              )}
                            </div>
                          </div>
                          <span className="kg-value tabular">{formatKg(r.quantity_kg)}<small>kg</small></span>
                          <div className="list-actions">
                            <button className="icon-btn" onClick={() => setEditing(r)} aria-label="Edit harvest"><Pencil /></button>
                            <button className="icon-btn danger" onClick={() => setDeleting(r)} aria-label="Delete harvest"><Trash2 /></button>
                          </div>
                        </motion.li>
                      ))}
                    </AnimatePresence>
                  </ul>
                </section>
              ))
            )}
          </div>
        </div>
      </div>

      <Modal open={logging} onClose={() => setLogging(false)} title="Log a harvest" description="Weigh it, note it, enjoy it.">
        {logging && (
          <HarvestForm
            plants={plants ?? []}
            beds={beds ?? []}
            initial={blank()}
            submitLabel="Log harvest"
            onSubmit={create}
            onCancel={() => setLogging(false)}
          />
        )}
      </Modal>

      <Modal open={!!editing} onClose={() => setEditing(null)} title="Edit harvest">
        {editing && (
          <HarvestForm
            plants={plants ?? []}
            beds={beds ?? []}
            initial={{
              crop_name: editing.crop_name,
              quantity_kg: String(editing.quantity_kg),
              harvested_on: editing.harvested_on,
              plant_id: editing.plant_id ? String(editing.plant_id) : '',
              bed_id: editing.bed_id ? String(editing.bed_id) : '',
              notes: editing.notes ?? '',
            }}
            submitLabel="Save changes"
            onSubmit={update}
            onCancel={() => setEditing(null)}
          />
        )}
      </Modal>

      <ConfirmDialog
        open={!!deleting}
        title="Remove this harvest?"
        message={deleting && `${formatKg(deleting.quantity_kg)} kg of ${deleting.crop_name} from ${formatDate(deleting.harvested_on)} will be removed from the log.`}
        onConfirm={remove}
        onCancel={() => setDeleting(null)}
      />
    </>
  );
}
