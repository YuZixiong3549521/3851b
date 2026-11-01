import { addCalendarDays, singaporeToday } from './customer/booking-schedule.mjs';

export const reviewOverdueCondition = (alias = 'b') => `${alias}.booking_status='Submitted' AND (${alias}.expires_at IS NULL OR ${alias}.expires_at>UTC_TIMESTAMP()) AND UNIX_TIMESTAMP(${alias}.created_at)<=UNIX_TIMESTAMP()-86400`;

export function operationsQueueFilter(queue, today = singaporeToday()) {
  if (queue === 'overdue-review') return { sql: reviewOverdueCondition(), values: [] };
  if (queue === 'today') return { sql: "b.preferred_service_date=? AND b.booking_status NOT IN ('Cancelled','Expired','Rejected')", values: [today] };
  if (queue === 'active') return { sql: "b.booking_status IN ('On The Way','In Progress','Return visit')", values: [] };
  if (queue === 'completed-week') {
    const start = addCalendarDays(today, -((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7));
    return { sql: "b.booking_status='Completed' AND b.preferred_service_date BETWEEN ? AND ?", values: [start, addCalendarDays(start, 6)] };
  }
  return null;
}
