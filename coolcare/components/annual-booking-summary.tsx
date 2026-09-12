'use client';

import { annualVisitAmounts, annualVisitDates } from '@/lib/annual-booking';
import { formatDate, formatMoney } from '@/lib/format';
import type { AnnualBundle } from '@/lib/coolcare-types';

export function AnnualBookingSummary({ firstDate, timeSlot, totalAmount, saved, compact = false }: {
  firstDate?: string;
  timeSlot?: string;
  totalAmount: number;
  saved?: AnnualBundle | null;
  compact?: boolean;
}) {
  const amounts = annualVisitAmounts(totalAmount);
  const visits = saved?.visits ?? annualVisitDates(firstDate ?? '').map((preferredDate, index) => ({ bookingId: undefined, visitNumber: index + 1, preferredDate, timeSlot: timeSlot ?? '', totalAmount: amounts[index], status: 'Preferred date' }));
  return <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4 text-left text-sm">
    <p className="font-semibold">{saved ? saved.name : 'Annual Cleaning Bundle'}</p>
    <div className="mt-2 flex flex-wrap items-baseline justify-between gap-2"><span className="text-muted-foreground">All four visits</span><strong className="text-lg text-primary">{formatMoney(saved?.totalAmount ?? totalAmount)}</strong></div>
    <p className="mt-1 text-xs leading-5 text-muted-foreground">Pay for each visit after service. Additional work requires your approval of a separate quote.</p>
    {saved && <p className="mt-3 font-medium">{saved.visits.length} booking requests saved</p>}
    {visits.length > 0 ? <ol className="mt-3 space-y-2">{visits.map(visit => <li key={visit.visitNumber} className="rounded-xl border border-primary/10 bg-background p-3"><div className="flex flex-wrap items-center justify-between gap-2"><span className="font-semibold">Visit {visit.visitNumber} of 4{visit.bookingId ? ' · #' + visit.bookingId : ''}</span><span className="font-semibold">{formatMoney(visit.totalAmount)}</span></div><p className="mt-1">{formatDate(visit.preferredDate)}{!compact && visit.timeSlot ? ' · ' + visit.timeSlot : ''}</p>{saved && <p className="mt-1 text-xs text-muted-foreground">{visit.status}</p>}</li>)}</ol> : <p className="mt-3 text-xs text-muted-foreground">Choose the first preferred date to preview all four quarterly visits.</p>}
    {!compact && <p className="mt-3 text-xs leading-5 text-muted-foreground">Dates and time windows are requests, subject to availability. The service team will confirm each visit; submitting does not assign a technician or take payment.</p>}
  </div>;
}
