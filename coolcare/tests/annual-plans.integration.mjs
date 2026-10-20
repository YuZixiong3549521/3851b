import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import mysql from 'mysql2/promise';
import { listAnnualPlans, getAnnualPlanRenewal, dismissAnnualPlanNotice, assertAnnualPlanRenewal } from '../server/customer/plans.mjs';
import { getBookingOptions } from '../server/customer/booking-options.mjs';
import { createBooking } from '../server/customer/booking-service.mjs';
import { annualVisitSchedule, addCalendarMonths } from '../server/customer/annual-bookings.mjs';
import { nextWeekday, addCalendarDays, singaporeToday } from '../server/customer/booking-schedule.mjs';
import { openPrivilegedFixtureConnection } from './privileged-fixture.mjs';
import { bookingReference } from '../server/booking-reference.mjs';

const pool = mysql.createPool({
  host: process.env.DB_HOST, port: Number(process.env.DB_PORT), user: process.env.DB_USER,
  password: process.env.DB_PASSWORD, database: process.env.DB_NAME, dateStrings: true, decimalNumbers: true, connectionLimit: 5,
});
after(() => pool.end());

async function fixture(work, { committed = false } = {}) {
  const c = await pool.getConnection();
  await c.beginTransaction();
  let cleanupCustomerId;
  let cleanupUserId;
  const connection = {
    execute: c.execute.bind(c), query: c.query.bind(c),
    beginTransaction: () => c.query('SAVEPOINT annual_plan_test'),
    commit: () => c.query('RELEASE SAVEPOINT annual_plan_test'),
    rollback: () => c.query('ROLLBACK TO SAVEPOINT annual_plan_test'), release: () => {},
  };
  const db = { execute: c.execute.bind(c), query: c.query.bind(c), getConnection: async () => connection };
  try {
    const [account] = await c.execute(`INSERT INTO user_account(role_id,full_name,email,password_hash,phone)
      SELECT role_id,'Annual Plan Test',?,'unusable-test-password','91234567' FROM role WHERE role_name='Customer'`, [`plan-${randomUUID()}@example.test`]);
    const [customer] = await c.execute('INSERT INTO customer(user_id) VALUES (?)', [account.insertId]);
    cleanupCustomerId = customer.insertId;
    cleanupUserId = account.insertId;
    const [address] = await c.execute("INSERT INTO service_address(customer_id,address_line,postal_code) VALUES (?,'28 Annual Plan Test Road #03-04','560123')", [customer.insertId]);
    const options = await getBookingOptions(c);
    const bundle = options.bundles.find(item => item.code === 'annual-cleaning');
    const firstDate = nextWeekday(addCalendarMonths(addCalendarDays(singaporeToday(), 30), -12));
    const [created] = await c.execute(`INSERT INTO annual_booking_series
      (customer_id,address_id,package_id,package_name,first_service_date,unit_count,total_amount,request_id,property_type,property_label,included_units,base_annual_price,additional_unit_price)
      VALUES (?,?,?,'Annual Cleaning Bundle',?,3,240,?,'hdb-4','HDB 4-room',3,240,80)`,
    [customer.insertId, address.insertId, bundle.packageId, firstDate, randomUUID()]);
    for (const visit of annualVisitSchedule(firstDate, 240)) {
      const [booking] = await c.execute(`INSERT INTO booking(customer_id,address_id,service_id,preferred_service_date,
        preferred_time_slot,slot_start,slot_end,booking_status,total_amount) VALUES (?,?,?,?,'09:00 - 11:00','09:00:00','11:15:00','Completed',60)`,
      [customer.insertId, address.insertId, bundle.serviceIds[0], visit.preferredDate]);
      await c.execute('INSERT INTO annual_booking_visit(booking_id,series_id,visit_number,scheduled_date,window_start,window_end) VALUES (?,?,?,?,?,?)',
        [booking.insertId, created.insertId, visit.visitNumber, visit.preferredDate, visit.windowStart, visit.windowEnd]);
    }
    if (committed) await c.commit();
    await work({ db: committed ? pool : db, c, userId: account.insertId, customerId: customer.insertId, addressId: address.insertId, seriesId: created.insertId, bundle });
  } finally {
    await c.rollback();
    c.release();
    if (committed && cleanupCustomerId) {
      const cleanup = await openPrivilegedFixtureConnection();
      try {
        await cleanup.beginTransaction();
        const [bookings] = await cleanup.execute('SELECT booking_id FROM booking WHERE customer_id=?', [cleanupCustomerId]);
        const bookingIds = bookings.map(row => row.booking_id);
        await cleanup.execute('DELETE n FROM annual_plan_notice n JOIN annual_booking_series s ON s.series_id=n.series_id WHERE s.customer_id=?', [cleanupCustomerId]);
        await cleanup.execute('DELETE r FROM annual_plan_renewal r JOIN annual_booking_series s ON s.series_id=r.source_series_id WHERE s.customer_id=?', [cleanupCustomerId]);
        if (bookingIds.length) {
          const placeholders = bookingIds.map(() => '?').join(',');
          for (const table of ['annual_booking_visit', 'booking_email_outbox', 'booking_status_history', 'booking_aircon_unit', 'booking_service', 'booking_package', 'web_booking_details']) {
            await cleanup.execute(`DELETE FROM ${table} WHERE booking_id IN (${placeholders})`, bookingIds);
          }
          await cleanup.execute(`DELETE FROM booking WHERE booking_id IN (${placeholders})`, bookingIds);
        }
        await cleanup.execute('DELETE FROM annual_booking_series WHERE customer_id=?', [cleanupCustomerId]);
        await cleanup.execute('DELETE FROM aircon_unit WHERE customer_id=?', [cleanupCustomerId]);
        await cleanup.execute('DELETE FROM service_address WHERE customer_id=?', [cleanupCustomerId]);
        await cleanup.execute('DELETE FROM customer WHERE customer_id=?', [cleanupCustomerId]);
        await cleanup.execute('DELETE FROM user_account WHERE user_id=?', [cleanupUserId]);
        await cleanup.commit();
      } catch (error) {
        await cleanup.rollback();
        throw error;
      } finally {
        await cleanup.end();
      }
    }
  }
}

test('annual plans show owned snapshots, four entitlements and durable reminder acknowledgement', async () => fixture(async ({ db, userId, seriesId }) => {
  const listed = await listAnnualPlans(db, userId);
  assert.equal(listed.plans.length, 1);
  assert.equal(listed.plans[0].totalAmount, 240, 'historical price is not replaced by the current catalogue');
  assert.equal(listed.plans[0].completedVisits, 4);
  assert.equal(listed.plans[0].remainingVisits, 0);
  assert.equal(listed.plans[0].status, 'Completed');
  assert.equal(listed.reminders.length, 1);
  await dismissAnnualPlanNotice(db, userId, seriesId, listed.reminders[0].key);
  await dismissAnnualPlanNotice(db, userId, seriesId, listed.reminders[0].key);
  assert.equal((await listAnnualPlans(db, userId)).reminders.length, 0);
  assert.deepEqual((await listAnnualPlans(db, userId + 999999)).plans, []);
  await assert.rejects(getAnnualPlanRenewal(db, userId + 999999, seriesId), error => error.status === 404);
  await assert.rejects(dismissAnnualPlanNotice(db, userId + 999999, seriesId, listed.reminders[0].key), error => error.status === 404);
  await assert.rejects(dismissAnnualPlanNotice(db, userId, seriesId, 'forged-notice'), error => error.status === 409);
}));

test('annual renewal reviews current prices, validates term boundaries and creates only one successor', async () => fixture(async ({ db, c, userId, customerId, seriesId, bundle }) => {
  const prefill = await getAnnualPlanRenewal(db, userId, seriesId);
  assert.equal(prefill.packageId, bundle.packageId);
  assert.equal(prefill.numberOfUnits, 3);
  assert.equal(prefill.currentAnnualPrice, bundle.propertyPrices.find(tier => tier.propertyType === 'hdb-4').price);
  await assert.rejects(assertAnnualPlanRenewal(c, {
    renewalOfSeriesId: seriesId, customerId, packageId: bundle.packageId,
    preferredDate: addCalendarDays(prefill.minimumFirstDate, -1),
  }), error => error.status === 400);
  const payload = {
    renewalOfSeriesId: seriesId, packageId: prefill.packageId, propertyType: prefill.propertyType,
    serviceAddress: prefill.serviceAddress, addressId: prefill.addressId, postalCode: prefill.postalCode,
    numberOfUnits: prefill.numberOfUnits, preferredDate: prefill.minimumFirstDate,
    timeSlot: '09:00 - 11:00', requestId: randomUUID(),
  };
  const created = await createBooking(db, payload, userId);
  assert.equal(created.annualBundle.visits.length, 4);
  assert.equal(new Set(created.annualBundle.visits.map(v => v.bookingReference)).size, 4);
  for (const visit of created.annualBundle.visits) {
    const [[booking]] = await c.execute('SELECT created_at FROM booking WHERE booking_id=?', [visit.bookingId]);
    assert.equal(visit.bookingReference, bookingReference(visit.bookingId, booking.created_at));
  }
  assert.equal(created.annualBundle.totalAmount, prefill.currentAnnualPrice);
  assert.equal((await createBooking(db, payload, userId)).bookingId, created.bookingId, 'same request returns the original booking');
  await assert.rejects(createBooking(db, { ...payload, requestId: randomUUID() }, userId), error => error.status === 409);
  const [[count]] = await c.execute('SELECT COUNT(*) AS total FROM annual_booking_series WHERE customer_id=?', [customerId]);
  assert.equal(count.total, 2);
  const updated = await getAnnualPlanRenewal(db, userId, seriesId);
  assert.equal(updated.existingRenewalSeriesId, created.annualBundle.seriesId);
  const listing = await listAnnualPlans(db, userId);
  assert.equal(listing.plans.find(plan => plan.seriesId === seriesId).canRenew, false);
  assert.equal(listing.plans.find(plan => plan.seriesId === created.annualBundle.seriesId).renewedFromSeriesId, seriesId);
}));

test('concurrent renewal requests create one successor and stale read snapshots cannot bypass it', async () => fixture(async ({ db, userId, customerId, seriesId }) => {
  const prefill = await getAnnualPlanRenewal(db, userId, seriesId);
  const payload = {
    renewalOfSeriesId: seriesId, packageId: prefill.packageId, propertyType: prefill.propertyType,
    serviceAddress: prefill.serviceAddress, addressId: prefill.addressId, postalCode: prefill.postalCode,
    numberOfUnits: prefill.numberOfUnits, preferredDate: prefill.minimumFirstDate, timeSlot: '09:00 - 11:00',
  };
  const stale = await pool.getConnection();
  const dates = annualVisitSchedule(prefill.minimumFirstDate, prefill.currentAnnualPrice).map(visit => visit.preferredDate);
  const [previousLocks] = await pool.execute(`SELECT service_date FROM service_day_capacity_lock WHERE service_date IN (${dates.map(() => '?').join(',')})`, dates);
  const originalLocks = new Set(previousLocks.map(row => row.service_date));
  try {
    await stale.beginTransaction();
    const [[before]] = await stale.execute('SELECT COUNT(*) AS count FROM annual_plan_renewal WHERE source_series_id=?', [seriesId]);
    assert.equal(before.count, 0);
    const results = await Promise.allSettled([
      createBooking(db, { ...payload, requestId: randomUUID() }, userId),
      createBooking(db, { ...payload, requestId: randomUUID() }, userId),
    ]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    const rejected = results.find(result => result.status === 'rejected');
    assert.equal(rejected.reason.status, 409);
    assert.match(rejected.reason.message, /already been renewed/);
    await assert.rejects(assertAnnualPlanRenewal(stale, {
      renewalOfSeriesId: seriesId, customerId, packageId: payload.packageId, preferredDate: payload.preferredDate,
    }), error => error.status === 409 && /already been renewed/.test(error.message));
    const [[after]] = await db.execute('SELECT COUNT(*) AS count FROM annual_booking_series WHERE customer_id=?', [customerId]);
    assert.equal(after.count, 2);
  } finally {
    await stale.rollback();
    stale.release();
    const cleanup = await openPrivilegedFixtureConnection();
    try {
      for (const date of dates.filter(value => !originalLocks.has(value))) {
        await cleanup.execute('DELETE FROM service_day_capacity_lock WHERE service_date=?', [date]);
      }
    } finally { await cleanup.end(); }
  }
}, { committed: true }));
