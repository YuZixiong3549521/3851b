import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import mysql from 'mysql2/promise';
import { createPublicBooking } from '../server/public-site.mjs';
import {
  addCalendarDays,
  minimumBookingDate,
  nextWeekday,
} from '../server/customer/booking-schedule.mjs';
import {
  approveBooking,
  editTravelPlan,
  getAdminActionSummary,
  getAdminBooking,
  dispatchBooking,
  listDispatchOptions,
  listAdminSchedule,
  rejectBooking,
  rescheduleAdminBooking,
  revokeInvitation,
  transferOwner,
  updateTechnician,
} from '../server/admin-operations.mjs';
import {
  acceptStaffInvitation,
  inviteStaff,
  validateStaffInvitation,
} from '../server/staff-invitations.mjs';
import { updateTechnicianJobStatus } from '../server/technician.mjs';
import {
  getTeamSlotAvailability,
  lockTechnicianRoster,
} from '../server/scheduling.mjs';

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  dateStrings: true,
  decimalNumbers: true,
  connectionLimit: 5,
});
const rootPool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: 'root',
  password: process.env.MYSQL_ROOT_PASSWORD,
  database: process.env.DB_NAME,
  dateStrings: true,
  decimalNumbers: true,
  connectionLimit: 2,
});
after(() => Promise.all([pool.end(), rootPool.end()]));

function nestedPool(connection) {
  const handle = {
    execute: connection.execute.bind(connection),
    query: connection.query.bind(connection),
    beginTransaction: () => connection.query('SAVEPOINT staff_dispatch'),
    commit: () => connection.query('RELEASE SAVEPOINT staff_dispatch'),
    rollback: () => connection.query('ROLLBACK TO SAVEPOINT staff_dispatch'),
    release: () => {},
  };
  return {
    execute: connection.execute.bind(connection),
    query: connection.query.bind(connection),
    getConnection: async () => handle,
  };
}

async function rollbackFixture(work) {
  const connection = await pool.getConnection();
  await connection.beginTransaction();
  try {
    await work(nestedPool(connection), connection);
  } finally {
    await connection.rollback();
    connection.release();
  }
}

async function actors(connection) {
  const [[owner]] =
    await connection.execute(`SELECT u.user_id AS userId,u.full_name AS fullName,a.access_level AS accessLevel
    FROM admin_profile a JOIN user_account u ON u.user_id=a.user_id WHERE a.access_level='Owner' AND u.status='Active'`);
  const [[admin]] =
    await connection.execute(`SELECT u.user_id AS userId,u.full_name AS fullName,a.access_level AS accessLevel
    FROM admin_profile a JOIN user_account u ON u.user_id=a.user_id WHERE a.access_level='Admin' AND u.status='Active' ORDER BY u.user_id LIMIT 1`);
  assert.ok(owner);
  assert.ok(admin);
  return { owner, admin };
}

function tokenFromMail(text) {
  const match = /\/activate\?token=([^\s]+)/.exec(text);
  assert.ok(match, 'Invitation email must contain an activation token.');
  return decodeURIComponent(match[1]);
}

test('staff invitations are owner-scoped, hashed, expiring, revocable and single-use; ownership remains unique', async () =>
  rollbackFixture(async (db, connection) => {
    const { owner, admin } = await actors(connection),
      suffix = randomUUID().slice(0, 8);
    await assert.rejects(
      inviteStaff(db, admin, 'Admin', {
        fullName: 'Forbidden Admin',
        email: `forbidden-${suffix}@example.test`,
        phone: '',
      }),
      (error) => error.status === 403,
    );

    const invited = await inviteStaff(
      db,
      owner,
      'Admin',
      {
        fullName: 'QA Admin',
        email: `admin-${suffix}@example.test`,
        phone: '91234567',
      },
      { origin: 'http://localhost:3000' },
    );
    const [[stored]] = await connection.execute(
      `SELECT i.token_hash,i.expires_at,u.status,e.body_text FROM staff_invitation i
    JOIN user_account u ON u.user_id=i.user_id JOIN booking_email_outbox e ON e.invitation_id=i.invitation_id WHERE i.invitation_id=?`,
      [invited.invitationId],
    );
    const firstToken = tokenFromMail(stored.body_text);
    assert.equal(stored.status, 'Inactive');
    assert.equal(stored.token_hash.length, 64);
    assert.equal(stored.token_hash.includes(firstToken), false);
    assert.equal(
      (await validateStaffInvitation(db, firstToken)).roleName,
      'Admin',
    );
    await connection.execute(
      'UPDATE staff_invitation SET expires_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 SECOND) WHERE invitation_id=?',
      [invited.invitationId],
    );
    await assert.rejects(
      validateStaffInvitation(db, firstToken),
      (error) => error.status === 410,
    );

    const resent = await inviteStaff(
      db,
      owner,
      'Admin',
      { fullName: 'QA Admin', email: invited.email, phone: '91234567' },
      { origin: 'http://localhost:3000' },
    );
    const [[mail]] = await connection.execute(
      'SELECT body_text FROM booking_email_outbox WHERE invitation_id=?',
      [resent.invitationId],
    );
    const token = tokenFromMail(mail.body_text),
      request = { session: { regenerate: (callback) => callback() } };
    const activated = await acceptStaffInvitation(db, request, {
      token,
      password: 'StrongPass123!',
      confirmPassword: 'StrongPass123!',
    });
    assert.equal(activated.user.role, 'Admin');
    assert.equal(request.session.portalUser.id, invited.userId);
    await assert.rejects(
      validateStaffInvitation(db, token),
      (error) => error.status === 410,
    );
    await assert.rejects(
      inviteStaff(db, owner, 'Admin', {
        fullName: 'Duplicate',
        email: invited.email,
        phone: '',
      }),
      (error) => error.status === 409,
    );

    await transferOwner(db, owner, invited.userId);
    const [[ownership]] = await connection.execute(
      "SELECT COUNT(*) AS count,MAX(user_id=?) AS targetIsOwner FROM admin_profile WHERE access_level='Owner'",
      [invited.userId],
    );
    assert.equal(Number(ownership.count), 1);
    assert.equal(Number(ownership.targetIsOwner), 1);

    const technician = await inviteStaff(
      db,
      admin,
      'Technician',
      {
        fullName: 'QA Technician',
        email: `tech-${suffix}@example.test`,
        phone: '',
      },
      { origin: 'http://localhost:3000' },
    );
    await revokeInvitation(db, admin, technician.invitationId);
    const [[revokedMail]] = await connection.execute(
      'SELECT body_text FROM booking_email_outbox WHERE invitation_id=?',
      [technician.invitationId],
    );
    await assert.rejects(
      validateStaffInvitation(db, tokenFromMail(revokedMail.body_text)),
      (error) => error.status === 410,
    );
  }));

test('review and dispatch are separate, automatic dispatch rotates conflict-free technicians, and job status is sequential', async () =>
  rollbackFixture(async (db, connection) => {
    const { owner } = await actors(connection);
    const [[customer]] =
      await connection.execute(`SELECT u.user_id AS id,u.email,u.phone,c.customer_id AS customerId FROM user_account u
    JOIN customer c ON c.user_id=u.user_id WHERE u.email='alice.tan@coolcare.demo'`);
    const [[service]] = await connection.execute(
      "SELECT service_id AS serviceId FROM simple_service_catalog WHERE code='cleaning'",
    );
    const [technicians] =
      await connection.execute(`SELECT t.technician_id AS technicianId,t.user_id AS userId,u.email,u.full_name AS fullName FROM technician t
    JOIN user_account u ON u.user_id=t.user_id ORDER BY t.technician_id`);
    assert.ok(technicians.length >= 2);
    await lockTechnicianRoster(connection);
    await connection.execute(
      "UPDATE user_account u JOIN technician t ON t.user_id=u.user_id SET u.status='Active'",
    );
    await connection.execute(
      "UPDATE technician SET availability_status='Available',last_assigned_at=CASE technician_id WHEN ? THEN '2025-01-01 00:00:00' ELSE '2026-01-01 00:00:00' END",
      [technicians[0].technicianId],
    );
    await connection.execute(
      'UPDATE technician SET hourly_labor_cost=40 WHERE technician_id IN (' +
        technicians.map(() => '?').join(',') +
        ')',
      technicians.map((row) => row.technicianId),
    );
    const date = nextWeekday(addCalendarDays(minimumBookingDate(), 365)),
      address = `Dispatch QA ${randomUUID()}, Singapore`;
    const create = (serviceAddress = address) =>
      createPublicBooking(db, customer, {
        serviceId: service.serviceId,
        serviceAddress,
        numberOfUnits: 1,
        preferredDate: date,
        timeWindow: '09:00 - 11:00',
        requestId: randomUUID(),
      });

    const first = await create(),
      rescheduledDate = nextWeekday(addCalendarDays(date, 7)),
      rescheduleRequest = randomUUID();
    assert.ok((await getAdminActionSummary(db)).submitted >= 1);
    assert.equal(
      (await getAdminBooking(db, first.bookingId)).travelBufferMinutes,
      30,
    );
    const travelRequest = randomUUID();
    assert.deepEqual(
      await editTravelPlan(db, owner, first.bookingId, {
        requestId: travelRequest,
        travelBufferMinutes: 45,
        trafficNote: 'Peak-hour traffic and visitor parking.',
      }),
      {
        bookingId: first.bookingId,
        travelBufferMinutes: 45,
        trafficNote: 'Peak-hour traffic and visitor parking.',
      },
    );
    assert.equal(
      (
        await editTravelPlan(db, owner, first.bookingId, {
          requestId: travelRequest,
          travelBufferMinutes: 45,
          trafficNote: 'Peak-hour traffic and visitor parking.',
        })
      ).replayed,
      true,
    );
    const rescheduled = await rescheduleAdminBooking(
      db,
      owner,
      first.bookingId,
      {
        requestId: rescheduleRequest,
        preferredDate: rescheduledDate,
        timeSlot: '14:00 - 16:00',
      },
    );
    assert.equal(rescheduled.preferredDate, rescheduledDate);
    assert.equal(rescheduled.timeSlot, '14:00 - 16:00');
    assert.equal(
      (
        await rescheduleAdminBooking(db, owner, first.bookingId, {
          requestId: rescheduleRequest,
          preferredDate: rescheduledDate,
          timeSlot: '14:00 - 16:00',
        })
      ).replayed,
      true,
    );
    const scheduled = await listAdminSchedule(db, {
      from: rescheduledDate,
      to: rescheduledDate,
    });
    assert.equal(
      scheduled.rows.find((row) => row.bookingId === first.bookingId)?.timeSlot,
      '14:00 - 16:00',
    );
    const [[changeAudit]] = await connection.execute(
      `SELECT COUNT(*) AS count FROM booking_change_request
      WHERE booking_id=? AND request_type='Reschedule' AND request_status='Approved'`,
      [first.bookingId],
    );
    assert.equal(Number(changeAudit.count), 1);
    await assert.rejects(
      dispatchBooking(db, owner, first.bookingId, { requestId: randomUUID() }),
      (error) => error.status === 409 && /Approve/.test(error.message),
    );
    assert.equal(
      (
        await approveBooking(db, owner, first.bookingId, {
          requestId: randomUUID(),
        })
      ).status,
      'Confirmed',
    );
    const [[reviewMailCount]] = await connection.execute(
      'SELECT COUNT(*) AS count FROM booking_email_outbox WHERE booking_id=?',
      [first.bookingId],
    );
    assert.equal(Number(reviewMailCount.count), 0);
    const dispatchRequest = randomUUID(),
      firstDispatch = await dispatchBooking(db, owner, first.bookingId, {
        requestId: dispatchRequest,
      });
    assert.equal(
      firstDispatch.technician.technicianId,
      technicians[0].technicianId,
    );
    assert.equal(
      (
        await dispatchBooking(db, owner, first.bookingId, {
          requestId: dispatchRequest,
        })
      ).replayed,
      true,
    );
    const [[dispatchMail]] = await connection.execute(
      `SELECT recipient,event_type,subject,body_text FROM booking_email_outbox
      WHERE booking_id=? AND event_type='booking.assigned'`,
      [first.bookingId],
    );
    assert.equal(dispatchMail.recipient, customer.email);
    assert.equal(dispatchMail.event_type, 'booking.assigned');
    assert.match(dispatchMail.subject, /confirmed/i);
    const emailDate = new Intl.DateTimeFormat('en-SG', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(`${rescheduledDate}T00:00:00Z`));
    assert.match(dispatchMail.body_text, new RegExp(emailDate));
    assert.match(
      dispatchMail.body_text,
      /Service time: 14:00 - 14:45 \(Singapore time\)/,
    );
    assert.match(
      dispatchMail.body_text,
      new RegExp(
        technicians[0].fullName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
      ),
    );
    const [[technicianMailCount]] = await connection.execute(
      `SELECT COUNT(*) AS count FROM booking_email_outbox
      WHERE booking_id=? AND recipient=?`,
      [first.bookingId, technicians[0].email],
    );
    assert.equal(Number(technicianMailCount.count), 0);
    await assert.rejects(
      rescheduleAdminBooking(db, owner, first.bookingId, {
        requestId: randomUUID(),
        preferredDate: nextWeekday(addCalendarDays(rescheduledDate, 1)),
        timeSlot: '16:00 - 18:00',
      }),
      (error) => error.status === 409 && /unassigned/i.test(error.message),
    );

    const second = await create();
    await approveBooking(db, owner, second.bookingId, {
      requestId: randomUUID(),
    });
    const secondDispatch = await dispatchBooking(db, owner, second.bookingId, {
      requestId: randomUUID(),
    });
    assert.notEqual(
      secondDispatch.technician.technicianId,
      firstDispatch.technician.technicianId,
    );
    // Submitted requests also reserve capacity. The first booking moved to a
    // different slot, so fill every remaining place without assuming the local
    // database contains exactly two technicians.
    const capacityFillers = [];
    for (let index = 1; index < technicians.length; index++) {
      capacityFillers.push(
        await create(`Capacity filler ${randomUUID()}, Singapore`),
      );
    }
    await assert.rejects(
      create(`Capacity QA ${randomUUID()}, Singapore`),
      (error) => error.status === 409 && /fully booked/i.test(error.message),
    );
    await rejectBooking(db, owner, capacityFillers[0].bookingId, {
      requestId: randomUUID(),
      reason: 'Capacity test place released.',
    });

    await assert.rejects(
      updateTechnicianJobStatus(
        db,
        technicians[1].userId,
        firstDispatch.jobId,
        {
          requestId: randomUUID(),
          expectedStatus: 'Assigned',
          status: 'On The Way',
        },
      ),
      (error) => error.status === 404,
    );
    await assert.rejects(
      updateTechnicianJobStatus(
        db,
        technicians[0].userId,
        firstDispatch.jobId,
        {
          requestId: randomUUID(),
          expectedStatus: 'Assigned',
          status: 'Completed',
        },
      ),
      (error) => error.status === 409,
    );
    const travelling = {
      requestId: randomUUID(),
      expectedStatus: 'Assigned',
      status: 'On The Way',
    };
    assert.equal(
      (
        await updateTechnicianJobStatus(
          db,
          technicians[0].userId,
          firstDispatch.jobId,
          travelling,
        )
      ).status,
      'On The Way',
    );
    assert.equal(
      (
        await updateTechnicianJobStatus(
          db,
          technicians[0].userId,
          firstDispatch.jobId,
          travelling,
        )
      ).replayed,
      true,
    );
    const [[accepted]] = await connection.execute(
      'SELECT assignment_status FROM assignment WHERE assignment_id=?',
      [firstDispatch.assignmentId],
    );
    assert.equal(accepted.assignment_status, 'Accepted');
    await updateTechnicianJobStatus(
      db,
      technicians[0].userId,
      firstDispatch.jobId,
      {
        requestId: randomUUID(),
        expectedStatus: 'On The Way',
        status: 'In Progress',
      },
    );
    await updateTechnicianJobStatus(
      db,
      technicians[0].userId,
      firstDispatch.jobId,
      {
        requestId: randomUUID(),
        expectedStatus: 'In Progress',
        status: 'Completed',
        report: {
          workPerformed: 'Cleaned and inspected the unit.',
          problemFound: 'Dirty filters',
          solutionApplied: 'Cleaned filters',
          checklist: 'Cooling and drainage checked',
        },
      },
    );
    const [[savedReport]] = await connection.execute(
      'SELECT * FROM service_report WHERE job_id=?',
      [firstDispatch.jobId],
    );
    assert.equal(savedReport.work_performed, 'Cleaned and inspected the unit.');
    assert.ok(savedReport.started_at);
    assert.ok(savedReport.completed_at);
    assert.ok(savedReport.submitted_time);
    assert.ok(savedReport.completed_at >= savedReport.started_at);
    const adminDetail = await getAdminBooking(db, first.bookingId);
    assert.equal(
      adminDetail.reports[0].workPerformed,
      savedReport.work_performed,
    );
    const [[completed]] = await connection.execute(
      `SELECT b.booking_status,w.current_status,a.assignment_status FROM booking b
    JOIN work_order w ON w.booking_id=b.booking_id JOIN assignment a ON a.assignment_id=w.assignment_id WHERE b.booking_id=?`,
      [first.bookingId],
    );
    assert.deepEqual(completed, {
      booking_status: 'Completed',
      current_status: 'Completed',
      assignment_status: 'Completed',
    });

    const freed = await create(`Released capacity ${randomUUID()}, Singapore`);
    const reason = 'Requested date cannot be supported by the service team.';
    await rejectBooking(db, owner, freed.bookingId, {
      requestId: randomUUID(),
      reason,
    });
    const [[rejected]] = await connection.execute(
      `SELECT b.booking_status,h.change_note FROM booking b JOIN booking_status_history h ON h.booking_id=b.booking_id
    WHERE b.booking_id=? AND h.new_status='Rejected' ORDER BY h.history_id DESC LIMIT 1`,
      [freed.bookingId],
    );
    assert.deepEqual(rejected, {
      booking_status: 'Rejected',
      change_note: reason,
    });
    const [[mailCount]] = await connection.execute(
      `SELECT COUNT(*) AS count FROM booking_email_outbox WHERE booking_id IN (?,?)
    AND event_type IN ('booking.confirmed','booking.assigned','booking.rejected')`,
      [first.bookingId, freed.bookingId],
    );
    assert.equal(Number(mailCount.count), 1);
    await assert.rejects(
      updateTechnician(db, secondDispatch.technician.technicianId, {
        availability: 'On Leave',
      }),
      (error) =>
        error.status === 409 &&
        /active service|work orders|return visits/.test(error.message),
    );
  }));

void test('manual dispatch lists every technician, enforces eligibility, supports safe redispatch and preserves email idempotency', async () =>
  rollbackFixture(async (db, connection) => {
    const { owner } = await actors(connection);
    const [[customer]] =
      await connection.execute(`SELECT u.user_id AS id,u.email,u.phone,c.customer_id AS customerId FROM user_account u
      JOIN customer c ON c.user_id=u.user_id WHERE u.email='alice.tan@coolcare.demo'`);
    const [[service]] = await connection.execute(
      "SELECT service_id AS serviceId FROM simple_service_catalog WHERE code='cleaning'",
    );
    const [technicians] =
      await connection.execute(`SELECT t.technician_id AS technicianId,t.user_id AS userId,u.email,u.full_name AS fullName FROM technician t
      JOIN user_account u ON u.user_id=t.user_id ORDER BY t.technician_id`);
    assert.ok(technicians.length >= 2);
    const automaticFirst = technicians[0],
      manuallySelected = technicians[1];
    await lockTechnicianRoster(connection);
    await connection.execute(
      "UPDATE user_account u JOIN technician t ON t.user_id=u.user_id SET u.status='Active'",
    );
    await connection.execute(
      "UPDATE technician SET availability_status='Available',last_assigned_at=CASE technician_id WHEN ? THEN '2025-01-01 00:00:00' ELSE '2026-01-01 00:00:00' END",
      [automaticFirst.technicianId],
    );
    const date = nextWeekday(addCalendarDays(minimumBookingDate(), 800));
    const create = (label) =>
      createPublicBooking(db, customer, {
        serviceId: service.serviceId,
        serviceAddress: `${label} ${randomUUID()}, Singapore`,
        numberOfUnits: 1,
        preferredDate: date,
        timeWindow: '09:00 - 11:00',
        requestId: randomUUID(),
      });

    const first = await create('Manual dispatch QA');
    await approveBooking(db, owner, first.bookingId, {
      requestId: randomUUID(),
    });
    const initialOptions = await listDispatchOptions(db, first.bookingId);
    assert.equal(initialOptions.technicians.length, technicians.length);
    assert.ok(initialOptions.technicians.every((option) => option.eligible));

    const initialRequest = randomUUID();
    const assigned = await dispatchBooking(db, owner, first.bookingId, {
      requestId: initialRequest,
      mode: 'manual',
      technicianId: manuallySelected.technicianId,
    });
    assert.equal(
      assigned.technician.technicianId,
      manuallySelected.technicianId,
    );
    assert.equal(
      (
        await dispatchBooking(db, owner, first.bookingId, {
          requestId: initialRequest,
          mode: 'manual',
          technicianId: manuallySelected.technicianId,
        })
      ).replayed,
      true,
    );
    await assert.rejects(
      dispatchBooking(db, owner, first.bookingId, {
        requestId: initialRequest,
        mode: 'manual',
        technicianId: automaticFirst.technicianId,
      }),
      (error) => error.status === 409 && /request ID/i.test(error.message),
    );

    const second = await create('Manual conflict QA');
    await approveBooking(db, owner, second.bookingId, {
      requestId: randomUUID(),
    });
    await assert.rejects(
      dispatchBooking(db, owner, second.bookingId, {
        requestId: randomUUID(),
        mode: 'manual',
        technicianId: manuallySelected.technicianId,
      }),
      (error) => error.status === 409 && /overlapping/i.test(error.message),
    );
    await connection.execute(
      "UPDATE user_account SET status='Suspended' WHERE user_id=?",
      [automaticFirst.userId],
    );
    await assert.rejects(
      dispatchBooking(db, owner, second.bookingId, {
        requestId: randomUUID(),
        mode: 'manual',
        technicianId: automaticFirst.technicianId,
      }),
      (error) => error.status === 409 && /active account/i.test(error.message),
    );
    await connection.execute(
      "UPDATE user_account SET status='Active' WHERE user_id=?",
      [automaticFirst.userId],
    );
    await connection.execute(
      "UPDATE technician SET availability_status='On Leave' WHERE technician_id=?",
      [automaticFirst.technicianId],
    );
    await assert.rejects(
      dispatchBooking(db, owner, second.bookingId, {
        requestId: randomUUID(),
        mode: 'manual',
        technicianId: automaticFirst.technicianId,
      }),
      (error) => error.status === 409 && /on leave/i.test(error.message),
    );
    await assert.rejects(
      dispatchBooking(db, owner, second.bookingId, {
        requestId: randomUUID(),
        mode: 'manual',
        technicianId: 4294967295,
      }),
      (error) => error.status === 409 && /not found/i.test(error.message),
    );
    const blockedOptions = await listDispatchOptions(db, second.bookingId);
    assert.match(
      blockedOptions.technicians.find(
        (option) => option.technicianId === manuallySelected.technicianId,
      ).reason,
      /overlapping/i,
    );
    assert.match(
      blockedOptions.technicians.find(
        (option) => option.technicianId === automaticFirst.technicianId,
      ).reason,
      /leave/i,
    );

    await connection.execute(
      "UPDATE technician SET availability_status='Available' WHERE technician_id=?",
      [automaticFirst.technicianId],
    );
    const redispatchOptions = await listDispatchOptions(db, first.bookingId),
      current = redispatchOptions.technicians.find(
        (option) => option.technicianId === manuallySelected.technicianId,
      ),
      replacement = redispatchOptions.technicians.find(
        (option) => option.technicianId === automaticFirst.technicianId,
      );
    assert.equal(current.current, true);
    assert.equal(current.eligible, false);
    assert.match(current.reason, /currently assigned/i);
    assert.equal(replacement.eligible, true);
    await assert.rejects(
      dispatchBooking(
        db,
        owner,
        first.bookingId,
        {
          requestId: randomUUID(),
          mode: 'manual',
          technicianId: manuallySelected.technicianId,
        },
        { redispatch: true },
      ),
      (error) =>
        error.status === 409 && /different technician/i.test(error.message),
    );
    const redispatchRequest = randomUUID();
    const reassigned = await dispatchBooking(
      db,
      owner,
      first.bookingId,
      {
        requestId: redispatchRequest,
        mode: 'manual',
        technicianId: automaticFirst.technicianId,
      },
      { redispatch: true },
    );
    assert.equal(
      reassigned.technician.technicianId,
      automaticFirst.technicianId,
    );
    assert.equal(
      (
        await dispatchBooking(
          db,
          owner,
          first.bookingId,
          {
            requestId: redispatchRequest,
            mode: 'manual',
            technicianId: automaticFirst.technicianId,
          },
          { redispatch: true },
        )
      ).replayed,
      true,
    );
    const [assignmentRows] = await connection.execute(
      `SELECT a.assignment_status AS assignmentStatus,w.current_status AS workStatus
      FROM assignment a JOIN work_order w ON w.assignment_id=a.assignment_id
      WHERE a.booking_id=? ORDER BY a.assignment_id`,
      [first.bookingId],
    );
    assert.deepEqual(assignmentRows, [
      { assignmentStatus: 'Reassigned', workStatus: 'Cancelled' },
      { assignmentStatus: 'Assigned', workStatus: 'Assigned' },
    ]);
    const [[customerMail]] = await connection.execute(
      `SELECT COUNT(*) AS count FROM booking_email_outbox
      WHERE booking_id=? AND recipient=? AND event_type='booking.assigned'`,
      [first.bookingId, customer.email],
    );
    assert.equal(Number(customerMail.count), 2);
    const [[technicianMail]] = await connection.execute(
      `SELECT COUNT(*) AS count FROM booking_email_outbox
      WHERE booking_id=? AND recipient IN (?,?)`,
      [first.bookingId, manuallySelected.email, automaticFirst.email],
    );
    assert.equal(Number(technicianMail.count), 0);
    const [[failedDispatchMail]] = await connection.execute(
      'SELECT COUNT(*) AS count FROM booking_email_outbox WHERE booking_id=?',
      [second.bookingId],
    );
    assert.equal(Number(failedDispatchMail.count), 0);
  }));

test('concurrent submissions serialize the last team-capacity place and released bookings reopen it', async () => {
  const suffix = randomUUID().slice(0, 8),
    date = nextWeekday(addCalendarDays(minimumBookingDate(), 2400));
  const [eligibleRows] =
    await pool.execute(`SELECT t.technician_id FROM technician t JOIN user_account u ON u.user_id=t.user_id
    WHERE u.status='Active' AND t.availability_status NOT IN ('Unavailable','On Leave') ORDER BY t.technician_id`);
  assert.ok(eligibleRows.length >= 1);
  const userIds = [],
    customerIds = [],
    bookingIds = [];
  try {
    const [[role]] = await rootPool.execute(
      "SELECT role_id AS roleId FROM role WHERE role_name='Customer'",
    );
    const [[service]] = await rootPool.execute(
      "SELECT service_id AS serviceId FROM simple_service_catalog WHERE code='cleaning'",
    );
    for (let index = 0; index < eligibleRows.length + 1; index++) {
      const [created] = await rootPool.execute(
        `INSERT INTO user_account(role_id,full_name,email,password_hash,phone,status)
        VALUES (?,?,?,?,?,'Active')`,
        [
          role.roleId,
          `Capacity User ${suffix}-${index}`,
          `capacity-${suffix}-${index}@example.test`,
          '$2b$12$2b2t12wFdummypasswordhashthatwillneverlogin0000000000000',
          '91234567',
        ],
      );
      userIds.push(created.insertId);
      const [customer] = await rootPool.execute(
        'INSERT INTO customer(user_id) VALUES (?)',
        [created.insertId],
      );
      customerIds.push(customer.insertId);
    }
    const submit = async (index) => {
      const booking = await createPublicBooking(
        pool,
        { id: userIds[index], phone: '91234567' },
        {
          serviceId: service.serviceId,
          serviceAddress: `Capacity ${suffix} #${index}, Singapore`,
          numberOfUnits: 1,
          preferredDate: date,
          timeWindow: '09:00 - 11:00',
          requestId: randomUUID(),
        },
      );
      bookingIds.push(booking.bookingId);
      return booking;
    };
    for (let index = 0; index < eligibleRows.length - 1; index++)
      await submit(index);
    const contenders = await Promise.allSettled([
      submit(eligibleRows.length - 1),
      submit(eligibleRows.length),
    ]);
    const [[reserved]] = await rootPool.execute(
      `SELECT COUNT(*) AS count FROM booking WHERE preferred_service_date=? AND slot_start='09:00:00'
      AND booking_status IN ('Submitted','Confirmed','Assigned','On The Way','In Progress') AND customer_id IN (${customerIds.map(() => '?').join(',')})`,
      [date, ...customerIds],
    );
    assert.equal(
      contenders.filter((result) => result.status === 'fulfilled').length,
      1,
      JSON.stringify({
        eligible: eligibleRows.length,
        reserved: reserved.count,
        bookingIds,
      }),
    );
    const failed = contenders.find((result) => result.status === 'rejected');
    assert.equal(failed.reason.status, 409);
    assert.match(failed.reason.message, /fully booked/i);
    assert.equal(Number(reserved.count), eligibleRows.length);
    assert.equal(
      (await getTeamSlotAvailability(pool, [date])).dates[0].slots[0].available,
      false,
    );
    await rootPool.execute(
      "UPDATE booking SET booking_status='Rejected' WHERE booking_id=?",
      [bookingIds[0]],
    );
    assert.equal(
      (await getTeamSlotAvailability(pool, [date])).dates[0].slots[0].available,
      true,
    );
  } finally {
    if (customerIds.length) {
      const placeholders = customerIds.map(() => '?').join(',');
      const [rows] = await rootPool.execute(
        `SELECT booking_id FROM booking WHERE customer_id IN (${placeholders})`,
        customerIds,
      );
      const ids = rows.map((row) => row.booking_id);
      if (ids.length) {
        const bookingPlaceholders = ids.map(() => '?').join(',');
        for (const table of [
          'booking_email_outbox',
          'booking_admin_operation',
          'booking_change_request',
          'booking_status_history',
          'booking_aircon_unit',
          'booking_service',
          'booking_package',
          'web_booking_details',
        ]) {
          await rootPool.execute(
            `DELETE FROM ${table} WHERE booking_id IN (${bookingPlaceholders})`,
            ids,
          );
        }
        await rootPool.execute(
          `DELETE FROM booking WHERE booking_id IN (${bookingPlaceholders})`,
          ids,
        );
      }
      await rootPool.execute(
        `DELETE FROM aircon_unit WHERE customer_id IN (${placeholders})`,
        customerIds,
      );
      await rootPool.execute(
        `DELETE FROM service_address WHERE customer_id IN (${placeholders})`,
        customerIds,
      );
      await rootPool.execute(
        `DELETE FROM customer WHERE customer_id IN (${placeholders})`,
        customerIds,
      );
    }
    if (userIds.length)
      await rootPool.execute(
        `DELETE FROM web_customer_profile WHERE user_id IN (${userIds.map(() => '?').join(',')})`,
        userIds,
      );
    if (userIds.length)
      await rootPool.execute(
        `DELETE FROM user_account WHERE user_id IN (${userIds.map(() => '?').join(',')})`,
        userIds,
      );
    await rootPool.execute(
      'DELETE FROM service_day_capacity_lock WHERE service_date=?',
      [date],
    );
  }
});
