import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import { createApp } from '../server/app.mjs';
import { changePublicBooking } from '../server/public-site.mjs';
import { rejectBooking, listAdminBookings, getAdminBooking } from '../server/admin-operations.mjs';
import { expireSubmittedBookings } from '../server/order-expiry.mjs';
import { addCalendarDays } from '../server/customer/booking-schedule.mjs';
import { awardCompletedBookingRewards, reserveReward, releaseBookingRewardReservation, adjustReward, updateRewardRule, rewardsSummary, commerceReport, listRewardBookings } from '../server/commerce.mjs';
import { updateTechnicianJobStatus } from '../server/technician.mjs';
import { getReport, saveReport } from '../server/technician-pages.mjs';
import { listBookings, getBookingDetail } from '../server/customer/booking-service.mjs';

const pool = mysql.createPool({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT), user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME, dateStrings: true, connectionLimit: 5 });
const cleanupPool = mysql.createPool({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT), user: 'root', password: process.env.MYSQL_ROOT_PASSWORD, database: process.env.DB_NAME, dateStrings: true });
after(async () => { await pool.end(); await cleanupPool.end(); });
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
async function complete(db, bookingId) {
  const c = await db.getConnection();
  try {
    await c.beginTransaction();
    await c.execute("UPDATE booking SET booking_status='Completed' WHERE booking_id=?", [bookingId]);
    const result = await awardCompletedBookingRewards(c, bookingId);
    await c.commit();
    return result;
  } catch (error) { await c.rollback(); throw error; } finally { c.release(); }
}
async function makeJob(c, f, bookingId) {
  if (!f.technician) {
    const [user] = await c.execute(`INSERT INTO user_account(role_id,full_name,email,password_hash)
      SELECT role_id,'Isolated commerce technician',?,'disabled-test-password' FROM role WHERE role_name='Technician'`, [`commerce-tech-${randomUUID()}@coolcare.test`]);
    const [t] = await c.execute("INSERT INTO technician(user_id,availability_status) VALUES (?,'Available')", [user.insertId]);
    f.technician = { technician_id: t.insertId, user_id: user.insertId };
  }
  const tech = f.technician;
  const [assignment] = await c.execute("INSERT INTO assignment(booking_id,technician_id,assigned_by_admin_id,assignment_status) VALUES (?,?,?,'Assigned')", [bookingId, tech.technician_id, f.adminId]);
  const [job] = await c.execute("INSERT INTO work_order(booking_id,assignment_id,appointment_date,appointment_time,current_status) VALUES (?,?,?,'00:00:00','Assigned')", [bookingId, assignment.insertId, today()]);
  return { jobId: job.insertId, userId: tech.user_id };
}
const reportContent = { workPerformed: 'Synthetic completed cleaning checks', problemFound: '', solutionApplied: 'Cleaned filters', checklist: 'Cooling checked', customerSignatureUrl: '', technicianSignatureUrl: '' };

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
    const [b] = await c.execute(`INSERT INTO booking(customer_id,address_id,service_id,preferred_service_date,preferred_time_slot,booking_status,total_amount) VALUES (?,?,?,?,'09:00 - 11:00','Assigned',100)`, [customer.insertId, a.insertId, service.service_id, today()]);
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

test('End service and report submission award once without payments, including repair extras', () => fixture(async (db, c, f) => {
  await setRule(db, c, f.adminId);
  const first = await makeJob(c, f, f.bookings[0]), second = await makeJob(c, f, f.bookings[1]);
  await c.execute('INSERT INTO service_progress(job_id,additional_repair_fee) VALUES (?,25.99)', [first.jobId]);
  await updateTechnicianJobStatus(db, first.userId, first.jobId, { requestId: randomUUID(), expectedStatus: 'Assigned', status: 'In Progress' });
  const end = { requestId: randomUUID(), expectedStatus: 'In Progress', status: 'Completed' };
  await updateTechnicianJobStatus(db, first.userId, first.jobId, end);
  await updateTechnicianJobStatus(db, first.userId, first.jobId, end);
  assert.equal((await rewardsSummary(db, f.customerId)).balance, 125);
  const customerCard = (await listBookings(db, 'history', f.userId)).find(b => b.bookingId === f.bookings[0]);
  const customerDetail = await getBookingDetail(db, f.bookings[0], f.userId);
  const rewardCard = (await listRewardBookings(db, f.customerId)).find(b => b.bookingId === f.bookings[0]);
  assert.deepEqual(customerCard.amounts, customerDetail.amounts);
  assert.deepEqual(customerCard.amounts, rewardCard.amounts);
  const adminDetail = await getAdminBooking(db, f.bookings[0]);
  const adminList = await listAdminBookings(db, { q:String(f.bookings[0]) });
  assert.deepEqual(adminDetail.amounts, customerCard.amounts);
  assert.deepEqual(adminList.rows.find(b => b.bookingId === f.bookings[0]).amounts, customerCard.amounts);
  assert.equal(customerCard.amounts.baseAmount, 100);
  assert.equal(customerCard.amounts.additionalFee, 25.99);
  assert.equal(customerCard.amounts.netServiceAmount, 125.99);
  assert.equal(customerCard.amounts.awardedPoints, 125);
  const saved = await getReport(db, first.userId, first.jobId);
  await saveReport(db, first.userId, first.jobId, { requestId: randomUUID(), expectedVersion: saved.version, report: reportContent });
  assert.equal((await rewardsSummary(db, f.customerId)).balance, 125, 'late report does not repeat earning');
  await setRule(db, c, f.adminId, { pointsPerDollar: 5 });
  assert.equal((await complete(db, f.bookings[0])).awardedPoints, 125, 'completed reward keeps its original rate');
  await updateTechnicianJobStatus(db, second.userId, second.jobId, { requestId: randomUUID(), expectedStatus: 'Assigned', status: 'In Progress' });
  const draft = await getReport(db, second.userId, second.jobId);
  const submission = { requestId: randomUUID(), expectedVersion: draft.version, report: reportContent };
  await saveReport(db, second.userId, second.jobId, submission);
  await saveReport(db, second.userId, second.jobId, submission);
  const summary = await rewardsSummary(db, f.customerId);
  assert.equal(summary.balance, 625);
  assert.equal(summary.history.filter(h => h.type === 'Earned').length, 2);
  assert.equal('payments' in summary, false);
  await assert.rejects(awardCompletedBookingRewards(c, f.bookings[2]), /only when/);
}));

test('reward reservation freezes discount and consumes points once on completion', () => fixture(async (db, c, f) => {
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
  await complete(db, f.bookings[0]);
  await complete(db, f.bookings[0]);
  const summary = await rewardsSummary(db, f.customerId);
  assert.equal(summary.balance, 245);
  assert.equal(summary.reserved, 0);
  assert.equal(summary.bookings.find(b => b.bookingId === f.bookings[0]).discount, 5);
  assert.equal(summary.history.filter(h => h.type === 'Redeemed').length, 1);
  await assert.rejects(reserveReward(db, f.userId, f.customerId, f.bookings[0], { requestId: randomUUID(), points: 0 }), /already been applied/);
}));

test('full discounts earn zero and insufficient reserved points do not block completion', () => fixture(async (db, c, f) => {
  await setRule(db, c, f.adminId);
  await adjustReward(db, f.adminId, f.customerId, { requestId: randomUUID(), points: 2200, reason: 'Synthetic full-discount validation.' });
  await reserveReward(db, f.userId, f.customerId, f.bookings[0], { requestId: randomUUID(), points: 2000 });
  const full = await complete(db, f.bookings[0]);
  assert.equal(full.awardedPoints, 0); assert.equal(full.redeemedPoints, 2000);
  await reserveReward(db, f.userId, f.customerId, f.bookings[1], { requestId: randomUUID(), points: 100 });
  await reserveReward(db, f.userId, f.customerId, f.bookings[2], { requestId: randomUUID(), points: 100 });
  await adjustReward(db, f.adminId, f.customerId, { requestId: randomUUID(), points: -100, reason: 'Synthetic reservation shortage.' });
  const reduced = await complete(db, f.bookings[1]);
  assert.equal(reduced.redeemedPoints, 0); assert.equal(reduced.awardedPoints, 100);
  let summary = await rewardsSummary(db, f.customerId);
  assert.equal(summary.balance, 200); assert.equal(summary.reserved, 100);
  assert.ok(summary.history.some(h => h.points === 0 && h.description.includes('reduced')));
  await complete(db, f.bookings[2]);
  summary = await rewardsSummary(db, f.customerId);
  assert.equal(summary.balance, 195); assert.equal(summary.reserved, 0);
}));

test('completion marker prevents historical backfill, unknown prices and rolled-back awards', () => fixture(async (db, c, f) => {
  await setRule(db, c, f.adminId);
  await c.execute("INSERT INTO booking_completion_reward(booking_id,outcome,note) VALUES (?,'Historical','Pre-cutover booking')", [f.bookings[0]]);
  assert.equal((await complete(db, f.bookings[0])).replayed, true);
  assert.equal((await rewardsSummary(db, f.customerId)).balance, 0);
  await c.execute('UPDATE booking SET total_amount=NULL WHERE booking_id=?', [f.bookings[1]]);
  const unknown = await complete(db, f.bookings[1]);
  assert.equal(unknown.outcome, 'Unknown price'); assert.equal(unknown.awardedPoints, 0);
  await c.query('SAVEPOINT before_failed_completion');
  await c.execute("UPDATE booking SET booking_status='Completed' WHERE booking_id=?", [f.bookings[2]]);
  await awardCompletedBookingRewards(c, f.bookings[2]);
  await c.query('ROLLBACK TO SAVEPOINT before_failed_completion');
  const [[b]] = await c.execute('SELECT booking_status FROM booking WHERE booking_id=?', [f.bookings[2]]);
  assert.equal(b.booking_status, 'Assigned');
  assert.equal((await rewardsSummary(db, f.customerId)).balance, 0);
  assert.equal((await complete(db, f.bookings[2])).awardedPoints, 100);
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

test('reports show completed service values and reward discounts with service and visit filters', () => fixture(async (db, c, f) => {
  await setRule(db, c, f.adminId);
  const [services] = await c.query('SELECT s.service_id,s.service_name FROM simple_service_catalog x JOIN service_catalog s ON s.service_id=x.service_id ORDER BY s.service_id');
  for (const s of services) await c.execute('INSERT INTO booking_service(booking_id,service_id,service_name,base_price,additional_unit_price,quantity,line_total) VALUES (?,?,?,50,0,1,50)', [f.bookings[0], s.service_id, s.service_name]);
  await adjustReward(db, f.adminId, f.customerId, { requestId: randomUUID(), points: 100, reason: 'Synthetic report discount.' });
  await reserveReward(db, f.userId, f.customerId, f.bookings[0], { requestId: randomUUID(), points: 100 });
  for (const id of f.bookings) await complete(db, id);
  const report = await commerceReport(db, { from: today(), to: today(), serviceId: f.serviceId });
  const row = report.orders.find(b => b.bookingId === f.bookings[0]);
  assert.ok(row);
  for (const s of services) assert.ok(row.serviceName.includes(s.service_name));
  const rewardBooking = (await listRewardBookings(db, f.customerId)).find(b => b.bookingId === f.bookings[0]);
  for (const s of services) assert.ok(rewardBooking.serviceName.includes(s.service_name));
  const combined = await commerceReport(db, { from: today(), to: today(), serviceId: services[1].service_id });
  assert.ok(combined.orders.some(b => b.bookingId === f.bookings[0]), 'secondary Repair service is filterable and visible');
  assert.equal(row.visits, 0, 'no fictional visit is inferred from Completed status');
  assert.equal(Number(row.baseAmount), 100);
  assert.equal(row.rewardDiscount, 5); assert.equal(row.netServiceAmount, 95);
  assert.equal('receipts' in report.summary, false);
  assert.equal('refunds' in report.summary, false);
  assert.ok(report.services.some(s => s.isCurrent));
  assert.ok(report.services.some(s => !s.isCurrent), 'historical services remain discoverable separately');
  // A direct legacy data correction must never rewrite the completion snapshot.
  await c.execute('UPDATE booking SET total_amount=999 WHERE booking_id=?', [f.bookings[0]]);
  const stable = await commerceReport(db, { from: today(), to: today(), serviceId: f.serviceId });
  assert.equal(stable.orders.find(b => b.bookingId === f.bookings[0]).netServiceAmount, 95);
  const [[pkg]] = await c.query("SELECT package_id FROM simple_package_catalog WHERE code='annual-cleaning'");
  const [series] = await c.execute(`INSERT INTO annual_booking_series(customer_id,address_id,package_id,package_name,first_service_date,unit_count,total_amount)
    VALUES (?,?,?,'Annual Cleaning Bundle',?,1,400)`, [f.customerId, f.addressId, pkg.package_id, today()]);
  await c.execute(`INSERT INTO annual_booking_visit(booking_id,series_id,visit_number,scheduled_date,window_start,window_end) VALUES (?,?,1,?,?,?)`,
    [f.bookings[0], series.insertId, today(), today(), addCalendarDays(today(), 30)]);
  const annual = await commerceReport(db, { from: today(), to: today(), serviceGroup: 'annual' });
  assert.ok(annual.orders.some(b => b.bookingId === f.bookings[0]));
  assert.ok(!annual.orders.some(b => b.bookingId === f.bookings[1]), 'standalone cleaning is excluded from the annual filter');
  assert.ok(Number(annual.bundles.plans) >= 1);
  assert.ok(report.summary.completedServiceAmount >= 300);
  const all = await commerceReport(db, { from: today(), to: today(), technicianId: 4294967295 });
  assert.equal(all.orders.length, 0);
  assert.equal(all.summary.completedNetServiceAmount, 0);
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
    // A transaction-only admin keeps existing account roles and credentials intact.
    const adminEmail = `admin-${f.email}`;
    await c.execute("INSERT INTO user_account(role_id,full_name,email,password_hash) SELECT role_id,'Rewards API test admin',?,? FROM role WHERE role_name='Admin'", [adminEmail, await bcrypt.hash(f.password, 4)]);
    const adminLogin = await call('/api/public/login', 'POST', { email: adminEmail, password: f.password });
    assert.equal(adminLogin.status, 200); csrf = adminLogin.data.csrf;
    assert.equal((await call('/api/commerce/admin/payments')).status, 410);
    assert.equal((await call(`/api/commerce/admin/payments/${f.bookings[0]}`, 'POST', {})).status, 410);
    assert.equal((await call('/api/commerce/admin/rewards')).status, 200);
    const csv = await fetch(`${origin}/api/commerce/admin/reports.csv?from=${today()}&to=${today()}`, { headers: { Cookie: cookie } });
    assert.equal(csv.status, 200);
    const text = await csv.text();
    const reportBooking = (await listRewardBookings(db, f.customerId)).find(b => b.bookingId === f.bookings[0]);
    assert.ok(text.includes(reportBooking.bookingReference), 'CSV uses the same full reference as the rewards API');
    assert.match(text, /Net service amount SGD/);
    assert.doesNotMatch(text, /receipts|refunds|netReceived/);
  } finally { await new Promise(resolve => server.close(resolve)); }
}));

test('completion and points timestamps are stable UTC instants across database session time zones', () => fixture(async (db, c, f) => {
  try {
    for (const [index, zone] of ['+00:00', '+08:00', '-05:00'].entries()) {
      await c.query('SET time_zone=?', [zone]);
      const before = Date.now() - 1000;
      await complete(db, f.bookings[index]);
      const rewards = await rewardsSummary(db, f.customerId);
      const completed = rewards.bookings.find(b => b.bookingId === f.bookings[index]).completionReward;
      assert.match(completed.completedAt, /Z$/);
      assert.ok(Date.parse(completed.completedAt) >= before && Date.parse(completed.completedAt) <= Date.now());
      const earned = rewards.history.find(h => h.bookingId === f.bookings[index] && h.type === 'Earned');
      assert.ok(earned);
      assert.ok(Date.parse(earned.createdAt) >= before && Date.parse(earned.createdAt) <= Date.now());
    }
  } finally { await c.query("SET time_zone='+00:00'"); }
}));

test('concurrent reservations and completions serialize wallets without overspending or duplicate rewards', async () => {
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
    const completed = await Promise.all([complete(pool, f.bookings[0]), complete(pool, f.bookings[1])]);
    assert.equal(completed.length, 2, 'same-wallet completions must succeed without a deadlock retry wrapper');
    assert.equal((await rewardsSummary(pool, f.customerId)).balance, 195);
    const retry = await Promise.all([complete(pool, f.bookings[2]), complete(pool, f.bookings[2])]);
    assert.equal(retry.filter(r => r.replayed).length, 1);
    assert.equal((await rewardsSummary(pool, f.customerId)).balance, 295);
    const independent = await Promise.all(second.bookings.slice(0, 2).map(id => complete(pool, id)));
    assert.equal(independent.length, 2, 'first completions also serialize creation of a new wallet');
    assert.equal((await rewardsSummary(pool, second.customerId)).balance, 200);
  } finally {
    const d = await cleanupPool.getConnection();
    try {
      await d.beginTransaction();
      await d.execute(`DELETE FROM commerce_operation WHERE request_id IN (${requests.map(() => '?').join(',')})`, requests);
      for (const customer of [f, second]) {
        await d.execute('DELETE a FROM reward_adjustment_audit a JOIN loyalty_transaction t ON t.loyalty_transaction_id=a.loyalty_transaction_id JOIN loyalty_account l ON l.loyalty_account_id=t.loyalty_account_id WHERE l.customer_id=?', [customer.customerId]);
        await d.execute('DELETE p FROM commerce_payment p JOIN booking b ON b.booking_id=p.booking_id WHERE b.customer_id=?', [customer.customerId]);
        await d.execute('DELETE e FROM reward_booking_earning e JOIN booking b ON b.booking_id=e.booking_id WHERE b.customer_id=?', [customer.customerId]);
        await d.execute('DELETE e FROM booking_completion_reward e JOIN booking b ON b.booking_id=e.booking_id WHERE b.customer_id=?', [customer.customerId]);
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
