'use client';

import { useCallback, useEffect, useState } from 'react';
import { coolcareApi } from '@/lib/coolcare-api';
import { earliestBookingDate } from '@/lib/booking-schedule';
import { calendarDateValue, parseCalendarDate } from '@/lib/english-date';
import type { BookingAvailability } from '@/lib/coolcare-types';

export type BookingAvailabilityState = {
  blockedDates: string[];
  existingBookings: BookingAvailability['existingBookings'];
  checking: boolean;
  error: string;
  selectedDateBlocked: boolean;
  onMonthChange: (date: Date) => void;
  refresh: () => void;
};

export function useBookingAvailability({ serviceAddress, addressId, selectedDate, excludeBookingId, enabled = true }: {
  serviceAddress?: string; addressId?: number; selectedDate?: string; excludeBookingId?: number; enabled?: boolean;
}): BookingAvailabilityState {
  const [month, setMonth] = useState(() => (selectedDate || earliestBookingDate()).slice(0, 7));
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<Pick<BookingAvailabilityState, 'blockedDates' | 'existingBookings' | 'checking' | 'error' | 'selectedDateBlocked'>>({ blockedDates: [], existingBookings: [], checking: false, error: '', selectedDateBlocked: false });
  const address = serviceAddress?.trim() || undefined;
  const onMonthChange = useCallback((date: Date) => setMonth(calendarDateValue(date).slice(0, 7)), []);
  const refresh = useCallback(() => setRevision(value => value + 1), []);

  useEffect(() => { if (parseCalendarDate(selectedDate ?? '')) setMonth(selectedDate!.slice(0, 7)); }, [selectedDate]);
  useEffect(() => {
    let active = true;
    const empty = { blockedDates: [], existingBookings: [], checking: false, error: '', selectedDateBlocked: false };
    if (!enabled || (!addressId && (!address || address.length < 5))) { setResult(empty); return; }
    setResult({ ...empty, checking: true });
    const timer = window.setTimeout(async () => {
      const start = parseCalendarDate(month + '-01')!;
      const fromDate = new Date(start.getFullYear(), start.getMonth(), -6, 12);
      const toDate = new Date(start.getFullYear(), start.getMonth() + 1, 7, 12);
      const from = calendarDateValue(fromDate), to = calendarDateValue(toDate);
      const input = { serviceAddress: address, addressId, excludeBookingId };
      try {
        const [visible, selected] = await Promise.all([
          coolcareApi.getBookingAvailability({ ...input, from, to }),
          selectedDate && parseCalendarDate(selectedDate) && (selectedDate < from || selectedDate > to)
            ? coolcareApi.getBookingAvailability({ ...input, from: selectedDate, to: selectedDate }) : Promise.resolve(null),
        ]);
        if (!active) return;
        setResult({ blockedDates: [...new Set([...visible.blockedDates, ...(selected?.blockedDates ?? [])])], existingBookings: visible.existingBookings, checking: false, error: '', selectedDateBlocked: Boolean(selectedDate && (selected ?? visible).blockedDates.includes(selectedDate)) });
      } catch (reason) {
        if (active) setResult({ ...empty, error: reason instanceof Error ? reason.message : 'Unable to check existing bookings.' });
      }
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [address, addressId, month, selectedDate, excludeBookingId, enabled, revision]);
  return { ...result, onMonthChange, refresh };
}
