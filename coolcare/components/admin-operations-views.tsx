'use client';
import { ReturnVisitsPanel } from '@/components/return-visits-panel';
import { ServicePhotoGallery } from '@/components/service-photo-gallery';
import { SignatureImage } from '@/components/signature-image';

import { useEffect, useRef, useState } from 'react';
import {
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Send,
  ShieldCheck,
  XCircle,
  AlertCircle,
  MapPin,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { NativeSelect } from '@/components/ui/native-select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { BookingStatus } from '@/components/booking-status';
import { EnglishDatePicker } from '@/components/english-date-picker';
import { formatServiceWindow, formatTimeSlot } from '@/lib/format';
import {
  bookingDateError,
  earliestBookingDate,
  singaporeToday,
} from '@/lib/booking-schedule';
import {
  api,
  ApiError,
  errorText,
  money,
  useInventory,
  useResource,
  type AdminBooking,
  type AdminBookingDetail,
  type AdminSchedule,
  type DispatchOptions,
  type List,
  type StaffMember,
} from '@/lib/inventory-client';
import { LoadState, NoResults, Pager } from '@/components/inventory-ui';

const displayServiceTime = (booking: {
  timeSlot: string;
  slotStart?: string | null;
  slotEnd?: string | null;
  estimatedDurationMinutes?: number | null;
}) =>
  booking.slotStart && booking.slotEnd
    ? formatTimeSlot(
        booking.slotStart.slice(0, 5) + ' - ' + booking.slotEnd.slice(0, 5),
      )
    : formatServiceWindow(
        booking.timeSlot,
        booking.estimatedDurationMinutes ?? undefined,
      );
const fitsWorkingHours = (slot: string, duration?: number | null) =>
  !duration ||
  Number(slot.slice(0, 2)) * 60 + Number(slot.slice(3, 5)) + duration <=
    18 * 60;
const displayDate = (value: string) =>
  new Intl.DateTimeFormat('en-SG', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${String(value).slice(0, 10)}T00:00:00Z`));
const displayMoment = (value: string | null | undefined) =>
  value ? String(value).replace('T', ' ').slice(0, 16) : 'Not recorded';
const displayExpiry = (value: string) =>
  new Intl.DateTimeFormat('en-SG', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Singapore',
  }).format(
    new Date(value.includes('T') ? value : value.replace(' ', 'T') + 'Z'),
  ) + ' SGT';
const timeSlots = [
  { value: '09:00 - 11:00', label: '09:00 AM - 11:00 AM' },
  { value: '11:00 - 13:00', label: '11:00 AM - 01:00 PM' },
  { value: '14:00 - 16:00', label: '02:00 PM - 04:00 PM' },
  { value: '16:00 - 18:00', label: '04:00 PM - 06:00 PM' },
];
const canonicalTimeSlot = (value: string) =>
  ({
    '09:00 AM - 11:00 AM': '09:00 - 11:00',
    '11:00 AM - 01:00 PM': '11:00 - 13:00',
    '11:30 AM - 01:30 PM': '11:00 - 13:00',
    '02:00 PM - 04:00 PM': '14:00 - 16:00',
    '04:00 PM - 06:00 PM': '16:00 - 18:00',
    '04:30 PM - 06:30 PM': '16:00 - 18:00',
  })[value] ?? value;
const calendarDate = (value: string) => String(value).slice(0, 10);
const validCalendarDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
};
const shiftDate = (value: string, days: number) => {
  const date = new Date(`${calendarDate(value)}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};
const mondayOf = (value: string) => {
  const date = new Date(`${calendarDate(value)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return mondayOf(singaporeToday());
  const day = date.getUTCDay();
  return shiftDate(value, -(day === 0 ? 6 : day - 1));
};
const weekday = (value: string) =>
  new Intl.DateTimeFormat('en-SG', {
    weekday: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${value}T00:00:00Z`));

function Heading({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string;
  title: string;
  description: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="page-title">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="muted">{description}</p>
      </div>
      {actions && <div className="actions">{actions}</div>}
    </div>
  );
}

export function OrdersPage({
  mode,
  params,
}: {
  mode: 'review' | 'dispatch';
  params: URLSearchParams;
}) {
  const { go, version, refresh, actionSummary } = useInventory(),
    status =
      mode === 'review'
        ? ['Submitted', 'Rejected', 'Expired'].includes(
            params.get('status') || '',
          )
          ? params.get('status')!
          : 'Submitted'
        : 'Confirmed';
  const page = Math.max(1, Number(params.get('page') || 1)),
    query = new URLSearchParams({ status, page: String(page), pageSize: '20' });
  const resource = useResource<List<AdminBooking>>(
    `/admin/bookings?${query}`,
    version,
  );
  const data = resource.data;
  return (
    <>
      <Heading
        eyebrow={mode === 'review' ? 'ORDERS / REVIEW' : 'ORDERS / DISPATCH'}
        title={mode === 'review' ? 'Booking review' : 'Dispatch queue'}
        description={
          mode === 'review'
            ? 'Approve or reject submitted customer requests before dispatch.'
            : 'Assign confirmed visits to an available technician automatically or manually.'
        }
        actions={
          <Button variant="outline" onClick={refresh}>
            <RefreshCw />
            Refresh
          </Button>
        }
      />
      {mode === 'review' && (
        <section className="mb-6" aria-labelledby="admin-action-centre-title">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h2
                id="admin-action-centre-title"
                className="text-xl font-semibold"
              >
                Action centre
              </h2>
              <p className="text-sm muted">
                Counts remain visible until the work is completed.
              </p>
            </div>
            <strong className="rounded-full bg-red-600 px-3 py-1 text-sm text-white">
              {actionSummary.totalRequiringAction} total
            </strong>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <button
              type="button"
              className="rounded-xl border bg-white p-4 text-left shadow-sm"
              onClick={() => go('/admin/orders?status=Submitted')}
            >
              <span className="text-sm muted">Awaiting confirmation</span>
              <strong className="mt-2 block text-2xl">
                {actionSummary.submitted}
              </strong>
            </button>
            <div className="rounded-xl border border-orange-200 bg-orange-50 p-4">
              <span className="text-sm text-orange-800">
                Due within 12 hours
              </span>
              <strong className="mt-2 block text-2xl text-orange-900">
                {actionSummary.expiringSoon}
              </strong>
            </div>
            <div className="rounded-xl border bg-white p-4 shadow-sm">
              <span className="text-sm muted">Return visits needing Admin</span>
              <strong className="mt-2 block text-2xl">
                {actionSummary.returnVisits}
              </strong>
            </div>
            <button
              type="button"
              className="rounded-xl border bg-white p-4 text-left shadow-sm"
              onClick={() => go('/admin/dispatch')}
            >
              <span className="text-sm muted">Awaiting dispatch</span>
              <strong className="mt-2 block text-2xl">
                {actionSummary.awaitingDispatch}
              </strong>
            </button>
          </div>
        </section>
      )}
      <ReturnVisitsPanel viewerRole="admin" />
      {mode === 'review' && (
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <label
            htmlFor="order-status-filter"
            className="text-sm font-semibold"
          >
            Order status
            <NativeSelect
              id="order-status-filter"
              className="mt-1"
              value={status}
              onChange={(event) =>
                go('/admin/orders?status=' + event.target.value)
              }
            >
              <option value="Submitted">Awaiting confirmation</option>
              <option value="Rejected">Rejected</option>
              <option value="Expired">Expired</option>
            </NativeSelect>
          </label>
          {status === 'Submitted' && (
            <p className="flex items-center gap-2 rounded-lg bg-red-50 p-3 text-sm font-medium text-red-800">
              <AlertCircle className="size-4" />
              Unconfirmed requests need review before their deadline.
            </p>
          )}
        </div>
      )}
      <LoadState {...resource} />
      {data &&
        (data.rows.length ? (
          <section className="panel table-panel admin-operations-table">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Booking</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Service</TableHead>
                  <TableHead>Schedule</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.rows.map((row) => (
                  <TableRow
                    key={row.bookingId}
                    className={
                      row.status === 'Submitted' ? 'bg-red-50/50' : undefined
                    }
                  >
                    <TableCell data-label="Booking">
                      <strong>
                        BK-{String(row.bookingId).padStart(4, '0')}
                      </strong>
                      <small className="block muted">
                        {money(row.totalAmount)}
                      </small>
                    </TableCell>
                    <TableCell data-label="Customer">
                      <strong>{row.customerName}</strong>
                      <small className="block muted">{row.email}</small>
                    </TableCell>
                    <TableCell data-label="Service">
                      {row.serviceName}
                      <small className="block muted">
                        {row.numberOfUnits} AC unit(s)
                      </small>
                    </TableCell>
                    <TableCell data-label="Schedule">
                      {displayDate(row.preferredDate)}
                      <small className="block muted">
                        {displayServiceTime(row)}
                      </small>
                    </TableCell>
                    <TableCell data-label="Status">
                      <BookingStatus status={row.status} />
                      {row.status === 'Submitted' && (
                        <small className="mt-1 block font-medium text-red-700">
                          {row.expiresAt
                            ? `Confirm by ${displayExpiry(row.expiresAt)}`
                            : 'Awaiting confirmation · No expiry for this existing request'}
                        </small>
                      )}
                    </TableCell>
                    <TableCell data-label="Action" className="text-right">
                      <Button
                        size="sm"
                        onClick={() => go(`/admin/orders/${row.bookingId}`)}
                      >
                        {mode === 'review' ? 'Review' : 'Open dispatch'}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Pager
              total={data.total}
              page={data.page}
              pageSize={data.pageSize}
              onPage={(next) =>
                go(
                  `/${mode === 'review' ? 'admin/orders' : 'admin/dispatch'}?page=${next}&status=${status}`,
                )
              }
            />
          </section>
        ) : (
          <NoResults
            title={
              mode === 'review'
                ? 'No bookings awaiting review'
                : 'No confirmed bookings awaiting dispatch'
            }
            description={
              mode === 'review'
                ? 'New customer requests will appear here.'
                : 'Approved bookings will appear here until assigned.'
            }
          />
        ))}
    </>
  );
}

export function DispatchCalendarPage({ params }: { params: URLSearchParams }) {
  const { go, version, refresh } = useInventory();
  const requestedDate = params.get('date') || '';
  const selectedDate = validCalendarDate(requestedDate) ? requestedDate : '';
  const weekStart = mondayOf(
    selectedDate || params.get('week') || singaporeToday(),
  );
  const weekEnd = shiftDate(weekStart, 6);
  const page = Math.max(1, Number(params.get('page') || 1));
  const schedule = useResource<AdminSchedule>(
    `/admin/schedule?from=${weekStart}&to=${weekEnd}`,
    version,
  );
  const queue = useResource<List<AdminBooking>>(
    `/admin/bookings?status=Confirmed&page=${page}&pageSize=20`,
    version,
  );
  const days = Array.from({ length: 7 }, (_, index) =>
    shiftDate(weekStart, index),
  );
  const rows = schedule.data?.rows ?? [];
  const assignedCount = rows.filter((row) =>
    ['Assigned', 'On The Way', 'In Progress'].includes(row.status),
  ).length;
  const dispatchUrl = (
    nextWeek: string,
    nextDate = selectedDate,
    nextPage = page,
  ) => {
    const query = new URLSearchParams({ week: nextWeek });
    if (nextDate) query.set('date', nextDate);
    if (nextPage > 1) query.set('page', String(nextPage));
    return `/admin/dispatch?${query}`;
  };
  const moveWeek = (daysToMove: number) =>
    go(
      dispatchUrl(
        shiftDate(weekStart, daysToMove),
        selectedDate ? shiftDate(selectedDate, daysToMove) : '',
      ),
    );
  return (
    <>
      <Heading
        eyebrow="ORDERS / DISPATCH"
        title="Weekly dispatch schedule"
        description={`${displayDate(weekStart)} – ${displayDate(weekEnd)} · Open a confirmed booking to review its time and assign a technician automatically or manually.`}
        actions={
          <div className="actions">
            <Button
              variant="outline"
              size="icon"
              aria-label="Previous week"
              onClick={() => moveWeek(-7)}
            >
              <ChevronLeft />
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                const today = singaporeToday();
                go(dispatchUrl(mondayOf(today), today));
              }}
            >
              Today
            </Button>
            <Button
              variant="outline"
              size="icon"
              aria-label="Next week"
              onClick={() => moveWeek(7)}
            >
              <ChevronRight />
            </Button>
            <Button variant="outline" onClick={refresh}>
              <RefreshCw />
              Refresh
            </Button>
          </div>
        }
      />
      <div className="schedule-summary">
        <div className="stat">
          <span>AWAITING DISPATCH</span>
          <strong>{queue.data?.total ?? '—'}</strong>
          <small>Confirmed bookings across all dates</small>
        </div>
        <div className="stat">
          <span>WEEKLY VISITS</span>
          <strong>{schedule.data ? rows.length : '—'}</strong>
          <small>Active and completed bookings shown</small>
        </div>
        <div className="stat">
          <span>ASSIGNED THIS WEEK</span>
          <strong>{schedule.data ? assignedCount : '—'}</strong>
          <small>Assigned or currently in progress</small>
        </div>
      </div>
      <LoadState {...schedule} />
      {schedule.data && (
        <section className="panel schedule-calendar-panel">
          <div className="schedule-calendar-heading">
            <div>
              <h2>Team calendar</h2>
              <p className="muted">
                Submitted requests are visible for planning. Technician names
                appear after dispatch.
              </p>
            </div>
            <EnglishDatePicker
              value={selectedDate || weekStart}
              label="Choose schedule date"
              disableWeekends={false}
              triggerMode="icon"
              align="end"
              onChange={(date) => go(dispatchUrl(mondayOf(date), date))}
            />
          </div>
          <div className="schedule-calendar-scroll">
            <div className="schedule-calendar-grid">
              {days.map((day, index) => {
                const bookings = rows.filter(
                  (row) => calendarDate(row.preferredDate) === day,
                );
                return (
                  <section className="schedule-day" key={day}>
                    <header
                      className={[
                        day === singaporeToday() ? 'today' : '',
                        day === selectedDate ? 'selected' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      aria-current={
                        day === selectedDate ||
                        (!selectedDate && day === singaporeToday())
                          ? 'date'
                          : undefined
                      }
                    >
                      <span>{weekday(day)}</span>
                      <strong>{displayDate(day)}</strong>
                    </header>
                    <div className="schedule-day-body">
                      {bookings.length ? (
                        bookings.map((booking) => (
                          <button
                            type="button"
                            className="schedule-booking"
                            data-status={booking.status}
                            key={booking.bookingId}
                            onClick={() =>
                              go(`/admin/orders/${booking.bookingId}`)
                            }
                            aria-label={`Open booking ${booking.bookingId} for ${booking.customerName}`}
                          >
                            <span className="schedule-booking-time">
                              {displayServiceTime(booking)}
                            </span>
                            <strong>
                              BK-{String(booking.bookingId).padStart(4, '0')}
                            </strong>
                            <span>{booking.customerName}</span>
                            <small>{booking.serviceName}</small>
                            <small>
                              {booking.technicianName || 'Awaiting dispatch'}
                            </small>
                            <BookingStatus status={booking.status} />
                          </button>
                        ))
                      ) : (
                        <p className="schedule-empty">
                          {index > 4 ? 'Closed' : 'No visits'}
                        </p>
                      )}
                    </div>
                  </section>
                );
              })}
            </div>
          </div>
        </section>
      )}
      <LoadState {...queue} />
      {queue.data &&
        (queue.data.rows.length ? (
          <section className="panel table-panel admin-operations-table mt-6">
            <div className="schedule-queue-heading">
              <div>
                <h2>Confirmed bookings awaiting dispatch</h2>
                <p className="muted">
                  Open a booking to adjust its appointment, then choose
                  automatic or manual dispatch.
                </p>
              </div>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Booking</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Service</TableHead>
                  <TableHead>Schedule</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {queue.data.rows.map((row) => (
                  <TableRow key={row.bookingId}>
                    <TableCell data-label="Booking">
                      <strong>
                        BK-{String(row.bookingId).padStart(4, '0')}
                      </strong>
                    </TableCell>
                    <TableCell data-label="Customer">
                      <strong>{row.customerName}</strong>
                      <small className="block muted">{row.email}</small>
                    </TableCell>
                    <TableCell data-label="Service">
                      {row.serviceName}
                    </TableCell>
                    <TableCell data-label="Schedule">
                      {displayDate(row.preferredDate)}
                      <small className="block muted">
                        {displayServiceTime(row)}
                      </small>
                    </TableCell>
                    <TableCell data-label="Action" className="text-right">
                      <Button
                        size="sm"
                        onClick={() => go(`/admin/orders/${row.bookingId}`)}
                      >
                        Open dispatch
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Pager
              total={queue.data.total}
              page={queue.data.page}
              pageSize={queue.data.pageSize}
              onPage={(next) => go(dispatchUrl(weekStart, selectedDate, next))}
            />
          </section>
        ) : (
          <NoResults
            title="No confirmed bookings awaiting dispatch"
            description="Approved bookings will appear here until assigned."
          />
        ))}
    </>
  );
}

export function OrderDetails({ bookingId }: { bookingId: number }) {
  const { go, version, refresh, notify, setDirty } = useInventory(),
    resource = useResource<{ booking: AdminBookingDetail }>(
      `/admin/bookings/${bookingId}`,
      version,
    ),
    booking = resource.data?.booking;
  const [reason, setReason] = useState(''),
    [reasonDraft, setReasonDraft] = useState<string | null>(null),
    [scheduleDraft, setScheduleDraft] = useState<{
      bookingId: number;
      preferredDate: string;
      timeSlot: string;
    } | null>(null),
    [travelDraft, setTravelDraft] = useState<{
      bookingId: number;
      travelBufferMinutes: string;
      trafficNote: string;
    } | null>(null),
    [dispatchMode, setDispatchMode] = useState<'automatic' | 'manual'>(
      'automatic',
    ),
    [selectedTechnicianId, setSelectedTechnicianId] = useState<number | null>(
      null,
    ),
    [busy, setBusy] = useState(''),
    [error, setError] = useState('');
  const pending = useRef<{ type: string; requestId: string } | null>(null);
  const schedule =
      scheduleDraft?.bookingId === bookingId
        ? scheduleDraft
        : booking
          ? {
              bookingId,
              preferredDate: calendarDate(booking.preferredDate),
              timeSlot: canonicalTimeSlot(booking.timeSlot),
            }
          : { bookingId, preferredDate: '', timeSlot: '' },
    canEditSchedule = Boolean(
      booking && ['Submitted', 'Confirmed'].includes(booking.status),
    ),
    scheduleDirty = Boolean(
      booking &&
      (schedule.preferredDate !== calendarDate(booking.preferredDate) ||
        schedule.timeSlot !== canonicalTimeSlot(booking.timeSlot)),
    ),
    scheduleError = schedule.preferredDate
      ? bookingDateError(schedule.preferredDate)
      : 'Choose a service date.';
  const travel =
      travelDraft?.bookingId === bookingId
        ? travelDraft
        : {
            bookingId,
            travelBufferMinutes: String(booking?.travelBufferMinutes ?? 30),
            trafficNote: booking?.trafficNote ?? '',
          },
    canEditTravel = Boolean(
      booking &&
      ['Submitted', 'Confirmed', 'Awaiting return arrangement'].includes(
        booking.status,
      ),
    ),
    travelMinutes = Number(travel.travelBufferMinutes),
    travelError =
      !Number.isInteger(travelMinutes) ||
      travelMinutes < 0 ||
      travelMinutes > 180
        ? 'Enter a whole number from 0 to 180 minutes.'
        : '',
    travelDirty = Boolean(
      booking &&
      (travelMinutes !== Number(booking.travelBufferMinutes ?? 30) ||
        travel.trafficNote !== (booking.trafficNote ?? '')),
    );
  const dispatchAction =
    booking?.status === 'Confirmed'
      ? 'dispatch'
      : booking?.status === 'Assigned' &&
          booking.assignments[0]?.workStatus === 'Assigned'
        ? 'redispatch'
        : null;
  const dispatchOptions = useResource<DispatchOptions>(
    dispatchAction ? `/admin/bookings/${bookingId}/dispatch-options` : null,
    version,
  );
  const selectedTechnician = dispatchOptions.data?.technicians.find(
    (technician) => technician.technicianId === selectedTechnicianId,
  );
  useEffect(() => {
    setDirty(
      scheduleDirty ||
        travelDirty ||
        (reasonDraft !== null && reasonDraft !== booking?.rejectionReason),
    );
    return () => setDirty(false);
  }, [
    scheduleDirty,
    travelDirty,
    reasonDraft,
    booking?.rejectionReason,
    setDirty,
  ]);
  async function action(
    type: 'approve' | 'reject' | 'dispatch' | 'redispatch',
  ) {
    if (scheduleDirty || travelDirty) {
      setError(
        'Save or discard the appointment and travel-plan changes before reviewing or dispatching this booking.',
      );
      return;
    }
    if (type === 'reject' && reason.trim().length < 3) {
      setError('Enter a clear rejection reason for the customer.');
      return;
    }
    const isDispatch = type === 'dispatch' || type === 'redispatch';
    if (
      isDispatch &&
      dispatchMode === 'manual' &&
      (!selectedTechnicianId || !selectedTechnician?.eligible)
    ) {
      setError('Choose an available technician for manual dispatch.');
      return;
    }
    const requestType = isDispatch
      ? `${type}:${dispatchMode}:${selectedTechnicianId ?? 'automatic'}`
      : type;
    setBusy(type);
    setError('');
    if (pending.current?.type !== requestType)
      pending.current = { type: requestType, requestId: crypto.randomUUID() };
    try {
      const result = await api<{ technician?: { fullName: string } }>(
        `/admin/bookings/${bookingId}/${type}`,
        'POST',
        {
          requestId: pending.current.requestId,
          ...(type === 'reject' ? { reason: reason.trim() } : {}),
          ...(isDispatch
            ? {
                mode: dispatchMode,
                ...(dispatchMode === 'manual'
                  ? { technicianId: selectedTechnicianId }
                  : {}),
              }
            : {}),
        },
      );
      pending.current = null;
      setReason('');
      setSelectedTechnicianId(null);
      notify(
        type === 'dispatch' || type === 'redispatch'
          ? `Assigned to ${result.technician?.fullName}. Customer email queued.`
          : `Booking ${type === 'approve' ? 'approved' : 'rejected'}. No customer email was sent.`,
      );
      refresh();
    } catch (cause) {
      setError(errorText(cause));
      if (isDispatch && dispatchMode === 'manual') dispatchOptions.reload();
      if (cause instanceof ApiError && cause.status < 500)
        pending.current = null;
    } finally {
      setBusy('');
    }
  }
  async function saveRejectionReason() {
    const newReason = (reasonDraft ?? booking?.rejectionReason ?? '').trim();
    if (!booking || newReason.length < 3 || busy) return;
    const requestType =
      'rejection-reason:' +
      bookingId +
      ':' +
      booking.rejectionVersion +
      ':' +
      newReason;
    if (pending.current?.type !== requestType)
      pending.current = { type: requestType, requestId: crypto.randomUUID() };
    setBusy('reason');
    setError('');
    try {
      await api('/admin/bookings/' + bookingId + '/rejection-reason', 'PATCH', {
        requestId: pending.current.requestId,
        version: booking.rejectionVersion,
        reason: newReason,
      });
      pending.current = null;
      setReasonDraft(null);
      notify(
        'Rejection reason updated. The customer can see the revised explanation.',
      );
      refresh();
    } catch (cause) {
      setError(errorText(cause));
      if (cause instanceof ApiError && cause.status < 500)
        pending.current = null;
    } finally {
      setBusy('');
    }
  }
  async function saveSchedule() {
    if (!canEditSchedule || !scheduleDirty) return;
    if (scheduleError) {
      setError(scheduleError);
      return;
    }
    const requestType = `reschedule:${schedule.preferredDate}:${schedule.timeSlot}`;
    setBusy('reschedule');
    setError('');
    if (pending.current?.type !== requestType)
      pending.current = { type: requestType, requestId: crypto.randomUUID() };
    try {
      await api(`/admin/bookings/${bookingId}/reschedule`, 'PATCH', {
        requestId: pending.current.requestId,
        preferredDate: schedule.preferredDate,
        timeSlot: schedule.timeSlot,
      });
      pending.current = null;
      setScheduleDraft(null);
      setDirty(false);
      notify('Appointment updated. No customer email was sent.');
      refresh();
    } catch (cause) {
      setError(errorText(cause));
      if (cause instanceof ApiError && cause.status < 500)
        pending.current = null;
    } finally {
      setBusy('');
    }
  }
  async function saveTravelPlan() {
    if (!canEditTravel || !travelDirty || travelError) return;
    const requestType = `travel-plan:${travelMinutes}:${travel.trafficNote}`;
    setBusy('travel-plan');
    setError('');
    if (pending.current?.type !== requestType)
      pending.current = { type: requestType, requestId: crypto.randomUUID() };
    try {
      await api(`/admin/bookings/${bookingId}/travel-plan`, 'PATCH', {
        requestId: pending.current.requestId,
        travelBufferMinutes: travelMinutes,
        trafficNote: travel.trafficNote.trim(),
      });
      pending.current = null;
      setTravelDraft(null);
      setDirty(false);
      notify('Travel plan updated and recorded in the booking timeline.');
      refresh();
    } catch (cause) {
      setError(errorText(cause));
      if (cause instanceof ApiError && cause.status < 500)
        pending.current = null;
    } finally {
      setBusy('');
    }
  }
  return (
    <>
      <Button
        variant="ghost"
        onClick={() =>
          go(
            booking?.status === 'Confirmed'
              ? '/admin/dispatch'
              : '/admin/orders',
          )
        }
      >
        ← Back to orders
      </Button>
      <LoadState {...resource} />
      {booking && (
        <>
          <Heading
            eyebrow={`BOOKING / BK-${String(booking.bookingId).padStart(4, '0')}`}
            title={`${booking.customerName} · ${booking.serviceName}`}
            description={`${displayDate(booking.preferredDate)} · ${displayServiceTime(booking)}`}
            actions={<BookingStatus status={booking.status} />}
          />
          <div className="admin-detail-grid">
            <section className="panel">
              <h2>Request details</h2>
              {booking.status === 'Submitted' && (
                <p className="mt-3 flex items-center gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-800">
                  <AlertCircle className="size-4 shrink-0" />
                  {booking.expiresAt
                    ? 'Confirmation deadline: ' +
                      displayExpiry(booking.expiresAt)
                    : 'Awaiting confirmation. This existing request has no expiry deadline.'}
                </p>
              )}
              {booking.status === 'Expired' && (
                <p className="notice mt-3">
                  The confirmation deadline passed. This request no longer
                  reserves capacity. The customer can make a new booking.
                </p>
              )}
              <dl className="data-list">
                <div>
                  <dt>Customer</dt>
                  <dd>
                    {booking.customerName}
                    <small className="block muted">
                      {booking.email}
                      {booking.phone ? ` · ${booking.phone}` : ''}
                    </small>
                  </dd>
                </div>
                <div>
                  <dt>Service address</dt>
                  <dd>
                    {booking.addressLine}
                    {booking.postalCode ? `, ${booking.postalCode}` : ''}
                  </dd>
                </div>
                <div>
                  <dt>Service</dt>
                  <dd>
                    {booking.serviceName} · {booking.numberOfUnits} AC unit(s)
                  </dd>
                </div>
                <div>
                  <dt>Estimate</dt>
                  <dd>{money(booking.totalAmount)}</dd>
                </div>
                <div>
                  <dt>Reported issue</dt>
                  <dd>
                    {booking.problemDescription ||
                      'No additional notes provided.'}
                  </dd>
                </div>
                <div>
                  <dt>Other remarks</dt>
                  <dd>
                    {booking.otherRemarks ||
                      'No preferences or access notes provided.'}
                  </dd>
                </div>
                <div>
                  <dt>Estimated service duration</dt>
                  <dd>
                    {booking.estimatedDurationMinutes
                      ? booking.estimatedDurationMinutes + ' minutes'
                      : 'Not recorded'}
                  </dd>
                </div>
              </dl>
              <div className="admin-schedule-editor">
                <div>
                  <h3 className="font-semibold">Appointment schedule</h3>
                  <p className="mt-1 text-sm muted">
                    {canEditSchedule
                      ? 'Adjust the date or service time before dispatch. The customer is emailed only after a technician is assigned.'
                      : 'The appointment is locked after dispatch.'}
                  </p>
                </div>
                <div className="admin-schedule-fields">
                  <div className="block text-sm font-semibold">
                    <span>Service date</span>
                    <EnglishDatePicker
                      label="Service date"
                      min={earliestBookingDate()}
                      value={schedule.preferredDate}
                      disabled={!canEditSchedule || Boolean(busy)}
                      aria-invalid={Boolean(scheduleDirty && scheduleError)}
                      onChange={(preferredDate) => {
                        setScheduleDraft({
                          bookingId,
                          preferredDate,
                          timeSlot: schedule.timeSlot,
                        });
                        setError('');
                      }}
                      className="mt-2"
                    />
                  </div>
                  <label className="block text-sm font-semibold">
                    Service time
                    <NativeSelect
                      className="mt-2 h-12 w-full"
                      value={schedule.timeSlot}
                      disabled={!canEditSchedule || Boolean(busy)}
                      onChange={(event) => {
                        setScheduleDraft({
                          bookingId,
                          preferredDate: schedule.preferredDate,
                          timeSlot: event.target.value,
                        });
                        setError('');
                      }}
                    >
                      {timeSlots.map((slot) => (
                        <option
                          key={slot.value}
                          value={slot.value}
                          disabled={
                            !fitsWorkingHours(
                              slot.value,
                              booking.estimatedDurationMinutes,
                            )
                          }
                        >
                          {!canEditSchedule &&
                          slot.value === canonicalTimeSlot(booking.timeSlot)
                            ? displayServiceTime(booking)
                            : formatServiceWindow(
                                slot.value,
                                booking.estimatedDurationMinutes ?? undefined,
                              )}
                          {fitsWorkingHours(
                            slot.value,
                            booking.estimatedDurationMinutes,
                          )
                            ? ''
                            : ' · Ends after 6:00 PM'}
                        </option>
                      ))}
                    </NativeSelect>
                  </label>
                </div>
                {canEditSchedule && (
                  <div className="actions">
                    <Button
                      variant="outline"
                      disabled={
                        Boolean(busy) ||
                        !scheduleDirty ||
                        Boolean(scheduleError)
                      }
                      onClick={saveSchedule}
                    >
                      <CalendarDays />
                      {busy === 'reschedule'
                        ? 'Saving appointment…'
                        : 'Save appointment'}
                    </Button>
                    {scheduleDirty && (
                      <Button
                        variant="ghost"
                        disabled={Boolean(busy)}
                        onClick={() => {
                          setScheduleDraft(null);
                          setError('');
                        }}
                      >
                        Discard changes
                      </Button>
                    )}
                    {scheduleDirty && scheduleError && (
                      <p
                        className="basis-full text-sm text-red-700"
                        role="alert"
                      >
                        {scheduleError}
                      </p>
                    )}
                  </div>
                )}
              </div>
              <div className="admin-schedule-editor mt-5">
                <div>
                  <h3 className="font-semibold">Travel and traffic plan</h3>
                  <p className="mt-1 text-sm muted">
                    Every booking starts with a 30-minute travel allowance.
                    Adjust it for expected traffic, parking or building access
                    before dispatch. This time blocks adjacent technician work.
                  </p>
                </div>
                <div className="admin-schedule-fields">
                  <label
                    htmlFor={`travel-buffer-${bookingId}`}
                    className="block text-sm font-semibold"
                  >
                    Travel buffer (minutes)
                    <Input
                      id={`travel-buffer-${bookingId}`}
                      className="mt-2 h-12"
                      type="number"
                      min={0}
                      max={180}
                      step={5}
                      value={travel.travelBufferMinutes}
                      disabled={!canEditTravel || Boolean(busy)}
                      aria-invalid={Boolean(travelDirty && travelError)}
                      onChange={(event) => {
                        setTravelDraft({
                          ...travel,
                          travelBufferMinutes: event.target.value,
                        });
                        setError('');
                      }}
                    />
                  </label>
                  <label
                    htmlFor={`traffic-note-${bookingId}`}
                    className="block text-sm font-semibold"
                  >
                    Traffic and access note
                    <Textarea
                      id={`traffic-note-${bookingId}`}
                      className="mt-2 min-h-20"
                      maxLength={500}
                      value={travel.trafficNote}
                      disabled={!canEditTravel || Boolean(busy)}
                      onChange={(event) => {
                        setTravelDraft({
                          ...travel,
                          trafficNote: event.target.value,
                        });
                        setError('');
                      }}
                      placeholder="e.g. Peak-hour traffic; allow time for visitor parking."
                    />
                  </label>
                </div>
                {canEditTravel ? (
                  <div className="actions">
                    <Button
                      variant="outline"
                      disabled={
                        Boolean(busy) || !travelDirty || Boolean(travelError)
                      }
                      onClick={saveTravelPlan}
                    >
                      {busy === 'travel-plan'
                        ? 'Saving travel plan…'
                        : 'Save travel plan'}
                    </Button>
                    {travelDirty && (
                      <Button
                        variant="ghost"
                        disabled={Boolean(busy)}
                        onClick={() => {
                          setTravelDraft(null);
                          setError('');
                        }}
                      >
                        Discard changes
                      </Button>
                    )}
                    {travelDirty && travelError && (
                      <p
                        className="basis-full text-sm text-red-700"
                        role="alert"
                      >
                        {travelError}
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="text-sm muted">
                    The recorded travel plan is locked after dispatch or
                    closure.
                  </p>
                )}
              </div>
              {booking.status === 'Submitted' && (
                <div className="mt-6 space-y-3">
                  <div className="actions">
                    <Button
                      disabled={Boolean(busy) || scheduleDirty || travelDirty}
                      onClick={() => action('approve')}
                    >
                      <CheckCircle2 />
                      {busy === 'approve' ? 'Approving…' : 'Approve booking'}
                    </Button>
                  </div>
                  <label
                    htmlFor="booking-rejection-reason"
                    className="block text-sm font-semibold"
                  >
                    Rejection reason
                    <Textarea
                      id="booking-rejection-reason"
                      className="mt-2 min-h-24"
                      value={reason}
                      maxLength={500}
                      onChange={(event) => setReason(event.target.value)}
                      placeholder="Explain why this request cannot be approved. The customer will see this message."
                    />
                  </label>
                  <Button
                    variant="destructive"
                    disabled={
                      Boolean(busy) ||
                      scheduleDirty ||
                      travelDirty ||
                      reason.trim().length < 3
                    }
                    onClick={() => action('reject')}
                  >
                    <XCircle />
                    {busy === 'reject' ? 'Rejecting…' : 'Reject booking'}
                  </Button>
                </div>
              )}
              {booking.status === 'Rejected' && (
                <div className="mt-6 space-y-3">
                  <label
                    htmlFor={`rejection-reason-${bookingId}`}
                    className="block text-sm font-semibold"
                  >
                    Rejection reason
                    <Textarea
                      id={`rejection-reason-${bookingId}`}
                      className="mt-2 min-h-24"
                      value={reasonDraft ?? booking.rejectionReason ?? ''}
                      maxLength={500}
                      onChange={(event) => setReasonDraft(event.target.value)}
                    />
                  </label>
                  <p className="text-sm muted">
                    The customer sees this reason. Every correction remains in
                    the status timeline.
                  </p>
                  <Button
                    disabled={
                      Boolean(busy) ||
                      (reasonDraft ?? '').trim().length < 3 ||
                      reasonDraft === booking.rejectionReason
                    }
                    onClick={saveRejectionReason}
                  >
                    {busy === 'reason' ? 'Saving…' : 'Save rejection reason'}
                  </Button>
                  {reasonDraft !== null && (
                    <Button
                      variant="ghost"
                      disabled={Boolean(busy)}
                      onClick={() => setReasonDraft(null)}
                    >
                      Discard changes
                    </Button>
                  )}
                </div>
              )}
              {dispatchAction && (
                <div className="dispatch-control mt-6 rounded-xl border border-primary/20 bg-primary/5 p-4">
                  <h3 className="font-semibold">
                    {dispatchAction === 'redispatch'
                      ? 'Reassign technician'
                      : 'Dispatch technician'}
                  </h3>
                  <p className="mt-1 text-sm muted">
                    Choose postal-area assignment or manually select an eligible
                    technician. The {booking.travelBufferMinutes ?? 30}-minute
                    travel allowance blocks adjacent work. The customer email is
                    queued only after the assignment succeeds.
                  </p>
                  {booking.trafficNote && (
                    <p className="mt-3 rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm text-orange-900">
                      <strong>Traffic/access note:</strong>{' '}
                      {booking.trafficNote}
                    </p>
                  )}
                  <fieldset className="dispatch-mode-switch mt-4">
                    <legend className="sr-only">Dispatch method</legend>
                    <Button
                      type="button"
                      size="sm"
                      variant={
                        dispatchMode === 'automatic' ? 'default' : 'outline'
                      }
                      aria-pressed={dispatchMode === 'automatic'}
                      disabled={Boolean(busy)}
                      onClick={() => {
                        setDispatchMode('automatic');
                        setError('');
                      }}
                    >
                      Automatic
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={
                        dispatchMode === 'manual' ? 'default' : 'outline'
                      }
                      aria-pressed={dispatchMode === 'manual'}
                      disabled={Boolean(busy)}
                      onClick={() => {
                        setDispatchMode('manual');
                        setError('');
                      }}
                    >
                      Manual
                    </Button>
                  </fieldset>
                  {dispatchMode === 'automatic' ? (
                    <div className="mt-3 rounded-lg border bg-white p-3 text-sm">
                      <p className="font-medium">
                        Available technicians are ranked by postal area, known
                        travel labour cost, then workload.
                      </p>
                      <p className="muted">
                        Uses the previous visit that day, or the
                        technician&apos;s base postal code. Postal-sector
                        matching is an area estimate, not travel distance or
                        live GPS.
                      </p>
                      <LoadState {...dispatchOptions} />
                      {dispatchOptions.data?.technicians
                        .filter((tech) => tech.eligible)
                        .slice(0, 3)
                        .map((tech) => (
                          <p key={tech.technicianId} className="mt-2">
                            <strong>{tech.fullName}</strong> ·{' '}
                            {tech.proximity?.label ?? 'Location unavailable'} ·{' '}
                            {tech.dailyJobs} active job(s)
                            <small className="block muted">
                              {tech.proximity?.origin}
                              {tech.proximity?.originPostalCode
                                ? ' · ' + tech.proximity.originPostalCode
                                : ''}
                            </small>
                            <small className="block muted">
                              {tech.travelPlan?.bufferMinutes ?? 30} min planned
                              travel ·{' '}
                              {tech.travelPlan?.estimatedLaborCost == null
                                ? 'Labour rate not recorded'
                                : `${money(tech.travelPlan.estimatedLaborCost)} travel labour`}
                            </small>
                          </p>
                        ))}
                    </div>
                  ) : (
                    <div className="mt-4">
                      <LoadState {...dispatchOptions} />
                      {dispatchOptions.data &&
                        (dispatchOptions.data.technicians.length ? (
                          <div
                            className="manual-dispatch-list"
                            role="radiogroup"
                            aria-label="Choose technician"
                          >
                            {dispatchOptions.data.technicians.map(
                              (technician) => (
                                <label
                                  className="manual-dispatch-option"
                                  data-disabled={!technician.eligible}
                                  key={technician.technicianId}
                                >
                                  <input
                                    type="radio"
                                    name={`dispatch-technician-${bookingId}`}
                                    value={technician.technicianId}
                                    checked={
                                      selectedTechnicianId ===
                                      technician.technicianId
                                    }
                                    disabled={
                                      !technician.eligible || Boolean(busy)
                                    }
                                    onChange={() => {
                                      setSelectedTechnicianId(
                                        technician.technicianId,
                                      );
                                      setError('');
                                    }}
                                  />
                                  <span>
                                    <strong>{technician.fullName}</strong>
                                    <small>
                                      {technician.email} ·{' '}
                                      {technician.availability} ·{' '}
                                      {technician.dailyJobs} active job(s) that
                                      day
                                    </small>
                                    <small className="flex items-center gap-1">
                                      <MapPin className="size-3" />
                                      {technician.proximity?.label ??
                                        'Location unavailable'}{' '}
                                      · {technician.proximity?.origin}
                                      {technician.proximity?.originPostalCode
                                        ? ' ' +
                                          technician.proximity.originPostalCode
                                        : ''}
                                    </small>
                                    <small>
                                      {technician.travelPlan?.bufferMinutes ??
                                        30}{' '}
                                      min planned travel ·{' '}
                                      {technician.travelPlan
                                        ?.estimatedLaborCost == null
                                        ? 'Labour rate not recorded'
                                        : `${money(technician.travelPlan.estimatedLaborCost)} travel labour`}
                                    </small>
                                    {!technician.eligible && (
                                      <small className="manual-dispatch-reason">
                                        {technician.reason}
                                      </small>
                                    )}
                                  </span>
                                </label>
                              ),
                            )}
                          </div>
                        ) : (
                          <p className="notice error">
                            No technician accounts are available.
                          </p>
                        ))}
                    </div>
                  )}
                  <Button
                    className="mt-4"
                    disabled={
                      Boolean(busy) ||
                      scheduleDirty ||
                      travelDirty ||
                      (dispatchMode === 'manual' &&
                        (!selectedTechnician?.eligible ||
                          dispatchOptions.loading))
                    }
                    onClick={() => action(dispatchAction)}
                  >
                    {dispatchAction === 'redispatch' ? <RefreshCw /> : <Send />}
                    {busy === dispatchAction
                      ? dispatchAction === 'redispatch'
                        ? 'Reassigning…'
                        : 'Assigning…'
                      : dispatchMode === 'manual'
                        ? dispatchAction === 'redispatch'
                          ? 'Reassign selected technician'
                          : 'Assign selected technician'
                        : dispatchAction === 'redispatch'
                          ? 'Automatically redispatch'
                          : 'Automatically assign technician'}
                  </Button>
                </div>
              )}
              {error && (
                <p className="notice error" role="alert">
                  {error}
                </p>
              )}
            </section>
            <section className="panel">
              <h2>Status timeline</h2>
              <ol className="admin-timeline">
                {booking.timeline.map((item) => (
                  <li key={item.historyId}>
                    <span />
                    <div>
                      <strong>{item.status}</strong>
                      <small>
                        {displayMoment(item.changedAt)}
                        {item.changedBy ? ` · ${item.changedBy}` : ''}
                      </small>
                      <p>{item.note || 'No note recorded.'}</p>
                    </div>
                  </li>
                ))}
              </ol>
              {booking.reports?.map((report) => (
                <section key={report.reportId} className="mt-7 space-y-2">
                  <h2>Service report</h2>
                  <h3>Service process photos</h3>
                  <ServicePhotoGallery photos={report.photos || []} />
                  <p>
                    <strong>Work performed:</strong> {report.workPerformed}
                  </p>
                  <p>
                    <strong>Problem found:</strong>{' '}
                    {report.problemFound || 'Not recorded'}
                  </p>
                  <p>
                    <strong>Solution:</strong>{' '}
                    {report.solutionApplied || 'Not recorded'}
                  </p>
                  <p>
                    <strong>Checks completed:</strong>{' '}
                    {report.checklist || 'Not recorded'}
                  </p>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <section>
                      <h3>Customer signature</h3>
                      <SignatureImage
                        url={report.customerSignatureUrl}
                        label="Customer signature"
                      />
                    </section>
                    <section>
                      <h3>Technician signature</h3>
                      <SignatureImage
                        url={report.technicianSignatureUrl}
                        label="Technician signature"
                      />
                    </section>
                  </div>
                  <p>
                    Started:{' '}
                    {report.startedAt
                      ? displayMoment(report.startedAt)
                      : 'Not recorded'}{' '}
                    · Completed:{' '}
                    {report.completedAt
                      ? displayMoment(report.completedAt)
                      : 'Not recorded'}
                  </p>
                </section>
              ))}
              {booking.assignments.length > 0 && (
                <>
                  <h2 className="mt-7">Assignments</h2>
                  <ul className="tech-detail-list">
                    {booking.assignments.map((item) => (
                      <li key={item.assignmentId}>
                        <strong>{item.technicianName}</strong> ·{' '}
                        {item.workStatus}
                        <small>
                          WO-{String(item.jobId).padStart(4, '0')} ·{' '}
                          {item.status}
                        </small>
                        {item.progress && (
                          <div className="mt-3 space-y-2 rounded-lg border p-3 text-sm">
                            {item.progress.extensionMinutes > 0 && (
                              <p>
                                <strong>Service extended:</strong>{' '}
                                {item.progress.extensionMinutes} minutes ·
                                Expected end{' '}
                                {item.progress.expectedEndTime ||
                                  'Not recorded'}
                              </p>
                            )}
                            {item.progress.followUpStatus !== 'None' && (
                              <p>
                                <strong>Return visit:</strong>{' '}
                                {item.progress.followUpStatus}
                                {item.progress.followUpDate
                                  ? ' · ' +
                                    displayDate(item.progress.followUpDate)
                                  : ''}
                                {item.progress.followUpStart
                                  ? ' · ' +
                                    item.progress.followUpStart +
                                    ' – ' +
                                    item.progress.followUpEnd
                                  : ''}
                              </p>
                            )}
                            {item.progress.additionalRepairFee > 0 && (
                              <p>
                                <strong>Additional repair fee:</strong>{' '}
                                {money(item.progress.additionalRepairFee)}
                                <small className="block muted">
                                  {item.progress.repairQuoteNote}
                                </small>
                              </p>
                            )}
                            {item.progress.events?.map((event) => (
                              <p key={event.id}>
                                <strong>{event.kind}:</strong> {event.reason} ·{' '}
                                {event.notes}
                                {event.partNotes
                                  ? ' · Parts: ' + event.partNotes
                                  : ''}
                                <small className="block muted">
                                  {displayMoment(event.createdAt)}
                                </small>
                              </p>
                            ))}
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>
          </div>
        </>
      )}
    </>
  );
}

export function StaffPage({ role }: { role: 'Admin' | 'Technician' }) {
  const { user, version, refresh, notify } = useInventory(),
    resource = useResource<{ rows: StaffMember[] }>(
      role === 'Admin' ? '/admin/admins' : '/admin/technicians',
      version,
    );
  const [form, setForm] = useState({ fullName: '', email: '', phone: '' }),
    [busy, setBusy] = useState(false),
    [rowBusy, setRowBusy] = useState(''),
    [postalDrafts, setPostalDrafts] = useState<Record<number, string>>({}),
    [laborCostDrafts, setLaborCostDrafts] = useState<Record<number, string>>(
      {},
    ),
    [error, setError] = useState('');
  async function invite(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api(
        `/admin/${role === 'Admin' ? 'admins' : 'technicians'}/invitations`,
        'POST',
        form,
      );
      setForm({ fullName: '', email: '', phone: '' });
      notify(`${role} invitation queued.`);
      refresh();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }
  async function updateMember(
    member: StaffMember,
    patch: {
      availability?: string;
      accountStatus?: string;
      basePostalCode?: string;
      hourlyLaborCost?: number | null;
    },
  ) {
    const key = `update-${member.userId}`;
    setRowBusy(key);
    setError('');
    try {
      await api(
        role === 'Admin'
          ? `/admin/admins/${member.userId}`
          : `/admin/technicians/${member.technicianId}`,
        'PATCH',
        patch,
      );
      setPostalDrafts((current) => {
        const next = { ...current };
        delete next[member.userId];
        return next;
      });
      setLaborCostDrafts((current) => {
        const next = { ...current };
        delete next[member.userId];
        return next;
      });
      notify(`${member.fullName} updated.`);
      refresh();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setRowBusy('');
    }
  }
  async function resend(member: StaffMember) {
    const key = `resend-${member.userId}`;
    setRowBusy(key);
    setError('');
    try {
      await api(
        `/admin/${role === 'Admin' ? 'admins' : 'technicians'}/invitations`,
        'POST',
        {
          fullName: member.fullName,
          email: member.email,
          phone: member.phone ?? '',
        },
      );
      notify(`A new ${role.toLowerCase()} invitation was queued.`);
      refresh();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setRowBusy('');
    }
  }
  async function revoke(member: StaffMember) {
    if (!member.invitationId) return;
    const key = `revoke-${member.userId}`;
    setRowBusy(key);
    setError('');
    try {
      await api(`/admin/invitations/${member.invitationId}/revoke`, 'POST', {});
      notify(`Invitation for ${member.fullName} revoked.`);
      refresh();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setRowBusy('');
    }
  }
  async function transfer(member: StaffMember) {
    setError('');
    try {
      await api('/admin/owner/transfer', 'POST', {
        targetUserId: member.userId,
      });
      notify(
        `Ownership transferred to ${member.fullName}. Sign in again to refresh permissions.`,
      );
      window.location.assign('/admin/orders');
    } catch (cause) {
      setError(errorText(cause));
    }
  }
  return (
    <>
      <Heading
        eyebrow={`TEAM / ${role.toUpperCase()}S`}
        title={role === 'Admin' ? 'Administrators' : 'Technicians'}
        description={
          role === 'Admin'
            ? 'Owner-managed administrative access.'
            : 'Invite field staff and manage their availability.'
        }
      />
      <div className="admin-staff-grid">
        <section className="panel">
          <h2>Invite {role.toLowerCase()}</h2>
          <p className="muted mt-1 text-sm">
            A single-use activation email will expire after 48 hours.
          </p>
          <form className="mt-5" onSubmit={invite}>
            <label htmlFor="staff-full-name">
              Full name
              <Input
                id="staff-full-name"
                required
                maxLength={120}
                value={form.fullName}
                onChange={(event) =>
                  setForm({ ...form, fullName: event.target.value })
                }
              />
            </label>
            <label htmlFor="staff-work-email">
              Work email
              <Input
                id="staff-work-email"
                required
                type="email"
                maxLength={255}
                value={form.email}
                onChange={(event) =>
                  setForm({ ...form, email: event.target.value })
                }
              />
            </label>
            <label htmlFor="staff-phone">
              Phone
              <Input
                id="staff-phone"
                maxLength={30}
                value={form.phone}
                onChange={(event) =>
                  setForm({ ...form, phone: event.target.value })
                }
              />
            </label>
            {error && (
              <p role="alert" className="notice error">
                {error}
              </p>
            )}
            <Button type="submit" disabled={busy}>
              <Send />
              {busy ? 'Sending…' : 'Send invitation'}
            </Button>
          </form>
        </section>
        <section className="panel table-panel admin-operations-table">
          <LoadState {...resource} />
          {resource.data &&
            (resource.data.rows.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Staff member</TableHead>
                    <TableHead>Account</TableHead>
                    <TableHead>
                      {role === 'Admin' ? 'Access' : 'Availability'}
                    </TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {resource.data.rows.map((member) => {
                    const invitationOpen =
                      member.status === 'Inactive' &&
                      Boolean(member.invitationId) &&
                      !member.invitationAcceptedAt &&
                      !member.invitationRevokedAt;
                    const disabled = Boolean(rowBusy);
                    return (
                      <TableRow key={member.userId}>
                        <TableCell data-label="Staff member">
                          <strong>{member.fullName}</strong>
                          <small className="block muted">
                            {member.email}
                            {member.phone ? ` · ${member.phone}` : ''}
                          </small>
                          {role === 'Technician' && (
                            <small className="block muted">
                              {member.futureWorkOrders ?? 0} future work
                              order(s)
                            </small>
                          )}
                          {role === 'Technician' && (
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                              <label
                                htmlFor={`base-postal-${member.userId}`}
                                className="text-xs muted"
                              >
                                Base postal code
                                <Input
                                  id={`base-postal-${member.userId}`}
                                  className="mt-1 w-32"
                                  inputMode="numeric"
                                  maxLength={6}
                                  placeholder="e.g. 238839"
                                  value={
                                    postalDrafts[member.userId] ??
                                    member.basePostalCode ??
                                    ''
                                  }
                                  disabled={
                                    disabled || member.status === 'Inactive'
                                  }
                                  onChange={(event) =>
                                    setPostalDrafts({
                                      ...postalDrafts,
                                      [member.userId]: event.target.value,
                                    })
                                  }
                                />
                              </label>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={
                                  disabled ||
                                  postalDrafts[member.userId] === undefined ||
                                  (postalDrafts[member.userId] !== '' &&
                                    !/^\d{6}$/.test(
                                      postalDrafts[member.userId],
                                    ))
                                }
                                onClick={() =>
                                  void updateMember(member, {
                                    basePostalCode: postalDrafts[member.userId],
                                  })
                                }
                              >
                                Save location
                              </Button>
                              <label
                                htmlFor={`labor-cost-${member.userId}`}
                                className="text-xs muted"
                              >
                                Travel labour rate (SGD/hour)
                                <Input
                                  id={`labor-cost-${member.userId}`}
                                  className="mt-1 w-36"
                                  type="number"
                                  min={0}
                                  max={1000}
                                  step="0.50"
                                  placeholder="Not recorded"
                                  value={
                                    laborCostDrafts[member.userId] ??
                                    member.hourlyLaborCost ??
                                    ''
                                  }
                                  disabled={
                                    disabled || member.status === 'Inactive'
                                  }
                                  onChange={(event) =>
                                    setLaborCostDrafts({
                                      ...laborCostDrafts,
                                      [member.userId]: event.target.value,
                                    })
                                  }
                                />
                              </label>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={
                                  disabled ||
                                  laborCostDrafts[member.userId] ===
                                    undefined ||
                                  (laborCostDrafts[member.userId] !== '' &&
                                    (!Number.isFinite(
                                      Number(laborCostDrafts[member.userId]),
                                    ) ||
                                      Number(laborCostDrafts[member.userId]) <
                                        0 ||
                                      Number(laborCostDrafts[member.userId]) >
                                        1000))
                                }
                                onClick={() =>
                                  void updateMember(member, {
                                    hourlyLaborCost:
                                      laborCostDrafts[member.userId] === ''
                                        ? null
                                        : Number(
                                            laborCostDrafts[member.userId],
                                          ),
                                  })
                                }
                              >
                                Save labour rate
                              </Button>
                            </div>
                          )}
                        </TableCell>
                        <TableCell data-label="Account">
                          {member.status === 'Inactive' ? (
                            <>
                              <span>Inactive</span>
                              <small className="block muted">
                                {invitationOpen
                                  ? `Invitation expires ${displayMoment(member.invitationExpiresAt)}`
                                  : member.invitationRevokedAt
                                    ? 'Invitation revoked'
                                    : 'Invitation unavailable'}
                              </small>
                            </>
                          ) : (
                            <NativeSelect
                              aria-label={`Account status for ${member.fullName}`}
                              value={member.status}
                              disabled={
                                disabled || member.accessLevel === 'Owner'
                              }
                              onChange={(event) =>
                                void updateMember(member, {
                                  accountStatus: event.target.value,
                                })
                              }
                            >
                              <option value="Active">Active</option>
                              <option value="Suspended">Suspended</option>
                            </NativeSelect>
                          )}
                        </TableCell>
                        <TableCell
                          data-label={
                            role === 'Admin' ? 'Access' : 'Availability'
                          }
                        >
                          {role === 'Admin' ? (
                            member.accessLevel
                          ) : (
                            <NativeSelect
                              aria-label={`Availability for ${member.fullName}`}
                              value={member.availability}
                              disabled={disabled || member.status !== 'Active'}
                              onChange={(event) =>
                                void updateMember(member, {
                                  availability: event.target.value,
                                })
                              }
                            >
                              <option value="Available">Available</option>
                              <option value="Unavailable">Unavailable</option>
                              <option value="On Leave">On Leave</option>
                            </NativeSelect>
                          )}
                        </TableCell>
                        <TableCell data-label="Action">
                          <div className="actions justify-end">
                            {member.status === 'Inactive' && (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={disabled}
                                onClick={() => void resend(member)}
                              >
                                {rowBusy === `resend-${member.userId}`
                                  ? 'Sending…'
                                  : 'Resend'}
                              </Button>
                            )}
                            {invitationOpen && (
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={disabled}
                                onClick={() => void revoke(member)}
                              >
                                {rowBusy === `revoke-${member.userId}`
                                  ? 'Revoking…'
                                  : 'Revoke'}
                              </Button>
                            )}
                            {role === 'Admin' &&
                              user.access_level === 'Owner' &&
                              member.status === 'Active' &&
                              member.accessLevel !== 'Owner' && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={disabled}
                                  onClick={() => void transfer(member)}
                                >
                                  <ShieldCheck />
                                  Transfer ownership
                                </Button>
                              )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            ) : (
              <NoResults
                title={`No ${role.toLowerCase()} accounts`}
                description="Send the first invitation to create an account."
              />
            ))}
        </section>
      </div>
    </>
  );
}
