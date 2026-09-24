'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, CalendarDays, Mail, RefreshCw } from 'lucide-react';
import { CoolCareShell } from '@/components/coolcare-shell';
import { ServiceProgressSummary } from '@/components/service-progress-summary';
import { bookingChangeNotice } from '@/components/booking-service-selection';
import { BookingCard } from '@/components/booking-card';
import { AnnualBookingSummary } from '@/components/annual-booking-summary';
import { bookingStatusLabel } from '@/components/booking-status';
import {
  BookingAvailabilityNotice,
  bookingConflictMessage,
} from '@/components/booking-availability-notice';
import { EnglishDatePicker } from '@/components/english-date-picker';
import { PageError, PageLoading } from '@/components/page-state';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { coolcareApi } from '@/lib/coolcare-api';
import {
  rescheduleDateError,
  earliestChangeDate,
} from '@/lib/booking-schedule';
import { dayBeforeDate } from '@/lib/annual-booking';
import {
  formatDate,
  formatDateTime,
  formatTimeSlot,
  formatServiceWindow,
} from '@/lib/format';
import { useBookingClock } from '@/lib/use-booking-clock';
import { useCustomerResource } from '@/lib/use-customer-resource';
import { useBookingAvailability } from '@/lib/use-booking-availability';
import { useSlotAvailability } from '@/lib/use-slot-availability';
import {
  bookingSupportLink,
  customerSupportEmail,
} from '@/lib/customer-support';
import type { BookingDetail, BookingInput } from '@/lib/coolcare-types';

type Action = 'cancel' | 'reschedule';
type PendingChange = { action: Action; date: string; time: string };
const slots = [
  '09:00 - 11:00',
  '11:00 - 13:00',
  '14:00 - 16:00',
  '16:00 - 18:00',
];

export default function BookingDetailsPage() {
  const { bookingId: routeId } = useParams<{ bookingId: string }>();
  return <BookingDetailsContent key={routeId} bookingId={Number(routeId)} />;
}

function BookingDetailsContent({ bookingId }: { bookingId: number }) {
  const load = useCallback(
    () =>
      Number.isSafeInteger(bookingId) && bookingId > 0
        ? coolcareApi.getBooking(bookingId)
        : Promise.reject(new Error('Invalid booking identifier.')),
    [bookingId],
  );
  const {
    data: resourceBooking,
    error,
    refreshing,
    refresh,
  } = useCustomerResource(load);
  const booking =
    resourceBooking?.bookingId === bookingId ? resourceBooking : null;
  const [action, setAction] = useState<Action | null>(null);
  const [date, setDate] = useState('');
  const [time, setTime] = useState(slots[0]);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const [success, setSuccess] = useState('');
  const [pending, setPending] = useState<PendingChange | null>(null);
  const initialized = useRef(false);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const now = useBookingClock();
  const canModify = Boolean(
    booking?.canModify &&
    (!booking.changeDeadline ||
      now.getTime() <= new Date(booking.changeDeadline).getTime()),
  );
  const minimum = [
    earliestChangeDate(now),
    booking?.annualBundle?.windowStart ?? '',
  ]
    .sort()
    .at(-1)!;
  const maximum = booking?.annualBundle?.windowEnd
    ? dayBeforeDate(booking.annualBundle.windowEnd)
    : undefined;
  const availability = useBookingAvailability({
    serviceAddress: booking?.addressLine,
    addressId: booking?.addressId,
    selectedDate: date,
    excludeBookingId: bookingId,
    serviceIds: booking?.serviceIds,
    packageId: booking?.packageId ?? undefined,
    enabled: action === 'reschedule',
  });
  const dateError = date
    ? rescheduleDateError(date, time, now) ||
      (date < minimum || (maximum && date > maximum)
        ? 'Choose a date inside this quarterly visit window.'
        : '')
    : '';
  const slotAvailability = useSlotAvailability(
    date && !dateError ? [date] : [],
    action === 'reschedule',
    booking?.estimatedDurationMinutes,
    bookingId,
  );
  const selectedSlotAvailable = slotAvailability.isAvailable(
    time as BookingInput['timeSlot'],
  );

  const openAction = useCallback(
    (nextAction: Action, current: BookingDetail) => {
      if (
        current.bookingId !== bookingId ||
        !current.canModify ||
        (current.changeDeadline &&
          new Date(current.changeDeadline).getTime() < Date.now())
      )
        return;
      setAction(nextAction);
      setActionError('');
      setDate(
        current.preferredDate < earliestChangeDate()
          ? earliestChangeDate()
          : current.preferredDate,
      );
      setTime(
        slots.find(
          (slot) => formatTimeSlot(slot) === formatTimeSlot(current.timeSlot),
        ) ?? current.timeSlot,
      );
    },
    [bookingId],
  );
  useEffect(() => {
    initialized.current = false;
    setAction(null);
    setPending(null);
    setSuccess('');
  }, [bookingId]);
  useEffect(() => {
    if (!booking || initialized.current) return;
    initialized.current = true;
    const url = new URL(window.location.href);
    const requested = url.searchParams.get('action');
    if (requested === 'cancel' || requested === 'reschedule') {
      // The card action is consumed once; reloading must not reopen a saved edit.
      url.searchParams.delete('action');
      window.history.replaceState(
        window.history.state,
        '',
        url.pathname + url.search + url.hash,
      );
      if (booking.canModify) openAction(requested, booking);
    }
  }, [booking, openAction]);

  async function submitChange() {
    if (
      !booking ||
      booking.bookingId !== bookingId ||
      !action ||
      busy ||
      !mounted.current
    )
      return;
    if (!pending && !canModify) {
      setActionError(
        'Changes must be made at least 72 hours before the original appointment. Please contact support.',
      );
      return;
    }
    if (
      !pending &&
      action === 'reschedule' &&
      (dateError ||
        !date ||
        !time ||
        availability.selectedDateBlocked ||
        !selectedSlotAvailable)
    ) {
      setActionError(
        dateError ||
          (availability.selectedDateBlocked
            ? bookingConflictMessage
            : !selectedSlotAvailable
              ? 'This time is fully booked. Choose another time.'
              : 'Choose a new date and time.'),
      );
      return;
    }
    const change = pending ?? { action, date, time };
    setBusy(true);
    setActionError('');
    try {
      if (change.action === 'cancel')
        await coolcareApi.updateBookingStatus(bookingId, 'Cancelled');
      else
        await coolcareApi.rescheduleBooking(bookingId, {
          preferredDate: change.date,
          timeWindow: change.time,
        });
      if (!mounted.current) return;
      setPending(null);
      setAction(null);
      setSuccess(
        change.action === 'cancel'
          ? 'This visit has been cancelled. It is now in Booking History.'
          : `Your visit was moved to ${formatDate(change.date)}, ${formatServiceWindow(change.time, booking.estimatedDurationMinutes)}. The service team will review and confirm the new appointment.`,
      );
      await refresh();
    } catch (reason) {
      if (!mounted.current) return;
      const status = (reason as { status?: number })?.status;
      const uncertain = !status || status >= 500;
      if (uncertain) {
        setPending(change);
        setActionError(
          'We could not confirm the update. Retry the same change to check its result; your selections are locked until it is confirmed.',
        );
      } else {
        setPending(null);
        setActionError(
          reason instanceof Error
            ? reason.message
            : 'Unable to update this booking.',
        );
        availability.refresh();
        await refresh();
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <CoolCareShell>
      <div className="mx-auto max-w-5xl px-5 py-7 sm:px-8 lg:px-10">
        <Button
          nativeButton={false}
          render={
            <Link
              href={
                booking &&
                ['Completed', 'Rejected', 'Cancelled', 'Expired'].includes(
                  booking.status,
                )
                  ? '/customer/history'
                  : '/customer/bookings'
              }
            />
          }
          variant="ghost"
          className="mb-4 -ml-3"
        >
          <ArrowLeft className="size-4" />
          Back to bookings
        </Button>
        <div className="mb-5 flex items-center justify-between gap-3">
          <h1 className="text-2xl font-bold sm:text-3xl">Booking details</h1>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void refresh()}
            disabled={refreshing}
          >
            <RefreshCw
              className={`size-4 ${refreshing ? 'animate-spin' : ''}`}
            />
            Refresh
          </Button>
        </div>
        {!booking && !error && <PageLoading />}
        {error && (
          <div className="mb-5">
            <PageError message={error} />
          </div>
        )}
        {success && (
          <p
            role="status"
            className="mb-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900"
          >
            {success}
          </p>
        )}
        {booking && (
          <>
            <BookingCard
              booking={booking}
              history={[
                'Completed',
                'Rejected',
                'Cancelled',
                'Expired',
              ].includes(booking.status)}
              showActions={false}
            />
            <div className="mt-4 flex flex-wrap gap-3">
              {canModify && (
                <>
                  <Button
                    onClick={() => openAction('reschedule', booking)}
                    disabled={Boolean(pending)}
                  >
                    <CalendarDays className="size-4" />
                    Reschedule
                  </Button>
                  <Button
                    variant="outline"
                    className="text-destructive"
                    onClick={() => openAction('cancel', booking)}
                    disabled={Boolean(pending)}
                  >
                    Cancel booking
                  </Button>
                </>
              )}
              {pending && (
                <Button onClick={() => setAction(pending.action)}>
                  Check pending update
                </Button>
              )}
              {booking.reportId && (
                <Button
                  nativeButton={false}
                  render={<Link href={`/customer/history/${bookingId}`} />}
                  variant="outline"
                >
                  View service report
                </Button>
              )}
              <Button
                nativeButton={false}
                render={
                  <a href={bookingSupportLink(booking.bookingReference)} />
                }
                variant="outline"
              >
                <Mail className="size-4" />
                Contact support
              </Button>
            </div>
            {!canModify &&
              !['Completed', 'Rejected', 'Cancelled', 'Expired'].includes(
                booking.status,
              ) && (
                <p className="mt-3 text-sm text-muted-foreground">
                  Please email{' '}
                  <a
                    href={bookingSupportLink(booking.bookingReference)}
                    className="text-primary underline"
                  >
                    {customerSupportEmail}
                  </a>{' '}
                  to request changes to an arranged visit.
                </p>
              )}
            {booking.changeDeadline && (
              <p className="mt-4 rounded-xl bg-muted/50 p-3 text-sm text-muted-foreground">
                {bookingChangeNotice}
                <span className="mt-1 block">
                  Change deadline: {formatDateTime(booking.changeDeadline)}{' '}
                  (SGT).
                </span>
              </p>
            )}
            {['Rejected', 'Expired'].includes(booking.status) && (
              <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
                <p className="text-sm text-amber-950">
                  {booking.status === 'Rejected'
                    ? 'Review the reason above and choose another appointment.'
                    : 'This request expired before confirmation. Choose a new appointment to book again.'}
                </p>
                <Button
                  className="mt-3"
                  nativeButton={false}
                  render={<Link href={`/customer/book?rebook=${bookingId}`} />}
                >
                  Book again
                </Button>
              </div>
            )}
            <div className="mt-6">
              <ServiceProgressSummary progress={booking.serviceProgress} />
            </div>
            <div className="mt-6 grid gap-5 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Booking progress</CardTitle>
                </CardHeader>
                <CardContent>
                  <ol className="space-y-5 border-l-2 border-primary/15 pl-4">
                    {booking.statusTimeline.length ? (
                      booking.statusTimeline.map((entry, index) => (
                        <li key={`${entry.changedAt}-${index}`}>
                          <p className="font-semibold">
                            {bookingStatusLabel(entry.status)}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {formatDateTime(entry.changedAt)}
                          </p>
                          {entry.remarks && (
                            <p className="mt-1 text-sm text-muted-foreground">
                              {entry.remarks}
                            </p>
                          )}
                        </li>
                      ))
                    ) : (
                      <li>
                        <p className="font-semibold">
                          {bookingStatusLabel(booking.status)}
                        </p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          No earlier status updates were recorded.
                        </p>
                      </li>
                    )}
                  </ol>
                </CardContent>
              </Card>
              <div className="space-y-5">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">
                      Your service notes
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground">
                      {booking.problemDescription ||
                        'No service issues were provided.'}
                    </p>
                    {booking.specialNotes && (
                      <>
                        <h3 className="mt-4 text-sm font-semibold">
                          Other remarks for the administrator
                        </h3>
                        <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground">
                          {booking.specialNotes}
                        </p>
                      </>
                    )}
                  </CardContent>
                </Card>
                {booking.annualBundle && (
                  <AnnualBookingSummary
                    totalAmount={booking.annualBundle.totalAmount}
                    saved={booking.annualBundle}
                    compact
                    collapsible
                  />
                )}
              </div>
            </div>
          </>
        )}
        <Dialog
          open={Boolean(action)}
          onOpenChange={(open) => {
            if (!open && !busy) setAction(null);
          }}
        >
          <DialogContent
            className="customer-theme max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg"
            showCloseButton={!busy}
          >
            <DialogHeader>
              <DialogTitle>
                {action === 'cancel'
                  ? 'Cancel this visit?'
                  : 'Reschedule your visit'}
              </DialogTitle>
              <DialogDescription>
                {booking?.bookingReference}
                {booking?.annualBundle
                  ? ` · Visit ${booking.annualBundle.visitNumber} of 4. Changes apply only to this visit.`
                  : ''}
              </DialogDescription>
            </DialogHeader>
            {action === 'cancel' ? (
              <p className="text-sm leading-6 text-muted-foreground">
                This appointment will move to Booking History.{' '}
                {booking?.annualBundle
                  ? 'The other visits in your annual plan will keep their dates.'
                  : 'You can make a new booking whenever you are ready.'}
              </p>
            ) : (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Changes require 72 hours of notice before the original visit.
                  Choose a new weekday appointment at least 72 hours from now.
                  Times are in Singapore time.
                </p>
                {booking?.annualBundle?.windowStart && maximum && (
                  <p className="rounded-xl bg-primary/5 p-3 text-sm">
                    This visit window:{' '}
                    {formatDate(booking.annualBundle.windowStart)} to{' '}
                    {formatDate(maximum)}.
                  </p>
                )}
                {maximum && minimum > maximum ? (
                  <p role="alert" className="text-sm text-destructive">
                    No self-service dates remain in this visit window. Please
                    contact support.
                  </p>
                ) : (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="reschedule-date">
                        New preferred date
                      </Label>
                      <EnglishDatePicker
                        id="reschedule-date"
                        label="New preferred date"
                        value={date}
                        onChange={setDate}
                        min={minimum}
                        max={maximum}
                        disabled={busy || Boolean(pending)}
                        blockedDates={availability.blockedDates}
                        onMonthChange={availability.onMonthChange}
                        aria-invalid={Boolean(dateError)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="reschedule-time">
                        New preferred time
                      </Label>
                      <NativeSelect
                        id="reschedule-time"
                        value={time}
                        onChange={(event) => setTime(event.target.value)}
                        disabled={
                          busy || Boolean(pending) || slotAvailability.loading
                        }
                      >
                        {!slots.includes(time) && (
                          <NativeSelectOption value={time}>
                            {formatTimeSlot(time)} (current time)
                          </NativeSelectOption>
                        )}
                        {slots.map((slot) => (
                          <NativeSelectOption
                            key={slot}
                            value={slot}
                            disabled={
                              !slotAvailability.isAvailable(
                                slot as BookingInput['timeSlot'],
                              )
                            }
                          >
                            {formatServiceWindow(
                              slot,
                              booking?.estimatedDurationMinutes,
                            )}
                            {slotAvailability.isAvailable(
                              slot as BookingInput['timeSlot'],
                            )
                              ? ''
                              : ' — Fully booked'}
                          </NativeSelectOption>
                        ))}
                      </NativeSelect>
                      {slotAvailability.loading && (
                        <p className="text-xs text-muted-foreground">
                          Checking team capacity…
                        </p>
                      )}
                      {slotAvailability.error && (
                        <p role="alert" className="text-xs text-destructive">
                          {slotAvailability.error}
                        </p>
                      )}
                      {!selectedSlotAvailable && (
                        <p role="alert" className="text-xs text-destructive">
                          This time is fully booked. Choose another time.
                        </p>
                      )}
                    </div>
                  </>
                )}
                {dateError && (
                  <p role="alert" className="text-sm text-destructive">
                    {dateError}
                  </p>
                )}
                <BookingAvailabilityNotice availability={availability} />
              </div>
            )}
            {actionError && (
              <p
                role="alert"
                className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive"
              >
                {actionError}
              </p>
            )}
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setAction(null)}
                disabled={busy}
              >
                Keep booking
              </Button>
              <Button
                variant={action === 'cancel' ? 'destructive' : 'default'}
                onClick={() => void submitChange()}
                disabled={
                  busy ||
                  (!pending &&
                    action === 'reschedule' &&
                    Boolean(
                      !date ||
                      dateError ||
                      availability.checking ||
                      availability.selectedDateBlocked ||
                      slotAvailability.loading ||
                      !selectedSlotAvailable ||
                      (maximum && minimum > maximum),
                    ))
                }
              >
                {busy
                  ? 'Saving…'
                  : pending
                    ? 'Retry same update'
                    : action === 'cancel'
                      ? 'Confirm cancellation'
                      : 'Save new schedule'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </CoolCareShell>
  );
}
