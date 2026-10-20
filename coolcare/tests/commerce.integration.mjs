import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import { createApp } from '../server/app.mjs';
import { changePublicBooking } from '../server/public-site.mjs';
import { rejectBooking } from '../server/admin-operations.mjs';
import { expireSubmittedBookings } from '../server/order-expiry.mjs';
import { addCalendarDays } from '../server/customer/booking-schedule.mjs';
import { recordPayment, reserveReward, releaseBookingRewardReservation, adjustReward, updateRewardRule, rewardsSummary, commerceReport, listPaymentBookings } from '../server/commerce.mjs';

const pool = mysql.createPool({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT), user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME, dateStrings: true, connectionLimit: 5 });
const cleanupPool = mysql.createPool({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT), user: 'root', password: process.env.MYSQL_ROOT_PASSWORD, database: process.env.DB_NAME, dateStrings: true });
after(async () => { await pool.end(); await cleanupPool.end(); });
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const receipt = (amount, extra = {}) => ({ requestId: randomUUID(), kind: 'Receipt', amount, method: 'PayNow', receivedDate: today(), notes: 'Synthetic isolated settlement test.', ...extra });

async function makeFixture(c) {
  const [[role]] = await c.query("SELECT role_id FROM role WHERE role_name='Customer'");
  const [[admin]] = await c.query("SELECT user_id FROM admin_profile LIMIT 1");
  const [[service]] = await c.query('SELECT service_id FROM simple_service_catalog ORDER BY service_id LIMIT 1');
  const email = `commerce-${randomUUID()}@coolcare.test`, password = 'CommerceTest2026!';
  const [u] = await c.execute('INSERT INTO user_account(role_id,full_name,email,password_hash) VALUES (?,?,?,?)', [role.role_id, 'Commerce isolated test', email, await bcrypt.hash(password, 4)]);
  const [customer] = await c.execute('INSERT INTO customer(user_id) VALUES (?)', [u.insertId]);
  const [a] = await c.execute('INSERT INTO service_address(customer_id,address_line,postal_code) VALUES (?,?,?)', [customer.insertId, 'Isolated commerce test address', '560123']);
  const bookings = [];
  for (let i = 0; i < 3; i++) {
    const [b] = await c.execute(`INSERT INTO booking(customer_id,address_id,service_id,preferred_service_date,preferred_time_slot,booking_status,total_amount) VALUES (?,?,?,?,'09:00 - 11:00','Completed',100)`, [customer.insertId, a.insertId, service.service_id, today()]);
    bookings.push(b.insertId);
  }
  return { userId: u.insertId, customerId: customer.insertId, addressId: a.insertId, adminId: admin.user_id, serviceId: service.service_id, bookings, email, password };
}
async function fixture(run) {
  const c = await pool.getConnection(); await c.beginTransaction();
  const executor = { execute: c.execute.bind(c), query: c.query.bind(c), beginTransaction: () => c.query('SAVEPOINT commerce'), commit: () => c.query('RELEASE SAVEPOINT commerce'), rollback: () => c.query('ROLLBACK TO SAVEPOINT commerce'), release() {} };
  const db = { ...executor, getConnection: async () => executor };
  try { await run(db, c, await makeFixture(c)); } finally { await c.rollback(); c.release(); }
}
async function setRule(db, c, actor, patch = {}) {
  const [[r]] = await c.query('SELECT version FROM reward_rule WHERE rule_id=1');
  return updateRewardRule(db, actor, { requestId: randomUUID(), expectedVersion: r.version, pointsPerDollar: 1, redemptionPoints: 100, redemptionValue: 5, reason: 'Isolated rule configuration for validation.', ...patch });
}

test('commerce partial receipts are cumulative, immutable/idempotent and refunds reverse only actual earnings', () => fixture(async (db, c, f) => {
  await setRule(db, c, f.adminId);
  const first = receipt(10.51);
  const saved = await recordPayment(db, f.adminId, f.bookings[0], first);
  assert.equal(saved.pointsChange, 10);
  assert.deepEqual(await recordPayment(db, f.adminId, f.bookings[0], first), saved);
  await assert.rejects(recordPayment(db, f.adminId, f.bookings[0], { ...first, amount: 11 }), /request ID/);
  assert.equal((await recordPayment(db, f.adminId, f.bookings[0], receipt(0.49))).pointsChange, 1);
  await assert.rejects(recordPayment(db, f.adminId, f.bookings[0], receipt(90)), /exceeds/);
  await setRule(db, c, f.adminId, { pointsPerDollar: 5 });
  assert.equal((await recordPayment(db, f.adminId, f.bookings[0], receipt(1))).pointsChange, 1, 'original earning rate is frozen');
  const refund = await recordPayment(db, f.adminId, f.bookings[0], receipt(2, { kind: 'Refund' }));
  assert.equal(refund.pointsChange, -2);
  const summary = await rewardsSummary(db, f.customerId);
  assert.equal(summary.balance, 10);
  assert.equal(summary.payments.length, 4);
  assert.equal(summary.bookings.find(b => b.bookingId === f.bookings[0]).netReceived, 10);
  await assert.rejects(recordPayment(db, f.adminId, f.bookings[0], receipt(11, { kind: 'Refund' })), /Refund exceeds/);
  await c.execute("UPDATE booking SET booking_status='Assigned' WHERE booking_id=?", [f.bookings[1]]);
  await assert.rejects(recordPayment(db, f.adminId, f.bookings[1], receipt(50)), /completed/);
}));

test('reward reservation freezes rate, releases on closed booking and consumes points once at first receipt', () => fixture(async (db, c, f) => {
  await setRule(db, c, f.adminId);
  await adjustReward(db, f.adminId, f.customerId, { requestId: randomUUID(), points: 250, reason: 'Seed isolated loyalty validation points.' });
  const reservation = { requestId: randomUUID(), points: 100 };
  const initial = await reserveReward(db, f.userId, f.customerId, f.bookings[0], reservation);
  assert.equal(initial.discount, 5);
  assert.deepEqual(await reserveReward(db, f.userId, f.customerId, f.bookings[0], reservation), initial);
  await assert.rejects(reserveReward(db, f.userId, f.customerId + 100000, f.bookings[1], { requestId: randomUUID(), points: 100 }), /not found/);
  await reserveReward(db, f.userId, f.customerId, f.bookings[1], { requestId: randomUUID(), points: 100 });
  await assert.rejects(reserveReward(db, f.userId, f.customerId, f.bookings[2], { requestId: randomUUID(), points: 100 }), /Not enough/);
  await c.execute("UPDATE booking SET booking_status='Cancelled' WHERE booking_id=?", [f.bookings[1]]);
  await releaseBookingRewardReservation(c, f.bookings[1], 'Cancelled by test.');
  assert.equal((await rewardsSummary(db, f.customerId)).available, 150);
  await setRule(db, c, f.adminId, { redemptionValue: 10 });
  const payment = receipt(95);
  await recordPayment(db, f.adminId, f.bookings[0], payment);
  await recordPayment(db, f.adminId, f.bookings[0], payment);
  const summary = await rewardsSummary(db, f.customerId);
  assert.equal(summary.balance, 245);
  assert.equal(summary.reserved, 0);
  assert.equal(summary.bookings.find(b => b.bookingId === f.bookings[0]).discount, 5);
  assert.equal(summary.history.filter(h => h.type === 'Redeemed').length, 1);
  await assert.rejects(reserveReward(db, f.userId, f.customerId, f.bookings[0], { requestId: randomUUID(), points: 0 }), /already been applied/);
}));

test('refunds after points are spent create debt and future earnings repay it without duplicate return earnings', () => fixture(async (db, c, f) => {
  await setRule(db, c, f.adminId);
  await recordPayment(db, f.adminId, f.bookings[0], receipt(100));
  await reserveReward(db, f.userId, f.customerId, f.bookings[1], { requestId: randomUUID(), points: 100 });
  await recordPayment(db, f.adminId, f.bookings[1], receipt(1));
  await recordPayment(db, f.adminId, f.bookings[0], receipt(100, { kind: 'Refund' }));
  let summary = await rewardsSummary(db, f.customerId);
  assert.equal(summary.balance, -99); assert.equal(summary.available, 0); assert.equal(summary.debt, 99);
  await recordPayment(db, f.adminId, f.bookings[2], receipt(100));
  summary = await rewardsSummary(db, f.customerId);
  assert.equal(summary.balance, 1); assert.equal(summary.available, 1);
  const [[r]] = await c.execute('SELECT COUNT(*) AS n FROM reward_booking_earning WHERE booking_id=?', [f.bookings[0]]);
  assert.equal(r.n, 1);
}));

test('actual customer cancellation, admin rejection and expiry atomically release reserved rewards', () => fixture(async (db, c, f) => {
  await setRule(db, c, f.adminId);
  await adjustReward(db, f.adminId, f.customerId, { requestId: randomUUID(), points: 300, reason: 'Isolated cancellation release validation.' });
  for (const id of f.bookings) {
    await c.execute("UPDATE booking SET booking_status='Submitted',preferred_service_date=?,expires_at=NULL WHERE booking_id=?", [addCalendarDays(today(), 21), id]);
    await reserveReward(db, f.userId, f.customerId, id, { requestId: randomUUID(), points: 100 });
  }
  await changePublicBooking(db, { id: f.userId, customerId: f.customerId }, f.bookings[0], 'cancel', { status: 'Cancelled' });
  assert.equal((await rewardsSummary(db, f.customerId)).available, 100);
  await rejectBooking(db, { userId: f.adminId }, f.bookings[1], { requestId: randomUUID(), reason: 'Isolated rejected request for release test.' });
  assert.equal((await rewardsSummary(db, f.customerId)).available, 200);
  await c.execute('UPDATE booking SET expires_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 49 HOUR) WHERE booking_id=?', [f.bookings[2]]);
  const scoped = { ...db, execute: (sql, params) => sql.includes("SELECT booking_id FROM booking WHERE booking_status='Submitted'") ? c.execute(sql.replace("WHERE booking_status='Submitted'", "WHERE customer_id=? AND booking_status='Submitted'"), [f.customerId, ...params]) : db.execute(sql, params) };
  assert.equal((await expireSubmittedBookings(scoped)).expired, 1);
  const summary = await rewardsSummary(db, f.customerId);
  assert.equal(summary.balance, 300); assert.equal(summary.reserved, 0); assert.equal(summary.available, 300);
  assert.ok(summary.bookings.every(b => ['Cancelled', 'Rejected', 'Expired'].includes(b.status)));
  assert.equal(summary.history.filter(h => h.type === 'Redeemed').length, 0);
}));

test('commerce report separates service quotes, real cash and order/visit counts with filters', () => fixture(async (db, c, f) => {
  await setRule(db, c, f.adminId);
  const [services] = await c.query('SELECT s.service_id,s.service_name FROM simple_service_catalog x JOIN service_catalog s ON s.service_id=x.service_id ORDER BY s.service_id');
  for (const s of services) await c.execute('INSERT INTO booking_service(booking_id,service_id,service_name,base_price,additional_unit_price,quantity,line_total) VALUES (?,?,?,50,0,1,50)', [f.bookings[0], s.service_id, s.service_name]);
  await recordPayment(db, f.adminId, f.bookings[0], receipt(50));
  await recordPayment(db, f.adminId, f.bookings[0], receipt(10, { kind: 'Refund' }));
  const report = await commerceReport(db, { from: today(), to: today(), serviceId: f.serviceId });
  const row = report.orders.find(b => b.bookingId === f.bookings[0]);
  assert.ok(row);
  for (const s of services) assert.ok(row.serviceName.includes(s.service_name));
  const paymentBooking = (await listPaymentBookings(db, f.customerId)).find(b => b.bookingId === f.bookings[0]);
  for (const s of services) assert.ok(paymentBooking.serviceName.includes(s.service_name));
  const combined = await commerceReport(db, { from: today(), to: today(), serviceId: services[1].service_id });
  assert.ok(combined.orders.some(b => b.bookingId === f.bookings[0]), 'secondary Repair service is filterable and visible');
  assert.equal(row.visits, 0, 'no fictional visit is inferred from Completed status');
  assert.equal(Number(row.baseAmount), 100);
  assert.ok(report.summary.receipts >= 50);
  assert.ok(report.summary.refunds >= 10);
  assert.ok(report.summary.completedServiceAmount >= 300);
  const all = await commerceReport(db, { from: today(), to: today(), technicianId: 4294967295 });
  assert.equal(all.orders.length, 0);
  assert.equal(all.summary.netReceived, 0);
  const [[tech]] = await c.query('SELECT technician_id FROM technician LIMIT 1');
  const [assignment] = await c.execute("INSERT INTO assignment(booking_id,technician_id,assigned_by_admin_id,assignment_status) VALUES (?,?,?,'Completed')", [f.bookings[0], tech.technician_id, f.adminId]);
  const [job] = await c.execute("INSERT INTO work_order(booking_id,assignment_id,appointment_date,current_status) VALUES (?,?,?,'Completed')", [f.bookings[0], assignment.insertId, today() + ' 09:00:00']);
  const [reportRow] = await c.execute("INSERT INTO service_report(job_id,work_performed,started_at) VALUES (?,'Isolated ambiguous legacy visit',?)", [job.insertId, today() + ' 09:00:00']);
  const attributed = await commerceReport(db, { from: today(), to: today(), technicianId: tech.technician_id });
  assert.equal(attributed.orders.find(b => b.bookingId === f.bookings[0]).visits, 0, 'legacy report is not credited to a possibly reassigned current technician');
  await c.execute('INSERT INTO performance_visit(report_id,job_id,technician_id,actual_start) VALUES (?,?,?,?)', [reportRow.insertId, job.insertId, tech.technician_id, today() + ' 09:00:00']);
  const known = await commerceReport(db, { from: today(), to: today(), technicianId: tech.technician_id });
  assert.equal(known.orders.find(b => b.bookingId === f.bookings[0]).visits, 1);
}));

test('commerce HTTP enforces role, CSRF and customer booking ownership', () => fixture(async (db, c, f) => {
  const app = createApp({ pool: db, secret: 'commerce-validation-secret-with-at-least-32-characters' });
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  let cookie = '', csrf = '';
  async function call(path, method = 'GET', body, token = true) {
    const response = await fetch(origin + path, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...(token ? { 'X-CSRF-Token': csrf } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = response.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    const data = await response.json();
    return { status: response.status, data };
  }
  try {
    assert.equal((await call('/api/commerce/customer/rewards')).status, 401);
    csrf = (await call('/api/session')).data.csrf;
    const login = await call('/api/public/login', 'POST', { email: f.email, password: f.password });
    assert.equal(login.status, 200); csrf = (await call('/api/session')).data.csrf;
    assert.equal((await call('/api/commerce/admin/payments')).status, 403);
    assert.equal((await call('/api/commerce/customer/rewards')).status, 200);
    assert.equal((await call(`/api/commerce/customer/rewards/${f.bookings[0]}`, 'POST', { requestId: randomUUID(), points: 0 }, false)).status, 403);
    const [[other]] = await c.execute('SELECT booking_id FROM booking WHERE customer_id<>? LIMIT 1', [f.customerId]);
    if (other) assert.equal((await call(`/api/commerce/customer/rewards/${other.booking_id}`, 'POST', { requestId: randomUUID(), points: 0 })).status, 404);
  } finally { await new Promise(resolve => server.close(resolve)); }
}));

test('simultaneous reservations on separate bookings cannot overspend one wallet', async () => {
  // Committed, uniquely named fixtures are required for separate connections.
  // The cleanup only targets this synthetic customer's records.
  const c = await pool.getConnection(); let f, second;
  try { f = await makeFixture(c); second = await makeFixture(c); } finally { c.release(); }
  const requests = [randomUUID(), randomUUID(), randomUUID()];
  const requestId = () => { const id = randomUUID(); requests.push(id); return id; };
  try {
    await adjustReward(pool, f.adminId, f.customerId, { requestId: requests[0], points: 100, reason: 'Isolated concurrent reservation test.' });
    const outcomes = await Promise.allSettled(f.bookings.slice(0, 2).map((id, index) => reserveReward(pool, f.userId, f.customerId, id, { requestId: requests[index + 1], points: 100 })));
    assert.equal(outcomes.filter(r => r.status === 'fulfilled').length, 1);
    const summary = await rewardsSummary(pool, f.customerId);
    assert.equal(summary.reserved, 100); assert.equal(summary.available, 0); assert.equal(summary.balance, 100);
    const winner = summary.bookings.find(b => b.rewardStatus === 'Reserved');
    await reserveReward(pool, f.userId, f.customerId, winner.bookingId, { requestId: requestId(), points: 0 });
    const snapshot = await pool.getConnection();
    try {
      await snapshot.beginTransaction();
      await snapshot.execute('SELECT current_points FROM loyalty_account WHERE customer_id=?', [f.customerId]);
      await reserveReward(pool, f.userId, f.customerId, f.bookings[0], { requestId: requestId(), points: 100 });
      const h = { execute: snapshot.execute.bind(snapshot), query: snapshot.query.bind(snapshot), beginTransaction: () => snapshot.query('SAVEPOINT stale_view'), commit: () => snapshot.query('RELEASE SAVEPOINT stale_view'), rollback: () => snapshot.query('ROLLBACK TO SAVEPOINT stale_view'), release() {} };
      await assert.rejects(reserveReward({ getConnection: async () => h }, f.userId, f.customerId, f.bookings[1], { requestId: requestId(), points: 100 }), /Not enough/, 'wallet and reservation reads must see commits newer than an established snapshot');
    } finally { await snapshot.rollback(); snapshot.release(); }
    const payments = await Promise.allSettled([1, 2].map(() => recordPayment(pool, f.adminId, f.bookings[2], receipt(70, { requestId: requestId() }))));
    assert.equal(payments.filter(r => r.status === 'fulfilled').length, 1, 'concurrent receipts cannot exceed the outstanding quote');
    const finalReceipt = receipt(30, { requestId: requestId() });
    const retry = await Promise.all([recordPayment(pool, f.adminId, f.bookings[2], finalReceipt), recordPayment(pool, f.adminId, f.bookings[2], finalReceipt)]);
    assert.equal(retry[0].paymentId, retry[1].paymentId, 'same-UUID concurrent receipt retries return one ledger row');
    assert.equal((await rewardsSummary(pool, f.customerId)).payments.length, 2);
    const prefix = randomUUID().slice(0, -12), adjacent = [prefix + '000000000001', prefix + '000000000002'];
    requests.push(...adjacent);
    const independent = await Promise.all([
      recordPayment(pool, f.adminId, f.bookings[1], receipt(60, { requestId: adjacent[0] })),
      recordPayment(pool, second.adminId, second.bookings[0], receipt(60, { requestId: adjacent[1] })),
    ]);
    assert.equal(independent.length, 2, 'independent-wallet adjacent UUID gap contention safely retries definite deadlocks');
  } finally {
    const d = await cleanupPool.getConnection();
    try {
      await d.beginTransaction();
      await d.execute(`DELETE FROM commerce_operation WHERE request_id IN (${requests.map(() => '?').join(',')})`, requests);
      for (const customer of [f, second]) {
        await d.execute('DELETE a FROM reward_adjustment_audit a JOIN loyalty_transaction t ON t.loyalty_transaction_id=a.loyalty_transaction_id JOIN loyalty_account l ON l.loyalty_account_id=t.loyalty_account_id WHERE l.customer_id=?', [customer.customerId]);
        await d.execute('DELETE p FROM commerce_payment p JOIN booking b ON b.booking_id=p.booking_id WHERE b.customer_id=?', [customer.customerId]);
        await d.execute('DELETE e FROM reward_booking_earning e JOIN booking b ON b.booking_id=e.booking_id WHERE b.customer_id=?', [customer.customerId]);
        await d.execute('DELETE r FROM reward_reservation r JOIN booking b ON b.booking_id=r.booking_id WHERE b.customer_id=?', [customer.customerId]);
        await d.execute('DELETE FROM loyalty_account WHERE customer_id=?', [customer.customerId]);
        await d.execute('DELETE FROM booking WHERE customer_id=?', [customer.customerId]);
        await d.execute('DELETE FROM service_address WHERE customer_id=?', [customer.customerId]);
        await d.execute('DELETE FROM customer WHERE customer_id=?', [customer.customerId]);
        await d.execute('DELETE FROM user_account WHERE user_id=?', [customer.userId]);
      }
      await d.commit();
    } catch (e) { await d.rollback(); throw e; } finally { d.release(); }
  }
});
