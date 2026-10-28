'use client';
import {notifyCustomerUpdate} from '@/lib/customer-updates';

import { useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { AppContext } from '@/lib/inventory-client';

export type RewardRule = { version: number; pointsPerDollar: number; redemptionPoints: number; redemptionValue: number };
export type RewardBooking = {
  bookingId: number; bookingReference: string; customerId: number; status: string; serviceDate: string;
  customerName: string; email: string; serviceName: string; quote: number | null;
  baseAmount: number | null; additionalFee: number | null; discount: number; netServiceAmount: number | null;
  rewardStatus: string | null; rewardPoints: number; canReserve: boolean;
  completionReward: { awardedPoints: number; redeemedPoints: number; discountAmount: number; netServiceAmount: number | null; completedAt: string; outcome: string; note: string } | null;
};
export type RewardHistory = { id: number | string; bookingId: number | null; bookingReference: string; type: string; points: number; availableDelta?:number; reservedPoints?: number; settledPoints?: number; description: string; createdAt: string; adjustedBy?: string };
export type RewardsData = { rules: RewardRule; balance: number; reserved: number; available: number; debt: number; history: RewardHistory[]; bookings: RewardBooking[] };
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
  if(method!=='GET')notifyCustomerUpdate();
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
  return <>{error && <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}{unresolved && <div className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"><p>The last save may have succeeded. Retry the same saved details to recover its result safely before making another change.</p><Button variant="outline" disabled={busy} onClick={() => void retryPending?.()} type="button">Retry pending save</Button></div>}{message && <p role="status" className="rounded-xl bg-primary/5 p-3 text-sm">{message}</p>}</>;
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
export function RewardHistoryTable({ rows }: { rows: RewardHistory[] }) {
  return rows.length ? <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-left text-sm"><caption className="sr-only">Points transaction history</caption><thead><tr className="border-b">{['Date', 'Points', 'Booking', 'Reason'].map(v => <th className="p-3 font-medium" key={v}>{v}</th>)}</tr></thead><tbody>{rows.map(r => <tr className="border-b align-top" key={r.id}><td className="p-3">{moment(r.createdAt)}</td><td className="p-3 whitespace-nowrap font-medium">{(r.availableDelta??r.points) > 0 ? '+' : ''}{r.availableDelta??r.points}<div className="text-xs text-muted-foreground">{r.type === 'Reserved' ? 'Points reserved' : r.type === 'Returned' ? 'Points returned' : r.type === 'Settled' ? 'Reservation settled' : r.type === 'Redeemed' ? 'Points used (already reserved)' : r.type}{r.settledPoints ? ` · ${r.settledPoints} points` : ''}</div></td><td className="p-3 whitespace-nowrap">{r.bookingId ? r.bookingReference : 'Account'}</td><td className="max-w-md p-3">{r.description}{r.adjustedBy && <div className="text-xs text-muted-foreground">Adjusted by {r.adjustedBy}</div>}</td></tr>)}</tbody></table></div> : <p className="text-sm text-muted-foreground">No points transactions yet.</p>;
}
