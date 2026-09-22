import { Router } from 'express';
import { query } from '../db.js';
import { GARDEN_TIMEZONE } from '../lib/config.js';
import { badRequest, notFound } from '../lib/errors.js';
import { notifyActivity } from '../lib/push.js';
import { parseId, parseQueryDate, validate } from '../lib/validate.js';
import { RECURRENCES, findOccurrences, isOccurrence } from '../lib/workItems.js';

const router = Router();

const MAX_RANGE_DAYS = 400;

const schema = {
  title: { type: 'string', required: true, max: 200 },
  description: { type: 'string', max: 2000 },
  scheduled_at: { type: 'datetime', required: true },
  recurrence: { type: 'enum', values: RECURRENCES, default: 'none' },
  bed_id: { type: 'id' },
  plant_id: { type: 'id' },
};

const SELECT_ITEM = `
  SELECT w.*, b.name AS bed_name, p.name AS plant_name, u.display_name AS created_by_name
  FROM work_items w
  LEFT JOIN beds b ON b.id = w.bed_id
  LEFT JOIN plants p ON p.id = w.plant_id
  LEFT JOIN users u ON u.id = w.created_by`;

async function findItem(id) {
  const { rows } = await query(`${SELECT_ITEM} WHERE w.id = $1`, [id]);
  if (rows.length === 0) throw notFound('That work item could not be found.');
  return rows[0];
}

const firstName = (user) => (user.display_name || user.email).split(' ')[0];
const whenFmt = new Intl.DateTimeFormat('en-US', { weekday: 'short', day: 'numeric', month: 'short', timeZone: GARDEN_TIMEZONE });

// ?from=YYYY-MM-DD&to=YYYY-MM-DD — every occurrence in the range, recurring items expanded.
router.get('/', async (req, res) => {
  const from = parseQueryDate(req.query.from, 'from');
  const to = parseQueryDate(req.query.to, 'to');
  if (!from || !to) throw badRequest('from and to are required (YYYY-MM-DD).');
  const days = (Date.parse(to) - Date.parse(from)) / 86_400_000;
  if (days < 0) throw badRequest('from must be on or before to.');
  if (days > MAX_RANGE_DAYS) throw badRequest(`The range can be at most ${MAX_RANGE_DAYS} days.`);
  res.json(await findOccurrences(from, to));
});

router.get('/:id', async (req, res) => {
  res.json(await findItem(parseId(req.params.id)));
});

router.post('/', async (req, res) => {
  const data = validate(schema, req.body);
  const cols = [...Object.keys(data), 'created_by'];
  const values = [...Object.values(data), req.user.id];
  const { rows } = await query(
    `INSERT INTO work_items (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
    values,
  );
  const created = await findItem(rows[0].id);
  res.status(201).json(created);
  notifyActivity(req.user.id, 'New garden task', `${firstName(req.user)} scheduled “${created.title}” for ${whenFmt.format(created.scheduled_at)}.`, {
    url: '/calendar',
    tag: 'work-item-new',
  });
});

router.put('/:id', async (req, res) => {
  const id = parseId(req.params.id);
  const data = validate(schema, req.body, { partial: true });
  const cols = Object.keys(data);
  const { rowCount } = await query(
    `UPDATE work_items SET ${cols.map((c, i) => `${c} = $${i + 1}`).join(', ')} WHERE id = $${cols.length + 1}`,
    [...Object.values(data), id],
  );
  if (rowCount === 0) throw notFound('That work item could not be found.');
  res.json(await findItem(id));
});

router.delete('/:id', async (req, res) => {
  const { rowCount } = await query('DELETE FROM work_items WHERE id = $1', [parseId(req.params.id)]);
  if (rowCount === 0) throw notFound('That work item could not be found.');
  res.status(204).end();
});

/**
 * Toggle completion. Body: { completed?: boolean, occurrence_date?: 'YYYY-MM-DD' }.
 * One-off items flip work_items.completed. Recurring items need occurrence_date
 * and are completed one occurrence at a time. Omit `completed` to toggle.
 */
router.patch('/:id/complete', async (req, res) => {
  const id = parseId(req.params.id);
  const item = await findItem(id);
  const wanted = req.body?.completed;
  if (wanted !== undefined && typeof wanted !== 'boolean') throw badRequest('completed must be true or false.');

  if (item.recurrence === 'none') {
    const { rows } = await query(
      'UPDATE work_items SET completed = COALESCE($2, NOT completed) WHERE id = $1 RETURNING completed',
      [id, wanted ?? null],
    );
    return res.json({ id, occurrence_date: null, completed: rows[0].completed });
  }

  const date = parseQueryDate(req.body?.occurrence_date, 'occurrence_date');
  if (!date) throw badRequest('occurrence_date is required for a recurring item.');
  if (!(await isOccurrence(id, date))) throw badRequest('That date isn’t one of this item’s occurrences.');

  const { rows } = await query(
    'SELECT 1 FROM work_item_completions WHERE work_item_id = $1 AND occurrence_date = $2',
    [id, date],
  );
  const completed = wanted ?? rows.length === 0;
  if (completed) {
    await query(
      `INSERT INTO work_item_completions (work_item_id, occurrence_date, completed_by) VALUES ($1, $2, $3)
       ON CONFLICT (work_item_id, occurrence_date) DO NOTHING`,
      [id, date, req.user.id],
    );
  } else {
    await query('DELETE FROM work_item_completions WHERE work_item_id = $1 AND occurrence_date = $2', [id, date]);
  }
  res.json({ id, occurrence_date: date, completed });
});

export default router;
