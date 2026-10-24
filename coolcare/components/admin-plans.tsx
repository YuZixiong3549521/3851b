'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowRight, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { NativeSelect } from '@/components/ui/native-select';
import { useResource } from '@/lib/inventory-client';
import type { AnnualPlan } from '@/lib/customer-plans-api';
import { formatDate, formatMoney } from '@/lib/format';
import { formatInstantDateTime } from '@/lib/sg-time';
import { Feedback, Metric } from './commerce-shared';

export function AdminPlans() {
  const { data, error, loading, reload } = useResource<{ plans: AnnualPlan[] }>('/commerce/admin/plans');
  const [search, setSearch] = useState(''), [status, setStatus] = useState('');
  const plans = data?.plans ?? [];
  const visible = plans.filter(plan => (!status || plan.status === status)
    && `${plan.seriesId} ${plan.customerName} ${plan.email} ${plan.addressLine} ${plan.postalCode ?? ''}`.toLowerCase().includes(search.trim().toLowerCase()));
  return <div className="mx-auto max-w-7xl space-y-6">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-3xl font-semibold">Yearly packages</h1><p className="mt-2 text-sm text-muted-foreground">Customer annual cleaning plans, quarterly orders and early renewal rewards.</p></div><Button variant="outline" disabled={loading} onClick={() => void reload()}><RefreshCw className="size-4" />Refresh</Button></header>
    <Feedback error={error} />
    {loading && !data && <p role="status">Loading annual plans…</p>}
    {data && <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4"><Metric title="Annual plans" value={plans.length} /><Metric title="Active plans" value={plans.filter(plan => plan.status === 'Active').length} /><Metric title="Completed quarterly visits" value={plans.reduce((sum, plan) => sum + plan.completedVisits, 0)} /><Metric title="Open quarterly visits" value={plans.reduce((sum, plan) => sum + plan.remainingVisits, 0)} /></div>
      <div className="flex flex-wrap gap-3"><label className="grid min-w-0 flex-1 gap-2 text-sm">Find a package<Input value={search} onChange={event => setSearch(event.target.value)} placeholder="Customer, email, address or plan ID" /></label><label className="grid gap-2 text-sm">Plan status<NativeSelect value={status} onChange={event => setStatus(event.target.value)}><option value="">All statuses</option>{['Active', 'Completed', 'Expired', 'Cancelled'].map(value => <option key={value}>{value}</option>)}</NativeSelect></label></div>
      <p className="text-sm text-muted-foreground">Showing {visible.length} of {plans.length} plans. Values describe agreed service prices, not payments received.</p>
      {!visible.length && <p className="rounded-2xl border bg-card p-6">No yearly packages match these filters.</p>}
      {visible.map(plan => <article key={plan.seriesId} id={`plan-${plan.seriesId}`} className="space-y-4 rounded-2xl border bg-card p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl font-semibold">Plan #{plan.seriesId} · {plan.customerName}</h2><p className="mt-1 break-all text-sm text-muted-foreground">{plan.email}</p></div><Badge variant={plan.status === 'Active' ? 'default' : 'secondary'}>{plan.status}</Badge></div>
        <div className="grid gap-3 text-sm sm:grid-cols-2"><div><p className="font-medium">{plan.name} · {plan.propertyLabel || 'Property type not recorded'}</p><p className="mt-1">{plan.addressLine}{plan.postalCode ? ` · Singapore ${plan.postalCode}` : ''}</p><p className="mt-1 text-muted-foreground">{plan.unitCount} AC units · {formatDate(plan.validFrom)} – before {formatDate(plan.validUntil)}</p></div><div><p className="font-semibold">{formatMoney(plan.totalAmount)} annual service value</p><p className="mt-1">{plan.completedVisits} / 4 completed · {plan.remainingVisits} open · {plan.unusedClosedVisits} closed without completion</p></div></div>
        {plan.attentionMessage && <p className="rounded-xl bg-muted/50 p-3 text-sm">{plan.attentionMessage}</p>}
        {plan.earlyRenewalEligible && plan.earlyRenewalDeadline && <p className="rounded-xl bg-primary/5 p-3 text-sm">Early renewal offer: {plan.earlyRenewalPoints} points for renewal before {formatInstantDateTime(plan.earlyRenewalDeadline)}; credited after the renewed plan&apos;s first service completes.</p>}
        {plan.earlyRenewalReward && <p className="rounded-xl bg-muted/50 p-3 text-sm">Early renewal bonus: {plan.earlyRenewalReward.points} points · {plan.earlyRenewalReward.status}{plan.earlyRenewalReward.awardedAt ? ` · ${formatInstantDateTime(plan.earlyRenewalReward.awardedAt)}` : ''}</p>}
        {(plan.renewedFromSeriesId || plan.existingRenewalSeriesId) && <p className="text-sm text-muted-foreground">{plan.renewedFromSeriesId ? `Renewed from plan #${plan.renewedFromSeriesId}. ` : ''}{plan.existingRenewalSeriesId ? `Renewed as plan #${plan.existingRenewalSeriesId}.` : ''}</p>}
        <details className="rounded-xl border p-3"><summary className="cursor-pointer font-medium">Quarterly orders ({plan.visits.length})</summary><div className="mt-3 grid gap-2 sm:grid-cols-2">{plan.visits.map(visit => <div key={visit.bookingId} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-muted/30 p-3 text-sm"><div><p className="font-medium">Visit {visit.visitNumber} · {visit.reference}</p><p className="mt-1">{formatDate(visit.preferredDate)} · {visit.status}</p><p className="mt-1 text-muted-foreground">{formatMoney(visit.totalAmount)}</p></div><Button size="sm" variant="outline" nativeButton={false} render={<Link href={`/admin/orders/${visit.bookingId}`} />}>Open order<ArrowRight className="size-4" /></Button></div>)}</div></details>
      </article>)}
    </>}
  </div>;
}
