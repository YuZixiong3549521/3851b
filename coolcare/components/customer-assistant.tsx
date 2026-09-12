'use client';

import { useEffect, useRef, useState } from 'react';
import { Bot, CalendarPlus, MessageCircle, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { BookingServiceSelection, bookingEmailMessage, bookingFrequencyNotice, emptyBookingSelection, getBookingSelection, type BookingSelection } from '@/components/booking-service-selection';
import { bookingStatusLabel } from '@/components/booking-status';
import { AnnualBookingSummary } from '@/components/annual-booking-summary';
import { BookingAddressField } from '@/components/booking-address-field';
import { EnglishDatePicker } from '@/components/english-date-picker';
import { BookingAvailabilityNotice, bookingConflictMessage } from '@/components/booking-availability-notice';
import { useBookingAvailability } from '@/lib/use-booking-availability';
import { apiFetch } from '@/components/public-site/api';
import { coolcareApi } from '@/lib/coolcare-api';
import { formatDate, formatMoney } from '@/lib/format';
import { assertBookingConfirmation } from '@/lib/annual-booking';
import { bookingDateError, bookingScheduleNotice, earliestBookingDate } from '@/lib/booking-schedule';
import type { Address, AnnualBundle, BookingOptions, CustomerContext, EmailNotification } from '@/lib/coolcare-types';

type Step = 'menu' | 'service' | 'units' | 'schedule' | 'address' | 'review' | 'success';
type Draft = { numberOfUnits: number; preferredDate: string; timeWindow: string; serviceAddress: string; phone: string; symptoms: string };
const times = ['09:00 AM - 11:00 AM', '11:00 AM - 01:00 PM', '02:00 PM - 04:00 PM', '04:00 PM - 06:00 PM'];
const emptyDraft: Draft = { numberOfUnits: 1, preferredDate: '', timeWindow: '', serviceAddress: '', phone: '', symptoms: '' };
const prompts: Record<Step, string> = {
  menu: 'I can help you create a booking, one step at a time.',
  service: 'Choose Cleaning, Repair or the Annual Cleaning Bundle with four quarterly visits.', units: 'How many aircon units need servicing?',
  schedule: 'When would you like us to visit?', address: 'Where should we visit, and how can we reach you?',
  review: 'Please check your request. I will only submit it when you select Confirm booking.',
  success: 'Your booking has been saved! The service team will confirm availability.',
};

async function publicRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(`/api/public${path}`, init);
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(response.status === 401 || response.status === 403
    ? 'Your session is no longer available. Please sign in again.' : data.message || data.error || 'Unable to complete your request. Please retry.'), { status: response.status });
  return data as T;
}

export function CustomerAssistant({ onBookingCreated }: { onBookingCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [context, setContext] = useState<CustomerContext | null>(null);
  const [options, setOptions] = useState<BookingOptions | null>(null);
  const [selection, setSelection] = useState<BookingSelection>(emptyBookingSelection);
  const [step, setStep] = useState<Step>('menu');
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [created, setCreated] = useState<{ id: number; status: string; totalAmount: number; emailNotification?: EmailNotification; annualBundle?: AnnualBundle | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [retryLocked, setRetryLocked] = useState(false);
  const [addressEditorOpen, setAddressEditorOpen] = useState(false);
  const requestId = useRef('');
  const submitting = useRef(false);
  const startingBooking = useRef(false);
  const pendingRequest = useRef<Record<string, unknown> | null>(null);
  const ownerId = useRef<number | null>(null);
  const body = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setBusy(true);
    setError('');
    setContext(null);
    Promise.all([coolcareApi.getCustomerContext(), coolcareApi.getBookingOptions()])
      .then(([nextContext, data]) => { if (active) {
        if (ownerId.current !== nextContext.customer.userId) {
          setStep('menu'); setCreated(null); setDraft(emptyDraft); setSelection(emptyBookingSelection); setRetryLocked(false);
          pendingRequest.current = null;
          ownerId.current = nextContext.customer.userId;
        }
        setContext(nextContext); if (!pendingRequest.current) setOptions(data);
      } })
      .catch(reason => { if (active) setError(reason instanceof Error ? reason.message : 'Unable to load the assistant.'); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [open]);

  useEffect(() => { body.current?.scrollTo({ top: 0 }); }, [step]);

  function go(next: Step) { setError(''); setStep(next); }
  async function startBooking() {
    if (startingBooking.current || submitting.current) return;
    startingBooking.current = true;
    setBusy(true); setError('');
    try { setOptions(await coolcareApi.getBookingOptions()); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to refresh booking options.'); setBusy(false); return; }
    finally { startingBooking.current = false; }
    setBusy(false);
    requestId.current = crypto.randomUUID();
    pendingRequest.current = null;
    setRetryLocked(false);
    setDraft({ ...emptyDraft, preferredDate: earliestBookingDate(), serviceAddress: context?.addresses[0]?.addressLine || '', phone: context?.customer.phone || '' });
    setSelection(emptyBookingSelection);
    setCreated(null);
    go('service');
  }

  async function confirm() {
    if (submitting.current || !context || (!pendingRequest.current && !selectedServices.valid)) return;
    if (!pendingRequest.current && availability.selectedDateBlocked) { setError(bookingConflictMessage); return; }
    if (!pendingRequest.current && bookingDateError(draft.preferredDate)) { setError(bookingDateError(draft.preferredDate)); return; }
    if (!pendingRequest.current) pendingRequest.current = { ...draft, ...selectedServices.payload, expectedUserId: context.customer.userId, requestId: requestId.current };
    submitting.current = true; setBusy(true); setError(''); setRetryLocked(true);
    try {
      const result = await publicRequest<{ booking: { id: number; status: string; totalAmount: number; emailNotification?: EmailNotification; annualBundle?: AnnualBundle | null }; emailNotification?: EmailNotification }>('/bookings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pendingRequest.current),
      });
      assertBookingConfirmation(result.booking, Boolean(pendingRequest.current.packageId));
      setCreated({ ...result.booking, emailNotification: result.booking.emailNotification ?? result.emailNotification }); go('success'); setRetryLocked(false); pendingRequest.current = null; onBookingCreated();
    } catch (reason) {
      const rejected = reason instanceof Error && 'status' in reason && Number(reason.status) < 500;
      if (rejected) pendingRequest.current = null;
      if (reason instanceof Error && reason.message.includes('signed-in account changed')) {
        setContext(null); setOptions(null); setDraft(emptyDraft); setSelection(emptyBookingSelection); setCreated(null); ownerId.current = null;
      }
      setRetryLocked(!rejected);
      setError(`${reason instanceof Error ? reason.message : 'Unable to submit.'}${rejected ? '' : ' Retry with the same details to safely check or complete this request.'}`);
    } finally { submitting.current = false; setBusy(false); }
  }

  const selectedServices = getBookingSelection(options, selection, draft.numberOfUnits);
  const estimate = selectedServices.estimate;
  const minimumDate = earliestBookingDate();
  const availability = useBookingAvailability({ serviceAddress: draft.serviceAddress, selectedDate: draft.preferredDate, enabled: Boolean(open && context && ['address', 'schedule', 'review'].includes(step) && !retryLocked) });
  const previous: Partial<Record<Step, Step>> = { units: 'service', address: 'units', schedule: 'address', review: 'schedule' };
  function addressSaved(address: Address) {
    setContext(current => current ? { ...current, addresses: [address, ...current.addresses.filter(item => item.addressId !== address.addressId)] } : current);
    setDraft(current => ({ ...current, serviceAddress: address.addressLine }));
  }

  return <Dialog open={open} onOpenChange={value => { if (!submitting.current) setOpen(value); }}>
    <DialogTrigger render={<Button variant="outline" className="border-white/40 bg-white/10 text-white hover:bg-white/20 hover:text-white" />}>
      <MessageCircle className="size-4" />Ask CoolCare Assistant
    </DialogTrigger>
    <DialogContent className="flex max-h-[90dvh] flex-col gap-0 overflow-hidden rounded-3xl p-0 sm:max-w-lg" aria-busy={busy}>
      <div className="border-b bg-primary/5 px-5 py-5 pr-12">
        <DialogTitle className="flex items-center gap-2 text-lg font-bold"><Bot className="size-6 text-primary" />CoolCare Assistant</DialogTitle>
        <DialogDescription className="mt-1">Your bookings, one step at a time.</DialogDescription>
      </div>
      <div ref={body} className="min-h-0 space-y-4 overflow-y-auto p-5">
        {busy && <p role="status" className="text-sm text-muted-foreground">{submitting.current ? 'Saving your booking…' : 'Loading…'}</p>}
        {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}{!context && <p className="mt-2"><a href="/#/login" className="underline">Sign in</a> or close and reopen the assistant to retry.</p>}</div>}
        {context && <>
          <div className="rounded-2xl rounded-tl-sm bg-muted p-4 text-sm leading-6" aria-live="polite">
            {step === 'menu' && <p className="font-semibold">Hi {context.customer.fullName.split(' ')[0]}!</p>}{prompts[step]}
          </div>
          {step === 'menu' && <div className="grid gap-3">
            <Button className="h-14 justify-start" onClick={startBooking} disabled={busy}><CalendarPlus />Create a new booking</Button>
          </div>}
          {step === 'service' && options && <BookingServiceSelection options={options} value={selection} onChange={setSelection} units={draft.numberOfUnits} disabled={busy} />}
          {step === 'units' && <><div className="grid grid-cols-5 gap-2">{Array.from({ length: 10 }, (_, i) => i + 1).map(count => <Button key={count} variant={draft.numberOfUnits === count ? 'default' : 'outline'} aria-pressed={draft.numberOfUnits === count} onClick={() => setDraft({ ...draft, numberOfUnits: count })}>{count}</Button>)}</div><p className="text-sm">{selectedServices.label} · {selectedServices.isAnnual ? 'Annual estimate' : 'Visit estimate'} {formatMoney(estimate)}</p></>}
          {step === 'schedule' && <form id="assistant-schedule" className="space-y-4" onSubmit={event => { event.preventDefault(); const message = bookingDateError(draft.preferredDate) || (availability.selectedDateBlocked ? bookingConflictMessage : ''); if (message) { setError(message); return; } go('review'); }}>
            <p className="rounded-xl bg-primary/5 p-3 text-sm leading-6">{bookingScheduleNotice}</p>
            <div className="space-y-2 text-sm font-medium"><label htmlFor="assistant-date">{selectedServices.isAnnual ? 'First preferred visit date' : 'Preferred date'}</label><EnglishDatePicker id="assistant-date" min={minimumDate} aria-invalid={Boolean(bookingDateError(draft.preferredDate)) || availability.selectedDateBlocked} value={draft.preferredDate} blockedDates={availability.blockedDates} onMonthChange={availability.onMonthChange} onChange={value => { setDraft({ ...draft, preferredDate: value }); setError(bookingDateError(value)); }} /></div><BookingAvailabilityNotice availability={availability} />
            <p className="text-sm font-medium">Preferred arrival window</p><div className="grid grid-cols-2 gap-2">{times.map(time => <Button key={time} type="button" className="h-auto whitespace-normal py-3" variant={draft.timeWindow === time ? 'default' : 'outline'} aria-pressed={draft.timeWindow === time} onClick={() => setDraft({ ...draft, timeWindow: time })}>{time}</Button>)}</div>
            {selectedServices.isAnnual && <AnnualBookingSummary firstDate={draft.preferredDate} timeSlot={draft.timeWindow} totalAmount={estimate} collapsible />}
            <p className="text-xs text-muted-foreground">These are preferred windows. The service team will confirm availability.</p><p className="text-xs leading-5 text-muted-foreground">{bookingFrequencyNotice}</p>
          </form>}
          {step === 'address' && <form id="assistant-address" className="space-y-4" onSubmit={event => { event.preventDefault(); if (addressEditorOpen) return; if (draft.serviceAddress.trim().length < 5 || draft.serviceAddress.trim().length > 255) { setError('Enter a service address between 5 and 255 characters.'); return; } go('schedule'); }}>
            <BookingAddressField key={context.customer.userId} expectedUserId={context.customer.userId} addresses={context.addresses} value={draft.serviceAddress} onChange={value => setDraft(current => ({ ...current, serviceAddress: value }))} onAddressSaved={addressSaved} onEditingChange={setAddressEditorOpen} />
            <label className="block space-y-2 text-sm font-medium"><span>Contact phone</span><Input required type="tel" maxLength={30} value={draft.phone} onChange={event => setDraft({ ...draft, phone: event.target.value })} /></label>
            <label className="block space-y-2 text-sm font-medium"><span>Notes for the technician (optional)</span><Textarea maxLength={1000} value={draft.symptoms} onChange={event => setDraft({ ...draft, symptoms: event.target.value })} /></label>
          </form>}
          {(step === 'review' || step === 'success') && <>
            {created && step === 'success' && <div role="status" className="rounded-xl bg-emerald-50 p-4 text-emerald-900"><p className="font-bold">{created.annualBundle ? 'Four booking requests saved' : 'Booking #' + created.id}</p><p>Status: {bookingStatusLabel(created.status)}</p></div>}
            <dl className="space-y-3 rounded-xl border p-4 text-sm">{Object.entries({ 'Booking option': selectedServices.label, Units: draft.numberOfUnits, [selectedServices.isAnnual ? 'First preferred date' : 'Preferred date']: formatDate(draft.preferredDate), Time: draft.timeWindow, Address: draft.serviceAddress, Phone: draft.phone, [selectedServices.isAnnual ? 'Annual estimate' : 'Visit estimate']: formatMoney(created && step === 'success' ? created.annualBundle?.totalAmount ?? created.totalAmount : estimate), ...(draft.symptoms ? { Notes: draft.symptoms } : {}) }).map(([label, value]) => <div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="break-words font-medium">{value}</dd></div>)}</dl>
            {selectedServices.isAnnual && <AnnualBookingSummary firstDate={draft.preferredDate} timeSlot={draft.timeWindow} totalAmount={estimate} saved={step === 'success' ? created?.annualBundle : null} />}
            {selectedServices.pricingNote && <p className="text-sm text-muted-foreground">{selectedServices.pricingNote}</p>}
            {created?.emailNotification && step === 'success' && <p role="status" className="text-sm text-muted-foreground">{bookingEmailMessage(created.emailNotification)}</p>}
          </>}
        </>}
      </div>
      {context && step !== 'menu' && <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t bg-background p-4">
        {previous[step] && <Button variant="outline" disabled={busy || retryLocked || addressEditorOpen} onClick={() => go(previous[step]!)}>Back</Button>}
        <Button variant="ghost" size="sm" disabled={busy || retryLocked || addressEditorOpen} onClick={() => go('menu')} aria-label="Back to assistant menu"><RotateCcw className="size-4" /><span className="hidden sm:inline">Menu</span></Button>
        {step === 'service' && <Button disabled={busy || !selectedServices.valid} onClick={() => go('units')}>Continue</Button>}
        {step === 'units' && <Button disabled={busy} onClick={() => go('address')}>Continue</Button>}
        {step === 'address' && <Button type="submit" form="assistant-address" disabled={busy || addressEditorOpen}>Continue</Button>}
        {step === 'schedule' && <Button type="submit" form="assistant-schedule" disabled={busy || !draft.timeWindow || availability.selectedDateBlocked}>Review booking</Button>}
        {step === 'review' && <Button disabled={busy || (!retryLocked && availability.selectedDateBlocked)} onClick={confirm}>{busy ? 'Saving…' : retryLocked ? 'Retry confirmation' : 'Confirm booking'}</Button>}
        {step === 'success' && <Button disabled={busy} onClick={startBooking}>Book another service</Button>}
      </div>}
    </DialogContent>
  </Dialog>;
}
