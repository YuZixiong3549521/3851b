'use client';

import {useId} from 'react';
import { CalendarDays, Check, Sparkles, Wrench } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/native-select';
import { formatMoney } from '@/lib/format';
import type { BookingOptions } from '@/lib/coolcare-types';

export type BookingSelection = {
  mode: 'custom' | 'bundle';
  serviceIds: number[];
  packageId?: number;
  propertyType?: string;
};

export const emptyBookingSelection: BookingSelection = { mode: 'custom', serviceIds: [] };
export const bookingFrequencyNotice = 'One cleaning appointment per address each Monday–Sunday week, including bundle and combined-service visits. Cancelled, rejected and expired requests do not count. Repair-only visits are not restricted by this cleaning limit.';
export const cleaningMethodNotice = 'For residential wall-mounted air conditioners. Your technician decides the cleaning method after inspection. Repair starts with a minimum diagnostic fee; additional labour and parts are quoted by your technician and shown in your booking. No payment is collected online.';
export const bookingChangeNotice = 'Any appointment change must be made at least 72 hours before the original visit. New dates must also be at least 72 hours ahead and fall on a weekday.';

export function getBookingSelection(options: BookingOptions | null, selection: BookingSelection, unitCount: number) {
  const bundle = options?.bundles.find(item => item.packageId === selection.packageId && item.code === 'annual-cleaning');
  const services = options?.services.filter(item => (selection.mode === 'bundle' ? bundle?.serviceIds ?? [] : selection.serviceIds).includes(item.serviceId)) ?? [];
  const property = bundle?.propertyPrices?.find(item => item.propertyType === selection.propertyType);
  const selected = selection.mode === 'bundle' ? Boolean(bundle && property) : services.length >= 1;
  const estimate = !selected || unitCount < 1 ? 0 : selection.mode === 'bundle'
    ? Number(property!.price) + Math.max(0, unitCount - Number(property!.includedUnits)) * Number(property!.additionalUnitPrice)
    : services.reduce((sum, service) => sum + Number(service.basePrice) + Math.max(0, unitCount - 1) * Number(service.additionalUnitPrice ?? 0), 0);
  const durationMinutes = services.reduce((sum, service) => sum + Math.max(Number(service.minimumDurationMinutes ?? (service.code === 'repair' ? 60 : 0)), unitCount * Number(service.durationMinutesPerUnit ?? (service.code === 'cleaning' ? 45 : 0))), 0);
  return {
    valid: selected && services.length >= 1,
    estimate,
    durationMinutes,
    propertyLabel: property?.label ?? '',
    isAnnual: selection.mode === 'bundle' && Boolean(bundle),
    visitCount: selection.mode === 'bundle' ? Number(bundle?.includedVisits ?? 4) : 1,
    pricingNote: selection.mode === 'bundle' ? property ? `${property.label}: includes up to ${property.includedUnits} units per visit. Extra units cost ${formatMoney(property.additionalUnitPrice)} each for the year. Four quarterly visits; pay after each visit.` : 'Choose your property type to see the annual price.' : services.map(service => service.pricingNote).join(' '),
    label: selection.mode === 'bundle' ? bundle?.name ?? '' : services.map(service => service.name).join(' + '),
    serviceNames: services.map(item => item.name).join(' + '),
    payload: { serviceIds: services.map(item => item.serviceId), ...(selection.mode === 'bundle' && bundle ? { packageId: bundle.packageId, propertyType: selection.propertyType } : {}) },
  };
}

export function BookingServiceSelection({ options, value, onChange, disabled = false }: {
  options: BookingOptions;
  value: BookingSelection;
  onChange: (value: BookingSelection) => void;
  disabled?: boolean;
}) {
  const propertyId=useId();
  const services = options.services.filter(service => service.code === 'cleaning' || service.code === 'repair');
  const bundle = options.bundles.find(item => item.code === 'annual-cleaning');
  return <div className="space-y-4">
    <p className="text-sm text-muted-foreground">Choose Cleaning, Repair, or both for one address. For quarterly cleaning, choose the Annual Cleaning Bundle.</p>
    <div className="grid gap-3" aria-label="Service options">
      {services.map(service => {
        const selected = value.mode === 'custom' && value.serviceIds.includes(service.serviceId);
        const Icon = service.code === 'repair' ? Wrench : Sparkles;
        const price = Number(service.basePrice);
        return <Button key={service.serviceId} type="button" variant="outline" disabled={disabled} aria-pressed={selected} onClick={() => onChange({ mode: 'custom', serviceIds: selected ? value.serviceIds.filter(id => id !== service.serviceId) : [...(value.mode === 'custom' ? value.serviceIds : []), service.serviceId] })} className={'h-auto w-full items-start justify-start gap-3 whitespace-normal rounded-2xl p-4 text-left ' + (selected ? 'border-primary bg-primary/5' : '')}>
          <Icon className="mt-0.5 size-5 shrink-0 text-primary" />
          <span className="min-w-0 flex-1"><span className="flex items-center justify-between gap-3"><span className="font-semibold">{service.name}</span>{selected && <Check className="size-4 shrink-0 text-primary" />}</span><span className="mt-1 block text-xs font-normal leading-5 text-muted-foreground">{service.description}</span><span className="mt-2 block text-sm font-semibold text-primary">{formatMoney(price)}{service.code === 'repair' ? ' minimum diagnostic fee' : ' per unit'}</span></span>
        </Button>;
      })}
      {bundle && <Button type="button" variant="outline" disabled={disabled} aria-pressed={value.mode === 'bundle' && value.packageId === bundle.packageId} onClick={() => onChange({ mode: 'bundle', packageId: bundle.packageId, serviceIds: bundle.serviceIds })} className={'h-auto w-full items-start justify-start gap-3 whitespace-normal rounded-2xl p-4 text-left ' + (value.mode === 'bundle' && value.packageId === bundle.packageId ? 'border-primary bg-primary/5' : '')}>
        <CalendarDays className="mt-0.5 size-5 shrink-0 text-primary" /><span className="min-w-0 flex-1"><span className="flex items-center justify-between gap-3"><span className="font-semibold">{bundle.name}</span>{value.mode === 'bundle' && value.packageId === bundle.packageId && <Check className="size-4 shrink-0 text-primary" />}</span><span className="mt-1 block text-xs font-normal leading-5 text-muted-foreground">Four cleaning visits, once every three months. Pricing depends on your property type and number of units.</span><span className="mt-2 block text-sm font-semibold text-primary">Select your property type for the annual estimate</span></span>
      </Button>}
      {bundle && value.mode === 'bundle' && <div><label className="text-sm font-medium" htmlFor={propertyId}>Property type</label><NativeSelect id={propertyId} className="mt-2 w-full" value={value.propertyType ?? ''} disabled={disabled} onChange={event => onChange({ ...value, propertyType: event.target.value })}><option value="">Choose your property type</option>{bundle.propertyPrices?.map(property => <option key={property.propertyType} value={property.propertyType}>{property.label} · {formatMoney(property.price)}/year · up to {property.includedUnits} units</option>)}</NativeSelect><p className="mt-2 text-xs leading-5 text-muted-foreground">The package price includes up to the stated number of units. Fewer units do not reduce the package price. Additional units are priced separately.</p></div>}
      {services.length === 0 && !bundle && <p className="text-sm">No services are currently available. Please try again later.</p>}
    </div>
    <p className="rounded-xl bg-muted/65 p-3 text-xs leading-5 text-muted-foreground">{cleaningMethodNotice}</p>
  </div>;
}
