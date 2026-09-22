// Fills the database with a year of sample garden data (relative to today).
// Never touches the users table.
//
//   npm run seed              – only runs if the garden tables are empty
//   npm run seed -- --force   – wipes beds/plants/savings/expenses/harvests first
import { parseArgs } from 'node:util';
import { pool, withTransaction } from '../db.js';

const { values: args } = parseArgs({ options: { force: { type: 'boolean', default: false } } });

// Small deterministic PRNG so every seed run produces the same data.
let state = 42;
const rand = () => ((state = (state * 1664525 + 1013904223) % 4294967296) / 4294967296);
const between = (min, max) => Math.round((min + rand() * (max - min)) * 100) / 100;

const today = new Date();
const iso = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const daysFromToday = (n) => {
  const d = new Date(today);
  d.setDate(d.getDate() + n);
  return iso(d);
};
/** A date in the month `monthsAgo` months back, on day `day` (clamped to today). */
const monthDate = (monthsAgo, day) => {
  const d = new Date(today.getFullYear(), today.getMonth() - monthsAgo, day);
  return d > today ? iso(today) : iso(d);
};

const beds = [
  { key: 'tomato', name: 'Sunny Raised Bed', location: 'South fence', size_sqm: 4.5, notes: 'Best light in the garden — tomatoes and basil live here.' },
  { key: 'herbs', name: 'Herb Spiral', location: 'By the kitchen door', size_sqm: 2, notes: 'Stone spiral: dry at the top, damp at the bottom.' },
  { key: 'roots', name: 'Root Row', location: 'Back plot', size_sqm: 6, notes: 'Deep, loose soil. Rotate with legumes next year.' },
  { key: 'greenhouse', name: 'Little Greenhouse', location: 'West corner', size_sqm: 3.2, notes: 'Winter greens and early seedlings.' },
  { key: 'berries', name: 'Berry Patch', location: 'Along the path', size_sqm: 5, notes: null },
];

// [bed key, name, variety, planted (days from today), expected harvest (days from today), status]
const plants = [
  ['tomato', 'Tomato', 'San Marzano', -140, -20, 'harvested'],
  ['tomato', 'Tomato', 'Sungold cherry', -135, 12, 'growing'],
  ['tomato', 'Basil', 'Genovese', -110, 5, 'growing'],
  ['tomato', 'Pepper', 'Padrón', -120, 21, 'growing'],
  ['herbs', 'Rosemary', 'Tuscan Blue', -300, null, 'growing'],
  ['herbs', 'Thyme', 'English', -280, null, 'growing'],
  ['herbs', 'Mint', 'Moroccan', -250, 30, 'growing'],
  ['roots', 'Carrot', 'Nantes', -70, 18, 'growing'],
  ['roots', 'Beetroot', 'Chioggia', -60, 34, 'planted'],
  ['roots', 'Potato', 'Charlotte', -150, -30, 'harvested'],
  ['greenhouse', 'Lettuce', 'Little Gem', -25, 28, 'planted'],
  ['greenhouse', 'Spinach', 'Bloomsdale', -15, 40, 'planted'],
  ['greenhouse', 'Cucumber', 'Marketmore', -130, -40, 'removed'],
  ['berries', 'Strawberry', 'Mara des Bois', -330, -60, 'harvested'],
  ['berries', 'Raspberry', 'Autumn Bliss', -360, 9, 'growing'],
  [null, 'Garlic', 'Purple Moldovan', 0, 270, 'planted'],
];

// Harvest weights by crop, spread through the right months.
// [plant name, bed key, months ago list, kg range]
const harvestPlan = [
  ['Strawberry', 'berries', [4, 3, 3], [0.8, 2.2]],
  ['Potato', 'roots', [2, 1], [4.5, 9]],
  ['Tomato', 'tomato', [2, 1, 1, 0, 0], [1.5, 4.2]],
  ['Basil', 'tomato', [3, 2, 1, 0], [0.15, 0.4]],
  ['Cucumber', 'greenhouse', [3, 2, 2], [1.2, 3]],
  ['Raspberry', 'berries', [1, 0], [0.6, 1.4]],
  ['Lettuce', 'greenhouse', [11, 10, 9, 8, 6, 5], [0.3, 0.9]],
  ['Spinach', 'greenhouse', [11, 9, 7], [0.25, 0.7]],
  ['Rosemary', 'herbs', [10, 6, 3], [0.05, 0.15]],
  ['Carrot', 'roots', [7, 6, 0], [1.2, 2.8]],
];

// Monthly spending weighted towards spring. [months ago, category, amount range, description]
const expensePlan = [
  [11, 'tools', [18, 35], 'Pruning shears'],
  [10, 'other', [8, 15], 'Garden twine and labels'],
  [9, 'fertilizer', [12, 20], 'Bone meal'],
  [8, 'seeds', [22, 38], 'Seed catalogue order'],
  [7, 'soil', [30, 55], 'Compost delivery'],
  [7, 'seeds', [9, 16], 'Seed potatoes'],
  [6, 'tools', [40, 75], 'Hori-hori knife and trowel'],
  [6, 'soil', [25, 40], 'Potting mix'],
  [6, 'seeds', [12, 20], 'Tomato and pepper seeds'],
  [5, 'water', [35, 60], 'Soaker hose'],
  [5, 'fertilizer', [14, 22], 'Liquid seaweed feed'],
  [5, 'other', [20, 32], 'Netting for berries'],
  [4, 'water', [12, 18], 'Water bill share'],
  [4, 'seeds', [6, 11], 'Basil seedlings'],
  [3, 'water', [14, 20], 'Water bill share'],
  [3, 'fertilizer', [10, 16], 'Tomato feed'],
  [2, 'water', [14, 22], 'Water bill share'],
  [2, 'tools', [15, 28], 'Harvest trug'],
  [1, 'seeds', [8, 14], 'Winter lettuce and spinach seeds'],
  [1, 'soil', [18, 30], 'Mulch'],
  [0, 'seeds', [10, 18], 'Garlic bulbs'],
];

// [title, description, days from today, hour, recurrence, bed key, plant name]
const workPlan = [
  ['Water the greenhouse seedlings', 'Bottom-water the trays; keep the lid cracked.', -6, 8, 'weekly', 'greenhouse', 'Lettuce'],
  ['Pinch out tomato side shoots', null, -1, 18, 'none', 'tomato', 'Tomato'],
  ['Prune tomatoes', 'Take off the lower leaves touching the soil.', 0, 17, 'none', 'tomato', 'Tomato'],
  ['Feed the berry patch', 'Comfrey tea, one can per row.', 1, 9, 'monthly', 'berries', 'Strawberry'],
  ['Thin the carrots', null, 3, 10, 'none', 'roots', 'Carrot'],
  ['Add compost to the Root Row', 'Two barrows from the back heap.', 6, 11, 'none', 'roots', null],
  ['Harvest basil before it bolts', null, 5, 8, 'none', 'tomato', 'Basil'],
  ['Turn the compost heap', null, 2, 16, 'weekly', null, null],
];

async function main() {
  const { rows } = await pool.query(`
    SELECT (SELECT COUNT(*) FROM beds) + (SELECT COUNT(*) FROM plants) + (SELECT COUNT(*) FROM savings)
         + (SELECT COUNT(*) FROM expenses) + (SELECT COUNT(*) FROM harvests) AS n
  `);
  if (rows[0].n > 0 && !args.force) {
    console.log('The garden tables already contain data — nothing was changed.');
    console.log('Run `npm run seed -- --force` to wipe beds, plants, savings, expenses and harvests and re-seed.');
    console.log('(Users are never touched.)');
    return;
  }

  await withTransaction(async (client) => {
    if (args.force) {
      // Postgres won't truncate a table that another table references unless that
      // one goes too: work items and reminder bookkeeping point at beds and plants.
      await client.query(
        `TRUNCATE work_item_reminders_sent, work_item_completions, work_items, harvest_reminders_sent,
                  harvests, expenses, savings, plants, beds RESTART IDENTITY`,
      );
    }

    const bedIds = {};
    for (const bed of beds) {
      const r = await client.query(
        'INSERT INTO beds (name, location, size_sqm, notes) VALUES ($1, $2, $3, $4) RETURNING id',
        [bed.name, bed.location, bed.size_sqm, bed.notes],
      );
      bedIds[bed.key] = r.rows[0].id;
    }

    const plantIds = {};
    for (const [bedKey, name, variety, planted, expected, status] of plants) {
      const r = await client.query(
        `INSERT INTO plants (bed_id, name, variety, planted_date, expected_harvest_date, status)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [bedKey ? bedIds[bedKey] : null, name, variety, daysFromToday(planted),
          expected === null ? null : daysFromToday(expected), status],
      );
      plantIds[name] ??= r.rows[0].id;
    }

    // A regular deposit at the start of each month, plus the odd top-up.
    let savingsCount = 0;
    for (let m = 11; m >= 0; m -= 1) {
      await client.query('INSERT INTO savings (amount, note, saved_on) VALUES ($1, $2, $3)',
        [120, 'Monthly garden fund deposit', monthDate(m, 1)]);
      savingsCount += 1;
      if (rand() < 0.35) {
        await client.query('INSERT INTO savings (amount, note, saved_on) VALUES ($1, $2, $3)',
          [between(20, 60), 'Sold surplus at the plant swap', monthDate(m, 18)]);
        savingsCount += 1;
      }
    }

    for (const [monthsAgo, category, [min, max], description] of expensePlan) {
      const plantId = category === 'seeds' && description.includes('Tomato') ? plantIds.Tomato : null;
      await client.query(
        'INSERT INTO expenses (category, amount, description, plant_id, spent_on) VALUES ($1, $2, $3, $4, $5)',
        [category, between(min, max), description, plantId, monthDate(monthsAgo, 3 + Math.floor(rand() * 22))],
      );
    }

    let harvestCount = 0;
    for (const [crop, bedKey, months, [min, max]] of harvestPlan) {
      for (const monthsAgo of months) {
        await client.query(
          `INSERT INTO harvests (plant_id, bed_id, crop_name, quantity_kg, harvested_on)
           VALUES ($1, $2, $3, $4, $5)`,
          [plantIds[crop] ?? null, bedIds[bedKey], crop, between(min, max),
            monthDate(monthsAgo, 2 + Math.floor(rand() * 24))],
        );
        harvestCount += 1;
      }
    }

    // Shared garden tasks around today, some recurring. Owned by the first user, if any.
    const { rows: [owner] } = await client.query('SELECT MIN(id) AS id FROM users');
    for (const [title, description, days, hour, recurrence, bedKey, plantName] of workPlan) {
      const at = new Date(today.getFullYear(), today.getMonth(), today.getDate() + days, hour);
      await client.query(
        `INSERT INTO work_items (title, description, scheduled_at, recurrence, bed_id, plant_id, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [title, description, at.toISOString(), recurrence, bedKey ? bedIds[bedKey] : null,
          plantName ? plantIds[plantName] ?? null : null, owner.id],
      );
    }

    console.log(`✓ Seeded ${beds.length} beds, ${plants.length} plants, ${savingsCount} deposits, `
      + `${expensePlan.length} expenses, ${harvestCount} harvests and ${workPlan.length} work items.`);
  });
}

main()
  .catch((err) => {
    console.error('Seeding failed:', err.message);
    if (err.code === '42P01') console.error('Tables are missing — run `npm run migrate` first.');
    process.exitCode = 1;
  })
  .finally(() => pool.end());
