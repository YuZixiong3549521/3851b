import { z } from 'zod';
import { AppError, idSchema } from './inventory.mjs';
import {
  beginOperation,
  finishOperation,
  listDispatchOptions,
} from './admin-operations.mjs';
import { assertBookingNotExpired } from './order-expiry.mjs';
import {
  assertBookableDate,
  isCalendarDate,
  isWeekday,
  addCalendarDays,
  singaporeToday,
} from './customer/booking-schedule.mjs';
import { assertAnnualRescheduleWindow } from './customer/annual-bookings.mjs';
import {
  assertAddressBookingLimit,
  bookingIncludesCleaning,
} from './customer/booking-options.mjs';
import { getTeamSlotAvailability } from './scheduling.mjs';

const request = z.object({ requestId: z.uuid() }).strict();
const queueRequest = request
  .extend({ reason: z.string().trim().min(3).max(500) })
  .strict();

// Queue membership is administrative metadata, never a customer confirmation.
export async function queueBooking(pool, actor, bookingId, raw) {
  const data = queueRequest.parse(raw),
    c = await pool.getConnection();
  try {
    await c.beginTransaction();
    const operation = await beginOperation(c, {
      requestId: data.requestId,
      bookingId,
      actorUserId: actor.userId,
      type: 'Queue for dispatch',
      payload: data,
    });
    if (operation.replayed) {
      await c.commit();
      return { ...operation.result, replayed: true };
    }
    const [[booking]] = await c.execute(
      'SELECT * FROM booking WHERE booking_id=? FOR UPDATE',
      [bookingId],
    );
    if (!booking) throw new AppError('Booking not found.', 404);
    if (!['Submitted', 'Confirmed'].includes(booking.booking_status))
      throw new AppError(
        'Only unassigned requests can enter the waiting queue.',
        409,
      );
    await assertBookingNotExpired(c, booking);
    if (!booking.admin_waiting_since) {
      await c.execute(
        'UPDATE booking SET admin_waiting_since=UTC_TIMESTAMP(),admin_waiting_reason=? WHERE booking_id=?',
        [data.reason, bookingId],
      );
      await c.execute(
        `INSERT INTO booking_status_history(booking_id,old_status,new_status,changed_by_user_id,change_note) VALUES (?,?,?,?,?)`,
        [
          bookingId,
          booking.booking_status,
          booking.booking_status,
          actor.userId,
          `Added to waiting dispatch: ${data.reason}. No confirmation email sent; any existing deadline remains unchanged.`,
        ],
      );
    }
    const result = { bookingId, status: booking.booking_status, queued: true };
    await finishOperation(c, {
      requestId: data.requestId,
      bookingId,
      actorUserId: actor.userId,
      type: 'Queue for dispatch',
      hash: operation.hash,
      result,
    });
    await c.commit();
    return result;
  } catch (error) {
    await c.rollback();
    throw error;
  } finally {
    c.release();
  }
}

export async function listBookingEmails(pool, bookingId) {
  const [[booking]] = await pool.execute(
    'SELECT booking_id FROM booking WHERE booking_id=?',
    [bookingId],
  );
  if (!booking) throw new AppError('Booking not found.', 404);
  const [rows] = await pool.execute(
    `SELECT email_id AS emailId,recipient,subject,status,delivery_mode AS deliveryMode,
    attempts,last_error AS lastError,next_attempt_at AS nextAttemptAt,sent_at AS sentAt,created_at AS createdAt
    FROM booking_email_outbox WHERE booking_id=? AND event_type='booking.assigned' ORDER BY email_id DESC`,
    [bookingId],
  );
  return {
    rows: rows.map((row) => ({
      ...row,
      canRetry:
        row.status === 'Pending' &&
        Boolean(row.lastError) &&
        row.deliveryMode !== 'disabled',
    })),
  };
}

export async function retryBookingEmail(pool, actor, bookingId, emailId, raw) {
  const data = request.parse(raw),
    c = await pool.getConnection();
  try {
    await c.beginTransaction();
    const operation = await beginOperation(c, {
      requestId: data.requestId,
      bookingId,
      actorUserId: actor.userId,
      type: 'Retry customer email',
      payload: { ...data, emailId },
    });
    if (operation.replayed) {
      await c.commit();
      return { ...operation.result, replayed: true };
    }
    const [[booking]] = await c.execute(
      'SELECT booking_id FROM booking WHERE booking_id=? FOR UPDATE',
      [bookingId],
    );
    if (!booking) throw new AppError('Booking not found.', 404);
    const [[email]] = await c.execute(
      "SELECT * FROM booking_email_outbox WHERE email_id=? AND booking_id=? AND event_type='booking.assigned' FOR UPDATE",
      [emailId, bookingId],
    );
    if (!email) throw new AppError('Customer notification not found.', 404);
    if (
      email.status !== 'Pending' ||
      !email.last_error ||
      email.delivery_mode === 'disabled'
    )
      throw new AppError(
        'Only failed customer deliveries waiting for retry can be retried. Reload the status.',
        409,
      );
    // Preserve the event key, message ID and attempts. The existing worker owns sending.
    await c.execute(
      'UPDATE booking_email_outbox SET next_attempt_at=UTC_TIMESTAMP(),last_error=NULL WHERE email_id=?',
      [emailId],
    );
    const result = { bookingId, emailId, status: 'Pending' };
    await finishOperation(c, {
      requestId: data.requestId,
      bookingId,
      actorUserId: actor.userId,
      type: 'Retry customer email',
      hash: operation.hash,
      result,
    });
    await c.commit();
    return result;
  } catch (error) {
    await c.rollback();
    throw error;
  } finally {
    c.release();
  }
}

export async function getBookingPlanner(pool, bookingId, query) {
  const { week } = z
    .object({ week: z.string().refine(isCalendarDate) })
    .strict()
    .parse(query);
  const start = addCalendarDays(
    week,
    -(new Date(`${week}T00:00:00Z`).getUTCDay() + 6) % 7,
  );
  const [[booking]] = await pool.execute(
    `SELECT b.*,sa.address_line FROM booking b JOIN service_address sa ON sa.address_id=b.address_id WHERE b.booking_id=?`,
    [bookingId],
  );
  if (!booking) throw new AppError('Booking not found.', 404);
  if (!['Submitted', 'Confirmed'].includes(booking.booking_status))
    throw new AppError(
      'Only unassigned bookings can use alternative-time planning.',
      409,
    );
  const dates = Array.from({ length: 7 }, (_, i) => addCalendarDays(start, i));
  const capacity = await getTeamSlotAvailability(pool, dates, {
    durationMinutes: booking.estimated_duration_minutes,
    excludeBookingId: bookingId,
  });
  const includesCleaning = await bookingIncludesCleaning(pool, bookingId);
  const days = [];
  for (const day of capacity.dates) {
    let dateReason = null;
    try {
      assertBookableDate(day.date);
      await assertBookingNotExpired(pool, booking);
      await assertAnnualRescheduleWindow(pool, bookingId, day.date);
      await assertAddressBookingLimit(
        pool,
        booking.customer_id,
        booking.address_line,
        day.date,
        bookingId,
        { includesCleaning },
      );
      if (booking.subscription_id) {
        const [[subscription]] = await pool.execute(
          'SELECT start_date,end_date,subscription_status FROM customer_subscription WHERE subscription_id=? AND customer_id=?',
          [booking.subscription_id, booking.customer_id],
        );
        if (
          !subscription ||
          subscription.subscription_status !== 'Active' ||
          day.date < String(subscription.start_date).slice(0, 10) ||
          day.date > String(subscription.end_date).slice(0, 10)
        )
          throw new AppError('Outside the active membership period.', 409);
      }
    } catch (error) {
      if (![400, 409].includes(error.status)) throw error;
      dateReason = error.message;
    }
    const slots = [];
    for (const slot of day.slots) {
      let reason =
        dateReason ||
        slot.reason ||
        (!slot.available ? 'Team capacity is full.' : null);
      let eligibleCount = 0;
      if (!reason) {
        const options = await listDispatchOptions(pool, bookingId, {
          date: day.date,
          timeSlot: slot.code,
        });
        eligibleCount = options.technicians.filter(
          (row) => row.eligible,
        ).length;
        if (!eligibleCount)
          reason = 'No technician is free, including the travel allowance.';
      }
      slots.push({ ...slot, available: !reason, reason, eligibleCount });
    }
    days.push({ date: day.date, closed: !isWeekday(day.date), slots });
  }
  return { week: start, days };
}

const auditQuery = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  bookingId: z.coerce.number().int().min(1).optional(),
  action: z
    .enum([
      '',
      'Dispatch',
      'Redispatch',
      'Reject',
      'Reschedule',
      'Edit rejection',
      'Edit travel plan',
      'Queue for dispatch',
      'Retry customer email',
      'Approve',
    ])
    .default(''),
});
export async function listAdminAudit(pool, query) {
  const data = auditQuery.parse(query),
    where = [],
    values = [];
  if (data.bookingId) {
    where.push('o.booking_id=?');
    values.push(data.bookingId);
  }
  if (data.action) {
    where.push('o.operation_type=?');
    values.push(data.action);
  }
  const clause = where.length ? ` WHERE ${where.join(' AND ')}` : '';
  const [[{ total }]] = await pool.execute(
    `SELECT COUNT(*) AS total FROM booking_admin_operation o${clause}`,
    values,
  );
  const page = Math.min(data.page, Math.max(1, Math.ceil(Number(total) / 25)));
  const [rows] = await pool.execute(
    `SELECT o.request_id AS requestId,o.booking_id AS bookingId,o.operation_type AS action,o.created_at AS createdAt,u.full_name AS actor
    FROM booking_admin_operation o JOIN user_account u ON u.user_id=o.actor_user_id${clause} ORDER BY o.created_at DESC,o.request_id DESC LIMIT 25 OFFSET ?`,
    [...values, (page - 1) * 25],
  );
  return { rows, total: Number(total), page, pageSize: 25 };
}

export const csvCell = (value) =>
  '"' +
  String(value ?? '')
    .replace(/^[\s]*[=+@-]/, "'$&")
    .replaceAll('"', '""') +
  '"';

export async function getOperationsOverview(pool) {
  const today = singaporeToday(),
    week = addCalendarDays(
      today,
      -(new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7,
    );
  const [[counts]] = await pool.execute(
    `SELECT
    SUM(booking_status='Submitted' AND admin_waiting_since IS NULL AND (expires_at IS NULL OR expires_at>UTC_TIMESTAMP())) AS review,
    SUM(booking_status='Confirmed' OR (booking_status='Submitted' AND admin_waiting_since IS NOT NULL AND (expires_at IS NULL OR expires_at>UTC_TIMESTAMP()))) AS waiting,
    SUM(booking_status='Submitted' AND expires_at>UTC_TIMESTAMP() AND expires_at<=DATE_ADD(UTC_TIMESTAMP(),INTERVAL 12 HOUR)) AS dueSoon,
    SUM(preferred_service_date=? AND booking_status NOT IN ('Cancelled','Expired','Rejected')) AS visitsToday,
    SUM(booking_status IN ('On The Way','In Progress','Return visit')) AS inProgress,
    SUM(booking_status='Completed' AND preferred_service_date BETWEEN ? AND ?) AS completedWeek
    FROM booking`,
    [today, week, addCalendarDays(week, 6)],
  );
  const [[mail]] =
    await pool.execute(`SELECT SUM(status='Pending' AND last_error IS NOT NULL) AS failedMail,
    SUM(status IN ('Pending','Sending') AND delivery_mode<>'disabled') AS queuedMail FROM booking_email_outbox WHERE event_type='booking.assigned'`);
  const [[returns]] = await pool.execute(
    "SELECT COUNT(*) AS returnVisits FROM service_progress WHERE follow_up_status IN ('Required','Awaiting confirmation')",
  );
  const [workload] = await pool.execute(
    `SELECT t.technician_id AS technicianId,u.full_name AS name,u.status AS accountStatus,t.availability_status AS availability,
    (SELECT COUNT(DISTINCT w.job_id) FROM work_order w JOIN assignment a ON a.assignment_id=w.assignment_id LEFT JOIN service_progress p ON p.job_id=w.job_id
    WHERE a.technician_id=t.technician_id AND a.assignment_status NOT IN ('Declined','Reassigned','Cancelled') AND w.current_status<>'Cancelled'
    AND (DATE(w.appointment_date)=? OR (p.follow_up_date=? AND p.follow_up_status IN ('Scheduled','In Progress')))) AS visitsToday
    FROM technician t JOIN user_account u ON u.user_id=t.user_id ORDER BY u.status='Active' DESC,u.full_name,t.technician_id`,
    [today, today],
  );
  const [failures] =
    await pool.execute(`SELECT email_id AS emailId,booking_id AS bookingId,recipient,last_error AS lastError,next_attempt_at AS nextAttemptAt FROM booking_email_outbox
    WHERE event_type='booking.assigned' AND status='Pending' AND last_error IS NOT NULL ORDER BY next_attempt_at,email_id LIMIT 10`);
  return {
    today,
    week,
    counts: Object.fromEntries(
      Object.entries({ ...counts, ...mail, ...returns }).map(([key, value]) => [
        key,
        Number(value || 0),
      ]),
    ),
    workload,
    failures,
  };
}

export function registerAdminWorkspaceRoutes(router, pool) {
  router.get('/operations-overview', async (_req, res) =>
    res.json(await getOperationsOverview(pool)),
  );
  router.get('/audit', async (req, res) =>
    res.json(await listAdminAudit(pool, req.query)),
  );
  router.get('/audit/export', async (req, res) => {
    if (req.adminUser.accessLevel !== 'Owner')
      throw new AppError('Only the Owner can export operation logs.', 403);
    const result = await listAdminAudit(pool, req.query);
    const csv = [
      ['Time (UTC)', 'Admin', 'Booking', 'Action', 'Request ID'],
      ...result.rows.map((row) => [
        row.createdAt,
        row.actor,
        row.bookingId,
        row.action,
        row.requestId,
      ]),
    ]
      .map((row) => row.map(csvCell).join(','))
      .join('\r\n');
    res
      .set(
        'Content-Disposition',
        `attachment; filename="admin-operations-page-${result.page}.csv"`,
      )
      .type('text/csv')
      .send('\uFEFF' + csv);
  });
  router.post('/bookings/:id/waiting-dispatch', async (req, res) =>
    res.json(
      await queueBooking(
        pool,
        req.adminUser,
        idSchema.parse(req.params.id),
        req.body,
      ),
    ),
  );
  router.get('/bookings/:id/planner', async (req, res) =>
    res.json(
      await getBookingPlanner(pool, idSchema.parse(req.params.id), req.query),
    ),
  );
  router.get('/bookings/:id/emails', async (req, res) =>
    res.json(await listBookingEmails(pool, idSchema.parse(req.params.id))),
  );
  router.post('/bookings/:id/emails/:emailId/retry', async (req, res) =>
    res.json(
      await retryBookingEmail(
        pool,
        req.adminUser,
        idSchema.parse(req.params.id),
        idSchema.parse(req.params.emailId),
        req.body,
      ),
    ),
  );
}
