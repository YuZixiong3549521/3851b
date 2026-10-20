'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { RefreshCw } from 'lucide-react';
import { CoolCareShell } from '@/components/coolcare-shell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { useCustomerResource } from '@/lib/use-customer-resource';
import { commerceApi, Section, Metric, Field, Feedback, ReceiptTable, RewardHistoryTable, useCommerceMutation, type RewardsData, money, day } from '@/components/commerce-shared';

const load = () => commerceApi<RewardsData>('/customer/rewards');
export default function RewardsPage() {
  const { data, error, refreshing, refresh } = useCustomerResource(load);
  const mutation = useCommerceMutation(refresh);
  const [bookingId, setBookingId] = useState(''), [points, setPoints] = useState('');
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('booking');
    if (id && /^[1-9]\d*$/.test(id)) setBookingId(id);
  }, []);
  const booking = data?.bookings.find(b => String(b.bookingId) === bookingId);
  const eligible = data?.bookings.filter(b => !['Cancelled', 'Rejected', 'Expired'].includes(b.status) && b.totalReceived === 0 && b.rewardStatus !== 'Redeemed' && b.quote !== null) ?? [];
  const discount = data ? Number(points) / data.rules.redemptionPoints * data.rules.redemptionValue : 0;
  return <CoolCareShell><div className="mx-auto max-w-5xl space-y-6 px-5 py-8 sm:px-8 lg:py-10">
    <header className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-sm font-semibold text-primary">MY REWARDS</p><h1 className="mt-1 text-3xl font-bold">Your points &amp; payments</h1><p className="mt-2 text-sm text-muted-foreground">Earn points after your completed service is paid, then save on a future visit.</p></div><Button variant="outline" onClick={() => void refresh()} disabled={refreshing}><RefreshCw className="size-4" />Refresh</Button></header>
    <Feedback {...mutation} error={error || mutation.error} />{!data && !error && <p role="status">Loading your rewards…</p>}
    {data && <>
      <div className="grid gap-3 sm:grid-cols-3"><Metric title="Available points" value={data.available} /><Metric title="Reserved for visits" value={data.reserved} /><Metric title="Account balance" value={data.balance} /></div>
      <p className="text-sm text-muted-foreground">Earn {data.rules.pointsPerDollar} point(s) per SGD 1 actually paid. Every {data.rules.redemptionPoints} points gives a {money(data.rules.redemptionValue)} discount. Annual plans earn points separately for each paid quarterly visit; return visits do not award duplicate points.</p>
      {data.debt > 0 && <p role="status" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">Your account has a {data.debt}-point adjustment balance following a refund or correction. Future earnings will reduce it before points become available again.</p>}
      <Section title="Use points for a booking"><form className="space-y-4" onSubmit={async e => { e.preventDefault(); await mutation.submit(`/customer/rewards/${bookingId}`, { points: Number(points) }, 'Reward reservation saved. Your payment balance will include this discount.'); }}><div className="grid gap-4 sm:grid-cols-2"><Field label="Unpaid booking"><NativeSelect value={bookingId} onChange={e => { setBookingId(e.target.value); setPoints(''); }}><option value="">Choose a booking</option>{eligible.map(b => <option key={b.bookingId} value={b.bookingId}>#{b.bookingId} · {day(b.serviceDate)} · {b.serviceName}</option>)}</NativeSelect></Field><Field label={`Points (multiples of ${data.rules.redemptionPoints})`}><Input type="number" required min={data.rules.redemptionPoints} step={data.rules.redemptionPoints} max={data.available + (booking?.rewardStatus === 'Reserved' ? booking.rewardPoints : 0)} value={points} onChange={e => setPoints(e.target.value)} disabled={!booking} /></Field></div>{booking && <p className="text-sm">Service quote {money(booking.quote)} · selected discount {money(discount)} · remaining {money(Math.max(0, (booking.quote ?? 0) - discount))}. <Link className="font-medium text-primary underline" href={`/customer/bookings/${booking.bookingId}`}>View booking</Link></p>}<p className="text-sm text-muted-foreground">Reserve before the first payment. Points remain reserved until payment and cannot be spent on another booking. Leave at least S$0.01 payable. Cancelling, rejection or expiry releases unused reservations. Applied discounts are not cash payments.</p><Button type="submit" disabled={mutation.busy || !booking || !Number(points)}>{mutation.busy ? 'Saving…' : 'Reserve points'}</Button></form>{!eligible.length && <p className="text-sm text-muted-foreground">No eligible unpaid bookings. You can reserve points after creating your next booking.</p>}</Section>
      {data.bookings.some(b => b.rewardStatus === 'Reserved') && <Section title="Reserved rewards"><div className="space-y-3">{data.bookings.filter(b => b.rewardStatus === 'Reserved').map(b => <div key={b.bookingId} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4"><div><Link className="font-medium text-primary underline" href={`/customer/bookings/${b.bookingId}`}>Booking #{b.bookingId}</Link><p className="mt-1 text-sm">{b.rewardPoints} points · {money(b.discount)} discount · {day(b.serviceDate)}</p></div><Button variant="outline" disabled={mutation.busy} onClick={() => void mutation.submit(`/customer/rewards/${b.bookingId}`, { points: 0 }, 'Unused reservation released. Your points are available again.')}>Release points</Button></div>)}</div></Section>}
      <Section title="Points activity"><p className="text-sm text-muted-foreground">Latest 200 entries. Refunds reverse earned points, even if they have already been spent.</p><RewardHistoryTable rows={data.history} /></Section>
      <Section title="Payment history"><p className="text-sm text-muted-foreground">Recorded receipts and refunds for your bookings. A service quote alone is not proof of payment.</p><ReceiptTable rows={data.payments} /></Section>
    </>}
  </div></CoolCareShell>;
}
