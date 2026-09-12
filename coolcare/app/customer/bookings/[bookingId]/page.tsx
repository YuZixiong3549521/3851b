'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, CalendarDays, Mail, RefreshCw } from 'lucide-react';
import { CoolCareShell } from '@/components/coolcare-shell';
import { BookingCard } from '@/components/booking-card';
import { AnnualBookingSummary } from '@/components/annual-booking-summary';
import { bookingStatusLabel } from '@/components/booking-status';
import { BookingAvailabilityNotice, bookingConflictMessage } from '@/components/booking-availability-notice';
import { EnglishDatePicker } from '@/components/english-date-picker';
import { PageError, PageLoading } from '@/components/page-state';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { coolcareApi } from '@/lib/coolcare-api';
import { bookingDateError, earliestBookingDate } from '@/lib/booking-schedule';
import { dayBeforeDate } from '@/lib/annual-booking';
import { formatDate, formatDateTime, formatTimeSlot } from '@/lib/format';
import { useBookingClock } from '@/lib/use-booking-clock';
import { useCustomerResource } from '@/lib/use-customer-resource';
import { useBookingAvailability } from '@/lib/use-booking-availability';
import { bookingSupportLink, customerSupportEmail } from '@/lib/customer-support';
import type { BookingDetail } from '@/lib/coolcare-types';

type Action = 'cancel' | 'reschedule';
type PendingChange = { action: Action; date: string; time: string };
const slots = ['09:00 - 11:00', '11:00 - 13:00', '14:00 - 16:00', '16:00 - 18:00'];

export default function BookingDetailsPage() {
  const { bookingId: routeId } = useParams<{ bookingId: string }>();
  return <BookingDetailsContent key={routeId} bookingId={Number(routeId)} />;
}

function BookingDetailsContent({ bookingId }: { bookingId: number }) {
  const load = useCallback(() => Number.isSafeInteger(bookingId) && bookingId > 0 ? coolcareApi.getBooking(bookingId) : Promise.reject(new Error('Invalid booking identifier.')), [bookingId]);
  const { data: resourceBooking, error, refreshing, refresh } = useCustomerResource(load);
  const booking = resourceBooking?.bookingId === bookingId ? resourceBooking : null;
  const [action, setAction] = useState<Action | null>(null);
  const [date, setDate] = useState('');
  const [time, setTime] = useState(slots[0]);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const [success, setSuccess] = useState('');
  const [pending, setPending] = useState<PendingChange | null>(null);
  const initialized = useRef(false);
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const now = useBookingClock();
  const minimum = [earliestBookingDate(now), booking?.annualBundle?.windowStart ?? ''].sort().at(-1)!;
  const maximum = booking?.annualBundle?.windowEnd ? dayBeforeDate(booking.annualBundle.windowEnd) : undefined;
  const availability = useBookingAvailability({ serviceAddress: booking?.addressLine, addressId: booking?.addressId, selectedDate: date, excludeBookingId: bookingId, enabled: action === 'reschedule' });
  const dateError = date ? bookingDateError(date, now) || (date < minimum || (maximum && date > maximum) ? 'Choose a date inside this quarterly visit window.' : '') : '';

  const openAction = useCallback((nextAction: Action, current: BookingDetail) => {
    if (current.bookingId !== bookingId || !current.canModify) return;
    setAction(nextAction); setActionError('');
    setDate(current.preferredDate < earliestBookingDate() ? earliestBookingDate() : current.preferredDate);
    setTime(slots.find(slot => formatTimeSlot(slot) === formatTimeSlot(current.timeSlot)) ?? current.timeSlot);
  }, [bookingId]);
  useEffect(() => { initialized.current = false; setAction(null); setPending(null); setSuccess(''); }, [bookingId]);
  useEffect(() => {
    if (!booking || initialized.current) return;
    initialized.current = true;
    const url = new URL(window.location.href);
    const requested = url.searchParams.get('action');
    if (requested === 'cancel' || requested === 'reschedule') {
      // The card action is consumed once; reloading must not reopen a saved edit.
      url.searchParams.delete('action');
      window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
      if (booking.canModify) openAction(requested, booking);
    }
  }, [booking, openAction]);

  async function submitChange() {
    if (!booking || booking.bookingId !== bookingId || !action || busy || !mounted.current) return;
    if (!pending && action === 'reschedule' && (dateError || !date || !time || availability.selectedDateBlocked)) {
      setActionError(dateError || (availability.selectedDateBlocked ? bookingConflictMessage : 'Choose a new date and time.')); return;
    }
    const change = pending ?? { action, date, time };
    setBusy(true); setActionError('');
    try {
      if (change.action === 'cancel') await coolcareApi.updateBookingStatus(bookingId, 'Cancelled');
      else await coolcareApi.rescheduleBooking(bookingId, { preferredDate: change.date, timeWindow: change.time });
      if (!mounted.current) return;
      setPending(null); setAction(null);
      setSuccess(change.action === 'cancel' ? 'This visit has been cancelled. It is now in Booking History.' : `Your visit was moved to ${formatDate(change.date)}, ${formatTimeSlot(change.time)}.`);
      await refresh();
    } catch (reason) {
      if (!mounted.current) return;
      const status = (reason as { status?: number })?.status;
      const uncertain = !status || status >= 500;
      if (uncertain) {
        setPending(change);
        setActionError('We could not confirm the update. Retry the same change to check its result; your selections are locked until it is confirmed.');
      } else {
        setPending(null);
        setActionError(reason instanceof Error ? reason.message : 'Unable to update this booking.');
        availability.refresh();
        await refresh();
      }
    } finally { if (mounted.current) setBusy(false); }
  }

  return <CoolCareShell><div className="mx-auto max-w-5xl px-5 py-7 sm:px-8 lg:px-10">
    <Button nativeButton={false} render={<Link href={booking && ['Completed', 'Cancelled'].includes(booking.status) ? '/customer/history' : '/customer/bookings'} />} variant="ghost" className="mb-4 -ml-3"><ArrowLeft className="size-4" />Back to bookings</Button>
    <div className="mb-5 flex items-center justify-between gap-3"><h1 className="text-2xl font-bold sm:text-3xl">Booking details</h1><Button size="sm" variant="ghost" onClick={() => void refresh()} disabled={refreshing}><RefreshCw className={`size-4 ${refreshing ? 'animate-spin' : ''}`} />Refresh</Button></div>
    {!booking && !error && <PageLoading />}
    {error && <div className="mb-5"><PageError message={error} /></div>}
    {success && <p role="status" className="mb-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">{success}</p>}
    {booking && <>
      <BookingCard booking={booking} history={['Completed', 'Cancelled'].includes(booking.status)} showActions={false} />
      <div className="mt-4 flex flex-wrap gap-3">
        {booking.canModify && <><Button onClick={() => openAction('reschedule', booking)} disabled={Boolean(pending)}><CalendarDays className="size-4" />Reschedule</Button><Button variant="outline" className="text-destructive" onClick={() => openAction('cancel', booking)} disabled={Boolean(pending)}>Cancel booking</Button></>}
        {pending && <Button onClick={() => setAction(pending.action)}>Check pending update</Button>}
        {booking.reportId && <Button nativeButton={false} render={<Link href={`/customer/history/${bookingId}`} />} variant="outline">View service report</Button>}
        <Button nativeButton={false} render={<a href={bookingSupportLink(booking.bookingReference)} />} variant="outline"><Mail className="size-4" />Contact support</Button>
      </div>
      {!booking.canModify && !['Completed', 'Cancelled'].includes(booking.status) && <p className="mt-3 text-sm text-muted-foreground">Please email <a href={bookingSupportLink(booking.bookingReference)} className="text-primary underline">{customerSupportEmail}</a> to request changes to an arranged visit.</p>}
      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <Card><CardHeader><CardTitle className="text-lg">Booking progress</CardTitle></CardHeader><CardContent><ol className="space-y-5 border-l-2 border-primary/15 pl-4">{booking.statusTimeline.length ? booking.statusTimeline.map((entry, index) => <li key={`${entry.changedAt}-${index}`}><p className="font-semibold">{bookingStatusLabel(entry.status)}</p><p className="mt-1 text-xs text-muted-foreground">{formatDateTime(entry.changedAt)}</p>{entry.remarks && <p className="mt-1 text-sm text-muted-foreground">{entry.remarks}</p>}</li>) : <li><p className="font-semibold">{bookingStatusLabel(booking.status)}</p><p className="mt-1 text-sm text-muted-foreground">No earlier status updates were recorded.</p></li>}</ol></CardContent></Card>
        <div className="space-y-5"><Card><CardHeader><CardTitle className="text-lg">Your service notes</CardTitle></CardHeader><CardContent><p className="whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground">{booking.problemDescription || 'No additional notes were provided.'}</p></CardContent></Card>{booking.annualBundle && <AnnualBookingSummary totalAmount={booking.annualBundle.totalAmount} saved={booking.annualBundle} compact collapsible />}</div>
      </div>
    </>}
    <Dialog open={Boolean(action)} onOpenChange={open => { if (!open && !busy) setAction(null); }}>
      <DialogContent className="customer-theme max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg" showCloseButton={!busy}>
        <DialogHeader><DialogTitle>{action === 'cancel' ? 'Cancel this visit?' : 'Reschedule your visit'}</DialogTitle><DialogDescription>{booking?.bookingReference}{booking?.annualBundle ? ` · Visit ${booking.annualBundle.visitNumber} of 4. Changes apply only to this visit.` : ''}</DialogDescription></DialogHeader>
        {action === 'cancel' ? <p className="text-sm leading-6 text-muted-foreground">This appointment will move to Booking History. {booking?.annualBundle ? 'The other visits in your annual plan will keep their dates.' : 'You can make a new booking whenever you are ready.'}</p> : <div className="space-y-4">
          <p className="text-sm text-muted-foreground">Choose a weekday at least 14 days ahead. Preferred times are in Singapore time.</p>
          {booking?.annualBundle?.windowStart && maximum && <p className="rounded-xl bg-primary/5 p-3 text-sm">This visit window: {formatDate(booking.annualBundle.windowStart)} to {formatDate(maximum)}.</p>}
          {maximum && minimum > maximum ? <p role="alert" className="text-sm text-destructive">No self-service dates remain in this visit window. Please contact support.</p> : <><div className="space-y-2"><Label htmlFor="reschedule-date">New preferred date</Label><EnglishDatePicker id="reschedule-date" label="New preferred date" value={date} onChange={setDate} min={minimum} max={maximum} disabled={busy || Boolean(pending)} blockedDates={availability.blockedDates} onMonthChange={availability.onMonthChange} aria-invalid={Boolean(dateError)} /></div><div className="space-y-2"><Label htmlFor="reschedule-time">New preferred time</Label><NativeSelect id="reschedule-time" value={time} onChange={event => setTime(event.target.value)} disabled={busy || Boolean(pending)}>{!slots.includes(time) && <NativeSelectOption value={time}>{formatTimeSlot(time)} (current time)</NativeSelectOption>}{slots.map(slot => <NativeSelectOption key={slot} value={slot}>{formatTimeSlot(slot)}</NativeSelectOption>)}</NativeSelect></div></>}
          {dateError && <p role="alert" className="text-sm text-destructive">{dateError}</p>}
          <BookingAvailabilityNotice availability={availability} />
        </div>}
        {actionError && <p role="alert" className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive">{actionError}</p>}
        <DialogFooter><Button variant="outline" onClick={() => setAction(null)} disabled={busy}>Keep booking</Button><Button variant={action === 'cancel' ? 'destructive' : 'default'} onClick={() => void submitChange()} disabled={busy || (!pending && action === 'reschedule' && Boolean(!date || dateError || availability.checking || availability.selectedDateBlocked || maximum && minimum > maximum))}>{busy ? 'Saving…' : pending ? 'Retry same update' : action === 'cancel' ? 'Confirm cancellation' : 'Save new schedule'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </div></CoolCareShell>;
}
