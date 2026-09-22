import cron from 'node-cron';
import { query } from '../db.js';
import { GARDEN_TIMEZONE } from '../lib/config.js';
import { pushEnabled, sendPushToUser } from '../lib/push.js';
import { findOccurrences } from '../lib/workItems.js';

// Reminders fire at 08:00 (daily) and 09:00 on the 1st (monthly) in this zone.
export const REMINDER_TIMEZONE = GARDEN_TIMEZONE;

/** Today's date as YYYY-MM-DD in the reminder timezone. */
function todayInZone(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: REMINDER_TIMEZONE }).format(now);
}

// Only users with at least one subscribed device; settings fall back to the defaults.
const SUBSCRIBED_USERS = `
  SELECT u.id,
         rs.watering_interval_days,
         rs.last_watering_sent_on,
         COALESCE(rs.harvest_lead_days, 3)         AS harvest_lead_days,
         COALESCE(rs.notify_harvest, true)         AS notify_harvest,
         COALESCE(rs.notify_savings_monthly, true) AS notify_savings_monthly
  FROM users u
  LEFT JOIN reminder_settings rs ON rs.user_id = u.id
  WHERE EXISTS (SELECT 1 FROM push_subscriptions ps WHERE ps.user_id = u.id)`;

function plantLabel(p) {
  return p.variety ? `${p.name} (${p.variety})` : p.name;
}

function whenLabel(days) {
  if (days <= 0) return 'today';
  if (days === 1) return 'tomorrow';
  return `in ${days} days`;
}

async function sendHarvestReminder(user, today) {
  // Plants still in the ground that are due within the lead window and haven't
  // been reminded about for this expected date yet.
  const { rows: plants } = await query(
    `SELECT p.id, p.name, p.variety, p.expected_harvest_date,
            (p.expected_harvest_date - $2::date) AS days_left
     FROM plants p
     WHERE p.status IN ('planted', 'growing')
       AND p.expected_harvest_date BETWEEN $2::date AND $2::date + $3::int
       AND NOT EXISTS (
         SELECT 1 FROM harvest_reminders_sent s
         WHERE s.user_id = $1 AND s.plant_id = p.id AND s.expected_harvest_date = p.expected_harvest_date
       )
     ORDER BY p.expected_harvest_date, p.name`,
    [user.id, today, user.harvest_lead_days],
  );
  if (plants.length === 0) return;

  const [first] = plants;
  const title = plants.length === 1 ? 'Harvest coming up' : `${plants.length} plants almost ready`;
  const body =
    plants.length === 1
      ? `${plantLabel(first)} should be ready ${whenLabel(first.days_left)}.`
      : `${plants.map(plantLabel).slice(0, 4).join(', ')}${plants.length > 4 ? '…' : ''} — first one ${whenLabel(first.days_left)}.`;

  const delivered = await sendPushToUser(user.id, title, body, { url: '/garden', tag: 'harvest' });
  if (delivered > 0) {
    await query(
      `INSERT INTO harvest_reminders_sent (user_id, plant_id, expected_harvest_date)
       SELECT $1, p.id, p.expected_harvest_date FROM plants p WHERE p.id = ANY($2::int[])
       ON CONFLICT DO NOTHING`,
      [user.id, plants.map((p) => p.id)],
    );
  }
}

async function sendWateringReminder(user, today) {
  const interval = user.watering_interval_days;
  if (!interval) return;
  if (user.last_watering_sent_on) {
    const next = new Date(`${user.last_watering_sent_on}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + interval);
    if (next.toISOString().slice(0, 10) > today) return;
  }

  const body = interval === 1 ? 'Daily reminder to water the beds.' : `It’s been ${interval} days — time to water the beds.`;
  const delivered = await sendPushToUser(user.id, 'Time to water', body, { url: '/garden', tag: 'watering' });
  if (delivered > 0) {
    await query('UPDATE reminder_settings SET last_watering_sent_on = $2 WHERE user_id = $1', [user.id, today]);
  }
}

/** Harvest and watering reminders for every subscribed user. */
export async function runDailyReminders() {
  const today = todayInZone();
  const { rows: users } = await query(SUBSCRIBED_USERS);
  for (const user of users) {
    try {
      if (user.notify_harvest) await sendHarvestReminder(user, today);
      await sendWateringReminder(user, today);
    } catch (err) {
      console.error(`Daily reminders for user #${user.id} failed:`, err.message);
    }
  }
}

/** "Add this month's savings" nudge for users who opted in. */
export async function runMonthlySavingsReminder() {
  const month = new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: REMINDER_TIMEZONE }).format(new Date());
  const { rows: users } = await query(`${SUBSCRIBED_USERS} AND COALESCE(rs.notify_savings_monthly, true)`);
  await Promise.all(
    users.map((user) =>
      sendPushToUser(user.id, 'Garden fund', `New month! Add ${month}’s savings to the garden fund.`, {
        url: '/savings',
        tag: 'savings-monthly',
      }).catch((err) => console.error(`Savings reminder for user #${user.id} failed:`, err.message)),
    ),
  );
}

/* ---------- Calendar work items ---------- */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
// Day-before reminders wait for waking hours; the last run before quiet time sends any still pending.
const WAKING_START = 7;
const WAKING_END = 21;

const hourFmt = new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: REMINDER_TIMEZONE });
const timeFmt = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: REMINDER_TIMEZONE });

function addDays(isoDate, n) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Which reminder (if any) an occurrence is due for at `now`. */
function dueKind(occ, now, hour, today, tomorrow) {
  const at = occ.occurs_at.getTime();
  const t = now.getTime();
  if (occ.occurrence_date === tomorrow) {
    const awake = hour >= WAKING_START && hour < WAKING_END;
    return awake && (t >= at - DAY || hour === WAKING_END - 1) ? 'day_before' : null;
  }
  if (occ.occurrence_date === today) {
    // In the morning, or an hour ahead for early tasks — and not long after it has passed.
    const inTime = hour >= WAKING_START || t >= at - HOUR;
    return inTime && t <= at + 2 * HOUR ? 'day_of' : null;
  }
  return null;
}

/**
 * Day-before and day-of pushes for every open occurrence. Work items are
 * shared, so everyone subscribed hears about them (unless they turned
 * calendar reminders off). Each reminder is claimed in
 * work_item_reminders_sent *before* sending, so overlapping runs or a
 * restart can never send it twice.
 */
export async function runWorkItemReminders(now = new Date()) {
  const today = todayInZone(now);
  const tomorrow = addDays(today, 1);
  const hour = Number(hourFmt.format(now));

  const occurrences = await findOccurrences(today, tomorrow);
  const due = occurrences
    .filter((occ) => !occ.completed)
    .map((occ) => [occ, dueKind(occ, now, hour, today, tomorrow)])
    .filter(([, kind]) => kind);
  if (due.length === 0) return;

  const { rows: users } = await query(`${SUBSCRIBED_USERS} AND COALESCE(rs.notify_calendar, true)`);
  for (const [occ, kind] of due) {
    const { rowCount } = await query(
      `INSERT INTO work_item_reminders_sent (work_item_id, occurrence_date, kind) VALUES ($1, $2, $3)
       ON CONFLICT (work_item_id, occurrence_date, kind) DO NOTHING`,
      [occ.id, occ.occurrence_date, kind],
    );
    if (rowCount === 0) continue;

    const title = `🌱 ${kind === 'day_before' ? 'Tomorrow' : 'Today'}: ${occ.title}`;
    const body = [timeFmt.format(occ.occurs_at), occ.bed_name, occ.plant_name].filter(Boolean).join(' · ');
    await Promise.all(
      users.map((user) =>
        // Same tag per occurrence: the day-of reminder replaces yesterday's.
        sendPushToUser(user.id, title, body, { url: `/calendar?date=${occ.occurrence_date}`, tag: `work-${occ.id}-${occ.occurrence_date}` })
          .catch((err) => console.error(`Work item reminder for user #${user.id} failed:`, err.message)),
      ),
    );
  }
}

export function startReminderJobs() {
  if (!pushEnabled) return;
  const options = { timezone: REMINDER_TIMEZONE, noOverlap: true };
  const guard = (name, fn) => () => fn().catch((err) => console.error(`${name} job failed:`, err.message));

  cron.schedule('0 8 * * *', guard('Daily reminders', runDailyReminders), { ...options, name: 'daily-reminders' });
  cron.schedule('0 9 1 * *', guard('Monthly savings', runMonthlySavingsReminder), { ...options, name: 'monthly-savings' });
  cron.schedule('0 * * * *', guard('Work item reminders', () => runWorkItemReminders()), { ...options, name: 'work-item-reminders' });
  console.log(`⏰ Reminder jobs scheduled (${REMINDER_TIMEZONE})`);
}
