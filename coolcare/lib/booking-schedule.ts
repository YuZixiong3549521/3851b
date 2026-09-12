export const bookingScheduleNotice = 'Choose Monday to Friday, at least 14 calendar days ahead in Singapore time. Weekend appointments are unavailable.';

function calendarDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : null;
}

export function singaporeToday(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-SG', { timeZone: 'Asia/Singapore', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const value = (name: string) => parts.find(part => part.type === name)!.value;
  return value('year') + '-' + value('month') + '-' + value('day');
}

export function minimumBookingDate(now: Date = new Date()): string {
  const date = calendarDate(singaporeToday(now))!;
  date.setUTCDate(date.getUTCDate() + 14);
  return date.toISOString().slice(0, 10);
}

export function isWeekday(value: string): boolean {
  const date = calendarDate(value);
  return Boolean(date && date.getUTCDay() !== 0 && date.getUTCDay() !== 6);
}

export function nextWeekday(value: string): string {
  const date = calendarDate(value);
  if (!date) return '';
  const day = date.getUTCDay();
  date.setUTCDate(date.getUTCDate() + (day === 6 ? 2 : day === 0 ? 1 : 0));
  return date.getUTCFullYear() > 9999 ? '' : date.toISOString().slice(0, 10);
}

export function earliestBookingDate(now: Date = new Date()): string {
  return nextWeekday(minimumBookingDate(now));
}

export function bookingDateError(value: string, now: Date = new Date()): string {
  if (!calendarDate(value)) return 'Choose a valid preferred service date.';
  if (value < minimumBookingDate(now)) return 'Choose a weekday on or after ' + earliestBookingDate(now) + ' (at least 14 calendar days ahead, Singapore time).';
  if (!isWeekday(value)) return 'Weekend appointments are unavailable. Choose Monday to Friday.';
  return '';
}
