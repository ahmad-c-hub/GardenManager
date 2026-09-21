import { useId, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Fence, Pencil, Plus, Sprout, Trash2, Wheat } from 'lucide-react';
import { api } from '../lib/api.js';
import { useCollection } from '../lib/useCollection.js';
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
  const handle = form.submit(async (values) => {
    await onSubmit(clean(values, ['quantity_kg', 'plant_id', 'bed_id']));
    if (!onCancel) form.reset(blank());
  });

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
        {onCancel && <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>}
        <button
          type="submit"
          className={`btn btn-primary ${onCancel ? '' : 'btn-block'}`}
          disabled={form.busy || !form.values.crop_name.trim() || !form.values.quantity_kg}
        >
          {form.busy ? <span className="spinner" /> : <>{!onCancel && <Wheat />} {submitLabel}</>}
        </button>
      </div>
    </form>
  );
}

export default function Harvests() {
  const toast = useToast();
  const { data: rows, loading, error, reload } = useCollection('/harvests');
  const { data: plants } = useCollection('/plants');
  const { data: beds } = useCollection('/beds');
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);

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

  async function create(values) {
    await api.post('/harvests', values);
    toast.success(`Logged ${formatKg(values.quantity_kg)} kg of ${values.crop_name}`);
    reload();
  }
  async function update(values) {
    await api.put(`/harvests/${editing.id}`, values);
    setEditing(null);
    toast.success('Harvest updated');
    reload();
  }
  async function remove() {
    await api.del(`/harvests/${deleting.id}`);
    setDeleting(null);
    toast.success('Harvest removed');
    reload();
  }

  return (
    <>
      <PageHeader
        eyebrow="What we grew"
        eyebrowIcon={Wheat}
        title="Harvests"
        subtitle="Every basket that came in from the garden, weighed in kilograms."
      />

      <div className="split split-form">
        <div className="card card-pad sticky-col">
          <div className="card-header">
            <div>
              <h2 className="card-title">Log a harvest</h2>
              <p className="card-subtitle">Weigh it, note it, enjoy it</p>
            </div>
            <span className="icon-tile tone-kg"><Wheat /></span>
          </div>
          <HarvestForm initial={blank()} plants={plants ?? []} beds={beds ?? []} submitLabel="Log harvest" onSubmit={create} />
        </div>

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
              <EmptyState title="The first harvest awaits" message="When something comes in from the garden, weigh it and log it here." />
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
                        <motion.li layout className="list-row" key={r.id} {...listItem}>
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
