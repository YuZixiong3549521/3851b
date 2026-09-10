'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ArrowLeft, CalendarDays, Camera, CheckCircle2, ClipboardCheck, Clock3, Snowflake, UserRound, Wrench } from 'lucide-react';
import { CoolCareShell } from '@/components/coolcare-shell';
import { PageError, PageLoading } from '@/components/page-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { coolcareApi } from '@/lib/coolcare-api';
import { formatDate } from '@/lib/format';
import type { ServiceReport } from '@/lib/coolcare-types';

export default function ServiceReportPage() {
  const params = useParams<{ bookingId: string }>();
  const bookingId = Number(params.bookingId);
  const [report, setReport] = useState<ServiceReport | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!Number.isInteger(bookingId)) return;
    coolcareApi.getReport(bookingId).then(setReport).catch((reason) => setError(reason instanceof Error ? reason.message : 'Unable to load the service report.'));
  }, [bookingId]);

  return (
    <CoolCareShell>
      <div className="mx-auto max-w-5xl px-5 py-8 sm:px-8 lg:px-10 lg:py-10">
        <Button render={<Link href="/history" />} variant="ghost" className="mb-5 -ml-3"><ArrowLeft className="size-4" aria-hidden="true" />Back to maintenance history</Button>
        {!report && !error && <PageLoading />}
        {!Number.isInteger(bookingId) && <PageError message="Invalid booking identifier." />}
        {error && <PageError message={error} />}
        {report && (
          <>
            <section className="overflow-hidden rounded-[28px] bg-[linear-gradient(120deg,#003f9f,#0066ff_65%,#00a98f_135%)] p-6 text-white shadow-[0_20px_60px_rgba(0,80,203,0.16)] sm:p-9">
              <div className="flex flex-wrap items-start justify-between gap-5"><div><Badge className="mb-4 border-white/20 bg-white/15 text-white hover:bg-white/15">Completed</Badge><p className="font-mono text-xs font-semibold text-blue-100">SR-2026-{String(report.reportId).padStart(4, '0')}</p><h1 className="mt-2 text-3xl font-bold">Service report</h1><p className="mt-2 text-blue-50">{report.serviceName} · {report.bookingReference}</p></div><div className="grid size-16 place-items-center rounded-2xl bg-white/15"><ClipboardCheck className="size-8" aria-hidden="true" /></div></div>
              <div className="mt-7 grid gap-4 border-t border-white/20 pt-6 sm:grid-cols-3"><ReportMeta icon={CalendarDays} label="Service date" value={formatDate(report.serviceDate)} /><ReportMeta icon={Clock3} label="Appointment" value={report.timeSlot} /><ReportMeta icon={UserRound} label="Technician" value={report.technicianName} /></div>
            </section>

            <div className="mt-6 grid gap-6 lg:grid-cols-2">
              <ReportSection icon={Wrench} title="Work performed" text={report.workPerformed} />
              <ReportSection icon={Snowflake} title="Problem found" text={report.problemFound ?? 'No additional problem was recorded.'} />
              <ReportSection icon={CheckCircle2} title="Solution applied" text={report.solutionApplied ?? 'No additional solution was recorded.'} />
              <ReportSection icon={ClipboardCheck} title="Checklist result" text={report.checklistResult ?? 'No checklist result was recorded.'} success />
            </div>

            <Card className="mt-6 border-border/80 shadow-sm"><CardHeader><CardTitle className="flex items-center gap-2 text-xl"><Camera className="size-5 text-primary" aria-hidden="true" />Service photos</CardTitle></CardHeader><CardContent>{report.photos.length ? <div className="grid gap-4 sm:grid-cols-2">{report.photos.map((photo) => <div key={photo.photoId} className="rounded-2xl border border-border bg-muted/35 p-5"><div className="grid size-11 place-items-center rounded-xl bg-primary/10 text-primary"><Camera className="size-5" aria-hidden="true" /></div><p className="mt-4 text-sm font-semibold">{photo.description ?? 'Service photo'}</p><p className="mt-1 text-xs text-muted-foreground">Evidence reference #{photo.photoId}</p></div>)}</div> : <p className="text-sm text-muted-foreground">No service photos were attached to this report.</p>}</CardContent></Card>

            <div className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-secondary/20 bg-secondary/8 p-5"><div><p className="font-semibold text-secondary">Report submitted successfully</p><p className="mt-1 text-sm text-muted-foreground">This report is stored with the completed booking.</p></div><p className="font-mono text-xs font-semibold text-muted-foreground">{report.submittedTime ? report.submittedTime.replace('T', ' ') : 'Submission time unavailable'}</p></div>
          </>
        )}
      </div>
    </CoolCareShell>
  );
}

function ReportMeta({ icon: Icon, label, value }: { icon: typeof CalendarDays; label: string; value: string }) {
  return <div className="flex gap-3"><Icon className="mt-0.5 size-4 shrink-0 text-blue-100" aria-hidden="true" /><div><p className="text-xs font-semibold uppercase tracking-wider text-blue-100">{label}</p><p className="mt-1 text-sm font-semibold">{value}</p></div></div>;
}

function ReportSection({ icon: Icon, title, text, success = false }: { icon: typeof Wrench; title: string; text: string; success?: boolean }) {
  return <Card className={`border-border/80 shadow-sm ${success ? 'bg-[#f7fffd]' : ''}`}><CardHeader><div className={`mb-1 grid size-10 place-items-center rounded-xl ${success ? 'bg-secondary/15 text-secondary' : 'bg-primary/10 text-primary'}`}><Icon className="size-5" aria-hidden="true" /></div><CardTitle className="text-lg">{title}</CardTitle></CardHeader><CardContent><p className="text-sm leading-6 text-muted-foreground">{text}</p></CardContent></Card>;
}
