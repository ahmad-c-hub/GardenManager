import cron from 'node-cron';
import { query } from '../db.js';
import { pushEnabled, sendPushToUser } from '../lib/push.js';

// Reminders fire at 08:00 (daily) and 09:00 on the 1st (monthly) in this zone.
export const REMINDER_TIMEZONE = process.env.REMINDER_TIMEZONE || 'UTC';

/** Today's date as YYYY-MM-DD in the reminder timezone. */
function todayInZone() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: REMINDER_TIMEZONE }).format(new Date());
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

export function startReminderJobs() {
  if (!pushEnabled) return;
  const options = { timezone: REMINDER_TIMEZONE, noOverlap: true };
  const guard = (name, fn) => () => fn().catch((err) => console.error(`${name} job failed:`, err.message));

  cron.schedule('0 8 * * *', guard('Daily reminders', runDailyReminders), { ...options, name: 'daily-reminders' });
  cron.schedule('0 9 1 * *', guard('Monthly savings', runMonthlySavingsReminder), { ...options, name: 'monthly-savings' });
  console.log(`⏰ Reminder jobs scheduled (${REMINDER_TIMEZONE})`);
}
