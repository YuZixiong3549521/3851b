export type Customer = {
  customerId: number;
  userId: number;
  fullName: string;
  email: string;
  phone: string | null;
};

export type Address = {
  addressId: number;
  label: string | null;
  addressLine: string;
  postalCode: string | null;
  isDefault: number | boolean;
};

export type CreateAddressInput = {
  addressLine: string;
  label?: string;
  postalCode?: string;
  expectedUserId?: number;
  requestId?: string;
};

export type UpdateProfileInput = { fullName: string; phone: string | null; expectedUserId?: number };
export type BookingAvailabilityInput = {
  serviceIds?: number[];
  packageId?: number;
  serviceAddress?: string;
  addressId?: number;
  from: string;
  to: string;
  excludeBookingId?: number;
};
export type BookingAvailability = {
  blockedDates: string[];
  existingBookings: Array<{ bookingId: number; preferredDate: string; timeSlot: string; status: string }>;
  earliestDate: string;
  timeZone: 'Asia/Singapore';
};
export type SlotAvailability = {
  dates: Array<{ date: string; slots: Array<{ code: BookingInput['timeSlot']; label: string; available: boolean }> }>;
};

export type AirconUnit = {
  unitId: number;
  addressId: number | null;
  brand: string | null;
  model: string | null;
  serialNumber: string | null;
  location: string | null;
  warrantyStatus: string;
};

export type CustomerContext = {
  customer: Customer;
  addresses: Address[];
  units: AirconUnit[];
};

export type Service = {
  serviceId: number;
  serviceName: string;
  description: string | null;
  basePrice: number;
  additionalUnitPrice?: number;
  durationMinutes: number;
};

export type BookingServiceOption = {
  serviceId: number;
  name: string;
  description: string | null;
  basePrice: number;
  additionalUnitPrice: number;
  code: 'cleaning' | 'repair';
  pricingNote: string;
  durationMinutesPerUnit?: number;
  minimumDurationMinutes?: number;
};

export type PropertyPrice = { propertyType: string; label: string; includedUnits: number; price: number; additionalUnitPrice: number };

export type ServiceBundle = {
  propertyPrices?: PropertyPrice[];
  packageId: number;
  name: string;
  description: string | null;
  price: number;
  serviceIds: number[];
  includedUnits: number;
  additionalUnitPrice: number;
  code: 'annual-cleaning';
  includedVisits: number;
  pricingNote: string;
};

export type BookingOptions = {
  services: BookingServiceOption[];
  bundles: ServiceBundle[];
  subscriptions: [];
};

export type Booking = {
  slotStart?: string | null;
  slotEnd?: string | null;
  serviceIds?: number[];
  packageId?: number | null;
  estimatedDurationMinutes?: number;
  specialNotes?: string | null;
  propertyType?: string | null;
  propertyLabel?: string | null;
  changeDeadline?: string | null;
  expiresAt?: string | null;
  rejectionVersion?: number;
  serviceProgress?: ServiceProgress | null;
  bookingId: number;
  addressId: number;
  numberOfUnits: number;
  canModify: boolean;
  bookingReference: string;
  createdAt: string;
  preferredDate: string;
  timeSlot: string;
  problemDescription: string | null;
  status: string;
  rejectionReason: string | null;
  totalAmount: number | null;
  serviceName: string;
  addressLabel: string | null;
  addressLine: string;
  postalCode: string | null;
  technicianName: string | null;
  reportId: number | null;
  units: AirconUnit[];
  annualBundle?: AnnualBundle | null;
};

export type BookingDetail = Booking & {
  canModify: boolean;
  statusTimeline: Array<{ status: string; changedAt: string; remarks: string | null }>;
};

export type AnnualVisit = {
  bookingId: number;
  visitNumber: number;
  preferredDate: string;
  timeSlot: string;
  totalAmount: number;
  status: string;
  windowStart?: string;
  windowEnd?: string;
};

export type AnnualBundle = {
  propertyType?: string | null;
  propertyLabel?: string | null;
  seriesId: number;
  name: string;
  totalAmount: number;
  visitNumber?: number;
  windowStart?: string;
  windowEnd?: string;
  visits: AnnualVisit[];
};

export type CreatedBooking = {
  bookingId: number;
  bookingReference: string;
  status: string;
  serviceName: string;
  totalAmount: number;
  annualBundle?: AnnualBundle | null;
};

export type ServiceReport = {
  serviceProgress?: ServiceProgress | null;
  bookingId: number;
  bookingReference: string;
  serviceDate: string;
  timeSlot: string;
  serviceName: string;
  technicianName: string;
  reportId: number;
  workPerformed: string;
  problemFound: string | null;
  solutionApplied: string | null;
  checklistResult: string | null;
  customerSignatureUrl?: string | null;
  technicianSignatureUrl?: string | null;
  submittedTime: string | null;
  cleaningMethod?: 'Regular' | 'Chemical' | null;
  assessmentNote?: string | null;
  durationMinutes: number | null;
  partsUsed: Array<{ partId: number; partName: string; quantity: number; unit: string | null }>;
  photos: Array<{
    photoId: number;
    photoUrl: string | null;
    description: string | null;
    capturedTime: string;
  }>;
};

export type BookingInput = {
  propertyType?: string;
  postalCode?: string;
  specialNotes?: string;
  expectedUserId?: number;
  serviceId?: number;
  serviceIds?: number[];
  packageId?: number;
  requestId?: string;
  addressId?: number;
  unitIds?: number[];
  serviceAddress?: string;
  numberOfUnits?: number;
  preferredDate: string;
  timeSlot: '09:00 - 11:00' | '11:00 - 13:00' | '14:00 - 16:00' | '16:00 - 18:00';
  problemDescription?: string;
};

export type ServiceProgress = {
  version: number;
  extensionMinutes: number;
  expectedEndTime: string | null;
  followUpStatus: string | null;
  additionalRepairFee: number;
  repairQuoteNote: string | null;
  followUpDate: string | null;
  followUpStart: string | null;
  followUpEnd: string | null;
  events: Array<{ id: number; kind: string; minutes?: number | null; reason?: string | null; notes?: string | null; partNotes?: string | null; followUpDate?: string | null; followUpStart?: string | null; followUpEnd?: string | null; createdAt: string; createdBy: string; amount?: number | null }>;
};
