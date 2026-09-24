import { createHash } from 'node:crypto';
import { z } from 'zod';
import { AppError } from './inventory.mjs';
import {
  assertTeamCapacity,
  lockServiceDates,
  lockTechnicianRoster,
} from './scheduling.mjs';

const hash = (value) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
const common = {
  requestId: z.uuid(),
  expectedVersion: z.number().int().min(0).max(4294967294),
  notes: z.string().trim().min(5).max(2000),
};
export const serviceProgressSchema = z.discriminatedUnion('action', [
  z
    .object({
      ...common,
      action: z.literal('extend'),
      minutes: z
        .number()
        .int()
        .min(15)
        .max(120)
        .refine((n) => n % 15 === 0, 'Use 15-minute increments.'),
      reason: z.enum([
        'More cleaning required',
        'Complex repair',
        'Additional checks',
        'Other',
      ]),
    })
    .strict(),
  z
    .object({
      ...common,
      action: z.literal('require-return'),
      reason: z.enum([
        'Part unavailable',
        'Additional diagnosis',
        'More time required',
        'Other',
      ]),
      partNotes: z.string().trim().max(2000).default(''),
    })
    .strict(),
  z
    .object({
      ...common,
      action: z.literal('schedule-return'),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      start: z.string().regex(/^(09|1[0-7]):(00|15|30|45)$/),
      durationMinutes: z
        .number()
        .int()
        .min(15)
        .max(480)
        .refine((n) => n % 15 === 0),
    })
    .strict(),
  z.object({ ...common, action: z.literal('start-return') }).strict(),
  z
    .object({
      ...common,
      action: z.literal('complete-return'),
      partNotes: z.string().trim().max(2000).default(''),
    })
    .strict(),
  z
    .object({
      ...common,
      action: z.literal('repair-quote'),
      amount: z
        .number()
        .finite()
        .min(0)
        .max(100000)
        .refine(
          (n) => Math.abs(n * 100 - Math.round(n * 100)) < 0.00001,
          'Use at most two decimal places.',
        ),
    })
    .strict(),
]);
export async function getServiceProgress(c, jobId) {
  const [[row]] = await c.execute(
    `SELECT revision AS version,extension_minutes AS extensionMinutes,expected_end_time AS expectedEndTime,
  follow_up_status AS followUpStatus,DATE_FORMAT(follow_up_date,'%Y-%m-%d') AS followUpDate,follow_up_start AS followUpStart,follow_up_end AS followUpEnd,
  additional_repair_fee AS additionalRepairFee,repair_quote_note AS repairQuoteNote FROM service_progress WHERE job_id=?`,
    [jobId],
  );
  const [events] = await c.execute(
    `SELECT e.event_id AS id,e.report_id AS reportId,e.revision AS version,e.kind,e.minutes,e.amount,e.reason,e.notes,e.part_notes AS partNotes,
  DATE_FORMAT(e.follow_up_date,'%Y-%m-%d') AS followUpDate,e.follow_up_start AS followUpStart,e.follow_up_end AS followUpEnd,
  DATE_FORMAT(CONVERT_TZ(e.created_at,'+00:00','+08:00'),'%Y-%m-%d %H:%i:%s') AS createdAt,u.full_name AS createdBy
  FROM service_progress_event e JOIN user_account u ON u.user_id=e.actor_user_id WHERE e.job_id=? ORDER BY e.revision DESC`,
    [jobId],
  );
  return {
    ...(row ?? {
      version: 0,
      extensionMinutes: 0,
      expectedEndTime: null,
      followUpStatus: 'None',
      followUpDate: null,
      followUpStart: null,
      followUpEnd: null,
      additionalRepairFee: 0,
      repairQuoteNote: '',
    }),
    additionalRepairFee: Number(row?.additionalRepairFee ?? 0),
    events: events.map((e) => ({
      ...e,
      amount: e.amount === null ? null : Number(e.amount),
    })),
  };
}
export function extendTime(start, minutes) {
  const [h, m] = String(start ?? '')
      .split(':')
      .map(Number),
    total = h * 60 + m + minutes;
  if (!Number.isFinite(total) || total > 18 * 60)
    throw new AppError(
      'The visit would finish after 6:00 PM. Record a return visit instead.',
      409,
    );
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}:00`;
}
async function assertTechnicianFree(c, technicianId, jobId, date, start, end) {
  const [conflicts] = await c.execute(
    `SELECT w.job_id FROM work_order w JOIN assignment a ON a.assignment_id=w.assignment_id AND a.booking_id=w.booking_id
  JOIN booking b ON b.booking_id=w.booking_id WHERE a.technician_id=? AND w.job_id<>? AND a.assignment_status NOT IN ('Completed','Cancelled','Declined','Reassigned')
  AND w.current_status IN ('Assigned','On The Way','In Progress') AND DATE(w.appointment_date)=? AND b.slot_start<? AND b.slot_end>? FOR UPDATE`,
    [technicianId, jobId, date, end, start],
  );
  const [returns] = await c.execute(
    `SELECT p.job_id FROM service_progress p JOIN work_order w ON w.job_id=p.job_id JOIN assignment a ON a.assignment_id=w.assignment_id AND a.booking_id=w.booking_id
  WHERE a.technician_id=? AND p.job_id<>? AND a.assignment_status NOT IN ('Cancelled','Declined','Reassigned')
  AND p.follow_up_status IN ('Scheduled','In Progress') AND p.follow_up_date=? AND p.follow_up_start<? AND p.follow_up_end>? FOR UPDATE`,
    [technicianId, jobId, date, end, start],
  );
  if (conflicts.length || returns.length)
    throw new AppError(
      'This technician has another visit during that time. Choose another time or contact the administrator.',
      409,
    );
}
export async function updateServiceProgress(pool, userId, jobId, raw) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await saveServiceProgress(pool, userId, jobId, raw);
    } catch (error) {
      if (!['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT'].includes(error.code))
        throw error;
      if (attempt === 2)
        throw new AppError(
          'Another schedule update is in progress. Retry this update.',
          409,
        );
    }
  }
}
async function saveServiceProgress(pool, userId, jobId, raw) {
  const d = serviceProgressSchema.parse(raw),
    payloadHash = hash({ userId, jobId, ...d }),
    c = await pool.getConnection();
  try {
    await c.beginTransaction();
    const [[hint]] = await c.execute(
      `SELECT w.booking_id AS bookingId,DATE_FORMAT(w.appointment_date,'%Y-%m-%d') AS date,DATE_FORMAT(p.follow_up_date,'%Y-%m-%d') AS followUpDate FROM work_order w LEFT JOIN service_progress p ON p.job_id=w.job_id WHERE w.job_id=?`,
      [jobId],
    );
    if (!hint) throw new AppError('Job not found for this technician.', 404);
    await c.execute(
      'SELECT booking_id FROM booking WHERE booking_id=? FOR UPDATE',
      [hint.bookingId],
    );
    if (['extend', 'schedule-return'].includes(d.action)) {
      await lockServiceDates(c, [
        hint.date,
        ...(hint.followUpDate ? [hint.followUpDate] : []),
        ...(d.date ? [d.date] : []),
      ]);
      await lockTechnicianRoster(c);
    }
    const [[w]] = await c.execute(
      `SELECT w.*,DATE_FORMAT(w.appointment_date,'%Y-%m-%d') AS serviceDate,a.technician_id,t.availability_status,b.slot_start,b.slot_end,b.service_id,
   EXISTS(SELECT 1 FROM simple_service_catalog ss WHERE ss.service_id=b.service_id AND ss.code='repair') OR EXISTS(SELECT 1 FROM booking_service bs JOIN simple_service_catalog ss ON ss.service_id=bs.service_id WHERE bs.booking_id=b.booking_id AND ss.code='repair') AS repairEligible
   FROM work_order w JOIN booking b ON b.booking_id=w.booking_id JOIN assignment a ON a.assignment_id=w.assignment_id AND a.booking_id=w.booking_id
   JOIN technician t ON t.technician_id=a.technician_id JOIN user_account u ON u.user_id=t.user_id
   WHERE w.job_id=? AND t.user_id=? AND u.status='Active' AND a.assignment_status NOT IN ('Cancelled','Declined','Reassigned') FOR UPDATE`,
      [jobId, userId],
    );
    if (!w) throw new AppError('Job not found for this technician.', 404);
    const [[previous]] = await c.execute(
      'SELECT payload_hash,result_json FROM service_progress_event WHERE request_id=? FOR SHARE',
      [d.requestId],
    );
    if (previous) {
      if (previous.payload_hash !== payloadHash)
        throw new AppError(
          'This request was already used for a different update.',
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
    if (!['In Progress', 'Completed'].includes(w.current_status))
      throw new AppError(
        'Start the service before recording a service update.',
        409,
      );
    if (w.serviceDate !== hint.date)
      throw new AppError(
        'The appointment changed. Reload this work order.',
        409,
      );
    await c.execute(
      'INSERT INTO service_progress(job_id) VALUES (?) ON DUPLICATE KEY UPDATE job_id=VALUES(job_id)',
      [jobId],
    );
    const [[p]] = await c.execute(
      'SELECT * FROM service_progress WHERE job_id=? FOR UPDATE',
      [jobId],
    );
    if (p.revision !== d.expectedVersion)
      throw new AppError(
        'Service updates changed elsewhere. Reload before saving.',
        409,
      );
    let kind,
      reason = d.reason ?? '',
      minutes = null,
      amount = null,
      date = null,
      start = null,
      end = null;
    if (d.action === 'extend') {
      const returnInProgress = p.follow_up_status === 'In Progress';
      if (w.current_status !== 'In Progress' && !returnInProgress)
        throw new AppError('Only a service in progress can be extended.', 409);
      if (
        returnInProgress &&
        String(p.follow_up_date).slice(0, 10) !== hint.followUpDate
      )
        throw new AppError(
          'The return appointment changed. Reload this work order.',
          409,
        );
      end = extendTime(
        returnInProgress ? p.follow_up_end : w.slot_end,
        d.minutes,
      );
      start = returnInProgress ? p.follow_up_start : w.slot_start;
      date = returnInProgress
        ? String(p.follow_up_date).slice(0, 10)
        : w.serviceDate;
      minutes = d.minutes;
      kind = 'Extension';
      await assertTeamCapacity(c, [{ date, start, end }], {
        excludeBookingId: w.booking_id,
      });
      await assertTechnicianFree(c, w.technician_id, jobId, date, start, end);
      if (returnInProgress)
        await c.execute(
          'UPDATE service_progress SET follow_up_end=? WHERE job_id=?',
          [end, jobId],
        );
      else
        await c.execute('UPDATE booking SET slot_end=? WHERE booking_id=?', [
          end,
          w.booking_id,
        ]);
      await c.execute(
        'UPDATE service_progress SET extension_minutes=extension_minutes+?,expected_end_time=? WHERE job_id=?',
        [minutes, end, jobId],
      );
    } else if (d.action === 'require-return') {
      if (!['None', 'Completed'].includes(p.follow_up_status))
        throw new AppError(
          'A return visit is already open. Update that visit first.',
          409,
        );
      if (d.reason === 'Part unavailable' && d.partNotes.trim().length < 5)
        throw new AppError(
          'Record the missing part and required quantity.',
          400,
        );
      kind = 'Return required';
      await c.execute(
        "UPDATE service_progress SET follow_up_status='Required',follow_up_date=NULL,follow_up_start=NULL,follow_up_end=NULL WHERE job_id=?",
        [jobId],
      );
    } else if (d.action === 'schedule-return') {
      if(['Unavailable','On Leave'].includes(w.availability_status))throw new AppError('Update your availability or contact the administrator before scheduling a return visit.',409);
      if (!['Required', 'Scheduled'].includes(p.follow_up_status))
        throw new AppError('Record why a return visit is required first.', 409);
      if (w.current_status !== 'Completed')
        throw new AppError(
          'End the current service before scheduling its return visit.',
          409,
        );
      const day = new Date(`${d.date}T00:00:00Z`),
        today = new Intl.DateTimeFormat('en-CA', {
          timeZone: 'Asia/Singapore',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }).format(new Date());
      if (
        Number.isNaN(day.getTime()) ||
        day.toISOString().slice(0, 10) !== d.date ||
        d.date <= today ||
        [0, 6].includes(day.getUTCDay())
      )
        throw new AppError(
          'Choose a future weekday for the return visit.',
          400,
        );
      date = d.date;
      start = d.start + ':00';
      end = extendTime(start, d.durationMinutes);
      kind = 'Return scheduled';
      reason = 'Return visit appointment';
      await assertTeamCapacity(c, [{ date, start, end }], {
        excludeBookingId: w.booking_id,
      });
      await assertTechnicianFree(c, w.technician_id, jobId, date, start, end);
      await c.execute(
        "UPDATE service_progress SET follow_up_status='Scheduled',follow_up_date=?,follow_up_start=?,follow_up_end=? WHERE job_id=?",
        [date, start, end, jobId],
      );
    } else if (d.action === 'start-return' || d.action === 'complete-return') {
      const from = d.action === 'start-return' ? 'Scheduled' : 'In Progress',
        to = d.action === 'start-return' ? 'In Progress' : 'Completed';
      if (p.follow_up_status !== from)
        throw new AppError(
          `The return visit must be ${from.toLowerCase()} before this update.`,
          409,
        );
      date = p.follow_up_date;
      start = p.follow_up_start;
      end = p.follow_up_end;
      kind =
        d.action === 'start-return' ? 'Return started' : 'Return completed';
      reason = 'Return visit progress';
      await c.execute(
        'UPDATE service_progress SET follow_up_status=? WHERE job_id=?',
        [to, jobId],
      );
    } else {
      if (!w.repairEligible)
        throw new AppError(
          'Additional repair charges are only available on a Repair work order.',
          400,
        );
      kind = 'Repair quote';
      reason = 'Technician repair quotation';
      amount = d.amount;
      await c.execute(
        'UPDATE service_progress SET additional_repair_fee=?,repair_quote_note=? WHERE job_id=?',
        [amount, d.notes, jobId],
      );
    }
    await c.execute(
      "INSERT INTO service_report(job_id,work_performed) VALUES (?,'') ON DUPLICATE KEY UPDATE job_id=VALUES(job_id)",
      [jobId],
    );
    const [[report]] = await c.execute(
      'SELECT report_id FROM service_report WHERE job_id=? FOR SHARE',
      [jobId],
    );
    const version = p.revision + 1,
      result = { jobId, reportId: report.report_id, version, replayed: false };
    await c.execute('UPDATE service_progress SET revision=? WHERE job_id=?', [
      version,
      jobId,
    ]);
    await c.execute(
      `INSERT INTO service_progress_event(request_id,payload_hash,result_json,job_id,report_id,actor_user_id,revision,kind,minutes,amount,reason,notes,part_notes,follow_up_date,follow_up_start,follow_up_end)
   VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        d.requestId,
        payloadHash,
        JSON.stringify(result),
        jobId,
        report.report_id,
        userId,
        version,
        kind,
        minutes,
        amount,
        reason,
        d.notes,
        d.partNotes ?? '',
        date,
        start,
        end,
      ],
    );
    await c.execute(
      'UPDATE work_order SET updated_at=CURRENT_TIMESTAMP WHERE job_id=?',
      [jobId],
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
