'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { CalendarPlus } from 'lucide-react';
import { BookingCard } from '@/components/booking-card';
import { CoolCareShell } from '@/components/coolcare-shell';
import { EmptyState, PageError, PageLoading } from '@/components/page-state';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { coolcareApi } from '@/lib/coolcare-api';
import type { Booking } from '@/lib/coolcare-types';

export default function MaintenanceHistoryPage() {
  const [bookings, setBookings] = useState<Booking[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    coolcareApi.getBookings().then(setBookings).catch((reason) => setError(reason instanceof Error ? reason.message : 'Unable to load booking history.'));
  }, []);

  const completed = bookings?.filter((booking) => booking.status === 'Completed') ?? [];
  const cancelled = bookings?.filter((booking) => booking.status === 'Cancelled') ?? [];

  return (
    <CoolCareShell>
      <div className="mx-auto max-w-5xl px-5 py-8 sm:px-8 lg:px-10 lg:py-10">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4"><div><p className="text-sm font-semibold text-primary">HISTORY</p><h1 className="mt-1 text-3xl font-bold tracking-tight">Booking history</h1><p className="mt-2 text-sm text-muted-foreground">Review completed visits, technician reports and cancelled requests.</p></div><Button render={<Link href="/customer/book" />} variant="outline"><CalendarPlus className="size-4" aria-hidden="true" />Book another visit</Button></div>
        {!bookings && !error && <PageLoading />}
        {error && <PageError message={`${error} Please refresh this page to retry.`} />}
        {bookings && <Tabs defaultValue="completed">
          <TabsList className="mb-6 h-11 w-full justify-start overflow-x-auto rounded-xl p-1 sm:w-fit"><TabsTrigger value="completed" className="px-4">Completed ({completed.length})</TabsTrigger><TabsTrigger value="cancelled" className="px-4">Cancelled ({cancelled.length})</TabsTrigger></TabsList>
          <TabsContent value="completed">{completed.length === 0 ? <EmptyState title="No completed services yet" description="Completed appointments and their reports will be kept here." /> : <HistoryList bookings={completed} />}</TabsContent>
          <TabsContent value="cancelled">{cancelled.length === 0 ? <EmptyState title="No cancelled bookings" description="Cancelled requests will be kept here for your records." /> : <HistoryList bookings={cancelled} />}</TabsContent>
        </Tabs>}
      </div>
    </CoolCareShell>
  );
}

function HistoryList({ bookings }: { bookings: Booking[] }) {
  return <div className="grid gap-5">{bookings.map((booking) => <BookingCard key={booking.bookingId} booking={booking} history />)}</div>;
}
