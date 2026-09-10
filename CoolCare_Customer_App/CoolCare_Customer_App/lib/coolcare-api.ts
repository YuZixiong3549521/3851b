import type {
  Booking,
  BookingInput,
  CreatedBooking,
  CustomerContext,
  Service,
  ServiceReport,
} from './coolcare-types';

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000';

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set('Content-Type', 'application/json');
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
    (await apiRequest<{ customer: CustomerContext['customer']; addresses: CustomerContext['addresses']; units: CustomerContext['units'] }>('/api/customer-context')),
  getServices: async () => (await apiRequest<{ services: Service[] }>('/api/services')).services,
  getBookings: async (scope?: 'upcoming') =>
    (await apiRequest<{ bookings: Booking[] }>(`/api/bookings${scope ? `?scope=${scope}` : ''}`)).bookings,
  getHistory: async () => (await apiRequest<{ bookings: Booking[] }>('/api/bookings/history')).bookings,
  getReport: async (bookingId: number) =>
    (await apiRequest<{ report: ServiceReport }>(`/api/bookings/${bookingId}/report`)).report,
  createBooking: async (input: BookingInput) =>
    (await apiRequest<{ booking: CreatedBooking }>('/api/bookings', {
      method: 'POST',
      body: JSON.stringify(input),
    })).booking,
};
