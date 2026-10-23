'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Gift, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { commerceApi, money, type RewardsData } from '@/components/commerce-shared';
import { bookingRewardPreview } from '@/lib/booking-rewards';
import { useCustomerResource } from '@/lib/use-customer-resource';

const loadRewards = () => commerceApi<RewardsData>('/customer/rewards');

export function BookingRewardSelection({ amount, annual = false, value, onChange, onValidityChange, onRuleVersionChange, disabled = false }: {
  amount: number;
  annual?: boolean;
  value: number;
  onChange: (points: number) => void;
  onValidityChange: (valid: boolean) => void;
  onRuleVersionChange?: (version: number | undefined) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const [input, setInput] = useState(String(value));
  useEffect(() => { setInput(String(value)); }, [value]);
  const entered = input === '' ? 0 : Number(input);
  const validInput = Number.isSafeInteger(entered) && entered >= 0 && entered <= 10_000_000;
  const selectPoints = (points: number) => { setInput(String(points)); onChange(points); };
  const { data, error, refreshing, refresh } = useCustomerResource(loadRewards);
  const preview = data ? bookingRewardPreview(amount, data.available, value, data.rules) : null;
  const valid = validInput && (value === 0 || Boolean(data && !error && !refreshing && preview?.valid));
  const version = value > 0 && data && !error ? data.rules.version : undefined;
  const callbacks = useRef({ onValidityChange, onRuleVersionChange });
  callbacks.current = { onValidityChange, onRuleVersionChange };
  useEffect(() => { callbacks.current.onValidityChange(valid); }, [valid]);
  useEffect(() => { callbacks.current.onRuleVersionChange?.(version); }, [version]);

  return <section aria-labelledby={`${id}-title`} className="mt-5 space-y-3 rounded-2xl border border-primary/20 bg-primary/5 p-4 sm:p-5">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 id={`${id}-title`} className="flex items-center gap-2 font-semibold"><Gift className="size-4" />Use loyalty points</h3>
      <Button type="button" size="sm" variant="ghost" disabled={disabled || refreshing} onClick={() => void refresh()}><RefreshCw className="size-4" />Refresh points</Button>
    </div>
    {!data && !error && <p role="status" className="text-sm text-muted-foreground">Loading available points…</p>}
    {data && refreshing && value > 0 && <p role="status" className="text-sm text-muted-foreground">Checking your available points…</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error} Refresh points to apply a discount, or continue without points.</p>}
    {data && preview && <>
      <p className="text-sm"><strong>{data.available} points available</strong> · {data.rules.redemptionPoints} points = {money(data.rules.redemptionValue)} off</p>
      <label htmlFor={id} className="block text-sm font-medium">Points to use (optional)</label>
      <div className="flex flex-wrap items-center gap-2">
        <Input id={id} type="number" inputMode="numeric" min={0} max={preview.maxPoints} step={data.rules.redemptionPoints} value={input} disabled={disabled || Boolean(error) || (preview.maxPoints === 0 && value === 0 && validInput)} aria-invalid={!valid} aria-describedby={`${id}-hint`} onChange={event => {
          const text = event.target.value;
          setInput(text);
          const points = text === '' ? 0 : Number(text);
          // Keep invalid temporary input out of the Assistant's persisted draft.
          if (Number.isSafeInteger(points) && points >= 0 && points <= 10_000_000) onChange(points);
        }} className="max-w-40 bg-background" />
        <Button type="button" variant="outline" size="sm" disabled={disabled || Boolean(error) || preview.maxPoints === 0} onClick={() => selectPoints(preview.maxPoints)}>Use maximum</Button>
      </div>
      <p id={`${id}-hint`} className="text-xs text-muted-foreground">Use multiples of {data.rules.redemptionPoints}, up to {preview.maxPoints} points for {annual ? 'the first quarterly visit' : 'this visit'}. Leave 0 to book without points.</p>
      {!validInput && <p role="alert" className="text-sm text-destructive">Enter a whole number of points from 0 to 10,000,000.</p>}
      {validInput && !preview.valid && <p role="alert" className="text-sm text-destructive">Your selected points are no longer available for this amount. Choose a valid amount or remove the points.</p>}
      {preview.maxPoints === 0 && value === 0 && <p className="text-sm text-muted-foreground">No points can be used for this visit yet. You can still confirm your booking.</p>}
      <dl className="space-y-1 border-t border-primary/15 pt-3 text-sm">
        <div className="flex flex-wrap justify-between gap-x-3"><dt>{annual ? 'First visit estimate' : 'Visit estimate'}</dt><dd>{money(amount)}</dd></div>
        <div className="flex flex-wrap justify-between gap-x-3"><dt>Points discount</dt><dd>{valid ? `−${money(preview.discount)}` : 'Choose valid points'}</dd></div>
        <div className="flex flex-wrap justify-between gap-x-3 font-semibold"><dt>{annual ? 'First visit after points' : 'Estimate after points'}</dt><dd>{valid ? money(preview.netAmount) : '—'}</dd></div>
      </dl>
    </>}
    {(value !== 0 || !validInput) && <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={() => selectPoints(0)}>Do not use points</Button>}
    {annual && <p className="text-xs text-muted-foreground">Points apply to the first quarterly booking only. The other three visits keep their quoted prices.</p>}
    <p className="text-xs leading-5 text-muted-foreground">Your points are reserved when you confirm this booking and used once the order is completed. Cancelling, rejection or expiry releases unused points.</p>
  </section>;
}
