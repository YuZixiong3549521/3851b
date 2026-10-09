import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import { sampleDataDeletionOrder, sampleDataTables } from '../scripts/sample-data-schema.mjs';

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});
after(() => pool.end());

test('sample-data replacement covers every foreign-key child of its business tables', async () => {
  const [tables] = await pool.execute(
    `SELECT TABLE_NAME name FROM information_schema.TABLES
     WHERE TABLE_SCHEMA=? AND TABLE_TYPE='BASE TABLE'`,
    [process.env.DB_NAME],
  );
  const available = new Set(tables.map(row => row.name));
  assert.deepEqual(sampleDataTables.filter(table => !available.has(table)), []);
  const [edges] = await pool.execute(
    `SELECT TABLE_NAME child, REFERENCED_TABLE_NAME parent
     FROM information_schema.KEY_COLUMN_USAGE
     WHERE TABLE_SCHEMA=? AND REFERENCED_TABLE_NAME IS NOT NULL`,
    [process.env.DB_NAME],
  );
  const order = sampleDataDeletionOrder(edges);
  assert.equal(order.length, sampleDataTables.length);
  assert.equal(new Set(order).size, sampleDataTables.length);
});
