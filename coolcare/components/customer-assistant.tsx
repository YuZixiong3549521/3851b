'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Bot, CalendarDays, CalendarPlus, Check, CheckCircle2, ChevronDown, HelpCircle, Mail, Pencil, Sparkles, Wrench } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { bookingEmailMessage, bookingFrequencyNotice, getBookingSelection } from '@/components/booking-service-selection';
import { bookingStatusLabel } from '@/components/booking-status';
import { AnnualBookingSummary } from '@/components/annual-booking-summary';
import { BookingAddressField } from '@/components/booking-address-field';
import { EnglishDatePicker } from '@/components/english-date-picker';
import { bookingConflictMessage } from '@/components/booking-availability-notice';
import { useBookingAvailability } from '@/lib/use-booking-availability';
import { useSlotAvailability } from '@/lib/use-slot-availability';
import { useAssistantDraft } from '@/lib/use-assistant-draft';
import { assistantApi, emptyAssistantDraft, verifyAssistantState, type AssistantConflict, type AssistantError, type AssistantState, type AssistantStep } from '@/lib/assistant-api';
import { coolcareApi } from '@/lib/coolcare-api';
import { formatDate, formatDateTime, formatMoney, formatTimeSlot } from '@/lib/format';
import { annualVisitAmounts,annualVisitDates } from '@/lib/annual-booking';
import { bookingDateError, bookingScheduleNotice, earliestBookingDate } from '@/lib/booking-schedule';
import { bookingSupportLink, customerSupportEmail } from '@/lib/customer-support';
import { phoneNumberError } from '@/lib/phone-number.mjs';
import { homepageIssues } from '@/lib/homepage-offers';
import type { Address, BookingOptions, CustomerContext } from '@/lib/coolcare-types';

type Screen = 'menu' | AssistantStep | 'success';
type HelpTopic = 'service' | 'pricing' | 'dates' | 'changes' | null;
const steps: AssistantStep[] = ['service', 'address', 'schedule', 'review'];
const labels: Record<AssistantStep, string> = { service: 'Service', address: 'Address', schedule: 'Schedule', review: 'Review' };
const times = ['09:00 AM - 11:00 AM', '11:00 AM - 01:00 PM', '02:00 PM - 04:00 PM', '04:00 PM - 06:00 PM'];
const timeCodes:Record<string,'09:00 - 11:00'|'11:00 - 13:00'|'14:00 - 16:00'|'16:00 - 18:00'>={
  '09:00 AM - 11:00 AM':'09:00 - 11:00','11:00 AM - 01:00 PM':'11:00 - 13:00','02:00 PM - 04:00 PM':'14:00 - 16:00','04:00 PM - 06:00 PM':'16:00 - 18:00',
};
const prompts: Record<Screen, string> = {
  menu: 'I can help you create a booking and explain your service options.',
  service: 'What care do you need, and how many aircon units should we service?',
  address: 'Where should we visit, and how can we reach you?',
  schedule: 'Choose a preferred weekday. I will check every visit before you confirm.',
  review: 'Check your details and current estimate. Nothing is booked until you confirm.',
  success: 'Your request is saved. The service team will confirm availability.',
};
const supportHref = 'mailto:' + customerSupportEmail + '?subject=CoolCare%20booking%20help';

export function CustomerAssistant({ open, onOpenChange: setOpen, dialogId, returnFocus, onBookingCreated }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dialogId: string;
  returnFocus: () => HTMLElement | null;
  onBookingCreated: () => void;
}) {
  const store = useAssistantDraft();
  const { draft, record } = store;
  const [screen, setScreen] = useState<Screen>('menu');
  const [context, setContext] = useState<CustomerContext | null>(null);
  const [options, setOptions] = useState<BookingOptions | null>(null);
  const [operation, setOperation] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [authExpired, setAuthExpired] = useState(false);
  const [draftConflict, setDraftConflict] = useState(false);
  const [conflicts, setConflicts] = useState<AssistantConflict[]>([]);
  const [help, setHelp] = useState<HelpTopic>(null);
  const [editingReview, setEditingReview] = useState(false);
  const [addressEditorOpen, setAddressEditorOpen] = useState(false);
  const [phoneTouched, setPhoneTouched] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [priceChanged, setPriceChanged] = useState(false);
  const inFlight = useRef(false);
  const confirming = useRef(false);
  const pendingConfirmation = useRef<Parameters<typeof assistantApi.confirm>[0] | null>(null);
  const resumeOnOpen = useRef(false);
  const body = useRef<HTMLDivElement>(null);
  const lastNotified = useRef<string | null>(null);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('assistant') === 'resume') { resumeOnOpen.current = true; setOpen(true); }
  }, [setOpen]);
  useEffect(() => {
    if (!open) return;
    const url = new URL(window.location.href);
    url.searchParams.set('assistant', 'resume');
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
    void loadAssistant(resumeOnOpen.current);
    resumeOnOpen.current = false;
  }, [open]);
  useEffect(() => { body.current?.scrollTo({ top: 0 }); }, [screen]);

  const selection = draft.packageId ? { mode: 'bundle' as const, packageId: draft.packageId, serviceIds: [] } : { mode: 'custom' as const, serviceIds: draft.serviceId ? [draft.serviceId] : [] };
  const selected = getBookingSelection(options, selection, draft.numberOfUnits);
  const locked = Boolean(operation || uncertain || authExpired || draftConflict || ['conflict', 'auth'].includes(store.saveStatus));
  const availability = useBookingAvailability({ serviceAddress: draft.serviceAddress, selectedDate: draft.preferredDate, enabled: Boolean(open && context && screen === 'schedule' && !locked) });
  const annual = Boolean(draft.packageId);
  const slotDates=annual?annualVisitDates(draft.preferredDate):draft.preferredDate?[draft.preferredDate]:[];
  const slotAvailability=useSlotAvailability(slotDates,Boolean(open&&context&&screen==='schedule'&&!locked));
  const selectedSlotFull=Boolean(draft.timeWindow&&!slotAvailability.isAvailable(timeCodes[draft.timeWindow]));
  const receipt = record?.status === 'completed' ? record.booking : null;
  const quote = record?.quote;
  const estimate = quote && !store.dirty && (screen === 'review' || screen === 'success') ? quote.totalAmount : selected.estimate;
  const phoneError = phoneTouched ? phoneNumberError(draft.phone) : '';
  const canReview = selected.valid && !phoneNumberError(draft.phone) && draft.serviceAddress.trim().length >= 5 && !bookingDateError(draft.preferredDate) && Boolean(draft.timeWindow) && !selectedSlotFull;
  const savedProblem = ['error', 'conflict', 'auth'].includes(store.saveStatus);
  const bookingId = receipt?.id ?? receipt?.bookingId;

  function notifyCreated(state: AssistantState) {
    if (state.status === 'completed' && lastNotified.current !== state.draftId) { lastNotified.current = state.draftId; onBookingCreated(); }
  }
  function accept(state: AssistantState) {
    if (!context) return;
    verifyAssistantState(state, context.customer.userId);
    store.hydrate(state, context.customer.userId);
    if (state.status === 'completed') { setScreen('success'); setUncertain(false); setNotice(''); notifyCreated(state); }
  }
  function handleError(reason: unknown) {
    const problem = reason as AssistantError;
    const fields = problem.details?.fieldErrors;
    const messages = fields ? Object.values(fields).flatMap(value => Array.isArray(value) ? value : [value]).filter(Boolean) : [];
    setError(messages.length ? messages.join(' ') : problem.message || 'Unable to complete this step. Please retry.');
    if (problem.status === 401 || problem.status === 403 || problem.code === 'ACCOUNT_CHANGED') setAuthExpired(true);
    if (problem.code === 'DRAFT_CONFLICT') setDraftConflict(true);
    if (problem.details?.conflicts) setConflicts(problem.details.conflicts);
    if (fields && problem.code === 'VALIDATION_ERROR') {
      const field = Object.keys(fields)[0];
      if (['phone', 'serviceAddress', 'notes'].includes(field)) { setScreen('address'); setPhoneTouched(true); }
      else if (['serviceId', 'packageId', 'numberOfUnits'].includes(field)) setScreen('service');
      else if (['preferredDate', 'timeWindow'].includes(field)) setScreen('schedule');
      setEditingReview(true);
    }
    return problem;
  }
  async function loadAssistant(resume = false) {
    if (inFlight.current) return;
    inFlight.current = true; setOperation('Loading your saved draft…'); setError('');
    try {
      if (store.savingRef.current) await store.savingRef.current.catch(() => undefined);
      const [nextContext, nextOptions, nextState] = await Promise.all([coolcareApi.getCustomerContext(), coolcareApi.getBookingOptions(), assistantApi.load()]);
      verifyAssistantState(nextState, nextContext.customer.userId);
      setContext(nextContext); setOptions(nextOptions);
      const defaults = { ...emptyAssistantDraft, preferredDate: earliestBookingDate(), serviceAddress: nextContext.addresses.find(address => address.isDefault)?.addressLine || nextContext.addresses[0]?.addressLine || '', phone: nextContext.customer.phone || '' };
      store.hydrate(nextState, nextContext.customer.userId, defaults);
      setAuthExpired(false); setDraftConflict(false); setUncertain(false); setConflicts([]); setEditingReview(false); setPriceChanged(false);
      setScreen(nextState?.status === 'completed' ? 'success' : resume && nextState ? nextState.draft.step : 'menu');
      setNotice(nextState?.status === 'completed' ? '' : resume && nextState ? 'Your saved answers have been restored.' : '');
      if (nextState?.status === 'completed') notifyCreated(nextState);
    } catch (reason) { handleError(reason); }
    finally { inFlight.current = false; setOperation(''); }
  }
  async function run(label: string, action: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true; setOperation(label); setError('');
    try { await action(); } catch (reason) { handleError(reason); }
    finally { inFlight.current = false; setOperation(''); }
  }
  async function startBooking(reset = false) {
    if (!context) return;
    await run('Preparing your booking…', async () => {
      // Finish/reconcile every prior save before resetting the durable draft.
      await store.flush(true);
      setOptions(await coolcareApi.getBookingOptions());
      let current = store.recordRef.current;
      if (current && reset) {
        current = await assistantApi.startNew({ expectedUserId: context.customer.userId, draftId: current.draftId, revision: current.revision });
        store.hydrate(current, context.customer.userId);
      }
      setNotice(''); setConflicts([]); setEditingReview(false); setPriceChanged(false); setPhoneTouched(false);
      pendingConfirmation.current = null;
      store.update({ step: 'service', preferredDate: earliestBookingDate(), serviceAddress: context.addresses.find(address => address.isDefault)?.addressLine || context.addresses[0]?.addressLine || '', phone: context.customer.phone || '', notes: '', serviceId: undefined, packageId: undefined });
      await store.flush(true); setScreen('service');
    });
  }
  function resumeBooking() { setNotice('Your saved answers have been restored.'); setScreen(record?.draft.step ?? 'service'); }
  async function move(next: AssistantStep) {
    await run('Saving your answers…', async () => {
      setNotice('');
      store.update({ step: next });
      const saved = await store.flush();
      if (saved?.status === 'completed') { accept(saved); return; }
      setScreen(next);
    });
  }
  function edit(step: AssistantStep) { setEditingReview(true); setPriceChanged(false); setConflicts([]); void move(step); }
  function validCurrentStep() {
    if (screen === 'service' && !selected.valid) { setError('Choose a service to continue.'); return false; }
    if (screen === 'address') {
      setPhoneTouched(true);
      if (addressEditorOpen) return false;
      if (draft.serviceAddress.trim().length < 5 || draft.serviceAddress.trim().length > 255) { setError('Enter a service address between 5 and 255 characters.'); return false; }
      const message = phoneNumberError(draft.phone);
      if (message) { setError(message); return false; }
    }
    if (screen === 'schedule') {
      const message = bookingDateError(draft.preferredDate) || (!draft.timeWindow ? 'Choose a preferred arrival window.' : '') || (availability.selectedDateBlocked ? bookingConflictMessage : '') || (selectedSlotFull?'This service time is fully booked. Choose another available time.':'');
      if (message) { setError(message); return false; }
    }
    return true;
  }
  async function review() {
    if (!context || !validCurrentStep()) return;
    await run('Checking prices and all visit dates…', async () => {
      const previousAmount = store.recordRef.current?.quote?.totalAmount ?? selected.estimate;
      store.update({ step: 'review' });
      const saved = await store.flush();
      if (!saved) throw new Error('Save your answers before requesting a review.');
      if (saved.status === 'completed') { accept(saved); return; }
      try {
        const checked = await assistantApi.review({ expectedUserId: context.customer.userId, draftId: saved.draftId, revision: saved.revision });
        accept(checked); setScreen('review'); setEditingReview(false); setConflicts([]);
        setPriceChanged(Boolean(checked.quote && checked.quote.totalAmount !== previousAmount));
      } catch (reason) {
        const problem = reason as AssistantError;
        if (problem.code === 'SCHEDULE_CONFLICT') { if (problem.state) accept(problem.state); setScreen('schedule'); setEditingReview(true); }
        throw reason;
      }
    });
  }
  async function continueStep() {
    if (!validCurrentStep()) return;
    if (editingReview || screen === 'schedule') { await review(); return; }
    await move(screen === 'service' ? 'address' : 'schedule');
  }
  async function confirm() {
    if (!context || confirming.current) return;
    const current = store.recordRef.current;
    if (!current?.quote || current.status !== 'reviewed' || store.dirty || savedProblem) { setError('Check the current price and dates again before confirming.'); return; }
    confirming.current = true;
    const input = { expectedUserId: context.customer.userId, draftId: current.draftId, revision: current.revision, quoteId: current.quote.quoteId };
    pendingConfirmation.current = input;
    await run('Saving your booking request…', async () => {
      try {
        const saved = await assistantApi.confirm(input);
        accept(saved); pendingConfirmation.current = null; setPriceChanged(false); setUncertain(false);
      } catch (reason) {
        const problem = reason as AssistantError;
        if (problem.code === 'REVIEW_REQUIRED' && problem.state) {
          pendingConfirmation.current = null;
          accept(problem.state); setScreen('review'); setPriceChanged(true); setUncertain(false);
          setNotice('The price changed. Review the updated estimate below, then select Confirm updated price to accept it.'); return;
        }
        if (problem.code === 'SCHEDULE_CONFLICT') { pendingConfirmation.current = null; if (problem.state) accept(problem.state); setScreen('schedule'); setEditingReview(true); setUncertain(false); throw reason; }
        if (!problem.status || problem.status >= 500) { setUncertain(true); setError('We could not verify the confirmation response. Check the saved result before editing or starting another booking.'); return; }
        throw reason;
      }
    });
    confirming.current = false;
  }
  async function recoverConfirmation() {
    if (!context) return;
    await run('Checking the saved booking result…', async () => {
      const current = await assistantApi.load(); verifyAssistantState(current, context.customer.userId);
      if (!current || current.draftId !== record?.draftId) {
        // A second tab may have started a new draft after this request completed.
        // The original confirmation can still retrieve its archived receipt.
        if (pendingConfirmation.current) {
          const original = await assistantApi.confirm(pendingConfirmation.current);
          accept(original); pendingConfirmation.current = null; setUncertain(false); return;
        }
        setDraftConflict(true); throw new Error('The saved draft changed in another session. Reload it before continuing.');
      }
      accept(current); setUncertain(false);
      if (current.status === 'completed') pendingConfirmation.current = null;
      if (current.status !== 'completed') { setScreen('review'); setNotice('No completed booking was found for this request. You can safely retry the same confirmation.'); }
    });
  }
  async function closeAssistant() {
    if (inFlight.current || confirming.current || addressEditorOpen) return;
    if (uncertain || authExpired || store.saveStatus === 'auth' || draftConflict || store.saveStatus === 'conflict') { setError('Resolve the saved draft or sign in again before closing so your changes are not lost.'); return; }
    await run('Saving before closing…', async () => {
      await store.flush(); setOpen(false);
      const url = new URL(window.location.href); url.searchParams.delete('assistant');
      window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
    });
  }
  function addressSaved(address: Address) {
    setContext(current => current ? { ...current, addresses: [address, ...current.addresses.filter(item => item.addressId !== address.addressId)] } : current);
    store.update({ serviceAddress: address.addressLine });
  }
  function chooseIssue(serviceCode: 'cleaning' | 'repair' | 'annual-cleaning', note?: string) {
    const service = options?.services.find(item => item.code === serviceCode);
    const bundle = options?.bundles.find(item => item.code === serviceCode);
    if (!service && !bundle) { setError('This service is currently unavailable. Reload the assistant to check again.'); return; }
    const notes = note && !draft.notes.includes(note) ? [draft.notes, note].filter(Boolean).join('\n') : draft.notes;
    if (notes.length > 1000) { setError('Shorten your technician notes before adding another symptom. Notes can contain up to 1,000 characters.'); return; }
    store.update({ serviceId: service?.serviceId, packageId: bundle?.packageId, ...(note ? { notes } : {}) });
    setNotice(note ? 'Service selected and your symptom added to the technician notes.' : 'Quarterly cleaning selected.'); setHelp(null);
  }

  return <Dialog open={open} onOpenChange={value => { if (value) setOpen(true); else void closeAssistant(); }}>
    <DialogContent id={dialogId} finalFocus={returnFocus} className="flex max-h-[92dvh] flex-col gap-0 overflow-hidden rounded-3xl p-0 sm:max-w-xl" aria-busy={Boolean(operation)}>
      <div className="shrink-0 border-b bg-primary/5 px-5 py-4 pr-12">
        <DialogTitle className="flex items-center gap-2 text-lg font-bold"><Bot className="size-6 text-primary" />CoolCare Assistant</DialogTitle>
        <DialogDescription className="mt-1">Book a service with guided steps. Your draft stays in your account.</DialogDescription>
        {context && screen !== 'menu' && screen !== 'success' && <ol className="mt-4 grid grid-cols-4 gap-2" aria-label="Booking progress">{steps.map((step, index) => <li key={step} aria-current={screen === step ? 'step' : undefined} className={'rounded-lg px-1 py-2 text-center text-xs ' + (screen === step ? 'bg-primary font-semibold text-white' : steps.indexOf(screen as AssistantStep) > index ? 'bg-primary/10 text-primary' : 'bg-background text-muted-foreground')}><span className="block text-[10px] opacity-80">Step {index + 1}</span><span className="mt-0.5 block">{labels[step]}</span></li>)}</ol>}
      </div>
      <div ref={body} className="min-h-0 space-y-4 overflow-y-auto p-5">
        {operation && <p role="status" className="text-sm text-muted-foreground">{operation}</p>}
        {(error || savedProblem) && <div role="alert" className="space-y-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <p>{error || store.saveError}</p>
          {(authExpired || store.saveStatus === 'auth') ? <><p>Your last successfully saved answers are kept in your account. Unsaved changes may need to be entered again.</p><a href="/#/login?returnTo=assistant" className="inline-block font-semibold underline">Sign in and resume booking</a></> :
            (draftConflict || store.saveStatus === 'conflict') ? <><p>Reloading replaces this screen with the latest saved answers from your account.</p><Button variant="outline" size="sm" disabled={Boolean(operation)} onClick={() => void loadAssistant(true)}>Reload saved draft</Button></> :
            store.saveStatus === 'error' && <Button variant="outline" size="sm" disabled={Boolean(operation)} onClick={() => void run('Retrying draft save…', async () => { await store.flush(true); setNotice('Your latest answers are saved.'); })}>Retry saving draft</Button>}
          {!context && !authExpired && <Button variant="outline" size="sm" disabled={Boolean(operation)} onClick={() => void loadAssistant(true)}>Reload assistant</Button>}
        </div>}
        {notice && <p role="status" className="rounded-xl bg-primary/5 p-3 text-sm text-primary">{notice}</p>}
        {uncertain && <div className="space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950"><p>Your request reference is preserved. Checking the result will not create another booking.</p><Button disabled={Boolean(operation)} onClick={recoverConfirmation}>Check saved booking result</Button></div>}
        {context && <>
          <div className="rounded-2xl rounded-tl-sm bg-muted p-4 text-sm leading-6" aria-live="polite">{screen === 'menu' && <p className="font-semibold">Hi {context.customer.fullName.split(' ')[0]}!</p>}{prompts[screen]}</div>
          {screen === 'menu' && <div className="grid gap-3">{record && record.status !== 'completed' ? <>
            <div className="rounded-xl border p-4 text-sm"><p className="font-semibold">A booking draft is ready to continue</p><p className="mt-1 text-muted-foreground">{selected.label || 'Service not selected'} · {draft.numberOfUnits} aircon units</p><p className="mt-1 text-xs text-muted-foreground">Last saved {formatDateTime(record.updatedAt)}</p><Button className="mt-3 w-full" onClick={resumeBooking} disabled={locked}>Resume saved booking</Button></div>
            <Button variant="outline" className="h-auto whitespace-normal py-3" onClick={() => void startBooking(true)} disabled={locked}>Discard saved draft and start again</Button>
          </> : <Button className="h-14 justify-start" onClick={() => void startBooking()} disabled={locked}><CalendarPlus />Create a new booking</Button>}</div>}
          {screen === 'service' && options && <fieldset disabled={locked} className="min-w-0 space-y-4">
            <div className="grid gap-2" aria-label="Service options">
              {options.services.map(service => {
                const active = draft.serviceId === service.serviceId && !draft.packageId;
                const Icon = service.code === 'repair' ? Wrench : Sparkles;
                const price = Number(service.basePrice) + (draft.numberOfUnits - 1) * Number(service.additionalUnitPrice);
                return <Button key={service.serviceId} variant="outline" aria-pressed={active} onClick={() => store.update({ serviceId: service.serviceId, packageId: undefined })} className={'h-auto items-start justify-start gap-3 whitespace-normal rounded-xl p-3 text-left ' + (active ? 'border-primary bg-primary/5' : '')}><Icon className="mt-1 size-5 text-primary" /><span className="flex-1"><span className="font-semibold">{service.name}</span><span className="mt-1 block text-xs font-normal text-muted-foreground">{service.code === 'repair' ? 'On-site diagnosis; repair work and parts quoted separately.' : 'One visit; your technician decides the cleaning method.'}</span><span className="mt-1 block text-sm text-primary">{formatMoney(price)} {service.code === 'repair' ? 'diagnosis visit' : 'per visit'}</span></span>{active && <Check className="size-4 text-primary" />}</Button>;
              })}
              {options.bundles.filter(bundle => bundle.code === 'annual-cleaning').map(bundle => {
                const price = Number(bundle.price) + Math.max(0, draft.numberOfUnits - Number(bundle.includedUnits)) * Number(bundle.additionalUnitPrice);
                const amounts = annualVisitAmounts(price);
                return <Button key={bundle.packageId} variant="outline" aria-pressed={draft.packageId === bundle.packageId} onClick={() => store.update({ packageId: bundle.packageId, serviceId: undefined })} className={'h-auto items-start justify-start gap-3 whitespace-normal rounded-xl p-3 text-left ' + (draft.packageId === bundle.packageId ? 'border-primary bg-primary/5' : '')}><CalendarDays className="mt-1 size-5 text-primary" /><span className="flex-1"><span className="font-semibold">Annual Cleaning Bundle</span><span className="mt-1 block text-xs font-normal text-muted-foreground">Four quarterly cleaning visits at one address.</span><span className="mt-1 block text-sm text-primary">{formatMoney(price)} per year · {amounts.every(amount => amount === amounts[0]) ? formatMoney(amounts[0]) + ' per visit' : 'split across four visits'}</span></span>{draft.packageId === bundle.packageId && <Check className="size-4 text-primary" />}</Button>;
              })}
            </div>
            <div><label htmlFor="assistant-unit-count" className="mb-2 block text-sm font-semibold">Number of aircon units</label><NativeSelect id="assistant-unit-count" value={draft.numberOfUnits} onChange={event => store.update({ numberOfUnits: Number(event.target.value) })}>{Array.from({ length: 10 }, (_, index) => index + 1).map(count => <option key={count} value={count}>{count} {count === 1 ? 'aircon unit' : 'aircon units'}</option>)}</NativeSelect></div>
            <Button variant="outline" className="w-full" aria-expanded={help === 'service'} onClick={() => setHelp(help === 'service' ? null : 'service')}><HelpCircle className="size-4" />Help me choose a service</Button>
          </fieldset>}
          {screen === 'address' && <fieldset disabled={locked} className="min-w-0 space-y-4">
            <BookingAddressField key={context.customer.userId} expectedUserId={context.customer.userId} addresses={context.addresses} value={draft.serviceAddress} onChange={value => store.update({ serviceAddress: value })} onAddressSaved={addressSaved} onEditingChange={setAddressEditorOpen} />
            <div><label htmlFor="assistant-phone" className="mb-2 block text-sm font-medium">Contact phone</label><Input id="assistant-phone" type="tel" autoComplete="tel" maxLength={30} value={draft.phone} aria-invalid={Boolean(phoneError)} aria-describedby="assistant-phone-help" onBlur={() => setPhoneTouched(true)} onChange={event => store.update({ phone: event.target.value })} /><p id="assistant-phone-help" className={'mt-2 text-xs ' + (phoneError ? 'text-red-700' : 'text-muted-foreground')}>{phoneError || 'Singapore: 8 digits, or +country code for an international number.'}</p></div>
            <div><label htmlFor="assistant-notes" className="mb-2 block text-sm font-medium">Notes for the technician (optional)</label><Textarea id="assistant-notes" maxLength={1000} value={draft.notes} onChange={event => store.update({ notes: event.target.value })} /><p className="mt-1 text-right text-xs text-muted-foreground">{draft.notes.length}/1000</p></div>
          </fieldset>}
          {screen === 'schedule' && <fieldset disabled={locked} className="min-w-0 space-y-4">
            <p className="rounded-xl bg-primary/5 p-3 text-sm leading-6">{bookingScheduleNotice}</p>
            <div className="space-y-2 text-sm font-medium"><label htmlFor="assistant-date">{annual ? 'First preferred visit date' : 'Preferred date'}</label><EnglishDatePicker id="assistant-date" min={earliestBookingDate()} disabled={locked} aria-invalid={Boolean(bookingDateError(draft.preferredDate)) || availability.selectedDateBlocked} value={draft.preferredDate} blockedDates={availability.blockedDates} onMonthChange={availability.onMonthChange} onChange={value => { store.update({ preferredDate: value }); setConflicts([]); setError(''); }} /></div>
            {availability.checking && <p role="status" className="text-xs text-muted-foreground">Checking dates at this address…</p>}
            {availability.selectedDateBlocked && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{bookingConflictMessage}</p>}
            {availability.error && <p className="text-xs text-muted-foreground">The calendar check is unavailable. All dates will be checked before confirmation.</p>}
            {conflicts.length > 0 && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800"><p className="font-semibold">Choose another first date to resolve these visits:</p><ul className="mt-2 space-y-2">{conflicts.map(item => <li key={item.visitNumber}><strong>Visit {item.visitNumber} · {formatDate(item.preferredDate)}</strong><br />{item.message}</li>)}</ul></div>}
            <p className="text-sm font-medium">Preferred arrival window</p><div className="grid grid-cols-2 gap-2">{times.map(time => <Button key={time} className="h-auto whitespace-normal py-3" disabled={!slotAvailability.isAvailable(timeCodes[time])} variant={draft.timeWindow === time ? 'default' : 'outline'} aria-pressed={draft.timeWindow === time} onClick={() => store.update({ timeWindow: time })}>{time}{slotAvailability.isAvailable(timeCodes[time])?'':' · Fully booked'}</Button>)}</div>
            {slotAvailability.loading&&<p className="text-xs text-muted-foreground">Checking team availability…</p>}{selectedSlotFull&&<p role="alert" className="text-xs text-red-700">This service time is fully booked.</p>}
            {annual && <AnnualBookingSummary firstDate={draft.preferredDate} timeSlot={draft.timeWindow} totalAmount={selected.estimate} collapsible />}
            <p className="text-xs leading-5 text-muted-foreground">All {annual ? 'four dates' : 'dates'} are checked before review and again on confirmation. {bookingFrequencyNotice}</p>
          </fieldset>}
          {(screen === 'review' || screen === 'success') && <>
            {receipt && <div role="status" className="rounded-xl bg-emerald-50 p-4 text-emerald-900"><p className="flex items-center gap-2 font-bold"><CheckCircle2 className="size-5" />{receipt.annualBundle ? 'Four booking requests saved' : 'Booking #' + bookingId}</p><p className="mt-1">Status: {bookingStatusLabel(receipt.status)}</p></div>}
            {receipt && bookingId && <div className="grid gap-2"><Button nativeButton={false} render={<Link href={'/customer/bookings/' + bookingId} />} onClick={() => void closeAssistant()} className="w-full">View this booking</Button><a href={bookingSupportLink(receipt.bookingReference || '#' + bookingId)} className="inline-flex items-center justify-center gap-2 py-2 text-sm font-medium text-primary underline underline-offset-4"><Mail className="size-4" />Contact support about this booking</a></div>}
            {priceChanged && !receipt && <div role="status" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">The current estimate differs from the earlier price. Review the updated amount before confirming.</div>}
            <div className="space-y-3 rounded-xl border p-4 text-sm">
              {[
                { key: 'service' as AssistantStep, title: 'Service & quantity', value: (quote?.serviceName || selected.label || 'Service unavailable') + ' · ' + draft.numberOfUnits + ' aircon unit(s)' },
                { key: 'address' as AssistantStep, title: 'Address & contact', value: draft.serviceAddress + '\n' + draft.phone },
                { key: 'schedule' as AssistantStep, title: annual ? 'First preferred visit' : 'Preferred visit', value: formatDate(draft.preferredDate) + '\n' + formatTimeSlot(draft.timeWindow) },
              ].map(item => <div key={item.key} className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-xs text-muted-foreground">{item.title}</p><p className="mt-1 whitespace-pre-line break-words font-medium">{item.value}</p></div>{!receipt && <Button variant="ghost" size="sm" disabled={locked || savedProblem} aria-label={'Edit ' + item.title.toLowerCase()} onClick={() => edit(item.key)}><Pencil className="size-3" />Edit</Button>}</div>)}
              {draft.notes && <div><p className="text-xs text-muted-foreground">Technician notes</p><p className="mt-1 whitespace-pre-line break-words">{draft.notes}</p></div>}
              <div className="flex items-baseline justify-between gap-3 border-t pt-3"><span>{annual ? 'Annual estimate' : 'Visit estimate'} · SGD</span><strong className="text-xl text-primary">{formatMoney(receipt?.annualBundle?.totalAmount ?? receipt?.totalAmount ?? estimate)}</strong></div>
            </div>
            {annual && <AnnualBookingSummary firstDate={draft.preferredDate} timeSlot={draft.timeWindow} totalAmount={estimate} saved={receipt?.annualBundle} compact />}
            {selected.pricingNote && <p className="text-xs leading-5 text-muted-foreground">{selected.pricingNote}</p>}
            {!receipt && <p className="text-xs leading-5 text-muted-foreground">Your request will be saved as Awaiting confirmation. Preferred dates and times still need the service team's confirmation.</p>}
            {receipt?.emailNotification && <p role="status" className="text-sm text-muted-foreground">{bookingEmailMessage(receipt.emailNotification)}</p>}
          </>}
          {screen !== 'menu' && screen !== 'review' && screen !== 'success' && selected.valid && <details className="rounded-xl border p-3 text-sm"><summary className="cursor-pointer font-medium">Your selected answers</summary><dl className="mt-3 space-y-2 text-xs"><div><dt className="text-muted-foreground">Service</dt><dd>{selected.label} · {draft.numberOfUnits} unit(s) · {formatMoney(selected.estimate)} {annual ? 'per year' : 'per visit'}</dd></div>{draft.serviceAddress && <div><dt className="text-muted-foreground">Address</dt><dd className="break-words">{draft.serviceAddress}</dd></div>}{draft.preferredDate && <div><dt className="text-muted-foreground">Preferred date</dt><dd>{formatDate(draft.preferredDate)} · {formatTimeSlot(draft.timeWindow)}</dd></div>}</dl></details>}
          {screen !== 'success' && <div className="border-t pt-3">
            <div className="flex flex-wrap gap-2" aria-label="Booking help">{([{ id: 'pricing', label: 'Prices & inclusions' }, { id: 'dates', label: 'Booking rules' }, { id: 'changes', label: 'Change a request' }] as const).map(topic => <Button key={topic.id} variant="outline" size="sm" aria-expanded={help === topic.id} onClick={() => setHelp(help === topic.id ? null : topic.id)}>{topic.label}<ChevronDown className="size-3" /></Button>)}</div>
            {help === 'service' && <div className="mt-3 space-y-3 rounded-xl bg-muted p-3 text-sm"><p>Choose the closest description. Your technician will assess the cause on site.</p><div className="grid grid-cols-2 gap-2">{homepageIssues.map(issue => <Button key={issue.id} variant="outline" disabled={locked} className="h-auto whitespace-normal py-2" onClick={() => chooseIssue(issue.id === 'needs-cleaning' ? 'cleaning' : 'repair', issue.name + ': ' + issue.description)}>{issue.name}</Button>)}</div><Button variant="outline" disabled={locked} className="w-full h-auto whitespace-normal py-2" onClick={() => chooseIssue('annual-cleaning')}>I want quarterly cleaning all year</Button></div>}
            {help === 'pricing' && <div className="mt-3 rounded-xl bg-muted p-3 text-sm leading-6"><p>Prices use your selected AC count and the current service catalogue. Repair covers diagnosis; labour and replacement parts require a separate quote. Cleaning covers routine care; the technician decides whether chemical treatment is needed and asks for approval for extra work.</p>{selected.valid && <p className="mt-2 font-semibold">{selected.label}: {formatMoney(selected.estimate)} {annual ? 'for all four visits, paid after each service' : 'for this visit'}.</p>}<p className="mt-2">The final review checks the current price. A changed price needs your confirmation again.</p></div>}
            {help === 'dates' && <div className="mt-3 rounded-xl bg-muted p-3 text-sm leading-6">{bookingScheduleNotice} {bookingFrequencyNotice} Annual care includes four visits every three months; later weekend dates move to Monday. All slots await confirmation.</div>}
            {help === 'changes' && <div className="mt-3 rounded-xl bg-muted p-3 text-sm leading-6">Before submitting, use Edit on the review to change your answers. After booking, unassigned requests awaiting confirmation can be changed from the booking detail page. For an assigned visit, <a href={supportHref} className="font-medium text-primary underline">email support</a>.</div>}
            <a href={supportHref} className="mt-3 inline-flex items-center gap-2 text-xs font-medium text-primary underline underline-offset-4"><Mail className="size-3" />Contact support</a>
          </div>}
        </>}
      </div>
      {context && <div className="shrink-0 border-t bg-background p-4">
        {record?.status !== 'completed' && <p role="status" className={'mb-3 text-xs ' + (savedProblem ? 'text-red-700' : 'text-muted-foreground')}>{store.saveStatus === 'saving' ? 'Saving your answers to your account…' : store.saveStatus === 'dirty' ? 'Changes waiting to save…' : store.saveStatus === 'saved' ? 'Draft saved to your account. You can resume after signing in.' : store.saveStatus === 'error' ? 'Latest changes are not saved. Retry saving before continuing.' : store.saveStatus === 'conflict' ? 'Another session changed this draft.' : store.saveStatus === 'auth' ? 'Sign in to continue saving.' : 'Start a booking to save your draft.'}</p>}
        <div className="flex flex-wrap items-center justify-between gap-2">
          {screen !== 'menu' && screen !== 'success' && <Button variant="outline" disabled={locked || savedProblem || addressEditorOpen} onClick={() => screen === 'service' ? setScreen('menu') : void move(steps[Math.max(0, steps.indexOf(screen as AssistantStep) - 1)])}>Back</Button>}
          {(['service', 'address', 'schedule'] as Screen[]).includes(screen) && <Button disabled={locked || savedProblem || addressEditorOpen || (screen === 'service' && !selected.valid) || (screen === 'schedule' && availability.selectedDateBlocked)} onClick={continueStep}>{editingReview ? 'Return to review' : screen === 'schedule' ? 'Review booking' : 'Continue'}</Button>}
          {screen === 'review' && !receipt && (record?.status !== 'reviewed' || !quote || store.dirty ? <Button disabled={locked || savedProblem || !canReview} onClick={review}>Check price &amp; dates again</Button> : <Button disabled={locked || savedProblem} onClick={confirm}>{priceChanged ? 'Confirm updated price' : 'Confirm booking'}</Button>)}
          {screen === 'success' && <Button variant="outline" className="w-full" disabled={locked} onClick={() => void startBooking(true)}><CalendarPlus className="size-4" />Book another service</Button>}
        </div>
      </div>}
    </DialogContent>
  </Dialog>;
}
