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
import { isActiveBooking, upcomingBookings } from '@/lib/customer-bookings';
import { useBookingClock } from '@/lib/use-booking-clock';
import type { Booking } from '@/lib/coolcare-types';

export default function MyBookingsPage() {
  const [bookings, setBookings] = useState<Booking[] | null>(null);
  const [error, setError] = useState('');
  const now = useBookingClock();

  useEffect(() => {
    coolcareApi.getBookings().then(setBookings).catch((reason) => setError(reason instanceof Error ? reason.message : 'Unable to load bookings.'));
  }, []);

  const active = bookings?.filter(isActiveBooking) ?? [];
  const upcoming = upcomingBookings(active, now);

  return (
    <CoolCareShell>
      <div className="mx-auto max-w-5xl px-5 py-8 sm:px-8 lg:px-10 lg:py-10">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4"><div><p className="text-sm font-semibold text-primary">MY BOOKINGS</p><h1 className="mt-1 text-3xl font-bold tracking-tight">Service requests</h1><p className="mt-2 text-sm text-muted-foreground">Track your active requests. Completed and cancelled bookings are in <Link href="/customer/history" className="font-medium text-primary underline underline-offset-4">Booking History</Link>.</p></div><Button render={<Link href="/customer/book" />}><Plus className="size-4" aria-hidden="true" />New booking</Button></div>
        {!bookings && !error && <PageLoading />}
        {error && <PageError message={`${error} Please refresh this page to retry.`} />}
        {bookings && (
          <Tabs defaultValue="active">
            <TabsList className="mb-6 h-11 w-full justify-start overflow-x-auto rounded-xl p-1 sm:w-fit"><TabsTrigger value="active" className="px-4">Active ({active.length})</TabsTrigger><TabsTrigger value="upcoming" className="px-4">Upcoming ({upcoming.length})</TabsTrigger></TabsList>
            <TabsContent value="active"><BookingList bookings={active} /></TabsContent>
            <TabsContent value="upcoming"><BookingList bookings={upcoming} /></TabsContent>
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
