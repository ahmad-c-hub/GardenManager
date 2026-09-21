// Create (or reset the password of) a user account from the terminal.
//
//   npm run add-user -- --email you@example.com --name "Your Name" --password "..."
//   npm run add-user -- --email you@example.com --name "Your Name"      (prompts for password)
//   npm run add-user -- --email you@example.com --reset                  (change password)
import { parseArgs } from 'node:util';
import readline from 'node:readline';
import bcrypt from 'bcryptjs';
import { pool } from '../db.js';

const MIN_PASSWORD_LENGTH = 8;

function usage(message) {
  if (message) console.error(`Error: ${message}\n`);
  console.error(
    'Usage:\n' +
      '  npm run add-user -- --email <email> --name "<display name>" [--password "<password>"]\n' +
      '  npm run add-user -- --email <email> --reset [--password "<password>"]\n\n' +
      'If --password is omitted you will be prompted for it (keeps it out of shell history).',
  );
  process.exit(1);
}

/** Prompt without echoing what is typed. */
function promptHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (chunk) => {
      // Only show the prompt itself, never the typed characters.
      if (chunk.includes(question)) process.stdout.write(chunk);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

async function main() {
  let values;
  try {
    ({ values } = parseArgs({
      options: {
        email: { type: 'string' },
        name: { type: 'string' },
        password: { type: 'string' },
        reset: { type: 'boolean', default: false },
      },
    }));
  } catch (err) {
    usage(err.message);
  }

  const email = values.email?.trim().toLowerCase();
  const name = values.name?.trim();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) usage('a valid --email is required.');
  if (!values.reset && !name) usage('--name is required when creating a user.');

  let password = values.password;
  if (password === undefined) {
    password = await promptHidden('Password: ');
    const confirm = await promptHidden('Confirm password: ');
    if (password !== confirm) usage('passwords did not match.');
  }
  if (password.length < MIN_PASSWORD_LENGTH) usage(`password must be at least ${MIN_PASSWORD_LENGTH} characters.`);

  const hash = await bcrypt.hash(password, 12);

  if (values.reset) {
    const { rowCount } = await pool.query(
      'UPDATE users SET password_hash = $1 WHERE lower(email) = lower($2)',
      [hash, email],
    );
    if (rowCount === 0) usage(`no user with email ${email}.`);
    console.log(`✓ Password updated for ${email}`);
    return;
  }

  try {
    const { rows } = await pool.query(
      'INSERT INTO users (email, display_name, password_hash) VALUES ($1, $2, $3) RETURNING id',
      [email, name, hash],
    );
    console.log(`✓ Created user #${rows[0].id}: ${name} <${email}>`);
  } catch (err) {
    if (err.code === '23505') usage(`a user with email ${email} already exists (use --reset to change the password).`);
    if (err.code === '42P01') usage('the users table does not exist yet — run `npm run migrate` first.');
    throw err;
  }
}

main()
  .catch((err) => {
    console.error('Failed to add user:', err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
