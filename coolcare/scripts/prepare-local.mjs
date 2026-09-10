import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const dir = resolve(import.meta.dirname, '..');
const config = resolve(dir, '.env.local');
mkdirSync(resolve(dir, '.local'), { recursive: true });
if (!existsSync(config)) {
  const suffix = randomBytes(4).toString('hex');
  writeFileSync(
    config,
    `DB_HOST=127.0.0.1\nDB_PORT=3306\nDB_NAME=coolcare_service_app\nDB_USER=cc_inventory_${suffix}\nDB_PASSWORD=${randomBytes(32).toString('hex')}\nSESSION_SECRET=${randomBytes(48).toString('hex')}\nAPI_PORT=3001\nWEB_ORIGIN=http://localhost:3000\nLOW_STOCK_THRESHOLD=15\n`,
    { flag: 'wx', mode: 0o600 },
  );
}
const env = Object.fromEntries(
  readFileSync(config, 'utf8')
    .trim()
    .split(/\r?\n/)
    .map((line) => line.split(/=(.*)/s).slice(0, 2)),
);
if (
  !/^cc_inventory_[a-f0-9]{8}$/.test(env.DB_USER) ||
  !/^[a-f0-9]{64}$/.test(env.DB_PASSWORD)
)
  throw new Error(
    'Existing configuration is customized; it has not been changed.',
  );
const user = `'${env.DB_USER}'@'localhost'`;
const grants = [
  ['part', 'SELECT, INSERT, UPDATE'],
  ['inventory_transaction', 'SELECT, INSERT'],
  ['inventory_web_operation', 'SELECT, INSERT'],
  ['user_account', 'SELECT'],
  ['role', 'SELECT'],
  ['admin_profile', 'SELECT'],
  ['work_order', 'SELECT'],
]
  .map(
    ([table, privileges]) =>
      `GRANT ${privileges} ON coolcare_service_app.${table} TO ${user};`,
  )
  .join('\n');
writeFileSync(
  resolve(dir, '.local/setup-mysql.sql'),
  `-- Local web setup. No existing data is deleted or reset.\nUSE coolcare_service_app;\nCREATE TABLE IF NOT EXISTS inventory_web_operation (\n request_id CHAR(36) PRIMARY KEY,\n payload_hash CHAR(64) NOT NULL,\n transaction_id INT UNSIGNED NOT NULL UNIQUE,\n stock_before INT NOT NULL,\n stock_delta INT NOT NULL,\n stock_after INT NOT NULL,\n CONSTRAINT fk_web_operation_transaction FOREIGN KEY (transaction_id) REFERENCES inventory_transaction(transaction_id),\n CONSTRAINT chk_web_operation_stock CHECK (stock_before >= 0 AND stock_after >= 0 AND stock_delta <> 0 AND stock_after = stock_before + stock_delta)\n) ENGINE=InnoDB;\nCREATE USER IF NOT EXISTS ${user} IDENTIFIED BY '${env.DB_PASSWORD}';\n${grants}\nSELECT 'CoolCare inventory web connection is ready' AS result;\n`,
  { mode: 0o600 },
);
console.log('Local-only settings and SQL are prepared. No passwords printed.');
console.log(
  `SOURCE ${resolve(dir, '.local/setup-mysql.sql').replaceAll('\\', '/')};`,
);
