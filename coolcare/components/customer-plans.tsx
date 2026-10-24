'use client';

import Link from 'next/link';
import { useState } from 'react';
import { AlertTriangle, ArrowRight, CalendarDays, Check, ChevronDown, ChevronUp, RefreshCw, Repeat, Wind, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { EmptyState, PageError, PageLoading } from '@/components/page-state';
import { formatDate, formatMoney, formatTimeSlot } from '@/lib/format';
import { useCustomerResource } from '@/lib/use-customer-resource';
import { customerPlansApi, type AnnualPlan, type PlanReminder } from '@/lib/customer-plans-api';
import { formatInstantDateTime } from '@/lib/sg-time';

function PlanReminderCard({ reminder, onDismiss }: { reminder: PlanReminder; onDismiss: () => Promise<unknown> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dismiss = async () => {
    setBusy(true);
    setError('');
    try {
      await customerPlansApi.dismissReminder(reminder.seriesId, reminder.key);
      await onDismiss();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to dismiss this reminder.');
    } finally {
      setBusy(false);
    }
  };
  return <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4">
    <div className="flex items-start gap-3">
      <CalendarDays className="mt-0.5 size-5 shrink-0 text-primary" />
      <div className="min-w-0 flex-1">
        <h3 className="font-semibold">{reminder.title}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{reminder.message.replace(/\d{4}-\d{2}-\d{2}/g, date => formatDate(date))}</p>
        <Link className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-primary underline underline-offset-4" href={reminder.kind === 'renewal' ? `/customer/book?renewPlan=${reminder.seriesId}` : `/customer/bookings/${reminder.bookingId}`}>
          {reminder.kind === 'renewal' ? 'Review renewal' : 'View appointment'}<ArrowRight className="size-4" />
        </Link>
        {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
      </div>
      <Button variant="ghost" size="icon" aria-label={`Dismiss reminder: ${reminder.title}`} disabled={busy} onClick={() => void dismiss()}><X className="size-4" /></Button>
    </div>
  </div>;
}

function PlanCard({ plan }: { plan: AnnualPlan }) {
  const [expanded, setExpanded] = useState(plan.status === 'Active');
  return <article id={`plan-${plan.seriesId}`} className="scroll-mt-8 overflow-hidden rounded-3xl border bg-card shadow-sm">
    <div className="border-b bg-muted/30 p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Plan #{plan.seriesId}</p>
          <h2 className="mt-1 text-xl font-semibold">{plan.name}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{plan.propertyLabel || 'Property type not recorded'} · {plan.unitCount} {plan.unitCount === 1 ? 'aircon unit' : 'aircon units'}</p>
        </div>
        <Badge variant={plan.status === 'Active' ? 'default' : 'secondary'}>{plan.status}</Badge>
      </div>
      <p className="mt-4 text-sm">{plan.addressLine}{plan.postalCode ? ` · Singapore ${plan.postalCode}` : ''}</p>
      <p className="mt-1 text-sm text-muted-foreground">{formatDate(plan.validFrom)} – before {formatDate(plan.validUntil)}</p>
    </div>
    <div className="space-y-5 p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><p className="text-2xl font-bold">{formatMoney(plan.totalAmount)}</p><p className="mt-1 text-xs text-muted-foreground">Agreed annual service price · pay after each visit</p></div>
        <div className="text-sm"><p className="font-medium">{plan.completedVisits} of {plan.totalVisits} quarterly visits completed</p><p className="mt-1 text-muted-foreground">{plan.remainingVisits} open · {plan.unusedClosedVisits} closed without completion</p></div>
      </div>
      <Progress value={plan.completedVisits / plan.totalVisits * 100} aria-label={`${plan.completedVisits} of ${plan.totalVisits} quarterly visits completed`} />
      {plan.earlyRenewalPromotionAvailable && plan.earlyRenewalDeadline && <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4 text-sm"><p className="font-semibold">Early renewal: earn {plan.earlyRenewalPoints} bonus points</p>{!plan.canRenew && <p className="mt-1 font-medium">Renewal opens on {formatDate(plan.renewalOpenDate)}.</p>}<p className="mt-1">Renew before {formatInstantDateTime(plan.earlyRenewalDeadline)}, the start of your final scheduled visit. Points are awarded after your new plan&apos;s first service is completed, in addition to normal completion points. A cancelled, rejected or expired first visit earns no bonus.</p></div>}
      {plan.earlyRenewalReward && <div className="rounded-2xl bg-muted/50 p-4 text-sm"><p className="font-semibold">Early renewal bonus · {plan.earlyRenewalReward.points} points</p><p className="mt-1">{plan.earlyRenewalReward.status}{plan.earlyRenewalReward.awardedAt ? ` · ${formatInstantDateTime(plan.earlyRenewalReward.awardedAt)}` : ''}</p>{plan.earlyRenewalReward.status === 'Pending first completion' && <p className="mt-1 text-muted-foreground">Your bonus is reserved for completion of visit 1. It is separate from your service-value points.</p>}</div>}
      {plan.attentionMessage && <div className="flex gap-3 rounded-2xl border border-primary/20 bg-primary/5 p-4 text-sm"><AlertTriangle className="mt-0.5 size-5 shrink-0 text-primary" /><p>{plan.attentionMessage}</p></div>}
      {plan.nextVisit && <div className="flex gap-3 rounded-2xl bg-muted/50 p-4"><CalendarDays className="mt-0.5 size-5 shrink-0 text-primary" /><div><p className="text-xs font-semibold uppercase tracking-wide text-primary">Next quarterly appointment</p><p className="mt-1 font-medium">{formatDate(plan.nextVisit.preferredDate)} · {formatTimeSlot(plan.nextVisit.slotStart && plan.nextVisit.slotEnd ? `${plan.nextVisit.slotStart.slice(0, 5)} - ${plan.nextVisit.slotEnd.slice(0, 5)}` : plan.nextVisit.timeSlot)}</p><p className="mt-1 text-sm text-muted-foreground">{plan.nextVisit.reference} · {plan.nextVisit.status}</p></div></div>}
      {!plan.nextVisit && plan.remainingVisits > 0 && <p className="rounded-xl bg-muted/40 p-3 text-sm text-muted-foreground">An open visit may be awaiting a new arrangement or return visit. Open its booking below for the latest service updates.</p>}
      <div className="flex flex-wrap gap-2">
        {plan.canRenew && <Button nativeButton={false} render={<Link href={`/customer/book?renewPlan=${plan.seriesId}`} />}><Repeat className="size-4" />Review renewal</Button>}
        {plan.existingRenewalSeriesId && <Button variant="outline" nativeButton={false} render={<Link href={`/customer/plans#plan-${plan.existingRenewalSeriesId}`} />}><Check className="size-4" />View renewed plan</Button>}
        <Button variant="outline" onClick={() => setExpanded(!expanded)} aria-expanded={expanded} aria-controls={`plan-visits-${plan.seriesId}`}>{expanded ? 'Hide quarterly visits' : 'View quarterly visits'}{expanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}</Button>
      </div>
      {!plan.canRenew && !plan.existingRenewalSeriesId && plan.status === 'Active' && <p className="text-xs text-muted-foreground">Renewal becomes available on {formatDate(plan.renewalOpenDate)}, or after all four visits are completed.</p>}
      {plan.renewedFromSeriesId && <p className="text-xs text-muted-foreground">Renewed from <Link className="text-primary underline" href={`/customer/plans#plan-${plan.renewedFromSeriesId}`}>plan #{plan.renewedFromSeriesId}</Link>. This plan has its own four quarterly visits.</p>}
      <div id={`plan-visits-${plan.seriesId}`} hidden={!expanded} className="space-y-3">
        {plan.visits.map(visit => <div key={visit.bookingId} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border p-4">
          <div><p className="text-sm font-semibold">Visit {visit.visitNumber} · {formatDate(visit.preferredDate)}</p><p className="mt-1 text-sm text-muted-foreground">{formatTimeSlot(visit.slotStart && visit.slotEnd ? `${visit.slotStart.slice(0, 5)} - ${visit.slotEnd.slice(0, 5)}` : visit.timeSlot)} · {formatMoney(visit.totalAmount)}</p><p className="mt-1 text-xs text-muted-foreground">{visit.reference} · {visit.status}</p>{visit.visitNumber > 1 && visit.status === 'Submitted' && <p className="mt-1 text-xs text-muted-foreground">Reserved · awaiting individual confirmation · no automatic expiry</p>}</div>
          <Button size="sm" variant="outline" nativeButton={false} render={<Link href={`/customer/bookings/${visit.bookingId}`} />}>View / manage<ArrowRight className="size-4" /></Button>
        </div>)}
        <p className="text-xs leading-relaxed text-muted-foreground">The first visit has a confirmation deadline. Visits 2–4 stay reserved and require individual confirmation, without automatic expiry. Rescheduling or cancellation requires at least 72 hours&apos; notice. A quarterly visit must stay within its original three-month window. Return visits remain part of the same quarterly service and do not use another entitlement. Cancelling, rejecting or expiring one appointment affects only that visit and does not count as completed service.</p>
      </div>
    </div>
  </article>;
}

export function CustomerPlans() {
  const { data, error, refreshing, refresh } = useCustomerResource(customerPlansApi.getPlans);
  return <div className="mx-auto max-w-5xl px-5 py-8 sm:px-8 lg:px-10 lg:py-10">
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div><p className="text-sm font-semibold text-primary">MY PLANS</p><h1 className="mt-1 text-3xl font-bold tracking-tight">Year-round aircon care</h1><p className="mt-2 max-w-2xl text-sm text-muted-foreground">Your annual cleaning plans, quarterly appointments and renewal reminders in one place. Renewals are optional and use the latest reviewed price.</p></div>
      <Button variant="outline" size="sm" disabled={refreshing} onClick={() => void refresh()}><RefreshCw className={`size-4 ${refreshing ? 'animate-spin' : ''}`} />Refresh</Button>
    </div>
    {error && <div className="mb-5"><PageError message={error} /></div>}
    {!data && !error && <PageLoading />}
    {data && <>
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[['Active plans', data.summary.activePlans], ['Open quarterly visits', data.summary.scheduledVisits], ['Completed visits', data.summary.completedVisits], ['Ready to renew', data.summary.renewalsAvailable]].map(([label, value]) => <div key={label} className="rounded-2xl border bg-card p-4"><p className="text-sm text-muted-foreground">{label}</p><p className="mt-2 text-2xl font-semibold">{value}</p></div>)}
      </div>
      {data.reminders.length > 0 && <section aria-label="Plan reminders" className="mb-6 grid gap-3">{data.reminders.map(reminder => <PlanReminderCard key={`${reminder.seriesId}-${reminder.key}`} reminder={reminder} onDismiss={refresh} />)}</section>}
      {!data.plans.length ? <div className="rounded-3xl border bg-card p-5"><EmptyState title="Your annual plan starts here" description="Choose the Annual Cleaning Bundle when booking to arrange four quarterly visits for your home." /><div className="mt-4 flex justify-center"><Button nativeButton={false} render={<Link href="/customer/book" />}><Wind className="size-4" />Explore services</Button></div></div> : <div className="space-y-6">{data.plans.map(plan => <PlanCard key={plan.seriesId} plan={plan} />)}</div>}
      <p className="mt-6 text-sm text-muted-foreground">Each completed quarterly booking earns reward points on its service value after any reward discount. Extra repair work appears separately on the booking. Renewal requires your confirmation.</p>
    </>}
  </div>;
}
