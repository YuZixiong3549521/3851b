import { Badge } from '@/components/ui/badge';

const colours: Record<string, string> = {
  Submitted: 'bg-amber-100 text-amber-900', Confirmed: 'bg-blue-100 text-blue-900',
  Assigned: 'bg-indigo-100 text-indigo-900', 'On The Way': 'bg-violet-100 text-violet-900',
  'In Progress': 'bg-cyan-100 text-cyan-900', Completed: 'bg-emerald-100 text-emerald-900',
  Cancelled: 'bg-slate-200 text-slate-800',
};
export function bookingStatusLabel(status: string) {
  return status === 'Submitted' ? 'Awaiting confirmation' : status;
}
export function bookingStatusDescription(status: string) {
  const descriptions: Record<string, string> = {
    Submitted: 'Your preferred date and time are awaiting confirmation by the service team.',
    Confirmed: 'Your appointment is confirmed. Technician details will appear when assigned.',
    Assigned: 'A technician has been assigned. Please contact the service team if your plans change.',
    'On The Way': 'Your technician is on the way to the service address.',
    'In Progress': 'Your service visit is in progress.',
    Completed: 'This visit is complete. Any submitted service report is available below.',
    Cancelled: 'This visit was cancelled and is kept in your booking history.',
  };
  return descriptions[status] ?? 'The latest recorded status for this request.';
}
export function BookingStatus({ status }: { status: string }) {
  return <Badge className={`${colours[status] ?? 'bg-slate-100 text-slate-800'} w-fit whitespace-normal text-left`}>
    {bookingStatusLabel(status)}
  </Badge>;
}
