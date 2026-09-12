'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowRight, CalendarDays, ClipboardCheck, Clock3, History, MapPin, Wind } from 'lucide-react';
import { CoolCareShell } from '@/components/coolcare-shell';
import { CustomerAssistant } from '@/components/customer-assistant';
import { AnnualBookingSummary } from '@/components/annual-booking-summary';
import { PageError, PageLoading } from '@/components/page-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { coolcareApi } from '@/lib/coolcare-api';
import { formatDate } from '@/lib/format';
import { nextUpcomingBooking } from '@/lib/customer-bookings';
import type { Booking, CustomerContext } from '@/lib/coolcare-types';

export default function Home() {
  const [context, setContext] = useState<CustomerContext | null>(null);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [history, setHistory] = useState<Booking[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([coolcareApi.getCustomerContext(), coolcareApi.getBookings('upcoming'), coolcareApi.getHistory()])
      .then(([nextContext, nextBookings, nextHistory]) => {
        setContext(nextContext);
        setBookings(nextBookings);
        setHistory(nextHistory);
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : 'Unable to load your dashboard.'));
  }, []);

  const upcoming = nextUpcomingBooking(bookings, new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' }));
  const firstName = context?.customer.fullName.split(' ')[0] ?? 'there';
  const annualBundles = [...new Map(bookings.flatMap(booking => booking.annualBundle ? [[booking.annualBundle.seriesId, booking.annualBundle] as const] : [])).values()];

  return (
    <CoolCareShell>
      <div className="mx-auto max-w-[1320px] px-5 py-8 sm:px-8 lg:px-10 lg:py-10">
        {!context && !error && <PageLoading />}
        {error && <PageError message={`${error} Please refresh this page to retry.`} />}
        {context && (
          <>
            <section className="relative overflow-hidden rounded-[28px] bg-[linear-gradient(115deg,#003f9f_0%,#0066ff_58%,#00a98f_125%)] px-6 py-8 text-white shadow-[0_24px_70px_rgba(0,80,203,0.18)] sm:px-9 sm:py-10">
              <div className="absolute -right-16 -top-24 size-72 rounded-full border-[42px] border-white/10" aria-hidden="true" />
              <div className="absolute -bottom-28 right-40 size-52 rounded-full bg-cyan-300/10 blur-2xl" aria-hidden="true" />
              <div className="relative max-w-2xl">
                <Badge className="mb-5 border-white/20 bg-white/15 text-white hover:bg-white/15">Welcome back, {firstName}</Badge>
                <h1 className="text-3xl font-bold tracking-[-0.025em] sm:text-4xl">Comfort at home, without the guesswork.</h1>
                <p className="mt-3 max-w-xl text-sm leading-6 text-blue-50 sm:text-base">Book maintenance, follow every request, and keep your service history together.</p>
                <Button nativeButton={false} render={<Link href="/customer/book" />} size="lg" className="mt-7 bg-white text-primary shadow-lg hover:bg-blue-50">Book a service<ArrowRight className="size-4" aria-hidden="true" /></Button>
                <CustomerAssistant onBookingCreated={() => {
                  Promise.all([coolcareApi.getCustomerContext(), coolcareApi.getBookings('upcoming')])
                    .then(([nextContext, nextBookings]) => { setContext(nextContext); setBookings(nextBookings); })
                    .catch(() => setError('Your booking was saved, but the dashboard could not refresh. Please reload.'));
                }} />
              </div>
            </section>

            {annualBundles.length > 0 && <section className="mt-8" aria-labelledby="annual-bookings-heading"><div className="mb-4"><p className="text-sm font-semibold text-primary">QUARTERLY CARE</p><h2 id="annual-bookings-heading" className="mt-1 text-2xl font-bold">Your annual cleaning visits</h2></div><div className="grid gap-4 lg:grid-cols-2">{annualBundles.map(bundle => <AnnualBookingSummary key={bundle.seriesId} saved={bundle} totalAmount={bundle.totalAmount} compact />)}</div></section>}

            <section aria-labelledby="overview-heading" className="mt-8">
              <div className="mb-4"><p className="text-sm font-semibold text-primary">AT A GLANCE</p><h2 id="overview-heading" className="mt-1 text-2xl font-bold tracking-tight">Your home comfort</h2></div>
              <div className="grid gap-4 sm:grid-cols-3">
                <MetricCard icon={Wind} label="Registered units" value={String(context.units.length)} detail={context.units.map((unit) => unit.brand).filter(Boolean).join(' · ') || 'No units'} />
                <MetricCard icon={CalendarDays} label="Upcoming requests" value={String(bookings.length)} detail={bookings.length ? 'Active service requests' : 'Nothing scheduled'} />
                <MetricCard icon={History} label="Completed services" value={String(history.length)} detail={history[0] ? `Last visit ${formatDate(history[0].preferredDate, { day: 'numeric', month: 'short' })}` : 'No previous visits'} />
              </div>
            </section>

            <section className="mt-8 grid gap-6 xl:grid-cols-[1.5fr_0.8fr]">
              <Card className="border-border/80 shadow-sm">
                <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
                  <div><p className="text-sm font-semibold text-primary">{upcoming ? 'UPCOMING' : 'READY WHEN YOU ARE'}</p><CardTitle className="mt-1 text-xl">{upcoming?.annualBundle ? upcoming.annualBundle.name + ' · Visit ' + upcoming.annualBundle.visitNumber + ' of 4' : upcoming?.serviceName ?? 'No active booking'}</CardTitle></div>
                  {upcoming && <StatusBadge status={upcoming.status} />}
                </CardHeader>
                <CardContent>
                  {upcoming ? (
                    <>
                      <div className="grid gap-4 rounded-2xl bg-muted/65 p-5 sm:grid-cols-3">
                        <Detail icon={CalendarDays} label="Date" value={formatDate(upcoming.preferredDate)} />
                        <Detail icon={Clock3} label="Time" value={upcoming.timeSlot} />
                        <Detail icon={MapPin} label="Address" value={`${upcoming.addressLine}${upcoming.postalCode ? ` · ${upcoming.postalCode}` : ''}`} />
                      </div>
                      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
                        <div><p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Booking reference</p><p className="mt-1 font-mono text-sm font-semibold">{upcoming.bookingReference}</p></div>
                        <Button nativeButton={false} render={<Link href="/customer/bookings" />} variant="outline">View booking</Button>
                      </div>
                    </>
                  ) : (
                    <div className="rounded-2xl bg-muted/65 p-5 text-sm text-muted-foreground">Create a service request and it will appear here after it is saved.</div>
                  )}
                </CardContent>
              </Card>

              <Card className="border-border/80 bg-[#f7fffd] shadow-sm">
                <CardHeader><div className="mb-1 grid size-11 place-items-center rounded-2xl bg-secondary/15 text-secondary"><ClipboardCheck className="size-5" aria-hidden="true" /></div><CardTitle className="text-xl">Maintenance history</CardTitle></CardHeader>
                <CardContent><p className="text-sm leading-6 text-muted-foreground">{history[0] ? `Your latest visit was completed on ${formatDate(history[0].preferredDate)}.` : 'Completed maintenance visits will be kept here.'}</p><Button nativeButton={false} render={<Link href="/customer/history" />} variant="link" className="mt-4 h-auto p-0 text-secondary">View service history<ArrowRight className="size-4" aria-hidden="true" /></Button></CardContent>
              </Card>
            </section>
          </>
        )}
      </div>
    </CoolCareShell>
  );
}

function MetricCard({ icon: Icon, label, value, detail }: { icon: typeof Wind; label: string; value: string; detail: string }) {
  return <Card className="border-border/80 shadow-sm"><CardContent className="flex items-center gap-4 p-5 sm:p-6"><div className="grid size-12 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary"><Icon className="size-5" aria-hidden="true" /></div><div><p className="text-sm font-medium text-muted-foreground">{label}</p><p className="mt-0.5 text-2xl font-bold">{value}</p><p className="text-xs text-muted-foreground">{detail}</p></div></CardContent></Card>;
}

function Detail({ icon: Icon, label, value }: { icon: typeof CalendarDays; label: string; value: string }) {
  return <div className="flex gap-3"><Icon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" /><div><p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</p><p className="mt-1 text-sm font-semibold">{value}</p></div></div>;
}

function StatusBadge({ status }: { status: string }) {
  const colour = status === 'Submitted' ? 'bg-amber-100 text-amber-800' : status === 'Completed' ? 'bg-emerald-100 text-emerald-800' : 'bg-blue-100 text-blue-800';
  return <Badge className={colour}>{status}</Badge>;
}
