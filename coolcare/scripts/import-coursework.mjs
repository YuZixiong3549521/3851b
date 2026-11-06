import mysql from 'mysql2/promise';
import { inspectCourseworkImport, runCourseworkImport, validateCourseworkOptions } from './coursework-import.mjs';

const help = `Append 50 connected synthetic coursework bookings without replacing existing data.

Uses DB_* environment variables already configured on the running application.
Does not load .env.local automatically, migrate schema, send email or start at deployment.

npm run db:coursework -- --plan --batch=coursework-2026-11-v1
npm run db:coursework -- --dry-run --batch=coursework-2026-11-v1 --as-of=2026-11-06
npm run db:coursework -- --apply --batch=coursework-2026-11-v1 --as-of=2026-11-06 --database=<existing database name>

--plan (default): read current counts and preview the scenario plan.
--dry-run: insert and validate inside a rolled-back transaction; IDs may advance.
--apply: commit once; the same batch key replays its original receipt.
--database: required for --apply and must match DB_NAME exactly.
--as-of: Singapore date; omitted means today for a new batch.
Local use: node --env-file=.env.local scripts/import-coursework.mjs <options>
`;

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) { console.log(help); return; }
  const options = { batchKey: 'coursework-2026-11-v1' };
  let mode;
  const seen = new Set();
  for (const argument of args) {
    const key = argument.split('=')[0];
    if (seen.has(key)) throw new Error(`Repeated option: ${key}`);
    seen.add(key);
    if (['--plan', '--dry-run', '--apply'].includes(argument)) {
      if (mode) throw new Error('Choose only one of --plan, --dry-run or --apply.');
      mode = argument;
    } else if (argument.startsWith('--batch=')) options.batchKey = argument.slice(8);
    else if (argument.startsWith('--as-of=')) options.asOf = argument.slice(8);
    else if (argument.startsWith('--database=')) options.database = argument.slice(11);
    else throw new Error(`Unknown option: ${key}. Use --help.`);
  }
  mode ??= '--plan';
  validateCourseworkOptions(options);
  for (const name of ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'])
    if (!process.env[name]) throw new Error(`Missing ${name}. Run in the Azure application environment or pass a local --env-file to node.`);
  if (mode === '--apply' && options.database !== process.env.DB_NAME)
    throw new Error('--apply requires --database to exactly match DB_NAME. Run --plan to review the target first.');
  if (process.env.DB_SSL !== undefined && !['true', 'false'].includes(process.env.DB_SSL))
    throw new Error('DB_SSL must be true or false.');
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
    dateStrings: true, decimalNumbers: true, timezone: 'Z', connectTimeout: 10000,
    ...(process.env.DB_SSL === 'true' ? { ssl: { rejectUnauthorized: true,
      ...(process.env.DB_SSL_CA ? { ca: process.env.DB_SSL_CA } : {}) } } : {}),
  });
  try {
    await connection.query("SET time_zone='+00:00'");
    const result = mode === '--plan' ? await inspectCourseworkImport(connection, options)
      : await runCourseworkImport(connection, { ...options, dryRun: mode === '--dry-run' });
    console.log(JSON.stringify(result, null, 2));
  } finally { await connection.end(); }
}

main().catch(error => {
  // Database diagnostics can contain hostnames, SQL parameters or credentials.
  // Only deliberately authored configuration messages and bounded driver codes are printed.
  const code = String(error.code || '').replace(/[^A-Z0-9_]/gi, '').slice(0, 80);
  const deniedTable = error.sqlMessage?.match(/for table ['`]([a-z_]+)['`]/i)?.[1];
  if (code === 'ER_TABLEACCESS_DENIED_ERROR' && deniedTable)
    console.error(`Coursework import rolled back: the database account lacks import permissions on ${deniedTable}. Use an authorized database operator connection for this one-time import; do not broaden the website account's permissions.`);
  else console.error(code ? `Coursework import failed (${code}). No partial import was committed. Check schema, connectivity and permissions.` : error.message);
  process.exitCode = 1;
});
