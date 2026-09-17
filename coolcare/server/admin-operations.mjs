import express from 'express';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { AppError, idSchema } from './inventory.mjs';
import { enqueueBookingLifecycleEmail } from './booking-email.mjs';
import { inviteStaff } from './staff-invitations.mjs';
import {
  assertAddressBookingLimit,
  lockCustomer,
} from './customer/booking-options.mjs';
import { assertAnnualRescheduleWindow } from './customer/annual-bookings.mjs';
import {
  assertBookableDate,
  isCalendarDate,
} from './customer/booking-schedule.mjs';
import {
  assertTeamCapacity,
  lockServiceDates,
  lockTechnicianRoster,
  normalizeBookingSlot,
} from './scheduling.mjs';

const requestSchema = z.object({ requestId: z.uuid() }).strict();
const rejectSchema = requestSchema
  .extend({ reason: z.string().trim().min(3).max(500) })
  .strict();
const rescheduleSchema = requestSchema
  .extend({
    preferredDate: z
      .string()
      .refine(isCalendarDate, 'Choose a valid service date.'),
    timeSlot: z.string().trim().min(1).max(50),
  })
  .strict();
const scheduleQuerySchema = z
  .object({
    from: z.string().refine(isCalendarDate, 'Choose a valid start date.'),
    to: z.string().refine(isCalendarDate, 'Choose a valid end date.'),
  })
  .strict()
  .refine(
    ({ from, to }) => {
      const days =
        (new Date(`${to}T00:00:00Z`).getTime() -
          new Date(`${from}T00:00:00Z`).getTime()) /
        86400000;
      return days >= 0 && days <= 30;
    },
    'Choose a date range of 31 days or fewer.',
  );
const pageSchema = z.object({
  status: z
    .enum([
      '',
      'Submitted',
      'Confirmed',
      'Assigned',
      'On The Way',
      'In Progress',
      'Completed',
      'Rejected',
      'Cancelled',
    ])
    .default(''),
  q: z.string().trim().max(120).default(''),
  page: z.coerce.number().int().min(1).max(1000000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

const stableHash = (value) =>
  createHash('sha256')
    .update(JSON.stringify(value, Object.keys(value).sort()))
    .digest('hex');

async function beginOperation(
  connection,
  { requestId, bookingId, actorUserId, type, payload },
) {
  const hash = stableHash(payload);
  const [[existing]] = await connection.execute(
    'SELECT * FROM booking_admin_operation WHERE request_id=? FOR UPDATE',
    [requestId],
  );
  if (existing) {
    if (
      existing.booking_id !== bookingId ||
      existing.actor_user_id !== actorUserId ||
      existing.operation_type !== type ||
      existing.payload_hash !== hash
    ) {
      throw new AppError(
        'This request ID was already used for a different operation.',
        409,
      );
    }
    return {
      replayed: true,
      result:
        typeof existing.result_json === 'string'
          ? JSON.parse(existing.result_json)
          : existing.result_json,
    };
  }
  return { replayed: false, hash };
}

async function finishOperation(
  connection,
  { requestId, bookingId, actorUserId, type, hash, result },
) {
  await connection.execute(
    `INSERT INTO booking_admin_operation(request_id,booking_id,actor_user_id,operation_type,payload_hash,result_json)
    VALUES (?,?,?,?,?,?)`,
    [requestId, bookingId, actorUserId, type, hash, JSON.stringify(result)],
  );
}

async function lockedBooking(connection, bookingId) {
  const [[booking]] = await connection.execute(
    'SELECT * FROM booking WHERE booking_id=? FOR UPDATE',
    [bookingId],
  );
  if (!booking) throw new AppError('Booking not found.', 404);
  const [[details]] = await connection.execute(
    `SELECT sa.address_line,sc.service_name,
    (SELECT COUNT(*) FROM booking_aircon_unit bu WHERE bu.booking_id=?) AS unit_count
    FROM service_address sa JOIN service_catalog sc ON sc.service_id=? WHERE sa.address_id=?`,
    [bookingId, booking.service_id, booking.address_id],
  );
  Object.assign(booking, details);
  if (!booking.slot_start || !booking.slot_end) {
    const slot = normalizeBookingSlot(booking.preferred_time_slot);
    booking.slot_start = slot.start;
    booking.slot_end = slot.end;
    await connection.execute(
      'UPDATE booking SET slot_start=?,slot_end=? WHERE booking_id=?',
      [slot.start, slot.end, bookingId],
    );
  }
  return booking;
}

export async function approveBooking(pool, actor, bookingId, raw) {
  const data = requestSchema.parse(raw),
    connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const operation = await beginOperation(connection, {
      requestId: data.requestId,
      bookingId,
      actorUserId: actor.userId,
      type: 'Approve',
      payload: data,
    });
    if (operation.replayed) {
      await connection.commit();
      return { ...operation.result, replayed: true };
    }
    const booking = await lockedBooking(connection, bookingId);
    if (booking.booking_status !== 'Submitted')
      throw new AppError('Only submitted bookings can be approved.', 409);
    await lockServiceDates(connection, [booking.preferred_service_date]);
    await connection.execute(
      "UPDATE booking SET booking_status='Confirmed' WHERE booking_id=?",
      [bookingId],
    );
    await connection.execute(
      `INSERT INTO booking_status_history(booking_id,old_status,new_status,changed_by_user_id,change_note)
      VALUES (?,'Submitted','Confirmed',?,'Booking request reviewed and approved by the service team.')`,
      [bookingId, actor.userId],
    );
    const result = { bookingId, status: 'Confirmed' };
    await finishOperation(connection, {
      requestId: data.requestId,
      bookingId,
      actorUserId: actor.userId,
      type: 'Approve',
      hash: operation.hash,
      result,
    });
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function rejectBooking(pool, actor, bookingId, raw) {
  const data = rejectSchema.parse(raw),
    connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const operation = await beginOperation(connection, {
      requestId: data.requestId,
      bookingId,
      actorUserId: actor.userId,
      type: 'Reject',
      payload: data,
    });
    if (operation.replayed) {
      await connection.commit();
      return { ...operation.result, replayed: true };
    }
    const booking = await lockedBooking(connection, bookingId);
    if (booking.booking_status !== 'Submitted')
      throw new AppError('Only submitted bookings can be rejected.', 409);
    await lockServiceDates(connection, [booking.preferred_service_date]);
    await connection.execute(
      "UPDATE booking SET booking_status='Rejected' WHERE booking_id=?",
      [bookingId],
    );
    await connection.execute(
      `INSERT INTO booking_status_history(booking_id,old_status,new_status,changed_by_user_id,change_note)
      VALUES (?,'Submitted','Rejected',?,?)`,
      [bookingId, actor.userId, data.reason],
    );
    const result = { bookingId, status: 'Rejected', reason: data.reason };
    await finishOperation(connection, {
      requestId: data.requestId,
      bookingId,
      actorUserId: actor.userId,
      type: 'Reject',
      hash: operation.hash,
      result,
    });
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function chooseTechnician(
  connection,
  booking,
  { excludeTechnicianId = 0 } = {},
) {
  const date = String(booking.preferred_service_date).slice(0, 10);
  await lockTechnicianRoster(connection);
  const [eligible] = await connection.execute(
    `SELECT t.technician_id FROM technician t JOIN user_account u ON u.user_id=t.user_id
    JOIN role r ON r.role_id=u.role_id WHERE u.status='Active' AND r.role_name='Technician'
    AND t.availability_status NOT IN ('Unavailable','On Leave') AND t.technician_id<>? ORDER BY t.technician_id`,
    [excludeTechnicianId],
  );
  if (!eligible.length)
    throw new AppError(
      'No technician is available for this confirmed time. Review technician availability and try again.',
      409,
    );
  const eligibleIds = eligible.map((row) => row.technician_id);
  await connection.execute(
    `SELECT technician_id FROM technician WHERE technician_id IN (${eligibleIds.map(() => '?').join(',')}) ORDER BY technician_id FOR UPDATE`,
    eligibleIds,
  );
  const [rows] = await connection.execute(
    `SELECT t.technician_id AS technicianId,t.user_id AS userId,u.full_name AS fullName,
    t.last_assigned_at AS lastAssignedAt,
    (SELECT COUNT(*) FROM assignment daily_assignment JOIN work_order daily_work ON daily_work.assignment_id=daily_assignment.assignment_id
      WHERE daily_assignment.technician_id=t.technician_id AND DATE(daily_work.appointment_date)=?
      AND daily_assignment.assignment_status NOT IN ('Declined','Reassigned','Cancelled','Completed')
      AND daily_work.current_status NOT IN ('Completed','Cancelled')) AS dailyJobs
    FROM technician t JOIN user_account u ON u.user_id=t.user_id JOIN role r ON r.role_id=u.role_id
    WHERE u.status='Active' AND r.role_name='Technician' AND t.availability_status NOT IN ('Unavailable','On Leave')
    AND t.technician_id<>?
    AND NOT EXISTS (
      SELECT 1 FROM assignment occupied_assignment
      JOIN work_order occupied_work ON occupied_work.assignment_id=occupied_assignment.assignment_id
      JOIN booking occupied_booking ON occupied_booking.booking_id=occupied_work.booking_id
      WHERE occupied_assignment.technician_id=t.technician_id
      AND occupied_assignment.assignment_status NOT IN ('Declined','Reassigned','Cancelled','Completed')
      AND occupied_work.current_status NOT IN ('Completed','Cancelled')
      AND occupied_booking.preferred_service_date=?
      AND occupied_booking.slot_start<? AND occupied_booking.slot_end>?
    )
    ORDER BY dailyJobs ASC,(t.last_assigned_at IS NULL) DESC,t.last_assigned_at ASC,t.technician_id ASC
    LIMIT 1`,
    [date, excludeTechnicianId, date, booking.slot_end, booking.slot_start],
  );
  if (!rows.length)
    throw new AppError(
      'No technician is available for this confirmed time. Review technician availability and try again.',
      409,
    );
  return rows[0];
}

async function createAssignment(
  connection,
  actor,
  booking,
  technician,
  requestId,
) {
  const date = String(booking.preferred_service_date).slice(0, 10),
    start = String(booking.slot_start).slice(0, 8);
  const priority = String(booking.service_name).toLowerCase().includes('repair')
    ? 'High'
    : 'Normal';
  const [assignment] = await connection.execute(
    `INSERT INTO assignment
    (booking_id,technician_id,assigned_by_admin_id,dispatch_request_id,assignment_status)
    VALUES (?,?,?,?,'Assigned')`,
    [booking.booking_id, technician.technicianId, actor.userId, requestId],
  );
  const [workOrder] = await connection.execute(
    `INSERT INTO work_order
    (booking_id,assignment_id,appointment_date,appointment_time,priority_level,reported_problem,current_status)
    VALUES (?,?,?,?,?,?,'Assigned')`,
    [
      booking.booking_id,
      assignment.insertId,
      `${date} ${start}`,
      start,
      priority,
      booking.problem_description || null,
    ],
  );
  await connection.execute(
    'UPDATE technician SET last_assigned_at=UTC_TIMESTAMP() WHERE technician_id=?',
    [technician.technicianId],
  );
  return { assignmentId: assignment.insertId, jobId: workOrder.insertId };
}

export async function dispatchBooking(
  pool,
  actor,
  bookingId,
  raw,
  { redispatch = false } = {},
) {
  const data = requestSchema.parse(raw),
    type = redispatch ? 'Redispatch' : 'Dispatch',
    connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const operation = await beginOperation(connection, {
      requestId: data.requestId,
      bookingId,
      actorUserId: actor.userId,
      type,
      payload: data,
    });
    if (operation.replayed) {
      await connection.commit();
      return { ...operation.result, replayed: true };
    }
    const booking = await lockedBooking(connection, bookingId);
    if (
      redispatch
        ? booking.booking_status !== 'Assigned'
        : booking.booking_status !== 'Confirmed'
    ) {
      throw new AppError(
        redispatch
          ? 'Only assigned bookings can be redispatched.'
          : 'Approve this booking before dispatching it.',
        409,
      );
    }
    await lockServiceDates(connection, [booking.preferred_service_date]);
    let previous = null;
    if (redispatch) {
      [[previous]] = await connection.execute(
        `SELECT a.assignment_id AS assignmentId,a.technician_id AS technicianId,w.job_id AS jobId,w.current_status AS workStatus
        FROM assignment a JOIN work_order w ON w.assignment_id=a.assignment_id
        WHERE a.booking_id=? AND a.assignment_status NOT IN ('Declined','Reassigned','Cancelled','Completed')
        ORDER BY a.assignment_id DESC LIMIT 1 FOR UPDATE`,
        [bookingId],
      );
      if (!previous || previous.workStatus !== 'Assigned')
        throw new AppError(
          'A work order can only be redispatched before the technician starts travelling.',
          409,
        );
    }
    const technician = await chooseTechnician(connection, booking, {
      excludeTechnicianId: previous?.technicianId ?? 0,
    });
    if (previous) {
      await connection.execute(
        "UPDATE assignment SET assignment_status='Reassigned' WHERE assignment_id=?",
        [previous.assignmentId],
      );
      await connection.execute(
        "UPDATE work_order SET current_status='Cancelled' WHERE job_id=?",
        [previous.jobId],
      );
    }
    const created = await createAssignment(
      connection,
      actor,
      booking,
      technician,
      data.requestId,
    );
    if (!redispatch)
      await connection.execute(
        "UPDATE booking SET booking_status='Assigned' WHERE booking_id=?",
        [bookingId],
      );
    const note = redispatch
      ? `Work order automatically reassigned to ${technician.fullName}.`
      : `Automatically assigned to ${technician.fullName} using current workload and rotation order.`;
    await connection.execute(
      `INSERT INTO booking_status_history(booking_id,old_status,new_status,changed_by_user_id,change_note)
      VALUES (?,?,?,?,?)`,
      [
        bookingId,
        redispatch ? 'Assigned' : 'Confirmed',
        'Assigned',
        actor.userId,
        note,
      ],
    );
    await enqueueBookingLifecycleEmail(
      connection,
      bookingId,
      'booking.assigned',
      {
        technicianName: technician.fullName,
        eventKey: redispatch
          ? `booking.reassigned:${bookingId}:${created.assignmentId}`
          : undefined,
      },
    );
    const result = {
      bookingId,
      status: 'Assigned',
      technician: {
        technicianId: technician.technicianId,
        fullName: technician.fullName,
      },
      ...created,
    };
    await finishOperation(connection, {
      requestId: data.requestId,
      bookingId,
      actorUserId: actor.userId,
      type,
      hash: operation.hash,
      result,
    });
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function rescheduleAdminBooking(
  pool,
  actor,
  bookingId,
  raw,
) {
  const data = rescheduleSchema.parse(raw),
    connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[identity]] = await connection.execute(
      `SELECT c.user_id AS userId FROM booking b
      JOIN customer c ON c.customer_id=b.customer_id WHERE b.booking_id=?`,
      [bookingId],
    );
    if (!identity) throw new AppError('Booking not found.', 404);
    const customer = await lockCustomer(connection, identity.userId);
    const operation = await beginOperation(connection, {
      requestId: data.requestId,
      bookingId,
      actorUserId: actor.userId,
      type: 'Reschedule',
      payload: data,
    });
    if (operation.replayed) {
      await connection.commit();
      return { ...operation.result, replayed: true };
    }
    const booking = await lockedBooking(connection, bookingId);
    if (!['Submitted', 'Confirmed'].includes(booking.booking_status))
      throw new AppError(
        'Only unassigned bookings awaiting review or dispatch can be rescheduled.',
        409,
      );
    const [[assignment]] = await connection.execute(
      'SELECT COUNT(*) AS count FROM assignment WHERE booking_id=?',
      [bookingId],
    );
    if (Number(assignment.count) > 0)
      throw new AppError(
        'This booking already has an assignment and its schedule is locked.',
        409,
      );
    assertBookableDate(data.preferredDate);
    await assertAnnualRescheduleWindow(
      connection,
      bookingId,
      data.preferredDate,
    );
    await assertAddressBookingLimit(
      connection,
      customer.customerId,
      booking.address_line,
      data.preferredDate,
      bookingId,
    );
    if (booking.subscription_id) {
      const [[subscription]] = await connection.execute(
        `SELECT start_date,end_date,subscription_status FROM customer_subscription
        WHERE subscription_id=? AND customer_id=? FOR UPDATE`,
        [booking.subscription_id, customer.customerId],
      );
      if (
        !subscription ||
        subscription.subscription_status !== 'Active' ||
        data.preferredDate < String(subscription.start_date).slice(0, 10) ||
        data.preferredDate > String(subscription.end_date).slice(0, 10)
      )
        throw new AppError(
          'Choose a date within the customer’s active membership period.',
          409,
        );
    }
    const slot = normalizeBookingSlot(data.timeSlot),
      oldDate = String(booking.preferred_service_date).slice(0, 10),
      oldTimeSlot = booking.preferred_time_slot;
    await lockServiceDates(connection, [oldDate, data.preferredDate]);
    await assertTeamCapacity(
      connection,
      [
        {
          date: data.preferredDate,
          start: slot.start,
          end: slot.end,
        },
      ],
      { excludeBookingId: bookingId },
    );
    await connection.execute(
      `UPDATE booking SET preferred_service_date=?,preferred_time_slot=?,slot_start=?,slot_end=?
      WHERE booking_id=?`,
      [data.preferredDate, slot.code, slot.start, slot.end, bookingId],
    );
    await connection.execute(
      `INSERT INTO booking_change_request
      (booking_id,request_type,requested_service_date,requested_time_slot,reason,request_status)
      VALUES (?,'Reschedule',?,?,?,'Approved')`,
      [
        bookingId,
        data.preferredDate,
        slot.code,
        'Appointment adjusted by an administrator before dispatch.',
      ],
    );
    await connection.execute(
      `INSERT INTO booking_status_history
      (booking_id,old_status,new_status,changed_by_user_id,change_note)
      VALUES (?,?,?,?,?)`,
      [
        bookingId,
        booking.booking_status,
        booking.booking_status,
        actor.userId,
        `Appointment changed from ${oldDate} ${oldTimeSlot} to ${data.preferredDate} ${slot.code} before dispatch.`,
      ],
    );
    const result = {
      bookingId,
      status: booking.booking_status,
      preferredDate: data.preferredDate,
      timeSlot: slot.code,
    };
    await finishOperation(connection, {
      requestId: data.requestId,
      bookingId,
      actorUserId: actor.userId,
      type: 'Reschedule',
      hash: operation.hash,
      result,
    });
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function listAdminBookings(pool, query) {
  const data = pageSchema.parse(query),
    where = [],
    values = [];
  if (data.status) {
    where.push('b.booking_status=?');
    values.push(data.status);
  }
  if (data.q) {
    where.push(
      '(u.full_name LIKE ? OR u.email LIKE ? OR CAST(b.booking_id AS CHAR)=?)',
    );
    values.push(`%${data.q}%`, `%${data.q}%`, data.q.replace(/^BK-0*/i, ''));
  }
  const clause = where.length ? ' WHERE ' + where.join(' AND ') : '';
  const [[{ total }]] = await pool.execute(
    `SELECT COUNT(*) AS total FROM booking b JOIN customer c ON c.customer_id=b.customer_id
    JOIN user_account u ON u.user_id=c.user_id${clause}`,
    values,
  );
  const page = Math.min(
    data.page,
    Math.max(1, Math.ceil(Number(total) / data.pageSize)),
  );
  const [rows] = await pool.execute(
    `SELECT b.booking_id AS bookingId,b.booking_status AS status,b.preferred_service_date AS preferredDate,
    b.preferred_time_slot AS timeSlot,b.total_amount AS totalAmount,b.created_at AS createdAt,u.full_name AS customerName,u.email,
    sa.address_line AS addressLine,COALESCE(GROUP_CONCAT(DISTINCT bs.service_name ORDER BY bs.service_id SEPARATOR ', '),sc.service_name) AS serviceName,
    (SELECT COUNT(*) FROM booking_aircon_unit bu WHERE bu.booking_id=b.booking_id) AS numberOfUnits,
    (SELECT technician_user.full_name FROM assignment latest_assignment JOIN technician latest_technician ON latest_technician.technician_id=latest_assignment.technician_id
      JOIN user_account technician_user ON technician_user.user_id=latest_technician.user_id WHERE latest_assignment.booking_id=b.booking_id
      ORDER BY latest_assignment.assignment_id DESC LIMIT 1) AS technicianName
    FROM booking b JOIN customer c ON c.customer_id=b.customer_id JOIN user_account u ON u.user_id=c.user_id
    JOIN service_address sa ON sa.address_id=b.address_id JOIN service_catalog sc ON sc.service_id=b.service_id
    LEFT JOIN booking_service bs ON bs.booking_id=b.booking_id${clause}
    GROUP BY b.booking_id,b.booking_status,b.preferred_service_date,b.preferred_time_slot,b.total_amount,b.created_at,u.full_name,u.email,sa.address_line,sc.service_name
    ORDER BY FIELD(b.booking_status,'Submitted','Confirmed','Assigned','On The Way','In Progress','Completed','Rejected','Cancelled'),b.preferred_service_date,b.booking_id
    LIMIT ? OFFSET ?`,
    [...values, data.pageSize, (page - 1) * data.pageSize],
  );
  return { rows, total: Number(total), page, pageSize: data.pageSize };
}

export async function listAdminSchedule(pool, query) {
  const data = scheduleQuerySchema.parse(query);
  const [rows] = await pool.execute(
    `SELECT b.booking_id AS bookingId,b.booking_status AS status,
    b.preferred_service_date AS preferredDate,b.preferred_time_slot AS timeSlot,
    b.total_amount AS totalAmount,b.created_at AS createdAt,u.full_name AS customerName,u.email,
    sa.address_line AS addressLine,
    COALESCE(GROUP_CONCAT(DISTINCT bs.service_name ORDER BY bs.service_id SEPARATOR ', '),sc.service_name) AS serviceName,
    (SELECT COUNT(*) FROM booking_aircon_unit bu WHERE bu.booking_id=b.booking_id) AS numberOfUnits,
    (SELECT technician_user.full_name FROM assignment latest_assignment
      JOIN technician latest_technician ON latest_technician.technician_id=latest_assignment.technician_id
      JOIN user_account technician_user ON technician_user.user_id=latest_technician.user_id
      WHERE latest_assignment.booking_id=b.booking_id
      ORDER BY latest_assignment.assignment_id DESC LIMIT 1) AS technicianName
    FROM booking b JOIN customer c ON c.customer_id=b.customer_id
    JOIN user_account u ON u.user_id=c.user_id
    JOIN service_address sa ON sa.address_id=b.address_id
    JOIN service_catalog sc ON sc.service_id=b.service_id
    LEFT JOIN booking_service bs ON bs.booking_id=b.booking_id
    WHERE b.preferred_service_date BETWEEN ? AND ?
    AND b.booking_status NOT IN ('Rejected','Cancelled')
    GROUP BY b.booking_id,b.booking_status,b.preferred_service_date,b.preferred_time_slot,
      b.total_amount,b.created_at,u.full_name,u.email,sa.address_line,sc.service_name
    ORDER BY b.preferred_service_date,b.slot_start,b.booking_id`,
    [data.from, data.to],
  );
  return { from: data.from, to: data.to, rows };
}

export async function getAdminBooking(pool, bookingId) {
  const [[booking]] = await pool.execute(
    `SELECT b.booking_id AS bookingId,b.booking_status AS status,b.preferred_service_date AS preferredDate,
    b.preferred_time_slot AS timeSlot,b.problem_description AS problemDescription,b.total_amount AS totalAmount,b.created_at AS createdAt,
    u.full_name AS customerName,u.email,u.phone,sa.address_line AS addressLine,sa.postal_code AS postalCode,
    COALESCE(GROUP_CONCAT(DISTINCT bs.service_name ORDER BY bs.service_id SEPARATOR ', '),sc.service_name) AS serviceName,
    (SELECT COUNT(*) FROM booking_aircon_unit bu WHERE bu.booking_id=b.booking_id) AS numberOfUnits
    FROM booking b JOIN customer c ON c.customer_id=b.customer_id JOIN user_account u ON u.user_id=c.user_id
    JOIN service_address sa ON sa.address_id=b.address_id JOIN service_catalog sc ON sc.service_id=b.service_id
    LEFT JOIN booking_service bs ON bs.booking_id=b.booking_id WHERE b.booking_id=?
    GROUP BY b.booking_id,b.booking_status,b.preferred_service_date,b.preferred_time_slot,b.problem_description,b.total_amount,b.created_at,
      u.full_name,u.email,u.phone,sa.address_line,sa.postal_code,sc.service_name`,
    [bookingId],
  );
  if (!booking) throw new AppError('Booking not found.', 404);
  const [timeline] = await pool.execute(
    `SELECT h.history_id AS historyId,h.old_status AS oldStatus,h.new_status AS status,
    h.change_note AS note,h.changed_at AS changedAt,u.full_name AS changedBy FROM booking_status_history h
    LEFT JOIN user_account u ON u.user_id=h.changed_by_user_id WHERE h.booking_id=? ORDER BY h.changed_at,h.history_id`,
    [bookingId],
  );
  const [assignments] = await pool.execute(
    `SELECT a.assignment_id AS assignmentId,a.assignment_status AS status,a.assigned_at AS assignedAt,
    u.full_name AS technicianName,w.job_id AS jobId,w.current_status AS workStatus
    FROM assignment a JOIN technician t ON t.technician_id=a.technician_id JOIN user_account u ON u.user_id=t.user_id
    LEFT JOIN work_order w ON w.assignment_id=a.assignment_id WHERE a.booking_id=? ORDER BY a.assignment_id DESC`,
    [bookingId],
  );
  return { ...booking, timeline, assignments };
}

export async function listStaff(pool, roleName) {
  const table = roleName === 'Admin' ? 'admin_profile' : 'technician';
  const extra =
    roleName === 'Admin'
      ? 'p.access_level AS accessLevel'
      : `p.technician_id AS technicianId,p.availability_status AS availability,p.last_assigned_at AS lastAssignedAt,
    (SELECT COUNT(*) FROM assignment future_assignment JOIN work_order future_work ON future_work.assignment_id=future_assignment.assignment_id
      WHERE future_assignment.technician_id=p.technician_id AND future_assignment.assignment_status NOT IN ('Declined','Reassigned','Cancelled','Completed')
      AND future_work.current_status NOT IN ('Completed','Cancelled') AND future_work.appointment_date>=CURRENT_DATE) AS futureWorkOrders`;
  const [rows] = await pool.execute(
    `SELECT u.user_id AS userId,u.full_name AS fullName,u.email,u.phone,u.status,u.created_at AS createdAt,${extra},
    latest.invitation_id AS invitationId,latest.expires_at AS invitationExpiresAt,latest.accepted_at AS invitationAcceptedAt,latest.revoked_at AS invitationRevokedAt
    FROM user_account u JOIN role r ON r.role_id=u.role_id JOIN ${table} p ON p.user_id=u.user_id
    LEFT JOIN staff_invitation latest ON latest.invitation_id=(SELECT i.invitation_id FROM staff_invitation i WHERE i.user_id=u.user_id ORDER BY i.invitation_id DESC LIMIT 1)
    WHERE r.role_name=? ORDER BY u.status='Active' DESC,u.full_name,u.user_id`,
    [roleName],
  );
  return rows;
}

async function assertTechnicianCanBecomeUnavailable(connection, technicianId) {
  const [[assigned]] = await connection.execute(
    `SELECT COUNT(*) AS count FROM assignment a JOIN work_order w ON w.assignment_id=a.assignment_id
    WHERE a.technician_id=? AND a.assignment_status NOT IN ('Declined','Reassigned','Cancelled','Completed')
    AND w.current_status NOT IN ('Completed','Cancelled') AND w.appointment_date>=UTC_TIMESTAMP()`,
    [technicianId],
  );
  if (Number(assigned.count) > 0)
    throw new AppError(
      'Redispatch this technician’s future work orders before making the account unavailable.',
      409,
    );
  const [[roster]] =
    await connection.execute(`SELECT COUNT(*) AS count FROM technician t JOIN user_account u ON u.user_id=t.user_id
    WHERE u.status='Active' AND t.availability_status NOT IN ('Unavailable','On Leave')`);
  const remaining = Number(roster.count) - 1;
  const [[overbooked]] = await connection.execute(
    `SELECT b.preferred_service_date,b.slot_start,COUNT(*) AS reservations FROM booking b
    WHERE b.preferred_service_date>=CURRENT_DATE AND b.booking_status IN ('Submitted','Confirmed','Assigned','On The Way','In Progress')
    GROUP BY b.preferred_service_date,b.slot_start,b.slot_end HAVING COUNT(*)>? LIMIT 1`,
    [remaining],
  );
  if (overbooked)
    throw new AppError(
      'This technician is still needed for reserved customer time slots. Resolve the affected bookings first.',
      409,
    );
}

export async function updateTechnician(pool, technicianId, raw) {
  const data = z
    .object({
      accountStatus: z.enum(['Active', 'Suspended']).optional(),
      availability: z.enum(['Available', 'Unavailable', 'On Leave']).optional(),
    })
    .strict()
    .refine(
      (value) => value.accountStatus || value.availability,
      'Choose an account or availability status.',
    )
    .parse(raw);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await lockTechnicianRoster(connection);
    const [[technician]] = await connection.execute(
      `SELECT t.*,u.status FROM technician t JOIN user_account u ON u.user_id=t.user_id
      WHERE t.technician_id=? FOR UPDATE`,
      [technicianId],
    );
    if (!technician) throw new AppError('Technician not found.', 404);
    if (technician.status === 'Inactive')
      throw new AppError(
        'An invited technician must activate the account before its status can change.',
        409,
      );
    const wasEligible =
      technician.status === 'Active' &&
      !['Unavailable', 'On Leave'].includes(technician.availability_status);
    const nextStatus = data.accountStatus ?? technician.status,
      nextAvailability = data.availability ?? technician.availability_status;
    const willBeEligible =
      nextStatus === 'Active' &&
      !['Unavailable', 'On Leave'].includes(nextAvailability);
    if (wasEligible && !willBeEligible)
      await assertTechnicianCanBecomeUnavailable(connection, technicianId);
    if (data.accountStatus)
      await connection.execute(
        'UPDATE user_account SET status=? WHERE user_id=?',
        [data.accountStatus, technician.user_id],
      );
    if (data.availability)
      await connection.execute(
        'UPDATE technician SET availability_status=? WHERE technician_id=?',
        [data.availability, technicianId],
      );
    await connection.commit();
    return {
      technicianId,
      accountStatus: nextStatus,
      availability: nextAvailability,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function updateAdmin(pool, actor, targetUserId, raw) {
  if (actor.accessLevel !== 'Owner')
    throw new AppError(
      'Only the Owner can change administrator accounts.',
      403,
    );
  const data = z
    .object({ accountStatus: z.enum(['Active', 'Suspended']) })
    .strict()
    .parse(raw);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[target]] = await connection.execute(
      `SELECT a.access_level,u.status FROM admin_profile a JOIN user_account u ON u.user_id=a.user_id
      WHERE a.user_id=? FOR UPDATE`,
      [targetUserId],
    );
    if (!target) throw new AppError('Administrator not found.', 404);
    if (target.access_level === 'Owner')
      throw new AppError(
        'Transfer ownership before changing the Owner account.',
        409,
      );
    if (target.status === 'Inactive')
      throw new AppError(
        'An invited administrator must activate the account before its status can change.',
        409,
      );
    await connection.execute(
      'UPDATE user_account SET status=? WHERE user_id=?',
      [data.accountStatus, targetUserId],
    );
    await connection.commit();
    return { userId: targetUserId, accountStatus: data.accountStatus };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function revokeInvitation(pool, actor, invitationId) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[invitation]] = await connection.execute(
      `SELECT i.invitation_id AS invitationId,i.role_name AS roleName,i.accepted_at AS acceptedAt,
      i.revoked_at AS revokedAt,u.status FROM staff_invitation i JOIN user_account u ON u.user_id=i.user_id
      WHERE i.invitation_id=? FOR UPDATE`,
      [invitationId],
    );
    if (!invitation) throw new AppError('Invitation not found.', 404);
    if (invitation.roleName === 'Admin' && actor.accessLevel !== 'Owner')
      throw new AppError(
        'Only the Owner can revoke administrator invitations.',
        403,
      );
    if (invitation.acceptedAt)
      throw new AppError('This invitation has already been accepted.', 409);
    if (!invitation.revokedAt)
      await connection.execute(
        'UPDATE staff_invitation SET revoked_at=UTC_TIMESTAMP() WHERE invitation_id=?',
        [invitationId],
      );
    await connection.commit();
    return { invitationId, status: 'Revoked' };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function transferOwner(pool, actor, targetUserId) {
  if (actor.accessLevel !== 'Owner')
    throw new AppError('Only the Owner can transfer ownership.', 403);
  if (targetUserId === actor.userId)
    throw new AppError('Choose another active administrator.', 400);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [profiles] = await connection.execute(
      `SELECT a.user_id,a.access_level,u.status FROM admin_profile a JOIN user_account u ON u.user_id=a.user_id
      WHERE a.user_id IN (?,?) ORDER BY a.user_id FOR UPDATE`,
      [actor.userId, targetUserId],
    );
    const current = profiles.find((row) => row.user_id === actor.userId),
      target = profiles.find((row) => row.user_id === targetUserId);
    if (
      current?.access_level !== 'Owner' ||
      !target ||
      target.status !== 'Active'
    )
      throw new AppError(
        'Ownership can only be transferred to an active administrator.',
        409,
      );
    await connection.execute(
      "UPDATE admin_profile SET access_level='Admin' WHERE user_id=?",
      [actor.userId],
    );
    await connection.execute(
      "UPDATE admin_profile SET access_level='Owner' WHERE user_id=?",
      [targetUserId],
    );
    await connection.commit();
    return { ownerUserId: targetUserId };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export function createAdminOperationsRouter(pool, { origin } = {}) {
  const router = express.Router();
  router.get('/bookings', async (req, res) =>
    res.json(await listAdminBookings(pool, req.query)),
  );
  router.get('/schedule', async (req, res) =>
    res.json(await listAdminSchedule(pool, req.query)),
  );
  router.get('/bookings/:id', async (req, res) =>
    res.json({
      booking: await getAdminBooking(pool, idSchema.parse(req.params.id)),
    }),
  );
  router.post('/bookings/:id/approve', async (req, res) =>
    res.json(
      await approveBooking(
        pool,
        req.adminUser,
        idSchema.parse(req.params.id),
        req.body,
      ),
    ),
  );
  router.post('/bookings/:id/reject', async (req, res) =>
    res.json(
      await rejectBooking(
        pool,
        req.adminUser,
        idSchema.parse(req.params.id),
        req.body,
      ),
    ),
  );
  router.patch('/bookings/:id/reschedule', async (req, res) =>
    res.json(
      await rescheduleAdminBooking(
        pool,
        req.adminUser,
        idSchema.parse(req.params.id),
        req.body,
      ),
    ),
  );
  router.post('/bookings/:id/dispatch', async (req, res) =>
    res
      .status(201)
      .json(
        await dispatchBooking(
          pool,
          req.adminUser,
          idSchema.parse(req.params.id),
          req.body,
        ),
      ),
  );
  router.post('/bookings/:id/redispatch', async (req, res) =>
    res
      .status(201)
      .json(
        await dispatchBooking(
          pool,
          req.adminUser,
          idSchema.parse(req.params.id),
          req.body,
          { redispatch: true },
        ),
      ),
  );
  router.get('/technicians', async (_req, res) =>
    res.json({ rows: await listStaff(pool, 'Technician') }),
  );
  router.post('/technicians/invitations', async (req, res) =>
    res
      .status(201)
      .json(
        await inviteStaff(pool, req.adminUser, 'Technician', req.body, {
          origin,
        }),
      ),
  );
  router.patch('/technicians/:id', async (req, res) =>
    res.json(
      await updateTechnician(pool, idSchema.parse(req.params.id), req.body),
    ),
  );
  router.post('/invitations/:id/revoke', async (req, res) =>
    res.json(
      await revokeInvitation(
        pool,
        req.adminUser,
        idSchema.parse(req.params.id),
      ),
    ),
  );
  router.get('/admins', async (req, res) => {
    if (req.adminUser.accessLevel !== 'Owner')
      throw new AppError('Only the Owner can manage administrators.', 403);
    res.json({ rows: await listStaff(pool, 'Admin') });
  });
  router.post('/admins/invitations', async (req, res) =>
    res
      .status(201)
      .json(
        await inviteStaff(pool, req.adminUser, 'Admin', req.body, { origin }),
      ),
  );
  router.patch('/admins/:id', async (req, res) =>
    res.json(
      await updateAdmin(
        pool,
        req.adminUser,
        idSchema.parse(req.params.id),
        req.body,
      ),
    ),
  );
  router.post('/owner/transfer', async (req, res) => {
    const data = z.object({ targetUserId: idSchema }).strict().parse(req.body);
    res.json(await transferOwner(pool, req.adminUser, data.targetUserId));
  });
  return router;
}
