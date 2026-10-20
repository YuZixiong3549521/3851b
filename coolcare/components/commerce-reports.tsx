'use client';

import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Download, RefreshCw } from 'lucide-react';
import { NativeSelect } from '@/components/ui/native-select';
import { Button } from '@/components/ui/button';
import { EnglishDatePicker } from '@/components/english-date-picker';
import { useResource } from '@/lib/inventory-client';
import { singaporeToday } from '@/lib/booking-schedule';
import { Section, Metric, Field, Feedback, day, money } from './commerce-shared';

type Report = {
  summary: { orders: number; completed: number; cancelled: number; returnOrders: number; visits: number; completionRate: number; cancellationRate: number; returnRate: number; completedServiceAmount: number; unknownCompletedPrices: number; receipts: number; refunds: number; netReceived: number };
  cash: { date: string; receipts: number; refunds: number; net: number }[];
  orders: { bookingId: number; status: string; serviceDate: string; serviceName: string; visits: number; returns: number; baseAmount: number | null; additionalFee: number }[];
  parts: { partId: number; name: string; unit: string; issued: number; returned: number }[];
  bundles: { plans: number; scheduledVisits: number; completedVisits: number };
  services: { id: number; name: string }[]; technicians: { id: number; name: string }[];
};
export function CommerceReportsPage() {
  const today = singaporeToday();
  const [from, setFrom] = useState(today.slice(0, 7) + '-01'), [to, setTo] = useState(today), [service, setService] = useState(''), [technician, setTechnician] = useState('');
  const [query, setQuery] = useState(new URLSearchParams({ from, to }).toString());
  const { data, error, loading, reload } = useResource<Report>('/commerce/admin/reports?' + query);
  const [exportError, setExportError] = useState('');
  async function download() {
    setExportError('');
    try {
      const response = await fetch('/api/commerce/admin/reports.csv?' + query);
      if (!response.ok) throw new Error((await response.json() as { error?: string }).error || 'Unable to export report.');
      const url = URL.createObjectURL(await response.blob()), a = document.createElement('a'); a.href = url; a.download = 'coolcare-report.csv'; a.click(); URL.revokeObjectURL(url);
    } catch (e) { setExportError(e instanceof Error ? e.message : 'Unable to export report.'); }
  }
  return <div className="mx-auto max-w-7xl space-y-6">
    <header className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-sm font-semibold text-primary">OPERATIONS</p><h1 className="mt-1 text-3xl font-bold">Reports &amp; analytics</h1><p className="mt-2 text-sm text-muted-foreground">Live booking, service, collection and inventory records.</p></div><div className="flex gap-2"><Button variant="outline" onClick={reload} disabled={loading}><RefreshCw className="size-4" />Refresh</Button><Button variant="outline" onClick={() => void download()} disabled={!data || loading}><Download className="size-4" />Export CSV</Button></div></header>
    <form className="grid items-end gap-4 rounded-2xl border bg-card p-5 sm:grid-cols-2 lg:grid-cols-5" onSubmit={e => { e.preventDefault(); const q = new URLSearchParams({ from, to }); if (service) q.set('serviceId', service); if (technician) q.set('technicianId', technician); setQuery(q.toString()); }}>
      <Field label="From"><EnglishDatePicker label="Report start date" value={from} onChange={setFrom} disableWeekends={false} max={to} /></Field>
      <Field label="To"><EnglishDatePicker label="Report end date" value={to} onChange={setTo} disableWeekends={false} min={from} /></Field>
      <Field label="Service"><NativeSelect value={service} onChange={e => setService(e.target.value)}><option value="">All services</option>{data?.services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</NativeSelect></Field>
      <Field label="Technician"><NativeSelect value={technician} onChange={e => setTechnician(e.target.value)}><option value="">All technicians</option>{data?.technicians.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</NativeSelect></Field><Button type="submit">Apply filters</Button>
    </form>
    <Feedback error={error || exportError} />{loading && <p role="status">Loading report…</p>}
    {data && <>
      <p className="text-sm text-muted-foreground">Orders use their scheduled service date. Cash uses the recorded payment date. Parts use the stock movement date in Singapore. A technician filter includes orders they were assigned or recorded visiting; cash and parts remain whole-order totals. Visit and return counts use the recorded visit technician where available. Rates are order-cohort measures, not individual performance ratings.</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Metric title="Orders" value={data.summary.orders} /><Metric title="Recorded started visits" value={data.summary.visits} /><Metric title="Completion rate" value={`${data.summary.completionRate}%`} /><Metric title="Cancellation rate" value={`${data.summary.cancellationRate}%`} /></div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Metric title="Completed service quotes" value={money(data.summary.completedServiceAmount)} /><Metric title="Actual receipts" value={money(data.summary.receipts)} /><Metric title="Actual refunds" value={money(data.summary.refunds)} /><Metric title="Net received" value={money(data.summary.netReceived)} /></div>
      <p className="text-sm text-muted-foreground">Quoted amounts are before reward discounts and are not proof of payment. {data.summary.unknownCompletedPrices > 0 && `${data.summary.unknownCompletedPrices} completed historical order(s) have no recorded price and are excluded from quoted totals.`} No historical payments have been invented.</p>
      <Section title="Collections by date">
        {data.cash.length ? <><div className="h-64 w-full" aria-hidden="true"><ResponsiveContainer width="100%" height={256} minWidth={0}><BarChart data={data.cash}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="date" tickFormatter={value => day(String(value))} /><YAxis /><Tooltip labelFormatter={label => day(String(label))} /><Bar dataKey="receipts" name="Receipts (SGD)" fill="var(--primary)" /><Bar dataKey="refunds" name="Refunds (SGD)" fill="#d97706" /></BarChart></ResponsiveContainer></div><div className="overflow-x-auto"><table className="w-full text-left text-sm"><caption className="sr-only">Daily collections in Singapore dollars</caption><thead><tr>{['Date', 'Received', 'Refunded', 'Net'].map(v => <th className="p-3 font-medium" key={v}>{v}</th>)}</tr></thead><tbody>{data.cash.map(r => <tr className="border-t" key={r.date}><td className="p-3">{day(r.date)}</td><td className="p-3">{money(r.receipts)}</td><td className="p-3">{money(r.refunds)}</td><td className="p-3">{money(r.net)}</td></tr>)}</tbody></table></div></> : <p className="text-sm text-muted-foreground">No receipts or refunds in this period.</p>}
      </Section>
      <div className="grid gap-6 lg:grid-cols-2"><Section title="Service follow-ups"><Metric title="Orders requiring a return" value={`${data.summary.returnOrders} (${data.summary.returnRate}%)`} /><p className="text-sm text-muted-foreground">A return remains part of the original order. Started visits are counted separately from orders. Missing historical visit records are not fabricated.</p></Section><Section title="Annual bundle usage"><div className="grid gap-3 sm:grid-cols-3"><Metric title="Plans in period" value={data.bundles.plans} /><Metric title="Quarterly visits" value={data.bundles.scheduledVisits} /><Metric title="Completed visits" value={data.bundles.completedVisits} /></div><p className="text-sm text-muted-foreground">Return visits do not consume another quarterly entitlement.</p></Section></div>
      <Section title="Parts consumption">{data.parts.length ? <div className="overflow-x-auto"><table className="w-full text-left text-sm"><caption className="sr-only">Parts issued and returned</caption><thead><tr>{['Part', 'Issued', 'Returned', 'Net used'].map(v => <th className="p-3 font-medium" key={v}>{v}</th>)}</tr></thead><tbody>{data.parts.map(r => <tr className="border-t" key={r.partId}><td className="p-3">{r.name} <span className="text-muted-foreground">({r.unit})</span></td><td className="p-3">{r.issued}</td><td className="p-3">{r.returned}</td><td className="p-3">{Number(r.issued) - Number(r.returned)}</td></tr>)}</tbody></table></div> : <p className="text-sm text-muted-foreground">No work-order parts movements in this period.</p>}</Section>
      <Section title="Orders behind this report"><div className="overflow-x-auto"><table className="w-full min-w-[650px] text-left text-sm"><caption className="sr-only">Orders in the selected service-date range</caption><thead><tr>{['Booking', 'Service date', 'Service', 'Status', 'Visits', 'Quote'].map(v => <th className="p-3 font-medium" key={v}>{v}</th>)}</tr></thead><tbody>{data.orders.map(r => <tr className="border-t" key={r.bookingId}><td className="p-3">#{r.bookingId}</td><td className="p-3">{day(r.serviceDate)}</td><td className="p-3">{r.serviceName}</td><td className="p-3">{r.status}</td><td className="p-3">{r.visits}</td><td className="p-3">{money(r.baseAmount === null ? null : Number(r.baseAmount) + Number(r.additionalFee))}</td></tr>)}</tbody></table>{!data.orders.length && <p className="p-3 text-muted-foreground">No orders match these filters.</p>}</div></Section>
    </>}
  </div>;
}
