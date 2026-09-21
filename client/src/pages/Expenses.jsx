import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Layers, Pencil, Plus, Receipt, Sprout, Trash2, X } from 'lucide-react';
import { api } from '../lib/api.js';
import { useCollection } from '../lib/useCollection.js';
import { clean, useForm } from '../lib/useForm.js';
import { useToast } from '../lib/toast.jsx';
import { EXPENSE_CATEGORIES, categoryMeta } from '../lib/constants.js';
import { currencySymbol, formatDate, formatMoney, todayISO } from '../lib/format.js';
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

const blank = () => ({ category: 'seeds', amount: '', description: '', spent_on: todayISO(), plant_id: '' });

function ExpenseForm({ initial, plants, submitLabel, onSubmit, onCancel }) {
  const form = useForm(initial);
  const handle = form.submit(async (values) => onSubmit(clean(values, ['amount', 'plant_id'])));

  return (
    <form onSubmit={handle} noValidate>
      <Field label="Category">
        {() => (
          <div className="chip-row" role="group" aria-label="Category">
            {EXPENSE_CATEGORIES.map(({ value, label, icon: Icon }) => (
              <button
                type="button"
                key={value}
                className="chip"
                aria-pressed={form.values.category === value}
                onClick={() => form.set('category', value)}
              >
                <Icon /> {label}
              </button>
            ))}
          </div>
        )}
      </Field>
      <div className="form-grid mt-5">
        <Field label="Amount">
          {(id) => (
            <div className="input-wrap">
              <span className="input-prefix">{currencySymbol}</span>
              <input id={id} className="input has-prefix tabular" type="number" inputMode="decimal" min="0.01" step="0.01" placeholder="0.00" {...form.bind('amount')} />
            </div>
          )}
        </Field>
        <Field label="Date">
          {(id) => <input id={id} className="input" type="date" {...form.bind('spent_on')} />}
        </Field>
        <Field label="Description" optional className="span-2">
          {(id) => <input id={id} className="input" type="text" maxLength={500} placeholder="e.g. Compost delivery" {...form.bind('description')} />}
        </Field>
        <Field label="For a plant" optional className="span-2">
          {(id) => (
            <select id={id} className="select" {...form.bind('plant_id')}>
              <option value="">Not linked to a plant</option>
              {plants.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}{p.variety ? ` · ${p.variety}` : ''}{p.bed_name ? ` (${p.bed_name})` : ''}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>
      <div className="mt-4">
        <FormError error={form.error} />
      </div>
      <div className="form-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn-accent" disabled={form.busy || !form.values.amount}>
          {form.busy ? <span className="spinner" /> : submitLabel}
        </button>
      </div>
    </form>
  );
}

export default function Expenses() {
  const toast = useToast();
  const [filters, setFilters] = useState({ category: '', from: '', to: '' });
  const { data: rows, loading, error, reload } = useCollection('/expenses', filters);
  const { data: plants } = useCollection('/plants');
  const [modal, setModal] = useState(null); // null | { mode: 'create' } | { mode: 'edit', row }
  const [deleting, setDeleting] = useState(null);

  const filtered = filters.category || filters.from || filters.to;
  const total = useMemo(() => (rows ?? []).reduce((s, r) => s + r.amount, 0), [rows]);
  const topCategory = useMemo(() => {
    if (!rows?.length) return null;
    const sums = {};
    for (const r of rows) sums[r.category] = (sums[r.category] ?? 0) + r.amount;
    return Object.entries(sums).sort((a, b) => b[1] - a[1])[0];
  }, [rows]);

  const setFilter = (key, value) => setFilters((f) => ({ ...f, [key]: value }));

  async function save(values) {
    if (modal.mode === 'edit') {
      await api.put(`/expenses/${modal.row.id}`, values);
      toast.success('Expense updated');
    } else {
      await api.post('/expenses', values);
      toast.success(`Logged ${formatMoney(values.amount)} for ${categoryMeta(values.category).label.toLowerCase()}`);
    }
    setModal(null);
    reload();
  }
  async function remove() {
    await api.del(`/expenses/${deleting.id}`);
    setDeleting(null);
    toast.success('Expense deleted');
    reload();
  }

  return (
    <>
      <PageHeader
        eyebrow="Garden fund"
        eyebrowIcon={Receipt}
        title="Expenses"
        subtitle="What we’ve spent from the fund on seeds, soil, tools and everything else."
        actions={
          <button className="btn btn-primary" onClick={() => setModal({ mode: 'create' })}>
            <Plus /> Add expense
          </button>
        }
      />

      <div className="stack">
        <div className="card card-pad">
          <div className="filter-bar">
            <div className="chip-row" role="group" aria-label="Filter by category">
              <button className="chip" aria-pressed={!filters.category} onClick={() => setFilter('category', '')}>
                <Layers /> All
              </button>
              {EXPENSE_CATEGORIES.map(({ value, label, icon: Icon }) => (
                <button key={value} className="chip" aria-pressed={filters.category === value} onClick={() => setFilter('category', filters.category === value ? '' : value)}>
                  <Icon /> {label}
                </button>
              ))}
            </div>
            <div className="filter-dates">
              <Field label="From">
                {(id) => <input id={id} className="input" type="date" value={filters.from} max={filters.to || undefined} onChange={(e) => setFilter('from', e.target.value)} />}
              </Field>
              <Field label="To">
                {(id) => <input id={id} className="input" type="date" value={filters.to} min={filters.from || undefined} onChange={(e) => setFilter('to', e.target.value)} />}
              </Field>
              {filtered && (
                <button className="btn btn-ghost" onClick={() => setFilters({ category: '', from: '', to: '' })}>
                  <X /> Clear
                </button>
              )}
            </div>
          </div>
        </div>

        {rows && (
          <div className="summary-strip">
            <div className="summary-item">
              <div className="label">{filtered ? 'Filtered total' : 'Total spent'}</div>
              <div className="value">{formatMoney(total)}</div>
            </div>
            <div className="summary-item">
              <div className="label">Expenses</div>
              <div className="value">{rows.length}</div>
            </div>
            <div className="summary-item">
              <div className="label">Biggest category</div>
              <div className="value">{topCategory ? categoryMeta(topCategory[0]).label : '—'}</div>
              {topCategory && <div className="sub">{formatMoney(topCategory[1])}</div>}
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
              title={filtered ? 'Nothing matches' : 'No expenses yet'}
              message={filtered ? 'Try a different category or date range.' : 'When you buy seeds, soil or tools, log them here.'}
              action={!filtered && <button className="btn btn-primary" onClick={() => setModal({ mode: 'create' })}><Plus /> Add expense</button>}
            />
          ) : (
            <ul className="list">
              <AnimatePresence initial={false}>
                {rows.map((r) => {
                  const meta = categoryMeta(r.category);
                  const Icon = meta.icon;
                  return (
                    <motion.li layout className="list-row" key={r.id} {...listItem}>
                      <span className="icon-tile tone-spent"><Icon /></span>
                      <div className="list-main">
                        <div className="list-title">{r.description || meta.label}</div>
                        <div className="list-meta">
                          <span>{meta.label}</span>
                          <span className="sep" />
                          <span>{formatDate(r.spent_on)}</span>
                          {r.plant_name && (
                            <>
                              <span className="sep" />
                              <span className="meta-icon">
                                <Sprout size={13} /> {r.plant_name}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                      <span className="list-value">−{formatMoney(r.amount)}</span>
                      <div className="list-actions">
                        <button className="icon-btn" onClick={() => setModal({ mode: 'edit', row: r })} aria-label="Edit expense"><Pencil /></button>
                        <button className="icon-btn danger" onClick={() => setDeleting(r)} aria-label="Delete expense"><Trash2 /></button>
                      </div>
                    </motion.li>
                  );
                })}
              </AnimatePresence>
            </ul>
          )}
        </div>
      </div>

      <Modal
        open={!!modal}
        onClose={() => setModal(null)}
        title={modal?.mode === 'edit' ? 'Edit expense' : 'New expense'}
        description="Money spent from the garden fund."
      >
        {modal && (
          <ExpenseForm
            key={modal.row?.id ?? 'new'}
            plants={plants ?? []}
            initial={
              modal.mode === 'edit'
                ? {
                    category: modal.row.category,
                    amount: String(modal.row.amount),
                    description: modal.row.description ?? '',
                    spent_on: modal.row.spent_on,
                    plant_id: modal.row.plant_id ? String(modal.row.plant_id) : '',
                  }
                : blank()
            }
            submitLabel={modal.mode === 'edit' ? 'Save changes' : 'Add expense'}
            onSubmit={save}
            onCancel={() => setModal(null)}
          />
        )}
      </Modal>

      <ConfirmDialog
        open={!!deleting}
        title="Delete this expense?"
        message={deleting && `${formatMoney(deleting.amount)} on ${formatDate(deleting.spent_on)} will be deleted and returned to the fund balance.`}
        onConfirm={remove}
        onCancel={() => setDeleting(null)}
      />
    </>
  );
}
