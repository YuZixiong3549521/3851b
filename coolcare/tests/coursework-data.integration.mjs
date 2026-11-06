import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { openPrivilegedFixtureConnection } from './privileged-fixture.mjs';
import { appendCourseworkData } from '../database/coursework-data.mjs';
import { runCourseworkImport } from '../scripts/coursework-import.mjs';
import { singaporeToday } from '../server/customer/booking-schedule.mjs';
import { getAdminBooking } from '../server/admin-operations.mjs';
import { getAdminAnnualPlan } from '../server/customer/plans.mjs';
import { commerceReport } from '../server/commerce.mjs';
import { listPerformance } from '../server/performance.mjs';

const unchangedTables = {
  user_account: 'user_id', customer: 'customer_id', technician: 'technician_id',
  service_address: 'address_id', aircon_unit: 'unit_id', booking: 'booking_id',
  annual_booking_series: 'series_id', assignment: 'assignment_id', work_order: 'job_id',
  service_report: 'report_id', loyalty_account: 'loyalty_account_id',
  loyalty_transaction: 'loyalty_transaction_id', inventory_transaction: 'transaction_id',
  booking_email_outbox: 'email_id', service_catalog: 'service_id', maintenance_package: 'package_id',
};
const digest = row => createHash('sha256').update(JSON.stringify(row)).digest('hex');
const placeholders = ids => ids.map(() => '?').join(',');

async function snapshot(c) {
  const result = {};
  for (const [table, key] of Object.entries(unchangedTables)) {
    const [rows] = await c.query(`SELECT * FROM ${table} ORDER BY ${key}`);
    result[table] = new Map(rows.map(row => [row[key], digest(row)]));
  }
  const [parts] = await c.query('SELECT * FROM part ORDER BY part_id');
  result.parts = parts;
  return result;
}

async function assertPreserved(c, before) {
  for (const [table, key] of Object.entries(unchangedTables)) {
    const [rows] = await c.query(`SELECT * FROM ${table} ORDER BY ${key}`);
    const current = new Map(rows.map(row => [row[key], digest(row)]));
    for (const [id, fingerprint] of before[table]) assert.equal(current.get(id), fingerprint, `existing ${table} ${id} must be unchanged`);
    if (['booking_email_outbox', 'service_catalog', 'maintenance_package'].includes(table)) assert.equal(current.size, before[table].size, `${table} must not grow`);
  }
}

async function fixture(work) {
  if (!['localhost', '127.0.0.1', '::1'].includes(process.env.DB_HOST)) throw new Error('Coursework integration tests require the local database.');
  const c = await openPrivilegedFixtureConnection();
  try {
    await c.query("SET time_zone='+00:00'");
    await c.beginTransaction();
    const [[actor]] = await c.query("SELECT a.user_id FROM admin_profile a JOIN user_account u ON u.user_id=a.user_id WHERE u.status='Active' ORDER BY a.access_level='Owner' DESC,a.user_id LIMIT 1");
    assert.ok(actor, 'local setup must provide an administrator');
    await work(c, actor.user_id);
  } finally {
    await c.rollback();
    await c.end();
  }
}

test('coursework append preserves existing records and creates coherent orders, reports, rewards, plans and stock', () => fixture(async (c, actorUserId) => {
  const before = await snapshot(c);
  const asOf = singaporeToday();
  const result = await appendCourseworkData(c, { asOf, batchKey: `test-${randomUUID()}`, actorUserId, requestId: randomUUID() });
  assert.equal(result.ids.bookingIds.length, 50);
  assert.equal(result.ids.seriesIds.length, 3);
  await assertPreserved(c, before);
  const bookingIds = result.ids.bookingIds;
  const inBookings = placeholders(bookingIds);
  const [bookings] = await c.execute(`SELECT * FROM booking WHERE booking_id IN (${inBookings})`, bookingIds);
  assert.equal(bookings.length, 50);
  const completedIds = bookings.filter(row => row.booking_status === 'Completed').map(row => row.booking_id);
  assert.ok(completedIds.length >= 20);

  const [badOwners] = await c.execute(`SELECT b.booking_id FROM booking b JOIN service_address a ON a.address_id=b.address_id
    JOIN booking_aircon_unit bu ON bu.booking_id=b.booking_id JOIN aircon_unit u ON u.unit_id=bu.unit_id
    WHERE b.booking_id IN (${inBookings}) AND (a.customer_id<>b.customer_id OR u.customer_id<>b.customer_id OR u.address_id<>b.address_id)`, bookingIds);
  assert.equal(badOwners.length, 0, 'bookings, addresses and units must have the same customer');
  const [badServices] = await c.execute(`SELECT b.booking_id FROM booking b LEFT JOIN booking_service s ON s.booking_id=b.booking_id WHERE b.booking_id IN (${inBookings}) GROUP BY b.booking_id HAVING COUNT(s.service_id)=0`, bookingIds);
  assert.equal(badServices.length, 0, 'each booking needs a service snapshot');
  const [badPlans] = await c.execute(`SELECT s.series_id FROM annual_booking_series s LEFT JOIN annual_booking_visit v ON v.series_id=s.series_id LEFT JOIN booking b ON b.booking_id=v.booking_id
    WHERE s.series_id IN (${placeholders(result.ids.seriesIds)}) GROUP BY s.series_id,s.total_amount HAVING COUNT(v.booking_id)<>4 OR COUNT(DISTINCT v.visit_number)<>4 OR ABS(SUM(b.total_amount)-s.total_amount)>0.005`, result.ids.seriesIds);
  assert.equal(badPlans.length, 0, 'four quarterly prices reconcile to each annual plan');
  const [badWindows] = await c.execute(`SELECT v.booking_id FROM annual_booking_visit v JOIN booking b ON b.booking_id=v.booking_id WHERE v.booking_id IN (${inBookings}) AND (v.scheduled_date<>b.preferred_service_date OR b.preferred_service_date<v.window_start OR b.preferred_service_date>v.window_end)`, bookingIds);
  assert.equal(badWindows.length, 0, 'annual visits must fall within their saved quarterly windows');
  const [duplicateCleaning] = await c.execute(`SELECT b.customer_id,b.address_id,YEARWEEK(b.preferred_service_date,3) AS week_key FROM booking b
    WHERE b.booking_id IN (${inBookings}) AND b.booking_status NOT IN ('Cancelled','Rejected','Expired')
    AND EXISTS(SELECT 1 FROM booking_service bs JOIN service_catalog sc ON sc.service_id=bs.service_id WHERE bs.booking_id=b.booking_id AND sc.service_name LIKE '%Cleaning%')
    GROUP BY b.customer_id,b.address_id,YEARWEEK(b.preferred_service_date,3) HAVING COUNT(*)>1`, bookingIds);
  assert.equal(duplicateCleaning.length, 0, 'sample data must respect the same address/week cleaning rule');

  const [complete] = await c.execute(`SELECT b.booking_id,r.report_id,r.started_at,r.completed_at,r.submitted_time,r.visit_technician_id,
    p.technician_id,p.actual_start,p.actual_end,cr.outcome,cr.gross_amount,cr.base_amount,cr.additional_fee,cr.net_amount,cr.awarded_points,cr.completed_at AS reward_completed_at
    FROM booking b LEFT JOIN work_order w ON w.booking_id=b.booking_id LEFT JOIN service_report r ON r.job_id=w.job_id
    LEFT JOIN performance_visit p ON p.report_id=r.report_id LEFT JOIN booking_completion_reward cr ON cr.booking_id=b.booking_id
    WHERE b.booking_id IN (${placeholders(completedIds)})`, completedIds);
  assert.equal(complete.length, completedIds.length);
  for (const row of complete) {
    assert.ok(row.report_id && row.submitted_time && row.started_at && row.completed_at, `completed booking ${row.booking_id} needs its own submitted report`);
    assert.equal(row.visit_technician_id, row.technician_id);
    assert.equal(row.started_at, row.actual_start);
    assert.equal(row.completed_at, row.actual_end);
    assert.ok(row.completed_at >= row.started_at);
    assert.ok(row.reward_completed_at, 'analytics need the actual completion timestamp');
    assert.equal(row.outcome, 'Awarded');
    assert.ok(Math.abs(row.gross_amount - row.base_amount - row.additional_fee) < 0.005);
    assert.ok(row.net_amount >= 0 && row.awarded_points >= 0);
  }
  const [badTeam] = await c.execute(`SELECT a.assignment_id FROM assignment a JOIN work_order w ON w.assignment_id=a.assignment_id
    LEFT JOIN assignment_member m ON m.assignment_id=a.assignment_id WHERE w.booking_id IN (${inBookings}) GROUP BY a.assignment_id,a.technician_id HAVING COUNT(m.technician_id)=0 OR SUM(m.technician_id=a.technician_id)<>1`, bookingIds);
  assert.equal(badTeam.length, 0, 'each work order must retain its team and lead');
  const [badVisitTeam] = await c.execute(`SELECT r.report_id FROM service_report r JOIN work_order w ON w.job_id=r.job_id
    LEFT JOIN visit_member vm ON vm.report_id=r.report_id WHERE w.booking_id IN (${inBookings}) GROUP BY r.report_id,r.visit_technician_id HAVING COUNT(vm.technician_id)=0 OR SUM(vm.is_lead)<>1 OR SUM(vm.is_lead AND vm.technician_id=r.visit_technician_id)<>1`, bookingIds);
  assert.equal(badVisitTeam.length, 0);
  const [feedback] = await c.execute(`SELECT f.* FROM performance_feedback f JOIN service_report r ON r.report_id=f.report_id JOIN work_order w ON w.job_id=r.job_id WHERE w.booking_id IN (${inBookings})`, bookingIds);
  assert.ok(feedback.length >= 10, 'performance demonstrations need multiple reviews');
  for (const review of feedback) assert.match(review.comment, /synthetic/i, 'sample reviews must be explicitly identified');

  const orderView = await getAdminBooking(c, completedIds[0]);
  assert.equal(orderView.status, 'Completed');
  assert.ok(orderView.team.length >= 1);
  assert.equal(orderView.reports.length, 1, 'the actual Admin detail reader must expose the sample report');
  assert.equal(orderView.amounts.isFinal, true);
  assert.equal(orderView.reports[0].customerSignatureUrl, null, 'sample import must not invent signatures');
  assert.equal(orderView.reports[0].technicianSignatureUrl, null);
  assert.deepEqual(orderView.reports[0].photos, [], 'sample import must not invent uploaded evidence');
  for (const seriesId of result.ids.seriesIds) {
    const planView = await getAdminAnnualPlan(c, seriesId);
    assert.equal(planView.visits.length, 4, 'the actual annual-plan reader must expose four connected visits');
  }
  const performanceView = await listPerformance(c, { id: actorUserId, role: 'Admin' }, { reportId: feedback[0].report_id });
  assert.ok(performanceView.visits.length >= 1);
  assert.equal(performanceView.visits[0].stars, feedback[0].stars, 'ratings must reach the Admin performance read model');
  const from = bookings.filter(row => row.booking_status === 'Completed').map(row => row.preferred_service_date).sort()[0];
  const reportView = await commerceReport(c, { from, to: asOf, dateBasis: 'completed', groupBy: 'year' });
  const importedCompleted = reportView.orders.filter(row => completedIds.includes(row.bookingId));
  assert.equal(importedCompleted.length, completedIds.length, 'all completed synthetic orders must appear under actual-completion analytics');
  for (const order of importedCompleted) assert.ok(order.serviceAmount !== null && order.completedDate, 'analytics should use real stored snapshots');

  const [wallets] = await c.execute(`SELECT a.loyalty_account_id,a.current_points,COALESCE(SUM(t.points),0) AS ledger_points FROM loyalty_account a LEFT JOIN loyalty_transaction t ON t.loyalty_account_id=a.loyalty_account_id
    WHERE a.customer_id IN (${placeholders(result.ids.customerIds)}) GROUP BY a.loyalty_account_id,a.current_points`, result.ids.customerIds);
  assert.ok(wallets.length > 0);
  for (const wallet of wallets) assert.equal(Number(wallet.current_points), Number(wallet.ledger_points), 'reward balances must reconcile with the point ledger');

  const [afterParts] = await c.query('SELECT * FROM part ORDER BY part_id');
  assert.equal(afterParts.length, before.parts.length, 'reuse existing parts without creating duplicate catalogue entries');
  const [newStock] = await c.execute(`SELECT part_id,SUM(CASE WHEN transaction_type IN ('Stock In','Return') THEN quantity WHEN transaction_type='Stock Out' THEN -quantity ELSE 0 END) AS delta FROM inventory_transaction WHERE transaction_id IN (${placeholders(result.ids.inventoryTransactionIds)}) GROUP BY part_id`, result.ids.inventoryTransactionIds);
  const deltas = new Map(newStock.map(row => [row.part_id, Number(row.delta)]));
  for (const old of before.parts) {
    const current = afterParts.find(part => part.part_id === old.part_id);
    assert.equal(Number(current.current_stock), Number(old.current_stock) + (deltas.get(old.part_id) || 0));
    assert.ok(current.current_stock >= 0);
    const { current_stock: oldStock, ...oldFields } = old;
    const { current_stock: newStock, ...newFields } = current;
    assert.equal(digest(newFields), digest(oldFields), 'stock changes must not rewrite part definitions');
  }
}));

test('coursework import defaults to rollback, applies only once and rejects changed replay inputs', () => fixture(async (c, actorUserId) => {
  const before = await snapshot(c);
  let savepoint = 0;
  let currentSavepoint;
  const nested = {
    execute: c.execute.bind(c), query: c.query.bind(c),
    beginTransaction: () => { currentSavepoint = `coursework_test_${++savepoint}`; return c.query(`SAVEPOINT ${currentSavepoint}`); },
    commit: () => c.query(`RELEASE SAVEPOINT ${currentSavepoint}`),
    rollback: () => c.query(`ROLLBACK TO SAVEPOINT ${currentSavepoint}`),
  };
  const options = { batchKey: `test-${randomUUID()}`, asOf: singaporeToday(), actorUserId };
  const preview = await runCourseworkImport(nested, options);
  assert.equal(preview.dryRun, true);
  assert.equal(preview.alreadyImported, false);
  await assertPreserved(c, before);
  const [[afterPreview]] = await c.query('SELECT COUNT(*) AS n FROM booking');
  assert.equal(Number(afterPreview.n), before.booking.size, 'preview must not retain synthetic bookings');
  let injected = false;
  const interrupted = {
    ...nested,
    execute: (sql, values) => {
      if (/INSERT\s+INTO\s+service_report\b/i.test(sql)) {
        injected = true;
        throw new Error('Injected coursework report failure');
      }
      return c.execute(sql, values);
    },
  };
  await assert.rejects(runCourseworkImport(interrupted, { ...options, dryRun: false }), /Injected coursework report failure/);
  assert.equal(injected, true, 'failure should occur after some records were written');
  const [[afterFailure]] = await c.query('SELECT COUNT(*) AS n FROM booking');
  assert.equal(Number(afterFailure.n), before.booking.size, 'a mid-import failure must roll back every new booking');
  await assertPreserved(c, before);
  const applied = await runCourseworkImport(nested, { ...options, dryRun: false });
  assert.equal(applied.dryRun, false);
  assert.equal(applied.alreadyImported, false);
  const replayed = await runCourseworkImport(nested, { ...options, dryRun: false });
  assert.equal(replayed.alreadyImported, true);
  assert.deepEqual(replayed.ids, applied.ids);
  const replayWithoutDate = await runCourseworkImport(nested, { batchKey: options.batchKey, actorUserId, dryRun: false });
  assert.equal(replayWithoutDate.alreadyImported, true);
  assert.equal(replayWithoutDate.asOf, options.asOf, 'retry without a date must preserve the original dated batch');
  const [[afterReplay]] = await c.query('SELECT COUNT(*) AS n FROM booking');
  assert.equal(Number(afterReplay.n), before.booking.size + 50, 'retry must not duplicate the import');
  await assert.rejects(runCourseworkImport(nested, { ...options, asOf: '2004-01-05', dryRun: false }));
  await assertPreserved(c, before);
}));
