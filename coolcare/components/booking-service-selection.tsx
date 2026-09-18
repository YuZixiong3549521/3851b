'use client';

import { CalendarDays, Check, Sparkles, Wrench } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatMoney } from '@/lib/format';
import type { BookingOptions } from '@/lib/coolcare-types';

export type BookingSelection = {
  mode: 'custom' | 'bundle';
  serviceIds: number[];
  packageId?: number;
};

export const emptyBookingSelection: BookingSelection = { mode: 'custom', serviceIds: [] };
export const bookingFrequencyNotice = 'To avoid duplicate visits, you can make up to two bookings for the same address in any 7-day period. Cancelled bookings do not count.';
export const cleaningMethodNotice = 'For residential wall-mounted air conditioners. The technician will assess the unit and decide whether regular or chemical cleaning is appropriate. Chemical cleaning, repairs and any additional work require an agreed quote before proceeding.';

export function getBookingSelection(options: BookingOptions | null, selection: BookingSelection, unitCount: number) {
  const bundle = options?.bundles.find(item => item.packageId === selection.packageId && item.code === 'annual-cleaning');
  const services = options?.services.filter(item => (selection.mode === 'bundle' ? bundle?.serviceIds ?? [] : selection.serviceIds).includes(item.serviceId)) ?? [];
  const selected = selection.mode === 'bundle' ? Boolean(bundle) : services.length === 1;
  const estimate = !selected || unitCount < 1 ? 0 : selection.mode === 'bundle'
    ? Number(bundle!.price) + Math.max(0, unitCount - Number(bundle!.includedUnits ?? 1)) * Number(bundle!.additionalUnitPrice ?? 0)
    : Number(services[0].basePrice) + Math.max(0, unitCount - 1) * Number(services[0].additionalUnitPrice ?? 0);
  return {
    valid: selected && services.length === 1,
    estimate,
    isAnnual: selection.mode === 'bundle' && Boolean(bundle),
    visitCount: selection.mode === 'bundle' ? Number(bundle?.includedVisits ?? 4) : 1,
    pricingNote: selection.mode === 'bundle' ? bundle?.pricingNote ?? '' : services[0]?.pricingNote ?? '',
    label: selection.mode === 'bundle' ? bundle?.name ?? '' : services[0]?.name ?? '',
    serviceNames: services.map(item => item.name).join(' + '),
    payload: { serviceIds: services.map(item => item.serviceId), ...(selection.mode === 'bundle' && bundle ? { packageId: bundle.packageId } : {}) },
  };
}

export function BookingServiceSelection({ options, value, onChange, units = 1, disabled = false }: {
  options: BookingOptions;
  value: BookingSelection;
  onChange: (value: BookingSelection) => void;
  units?: number;
  disabled?: boolean;
}) {
  const summary = getBookingSelection(options, value, units);
  const services = options.services.filter(service => service.code === 'cleaning' || service.code === 'repair');
  const bundle = options.bundles.find(item => item.code === 'annual-cleaning');
  return <div className="space-y-4">
    <p className="text-sm text-muted-foreground">Choose one option for your air conditioner.</p>
    <div className="grid gap-3" aria-label="Service options">
      {services.map(service => {
        const selected = value.mode === 'custom' && value.serviceIds[0] === service.serviceId;
        const Icon = service.code === 'repair' ? Wrench : Sparkles;
        const price = Number(service.basePrice) + Math.max(0, units - 1) * Number(service.additionalUnitPrice);
        return <Button key={service.serviceId} type="button" variant="outline" disabled={disabled} aria-pressed={selected} onClick={() => onChange({ mode: 'custom', serviceIds: [service.serviceId] })} className={'h-auto w-full items-start justify-start gap-3 whitespace-normal rounded-2xl p-4 text-left ' + (selected ? 'border-primary bg-primary/5' : '')}>
          <Icon className="mt-0.5 size-5 shrink-0 text-primary" />
          <span className="min-w-0 flex-1"><span className="flex items-center justify-between gap-3"><span className="font-semibold">{service.name}</span>{selected && <Check className="size-4 shrink-0 text-primary" />}</span><span className="mt-1 block text-xs font-normal leading-5 text-muted-foreground">{service.description}</span><span className="mt-2 block text-sm font-semibold text-primary">{formatMoney(price)}{service.code === 'repair' ? ' diagnostic visit' : ' per visit'}</span><span className="mt-1 block text-xs font-normal leading-5 text-muted-foreground">{service.pricingNote}</span></span>
        </Button>;
      })}
      {bundle && <Button type="button" variant="outline" disabled={disabled} aria-pressed={value.mode === 'bundle' && value.packageId === bundle.packageId} onClick={() => onChange({ mode: 'bundle', packageId: bundle.packageId, serviceIds: bundle.serviceIds })} className={'h-auto w-full items-start justify-start gap-3 whitespace-normal rounded-2xl p-4 text-left ' + (value.mode === 'bundle' && value.packageId === bundle.packageId ? 'border-primary bg-primary/5' : '')}>
        <CalendarDays className="mt-0.5 size-5 shrink-0 text-primary" /><span className="min-w-0 flex-1"><span className="flex items-center justify-between gap-3"><span className="font-semibold">{bundle.name}</span>{value.mode === 'bundle' && value.packageId === bundle.packageId && <Check className="size-4 shrink-0 text-primary" />}</span><span className="mt-1 block text-xs font-normal leading-5 text-muted-foreground">Four cleaning visits, once every three months. Choose the first preferred date; we will save all four requests.</span><span className="mt-2 block text-sm font-semibold text-primary">{formatMoney(Number(bundle.price) + Math.max(0, units - Number(bundle.includedUnits)) * Number(bundle.additionalUnitPrice))} for all four visits</span><span className="mt-1 block text-xs font-normal leading-5 text-muted-foreground">{bundle.pricingNote}</span></span>
      </Button>}
      {services.length === 0 && !bundle && <p className="text-sm">No services are currently available. Please try again later.</p>}
    </div>
    <p className="rounded-xl bg-muted/65 p-3 text-xs leading-5 text-muted-foreground">{cleaningMethodNotice}</p>
    {summary.valid && <p className="text-sm font-medium text-primary" aria-live="polite">{summary.isAnnual ? 'Annual estimate: ' : 'Visit estimate: '}{formatMoney(summary.estimate)} for {units} unit(s).</p>}
  </div>;
}
