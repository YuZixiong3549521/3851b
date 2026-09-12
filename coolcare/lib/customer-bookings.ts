type ScheduledBooking = { preferredDate: string; timeSlot: string; status: string; bookingId?: number };

export function isActiveBooking(booking: { status: string }) {
  return !['completed', 'cancelled', 'canceled'].includes(booking.status.trim().toLowerCase());
}

function appointmentStart(booking: ScheduledBooking): number {
  const date = booking.preferredDate.slice(0, 10);
  const calendar = new Date(date + 'T00:00:00Z');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(calendar.getTime()) || calendar.toISOString().slice(0, 10) !== date) return NaN;
  const match = /^(\d{1,2}):(\d{2})\s*(AM|PM)?(?=\s|[-–—]|$)/i.exec(booking.timeSlot.trim());
  if (!match) return NaN;
  const rawHour = Number(match[1]);
  const minute = Number(match[2]);
  if (minute > 59 || (match[3] ? rawHour < 1 || rawHour > 12 : rawHour > 23)) return NaN;
  const hour = match[3] ? rawHour % 12 + (match[3].toUpperCase() === 'PM' ? 12 : 0) : rawHour;
  // Appointment windows are Singapore local time, independently of the browser's timezone.
  return new Date(`${date}T${String(hour).padStart(2, '0')}:${match[2]}:00+08:00`).getTime();
}

/** Active appointments whose preferred arrival window has not started, nearest first. */
export function upcomingBookings<T extends ScheduledBooking>(bookings: T[], now: Date | string = new Date()): T[] {
  // Retain the previous date-only call contract: that date starts at Singapore midnight.
  const reference = typeof now === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(now)
    ? new Date(now + 'T00:00:00+08:00').getTime()
    : new Date(now).getTime();
  if (!Number.isFinite(reference)) return [];
  return bookings.filter(isActiveBooking).map(booking => ({ booking, start: appointmentStart(booking) }))
    .filter(({ start }) => Number.isFinite(start) && start >= reference)
    .sort((a, b) => a.start - b.start || (a.booking.bookingId ?? 0) - (b.booking.bookingId ?? 0))
    .map(({ booking }) => booking);
}

export function nextUpcomingBooking<T extends ScheduledBooking>(bookings: T[], now: Date | string = new Date()): T | undefined {
  return upcomingBookings(bookings, now)[0];
}

/** Chronological order for the active list, including unfinished past appointments. */
export function sortBookingsByService<T extends ScheduledBooking>(bookings: T[]): T[] {
  return [...bookings].sort((a, b) => {
    const first = appointmentStart(a);
    const second = appointmentStart(b);
    const firstValid = Number.isFinite(first);
    const secondValid = Number.isFinite(second);
    if (firstValid !== secondValid) return firstValid ? -1 : 1;
    if (firstValid && first !== second) return first - second;
    return a.preferredDate.localeCompare(b.preferredDate) || (a.bookingId ?? 0) - (b.bookingId ?? 0);
  });
}

/** Group only visits from the same purchased annual series, retaining chronological group order. */
export function groupCustomerBookings<T extends ScheduledBooking & { annualBundle?: { seriesId: number } | null }>(bookings: T[]) {
  const groups = new Map<string, { key: string; annual: boolean; bookings: T[] }>();
  for (const booking of sortBookingsByService(bookings)) {
    const key = booking.annualBundle ? `annual-${booking.annualBundle.seriesId}` : `booking-${booking.bookingId}`;
    const group = groups.get(key) ?? { key, annual: Boolean(booking.annualBundle), bookings: [] };
    group.bookings.push(booking);
    groups.set(key, group);
  }
  return [...groups.values()];
}
