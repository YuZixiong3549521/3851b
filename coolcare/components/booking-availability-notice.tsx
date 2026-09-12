'use client';

import { Button } from '@/components/ui/button';
import { formatDate } from '@/lib/format';
import type { BookingAvailabilityState } from '@/lib/use-booking-availability';

export const bookingConflictMessage = 'This address already has two bookings within a 7-day period. Choose another available date to avoid a duplicate visit.';

export function BookingAvailabilityNotice({ availability }: { availability: BookingAvailabilityState }) {
  const { checking, error, existingBookings, selectedDateBlocked, refresh } = availability;
  if (checking) return <p role="status" className="mt-3 text-xs text-muted-foreground">Checking existing bookings at this address…</p>;
  if (error) return <div role="status" className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"><p>We could not check existing bookings. Your dates will be checked again when you confirm.</p><Button type="button" variant="link" size="sm" className="h-auto px-0 text-amber-900" onClick={refresh}>Check again</Button></div>;
  return <div className="mt-3 space-y-2 text-xs">
    {selectedDateBlocked && <p role="alert" className="rounded-xl bg-red-50 p-3 text-red-800">{bookingConflictMessage}</p>}
    {existingBookings.length > 0 && <details className="rounded-xl border border-primary/15 bg-primary/5 p-3"><summary className="cursor-pointer font-medium">{existingBookings.length} existing {existingBookings.length === 1 ? 'booking' : 'bookings'} near this month at this address</summary><ul className="mt-2 space-y-2">{existingBookings.map(booking => <li key={booking.bookingId}><strong>{formatDate(booking.preferredDate)}</strong> · {booking.timeSlot}<span className="block text-muted-foreground">Booking #{booking.bookingId} · {booking.status}</span></li>)}</ul><p className="mt-2 leading-5 text-muted-foreground">Up to two bookings are allowed at the same address in any 7-day period. Dates exceeding this limit are unavailable.</p></details>}
  </div>;
}
