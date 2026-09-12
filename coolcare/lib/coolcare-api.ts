import type {
  Address,
  Booking,
  BookingInput,
  BookingOptions,
  CreatedBooking,
  CreateAddressInput,
  CustomerContext,
  EmailNotification,
  Service,
  ServiceReport,
} from './coolcare-types';

const apiBaseUrl = '/api/customer';

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set('Content-Type', 'application/json');
  if (init?.method && !['GET', 'HEAD'].includes(init.method)) {
    const sessionResponse = await fetch('/api/session');
    if (!sessionResponse.ok) throw new Error('Unable to start a session. Please retry.');
    const session = await sessionResponse.json() as { csrf: string };
    headers.set('X-CSRF-Token', session.csrf);
  }
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers,
  });

  const result: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof result === 'object' && result !== null && 'error' in result && typeof result.error === 'string'
      ? result.error
      : 'Unable to complete the request.';
    throw Object.assign(new Error(message), { status: response.status });
  }
  return result as T;
}

export const coolcareApi = {
  getCustomerContext: async () =>
    (await apiRequest<{ customer: CustomerContext['customer']; addresses: CustomerContext['addresses']; units: CustomerContext['units'] }>('/customer-context')),
  getServices: async () => (await apiRequest<{ services: Service[] }>('/services')).services,
  getBookingOptions: async () => apiRequest<BookingOptions>('/booking-options'),
  createAddress: async (input: CreateAddressInput) => {
    const result = await apiRequest<{ address: Address }>('/addresses', { method: 'POST', body: JSON.stringify(input) });
    if (!result.address || !Number.isInteger(Number(result.address.addressId)) || Number(result.address.addressId) < 1 || typeof result.address.addressLine !== 'string') {
      throw new Error('The saved address could not be verified. Retry saving with the same details.');
    }
    return result.address;
  },
  getBookings: async (scope?: 'upcoming') =>
    (await apiRequest<{ bookings: Booking[] }>(`/bookings${scope ? `?scope=${scope}` : ''}`)).bookings,
  getHistory: async () => (await apiRequest<{ bookings: Booking[] }>('/bookings/history')).bookings,
  getReport: async (bookingId: number) =>
    (await apiRequest<{ report: ServiceReport }>(`/bookings/${bookingId}/report`)).report,
  createBooking: async (input: BookingInput) => {
    const result = await apiRequest<{ booking: CreatedBooking; emailNotification?: EmailNotification }>('/bookings', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    return { ...result.booking, emailNotification: result.emailNotification ?? result.booking.emailNotification };
  },
};
