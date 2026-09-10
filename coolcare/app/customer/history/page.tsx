'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { CalendarPlus } from 'lucide-react';
import { BookingCard } from '@/components/booking-card';
import { CoolCareShell } from '@/components/coolcare-shell';
import { EmptyState, PageError, PageLoading } from '@/components/page-state';
import { Button } from '@/components/ui/button';
import { coolcareApi } from '@/lib/coolcare-api';
import type { Booking } from '@/lib/coolcare-types';

export default function MaintenanceHistoryPage() {
  const [bookings, setBookings] = useState<Booking[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    coolcareApi.getHistory().then(setBookings).catch((reason) => setError(reason instanceof Error ? reason.message : 'Unable to load maintenance history.'));
  }, []);

  return (
    <CoolCareShell>
      <div className="mx-auto max-w-5xl px-5 py-8 sm:px-8 lg:px-10 lg:py-10">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4"><div><p className="text-sm font-semibold text-primary">MAINTENANCE HISTORY</p><h1 className="mt-1 text-3xl font-bold tracking-tight">Completed service visits</h1><p className="mt-2 text-sm text-muted-foreground">Review previous maintenance details and technician reports.</p></div><Button render={<Link href="/customer/book" />} variant="outline"><CalendarPlus className="size-4" aria-hidden="true" />Book another visit</Button></div>
        {!bookings && !error && <PageLoading />}
        {error && <PageError message={`${error} Start the database and customer API, then refresh this page.`} />}
        {bookings && bookings.length === 0 && <EmptyState title="No completed services yet" description="Completed appointments and their reports will be kept here." />}
        {bookings && bookings.length > 0 && <div className="grid gap-5">{bookings.map((booking) => <BookingCard key={booking.bookingId} booking={booking} history />)}</div>}
      </div>
    </CoolCareShell>
  );
}
