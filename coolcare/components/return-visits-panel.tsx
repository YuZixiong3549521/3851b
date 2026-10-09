'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { EnglishDatePicker } from '@/components/english-date-picker';
import { earliestBookingDate, bookingDateError } from '@/lib/booking-schedule';
type Row = {
  jobId: number;
  bookingId: number;
  version: number;
  customer: string;
  status: string;
  reason: string;
  parts: string;
  customerMessage: string | null;
  travelBufferMinutes: number;
  trafficNote: string | null;
  date: string | null;
  start: string | null;
  end: string | null;
};
async function request(path: string, body?: unknown) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (body) {
    const s = await fetch('/api/session');
    if (!s.ok) throw new Error('Please sign in again.');
    headers['X-CSRF-Token'] = ((await s.json()) as { csrf: string }).csrf;
  }
  const r = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const d: unknown = await r.json();
  if (!r.ok)
    throw Object.assign(new Error(errorMessage(d)), {
      status: r.status,
    });
  return d;
}
function errorMessage(value: unknown) {
  return value &&
    typeof value === 'object' &&
    'error' in value &&
    typeof value.error === 'string'
    ? value.error
    : 'Request failed.';
}
function rowsFrom(value: unknown): Row[] {
  if (
    value &&
    typeof value === 'object' &&
    'rows' in value &&
    Array.isArray(value.rows)
  )
    return value.rows as Row[];
  return [];
}
export function ReturnVisitsPanel({
  viewerRole,
  noticeOnly = false,
}: {
  viewerRole: 'admin' | 'customer';
  noticeOnly?: boolean;
}) {
  const [rows, setRows] = useState<Row[]>([]),
    [error, setError] = useState('');
  const load = useCallback(async () => {
    try {
      setRows(rowsFrom(await request(`/api/${viewerRole}/return-visits`)));
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }, [viewerRole]);
  useEffect(() => {
    const initial = window.setTimeout(() => void load(), 0);
    const timer = setInterval(load, 30000);
    return () => {
      clearTimeout(initial);
      clearInterval(timer);
    };
  }, [load]);
  if (noticeOnly) {
    const waiting = rows.filter(
      (r) => r.status === 'Awaiting customer' || r.status === 'Scheduled',
    );
    return waiting.length ? (
      <aside className="m-4 rounded-xl border bg-blue-50 p-4">
        Return visit update: {waiting.length} appointment(s).{' '}
        <Link className="underline" href="/customer/bookings">
          View notification and arrange your visit
        </Link>
      </aside>
    ) : null;
  }
  return (
    <section className="my-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Return visits</h2>
        <Button variant="outline" onClick={() => void load()}>
          Refresh return visits
        </Button>
      </div>
      {error && <p role="alert">{error}</p>}
      {!rows.length && !error && <p>No return visits awaiting action.</p>}
      {rows.map((row) => (
        <ReturnCard
          key={row.jobId + ':' + row.version}
          row={row}
          viewerRole={viewerRole}
          onSaved={load}
        />
      ))}
    </section>
  );
}
function ReturnCard({
  row,
  viewerRole,
  onSaved,
}: {
  row: Row;
  viewerRole: 'admin' | 'customer';
  onSaved: () => Promise<void>;
}) {
  const [date, setDate] = useState(''),
    [slot, setSlot] = useState(''),
    [tech, setTech] = useState(''),
    [customerMessage, setCustomerMessage] = useState(
      row.customerMessage ||
        'A return visit is required. Please choose a new weekday appointment at least 14 days ahead.',
    );
  const [slots, setSlots] = useState<
      { code: string; label: string; available: boolean }[]
    >([]),
    [staff, setStaff] = useState<
      {
        technicianId: number;
        fullName: string;
        status: string;
        availability: string;
      }[]
    >([]);
  const [busy, setBusy] = useState(false),
    [uncertain, setUncertain] = useState(false),
    [error, setError] = useState('');
  const pending = useRef<{
      requestId: string;
      expectedVersion: number;
      action: string;
      date?: string;
      timeSlot?: string;
      customerMessage?: string;
      technicianId?: number;
    } | null>(null),
    inFlight = useRef(false);
  useEffect(() => {
    if (viewerRole !== 'admin') return;
    request('/api/admin/technicians')
      .then((value) => {
        if (Array.isArray(value)) setStaff(value as typeof staff);
        else if (
          value &&
          typeof value === 'object' &&
          'rows' in value &&
          Array.isArray(value.rows)
        )
          setStaff(value.rows as typeof staff);
      })
      .catch((e) => setError(e.message));
  }, [viewerRole]);
  useEffect(() => {
    if (!date || viewerRole !== 'customer') return;
    let active = true;
    request(
      `/api/customer/return-visits/${row.jobId}/availability?date=${date}`,
    )
      .then((value) => {
        if (
          active &&
          value &&
          typeof value === 'object' &&
          'slots' in value &&
          Array.isArray(value.slots)
        )
          setSlots(value.slots as typeof slots);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [date, viewerRole, row.jobId]);
  async function save(action: string) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      pending.current ??= {
        requestId: crypto.randomUUID(),
        expectedVersion: row.version,
        action,
        ...(action === 'choose' ? { date, timeSlot: slot } : {}),
        ...(action === 'invite'
          ? { customerMessage: customerMessage.trim() }
          : {}),
        ...(action === 'dispatch' ? { technicianId: Number(tech) } : {}),
      };
      await request(
        `/api/${viewerRole}/return-visits/${row.jobId}`,
        pending.current,
      );
      pending.current = null;
      setUncertain(false);
      await onSaved();
      if (viewerRole === 'admin')
        window.dispatchEvent(new Event('coolcare:admin-actions-updated'));
    } catch (e) {
      const err = e as Error & { status?: number };
      setError(err.message);
      const unknown = !err.status || err.status >= 500;
      setUncertain(unknown);
      if (!unknown) pending.current = null;
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  return (
    <article className="rounded-xl border bg-white p-5 space-y-3">
      <h3 className="font-semibold">
        WO-{row.jobId} · {row.customer}
      </h3>
      <p>{row.status}</p>
      <p>Reason: {row.reason}</p>
      {row.parts && <p>Parts needed: {row.parts}</p>}
      <p>
        Planned travel time: {row.travelBufferMinutes ?? 30} minutes
        {row.trafficNote ? ` · ${row.trafficNote}` : ''}
      </p>
      {viewerRole === 'admin' && row.customerMessage && (
        <p className="rounded-lg bg-blue-50 p-3 text-sm">
          <strong>Administrator message:</strong> {row.customerMessage}
        </p>
      )}
      {row.date && (
        <p>
          Requested appointment: {row.date} · {row.start} – {row.end}
        </p>
      )}
      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
      {uncertain ? (
        <Button
          disabled={busy}
          onClick={() => {
            if (pending.current) void save(pending.current.action);
          }}
        >
          Retry same request
        </Button>
      ) : (
        <fieldset disabled={busy} className="space-y-3">
          {viewerRole === 'admin' &&
            ['Required', 'Awaiting confirmation'].includes(row.status) && (
              <div className="space-y-3">
                <label
                  htmlFor={`return-message-${row.jobId}`}
                  className="block text-sm font-semibold"
                >
                  Message to customer
                  <Textarea
                    id={`return-message-${row.jobId}`}
                    className="mt-2 min-h-24"
                    value={customerMessage}
                    maxLength={1000}
                    onChange={(event) => setCustomerMessage(event.target.value)}
                    placeholder="Explain why another visit is needed and what the customer should do next."
                  />
                </label>
                <p className="text-sm text-muted-foreground">
                  This message is saved in the service history and shown in the
                  customer&apos;s return-visit notice.
                </p>
                <Button
                  variant="outline"
                  disabled={customerMessage.trim().length < 10}
                  onClick={() => void save('invite')}
                >
                  {row.status === 'Required'
                    ? 'Approve & notify customer to choose time'
                    : 'Ask customer to choose a new time'}
                </Button>
              </div>
            )}
          {viewerRole === 'customer' && row.status === 'Awaiting customer' && (
            <>
              <p>
                The administrator has approved your return visit. Choose a
                weekday at least 14 days ahead. Your time requires administrator
                confirmation.
              </p>
              {row.customerMessage && (
                <p className="rounded-lg bg-blue-50 p-3 text-sm">
                  {row.customerMessage}
                </p>
              )}
              <EnglishDatePicker
                value={date}
                onChange={(value) => {
                  setDate(value);
                  setSlots([]);
                  setSlot('');
                }}
                min={earliestBookingDate()}
                label="Return visit date"
              />
              <NativeSelect
                aria-label="Return visit time"
                value={slot}
                onChange={(e) => setSlot(e.target.value)}
              >
                <option value="">Choose an available time</option>
                {slots.map((s) => (
                  <option key={s.code} value={s.code} disabled={!s.available}>
                    {s.label}
                    {!s.available ? ' — unavailable' : ''}
                  </option>
                ))}
              </NativeSelect>
              <Button
                disabled={!date || !slot || Boolean(bookingDateError(date))}
                onClick={() => void save('choose')}
              >
                Submit preferred return time
              </Button>
            </>
          )}
          {viewerRole === 'admin' && row.status === 'Awaiting confirmation' && (
            <>
              <NativeSelect
                aria-label="Return visit technician"
                value={tech}
                onChange={(e) => setTech(e.target.value)}
              >
                <option value="">Choose technician</option>
                {staff
                  .filter(
                    (t) =>
                      t.status === 'Active' &&
                      !['Unavailable', 'On Leave'].includes(t.availability),
                  )
                  .map((t) => (
                    <option key={t.technicianId} value={t.technicianId}>
                      {t.fullName}
                    </option>
                  ))}
              </NativeSelect>
              <p>
                Availability and the 14-day lead time are checked again on
                confirmation.
              </p>
              <Button disabled={!tech} onClick={() => void save('dispatch')}>
                Confirm time & dispatch
              </Button>
            </>
          )}
        </fieldset>
      )}
    </article>
  );
}
