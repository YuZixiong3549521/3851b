import {registerTechnicianPhotos} from './service-photo-upload.mjs';
import {
  storeSignature,
  validateReportSignatures,
} from './report-signatures.mjs';
import { createHash } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { AppError, idSchema } from './inventory.mjs';
import { lockTechnicianRoster } from './scheduling.mjs';
const hash = (value) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
const signature = z
  .string()
  .trim()
  .max(500)
  .default('')
  .refine(
    (v) =>
      !v ||
      /^https:\/\/[^\s]+$/i.test(v) ||
      /^\/api\/report-signatures\/[0-9a-f-]{36}$/.test(v),
    'Use an HTTPS signature image URL.',
  );
export const reportFormSchema = z
  .object({
    workPerformed: z.string().trim().min(5).max(5000),
    problemFound: z.string().trim().max(5000).default(''),
    solutionApplied: z.string().trim().max(5000).default(''),
    checklist: z.string().trim().min(3).max(5000),
    customerSignatureUrl: signature,
    technicianSignatureUrl: signature,
  })
  .strict();
const reportSelect = `SELECT r.report_id AS reportId,r.work_performed AS workPerformed,r.problem_found AS problemFound,r.solution_applied AS solutionApplied,r.checklist_result AS checklist,r.customer_signature_url AS customerSignatureUrl,r.technician_signature_url AS technicianSignatureUrl,r.submitted_time AS submittedAt,r.started_at AS startedAt,r.completed_at AS completedAt FROM service_report r WHERE r.job_id=?`;
async function ownedWork(c, userId, jobId, lock = false) {
  const [[row]] = await c.execute(
    `SELECT w.*,b.booking_status FROM work_order w JOIN booking b ON b.booking_id=w.booking_id JOIN assignment a ON a.assignment_id=w.assignment_id AND a.booking_id=w.booking_id JOIN technician t ON t.technician_id=a.technician_id JOIN user_account u ON u.user_id=t.user_id WHERE w.job_id=? AND t.user_id=? AND u.status='Active' AND a.assignment_status NOT IN ('Declined','Reassigned','Cancelled') ${lock ? 'FOR UPDATE' : ''}`,
    [jobId, userId],
  );
  if (!row) throw new AppError('Report not found for this technician.', 404);
  return row;
}
export async function getReport(c, userId, jobId) {
  const work = await ownedWork(c, userId, jobId);
  const [[report]] = await c.execute(reportSelect, [jobId]);
  const [history] = await c.execute(
    'SELECT version,changed_at AS changedAt,after_json AS content FROM service_report_revision WHERE job_id=? ORDER BY version DESC',
    [jobId],
  );
  return {
    jobId,
    status: work.current_status,
    report: report ?? null,
    version: hash(report ?? null),
    history: history.map((r) => ({
      ...r,
      content:
        typeof r.content === 'string' ? JSON.parse(r.content) : r.content,
    })),
  };
}
export async function saveReport(pool, userId, jobId, raw) {
  const d = z
    .object({
      requestId: z.uuid(),
      expectedVersion: z.string().length(64),
      report: reportFormSchema,
    })
    .strict()
    .parse(raw);
  const payloadHash = hash({ userId, jobId, ...d });
  const c = await pool.getConnection();
  try {
    await c.beginTransaction();
    const w = await ownedWork(c, userId, jobId, true);
    const [[previous]] = await c.execute(
      'SELECT payload_hash FROM service_report_revision WHERE request_id=?',
      [d.requestId],
    );
    if (previous) {
      if (previous.payload_hash !== payloadHash)
        throw new AppError(
          'This request ID was used for different report content.',
          409,
        );
      await c.commit();
      return { success: true, replayed: true };
    }
    if (!['In Progress', 'Completed'].includes(w.current_status))
      throw new AppError(
        'Start this service from My Jobs before submitting its report.',
        409,
      );
    const [[old]] = await c.execute(reportSelect, [jobId]);
    if (hash(old ?? null) !== d.expectedVersion)
      throw new AppError(
        'This report changed elsewhere. Reload it before editing.',
        409,
      );
    const [[revision]] = await c.execute(
      'SELECT COALESCE(MAX(version),0)+1 AS nextVersion FROM service_report_revision WHERE job_id=?',
      [jobId],
    );
    const r = d.report;
    await validateReportSignatures(c, userId, jobId, d.expectedVersion, old, r);
    await c.execute(
      `INSERT INTO service_report(job_id,work_performed,problem_found,solution_applied,checklist_result,customer_signature_url,technician_signature_url,submitted_time,completed_at) VALUES(?,?,?,?,?,?,?,CURRENT_TIMESTAMP,IF(?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 8 HOUR),NULL)) ON DUPLICATE KEY UPDATE work_performed=VALUES(work_performed),problem_found=VALUES(problem_found),solution_applied=VALUES(solution_applied),checklist_result=VALUES(checklist_result),customer_signature_url=VALUES(customer_signature_url),technician_signature_url=VALUES(technician_signature_url),submitted_time=COALESCE(submitted_time,VALUES(submitted_time)),completed_at=COALESCE(completed_at,VALUES(completed_at))`,
      [
        jobId,
        r.workPerformed,
        r.problemFound,
        r.solutionApplied,
        r.checklist,
        r.customerSignatureUrl || null,
        r.technicianSignatureUrl || null,
        w.current_status === 'In Progress',
      ],
    );
    if (w.current_status === 'In Progress') {
      await c.execute(
        "UPDATE work_order SET current_status='Completed' WHERE job_id=?",
        [jobId],
      );
      await c.execute(
        "UPDATE booking SET booking_status='Completed' WHERE booking_id=?",
        [w.booking_id],
      );
      await c.execute(
        "UPDATE assignment SET assignment_status='Completed' WHERE assignment_id=?",
        [w.assignment_id],
      );
      await c.execute(
        'INSERT INTO booking_status_history(booking_id,old_status,new_status,changed_by_user_id,change_note) VALUES (?,?,?,?,?)',
        [
          w.booking_id,
          w.booking_status,
          'Completed',
          userId,
          'Technician submitted the service report and completed the visit.',
        ],
      );
    }
    await c.execute(
      'INSERT INTO service_report_revision(request_id,job_id,actor_user_id,version,payload_hash,before_json,after_json) VALUES(?,?,?,?,?,?,?)',
      [
        d.requestId,
        jobId,
        userId,
        revision.nextVersion,
        payloadHash,
        old ? JSON.stringify(old) : null,
        JSON.stringify(r),
      ],
    );
    await c.commit();
    return { success: true, replayed: false };
  } catch (e) {
    await c.rollback();
    throw e;
  } finally {
    c.release();
  }
}
export async function getProfile(c, userId) {
  const [[p]] = await c.execute(
    `SELECT u.user_id AS userId,u.full_name AS fullName,u.email,u.phone,u.status,u.created_at AS memberSince,t.technician_id AS technicianId,t.availability_status AS availability,COALESCE(p.primary_region,'') AS primaryRegion FROM user_account u JOIN technician t ON t.user_id=u.user_id LEFT JOIN technician_portal_profile p ON p.technician_id=t.technician_id WHERE u.user_id=? AND u.status='Active'`,
    [userId],
  );
  if (!p) throw new AppError('Technician profile not found.', 404);
  return { ...p, version: hash(p) };
}
export const profileSchema = z
  .object({
    expectedVersion: z.string().length(64),
    fullName: z.string().trim().min(1).max(120),
    phone: z.string().trim().min(3).max(30),
    primaryRegion: z.string().trim().max(120),
    availability: z.enum(['Available', 'Busy', 'Unavailable', 'On Leave']),
  })
  .strict();
export async function saveProfile(pool, userId, raw) {
  const d = profileSchema.parse(raw),
    c = await pool.getConnection();
  try {
    await c.beginTransaction();
    await lockTechnicianRoster(c);
    await c.execute(
      'SELECT user_id FROM user_account WHERE user_id=? FOR UPDATE',
      [userId],
    );
    const old = await getProfile(c, userId);
    const same = ['fullName', 'phone', 'primaryRegion', 'availability'].every(
      (k) => d[k] === (old[k] ?? ''),
    );
    if (!same && d.expectedVersion !== old.version)
      throw new AppError(
        'Your profile changed elsewhere. Reload before saving.',
        409,
      );
    await c.execute(
      'UPDATE user_account SET full_name=?,phone=? WHERE user_id=?',
      [d.fullName, d.phone, userId],
    );
    await c.execute(
      'UPDATE technician SET availability_status=? WHERE technician_id=?',
      [d.availability, old.technicianId],
    );
    await c.execute(
      'INSERT INTO technician_portal_profile(technician_id,primary_region) VALUES(?,?) ON DUPLICATE KEY UPDATE primary_region=VALUES(primary_region)',
      [old.technicianId, d.primaryRegion],
    );
    const result = await getProfile(c, userId);
    await c.commit();
    return result;
  } catch (e) {
    await c.rollback();
    throw e;
  } finally {
    c.release();
  }
}
export const passwordSchema = z
  .object({
    currentPassword: z.string().min(1).max(72),
    newPassword: z
      .string()
      .min(8)
      .max(72)
      .refine(
        (v) => Buffer.byteLength(v, 'utf8') <= 72,
        'Password must be at most 72 UTF-8 bytes.',
      ),
    confirmPassword: z.string(),
  })
  .strict()
  .refine((d) => d.newPassword === d.confirmPassword, 'Passwords do not match.')
  .refine(
    (d) => d.newPassword !== d.currentPassword,
    'Choose a different password.',
  );
export async function changePassword(pool, userId, raw) {
  const d = passwordSchema.parse(raw);
  const [[old]] = await pool.execute(
    "SELECT password_hash FROM user_account WHERE user_id=? AND status='Active'",
    [userId],
  );
  if (!old || !(await bcrypt.compare(d.currentPassword, old.password_hash)))
    throw new AppError('Current password is incorrect.', 400);
  const next = await bcrypt.hash(d.newPassword, 12);
  const [result] = await pool.execute(
    "UPDATE user_account SET password_hash=? WHERE user_id=? AND password_hash=? AND status='Active'",
    [next, userId, old.password_hash],
  );
  if (!result.affectedRows)
    throw new AppError(
      'Your password changed elsewhere. Please sign in again.',
      409,
    );
  return { success: true };
}
export function registerTechnicianPages(router, pool) {
  registerTechnicianPhotos(router,pool);
  router.post(
    '/reports/:jobId/signatures/:signer',
    rateLimit({ windowMs: 15 * 60 * 1000, limit: 40 }),
    async (req, res) =>
      res
        .status(201)
        .json(
          await storeSignature(
            pool,
            req.technicianUser.id,
            idSchema.parse(req.params.jobId),
            req.params.signer,
            req.body,
          ),
        ),
  );
  router.get('/reports', async (req, res) => {
    const [rows] = await pool.execute(
      `SELECT w.job_id AS jobId,r.report_id AS reportId,u.full_name AS customer,DATE_FORMAT(w.appointment_date,'%Y-%m-%d') AS date,sc.service_name AS serviceType,w.current_status AS jobStatus,r.submitted_time AS submittedAt FROM work_order w JOIN assignment a ON a.assignment_id=w.assignment_id AND a.booking_id=w.booking_id JOIN technician t ON t.technician_id=a.technician_id JOIN booking b ON b.booking_id=w.booking_id JOIN customer cu ON cu.customer_id=b.customer_id JOIN user_account u ON u.user_id=cu.user_id JOIN service_catalog sc ON sc.service_id=b.service_id LEFT JOIN service_report r ON r.job_id=w.job_id WHERE t.user_id=? AND a.assignment_status NOT IN ('Declined','Reassigned','Cancelled') AND w.current_status IN ('In Progress','Completed') ORDER BY w.appointment_date DESC,w.job_id DESC`,
      [req.technicianUser.id],
    );
    res.json({ reports: rows });
  });
  router.get('/reports/:jobId', async (req, res) =>
    res.json(
      await getReport(
        pool,
        req.technicianUser.id,
        idSchema.parse(req.params.jobId),
      ),
    ),
  );
  router.put('/reports/:jobId', async (req, res) =>
    res.json(
      await saveReport(
        pool,
        req.technicianUser.id,
        idSchema.parse(req.params.jobId),
        req.body,
      ),
    ),
  );
  router.get('/profile', async (req, res) =>
    res.json(await getProfile(pool, req.technicianUser.id)),
  );
  router.patch('/profile', async (req, res) =>
    res.json(await saveProfile(pool, req.technicianUser.id, req.body)),
  );
  router.post(
    '/password',
    rateLimit({ windowMs: 15 * 60 * 1000, limit: 10 }),
    async (req, res) => {
      await changePassword(pool, req.technicianUser.id, req.body);
      res.json({ success: true });
    },
  );
}
