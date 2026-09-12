import { apiFetch } from '@/components/public-site/api';
import { assertBookingConfirmation } from '@/lib/annual-booking';
import type { AnnualBundle, EmailNotification } from '@/lib/coolcare-types';

export type AssistantStep = 'service' | 'address' | 'schedule' | 'review';
export type AssistantDraft = {
  step: AssistantStep;
  serviceId?: number;
  packageId?: number;
  numberOfUnits: number;
  serviceAddress: string;
  phone: string;
  preferredDate: string;
  timeWindow: string;
  notes: string;
};
export type AssistantQuote = {
  quoteId: string;
  currency: 'SGD';
  serviceName: string;
  annual: boolean;
  totalAmount: number;
  visits: Array<{ visitNumber: number; preferredDate: string; totalAmount: number }>;
  reviewedAt: string;
};
export type AssistantReceipt = {
  id: number;
  bookingId?: number;
  bookingReference?: string;
  status: string;
  totalAmount: number;
  emailNotification?: EmailNotification;
  annualBundle?: AnnualBundle | null;
};
export type AssistantState = {
  draftId: string;
  userId: number;
  revision: number;
  status: 'editing' | 'reviewed' | 'completed';
  requestId: string;
  draft: AssistantDraft;
  quote: AssistantQuote | null;
  booking: AssistantReceipt | null;
  updatedAt: string;
};
export type AssistantConflict = { visitNumber: number; preferredDate: string; message: string };
export type AssistantError = Error & {
  status?: number;
  code?: string;
  state?: AssistantState;
  details?: { conflicts?: AssistantConflict[]; fieldErrors?: Record<string, string | string[]> };
};
export const emptyAssistantDraft: AssistantDraft = { step: 'service', numberOfUnits: 2, serviceAddress: '', phone: '', preferredDate: '', timeWindow: '09:00 AM - 11:00 AM', notes: '' };

export function sameAssistantDraft(a: AssistantDraft, b: AssistantDraft) {
  return ['step', 'serviceId', 'packageId', 'numberOfUnits', 'serviceAddress', 'phone', 'preferredDate', 'timeWindow', 'notes'].every(key => (a[key as keyof AssistantDraft] ?? '') === (b[key as keyof AssistantDraft] ?? ''));
}

export function verifyAssistantState(state: AssistantState | null, expectedUserId: number) {
  if (!state) return;
  if (state.userId !== expectedUserId) throw Object.assign(new Error('The signed-in account changed. Sign in again to reload your own saved draft.'), { status: 401 });
  if (!state.draftId || !Number.isInteger(state.revision) || !state.draft) throw new Error('The saved draft response could not be verified. Reload your saved draft before continuing.');
  if (state.status === 'completed') assertBookingConfirmation(state.booking, Boolean(state.draft.packageId));
}

async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await apiFetch('/api/customer/assistant/' + path, body === undefined ? {} : {
    method: path === 'draft' ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(response.status === 401 || response.status === 403 ? 'Your session is no longer available. Sign in again to continue your saved booking.' : data.error || data.message || 'Unable to complete the request. Please retry.'), {
    status: response.status, code: data.code, state: data.state, details: data.details,
  });
  return data as T;
}

export const assistantApi = {
  load: async () => (await request<{ state: AssistantState | null }>('draft')).state,
  save: async (input: { expectedUserId: number; draftId: string | null; revision: number; draft: AssistantDraft }) => (await request<{ state: AssistantState }>('draft', input)).state,
  review: async (input: { expectedUserId: number; draftId: string; revision: number }) => (await request<{ state: AssistantState }>('review', input)).state,
  confirm: async (input: { expectedUserId: number; draftId: string; revision: number; quoteId: string }) => (await request<{ state: AssistantState; booking: AssistantReceipt }>('confirm', input)).state,
  startNew: async (input: { expectedUserId: number; draftId: string; revision: number }) => (await request<{ state: AssistantState }>('new', input)).state,
};
