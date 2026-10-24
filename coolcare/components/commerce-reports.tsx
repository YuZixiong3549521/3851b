'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { BarChart3, CalendarRange, Download, ExternalLink, RefreshCw } from 'lucide-react';
import { ReportAnalyticsCharts } from '@/components/report-analytics-charts';
import type { AnalyticsPeriod, GroupBy } from '@/lib/report-analytics-types';
import { NativeSelect } from '@/components/ui/native-select';
import { Button } from '@/components/ui/button';
import { EnglishDatePicker } from '@/components/english-date-picker';
import { useResource } from '@/lib/inventory-client';
import { singaporeToday } from '@/lib/booking-schedule';
import { Section, Metric, Field, Feedback, day, money } from './commerce-shared';

type Report = {
  filters: { from: string; to: string; groupBy: GroupBy; serviceId?: number; serviceGroup?: 'annual'; technicianId?: number };
  analytics: { periods: AnalyticsPeriod[] };
  summary: { orders: number; completed: number; cancelled: number; returnOrders: number; visits: number; completionRate: number; cancellationRate: number; returnRate: number; completedServiceAmount: number; unknownCompletedPrices: number; rewardDiscounts: number; completedNetServiceAmount: number };
  dailyService: { date: string; completed: number; serviceAmount: number; rewardDiscounts: number; netServiceAmount: number }[];
  periodService: { period: string; completed: number; serviceAmount: number; rewardDiscounts: number; netServiceAmount: number }[];
  orders: { bookingId: number; bookingReference: string; status: string; serviceDate: string; serviceName: string; visits: number; returns: number; serviceAmount: number | null; rewardDiscount: number; netServiceAmount: number | null }[];
  parts: { partId: number; name: string; unit: string; issued: number; returned: number }[];
  bundles: { plans: number; scheduledVisits: number; completedVisits: number };
  services: { id: number; name: string; isCurrent: boolean }[]; technicians: { id: number; name: string }[];
};
export function CommerceReportsPage() {
  const today = singaporeToday();
  const [from, setFrom] = useState(today.slice(0, 4) + '-01-01'), [to, setTo] = useState(today), [service, setService] = useState(''), [technician, setTechnician] = useState('');
  const [groupBy, setGroupBy] = useState<GroupBy>('quarter');
  const [query, setQuery] = useState(new URLSearchParams({ from, to, groupBy }).toString());
  const { data, error, loading, reload } = useResource<Report>('/commerce/admin/reports?' + query);
  const [exportError, setExportError] = useState('');
  const [filterError, setFilterError] = useState('');
  const [catalogues, setCatalogues] = useState<Pick<Report, 'services' | 'technicians'>>({ services: [], technicians: [] });
  useEffect(() => { if (data) setCatalogues({ services: data.services, technicians: data.technicians }); }, [data]);
  const appliedGroup = new URLSearchParams(query).get('groupBy');
  function preset(period: 'quarter' | 'year' | 'years' | 'lastYear') {
    const year = Number(today.slice(0, 4));
    const startMonth = period === 'quarter' ? String(Math.floor((Number(today.slice(5, 7)) - 1) / 3) * 3 + 1).padStart(2, '0') : '01';
    const start = `${period === 'years' ? year - 2 : period === 'lastYear' ? year - 1 : year}-${startMonth}-01`;
    const end = period === 'lastYear' ? `${year - 1}-12-31` : today;
    const grouping: GroupBy = period === 'years' ? 'year' : period === 'quarter' ? 'day' : 'quarter';
    setFrom(start); setTo(end); setGroupBy(grouping);
    applyFilters(start, end, grouping);
  }
  function applyFilters(start = from, end = to, grouping: GroupBy = groupBy) {
    if (!start || !end || start > end || (Date.parse(end) - Date.parse(start)) / 86400000 > 1830) { setFilterError('Choose a valid date range of at most five years.'); return; }
    setFilterError(''); setExportError('');
    const q = new URLSearchParams({ from: start, to: end, groupBy: grouping });
    if (service === 'annual') q.set('serviceGroup', 'annual'); else if (service) q.set('serviceId', service);
    if (technician) q.set('technicianId', technician);
    if (q.toString() === query) reload(); else setQuery(q.toString());
  }
  async function download() {
    setExportError('');
    try {
      const response = await fetch('/api/commerce/admin/reports.csv?' + query);
      if (!response.ok) throw new Error((await response.json() as { error?: string }).error || 'Unable to export report.');
      const url = URL.createObjectURL(await response.blob()), a = document.createElement('a'); a.href = url; a.download = 'coolcare-report.csv'; a.click(); URL.revokeObjectURL(url);
    } catch (e) { setExportError(e instanceof Error ? e.message : 'Unable to export report.'); }
  }
  return <div className="mx-auto min-w-0 max-w-7xl space-y-6">
    <header className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-sm font-semibold text-primary">OPERATIONS</p><h1 className="mt-1 text-3xl font-bold">Reports &amp; analytics</h1><p className="mt-2 text-sm text-muted-foreground">Compare quarterly and yearly service values, orders and annual-plan visits.</p></div><div className="flex gap-2"><Button variant="outline" onClick={reload} disabled={loading}><RefreshCw className="size-4" />Refresh</Button><Button variant="outline" onClick={() => void download()} disabled={!data || loading}><Download className="size-4" />Export CSV</Button></div></header>
    <div className="space-y-3" aria-label="Quick report periods">
      <div className="flex flex-wrap items-center gap-3"><div className="flex flex-wrap gap-2" role="group" aria-label="Chart views">
        <Button variant={appliedGroup === 'quarter' ? 'default' : 'outline'} aria-pressed={appliedGroup === 'quarter'} disabled={loading} onClick={() => preset('year')}><BarChart3 className="size-4" />Quarterly view</Button>
        <Button variant={appliedGroup === 'year' ? 'default' : 'outline'} aria-pressed={appliedGroup === 'year'} disabled={loading} onClick={() => preset('years')}><CalendarRange className="size-4" />Yearly view</Button>
      </div><p className="text-xs text-muted-foreground">Quarterly: this year to date · Yearly: last 3 years to date</p></div>
      <div className="flex flex-wrap items-center gap-2"><span className="mr-1 text-xs text-muted-foreground">More periods</span><Button variant="outline" size="sm" disabled={loading} onClick={() => preset('lastYear')}>Last year by quarter</Button><Button variant="outline" size="sm" disabled={loading} onClick={() => preset('quarter')}>This quarter by day</Button></div>
    </div>
    <form className="grid items-end gap-4 rounded-2xl border bg-card p-5 sm:grid-cols-2 lg:grid-cols-3" onSubmit={e => { e.preventDefault(); applyFilters(); }}>
      <Field label="From"><EnglishDatePicker label="Report start date" value={from} onChange={setFrom} disableWeekends={false} max={to} /></Field>
      <Field label="To"><EnglishDatePicker label="Report end date" value={to} onChange={setTo} disableWeekends={false} min={from} /></Field>
      <Field label="Service"><NativeSelect value={service} onChange={e => setService(e.target.value)}><option value="">All services</option><optgroup label="Current services">{catalogues.services.filter(s => s.isCurrent).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}<option value="annual">Annual Cleaning Bundle</option></optgroup><optgroup label="Historical services">{catalogues.services.filter(s => !s.isCurrent).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</optgroup></NativeSelect></Field>
      <Field label="Technician"><NativeSelect value={technician} onChange={e => setTechnician(e.target.value)}><option value="">All technicians</option>{catalogues.technicians.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</NativeSelect></Field>
      <Field label="Group charts by"><NativeSelect value={groupBy} onChange={e => setGroupBy(e.target.value as GroupBy)}><option value="day">Date</option><option value="quarter">Quarter</option><option value="year">Year</option></NativeSelect></Field><Button type="submit" disabled={loading}>Apply filters</Button>
    </form>
    <Feedback error={filterError || error || exportError} />{loading && <p role="status">Loading report…</p>}
    {data && <>
      <div className="space-y-1 rounded-xl border bg-primary/5 p-4" role="status"><p className="text-sm font-semibold">Showing {day(data.filters.from)}–{day(data.filters.to)} · {data.filters.groupBy === 'quarter' ? 'Quarterly' : data.filters.groupBy === 'year' ? 'Yearly' : 'Daily'}</p><p className="text-sm text-muted-foreground">{data.filters.serviceGroup === 'annual' ? 'Annual Cleaning Bundle' : data.services.find(s => s.id === data.filters.serviceId)?.name ?? 'All services'} · {data.technicians.find(t => t.id === data.filters.technicianId)?.name ?? 'All technicians'}</p></div>
      <p className="text-sm text-muted-foreground">Charts use the current scheduled service date in Singapore and each booking&apos;s current status. Rescheduling can move an order between periods. Parts use the stock movement date. A technician filter includes orders they were assigned or recorded visiting; service values and parts remain whole-order totals. Visit and return counts use recorded visit ownership.</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Metric title="Orders" value={data.summary.orders} /><Metric title="Recorded started visits" value={data.summary.visits} /><Metric title="Completion rate" value={`${data.summary.completionRate}%`} /><Metric title="Cancellation rate" value={`${data.summary.cancellationRate}%`} /></div>
      <div className="grid gap-3 sm:grid-cols-3"><Metric title="Completed service amount" value={money(data.summary.completedServiceAmount)} /><Metric title="Applied reward discounts" value={money(data.summary.rewardDiscounts)} /><Metric title="Completed service after rewards" value={money(data.summary.completedNetServiceAmount)} /></div>
      <p className="text-sm text-muted-foreground">Service values include recorded repair extras. Applied reward discounts are deducted once per completed order. {data.summary.unknownCompletedPrices > 0 && `${data.summary.unknownCompletedPrices} completed historical order(s) have no recorded price and are excluded from these totals.`}</p>
      <ReportAnalyticsCharts periods={data.analytics.periods} groupBy={data.filters.groupBy} />
      <div className="grid gap-6 lg:grid-cols-2"><Section title="Service follow-ups"><Metric title="Orders requiring a return" value={`${data.summary.returnOrders} (${data.summary.returnRate}%)`} /><p className="text-sm text-muted-foreground">A return remains part of the original order. Started visits are counted separately from orders. Missing historical visit records are not fabricated.</p></Section><Section title="Annual bundle usage"><div className="grid gap-3 sm:grid-cols-3"><Metric title="Plans in period" value={data.bundles.plans} /><Metric title="Quarterly visits" value={data.bundles.scheduledVisits} /><Metric title="Completed visits" value={data.bundles.completedVisits} /></div><p className="text-sm text-muted-foreground">Plans are distinct annual subscriptions with a quarterly visit in this range; a plan can span several periods. Return visits do not consume another quarterly entitlement.</p></Section></div>
      <Section title="Parts consumption">{data.parts.length ? <div className="overflow-x-auto"><table className="w-full text-left text-sm"><caption className="sr-only">Parts issued and returned</caption><thead><tr>{['Part', 'Issued', 'Returned', 'Net used'].map(v => <th className="p-3 font-medium" key={v}>{v}</th>)}</tr></thead><tbody>{data.parts.map(r => <tr className="border-t" key={r.partId}><td className="p-3">{r.name} <span className="text-muted-foreground">({r.unit})</span></td><td className="p-3">{r.issued}</td><td className="p-3">{r.returned}</td><td className="p-3">{Number(r.issued) - Number(r.returned)}</td></tr>)}</tbody></table></div> : <p className="text-sm text-muted-foreground">No work-order parts movements in this period.</p>}</Section>
      <Section title="Orders behind this report"><p className="text-sm text-muted-foreground">Open an order in a new tab to keep your current report filters.</p><div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><caption className="sr-only">Orders in the selected service-date range</caption><thead><tr>{['Booking', 'Service date', 'Service', 'Status', 'Visits', 'Service amount', 'Reward discount', 'After rewards'].map(value => <th className="p-3 font-medium" key={value}>{value}</th>)}</tr></thead><tbody>{data.orders.map(row => <tr className="border-t" key={row.bookingId}><td className="p-3"><Link className="inline-flex items-center gap-1 whitespace-nowrap text-primary underline underline-offset-4" href={`/admin/orders/${row.bookingId}`} target="_blank" rel="noopener noreferrer" aria-label={`View ${row.bookingReference} (opens in a new tab)`}>{row.bookingReference}<ExternalLink className="size-3 shrink-0" aria-hidden="true" /></Link></td><td className="p-3">{day(row.serviceDate)}</td><td className="p-3">{row.serviceName}</td><td className="p-3">{row.status}</td><td className="p-3">{row.visits}</td><td className="p-3">{money(row.serviceAmount)}</td><td className="p-3">{money(row.rewardDiscount)}</td><td className="p-3">{money(row.netServiceAmount)}</td></tr>)}</tbody></table>{!data.orders.length && <p className="p-3 text-muted-foreground">No orders match these filters.</p>}</div></Section>
    </>}
  </div>;
}
