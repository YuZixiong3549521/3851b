'use client';

import { useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { EnglishDatePicker } from '@/components/english-date-picker';
import { singaporeToday } from '@/lib/booking-schedule';
import { AppContext } from '@/lib/inventory-client';

export type RewardRule = { version: number; pointsPerDollar: number; redemptionPoints: number; redemptionValue: number };
export type PaymentBooking = {
  bookingId: number; customerId: number; status: string; serviceDate: string;
  customerName: string; email: string; serviceName: string; quote: number | null;
  baseAmount: number | null; additionalFee: number; netReceived: number;
  totalReceived: number; totalRefunded: number; discount: number; amountDue: number | null;
  rewardStatus: string | null; rewardPoints: number;
};
export type Receipt = { id: number; bookingId: number; kind: string; amount: number; method: string; receivedDate: string; reference: string; notes: string; recordedBy?: string };
export type RewardHistory = { id: number; bookingId: number | null; type: string; points: number; description: string; createdAt: string; adjustedBy?: string };
export type RewardsData = { rules: RewardRule; balance: number; reserved: number; available: number; debt: number; history: RewardHistory[]; bookings: PaymentBooking[]; payments: Receipt[] };
export const money = (v: number | string | null) => v === null ? 'Not recorded' : new Intl.NumberFormat('en-SG', { style: 'currency', currency: 'SGD' }).format(Number(v));
export const day = (v: string) => new Intl.DateTimeFormat('en-SG', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(v.slice(0, 10) + 'T00:00:00Z'));
export const moment = (v: string) => new Intl.DateTimeFormat('en-SG', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Singapore' }).format(new Date(v.includes('T') ? v : v.replace(' ', 'T') + 'Z')) + ' SGT';
export async function commerceApi<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (method !== 'GET') {
    const session = await fetch('/api/session', { credentials: 'same-origin' });
    if (!session.ok) throw new Error('Unable to check your session. Please retry.');
    headers['X-CSRF-Token'] = (await session.json() as { csrf: string }).csrf;
  }
  const response = await fetch('/api/commerce' + path, { credentials: 'same-origin', method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json() as { error?: string };
  if (!response.ok) throw Object.assign(new Error(data.error || 'Unable to complete this request.'), { status: response.status });
  return data as T;
}
export function useCommerceMutation(refresh: () => unknown) {
  const adminContext = useContext(AppContext);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const [unresolved, setUnresolved] = useState(false);
  const pending = useRef<{ key: string; requestId: string; path: string; data: Record<string, unknown>; success: string; method: string } | null>(null);
  const inFlight = useRef(false);
  const setDirty = adminContext?.setDirty;
  useEffect(() => {
    if (!busy && !unresolved) return;
    setDirty?.(true);
    const preventLoss = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', preventLoss);
    return () => { window.removeEventListener('beforeunload', preventLoss); setDirty?.(false); };
  }, [busy, unresolved, setDirty]);
  async function submit(path: string, data: Record<string, unknown>, success: string, method = 'POST') {
    if (inFlight.current) return false;
    const key = JSON.stringify({ path, method, data });
    if (pending.current && pending.current.key !== key) {
      setError('The previous save has an unknown outcome. Retry that exact pending save below before starting another operation. Edited fields have not been submitted.');
      return false;
    }
    inFlight.current = true; setBusy(true); setError(''); setMessage('');
    pending.current ??= { key, requestId: crypto.randomUUID(), path, data: structuredClone(data), success, method };
    try {
      await commerceApi(path, method, { ...data, requestId: pending.current.requestId });
      pending.current = null; setUnresolved(false); setMessage(success); await refresh(); return true;
    } catch (cause) {
      const status = (cause as { status?: number })?.status;
      if (status && status >= 400 && status < 500) { pending.current = null; setUnresolved(false); }
      else setUnresolved(Boolean(pending.current));
      setError(cause instanceof Error ? cause.message : 'Unable to save. Please retry.'); return false;
    }
    finally { inFlight.current = false; setBusy(false); }
  }
  async function retryPending() {
    const p = pending.current;
    if (p) await submit(p.path, p.data, p.success, p.method);
  }
  return { busy, error, message, submit, unresolved, retryPending };
}
export function Feedback({ error, message, unresolved, retryPending, busy }: { error: string; message?: string; unresolved?: boolean; retryPending?: () => unknown; busy?: boolean }) {
  return <>{error && <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}{unresolved && <div className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"><p>The last save may have succeeded. Retry the same saved details to recover its result safely; do not create a second payment.</p><Button variant="outline" disabled={busy} onClick={() => void retryPending?.()} type="button">Retry pending save</Button></div>}{message && <p role="status" className="rounded-xl bg-primary/5 p-3 text-sm">{message}</p>}</>;
}
export function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section className="space-y-4 rounded-2xl border bg-card p-5 sm:p-6"><h2 className="text-xl font-semibold">{title}</h2>{children}</section>;
}
export function Metric({ title, value }: { title: string; value: ReactNode }) {
  return <div className="rounded-xl border bg-card p-4"><p className="text-sm text-muted-foreground">{title}</p><p className="mt-2 text-2xl font-semibold">{value}</p></div>;
}
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="grid min-w-0 gap-2 text-sm font-medium">{label}{children}</label>;
}
export function ReceiptTable({ rows }: { rows: Receipt[] }) {
  return rows.length ? <div className="overflow-x-auto"><table className="w-full min-w-[650px] text-left text-sm"><caption className="sr-only">Payment and refund records</caption><thead><tr className="border-b text-muted-foreground">{['Date', 'Booking', 'Type / method', 'Amount', 'Reference / notes'].map(v => <th key={v} className="p-3 font-medium">{v}</th>)}</tr></thead><tbody>{rows.map(r => <tr key={r.id} className="border-b align-top"><td className="p-3 whitespace-nowrap">{day(r.receivedDate)}<div className="text-xs text-muted-foreground">{r.recordedBy}</div></td><td className="p-3">#{r.bookingId}</td><td className="p-3">{r.kind}<div className="text-xs text-muted-foreground">{r.method}</div></td><td className="p-3 whitespace-nowrap">{money(r.amount)}</td><td className="max-w-md p-3 break-words">{r.reference || 'No reference'}<div className="mt-1 text-muted-foreground">{r.notes}</div></td></tr>)}</tbody></table></div> : <p className="text-sm text-muted-foreground">No payment records yet. Quotes are not recorded receipts.</p>;
}
export function RewardHistoryTable({ rows }: { rows: RewardHistory[] }) {
  return rows.length ? <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-left text-sm"><caption className="sr-only">Points transaction history</caption><thead><tr className="border-b">{['Date', 'Points', 'Booking', 'Reason'].map(v => <th className="p-3 font-medium" key={v}>{v}</th>)}</tr></thead><tbody>{rows.map(r => <tr className="border-b align-top" key={r.id}><td className="p-3">{moment(r.createdAt)}</td><td className="p-3 whitespace-nowrap font-medium">{r.points > 0 ? '+' : ''}{r.points}<div className="text-xs text-muted-foreground">{r.type}</div></td><td className="p-3">{r.bookingId ? `#${r.bookingId}` : 'Account'}</td><td className="max-w-md p-3">{r.description}{r.adjustedBy && <div className="text-xs text-muted-foreground">Adjusted by {r.adjustedBy}</div>}</td></tr>)}</tbody></table></div> : <p className="text-sm text-muted-foreground">No points transactions yet.</p>;
}
export function PaymentForm({ booking, onSaved, onBlockingChange }: { booking: PaymentBooking; onSaved: () => unknown; onBlockingChange?: (blocked: boolean) => void }) {
  const mutation = useCommerceMutation(onSaved);
  useEffect(() => { onBlockingChange?.(mutation.busy || mutation.unresolved); return () => onBlockingChange?.(false); }, [mutation.busy, mutation.unresolved, onBlockingChange]);
  const [kind, setKind] = useState('Receipt'), [amount, setAmount] = useState(''), [method, setMethod] = useState('PayNow');
  const [receivedDate, setDate] = useState(singaporeToday), [reference, setReference] = useState(''), [notes, setNotes] = useState('');
  return <form className="space-y-4" onSubmit={async e => { e.preventDefault(); if (await mutation.submit(`/admin/payments/${booking.bookingId}`, { kind, amount: Number(amount), method, receivedDate, reference, notes }, 'Payment record saved. The booking balance and points have been updated.')) { setAmount(''); setNotes(''); setReference(''); } }}>
    <div className="grid gap-3 sm:grid-cols-3"><Metric title="Service quote + extras" value={money(booking.quote)} /><Metric title="Recorded net payment" value={money(booking.netReceived)} /><Metric title="Outstanding after rewards" value={money(booking.amountDue)} /></div>
    {booking.discount > 0 && <p className="text-sm">Reward discount: {money(booking.discount)} ({booking.rewardStatus?.toLowerCase()}).</p>}
    <p className="text-sm text-muted-foreground">Record money actually received or returned. Receipts require a completed service. Saved records cannot be overwritten; corrections use a refund with a reason.</p>
    <fieldset disabled={mutation.busy || mutation.unresolved} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <Field label="Record type"><NativeSelect value={kind} onChange={e => setKind(e.target.value)}><option>Receipt</option><option>Refund</option></NativeSelect></Field>
      <Field label="Amount (SGD)"><Input type="number" min="0.01" step="0.01" max={kind === 'Refund' ? booking.netReceived : booking.amountDue ?? 0} required value={amount} onChange={e => setAmount(e.target.value)} /></Field>
      <Field label="Payment method"><NativeSelect value={method} onChange={e => setMethod(e.target.value)}>{['PayNow', 'Cash', 'Bank transfer', 'Card', 'Other'].map(v => <option key={v}>{v}</option>)}</NativeSelect></Field>
      <Field label="Actual payment date"><EnglishDatePicker label="Actual payment date" value={receivedDate} onChange={setDate} max={singaporeToday()} disableWeekends={false} /></Field>
      <Field label="Reference (optional)"><Input value={reference} maxLength={120} onChange={e => setReference(e.target.value)} /></Field>
      <Field label="Reason / notes (visible to customer)"><Textarea required minLength={5} maxLength={1000} value={notes} onChange={e => setNotes(e.target.value)} /></Field>
    </fieldset>
    <Feedback {...mutation} /><Button disabled={mutation.busy || (kind === 'Receipt' && booking.status !== 'Completed') || (kind === 'Refund' && booking.netReceived <= 0)} type="submit">{mutation.busy ? 'Saving…' : `Save ${kind.toLowerCase()}`}</Button>
  </form>;
}
