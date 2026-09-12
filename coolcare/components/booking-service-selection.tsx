'use client';

import { Layers, ListChecks, WalletCards } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { formatDate, formatMoney } from '@/lib/format';
import type { BookingOptions, EmailNotification } from '@/lib/coolcare-types';

export type BookingSelection = {
  mode: 'custom' | 'bundle' | 'membership';
  serviceIds: number[];
  packageId?: number;
  subscriptionId?: number;
};

export const emptyBookingSelection: BookingSelection = { mode: 'custom', serviceIds: [] };
export const bookingFrequencyNotice = 'To avoid duplicate visits, you can make up to two bookings for the same address in any 7-day period. Cancelled bookings do not count.';

export function bookingEmailMessage(notification?: EmailNotification) {
  if (!notification) return '';
  if (notification.status === 'disabled') return 'Booking email is currently unavailable. Your booking has been saved.';
  if (notification.status === 'sent') return notification.mode === 'local' ? 'Booking email delivered to the local demo inbox.' : `Booking email sent to ${notification.recipient}.`;
  return notification.mode === 'local' ? 'Booking email queued for the local demo inbox.' : 'Your booking email is queued.';
}

export function getBookingSelection(options: BookingOptions | null, selection: BookingSelection, unitCount: number) {
  const bundle = options?.bundles.find(item => item.packageId === selection.packageId);
  const subscription = options?.subscriptions.find(item => item.subscriptionId === selection.subscriptionId);
  const services = selection.mode === 'membership' ? subscription?.services ?? []
    : options?.services.filter(item => (selection.mode === 'bundle' ? bundle?.serviceIds ?? [] : selection.serviceIds).includes(item.serviceId)) ?? [];
  const selected = selection.mode === 'bundle' ? Boolean(bundle) : selection.mode === 'membership' ? Boolean(subscription && subscription.remainingVisits > 0) : services.length > 0;
  const estimate = !selected || unitCount < 1 ? 0 : selection.mode === 'membership' ? 0 : selection.mode === 'bundle'
    ? Number(bundle!.price) + Math.max(0, unitCount - Number(bundle!.includedUnits ?? 1)) * Number(bundle!.additionalUnitPrice ?? 0)
    : services.reduce((total, service) => total + Number(service.basePrice) + Math.max(0, unitCount - 1) * Number(service.additionalUnitPrice ?? 0), 0);
  return {
    valid: selected && services.length > 0,
    estimate,
    label: selection.mode === 'bundle' ? bundle?.name ?? '' : selection.mode === 'membership' ? subscription?.name ?? '' : services.map(item => item.name).join(' + '),
    serviceNames: services.map(item => item.name).join(' + '),
    payload: { serviceIds: services.map(item => item.serviceId), ...(selection.mode === 'bundle' && bundle ? { packageId: bundle.packageId } : {}), ...(selection.mode === 'membership' && subscription ? { subscriptionId: subscription.subscriptionId } : {}) },
  };
}

export function BookingServiceSelection({ options, value, onChange, units = 1, disabled = false }: {
  options: BookingOptions;
  value: BookingSelection;
  onChange: (value: BookingSelection) => void;
  units?: number;
  disabled?: boolean;
}) {
  const modes = [{ mode: 'custom' as const, title: 'Build your own', icon: ListChecks }, { mode: 'bundle' as const, title: 'Service bundle', icon: Layers }, { mode: 'membership' as const, title: 'Use my membership', icon: WalletCards }];
  const summary = getBookingSelection(options, value, units);
  return <div className="space-y-4">
    <div className="grid gap-2 sm:grid-cols-3" aria-label="Booking type">{modes.map(({ mode, title, icon: Icon }) => <Button key={mode} type="button" variant={value.mode === mode ? 'default' : 'outline'} disabled={disabled} aria-pressed={value.mode === mode} className="h-auto min-h-12 whitespace-normal px-3 py-3" onClick={() => onChange({ mode, serviceIds: [] })}><Icon className="size-4 shrink-0" />{title}</Button>)}</div>
    {value.mode === 'custom' && <div className="space-y-2"><p className="text-sm text-muted-foreground">Choose one or more services for the same visit.</p>{options.services.length === 0 && <p className="text-sm">No services are currently available.</p>}{options.services.map(service => <label key={service.serviceId} className="flex cursor-pointer items-start gap-3 rounded-xl border bg-background p-4 has-data-checked:border-primary has-data-checked:bg-primary/5"><Checkbox disabled={disabled} checked={value.serviceIds.includes(service.serviceId)} onCheckedChange={checked => onChange({ ...value, serviceIds: checked ? [...value.serviceIds, service.serviceId] : value.serviceIds.filter(id => id !== service.serviceId) })} aria-label={service.name} /><span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{service.name}</span><span className="mt-1 block text-xs leading-5 text-muted-foreground">{service.description}</span><span className="mt-2 block text-xs font-medium text-primary">{formatMoney(service.basePrice)} first unit{Number(service.additionalUnitPrice) > 0 ? ` · ${formatMoney(service.additionalUnitPrice)} each extra unit` : ' · No extra unit charge'}</span></span></label>)}</div>}
    {value.mode === 'bundle' && <div className="space-y-2"><p className="text-sm text-muted-foreground">One bundle combines the services listed below in a single visit.</p>{options.bundles.length === 0 && <p className="text-sm">No service bundles are currently available.</p>}{options.bundles.map(bundle => <Button key={bundle.packageId} type="button" variant="outline" disabled={disabled} aria-pressed={value.packageId === bundle.packageId} onClick={() => onChange({ mode: 'bundle', packageId: bundle.packageId, serviceIds: bundle.serviceIds })} className={`h-auto w-full justify-start whitespace-normal p-4 text-left ${value.packageId === bundle.packageId ? 'border-primary bg-primary/5' : ''}`}><span className="block"><span className="block font-semibold">{bundle.name}</span><span className="mt-1 block text-xs font-normal leading-5 text-muted-foreground">{bundle.description}</span><span className="mt-1 block text-xs font-normal">{options.services.filter(item => bundle.serviceIds.includes(item.serviceId)).map(item => item.name).join(' + ')}</span><span className="mt-2 block text-xs text-primary">{formatMoney(bundle.price)} for {bundle.includedUnits ?? 1} unit(s) · {formatMoney(bundle.additionalUnitPrice ?? 0)} each extra unit</span></span></Button>)}</div>}
    {value.mode === 'membership' && <div className="space-y-2"><p className="text-sm text-muted-foreground">Use an included visit from a membership on your account. One visit is reserved when you book.</p>{options.subscriptions.length === 0 && <p className="rounded-xl bg-muted p-4 text-sm">You do not have an active membership. Choose individual services or a service bundle to continue.</p>}{options.subscriptions.map(subscription => <Button key={subscription.subscriptionId} type="button" variant="outline" disabled={disabled || subscription.remainingVisits < 1} aria-pressed={value.subscriptionId === subscription.subscriptionId} onClick={() => onChange({ mode: 'membership', subscriptionId: subscription.subscriptionId, serviceIds: subscription.services.map(item => item.serviceId) })} className={`h-auto w-full justify-start whitespace-normal p-4 text-left ${value.subscriptionId === subscription.subscriptionId ? 'border-primary bg-primary/5' : ''}`}><span><span className="block font-semibold">{subscription.name}</span><span className="mt-1 block text-xs">{subscription.remainingVisits} visit(s) remaining · Valid until {formatDate(subscription.endDate)}</span><span className="mt-1 block text-xs font-normal text-muted-foreground">{subscription.services.map(item => item.name).join(' + ')}</span><span className="mt-2 block text-xs text-primary">Included visit · {formatMoney(0)}</span></span></Button>)}</div>}
    {summary.valid && <p className="text-sm font-medium text-primary" aria-live="polite">{value.mode === 'membership' ? 'Included in your membership' : `Estimated ${formatMoney(summary.estimate)} for ${units} unit(s)`}</p>}
  </div>;
}
