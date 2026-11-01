import { createHash } from 'node:crypto';
import { z } from 'zod';
import { AppError } from './inventory.mjs';

const schema = z.object({
  requestId: z.uuid(), expectedVersion: z.number().int().min(0).max(4294967294),
  feedbackVersion: z.number().int().positive(),
  status: z.enum(['Open', 'In progress', 'Resolved']),
  note: z.string().trim().min(5).max(1500),
}).strict();

export async function saveAdminReviewFollowUp(pool, user, reportId, raw) {
  if (user.role !== 'Admin') throw new AppError('Administrator access required.', 403);
  const data = schema.parse(raw);
  const payloadHash = createHash('sha256').update(JSON.stringify({ reportId, actor: user.id, ...data })).digest('hex');
  const c = await pool.getConnection();
  try {
    await c.beginTransaction();
    const [[feedback]] = await c.execute('SELECT * FROM performance_feedback WHERE report_id=? FOR UPDATE', [reportId]);
    if (!feedback) throw new AppError('Customer review not found.', 404);
    const [[event]] = await c.execute('SELECT * FROM admin_review_follow_up_event WHERE request_id=?', [data.requestId]);
    if (event) {
      if (event.payload_hash !== payloadHash) throw new AppError('This request was used for a different follow-up.', 409);
      await c.commit();
      return { ...(typeof event.result_json === 'string' ? JSON.parse(event.result_json) : event.result_json), replayed: true };
    }
    if (feedback.version !== data.feedbackVersion) throw new AppError('The customer review changed. Reload before saving your follow-up.', 409);
    const [[before]] = await c.execute('SELECT * FROM admin_review_follow_up WHERE report_id=? FOR UPDATE', [reportId]);
    if ((before?.version ?? 0) !== data.expectedVersion) throw new AppError('Another administrator updated this follow-up. Reload before saving.', 409);
    const result = { reportId, status: data.status, note: data.note, feedbackVersion: data.feedbackVersion, version: data.expectedVersion + 1 };
    await c.execute(`INSERT INTO admin_review_follow_up(report_id,status,note,feedback_version,version,updated_by)
      VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE status=VALUES(status),note=VALUES(note),feedback_version=VALUES(feedback_version),version=VALUES(version),updated_by=VALUES(updated_by)`,
      [reportId, result.status, result.note, result.feedbackVersion, result.version, user.id]);
    await c.execute('INSERT INTO admin_review_follow_up_event(request_id,report_id,actor_user_id,payload_hash,before_json,after_json,result_json) VALUES (?,?,?,?,?,?,?)',
      [data.requestId, reportId, user.id, payloadHash, before ? JSON.stringify(before) : null, JSON.stringify(result), JSON.stringify(result)]);
    await c.commit();
    return result;
  } catch (error) {
    await c.rollback();
    if (error.code === 'ER_DUP_ENTRY') throw new AppError('This request was used for a different follow-up. Reload before saving.', 409);
    throw error;
  }
  finally { c.release(); }
}
