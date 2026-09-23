import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CalendarClock, Fence, MapPin, Pencil, Plus, Ruler, Sprout, Trash2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { useCollection } from '../lib/useCollection.js';
import { useHighlight } from '../lib/useHighlight.js';
import { clean, useForm } from '../lib/useForm.js';
import { useToast } from '../lib/toast.jsx';
import { PLANT_STATUSES, isActiveStatus } from '../lib/constants.js';
import { daysUntil, formatDate, formatDateShort, formatKg, relativeDays, todayISO } from '../lib/format.js';
import { fadeUp, listItem, stagger } from '../lib/motion.js';
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

/* ---------- Forms ---------- */

function BedForm({ initial, onSubmit, onCancel, submitLabel }) {
  const form = useForm(initial);
  return (
    <form onSubmit={form.submit(async (v) => onSubmit(clean(v, ['size_sqm'])))} noValidate>
      <div className="form-grid">
        <Field label="Name" className="span-2">
          {(id) => <input id={id} className="input" maxLength={120} placeholder="e.g. Sunny Raised Bed" {...form.bind('name')} />}
        </Field>
        <Field label="Location" optional>
          {(id) => <input id={id} className="input" maxLength={200} placeholder="e.g. South fence" {...form.bind('location')} />}
        </Field>
        <Field label="Size (m²)" optional>
          {(id) => <input id={id} className="input tabular" type="number" inputMode="decimal" min="0" step="0.1" placeholder="0.0" {...form.bind('size_sqm')} />}
        </Field>
        <Field label="Notes" optional className="span-2">
          {(id) => <textarea id={id} className="textarea" maxLength={2000} placeholder="Soil, light, what grew well…" {...form.bind('notes')} />}
        </Field>
      </div>
      <div className="mt-4"><FormError error={form.error} /></div>
      <div className="form-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={form.busy || !form.values.name.trim()}>
          {form.busy ? <span className="spinner" /> : submitLabel}
        </button>
      </div>
    </form>
  );
}

function PlantForm({ initial, beds, onSubmit, onCancel, submitLabel }) {
  const form = useForm(initial);
  return (
    <form onSubmit={form.submit(async (v) => onSubmit(clean(v, ['bed_id'])))} noValidate>
      <div className="form-grid">
        <Field label="Plant">
          {(id) => <input id={id} className="input" maxLength={120} placeholder="e.g. Tomato" {...form.bind('name')} />}
        </Field>
        <Field label="Variety" optional>
          {(id) => <input id={id} className="input" maxLength={120} placeholder="e.g. San Marzano" {...form.bind('variety')} />}
        </Field>
        <Field label="Bed" optional>
          {(id) => (
            <select id={id} className="select" {...form.bind('bed_id')}>
              <option value="">No bed yet</option>
              {beds.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          )}
        </Field>
        <Field label="Status">
          {(id) => (
            <select id={id} className="select" {...form.bind('status')}>
              {PLANT_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          )}
        </Field>
        <Field label="Planted on" optional>
          {(id) => <input id={id} className="input" type="date" {...form.bind('planted_date')} />}
        </Field>
        <Field label="Expected harvest" optional>
          {(id) => <input id={id} className="input" type="date" min={form.values.planted_date || undefined} {...form.bind('expected_harvest_date')} />}
        </Field>
        <Field label="Notes" optional className="span-2">
          {(id) => <textarea id={id} className="textarea" maxLength={2000} placeholder="Spacing, feeding, anything to remember…" {...form.bind('notes')} />}
        </Field>
      </div>
      <div className="mt-4"><FormError error={form.error} /></div>
      <div className="form-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={form.busy || !form.values.name.trim()}>
          {form.busy ? <span className="spinner" /> : submitLabel}
        </button>
      </div>
    </form>
  );
}

/* ---------- Pieces ---------- */

function HarvestWhen({ date, status }) {
  if (!date) return null;
  if (!isActiveStatus(status)) return <span className="when">{formatDate(date)}</span>;
  const n = daysUntil(date);
  return (
    <span className={`when ${n < 0 ? 'overdue' : n <= 14 ? 'soon' : ''}`} title={`Expected harvest ${formatDate(date)}`}>
      <CalendarClock size={12} className="when-icon" />
      {n < 0 ? `due ${relativeDays(date)}` : relativeDays(date)}
    </span>
  );
}

function PlantRow({ plant, onStatus, onEdit, onDelete }) {
  return (
    <motion.li layout className={`list-row plant-row ${isActiveStatus(plant.status) ? '' : 'dim'}`} data-entry-id={plant.id} {...listItem}>
      <div className="plant-line">
        <div className="list-title">
          {plant.name}
          {plant.variety && <span className="variety"> · {plant.variety}</span>}
        </div>
        <div className="list-actions">
          <button className="icon-btn" onClick={() => onEdit(plant)} aria-label={`Edit ${plant.name}`}><Pencil /></button>
          <button className="icon-btn danger" onClick={() => onDelete(plant)} aria-label={`Delete ${plant.name}`}><Trash2 /></button>
        </div>
      </div>
      <div className="plant-line">
        <div className="list-meta">
          {plant.planted_date && <span>Planted {formatDateShort(plant.planted_date)}</span>}
          {plant.planted_date && plant.expected_harvest_date && <span className="sep" />}
          <HarvestWhen date={plant.expected_harvest_date} status={plant.status} />
        </div>
        <select
          className={`select status-select badge-${plant.status}`}
          value={plant.status}
          onChange={(e) => onStatus(plant, e.target.value)}
          aria-label={`Status of ${plant.name}`}
        >
          {PLANT_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </div>
    </motion.li>
  );
}

function BedCard({ bed, plants, onEditBed, onDeleteBed, onAddPlant, plantHandlers }) {
  const unassigned = !bed.id;
  return (
    <motion.article className="card bed-card" variants={fadeUp} layout>
      <div className={`bed-card-head ${unassigned ? 'unassigned' : ''}`}>
        <div className="bed-card-title">
          <h3>{bed.name}</h3>
          {!unassigned && (
            <div className="bed-card-actions">
              <button className="icon-btn" onClick={() => onEditBed(bed)} aria-label={`Edit ${bed.name}`}><Pencil /></button>
              <button className="icon-btn danger" onClick={() => onDeleteBed(bed)} aria-label={`Delete ${bed.name}`}><Trash2 /></button>
            </div>
          )}
        </div>
        {unassigned ? (
          <p className="bed-card-meta">Plants that aren’t in a bed yet</p>
        ) : (
          <>
            {(bed.location || bed.size_sqm !== null) && (
              <div className="bed-card-meta">
                {bed.location && <span><MapPin /> {bed.location}</span>}
                {bed.size_sqm !== null && <span><Ruler /> {bed.size_sqm} m²</span>}
              </div>
            )}
            {bed.notes && <p className="bed-notes">{bed.notes}</p>}
            <div className="bed-stats">
              <div className="bed-stat"><strong>{bed.active_plants}</strong><span>Growing</span></div>
              <div className="bed-stat"><strong>{formatKg(bed.total_kg)}</strong><span>kg harvested</span></div>
            </div>
          </>
        )}
      </div>
      <div className="bed-card-body">
        {plants.length === 0 ? (
          <p className="bed-empty">Nothing planted here yet.</p>
        ) : (
          <ul className="list">
            <AnimatePresence initial={false}>
              {plants.map((p) => <PlantRow key={p.id} plant={p} {...plantHandlers} />)}
            </AnimatePresence>
          </ul>
        )}
        <button className="btn btn-secondary btn-sm add-plant-btn" onClick={() => onAddPlant(bed.id)}>
          <Plus /> Add plant{unassigned ? '' : ` to ${bed.name}`}
        </button>
      </div>
    </motion.article>
  );
}

/* ---------- Page ---------- */

const blankBed = { name: '', location: '', size_sqm: '', notes: '' };
const blankPlant = (bedId) => ({
  name: '',
  variety: '',
  bed_id: bedId ? String(bedId) : '',
  status: 'planted',
  planted_date: todayISO(),
  expected_harvest_date: '',
  notes: '',
});

export default function Garden() {
  const toast = useToast();
  const beds = useCollection('/beds');
  const plants = useCollection('/plants');
  const [view, setView] = useState('active');
  const [bedModal, setBedModal] = useState(null); // { bed? }
  const [plantModal, setPlantModal] = useState(null); // { plant? , bedId? }
  const [confirm, setConfirm] = useState(null); // { kind, item }

  const reloadAll = () => {
    beds.reload();
    plants.reload();
  };

  const byBed = useMemo(() => {
    const map = new Map();
    for (const p of plants.data ?? []) {
      if (view === 'active' && !isActiveStatus(p.status)) continue;
      const key = p.bed_id ?? 0;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(p);
    }
    return map;
  }, [plants.data, view]);

  async function saveBed(values) {
    if (bedModal.bed) {
      await api.put(`/beds/${bedModal.bed.id}`, values);
      toast.success('Bed updated');
    } else {
      await api.post('/beds', values);
      toast.success(`${values.name} added`);
    }
    setBedModal(null);
    beds.reload();
  }

  async function savePlant(values) {
    if (plantModal.plant) {
      await api.put(`/plants/${plantModal.plant.id}`, values);
      toast.success('Plant updated');
    } else {
      await api.post('/plants', values);
      toast.success(`${values.name} planted`);
    }
    setPlantModal(null);
    reloadAll();
  }

  async function changeStatus(plant, status) {
    try {
      await api.put(`/plants/${plant.id}`, { status });
      toast.success(`${plant.name} marked as ${status}`);
      reloadAll();
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function confirmDelete() {
    const { kind, item } = confirm;
    await api.del(`/${kind === 'bed' ? 'beds' : 'plants'}/${item.id}`);
    setConfirm(null);
    toast.success(`${item.name} deleted`);
    reloadAll();
  }

  const plantHandlers = {
    onStatus: changeStatus,
    onEdit: (plant) => setPlantModal({ plant }),
    onDelete: (plant) => setConfirm({ kind: 'plant', item: plant }),
  };

  const loading = !beds.data || !plants.data;
  const error = beds.error || plants.error;
  useHighlight(!loading, 'plant'); // ?plant=<id> from a harvest reminder
  const unassigned = byBed.get(0) ?? [];

  return (
    <>
      <PageHeader
        eyebrow="The garden"
        eyebrowIcon={Sprout}
        title="Beds & plants"
        subtitle="What’s growing where, and when it should be ready."
        actions={
          <>
            <button className="btn btn-secondary" onClick={() => setBedModal({})}><Fence /> New bed</button>
            <button className="btn btn-primary" onClick={() => setPlantModal({})}><Plus /> Add plant</button>
          </>
        }
      />

      <div className="toolbar">
        <div className="segmented" role="group" aria-label="Which plants to show">
          {[
            ['active', 'Growing now'],
            ['all', 'All plants'],
          ].map(([value, label]) => (
            <button key={value} aria-pressed={view === value} onClick={() => setView(value)}>
              {view === value && <motion.span layoutId="garden-seg" className="seg-pill" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
              <span className="seg-label">{label}</span>
            </button>
          ))}
        </div>
        {plants.data && (
          <span className="greeting-date">
            {plants.data.filter((p) => isActiveStatus(p.status)).length} growing · {beds.data?.length ?? 0} beds
          </span>
        )}
      </div>

      {error && loading ? (
        <ErrorBanner error={error} onRetry={reloadAll} />
      ) : loading ? (
        <div className="card card-pad"><SkeletonRows /></div>
      ) : beds.data.length === 0 && plants.data.length === 0 ? (
        <div className="card">
          <EmptyState
            title="Let’s map the garden"
            message="Add your first bed, then fill it with what you’ve planted."
            action={<button className="btn btn-primary" onClick={() => setBedModal({})}><Fence /> Add a bed</button>}
          />
        </div>
      ) : (
        <motion.div className="bed-grid" variants={stagger} initial="hidden" animate="show">
          {beds.data.map((bed) => (
            <BedCard
              key={bed.id}
              bed={bed}
              plants={byBed.get(bed.id) ?? []}
              onEditBed={(b) => setBedModal({ bed: b })}
              onDeleteBed={(b) => setConfirm({ kind: 'bed', item: b })}
              onAddPlant={(bedId) => setPlantModal({ bedId })}
              plantHandlers={plantHandlers}
            />
          ))}
          {unassigned.length > 0 && (
            <BedCard
              bed={{ id: null, name: 'Not in a bed' }}
              plants={unassigned}
              onAddPlant={() => setPlantModal({})}
              plantHandlers={plantHandlers}
            />
          )}
        </motion.div>
      )}

      <Modal open={!!bedModal} onClose={() => setBedModal(null)} title={bedModal?.bed ? 'Edit bed' : 'New bed'} description="A bed, pot, row or patch of ground.">
        {bedModal && (
          <BedForm
            initial={
              bedModal.bed
                ? {
                    name: bedModal.bed.name,
                    location: bedModal.bed.location ?? '',
                    size_sqm: bedModal.bed.size_sqm ?? '',
                    notes: bedModal.bed.notes ?? '',
                  }
                : blankBed
            }
            submitLabel={bedModal.bed ? 'Save changes' : 'Add bed'}
            onSubmit={saveBed}
            onCancel={() => setBedModal(null)}
          />
        )}
      </Modal>

      <Modal open={!!plantModal} onClose={() => setPlantModal(null)} title={plantModal?.plant ? 'Edit plant' : 'Add a plant'}>
        {plantModal && (
          <PlantForm
            beds={beds.data ?? []}
            initial={
              plantModal.plant
                ? {
                    name: plantModal.plant.name,
                    variety: plantModal.plant.variety ?? '',
                    bed_id: plantModal.plant.bed_id ? String(plantModal.plant.bed_id) : '',
                    status: plantModal.plant.status,
                    planted_date: plantModal.plant.planted_date ?? '',
                    expected_harvest_date: plantModal.plant.expected_harvest_date ?? '',
                    notes: plantModal.plant.notes ?? '',
                  }
                : blankPlant(plantModal.bedId)
            }
            submitLabel={plantModal.plant ? 'Save changes' : 'Add plant'}
            onSubmit={savePlant}
            onCancel={() => setPlantModal(null)}
          />
        )}
      </Modal>

      <ConfirmDialog
        open={!!confirm}
        title={`Delete ${confirm?.item.name}?`}
        message={
          confirm?.kind === 'bed'
            ? 'Its plants will be kept and moved to “Not in a bed”. Harvests stay in the log.'
            : 'The plant will be removed. Its harvests and expenses stay in the log. Tip: set status to “Removed” instead to keep its history.'
        }
        onConfirm={confirmDelete}
        onCancel={() => setConfirm(null)}
      />
    </>
  );
}
