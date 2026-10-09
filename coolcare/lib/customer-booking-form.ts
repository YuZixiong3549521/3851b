import type { BookingInput, Address } from '@/lib/coolcare-types';

type ServiceChoice = {
  mode: 'custom' | 'bundle';
  serviceIds: number[];
  packageId?: number;
};

export type CustomerBookingForm = {
  serviceAddress: string;
  postalCode: string;
  specialNotes: string;
  numberOfUnits: number;
  preferredDate: string;
  timeSlot: BookingInput['timeSlot'] | '';
  problemDescription: string;
};

export function createDefaultCustomerBookingForm(
  addresses: readonly Pick<Address, 'addressLine' | 'postalCode' | 'isDefault'>[] = [],
  preferredDate: string,
): CustomerBookingForm {
  const address = addresses.find((item) => item.isDefault) ?? addresses[0];
  return {
    serviceAddress: address?.addressLine ?? '',
    postalCode: address?.postalCode ?? '',
    specialNotes: '',
    numberOfUnits: 1,
    preferredDate,
    timeSlot: '',
    problemDescription: '',
  };
}

export function bookingServiceChanged(previous: ServiceChoice, next: ServiceChoice) {
  if (previous.mode !== next.mode) return true;
  if (next.mode === 'bundle') return previous.packageId !== next.packageId;
  if (previous.serviceIds.length !== next.serviceIds.length) return true;
  const previousIds = new Set(previous.serviceIds);
  return next.serviceIds.some((serviceId) => !previousIds.has(serviceId));
}
