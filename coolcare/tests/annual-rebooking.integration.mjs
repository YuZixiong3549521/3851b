import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import mysql from 'mysql2/promise';
import { createApp } from '../server/app.mjs';
import { rebookAnnualVisit } from '../server/customer/annual-rebooking.mjs';
import { annualVisitSchedule } from '../server/customer/annual-bookings.mjs';
import { getBookingOptions } from '../server/customer/booking-options.mjs';
import { nextWeekday, minimumBookingDate, addCalendarDays, singaporeToday } from '../server/customer/booking-schedule.mjs';
import { openPrivilegedFixtureConnection } from './privileged-fixture.mjs';

const pool = mysql.createPool({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT), user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME, dateStrings: true, decimalNumbers: true, connectionLimit: 4 });
after(() => pool.end());

async function fixture(work, { committed = false } = {}) {
  const c = await pool.getConnection();
  await c.beginTransaction();
  let customerId, userId;
  const handle = { execute: c.execute.bind(c), query: c.query.bind(c), beginTransaction: () => c.query('SAVEPOINT annual_rebooking_test'), commit: () => c.query('RELEASE SAVEPOINT annual_rebooking_test'), rollback: () => c.query('ROLLBACK TO SAVEPOINT annual_rebooking_test'), release() {} };
  const db = { execute: c.execute.bind(c), query: c.query.bind(c), getConnection: async () => handle };
  try {
    const email = `annual-rebook-${randomUUID()}@example.test`;
    const [[demo]] = await c.execute("SELECT password_hash FROM user_account WHERE email='alice.tan@coolcare.demo'");
    const [account] = await c.execute("INSERT INTO user_account(role_id,full_name,email,password_hash,phone) SELECT role_id,'Annual Rebooking Test',?,?,'91234567' FROM role WHERE role_name='Customer'", [email, demo.password_hash]);
    userId = account.insertId;
    const [customer] = await c.execute('INSERT INTO customer(user_id) VALUES (?)', [userId]);
    customerId = customer.insertId;
    const [address] = await c.execute("INSERT INTO service_address(customer_id,address_line,postal_code) VALUES (?,'28 Annual Rebooking Test Road #03-04','560123')", [customerId]);
    const options = await getBookingOptions(c);
    const bundle = options.bundles.find(item => item.code === 'annual-cleaning');
    const firstDate = nextWeekday(addCalendarDays(minimumBookingDate(), 400));
    const [series] = await c.execute(`INSERT INTO annual_booking_series(customer_id,address_id,package_id,package_name,first_service_date,unit_count,total_amount,request_id)
      VALUES (?,?,?,'Annual Cleaning Bundle',?,1,200,?)`, [customerId, address.insertId, bundle.packageId, firstDate, randomUUID()]);
    const visits = [];
    for (const visit of annualVisitSchedule(firstDate, 200)) {
      const [booking] = await c.execute(`INSERT INTO booking(customer_id,address_id,service_id,preferred_service_date,preferred_time_slot,slot_start,slot_end,booking_status,total_amount,estimated_duration_minutes)
        VALUES (?,?,?,?,'09:00 - 11:00','09:00:00','09:45:00','Rejected',50,45)`, [customerId, address.insertId, bundle.serviceIds[0], visit.preferredDate]);
      await c.execute('INSERT INTO annual_booking_visit(booking_id,series_id,visit_number,scheduled_date,window_start,window_end) VALUES (?,?,?,?,?,?)', [booking.insertId, series.insertId, visit.visitNumber, visit.preferredDate, visit.windowStart, visit.windowEnd]);
      await c.execute("INSERT INTO booking_status_history(booking_id,old_status,new_status,changed_by_user_id,change_note) VALUES (?,'Submitted','Rejected',?,'Original rejection is retained.')", [booking.insertId, userId]);
      visits.push({ ...visit, bookingId: booking.insertId });
    }
    if (committed) await c.commit();
    await work({ db: committed ? pool : db, c, user: { id: userId }, customerId, addressId: address.insertId, seriesId: series.insertId, visits, email, serviceId: bundle.serviceIds[0] });
  } finally {
    await c.rollback();
    c.release();
    if (committed && customerId) {
      const cleanup = await openPrivilegedFixtureConnection();
      try {
        await cleanup.beginTransaction();
        await cleanup.execute('DELETE FROM commerce_operation WHERE actor_user_id=?', [userId]);
        for (const table of ['booking_change_request', 'booking_status_history', 'annual_booking_visit']) await cleanup.execute(`DELETE x FROM ${table} x JOIN booking b ON b.booking_id=x.booking_id WHERE b.customer_id=?`, [customerId]);
        await cleanup.execute('DELETE FROM booking WHERE customer_id=?', [customerId]);
        await cleanup.execute('DELETE FROM annual_booking_series WHERE customer_id=?', [customerId]);
        await cleanup.execute('DELETE FROM service_address WHERE customer_id=?', [customerId]);
        await cleanup.execute('DELETE FROM customer WHERE customer_id=?', [customerId]);
        await cleanup.execute('DELETE FROM user_account WHERE user_id=?', [userId]);
        await cleanup.commit();
      } catch (error) { await cleanup.rollback(); throw error; }
      finally { await cleanup.end(); }
    }
  }
}

const inputFor = visit => ({ requestId: randomUUID(), preferredDate: nextWeekday(addCalendarDays(visit.preferredDate, 7)), timeWindow: '11:00 - 13:00' });

test('rebooking retains one annual entitlement, price, history, siblings and released points', () => fixture(async ({ db, c, user, customerId, seriesId, visits }) => {
  const visit = visits[1], input = inputFor(visit);
  await c.execute("UPDATE booking SET rejection_reason='Original reason',rejection_version=1 WHERE booking_id=?", [visit.bookingId]);
  const [wallet] = await c.execute('INSERT INTO loyalty_account(customer_id) VALUES (?)', [customerId]);
  await c.execute("INSERT INTO reward_reservation(booking_id,loyalty_account_id,points,discount_amount,rule_version,status) VALUES (?,?,100,5,1,'Released')", [visit.bookingId, wallet.insertId]);
  const [before] = await c.execute('SELECT * FROM booking WHERE customer_id=? ORDER BY booking_id', [customerId]);
  const result = await rebookAnnualVisit(db, user, visit.bookingId, input);
  assert.deepEqual(result, { success: true, bookingId: visit.bookingId });
  const [afterRows] = await c.execute('SELECT * FROM booking WHERE customer_id=? ORDER BY booking_id', [customerId]);
  assert.equal(afterRows.length, 4, 'one closed visit never creates a new four-visit plan');
  assert.deepEqual(afterRows.filter(row => row.booking_id !== visit.bookingId), before.filter(row => row.booking_id !== visit.bookingId));
  const row = afterRows.find(row => row.booking_id === visit.bookingId);
  assert.equal(row.booking_status, 'Submitted'); assert.equal(row.preferred_service_date, input.preferredDate);
  assert.equal(row.total_amount, 50); assert.equal(row.expires_at, null); assert.equal(row.rejection_reason, null);
  const [[link]] = await c.execute('SELECT * FROM annual_booking_visit WHERE booking_id=?', [visit.bookingId]);
  assert.equal(link.series_id, seriesId); assert.equal(link.visit_number, 2); assert.equal(link.scheduled_date, input.preferredDate);
  assert.equal(link.window_start, visit.windowStart); assert.equal(link.window_end, visit.windowEnd);
  const [[reward]] = await c.execute('SELECT status,points FROM reward_reservation WHERE booking_id=?', [visit.bookingId]);
  assert.deepEqual(reward, { status: 'Released', points: 100 });
  const [history] = await c.execute('SELECT new_status FROM booking_status_history WHERE booking_id=? ORDER BY history_id', [visit.bookingId]);
  assert.deepEqual(history.map(row => row.new_status), ['Rejected', 'Submitted']);
  await c.execute("UPDATE booking SET booking_status='Assigned' WHERE booking_id=?", [visit.bookingId]);
  assert.deepEqual(await rebookAnnualVisit(db, user, visit.bookingId, input), result, 'lost response replays after subsequent dispatch');
  const [[unchanged]] = await c.execute('SELECT booking_status FROM booking WHERE booking_id=?', [visit.bookingId]);
  assert.equal(unchanged.booking_status, 'Assigned');
  await assert.rejects(rebookAnnualVisit(db, user, visit.bookingId, { ...input, timeWindow: '14:00 - 16:00' }), e => e.status === 409);
  await assert.rejects(rebookAnnualVisit(db, user, visit.bookingId, { ...input, requestId: randomUUID() }), e => e.status === 409);
}));

test('first visit gains a new confirmation deadline; closed original date may already be past', () => fixture(async ({ db, c, user, visits }) => {
  const visit = visits[0], input = inputFor(visit);
  await c.execute("UPDATE booking SET booking_status='Expired',preferred_service_date=? WHERE booking_id=?", [addCalendarDays(singaporeToday(), -1), visit.bookingId]);
  await rebookAnnualVisit(db, user, visit.bookingId, input);
  const [[b]] = await c.execute('SELECT booking_status,expires_at>UTC_TIMESTAMP() AS newDeadline FROM booking WHERE booking_id=?', [visit.bookingId]);
  assert.deepEqual(b, { booking_status: 'Submitted', newDeadline: 1 });
}));

test('rebooking rejects wrong ownership, ordinary bookings, active visits, expired windows and invalid dates', () => fixture(async ({ db, c, user, customerId, addressId, visits, serviceId }) => {
  const visit = visits[1], input = inputFor(visit);
  const [[other]] = await c.execute('SELECT user_id AS id FROM customer WHERE customer_id<>? LIMIT 1', [customerId]);
  await assert.rejects(rebookAnnualVisit(db, other, visit.bookingId, input), e => e.status === 404);
  const [ordinary] = await c.execute("INSERT INTO booking(customer_id,address_id,service_id,preferred_service_date,preferred_time_slot,booking_status,total_amount) VALUES (?,?,?,?,'09:00 - 11:00','Rejected',50)", [customerId, addressId, serviceId, input.preferredDate]);
  await assert.rejects(rebookAnnualVisit(db, user, ordinary.insertId, input), e => e.status === 409 && /annual/.test(e.message));
  for (const preferredDate of [addCalendarDays(visit.windowStart, -1), visit.windowEnd]) await assert.rejects(rebookAnnualVisit(db, user, visit.bookingId, { ...input, preferredDate }), e => e.status === 409 || e.status === 400);
  const saturday = addCalendarDays(input.preferredDate, (6 - new Date(`${input.preferredDate}T00:00:00Z`).getUTCDay() + 7) % 7);
  await assert.rejects(rebookAnnualVisit(db, user, visit.bookingId, { ...input, preferredDate: saturday }), e => e.status === 400);
  await assert.rejects(rebookAnnualVisit(db, user, visit.bookingId, { ...input, preferredDate: singaporeToday() }), e => e.status === 400);
  for (const status of ['Submitted', 'Confirmed', 'Assigned', 'In Progress', 'Completed']) {
    await c.execute('UPDATE booking SET booking_status=? WHERE booking_id=?', [status, visit.bookingId]);
    await assert.rejects(rebookAnnualVisit(db, user, visit.bookingId, input), e => e.status === 409);
  }
}));

test('rebooking rejects cleaning-week and capacity conflicts atomically', () => fixture(async ({ db, c, user, customerId, addressId, serviceId, visits }) => {
  const visit = visits[1], input = inputFor(visit);
  const [conflict] = await c.execute(`INSERT INTO booking(customer_id,address_id,service_id,preferred_service_date,preferred_time_slot,slot_start,slot_end,booking_status,total_amount)
    VALUES (?,?,?,?,'09:00 - 11:00','09:00:00','09:45:00','Confirmed',50)`, [customerId, addressId, serviceId, input.preferredDate]);
  await assert.rejects(rebookAnnualVisit(db, user, visit.bookingId, input), e => e.status === 409);
  await c.execute("UPDATE booking SET booking_status='Cancelled' WHERE booking_id=?", [conflict.insertId]);
  await c.execute('UPDATE booking SET required_technicians=1000 WHERE booking_id=?', [visit.bookingId]);
  await assert.rejects(rebookAnnualVisit(db, user, visit.bookingId, input), e => e.status === 409 && /fully booked/.test(e.message));
  const [[row]] = await c.execute('SELECT booking_status,preferred_service_date FROM booking WHERE booking_id=?', [visit.bookingId]);
  assert.deepEqual(row, { booking_status: 'Rejected', preferred_service_date: visit.preferredDate });
  const [[operations]] = await c.execute('SELECT COUNT(*) AS n FROM commerce_operation WHERE actor_user_id=?', [user.id]);
  assert.equal(operations.n, 0);
}));

test('service reports and inventory activity prevent reopening even a cancelled work order', () => fixture(async ({ db, c, user, visits }) => {
  const [[staff]] = await c.execute('SELECT t.technician_id,a.user_id AS adminId FROM technician t CROSS JOIN admin_profile a LIMIT 1');
  for (const [index, activity] of ['report', 'inventory'].entries()) {
    const visit = visits[index], input = inputFor(visit);
    const [assignment] = await c.execute("INSERT INTO assignment(booking_id,technician_id,assigned_by_admin_id,assignment_status) VALUES (?,?,?,'Cancelled')", [visit.bookingId, staff.technician_id, staff.adminId]);
    const [job] = await c.execute("INSERT INTO work_order(booking_id,assignment_id,appointment_date,appointment_time,current_status) VALUES (?,?,?,'09:00:00','Cancelled')", [visit.bookingId, assignment.insertId, visit.preferredDate]);
    if (activity === 'report') await c.execute("INSERT INTO service_report(job_id,work_performed,started_at) VALUES (?,'Retained service work',NOW())", [job.insertId]);
    else await c.execute("INSERT INTO inventory_transaction(job_id,part_id,transaction_type,quantity,admin_user_id) SELECT ?,part_id,'Stock Out',1,? FROM part LIMIT 1", [job.insertId, staff.adminId]);
    await assert.rejects(rebookAnnualVisit(db, user, visit.bookingId, input), e => e.status === 409 && /service or inventory/.test(e.message));
  }
}));

test('concurrent repeated annual rebooking creates exactly one change and no extra bookings', () => fixture(async ({ db, c, user, visits, customerId }) => {
  const visit = visits[2], input = inputFor(visit);
  const results = await Promise.all([rebookAnnualVisit(db, user, visit.bookingId, input), rebookAnnualVisit(db, user, visit.bookingId, input)]);
  assert.deepEqual(results[0], results[1]);
  const [[changes]] = await c.execute('SELECT COUNT(*) AS n FROM booking_change_request WHERE booking_id=?', [visit.bookingId]);
  const [[orders]] = await c.execute('SELECT COUNT(*) AS n FROM booking WHERE customer_id=?', [customerId]);
  assert.equal(changes.n, 1); assert.equal(orders.n, 4);
}, { committed: true }));

test('customer and public rebooking HTTP aliases enforce authentication, CSRF and ownership', () => fixture(async ({ db, c, user, visits, email }) => {
  const server = createApp({ pool: db, secret: process.env.SESSION_SECRET }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  let cookie = '', csrf = '';
  const request = async (path, method = 'GET', body) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method, headers: { Cookie: cookie, 'X-CSRF-Token': csrf, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
    return response;
  };
  try {
    csrf = (await (await request('/api/session')).json()).csrf;
    const input = inputFor(visits[1]);
    for (const alias of ['customer', 'public']) assert.equal((await request(`/api/${alias}/bookings/${visits[1].bookingId}/rebook`, 'PATCH', input)).status, 401);
    const login = await (await request('/api/public/login', 'POST', { email, password: 'CoolCareDemo2026!' })).json();
    csrf = login.csrf;
    assert.equal(login.user.id, user.id);
    const validCsrf = csrf;
    csrf = 'wrong';
    for (const alias of ['customer', 'public']) assert.equal((await request(`/api/${alias}/bookings/${visits[1].bookingId}/rebook`, 'PATCH', input)).status, 403);
    csrf = validCsrf;
    const [[foreign]] = await c.execute('SELECT booking_id FROM booking WHERE customer_id<>(SELECT customer_id FROM customer WHERE user_id=?) LIMIT 1', [user.id]);
    assert.equal((await request(`/api/customer/bookings/${foreign.booking_id}/rebook`, 'PATCH', input)).status, 404);
    const created = await request(`/api/customer/bookings/${visits[1].bookingId}/rebook`, 'PATCH', input);
    assert.equal(created.status, 200); assert.deepEqual(await created.json(), { success: true, bookingId: visits[1].bookingId });
    assert.equal((await request(`/api/public/bookings/${visits[1].bookingId}/rebook`, 'PATCH', input)).status, 200, 'aliases share the same durable receipt');
  } finally { await new Promise(resolve => server.close(resolve)); }
}));
