import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import mysql from 'mysql2/promise';
import {
  approveBooking,
  rejectBooking,
  editRejectionReason,
  getAdminBooking,
  getAdminActionSummary,
  dispatchBooking,
  listAdminBookings,
  listAdminSchedule,
  listDispatchOptions,
  editTravelPlan,
  rescheduleAdminBooking,
} from '../server/admin-operations.mjs';
import { updateReturn } from '../server/return-visits.mjs';
import { expireSubmittedBookings } from '../server/order-expiry.mjs';
import {
  queueBooking,
  retryBookingEmail,
  listBookingEmails,
  getBookingPlanner,
  listAdminAudit,
  getOperationsOverview,
} from '../server/admin-workspace.mjs';

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

test('waiting dispatch preserves deadlines and customer status, is idempotent, and clears on dispatch', () =>
  fixture(async ({ c, db, actor, create }) => {
    const id = await create('Submitted', '2090-01-01 00:00:00');
    const input = {
      requestId: randomUUID(),
      reason: 'Waiting for suitable technician capacity',
    };
    assert.equal((await queueBooking(db, actor, id, input)).queued, true);
    assert.equal((await queueBooking(db, actor, id, input)).replayed, true);
    await assert.rejects(
      queueBooking(db, actor, id, { ...input, reason: 'A different reason' }),
      (e) => e.status === 409,
    );
    let detail = await getAdminBooking(db, id);
    assert.equal(detail.status, 'Submitted');
    assert.equal(detail.expiresAt, '2090-01-01 00:00:00');
    assert.ok(detail.waitingSince);
    assert.equal(detail.timeline.length, 1);
    assert.equal((await listBookingEmails(db, id)).rows.length, 0);
    assert.equal(
      (await listAdminBookings(db, { queue: 'waiting', q: String(id) })).rows[0]
        .bookingId,
      id,
    );
    assert.equal(
      (await listAdminBookings(db, { queue: 'review', q: String(id) })).rows
        .length,
      0,
    );
    await dispatchBooking(db, actor, id, { requestId: randomUUID() });
    detail = await getAdminBooking(db, id);
    assert.equal(detail.status, 'Assigned');
    assert.equal(detail.waitingSince, null);
    assert.equal(
      (await listAdminBookings(db, { queue: 'waiting', q: String(id) })).rows
        .length,
      0,
    );
    assert.equal((await listBookingEmails(db, id)).rows.length, 1);
    assert.equal((await listAdminAudit(db, { bookingId: id })).total, 2);
    assert.ok((await getOperationsOverview(db)).counts.waiting >= 0);
  }));

test('expired queued requests leave the active queue and cannot be queued again', () =>
  fixture(async ({ c, db, actor, create }) => {
    const id = await create();
    await queueBooking(db, actor, id, {
      requestId: randomUUID(),
      reason: 'Capacity unavailable',
    });
    await c.execute(
      "UPDATE booking SET expires_at='2000-01-01 00:00:00' WHERE booking_id=?",
      [id],
    );
    assert.equal(
      (await listAdminBookings(db, { queue: 'waiting', q: String(id) })).total,
      0,
    );
    await expireSubmittedBookings(db);
    await assert.rejects(
      queueBooking(db, actor, id, {
        requestId: randomUUID(),
        reason: 'Capacity unavailable',
      }),
      (e) => e.status === 409,
    );
    assert.equal((await getAdminBooking(db, id)).status, 'Expired');
    assert.equal((await listBookingEmails(db, id)).rows.length, 0);
  }));

test('final dispatch review rejects stale details and changed recommendations without side effects', () =>
  fixture(async ({ c, db, actor, create }) => {
    const id = await create();
    const options = await listDispatchOptions(db, id),
      tech = options.technicians.find((t) => t.eligible);
    assert.ok(tech);
    const review = {
      status: 'Submitted',
      date: options.preferredDate,
      timeSlot: options.timeSlot,
      travelBufferMinutes: options.travelBufferMinutes,
      technicianId: tech.technicianId,
    };
    await assert.rejects(
      dispatchBooking(db, actor, id, {
        requestId: randomUUID(),
        review: { ...review, travelBufferMinutes: 179 },
      }),
      (e) => e.status === 409 && /changed/.test(e.message),
    );
    await assert.rejects(
      dispatchBooking(db, actor, id, {
        requestId: randomUUID(),
        review: { ...review, technicianId: 999999999 },
      }),
      (e) =>
        e.status === 409 && /recommended technician changed/.test(e.message),
    );
    assert.equal((await getAdminBooking(db, id)).assignments.length, 0);
    assert.equal((await listBookingEmails(db, id)).rows.length, 0);
    const request = { requestId: randomUUID(), review };
    await dispatchBooking(db, actor, id, request);
    assert.equal(
      (await dispatchBooking(db, actor, id, request)).replayed,
      true,
    );
    await assert.rejects(
      dispatchBooking(db, actor, id, {
        ...request,
        review: { ...review, technicianId: 999999999 },
      }),
      (e) => e.status === 409,
    );
  }));

test('manual failed-mail retry reuses the message, rejects nonfailed deliveries and records one operation', () =>
  fixture(async ({ c, db, actor, create }) => {
    const id = await create();
    await dispatchBooking(db, actor, id, { requestId: randomUUID() });
    const [[mail]] = await c.execute(
      'SELECT * FROM booking_email_outbox WHERE booking_id=?',
      [id],
    );
    await assert.rejects(
      retryBookingEmail(db, actor, id, mail.email_id, {
        requestId: randomUUID(),
      }),
      (e) => e.status === 409,
    );
    await c.execute(
      "UPDATE booking_email_outbox SET delivery_mode='local',last_error='ECONNECTION',attempts=2,next_attempt_at='2090-01-01' WHERE email_id=?",
      [mail.email_id],
    );
    assert.equal((await listBookingEmails(db, id)).rows[0].canRetry, true);
    const input = { requestId: randomUUID() };
    await retryBookingEmail(db, actor, id, mail.email_id, input);
    assert.equal(
      (await retryBookingEmail(db, actor, id, mail.email_id, input)).replayed,
      true,
    );
    await assert.rejects(
      retryBookingEmail(db, actor, id, mail.email_id, {
        requestId: randomUUID(),
      }),
      (e) => e.status === 409,
    );
    const [[after]] = await c.execute(
      'SELECT * FROM booking_email_outbox WHERE email_id=?',
      [mail.email_id],
    );
    assert.equal(after.message_id, mail.message_id);
    assert.equal(after.event_key, mail.event_key);
    assert.equal(after.attempts, 2);
    assert.equal(after.last_error, null);
    assert.equal((await listBookingEmails(db, id)).rows.length, 1);
    assert.equal(
      (
        await listAdminAudit(db, {
          bookingId: id,
          action: 'Retry customer email',
        })
      ).total,
      1,
    );
    await c.execute(
      "UPDATE booking_email_outbox SET status='Sent',sent_at=NOW() WHERE email_id=?",
      [mail.email_id],
    );
    assert.equal((await listBookingEmails(db, id)).rows[0].canRetry, false);
  }));

test('weekly planner includes seven days, excludes closed and fully occupied choices, and never changes an appointment', () =>
  fixture(async ({ c, db, create }) => {
    const id = await create(),
      before = await getAdminBooking(db, id);
    const plan = await getBookingPlanner(db, id, { week: '2091-01-08' });
    assert.equal(plan.days.length, 7);
    assert.equal(plan.days.filter((day) => day.closed).length, 2);
    assert.ok(
      plan.days
        .filter((day) => day.closed)
        .every((day) => day.slots.every((slot) => !slot.available)),
    );
    assert.ok(
      plan.days.some((day) =>
        day.slots.some((slot) => slot.available && slot.eligibleCount > 0),
      ),
    );
    await c.execute("UPDATE technician SET availability_status='On Leave'");
    const full = await getBookingPlanner(db, id, { week: '2091-01-08' });
    assert.ok(
      full.days.every((day) => day.slots.every((slot) => !slot.available)),
    );
    const after = await getAdminBooking(db, id);
    assert.equal(after.preferredDate, before.preferredDate);
    assert.equal(after.timeSlot, before.timeSlot);
    assert.equal((await listBookingEmails(db, id)).rows.length, 0);
  }));
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

test('admin action centre exposes bounded direct order references and precise deadline and return queues', () =>
  fixture(async ({ c, db, actor, create }) => {
    const ids = [];
    for (let i = 0; i < 7; i++) {
      const id = await create();
      ids.push(id);
      await c.execute("UPDATE booking SET created_at='2001-01-01 00:00:00',expires_at=DATE_ADD(UTC_TIMESTAMP(),INTERVAL 6 HOUR) WHERE booking_id=?", [id]);
    }
    const outside = await create('Submitted', '2090-01-01 00:00:00');
    const summary = await getAdminActionSummary(db);
    assert.deepEqual(summary.items.submitted.map(row => row.bookingId), ids.slice(0, 5));
    assert.ok(summary.items.submitted.every(row => row.bookingReference.startsWith('BK-2001-') && row.customerName));
    assert.ok(Object.values(summary.items).every(rows => rows.length <= 5));
    assert.equal((await listAdminBookings(db, { queue: 'expiring', q: String(ids[0]) })).total, 1);
    assert.equal((await listAdminBookings(db, { queue: 'expiring', q: String(outside) })).total, 0);
    const [[tech]] = await c.execute('SELECT technician_id FROM technician ORDER BY technician_id LIMIT 1');
    const [assignment] = await c.execute("INSERT INTO assignment(booking_id,technician_id,assigned_by_admin_id,assignment_status) VALUES (?,?,?,'Assigned')", [outside, tech.technician_id, actor.userId]);
    const [work] = await c.execute("INSERT INTO work_order(booking_id,assignment_id,appointment_date,appointment_time,current_status) VALUES (?,?,'2091-01-08 09:00:00','09:00:00','Awaiting return arrangement')", [outside, assignment.insertId]);
    await c.execute("INSERT INTO service_progress(job_id,follow_up_status) VALUES (?,'Required')", [work.insertId]);
    assert.equal((await listAdminBookings(db, { queue: 'returns', q: String(outside) })).rows[0].bookingId, outside);
    await c.execute("UPDATE service_progress SET follow_up_status='Awaiting customer' WHERE job_id=?", [work.insertId]);
    assert.equal((await listAdminBookings(db, { queue: 'returns', q: String(outside) })).total, 0);
  }));

test('admin order changes reject both In Progress bookings and stale bookings with active work, without side effects', () =>
  fixture(async ({ c, db, actor, create }) => {
    const [[tech]] = await c.execute('SELECT technician_id FROM technician ORDER BY technician_id LIMIT 1');
    for (const status of ['In Progress', 'Submitted']) {
      const id = await create(status);
      const [assignment] = await c.execute("INSERT INTO assignment(booking_id,technician_id,assigned_by_admin_id,assignment_status) VALUES (?,?,?,'Assigned')", [id, tech.technician_id, actor.userId]);
      const [work] = await c.execute("INSERT INTO work_order(booking_id,assignment_id,appointment_date,appointment_time,current_status) VALUES (?,?,'2091-01-08 09:00:00','09:00:00','In Progress')", [id, assignment.insertId]);
      await c.execute("INSERT INTO service_progress(job_id,follow_up_status) VALUES (?,'Required')", [work.insertId]);
      await c.execute('UPDATE booking SET slot_start=NULL,slot_end=NULL WHERE booking_id=?', [id]);
      const [[before]] = await c.execute('SELECT * FROM booking WHERE booking_id=?', [id]);
      const actions = [
        () => approveBooking(db, actor, id, { requestId: randomUUID() }),
        () => dispatchBooking(db, actor, id, { requestId: randomUUID() }),
        () => dispatchBooking(db, actor, id, { requestId: randomUUID() }, { redispatch: true }),
        () => rejectBooking(db, actor, id, { requestId: randomUUID(), reason: 'No technician available.' }),
        () => editRejectionReason(db, actor, id, { requestId: randomUUID(), version: 1, reason: 'Updated reason.' }),
        () => editTravelPlan(db, actor, id, { requestId: randomUUID(), travelBufferMinutes: 60, trafficNote: 'Change blocked.' }),
        () => rescheduleAdminBooking(db, actor, id, { requestId: randomUUID(), preferredDate: '2091-01-09', timeSlot: '09:00 - 11:00' }),
        () => queueBooking(db, actor, id, { requestId: randomUUID(), reason: 'Change blocked.' }),
        () => updateReturn(db, 'admin', actor.userId, work.insertId, { requestId: randomUUID(), expectedVersion: 0, action: 'invite', customerMessage: 'Please choose another weekday.' }),
      ];
      for (const action of actions) await assert.rejects(action(), error => error.status === 409 && /in progress/.test(error.message));
      const [[after]] = await c.execute('SELECT * FROM booking WHERE booking_id=?', [id]);
      assert.deepEqual(after, before, 'blocked requests cannot even normalize a legacy appointment');
      assert.equal((await listAdminAudit(db, { bookingId: id })).total, 0);
      assert.equal((await getAdminBooking(db, id)).timeline.length, 0);
      assert.equal((await listBookingEmails(db, id)).rows.length, 0);
    }
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

test('submitted requests are listed oldest first regardless of appointment date', () =>
  fixture(async ({ c, db, create }) => {
    const oldest = await create(),
      newer = await create();
    await c.execute(
      "UPDATE booking SET created_at='1990-01-01 08:00:00',preferred_service_date='2091-01-20' WHERE booking_id=?",
      [oldest],
    );
    await c.execute(
      "UPDATE booking SET created_at='1990-01-02 08:00:00',preferred_service_date='2091-01-07' WHERE booking_id=?",
      [newer],
    );
    const result = await listAdminBookings(db, {
      status: 'Submitted',
      page: 1,
      pageSize: 100,
    });
    assert.equal(result.rows[0].bookingId, oldest);
    assert.equal(result.rows[1].bookingId, newer);
    const [[stored]] = await c.execute('SELECT UNIX_TIMESTAMP(created_at) AS epoch FROM booking WHERE booking_id=?', [oldest]);
    assert.equal(result.rows[0].createdAt, new Date(Number(stored.epoch) * 1000).toISOString());
  }));

test('admin report queue identifies the responsible technician until finished and return-visit reports are submitted', () =>
  fixture(async ({ c, db, actor, create }) => {
    const baseline = (await getAdminActionSummary(db)).pendingReports;
    const [[technician]] = await c.execute(`SELECT t.technician_id,u.full_name FROM technician t
      JOIN user_account u ON u.user_id=t.user_id ORDER BY t.technician_id LIMIT 1`);
    const jobs = [];
    for (const status of ['Completed', 'Awaiting return arrangement', 'In Progress']) {
      const bookingId = await create(status === 'Completed' ? 'Completed' : 'In Progress');
      const [assignment] = await c.execute(`INSERT INTO assignment(booking_id,technician_id,assigned_by_admin_id,assignment_status)
        VALUES (?,?,?,'Assigned')`, [bookingId, technician.technician_id, actor.userId]);
      const [work] = await c.execute(`INSERT INTO work_order(booking_id,assignment_id,appointment_date,appointment_time,current_status)
        VALUES (?,?,'2091-01-08 09:00:00','09:00:00',?)`, [bookingId, assignment.insertId, status]);
      if (status !== 'Completed') await c.execute("INSERT INTO service_report(job_id,work_performed,submitted_time) VALUES (?,'Draft report.',NULL)", [work.insertId]);
      jobs.push({ bookingId, jobId: work.insertId });
    }
    assert.equal((await getAdminActionSummary(db)).pendingReports, baseline + 2);
    for (const item of jobs.slice(0, 2)) {
      const queue = await listAdminBookings(db, { queue: 'reports', q: String(item.bookingId) });
      assert.equal(queue.total, 1);
      assert.equal(queue.rows[0].reportPending, true);
      assert.equal(queue.rows[0].pendingReportJobId, item.jobId);
      assert.equal(queue.rows[0].pendingReportTechnicianName, technician.full_name);
      const detail = await getAdminBooking(db, item.bookingId);
      assert.equal(detail.reportPending, true);
      assert.equal(detail.pendingReportTechnicianName, technician.full_name);
    }
    assert.equal((await getAdminBooking(db, jobs[0].bookingId)).reportId, null, 'missing historical reports still require follow-up');
    assert.equal((await listAdminBookings(db, { queue: 'reports', q: String(jobs[2].bookingId) })).total, 0, 'a live draft is not an overdue report');
    for (const item of jobs.slice(0, 2)) {
      await c.execute(`INSERT INTO service_report(job_id,work_performed,submitted_time)
        VALUES (?,'Submitted report for isolated queue validation.',CURRENT_TIMESTAMP)
        ON DUPLICATE KEY UPDATE submitted_time=CURRENT_TIMESTAMP`, [item.jobId]);
      assert.equal((await listAdminBookings(db, { queue: 'reports', q: String(item.bookingId) })).total, 0);
      assert.equal((await getAdminBooking(db, item.bookingId)).reportPending, false);
    }
    assert.equal((await getAdminActionSummary(db)).pendingReports, baseline);
  }));

test('admin timestamps preserve their instants across database session timezone changes', () =>
  fixture(async ({ c, db, actor, create }) => {
    const [[session]] = await c.execute('SELECT @@session.time_zone AS zone');
    try {
      await c.query("SET SESSION time_zone='+00:00'");
      const bookingId = await create('Confirmed');
      await c.execute("UPDATE booking SET created_at='2026-10-20 01:02:03' WHERE booking_id=?", [bookingId]);
      await c.execute(`INSERT INTO booking_status_history(booking_id,new_status,changed_by_user_id,change_note,changed_at)
        VALUES (?,'Confirmed',?,'Timezone test.','2026-10-20 02:03:04')`, [bookingId, actor.userId]);
      const [[technician]] = await c.execute('SELECT technician_id FROM technician ORDER BY technician_id LIMIT 1');
      await c.execute(`INSERT INTO assignment(booking_id,technician_id,assigned_by_admin_id,assignment_status,assigned_at)
        VALUES (?,?,?,'Assigned','2026-10-20 03:04:05')`, [bookingId, technician.technician_id, actor.userId]);
      for (const zone of ['+08:00', '-05:00']) {
        await c.query('SET SESSION time_zone=?', [zone]);
        const detail = await getAdminBooking(db, bookingId);
        assert.equal(detail.createdAt, '2026-10-20T01:02:03.000Z');
        assert.equal(detail.timeline[0].changedAt, '2026-10-20T02:03:04.000Z');
        assert.equal(detail.assignments[0].assignedAt, '2026-10-20T03:04:05.000Z');
        assert.equal((await listAdminBookings(db, { q: String(bookingId) })).rows[0].createdAt, detail.createdAt);
        assert.equal((await listAdminSchedule(db, { from: '2091-01-08', to: '2091-01-08' })).rows.find(row => row.bookingId === bookingId).createdAt, detail.createdAt);
      }
    } finally {
      await c.query('SET SESSION time_zone=?', [session.zone]);
    }
  }));

test('a submitted request stays unconfirmed when no technician can be assigned', () =>
  fixture(async ({ c, db, actor, create }) => {
    const bookingId = await create();
    await c.execute("UPDATE technician SET availability_status='On Leave'");
    await assert.rejects(
      dispatchBooking(db, actor, bookingId, { requestId: randomUUID() }),
      (error) =>
        error.status === 409 &&
        /No technician is available/.test(error.message),
    );
    const [[booking]] = await c.execute(
      'SELECT booking_status AS status FROM booking WHERE booking_id=?',
      [bookingId],
    );
    const [[sideEffects]] = await c.execute(
      `SELECT
        (SELECT COUNT(*) FROM assignment WHERE booking_id=?) AS assignments,
        (SELECT COUNT(*) FROM booking_email_outbox WHERE booking_id=?) AS emails,
        (SELECT COUNT(*) FROM booking_status_history WHERE booking_id=? AND new_status='Confirmed') AS confirmations`,
      [bookingId, bookingId, bookingId],
    );
    assert.equal(booking.status, 'Submitted');
    assert.deepEqual(
      [
        Number(sideEffects.assignments),
        Number(sideEffects.emails),
        Number(sideEffects.confirmations),
      ],
      [0, 0, 0],
    );
  }));
