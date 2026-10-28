import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openPrivilegedFixtureConnection } from './privileged-fixture.mjs';
import {
  createPublicBooking,
  changePublicBooking,
} from '../server/public-site.mjs';
import {
  dispatchBooking,
  listDispatchOptions,
  updateTechnician,
} from '../server/admin-operations.mjs';
import {
  getTechnicianJobs,
  updateTechnicianJobStatus,
  saveCleaningAssessment,
} from '../server/technician.mjs';
import { getReport, saveReport } from '../server/technician-pages.mjs';
import { getBookingOptions } from '../server/customer/booking-options.mjs';
import {
  rewardsSummary,
  releaseBookingRewardReservation,
} from '../server/commerce.mjs';
import { listPerformance } from '../server/performance.mjs';
import {
  addCalendarDays,
  minimumBookingDate,
  nextWeekday,
} from '../server/customer/booking-schedule.mjs';
import { arrangeVisitForNow } from './service-visit-fixture.mjs';
import {
  getServiceProgress,
  updateServiceProgress,
} from '../server/service-progress.mjs';
import { updateReturn, listReturns } from '../server/return-visits.mjs';

async function fixture(work) {
  const c = await openPrivilegedFixtureConnection();
  await c.beginTransaction();
  const connection = {
    execute: c.execute.bind(c),
    query: c.query.bind(c),
    beginTransaction: () => c.query('SAVEPOINT team_operation'),
    commit: () => c.query('RELEASE SAVEPOINT team_operation'),
    rollback: () => c.query('ROLLBACK TO SAVEPOINT team_operation'),
    release() {},
  };
  const db = { ...connection, getConnection: async () => connection };
  try {
    await c.execute("UPDATE technician SET availability_status='On Leave'");
    const technicians = [];
    for (let i = 0; i < 5; i++) {
      const [u] = await c.execute(
        "INSERT INTO user_account(role_id,full_name,email,password_hash) SELECT role_id,?,?,'unused' FROM role WHERE role_name='Technician'",
        ['Team test ' + i, `team-${randomUUID()}@example.test`],
      );
      const [t] = await c.execute(
        "INSERT INTO technician(user_id,availability_status) VALUES (?,'Available')",
        [u.insertId],
      );
      technicians.push({ technicianId: t.insertId, userId: u.insertId });
    }
    const [u] = await c.execute(
      "INSERT INTO user_account(role_id,full_name,email,password_hash,phone) SELECT role_id,'Team customer',?,'unused','91234567' FROM role WHERE role_name='Customer'",
      [`team-customer-${randomUUID()}@example.test`],
    );
    const [customer] = await c.execute(
      'INSERT INTO customer(user_id) VALUES (?)',
      [u.insertId],
    );
    await c.execute(
      'INSERT INTO loyalty_account(customer_id,current_points) VALUES (?,500)',
      [customer.insertId],
    );
    await c.execute(
      'UPDATE reward_rule SET redemption_points=100,redemption_value=5,points_per_dollar=1 WHERE rule_id=1',
    );
    const [[actor]] = await c.execute(
      "SELECT user_id AS userId,access_level AS accessLevel FROM admin_profile WHERE access_level='Owner' LIMIT 1",
    );
    const date = nextWeekday(addCalendarDays(minimumBookingDate(), 180));
    const user = { id: u.insertId, customerId: customer.insertId };
    const create = (units = 8, more = {}) =>
      createPublicBooking(db, user, {
        serviceType: 'Cleaning',
        numberOfUnits: units,
        preferredDate: date,
        timeWindow: '09:00 AM - 11:00 AM',
        serviceAddress: `Team test ${randomUUID()} Singapore`,
        postalCode: '560123',
        requestId: randomUUID(),
        ...more,
      });
    await work({ c, db, user, actor, technicians, create, date });
  } finally {
    await c.rollback();
    await c.end();
  }
}

test('points reserve and return appear immediately, remain atomic and do not repeat', () =>
  fixture(async ({ c, db, user, create }) => {
    const b = await create(4, { rewardPoints: 100 });
    let wallet = await rewardsSummary(db, user.customerId);
    assert.deepEqual(
      [wallet.balance, wallet.available, wallet.reserved],
      [500, 400, 100],
    );
    assert.equal(
      wallet.history.find((h) => h.type === 'Reserved').points,
      -100,
    );
    await changePublicBooking(db, user, b.bookingId, 'cancel', {
      status: 'Cancelled',
    });
    wallet = await rewardsSummary(db, user.customerId);
    assert.deepEqual(
      [wallet.balance, wallet.available, wallet.reserved],
      [500, 500, 0],
    );
    assert.equal(wallet.history.find((h) => h.type === 'Returned').points, 100);
    await releaseBookingRewardReservation(
      c,
      b.bookingId,
      'Repeated cancellation',
    );
    assert.equal(
      (await rewardsSummary(db, user.customerId)).history.filter(
        (h) => h.type === 'Returned',
      ).length,
      1,
    );
  }));

test('automatic dispatch assigns complete teams, reserves every member and sends one email', () =>
  fixture(async ({ c, db, actor, create, technicians }) => {
    const b = await create(20);
    const options = await listDispatchOptions(db, b.bookingId);
    assert.equal(options.requiredTechnicians, 5);
    assert.equal(options.estimatedDurationMinutes, 180);
    const result = await dispatchBooking(db, actor, b.bookingId, {
      requestId: randomUUID(),
    });
    assert.equal(result.technicians.length, 5);
    assert.equal(result.technicians.filter((t) => t.isLead).length, 1);
    const [[counts]] = await c.execute(
      'SELECT (SELECT COUNT(*) FROM work_order WHERE booking_id=?) AS jobs,(SELECT COUNT(*) FROM booking_email_outbox WHERE booking_id=?) AS mails',
      [b.bookingId, b.bookingId],
    );
    assert.deepEqual([counts.jobs, counts.mails], [1, 1]);
    for (const t of technicians)
      assert.equal(
        (await getTechnicianJobs(db, t.technicianId, result.jobId)).length,
        1,
      );
    await assert.rejects(
      create(1),
      (e) => e.status === 409 && /fully booked/.test(e.message),
    );
    const member = result.technicians.find((t) => !t.isLead);
    await assert.rejects(
      updateTechnician(db, member.technicianId, { availability: 'On Leave' }),
      (e) => e.status === 409,
    );
  }));

test('manual teams can be smaller or larger, retain members on redispatch and reject late finishes', () =>
  fixture(async ({ c, db, actor, create, technicians }) => {
    const b = await create(8),
      ids = technicians.slice(0, 3).map((t) => t.technicianId);
    const manual = (list, lead) => ({
      requestId: randomUUID(),
      mode: 'manual',
      technicianIds: list,
      leadTechnicianId: lead,
    });
    const first = await dispatchBooking(
      db,
      actor,
      b.bookingId,
      manual([ids[0]], ids[0]),
    );
    assert.equal(first.estimatedDurationMinutes, 360);
    const second = await dispatchBooking(
      db,
      actor,
      b.bookingId,
      manual(ids, ids[1]),
      { redispatch: true },
    );
    assert.equal(second.estimatedDurationMinutes, 135);
    assert.equal(second.technician.technicianId, ids[1]);
    const late = await create(4, { timeWindow: '04:00 PM - 06:00 PM' }).catch(
      (e) => e,
    );
    assert.equal(late.status, 409);
    await assert.rejects(
      dispatchBooking(db, actor, b.bookingId, manual(ids, 999999), {
        redispatch: true,
      }),
      (e) => e.status === 400,
    );
    const [[saved]] = await c.execute(
      'SELECT assignment_id FROM work_order WHERE job_id=?',
      [second.jobId],
    );
    assert.equal(saved.assignment_id, second.assignmentId);
  }));

test('insufficient automatic staffing rolls back all dispatch effects', () =>
  fixture(async ({ c, db, actor, create, technicians }) => {
    const b = await create(8);
    for (const t of technicians.slice(1))
      await c.execute(
        "UPDATE technician SET availability_status='On Leave' WHERE technician_id=?",
        [t.technicianId],
      );
    await assert.rejects(
      dispatchBooking(db, actor, b.bookingId, { requestId: randomUUID() }),
      (e) => e.status === 409 && /2 required; only 1 available/.test(e.message),
    );
    const [[saved]] = await c.execute(
      'SELECT booking_status,(SELECT COUNT(*) FROM assignment WHERE booking_id=?) AS assignments FROM booking WHERE booking_id=?',
      [b.bookingId, b.bookingId],
    );
    assert.equal(saved.booking_status, 'Submitted');
    assert.equal(saved.assignments, 0);
  }));

test('only the lead writes a shared job; each member receives the captured visit and feedback', () =>
  fixture(async ({ c, db, user, actor, create, technicians }) => {
    const b = await create(8, { rewardPoints: 100 }),
      ids = technicians.slice(0, 2).map((t) => t.technicianId);
    const result = await dispatchBooking(db, actor, b.bookingId, {
      requestId: randomUUID(),
      mode: 'manual',
      technicianIds: ids,
      leadTechnicianId: ids[0],
    });
    const lead = technicians[0],
      helper = technicians[1];
    await arrangeVisitForNow(c, result.jobId);
    const start = {
      requestId: randomUUID(),
      expectedStatus: 'Assigned',
      status: 'In Progress',
    };
    await assert.rejects(
      updateTechnicianJobStatus(db, helper.userId, result.jobId, start),
      (e) => e.status === 404,
    );
    await updateTechnicianJobStatus(db, lead.userId, result.jobId, start);
    const view = await getReport(db, helper.userId, result.jobId);
    assert.equal(view.canEdit, false);
    assert.equal(view.team.length, 2);
    const report = {
      workPerformed: 'Shared team cleaned eight units',
      checklist: 'Cooling and drains checked',
      problemFound: '',
      solutionApplied: '',
      customerSignatureUrl: '',
      technicianSignatureUrl: '',
    };
    await assert.rejects(
      saveReport(db, helper.userId, result.jobId, {
        requestId: randomUUID(),
        expectedVersion: view.version,
        report,
      }),
      (e) => e.status === 404,
    );
    await assert.rejects(
      saveCleaningAssessment(db, helper.userId, result.jobId, {
        requestId: randomUUID(),
        expectedVersion: 0,
        method: 'Regular',
        note: 'Team helper must not write',
      }),
      (e) => e.status === 404,
    );
    const other = await create(1, {
      preferredDate: nextWeekday(addCalendarDays(minimumBookingDate(), 190)),
    });
    const otherDispatch = await dispatchBooking(db, actor, other.bookingId, {
      requestId: randomUUID(),
      mode: 'manual',
      technicianId: helper.technicianId,
    });
    await c.execute(
      "UPDATE work_order SET appointment_date=DATE(DATE_ADD(UTC_TIMESTAMP(),INTERVAL 8 HOUR)),appointment_time='00:00:00' WHERE job_id=?",
      [otherDispatch.jobId],
    );
    await assert.rejects(
      updateTechnicianJobStatus(db, helper.userId, otherDispatch.jobId, {
        ...start,
        requestId: randomUUID(),
      }),
      (e) =>
        e.status === 409 && /before starting another service/.test(e.message),
    );
    const before = await getReport(db, lead.userId, result.jobId);
    await saveReport(db, lead.userId, result.jobId, {
      requestId: randomUUID(),
      expectedVersion: before.version,
      report,
    });
    const [[captured]] = await c.execute(
      'SELECT report_id FROM service_report WHERE job_id=?',
      [result.jobId],
    );
    await c.execute(
      'INSERT INTO performance_feedback(report_id,stars,comment,customer_user_id,version) VALUES (?,5,?,?,1)',
      [captured.report_id, 'Great team', user.id],
    );
    for (const t of [lead, helper]) {
      const p = await listPerformance(
        db,
        { role: 'Technician', id: t.userId },
        { reportId: captured.report_id },
      );
      assert.equal(p.visits.length, 1);
      assert.equal(p.visits[0].stars, 5);
      assert.equal(p.visits[0].teamReview, 1);
    }
    const customer = await listPerformance(
      db,
      { role: 'Customer', id: user.id },
      { reportId: captured.report_id },
    );
    assert.equal(customer.visits.length, 1);
    const wallet = await rewardsSummary(db, user.customerId);
    assert.equal(wallet.history.filter((h) => h.type === 'Settled').length, 1);
    assert.equal(
      wallet.history.find((h) => h.type === 'Redeemed').availableDelta,
      0,
    );
  }));

test('automatic dispatch uses every quantity boundary and stale team review is rejected atomically', () =>
  fixture(async ({ c, db, actor, create, date }) => {
    for (const [units, count] of [
      [4, 1],
      [5, 2],
      [8, 2],
      [9, 3],
      [12, 3],
      [13, 4],
      [16, 4],
      [17, 5],
      [20, 5],
    ]) {
      const b = await create(units, {
        preferredDate: nextWeekday(addCalendarDays(date, units * 7)),
      });
      const options = await listDispatchOptions(db, b.bookingId),
        selected = options.technicians
          .filter((t) => t.eligible)
          .slice(0, count);
      const review = {
        status: 'Submitted',
        date: options.preferredDate,
        timeSlot: options.timeSlot,
        travelBufferMinutes: options.travelBufferMinutes,
        technicianId: selected[0].technicianId,
        technicianIds: selected.map((t) => t.technicianId),
        estimatedDurationMinutes: options.estimatedDurationMinutes,
      };
      await assert.rejects(
        dispatchBooking(db, actor, b.bookingId, {
          requestId: randomUUID(),
          review: {
            ...review,
            technicianIds: [...review.technicianIds, 999999],
          },
        }),
        (e) => e.status === 409,
      );
      const result = await dispatchBooking(db, actor, b.bookingId, {
        requestId: randomUUID(),
        review,
      });
      assert.equal(result.technicians.length, count);
      const [[saved]] = await c.execute(
        'SELECT required_technicians FROM booking WHERE booking_id=?',
        [b.bookingId],
      );
      assert.equal(saved.required_technicians, count);
    }
  }));

test('return dispatch defaults to the prior team and supports a changed team, lead and duration without moving history', () =>
  fixture(async ({ c, db, user, actor, create, technicians, date }) => {
    const ids = technicians.slice(0, 2).map((t) => t.technicianId),
      b = await create(8);
    const first = await dispatchBooking(db, actor, b.bookingId, {
      requestId: randomUUID(),
      mode: 'manual',
      technicianIds: ids,
      leadTechnicianId: ids[0],
    });
    await arrangeVisitForNow(c, first.jobId);
    await updateTechnicianJobStatus(db, technicians[0].userId, first.jobId, {
      requestId: randomUUID(),
      expectedStatus: 'Assigned',
      status: 'In Progress',
    });
    const required = await updateServiceProgress(
      db,
      technicians[0].userId,
      first.jobId,
      {
        requestId: randomUUID(),
        expectedVersion: 0,
        action: 'require-return',
        reason: 'Part unavailable',
        notes: 'Need a second team visit to install the part',
        partNotes: 'Replacement filter',
      },
    );
    const report = await getReport(db, technicians[0].userId, first.jobId);
    await saveReport(db, technicians[0].userId, first.jobId, {
      requestId: randomUUID(),
      expectedVersion: report.version,
      report: {
        workPerformed: 'Cleaned initial units, awaiting replacement part',
        checklist: 'Checks recorded',
        problemFound: 'Part unavailable',
        solutionApplied: 'Return required',
        customerSignatureUrl: '',
        technicianSignatureUrl: '',
      },
    });
    const oldReport = report.report.reportId;
    const rows = (await listReturns(db, 'admin', actor.userId)).rows;
    assert.deepEqual(
      rows.find((r) => r.jobId === first.jobId).team.map((t) => t.technicianId),
      ids,
    );
    const invited = await updateReturn(db, 'admin', actor.userId, first.jobId, {
      requestId: randomUUID(),
      expectedVersion: required.version,
      action: 'invite',
      customerMessage: 'Please choose a new return appointment for the team.',
    });
    const chosen = await updateReturn(db, 'customer', user.id, first.jobId, {
      requestId: randomUUID(),
      expectedVersion: invited.version,
      action: 'choose',
      date: nextWeekday(addCalendarDays(date, 21)),
      timeSlot: '09:00 - 11:00',
    });
    const updatedIds = [
      ids[1],
      technicians[2].technicianId,
      technicians[3].technicianId,
    ];
    const dispatch = {
      requestId: randomUUID(),
      expectedVersion: chosen.version,
      action: 'dispatch',
      technicianIds: updatedIds,
      leadTechnicianId: updatedIds[1],
      durationMinutes: 90,
    };
    await updateReturn(db, 'admin', actor.userId, first.jobId, dispatch);
    assert.equal(
      (await updateReturn(db, 'admin', actor.userId, first.jobId, dispatch))
        .replayed,
      true,
    );
    const [snapshots] = await c.execute(
      'SELECT technician_id FROM visit_member WHERE report_id=? ORDER BY technician_id',
      [oldReport],
    );
    assert.deepEqual(
      snapshots.map((t) => t.technician_id),
      ids,
    );
    const [[booking]] = await c.execute(
      'SELECT required_technicians,estimated_duration_minutes,slot_end FROM booking WHERE booking_id=?',
      [b.bookingId],
    );
    assert.deepEqual(
      [
        booking.required_technicians,
        booking.estimated_duration_minutes,
        booking.slot_end,
      ],
      [3, 90, '10:30:00'],
    );
    const helperView = await getTechnicianJobs(db, updatedIds[0], first.jobId);
    assert.equal(helperView[0].isLead, false);
    assert.equal(helperView[0].team.length, 3);
  }));

test('service extension checks helper conflicts including the other visit travel buffer', () =>
  fixture(async ({ c, db, actor, create, technicians }) => {
    const ids = technicians.slice(0, 2).map((t) => t.technicianId),
      first = await create(8);
    const assigned = await dispatchBooking(db, actor, first.bookingId, {
      requestId: randomUUID(),
      mode: 'manual',
      technicianIds: ids,
      leadTechnicianId: ids[0],
    });
    await arrangeVisitForNow(c, assigned.jobId);
    await updateTechnicianJobStatus(db, technicians[0].userId, assigned.jobId, {
      requestId: randomUUID(),
      expectedStatus: 'Assigned',
      status: 'In Progress',
    });
    const next = await create(1, {
      preferredDate: nextWeekday(addCalendarDays(minimumBookingDate(), 190)),
    });
    const helperNext = await dispatchBooking(db, actor, next.bookingId, {
      requestId: randomUUID(),
      mode: 'manual',
      technicianId: ids[1],
    });
    await c.execute(
      "UPDATE work_order SET appointment_date=DATE(DATE_ADD(UTC_TIMESTAMP(),INTERVAL 8 HOUR)),appointment_time='12:30:00' WHERE job_id=?",
      [helperNext.jobId],
    );
    await c.execute(
      "UPDATE booking SET preferred_service_date=DATE(DATE_ADD(UTC_TIMESTAMP(),INTERVAL 8 HOUR)),slot_start='12:30:00',slot_end='13:15:00' WHERE booking_id=?",
      [next.bookingId],
    );
    const progress = await getServiceProgress(db, assigned.jobId);
    await assert.rejects(
      updateServiceProgress(db, technicians[0].userId, assigned.jobId, {
        requestId: randomUUID(),
        expectedVersion: progress.version,
        action: 'extend',
        minutes: 15,
        reason: 'More cleaning required',
        notes: 'The shared team requires additional cleaning time.',
      }),
      (e) => e.status === 409 && /another visit/.test(e.message),
    );
    const [[unchanged]] = await c.execute(
      'SELECT slot_end FROM booking WHERE booking_id=?',
      [first.bookingId],
    );
    assert.equal(unchanged.slot_end, '12:00:00');
  }));
