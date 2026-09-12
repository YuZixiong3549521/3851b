import { isWeekday, nextWeekday } from './booking-schedule';

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + 'T00:00:00Z');
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** Clamp from the original day each quarter, then roll later weekend visits to Monday. */
export function annualVisitDates(firstDate: string): string[] {
  if (!isCalendarDate(firstDate) || !isWeekday(firstDate)) return [];
  const [year, month, day] = firstDate.split('-').map(Number);
  // The fourth visit's exclusive quarterly window ends 12 months after the anchor.
  if (year + 1 > 9999) return [];
  const first = new Date(Date.UTC(year, month - 1, day));
  if (first.toISOString().slice(0, 10) !== firstDate) return [];
  return [0, 3, 6, 9].map(offset => {
    const targetMonth = month - 1 + offset;
    const lastDay = new Date(Date.UTC(year, targetMonth + 1, 0)).getUTCDate();
    const preferredDate = new Date(Date.UTC(year, targetMonth, Math.min(day, lastDay))).toISOString().slice(0, 10);
    return offset === 0 ? preferredDate : nextWeekday(preferredDate);
  });
}

export function annualVisitAmounts(totalAmount: number): number[] {
  const cents = Math.round(totalAmount * 100);
  const each = Math.floor(cents / 4);
  return [each, each, each, cents - each * 3].map(amount => amount / 100);
}

export function dayBeforeDate(value: string): string {
  return new Date(new Date(value.slice(0, 10) + 'T00:00:00Z').getTime() - 86400000).toISOString().slice(0, 10);
}

/** Do not present a partial receipt as a completed four-visit booking. */
export function assertBookingConfirmation(value: unknown, annualRequested: boolean): void {
  const error = () => { throw new Error('The saved booking details could not be fully verified. Retry confirmation to retrieve the same request.'); };
  const amount = (value: unknown) => (typeof value === 'number' || (typeof value === 'string' && value.trim().length > 0)) && Number.isFinite(Number(value)) && Number(value) >= 0;
  if (!value || typeof value !== 'object') return error();
  const booking = value as Record<string, unknown>;
  if (!Number.isInteger(Number(booking.bookingId ?? booking.id)) || Number(booking.bookingId ?? booking.id) < 1 || !amount(booking.totalAmount)) return error();
  if (!booking.annualBundle) { if (annualRequested) return error(); return; }
  const bundle = booking.annualBundle as Record<string, unknown>;
  const visits = bundle.visits;
  if (!Array.isArray(visits) || visits.length !== 4 || !amount(bundle.totalAmount)) return error();
  const ids = new Set();
  const positions = new Set();
  let cents = 0;
  for (const visit of visits) {
    if (!visit || !Number.isInteger(Number(visit.bookingId)) || Number(visit.bookingId) < 1 || ![1, 2, 3, 4].includes(Number(visit.visitNumber)) || !amount(visit.totalAmount) || !isCalendarDate(String(visit.preferredDate).slice(0, 10))) return error();
    ids.add(Number(visit.bookingId)); positions.add(Number(visit.visitNumber)); cents += Math.round(Number(visit.totalAmount) * 100);
  }
  if (ids.size !== 4 || positions.size !== 4 || cents !== Math.round(Number(bundle.totalAmount) * 100)) return error();
}
