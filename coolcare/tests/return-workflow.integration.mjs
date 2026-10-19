import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import mysql from 'mysql2/promise';
import {
  updateServiceProgress,
  getServiceProgress,
} from '../server/service-progress.mjs';
import {
  minimumBookingDate,
  addCalendarDays,
} from '../server/customer/booking-schedule.mjs';
import { getReport } from '../server/technician-pages.mjs';
import { updateReturn, listReturns } from '../server/return-visits.mjs';
import { updateTechnicianJobStatus } from '../server/technician.mjs';
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  dateStrings: true,
});
after(() => pool.end());
async function fixture(fn) {
  const c = await pool.getConnection();
  await c.beginTransaction();
  const h = {
    execute: c.execute.bind(c),
    query: c.query.bind(c),
    beginTransaction: () => c.query('SAVEPOINT pages'),
    commit: () => c.query('RELEASE SAVEPOINT pages'),
    rollback: () => c.query('ROLLBACK TO SAVEPOINT pages'),
    release() {},
  };
  const db = { ...h, getConnection: async () => h };
  try {
    const [[actor]] = await c.execute(
      `SELECT t.user_id AS userId,w.job_id AS jobId FROM technician t JOIN assignment a ON a.technician_id=t.technician_id JOIN work_order w ON w.assignment_id=a.assignment_id WHERE a.assignment_status NOT IN ('Declined','Reassigned','Cancelled') LIMIT 1`,
    );
    assert.ok(actor);
    await c.execute(
      'UPDATE service_report SET customer_signature_url=NULL,technician_signature_url=NULL WHERE job_id=?',
      [actor.jobId],
    );
    await fn(db, c, actor);
  } finally {
    await c.rollback();
    c.release();
  }
}

test('return workflow retains the job, creates independent reports and photos, and replays without duplicates', () =>
  fixture(async (db, c, a) => {
    const [[w]] = await c.execute(
      'SELECT booking_id,assignment_id FROM work_order WHERE job_id=?',
      [a.jobId],
    );
    const [[admin]] = await c.execute(
      'SELECT user_id FROM admin_profile LIMIT 1',
    );
    const [[customer]] = await c.execute(
      'SELECT cu.user_id FROM booking b JOIN customer cu ON cu.customer_id=b.customer_id WHERE b.booking_id=?',
      [w.booking_id],
    );
    const [[tech]] = await c.execute(
      'SELECT technician_id FROM assignment WHERE assignment_id=?',
      [w.assignment_id],
    );
    await c.execute(
      "UPDATE technician SET availability_status='Available' WHERE technician_id=?",
      [tech.technician_id],
    );
    await c.execute(
      "UPDATE work_order SET current_status='In Progress' WHERE job_id=?",
      [a.jobId],
    );
    await c.execute(
      "UPDATE booking SET booking_status='In Progress',estimated_duration_minutes=45 WHERE booking_id=?",
      [w.booking_id],
    );
    await c.execute(
      "INSERT INTO service_progress(job_id) VALUES (?) ON DUPLICATE KEY UPDATE follow_up_status='None'",
      [a.jobId],
    );
    let p = await getServiceProgress(db, a.jobId);
    const required = await updateServiceProgress(db, a.userId, a.jobId, {
      requestId: randomUUID(),
      expectedVersion: p.version,
      action: 'require-return',
      reason: 'Part unavailable',
      partNotes: 'Fan motor: 1 piece',
      notes: 'Return visit needed.',
    });
    const change = async (role, user, extra) => {
      p = await getServiceProgress(db, a.jobId);
      return updateReturn(db, role, user, a.jobId, {
        requestId: randomUUID(),
        expectedVersion: p.version,
        ...extra,
      });
    };
    const choose = {
      action: 'choose',
      date: '2035-02-06',
      timeSlot: '09:00 - 11:00',
    };
    await assert.rejects(change('customer', customer.user_id, choose));
    await assert.rejects(
      change('customer', customer.user_id, { action: 'invite' }),
    );
    const customerMessage =
      'The replacement fan motor is being arranged. Please choose a new weekday appointment.';
    await change('admin', admin.user_id, {
      action: 'invite',
      customerMessage,
    });
    const customerReturn = (
      await listReturns(db, 'customer', customer.user_id)
    ).rows.find((r) => r.jobId === a.jobId);
    assert.equal(customerReturn.status, 'Awaiting customer');
    assert.equal(customerReturn.customerMessage, customerMessage);
    assert.equal(customerReturn.travelBufferMinutes, 30);
    await assert.rejects(change('customer', 4294967295, choose));
    await assert.rejects(
      change('customer', customer.user_id, { ...choose, date: '2020-01-01' }),
    );
    await assert.rejects(
      change('customer', customer.user_id, { ...choose, date: '2035-02-04' }),
    );
    await assert.rejects(
      change('customer', customer.user_id, {
        ...choose,
        date: addCalendarDays(minimumBookingDate(), -1),
      }),
    );
    await change('customer', customer.user_id, choose);
    p = await getServiceProgress(db, a.jobId);
    const dispatch = {
      requestId: randomUUID(),
      expectedVersion: p.version,
      action: 'dispatch',
      technicianId: tech.technician_id,
    };
    await updateReturn(db, 'admin', admin.user_id, a.jobId, dispatch);
    assert.equal(
      (await updateReturn(db, 'admin', admin.user_id, a.jobId, dispatch))
        .replayed,
      true,
    );
    const [[assigned]] = await c.execute(
      'SELECT current_status FROM work_order WHERE job_id=?',
      [a.jobId],
    );
    assert.equal(assigned.current_status, 'Return visit');
    await c.execute("UPDATE service_report SET work_performed='First visit work',checklist_result='First checklist',problem_found='First remarks',customer_signature_url='/api/report-signatures/11111111-1111-4111-8111-111111111111' WHERE job_id=?",[a.jobId]);
    await c.execute("INSERT INTO photo(job_id,report_id,photo_url,description) VALUES(?,?,'first-visit.jpg','First visit photo')",[a.jobId,required.reportId]);
    const startRequest={requestId:randomUUID(),expectedStatus:'Return visit',status:'In Progress'};
    await updateTechnicianJobStatus(db,a.userId,a.jobId,startRequest);
    await updateTechnicianJobStatus(db,a.userId,a.jobId,startRequest);
    const fresh=await getReport(db,a.userId,a.jobId);
    assert.notEqual(fresh.report.reportId,required.reportId);
    assert.equal(fresh.report.workPerformed,'');
    assert.equal(fresh.report.checklist,null);
    assert.equal(fresh.report.customerSignatureUrl,null);
    const priorReport=fresh.serviceProgress.visitReports.find(r=>r.reportId===required.reportId);
    assert.equal(priorReport.workPerformed,'First visit work');
    assert.equal(priorReport.checklist,'First checklist');
    assert.equal(priorReport.photos.length,1);
    assert.equal(fresh.serviceProgress.visitReports.find(r=>r.reportId===fresh.report.reportId).photos.length,0);
    const [[oldReport]]=await c.execute('SELECT job_id,archived_job_id FROM service_report WHERE report_id=?',[required.reportId]);
    assert.equal(oldReport.job_id,null);assert.equal(oldReport.archived_job_id,a.jobId);

    await updateTechnicianJobStatus(db, a.userId, a.jobId, {
      requestId: randomUUID(),
      expectedStatus: 'In Progress',
      status: 'Completed',
    });
    assert.equal(
      (await getServiceProgress(db, a.jobId)).followUpStatus,
      'Completed',
    );
    const [[report]] = await c.execute(
      'SELECT report_id FROM service_report WHERE job_id=?',
      [a.jobId],
    );
    assert.notEqual(report.report_id, required.reportId);
    const [visits] = await c.execute(
      'SELECT outcome FROM service_visit_record WHERE job_id=? ORDER BY visit_id DESC LIMIT 2',
      [a.jobId],
    );
    assert.deepEqual(
      visits.map((v) => v.outcome),
      ['Completed', 'Return required'],
    );
  }));
