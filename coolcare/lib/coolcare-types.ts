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

export type Booking = {
  bookingId: number;
  bookingReference: string;
  createdAt: string;
  preferredDate: string;
  timeSlot: string;
  problemDescription: string | null;
  status: string;
  totalAmount: number | null;
  serviceName: string;
  addressLabel: string | null;
  addressLine: string;
  postalCode: string | null;
  technicianName: string | null;
  reportId: number | null;
  units: AirconUnit[];
};

export type CreatedBooking = {
  bookingId: number;
  bookingReference: string;
  status: string;
  serviceName: string;
  totalAmount: number;
};

export type ServiceReport = {
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
  submittedTime: string | null;
  photos: Array<{
    photoId: number;
    photoUrl: string;
    description: string | null;
    capturedTime: string;
  }>;
};

export type BookingInput = {
  serviceId: number;
  addressId: number;
  unitIds: number[];
  preferredDate: string;
  timeSlot: '09:00 - 11:00' | '11:00 - 13:00' | '14:00 - 16:00' | '16:00 - 18:00';
  problemDescription?: string;
};
