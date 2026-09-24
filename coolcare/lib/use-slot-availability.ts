'use client';

import { useEffect, useMemo, useState } from 'react';
import { coolcareApi } from '@/lib/coolcare-api';
import type { BookingInput } from '@/lib/coolcare-types';

type AvailabilityState = {
  key: string;
  error: string;
  available: Map<string, boolean>;
};

export function useSlotAvailability(dates: string[], enabled = true, durationMinutes?: number, excludeBookingId?: number) {
  const dateKey = [...new Set(dates.filter(Boolean))]
    .sort((left, right) => left.localeCompare(right))
    .join(',');
  const key = `${dateKey}|${durationMinutes ?? ''}|${excludeBookingId ?? ''}`;
  const [state, setState] = useState<AvailabilityState>({
    key: '',
    error: '',
    available: new Map(),
  });

  useEffect(() => {
    let active = true;
    const requested = dateKey ? dateKey.split(',') : [];
    if (!enabled || !requested.length) return;

    coolcareApi
      .getSlotAvailability(requested, durationMinutes, excludeBookingId)
      .then((result) => {
        if (!active) return;
        const availability = new Map<string, boolean>();
        for (const date of result.dates) {
          for (const slot of date.slots) {
            availability.set(
              slot.code,
              (availability.get(slot.code) ?? true) && slot.available,
            );
          }
        }
        setState({ key, error: '', available: availability });
      })
      .catch((reason) => {
        if (!active) return;
        setState({
          key,
          error:
            reason instanceof Error
              ? reason.message
              : 'Unable to check service times.',
          available: new Map(),
        });
      });
    return () => {
      active = false;
    };
  }, [key, dateKey, enabled, durationMinutes, excludeBookingId]);

  return useMemo(
    () => ({
      loading: enabled && Boolean(dateKey) && state.key !== key,
      error: enabled && state.key === key ? state.error : '',
      isAvailable: (slot: BookingInput['timeSlot']) =>
        !enabled || state.key !== key || state.error
          ? true
          : state.available.get(slot) !== false,
      checked:
        enabled &&
        state.key === key &&
        !state.error &&
        state.available.size > 0,
    }),
    [enabled, key, dateKey, state],
  );
}
