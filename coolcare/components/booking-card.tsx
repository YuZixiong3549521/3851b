import Link from 'next/link';
import { CalendarDays, Clock3, MapPin, UserRound, Wind } from 'lucide-react';
import { BookingStatus, bookingStatusDescription } from '@/components/booking-status';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDate, formatMoney, formatTimeSlot } from '@/lib/format';
import type { Booking } from '@/lib/coolcare-types';

export function BookingCard({ booking, history = false, showActions = true }: { booking: Booking; history?: boolean; showActions?: boolean }) {
  const detailsUrl = `/customer/bookings/${booking.bookingId}`;
  const quantity = booking.numberOfUnits ?? booking.units.length;
  return <Card className="overflow-hidden border-border/80 shadow-sm">
    <CardHeader className="border-b border-border/70 bg-muted/30 sm:flex-row sm:items-start sm:justify-between sm:space-y-0">
      <div><p className="font-mono text-xs font-semibold text-muted-foreground">{booking.bookingReference}</p><CardTitle className="mt-1.5 text-xl">{booking.annualBundle?.name ?? booking.serviceName}</CardTitle>{booking.annualBundle && <p className="mt-2 text-sm font-semibold text-primary">Visit {booking.annualBundle.visitNumber} of 4 · Quarterly cleaning</p>}</div>
      <BookingStatus status={booking.status} />
    </CardHeader>
    <CardContent className="p-5 sm:p-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Info icon={CalendarDays} label="Service date" value={formatDate(booking.preferredDate)} />
        <Info icon={Clock3} label="Preferred time" value={formatTimeSlot(booking.timeSlot)} />
        <Info icon={MapPin} label="Address" value={`${booking.addressLine}${booking.postalCode ? `, ${booking.postalCode}` : ''}`} />
        <Info icon={Wind} label="Air conditioners" value={quantity ? `${quantity} AC ${quantity === 1 ? 'unit' : 'units'}` : 'Quantity not recorded'} />
      </div>
      {booking.technicianName && <div className="mt-5 rounded-xl bg-secondary/8 p-4"><Info icon={UserRound} label="Assigned technician" value={booking.technicianName} /></div>}
      <p className="mt-4 text-sm leading-6 text-muted-foreground">{bookingStatusDescription(booking.status)}</p>
      {booking.status === 'Rejected' && booking.rejectionReason && <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-950"><p className="font-semibold">Reason from the service team</p><p className="mt-1 whitespace-pre-wrap break-words leading-6">{booking.rejectionReason}</p></div>}
      <div className="mt-5 flex flex-wrap items-center justify-between gap-4 border-t border-border/70 pt-5">
        <div><p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{booking.annualBundle ? 'This visit estimate' : history ? 'Recorded amount' : 'Visit estimate'}</p><p className="mt-1 text-lg font-bold">{booking.totalAmount == null ? 'To be confirmed' : formatMoney(booking.totalAmount)}</p>{booking.annualBundle && <p className="mt-1 text-xs text-muted-foreground">{formatMoney(booking.annualBundle.totalAmount)} for all four visits · Pay after each service</p>}</div>
        {showActions && <div className="flex flex-wrap gap-2">
          <Button nativeButton={false} render={<Link href={detailsUrl} />} variant="outline">View details</Button>
          {booking.canModify && !history && <><Button nativeButton={false} render={<Link href={`${detailsUrl}?action=reschedule`} />} variant="outline">Reschedule</Button><Button nativeButton={false} render={<Link href={`${detailsUrl}?action=cancel`} />} variant="ghost" className="text-destructive">Cancel booking</Button></>}
          {history && booking.reportId && <Button nativeButton={false} render={<Link href={`/customer/history/${booking.bookingId}`} />}>View service report</Button>}
        </div>}
      </div>
    </CardContent>
  </Card>;
}

function Info({ icon: Icon, label, value }: { icon: typeof CalendarDays; label: string; value: string }) {
  return <div className="flex min-w-0 gap-3"><Icon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" /><div className="min-w-0"><p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</p><p className="mt-1 break-words text-sm font-medium leading-5">{value}</p></div></div>;
}
