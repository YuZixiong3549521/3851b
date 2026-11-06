import type { AssistantDraft } from './assistant-api';
import type { BookingOptions, SlotAvailability } from './coolcare-types';

/** Symptoms add to a one-off booking; changing a bundle always needs a choice. */
export function assistantIssueSelection(draft: AssistantDraft, options: BookingOptions, code: 'cleaning' | 'repair' | 'annual-cleaning', note?: string) {
  const service = options.services.find(item => item.code === code);
  const bundle = options.bundles.find(item => item.code === code);
  if (!service && !bundle) throw new Error('This service is currently unavailable. Reload the assistant to check again.');
  const notes = note && !draft.notes.split('\n').includes(note) ? [draft.notes, note].filter(Boolean).join('\n') : draft.notes;
  if (notes.length > 1000) throw new Error('Shorten your technician notes before adding another symptom. Notes can contain up to 1,000 characters.');
  const existing = draft.serviceIds ?? (draft.serviceId ? [draft.serviceId] : []);
  // A cleaning symptom is already covered by the selected annual plan.
  const keepBundle = Boolean(draft.packageId && (code === 'cleaning' || draft.packageId === bundle?.packageId));
  const patch: Partial<AssistantDraft> = keepBundle ? { notes } : {
    serviceId: undefined,
    serviceIds: service ? [...new Set([...(draft.packageId ? [] : existing), service.serviceId])] : [],
    packageId: bundle?.packageId,
    propertyType: undefined,
    notes,
  };
  return {
    patch,
    replacesSelection: !keepBundle && Boolean(draft.packageId || (bundle && existing.length)),
    label: bundle?.name ?? service!.name,
  };
}

/** Never label a partially returned annual schedule as checked and available. */
export function checkedSlotAvailability(dates: string[], result: SlotAvailability) {
  const codes = ['09:00 - 11:00', '11:00 - 13:00', '14:00 - 16:00', '16:00 - 18:00'];
  const available = new Map<string, boolean>(codes.map(code => [code, true]));
  for (const date of new Set(dates)) {
    const matches = result.dates.filter(item => item.date === date);
    if (matches.length !== 1) throw new Error('Some service dates could not be checked. Please retry.');
    for (const code of codes) {
      const slots = matches[0].slots.filter(slot => slot.code === code);
      if (slots.length !== 1 || typeof slots[0].available !== 'boolean') throw new Error('Some service times could not be checked. Please retry.');
      available.set(code, available.get(code)! && slots[0].available);
    }
  }
  return available;
}
