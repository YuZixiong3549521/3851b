type ScheduledBooking = { preferredDate: string; timeSlot: string; status: string };

function arrivalMinutes(timeSlot: string) {
  const match = /^(\d{1,2}):(\d{2})(?:\s*(AM|PM))?/i.exec(timeSlot.trim());
  if (!match) return Number.POSITIVE_INFINITY;
  const hour = match[3] ? Number(match[1]) % 12 + (match[3].toUpperCase() === 'PM' ? 12 : 0) : Number(match[1]);
  return hour * 60 + Number(match[2]);
}

export function nextUpcomingBooking<T extends ScheduledBooking>(bookings: T[], today: string): T | undefined {
  return bookings.filter(booking => booking.preferredDate.slice(0, 10) >= today && !['Completed', 'Cancelled'].includes(booking.status))
    .sort((a, b) => a.preferredDate.slice(0, 10).localeCompare(b.preferredDate.slice(0, 10)) || arrivalMinutes(a.timeSlot) - arrivalMinutes(b.timeSlot))[0];
}
