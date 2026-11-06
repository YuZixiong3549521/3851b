'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { coolcareApi } from '@/lib/coolcare-api';
import { checkedSlotAvailability } from '@/lib/assistant-guidance';
import type { BookingInput } from '@/lib/coolcare-types';

type AvailabilityState = {
  key: string;
  error: string;
  available: Map<string, boolean>;
};

export function useSlotAvailability(dates: string[], enabled = true, durationMinutes?: number, excludeBookingId?: number, numberOfUnits?: number) {
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt(value => value + 1), []);
  const dateKey = [...new Set(dates.filter(Boolean))]
    .sort((left, right) => left.localeCompare(right))
    .join(',');
  const key = `${dateKey}|${durationMinutes ?? ''}|${excludeBookingId ?? ''}|${numberOfUnits ?? ''}|${attempt}`;
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
      .getSlotAvailability(requested, durationMinutes, excludeBookingId, numberOfUnits)
      .then((result) => {
        if (!active) return;
        const availability = checkedSlotAvailability(requested, result);
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
  }, [key, dateKey, enabled, durationMinutes, excludeBookingId, numberOfUnits]);

  return useMemo(
    () => ({
      retry,
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
    [enabled, key, dateKey, state, retry],
  );
}
