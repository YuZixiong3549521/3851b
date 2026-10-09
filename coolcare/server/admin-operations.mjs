import { registerReturnRoutes } from './return-visits.mjs';
import { getServiceProgress } from './service-progress.mjs';
import { assertBookingNotExpired } from './order-expiry.mjs';
import {
  addDispatchProximity,
  compareDispatchCandidates,
} from './postal-proximity.mjs';
import { listServicePhotos } from './service-photo-upload.mjs';
import express from 'express';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { AppError, idSchema } from './inventory.mjs';
import { enqueueBookingLifecycleEmail } from './booking-email.mjs';
import { inviteStaff } from './staff-invitations.mjs';
import {
  assertAddressBookingLimit,
  bookingIncludesCleaning,
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
  bookingServiceSlot,
  peakConcurrentReservations,
} from './scheduling.mjs';
import { travelStartTime } from './travel-planning.mjs';

const requestSchema = z.object({ requestId: z.uuid() }).strict();
const dispatchSchema = z.union([
  requestSchema.extend({ mode: z.literal('automatic').optional() }).strict(),
  requestSchema
    .extend({ mode: z.literal('manual'), technicianId: idSchema })
    .strict(),
]);
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
const travelPlanSchema = requestSchema
  .extend({
    travelBufferMinutes: z.number().int().min(0).max(180),
    trafficNote: z.string().trim().max(500).default(''),
  })
  .strict();
const scheduleQuerySchema = z
  .object({
    from: z.string().refine(isCalendarDate, 'Choose a valid start date.'),
    to: z.string().refine(isCalendarDate, 'Choose a valid end date.'),
  })
  .strict()
  .refine(({ from, to }) => {
    const days =
      (new Date(`${to}T00:00:00Z`).getTime() -
        new Date(`${from}T00:00:00Z`).getTime()) /
      86400000;
    return days >= 0 && days <= 30;
  }, 'Choose a date range of 31 days or fewer.');
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
      'Expired',
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
    `SELECT sa.address_line,COALESCE((SELECT GROUP_CONCAT(bs.service_name ORDER BY bs.service_id SEPARATOR ', ') FROM booking_service bs WHERE bs.booking_id=?),sc.service_name) AS service_name,
    (SELECT COUNT(*) FROM booking_aircon_unit bu WHERE bu.booking_id=?) AS unit_count
    FROM service_address sa JOIN service_catalog sc ON sc.service_id=? WHERE sa.address_id=? FOR SHARE`,
    [bookingId, bookingId, booking.service_id, booking.address_id],
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
    await assertBookingNotExpired(connection, booking);
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
    await assertBookingNotExpired(connection, booking);
    if (booking.booking_status !== 'Submitted')
      throw new AppError('Only submitted bookings can be rejected.', 409);
    await lockServiceDates(connection, [booking.preferred_service_date]);
    await connection.execute(
      "UPDATE booking SET booking_status='Rejected',rejection_reason=?,rejection_version=rejection_version+1 WHERE booking_id=?",
      [data.reason, bookingId],
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

export async function editRejectionReason(pool, actor, bookingId, raw) {
  const data = rejectSchema
    .extend({ version: z.number().int().min(1) })
    .parse(raw);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const operation = await beginOperation(connection, {
      requestId: data.requestId,
      bookingId,
      actorUserId: actor.userId,
      type: 'Edit rejection',
      payload: data,
    });
    if (operation.replayed) {
      await connection.commit();
      return { ...operation.result, replayed: true };
    }
    const booking = await lockedBooking(connection, bookingId);
    if (booking.booking_status !== 'Rejected')
      throw new AppError(
        'Only rejected bookings have an editable rejection reason.',
        409,
      );
    if (Number(booking.rejection_version) !== data.version)
      throw new AppError(
        'The rejection reason changed. Reload before editing.',
        409,
      );
    await connection.execute(
      'UPDATE booking SET rejection_reason=?,rejection_version=rejection_version+1 WHERE booking_id=?',
      [data.reason, bookingId],
    );
    await connection.execute(
      `INSERT INTO booking_status_history(booking_id,old_status,new_status,changed_by_user_id,change_note)
      VALUES (?,'Rejected','Rejected',?,?)`,
      [bookingId, actor.userId, 'Rejection reason updated: ' + data.reason],
    );
    const result = {
      bookingId,
      reason: data.reason,
      version: data.version + 1,
    };
    await finishOperation(connection, {
      requestId: data.requestId,
      bookingId,
      actorUserId: actor.userId,
      type: 'Edit rejection',
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

export async function editTravelPlan(pool, actor, bookingId, raw) {
  const data = travelPlanSchema.parse(raw),
    connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const operation = await beginOperation(connection, {
      requestId: data.requestId,
      bookingId,
      actorUserId: actor.userId,
      type: 'Edit travel plan',
      payload: data,
    });
    if (operation.replayed) {
      await connection.commit();
      return { ...operation.result, replayed: true };
    }
    const booking = await lockedBooking(connection, bookingId);
    await assertBookingNotExpired(connection, booking);
    if (
      !['Submitted', 'Confirmed', 'Awaiting return arrangement'].includes(
        booking.booking_status,
      )
    )
      throw new AppError(
        'Travel planning is locked after dispatch or closure.',
        409,
      );
    await connection.execute(
      'UPDATE booking SET travel_buffer_minutes=?,traffic_note=? WHERE booking_id=?',
      [data.travelBufferMinutes, data.trafficNote || null, bookingId],
    );
    const note = `Travel plan updated: ${data.travelBufferMinutes} minute buffer${data.trafficNote ? `; ${data.trafficNote}` : ''}.`;
    await connection.execute(
      `INSERT INTO booking_status_history(booking_id,old_status,new_status,changed_by_user_id,change_note)
      VALUES (?,?,?,?,?)`,
      [
        bookingId,
        booking.booking_status,
        booking.booking_status,
        actor.userId,
        note,
      ],
    );
    const result = {
      bookingId,
      travelBufferMinutes: data.travelBufferMinutes,
      trafficNote: data.trafficNote || null,
    };
    await finishOperation(connection, {
      requestId: data.requestId,
      bookingId,
      actorUserId: actor.userId,
      type: 'Edit travel plan',
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

export async function getAdminActionSummary(pool) {
  const [[bookings]] = await pool.execute(
    `SELECT
      SUM(booking_status='Submitted' AND (expires_at IS NULL OR expires_at>UTC_TIMESTAMP())) AS submitted,
      SUM(booking_status='Submitted' AND expires_at>UTC_TIMESTAMP() AND expires_at<=DATE_ADD(UTC_TIMESTAMP(),INTERVAL 12 HOUR)) AS expiringSoon,
      SUM(booking_status='Confirmed') AS awaitingDispatch
    FROM booking`,
  );
  const [[returns]] = await pool.execute(
    `SELECT COUNT(*) AS awaitingAdmin FROM service_progress
    WHERE follow_up_status IN ('Required','Awaiting confirmation')`,
  );
  const submitted = Number(bookings.submitted || 0),
    returnVisits = Number(returns.awaitingAdmin || 0),
    awaitingDispatch = Number(bookings.awaitingDispatch || 0);
  return {
    submitted,
    expiringSoon: Number(bookings.expiringSoon || 0),
    returnVisits,
    awaitingDispatch,
    ordersRequiringAction: submitted + returnVisits,
    totalRequiringAction: submitted + returnVisits + awaitingDispatch,
  };
}

async function chooseTechnician(
  connection,
  booking,
  { excludeTechnicianId = 0 } = {},
) {
  const date = String(booking.preferred_service_date).slice(0, 10),
    travelStart = travelStartTime(
      booking.slot_start,
      booking.travel_buffer_minutes,
    );
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
    t.last_assigned_at AS lastAssignedAt,t.base_postal_code AS basePostalCode,t.hourly_labor_cost AS hourlyLaborCost,
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
      AND SUBTIME(occupied_booking.slot_start,SEC_TO_TIME(COALESCE(occupied_booking.travel_buffer_minutes,30)*60))<?
      AND occupied_booking.slot_end>?
    )

    AND NOT EXISTS (SELECT 1 FROM service_progress fp JOIN work_order fw ON fw.job_id=fp.job_id
      JOIN assignment fa ON fa.assignment_id=fw.assignment_id
      JOIN booking fb ON fb.booking_id=fw.booking_id
      WHERE fa.technician_id=t.technician_id AND fa.assignment_status NOT IN ('Declined','Reassigned','Cancelled')
      AND fp.follow_up_status IN ('Scheduled','In Progress') AND fp.follow_up_date=?
      AND SUBTIME(fp.follow_up_start,SEC_TO_TIME(COALESCE(fb.travel_buffer_minutes,30)*60))<?
      AND fp.follow_up_end>?)
    ORDER BY dailyJobs ASC,(t.last_assigned_at IS NULL) DESC,t.last_assigned_at ASC,t.technician_id ASC
    `,
    [
      date,
      excludeTechnicianId,
      date,
      booking.slot_end,
      travelStart,
      date,
      booking.slot_end,
      travelStart,
    ],
  );
  if (!rows.length)
    throw new AppError(
      'No technician is available for this confirmed time. Review technician availability and try again.',
      409,
    );
  await addDispatchProximity(connection, booking, rows);
  return rows.sort(compareDispatchCandidates)[0];
}

async function chooseManualTechnician(
  connection,
  booking,
  technicianId,
  { excludeTechnicianId = 0 } = {},
) {
  await lockTechnicianRoster(connection);
  const [[lockedTechnician]] = await connection.execute(
    'SELECT technician_id FROM technician WHERE technician_id=? FOR UPDATE',
    [technicianId],
  );
  if (!lockedTechnician)
    throw new AppError('The selected technician was not found.', 409);
  const [[technician]] = await connection.execute(
    `SELECT t.technician_id AS technicianId,t.user_id AS userId,u.full_name AS fullName,
    u.status AS accountStatus,t.availability_status AS availability,t.last_assigned_at AS lastAssignedAt,
    t.hourly_labor_cost AS hourlyLaborCost
    FROM technician t JOIN user_account u ON u.user_id=t.user_id
    JOIN role r ON r.role_id=u.role_id
    WHERE t.technician_id=? AND r.role_name='Technician'`,
    [technicianId],
  );
  if (!technician)
    throw new AppError('The selected technician was not found.', 409);
  if (technician.technicianId === excludeTechnicianId)
    throw new AppError(
      'Choose a different technician for this reassignment.',
      409,
    );
  if (technician.accountStatus !== 'Active')
    throw new AppError(
      'The selected technician does not have an active account.',
      409,
    );
  if (['Unavailable', 'On Leave'].includes(technician.availability))
    throw new AppError(
      `The selected technician is ${technician.availability.toLowerCase()}.`,
      409,
    );
  const date = String(booking.preferred_service_date).slice(0, 10),
    travelStart = travelStartTime(
      booking.slot_start,
      booking.travel_buffer_minutes,
    );
  const [[conflict]] = await connection.execute(
    `SELECT COUNT(*) AS count FROM assignment occupied_assignment
    JOIN work_order occupied_work ON occupied_work.assignment_id=occupied_assignment.assignment_id
    JOIN booking occupied_booking ON occupied_booking.booking_id=occupied_work.booking_id
    WHERE occupied_assignment.technician_id=?
    AND occupied_assignment.assignment_status NOT IN ('Declined','Reassigned','Cancelled','Completed')
    AND occupied_work.current_status NOT IN ('Completed','Cancelled')
    AND occupied_booking.preferred_service_date=?
    AND SUBTIME(occupied_booking.slot_start,SEC_TO_TIME(COALESCE(occupied_booking.travel_buffer_minutes,30)*60))<?
    AND occupied_booking.slot_end>?`,
    [technicianId, date, booking.slot_end, travelStart],
  );
  if (Number(conflict.count) > 0)
    throw new AppError(
      'The selected technician already has an overlapping work order.',
      409,
    );
  const [[followUp]] = await connection.execute(
    `SELECT COUNT(*) AS count FROM service_progress fp
    JOIN work_order fw ON fw.job_id=fp.job_id JOIN assignment fa ON fa.assignment_id=fw.assignment_id
    JOIN booking fb ON fb.booking_id=fw.booking_id
    WHERE fa.technician_id=? AND fa.assignment_status NOT IN ('Declined','Reassigned','Cancelled')
    AND fp.follow_up_status IN ('Scheduled','In Progress') AND fp.follow_up_date=?
    AND SUBTIME(fp.follow_up_start,SEC_TO_TIME(COALESCE(fb.travel_buffer_minutes,30)*60))<?
    AND fp.follow_up_end>?`,
    [technicianId, date, booking.slot_end, travelStart],
  );
  if (Number(followUp.count) > 0)
    throw new AppError(
      'The selected technician has an overlapping return visit.',
      409,
    );
  return technician;
}

function dispatchOptionReason(option, currentTechnicianId) {
  if (option.technicianId === currentTechnicianId)
    return 'Currently assigned to this booking.';
  if (option.accountStatus !== 'Active')
    return `Account is ${String(option.accountStatus).toLowerCase()}.`;
  if (option.availability === 'Unavailable') return 'Marked unavailable.';
  if (option.availability === 'On Leave') return 'Currently on leave.';
  if (Number(option.hasConflict) > 0 || Number(option.followUpConflict) > 0)
    return 'Overlapping service or planned travel time.';
  return null;
}

export async function listDispatchOptions(pool, bookingId) {
  const [[booking]] = await pool.execute(
    `SELECT b.booking_id,b.booking_status,b.preferred_service_date,b.preferred_time_slot,
    b.slot_start,b.slot_end,b.estimated_duration_minutes,b.travel_buffer_minutes,b.traffic_note,b.address_id FROM booking b WHERE b.booking_id=?`,
    [bookingId],
  );
  if (!booking) throw new AppError('Booking not found.', 404);
  if (!['Confirmed', 'Assigned'].includes(booking.booking_status))
    throw new AppError(
      'Dispatch options are available only for confirmed or assigned bookings.',
      409,
    );
  if (!booking.slot_start || !booking.slot_end) {
    const slot = normalizeBookingSlot(booking.preferred_time_slot);
    booking.slot_start = slot.start;
    booking.slot_end = slot.end;
  }
  let currentTechnicianId = 0;
  if (booking.booking_status === 'Assigned') {
    const [[current]] = await pool.execute(
      `SELECT a.technician_id AS technicianId,w.current_status AS workStatus
      FROM assignment a JOIN work_order w ON w.assignment_id=a.assignment_id
      WHERE a.booking_id=? AND a.assignment_status NOT IN ('Declined','Reassigned','Cancelled','Completed')
      ORDER BY a.assignment_id DESC LIMIT 1`,
      [bookingId],
    );
    if (!current || current.workStatus !== 'Assigned')
      throw new AppError(
        'A work order can only be redispatched before the technician starts travelling.',
        409,
      );
    currentTechnicianId = current.technicianId;
  }
  const date = String(booking.preferred_service_date).slice(0, 10),
    travelStart = travelStartTime(
      booking.slot_start,
      booking.travel_buffer_minutes,
    );
  const [rows] = await pool.execute(
    `SELECT t.technician_id AS technicianId,t.user_id AS userId,u.full_name AS fullName,u.email,
    u.status AS accountStatus,t.availability_status AS availability,t.last_assigned_at AS lastAssignedAt,t.base_postal_code AS basePostalCode,t.hourly_labor_cost AS hourlyLaborCost,
    (SELECT COUNT(*) FROM assignment daily_assignment
      JOIN work_order daily_work ON daily_work.assignment_id=daily_assignment.assignment_id
      WHERE daily_assignment.technician_id=t.technician_id AND DATE(daily_work.appointment_date)=?
      AND daily_assignment.assignment_status NOT IN ('Declined','Reassigned','Cancelled','Completed')
      AND daily_work.current_status NOT IN ('Completed','Cancelled')) AS dailyJobs,
    (SELECT COUNT(*) FROM assignment occupied_assignment
      JOIN work_order occupied_work ON occupied_work.assignment_id=occupied_assignment.assignment_id
      JOIN booking occupied_booking ON occupied_booking.booking_id=occupied_work.booking_id
      WHERE occupied_assignment.technician_id=t.technician_id
      AND occupied_assignment.assignment_status NOT IN ('Declined','Reassigned','Cancelled','Completed')
      AND occupied_work.current_status NOT IN ('Completed','Cancelled')
      AND occupied_booking.preferred_service_date=?
      AND SUBTIME(occupied_booking.slot_start,SEC_TO_TIME(COALESCE(occupied_booking.travel_buffer_minutes,30)*60))<?
      AND occupied_booking.slot_end>?) AS hasConflict,
    (SELECT COUNT(*) FROM service_progress fp JOIN work_order fw ON fw.job_id=fp.job_id JOIN assignment fa ON fa.assignment_id=fw.assignment_id
      JOIN booking fb ON fb.booking_id=fw.booking_id
      WHERE fa.technician_id=t.technician_id AND fa.assignment_status NOT IN ('Declined','Reassigned','Cancelled')
      AND fp.follow_up_status IN ('Scheduled','In Progress') AND fp.follow_up_date=?
      AND SUBTIME(fp.follow_up_start,SEC_TO_TIME(COALESCE(fb.travel_buffer_minutes,30)*60))<? AND fp.follow_up_end>?) AS followUpConflict
    FROM technician t JOIN user_account u ON u.user_id=t.user_id
    JOIN role r ON r.role_id=u.role_id WHERE r.role_name='Technician'
    ORDER BY u.status='Active' DESC,u.full_name,t.technician_id`,
    [
      date,
      date,
      booking.slot_end,
      travelStart,
      date,
      booking.slot_end,
      travelStart,
    ],
  );
  await addDispatchProximity(pool, booking, rows);
  rows.sort(
    (a, b) =>
      Number(Boolean(dispatchOptionReason(a, currentTechnicianId))) -
        Number(Boolean(dispatchOptionReason(b, currentTechnicianId))) ||
      compareDispatchCandidates(a, b),
  );
  return {
    bookingId,
    status: booking.booking_status,
    preferredDate: date,
    timeSlot: booking.preferred_time_slot,
    slotStart: booking.slot_start,
    slotEnd: booking.slot_end,
    estimatedDurationMinutes: booking.estimated_duration_minutes,
    travelBufferMinutes: Number(booking.travel_buffer_minutes ?? 30),
    trafficNote: booking.traffic_note || null,
    technicians: rows.map((row) => {
      const reason = dispatchOptionReason(row, currentTechnicianId);
      return {
        technicianId: row.technicianId,
        fullName: row.fullName,
        email: row.email,
        accountStatus: row.accountStatus,
        availability: row.availability,
        dailyJobs: Number(row.dailyJobs),
        proximity: row.proximity,
        travelPlan: row.travelPlan,
        current: row.technicianId === currentTechnicianId,
        eligible: reason === null,
        reason,
      };
    }),
  };
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
  const data = dispatchSchema.parse(raw),
    mode = data.mode ?? 'automatic',
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
    const selectionOptions = {
      excludeTechnicianId: previous?.technicianId ?? 0,
    };
    const technician =
      mode === 'manual'
        ? await chooseManualTechnician(
            connection,
            booking,
            data.technicianId,
            selectionOptions,
          )
        : await chooseTechnician(connection, booking, selectionOptions);
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
    const note =
      mode === 'manual'
        ? redispatch
          ? `Work order manually reassigned to ${technician.fullName} by an administrator.`
          : `Manually assigned to ${technician.fullName} by an administrator.`
        : redispatch
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

export async function rescheduleAdminBooking(pool, actor, bookingId, raw) {
  const data = rescheduleSchema.parse(raw),
    connection = await pool.getConnection();
  try {
    // Discover the immutable customer identity before opening the transaction.
    // A pre-lock consistent read would freeze an obsolete REPEATABLE READ snapshot.
    const [[identity]] = await connection.execute(
      `SELECT c.user_id AS userId FROM booking b
      JOIN customer c ON c.customer_id=b.customer_id WHERE b.booking_id=?`,
      [bookingId],
    );
    if (!identity) throw new AppError('Booking not found.', 404);
    await connection.beginTransaction();
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
    if (Number(booking.customer_id) !== Number(customer.customerId))
      throw new AppError(
        'Booking ownership changed. Reload before changing the schedule.',
        409,
      );
    await assertBookingNotExpired(connection, booking);
    if (!['Submitted', 'Confirmed'].includes(booking.booking_status))
      throw new AppError(
        'Only unassigned bookings awaiting review or dispatch can be rescheduled.',
        409,
      );
    const [[assignment]] = await connection.execute(
      "SELECT COUNT(*) AS count FROM assignment WHERE booking_id=? AND assignment_status NOT IN ('Declined','Reassigned','Cancelled','Completed')",
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
      {
        includesCleaning: await bookingIncludesCleaning(connection, bookingId),
      },
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
    const slot = bookingServiceSlot(
        data.timeSlot,
        booking.estimated_duration_minutes,
      ),
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
    b.preferred_time_slot AS timeSlot,b.slot_start AS slotStart,b.slot_end AS slotEnd,b.estimated_duration_minutes AS estimatedDurationMinutes,b.travel_buffer_minutes AS travelBufferMinutes,b.traffic_note AS trafficNote,b.total_amount AS totalAmount,b.created_at AS createdAt,b.expires_at AS expiresAt,u.full_name AS customerName,u.email,
    sa.address_line AS addressLine,COALESCE(GROUP_CONCAT(DISTINCT bs.service_name ORDER BY bs.service_id SEPARATOR ', '),sc.service_name) AS serviceName,
    (SELECT COUNT(*) FROM booking_aircon_unit bu WHERE bu.booking_id=b.booking_id) AS numberOfUnits,
    (SELECT technician_user.full_name FROM assignment latest_assignment JOIN technician latest_technician ON latest_technician.technician_id=latest_assignment.technician_id
      JOIN user_account technician_user ON technician_user.user_id=latest_technician.user_id WHERE latest_assignment.booking_id=b.booking_id
      ORDER BY latest_assignment.assignment_id DESC LIMIT 1) AS technicianName
    FROM booking b JOIN customer c ON c.customer_id=b.customer_id JOIN user_account u ON u.user_id=c.user_id
    JOIN service_address sa ON sa.address_id=b.address_id JOIN service_catalog sc ON sc.service_id=b.service_id
    LEFT JOIN booking_service bs ON bs.booking_id=b.booking_id${clause}
    GROUP BY b.booking_id,b.booking_status,b.preferred_service_date,b.preferred_time_slot,b.total_amount,b.created_at,u.full_name,u.email,sa.address_line,sc.service_name
    ORDER BY FIELD(b.booking_status,'Submitted','Confirmed','Assigned','On The Way','In Progress','Completed','Rejected','Cancelled','Expired'),b.preferred_service_date,b.booking_id
    LIMIT ? OFFSET ?`,
    [...values, data.pageSize, (page - 1) * data.pageSize],
  );
  return { rows, total: Number(total), page, pageSize: data.pageSize };
}

export async function listAdminSchedule(pool, query) {
  const data = scheduleQuerySchema.parse(query);
  const [rows] = await pool.execute(
    `SELECT b.booking_id AS bookingId,b.booking_status AS status,
    b.preferred_service_date AS preferredDate,b.preferred_time_slot AS timeSlot,b.slot_start AS slotStart,b.slot_end AS slotEnd,b.estimated_duration_minutes AS estimatedDurationMinutes,b.travel_buffer_minutes AS travelBufferMinutes,b.traffic_note AS trafficNote,
    b.total_amount AS totalAmount,b.created_at AS createdAt,b.expires_at AS expiresAt,u.full_name AS customerName,u.email,
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
    AND b.booking_status NOT IN ('Rejected','Cancelled','Expired')
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
    b.preferred_time_slot AS timeSlot,b.slot_start AS slotStart,b.slot_end AS slotEnd,b.estimated_duration_minutes AS estimatedDurationMinutes,b.travel_buffer_minutes AS travelBufferMinutes,b.traffic_note AS trafficNote,b.problem_description AS problemDescription,b.total_amount AS totalAmount,b.created_at AS createdAt,b.expires_at AS expiresAt,b.rejection_reason AS rejectionReason,b.rejection_version AS rejectionVersion,
    (SELECT details.special_notes FROM web_booking_details details WHERE details.booking_id=b.booking_id) AS otherRemarks,
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
  const [reports] = await pool.execute(
    `SELECT w.job_id AS jobId,r.report_id AS reportId,r.work_performed AS workPerformed,r.problem_found AS problemFound,r.solution_applied AS solutionApplied,r.checklist_result AS checklist,r.customer_signature_url AS customerSignatureUrl,r.technician_signature_url AS technicianSignatureUrl,r.started_at AS startedAt,r.completed_at AS completedAt FROM service_report r JOIN work_order w ON w.job_id=r.job_id WHERE w.booking_id=? AND r.submitted_time IS NOT NULL ORDER BY r.report_id DESC`,
    [bookingId],
  );
  return {
    ...booking,
    timeline,
    assignments: await Promise.all(
      assignments.map(async (item) => ({
        ...item,
        progress: item.jobId
          ? await getServiceProgress(pool, item.jobId)
          : null,
      })),
    ),
    reports: await Promise.all(
      reports.map(async (r) => ({
        ...r,
        photos: await listServicePhotos(pool, r.jobId),
      })),
    ),
  };
}

export async function listStaff(pool, roleName) {
  const table = roleName === 'Admin' ? 'admin_profile' : 'technician';
  const extra =
    roleName === 'Admin'
      ? 'p.access_level AS accessLevel'
      : `p.technician_id AS technicianId,p.availability_status AS availability,p.last_assigned_at AS lastAssignedAt,p.base_postal_code AS basePostalCode,p.hourly_labor_cost AS hourlyLaborCost,
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

export async function assertTechnicianCanBecomeUnavailable(
  connection,
  technicianId,
) {
  const [[assigned]] = await connection.execute(
    `SELECT COUNT(*) AS count FROM assignment a JOIN work_order w ON w.assignment_id=a.assignment_id
    WHERE a.technician_id=? AND a.assignment_status NOT IN ('Declined','Reassigned','Cancelled','Completed')
    AND w.current_status NOT IN ('Completed','Cancelled') AND (w.current_status IN ('On The Way','In Progress') OR w.appointment_date>=DATE_ADD(UTC_TIMESTAMP(),INTERVAL 8 HOUR))`,
    [technicianId],
  );
  const [[returns]] = await connection.execute(
    `SELECT COUNT(*) AS count FROM service_progress p JOIN work_order w ON w.job_id=p.job_id JOIN assignment a ON a.assignment_id=w.assignment_id
    WHERE a.technician_id=? AND a.assignment_status NOT IN ('Declined','Reassigned','Cancelled') AND p.follow_up_status IN ('Scheduled','In Progress')`,
    [technicianId],
  );
  if (Number(assigned.count) > 0 || Number(returns.count) > 0)
    throw new AppError(
      'Finish active service or resolve upcoming work orders and return visits before making the account unavailable.',
      409,
    );
  const [[roster]] =
    await connection.execute(`SELECT COUNT(*) AS count FROM technician t JOIN user_account u ON u.user_id=t.user_id
    WHERE u.status='Active' AND t.availability_status NOT IN ('Unavailable','On Leave')`);
  const remaining = Number(roster.count) - 1;
  const [reservations] =
    await connection.execute(`SELECT b.preferred_service_date AS date,b.slot_start AS start,b.slot_end AS end FROM booking b
    WHERE b.preferred_service_date>=CURRENT_DATE AND b.booking_status IN ('Submitted','Confirmed','Assigned','On The Way','In Progress')
    UNION ALL SELECT p.follow_up_date AS date,p.follow_up_start AS start,p.follow_up_end AS end FROM service_progress p
    WHERE p.follow_up_status IN ('Scheduled','In Progress') AND p.follow_up_date>=CURRENT_DATE`);
  const days = [
    ...new Set(reservations.map((row) => String(row.date).slice(0, 10))),
  ];
  const overbooked = days.some(
    (date) =>
      peakConcurrentReservations(
        reservations.filter((row) => String(row.date).slice(0, 10) === date),
        '00:00:00',
        '23:59:59',
      ) > remaining,
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
      basePostalCode: z
        .union([
          z
            .string()
            .regex(/^\d{6}$/, 'Enter a six-digit Singapore postal code.'),
          z.literal(''),
        ])
        .optional(),
      hourlyLaborCost: z.number().min(0).max(1000).nullable().optional(),
    })
    .strict()
    .refine(
      (value) =>
        value.accountStatus ||
        value.availability ||
        value.basePostalCode !== undefined ||
        value.hourlyLaborCost !== undefined,
      'Choose an account status, availability, base postal code or labour rate.',
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
    if (data.basePostalCode !== undefined)
      await connection.execute(
        'UPDATE technician SET base_postal_code=? WHERE technician_id=?',
        [data.basePostalCode || null, technicianId],
      );
    if (data.hourlyLaborCost !== undefined)
      await connection.execute(
        'UPDATE technician SET hourly_labor_cost=? WHERE technician_id=?',
        [data.hourlyLaborCost, technicianId],
      );
    await connection.commit();
    return {
      technicianId,
      basePostalCode:
        data.basePostalCode !== undefined
          ? data.basePostalCode || null
          : technician.base_postal_code,
      hourlyLaborCost:
        data.hourlyLaborCost !== undefined
          ? data.hourlyLaborCost
          : technician.hourly_labor_cost,
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
  registerReturnRoutes(router, pool, 'admin');
  router.get('/action-summary', async (_req, res) =>
    res.json(await getAdminActionSummary(pool)),
  );
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
  router.patch('/bookings/:id/rejection-reason', async (req, res) =>
    res.json(
      await editRejectionReason(
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
  router.patch('/bookings/:id/travel-plan', async (req, res) =>
    res.json(
      await editTravelPlan(
        pool,
        req.adminUser,
        idSchema.parse(req.params.id),
        req.body,
      ),
    ),
  );
  router.get('/bookings/:id/dispatch-options', async (req, res) =>
    res.json(await listDispatchOptions(pool, idSchema.parse(req.params.id))),
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
    res.status(201).json(
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
