'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Star, RefreshCw, ClipboardCheck, Clock3 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { NativeSelect } from '@/components/ui/native-select';
import { EnglishDatePicker } from '@/components/english-date-picker';
import { englishCalendarDate } from '@/lib/english-date';

type Visit = {
  teamReview?:boolean;isLead?:boolean;
  reportId: number;
  jobId: number;
  bookingId: number;
  bookingReference: string;
  technicianId: number;
  technician: string;
  customer: string;
  address: string;
  service: string;
  actualStart: string | null;
  actualEnd: string;
  scheduledStart: string | null;
  outcome: string;
  stars: number | null;
  comment: string;
  feedbackVersion: number;
  reportSubmittedAt: string | null;
  checklistRecorded: boolean;
  workPerformed: string;
  problemFound: string;
  solutionApplied: string;
  checklist: string;
  returnReason: string | null;
  returnParts: string | null;
};
type Settings = {
  graceMinutes: number;
};
type Summary = {
  closedVisits: number;
  completedVisits: number;
  returnRequiredVisits: number;
  reportsSubmitted: number;
  checklistsRecorded: number;
  customerAverage: number | null;
  customerCount: number;
  punctualityPercent: number | null;
  punctualityCount: number;
  technicianId?: number;
  name?: string;
};
type Result = {
  visits: Visit[];
  filters: { from: string; to: string };
  settings?: Settings;
  summary?: Summary;
  technicians?: Summary[];
};
type Mutation = (path: string, body: Record<string, unknown>) => Promise<void>;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set('Content-Type', 'application/json');
  if (init?.method) {
    const session = await fetch('/api/session', { credentials: 'include' });
    if (!session.ok) throw new Error('Please sign in again before saving.');
    headers.set(
      'X-CSRF-Token',
      ((await session.json()) as { csrf: string }).csrf,
    );
  }
  const response = await fetch('/api/performance' + path, {
    ...init,
    headers,
    credentials: 'include',
  });
  const result = (await response.json().catch(() => ({}))) as {
    error?: string;
  };
  if (!response.ok)
    throw new Error(
      result.error ?? 'Unable to load performance data. Please retry.',
    );
  return result as T;
}
function time(value: string | null) {
  if (!value) return 'Not recorded';
  const normalized = /Z$|[+-]\d\d:\d\d$/.test(value)
    ? value
    : value.replace(' ', 'T') + '+08:00';
  return new Intl.DateTimeFormat('en-SG', {
    timeZone: 'Asia/Singapore',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(normalized));
}
function metric(value: number | null | undefined, suffix = '') {
  return value == null ? 'Not recorded' : `${value}${suffix}`;
}
function SummaryCards({ summary }: { summary: Summary }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Stat
        label="Completed visits"
        value={String(summary.completedVisits)}
        note="Service visits completed during the selected period."
      />
      <Stat
        label="Customer feedback"
        value={
          summary.customerAverage == null
            ? 'Not yet rated'
            : metric(summary.customerAverage, ' / 5')
        }
        note={`${summary.customerCount} customer ${summary.customerCount === 1 ? 'review' : 'reviews'}. Unrated visits are excluded from the average.`}
      />
      <Stat
        label="Visits requiring a return"
        value={String(summary.returnRequiredVisits)}
        note="Finished visits that needed a further appointment."
      />
      <Stat
        label="Team service start punctuality"
        value={
          summary.punctualityPercent == null
            ? 'No recorded starts'
            : metric(summary.punctualityPercent, '%')
        }
        note={`${summary.punctualityCount} ${summary.punctualityCount === 1 ? 'visit' : 'visits'} with both scheduled and actual start times.`}
      />
    </div>
  );
}
function Stat({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note: string;
}) {
  return (
    <section className="rounded-2xl border bg-card p-5">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-2 text-xl font-semibold">{value}</p>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
        {note}
      </p>
    </section>
  );
}

export function PerformanceAdminView() {
  return <PerformanceWorkspace role="admin" />;
}
export function PerformanceTechnicianView() {
  return <PerformanceWorkspace role="technician" />;
}
export function PerformanceCustomerView() {
  return <PerformanceWorkspace role="customer" />;
}

function PerformanceWorkspace({
  role,
}: {
  role: 'admin' | 'technician' | 'customer';
}) {
  const [data, setData] = useState<Result | null>(null),
    [from, setFrom] = useState(''),
    [to, setTo] = useState('');
  const [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false);
  const [selectedReportId, setSelectedReportId] = useState('');
  const [reviewFilter, setReviewFilter] = useState('all');
  const pending = useRef<{ key: string; requestId: string } | null>(null),
    sequence = useRef(0);
  const endpoint = role === 'customer' ? '/customer/visits' : '/' + role;
  const load = useCallback(
    async (query = '') => {
      const serial = ++sequence.current;
      setBusy(true);
      setError('');
      try {
        const result = await request<Result>(endpoint + query);
        if (serial === sequence.current) {
          setData(result);
          setFrom(result.filters.from);
          setTo(result.filters.to);
        }
      } catch (e) {
        if (serial === sequence.current)
          setError(e instanceof Error ? e.message : 'Unable to load visits.');
      } finally {
        if (serial === sequence.current) setBusy(false);
      }
    },
    [endpoint],
  );
  useEffect(() => {
    const reportId =
      role === 'customer'
        ? new URLSearchParams(window.location.search).get('reportId')
        : null;
    const selected = reportId && /^[1-9]\d*$/.test(reportId) ? reportId : '';
    setSelectedReportId(selected);
    void load(selected ? '?reportId=' + selected : '');
    return () => {
      sequence.current++;
    };
  }, [load, role]);
  const query = () =>
    selectedReportId
      ? '?reportId=' + selectedReportId
      : from && to
        ? '?' + new URLSearchParams({ from, to }).toString()
        : '';
  const mutate: Mutation = async (path, body) => {
    setBusy(true);
    setError('');
    setNotice('');
    const key = JSON.stringify({ path, body });
    if (pending.current?.key !== key)
      pending.current = { key, requestId: crypto.randomUUID() };
    try {
      await request(path, {
        method: 'PUT',
        body: JSON.stringify({ ...body, requestId: pending.current.requestId }),
      });
      pending.current = null;
      if (role === 'customer')
        window.dispatchEvent(new Event('coolcare:bookings-updated'));
      setNotice(
        'Thank you for your review. Your technician and our service team can now see your feedback.',
      );
      await load(query());
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Unable to save. Please retry.',
      );
      setBusy(false);
      throw e;
    }
  };
  const visibleVisits =
    data?.visits.filter(
      (visit) =>
        reviewFilter === 'all' ||
        (reviewFilter === 'reviewed'
          ? visit.stars !== null
          : visit.outcome === 'Completed' && visit.stars === null),
    ) ?? [];
  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6 lg:p-8">
      <header>
        <p className="text-sm font-semibold text-primary">
          {role === 'customer' ? 'YOUR VOICE' : 'SERVICE FEEDBACK'}
        </p>
        {role === 'technician' ? (
          <h2 className="mt-1 text-3xl font-bold">Reviews and service records</h2>
        ) : (
          <h1 className="mt-1 text-3xl font-bold">
            {role === 'customer' ? 'Visit feedback' : 'Technician performance'}
          </h1>
        )}
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
          {role === 'customer'
            ? 'Rate a completed visit and tell us what went well or could improve. Your rating and comment are shared with the technician who performed that visit and our service team.'
            : role === 'technician'
              ? 'Read customer ratings and comments for visits you performed, alongside your completed services and service start records. Reviews are read-only.'
              : 'Compare customer ratings, completed visits and service start records. Each visit stays attributed to the technician who performed it; unrated visits do not lower the average.'}
        </p>
      </header>
      {selectedReportId ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-card p-4">
          <p className="text-sm">
            Showing the service visit selected from your reminder.
          </p>
          <Button
            variant="outline"
            onClick={() => {
              setSelectedReportId('');
              setReviewFilter('all');
              window.history.replaceState(null, '', '/customer/feedback');
              void load();
            }}
          >
            View all service visits
          </Button>
        </div>
      ) : (
        <form
          className="flex flex-wrap items-end gap-3 rounded-2xl border bg-card p-4"
          onSubmit={(e) => {
            e.preventDefault();
            void load(query());
          }}
        >
          <div className="min-w-44">
            <label className="mb-1 block text-sm">From</label>
            <EnglishDatePicker
              label="Performance start date"
              value={from}
              onChange={setFrom}
              disableWeekends={false}
            />
          </div>
          <div className="min-w-44">
            <label className="mb-1 block text-sm">To</label>
            <EnglishDatePicker
              label="Performance end date"
              value={to}
              onChange={setTo}
              disableWeekends={false}
            />
          </div>
          <Button disabled={busy} type="submit">
            <RefreshCw className="size-4" />
            {busy ? 'Loading…' : 'Apply dates'}
          </Button>
          <p className="text-xs text-muted-foreground">
            Up to 367 days. All dates and times use Singapore time.
          </p>
        </form>
      )}
      {error && (
        <div
          role="alert"
          className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
        >
          {error}{' '}
          <Button
            variant="outline"
            size="sm"
            onClick={() => void load(query())}
          >
            Refresh
          </Button>
        </div>
      )}
      {notice && (
        <p
          role="status"
          className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900"
        >
          {notice}
        </p>
      )}
      {!data && !error && <p role="status">Loading service visits…</p>}
      {data && (
        <>
          {!selectedReportId && (
            <p className="text-sm text-muted-foreground">
              Showing visits that ended from{' '}
              {englishCalendarDate(data.filters.from)} to{' '}
              {englishCalendarDate(data.filters.to)}.
            </p>
          )}
          {data.summary && (
            <>
              <SummaryCards summary={data.summary} />
              <div className="rounded-xl border bg-muted/30 p-4 text-sm leading-relaxed">
                <p>
                  Reports submitted: <strong>{data.summary.reportsSubmitted}</strong>
                  {' · '}Checklists recorded: <strong>{data.summary.checklistsRecorded}</strong>
                </p>
                <p className="mt-2 text-muted-foreground">
                  On time means service started no later than{' '}
                  {data.settings?.graceMinutes ?? 15} minutes after the recorded
                  appointment time. This measures service start, not physical
                  arrival. Visits without both times are excluded.
                </p>
                <p className="mt-2 text-muted-foreground">
                  Legacy visits without an unambiguous technician snapshot are
                  excluded. Customer reviews remain attached to their original
                  service visit.
                </p>
              </div>
            </>
          )}
          {role === 'admin' &&
            data.technicians &&
            data.technicians.length > 0 && (
              <section className="overflow-x-auto rounded-2xl border bg-card">
                <table className="w-full text-left text-sm">
                  <caption className="p-4 text-left font-semibold">
                    Technician summary
                  </caption>
                  <thead className="border-y bg-muted/30">
                    <tr>
                      {[
                        'Technician',
                        'Completed visits',
                        'Customer rating / 5',
                        'Reviews',
                        'On-time starts',
                      ].map((h) => (
                        <th key={h} className="whitespace-nowrap px-4 py-3">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.technicians.map((t) => (
                      <tr
                        key={t.technicianId}
                        className="border-b last:border-0"
                      >
                        <td className="px-4 py-3">{t.name}</td>
                        <td className="px-4 py-3">{t.completedVisits}</td>
                        <td className="px-4 py-3">
                          {t.customerAverage == null
                            ? 'Not yet rated'
                            : metric(t.customerAverage)}
                        </td>
                        <td className="px-4 py-3">{t.customerCount}</td>
                        <td className="px-4 py-3">
                          {metric(t.punctualityPercent, '%')}
                          <span className="mt-1 block text-xs text-muted-foreground">
                            {t.punctualityCount} timed {t.punctualityCount === 1 ? 'visit' : 'visits'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )}
          <section className="space-y-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <h2 className="text-xl font-semibold">
                Service visits ({visibleVisits.length})
              </h2>
              <div>
                <label
                  htmlFor="performance-review-filter"
                  className="mb-1 block text-sm font-medium"
                >
                  Reviews
                </label>
                <NativeSelect
                  id="performance-review-filter"
                  value={reviewFilter}
                  onChange={(e) => setReviewFilter(e.target.value)}
                >
                  <option value="all">All visits</option>
                  <option value="reviewed">
                    Customer reviews (
                    {data.visits.filter((v) => v.stars !== null).length})
                  </option>
                  <option value="pending">
                    Awaiting customer rating (
                    {
                      data.visits.filter(
                        (v) => v.outcome === 'Completed' && v.stars === null,
                      ).length
                    }
                    )
                  </option>
                </NativeSelect>
              </div>
            </div>
            {!visibleVisits.length ? (
              <p className="rounded-2xl border bg-card p-6 text-muted-foreground">
                {selectedReportId && data.visits.length === 0
                  ? 'This service visit is unavailable for your account or has not ended yet.'
                  : reviewFilter !== 'all'
                    ? 'No visits match this review filter in the selected period.'
                    : 'No recorded visits in this period. Try a different date range. New visits appear after the technician ends the service.'}
              </p>
            ) : (
              visibleVisits.map((v) => (
                <VisitCard
                  key={`${v.reportId}-${v.technicianId}-${v.feedbackVersion}`}
                  visit={v}
                  role={role}
                  mutate={mutate}
                  busy={busy}
                />
              ))
            )}
          </section>
        </>
      )}
    </div>
  );
}
function VisitCard({
  visit: v,
  role,
  mutate,
  busy,
}: {
  visit: Visit;
  role: string;
  mutate: Mutation;
  busy: boolean;
}) {
  const id = useId(),
    [stars, setStars] = useState(v.stars == null ? '' : String(v.stars)),
    [comment, setComment] = useState(v.comment);
  return (
    <article
      id={`visit-${v.reportId}-${v.technicianId}`}
      className="rounded-2xl border bg-card p-5 sm:p-6"
    >
      <header className="flex flex-wrap justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-primary">
            Booking {v.bookingReference} · Report #{v.reportId}
          </p>
          <h3 className="mt-1 text-lg font-semibold">{v.service}</h3>
          <p className="text-sm text-muted-foreground">
            {v.technician}{v.teamReview ? (v.isLead?' · Team lead · Shared team review':' · Team member · Shared team review'):''} · {englishCalendarDate(v.actualEnd.slice(0, 10))}
          </p>
        </div>
        <span className="h-fit rounded-full bg-muted px-3 py-1 text-xs">
          {v.outcome}
        </span>
      </header>
      <p className="mt-3 text-sm">
        {role !== 'customer' && `${v.customer} · `}
        {v.address}
      </p>
      <div className="mt-4 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
        <p className="flex items-center gap-2">
          <Clock3 className="size-4 shrink-0" />
          Scheduled: {time(v.scheduledStart)}
        </p>
        <p>
          Team service started: {time(v.actualStart)} · Ended: {time(v.actualEnd)}
        </p>
        <p className="flex items-center gap-2">
          <ClipboardCheck className="size-4 shrink-0" />
          {v.reportSubmittedAt
            ? 'Report submitted'
            : 'Report awaiting submission'}{' '}
          ·{' '}
          {v.checklistRecorded ? 'Checklist recorded' : 'No checklist recorded'}
        </p>
      </div>
      {v.outcome === 'Return required' && (
        <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-950">
          Return context: {v.returnReason ?? 'A further visit was recorded.'}
          {v.returnParts && ` · ${v.returnParts}`}. The reason is recorded with
          this visit for follow-up.
        </p>
      )}
      {role !== 'customer' && (
        <details className="mt-4 text-sm">
          <summary className="cursor-pointer font-medium">
            Review recorded service work
          </summary>
          <div className="mt-2 space-y-2 whitespace-pre-wrap rounded-xl bg-muted/40 p-4">
            <p>
              <strong>Work:</strong> {v.workPerformed || 'Not recorded'}
            </p>
            <p>
              <strong>Findings:</strong> {v.problemFound || 'Not recorded'}
            </p>
            <p>
              <strong>Solution:</strong> {v.solutionApplied || 'Not recorded'}
            </p>
            <p>
              <strong>Checklist:</strong> {v.checklist || 'Not recorded'}
            </p>
          </div>
        </details>
      )}
      {role === 'customer' && v.outcome === 'Completed' ? (
        <form
          className="mt-5 space-y-3 border-t pt-4"
          onSubmit={(e) => {
            e.preventDefault();
            void mutate(`/customer/visits/${v.reportId}/feedback`, {
              expectedVersion: v.feedbackVersion,
              stars: Number(stars),
              comment,
            }).catch(() => {});
          }}
        >
          <label htmlFor={`${id}-stars`} className="block text-sm font-medium">
            Your rating
          </label>
          <NativeSelect
            id={`${id}-stars`}
            required
            value={stars}
            onChange={(e) => setStars(e.target.value)}
            disabled={busy}
          >
            <option value="" disabled>
              Choose a rating
            </option>
            <option value="5">5 — Excellent</option>
            <option value="4">4 — Good</option>
            <option value="3">3 — Satisfactory</option>
            <option value="2">2 — Needs improvement</option>
            <option value="1">1 — Poor</option>
          </NativeSelect>
          <label
            htmlFor={`${id}-comment`}
            className="block text-sm font-medium"
          >
            Your feedback (optional)
          </label>
          <Textarea
            id={`${id}-comment`}
            maxLength={1500}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            disabled={busy}
            placeholder="What went well? How can we improve?"
          />
          <Button disabled={busy} type="submit">
            <Star className="size-4" />
            {v.feedbackVersion ? 'Update feedback' : 'Submit feedback'}
          </Button>
          <p className="text-xs text-muted-foreground">
            Feedback is shared with your technician and the service team.
            Updates preserve the previous version.
          </p>
        </form>
      ) : role === 'customer' ? (
        <p className="mt-4 text-sm text-muted-foreground">
          You can leave feedback after a completed visit.
        </p>
      ) : (
        <div className="mt-4 border-t pt-4">
          <div>
            <p className="text-sm font-medium">
              Customer rating:{' '}
              {v.stars == null ? 'Not yet rated' : metric(v.stars, ' / 5')}
            </p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
              {v.comment ||
                (v.stars == null
                  ? 'No customer review has been submitted for this visit.'
                  : 'No comment provided.')}
            </p>
          </div>
        </div>
      )}
    </article>
  );
}
