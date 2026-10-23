'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { RefreshCw } from 'lucide-react';
import { CoolCareShell } from '@/components/coolcare-shell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { useCustomerResource } from '@/lib/use-customer-resource';
import { commerceApi, Section, Metric, Feedback, RewardHistoryTable, useCommerceMutation, type RewardsData, money, day } from '@/components/commerce-shared';

const load = () => commerceApi<RewardsData>('/customer/rewards');
export default function RewardsPage() {
  const { data, error, refreshing, refresh } = useCustomerResource(load);
  const mutation = useCommerceMutation(refresh);
  const blocked = mutation.busy || mutation.unresolved;
  const completedRewards = data?.bookings.filter(candidate => ['Awarded', 'Unknown price'].includes(candidate.completionReward?.outcome ?? ''))
    .sort((left, right) => right.completionReward!.completedAt.localeCompare(left.completionReward!.completedAt)).slice(0, 20) ?? [];
  return <CoolCareShell><div className="mx-auto max-w-5xl space-y-6 px-5 py-8 sm:px-8 lg:py-10">
    <header className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-sm font-semibold text-primary">MY REWARDS</p><h1 className="mt-1 text-3xl font-bold">Your points</h1><p className="mt-2 text-sm text-muted-foreground">Earn points when your order is completed, then save on a future visit.</p></div><Button variant="outline" onClick={() => void refresh()} disabled={refreshing || blocked}><RefreshCw className="size-4" />Refresh</Button></header>
    <Feedback {...mutation} error={error || mutation.error} />{!data && !error && <p role="status">Loading your rewards…</p>}
    {data && <>
      <div className="grid gap-3 sm:grid-cols-3"><Metric title="Available points" value={data.available} /><Metric title="Reserved for visits" value={data.reserved} /><Metric title="Account balance" value={data.balance} /></div>
      <p className="text-sm text-muted-foreground">Earn {data.rules.pointsPerDollar} point(s) per SGD 1 of completed service, including recorded repair extras and after reward discounts. Fractional points are rounded down. Every {data.rules.redemptionPoints} points gives a {money(data.rules.redemptionValue)} discount. Each annual quarterly order earns separately; return visits do not award duplicate points.</p>
      {data.debt > 0 && <p role="status" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">Your account has a {data.debt}-point adjustment balance. Future earnings will reduce it before points become available again.</p>}
      <Section title="Use points when you book">
        <p className="text-sm text-muted-foreground">Choose your points discount before confirming a new booking. You will see the available points, discount and estimate after points together. For an annual bundle, the discount applies to the first quarterly visit only.</p>
        <Button nativeButton={false} render={<Link href="/customer/book" />}>Book a service</Button>
      </Section>
      {data.bookings.some(candidate => candidate.rewardStatus === 'Reserved') && <Section title="Reserved rewards"><div className="space-y-3">{data.bookings.filter(candidate => candidate.rewardStatus === 'Reserved').map(candidate => <div key={candidate.bookingId} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4"><div><Link className="font-medium text-primary underline" href={`/customer/bookings/${candidate.bookingId}`}>Booking {candidate.bookingReference}</Link><p className="mt-1 text-sm">{candidate.rewardPoints} points · {money(candidate.discount)} discount · {day(candidate.serviceDate)}</p></div><Button variant="outline" disabled={blocked} onClick={() => void mutation.submit(`/customer/rewards/${candidate.bookingId}`, { points: 0 }, 'Unused reservation released. Your points are available again.')}>Release points</Button></div>)}</div></Section>}
      {completedRewards.length > 0 && <Section title="Completed order rewards"><p className="text-sm text-muted-foreground">Latest 20 completed-order calculations. Each order is processed once, using its service amount and reward rules at completion.</p><div className="space-y-3">{completedRewards.map(candidate => <div key={candidate.bookingId} className="flex flex-wrap items-start justify-between gap-3 rounded-xl border p-4"><div><Link className="font-medium text-primary underline" href={`/customer/bookings/${candidate.bookingId}`}>Booking {candidate.bookingReference}</Link><p className="mt-1 text-sm text-muted-foreground">{day(candidate.serviceDate)} · {candidate.serviceName}</p><p className="mt-1 text-sm">Service after rewards: {money(candidate.completionReward!.netServiceAmount)}{candidate.completionReward!.redeemedPoints > 0 ? ` · ${candidate.completionReward!.redeemedPoints} points used` : ''}</p>{candidate.completionReward!.note && <p className="mt-1 max-w-xl text-xs text-muted-foreground">{candidate.completionReward!.note}</p>}</div><p className="font-semibold text-primary">{candidate.completionReward!.outcome === 'Awarded' ? `+${candidate.completionReward!.awardedPoints} points` : 'Price unavailable'}</p></div>)}</div></Section>}
      <Section title="Points activity"><p className="text-sm text-muted-foreground">Latest 200 entries, including completed-order earnings, redeemed points and any documented account corrections.</p><RewardHistoryTable rows={data.history} /></Section>
    </>}
  </div></CoolCareShell>;
}
