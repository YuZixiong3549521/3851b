import express from 'express';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { AppError, idSchema } from './inventory.mjs';
import { sessionUser } from './public-site.mjs';

const base = {
  requestId: z.uuid(),
  expectedVersion: z.number().int().min(0).max(4294967294),
};
export const feedbackSchema = z
  .object({
    ...base,
    stars: z.number().int().min(1).max(5),
    comment: z.string().trim().max(1500).default(''),
  })
  .strict();
export const qualitySchema = z
  .object({
    ...base,
    score: z.number().int().min(0).max(100),
    reason: z.string().trim().min(5).max(1500),
  })
  .strict();
export const settingsSchema = z
  .object({
    ...base,
    customerWeight: z.number().int().min(1).max(98),
    qualityWeight: z.number().int().min(1).max(98),
    punctualityWeight: z.number().int().min(1).max(98),
    graceMinutes: z.number().int().min(0).max(60),
    reason: z.string().trim().min(5).max(1500),
  })
  .strict()
  .refine(
    (d) => d.customerWeight + d.qualityWeight + d.punctualityWeight === 100,
    'The three weights must add up to 100.',
  );
const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (s) =>
      !Number.isNaN(Date.parse(s)) &&
      new Date(s).toISOString().slice(0, 10) === s,
  );
const filterSchema = z
  .object({
    from: calendarDate.optional(),
    to: calendarDate.optional(),
    technicianId: z.coerce.number().int().positive().optional(),
  })
  .strict();

// Called inside the existing booking/work-order transaction, after the report is created.
// INSERT IGNORE preserves both the scheduled time and the technician of the first start.
export async function capturePerformanceVisitStart(c, jobId) {
  await c.execute(
    `INSERT IGNORE INTO performance_visit
    (report_id,job_id,technician_id,scheduled_start,actual_start)
    SELECT r.report_id,w.job_id,a.technician_id,TIMESTAMP(DATE(w.appointment_date),w.appointment_time),r.started_at
    FROM work_order w JOIN assignment a ON a.assignment_id=w.assignment_id
    JOIN service_report r ON r.job_id=w.job_id
    WHERE w.job_id=? AND r.started_at IS NOT NULL`,
    [jobId],
  );
}

export async function capturePerformanceVisitEnd(c, jobId, outcome) {
  // Legacy services which were already running when this feature was installed have
  // no trustworthy captured scheduled time. Keep it NULL instead of using a later edit.
  await c.execute(
    `INSERT IGNORE INTO performance_visit
    (report_id,job_id,technician_id,actual_start,capture_source)
    SELECT r.report_id,w.job_id,a.technician_id,r.started_at,'Historical snapshot'
    FROM work_order w JOIN assignment a ON a.assignment_id=w.assignment_id
    JOIN service_report r ON r.job_id=w.job_id WHERE w.job_id=?`,
    [jobId],
  );
  await c.execute(
    `UPDATE performance_visit p JOIN service_report r ON r.report_id=p.report_id AND r.job_id=?
    SET p.actual_end=COALESCE(p.actual_end,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 8 HOUR)),
        p.outcome=COALESCE(p.outcome,?)`,
    [jobId, outcome],
  );
}

export function punctualityScore(visit, settings) {
  if (!visit.scheduledStart || !visit.actualStart) return null;
  const scheduled = Date.parse(
    String(visit.scheduledStart).replace(' ', 'T') + '+08:00',
  );
  const actual = Date.parse(
    String(visit.actualStart).replace(' ', 'T') + '+08:00',
  );
  if (!Number.isFinite(scheduled) || !Number.isFinite(actual)) return null;
  return actual <= scheduled + settings.graceMinutes * 60000 ? 100 : 0;
}
const mean = (values) =>
  values.length
    ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10
    : null;
export function summarizePerformance(visits, settings) {
  const closed = visits.filter((v) => v.actualEnd);
  const customer = closed
    .filter((v) => v.stars != null)
    .map((v) => Number(v.stars));
  const quality = closed
    .filter((v) => v.qualityScore != null)
    .map((v) => Number(v.qualityScore));
  const punctuality = closed
    .map((v) => punctualityScore(v, settings))
    .filter((v) => v !== null);
  const scored = closed.filter(
    (v) =>
      v.stars != null &&
      v.qualityScore != null &&
      punctualityScore(v, settings) !== null,
  );
  const composites = scored.map(
    (v) =>
      (Number(v.stars) * 20 * settings.customerWeight) / 100 +
      (Number(v.qualityScore) * settings.qualityWeight) / 100 +
      (punctualityScore(v, settings) * settings.punctualityWeight) / 100,
  );
  return {
    closedVisits: closed.length,
    completedVisits: closed.filter((v) => v.outcome === 'Completed').length,
    returnRequiredVisits: closed.filter((v) => v.outcome === 'Return required')
      .length,
    reportsSubmitted: closed.filter((v) => v.reportSubmittedAt).length,
    checklistsRecorded: closed.filter((v) => v.checklistRecorded).length,
    customerAverage: mean(customer),
    customerCount: customer.length,
    qualityAverage: mean(quality),
    qualityCount: quality.length,
    punctualityPercent: mean(punctuality),
    punctualityCount: punctuality.length,
    fullyScoredVisits: scored.length,
    minimumScoredVisits: 5,
    compositeScore: scored.length >= 5 ? mean(composites) : null,
  };
}

export async function getPerformanceSettings(c) {
  const [[row]] =
    await c.execute(`SELECT customer_weight AS customerWeight,quality_weight AS qualityWeight,
    punctuality_weight AS punctualityWeight,grace_minutes AS graceMinutes,version FROM performance_settings WHERE settings_id=1`);
  if (!row)
    throw new AppError(
      'Performance settings are not installed. Apply database migrations.',
      503,
    );
  return row;
}
function filters(raw) {
  const f = filterSchema.parse(raw);
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Singapore',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  f.to ??= today;
  f.from ??= new Date(Date.parse(f.to) - 89 * 86400000)
    .toISOString()
    .slice(0, 10);
  if (f.from > f.to || Date.parse(f.to) - Date.parse(f.from) > 366 * 86400000)
    throw new AppError(
      'Choose a date range of up to 367 days with the start before the end.',
      400,
    );
  return f;
}
const visitSelect = `SELECT p.report_id AS reportId,p.job_id AS jobId,p.technician_id AS technicianId,
  tech.full_name AS technician,b.booking_id AS bookingId,customer.full_name AS customer,
  sa.address_line AS address,COALESCE((SELECT GROUP_CONCAT(bs.service_name ORDER BY bs.service_id SEPARATOR ', ')
    FROM booking_service bs WHERE bs.booking_id=b.booking_id),sc.service_name) AS service,
  DATE_FORMAT(p.scheduled_start,'%Y-%m-%d %H:%i:%s') AS scheduledStart,
  DATE_FORMAT(p.actual_start,'%Y-%m-%d %H:%i:%s') AS actualStart,
  DATE_FORMAT(p.actual_end,'%Y-%m-%d %H:%i:%s') AS actualEnd,
  p.outcome,p.capture_source AS captureSource,
  r.submitted_time AS reportSubmittedAt,(LENGTH(TRIM(COALESCE(r.checklist_result,'')))>0) AS checklistRecorded,
  COALESCE(r.work_performed,'') AS workPerformed,COALESCE(r.problem_found,'') AS problemFound,
  COALESCE(r.solution_applied,'') AS solutionApplied,COALESCE(r.checklist_result,'') AS checklist,
  f.stars,COALESCE(f.comment,'') AS comment,COALESCE(f.version,0) AS feedbackVersion,
  q.score AS qualityScore,COALESCE(q.reason,'') AS qualityReason,COALESCE(q.version,0) AS qualityVersion,
  (SELECT e.reason FROM service_progress_event e WHERE e.report_id=p.report_id AND e.kind='Return required'
    ORDER BY e.revision DESC LIMIT 1) AS returnReason,
  (SELECT e.part_notes FROM service_progress_event e WHERE e.report_id=p.report_id AND e.kind='Return required'
    ORDER BY e.revision DESC LIMIT 1) AS returnParts
  FROM performance_visit p JOIN service_report r ON r.report_id=p.report_id
  JOIN work_order w ON w.job_id=p.job_id JOIN booking b ON b.booking_id=w.booking_id
  JOIN customer cu ON cu.customer_id=b.customer_id JOIN user_account customer ON customer.user_id=cu.user_id
  JOIN technician t ON t.technician_id=p.technician_id JOIN user_account tech ON tech.user_id=t.user_id
  JOIN service_address sa ON sa.address_id=b.address_id JOIN service_catalog sc ON sc.service_id=b.service_id
  LEFT JOIN performance_feedback f ON f.report_id=p.report_id LEFT JOIN performance_quality q ON q.report_id=p.report_id`;

export async function listPerformance(pool, user, raw = {}) {
  if (!['Admin', 'Technician', 'Customer'].includes(user.role))
    throw new AppError('This portal is unavailable.', 403);
  const f = filters(raw),
    settings = await getPerformanceSettings(pool);
  const where = ['p.actual_end>=?', 'p.actual_end<DATE_ADD(?,INTERVAL 1 DAY)'],
    values = [f.from, f.to];
  if (user.role === 'Technician') {
    where.push('t.user_id=?');
    values.push(user.id);
  }
  if (user.role === 'Customer') {
    where.push('cu.user_id=?');
    values.push(user.id);
  }
  if (f.technicianId) {
    where.push('p.technician_id=?');
    values.push(f.technicianId);
  }
  const [rows] = await pool.execute(
    visitSelect +
      ' WHERE ' +
      where.join(' AND ') +
      ' ORDER BY p.actual_end DESC,p.report_id DESC',
    values,
  );
  const visits = rows.map((r) => ({
    ...r,
    checklistRecorded: Boolean(r.checklistRecorded),
    punctualityScore: punctualityScore(r, settings),
  }));
  if (user.role === 'Customer')
    return {
      visits: visits.map(
        ({
          qualityScore,
          qualityReason,
          qualityVersion,
          punctualityScore,
          workPerformed,
          problemFound,
          solutionApplied,
          checklist,
          ...v
        }) => v,
      ),
      filters: f,
    };
  const technicians = new Map();
  for (const v of visits)
    if (!technicians.has(v.technicianId))
      technicians.set(v.technicianId, {
        technicianId: v.technicianId,
        name: v.technician,
      });
  const [auditRows] =
    user.role === 'Admin'
      ? await pool.execute(
          `SELECT o.request_id AS requestId,o.report_id AS reportId,o.operation_kind AS kind,
    u.full_name AS actor,o.before_json AS beforeValue,o.after_json AS afterValue,UNIX_TIMESTAMP(o.created_at) AS createdAtEpoch
    FROM performance_operation o JOIN user_account u ON u.user_id=o.actor_user_id
    WHERE UNIX_TIMESTAMP(o.created_at)>=? AND UNIX_TIMESTAMP(o.created_at)<?
    ORDER BY o.created_at DESC,o.request_id DESC LIMIT 100`,
          [
            Date.parse(f.from + 'T00:00:00+08:00') / 1000,
            Date.parse(f.to + 'T00:00:00+08:00') / 1000 + 86400,
          ],
        )
      : [[]];
  const audit = auditRows.map(({ createdAtEpoch, ...a }) => ({
    ...a,
    createdAt: new Date(Number(createdAtEpoch) * 1000).toISOString(),
  }));
  return {
    visits,
    settings,
    filters: f,
    summary: summarizePerformance(visits, settings),
    technicians: [...technicians.values()].map((t) => ({
      ...t,
      ...summarizePerformance(
        visits.filter((v) => v.technicianId === t.technicianId),
        settings,
      ),
    })),
    audit,
  };
}

export async function writePerformance(pool, user, reportId, kind, raw) {
  if (user.role !== (kind === 'Customer feedback' ? 'Customer' : 'Admin'))
    throw new AppError('This action is not allowed for your role.', 403);
  const d = (
    kind === 'Customer feedback'
      ? feedbackSchema
      : kind === 'Quality assessment'
        ? qualitySchema
        : settingsSchema
  ).parse(raw);
  const hash = createHash('sha256')
    .update(JSON.stringify({ userId: user.id, reportId, kind, d }))
    .digest('hex');
  const c = await pool.getConnection();
  try {
    await c.beginTransaction();
    if (kind === 'Settings')
      await c.execute(
        'SELECT settings_id FROM performance_settings WHERE settings_id=1 FOR UPDATE',
      );
    else {
      const [[visit]] = await c.execute(
        `SELECT p.*,cu.user_id AS customerUserId FROM performance_visit p
        JOIN work_order w ON w.job_id=p.job_id JOIN booking b ON b.booking_id=w.booking_id
        JOIN customer cu ON cu.customer_id=b.customer_id WHERE p.report_id=? FOR UPDATE`,
        [reportId],
      );
      if (
        !visit ||
        (user.role === 'Customer' &&
          Number(visit.customerUserId) !== Number(user.id))
      )
        throw new AppError('Visit not found.', 404);
      if (!visit.actual_end)
        throw new AppError(
          'The service visit must be finished before it can be assessed.',
          409,
        );
      if (kind === 'Customer feedback' && visit.outcome !== 'Completed')
        throw new AppError(
          'Feedback is available after a completed service visit.',
          409,
        );
    }
    const [[oldOp]] = await c.execute(
      'SELECT payload_hash,result_json FROM performance_operation WHERE request_id=?',
      [d.requestId],
    );
    if (oldOp) {
      if (oldOp.payload_hash !== hash)
        throw new AppError(
          'This request was already used for a different update.',
          409,
        );
      await c.commit();
      return {
        ...(typeof oldOp.result_json === 'string'
          ? JSON.parse(oldOp.result_json)
          : oldOp.result_json),
        replayed: true,
      };
    }
    const table =
      kind === 'Customer feedback'
        ? 'performance_feedback'
        : kind === 'Quality assessment'
          ? 'performance_quality'
          : 'performance_settings';
    const [[before]] = await c.execute(
      `SELECT * FROM ${table} WHERE ${kind === 'Settings' ? 'settings_id=1' : 'report_id=?'}`,
      kind === 'Settings' ? [] : [reportId],
    );
    if ((before?.version ?? 0) !== d.expectedVersion)
      throw new AppError(
        'This assessment changed. Refresh before saving again.',
        409,
      );
    const version = d.expectedVersion + 1;
    if (kind === 'Customer feedback')
      await c.execute(
        `INSERT INTO performance_feedback(report_id,stars,comment,version,customer_user_id)
      VALUES(?,?,?,?,?) ON DUPLICATE KEY UPDATE stars=VALUES(stars),comment=VALUES(comment),version=VALUES(version),updated_at=CURRENT_TIMESTAMP`,
        [reportId, d.stars, d.comment, version, user.id],
      );
    else if (kind === 'Quality assessment')
      await c.execute(
        `INSERT INTO performance_quality(report_id,score,reason,version,admin_user_id)
      VALUES(?,?,?,?,?) ON DUPLICATE KEY UPDATE score=VALUES(score),reason=VALUES(reason),version=VALUES(version),admin_user_id=VALUES(admin_user_id),updated_at=CURRENT_TIMESTAMP`,
        [reportId, d.score, d.reason, version, user.id],
      );
    else
      await c.execute(
        `UPDATE performance_settings SET customer_weight=?,quality_weight=?,punctuality_weight=?,grace_minutes=?,version=? WHERE settings_id=1`,
        [
          d.customerWeight,
          d.qualityWeight,
          d.punctualityWeight,
          d.graceMinutes,
          version,
        ],
      );
    const { requestId, expectedVersion, ...value } = d,
      result = { success: true, version, replayed: false };
    await c.execute(
      `INSERT INTO performance_operation(request_id,actor_user_id,report_id,operation_kind,payload_hash,before_json,after_json,result_json)
      VALUES(?,?,?,?,?,?,?,?)`,
      [
        requestId,
        user.id,
        reportId,
        kind,
        hash,
        before ? JSON.stringify(before) : null,
        JSON.stringify({ ...value, version }),
        JSON.stringify(result),
      ],
    );
    await c.commit();
    return result;
  } catch (e) {
    await c.rollback();
    if (e.code === 'ER_DUP_ENTRY')
      throw new AppError(
        'This request was already used for another update. Refresh before saving.',
        409,
      );
    throw e;
  } finally {
    c.release();
  }
}

export function createPerformanceRouter(pool) {
  const router = express.Router();
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    next();
  });
  router.use(async (req, _res, next) => {
    req.performanceUser = await sessionUser(pool, req);
    next();
  });
  const role = (name) => (req, _res, next) => {
    if (req.performanceUser.role !== name)
      throw new AppError('This portal is not available for your account.', 403);
    next();
  };
  router.get('/customer/visits', role('Customer'), async (req, res) =>
    res.json(await listPerformance(pool, req.performanceUser, req.query)),
  );
  router.put(
    '/customer/visits/:reportId/feedback',
    role('Customer'),
    async (req, res) =>
      res.json(
        await writePerformance(
          pool,
          req.performanceUser,
          idSchema.parse(req.params.reportId),
          'Customer feedback',
          req.body,
        ),
      ),
  );
  router.get('/admin', role('Admin'), async (req, res) =>
    res.json(await listPerformance(pool, req.performanceUser, req.query)),
  );
  router.put(
    '/admin/visits/:reportId/quality',
    role('Admin'),
    async (req, res) =>
      res.json(
        await writePerformance(
          pool,
          req.performanceUser,
          idSchema.parse(req.params.reportId),
          'Quality assessment',
          req.body,
        ),
      ),
  );
  router.put('/admin/settings', role('Admin'), async (req, res) =>
    res.json(
      await writePerformance(
        pool,
        req.performanceUser,
        null,
        'Settings',
        req.body,
      ),
    ),
  );
  router.get('/technician', role('Technician'), async (req, res) =>
    res.json(await listPerformance(pool, req.performanceUser, req.query)),
  );
  return router;
}
