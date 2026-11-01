import { createHash } from 'node:crypto';
import { z } from 'zod';
import { AppError, idSchema } from './inventory.mjs';
import { getAdminAnnualPlan } from './customer/plans.mjs';
import { describePlanReminder } from '../lib/admin-plan-reminders.mjs';

const schema = z
  .object({
    requestId: z.uuid(),
    reminderKey: z.string().min(1).max(120),
    channel: z.enum(['Phone', 'Email', 'Other']),
    note: z.string().trim().min(5).max(1500),
  })
  .strict();

// Records contact already made by an administrator. It never sends an email.
export async function recordPlanReminder(pool, user, rawSeriesId, raw) {
  if (user.role !== 'Admin')
    throw new AppError('Administrator access required.', 403);
  const seriesId = idSchema.parse(rawSeriesId),
    data = schema.parse(raw);
  const hash = createHash('sha256')
    .update(JSON.stringify({ seriesId, actor: user.id, ...data }))
    .digest('hex');
  const c = await pool.getConnection();
  let transactionStarted = false;
  try {
    // Receipts are immutable: a lost response can be recovered even while the
    // technician is updating the plan's work or after the plan has closed.
    const [[saved]] = await c.execute(
      'SELECT reminder_id,payload_hash FROM admin_plan_reminder WHERE request_id=?',
      [data.requestId],
    );
    if (saved) {
      if (saved.payload_hash !== hash)
        throw new AppError(
          'This request was used for a different contact record.',
          409,
        );
      return { reminderId: saved.reminder_id, seriesId, replayed: true };
    }
    const [[identity]] = await c.execute(
      'SELECT customer_id FROM annual_booking_series WHERE series_id=?',
      [seriesId],
    );
    if (!identity) throw new AppError('Annual plan not found.', 404);
    await c.beginTransaction();
    transactionStarted = true;
    // Renewal and Admin rescheduling take this same mutable customer lock.
    await c.execute(
      'SELECT customer_id FROM customer WHERE customer_id=? FOR UPDATE',
      [identity.customer_id],
    );
    const [[series]] = await c.execute(
      'SELECT series_id FROM annual_booking_series WHERE series_id=? FOR SHARE',
      [seriesId],
    );
    if (!series) throw new AppError('Annual plan not found.', 404);
    // Hold the visit dates stable while checking the reviewed renewal deadline.
    try {
      await c.execute(
        'SELECT b.booking_id FROM booking b JOIN annual_booking_visit v ON v.booking_id=b.booking_id WHERE v.series_id=? ORDER BY b.booking_id FOR SHARE NOWAIT',
        [seriesId],
      );
    } catch (error) {
      if (error.code === 'ER_LOCK_NOWAIT')
        throw new AppError(
          'A service or schedule update is in progress. Reload before recording contact.',
          409,
        );
      throw error;
    }
    const [[event]] = await c.execute(
      'SELECT reminder_id,payload_hash FROM admin_plan_reminder WHERE request_id=?',
      [data.requestId],
    );
    if (event) {
      if (event.payload_hash !== hash)
        throw new AppError(
          'This request was used for a different contact record.',
          409,
        );
      await c.commit();
      return { reminderId: event.reminder_id, seriesId, replayed: true };
    }
    const plan = await getAdminAnnualPlan(c, seriesId);
    const reminder = describePlanReminder(plan);
    if (!reminder.available || reminder.key !== data.reminderKey)
      throw new AppError(
        'The plan or renewal deadline changed. Reload before recording contact.',
        409,
      );
    const [inserted] = await c.execute(
      'INSERT INTO admin_plan_reminder(request_id,series_id,actor_user_id,reminder_key,channel,note,payload_hash) VALUES (?,?,?,?,?,?,?)',
      [
        data.requestId,
        seriesId,
        user.id,
        data.reminderKey,
        data.channel,
        data.note,
        hash,
      ],
    );
    await c.commit();
    return { reminderId: inserted.insertId, seriesId };
  } catch (error) {
    if (transactionStarted) await c.rollback();
    if (error.code === 'ER_DUP_ENTRY')
      throw new AppError(
        'This request was used for a different contact record. Reload before saving.',
        409,
      );
    throw error;
  } finally {
    c.release();
  }
}
