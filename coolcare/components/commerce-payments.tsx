'use client';

import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useResource } from '@/lib/inventory-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { NativeSelect } from '@/components/ui/native-select';
import { Section, Field, Feedback, PaymentForm, ReceiptTable, RewardHistoryTable, useCommerceMutation, type PaymentBooking, type Receipt, type RewardRule, type RewardsData, money, moment } from './commerce-shared';

type PaymentData = { bookings: PaymentBooking[]; payments: Receipt[]; customers: { id: number; name: string; email: string; points: number }[]; rules: RewardRule; ruleHistory: { version: number; reason: string; changedBy: string; createdAt: string }[] };
export function CommercePaymentsPage() {
  const { data, error, loading, reload } = useResource<PaymentData>('/commerce/admin/payments');
  const [bookingId, setBookingId] = useState(''), [customerId, setCustomerId] = useState(''), [search, setSearch] = useState('');
  const [paymentBlocked, setPaymentBlocked] = useState(false);
  const [adjustmentBlocked, setAdjustmentBlocked] = useState(false);
  const [ruleBlocked, setRuleBlocked] = useState(false);
  const anyBlocked = paymentBlocked || adjustmentBlocked || ruleBlocked;
  const booking = data?.bookings.find(b => String(b.bookingId) === bookingId);
  const matches = data?.bookings.filter(b => `${b.bookingId} ${b.customerName} ${b.email}`.toLowerCase().includes(search.toLowerCase())) ?? [];
  return <div className="mx-auto max-w-6xl space-y-6">
    <header className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-sm font-semibold text-primary">SETTLEMENT</p><h1 className="mt-1 text-3xl font-bold">Payments &amp; rewards</h1><p className="mt-2 text-sm text-muted-foreground">Record offline receipts, refunds and audited loyalty changes.</p></div><Button variant="outline" onClick={reload} disabled={loading || anyBlocked}><RefreshCw className="size-4" />Refresh</Button></header>
    <Feedback error={error} />{loading && <p role="status">Loading payment records…</p>}
    {data && <>
      <fieldset className="min-w-0" disabled={adjustmentBlocked || ruleBlocked}>
        <Section title="Record a payment or refund"><div className="grid gap-4 sm:grid-cols-2"><Field label="Find booking or customer"><Input placeholder="Booking number, name or email" value={search} onChange={e => setSearch(e.target.value)} disabled={paymentBlocked} /></Field><Field label="Booking"><NativeSelect value={bookingId} onChange={e => setBookingId(e.target.value)} disabled={paymentBlocked}><option value="">Choose a booking</option>{matches.map(b => <option value={b.bookingId} key={b.bookingId}>#{b.bookingId} · {b.customerName} · {b.status}</option>)}</NativeSelect></Field></div><p className="text-xs text-muted-foreground">Showing the latest 1,000 bookings. Annual plans settle per quarterly booking; return visits share that booking balance.</p>{booking && <PaymentForm key={booking.bookingId} booking={booking} onSaved={reload} onBlockingChange={setPaymentBlocked} />}</Section>
      </fieldset>
      <Section title="Payment ledger"><p className="text-sm text-muted-foreground">Latest 200 immutable records. Use Reports &amp; analytics for date-filtered totals and export.</p><ReceiptTable rows={data.payments} /></Section>
      <fieldset className="min-w-0" disabled={paymentBlocked || ruleBlocked}>
        <Section title="Customer loyalty account"><Field label="Customer"><NativeSelect value={customerId} onChange={e => setCustomerId(e.target.value)} disabled={adjustmentBlocked}><option value="">Choose a customer</option>{data.customers.map(c => <option value={c.id} key={c.id}>{c.name} · {c.email} · {c.points} points</option>)}</NativeSelect></Field>{customerId && <CustomerRewardsAdmin key={customerId} customerId={customerId} onChanged={reload} onBlockingChange={setAdjustmentBlocked} />}</Section>
      </fieldset>
      <fieldset className="min-w-0" disabled={paymentBlocked || adjustmentBlocked}>
        <Section title="Reward rules"><RuleEditor key={data.rules.version} rules={data.rules} refresh={reload} onBlockingChange={setRuleBlocked} /><details className="text-sm"><summary className="cursor-pointer font-medium">Rule change history</summary><div className="mt-3 space-y-3">{data.ruleHistory.length ? data.ruleHistory.map(r => <div className="rounded-lg border p-3" key={r.version}><p className="font-medium">Version {r.version} · {r.changedBy}</p><p>{r.reason}</p><p className="text-xs text-muted-foreground">{moment(r.createdAt)}</p></div>) : <p className="text-muted-foreground">The initial rules have not been changed.</p>}</div></details></Section>
      </fieldset>
    </>}
  </div>;
}
function CustomerRewardsAdmin({ customerId, onChanged, onBlockingChange }: { customerId: string; onChanged: () => unknown; onBlockingChange: (blocked: boolean) => void }) {
  const { data, error, reload } = useResource<RewardsData>('/commerce/admin/rewards/' + customerId);
  const mutation = useCommerceMutation(() => { reload(); onChanged(); });
  useEffect(() => { onBlockingChange(mutation.busy || mutation.unresolved); return () => onBlockingChange(false); }, [mutation.busy, mutation.unresolved, onBlockingChange]);
  const [points, setPoints] = useState(''), [reason, setReason] = useState('');
  return <div className="space-y-4"><Feedback {...mutation} error={error || mutation.error} />{data && <><p className="text-sm">Balance: <strong>{data.balance}</strong> · Reserved: <strong>{data.reserved}</strong> · Available: <strong>{data.available}</strong></p><form className="grid items-end gap-4 sm:grid-cols-3" onSubmit={async e => { e.preventDefault(); if (await mutation.submit(`/admin/rewards/${customerId}/adjust`, { points: Number(points), reason }, 'Points adjustment recorded with an audit trail.')) { setPoints(''); setReason(''); } }}><Field label="Points to add or deduct"><Input required type="number" min="-1000000" max="1000000" step="1" placeholder="For example, 20 or -20" value={points} onChange={e => setPoints(e.target.value)} /></Field><Field label="Required reason"><Textarea required minLength={5} maxLength={500} value={reason} onChange={e => setReason(e.target.value)} /></Field><Button type="submit" disabled={mutation.busy || !Number(points)}>{mutation.busy ? 'Saving…' : 'Record adjustment'}</Button></form><p className="text-sm text-muted-foreground">Refund reversals or corrections may create a negative balance. Future earnings repay that balance; customers cannot spend points while their available balance is zero. Applied discounts are not cash refunds.</p><RewardHistoryTable rows={data.history} /></>}</div>;
}
function RuleEditor({ rules, refresh, onBlockingChange }: { rules: RewardRule; refresh: () => unknown; onBlockingChange: (blocked: boolean) => void }) {
  const mutation = useCommerceMutation(refresh);
  useEffect(() => { onBlockingChange(mutation.busy || mutation.unresolved); return () => onBlockingChange(false); }, [mutation.busy, mutation.unresolved, onBlockingChange]);
  const [rate, setRate] = useState(String(rules.pointsPerDollar)), [points, setPoints] = useState(String(rules.redemptionPoints)), [value, setValue] = useState(String(rules.redemptionValue)), [reason, setReason] = useState('');
  return <form className="space-y-4" onSubmit={e => { e.preventDefault(); void mutation.submit('/admin/reward-rules', { expectedVersion: rules.version, pointsPerDollar: Number(rate), redemptionPoints: Number(points), redemptionValue: Number(value), reason }, 'Reward rules saved. Existing reservations and earnings keep their original rate.', 'PATCH'); }}><p className="text-sm text-muted-foreground">Current version {rules.version}: earn {rules.pointsPerDollar} point(s) per SGD 1 actually paid for completed service; {rules.redemptionPoints} points redeem {money(rules.redemptionValue)}. Fractions are rounded down across all payments for the booking, not per receipt. Existing bookings keep the earning rate fixed by their first receipt.</p><div className="grid gap-4 sm:grid-cols-3"><Field label="Points per SGD 1"><Input type="number" required min="0" max="100" step="1" value={rate} onChange={e => setRate(e.target.value)} /></Field><Field label="Points per redemption block"><Input type="number" required min="1" max="1000000" step="1" value={points} onChange={e => setPoints(e.target.value)} /></Field><Field label="Discount per block (SGD)"><Input type="number" required min="0.01" step="0.01" value={value} onChange={e => setValue(e.target.value)} /></Field></div><Field label="Reason for rule change"><Textarea required minLength={5} maxLength={500} value={reason} onChange={e => setReason(e.target.value)} /></Field><Feedback {...mutation} /><Button type="submit" disabled={mutation.busy}>{mutation.busy ? 'Saving…' : 'Save new rule version'}</Button></form>;
}
