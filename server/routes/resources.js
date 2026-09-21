import { badRequest } from '../lib/errors.js';
import { crudRouter } from '../lib/crud.js';
import { parseQueryDate } from '../lib/validate.js';

export const PLANT_STATUSES = ['planted', 'growing', 'harvested', 'removed'];
export const EXPENSE_CATEGORIES = ['seeds', 'soil', 'tools', 'water', 'fertilizer', 'other'];

const MAX_AMOUNT = 99_999_999.99; // NUMERIC(10,2)

function optionalId(raw, name) {
  if (raw === undefined || raw === '') return undefined;
  const id = Number(raw);
  if (!Number.isInteger(id) || id < 1) throw badRequest(`${name} must be a valid id.`);
  return id;
}

/** WHERE clauses for ?from=YYYY-MM-DD&to=YYYY-MM-DD on a date column. */
function dateRange(q, addParam, column) {
  const clauses = [];
  const from = parseQueryDate(q.from, 'from');
  const to = parseQueryDate(q.to, 'to');
  if (from) clauses.push(`${column} >= ${addParam(from)}`);
  if (to) clauses.push(`${column} <= ${addParam(to)}`);
  return clauses;
}

export const bedsRouter = crudRouter({
  table: 'beds',
  alias: 'b',
  schema: {
    name: { type: 'string', required: true, max: 120 },
    location: { type: 'string', max: 200 },
    size_sqm: { type: 'number', min: 0, max: 999_999.99 },
    notes: { type: 'string', max: 2000 },
  },
  selectSql: `
    SELECT b.*,
      (SELECT COUNT(*) FROM plants p WHERE p.bed_id = b.id AND p.status IN ('planted', 'growing')) AS active_plants,
      (SELECT COUNT(*) FROM plants p WHERE p.bed_id = b.id) AS total_plants,
      (SELECT COALESCE(SUM(h.quantity_kg), 0) FROM harvests h WHERE h.bed_id = b.id) AS total_kg
    FROM beds b`,
  orderBy: 'b.name ASC, b.id ASC',
});

export const plantsRouter = crudRouter({
  table: 'plants',
  alias: 'p',
  schema: {
    bed_id: { type: 'id' },
    name: { type: 'string', required: true, max: 120 },
    variety: { type: 'string', max: 120 },
    planted_date: { type: 'date' },
    expected_harvest_date: { type: 'date' },
    status: { type: 'enum', values: PLANT_STATUSES, default: 'planted' },
    notes: { type: 'string', max: 2000 },
  },
  selectSql: `
    SELECT p.*, b.name AS bed_name
    FROM plants p
    LEFT JOIN beds b ON b.id = p.bed_id`,
  orderBy: `CASE p.status WHEN 'growing' THEN 0 WHEN 'planted' THEN 1 WHEN 'harvested' THEN 2 ELSE 3 END,
            p.expected_harvest_date ASC NULLS LAST, p.name ASC`,
  filters(q, addParam) {
    const clauses = [];
    const bedId = optionalId(q.bed_id, 'bed_id');
    if (bedId) clauses.push(`p.bed_id = ${addParam(bedId)}`);
    if (q.status) {
      if (!PLANT_STATUSES.includes(q.status)) throw badRequest('Unknown plant status.');
      clauses.push(`p.status = ${addParam(q.status)}`);
    }
    return clauses;
  },
});

export const savingsRouter = crudRouter({
  table: 'savings',
  alias: 's',
  schema: {
    amount: { type: 'number', required: true, gt: 0, max: MAX_AMOUNT },
    note: { type: 'string', max: 500 },
    saved_on: { type: 'date', required: true },
  },
  selectSql: 'SELECT s.* FROM savings s',
  orderBy: 's.saved_on DESC, s.id DESC',
  filters: (q, addParam) => dateRange(q, addParam, 's.saved_on'),
});

export const expensesRouter = crudRouter({
  table: 'expenses',
  alias: 'e',
  schema: {
    category: { type: 'enum', values: EXPENSE_CATEGORIES, required: true },
    amount: { type: 'number', required: true, gt: 0, max: MAX_AMOUNT },
    description: { type: 'string', max: 500 },
    plant_id: { type: 'id' },
    spent_on: { type: 'date', required: true },
  },
  selectSql: `
    SELECT e.*, p.name AS plant_name
    FROM expenses e
    LEFT JOIN plants p ON p.id = e.plant_id`,
  orderBy: 'e.spent_on DESC, e.id DESC',
  filters(q, addParam) {
    const clauses = dateRange(q, addParam, 'e.spent_on');
    if (q.category) {
      if (!EXPENSE_CATEGORIES.includes(q.category)) throw badRequest('Unknown expense category.');
      clauses.push(`e.category = ${addParam(q.category)}`);
    }
    return clauses;
  },
});

export const harvestsRouter = crudRouter({
  table: 'harvests',
  alias: 'h',
  schema: {
    plant_id: { type: 'id' },
    bed_id: { type: 'id' },
    crop_name: { type: 'string', required: true, max: 120 },
    quantity_kg: { type: 'number', required: true, gt: 0, max: MAX_AMOUNT },
    harvested_on: { type: 'date', required: true },
    notes: { type: 'string', max: 2000 },
  },
  selectSql: `
    SELECT h.*, p.name AS plant_name, b.name AS bed_name
    FROM harvests h
    LEFT JOIN plants p ON p.id = h.plant_id
    LEFT JOIN beds b ON b.id = h.bed_id`,
  orderBy: 'h.harvested_on DESC, h.id DESC',
  filters(q, addParam) {
    const clauses = dateRange(q, addParam, 'h.harvested_on');
    const plantId = optionalId(q.plant_id, 'plant_id');
    const bedId = optionalId(q.bed_id, 'bed_id');
    if (plantId) clauses.push(`h.plant_id = ${addParam(plantId)}`);
    if (bedId) clauses.push(`h.bed_id = ${addParam(bedId)}`);
    return clauses;
  },
});
