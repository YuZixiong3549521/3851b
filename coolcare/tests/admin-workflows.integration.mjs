import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import mysql from 'mysql2/promise';
import {
  approveBooking,
  rejectBooking,
  editRejectionReason,
  getAdminBooking,
  dispatchBooking,
  listDispatchOptions,
} from '../server/admin-operations.mjs';
import { expireSubmittedBookings } from '../server/order-expiry.mjs';

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  dateStrings: true,
  decimalNumbers: true,
  connectionLimit: 3,
});
after(() => pool.end());
async function fixture(run) {
  const c = await pool.getConnection();
  await c.beginTransaction();
  const nested = {
    execute: c.execute.bind(c),
    query: c.query.bind(c),
    beginTransaction: () => c.query('SAVEPOINT admin_workflow'),
    commit: () => c.query('RELEASE SAVEPOINT admin_workflow'),
    rollback: () => c.query('ROLLBACK TO SAVEPOINT admin_workflow'),
    release: () => {},
  };
  const db = {
    execute: c.execute.bind(c),
    query: c.query.bind(c),
    getConnection: async () => nested,
  };
  try {
    const [[actor]] = await c.execute(
      "SELECT u.user_id AS userId FROM user_account u JOIN admin_profile a ON a.user_id=u.user_id WHERE u.status='Active' LIMIT 1",
    );
    const [[customer]] = await c.execute(
      'SELECT customer_id FROM customer ORDER BY customer_id LIMIT 1',
    );
    const [[service]] = await c.execute(
      "SELECT service_id FROM simple_service_catalog WHERE code='cleaning'",
    );
    assert.ok(actor && customer && service);
    const [address] = await c.execute(
      "INSERT INTO service_address(customer_id,address_line,postal_code) VALUES (?,?,'238839')",
      [customer.customer_id, 'Admin workflow ' + randomUUID()],
    );
    const create = async (status = 'Submitted', expiry = null) => {
      const [result] = await c.execute(
        `INSERT INTO booking(customer_id,address_id,service_id,preferred_service_date,preferred_time_slot,slot_start,slot_end,booking_status,total_amount,expires_at)
        VALUES (?,?,?,'2091-01-08','09:00 - 11:00','09:00:00','11:00:00',?,50,?)`,
        [
          customer.customer_id,
          address.insertId,
          service.service_id,
          status,
          expiry,
        ],
      );
      return result.insertId;
    };
    await run({ c, db, actor, create });
  } finally {
    await c.rollback();
    c.release();
  }
}

test('expired unconfirmed requests cannot be approved; expiry is audited once and preserves legacy/confirmed bookings', () =>
  fixture(async ({ c, db, actor, create }) => {
    const expired = await create('Submitted', '2000-01-01 00:00:00'),
      legacy = await create(),
      confirmed = await create('Confirmed', '2000-01-01 00:00:00');
    await assert.rejects(
      approveBooking(db, actor, expired, { requestId: randomUUID() }),
      (error) => error.status === 409 && /expired/.test(error.message),
    );
    await expireSubmittedBookings(db);
    await expireSubmittedBookings(db);
    const [states] = await c.execute(
      'SELECT booking_id,booking_status FROM booking WHERE booking_id IN (?,?,?) ORDER BY booking_id',
      [expired, legacy, confirmed],
    );
    assert.deepEqual(
      states.map((row) => row.booking_status),
      ['Expired', 'Submitted', 'Confirmed'],
    );
    const [[history]] = await c.execute(
      "SELECT COUNT(*) AS count FROM booking_status_history WHERE booking_id=? AND new_status='Expired'",
      [expired],
    );
    assert.equal(Number(history.count), 1);
  }));

test('rejection corrections enforce versioning, replay the same request and retain the original audit', () =>
  fixture(async ({ c, db, actor, create }) => {
    const id = await create();
    await rejectBooking(db, actor, id, {
      requestId: randomUUID(),
      reason: 'The requested service is unavailable.',
    });
    const change = {
      requestId: randomUUID(),
      version: 1,
      reason:
        'The requested date has no suitable technician. Please select another weekday.',
    };
    const result = await editRejectionReason(db, actor, id, change);
    assert.equal(result.version, 2);
    assert.equal(
      (await editRejectionReason(db, actor, id, change)).replayed,
      true,
    );
    await assert.rejects(
      editRejectionReason(db, actor, id, {
        ...change,
        requestId: randomUUID(),
        reason: 'A concurrent change.',
      }),
      (error) => error.status === 409,
    );
    const detail = await getAdminBooking(db, id);
    assert.equal(detail.rejectionReason, change.reason);
    assert.equal(detail.timeline.length, 2);
    assert.equal(
      detail.timeline[0].note,
      'The requested service is unavailable.',
    );
  }));

test('geographic dispatch uses an available same-area technician, then rejects that technician for an overlap', () =>
  fixture(async ({ c, db, actor, create }) => {
    const [techs] =
      await c.execute(`SELECT t.technician_id AS id FROM technician t JOIN user_account u ON u.user_id=t.user_id
    WHERE u.status='Active' AND t.availability_status NOT IN ('Unavailable','On Leave') ORDER BY t.technician_id`);
    assert.ok(techs.length >= 2);
    await c.execute('UPDATE technician SET base_postal_code=NULL');
    const preferred = techs[techs.length - 1].id;
    await c.execute(
      "UPDATE technician SET base_postal_code='238830' WHERE technician_id=?",
      [preferred],
    );
    const first = await create('Confirmed'),
      second = await create('Confirmed');
    const options = await listDispatchOptions(db, first);
    assert.equal(options.technicians[0].technicianId, preferred);
    assert.equal(options.technicians[0].proximity.label, 'Same postal sector');
    const assigned = await dispatchBooking(db, actor, first, {
      requestId: randomUUID(),
    });
    assert.equal(assigned.technician.technicianId, preferred);
    const nextOptions = await listDispatchOptions(db, second);
    assert.equal(
      nextOptions.technicians.find((row) => row.technicianId === preferred)
        .eligible,
      false,
    );
    const next = await dispatchBooking(db, actor, second, {
      requestId: randomUUID(),
    });
    assert.notEqual(next.technician.technicianId, preferred);
  }));
