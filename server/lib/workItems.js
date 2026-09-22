import { query } from '../db.js';
import { GARDEN_TIMEZONE } from './config.js';

export const RECURRENCES = ['none', 'weekly', 'monthly'];

/**
 * Every occurrence of every work item whose date (in the garden's timezone)
 * falls within [from, to], both 'YYYY-MM-DD'. Recurring items are expanded in
 * SQL: the step is added to the local wall-clock time and converted back, so
 * a 09:00 task stays at 09:00 across DST changes. Monthly steps are counted
 * from the first date, so the 31st becomes the last day of shorter months
 * and returns to the 31st afterwards.
 *
 * Each row: the item's fields plus occurs_at (timestamptz), occurrence_date
 * (garden-local date) and completed (for that occurrence).
 */
export const OCCURRENCES_SQL = `
  SELECT w.id, w.title, w.description, w.scheduled_at, w.recurrence,
         w.bed_id, b.name AS bed_name, w.plant_id, p.name AS plant_name,
         w.created_by, u.display_name AS created_by_name,
         o.occurs_at,
         to_char((o.occurs_at AT TIME ZONE $1)::date, 'YYYY-MM-DD') AS occurrence_date,
         CASE WHEN w.recurrence = 'none' THEN w.completed
              ELSE EXISTS (
                SELECT 1 FROM work_item_completions c
                WHERE c.work_item_id = w.id AND c.occurrence_date = (o.occurs_at AT TIME ZONE $1)::date
              )
         END AS completed
  FROM work_items w
  CROSS JOIN LATERAL (
    SELECT ((w.scheduled_at AT TIME ZONE $1)
             + n * CASE w.recurrence WHEN 'monthly' THEN interval '1 month' ELSE interval '1 week' END
           ) AT TIME ZONE $1 AS occurs_at
    FROM generate_series(
      0,
      CASE w.recurrence
        WHEN 'none' THEN 0
        -- Enough steps to reach "to" (28 days is the shortest month, so monthly overshoots slightly).
        ELSE GREATEST(0, ($3::date - (w.scheduled_at AT TIME ZONE $1)::date)
                         / CASE w.recurrence WHEN 'weekly' THEN 7 ELSE 28 END + 1)
      END
    ) AS n
  ) o
  LEFT JOIN beds b ON b.id = w.bed_id
  LEFT JOIN plants p ON p.id = w.plant_id
  LEFT JOIN users u ON u.id = w.created_by
  WHERE (o.occurs_at AT TIME ZONE $1)::date BETWEEN $2::date AND $3::date`;

export async function findOccurrences(from, to) {
  const { rows } = await query(`${OCCURRENCES_SQL} ORDER BY o.occurs_at, w.id`, [GARDEN_TIMEZONE, from, to]);
  return rows;
}

/** Whether `date` ('YYYY-MM-DD', garden-local) is an occurrence of the item. */
export async function isOccurrence(itemId, date) {
  const { rows } = await query(`${OCCURRENCES_SQL} AND w.id = $4`, [GARDEN_TIMEZONE, date, date, itemId]);
  return rows.length > 0;
}
