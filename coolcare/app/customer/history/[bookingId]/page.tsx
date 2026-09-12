'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ArrowLeft, CalendarDays, Camera, CheckCircle2, ClipboardCheck, Clock3, Package, Printer, Snowflake, Timer, UserRound, Wrench, ZoomIn } from 'lucide-react';
import { CoolCareShell } from '@/components/coolcare-shell';
import { PageError, PageLoading } from '@/components/page-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { coolcareApi } from '@/lib/coolcare-api';
import { formatDate, formatDateTime, formatTimeSlot } from '@/lib/format';
import type { ServiceReport } from '@/lib/coolcare-types';
import './report-print.css';

type ReportPhoto = ServiceReport['photos'][number];

export default function ServiceReportPage() {
  const params = useParams<{ bookingId: string }>();
  return <ServiceReportContent key={params.bookingId} bookingId={Number(params.bookingId)} />;
}

function ServiceReportContent({ bookingId }: { bookingId: number }) {
  const validId = Number.isInteger(bookingId) && bookingId > 0;
  const [report, setReport] = useState<ServiceReport | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [selectedPhoto, setSelectedPhoto] = useState<ReportPhoto | null>(null);

  useEffect(() => {
    let active = true;
    setReport(null); setError('');
    if (validId) coolcareApi.getReport(bookingId).then(result => { if (active) setReport(result); }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : 'Unable to load the service report.'); });
    return () => { active = false; };
  }, [bookingId, validId, attempt]);

  return <CoolCareShell>
    <article className="customer-service-report mx-auto max-w-5xl px-5 py-8 sm:px-8 lg:px-10 lg:py-10">
      <div className="report-screen-only mb-5 flex flex-wrap items-center justify-between gap-3"><Button nativeButton={false} render={<Link href="/customer/history" />} variant="ghost" className="-ml-3"><ArrowLeft className="size-4" aria-hidden="true" />Back to booking history</Button>{report && <Button variant="outline" onClick={() => window.print()}><Printer className="size-4" aria-hidden="true" />Print / Save as PDF</Button>}</div>
      {!report && !error && validId && <PageLoading />}
      {!validId && <PageError message="Invalid booking identifier." />}
      {error && <div className="space-y-4"><PageError message={error} /><Button variant="outline" onClick={() => setAttempt(value => value + 1)}>Retry</Button></div>}
      {report && <>
        <section className="report-hero overflow-hidden rounded-[28px] bg-[linear-gradient(120deg,#003f9f,#0066ff_65%,#00a98f_135%)] p-6 text-white shadow-[0_20px_60px_rgba(0,80,203,0.16)] sm:p-9">
          <div className="flex flex-wrap items-start justify-between gap-5"><div><Badge className="mb-4 border-white/20 bg-white/15 text-white hover:bg-white/15">Completed</Badge><p className="font-mono text-xs font-semibold text-blue-100">Report #{report.reportId}</p><h1 className="mt-2 text-3xl font-bold">Service report</h1><p className="mt-2 text-blue-50">{report.serviceName} · {report.bookingReference}</p></div><div className="report-screen-only grid size-16 place-items-center rounded-2xl bg-white/15"><ClipboardCheck className="size-8" aria-hidden="true" /></div></div>
          <div className="mt-7 grid gap-4 border-t border-white/20 pt-6 sm:grid-cols-2 lg:grid-cols-4"><ReportMeta icon={CalendarDays} label="Service date" value={formatDate(report.serviceDate)} /><ReportMeta icon={Clock3} label="Appointment" value={formatTimeSlot(report.timeSlot)} /><ReportMeta icon={UserRound} label="Technician" value={report.technicianName} /><ReportMeta icon={Timer} label="Work duration" value={formatDuration(report.durationMinutes)} /></div>
        </section>

        <div className="report-section-grid mt-6 grid gap-6 lg:grid-cols-2">
          {report.cleaningMethod && <ReportSection icon={Snowflake} title="Technician cleaning assessment" text={report.cleaningMethod + ' cleaning recommended after inspection.'} />}
          {report.assessmentNote && <ReportSection icon={ClipboardCheck} title="Assessment notes" text={report.assessmentNote} />}
          <ReportSection icon={Wrench} title="Work performed" text={report.workPerformed || 'Work details were not recorded.'} />
          <ReportSection icon={Snowflake} title="Problem found" text={report.problemFound || 'No additional problem was recorded.'} />
          <ReportSection icon={CheckCircle2} title="Solution applied" text={report.solutionApplied || 'No additional solution was recorded.'} />
          <ReportSection icon={ClipboardCheck} title="Checklist result" text={report.checklistResult || 'No checklist result was recorded.'} success />
        </div>

        <Card className="report-section mt-6 border-border/80 shadow-sm"><CardHeader><CardTitle className="flex items-center gap-2 text-xl"><Package className="size-5 text-primary" aria-hidden="true" />Parts used</CardTitle></CardHeader><CardContent>{report.partsUsed?.length ? <div className="divide-y divide-border">{report.partsUsed.map(part => <div key={part.partId} className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0"><div className="min-w-0"><p className="break-words text-sm font-semibold">{part.partName}</p><p className="mt-1 text-xs text-muted-foreground">Part #{part.partId}</p></div><p className="shrink-0 text-sm font-semibold">{new Intl.NumberFormat('en-SG', { maximumFractionDigits: 3 }).format(part.quantity)}{part.unit ? ' ' + part.unit : ''}</p></div>)}</div> : <p className="text-sm text-muted-foreground">No parts were recorded as used on this work order.</p>}</CardContent></Card>

        <Card className="report-photos mt-6 border-border/80 shadow-sm"><CardHeader><CardTitle className="flex items-center gap-2 text-xl"><Camera className="size-5 text-primary" aria-hidden="true" />Service photos</CardTitle></CardHeader><CardContent>{report.photos.length ? <div className="grid gap-4 sm:grid-cols-2">{report.photos.map(photo => <ReportPhotoCard key={photo.photoId} photo={photo} onOpen={() => setSelectedPhoto(photo)} />)}</div> : <p className="text-sm text-muted-foreground">No service photos were attached to this report.</p>}</CardContent></Card>

        <div className="report-submission mt-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-secondary/20 bg-secondary/8 p-5"><div><p className="font-semibold text-secondary">Report submitted</p><p className="mt-1 text-sm text-muted-foreground">Stored with your completed booking.</p></div><div className="text-sm"><p className="font-semibold">{formatDateTime(report.submittedTime)}</p><p className="mt-1 text-xs text-muted-foreground">Singapore time (SGT)</p></div></div>
      </>}
    </article>
    <Dialog open={Boolean(selectedPhoto)} onOpenChange={open => { if (!open) setSelectedPhoto(null); }}><DialogContent className="report-screen-only max-h-[94dvh] overflow-y-auto sm:max-w-4xl"><DialogHeader><DialogTitle>{selectedPhoto?.description || 'Service photo'}</DialogTitle><DialogDescription>Evidence #{selectedPhoto?.photoId}{selectedPhoto?.capturedTime ? ' · ' + formatDateTime(selectedPhoto.capturedTime) + ' (SGT)' : ''}</DialogDescription></DialogHeader>{selectedPhoto?.photoUrl && <img src={selectedPhoto.photoUrl} alt={selectedPhoto.description || 'Technician service evidence'} className="max-h-[72dvh] w-full rounded-xl object-contain" />}</DialogContent></Dialog>
  </CoolCareShell>;
}

function formatDuration(minutes: number | null | undefined) {
  if (minutes == null || !Number.isFinite(minutes) || minutes < 0) return 'Not recorded';
  const rounded = Math.round(minutes);
  const hours = Math.floor(rounded / 60);
  const remainder = rounded % 60;
  return hours ? hours + (hours === 1 ? ' hr' : ' hrs') + (remainder ? ' ' + remainder + ' min' : '') : rounded + ' min';
}

function ReportPhotoCard({ photo, onOpen }: { photo: ReportPhoto; onOpen: () => void }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [photo.photoUrl]);
  const available = Boolean(photo.photoUrl) && !failed;
  return <figure className="report-photo overflow-hidden rounded-2xl border border-border bg-muted/20">
    {available ? <Button variant="ghost" className="group relative block h-auto w-full overflow-hidden rounded-none p-0" onClick={onOpen} aria-label={'Enlarge ' + (photo.description || 'service photo')}><img src={photo.photoUrl!} alt={photo.description || 'Technician service evidence'} onError={() => setFailed(true)} className="aspect-[4/3] w-full object-cover" /><span className="report-screen-only absolute right-3 bottom-3 flex items-center gap-1.5 rounded-lg bg-white/95 px-2.5 py-1.5 text-xs text-foreground shadow-sm"><ZoomIn className="size-4" />Enlarge</span></Button> : <div className="flex min-h-32 flex-col items-center justify-center gap-2 bg-muted/45 px-5 py-6 text-center"><Camera className="size-7 text-muted-foreground" aria-hidden="true" /><p className="text-sm text-muted-foreground">Photo file unavailable</p><p className="text-xs text-muted-foreground">The evidence record is retained below.</p></div>}
    <figcaption className="p-4"><p className="break-words text-sm font-semibold">{photo.description || 'Service photo'}</p><p className="mt-1 text-xs text-muted-foreground">Evidence #{photo.photoId}</p>{photo.capturedTime && <p className="mt-1 text-xs text-muted-foreground">{formatDateTime(photo.capturedTime)} (SGT)</p>}</figcaption>
  </figure>;
}

function ReportMeta({ icon: Icon, label, value }: { icon: typeof CalendarDays; label: string; value: string }) {
  return <div className="flex gap-3"><Icon className="mt-0.5 size-4 shrink-0 text-blue-100" aria-hidden="true" /><div><p className="text-xs font-semibold uppercase tracking-wider text-blue-100">{label}</p><p className="mt-1 text-sm font-semibold">{value}</p></div></div>;
}

function ReportSection({ icon: Icon, title, text, success = false }: { icon: typeof Wrench; title: string; text: string; success?: boolean }) {
  return <Card className={'report-section border-border/80 shadow-sm ' + (success ? 'bg-[#f7fffd]' : '')}><CardHeader><div className={'mb-1 grid size-10 place-items-center rounded-xl ' + (success ? 'bg-secondary/15 text-secondary' : 'bg-primary/10 text-primary')}><Icon className="size-5" aria-hidden="true" /></div><CardTitle className="text-lg">{title}</CardTitle></CardHeader><CardContent><p className="whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground">{text}</p></CardContent></Card>;
}
