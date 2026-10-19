'use client';

import { useRef, useState } from 'react';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { NativeSelect } from '@/components/ui/native-select';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { EnglishDatePicker } from '@/components/english-date-picker';
import { LoadState, Pager } from '@/components/inventory-ui';
import {
  api,
  ApiError,
  errorText,
  useInventory,
  useResource,
  type AdminBookingDetail,
  type DispatchOptions,
  type List,
} from '@/lib/inventory-client';
import { earliestBookingDate, singaporeToday } from '@/lib/booking-schedule';
import { formatTimeSlot } from '@/lib/format';

const dayLabel = (date: string) =>
  new Intl.DateTimeFormat('en-SG', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(date.slice(0, 10) + 'T00:00:00Z'));
const momentLabel = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat('en-SG', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'Asia/Singapore',
      }).format(
        new Date(value.includes('T') ? value : value.replace(' ', 'T') + 'Z'),
      ) + ' SGT'
    : '—';
const shift = (date: string, days: number) => {
  const d = new Date(date.slice(0, 10) + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const monday = (date: string) =>
  shift(
    date,
    -((new Date(date.slice(0, 10) + 'T00:00:00Z').getUTCDay() + 6) % 7),
  );

export function WaitingDispatchControl({
  booking,
  disabled,
}: {
  booking: AdminBookingDetail;
  disabled: boolean;
}) {
  const { refresh, notify } = useInventory();
  const [open, setOpen] = useState(false),
    [reason, setReason] = useState(
      'Awaiting technician assignment or appointment coordination.',
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const pending = useRef<{ reason: string; requestId: string } | null>(null);
  async function save() {
    if (busy || reason.trim().length < 3) return;
    if (pending.current?.reason !== reason.trim())
      pending.current = {
        reason: reason.trim(),
        requestId: crypto.randomUUID(),
      };
    setBusy(true);
    setError('');
    try {
      await api(
        `/admin/bookings/${booking.bookingId}/waiting-dispatch`,
        'POST',
        pending.current,
      );
      pending.current = null;
      setOpen(false);
      notify('Added to waiting dispatch. The request deadline is unchanged.');
      refresh();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }
  if (booking.waitingSince)
    return (
      <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
        <strong>Waiting for dispatch</strong>
        <p>{booking.waitingReason}</p>
        <p>
          Queued {momentLabel(booking.waitingSince)}.{' '}
          {booking.expiresAt
            ? `Confirmation deadline: ${momentLabel(booking.expiresAt)}.`
            : 'No deadline on this existing request.'}
        </p>
      </div>
    );
  return (
    <>
      <Button
        className="mt-3"
        variant="outline"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        Move to waiting dispatch
      </Button>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!busy) setOpen(value);
        }}
      >
        <DialogContent>
          <DialogTitle>Move to waiting dispatch?</DialogTitle>
          <DialogDescription>
            The booking keeps its current status while waiting for an eligible
            technician. Its existing deadline remains in effect. No customer email
            is sent.
          </DialogDescription>
          <label htmlFor="waiting-dispatch-reason" className="grid gap-2">
            Reason
            <Textarea
              id="waiting-dispatch-reason"
              value={reason}
              maxLength={500}
              disabled={busy}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          {error && (
            <p role="alert" className="text-red-700">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button disabled={busy || reason.trim().length < 3} onClick={save}>
              {busy ? 'Saving…' : 'Add to queue'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

type Review = {
  status: 'Submitted' | 'Confirmed' | 'Assigned';
  date: string;
  timeSlot: string;
  travelBufferMinutes: number;
  technicianId: number;
};
type Confirmation = {
  requestId: string;
  mode: 'automatic' | 'manual';
  technicianId?: number;
  review: Review;
  technicianName: string;
};
export function DispatchReviewButton({
  booking,
  mode,
  technicianId,
  disabled,
  onReload,
}: {
  booking: AdminBookingDetail;
  mode: 'automatic' | 'manual';
  technicianId: number | null;
  disabled: boolean;
  onReload: () => void;
}) {
  const { refresh, notify } = useInventory();
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const redispatch = booking.status === 'Assigned';
  async function review() {
    setOpen(true);
    setError('');
    if (uncertain && confirmation) return;
    setBusy(true);
    setConfirmation(null);
    try {
      const options = await api<DispatchOptions>(
        `/admin/bookings/${booking.bookingId}/dispatch-options`,
      );
      const tech =
        mode === 'manual'
          ? options.technicians.find(
              (t) => t.technicianId === technicianId && t.eligible,
            )
          : options.technicians.find((t) => t.eligible);
      if (!tech)
        throw new Error(
          'No eligible technician is available. Refresh the booking and select another time or use the waiting queue.',
        );
      if (
        options.preferredDate !== booking.preferredDate.slice(0, 10) ||
        options.timeSlot !== booking.timeSlot ||
        options.travelBufferMinutes !== (booking.travelBufferMinutes ?? 30) ||
        options.status !== booking.status
      )
        throw new Error(
          'The booking changed. Close this review, refresh the booking and review the latest details.',
        );
      setConfirmation({
        requestId: crypto.randomUUID(),
        mode,
        ...(mode === 'manual' ? { technicianId: tech.technicianId } : {}),
        technicianName: tech.fullName,
        review: {
          status: options.status as Review['status'],
          date: options.preferredDate,
          timeSlot: options.timeSlot,
          travelBufferMinutes: options.travelBufferMinutes,
          technicianId: tech.technicianId,
        },
      });
    } catch (cause) {
      setError(errorText(cause));
      onReload();
    } finally {
      setBusy(false);
    }
  }
  async function confirm() {
    if (!confirmation || busy) return;
    setBusy(true);
    setError('');
    const { technicianName, ...payload } = confirmation;
    try {
      await api(
        `/admin/bookings/${booking.bookingId}/${redispatch ? 'redispatch' : 'dispatch'}`,
        'POST',
        payload,
      );
      setUncertain(false);
      setConfirmation(null);
      setOpen(false);
      notify(`Assigned to ${technicianName}. Customer email queued.`);
      refresh();
    } catch (cause) {
      setError(errorText(cause));
      const unresolved = !(cause instanceof ApiError && cause.status < 500);
      setUncertain(unresolved);
      if (!unresolved) {
        setConfirmation(null);
        onReload();
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Button disabled={disabled || busy} onClick={review}>
        {redispatch ? 'Review reassignment' : 'Review and confirm dispatch'}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!busy) setOpen(value);
        }}
      >
        <DialogContent className="sm:max-w-lg max-h-[90dvh] overflow-y-auto">
          <DialogTitle>
            {redispatch
              ? 'Final reassignment confirmation'
              : 'Final dispatch confirmation'}
          </DialogTitle>
          <DialogDescription>
            Check the appointment and technician before confirming.
          </DialogDescription>
          {busy && !confirmation && (
            <output>Checking current availability…</output>
          )}
          {confirmation && (
            <dl className="grid gap-3 text-sm">
              <div>
                <dt className="muted">Booking / customer</dt>
                <dd>
                  BK-{String(booking.bookingId).padStart(4, '0')} ·{' '}
                  {booking.customerName}
                </dd>
              </div>
              <div>
                <dt className="muted">Service / address</dt>
                <dd>
                  {booking.serviceName} · {booking.addressLine}
                </dd>
              </div>
              <div>
                <dt className="muted">Appointment (Singapore time)</dt>
                <dd>
                  {dayLabel(confirmation.review.date)} ·{' '}
                  {formatTimeSlot(
                    booking.slotStart && booking.slotEnd
                      ? `${booking.slotStart.slice(0, 5)} - ${booking.slotEnd.slice(0, 5)}`
                      : confirmation.review.timeSlot,
                  )}
                </dd>
              </div>
              <div>
                <dt className="muted">Technician</dt>
                <dd>
                  {confirmation.technicianName} ·{' '}
                  {confirmation.mode === 'automatic'
                    ? 'Automatic recommendation'
                    : 'Selected by Admin'}
                </dd>
              </div>
              <div>
                <dt className="muted">Travel allowance</dt>
                <dd>{confirmation.review.travelBufferMinutes} minutes</dd>
              </div>
            </dl>
          )}
          <p className="rounded-lg bg-blue-50 p-3 text-sm">
            {redispatch
              ? 'The old assignment is replaced only if the new assignment succeeds. '
              : ''}
            A successful assignment queues one customer notification to{' '}
            {booking.email}.
          </p>
          {error && (
            <p role="alert" className="text-red-700">
              {error}
              {uncertain &&
                ' The result is not yet known. Retry this same confirmation to safely recover the result.'}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setOpen(false)}
            >
              Back
            </Button>
            <Button disabled={busy || !confirmation} onClick={confirm}>
              {busy
                ? 'Confirming…'
                : uncertain
                  ? 'Retry confirmation'
                  : 'Confirm assignment'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

type Planner = {
  week: string;
  days: Array<{
    date: string;
    closed: boolean;
    slots: Array<{
      code: string;
      start?: string;
      end?: string;
      available: boolean;
      reason: string | null;
      eligibleCount: number;
    }>;
  }>;
};
export function AdminPlanner({
  booking,
  disabled,
  onSelect,
}: {
  booking: AdminBookingDetail;
  disabled: boolean;
  onSelect: (date: string, slot: string) => void;
}) {
  const { version } = useInventory();
  const [expanded, setExpanded] = useState(false),
    [week, setWeek] = useState(() =>
      monday(
        [booking.preferredDate.slice(0, 10), earliestBookingDate()]
          .sort()
          .at(-1)!,
      ),
    );
  const resource = useResource<Planner>(
    expanded
      ? `/admin/bookings/${booking.bookingId}/planner?week=${week}`
      : null,
    version,
  );
  const [selected, setSelected] = useState('');
  return (
    <section className="mt-5 rounded-xl border p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold">Find an alternative appointment</h3>
          <p className="text-sm muted">
            A full week, with available business-hour starts. Selecting a time
            fills the appointment form for review.
          </p>
        </div>
        <Button
          variant="outline"
          disabled={disabled}
          onClick={() => setExpanded(!expanded)}
        >
          <CalendarDays />
          {expanded ? 'Hide planner' : 'Open weekly planner'}
        </Button>
      </div>
      {expanded && (
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="icon"
              variant="outline"
              aria-label="Previous planning week"
              onClick={() => setWeek(shift(week, -7))}
            >
              <ChevronLeft />
            </Button>
            <EnglishDatePicker
              label="Planning week"
              value={week}
              disableWeekends={false}
              onChange={(date) => setWeek(monday(date))}
            />
            <Button
              size="icon"
              variant="outline"
              aria-label="Next planning week"
              onClick={() => setWeek(shift(week, 7))}
            >
              <ChevronRight />
            </Button>
            <Button variant="outline" onClick={resource.reload}>
              <RefreshCw />
              Refresh availability
            </Button>
          </div>
          <LoadState {...resource} />
          {resource.data && (
            <div
              className="overflow-x-auto rounded-lg border"
              aria-label="Seven-day appointment availability"
            >
              <div className="grid min-w-[1120px] grid-cols-7 divide-x">
                {resource.data.days.map((day) => (
                  <section
                    key={day.date}
                    className={day.closed ? 'bg-slate-100' : 'bg-white'}
                  >
                    <h4 className="border-b p-3 text-sm font-semibold">
                      {dayLabel(day.date)}
                    </h4>
                    <p className="p-3 text-xs muted">00:00–09:00 · Closed</p>
                    {day.slots.map((slot, i) => (
                      <div key={slot.code}>
                        {i === 2 && (
                          <p className="p-3 text-xs muted">
                            13:00–14:00 · No appointment starts
                          </p>
                        )}
                        <div className="m-2 rounded-lg border p-2 text-sm">
                          <strong>
                            {formatTimeSlot(
                              slot.start && slot.end
                                ? `${slot.start.slice(0, 5)} - ${slot.end.slice(0, 5)}`
                                : slot.code,
                            )}
                          </strong>
                          <p className="my-2 text-xs">
                            {day.closed
                              ? 'Closed — weekend'
                              : slot.available
                                ? `${slot.eligibleCount} eligible technician(s)`
                                : slot.reason}
                          </p>
                          <Button
                            className="w-full"
                            size="sm"
                            variant="outline"
                            disabled={disabled || !slot.available || day.closed}
                            aria-pressed={selected === day.date + slot.code}
                            onClick={() => {
                              setSelected(day.date + slot.code);
                              onSelect(day.date, slot.code);
                            }}
                          >
                            {selected === day.date + slot.code
                              ? 'Selected'
                              : slot.available
                                ? 'Use this time'
                                : 'Unavailable'}
                          </Button>
                        </div>
                      </div>
                    ))}
                    <p className="p-3 text-xs muted">18:00–24:00 · Closed</p>
                  </section>
                ))}
              </div>
            </div>
          )}
          {selected && (
            <output className="text-sm text-blue-800">
              Appointment form updated. Review it and select Save appointment to
              apply the change.
            </output>
          )}
          <p className="text-xs muted">
            Availability includes service duration, travel allowance and current
            reservations. Saving and dispatching check availability again.
          </p>
        </div>
      )}
    </section>
  );
}

type EmailRow = {
  emailId: number;
  recipient: string;
  subject: string;
  status: string;
  deliveryMode: string;
  attempts: number;
  lastError: string | null;
  nextAttemptAt: string;
  sentAt: string | null;
  canRetry: boolean;
};
export function CustomerMailPanel({ bookingId }: { bookingId: number }) {
  const { version, notify, refresh } = useInventory(),
    resource = useResource<{ rows: EmailRow[] }>(
      `/admin/bookings/${bookingId}/emails`,
      version,
    );
  const [target, setTarget] = useState<EmailRow | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const requestId = useRef('');
  async function retry() {
    if (!target || busy) return;
    setBusy(true);
    setError('');
    try {
      await api(
        `/admin/bookings/${bookingId}/emails/${target.emailId}/retry`,
        'POST',
        { requestId: requestId.current },
      );
      setTarget(null);
      notify('Customer email retry queued.');
      resource.reload();
      refresh();
    } catch (cause) {
      setError(errorText(cause));
      resource.reload();
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel mt-6">
      <div className="flex flex-wrap justify-between gap-3">
        <div>
          <h2>Customer email status</h2>
          <p className="muted text-sm">
            Sent means accepted by the mail server; customer delivery or reading
            is not tracked. Local mode sends to the demo mailbox.
          </p>
        </div>
        <Button variant="outline" onClick={resource.reload}>
          <RefreshCw />
          Refresh email status
        </Button>
      </div>
      <LoadState {...resource} />
      {resource.data?.rows.length === 0 && (
        <p className="mt-4 muted">
          No assignment notification yet. Email is queued after a successful
          dispatch.
        </p>
      )}
      <div className="mt-4 grid gap-3">
        {resource.data?.rows.map((row) => (
          <article key={row.emailId} className="rounded-lg border p-4 text-sm">
            <div className="flex flex-wrap justify-between gap-3">
              <div>
                <strong>
                  {row.lastError
                    ? 'Delivery failed — retry pending'
                    : row.deliveryMode === 'disabled'
                      ? 'Delivery disabled'
                      : row.status}
                </strong>
                <p className="break-all">{row.recipient}</p>
              </div>
              {row.canRetry && (
                <Button
                  variant="outline"
                  onClick={() => {
                    requestId.current = crypto.randomUUID();
                    setError('');
                    setTarget(row);
                  }}
                >
                  Retry failed email
                </Button>
              )}
            </div>
            <p>{row.subject}</p>
            <p className="muted">
              {row.deliveryMode === 'local'
                ? 'Local demo mailbox'
                : row.deliveryMode === 'smtp'
                  ? 'External SMTP'
                  : 'Disabled'}{' '}
              · {row.attempts} attempt(s)
              {row.sentAt ? ` · Sent ${momentLabel(row.sentAt)}` : ''}
            </p>
            {row.lastError && (
              <p className="text-red-700">
                {row.lastError} · Next automatic retry:{' '}
                {momentLabel(row.nextAttemptAt)}
              </p>
            )}
          </article>
        ))}
      </div>
      <Dialog
        open={Boolean(target)}
        onOpenChange={(value) => {
          if (!value && !busy) setTarget(null);
        }}
      >
        <DialogContent>
          <DialogTitle>Retry customer email?</DialogTitle>
          <DialogDescription>
            Retry the failed assignment notification to {target?.recipient}.
            This uses the existing message and keeps its delivery history.
          </DialogDescription>
          {error && (
            <p role="alert" className="text-red-700">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setTarget(null)}
            >
              Cancel
            </Button>
            <Button disabled={busy} onClick={retry}>
              {busy ? 'Queuing…' : 'Confirm retry'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

type Overview = {
  today: string;
  week: string;
  counts: Record<string, number>;
  workload: Array<{
    technicianId: number;
    name: string;
    accountStatus: string;
    availability: string;
    visitsToday: number;
  }>;
  failures: Array<{
    emailId: number;
    bookingId: number;
    recipient: string;
    lastError: string;
  }>;
};
export function AdminOverviewPage() {
  const { version, refresh, go } = useInventory(),
    resource = useResource<Overview>('/admin/operations-overview', version);
  const cards = [
    ['review', 'Awaiting review', '/admin/orders'],
    ['waiting', 'Waiting dispatch', '/admin/dispatch'],
    [
      'dueSoon',
      'Confirmation due within 12 hours',
      '/admin/orders?sort=deadline',
    ],
    ['visitsToday', 'Bookings scheduled today', '/admin/dispatch'],
    ['inProgress', 'Active service / return visits', '/admin/dispatch'],
    [
      'completedWeek',
      'Completed bookings scheduled this week',
      '/admin/dispatch',
    ],
    ['returnVisits', 'Return visits needing Admin', '/admin/orders'],
    ['failedMail', 'Failed customer email attempts', ''],
    ['queuedMail', 'Customer emails pending / sending', ''],
  ];
  return (
    <>
      <div className="page-title">
        <div>
          <p className="eyebrow">ADMIN / OPERATIONS</p>
          <h1>Operations overview</h1>
          <p className="muted">
            {resource.data
              ? dayLabel(resource.data.today)
              : dayLabel(singaporeToday())}{' '}
            · Singapore time
          </p>
        </div>
        <Button variant="outline" onClick={refresh}>
          <RefreshCw />
          Refresh
        </Button>
      </div>
      <LoadState {...resource} />
      {resource.data && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {cards.map(([key, label, path]) => (
              <section key={key} className="panel !m-0">
                <p className="muted">{label}</p>
                <strong className="my-3 block text-3xl">
                  {resource.data!.counts[key]}
                </strong>
                {path && (
                  <Button size="sm" variant="outline" onClick={() => go(path)}>
                    View details
                  </Button>
                )}
              </section>
            ))}
          </div>
          <section className="panel mt-6">
            <h2>Technician workload today</h2>
            <p className="muted text-sm">
              Includes assigned original visits and scheduled returns. Account
              and availability status determine dispatch eligibility.
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {resource.data.workload.map((row) => (
                <article
                  key={row.technicianId}
                  className="rounded-lg border p-4"
                >
                  <strong>{row.name}</strong>
                  <p>{row.visitsToday} visit(s)</p>
                  <p className="muted text-sm">
                    {row.accountStatus} · {row.availability}
                  </p>
                </article>
              ))}
            </div>
            {!resource.data.workload.length && (
              <p>No technicians registered.</p>
            )}
          </section>
          <section className="panel mt-6">
            <h2>Customer emails needing attention</h2>
            <p className="muted text-sm">
              Up to 10 failed attempts, ordered by next retry time. Open the
              booking to view status and retry.
            </p>
            {resource.data.failures.length ? (
              <div className="mt-3 grid gap-3">
                {resource.data.failures.map((row) => (
                  <div
                    key={row.emailId}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
                  >
                    <div className="min-w-0 text-sm">
                      <strong>
                        BK-{String(row.bookingId).padStart(4, '0')}
                      </strong>
                      <p className="break-all">
                        {row.recipient} · {row.lastError}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      onClick={() => go(`/admin/orders/${row.bookingId}`)}
                    >
                      View notification
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-3 muted">No failed customer email attempts.</p>
            )}
          </section>
        </>
      )}
    </>
  );
}

type AuditRow = {
  requestId: string;
  bookingId: number;
  action: string;
  createdAt: string;
  actor: string;
};
export function AdminAuditPage({ params }: { params: URLSearchParams }) {
  const { version, refresh, user, go } = useInventory();
  const [bookingFilter, setBookingFilter] = useState(
    params.get('bookingId') || '',
  );
  const query = new URLSearchParams();
  for (const key of ['page', 'action', 'bookingId'])
    if (params.get(key)) query.set(key, params.get(key)!);
  const resource = useResource<List<AuditRow>>(
    `/admin/audit?${query}`,
    version,
  );
  const navigate = (key: string, value: string) => {
    const next = new URLSearchParams(query);
    next.delete('page');
    if (value) next.set(key, value); else next.delete(key);
    go(`/admin/audit?${next}`);
  };
  return (
    <>
      <div className="page-title">
        <div>
          <p className="eyebrow">ADMIN / AUDIT</p>
          <h1>Booking operation log</h1>
          <p className="muted">
            Successful booking changes and customer email retries, with
            administrator and time. Open a booking for its detailed timeline.
          </p>
        </div>
        <Button variant="outline" onClick={refresh}>
          <RefreshCw />
          Refresh
        </Button>
      </div>
      <div className="panel mb-5 flex flex-wrap items-end gap-3">
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            navigate('bookingId', bookingFilter);
          }}
        >
          <label htmlFor="audit-booking-filter">
            Booking ID
            <Input
              id="audit-booking-filter"
              type="number"
              min={1}
              value={bookingFilter}
              onChange={(e) => setBookingFilter(e.target.value)}
              placeholder="All bookings"
            />
          </label>
          <Button variant="outline" type="submit">
            Filter
          </Button>
        </form>
        <label htmlFor="audit-action-filter">
          Action
          <NativeSelect
            id="audit-action-filter"
            value={query.get('action') || ''}
            onChange={(e) => navigate('action', e.target.value)}
          >
            {[
              '',
              'Dispatch',
              'Redispatch',
              'Reject',
              'Reschedule',
              'Edit rejection',
              'Edit travel plan',
              'Queue for dispatch',
              'Retry customer email',
            ].map((action) => (
              <option key={action} value={action}>
                {action || 'All actions'}
              </option>
            ))}
          </NativeSelect>
        </label>
        {user.access_level === 'Owner' && (
          <a
            className="text-sm font-medium text-primary underline"
            href={`/api/admin/audit/export?${query}`}
          >
            Export this page (CSV)
          </a>
        )}
      </div>
      <LoadState {...resource} />
      {resource.data && (
        <section className="panel">
          <div className="grid gap-3">
            {resource.data.rows.map((row) => (
              <article
                key={row.requestId}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4"
              >
                <div>
                  <strong>{row.action}</strong>
                  <p className="text-sm">
                    {row.actor} · {momentLabel(row.createdAt)}
                  </p>
                  <p className="muted break-all text-xs">
                    Request: {row.requestId}
                  </p>
                </div>
                <Button
                  variant="outline"
                  onClick={() => go(`/admin/orders/${row.bookingId}`)}
                >
                  BK-{String(row.bookingId).padStart(4, '0')}
                </Button>
              </article>
            ))}
          </div>
          {!resource.data.rows.length && (
            <p className="muted">No matching operations.</p>
          )}
          <Pager
            {...resource.data}
            onPage={(page) => {
              const next = new URLSearchParams(query);
              next.set('page', String(page));
              go(`/admin/audit?${next}`);
            }}
          />
        </section>
      )}
    </>
  );
}
