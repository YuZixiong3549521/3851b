import { Clock3, Wrench, CalendarDays, ClipboardList } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  formatDate,
  formatDateTime,
  formatMoney,
  formatTimeSlot,
} from '@/lib/format';
import type { ServiceProgress } from '@/lib/coolcare-types';

export function ServiceProgressSummary({
  progress,
}: {
  progress?: ServiceProgress | null;
}) {
  if (
    !progress ||
    (!progress.events.length &&
      !progress.extensionMinutes &&
      !progress.additionalRepairFee &&
      (!progress.followUpStatus || progress.followUpStatus === 'None'))
  )
    return null;
  const returnOpen =
    progress.followUpStatus && progress.followUpStatus !== 'None';
  return (
    <Card className="report-section border-border/80 shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <ClipboardList className="size-5 text-primary" />
          Service updates and return visits
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!!progress.visits?.length && <details><summary>Visit records ({progress.visits.length})</summary>{progress.visits.map((v,i)=><section key={v.id} className="border rounded-lg p-3 my-2"><h4>Visit {i+1} · {v.outcome}</h4><p>{v.startedAt ? String(v.startedAt).replace('T',' ').slice(0,19) : 'Start not recorded'} – {String(v.endedAt).replace('T',' ').slice(0,19)}</p><p className="whitespace-pre-wrap">{v.snapshot.checklist_result || 'No checklist recorded.'}</p><p>{v.snapshot.problem_found}</p></section>)}</details>}

        {progress.extensionMinutes > 0 && (
          <div className="rounded-xl bg-primary/5 p-4">
            <p className="flex items-center gap-2 font-semibold">
              <Clock3 className="size-4 text-primary" />
              Service time extended by {progress.extensionMinutes} minutes
            </p>
            {progress.expectedEndTime && (
              <p className="mt-1 text-sm text-muted-foreground">
                Expected finish:{' '}
                {formatTimeSlot(progress.expectedEndTime.slice(0, 5))} (SGT)
              </p>
            )}
          </div>
        )}
        {returnOpen && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
            <p className="flex items-center gap-2 font-semibold text-amber-950">
              <CalendarDays className="size-4" />
              Return visit: {progress.followUpStatus}
            </p>
            <p className="mt-1 text-sm text-amber-900">
              {progress.followUpDate
                ? formatDate(progress.followUpDate)
                : 'The administrator will review the request and invite you to choose a time.'}
              {progress.followUpStart && progress.followUpEnd
                ? ' · ' +
                  formatTimeSlot(
                    progress.followUpStart.slice(0, 5) +
                      ' - ' +
                      progress.followUpEnd.slice(0, 5),
                  ) +
                  ' (SGT)'
                : ''}
            </p>
            <p className="mt-2 text-xs text-amber-900">
              The original visit and return work stay in the same service
              report.
            </p>
          </div>
        )}
        {(progress.additionalRepairFee > 0 || progress.repairQuoteNote) && (
          <div className="rounded-xl bg-muted/50 p-4">
            <p className="flex items-center gap-2 font-semibold">
              <Wrench className="size-4 text-primary" />
              Additional repair quote:{' '}
              {formatMoney(progress.additionalRepairFee)}
            </p>
            <p className="mt-1 whitespace-pre-wrap break-words text-sm text-muted-foreground">
              {progress.repairQuoteNote}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              Quoted by your technician, in addition to the minimum visit fee.
              No online approval or payment is required.
            </p>
          </div>
        )}
        {progress.events.length > 0 && (
          <details open className="rounded-xl border p-4">
            <summary className="cursor-pointer text-sm font-semibold">
              Work updates ({progress.events.length})
            </summary>
            <ol className="mt-4 space-y-4">
              {progress.events.map((event) => (
                <li
                  key={event.id}
                  className="border-l-2 border-primary/20 pl-3"
                >
                  <p className="text-sm font-semibold">
                    {event.kind}
                    {event.minutes ? ` · ${event.minutes} minutes` : ''}
                    {event.amount != null
                      ? ' · ' + formatMoney(event.amount)
                      : ''}
                  </p>
                  {event.reason && (
                    <p className="mt-1 text-sm">{event.reason}</p>
                  )}
                  {event.notes && (
                    <p className="mt-1 whitespace-pre-wrap break-words text-sm text-muted-foreground">
                      {event.notes}
                    </p>
                  )}
                  {event.partNotes && (
                    <p className="mt-1 whitespace-pre-wrap break-words text-sm text-muted-foreground">
                      <strong>Parts required:</strong> {event.partNotes}
                    </p>
                  )}
                  <p className="mt-1 text-xs text-muted-foreground">
                    {formatDateTime(event.createdAt)} · {event.createdBy}
                  </p>
                </li>
              ))}
            </ol>
          </details>
        )}
      </CardContent>
    </Card>
  );
}
