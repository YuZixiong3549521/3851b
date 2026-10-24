'use client';

import { useCallback } from 'react';
import Link from 'next/link';
import { Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCustomerResource } from '@/lib/use-customer-resource';
import { englishCalendarDate } from '@/lib/english-date';

type PendingFeedback = {
  count: number;
  visits: {
    reportId: number;
    bookingReference: string;
    service: string;
    technician: string;
    actualEnd: string;
    reportSubmitted: boolean;
  }[];
};

/** Uses persisted visit feedback; dismissing a page never marks an order rated. */
export function CustomerFeedbackPrompt({ bookingId }: { bookingId?: number }) {
  const load = useCallback(async (): Promise<PendingFeedback> => {
    const response = await fetch(
      '/api/performance/customer/pending-feedback' +
        (bookingId ? `?bookingId=${bookingId}` : ''),
      { credentials: 'include' },
    );
    const result = (await response.json()) as PendingFeedback & { error?: string };
    if (!response.ok)
      throw Object.assign(
        new Error(result.error || 'Unable to check service feedback.'),
        { status: response.status },
      );
    return result;
  }, [bookingId]);
  const { data, error, refresh, refreshing } = useCustomerResource(load);
  if (error)
    return (
      <div className="rounded-2xl border bg-card p-4 text-sm">
        <p>{error}</p>
        <Button
          variant="outline"
          size="sm"
          className="mt-2"
          onClick={() => void refresh()}
          disabled={refreshing}
        >
          Retry feedback reminder
        </Button>
      </div>
    );
  if (!data?.count) return null;
  return (
    <section
      aria-label="Rate your completed service"
      className="rounded-2xl border border-primary/20 bg-primary/5 p-5"
    >
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        <Star className="size-5 text-primary" />
        How was your service?
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Your service is complete. Please rate your visit and share your
        experience with your technician and our service team.
      </p>
      <div className="mt-4 space-y-3">
        {data.visits.map((visit) => (
          <div
            key={visit.reportId}
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-card p-4"
          >
            <div>
              <p className="text-sm font-semibold">
                {visit.service} · {visit.bookingReference}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {visit.technician} ·{' '}
                {englishCalendarDate(visit.actualEnd.slice(0, 10))}
              </p>
              {!visit.reportSubmitted && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Your report is still being prepared. You can rate the
                  completed visit now.
                </p>
              )}
            </div>
            <Button
              nativeButton={false}
              render={
                <Link href={`/customer/feedback?reportId=${visit.reportId}`} />
              }
              size="sm"
            >
              Rate this service
            </Button>
          </div>
        ))}
      </div>
      {data.count > data.visits.length && (
        <p className="mt-3 text-sm text-muted-foreground">
          {data.count} completed visits are awaiting your feedback. More will
          appear after you rate these visits.
        </p>
      )}
    </section>
  );
}
