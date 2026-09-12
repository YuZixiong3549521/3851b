'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { BookingCard } from '@/components/booking-card';
import { CoolCareShell } from '@/components/coolcare-shell';
import { EmptyState, PageError, PageLoading } from '@/components/page-state';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { coolcareApi } from '@/lib/coolcare-api';
import type { Booking } from '@/lib/coolcare-types';

export default function MyBookingsPage() {
  const [bookings, setBookings] = useState<Booking[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    coolcareApi.getBookings().then(setBookings).catch((reason) => setError(reason instanceof Error ? reason.message : 'Unable to load bookings.'));
  }, []);

  const upcoming = bookings?.filter((booking) => !['Completed', 'Cancelled'].includes(booking.status)) ?? [];
  const completed = bookings?.filter((booking) => booking.status === 'Completed') ?? [];

  return (
    <CoolCareShell>
      <div className="mx-auto max-w-5xl px-5 py-8 sm:px-8 lg:px-10 lg:py-10">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4"><div><p className="text-sm font-semibold text-primary">MY BOOKINGS</p><h1 className="mt-1 text-3xl font-bold tracking-tight">Service requests</h1><p className="mt-2 text-sm text-muted-foreground">Track every request from submission to completion.</p></div><Button render={<Link href="/customer/book" />}><Plus className="size-4" aria-hidden="true" />New booking</Button></div>
        {!bookings && !error && <PageLoading />}
        {error && <PageError message={`${error} Please refresh this page to retry.`} />}
        {bookings && (
          <Tabs defaultValue="all">
            <TabsList className="mb-6 h-11 w-full justify-start overflow-x-auto rounded-xl p-1 sm:w-fit"><TabsTrigger value="all" className="px-4">All ({bookings.length})</TabsTrigger><TabsTrigger value="upcoming" className="px-4">Upcoming ({upcoming.length})</TabsTrigger><TabsTrigger value="completed" className="px-4">Completed ({completed.length})</TabsTrigger></TabsList>
            <TabsContent value="all"><BookingList bookings={bookings} /></TabsContent>
            <TabsContent value="upcoming"><BookingList bookings={upcoming} /></TabsContent>
            <TabsContent value="completed"><BookingList bookings={completed} /></TabsContent>
          </Tabs>
        )}
      </div>
    </CoolCareShell>
  );
}

function BookingList({ bookings }: { bookings: Booking[] }) {
  if (bookings.length === 0) return <EmptyState title="No bookings in this view" description="Create a service request and it will appear here after it is saved." />;
  return <div className="grid gap-5">{bookings.map((booking) => <BookingCard key={booking.bookingId} booking={booking} />)}</div>;
}
