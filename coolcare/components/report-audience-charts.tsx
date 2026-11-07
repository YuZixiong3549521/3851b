'use client';

import Link from 'next/link';
import type { AnalyticsPeriod, GroupBy } from '@/lib/report-analytics-types';
import { StackedChart, periodLabel } from './report-analytics-charts';
import { Section, Metric, day } from './commerce-shared';

export type ReportAudience = {
  periods: { period: string; from: string; to: string; partial: boolean; newCustomers: number; bookingCustomers: number; positive: number; neutral: number; negative: number }[];
  customers: { newInPeriod: number; withBookings: number };
  reviews: { total: number; average: number | null; positive: number; neutral: number; negative: number; fallbackDates: number };
  annualPlans: { seriesId: number; customerName: string; address: string; totalVisits: number; recordedVisits: number; completed: number; awaiting: number; closed: number; selectedVisits: number;
    visits: { bookingId: number; reference: string; visitNumber: number; date: string; status: string; category: 'completed' | 'awaiting' | 'closed'; included: boolean }[] }[];
};
const integer = new Intl.NumberFormat('en-SG');
const empty = <p className="flex min-h-44 items-center justify-center rounded-xl bg-muted/30 p-6 text-center text-sm text-muted-foreground">No matching records in this period.</p>;

export function ReportAudienceCharts({ audience, periods, groupBy, dateBasis }: {
  audience: ReportAudience; periods: AnalyticsPeriod[]; groupBy: GroupBy; dateBasis: 'scheduled' | 'completed';
}) {
  const total = periods.reduce((sum, r) => sum + r.orders, 0), completed = periods.reduce((sum, r) => sum + r.completed, 0);
  const rows = periods.map(({ period, from, to, partial, orders, completed }) => ({ period, from, to, partial, completed, notCompleted: orders - completed }));
  const reviewBands = [{ key: 'positive' as const, label: 'Positive', stars: '4–5 stars', colour: 'var(--chart-2)' },
    { key: 'neutral' as const, label: 'Neutral', stars: '3 stars', colour: 'var(--chart-3)' },
    { key: 'negative' as const, label: 'Negative', stars: '1–2 stars', colour: 'var(--chart-5)' }];
  return <div className="space-y-6">
    <div className="grid min-w-0 gap-6 xl:grid-cols-2">
      <Section title="Completed vs not completed">
        <p className="text-sm text-muted-foreground">Current status of the selected orders. Not completed includes awaiting service, active work, cancelled, rejected and expired requests; it does not mean all these visits are still due.</p>
        {dateBasis === 'completed' && <p className="rounded-lg bg-muted p-3 text-sm">Actual completion date selects completed orders only. Choose Scheduled service date to compare completed and unfinished appointments.</p>}
        <div className="grid grid-cols-2 gap-3"><Metric title="Completed" value={completed} /><Metric title="Not completed" value={total - completed} /></div>
        {total ? <StackedChart title="Completed vs not completed" rows={rows} groupBy={groupBy} series={[
          { key: 'completed', label: 'Completed', colour: 'var(--chart-2)' },
          { key: 'notCompleted', label: 'Not completed', colour: 'var(--chart-3)' },
        ]} /> : empty}
        <details><summary className="cursor-pointer text-sm font-medium text-primary">View completion data</summary><div className="mt-3 max-h-72 overflow-auto"><table className="w-full text-left text-sm"><caption className="sr-only">Completion comparison by period</caption><thead><tr><th className="p-2">Period</th><th className="p-2">Completed</th><th className="p-2">Not completed</th></tr></thead><tbody>{rows.map(row => <tr className="border-t" key={row.period}><td className="p-2">{periodLabel(row.period,groupBy)}{row.partial?' *':''}</td><td className="p-2">{row.completed}</td><td className="p-2">{row.notCompleted}</td></tr>)}</tbody></table></div></details>
      </Section>
      <Section title="Customer numbers">
        <p className="text-sm text-muted-foreground">New registrations use account creation dates in Singapore and include all customers, regardless of service or technician filters. Customers with bookings uses the selected orders and their selected date basis.</p>
        <div className="grid grid-cols-2 gap-3"><Metric title="New customers" value={audience.customers.newInPeriod} /><Metric title="Customers with bookings" value={audience.customers.withBookings} /></div>
        {audience.customers.newInPeriod || audience.customers.withBookings ? <StackedChart title="Customer numbers" rows={audience.periods} groupBy={groupBy} stacked={false} series={[
          { key: 'newCustomers', label: 'New registrations', colour: 'var(--chart-1)' },
          { key: 'bookingCustomers', label: 'Customers with bookings', colour: 'var(--chart-2)' },
        ]} /> : empty}
        <p className="text-xs text-muted-foreground">Each customer counts once per period and once in the range total. Customers can appear in both series or in several periods; do not add these bars to calculate a customer total.</p>
        <details><summary className="cursor-pointer text-sm font-medium text-primary">View customer data</summary><div className="mt-3 max-h-72 overflow-auto"><table className="w-full text-left text-sm"><caption className="sr-only">Customer numbers by period</caption><thead><tr><th className="p-2">Period</th><th className="p-2">New</th><th className="p-2">With bookings</th></tr></thead><tbody>{audience.periods.map(row => <tr className="border-t" key={row.period}><td className="p-2">{periodLabel(row.period,groupBy)}{row.partial?' *':''}</td><td className="p-2">{row.newCustomers}</td><td className="p-2">{row.bookingCustomers}</td></tr>)}</tbody></table></div></details>
      </Section>
    </div>
    <Section title="Customer rating comparison">
      <p className="text-sm text-muted-foreground">Latest saved rating for each reviewed visit, grouped by when feedback was first received in Singapore. This uses the date range and service/technician filters, independently of the order date basis. Shared team feedback counts once here; a technician filter uses the team recorded for that visit.</p>
      <div className="grid gap-3 sm:grid-cols-2"><Metric title="Reviewed visits" value={audience.reviews.total} /><Metric title="Average customer rating" value={audience.reviews.average === null ? 'No ratings' : `${audience.reviews.average.toFixed(2)} / 5`} /></div>
      <div className="grid min-w-0 items-start gap-6 lg:grid-cols-2">
        <div className="overflow-x-auto"><table className="w-full text-left text-sm"><caption className="sr-only">Positive, neutral and negative feedback comparison</caption><thead><tr><th className="p-3">Rating</th><th className="p-3">Reviews</th><th className="p-3">Share of ratings</th></tr></thead><tbody>{reviewBands.map(band => <tr className="border-t" key={band.key}><th className="p-3 font-medium"><span className="mr-2 inline-block size-2 rounded-full" style={{backgroundColor:band.colour}} />{band.label}<span className="block text-xs font-normal text-muted-foreground">{band.stars}</span></th><td className="p-3 tabular-nums">{audience.reviews[band.key]}</td><td className="p-3 tabular-nums">{audience.reviews.total ? `${(100*audience.reviews[band.key]/audience.reviews.total).toFixed(1)}%` : '—'}</td></tr>)}</tbody></table><p className="mt-3 text-xs text-muted-foreground">Unrated visits are excluded, not counted as negative feedback. Edited feedback replaces its previous rating without creating another review.</p></div>
        {audience.reviews.total ? <StackedChart title="Received customer ratings" rows={audience.periods} groupBy={groupBy} series={reviewBands.map(b=>({key:b.key,label:`${b.label} (${b.stars})`,colour:b.colour}))} /> : empty}
      </div>
      {audience.reviews.fallbackDates>0 && <p className="text-xs text-muted-foreground">{audience.reviews.fallbackDates} historical review(s) have no original receipt audit. Their latest saved feedback date is used.</p>}
      <details><summary className="cursor-pointer text-sm font-medium text-primary">View rating data by period</summary><div className="mt-3 max-h-72 overflow-auto"><table className="w-full text-left text-sm"><caption className="sr-only">Received ratings by period</caption><thead><tr><th className="p-2">Period</th>{reviewBands.map(b=><th className="p-2" key={b.key}>{b.label}</th>)}</tr></thead><tbody>{audience.periods.map(r=><tr className="border-t" key={r.period}><td className="p-2">{periodLabel(r.period,groupBy)}{r.partial?' *':''}</td>{reviewBands.map(b=><td className="p-2" key={b.key}>{integer.format(r[b.key])}</td>)}</tr>)}</tbody></table></div></details>
    </Section>
    <Section title="Annual bundle visit breakdown">
      <p className="text-sm text-muted-foreground">Each row shows all four quarterly entitlements for a plan with at least one visit in this report. Counts describe the whole plan, including visits outside the filters. A return visit remains part of its original entitlement.</p>
      {!audience.annualPlans.length ? <p className="text-sm text-muted-foreground">No annual bundle visits match these filters.</p> : <div className="max-h-[640px] overflow-auto rounded-xl border" role="region" aria-label="Annual bundle visits" tabIndex={0}><table className="w-full min-w-[980px] text-left text-sm"><caption className="sr-only">Annual plans split into four individual visit statuses</caption><thead className="sticky top-0 z-10 bg-muted"><tr><th className="p-3">Plan / customer</th><th className="p-3">Visit totals</th>{[1,2,3,4].map(n=><th className="p-3" key={n}>Visit {n}</th>)}</tr></thead><tbody>{audience.annualPlans.map(plan=><tr className="border-t align-top" key={plan.seriesId}><th className="max-w-60 p-3 font-normal"><p className="font-semibold">Plan #{plan.seriesId}</p><p className="mt-1 font-medium">{plan.customerName}</p><p className="mt-1 text-xs text-muted-foreground">{plan.address}</p></th><td className="min-w-40 p-3"><p className="font-semibold">{plan.totalVisits} visits</p><p>{plan.completed} completed</p><p>{plan.awaiting} awaiting / in progress</p><p>{plan.closed} closed</p><p className="mt-2 text-xs text-muted-foreground">{plan.selectedVisits} in this report</p>{plan.recordedVisits<plan.totalVisits && <p className="text-xs text-amber-800">{plan.totalVisits-plan.recordedVisits} not recorded</p>}</td>{[1,2,3,4].map(n=>{const v=plan.visits.find(v=>v.visitNumber===n);return <td className="min-w-40 p-3" key={n}>{v?<><span className={`inline-block rounded-full px-2 py-1 text-xs font-medium ${v.category==='completed'?'bg-emerald-50 text-emerald-800':v.category==='closed'?'bg-slate-100 text-slate-700':'bg-blue-50 text-blue-800'}`}>{v.category==='awaiting'?(v.status==='In Progress'?'In progress':v.status==='On The Way'?'On the way':'Awaiting service'):v.category==='closed'?'Closed':'Completed'}</span><p className="mt-2">{day(v.date)}</p><p className="mt-1 text-xs text-muted-foreground">{v.status}</p><Link className="mt-2 block text-xs text-primary underline underline-offset-4" href={`/admin/orders/${v.bookingId}`}>{v.reference}</Link><p className="mt-1 text-xs text-muted-foreground">{v.included?'In this report':'Outside report filters'}</p></>:<span className="text-muted-foreground">Not recorded</span>}</td>;})}</tr>)}</tbody></table></div>}
    </Section>
  </div>;
}
