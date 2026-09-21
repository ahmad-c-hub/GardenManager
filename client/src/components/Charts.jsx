import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { categoryMeta } from '../lib/constants.js';
import {
  formatKg,
  formatKgShort,
  formatMoney,
  formatMoneyCompact,
  formatMonth,
  formatMonthYear,
} from '../lib/format.js';

// Mirrors the --chart-* tokens (SVG attributes can't read CSS variables).
// These series colours were validated for colour-vision deficiency and >= 3:1 contrast.
const C = {
  saved: '#1e7443',
  spent: '#d07c45',
  kg: '#a6761d',
  grid: '#ebe2d2',
  axis: '#5f6d63',
  surface: '#fffdf8',
  cursor: 'rgba(214, 228, 204, 0.45)',
};

const axisProps = {
  axisLine: false,
  tickLine: false,
  tick: { fill: C.axis, fontSize: 12, fontFamily: 'Inter, system-ui, sans-serif' },
};

function Legend({ items }) {
  return (
    <div className="legend" aria-hidden="true">
      {items.map((it) => (
        <span className="legend-item" key={it.label}>
          <span className="legend-swatch" style={{ background: it.color }} />
          {it.label}
        </span>
      ))}
    </div>
  );
}

function TableToggle({ open, onToggle }) {
  return (
    <button type="button" className="btn btn-ghost btn-sm chart-table-toggle" onClick={onToggle} aria-expanded={open}>
      {open ? 'Hide table' : 'View as table'}
    </button>
  );
}

/* ---------- Savings vs spending by month ---------- */

function FlowTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  const net = row.saved - row.spent;
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-title">{formatMonthYear(label)}</div>
      <div className="chart-tooltip-row">
        <span className="legend-item"><span className="legend-swatch" style={{ background: C.saved }} />Saved</span>
        <strong>{formatMoney(row.saved)}</strong>
      </div>
      <div className="chart-tooltip-row">
        <span className="legend-item"><span className="legend-swatch" style={{ background: C.spent }} />Spent</span>
        <strong>{formatMoney(row.spent)}</strong>
      </div>
      <div className="chart-tooltip-row muted">
        <span>Net to fund</span>
        <strong>{net >= 0 ? '+' : '−'}{formatMoney(Math.abs(net))}</strong>
      </div>
    </div>
  );
}

export function MonthlyFlowChart({ data }) {
  const [showTable, setShowTable] = useState(false);
  return (
    <div className="card card-pad chart-card">
      <div className="card-header">
        <div>
          <h2 className="card-title">Saved vs. spent</h2>
          <p className="card-subtitle">Money into and out of the fund, last 12 months</p>
        </div>
        <Legend items={[{ label: 'Saved', color: C.saved }, { label: 'Spent', color: C.spent }]} />
      </div>
      <div className="chart-box" role="img" aria-label="Bar chart of money saved and spent per month over the last 12 months">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} barGap={2} barCategoryGap="28%" margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke={C.grid} strokeDasharray="3 5" />
            <XAxis dataKey="month" tickFormatter={formatMonth} {...axisProps} dy={8} interval="preserveStartEnd" minTickGap={8} />
            <YAxis tickFormatter={formatMoneyCompact} {...axisProps} width={60} allowDecimals={false} />
            <Tooltip content={<FlowTooltip />} cursor={{ fill: C.cursor, radius: 8 }} />
            <Bar dataKey="saved" name="Saved" fill={C.saved} radius={[4, 4, 0, 0]} maxBarSize={18} animationDuration={900} />
            <Bar dataKey="spent" name="Spent" fill={C.spent} radius={[4, 4, 0, 0]} maxBarSize={18} animationDuration={900} animationBegin={120} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <TableToggle open={showTable} onToggle={() => setShowTable((s) => !s)} />
      {showTable && (
        <table className="chart-table">
          <thead>
            <tr><th>Month</th><th>Saved</th><th>Spent</th><th>Net</th></tr>
          </thead>
          <tbody>
            {data.map((r) => (
              <tr key={r.month}>
                <td>{formatMonthYear(r.month)}</td>
                <td>{formatMoney(r.saved)}</td>
                <td>{formatMoney(r.spent)}</td>
                <td>{formatMoney(r.saved - r.spent)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/* ---------- Kilograms harvested by month ---------- */

function KgTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-title">{formatMonthYear(label)}</div>
      <div className="chart-tooltip-row">
        <span>Harvested</span>
        <strong>{formatKg(payload[0].value)} kg</strong>
      </div>
    </div>
  );
}

export function HarvestChart({ data }) {
  const [showTable, setShowTable] = useState(false);
  return (
    <div className="card card-pad chart-card">
      <div className="card-header">
        <div>
          <h2 className="card-title">Kilograms harvested</h2>
          <p className="card-subtitle">What the garden gave back, last 12 months</p>
        </div>
      </div>
      <div className="chart-box short" role="img" aria-label="Area chart of kilograms harvested per month over the last 12 months">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="kgFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={C.kg} stopOpacity={0.3} />
                <stop offset="100%" stopColor={C.kg} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke={C.grid} strokeDasharray="3 5" />
            <XAxis dataKey="month" tickFormatter={formatMonth} {...axisProps} dy={8} interval="preserveStartEnd" minTickGap={8} />
            <YAxis tickFormatter={(v) => `${formatKgShort(v)} kg`} {...axisProps} width={60} />
            <Tooltip content={<KgTooltip />} cursor={{ stroke: C.kg, strokeWidth: 1, strokeDasharray: '4 4' }} />
            <Area
              type="monotone"
              dataKey="kg"
              stroke={C.kg}
              strokeWidth={2}
              fill="url(#kgFill)"
              dot={false}
              activeDot={{ r: 5, fill: C.kg, stroke: C.surface, strokeWidth: 2 }}
              animationDuration={1100}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <TableToggle open={showTable} onToggle={() => setShowTable((s) => !s)} />
      {showTable && (
        <table className="chart-table">
          <thead>
            <tr><th>Month</th><th>Harvested (kg)</th></tr>
          </thead>
          <tbody>
            {data.map((r) => (
              <tr key={r.month}><td>{formatMonthYear(r.month)}</td><td>{formatKg(r.kg)}</td></tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/* ---------- Spending by category (ranked bars, one hue) ---------- */

export function CategoryBars({ data }) {
  const total = data.reduce((sum, d) => sum + d.total, 0);
  const max = Math.max(...data.map((d) => d.total), 1);
  return (
    <ul className="cat-bars list">
      {data.map((d, i) => {
        const meta = categoryMeta(d.category);
        const Icon = meta.icon;
        const pct = total ? Math.round((d.total / total) * 100) : 0;
        return (
          <li className="cat-bar-row" key={d.category}>
            <span className="icon-tile sm tone-spent"><Icon /></span>
            <div>
              <div className="cat-bar-head">
                <span className="name">{meta.label}</span>
                <span className="pct">{pct}%</span>
              </div>
              <div className="cat-bar-track">
                <motion.div
                  className="cat-bar-fill"
                  initial={{ width: 0 }}
                  animate={{ width: `${(d.total / max) * 100}%` }}
                  transition={{ duration: 0.9, delay: 0.15 + i * 0.07, ease: [0.22, 1, 0.36, 1] }}
                />
              </div>
            </div>
            <span className="cat-bar-amount">{formatMoney(d.total)}</span>
          </li>
        );
      })}
    </ul>
  );
}
