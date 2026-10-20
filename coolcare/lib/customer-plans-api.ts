export type AnnualPlanVisit = {
  seriesId: number;
  bookingId: number;
  bookingReference: string;
  visitNumber: number;
  reference: string;
  status: string;
  preferredDate: string;
  timeSlot: string;
  slotStart: string | null;
  slotEnd: string | null;
  totalAmount: number;
  windowStart: string;
  windowEnd: string;
};

export type AnnualPlan = {
  seriesId: number;
  name: string;
  status: 'Active' | 'Completed' | 'Expired' | 'Cancelled';
  propertyType: string | null;
  propertyLabel: string | null;
  addressLine: string;
  postalCode: string | null;
  unitCount: number;
  totalAmount: number;
  includedUnits: number | null;
  baseAnnualPrice: number | null;
  additionalUnitPrice: number | null;
  validFrom: string;
  validUntil: string;
  totalVisits: number;
  completedVisits: number;
  remainingVisits: number;
  unusedClosedVisits: number;
  nextVisit: AnnualPlanVisit | null;
  canRenew: boolean;
  renewalOpenDate: string;
  minimumFirstDate: string;
  existingRenewalSeriesId: number | null;
  renewedFromSeriesId: number | null;
  visits: AnnualPlanVisit[];
};

export type PlanReminder = {
  seriesId: number;
  key: string;
  kind: 'renewal' | 'visit';
  title: string;
  message: string;
  bookingId?: number;
};

export type AnnualPlansResponse = {
  plans: AnnualPlan[];
  reminders: PlanReminder[];
  summary: { activePlans: number; scheduledVisits: number; completedVisits: number; renewalsAvailable: number };
};

export type AnnualPlanRenewal = {
  renewalOfSeriesId: number;
  packageId: number;
  propertyType: string;
  numberOfUnits: number;
  addressId: number | null;
  serviceAddress: string;
  postalCode: string;
  minimumFirstDate: string;
  previousValidUntil: string;
  currentAnnualPrice: number | null;
  pricingNote: string;
};

async function planRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set('Content-Type', 'application/json');
  if (init?.method && init.method !== 'GET') {
    const session = await fetch('/api/session', { cache: 'no-store' });
    if (!session.ok) throw Object.assign(new Error('Sign in again to manage your plan.'), { status: session.status });
    const data = await session.json() as { csrf: string };
    headers.set('X-CSRF-Token', data.csrf);
  }
  const response = await fetch(`/api/customer/plans${path}`, { ...init, headers, cache: 'no-store' });
  const data: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof data === 'object' && data !== null && 'error' in data && typeof data.error === 'string'
      ? data.error : 'Unable to load your plans. Please retry.';
    throw Object.assign(new Error(message), { status: response.status });
  }
  return data as T;
}

export const customerPlansApi = {
  getPlans: () => planRequest<AnnualPlansResponse>(''),
  getRenewal: (seriesId: number) => planRequest<AnnualPlanRenewal | { existingRenewalSeriesId: number }>(`/${seriesId}/renewal`),
  dismissReminder: (seriesId: number, noticeKey: string) => planRequest<{ success: boolean }>(`/${seriesId}/notices/read`, {
    method: 'POST',
    body: JSON.stringify({ noticeKey }),
  }),
};
