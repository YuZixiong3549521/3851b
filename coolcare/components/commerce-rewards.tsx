'use client';

import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useResource } from '@/lib/inventory-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { NativeSelect } from '@/components/ui/native-select';
import { Section, Field, Feedback, RewardHistoryTable, useCommerceMutation, type RewardRule, type RewardsData, money, moment } from './commerce-shared';

type AdminRewardsData = {
  customers: { id: number; name: string; email: string; points: number }[];
  rules: RewardRule;
  ruleHistory: { version: number; reason: string; changedBy: string; createdAt: string }[];
};
export function CommerceRewardsPage() {
  const { data, error, loading, reload } = useResource<AdminRewardsData>('/commerce/admin/rewards');
  const [customerId, setCustomerId] = useState(''), [search, setSearch] = useState('');
  const [adjustmentBlocked, setAdjustmentBlocked] = useState(false);
  const [ruleBlocked, setRuleBlocked] = useState(false);
  const anyBlocked = adjustmentBlocked || ruleBlocked;
  const customers = data?.customers.filter(customer => `${customer.name} ${customer.email}`.toLowerCase().includes(search.toLowerCase())) ?? [];
  return <div className="mx-auto max-w-6xl space-y-6">
    <header className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-sm font-semibold text-primary">CUSTOMER CARE</p><h1 className="mt-1 text-3xl font-bold">Customer rewards</h1><p className="mt-2 text-sm text-muted-foreground">Manage loyalty rules and review points earned from completed orders.</p></div><Button variant="outline" onClick={reload} disabled={loading || anyBlocked}><RefreshCw className="size-4" />Refresh</Button></header>
    <Feedback error={error} />{loading && <p role="status">Loading customer rewards…</p>}
    {data && <>
      <fieldset className="min-w-0" disabled={ruleBlocked}>
        <Section title="Customer loyalty account"><div className="grid gap-4 sm:grid-cols-2"><Field label="Find a customer"><Input placeholder="Customer name or email" value={search} onChange={event => setSearch(event.target.value)} disabled={adjustmentBlocked} /></Field><Field label="Customer"><NativeSelect value={customerId} onChange={event => setCustomerId(event.target.value)} disabled={adjustmentBlocked}><option value="">Choose a customer</option>{customers.map(customer => <option value={customer.id} key={customer.id}>{customer.name} · {customer.email} · {customer.points} points</option>)}</NativeSelect></Field></div>{customerId && <CustomerRewardsAdmin key={customerId} customerId={customerId} onChanged={reload} onBlockingChange={setAdjustmentBlocked} />}</Section>
      </fieldset>
      <fieldset className="min-w-0" disabled={adjustmentBlocked}>
        <Section title="Reward rules"><RuleEditor key={data.rules.version} rules={data.rules} refresh={reload} onBlockingChange={setRuleBlocked} /><details className="text-sm"><summary className="cursor-pointer font-medium">Rule change history</summary><div className="mt-3 space-y-3">{data.ruleHistory.length ? data.ruleHistory.map(rule => <div className="rounded-lg border p-3" key={rule.version}><p className="font-medium">Version {rule.version} · {rule.changedBy}</p><p>{rule.reason}</p><p className="text-xs text-muted-foreground">{moment(rule.createdAt)}</p></div>) : <p className="text-muted-foreground">The initial rules have not been changed.</p>}</div></details></Section>
      </fieldset>
    </>}
  </div>;
}

function CustomerRewardsAdmin({ customerId, onChanged, onBlockingChange }: { customerId: string; onChanged: () => unknown; onBlockingChange: (blocked: boolean) => void }) {
  const { data, error, reload } = useResource<RewardsData>('/commerce/admin/rewards/' + customerId);
  const mutation = useCommerceMutation(() => { reload(); onChanged(); });
  useEffect(() => { onBlockingChange(mutation.busy || mutation.unresolved); return () => onBlockingChange(false); }, [mutation.busy, mutation.unresolved, onBlockingChange]);
  const [points, setPoints] = useState(''), [reason, setReason] = useState('');
  return <div className="space-y-4">
    <Feedback {...mutation} error={error || mutation.error} />
    {data && <>
      <p className="text-sm">Balance: <strong>{data.balance}</strong> · Reserved: <strong>{data.reserved}</strong> · Available: <strong>{data.available}</strong></p>
      <form onSubmit={async event => {
        event.preventDefault();
        if (await mutation.submit(`/admin/rewards/${customerId}/adjust`, { points: Number(points), reason }, 'Points adjustment recorded with an audit trail.')) { setPoints(''); setReason(''); }
      }}>
        <fieldset disabled={mutation.busy || mutation.unresolved} className="grid items-end gap-4 sm:grid-cols-3">
          <Field label="Points to add or deduct"><Input required type="number" min="-1000000" max="1000000" step="1" placeholder="For example, 20 or -20" value={points} onChange={event => setPoints(event.target.value)} /></Field>
          <Field label="Required reason"><Textarea required minLength={5} maxLength={500} value={reason} onChange={event => setReason(event.target.value)} /></Field>
          <Button type="submit" disabled={!Number(points)}>{mutation.busy ? 'Saving…' : 'Record adjustment'}</Button>
        </fieldset>
      </form>
      <p className="text-sm text-muted-foreground">Every adjustment is recorded with its author and reason. Corrections may leave a negative balance; future earnings reduce it before points become available again. Each completed order earns points once.</p>
      <RewardHistoryTable rows={data.history} />
    </>}
  </div>;
}

function RuleEditor({ rules, refresh, onBlockingChange }: { rules: RewardRule; refresh: () => unknown; onBlockingChange: (blocked: boolean) => void }) {
  const mutation = useCommerceMutation(refresh);
  useEffect(() => { onBlockingChange(mutation.busy || mutation.unresolved); return () => onBlockingChange(false); }, [mutation.busy, mutation.unresolved, onBlockingChange]);
  const [rate, setRate] = useState(String(rules.pointsPerDollar)), [points, setPoints] = useState(String(rules.redemptionPoints)), [value, setValue] = useState(String(rules.redemptionValue)), [reason, setReason] = useState('');
  return <form className="space-y-4" onSubmit={event => {
    event.preventDefault();
    void mutation.submit('/admin/reward-rules', { expectedVersion: rules.version, pointsPerDollar: Number(rate), redemptionPoints: Number(points), redemptionValue: Number(value), reason }, 'Reward rules saved. Completed orders keep their recorded points, and existing reservations keep their reserved discount.', 'PATCH');
  }}>
    <p className="text-sm text-muted-foreground">Current version {rules.version}: earn {rules.pointsPerDollar} point(s) per SGD 1 of completed service after reward discounts; {rules.redemptionPoints} points redeem {money(rules.redemptionValue)}. Points are calculated once when an order becomes Completed, with fractional points rounded down. A discount can cover the full service amount.</p>
    <fieldset disabled={mutation.busy || mutation.unresolved} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3"><Field label="Points per SGD 1"><Input type="number" required min="0" max="100" step="1" value={rate} onChange={event => setRate(event.target.value)} /></Field><Field label="Points per redemption block"><Input type="number" required min="1" max="1000000" step="1" value={points} onChange={event => setPoints(event.target.value)} /></Field><Field label="Discount per block (SGD)"><Input type="number" required min="0.01" step="0.01" value={value} onChange={event => setValue(event.target.value)} /></Field></div>
      <Field label="Reason for rule change"><Textarea required minLength={5} maxLength={500} value={reason} onChange={event => setReason(event.target.value)} /></Field>
      <Button type="submit">{mutation.busy ? 'Saving…' : 'Save new rule version'}</Button>
    </fieldset>
    <Feedback {...mutation} />
  </form>;
}
