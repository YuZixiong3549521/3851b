import type {
  Booking,
  BookingInput,
  CreatedBooking,
  CustomerContext,
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
    throw new Error(message);
  }
  return result as T;
}

export const coolcareApi = {
  getCustomerContext: async () =>
    (await apiRequest<{ customer: CustomerContext['customer']; addresses: CustomerContext['addresses']; units: CustomerContext['units'] }>('/customer-context')),
  getServices: async () => (await apiRequest<{ services: Service[] }>('/services')).services,
  getBookings: async (scope?: 'upcoming') =>
    (await apiRequest<{ bookings: Booking[] }>(`/bookings${scope ? `?scope=${scope}` : ''}`)).bookings,
  getHistory: async () => (await apiRequest<{ bookings: Booking[] }>('/bookings/history')).bookings,
  getReport: async (bookingId: number) =>
    (await apiRequest<{ report: ServiceReport }>(`/bookings/${bookingId}/report`)).report,
  createBooking: async (input: BookingInput) =>
    (await apiRequest<{ booking: CreatedBooking }>('/bookings', {
      method: 'POST',
      body: JSON.stringify(input),
    })).booking,
};
