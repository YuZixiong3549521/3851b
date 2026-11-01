'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { NativeSelect } from '@/components/ui/native-select';
import { api, ApiError, errorText, useInventory, useResource } from '@/lib/inventory-client';
import { planFiltersUrl, readPlanFilters } from '@/lib/admin-navigation.mjs';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import type { AnnualPlan } from '@/lib/customer-plans-api';
import { formatDate, formatMoney } from '@/lib/format';
import { formatInstantDateTime } from '@/lib/sg-time';
import { Feedback, Metric } from './commerce-shared';
import { matchesPlanAttention } from '@/lib/admin-plan-filters.mjs';
import { singaporeToday } from '@/lib/booking-schedule';

export function AdminPlans({ params }: { params: URLSearchParams }) {
  const { go } = useInventory();
  const { data, error, loading, reload } = useResource<{ plans: AnnualPlan[] }>('/commerce/admin/plans');
  const { search, status, attention } = readPlanFilters(params);
  const setSearch = (q: string) => go(planFiltersUrl(params, { q }), false, true);
  const setStatus = (status: string) => go(planFiltersUrl(params, { status }));
  const setAttention = (attention: string) => go(planFiltersUrl(params, { attention }));
  const [contactPlan, setContactPlan] = useState<AnnualPlan | null>(null);
  const [channel, setChannel] = useState('Phone'), [note, setNote] = useState('');
  const [saving, setSaving] = useState(false), [saveError, setSaveError] = useState('');
  const pending = useRef<{ payload: string; requestId: string } | null>(null);
  async function saveContact() {
    if (!contactPlan?.reminder || note.trim().length < 5 || saving) return;
    const payload = JSON.stringify({ seriesId: contactPlan.seriesId, reminderKey: contactPlan.reminder.key, channel, note: note.trim() });
    if (pending.current?.payload !== payload) pending.current = { payload, requestId: crypto.randomUUID() };
    setSaving(true); setSaveError('');
    try {
      await api(`/commerce/admin/plans/${contactPlan.seriesId}/reminders`, 'POST', { requestId: pending.current.requestId, reminderKey: contactPlan.reminder.key, channel, note: note.trim() });
      pending.current = null; setContactPlan(null); setNote('');
      await reload();
    } catch (cause) {
      setSaveError(errorText(cause));
      if (cause instanceof ApiError && cause.status < 500) pending.current = null;
    } finally { setSaving(false); }
  }
  const plans = data?.plans ?? [];
  const visible = plans.filter(plan => (!status || plan.status === status) && matchesPlanAttention(plan, attention, singaporeToday())
    && `${plan.seriesId} ${plan.customerName} ${plan.email} ${plan.addressLine} ${plan.postalCode ?? ''}`.toLowerCase().includes(search.trim().toLowerCase()));
  return <div className="mx-auto max-w-7xl space-y-6">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-3xl font-semibold">Yearly packages</h1><p className="mt-2 text-sm text-muted-foreground">Customer annual cleaning plans, quarterly orders and early renewal rewards.</p></div><Button variant="outline" disabled={loading} onClick={() => void reload()}><RefreshCw className="size-4" />Refresh</Button></header>
    <Feedback error={error} />
    {loading && !data && <p role="status">Loading annual plans…</p>}
    {data && <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4"><Metric title="Annual plans" value={plans.length} /><Metric title="Active plans" value={plans.filter(plan => plan.status === 'Active').length} /><Metric title="Completed quarterly visits" value={plans.reduce((sum, plan) => sum + plan.completedVisits, 0)} /><Metric title="Open quarterly visits" value={plans.reduce((sum, plan) => sum + plan.remainingVisits, 0)} /></div>
      <div className="flex flex-wrap gap-3"><label className="grid min-w-0 flex-1 gap-2 text-sm">Find a package<Input value={search} maxLength={120} onChange={event => setSearch(event.target.value)} placeholder="Customer, email, address or plan ID" /></label><label className="grid gap-2 text-sm">Plan status<NativeSelect value={status} onChange={event => setStatus(event.target.value)}><option value="">All statuses</option>{['Active', 'Completed', 'Expired', 'Cancelled'].map(value => <option key={value}>{value}</option>)}</NativeSelect></label></div>
      <p className="text-sm text-muted-foreground">Showing {visible.length} of {plans.length} plans. Values describe agreed service prices, not payments received.</p>
      <label htmlFor="admin-plan-attention" className="grid gap-2 text-sm sm:max-w-sm">Renewal attention<NativeSelect id="admin-plan-attention" value={attention} onChange={e => setAttention(e.target.value)}>
        <option value="all">All packages</option><option value="unrenewed">Not renewed</option><option value="renewable">Ready for renewal</option>
        <option value="expiring">Plan expires within 30 days</option><option value="bonus">Eligible for early renewal points</option><option value="bonus-soon">Points offer ends within 14 days</option>
        <option value="reminder-due">Renewal contact due within 14 days or overdue</option><option value="contacted">Contact recorded for current dates</option>
        <option value="reminder-overdue">Renewal contact overdue</option>
      </NativeSelect></label>
      <p className="text-sm text-muted-foreground">Renewal opens 60 days before the final scheduled visit. Renew before that visit starts to qualify for the displayed bonus; points are credited after the new plan’s first service completes.</p>
      {!visible.length && <p className="rounded-2xl border bg-card p-6">No yearly packages match these filters.</p>}
      {visible.map(plan => <article key={plan.seriesId} id={`plan-${plan.seriesId}`} className="space-y-4 rounded-2xl border bg-card p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl font-semibold">Plan #{plan.seriesId} · {plan.customerName}</h2><p className="mt-1 break-all text-sm text-muted-foreground">{plan.email}</p></div><Badge variant={plan.status === 'Active' ? 'default' : 'secondary'}>{plan.status}</Badge></div>
        <div className="grid gap-3 text-sm sm:grid-cols-2"><div><p className="font-medium">{plan.name} · {plan.propertyLabel || 'Property type not recorded'}</p><p className="mt-1">{plan.addressLine}{plan.postalCode ? ` · Singapore ${plan.postalCode}` : ''}</p><p className="mt-1 text-muted-foreground">{plan.unitCount} AC units · {formatDate(plan.validFrom)} – before {formatDate(plan.validUntil)}</p></div><div><p className="font-semibold">{formatMoney(plan.totalAmount)} annual service value</p><p className="mt-1">{plan.completedVisits} / 4 completed · {plan.remainingVisits} open · {plan.unusedClosedVisits} closed without completion</p></div></div>
        {plan.attentionMessage && <p className="rounded-xl bg-muted/50 p-3 text-sm">{plan.attentionMessage}</p>}
        {!plan.existingRenewalSeriesId && plan.status === 'Active' && <p className="text-sm text-muted-foreground">Renewal opens: {formatDate(plan.renewalOpenDate)}. {plan.earlyRenewalDeadline ? <>Final-visit deadline: {formatInstantDateTime(plan.earlyRenewalDeadline)}.</> : 'The final-visit deadline is not recorded.'}</p>}
        {plan.earlyRenewalEligible && plan.earlyRenewalDeadline && <p className="rounded-xl bg-primary/5 p-3 text-sm">Early renewal offer: {plan.earlyRenewalPoints} points for renewal before {formatInstantDateTime(plan.earlyRenewalDeadline)}; credited after the renewed plan&apos;s first service completes.</p>}
        {plan.earlyRenewalReward && <p className="rounded-xl bg-muted/50 p-3 text-sm">Early renewal bonus: {plan.earlyRenewalReward.points} points · {plan.earlyRenewalReward.status}{plan.earlyRenewalReward.awardedAt ? ` · ${formatInstantDateTime(plan.earlyRenewalReward.awardedAt)}` : ''}</p>}
        {plan.reminder && <section className="space-y-3 rounded-xl border p-3" aria-label={`Renewal contact for plan ${plan.seriesId}`}>
          <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-medium">Renewal contact <Badge variant={plan.reminder.due ? 'destructive' : 'secondary'}>{!plan.reminder.available ? 'Closed' : plan.reminder.contacted ? 'Contact recorded' : plan.reminder.due ? 'Contact due' : 'Not yet due'}</Badge></p><p className="mt-1 text-sm text-muted-foreground">Contact before {formatDate(plan.reminder.dueDate)}. Pending plans appear from 14 days before the final visit or plan expiry, whichever comes first.</p></div>{plan.reminder.available && <Button variant="outline" size="sm" onClick={() => { setContactPlan(plan); setChannel('Phone'); setNote(''); setSaveError(''); }}>Record contact</Button>}</div>
          <p className="text-sm text-muted-foreground">Record contact already made by phone, email or another channel. Saving this record sends no message. A changed renewal deadline needs a new contact record.</p>
          {plan.reminder.history.length > 0 && <details><summary className="cursor-pointer text-sm font-medium">Contact history (latest {plan.reminder.history.length})</summary><ul className="mt-3 space-y-3 text-sm">{plan.reminder.history.map(item => <li key={item.reminderId}><p className="font-medium">{item.channel} · {item.actorName} · {formatInstantDateTime(item.createdAt)}</p><p className="mt-1 whitespace-pre-wrap break-words">{item.note}</p>{item.reminderKey !== plan.reminder?.key && <p className="text-muted-foreground">Recorded for earlier plan dates.</p>}</li>)}</ul></details>}
        </section>}
        {(plan.renewedFromSeriesId || plan.existingRenewalSeriesId) && <p className="text-sm text-muted-foreground">{plan.renewedFromSeriesId ? `Renewed from plan #${plan.renewedFromSeriesId}. ` : ''}{plan.existingRenewalSeriesId ? `Renewed as plan #${plan.existingRenewalSeriesId}.` : ''}</p>}
        <details className="rounded-xl border p-3"><summary className="cursor-pointer font-medium">Quarterly orders ({plan.visits.length})</summary><div className="mt-3 grid gap-2 sm:grid-cols-2">{plan.visits.map(visit => <div key={visit.bookingId} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-muted/30 p-3 text-sm"><div><p className="font-medium">Visit {visit.visitNumber} · {visit.reference}</p><p className="mt-1">{formatDate(visit.preferredDate)} · {visit.status}</p><p className="mt-1 text-muted-foreground">{formatMoney(visit.totalAmount)}</p></div><Button size="sm" variant="outline" nativeButton={false} render={<Link href={`/admin/orders/${visit.bookingId}`} />}>Open order<ArrowRight className="size-4" /></Button></div>)}</div></details>
      </article>)}
    </>}
    <Dialog open={Boolean(contactPlan)} onOpenChange={open => { if (!open && !saving) setContactPlan(null); }}><DialogContent>
      <DialogTitle>Confirm renewal contact record</DialogTitle><DialogDescription>Plan #{contactPlan?.seriesId} · {contactPlan?.customerName}. Record contact already made; no email will be sent.</DialogDescription>
      {contactPlan?.earlyRenewalEligible && contactPlan.earlyRenewalDeadline && <p className="text-sm">Offer discussed: renew before {formatInstantDateTime(contactPlan.earlyRenewalDeadline)} for {contactPlan.earlyRenewalPoints} points, credited after the renewed plan’s first service completes.</p>}
      <label className="grid gap-2 text-sm">Contact channel<NativeSelect value={channel} disabled={saving} onChange={e => setChannel(e.target.value)}>{['Phone', 'Email', 'Other'].map(value => <option key={value}>{value}</option>)}</NativeSelect></label>
      <label className="grid gap-2 text-sm">Contact notes<Textarea value={note} maxLength={1500} disabled={saving} onChange={e => setNote(e.target.value)} placeholder="Who was contacted and what was discussed?" /></label>
      {saveError && <p role="alert" className="text-sm text-destructive">{saveError}</p>}
      <DialogFooter><Button variant="outline" disabled={saving} onClick={() => setContactPlan(null)}>Go back</Button><Button disabled={saving || note.trim().length < 5} onClick={() => void saveContact()}>{saving ? 'Saving…' : 'Confirm contact record'}</Button></DialogFooter>
    </DialogContent></Dialog>
  </div>;
}
