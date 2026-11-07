import { z } from 'zod';
import { AppError, idSchema } from './inventory.mjs';
import { parseBookingSearch, withBookingReference } from './booking-reference.mjs';
import { isCalendarDate } from './customer/booking-schedule.mjs';
import { auditActions, auditCategories, auditCategoryFor } from '../lib/admin-audit-filters.mjs';

const day = z.string().refine(isCalendarDate, 'Choose a valid calendar date.');
const scalar = z.union([z.string(), z.number()]);
export const auditQuery = z.object({
  page: scalar.pipe(z.coerce.number().int().min(1).max(100000)).default(1),
  pageSize: scalar.pipe(z.coerce.number().int().min(1).max(100)).default(25),
  bookingId: z.union([z.string(), z.number()]).transform(parseBookingSearch).refine(Boolean, 'Enter a valid booking reference or ID.').optional(),
  category: z.enum(['', ...auditCategories.map(category => category.value)]).default(''),
  action: z.enum(['', ...auditActions]).default(''),
  actorId: scalar.pipe(idSchema).optional(),
  from: day.optional(), to: day.optional(),
  q: z.string().trim().max(120).default(''),
  sort: z.enum(['newest', 'oldest']).default('newest'),
}).strict().refine(value => !value.from || !value.to || value.from <= value.to, 'The end date must not precede the start date.')
  .refine(value => !value.category || !value.action || auditCategories.find(category => category.value === value.category).actions.includes(value.action), 'Choose an action in the selected category.');

export function auditDateBoundary(date, nextDay = false) {
  return Math.floor(Date.parse(`${date}T00:00:00+08:00`) / 1000) + (nextDay ? 86400 : 0);
}

const escapedLike = value => '%' + value.replace(/[!%_]/g, character => '!' + character) + '%';
export function auditSqlFilters(data) {
  const where = [], values = [];
  if (data.bookingId) {
    where.push('o.booking_id=?'); values.push(data.bookingId.id);
    if (data.bookingId.year !== null) { where.push('YEAR(b.created_at)=?'); values.push(data.bookingId.year); }
  }
  if (data.action) { where.push('o.operation_type=?'); values.push(data.action); }
  else if (data.category) {
    const actions = auditCategories.find(category => category.value === data.category).actions;
    where.push(`o.operation_type IN (${actions.map(() => '?').join(',')})`); values.push(...actions);
  }
  if (data.actorId) { where.push('o.actor_user_id=?'); values.push(data.actorId); }
  if (data.from) { where.push('o.created_at>=FROM_UNIXTIME(?)'); values.push(auditDateBoundary(data.from)); }
  if (data.to) { where.push('o.created_at<FROM_UNIXTIME(?)'); values.push(auditDateBoundary(data.to, true)); }
  if (data.q) {
    where.push("(u.full_name LIKE ? ESCAPE '!' OR cu.full_name LIKE ? ESCAPE '!' OR cu.email LIKE ? ESCAPE '!' OR CAST(o.result_json AS CHAR) LIKE ? ESCAPE '!' OR o.request_id LIKE ? ESCAPE '!')");
    values.push(...Array(5).fill(escapedLike(data.q)));
  }
  return { clause: where.length ? ` WHERE ${where.join(' AND ')}` : '', values };
}

// Return only the known business outcome fields, never payload hashes or arbitrary
// future JSON keys. These are stored results, not reconstructed before/after data.
export function auditOutcome(raw) {
  let value = raw;
  if (typeof value === 'string') { try { value = JSON.parse(value); } catch { return []; } }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const fields = [
    ['status', 'Recorded status'], ['reason', 'Recorded reason'], ['preferredDate', 'New appointment date'],
    ['timeSlot', 'New appointment time'], ['travelBufferMinutes', 'Travel buffer (minutes)'],
    ['trafficNote', 'Travel note'], ['estimatedDurationMinutes', 'Planned duration (minutes)'],
    ['returnedPoints', 'Points returned'], ['assignmentId', 'Assignment ID'], ['jobId', 'Work order ID'],
    ['emailId', 'Email record ID'], ['version', 'Rejection version'],
  ];
  const result = fields.filter(([key]) => ['string', 'number'].includes(typeof value[key]))
    .map(([key, label]) => ({ label, value: String(value[key]) }));
  if (typeof value.queued === 'boolean') result.push({ label: 'Waiting dispatch', value: value.queued ? 'Yes' : 'No' });
  const team = Array.isArray(value.technicians) ? value.technicians : value.technician ? [value.technician] : [];
  const names = team.filter(member => member && typeof member.fullName === 'string')
    .map(member => member.fullName + (member.isLead ? ' (Lead)' : ''));
  if (names.length) result.push({ label: 'Assigned team', value: names.join(', ') });
  return result;
}

const joins = `FROM booking_admin_operation o JOIN booking b ON b.booking_id=o.booking_id
  JOIN user_account u ON u.user_id=o.actor_user_id JOIN role r ON r.role_id=u.role_id
  LEFT JOIN admin_profile ap ON ap.user_id=u.user_id
  JOIN customer c ON c.customer_id=b.customer_id JOIN user_account cu ON cu.user_id=c.user_id`;

export async function listAdminAudit(pool, query, { exportAll = false } = {}) {
  const data = auditQuery.parse(query), { clause, values } = auditSqlFilters(data);
  const [[{ total }]] = await pool.execute(`SELECT COUNT(*) AS total ${joins}${clause}`, values);
  if (exportAll && Number(total) > 10000) throw new AppError('More than 10,000 operations match. Narrow the filters before exporting.', 400);
  const page = Math.min(data.page, Math.max(1, Math.ceil(Number(total) / data.pageSize)));
  const direction = data.sort === 'oldest' ? 'ASC' : 'DESC';
  const [rows] = await pool.execute(`SELECT o.request_id AS requestId,o.booking_id AS bookingId,
    b.created_at AS bookingCreatedAt,o.operation_type AS action,UNIX_TIMESTAMP(o.created_at) AS createdAtEpoch,
    o.actor_user_id AS actorId,u.full_name AS actor,r.role_name AS actorRole,ap.access_level AS actorAccessLevel,
    cu.full_name AS customerName,cu.email AS customerEmail,o.result_json AS result
    ${joins}${clause} ORDER BY o.created_at ${direction},o.operation_id ${direction} LIMIT ? OFFSET ?`,
    [...values, exportAll ? 10000 : data.pageSize, exportAll ? 0 : (page - 1) * data.pageSize]);
  const [actors] = await pool.query(`SELECT DISTINCT u.user_id AS id,u.full_name AS name,u.status,
    r.role_name AS role,ap.access_level AS accessLevel FROM booking_admin_operation o
    JOIN user_account u ON u.user_id=o.actor_user_id JOIN role r ON r.role_id=u.role_id
    LEFT JOIN admin_profile ap ON ap.user_id=u.user_id ORDER BY u.full_name,u.user_id`);
  return {
    rows: rows.map(({ createdAtEpoch, result, ...row }) => withBookingReference({ ...row,
      createdAt: new Date(Number(createdAtEpoch) * 1000).toISOString(), category: auditCategoryFor(row.action), outcome: auditOutcome(result),
    })),
    total: Number(total), page, pageSize: data.pageSize, actors,
  };
}
