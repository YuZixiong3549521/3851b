'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Download, ExternalLink, RefreshCw } from 'lucide-react';
import { NativeSelect } from '@/components/ui/native-select';
import { Button } from '@/components/ui/button';
import { EnglishDatePicker } from '@/components/english-date-picker';
import { useResource } from '@/lib/inventory-client';
import { singaporeToday } from '@/lib/booking-schedule';
import { Section, Metric, Field, Feedback, day, money } from './commerce-shared';

type Report = {
  filters: { from: string; to: string; groupBy: 'day' | 'quarter' | 'year' };
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
  const [from, setFrom] = useState(today.slice(0, 7) + '-01'), [to, setTo] = useState(today), [service, setService] = useState(''), [technician, setTechnician] = useState('');
  const [groupBy, setGroupBy] = useState('quarter');
  const [query, setQuery] = useState(new URLSearchParams({ from, to, groupBy }).toString());
  const { data, error, loading, reload } = useResource<Report>('/commerce/admin/reports?' + query);
  const [exportError, setExportError] = useState('');
  const periodLabel = (value: string) => data?.filters.groupBy === 'day' ? day(value) : value.replace(/^(\d{4})-Q(\d)$/, 'Q$2 $1');
  function preset(period: 'quarter' | 'year' | 'years') {
    const year = Number(today.slice(0, 4));
    const startMonth = period === 'quarter' ? String(Math.floor((Number(today.slice(5, 7)) - 1) / 3) * 3 + 1).padStart(2, '0') : '01';
    const start = `${period === 'years' ? year - 2 : year}-${startMonth}-01`;
    const grouping = period === 'years' ? 'year' : 'quarter';
    setFrom(start); setTo(today); setGroupBy(grouping);
    applyFilters(start, today, grouping);
  }
  function applyFilters(start = from, end = to, grouping = groupBy) {
    const q = new URLSearchParams({ from: start, to: end, groupBy: grouping });
    if (service === 'annual') q.set('serviceGroup', 'annual'); else if (service) q.set('serviceId', service);
    if (technician) q.set('technicianId', technician);
    setQuery(q.toString());
  }
  async function download() {
    setExportError('');
    try {
      const response = await fetch('/api/commerce/admin/reports.csv?' + query);
      if (!response.ok) throw new Error((await response.json() as { error?: string }).error || 'Unable to export report.');
      const url = URL.createObjectURL(await response.blob()), a = document.createElement('a'); a.href = url; a.download = 'coolcare-report.csv'; a.click(); URL.revokeObjectURL(url);
    } catch (e) { setExportError(e instanceof Error ? e.message : 'Unable to export report.'); }
  }
  return <div className="mx-auto max-w-7xl space-y-6">
    <header className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-sm font-semibold text-primary">OPERATIONS</p><h1 className="mt-1 text-3xl font-bold">Reports &amp; analytics</h1><p className="mt-2 text-sm text-muted-foreground">Live booking, completed service, rewards and inventory records.</p></div><div className="flex gap-2"><Button variant="outline" onClick={reload} disabled={loading}><RefreshCw className="size-4" />Refresh</Button><Button variant="outline" onClick={() => void download()} disabled={!data || loading}><Download className="size-4" />Export CSV</Button></div></header>
    <div className="flex flex-wrap items-center gap-2" aria-label="Quick report periods"><span className="mr-2 text-sm text-muted-foreground">Quick periods</span><Button variant="outline" size="sm" onClick={() => preset('quarter')}>This quarter</Button><Button variant="outline" size="sm" onClick={() => preset('year')}>This year</Button><Button variant="outline" size="sm" onClick={() => preset('years')}>Last 3 years</Button></div>
    <form className="grid items-end gap-4 rounded-2xl border bg-card p-5 sm:grid-cols-2 lg:grid-cols-3" onSubmit={e => { e.preventDefault(); applyFilters(); }}>
      <Field label="From"><EnglishDatePicker label="Report start date" value={from} onChange={setFrom} disableWeekends={false} max={to} /></Field>
      <Field label="To"><EnglishDatePicker label="Report end date" value={to} onChange={setTo} disableWeekends={false} min={from} /></Field>
      <Field label="Service"><NativeSelect value={service} onChange={e => setService(e.target.value)}><option value="">All services</option><optgroup label="Current services">{data?.services.filter(s => s.isCurrent).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}<option value="annual">Annual Cleaning Bundle</option></optgroup><optgroup label="Historical services">{data?.services.filter(s => !s.isCurrent).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</optgroup></NativeSelect></Field>
      <Field label="Technician"><NativeSelect value={technician} onChange={e => setTechnician(e.target.value)}><option value="">All technicians</option>{data?.technicians.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</NativeSelect></Field>
      <Field label="Group service values by"><NativeSelect value={groupBy} onChange={e => setGroupBy(e.target.value)}><option value="day">Date</option><option value="quarter">Quarter</option><option value="year">Year</option></NativeSelect></Field><Button type="submit">Apply filters</Button>
    </form>
    <Feedback error={error || exportError} />{loading && <p role="status">Loading report…</p>}
    {data && <>
      <p className="text-sm text-muted-foreground">Orders and service amounts use their scheduled service date. Parts use the stock movement date in Singapore. A technician filter includes orders they were assigned or recorded visiting; service values and parts remain whole-order totals. Visit and return counts use the recorded visit technician where available. Rates describe the selected orders, not individual performance ratings.</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Metric title="Orders" value={data.summary.orders} /><Metric title="Recorded started visits" value={data.summary.visits} /><Metric title="Completion rate" value={`${data.summary.completionRate}%`} /><Metric title="Cancellation rate" value={`${data.summary.cancellationRate}%`} /></div>
      <div className="grid gap-3 sm:grid-cols-3"><Metric title="Completed service amount" value={money(data.summary.completedServiceAmount)} /><Metric title="Applied reward discounts" value={money(data.summary.rewardDiscounts)} /><Metric title="Completed service after rewards" value={money(data.summary.completedNetServiceAmount)} /></div>
      <p className="text-sm text-muted-foreground">Service values include recorded repair extras. Applied reward discounts are deducted once per completed order. {data.summary.unknownCompletedPrices > 0 && `${data.summary.unknownCompletedPrices} completed historical order(s) have no recorded price and are excluded from these totals.`}</p>
      <Section title={`Completed service value by ${data.filters.groupBy === 'day' ? 'date' : data.filters.groupBy}`}><p className="text-sm text-muted-foreground">{day(data.filters.from)}–{day(data.filters.to)} · Periods include only dates in this range; a partial quarter or year is not a full-period total. Amounts represent service value, not payments collected.</p>
        {data.periodService.length ? <><div className="h-64 w-full" aria-hidden="true"><ResponsiveContainer width="100%" height={256} minWidth={0}><BarChart data={data.periodService}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="period" tickFormatter={value => periodLabel(String(value))} /><YAxis /><Tooltip labelFormatter={label => periodLabel(String(label))} /><Bar dataKey="serviceAmount" name="Service amount (SGD)" fill="var(--primary)" /><Bar dataKey="netServiceAmount" name="After rewards (SGD)" fill="var(--secondary)" /></BarChart></ResponsiveContainer></div><div className="overflow-x-auto"><table className="w-full min-w-[560px] text-left text-sm"><caption className="sr-only">Completed service values by scheduled service date, in Singapore dollars</caption><thead><tr>{['Period', 'Completed orders', 'Service amount', 'Reward discounts', 'After rewards'].map(value => <th className="p-3 font-medium" key={value}>{value}</th>)}</tr></thead><tbody>{data.periodService.map(row => <tr className="border-t" key={row.period}><td className="p-3">{periodLabel(row.period)}</td><td className="p-3">{row.completed}</td><td className="p-3">{money(row.serviceAmount)}</td><td className="p-3">{money(row.rewardDiscounts)}</td><td className="p-3">{money(row.netServiceAmount)}</td></tr>)}</tbody></table></div></> : <p className="text-sm text-muted-foreground">No completed services in this period.</p>}
      </Section>
      <div className="grid gap-6 lg:grid-cols-2"><Section title="Service follow-ups"><Metric title="Orders requiring a return" value={`${data.summary.returnOrders} (${data.summary.returnRate}%)`} /><p className="text-sm text-muted-foreground">A return remains part of the original order. Started visits are counted separately from orders. Missing historical visit records are not fabricated.</p></Section><Section title="Annual bundle usage"><div className="grid gap-3 sm:grid-cols-3"><Metric title="Plans in period" value={data.bundles.plans} /><Metric title="Quarterly visits" value={data.bundles.scheduledVisits} /><Metric title="Completed visits" value={data.bundles.completedVisits} /></div><p className="text-sm text-muted-foreground">Return visits do not consume another quarterly entitlement.</p></Section></div>
      <Section title="Parts consumption">{data.parts.length ? <div className="overflow-x-auto"><table className="w-full text-left text-sm"><caption className="sr-only">Parts issued and returned</caption><thead><tr>{['Part', 'Issued', 'Returned', 'Net used'].map(v => <th className="p-3 font-medium" key={v}>{v}</th>)}</tr></thead><tbody>{data.parts.map(r => <tr className="border-t" key={r.partId}><td className="p-3">{r.name} <span className="text-muted-foreground">({r.unit})</span></td><td className="p-3">{r.issued}</td><td className="p-3">{r.returned}</td><td className="p-3">{Number(r.issued) - Number(r.returned)}</td></tr>)}</tbody></table></div> : <p className="text-sm text-muted-foreground">No work-order parts movements in this period.</p>}</Section>
      <Section title="Orders behind this report"><p className="text-sm text-muted-foreground">Open an order in a new tab to keep your current report filters.</p><div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><caption className="sr-only">Orders in the selected service-date range</caption><thead><tr>{['Booking', 'Service date', 'Service', 'Status', 'Visits', 'Service amount', 'Reward discount', 'After rewards'].map(value => <th className="p-3 font-medium" key={value}>{value}</th>)}</tr></thead><tbody>{data.orders.map(row => <tr className="border-t" key={row.bookingId}><td className="p-3"><Link className="inline-flex items-center gap-1 whitespace-nowrap text-primary underline underline-offset-4" href={`/admin/orders/${row.bookingId}`} target="_blank" rel="noopener noreferrer" aria-label={`View ${row.bookingReference} (opens in a new tab)`}>{row.bookingReference}<ExternalLink className="size-3 shrink-0" aria-hidden="true" /></Link></td><td className="p-3">{day(row.serviceDate)}</td><td className="p-3">{row.serviceName}</td><td className="p-3">{row.status}</td><td className="p-3">{row.visits}</td><td className="p-3">{money(row.serviceAmount)}</td><td className="p-3">{money(row.rewardDiscount)}</td><td className="p-3">{money(row.netServiceAmount)}</td></tr>)}</tbody></table>{!data.orders.length && <p className="p-3 text-muted-foreground">No orders match these filters.</p>}</div></Section>
    </>}
  </div>;
}
