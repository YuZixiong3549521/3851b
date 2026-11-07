import { buildReportAnalytics } from './report-periods.mjs';
import { withBookingReference } from './booking-reference.mjs';

const closed = new Set(['Cancelled', 'Rejected', 'Expired']);
export const ratingBand = stars => Number(stars) >= 4 ? 'positive' : Number(stars) === 3 ? 'neutral' : 'negative';
const periodKey = (date, grouping) => grouping === 'year' ? date.slice(0, 4)
  : grouping === 'quarter' ? `${date.slice(0, 4)}-Q${Math.ceil(Number(date.slice(5, 7)) / 3)}` : date;

// A customer counts once per period and once in the range total, even when they
// have several orders or four quarterly entitlements. Neither series is additive.
export function audiencePeriods(orders, registrations, reviews, filters) {
  const rows = buildReportAnalytics([], filters).periods.map(({ period, from, to, partial }) => ({
    period, from, to, partial, newCustomers: 0, bookingCustomers: 0, positive: 0, neutral: 0, negative: 0,
  }));
  const map = new Map(rows.map(row => [row.period, row])), customers = new Map();
  const inRange = date => date && date >= filters.from && date <= filters.to;
  for (const item of registrations) if (inRange(item.date)) map.get(periodKey(item.date, filters.groupBy)).newCustomers++;
  const all = new Set();
  for (const item of orders) {
    if (!inRange(item.serviceDate) || !item.customerId) continue;
    const key = periodKey(item.serviceDate, filters.groupBy), ids = customers.get(key) ?? new Set();
    ids.add(Number(item.customerId)); customers.set(key, ids); all.add(Number(item.customerId));
  }
  for (const [key, ids] of customers) map.get(key).bookingCustomers = ids.size;
  for (const review of reviews) if (inRange(review.date)) map.get(periodKey(review.date, filters.groupBy))[ratingBand(review.stars)]++;
  return { periods: rows, customers: { newInPeriod: rows.reduce((sum, r) => sum + r.newCustomers, 0), withBookings: all.size } };
}

export function annualVisitSummary(rows, selectedBookingIds) {
  const plans = new Map();
  for (const raw of rows) {
    const visit = withBookingReference(raw);
    let plan = plans.get(Number(visit.seriesId));
    if (!plan) {
      plan = { seriesId: Number(visit.seriesId), customerName: visit.customerName, address: visit.address,
        totalVisits: 4, recordedVisits: 0, completed: 0, awaiting: 0, closed: 0, selectedVisits: 0, visits: [] };
      plans.set(plan.seriesId, plan);
    }
    const category = visit.status === 'Completed' ? 'completed' : closed.has(visit.status) ? 'closed' : 'awaiting';
    const included = selectedBookingIds.has(Number(visit.bookingId));
    plan.recordedVisits++; plan[category]++; if (included) plan.selectedVisits++;
    plan.visits.push({ bookingId: Number(visit.bookingId), reference: visit.bookingReference,
      visitNumber: Number(visit.visitNumber), date: visit.date, status: visit.status, category, included });
  }
  return [...plans.values()];
}

export async function reportAudience(pool, orders, filters) {
  const start = Date.parse(filters.from + 'T00:00:00+08:00') / 1000;
  const end = Date.parse(filters.to + 'T00:00:00+08:00') / 1000 + 86400;
  const [registrations] = await pool.execute(`SELECT c.customer_id AS customerId,
    DATE_FORMAT(DATE_ADD('1970-01-01',INTERVAL (UNIX_TIMESTAMP(u.created_at)+28800) SECOND),'%Y-%m-%d') AS date
    FROM customer c JOIN user_account u ON u.user_id=c.user_id
    WHERE u.created_at>=FROM_UNIXTIME(?) AND u.created_at<FROM_UNIXTIME(?)`, [start, end]);
  // Latest feedback, assigned to its first recorded receipt. Legacy rows retain
  // their only available feedback timestamp, explicitly counted as a fallback.
  const received = `COALESCE((SELECT MIN(op.created_at) FROM performance_operation op
    WHERE op.report_id=f.report_id AND op.operation_kind='Customer feedback'),f.updated_at)`;
  const clauses = [], values = [start, end];
  if (filters.serviceId) {
    clauses.push('(b.service_id=? OR EXISTS(SELECT 1 FROM booking_service bs WHERE bs.booking_id=b.booking_id AND bs.service_id=?))');
    values.push(filters.serviceId, filters.serviceId);
  }
  if (filters.serviceGroup === 'annual') clauses.push('EXISTS(SELECT 1 FROM annual_booking_visit av WHERE av.booking_id=b.booking_id)');
  if (filters.technicianId) {
    clauses.push('(v.technician_id=? OR EXISTS(SELECT 1 FROM visit_member vm WHERE vm.report_id=v.report_id AND vm.technician_id=?))');
    values.push(filters.technicianId, filters.technicianId);
  }
  const [reviews] = await pool.execute(`SELECT f.report_id AS reportId,f.stars,
    DATE_FORMAT(DATE_ADD('1970-01-01',INTERVAL (UNIX_TIMESTAMP(${received})+28800) SECOND),'%Y-%m-%d') AS date,
    NOT EXISTS(SELECT 1 FROM performance_operation op WHERE op.report_id=f.report_id AND op.operation_kind='Customer feedback') AS fallbackDate
    FROM performance_feedback f JOIN performance_visit v ON v.report_id=f.report_id JOIN work_order w ON w.job_id=v.job_id
    JOIN booking b ON b.booking_id=w.booking_id
    WHERE ${received}>=FROM_UNIXTIME(?) AND ${received}<FROM_UNIXTIME(?)${clauses.length ? ' AND ' + clauses.join(' AND ') : ''}`, values);
  const byBand = { positive: 0, neutral: 0, negative: 0 };
  for (const review of reviews) byBand[ratingBand(review.stars)]++;
  const seriesIds = [...new Set(orders.filter(o => o.isAnnual && o.seriesId).map(o => Number(o.seriesId)))];
  let visits = [];
  // Bound placeholders even for a large selection; these rows only decorate
  // plans already present in the authorised report, without changing its totals.
  for (let i = 0; i < seriesIds.length; i += 250) {
    const chunk = seriesIds.slice(i, i + 250);
    const [rows] = await pool.execute(`SELECT s.series_id AS seriesId,u.full_name AS customerName,a.address_line AS address,
      av.visit_number AS visitNumber,b.booking_id AS bookingId,b.created_at AS bookingCreatedAt,
      b.preferred_service_date AS date,b.booking_status AS status
      FROM annual_booking_series s JOIN annual_booking_visit av ON av.series_id=s.series_id JOIN booking b ON b.booking_id=av.booking_id
      JOIN customer c ON c.customer_id=s.customer_id JOIN user_account u ON u.user_id=c.user_id JOIN service_address a ON a.address_id=s.address_id
      WHERE s.series_id IN (${chunk.map(() => '?').join(',')}) ORDER BY s.series_id,av.visit_number`, chunk);
    visits.push(...rows);
  }
  return { ...audiencePeriods(orders, registrations, reviews, filters),
    reviews: { ...byBand, total: reviews.length, average: reviews.length ? Math.round(reviews.reduce((sum, r) => sum + Number(r.stars), 0) / reviews.length * 100) / 100 : null,
      fallbackDates: reviews.filter(r => r.fallbackDate).length },
    annualPlans: annualVisitSummary(visits, new Set(orders.map(o => Number(o.bookingId)))) };
}
