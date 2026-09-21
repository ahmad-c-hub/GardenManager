import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ArrowDownRight,
  ArrowUpRight,
  CalendarDays,
  Leaf,
  PiggyBank,
  Plus,
  Receipt,
  Scale,
  Sprout,
  Wallet,
  Wheat,
} from 'lucide-react';
import { useAuth } from '../lib/auth.jsx';
import { useCollection } from '../lib/useCollection.js';
import { categoryMeta } from '../lib/constants.js';
import {
  daysUntil,
  formatDateShort,
  formatKg,
  formatLongToday,
  formatMoney,
  formatMoneyRound,
  greeting,
  parseISODate,
  relativeDays,
} from '../lib/format.js';
import { fadeUp, stagger } from '../lib/motion.js';
import { CornerFrond } from '../components/Botanical.jsx';
import { CategoryBars, HarvestChart, MonthlyFlowChart } from '../components/Charts.jsx';
import { CountUp, EmptyState, ErrorBanner, PageHeader } from '../components/ui.jsx';

function StatCard({ label, icon: Icon, tone, value, format, unit, foot, feature, negative }) {
  return (
    <motion.div variants={fadeUp} whileHover={{ y: -3 }} className={`stat-card ${feature ? 'feature' : ''}`}>
      {feature && <CornerFrond className="stat-art" />}
      <div className="stat-top">
        <span className="stat-label">{label}</span>
        <span className={`icon-tile sm tone-${tone}`}><Icon /></span>
      </div>
      <div className={`stat-value ${negative ? 'negative' : ''}`}>
        <CountUp value={value} format={format} />
        {unit && <span className="unit">{unit}</span>}
      </div>
      <div className="stat-foot">{foot}</div>
    </motion.div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="stack" aria-busy="true" aria-label="Loading dashboard">
      <div className="stat-grid">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="skeleton" style={{ height: 176, borderRadius: 20 }} />
        ))}
      </div>
      <div className="split">
        <div className="skeleton" style={{ height: 400, borderRadius: 20 }} />
        <div className="skeleton" style={{ height: 400, borderRadius: 20 }} />
      </div>
    </div>
  );
}

const ACTIVITY = {
  saving: { icon: PiggyBank, tone: 'saved', verb: 'Deposit' },
  expense: { icon: Receipt, tone: 'spent', verb: 'Spent' },
  harvest: { icon: Wheat, tone: 'kg', verb: 'Harvest' },
};

export default function Dashboard() {
  const { user } = useAuth();
  const { data, loading, error, reload } = useCollection('/dashboard');
  const firstName = user?.display_name?.split(' ')[0];

  const header = (
    <PageHeader
      eyebrow={formatLongToday()}
      eyebrowIcon={CalendarDays}
      title={
        <>
          {greeting()}, <em>{firstName}</em>
        </>
      }
      subtitle="Here’s how the garden fund and the beds are doing."
      actions={
        <>
          <Link to="/harvests" className="btn btn-secondary"><Wheat /> Log harvest</Link>
          <Link to="/savings" className="btn btn-primary"><Plus /> Add deposit</Link>
        </>
      }
    />
  );

  if (error && !data) {
    return (
      <>
        {header}
        <ErrorBanner error={error} onRetry={reload} />
      </>
    );
  }
  if (!data) {
    return (
      <>
        {header}
        <DashboardSkeleton />
      </>
    );
  }

  const isEmpty =
    data.total_saved === 0 && data.total_spent === 0 && data.total_kg_harvested === 0 && data.bed_count === 0;

  return (
    <>
      {header}
      <motion.div className="stack" variants={stagger} initial="hidden" animate="show" aria-busy={loading}>
        <motion.div className="stat-grid" variants={stagger}>
          <StatCard
            feature
            label="Fund balance"
            icon={Wallet}
            tone="saved"
            value={data.balance}
            format={formatMoney}
            negative={data.balance < 0}
            foot={<>What’s left to spend on the garden</>}
          />
          <StatCard
            label="Total saved"
            icon={PiggyBank}
            tone="saved"
            value={data.total_saved}
            format={formatMoneyRound}
            foot={
              <>
                <ArrowUpRight style={{ color: 'var(--positive)' }} />
                <strong>{formatMoneyRound(data.saved_this_month)}</strong> this month
              </>
            }
          />
          <StatCard
            label="Total spent"
            icon={Receipt}
            tone="spent"
            value={data.total_spent}
            format={formatMoneyRound}
            foot={
              <>
                <ArrowDownRight style={{ color: 'var(--accent-strong)' }} />
                <strong>{formatMoneyRound(data.spent_this_month)}</strong> this month
              </>
            }
          />
          <StatCard
            label="Harvested"
            icon={Scale}
            tone="kg"
            value={data.total_kg_harvested}
            format={formatKg}
            unit="kg"
            foot={
              <>
                <Leaf style={{ color: 'var(--ochre-600)' }} />
                <strong>{formatKg(data.kg_this_year)} kg</strong> so far this year
              </>
            }
          />
        </motion.div>

        {isEmpty ? (
          <motion.div variants={fadeUp} className="card">
            <EmptyState
              title="A fresh plot"
              message="Nothing recorded yet. Start with a first deposit into the garden fund, or add your beds."
              action={<Link to="/savings" className="btn btn-primary"><Plus /> Add first deposit</Link>}
            />
          </motion.div>
        ) : (
          <>
            <motion.div className="split" variants={fadeUp}>
              <MonthlyFlowChart data={data.monthly_totals} />
              <div className="card card-pad">
                <div className="card-header">
                  <div>
                    <h2 className="card-title">Where it goes</h2>
                    <p className="card-subtitle">All-time spending by category</p>
                  </div>
                </div>
                {data.spending_by_category.length ? (
                  <CategoryBars data={data.spending_by_category} />
                ) : (
                  <p className="card-subtitle">No expenses yet.</p>
                )}
                <Link to="/expenses" className="btn btn-ghost btn-sm mt-5">
                  See all expenses <ArrowUpRight />
                </Link>
              </div>
            </motion.div>

            <motion.div className="split" variants={fadeUp}>
              <HarvestChart data={data.kg_by_month} />
              <div className="card card-pad">
                <div className="card-header">
                  <div>
                    <h2 className="card-title">Coming up</h2>
                    <p className="card-subtitle">Expected harvests in the next few weeks</p>
                  </div>
                </div>
                {data.upcoming_harvests.length ? (
                  <ul className="list">
                    {data.upcoming_harvests.map((p) => {
                      const d = parseISODate(p.expected_harvest_date);
                      const n = daysUntil(p.expected_harvest_date);
                      return (
                        <li className="list-row" key={p.id}>
                          <span className="date-chip">
                            <span className="day">{d.getDate()}</span>
                            <span className="mon">{d.toLocaleString(undefined, { month: 'short' })}</span>
                          </span>
                          <div className="list-main">
                            <div className="list-title">
                              {p.name}
                              {p.variety && <span className="variety"> · {p.variety}</span>}
                            </div>
                            <div className="list-meta">{p.bed_name || 'No bed'}</div>
                          </div>
                          <span className={`when ${n < 0 ? 'overdue' : n <= 14 ? 'soon' : ''}`}>
                            {n < 0 ? `ready ${relativeDays(p.expected_harvest_date)}` : relativeDays(p.expected_harvest_date)}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="card-subtitle">Nothing due soon. Add expected harvest dates to your plants.</p>
                )}
                <Link to="/garden" className="btn btn-ghost btn-sm mt-4">
                  <Sprout /> {data.active_plants_count} plants growing in {data.bed_count} beds
                </Link>
              </div>
            </motion.div>

            <motion.div className="card card-pad" variants={fadeUp}>
              <div className="card-header">
                <div>
                  <h2 className="card-title">Recent activity</h2>
                  <p className="card-subtitle">The latest deposits, expenses and harvests</p>
                </div>
              </div>
              <ul className="list">
                {data.recent_activity.map((a) => {
                  const meta = ACTIVITY[a.kind];
                  const Icon = a.kind === 'expense' ? categoryMeta(a.category).icon : meta.icon;
                  return (
                    <li className="list-row" key={`${a.kind}-${a.id}`}>
                      <span className={`icon-tile sm tone-${meta.tone}`}><Icon /></span>
                      <div className="list-main">
                        <div className="list-title">{a.label || meta.verb}</div>
                        <div className="list-meta">
                          {meta.verb}
                          <span className="sep" />
                          {formatDateShort(a.date)}
                        </div>
                      </div>
                      <span className={`list-value ${a.kind === 'saving' ? 'value-pos' : ''}`}>
                        {a.kind === 'harvest'
                          ? `${formatKg(a.value)} kg`
                          : `${a.kind === 'saving' ? '+' : '−'}${formatMoney(a.value)}`}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </motion.div>
          </>
        )}
      </motion.div>
    </>
  );
}
