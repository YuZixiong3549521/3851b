'use client';

import Link from 'next/link';
import { ArrowRight, CalendarDays, Clock3, History, MapPin, RefreshCw } from 'lucide-react';
import { CoolCareShell } from '@/components/coolcare-shell';
import { AnnualBookingSummary } from '@/components/annual-booking-summary';
import { BookingStatus, bookingStatusDescription } from '@/components/booking-status';
import { PageError, PageLoading } from '@/components/page-state';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { coolcareApi } from '@/lib/coolcare-api';
import { formatDate, formatTimeSlot } from '@/lib/format';
import { upcomingBookings, isActiveBooking } from '@/lib/customer-bookings';
import { useBookingClock } from '@/lib/use-booking-clock';
import { useCustomerResource } from '@/lib/use-customer-resource';

async function loadDashboard() {
  const [context, bookings] = await Promise.all([coolcareApi.getCustomerContext(), coolcareApi.getBookings()]);
  return { context, bookings };
}

export default function Home() {
  const { data, error, refreshing, refresh } = useCustomerResource(loadDashboard);
  const now = useBookingClock();
  const bookings = data?.bookings ?? [];
  const futureBookings = upcomingBookings(bookings, now);
  const upcoming = futureBookings[0];
  const history = bookings.filter(booking => booking.status === 'Completed').sort((a, b) => b.preferredDate.localeCompare(a.preferredDate));
  const annualBundles = [...new Map(bookings.flatMap(booking => booking.annualBundle ? [[booking.annualBundle.seriesId, booking.annualBundle] as const] : [])).values()].filter(bundle => bundle.visits.some(isActiveBooking));
  return <CoolCareShell><div className="mx-auto max-w-[1320px] px-5 py-6 sm:px-8 lg:px-10 lg:py-8">
    {!data && !error && <PageLoading />}
    {error && <div className="mb-5 space-y-2"><PageError message={error} /><Button variant="outline" onClick={() => void refresh()} disabled={refreshing}>Retry</Button></div>}
    {data && <>
      <section className="rounded-3xl bg-[linear-gradient(115deg,#003f9f_0%,#0066ff_75%,#00a98f_125%)] px-5 py-5 text-white shadow-sm sm:px-7">
        <p className="text-sm text-blue-100">Welcome back, {data.context.customer.fullName.split(' ')[0]}</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">Your service at a glance</h1>
        <div className="mt-4 flex flex-wrap items-center gap-3"><Button nativeButton={false} render={<Link href="/customer/book" />} className="bg-white text-primary hover:bg-blue-50">Book a service<ArrowRight className="size-4" /></Button></div>
      </section>

      <section aria-label="Next appointment" className="mt-6">
        <Card className="border-primary/20 shadow-sm">
          <CardHeader className="flex-row items-start justify-between gap-4 space-y-0"><div><p className="text-sm font-semibold text-primary">UPCOMING</p><CardTitle className="mt-2 text-xl">{upcoming?.annualBundle ? `${upcoming.annualBundle.name} · Visit ${upcoming.annualBundle.visitNumber} of 4` : upcoming?.serviceName ?? 'No upcoming booking'}</CardTitle></div>{upcoming && <BookingStatus status={upcoming.status} />}</CardHeader>
          <CardContent>{upcoming ? <>
            <div className="grid gap-4 rounded-2xl bg-muted/65 p-4 sm:grid-cols-3"><Detail icon={CalendarDays} label="Date" value={formatDate(upcoming.preferredDate)} /><Detail icon={Clock3} label="Preferred time" value={formatTimeSlot(upcoming.timeSlot)} /><Detail icon={MapPin} label="Address" value={`${upcoming.addressLine}${upcoming.postalCode ? ` · ${upcoming.postalCode}` : ''}`} /></div>
            <p className="mt-4 text-sm text-muted-foreground">{bookingStatusDescription(upcoming.status)}</p>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3"><p className="font-mono text-sm font-semibold">{upcoming.bookingReference}</p><Button nativeButton={false} render={<Link href={`/customer/bookings/${upcoming.bookingId}`} />} variant="outline">View booking</Button></div>
          </> : <div className="space-y-3"><p className="text-sm text-muted-foreground">Choose cleaning, repair or four quarterly visits for your home.</p><Button nativeButton={false} render={<Link href="/customer/book" />}>Book your next visit</Button></div>}</CardContent>
        </Card>
      </section>

      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <MetricCard icon={MapPin} label="Saved addresses" value={data.context.addresses.length} detail="Manage your service locations" href="/customer/addresses" />
        <MetricCard icon={CalendarDays} label="Upcoming visits" value={futureBookings.length} detail="See dates and manage requests" href="/customer/bookings" />
        <MetricCard icon={History} label="Completed services" value={history.length} detail={history[0] ? `Last visit ${formatDate(history[0].preferredDate)}` : 'Your reports will appear here'} href="/customer/history" />
      </div>

      {annualBundles.length > 0 && <section className="mt-7" aria-labelledby="annual-bookings-heading"><h2 id="annual-bookings-heading" className="mb-4 text-xl font-bold">Your annual cleaning plan</h2><div className="grid gap-4 lg:grid-cols-2">{annualBundles.map(bundle => <AnnualBookingSummary key={bundle.seriesId} saved={bundle} totalAmount={bundle.totalAmount} compact collapsible />)}</div></section>}
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground"><p>Booking updates refresh when you return to this page.</p><Button variant="ghost" size="sm" onClick={() => void refresh()} disabled={refreshing}><RefreshCw className={`size-3.5 ${refreshing ? 'animate-spin' : ''}`} />{refreshing ? 'Refreshing' : 'Refresh'}</Button></div>
    </>}
  </div></CoolCareShell>;
}

function MetricCard({ icon: Icon, label, value, detail, href }: { icon: typeof MapPin; label: string; value: number; detail: string; href: string }) {
  return <Link href={href} className="rounded-2xl border border-border/80 bg-card p-4 shadow-sm transition-colors hover:border-primary/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"><div className="flex items-center gap-3"><div className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><Icon className="size-5" /></div><div><p className="text-sm text-muted-foreground">{label}</p><p className="text-xl font-bold">{value}</p></div></div><p className="mt-3 text-xs text-muted-foreground">{detail}</p></Link>;
}
function Detail({ icon: Icon, label, value }: { icon: typeof CalendarDays; label: string; value: string }) {
  return <div className="flex min-w-0 gap-3"><Icon className="mt-0.5 size-4 shrink-0 text-primary" /><div className="min-w-0"><p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</p><p className="mt-1 break-words text-sm font-semibold">{value}</p></div></div>;
}
