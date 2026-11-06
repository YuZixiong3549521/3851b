import mysql from 'mysql2/promise';
import { format, escapeId } from 'mysql2';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const allowed = new Set(`admin_plan_reminder admin_review_follow_up_event admin_review_follow_up reward_activity assignment_member visit_member performance_operation performance_feedback performance_quality performance_visit annual_renewal_bonus annual_plan_notice annual_plan_renewal commerce_payment commerce_operation reward_adjustment_audit reward_reservation reward_booking_earning booking_completion_reward booking_admin_operation technician_work_operation service_report_revision report_signature service_photo_upload return_visit_operation service_visit_record service_progress_event service_progress customer_booking_notice assistant_booking_draft work_order_cleaning_assessment_revision work_order_cleaning_assessment inventory_transaction_revision inventory_web_operation inventory_transaction photo technician_performance_score service_report work_order assignment booking_email_outbox web_booking_details booking_service booking_package annual_booking_visit booking_aircon_unit booking_promotion booking_change_request booking_status_history loyalty_transaction booking booking_customer_edit web_legacy_import`.split(' '));
// These need explicit stock/balance/plan reconciliation rather than blind row removal.
const reconcile = new Set(`inventory_transaction commerce_payment reward_reservation reward_booking_earning booking_completion_reward reward_activity loyalty_transaction annual_booking_visit`.split(' '));
const targetSql = `SELECT b.* FROM booking b
 JOIN customer c ON c.customer_id=b.customer_id
 JOIN user_account u ON u.user_id=c.user_id
 WHERE REGEXP_LIKE(u.full_name, '^DEMO Customer [0-9]+$', 'c')
 AND REGEXP_LIKE(u.email, '^customer[0-9]+@cc-demo-20261104[.]invalid$', 'c')
 ORDER BY b.booking_id FOR UPDATE`;
const hash = rows => createHash('sha256').update(JSON.stringify(rows)).digest('hex');
const key = (row, columns) => JSON.stringify(columns.map(column => row[column]));
const valueKey = value => value == null ? null : String(value);

export function deletionOrder(names, edges) {
  const pending = new Set(names), order = [];
  while (pending.size) {
    const table = [...pending].find(parent => !edges.some(e => e.parent === parent && pending.has(e.child)));
    if (!table) throw new Error('Cyclic foreign keys: no data was deleted.');
    order.push(table); pending.delete(table);
  }
  return order;
}

export async function cleanupDemoOrders(db, { apply = false, backupDirectory = '/home/demo-order-backups',
  expectedDatabase = 'coolcare_service_app' } = {}) {
  let transaction = false;
  try {
    await db.query("SET time_zone='+00:00'");
    await db.query('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE');
    await db.beginTransaction(); transaction = true;
    const [lock] = await db.query("SELECT GET_LOCK('coolcare-demo-cleanup-20261104', 0) AS acquired");
    if (Number(lock[0].acquired) !== 1) throw new Error('Another cleanup is running.');
    const [[identity]] = await db.query('SELECT DATABASE() AS name');
    if (identity.name !== expectedDatabase || (expectedDatabase !== 'coolcare_service_app' && !/^codex_cleanup_test_[a-f0-9]+$/.test(expectedDatabase)))
      throw new Error('Unexpected database; cleanup stopped.');
    const [bookings] = await db.query(targetSql);
    if (!bookings.length) {
      await db.rollback(); transaction = false;
      return { deleted: 0, message: 'No matching demo orders remain.' };
    }
    if (bookings.length !== 300 || new Set(bookings.map(b => String(b.customer_id))).size !== 60)
      throw new Error(`Expected exactly 300 orders / 60 demo customers; found ${bookings.length} orders. No data was deleted.`);
    const ids = bookings.map(b => b.booking_id);
    const [retainedBefore] = await db.query('SELECT * FROM booking WHERE booking_id NOT IN (?) ORDER BY booking_id FOR SHARE', [ids]);
    const [pkRows] = await db.query(`SELECT TABLE_NAME AS t,COLUMN_NAME AS c FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA=DATABASE() AND CONSTRAINT_NAME='PRIMARY' ORDER BY TABLE_NAME,ORDINAL_POSITION`);
    const primary = new Map();
    for (const { t, c } of pkRows) { if (!primary.has(t)) primary.set(t, []); primary.get(t).push(c); }
    const [fkRows] = await db.query(`SELECT CONSTRAINT_NAME AS n,TABLE_NAME AS child,COLUMN_NAME AS columnName,
      REFERENCED_TABLE_NAME AS parent,REFERENCED_COLUMN_NAME AS parentColumn,
      REFERENCED_TABLE_SCHEMA AS parentSchema FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA=DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL`);
    const selected = new Map([['booking', new Map(bookings.map(b => [key(b, primary.get('booking')), b]))]]);
    // Follow only actual foreign keys away from the 300 locked root orders.
    for (let round = 0; ; round++) {
      if (round > 100) throw new Error('Unexpected dependency graph; cleanup stopped.');
      let added = false;
      for (const e of fkRows) {
        if (!selected.has(e.parent) || e.parentSchema !== identity.name) continue;
        if (!allowed.has(e.child) || !primary.has(e.child)) throw new Error(`Unreviewed dependency: ${e.child}. No data was deleted.`);
        if (fkRows.filter(f => f.child === e.child && f.n === e.n).length !== 1)
          throw new Error(`Composite foreign key in ${e.child}; cleanup stopped.`);
        const values = [...new Set([...selected.get(e.parent).values()].map(r => r[e.parentColumn]).filter(v => v != null))];
        if (!values.length) continue;
        const [rows] = await db.query(`SELECT * FROM ${escapeId(e.child)} WHERE ${escapeId(e.columnName)} IN (?) FOR UPDATE`, [values]);
        if (!rows.length) continue;
        if (reconcile.has(e.child)) throw new Error(`Found ${rows.length} linked ${e.child} rows requiring reconciliation. No data was deleted.`);
        if (!selected.has(e.child)) selected.set(e.child, new Map());
        const destination = selected.get(e.child);
        for (const row of rows) {
          const id = key(row, primary.get(e.child));
          if (!destination.has(id)) { destination.set(id, row); added = true; }
        }
      }
      if ([...selected.values()].reduce((n, rows) => n + rows.size, 0) > 20000) throw new Error('Unexpected cleanup size.');
      if (!added) break;
    }
    const edges = fkRows.filter(e => selected.has(e.child) && selected.has(e.parent));
    // Never delete a dependent row shared with a retained order/report/assignment.
    for (const e of edges) {
      const parentValues = new Set([...selected.get(e.parent).values()].map(row => valueKey(row[e.parentColumn])));
      for (const row of selected.get(e.child).values()) {
        if (row[e.columnName] != null && !parentValues.has(valueKey(row[e.columnName])))
          throw new Error(`Shared retained relationship in ${e.child}; no data was deleted.`);
      }
    }
    const order = deletionOrder([...selected.keys()], edges);
    const [triggers] = await db.query('SELECT EVENT_OBJECT_TABLE AS t FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE()');
    if (triggers.some(row => selected.has(row.t))) throw new Error('Review database triggers before cleanup.');
    const counts = Object.fromEntries(order.map(table => [table, selected.get(table).size]));
    if (!apply) {
      await db.rollback(); transaction = false;
      return { mode: 'preview', orders: 300, retainedOrders: retainedBefore.length, rows: counts };
    }
    const [columnRows] = await db.query(`SELECT TABLE_NAME AS t,COLUMN_NAME AS c,EXTRA AS extra FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME,ORDINAL_POSITION`);
    const sql = ["SET NAMES utf8mb4;", "SET time_zone='+00:00';", 'START TRANSACTION;'];
    for (const table of [...order].reverse()) {
      const columns = columnRows.filter(c => c.t === table && !/VIRTUAL GENERATED|STORED GENERATED/i.test(c.extra)).map(c => c.c);
      const rows = [...selected.get(table).values()].map(row => columns.map(c => {
        const v = row[c]; return v && typeof v === 'object' && !Buffer.isBuffer(v) ? JSON.stringify(v) : v;
      }));
      sql.push(format(`INSERT INTO ${escapeId(table)} (${columns.map(escapeId).join(',')}) VALUES ?;`, [rows]));
    }
    sql.push('COMMIT;');
    await mkdir(backupDirectory, { recursive: true, mode: 0o700 });
    const backup = join(backupDirectory, `demo-20261104-${Date.now()}.sql`);
    await writeFile(backup, sql.join('\n'), { flag: 'wx', mode: 0o600 });
    for (const table of order) {
      const columns = primary.get(table);
      const tuples = [...selected.get(table).values()].map(row => columns.map(c => row[c]));
      const placeholders = tuples.map(() => `(${columns.map(() => '?').join(',')})`).join(',');
      const [result] = await db.query(`DELETE FROM ${escapeId(table)} WHERE (${columns.map(escapeId).join(',')}) IN (${placeholders})`, tuples.flat());
      if (result.affectedRows !== tuples.length) throw new Error(`Unexpected deleted row count in ${table}.`);
    }
    const [retainedAfter] = await db.query('SELECT * FROM booking ORDER BY booking_id FOR SHARE');
    if (hash(retainedAfter) !== hash(retainedBefore)) throw new Error('Retained orders changed; rolling back.');
    const [remaining] = await db.query(targetSql);
    if (remaining.length) throw new Error('Demo orders remain; rolling back.');
    await db.commit(); transaction = false;
    return { deleted: 300, remainingDemoOrders: 0, retainedOrders: retainedAfter.length, backup, rows: counts };
  } catch (error) {
    if (transaction) await db.rollback();
    throw error;
  } finally {
    await db.query("SELECT RELEASE_LOCK('coolcare-demo-cleanup-20261104')").catch(() => {});
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  let db;
  try {
    if (process.env.DB_HOST !== 'coolcare-db-3851.mysql.database.azure.com') throw new Error('Expected the confirmed Azure database host.');
    db = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
      user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
      ssl: { rejectUnauthorized: true, ...(process.env.DB_SSL_CA ? { ca: process.env.DB_SSL_CA } : {}) },
      dateStrings: true, supportBigNumbers: true, bigNumberStrings: true, connectTimeout: 10000 });
    console.log(JSON.stringify(await cleanupDemoOrders(db, { apply: process.argv.includes('--apply') }), null, 2));
  } catch (error) {
    console.error('CLEANUP STOPPED:', error.code || error.message); process.exitCode = 1;
  } finally { if (db) await db.end(); }
}
