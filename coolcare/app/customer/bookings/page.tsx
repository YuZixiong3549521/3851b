'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ChevronDown, ChevronUp, Plus, RefreshCw } from 'lucide-react';
import { BookingCard } from '@/components/booking-card';
import { CoolCareShell } from '@/components/coolcare-shell';
import { EmptyState, PageError, PageLoading } from '@/components/page-state';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { coolcareApi } from '@/lib/coolcare-api';
import { groupCustomerBookings, isActiveBooking, upcomingBookings } from '@/lib/customer-bookings';
import { useBookingClock } from '@/lib/use-booking-clock';
import { useCustomerResource } from '@/lib/use-customer-resource';
import { formatMoney } from '@/lib/format';
import type { Booking } from '@/lib/coolcare-types';

export default function MyBookingsPage() {
  const { data: bookings, error, refreshing, refresh } = useCustomerResource(coolcareApi.getBookings);
  const now = useBookingClock();
  const active = bookings?.filter(isActiveBooking) ?? [];
  const upcoming = upcomingBookings(active, now);
  return <CoolCareShell><div className="mx-auto max-w-5xl px-5 py-8 sm:px-8 lg:px-10 lg:py-10">
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4"><div><p className="text-sm font-semibold text-primary">MY BOOKINGS</p><h1 className="mt-1 text-3xl font-bold tracking-tight">Service requests</h1><p className="mt-2 text-sm text-muted-foreground">Manage active requests, ordered by service date. Completed, rejected and cancelled visits are in <Link href="/customer/history" className="font-medium text-primary underline underline-offset-4">Booking History</Link>.</p></div><Button nativeButton={false} render={<Link href="/customer/book" />}><Plus className="size-4" />New booking</Button></div>
    {!bookings && !error && <PageLoading />}
    {error && <div className="mb-4"><PageError message={error} /></div>}
    <div className="mb-4 flex justify-end"><Button variant="ghost" size="sm" onClick={() => void refresh()} disabled={refreshing}><RefreshCw className={`size-4 ${refreshing ? 'animate-spin' : ''}`} />{refreshing ? 'Refreshing' : 'Refresh'}</Button></div>
    {bookings && <Tabs defaultValue="active"><TabsList className="mb-6 h-11 w-full justify-start overflow-x-auto rounded-xl p-1 sm:w-fit"><TabsTrigger value="active" className="px-4">Active ({active.length})</TabsTrigger><TabsTrigger value="upcoming" className="px-4">Upcoming ({upcoming.length})</TabsTrigger></TabsList><TabsContent value="active"><BookingList bookings={active} /></TabsContent><TabsContent value="upcoming"><BookingList bookings={upcoming} /></TabsContent></Tabs>}
  </div></CoolCareShell>;
}
function BookingList({ bookings }: { bookings: Booking[] }) {
  if (!bookings.length) return <EmptyState title="No bookings in this view" description="Book a service to plan your next visit." />;
  return <div className="grid gap-5">{groupCustomerBookings(bookings).map(group => group.annual ? <AnnualBookingGroup key={group.key} bookings={group.bookings} /> : <BookingCard key={group.key} booking={group.bookings[0]} />)}</div>;
}
function AnnualBookingGroup({ bookings }: { bookings: Booking[] }) {
  const [expanded, setExpanded] = useState(false);
  const first = bookings[0];
  const bundle = first.annualBundle!;
  const completed = bundle.visits.filter(visit => visit.status === 'Completed').length;
  const remaining = bundle.visits.filter(isActiveBooking).length;
  return <section aria-label={`${bundle.name} at ${first.addressLine}`} className="rounded-3xl border border-primary/20 bg-primary/5 p-3 sm:p-4">
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3 px-1"><div><h2 className="text-lg font-bold">{bundle.name}</h2><p className="mt-1 text-sm text-muted-foreground">{completed} of 4 completed · {remaining} remaining · {formatMoney(bundle.totalAmount)} for the year</p><p className="mt-1 text-sm text-muted-foreground">{first.addressLine}</p></div></div>
    <BookingCard booking={first} />
    {bookings.length > 1 && <><Button className="mt-3 w-full justify-between" variant="ghost" aria-expanded={expanded} aria-controls={`annual-group-${bundle.seriesId}`} onClick={() => setExpanded(!expanded)}>{expanded ? 'Hide later visits' : `Show ${bookings.length - 1} later ${bookings.length === 2 ? 'visit' : 'visits'}`}{expanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}</Button><div id={`annual-group-${bundle.seriesId}`} hidden={!expanded} className="mt-3 space-y-4">{bookings.slice(1).map(booking => <BookingCard key={booking.bookingId} booking={booking} />)}</div></>}
  </section>;
}
