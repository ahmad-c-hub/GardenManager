// Compact, readable snapshot of the garden for the Planting Assistant's prompt.
import { query } from '../db.js';
import { GARDEN_TIMEZONE } from './config.js';

const MAX_CURRENT = 80;
const MAX_PAST = 40;
const MAX_CROPS = 25;
const MAX_RECENT_HARVESTS = 10;

const kg = new Intl.NumberFormat('en', { maximumFractionDigits: 1 });

function today() {
  const now = new Date();
  const iso = new Intl.DateTimeFormat('en-CA', { timeZone: GARDEN_TIMEZONE }).format(now);
  const long = new Intl.DateTimeFormat('en-GB', {
    timeZone: GARDEN_TIMEZONE,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(now);
  return { iso, long, month: Number(iso.slice(5, 7)) };
}

/** Northern-hemisphere season with early/mid/late, e.g. "early autumn". */
function season(month) {
  const seasons = ['winter', 'spring', 'summer', 'autumn'];
  const index = Math.floor((month % 12) / 3); // Dec–Feb, Mar–May, Jun–Aug, Sep–Nov
  const phase = ['early', 'mid', 'late'][month % 3];
  return `${phase} ${seasons[index]}`;
}

const daysBetween = (from, to) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);

function describePlant(p, todayIso) {
  let line = p.variety ? `${p.name} '${p.variety}'` : p.name;
  line += ` — ${p.status}`;
  if (p.planted_date) line += `, planted ${p.planted_date}`;
  if (p.expected_harvest_date && ['planted', 'growing'].includes(p.status)) {
    const days = daysBetween(todayIso, p.expected_harvest_date);
    line += `, harvest expected ${p.expected_harvest_date}`;
    if (days < 0) line += ` (${-days} days overdue)`;
    else if (days <= 14) line += ` (in ${days} days)`;
  }
  return line;
}

function groupByBed(plants, todayIso) {
  const groups = new Map();
  for (const p of plants) {
    const bed = p.bed_name ?? 'Not in a bed';
    if (!groups.has(bed)) groups.set(bed, []);
    groups.get(bed).push(describePlant(p, todayIso));
  }
  return [...groups].map(([bed, lines]) => `- ${bed}: ${lines.join('; ')}`);
}

/** Query the garden and summarise it as plain text. */
export async function buildGardenContext() {
  const t = today();

  const [beds, current, past, crops, recent] = await Promise.all([
    query('SELECT name, location, size_sqm FROM beds ORDER BY name LIMIT 50'),
    query(
      `SELECT p.name, p.variety, p.status, p.planted_date, p.expected_harvest_date, b.name AS bed_name
       FROM plants p LEFT JOIN beds b ON b.id = p.bed_id
       WHERE p.status IN ('planted', 'growing')
       ORDER BY b.name NULLS LAST, p.planted_date NULLS LAST
       LIMIT $1`,
      [MAX_CURRENT],
    ),
    // What each bed grew recently, for crop rotation advice.
    query(
      `SELECT p.name, p.variety, p.status, p.planted_date, b.name AS bed_name
       FROM plants p LEFT JOIN beds b ON b.id = p.bed_id
       WHERE p.status IN ('harvested', 'removed')
         AND COALESCE(p.planted_date, p.created_at::date) >= $1::date - INTERVAL '18 months'
       ORDER BY p.planted_date DESC NULLS LAST
       LIMIT $2`,
      [t.iso, MAX_PAST],
    ),
    query(
      `SELECT crop_name, SUM(quantity_kg) AS kg, COUNT(*) AS pickings, MAX(harvested_on) AS last
       FROM harvests
       WHERE harvested_on >= $1::date - INTERVAL '12 months'
       GROUP BY crop_name
       ORDER BY kg DESC
       LIMIT $2`,
      [t.iso, MAX_CROPS],
    ),
    query(
      `SELECT h.crop_name, h.quantity_kg, h.harvested_on, b.name AS bed_name
       FROM harvests h LEFT JOIN beds b ON b.id = h.bed_id
       ORDER BY h.harvested_on DESC, h.id DESC
       LIMIT $1`,
      [MAX_RECENT_HARVESTS],
    ),
  ]);

  const out = [`Today is ${t.long} (${t.iso}) — ${season(t.month)} in the Bekaa Valley.`];

  out.push('', `Beds (${beds.rows.length}):`);
  if (beds.rows.length === 0) out.push('- none recorded yet');
  for (const b of beds.rows) {
    const details = [b.location, b.size_sqm ? `${kg.format(b.size_sqm)} m²` : null].filter(Boolean).join(', ');
    out.push(`- ${b.name}${details ? ` — ${details}` : ''}`);
  }

  out.push('', `Currently growing (${current.rows.length}${current.rows.length === MAX_CURRENT ? '+' : ''}):`);
  out.push(...(current.rows.length ? groupByBed(current.rows, t.iso) : ['- nothing recorded as planted right now']));

  if (past.rows.length) {
    out.push('', 'Finished in the last 18 months (useful for rotation):');
    out.push(...groupByBed(past.rows, t.iso));
  }

  out.push('', 'Harvests in the last 12 months:');
  if (crops.rows.length === 0) out.push('- none recorded');
  else {
    const total = crops.rows.reduce((sum, c) => sum + c.kg, 0);
    out.push(`- total ${kg.format(total)} kg`);
    for (const c of crops.rows) {
      out.push(`- ${c.crop_name}: ${kg.format(c.kg)} kg over ${c.pickings} picking${c.pickings === 1 ? '' : 's'}, last on ${c.last}`);
    }
  }

  if (recent.rows.length) {
    out.push('', 'Most recent harvests:');
    for (const h of recent.rows) {
      out.push(`- ${h.harvested_on}: ${h.crop_name}, ${kg.format(h.quantity_kg)} kg${h.bed_name ? ` (${h.bed_name})` : ''}`);
    }
  }

  return out.join('\n');
}
