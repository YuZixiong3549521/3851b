'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Star, RefreshCw, ClipboardCheck, Clock3 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { NativeSelect } from '@/components/ui/native-select';
import { EnglishDatePicker } from '@/components/english-date-picker';
import { englishCalendarDate } from '@/lib/english-date';

type Visit = {
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
  qualityScore: number | null;
  qualityReason: string;
  qualityVersion: number;
  punctualityScore: number | null;
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
  customerWeight: number;
  qualityWeight: number;
  punctualityWeight: number;
  graceMinutes: number;
  version: number;
};
type Summary = {
  closedVisits: number;
  completedVisits: number;
  returnRequiredVisits: number;
  reportsSubmitted: number;
  checklistsRecorded: number;
  customerAverage: number | null;
  customerCount: number;
  qualityAverage: number | null;
  qualityCount: number;
  punctualityPercent: number | null;
  punctualityCount: number;
  fullyScoredVisits: number;
  minimumScoredVisits: number;
  compositeScore: number | null;
  technicianId?: number;
  name?: string;
};
type Result = {
  visits: Visit[];
  filters: { from: string; to: string };
  settings?: Settings;
  summary?: Summary;
  technicians?: Summary[];
  audit?: {
    requestId: string;
    reportId: number | null;
    kind: string;
    actor: string;
    createdAt: string;
    beforeValue: unknown;
    afterValue: unknown;
  }[];
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
  return value == null ? 'Not enough data' : `${value}${suffix}`;
}
function SummaryCards({ summary }: { summary: Summary }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Stat
        label="Composite score"
        value={
          summary.compositeScore === null
            ? 'Awaiting 5 scored visits'
            : `${summary.compositeScore} / 100`
        }
        note={`${summary.fullyScoredVisits} of ${summary.closedVisits} closed visits have all three measures.`}
      />
      <Stat
        label="Customer feedback"
        value={metric(summary.customerAverage, ' / 5')}
        note={`${summary.customerCount} rated visits. Missing feedback is not scored as zero.`}
      />
      <Stat
        label="Quality assessment"
        value={metric(summary.qualityAverage, ' / 100')}
        note={`${summary.qualityCount} admin-reviewed visits.`}
      />
      <Stat
        label="Service start punctuality"
        value={metric(summary.punctualityPercent, '%')}
        note={`${summary.punctualityCount} visits with both scheduled and actual start times.`}
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
        role === 'customer'
          ? 'Thank you for your review. Your technician and our service team can now see your feedback.'
          : 'Saved successfully. The change is recorded in the audit history.',
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
          {role === 'customer' ? 'YOUR VOICE' : 'SERVICE QUALITY'}
        </p>
        <h1 className="mt-1 text-3xl font-bold">
          {role === 'customer'
            ? 'Visit feedback'
            : role === 'technician'
              ? 'My performance'
              : 'Technician performance'}
        </h1>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
          {role === 'customer'
            ? 'Rate a completed visit and tell us what went well or could improve. Your rating and comment are shared with the technician who performed that visit and our service team.'
            : role === 'technician'
              ? 'Read customer reviews for visits you performed, along with your service quality and punctuality scores. You can view reviews but cannot change them.'
              : 'Scores use individual service visits and the technician recorded when that visit started. Missing feedback and old missing times remain unavailable.'}
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
          {data.summary && (
            <>
              <SummaryCards summary={data.summary} />
              <div className="rounded-xl border bg-muted/30 p-4 text-sm leading-relaxed">
                <p>
                  <strong>{data.summary.completedVisits}</strong> completed
                  visits · <strong>{data.summary.returnRequiredVisits}</strong>{' '}
                  visits requiring a return ·{' '}
                  <strong>{data.summary.reportsSubmitted}</strong> reports
                  submitted · <strong>{data.summary.checklistsRecorded}</strong>{' '}
                  checklists recorded
                </p>
                <p className="mt-2 text-muted-foreground">
                  Weights: customer feedback {data.settings?.customerWeight}%,
                  quality {data.settings?.qualityWeight}%, service start
                  punctuality {data.settings?.punctualityWeight}%. On time means
                  service started no later than {data.settings?.graceMinutes}{' '}
                  minutes after the captured schedule. This measures service
                  start, not physical arrival. A return for unavailable parts, a
                  customer reschedule or an extension does not automatically
                  deduct points.
                </p>
                <p className="mt-2 text-muted-foreground">
                  Legacy visits without an unambiguous technician snapshot are
                  excluded. Changing weights recalculates this view; raw
                  feedback and assessments stay unchanged.
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
                        'Closed visits',
                        'Customer / 5',
                        'Quality / 100',
                        'On time',
                        'Fully scored',
                        'Composite / 100',
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
                        <td className="px-4 py-3">{t.closedVisits}</td>
                        <td className="px-4 py-3">
                          {metric(t.customerAverage)}
                        </td>
                        <td className="px-4 py-3">
                          {metric(t.qualityAverage)}
                        </td>
                        <td className="px-4 py-3">
                          {metric(t.punctualityPercent, '%')}
                        </td>
                        <td className="px-4 py-3">
                          {t.fullyScoredVisits} / {t.closedVisits}
                        </td>
                        <td className="px-4 py-3">
                          {metric(t.compositeScore)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )}
          {role === 'admin' && data.settings && (
            <SettingsForm
              key={data.settings.version}
              settings={data.settings}
              mutate={mutate}
              busy={busy}
            />
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
                {selectedReportId
                  ? 'This service visit is unavailable for your account or has not ended yet.'
                  : reviewFilter !== 'all'
                    ? 'No visits match this review filter in the selected period.'
                    : 'No recorded visits in this period. Try a different date range. New visits appear after the technician ends the service.'}
              </p>
            ) : (
              visibleVisits.map((v) => (
                <VisitCard
                  key={`${v.reportId}-${v.feedbackVersion}-${v.qualityVersion}`}
                  visit={v}
                  role={role}
                  mutate={mutate}
                  busy={busy}
                />
              ))
            )}
          </section>
          {role === 'admin' && (
            <details className="rounded-2xl border bg-card p-5">
              <summary className="cursor-pointer font-semibold">
                Assessment and settings audit (latest 100 changes in this
                period)
              </summary>
              <div className="mt-4 space-y-3">
                {!data.audit?.length ? (
                  <p className="text-sm text-muted-foreground">
                    No changes recorded in this period.
                  </p>
                ) : (
                  data.audit.map((a) => (
                    <div key={a.requestId} className="border-t pt-3 text-sm">
                      <p className="font-medium">
                        {a.kind}
                        {a.reportId ? ` · Report ${a.reportId}` : ''} ·{' '}
                        {a.actor}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {time(a.createdAt)}
                      </p>
                      <details className="mt-2">
                        <summary className="cursor-pointer">
                          View recorded values
                        </summary>
                        <pre className="mt-2 whitespace-pre-wrap break-all rounded-lg bg-muted p-3 text-xs">
                          {JSON.stringify(
                            { before: a.beforeValue, after: a.afterValue },
                            null,
                            2,
                          )}
                        </pre>
                      </details>
                    </div>
                  ))
                )}
              </div>
            </details>
          )}
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
  const [score, setScore] = useState(
      v.qualityScore == null ? '' : String(v.qualityScore),
    ),
    [reason, setReason] = useState(v.qualityReason);
  return (
    <article
      id={`visit-${v.reportId}`}
      className="rounded-2xl border bg-card p-5 sm:p-6"
    >
      <header className="flex flex-wrap justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-primary">
            Booking {v.bookingReference} · Report #{v.reportId}
          </p>
          <h3 className="mt-1 text-lg font-semibold">{v.service}</h3>
          <p className="text-sm text-muted-foreground">
            {v.technician} · {englishCalendarDate(v.actualEnd.slice(0, 10))}
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
          Started: {time(v.actualStart)} · Ended: {time(v.actualEnd)}
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
          {v.returnParts && ` · ${v.returnParts}`}. This does not automatically
          reduce the score.
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
        <div className="mt-4 grid gap-4 border-t pt-4 sm:grid-cols-2">
          <div>
            <p className="text-sm font-medium">
              Customer feedback: {metric(v.stars, ' / 5')}
            </p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
              {v.comment || 'No comment provided.'}
            </p>
          </div>
          <div>
            <p className="text-sm font-medium">
              Quality: {metric(v.qualityScore, ' / 100')}
            </p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
              {v.qualityReason || 'Not assessed yet.'}
            </p>
          </div>
        </div>
      )}
      {role === 'admin' && (
        <details className="mt-4">
          <summary className="cursor-pointer text-sm font-medium">
            {v.qualityVersion
              ? 'Update quality assessment'
              : 'Add quality assessment'}
          </summary>
          <form
            className="mt-3 space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void mutate(`/admin/visits/${v.reportId}/quality`, {
                expectedVersion: v.qualityVersion,
                score: Number(score),
                reason,
              }).catch(() => {});
            }}
          >
            <label className="block text-sm" htmlFor={`${id}-quality`}>
              Quality score (0–100)
            </label>
            <Input
              id={`${id}-quality`}
              className="max-w-40"
              type="number"
              required
              min={0}
              max={100}
              step={1}
              value={score}
              onChange={(e) => setScore(e.target.value)}
              disabled={busy}
            />
            <label className="block text-sm" htmlFor={`${id}-reason`}>
              Assessment reason
            </label>
            <Textarea
              id={`${id}-reason`}
              required
              minLength={5}
              maxLength={1500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={busy}
              placeholder="Describe the evidence behind this assessment."
            />
            <Button disabled={busy} type="submit">
              Save quality assessment
            </Button>
          </form>
        </details>
      )}
    </article>
  );
}
function SettingsForm({
  settings: s,
  mutate,
  busy,
}: {
  settings: Settings;
  mutate: Mutation;
  busy: boolean;
}) {
  const id = useId(),
    [customerWeight, setCustomer] = useState(String(s.customerWeight)),
    [qualityWeight, setQuality] = useState(String(s.qualityWeight)),
    [punctualityWeight, setPunctuality] = useState(String(s.punctualityWeight)),
    [graceMinutes, setGrace] = useState(String(s.graceMinutes)),
    [reason, setReason] = useState('');
  const fields = [
    {
      name: 'Customer weight (%)',
      value: customerWeight,
      set: setCustomer,
      max: 98,
    },
    {
      name: 'Quality weight (%)',
      value: qualityWeight,
      set: setQuality,
      max: 98,
    },
    {
      name: 'Punctuality weight (%)',
      value: punctualityWeight,
      set: setPunctuality,
      max: 98,
    },
    {
      name: 'Start grace period (minutes)',
      value: graceMinutes,
      set: setGrace,
      max: 60,
    },
  ];
  return (
    <details className="rounded-2xl border bg-card p-5">
      <summary className="cursor-pointer font-semibold">
        Scoring settings
      </summary>
      <form
        className="mt-4 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void mutate('/admin/settings', {
            expectedVersion: s.version,
            customerWeight: Number(customerWeight),
            qualityWeight: Number(qualityWeight),
            punctualityWeight: Number(punctualityWeight),
            graceMinutes: Number(graceMinutes),
            reason,
          }).catch(() => {});
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {fields.map((f, i) => (
            <div key={f.name}>
              <label htmlFor={`${id}-${i}`} className="mb-1 block text-sm">
                {f.name}
              </label>
              <Input
                id={`${id}-${i}`}
                type="number"
                min={i === 3 ? 0 : 1}
                max={f.max}
                step={1}
                required
                value={f.value}
                onChange={(e) => f.set(e.target.value)}
                disabled={busy}
              />
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Weights must total 100%. At least five visits with all three measures
          are required for a composite score.
        </p>
        <label htmlFor={`${id}-reason`} className="block text-sm">
          Reason for changing the scoring settings
        </label>
        <Textarea
          id={`${id}-reason`}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          minLength={5}
          maxLength={1500}
          required
          disabled={busy}
        />
        <Button disabled={busy} type="submit">
          Save scoring settings
        </Button>
      </form>
    </details>
  );
}
