import { Router } from 'express';
import { query } from '../db.js';

const router = Router();

// The last 12 calendar months, oldest first, including the current month.
const LAST_12_MONTHS = `
  SELECT generate_series(
    date_trunc('month', CURRENT_DATE) - INTERVAL '11 months',
    date_trunc('month', CURRENT_DATE),
    INTERVAL '1 month'
  )::date AS month`;

router.get('/', async (_req, res) => {
  const [totals, byCategory, monthly, kgMonthly, upcoming, recent] = await Promise.all([
    query(`
      SELECT
        (SELECT COALESCE(SUM(amount), 0) FROM savings)       AS total_saved,
        (SELECT COALESCE(SUM(amount), 0) FROM expenses)      AS total_spent,
        (SELECT COALESCE(SUM(quantity_kg), 0) FROM harvests) AS total_kg_harvested,
        (SELECT COUNT(*) FROM plants WHERE status IN ('planted', 'growing')) AS active_plants_count,
        (SELECT COUNT(*) FROM beds)                          AS bed_count,
        (SELECT COALESCE(SUM(amount), 0) FROM savings
           WHERE saved_on >= date_trunc('month', CURRENT_DATE))  AS saved_this_month,
        (SELECT COALESCE(SUM(amount), 0) FROM expenses
           WHERE spent_on >= date_trunc('month', CURRENT_DATE))  AS spent_this_month,
        (SELECT COALESCE(SUM(quantity_kg), 0) FROM harvests
           WHERE harvested_on >= date_trunc('year', CURRENT_DATE)) AS kg_this_year
    `),
    query(`
      SELECT category, SUM(amount) AS total, COUNT(*) AS count
      FROM expenses
      GROUP BY category
      ORDER BY total DESC
    `),
    query(`
      WITH months AS (${LAST_12_MONTHS})
      SELECT to_char(m.month, 'YYYY-MM') AS month,
        COALESCE((SELECT SUM(amount) FROM savings
                  WHERE date_trunc('month', saved_on) = m.month), 0) AS saved,
        COALESCE((SELECT SUM(amount) FROM expenses
                  WHERE date_trunc('month', spent_on) = m.month), 0) AS spent
      FROM months m
      ORDER BY m.month
    `),
    query(`
      WITH months AS (${LAST_12_MONTHS})
      SELECT to_char(m.month, 'YYYY-MM') AS month,
        COALESCE((SELECT SUM(quantity_kg) FROM harvests
                  WHERE date_trunc('month', harvested_on) = m.month), 0) AS kg
      FROM months m
      ORDER BY m.month
    `),
    query(`
      SELECT p.id, p.name, p.variety, p.expected_harvest_date, p.status, b.name AS bed_name
      FROM plants p
      LEFT JOIN beds b ON b.id = p.bed_id
      WHERE p.status IN ('planted', 'growing')
        AND p.expected_harvest_date IS NOT NULL
        AND p.expected_harvest_date <= CURRENT_DATE + 45
      ORDER BY p.expected_harvest_date ASC
      LIMIT 6
    `),
    query(`
      (SELECT 'saving' AS kind, id, amount AS value, note AS label, NULL::text AS category, saved_on AS date, created_at FROM savings)
      UNION ALL
      (SELECT 'expense', id, amount, COALESCE(description, initcap(category)), category, spent_on, created_at FROM expenses)
      UNION ALL
      (SELECT 'harvest', id, quantity_kg, crop_name, NULL, harvested_on, created_at FROM harvests)
      ORDER BY date DESC, created_at DESC
      LIMIT 6
    `),
  ]);

  const t = totals.rows[0];
  res.json({
    total_saved: t.total_saved,
    total_spent: t.total_spent,
    balance: Math.round((t.total_saved - t.total_spent) * 100) / 100,
    total_kg_harvested: t.total_kg_harvested,
    active_plants_count: t.active_plants_count,
    bed_count: t.bed_count,
    saved_this_month: t.saved_this_month,
    spent_this_month: t.spent_this_month,
    kg_this_year: t.kg_this_year,
    spending_by_category: byCategory.rows,
    monthly_totals: monthly.rows,
    kg_by_month: kgMonthly.rows,
    upcoming_harvests: upcoming.rows,
    recent_activity: recent.rows.map(({ created_at, ...row }) => row),
  });
});

export default router;
