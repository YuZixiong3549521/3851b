'use client';

import Link from 'next/link';
import { useId, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { annualVisitAmounts, annualVisitDates } from '@/lib/annual-booking';
import { upcomingBookings } from '@/lib/customer-bookings';
import { useBookingClock } from '@/lib/use-booking-clock';
import { formatDate, formatMoney, formatTimeSlot } from '@/lib/format';
import { bookingStatusLabel } from '@/components/booking-status';
import { Button } from '@/components/ui/button';
import type { AnnualBundle } from '@/lib/coolcare-types';

export function AnnualBookingSummary({ firstDate, timeSlot, totalAmount, saved, compact = false, collapsible = false }: {
  firstDate?: string; timeSlot?: string; totalAmount: number; saved?: AnnualBundle | null;
  compact?: boolean; collapsible?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  const now = useBookingClock();
  const amounts = annualVisitAmounts(totalAmount);
  const visits = saved?.visits ?? annualVisitDates(firstDate ?? '').map((preferredDate, index) => ({ bookingId: undefined, visitNumber: index + 1, preferredDate, timeSlot: timeSlot ?? '', totalAmount: amounts[index], status: 'Preferred date' }));
  const completed = visits.filter(visit => visit.status === 'Completed').length;
  const cancelled = visits.filter(visit => visit.status === 'Cancelled').length;
  const rejected = visits.filter(visit => visit.status === 'Rejected').length;
  const next = saved ? upcomingBookings(saved.visits, now)[0] : undefined;
  const showDetails = !collapsible || expanded;
  return <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4 text-left text-sm">
    <p className="font-semibold">{saved ? saved.name : 'Annual Cleaning Bundle'}</p>
    <div className="mt-2 flex flex-wrap items-baseline justify-between gap-2"><span className="text-muted-foreground">Four quarterly visits</span><strong className="text-lg text-primary">{formatMoney(saved?.totalAmount ?? totalAmount)}</strong></div>
    <p className="mt-1 text-xs leading-5 text-muted-foreground">Pay after each visit. Additional work is quoted for your approval.</p>
    {saved && <div className="mt-4 space-y-2">
      <p className="font-medium">{completed} of {visits.length} completed · {visits.length - completed - cancelled - rejected} remaining{rejected ? ` · ${rejected} rejected` : ''}{cancelled ? ` · ${cancelled} cancelled` : ''}</p>
      <div role="progressbar" aria-label="Completed annual cleaning visits" aria-valuemin={0} aria-valuemax={visits.length} aria-valuenow={completed} className="h-1.5 overflow-hidden rounded-full bg-primary/10"><div className="h-full rounded-full bg-primary" style={{ width: `${visits.length ? completed / visits.length * 100 : 0}%` }} /></div>
      <p className="text-muted-foreground">{next ? `Next visit: ${formatDate(next.preferredDate)}` : 'No future visit is currently scheduled.'}</p>
    </div>}
    {collapsible && visits.length > 0 && <Button type="button" variant="ghost" className="mt-3 h-auto w-full justify-between whitespace-normal px-0 text-primary" aria-expanded={expanded} aria-controls={detailsId} onClick={() => setExpanded(!expanded)}>{expanded ? 'Hide visit details' : `Show all ${visits.length} visits`}{expanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}</Button>}
    {visits.length > 0 ? <ol id={detailsId} hidden={!showDetails} className="mt-3 space-y-2">{visits.map(visit => <li key={visit.visitNumber} className="rounded-xl border border-primary/10 bg-background p-3">
      <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-semibold">Visit {visit.visitNumber} of {visits.length}</span><span className="font-semibold">{formatMoney(visit.totalAmount)}</span></div>
      <p className="mt-1">{formatDate(visit.preferredDate)}{!compact && visit.timeSlot ? ' · ' + formatTimeSlot(visit.timeSlot) : ''}</p>
      {saved && <div className="mt-2 flex flex-wrap items-center justify-between gap-2"><p className="text-xs text-muted-foreground">{bookingStatusLabel(visit.status)}</p>{visit.bookingId && <Link href={`/customer/bookings/${visit.bookingId}`} className="font-medium text-primary underline underline-offset-4" aria-label={`View visit ${visit.visitNumber} details`}>View details</Link>}</div>}
    </li>)}</ol> : <p className="mt-3 text-xs text-muted-foreground">Choose a first visit date to preview all four visits.</p>}
    {!compact && showDetails && <p className="mt-3 text-xs leading-5 text-muted-foreground">Later quarterly visits falling on a weekend move to Monday. Dates and time windows are requests, subject to confirmation. No payment is taken when booking.</p>}
  </div>;
}
