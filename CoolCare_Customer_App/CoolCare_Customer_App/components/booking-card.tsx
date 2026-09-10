import Link from 'next/link';
import { CalendarDays, Clock3, MapPin, UserRound, Wind } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDate, formatMoney } from '@/lib/format';
import type { Booking } from '@/lib/coolcare-types';

const statusStyle: Record<string, string> = {
  Submitted: 'bg-amber-100 text-amber-800',
  Confirmed: 'bg-blue-100 text-blue-800',
  Assigned: 'bg-indigo-100 text-indigo-800',
  'On The Way': 'bg-violet-100 text-violet-800',
  'In Progress': 'bg-cyan-100 text-cyan-800',
  Completed: 'bg-emerald-100 text-emerald-800',
  Cancelled: 'bg-slate-200 text-slate-700',
};

export function BookingCard({ booking, history = false }: { booking: Booking; history?: boolean }) {
  return (
    <Card className="overflow-hidden border-border/80 shadow-sm">
      <CardHeader className="border-b border-border/70 bg-muted/30 sm:flex-row sm:items-start sm:justify-between sm:space-y-0">
        <div><p className="font-mono text-xs font-semibold text-muted-foreground">{booking.bookingReference}</p><CardTitle className="mt-1.5 text-xl">{booking.serviceName}</CardTitle></div>
        <Badge className={`${statusStyle[booking.status] ?? 'bg-slate-100 text-slate-700'} w-fit hover:opacity-100`}>{booking.status}</Badge>
      </CardHeader>
      <CardContent className="p-5 sm:p-6">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Info icon={CalendarDays} label="Service date" value={formatDate(booking.preferredDate)} />
          <Info icon={Clock3} label="Time" value={booking.timeSlot} />
          <Info icon={MapPin} label="Address" value={`${booking.addressLine}${booking.postalCode ? `, ${booking.postalCode}` : ''}`} />
          <Info icon={Wind} label="Units" value={booking.units.map((unit) => `${unit.brand} · ${unit.location}`).join(', ') || 'No unit recorded'} />
        </div>
        {booking.technicianName && <div className="mt-5 rounded-xl bg-secondary/8 p-4"><Info icon={UserRound} label="Assigned technician" value={booking.technicianName} /></div>}
        <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-t border-border/70 pt-5">
          <div><p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{history ? 'Final amount' : 'Estimated total'}</p><p className="mt-1 text-lg font-bold">{formatMoney(booking.totalAmount)}</p></div>
          {history && booking.reportId ? <Button render={<Link href={`/history/${booking.bookingId}`} />}>View service report</Button> : !history ? <p className="text-sm text-muted-foreground">Updates will appear here as the request progresses.</p> : null}
        </div>
      </CardContent>
    </Card>
  );
}

function Info({ icon: Icon, label, value }: { icon: typeof CalendarDays; label: string; value: string }) {
  return <div className="flex gap-3"><Icon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" /><div><p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</p><p className="mt-1 text-sm font-medium leading-5">{value}</p></div></div>;
}
