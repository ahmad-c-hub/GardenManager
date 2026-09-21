import pg from 'pg';

const { Pool, types } = pg;

// Return DATE columns as plain 'YYYY-MM-DD' strings instead of JS Dates,
// so a date never shifts by a day because of the server's timezone.
types.setTypeParser(1082, (value) => value);
// NUMERIC -> number. Amounts here are well within float precision.
types.setTypeParser(1700, (value) => (value === null ? null : Number(value)));
// COUNT(*) / BIGINT -> number.
types.setTypeParser(20, (value) => (value === null ? null : Number(value)));

function buildConnectionString(raw) {
  if (!raw) {
    throw new Error('DATABASE_URL is not set. Add it to the .env file in the project root.');
  }
  // TLS is configured explicitly below, so drop sslmode from the URL to keep
  // pg from overriding (and warning about) those settings.
  let url;
  try {
    url = new URL(raw);
  } catch {
    // Deliberately not echoing the value: it contains the password.
    throw new Error('DATABASE_URL is not a valid postgres:// connection URL.');
  }
  url.searchParams.delete('sslmode');
  return url.toString();
}

export const pool = new Pool({
  connectionString: buildConnectionString(process.env.DATABASE_URL),
  // Neon requires TLS (sslmode=require); its certificates are publicly trusted, so verify them.
  ssl: { rejectUnauthorized: true },
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

pool.on('error', (err) => {
  // An idle client errored (e.g. Neon suspended the compute). The pool discards it.
  console.error('Postgres pool error:', err.message);
});

export function query(text, params) {
  return pool.query(text, params);
}

/** Run `fn(client)` inside a transaction; rolls back if it throws. */
export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
