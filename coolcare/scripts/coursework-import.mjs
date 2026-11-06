import { createHash } from 'node:crypto';
import { isCalendarDate, singaporeToday } from '../server/customer/booking-schedule.mjs';
import { appendCourseworkData, buildCourseworkPlan } from '../database/coursework-data.mjs';

export const COURSEWORK_DATASET_VERSION = 1;
const lockName = 'coolcare-coursework-import';
const digest = value => createHash('sha256').update(value).digest('hex');
const decode = value => typeof value === 'string' ? JSON.parse(value) : value;

export function validateCourseworkOptions({ batchKey, asOf } = {}) {
  if (typeof batchKey !== 'string' || !/^[a-z0-9][a-z0-9-]{2,59}$/.test(batchKey))
    throw new Error('Use a batch key of 3–60 lowercase letters, numbers or hyphens.');
  if (asOf !== undefined && (!isCalendarDate(asOf) || asOf < '2003-01-01' || asOf > '2090-12-31'))
    throw new Error('Use a valid --as-of date between 2003 and 2090.');
  return { batchKey, asOf };
}

export function courseworkRequestId(batchKey) {
  validateCourseworkOptions({ batchKey });
  const h = digest(`coolcare:coursework-import:${batchKey}`);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

async function readReceipt(connection, batchKey) {
  const [[row]] = await connection.execute('SELECT result_json FROM commerce_operation WHERE request_id=?', [courseworkRequestId(batchKey)]);
  if (!row) return null;
  const receipt = decode(row.result_json);
  if (receipt?.dataset !== 'CoolCare synthetic coursework data' || receipt.batchKey !== batchKey || receipt.datasetVersion !== COURSEWORK_DATASET_VERSION)
    throw new Error('This batch key has an incompatible import receipt. No data was changed.');
  return receipt;
}

export async function inspectCourseworkImport(connection, { batchKey, asOf } = {}) {
  validateCourseworkOptions({ batchKey, asOf });
  const existing = await readReceipt(connection, batchKey);
  const [[database]] = await connection.query('SELECT DATABASE() AS name');
  const counts = {};
  for (const table of ['booking', 'customer', 'technician', 'annual_booking_series', 'service_report', 'performance_feedback', 'inventory_transaction', 'booking_email_outbox']) {
    const [[row]] = await connection.query('SELECT COUNT(*) AS n FROM ??', [table]);
    counts[table] = Number(row.n);
  }
  return {
    database: database.name, batchKey, existingCounts: counts,
    alreadyImported: Boolean(existing), importedBatch: existing,
    plan: existing ? null : buildCourseworkPlan({ batchKey, asOf: asOf ?? singaporeToday() }),
  };
}

// No CLI side effects: integration tests use an outer transaction/savepoints.
// A single connection owns the advisory lock, transaction and durable receipt.
export async function runCourseworkImport(connection, { batchKey, asOf, actorUserId, dryRun = true } = {}) {
  validateCourseworkOptions({ batchKey, asOf });
  let locked = false, inTransaction = false;
  try {
    const [[lock]] = await connection.query('SELECT GET_LOCK(?,10) AS acquired', [lockName]);
    if (Number(lock.acquired) !== 1) throw new Error('Another coursework import is running. Try again later.');
    locked = true;
    await connection.beginTransaction();
    inTransaction = true;
    const existing = await readReceipt(connection, batchKey);
    if (existing) {
      if (asOf !== undefined && asOf !== existing.asOf)
        throw new Error('This batch was already imported with a different as-of date. Keep its original date or omit --as-of.');
      await connection.rollback();
      inTransaction = false;
      return { ...existing, alreadyImported: true, dryRun: false };
    }
    const [[actor]] = await connection.execute(
      `SELECT a.user_id FROM admin_profile a JOIN user_account u ON u.user_id=a.user_id
       JOIN role r ON r.role_id=u.role_id
       WHERE u.status='Active' AND r.role_name='Admin' AND ${actorUserId === undefined ? "a.access_level='Owner'" : 'a.user_id=?'}
       ORDER BY a.user_id LIMIT 1 FOR SHARE`, actorUserId === undefined ? [] : [actorUserId]);
    if (!actor) throw new Error('An existing active administrator is required to record this import.');
    const effectiveDate = asOf ?? singaporeToday();
    const requestId = courseworkRequestId(batchKey);
    const result = await appendCourseworkData(connection, { batchKey, asOf: effectiveDate, actorUserId: actor.user_id, requestId });
    const receipt = {
      ...result, dataset: 'CoolCare synthetic coursework data', datasetVersion: COURSEWORK_DATASET_VERSION,
      batchKey, asOf: effectiveDate, requestId, importedAt: new Date().toISOString(),
    };
    await connection.execute('INSERT INTO commerce_operation(request_id,actor_user_id,payload_hash,result_json) VALUES (?,?,?,?)',
      [requestId, actor.user_id, digest(JSON.stringify({ datasetVersion: COURSEWORK_DATASET_VERSION, batchKey, asOf: effectiveDate })), JSON.stringify(receipt)]);
    if (dryRun) await connection.rollback();
    else await connection.commit();
    inTransaction = false;
    return { ...receipt, alreadyImported: false, dryRun };
  } catch (error) {
    if (inTransaction) await connection.rollback();
    throw error;
  } finally {
    if (locked) await connection.query('SELECT RELEASE_LOCK(?)', [lockName]);
  }
}
