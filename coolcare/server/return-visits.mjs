import { createHash } from 'node:crypto';
import { z } from 'zod';
import { AppError } from './inventory.mjs';
import { assertBookableDate } from './customer/booking-schedule.mjs';
import {
  BOOKING_TIME_SLOTS,
  bookingServiceSlot,
  assertTeamCapacity,
  lockServiceDates,
  lockTechnicianRoster,
} from './scheduling.mjs';
const base = { requestId: z.uuid(), expectedVersion: z.number().int().min(0) };
export const returnRequestSchema = z.discriminatedUnion('action', [
  z.object({ ...base, action: z.literal('invite') }).strict(),
  z
    .object({
      ...base,
      action: z.literal('choose'),
      date: z.string(),
      timeSlot: z.enum(BOOKING_TIME_SLOTS.map((s) => s.code)),
    })
    .strict(),
  z
    .object({
      ...base,
      action: z.literal('dispatch'),
      technicianId: z.number().int().positive(),
    })
    .strict(),
]);
export async function snapshotVisit(c, jobId, outcome) {
  const [[w]] = await c.execute(
    `SELECT w.assignment_id,a.technician_id,r.* FROM work_order w JOIN assignment a ON a.assignment_id=w.assignment_id JOIN service_report r ON r.job_id=w.job_id WHERE w.job_id=? FOR UPDATE`,
    [jobId],
  );
  if (!w) return;
  await c.execute(
    `INSERT INTO service_visit_record(job_id,report_id,technician_id,started_at,ended_at,outcome,report_snapshot) VALUES (?,?,?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 8 HOUR),?,?)`,
    [
      jobId,
      w.report_id,
      w.technician_id,
      w.started_at,
      outcome,
      JSON.stringify(w),
    ],
  );
}
export async function listReturns(pool, role, userId) {
  const [rows] = await pool.execute(
    `SELECT w.job_id AS jobId,b.booking_id AS bookingId,u.full_name AS customer,p.revision AS version,p.follow_up_status AS status,
 DATE_FORMAT(p.follow_up_date,'%Y-%m-%d') AS date,p.follow_up_start AS start,p.follow_up_end AS end,
 (SELECT e.reason FROM service_progress_event e WHERE e.job_id=w.job_id AND e.kind='Return required' ORDER BY e.revision DESC LIMIT 1) AS reason,
 (SELECT e.part_notes FROM service_progress_event e WHERE e.job_id=w.job_id AND e.kind='Return required' ORDER BY e.revision DESC LIMIT 1) AS parts
 FROM service_progress p JOIN work_order w ON w.job_id=p.job_id JOIN booking b ON b.booking_id=w.booking_id JOIN customer cu ON cu.customer_id=b.customer_id JOIN user_account u ON u.user_id=cu.user_id
 WHERE p.follow_up_status NOT IN ('None','Completed') ${role === 'customer' ? 'AND cu.user_id=?' : ''} ORDER BY w.job_id DESC`,
    role === 'customer' ? [userId] : [],
  );
  return { rows };
}
export async function returnAvailability(pool, userId, jobId, date) {
  assertBookableDate(date);
  const c = await pool.getConnection();
  try {
    await c.beginTransaction();
    const [[w]] = await c.execute(
      `SELECT w.booking_id,b.estimated_duration_minutes FROM work_order w JOIN booking b ON b.booking_id=w.booking_id JOIN customer cu ON cu.customer_id=b.customer_id JOIN service_progress p ON p.job_id=w.job_id WHERE w.job_id=? AND cu.user_id=? AND p.follow_up_status='Awaiting customer'`,
      [jobId, userId],
    );
    if (!w)
      throw new AppError('Return visit not available for selection.', 404);
    const slots = [];
    for (const s of BOOKING_TIME_SLOTS) {
      try {
        const slot = bookingServiceSlot(s.code, w.estimated_duration_minutes);
        await assertTeamCapacity(c, [{ date, ...slot }], {
          excludeBookingId: w.booking_id,
        });
        slots.push({ code: s.code, label: s.label, available: true });
      } catch (e) {
        if (e.status !== 409) throw e;
        slots.push({ code: s.code, label: s.label, available: false });
      }
    }
    await c.rollback();
    return { slots };
  } catch (e) {
    await c.rollback();
    throw e;
  } finally {
    c.release();
  }
}
export async function updateReturn(pool, role, userId, jobId, raw) {
  const d = returnRequestSchema.parse(raw);
  if ((role === 'customer') !== (d.action === 'choose'))
    throw new AppError('This action is not permitted for your role.', 403);
  const hash = createHash('sha256')
    .update(JSON.stringify({ role, userId, jobId, ...d }))
    .digest('hex');
  const c = await pool.getConnection();
  try {
    await c.beginTransaction();
    const [[hint]] = await c.execute(
      'SELECT booking_id FROM work_order WHERE job_id=?',
      [jobId],
    );
    if (!hint) throw new AppError('Work order not found.', 404);
    await c.execute(
      'SELECT booking_id FROM booking WHERE booking_id=? FOR UPDATE',
      [hint.booking_id],
    );
    const [[w]] = await c.execute(
      `SELECT w.*,b.booking_status,b.estimated_duration_minutes,cu.user_id AS customerUser FROM work_order w JOIN booking b ON b.booking_id=w.booking_id JOIN customer cu ON cu.customer_id=b.customer_id WHERE w.job_id=? FOR UPDATE`,
      [jobId],
    );
    if (role === 'customer' && w.customerUser !== userId)
      throw new AppError('Work order not found.', 404);
    const [[previous]] = await c.execute(
      'SELECT * FROM return_visit_operation WHERE request_id=?',
      [d.requestId],
    );
    if (previous) {
      if (previous.payload_hash !== hash)
        throw new AppError(
          'Request ID already used for different content.',
          409,
        );
      await c.commit();
      return {
        ...(typeof previous.result_json === 'string'
          ? JSON.parse(previous.result_json)
          : previous.result_json),
        replayed: true,
      };
    }
    const [[p]] = await c.execute(
      'SELECT * FROM service_progress WHERE job_id=? FOR UPDATE',
      [jobId],
    );
    if (!p || p.revision !== d.expectedVersion)
      throw new AppError(
        'This request changed. Reload before continuing.',
        409,
      );
    let state,
      kind,
      date = null,
      start = null,
      end = null;
    if (d.action === 'invite') {
      if (!['Required', 'Awaiting confirmation'].includes(p.follow_up_status))
        throw new AppError('This return visit is not awaiting review.', 409);
      state = 'Awaiting customer';
      kind = 'Return invited';
    } else if (d.action === 'choose') {
      if (p.follow_up_status !== 'Awaiting customer')
        throw new AppError(
          'Wait for the administrator to invite you to choose a time.',
          409,
        );
      assertBookableDate(d.date);
      const slot = bookingServiceSlot(d.timeSlot, w.estimated_duration_minutes);
      date = d.date;
      start = slot.start;
      end = slot.end;
      await assertTeamCapacity(c, [{ date, start, end }], {
        excludeBookingId: w.booking_id,
      });
      state = 'Awaiting confirmation';
      kind = 'Return requested';
    } else {
      if (p.follow_up_status !== 'Awaiting confirmation')
        throw new AppError('Wait for the customer to choose a time.', 409);
      date = String(p.follow_up_date).slice(0, 10);
      start = p.follow_up_start;
      end = p.follow_up_end;
      assertBookableDate(date);
      await lockServiceDates(c, [date]);
      await lockTechnicianRoster(c);
      await assertTeamCapacity(c, [{ date, start, end }], {
        excludeBookingId: w.booking_id,
      });
      const [[tech]] = await c.execute(
        `SELECT t.technician_id FROM technician t JOIN user_account u ON u.user_id=t.user_id WHERE t.technician_id=? AND u.status='Active' AND t.availability_status NOT IN ('Unavailable','On Leave') FOR UPDATE`,
        [d.technicianId],
      );
      if (!tech)
        throw new AppError('Select an active available technician.', 409);
      const [conflicts] = await c.execute(
        `SELECT w.job_id FROM work_order w JOIN assignment a ON a.assignment_id=w.assignment_id JOIN booking b ON b.booking_id=w.booking_id WHERE a.technician_id=? AND w.job_id<>? AND w.current_status IN ('Assigned','On The Way','In Progress','Return visit') AND DATE(w.appointment_date)=? AND b.slot_start<? AND b.slot_end>? FOR UPDATE`,
        [d.technicianId, jobId, date, end, start],
      );
      const [legacyConflicts] = await c.execute(
        `SELECT p.job_id FROM service_progress p JOIN work_order w ON w.job_id=p.job_id JOIN assignment a ON a.assignment_id=w.assignment_id WHERE a.technician_id=? AND p.job_id<>? AND p.follow_up_status IN ('Scheduled','In Progress') AND p.follow_up_date=? AND p.follow_up_start<? AND p.follow_up_end>? FOR UPDATE`,
        [d.technicianId, jobId, date, end, start],
      );
      if (conflicts.length || legacyConflicts.length)
        throw new AppError(
          'This technician has overlapping work. Choose another technician.',
          409,
        );
      await c.execute(
        "UPDATE assignment SET assignment_status='Reassigned' WHERE assignment_id=?",
        [w.assignment_id],
      );
      const [a] = await c.execute(
        `INSERT INTO assignment(booking_id,technician_id,assigned_by_admin_id,dispatch_request_id,assignment_status) VALUES (?,?,?,?,'Assigned')`,
        [w.booking_id, d.technicianId, userId, d.requestId],
      );
      await c.execute(
        "UPDATE work_order SET assignment_id=?,appointment_date=?,appointment_time=?,current_status='Return visit' WHERE job_id=?",
        [a.insertId, date + ' ' + start, start, jobId],
      );
      await c.execute(
        "UPDATE booking SET booking_status='Return visit',preferred_service_date=?,preferred_time_slot=?,slot_start=?,slot_end=? WHERE booking_id=?",
        [
          date,
          start.slice(0, 5) + ' - ' + end.slice(0, 5),
          start,
          end,
          w.booking_id,
        ],
      );
      await c.execute(
        'UPDATE technician SET last_assigned_at=UTC_TIMESTAMP() WHERE technician_id=?',
        [d.technicianId],
      );
      state = 'Scheduled';
      kind = 'Return scheduled';
    }
    const version = p.revision + 1;
    await c.execute(
      'UPDATE service_progress SET revision=?,follow_up_status=?,follow_up_date=?,follow_up_start=?,follow_up_end=? WHERE job_id=?',
      [version, state, date, start, end, jobId],
    );
    const [[report]] = await c.execute(
      'SELECT report_id FROM service_report WHERE job_id=?',
      [jobId],
    );
    const result = { jobId, version, status: state, replayed: false };
    await c.execute(
      `INSERT INTO service_progress_event(request_id,payload_hash,result_json,job_id,report_id,actor_user_id,revision,kind,reason,notes,part_notes,follow_up_date,follow_up_start,follow_up_end) VALUES (?,?,?,?,?,?,?,?,?,?,'',?,?,?)`,
      [
        d.requestId,
        hash,
        JSON.stringify(result),
        jobId,
        report.report_id,
        userId,
        version,
        kind,
        kind,
        kind,
        date,
        start,
        end,
      ],
    );
    await c.execute(
      'INSERT INTO return_visit_operation(request_id,job_id,actor_user_id,payload_hash,result_json) VALUES(?,?,?,?,?)',
      [d.requestId, jobId, userId, hash, JSON.stringify(result)],
    );
    if (d.action === 'dispatch')
      await c.execute(
        'INSERT INTO booking_status_history(booking_id,old_status,new_status,changed_by_user_id,change_note) VALUES(?,?,?,?,?)',
        [
          w.booking_id,
          w.booking_status,
          'Return visit',
          userId,
          'Return visit confirmed and dispatched.',
        ],
      );
    await c.commit();
    return result;
  } catch (e) {
    await c.rollback();
    throw e;
  } finally {
    c.release();
  }
}
export function registerReturnRoutes(router, pool, role) {
  const user = (req) =>
    role === 'admin' ? req.adminUser.userId : req.customerUser.id;
  router.get('/return-visits', async (req, res) =>
    res.json(await listReturns(pool, role, user(req))),
  );
  router.post('/return-visits/:id', async (req, res) =>
    res.json(
      await updateReturn(
        pool,
        role,
        user(req),
        z.coerce.number().int().positive().parse(req.params.id),
        req.body,
      ),
    ),
  );
  if (role === 'customer')
    router.get('/return-visits/:id/availability', async (req, res) =>
      res.json(
        await returnAvailability(
          pool,
          user(req),
          z.coerce.number().int().positive().parse(req.params.id),
          req.query.date,
        ),
      ),
    );
}
