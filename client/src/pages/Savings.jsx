import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Pencil, PiggyBank, Plus, Trash2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { useCollection } from '../lib/useCollection.js';
import { clean, useForm } from '../lib/useForm.js';
import { useToast } from '../lib/toast.jsx';
import {
  currencySymbol,
  formatDate,
  formatMoney,
  formatMonthYear,
  groupByMonth,
  todayISO,
} from '../lib/format.js';
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

const blank = () => ({ amount: '', saved_on: todayISO(), note: '' });

function DepositForm({ initial, submitLabel, onSubmit, onCancel }) {
  const form = useForm(initial);
  const handle = form.submit(async (values) => {
    await onSubmit(clean(values, ['amount']));
    if (!onCancel) form.reset(blank());
  });

  return (
    <form onSubmit={handle} noValidate>
      <div className="form-grid">
        <Field label="Amount">
          {(id) => (
            <div className="input-wrap">
              <span className="input-prefix">{currencySymbol}</span>
              <input id={id} className="input has-prefix tabular" type="number" inputMode="decimal" min="0.01" step="0.01" placeholder="0.00" required {...form.bind('amount')} />
            </div>
          )}
        </Field>
        <Field label="Date">
          {(id) => <input id={id} className="input" type="date" required {...form.bind('saved_on')} />}
        </Field>
        <Field label="Note" optional className="span-2">
          {(id) => <input id={id} className="input" type="text" maxLength={500} placeholder="e.g. Monthly deposit" {...form.bind('note')} />}
        </Field>
      </div>
      <div className="mt-4">
        <FormError error={form.error} />
      </div>
      <div className="form-actions">
        {onCancel && (
          <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>
        )}
        <button type="submit" className={`btn btn-primary ${onCancel ? '' : 'btn-block'}`} disabled={form.busy || !form.values.amount}>
          {form.busy ? <span className="spinner" /> : <>{!onCancel && <Plus />} {submitLabel}</>}
        </button>
      </div>
    </form>
  );
}

export default function Savings() {
  const toast = useToast();
  const { data: rows, loading, error, reload } = useCollection('/savings');
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);

  const stats = useMemo(() => {
    if (!rows) return null;
    const year = String(new Date().getFullYear());
    const month = todayISO().slice(0, 7);
    const total = rows.reduce((s, r) => s + r.amount, 0);
    const thisYear = rows.filter((r) => r.saved_on.startsWith(year)).reduce((s, r) => s + r.amount, 0);
    const thisMonth = rows.filter((r) => r.saved_on.startsWith(month)).reduce((s, r) => s + r.amount, 0);
    return { total, thisYear, thisMonth, count: rows.length };
  }, [rows]);

  const groups = useMemo(() => (rows ? groupByMonth(rows, 'saved_on') : []), [rows]);

  async function create(values) {
    await api.post('/savings', values);
    toast.success(`Deposited ${formatMoney(values.amount)} into the fund`);
    reload();
  }
  async function update(values) {
    await api.put(`/savings/${editing.id}`, values);
    setEditing(null);
    toast.success('Deposit updated');
    reload();
  }
  async function remove() {
    await api.del(`/savings/${deleting.id}`);
    setDeleting(null);
    toast.success('Deposit removed');
    reload();
  }

  return (
    <>
      <PageHeader
        eyebrow="Garden fund"
        eyebrowIcon={PiggyBank}
        title="Savings"
        subtitle="Every deposit we put aside for the garden. The fund balance is savings minus expenses."
      />

      <div className="split split-form">
        <div className="card card-pad sticky-col">
          <div className="card-header">
            <div>
              <h2 className="card-title">Add a deposit</h2>
              <p className="card-subtitle">Money going into the garden fund</p>
            </div>
            <span className="icon-tile tone-saved"><PiggyBank /></span>
          </div>
          <DepositForm initial={blank()} submitLabel="Add deposit" onSubmit={create} />
        </div>

        <div className="stack">
          {stats && (
            <div className="summary-strip">
              <div className="summary-item">
                <div className="label">Total saved</div>
                <div className="value">{formatMoney(stats.total)}</div>
                <div className="sub">{stats.count} deposits</div>
              </div>
              <div className="summary-item">
                <div className="label">This year</div>
                <div className="value">{formatMoney(stats.thisYear)}</div>
              </div>
              <div className="summary-item">
                <div className="label">This month</div>
                <div className="value">{formatMoney(stats.thisMonth)}</div>
              </div>
            </div>
          )}

          <div className="card card-pad">
            {error && !rows ? (
              <ErrorBanner error={error} onRetry={reload} />
            ) : loading && !rows ? (
              <SkeletonRows />
            ) : rows.length === 0 ? (
              <EmptyState title="No deposits yet" message="Add your first deposit to start growing the garden fund." />
            ) : (
              groups.map((g) => (
                <section key={g.month}>
                  <div className="group-heading">
                    <h3>{formatMonthYear(g.month)}</h3>
                    <span>{formatMoney(g.rows.reduce((s, r) => s + r.amount, 0))}</span>
                  </div>
                  <ul className="list">
                    <AnimatePresence initial={false}>
                      {g.rows.map((r) => (
                        <motion.li layout className="list-row" key={r.id} {...listItem}>
                          <span className="icon-tile sm tone-saved"><PiggyBank /></span>
                          <div className="list-main">
                            <div className="list-title">{r.note || 'Deposit'}</div>
                            <div className="list-meta">{formatDate(r.saved_on)}</div>
                          </div>
                          <span className="list-value value-pos">+{formatMoney(r.amount)}</span>
                          <div className="list-actions">
                            <button className="icon-btn" onClick={() => setEditing(r)} aria-label="Edit deposit"><Pencil /></button>
                            <button className="icon-btn danger" onClick={() => setDeleting(r)} aria-label="Delete deposit"><Trash2 /></button>
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

      <Modal open={!!editing} onClose={() => setEditing(null)} title="Edit deposit">
        {editing && (
          <DepositForm
            initial={{ amount: String(editing.amount), saved_on: editing.saved_on, note: editing.note ?? '' }}
            submitLabel="Save changes"
            onSubmit={update}
            onCancel={() => setEditing(null)}
          />
        )}
      </Modal>

      <ConfirmDialog
        open={!!deleting}
        title="Remove this deposit?"
        message={deleting && `${formatMoney(deleting.amount)} on ${formatDate(deleting.saved_on)} will be removed from the fund.`}
        onConfirm={remove}
        onCancel={() => setDeleting(null)}
      />
    </>
  );
}
