'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { RefreshCw } from 'lucide-react';
import { CoolCareShell } from '@/components/coolcare-shell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { useCustomerResource } from '@/lib/use-customer-resource';
import { commerceApi, Section, Metric, Field, Feedback, RewardHistoryTable, useCommerceMutation, type RewardsData, money, day } from '@/components/commerce-shared';

const load = () => commerceApi<RewardsData>('/customer/rewards');
export default function RewardsPage() {
  const { data, error, refreshing, refresh } = useCustomerResource(load);
  const mutation = useCommerceMutation(refresh);
  const [bookingId, setBookingId] = useState(''), [points, setPoints] = useState('');
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('booking');
    if (id && /^[1-9]\d*$/.test(id)) setBookingId(id);
  }, []);
  const eligible = data?.bookings.filter(candidate => candidate.canReserve) ?? [];
  const booking = eligible.find(candidate => String(candidate.bookingId) === bookingId);
  useEffect(() => {
    setPoints(booking?.rewardStatus === 'Reserved' ? String(booking.rewardPoints) : '');
  }, [booking?.bookingId]);
  const discount = data && Number(points) > 0 ? Number(points) / data.rules.redemptionPoints * data.rules.redemptionValue : 0;
  const maxPointsForPrice = data && booking?.quote != null
    ? Math.floor(Math.round(booking.quote * 100) / Math.round(data.rules.redemptionValue * 100)) * data.rules.redemptionPoints : 0;
  const usablePoints = data ? Math.max(0, data.available + (booking?.rewardStatus === 'Reserved' ? booking.rewardPoints : 0)) : 0;
  const maxPoints = data ? Math.min(maxPointsForPrice, Math.floor(usablePoints / data.rules.redemptionPoints) * data.rules.redemptionPoints) : 0;
  const validPoints = Boolean(data && Number.isInteger(Number(points)) && Number(points) > 0 && Number(points) <= maxPoints && Number(points) % data.rules.redemptionPoints === 0);
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
      <Section title="Use points for a booking">
        <form className="space-y-4" onSubmit={async event => {
          event.preventDefault();
          if (!booking || !validPoints || blocked) return;
          await mutation.submit(`/customer/rewards/${booking.bookingId}`, { points: Number(points) }, 'Points reserved. The discount will be applied when this order is completed.');
        }}>
          <fieldset disabled={blocked} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Active booking"><NativeSelect value={booking?.bookingId ? String(booking.bookingId) : ''} onChange={event => setBookingId(event.target.value)}><option value="">Choose a booking</option>{eligible.map(candidate => <option key={candidate.bookingId} value={candidate.bookingId}>#{candidate.bookingId} · {day(candidate.serviceDate)} · {candidate.serviceName}</option>)}</NativeSelect></Field>
              <Field label={`Points (multiples of ${data.rules.redemptionPoints})`}><Input type="number" required min={data.rules.redemptionPoints} step={data.rules.redemptionPoints} max={maxPoints} value={points} onChange={event => setPoints(event.target.value)} disabled={!booking || maxPoints < data.rules.redemptionPoints} /></Field>
            </div>
            {booking && <div className="rounded-xl bg-muted/50 p-4 text-sm"><p>Service amount {money(booking.quote)} · selected discount {money(discount)} · service amount after rewards {money(Math.max(0, (booking.quote ?? 0) - discount))}.</p><p className="mt-2 text-muted-foreground">You can reserve up to {maxPoints} points for this booking.</p><Link className="mt-2 inline-block font-medium text-primary underline" href={`/customer/bookings/${booking.bookingId}`}>View booking</Link></div>}
            <p className="text-sm text-muted-foreground">Reserve points before the order is completed. Reserved points cannot be used on another booking and are deducted once on completion. Discounts can cover the full service amount; a fully discounted order earns no new points. Cancelling, rejection or expiry releases unused reservations.</p>
            <Button type="submit" disabled={!booking || !validPoints}>{mutation.busy ? 'Saving…' : 'Reserve points'}</Button>
          </fieldset>
        </form>
        {bookingId && !booking && <p className="text-sm text-muted-foreground">The selected booking is not available for a new points reservation. Choose another active booking or view its current status in My Bookings.</p>}
        {!eligible.length && <p className="text-sm text-muted-foreground">No eligible active bookings. You can reserve points after creating your next booking.</p>}
      </Section>
      {data.bookings.some(candidate => candidate.rewardStatus === 'Reserved') && <Section title="Reserved rewards"><div className="space-y-3">{data.bookings.filter(candidate => candidate.rewardStatus === 'Reserved').map(candidate => <div key={candidate.bookingId} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4"><div><Link className="font-medium text-primary underline" href={`/customer/bookings/${candidate.bookingId}`}>Booking #{candidate.bookingId}</Link><p className="mt-1 text-sm">{candidate.rewardPoints} points · {money(candidate.discount)} discount · {day(candidate.serviceDate)}</p></div><Button variant="outline" disabled={blocked} onClick={() => void mutation.submit(`/customer/rewards/${candidate.bookingId}`, { points: 0 }, 'Unused reservation released. Your points are available again.')}>Release points</Button></div>)}</div></Section>}
      {completedRewards.length > 0 && <Section title="Completed order rewards"><p className="text-sm text-muted-foreground">Latest 20 completed-order calculations. Each order is processed once, using its service amount and reward rules at completion.</p><div className="space-y-3">{completedRewards.map(candidate => <div key={candidate.bookingId} className="flex flex-wrap items-start justify-between gap-3 rounded-xl border p-4"><div><Link className="font-medium text-primary underline" href={`/customer/bookings/${candidate.bookingId}`}>Booking #{candidate.bookingId}</Link><p className="mt-1 text-sm text-muted-foreground">{day(candidate.serviceDate)} · {candidate.serviceName}</p><p className="mt-1 text-sm">Service after rewards: {money(candidate.completionReward!.netServiceAmount)}{candidate.completionReward!.redeemedPoints > 0 ? ` · ${candidate.completionReward!.redeemedPoints} points used` : ''}</p>{candidate.completionReward!.note && <p className="mt-1 max-w-xl text-xs text-muted-foreground">{candidate.completionReward!.note}</p>}</div><p className="font-semibold text-primary">{candidate.completionReward!.outcome === 'Awarded' ? `+${candidate.completionReward!.awardedPoints} points` : 'Price unavailable'}</p></div>)}</div></Section>}
      <Section title="Points activity"><p className="text-sm text-muted-foreground">Latest 200 entries, including completed-order earnings, redeemed points and any documented account corrections.</p><RewardHistoryTable rows={data.history} /></Section>
    </>}
  </div></CoolCareShell>;
}
