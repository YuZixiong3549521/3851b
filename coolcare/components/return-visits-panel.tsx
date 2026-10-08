'use client';
import { useEffect, useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/native-select';
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
  const d: any = await r.json();
  if (!r.ok)
    throw Object.assign(new Error(d.error || 'Request failed.'), {
      status: r.status,
    });
  return d;
}
export function ReturnVisitsPanel({
  role,
  noticeOnly = false,
}: {
  role: 'admin' | 'customer';
  noticeOnly?: boolean;
}) {
  const [rows, setRows] = useState<Row[]>([]),
    [error, setError] = useState('');
  const load = async () => {
    try {
      setRows((await request(`/api/${role}/return-visits`)).rows);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  };
  useEffect(() => {
    void load();
    const timer = setInterval(load, 30000);
    return () => clearInterval(timer);
  }, [role]);
  if (noticeOnly) {
    const waiting = rows.filter(
      (r) => r.status === 'Awaiting customer' || r.status === 'Scheduled',
    );
    return waiting.length ? (
      <aside className="m-4 rounded-xl border bg-blue-50 p-4">
        Return visit update: {waiting.length} appointment(s).{' '}
        <a className="underline" href="/customer/bookings">
          View notification and arrange your visit
        </a>
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
          role={role}
          onSaved={load}
        />
      ))}
    </section>
  );
}
function ReturnCard({
  row,
  role,
  onSaved,
}: {
  row: Row;
  role: 'admin' | 'customer';
  onSaved: () => Promise<void>;
}) {
  const [date, setDate] = useState(''),
    [slot, setSlot] = useState(''),
    [tech, setTech] = useState('');
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
  const pending = useRef<any>(null),
    inFlight = useRef(false);
  useEffect(() => {
    if (role !== 'admin') return;
    request('/api/admin/technicians')
      .then((d) => setStaff(Array.isArray(d) ? d : d.rows))
      .catch((e) => setError(e.message));
  }, [role]);
  useEffect(() => {
    if (!date || role !== 'customer') return;
    let active = true;
    setSlots([]);
    setSlot('');
    request(
      `/api/customer/return-visits/${row.jobId}/availability?date=${date}`,
    )
      .then((d) => {
        if (active) setSlots(d.slots);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [date, role, row.jobId]);
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
        ...(action === 'dispatch' ? { technicianId: Number(tech) } : {}),
      };
      await request(`/api/${role}/return-visits/${row.jobId}`, pending.current);
      pending.current = null;
      setUncertain(false);
      await onSaved();
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
          onClick={() => void save(pending.current.action)}
        >
          Retry same request
        </Button>
      ) : (
        <fieldset disabled={busy} className="space-y-3">
          {role === 'admin' &&
            ['Required', 'Awaiting confirmation'].includes(row.status) && (
              <Button variant="outline" onClick={() => void save('invite')}>
                {row.status === 'Required'
                  ? 'Approve & notify customer to choose time'
                  : 'Ask customer to choose a new time'}
              </Button>
            )}
          {role === 'customer' && row.status === 'Awaiting customer' && (
            <>
              <p>
                The administrator has approved your return visit. Choose a
                weekday at least 14 days ahead. Your time requires administrator
                confirmation.
              </p>
              <EnglishDatePicker
                value={date}
                onChange={setDate}
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
          {role === 'admin' && row.status === 'Awaiting confirmation' && (
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
