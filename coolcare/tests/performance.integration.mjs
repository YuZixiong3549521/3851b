import { arrangeVisitForNow } from './service-visit-fixture.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { openPrivilegedFixtureConnection } from './privileged-fixture.mjs';
import {
  capturePerformanceVisitEnd,
  listPerformance,
  listPendingCustomerFeedback,
  writePerformance,
  getPerformanceSettings,
} from '../server/performance.mjs';
import { updateTechnicianJobStatus } from '../server/technician.mjs';
import { createApp } from '../server/app.mjs';

async function fixture(fn) {
  const c = await openPrivilegedFixtureConnection();
  await c.beginTransaction();
  const h = {
    execute: c.execute.bind(c),
    query: c.query.bind(c),
    beginTransaction: () => c.query('SAVEPOINT performance_write'),
    commit: () => c.query('RELEASE SAVEPOINT performance_write'),
    rollback: () => c.query('ROLLBACK TO SAVEPOINT performance_write'),
    release() {},
  };
  const db = { ...h, getConnection: async () => h };
  try {
    const [[a]] =
      await c.execute(`SELECT w.job_id AS jobId,w.booking_id AS bookingId,w.assignment_id AS assignmentId,
      t.technician_id AS technicianId,t.user_id AS technicianUserId,cu.user_id AS customerUserId
      FROM work_order w JOIN assignment a ON a.assignment_id=w.assignment_id JOIN technician t ON t.technician_id=a.technician_id
      JOIN booking b ON b.booking_id=w.booking_id JOIN customer cu ON cu.customer_id=b.customer_id
      JOIN user_account u ON u.user_id=t.user_id WHERE u.status='Active' LIMIT 1`);
    assert.ok(a, 'A sample work order is required');
    const [[admin]] = await c.execute(
      "SELECT ap.user_id AS id FROM admin_profile ap JOIN user_account u ON u.user_id=ap.user_id WHERE u.status='Active' LIMIT 1",
    );
    a.admin = { ...admin, role: 'Admin' };
    a.customer = { id: a.customerUserId, role: 'Customer' };
    a.technician = { id: a.technicianUserId, role: 'Technician' };
    // New report, independent of whichever production sample happened to be selected.
    await c.execute(
      'UPDATE service_report SET archived_job_id=job_id,job_id=NULL WHERE job_id=?',
      [a.jobId],
    );
    await c.execute(
      `UPDATE work_order SET current_status='Assigned',
      appointment_date=DATE_SUB(DATE_ADD(UTC_TIMESTAMP(),INTERVAL 8 HOUR),INTERVAL 10 MINUTE),
      appointment_time=TIME(DATE_SUB(DATE_ADD(UTC_TIMESTAMP(),INTERVAL 8 HOUR),INTERVAL 10 MINUTE)) WHERE job_id=?`,
      [a.jobId],
    );
    await c.execute(
      "UPDATE assignment SET assignment_status='Accepted' WHERE assignment_id=?",
      [a.assignmentId],
    );
    await c.execute(
      "UPDATE booking SET booking_status='Assigned' WHERE booking_id=?",
      [a.bookingId],
    );
    await arrangeVisitForNow(c, a.jobId);
    await c.execute(
      'UPDATE work_order SET appointment_time=TIME(DATE_ADD(UTC_TIMESTAMP(),INTERVAL 8 HOUR)) WHERE job_id=?',
      [a.jobId],
    );
    await updateTechnicianJobStatus(db, a.technicianUserId, a.jobId, {
      requestId: randomUUID(),
      expectedStatus: 'Assigned',
      status: 'In Progress',
    });
    const [[report]] = await c.execute(
      'SELECT report_id AS reportId FROM service_report WHERE job_id=?',
      [a.jobId],
    );
    a.reportId = report.reportId;
    const [[today]] = await c.execute(
      "SELECT DATE_FORMAT(DATE_ADD(UTC_TIMESTAMP(),INTERVAL 8 HOUR),'%Y-%m-%d') AS today",
    );
    a.filter = { from: today.today, to: today.today };
    a.complete = () =>
      updateTechnicianJobStatus(db, a.technicianUserId, a.jobId, {
        requestId: randomUUID(),
        expectedStatus: 'In Progress',
        status: 'Completed',
      });
    await fn(db, c, a);
  } finally {
    await c.rollback();
    await c.end();
  }
}

test('performance captures real visit start/end and ownership, with independent feedback and admin quality audits', () =>
  fixture(async (db, c, a) => {
    const feedback = {
      requestId: randomUUID(),
      expectedVersion: 0,
      stars: 5,
      comment: 'Careful service with a clear explanation.',
    };
    await assert.rejects(
      writePerformance(
        db,
        a.customer,
        a.reportId,
        'Customer feedback',
        feedback,
      ),
      (e) => e.status === 409,
    );
    await a.complete();
    const [[captured]] = await c.execute(
      'SELECT * FROM performance_visit WHERE report_id=?',
      [a.reportId],
    );
    assert.ok(captured.scheduled_start);
    const [[scheduled]] = await c.execute(
      "SELECT DATE_FORMAT(appointment_date,'%Y-%m-%d') AS day,appointment_time AS time FROM work_order WHERE job_id=?",
      [a.jobId],
    );
    assert.equal(
      captured.scheduled_start,
      `${scheduled.day} ${scheduled.time}`,
      'appointment_date may already contain a time; never add it twice',
    );
    assert.ok(captured.actual_start);
    assert.ok(captured.actual_end);
    assert.equal(captured.technician_id, a.technicianId);
    assert.equal(captured.outcome, 'Completed');
    assert.equal(
      (
        await writePerformance(
          db,
          a.customer,
          a.reportId,
          'Customer feedback',
          feedback,
        )
      ).version,
      1,
    );
    assert.equal(
      (
        await writePerformance(
          db,
          a.customer,
          a.reportId,
          'Customer feedback',
          feedback,
        )
      ).replayed,
      true,
    );
    await assert.rejects(
      writePerformance(db, a.customer, a.reportId, 'Customer feedback', {
        ...feedback,
        stars: 3,
      }),
      (e) => e.status === 409,
    );
    await assert.rejects(
      writePerformance(
        db,
        { id: 4294967295, role: 'Customer' },
        a.reportId,
        'Customer feedback',
        { ...feedback, requestId: randomUUID() },
      ),
      (e) => e.status === 404,
    );
    await assert.rejects(
      writePerformance(db, a.admin, a.reportId, 'Customer feedback', feedback),
      (e) => e.status === 403,
    );
    const quality = {
      requestId: randomUUID(),
      expectedVersion: 0,
      score: 85,
      reason: 'Report evidence shows all planned checks were completed.',
    };
    await writePerformance(
      db,
      a.admin,
      a.reportId,
      'Quality assessment',
      quality,
    );
    assert.equal(
      (
        await writePerformance(
          db,
          a.admin,
          a.reportId,
          'Quality assessment',
          quality,
        )
      ).replayed,
      true,
    );
    await assert.rejects(
      writePerformance(
        db,
        a.technician,
        a.reportId,
        'Quality assessment',
        quality,
      ),
      (e) => e.status === 403,
    );
    await writePerformance(db, a.customer, a.reportId, 'Customer feedback', {
      ...feedback,
      requestId: randomUUID(),
      expectedVersion: 1,
      stars: 4,
      comment: 'Added feedback after testing the system.',
    });
    await assert.rejects(
      writePerformance(db, a.customer, a.reportId, 'Customer feedback', {
        ...feedback,
        requestId: randomUUID(),
      }),
      (e) => e.status === 409,
    );
    const admin = await listPerformance(db, a.admin, a.filter),
      row = admin.visits.find((v) => v.reportId === a.reportId);
    assert.equal(row.stars, 4);
    assert.equal(row.qualityScore, 85);
    assert.equal(row.feedbackVersion, 2);
    assert.equal(row.qualityVersion, 1);
    assert.equal(row.punctualityScore, 100);
    const customer = (
      await listPerformance(db, a.customer, a.filter)
    ).visits.find((v) => v.reportId === a.reportId);
    assert.equal(customer.stars, 4);
    assert.equal('qualityScore' in customer, false);
    assert.equal('workPerformed' in customer, false);
    const technicianReview = (
      await listPerformance(db, a.technician, { reportId: a.reportId })
    ).visits[0];
    assert.equal(technicianReview.stars, 4);
    assert.equal(
      technicianReview.comment,
      'Added feedback after testing the system.',
    );
    assert.equal(technicianReview.feedbackVersion, 2);
    assert.equal(
      (
        await listPerformance(
          db,
          { id: 4294967295, role: 'Technician' },
          a.filter,
        )
      ).visits.length,
      0,
    );
    const [[count]] = await c.execute(
      'SELECT COUNT(*) AS n FROM performance_operation WHERE report_id=?',
      [a.reportId],
    );
    assert.equal(count.n, 3);
  }));

test('completed-service reminders include pending reports and old visits, respect ownership and disappear after rating', () =>
  fixture(async (db, c, a) => {
    const query = { bookingId: a.bookingId };
    const initially = await listPendingCustomerFeedback(db, a.customer, query);
    assert.equal(
      initially.visits.some((v) => v.reportId === a.reportId),
      false,
    );
    await a.complete();
    // Reminders and their direct links must not silently expire at 90 days.
    await c.execute(
      "UPDATE performance_visit SET actual_end='2020-01-08 10:00:00' WHERE report_id=?",
      [a.reportId],
    );
    const reminder = await listPendingCustomerFeedback(db, a.customer, query);
    const visit = reminder.visits.find((v) => v.reportId === a.reportId);
    assert.ok(visit);
    assert.equal(visit.reportSubmitted, false);
    assert.match(visit.bookingReference, /^BK-\d{4}-\d+$/);
    const direct = await listPerformance(db, a.customer, {
      reportId: a.reportId,
    });
    assert.equal(direct.visits.length, 1);
    assert.equal(direct.visits[0].reportId, a.reportId);
    assert.equal(
      (
        await listPerformance(
          db,
          { id: 4294967295, role: 'Customer' },
          { reportId: a.reportId },
        )
      ).visits.length,
      0,
    );
    assert.deepEqual(
      await listPendingCustomerFeedback(
        db,
        { id: 4294967295, role: 'Customer' },
        query,
      ),
      { count: 0, visits: [] },
    );
    await assert.rejects(
      listPendingCustomerFeedback(db, a.technician, query),
      (e) => e.status === 403,
    );
    await writePerformance(db, a.customer, a.reportId, 'Customer feedback', {
      requestId: randomUUID(),
      expectedVersion: 0,
      stars: 5,
      comment: 'A helpful completed visit.',
    });
    const after = await listPendingCustomerFeedback(db, a.customer, query);
    assert.equal(after.count, reminder.count - 1);
    assert.equal(
      after.visits.some((v) => v.reportId === a.reportId),
      false,
    );
    const tech = await listPerformance(db, a.technician, {
      reportId: a.reportId,
    });
    assert.equal(tech.visits[0].comment, 'A helpful completed visit.');
    assert.equal(
      (
        await listPerformance(
          db,
          { id: 4294967295, role: 'Technician' },
          { reportId: a.reportId },
        )
      ).visits.length,
      0,
    );
  }));

test('reassignment and return visit never move a previous report score onto a new technician', () =>
  fixture(async (db, c, a) => {
    await a.complete();
    const [[other]] = await c.execute(
      `SELECT t.technician_id AS id,t.user_id AS userId FROM technician t
    JOIN user_account u ON u.user_id=t.user_id WHERE t.technician_id<>? AND u.status='Active' LIMIT 1`,
      [a.technicianId],
    );
    assert.ok(other);
    const [[before]] = await c.execute(
      'SELECT * FROM performance_visit WHERE report_id=?',
      [a.reportId],
    );
    await c.execute(
      'UPDATE assignment SET technician_id=? WHERE assignment_id=?',
      [other.id, a.assignmentId],
    );
    await c.execute(
      "UPDATE work_order SET current_status='Return visit',appointment_time='15:00:00' WHERE job_id=?",
      [a.jobId],
    );
    await arrangeVisitForNow(c, a.jobId);
    await c.execute(
      'UPDATE work_order SET appointment_time=TIME(DATE_ADD(UTC_TIMESTAMP(),INTERVAL 8 HOUR)) WHERE job_id=?',
      [a.jobId],
    );
    await updateTechnicianJobStatus(db, other.userId, a.jobId, {
      requestId: randomUUID(),
      expectedStatus: 'Return visit',
      status: 'In Progress',
    });
    const [[active]] = await c.execute(
      'SELECT report_id AS reportId FROM service_report WHERE job_id=?',
      [a.jobId],
    );
    assert.notEqual(active.reportId, a.reportId);
    await updateTechnicianJobStatus(db, other.userId, a.jobId, {
      requestId: randomUUID(),
      expectedStatus: 'In Progress',
      status: 'Completed',
    });
    const oldRows = (
      await listPerformance(db, a.technician, a.filter)
    ).visits.filter(
      (v) => v.reportId === a.reportId || v.reportId === active.reportId,
    );
    assert.deepEqual(
      oldRows.map((v) => v.reportId),
      [a.reportId],
    );
    const newRows = (
      await listPerformance(
        db,
        { id: other.userId, role: 'Technician' },
        a.filter,
      )
    ).visits.filter(
      (v) => v.reportId === a.reportId || v.reportId === active.reportId,
    );
    assert.deepEqual(
      newRows.map((v) => v.reportId),
      [active.reportId],
    );
    const [[after]] = await c.execute(
      'SELECT * FROM performance_visit WHERE report_id=?',
      [a.reportId],
    );
    assert.deepEqual(after, before);
    await writePerformance(db, a.customer, a.reportId, 'Customer feedback', {
      requestId: randomUUID(),
      expectedVersion: 0,
      stars: 4,
      comment: 'First visit feedback.',
    });
    await writePerformance(
      db,
      a.customer,
      active.reportId,
      'Customer feedback',
      {
        requestId: randomUUID(),
        expectedVersion: 0,
        stars: 5,
        comment: 'Return visit feedback.',
      },
    );
    const [[count]] = await c.execute(
      'SELECT COUNT(*) AS n FROM performance_feedback WHERE report_id IN (?,?)',
      [a.reportId, active.reportId],
    );
    assert.equal(count.n, 2);
  }));

test('legacy closing visits keep missing schedule unknown; settings update atomically with versions and audit', () =>
  fixture(async (db, c, a) => {
    await c.execute(
      'UPDATE performance_visit SET scheduled_start=NULL,actual_start=NULL,capture_source=? WHERE report_id=?',
      ['Historical snapshot', a.reportId],
    );
    await capturePerformanceVisitEnd(c, a.jobId, 'Return required');
    const row = (await listPerformance(db, a.admin, a.filter)).visits.find(
      (v) => v.reportId === a.reportId,
    );
    assert.equal(row.scheduledStart, null);
    assert.equal(row.actualStart, null);
    assert.equal(row.punctualityScore, null);
    assert.equal(row.outcome, 'Return required');
    await assert.rejects(
      writePerformance(db, a.customer, a.reportId, 'Customer feedback', {
        requestId: randomUUID(),
        expectedVersion: 0,
        stars: 5,
      }),
      (e) => e.status === 409,
    );
    const settings = await getPerformanceSettings(c);
    const change = {
      requestId: randomUUID(),
      expectedVersion: settings.version,
      customerWeight: 30,
      qualityWeight: 50,
      punctualityWeight: 20,
      graceMinutes: 10,
      reason: 'Updated agreed quality policy.',
    };
    await writePerformance(db, a.admin, null, 'Settings', change);
    assert.equal(
      (await writePerformance(db, a.admin, null, 'Settings', change)).replayed,
      true,
    );
    await assert.rejects(
      writePerformance(db, a.admin, null, 'Settings', {
        ...change,
        requestId: randomUUID(),
      }),
      (e) => e.status === 409,
    );
    assert.deepEqual(await getPerformanceSettings(c), {
      customerWeight: 30,
      qualityWeight: 50,
      punctualityWeight: 20,
      graceMinutes: 10,
      version: settings.version + 1,
    });
  }));

test('performance HTTP endpoints enforce session, role and CSRF before storing owned feedback', () =>
  fixture(async (db, c, a) => {
    await a.complete();
    const [[customer]] = await c.execute(
      'SELECT email FROM user_account WHERE user_id=?',
      [a.customerUserId],
    );
    await c.execute('UPDATE user_account SET password_hash=? WHERE user_id=?', [
      await bcrypt.hash('FeedbackFixture2026!', 4),
      a.customerUserId,
    ]);
    const server = createApp({
      pool: db,
      secret: process.env.SESSION_SECRET,
    }).listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    let cookie = '',
      csrf = '';
    const request = async (path, method = 'GET', body, token = csrf) => {
      const response = await fetch(
        `http://127.0.0.1:${server.address().port}${path}`,
        {
          method,
          headers: {
            Cookie: cookie,
            'Content-Type': 'application/json',
            'X-CSRF-Token': token,
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        },
      );
      if (response.headers.get('set-cookie'))
        cookie = response.headers.get('set-cookie').split(';')[0];
      return response;
    };
    try {
      assert.equal(
        (await request('/api/performance/customer/visits')).status,
        401,
      );
      assert.equal(
        (await request('/api/performance/customer/pending-feedback')).status,
        401,
      );
      csrf = (await (await request('/api/session')).json()).csrf;
      const login = await request('/api/public/login', 'POST', {
        email: customer.email,
        password: 'FeedbackFixture2026!',
      });
      assert.equal(login.status, 200);
      csrf = (await login.json()).csrf;
      assert.equal((await request('/api/performance/admin')).status, 403);
      assert.equal((await request('/api/performance/technician')).status, 403);
      const pending = await request(
        `/api/performance/customer/pending-feedback?bookingId=${a.bookingId}`,
      );
      assert.equal(pending.status, 200);
      assert.equal(pending.headers.get('cache-control'), 'private, no-store');
      assert.ok(
        (await pending.json()).visits.some((v) => v.reportId === a.reportId),
      );
      const path = `/api/performance/customer/visits/${a.reportId}/feedback`,
        input = {
          requestId: randomUUID(),
          expectedVersion: 0,
          stars: 5,
          comment: 'HTTP fixture review.',
        };
      assert.equal((await request(path, 'PUT', input, '')).status, 403);
      assert.equal((await request(path, 'PUT', input)).status, 200);
      const ownVisits = await request(
        '/api/performance/customer/visits?' + new URLSearchParams(a.filter),
      );
      assert.equal(ownVisits.status, 200);
      assert.equal(ownVisits.headers.get('cache-control'), 'private, no-store');
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }));
