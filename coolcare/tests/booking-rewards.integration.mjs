import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import mysql from 'mysql2/promise';
import { createPublicBooking, changePublicBooking } from '../server/public-site.mjs';
import { createBooking } from '../server/customer/booking-service.mjs';
import { getBookingOptions } from '../server/customer/booking-options.mjs';
import { saveAssistantDraft, reviewAssistantDraft, confirmAssistantDraft } from '../server/customer/assistant-workflow.mjs';
import { rewardsSummary, awardCompletedBookingRewards } from '../server/commerce.mjs';
import { addCalendarDays, minimumBookingDate, nextWeekday } from '../server/customer/booking-schedule.mjs';
import { openPrivilegedFixtureConnection } from './privileged-fixture.mjs';

const pool = mysql.createPool({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT), user: process.env.DB_USER,
  password: process.env.DB_PASSWORD, database: process.env.DB_NAME, dateStrings: true, decimalNumbers: true, connectionLimit: 4 });
after(() => pool.end());
const futureDate = offset => nextWeekday(addCalendarDays(minimumBookingDate(), 35 + (offset || 0)));

async function makeCustomer(c, points = 500) {
  const [u] = await c.execute(`INSERT INTO user_account(role_id,full_name,email,password_hash,phone)
    SELECT role_id,'Booking reward integration',?,'disabled-test-password','91234567' FROM role WHERE role_name='Customer'`, [`booking-reward-${randomUUID()}@example.test`]);
  const [customer] = await c.execute('INSERT INTO customer(user_id) VALUES (?)', [u.insertId]);
  await c.execute('INSERT INTO loyalty_account(customer_id,current_points) VALUES (?,?)', [customer.insertId, points]);
  return { id: u.insertId, customerId: customer.insertId, phone: '91234567' };
}

async function fixture(work) {
  const c = await pool.getConnection();
  await c.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
  await c.beginTransaction();
  const handle = { execute: c.execute.bind(c), query: (sql, args) => sql === 'SET TRANSACTION ISOLATION LEVEL READ COMMITTED' ? Promise.resolve([[], []]) : c.query(sql, args),
    beginTransaction: () => c.query('SAVEPOINT booking_rewards'), commit: () => c.query('RELEASE SAVEPOINT booking_rewards'),
    rollback: () => c.query('ROLLBACK TO SAVEPOINT booking_rewards'), release() {} };
  const db = { ...handle, getConnection: async () => handle };
  try {
    await c.execute('UPDATE reward_rule SET version=version+1,redemption_points=100,redemption_value=5,points_per_dollar=1 WHERE rule_id=1');
    await work(db, c, await makeCustomer(c));
  } finally { await c.rollback(); c.release(); }
}

const payload = (overrides = {}) => ({ serviceType: 'Cleaning', numberOfUnits: 1, preferredDate: futureDate(),
  timeWindow: '09:00 AM - 11:00 AM', serviceAddress: '42 Booking Reward Test Avenue #02-10', requestId: randomUUID(), ...overrides });
const customerPayload = input => ({ ...input, timeSlot: '09:00 - 11:00' });
async function counts(c, customerId) {
  const [[row]] = await c.execute(`SELECT
    (SELECT COUNT(*) FROM booking WHERE customer_id=?) AS bookings,
    (SELECT COUNT(*) FROM annual_booking_series WHERE customer_id=?) AS series,
    (SELECT COUNT(*) FROM service_address WHERE customer_id=?) AS addresses,
    (SELECT COUNT(*) FROM aircon_unit WHERE customer_id=?) AS units,
    (SELECT COUNT(*) FROM reward_reservation r JOIN booking b ON b.booking_id=r.booking_id WHERE b.customer_id=?) AS reservations`, Array(5).fill(customerId));
  return row;
}
const zeroCounts = { bookings: 0, series: 0, addresses: 0, units: 0, reservations: 0 };

for (const surface of ['public', 'customer']) {
  test(`${surface} creates a booking with an atomic points reservation and recovers it on retry`, () => fixture(async (db, c, user) => {
    const create = input => surface === 'public' ? createPublicBooking(db, user, input) : createBooking(db, customerPayload(input), user.id);
    const [[rule]] = await c.query('SELECT version FROM reward_rule WHERE rule_id=1');
    const input = payload({ rewardPoints: 200, rewardRuleVersion: rule.version });
    const booking = await create(input);
    assert.deepEqual(booking.rewardReservation, { bookingId: booking.bookingId, points: 200, discount: 10, status: 'Reserved' });
    assert.equal(booking.totalAmount, 50, 'base service amount remains unchanged');
    const summary = await rewardsSummary(db, user.customerId);
    assert.equal(summary.balance, 500); assert.equal(summary.reserved, 200); assert.equal(summary.available, 300);
    assert.equal(summary.bookings[0].netServiceAmount, 40);
    assert.deepEqual((await create({ ...input, rewardPoints: 100 })).rewardReservation, booking.rewardReservation,
      'an existing request recovers its original booking instead of changing its reward');
    assert.deepEqual(await counts(c, user.customerId), { bookings: 1, series: 0, addresses: 1, units: 1, reservations: 1 });
    await changePublicBooking(db, user, booking.bookingId, 'cancel', { status: 'Cancelled' });
    assert.equal((await rewardsSummary(db, user.customerId)).available, 500, 'cancellation releases creation-time reservations');
  }));

  test(`${surface} rejects invalid reward selections without persisting bookings, addresses or equipment`, () => fixture(async (db, c, user) => {
    const create = input => surface === 'public' ? createPublicBooking(db, user, input) : createBooking(db, customerPayload(input), user.id);
    const [[rule]] = await c.query('SELECT version FROM reward_rule WHERE rule_id=1');
    for (const [patch, message] of [
      [{ rewardPoints: 600 }, /Not enough available points/],
      [{ rewardPoints: 1100 }, /cannot exceed/],
      [{ rewardPoints: 150 }, /multiples of 100/],
      [{ rewardPoints: 100, rewardRuleVersion: rule.version + 1 }, /Reward rules changed/],
      [{ rewardPoints: -100 }, null], [{ rewardPoints: 0.5 }, null], [{ rewardPoints: '100' }, null],
      [{ rewardPoints: 100, reward_points: 200 }, null],
    ]) {
      await assert.rejects(create(payload(patch)), message || undefined);
      assert.deepEqual(await counts(c, user.customerId), zeroCounts);
    }
    const booking = await create(payload({ reward_points: 100 }));
    assert.equal(booking.rewardReservation.points, 100, 'the snake_case compatibility input is accepted');
  }));
}

test('annual creation reserves points only against visit 1 and invalid rewards roll back the entire bundle', () => fixture(async (db, c, user) => {
  const { bundles } = await getBookingOptions(db, user.customerId), bundle = bundles[0];
  const input = payload({ serviceType: undefined, packageId: bundle.packageId, propertyType: bundle.propertyPrices[0].propertyType, rewardPoints: 100 });
  await assert.rejects(createPublicBooking(db, user, { ...input, rewardPoints: 600 }), /Not enough|cannot exceed/);
  assert.deepEqual(await counts(c, user.customerId), zeroCounts);
  await c.execute('UPDATE loyalty_account SET current_points=100000 WHERE customer_id=?', [user.customerId]);
  const beyondFirstVisit = (Math.floor(bundle.propertyPrices[0].price / 4 / 5) + 1) * 100;
  await assert.rejects(createPublicBooking(db, user, { ...input, rewardPoints: beyondFirstVisit }), /cannot exceed/,
    'the redemption limit is the first visit price, not the combined annual price');
  assert.deepEqual(await counts(c, user.customerId), zeroCounts);
  await c.execute('UPDATE loyalty_account SET current_points=500 WHERE customer_id=?', [user.customerId]);
  const booking = await createPublicBooking(db, user, input);
  assert.equal(booking.annualBundle.visits.length, 4);
  const [rows] = await c.execute(`SELECT b.booking_id,r.points,r.discount_amount FROM booking b
    LEFT JOIN reward_reservation r ON r.booking_id=b.booking_id WHERE b.customer_id=? ORDER BY b.booking_id`, [user.customerId]);
  assert.equal(rows[0].booking_id, booking.bookingId); assert.equal(rows[0].points, 100); assert.equal(rows[0].discount_amount, 5);
  assert.ok(rows.slice(1).every(row => row.points === null));
  assert.equal((await createPublicBooking(db, user, input)).bookingId, booking.bookingId);
  assert.deepEqual(await counts(c, user.customerId), { bookings: 4, series: 1, addresses: 1, units: 1, reservations: 1 });
}));

test('creation-time full discounts settle once at completion and earn no new points', () => fixture(async (db, c, user) => {
  await c.execute('UPDATE loyalty_account SET current_points=1000 WHERE customer_id=?', [user.customerId]);
  const booking = await createBooking(db, customerPayload(payload({ rewardPoints: 1000 })), user.id);
  await c.execute("UPDATE booking SET booking_status='Completed' WHERE booking_id=?", [booking.bookingId]);
  const completed = await awardCompletedBookingRewards(c, booking.bookingId);
  assert.equal(completed.redeemedPoints, 1000); assert.equal(completed.awardedPoints, 0);
  assert.equal((await awardCompletedBookingRewards(c, booking.bookingId)).replayed, true);
  const summary = await rewardsSummary(db, user.customerId);
  assert.equal(summary.balance, 0); assert.equal(summary.reserved, 0);
  assert.equal(summary.history.filter(row => row.type === 'Redeemed').length, 1);
}));

const identity = (user, state) => ({ expectedUserId: user.id, draftId: state?.draftId ?? null, revision: state?.revision ?? 0 });
async function assistantReview(db, user) {
  const { services } = await getBookingOptions(db, user.customerId);
  const draft = { step: 'review', numberOfUnits: 1, serviceId: services[0].serviceId, rewardPoints: 100,
    serviceAddress: '42 Assistant Reward Avenue #01-04', phone: '91234567', preferredDate: futureDate(), timeWindow: '09:00 AM - 11:00 AM', notes: '' };
  const saved = await saveAssistantDraft(db, user, { ...identity(user), draft });
  return (await reviewAssistantDraft(db, user, identity(user, saved.state))).state;
}

test('assistant fingerprints rewards, reconfirms changed rules and stores one atomic receipt', () => fixture(async (db, c, user) => {
  const reviewed = await assistantReview(db, user);
  assert.equal(reviewed.quote.rewardReservation.discount, 5);
  await c.execute('UPDATE reward_rule SET version=version+1,redemption_value=6 WHERE rule_id=1');
  const confirm = state => confirmAssistantDraft(db, user, { ...identity(user, state), quoteId: state.quote.quoteId });
  const changed = await confirm(reviewed);
  assert.equal(changed.code, 'REVIEW_REQUIRED'); assert.equal(changed.state.quote.rewardReservation.discount, 6);
  assert.deepEqual(await counts(c, user.customerId), zeroCounts);
  const result = await confirm(changed.state);
  assert.equal(result.booking.rewardReservation.discount, 6); assert.equal(result.booking.rewardReservation.points, 100);
  assert.deepEqual((await confirm(reviewed)).booking, JSON.parse(JSON.stringify(result.booking)), 'older confirmation recovers the immutable receipt');
  assert.deepEqual(await counts(c, user.customerId), { bookings: 1, series: 0, addresses: 1, units: 1, reservations: 1 });
}));

test('assistant rechecks available points at confirmation and preserves the reviewed draft on failure', () => fixture(async (db, c, user) => {
  const reviewed = await assistantReview(db, user);
  await c.execute('UPDATE loyalty_account SET current_points=0 WHERE customer_id=?', [user.customerId]);
  await assert.rejects(confirmAssistantDraft(db, user, { ...identity(user, reviewed), quoteId: reviewed.quote.quoteId }), error => {
    assert.equal(error.code, 'REWARD_SELECTION_INVALID'); assert.ok(error.details.fieldErrors.rewardPoints.length);
    return /Not enough/.test(error.message);
  });
  assert.deepEqual(await counts(c, user.customerId), zeroCounts);
  const [[draft]] = await c.execute('SELECT draft_status,revision FROM assistant_booking_draft WHERE draft_id=?', [reviewed.draftId]);
  assert.equal(draft.draft_status, 'reviewed'); assert.equal(draft.revision, reviewed.revision);
}));

test('concurrent customer and public submissions cannot reserve the same available points twice', async () => {
  // A committed, uniquely identified customer is needed for separate connections.
  // Cleanup is restricted to that customer's synthetic records.
  const [[rule]] = await pool.query('SELECT redemption_points AS points FROM reward_rule WHERE rule_id=1');
  const user = await makeCustomer(pool, rule.points);
  try {
    const outcomes = await Promise.allSettled([
      createPublicBooking(pool, user, payload({ rewardPoints: rule.points })),
      createBooking(pool, customerPayload(payload({ rewardPoints: rule.points, preferredDate: futureDate(7), serviceAddress: '43 Booking Reward Test Avenue' })), user.id),
    ]);
    assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1);
    assert.match(outcomes.find(result => result.status === 'rejected').reason.message, /Not enough available points/);
    assert.deepEqual(await counts(pool, user.customerId), { bookings: 1, series: 0, addresses: 1, units: 1, reservations: 1 });
    assert.equal((await rewardsSummary(pool, user.customerId)).available, 0);
  } finally {
    const c = await openPrivilegedFixtureConnection();
    try {
      await c.beginTransaction();
      await c.execute('DELETE r FROM reward_reservation r JOIN booking b ON b.booking_id=r.booking_id WHERE b.customer_id=?', [user.customerId]);
      await c.execute('DELETE d FROM web_booking_details d JOIN booking b ON b.booking_id=d.booking_id WHERE b.customer_id=?', [user.customerId]);
      await c.execute('DELETE FROM booking WHERE customer_id=?', [user.customerId]);
      await c.execute('DELETE FROM customer WHERE customer_id=?', [user.customerId]);
      await c.execute('DELETE FROM user_account WHERE user_id=?', [user.id]);
      await c.commit();
    } catch (error) { await c.rollback(); throw error; } finally { await c.end(); }
  }
});
