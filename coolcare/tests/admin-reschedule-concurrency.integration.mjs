import { test } from 'node:test';
import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import { randomUUID } from 'node:crypto';
import { rescheduleAdminBooking } from '../server/admin-operations.mjs';

test('admin rescheduling sees a cleaning booking committed while waiting for the customer lock', async () => {
  const config = {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: 'root',
    password: process.env.MYSQL_ROOT_PASSWORD,
    database: process.env.DB_NAME,
    dateStrings: true,
    decimalNumbers: true,
  };
  const setup = await mysql.createConnection(config),
    holder = await mysql.createConnection(config),
    admin = await mysql.createConnection(config);
  let addressId, bookingId, competingId, operation;
  let releaseWait;
  const customerLockAttempt = new Promise((resolve) => {
    releaseWait = resolve;
  });
  try {
    const [[customer]] = await setup.execute(
      'SELECT customer_id FROM customer ORDER BY customer_id LIMIT 1',
    );
    const [[actor]] = await setup.execute(
      "SELECT u.user_id AS userId FROM user_account u JOIN admin_profile p ON p.user_id=u.user_id WHERE u.status='Active' LIMIT 1",
    );
    const [[service]] = await setup.execute(
      "SELECT service_id FROM simple_service_catalog WHERE code='cleaning'",
    );
    const line = 'Admin reschedule concurrency ' + randomUUID();
    const [address] = await setup.execute(
      "INSERT INTO service_address(customer_id,address_line,postal_code) VALUES (?,?,'238839')",
      [customer.customer_id, line],
    );
    addressId = address.insertId;
    const insert = (connection, date) =>
      connection.execute(
        `INSERT INTO booking(customer_id,address_id,service_id,preferred_service_date,preferred_time_slot,slot_start,slot_end,booking_status,total_amount)
      VALUES (?,?,?,?,'09:00 - 11:00','09:00:00','11:00:00','Submitted',50)`,
        [customer.customer_id, addressId, service.service_id, date],
      );
    const [initial] = await insert(setup, '2091-01-01');
    bookingId = initial.insertId;
    await holder.beginTransaction();
    await holder.execute(
      'SELECT customer_id FROM customer WHERE customer_id=? FOR UPDATE',
      [customer.customer_id],
    );
    const handle = {
      execute: async (sql, args) => {
        if (
          sql.includes('SELECT customer_id AS customerId') &&
          sql.includes('FOR UPDATE')
        )
          releaseWait();
        return admin.execute(sql, args);
      },
      query: admin.query.bind(admin),
      beginTransaction: admin.beginTransaction.bind(admin),
      commit: admin.commit.bind(admin),
      rollback: admin.rollback.bind(admin),
      release: () => {},
    };
    operation = rescheduleAdminBooking(
      { getConnection: async () => handle },
      actor,
      bookingId,
      {
        requestId: randomUUID(),
        preferredDate: '2091-01-08',
        timeSlot: '09:00 - 11:00',
      },
    );
    // Attach the rejection assertion immediately, before releasing the competing transaction.
    const rejected = assert.rejects(
      operation,
      (error) => error.status === 409 && /calendar week/.test(error.message),
    );
    const timer = setTimeout(() => releaseWait(), 3000);
    await customerLockAttempt;
    clearTimeout(timer);
    const [competing] = await insert(holder, '2091-01-08');
    competingId = competing.insertId;
    await holder.commit();
    await rejected;
    const [[unchanged]] = await setup.execute(
      'SELECT preferred_service_date FROM booking WHERE booking_id=?',
      [bookingId],
    );
    assert.equal(unchanged.preferred_service_date, '2091-01-01');
  } finally {
    await holder.rollback();
    await admin.rollback();
    if (operation) await operation.catch(() => {});
    for (const id of [competingId, bookingId].filter(Boolean)) {
      await setup.execute(
        'DELETE FROM booking_admin_operation WHERE booking_id=?',
        [id],
      );
      await setup.execute(
        'DELETE FROM booking_change_request WHERE booking_id=?',
        [id],
      );
      await setup.execute(
        'DELETE FROM booking_status_history WHERE booking_id=?',
        [id],
      );
      await setup.execute('DELETE FROM booking WHERE booking_id=?', [id]);
    }
    if (addressId)
      await setup.execute('DELETE FROM service_address WHERE address_id=?', [
        addressId,
      ]);
    await Promise.all([setup.end(), holder.end(), admin.end()]);
  }
});
