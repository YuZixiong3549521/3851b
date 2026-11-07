'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Bot, CalendarPlus, CheckCircle2, HelpCircle, Mail, MessageCircle, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { BookingServiceSelection, bookingChangeNotice, bookingConfirmationNotice, bookingFrequencyNotice, getBookingSelection } from '@/components/booking-service-selection';
import { bookingStatusLabel } from '@/components/booking-status';
import { AnnualBookingSummary } from '@/components/annual-booking-summary';
import { BookingAddressField } from '@/components/booking-address-field';
import { BookingRewardSelection } from '@/components/booking-reward-selection';
import { AssistantFaqChat } from '@/components/assistant-faq-chat';
import { EnglishDatePicker } from '@/components/english-date-picker';
import { bookingConflictMessage } from '@/components/booking-availability-notice';
import { useBookingAvailability } from '@/lib/use-booking-availability';
import { useSlotAvailability } from '@/lib/use-slot-availability';
import { useAssistantDraft } from '@/lib/use-assistant-draft';
import { assistantIssueSelection } from '@/lib/assistant-guidance';
import { assistantApi, emptyAssistantDraft, verifyAssistantState, type AssistantConflict, type AssistantError, type AssistantState, type AssistantStep } from '@/lib/assistant-api';
import { coolcareApi } from '@/lib/coolcare-api';
import { formatDate, formatDateTime, formatMoney, formatTimeSlot, formatServiceWindow } from '@/lib/format';
import { annualVisitAmounts,annualVisitDates } from '@/lib/annual-booking';
import { bookingDateError, bookingScheduleNotice, earliestBookingDate } from '@/lib/booking-schedule';
import { bookingSupportLink, customerSupportEmail } from '@/lib/customer-support';
import { phoneNumberError } from '@/lib/phone-number.mjs';
import { homepageIssues } from '@/lib/homepage-offers';
import type { Address, BookingOptions, CustomerContext } from '@/lib/coolcare-types';

type Screen = 'menu' | AssistantStep | 'success';
type HelpTopic = 'service' | null;
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
  success: 'Your booking request was saved. Open the booking for its latest appointment and service details.',
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
  const [chatOpen, setChatOpen] = useState(true);
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
  const [rewardsValid, setRewardsValid] = useState(true);
  const [rewardRefresh, setRewardRefresh] = useState(0);
  const [closeWarning, setCloseWarning] = useState(false);
  const [discardWarning, setDiscardWarning] = useState(false);
  const [issueProposal, setIssueProposal] = useState<{ code: 'cleaning' | 'repair' | 'annual-cleaning'; note?: string; label: string } | null>(null);
  const preserveOnOpen = useRef(false);
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
    if (preserveOnOpen.current) {
      // Closing a panel must not hydrate over unsaved answers or forget the UUID
      // of a confirmation whose response was lost. Recovery remains explicit.
      preserveOnOpen.current = false;
    } else void loadAssistant(resumeOnOpen.current);
    resumeOnOpen.current = false;
  }, [open]);
  useEffect(() => { body.current?.scrollTo({ top: 0 }); }, [screen]);

  const selection = draft.packageId ? { mode: 'bundle' as const, packageId: draft.packageId, propertyType: draft.propertyType, serviceIds: [] } : { mode: 'custom' as const, serviceIds: draft.serviceIds ?? (draft.serviceId ? [draft.serviceId] : []) };
  const selected = getBookingSelection(options, selection, draft.numberOfUnits);
  const locked = Boolean(operation || uncertain || authExpired || draftConflict || ['conflict', 'auth'].includes(store.saveStatus));
  const availability = useBookingAvailability({ serviceAddress: draft.serviceAddress, selectedDate: draft.preferredDate, serviceIds: selected.payload.serviceIds, packageId: selected.payload.packageId, enabled: Boolean(open && context && screen === 'schedule' && !locked) });
  const annual = Boolean(draft.packageId);
  const slotDates=annual?annualVisitDates(draft.preferredDate):draft.preferredDate?[draft.preferredDate]:[];
  const slotAvailability=useSlotAvailability(slotDates,Boolean(open&&context&&screen==='schedule'&&!locked),selected.durationMinutes,undefined,draft.numberOfUnits);
  const selectedSlotFull=Boolean(draft.timeWindow&&!slotAvailability.isAvailable(timeCodes[draft.timeWindow]));
  const receipt = record?.status === 'completed' ? record.booking : null;
  const currentBooking = record?.currentBooking;
  const receiptReward = currentBooking ? currentBooking.rewardReservation : receipt?.rewardReservation;
  const quote = record?.quote;
  const estimate = quote && !store.dirty && (screen === 'review' || screen === 'success') ? quote.totalAmount : selected.estimate;
  const rewardAmount = annual ? annualVisitAmounts(estimate)[0] : estimate;
  const phoneError = phoneTouched ? phoneNumberError(draft.phone) : '';
  const canReview = selected.valid && !phoneNumberError(draft.phone) && draft.serviceAddress.trim().length >= 5 && !bookingDateError(draft.preferredDate) && Boolean(draft.timeWindow) && !selectedSlotFull;
  const savedProblem = ['error', 'conflict', 'auth'].includes(store.saveStatus);
  const bookingId = receipt?.id ?? receipt?.bookingId;
  const chatActive = chatOpen && Boolean(context) && !closeWarning;

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
    setChatOpen(false);
    const problem = reason as AssistantError;
    const fields = problem.details?.fieldErrors;
    const messages = fields ? Object.values(fields).flatMap(value => Array.isArray(value) ? value : [value]).filter(Boolean) : [];
    setError(messages.length ? messages.join(' ') : problem.message || 'Unable to complete this step. Please retry.');
    if (problem.status === 401 || problem.status === 403 || problem.code === 'ACCOUNT_CHANGED') setAuthExpired(true);
    if (problem.code === 'DRAFT_CONFLICT') setDraftConflict(true);
    if (problem.details?.conflicts) setConflicts(problem.details.conflicts);
    if (problem.code === 'REWARD_SELECTION_INVALID') { setScreen('review'); setRewardRefresh(value => value + 1); }
    if (fields && problem.code === 'VALIDATION_ERROR') {
      const field = Object.keys(fields)[0];
      if (['phone', 'postalCode', 'serviceAddress', 'notes'].includes(field)) { setScreen('address'); setPhoneTouched(true); }
      else if (['serviceId', 'serviceIds', 'propertyType', 'packageId', 'numberOfUnits'].includes(field)) setScreen('service');
      else if (['preferredDate', 'timeWindow'].includes(field)) setScreen('schedule');
      else if (['rewardPoints', 'rewardRuleVersion'].includes(field)) setScreen('review');
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
      const defaultAddress = nextContext.addresses.find(address => address.isDefault) ?? nextContext.addresses[0];
      const defaults = { ...emptyAssistantDraft, preferredDate: earliestBookingDate(), serviceAddress: defaultAddress?.addressLine || '', postalCode: defaultAddress?.postalCode || '', phone: nextContext.customer.phone || '' };
      store.hydrate(nextState, nextContext.customer.userId, defaults);
      setAuthExpired(false); setDraftConflict(false); setUncertain(false); setConflicts([]); setEditingReview(false); setPriceChanged(false); setCloseWarning(false); setDiscardWarning(false); setIssueProposal(null);
      setScreen(nextState?.status === 'completed' ? 'success' : resume && nextState ? nextState.draft.step : 'menu');
      setChatOpen(!resume && nextState?.status !== 'completed');
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
    if (!context || uncertain || confirming.current) return;
    setChatOpen(false);
    await run('Preparing your booking…', async () => {
      // Finish/reconcile every prior save before resetting the durable draft.
      await store.flush(true);
      setOptions(await coolcareApi.getBookingOptions());
      let current = store.recordRef.current;
      if (current && reset) {
        current = await assistantApi.startNew({ expectedUserId: context.customer.userId, draftId: current.draftId, revision: current.revision });
        store.hydrate(current, context.customer.userId);
      }
      setNotice(''); setConflicts([]); setEditingReview(false); setPriceChanged(false); setPhoneTouched(false); setDiscardWarning(false); setIssueProposal(null);
      pendingConfirmation.current = null;
      const defaultAddress = context.addresses.find(address => address.isDefault) ?? context.addresses[0];
      store.update({ step: 'service', preferredDate: earliestBookingDate(), serviceAddress: defaultAddress?.addressLine || '', postalCode: defaultAddress?.postalCode || '', phone: context.customer.phone || '', notes: '', serviceId: undefined, serviceIds: [], propertyType: undefined, packageId: undefined, rewardPoints: 0, rewardRuleVersion: undefined });
      await store.flush(true); setScreen('service');
    });
  }
  function resumeBooking() { setChatOpen(false); setNotice('Your saved answers have been restored.'); setScreen(record?.draft.step ?? 'service'); }
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
    if (screen === 'service' && !selected.valid) { setError('Choose your service(s) and, for an annual bundle, your property type.'); return false; }
    if (screen === 'address') {
      setPhoneTouched(true);
      if (addressEditorOpen) return false;
      if (draft.serviceAddress.trim().length < 5 || draft.serviceAddress.trim().length > 255) { setError('Enter a service address between 5 and 255 characters.'); return false; }
      if(draft.postalCode && !/^\d{6}$/.test(draft.postalCode)){setError('Enter a six-digit Singapore postal code.');return false;}
      const message = phoneNumberError(draft.phone);
      if (message) { setError(message); return false; }
    }
    if (screen === 'schedule') {
      const message = bookingDateError(draft.preferredDate) || (!draft.timeWindow ? 'Choose a preferred arrival window.' : '') || (availability.selectedDateBlocked ? bookingConflictMessage : '') || (slotAvailability.error ? 'Service times could not be checked. Retry the availability check before continuing.' : !slotAvailability.checked ? 'Wait for the service time check before continuing.' : '') || (selectedSlotFull?'This service time is fully booked. Choose another available time.':'');
      if (message) { setError(message); return false; }
    }
    return true;
  }
  async function review() {
    if (!context || !validCurrentStep()) return;
    if (screen === 'review' && !rewardsValid) { setError('Check your selected loyalty points before reviewing this booking.'); return; }
    await run('Checking prices and all visit dates…', async () => {
      const previousAmount = store.recordRef.current?.quote?.totalAmount ?? selected.estimate;
      store.update({ step: 'review' });
      const saved = await store.flush();
      if (!saved) throw new Error('Save your answers before requesting a review.');
      if (saved.status === 'completed') { accept(saved); return; }
      // Keep the points selector reachable if the saved selection is no longer usable.
      setScreen('review');
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
    if (!current?.quote || current.status !== 'reviewed' || store.dirty || savedProblem || !rewardsValid) { setError('Check the current price, loyalty points and dates again before confirming.'); return; }
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
          setRewardRefresh(value => value + 1);
          setNotice('The price or reward conversion changed. Review the updated amounts below, then select Confirm updated price to accept them.'); return;
        }
        if (problem.code === 'SCHEDULE_CONFLICT') { pendingConfirmation.current = null; if (problem.state) accept(problem.state); setScreen('schedule'); setEditingReview(true); setUncertain(false); throw reason; }
        if (!problem.status || problem.status >= 500) { setUncertain(true); setError('We could not verify the confirmation response. Check the saved result before editing or starting another booking.'); return; }
        pendingConfirmation.current = null;
        setRewardRefresh(value => value + 1);
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
  function dismissAssistant() {
    preserveOnOpen.current = Boolean(store.dirty || store.savingRef.current || uncertain || pendingConfirmation.current || inFlight.current || confirming.current || addressEditorOpen || savedProblem || authExpired || draftConflict);
    setCloseWarning(false); setOpen(false);
    const url = new URL(window.location.href); url.searchParams.delete('assistant');
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
  }
  function closeAssistant() {
    if (store.dirty || store.savingRef.current || uncertain || inFlight.current || confirming.current || addressEditorOpen) {
      setChatOpen(false); setCloseWarning(true); body.current?.scrollTo({ top: 0 }); return;
    }
    dismissAssistant();
  }
  function addressSaved(address: Address) {
    setContext(current => current ? { ...current, addresses: [address, ...current.addresses.filter(item => item.addressId !== address.addressId)] } : current);
    store.update({ serviceAddress: address.addressLine, postalCode: address.postalCode || '' });
  }
  function chooseIssue(serviceCode: 'cleaning' | 'repair' | 'annual-cleaning', note?: string, replace = false) {
    if (!options || locked) return;
    try {
      const result = assistantIssueSelection(draft, options, serviceCode, note);
      if (result.replacesSelection && !replace) { setIssueProposal({ code: serviceCode, note, label: result.label }); return; }
      store.update(result.patch); setIssueProposal(null); setError('');
      setNotice(note ? 'Your symptom was added to the technician notes. Existing compatible services are kept.' : 'Quarterly cleaning selected. Choose your property type to review the price.'); setHelp(null);
    } catch (reason) { handleError(reason); }
  }

  return <Dialog open={open} onOpenChange={value => { if (value) setOpen(true); else void closeAssistant(); }}>
    <DialogContent id={dialogId} finalFocus={returnFocus} className="flex h-[88dvh] max-h-[800px] flex-col gap-0 overflow-hidden rounded-3xl p-0 shadow-xl sm:top-auto sm:right-6 sm:bottom-6 sm:left-auto sm:h-[min(800px,calc(100dvh-48px))] sm:max-w-lg sm:translate-x-0 sm:translate-y-0" aria-busy={Boolean(operation)}>
      <div className="shrink-0 border-b bg-background px-4 py-4 pr-12">
        <div className="flex items-center gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-primary text-primary-foreground"><Bot className="size-6" aria-hidden="true" /></span><div><DialogTitle className="text-base font-bold">CoolCare Assistant</DialogTitle><DialogDescription className="mt-1 text-xs">Guided booking &amp; quick answers</DialogDescription></div></div>
        {context && <div className="mt-4 flex gap-1 rounded-xl bg-muted p-1" role="group" aria-label="Assistant views"><Button variant={chatActive ? 'default' : 'ghost'} size="sm" className="flex-1 rounded-lg" aria-pressed={chatActive} disabled={Boolean(operation) || closeWarning} onClick={() => setChatOpen(true)}><MessageCircle className="size-4" />Chat &amp; FAQs</Button><Button variant={!chatActive ? 'default' : 'ghost'} size="sm" className="flex-1 rounded-lg" aria-pressed={!chatActive} disabled={Boolean(operation) || closeWarning} onClick={() => setChatOpen(false)}><CalendarPlus className="size-4" />Booking</Button></div>}
        {context && !chatActive && screen !== 'menu' && screen !== 'success' && <ol className="mt-3 grid grid-cols-4 gap-2" aria-label="Booking progress">{steps.map((step, index) => <li key={step} aria-current={screen === step ? 'step' : undefined} className={'rounded-lg px-1 py-2 text-center text-xs ' + (screen === step ? 'bg-primary font-semibold text-white' : steps.indexOf(screen as AssistantStep) > index ? 'bg-primary/10 text-primary' : 'bg-background text-muted-foreground')}><span className="block text-[10px] opacity-80">Step {index + 1}</span><span className="mt-0.5 block">{labels[step]}</span></li>)}</ol>}
      </div>
      {context && <AssistantFaqChat key={context.customer.userId} firstName={context.customer.fullName.split(' ')[0]} options={options} active={chatActive} bookingDisabled={locked || savedProblem || addressEditorOpen} hasDraft={Boolean(record && record.status !== 'completed')} onBooking={() => record && record.status !== 'completed' ? resumeBooking() : void startBooking(Boolean(record))} supportHref={supportHref} />}
      <div ref={body} hidden={chatActive} className={chatActive ? 'hidden' : 'min-h-0 flex-1 space-y-4 overflow-y-auto bg-muted/25 p-4'}>
        {closeWarning && <div role="alert" className="space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950"><p className="font-semibold">Close the assistant for now?</p><p>{uncertain || confirming.current ? 'Your confirmation request is preserved. Reopen the assistant to check the same result before starting another booking.' : 'Your last saved draft stays in your account. Unsaved booking answers remain in this page while it stays open; refreshing or signing out can discard them.'}</p>{addressEditorOpen && <p>An unfinished new-address form will be closed. Save that address first to keep it, or check Saved addresses if its save was already in progress.</p>}<div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => setCloseWarning(false)}>Keep editing</Button><Button onClick={dismissAssistant}>Close for now</Button></div></div>}
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
          <div className="rounded-2xl rounded-tl-sm border bg-card p-4 text-sm leading-6 shadow-xs" aria-live="polite">{screen === 'menu' && <p className="font-semibold">Ready when you are.</p>}{prompts[screen]}</div>
          {screen === 'menu' && <div className="grid gap-3">{record && record.status !== 'completed' ? <>
            <div className="rounded-xl border p-4 text-sm"><p className="font-semibold">A booking draft is ready to continue</p><p className="mt-1 text-muted-foreground">{selected.label || 'Service not selected'} · {draft.numberOfUnits} aircon units</p><p className="mt-1 text-xs text-muted-foreground">Last saved {formatDateTime(record.updatedAt)}</p><Button className="mt-3 w-full" onClick={resumeBooking} disabled={locked}>Resume saved booking</Button></div>
            {!discardWarning ? <Button variant="outline" className="h-auto whitespace-normal py-3" onClick={() => setDiscardWarning(true)} disabled={locked}>Discard saved draft and start again</Button> : <div role="alert" className="space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm"><p className="font-semibold">Replace your saved answers?</p><p>Your service, address, schedule and notes in this draft will be replaced. Existing bookings are unaffected.</p><div className="flex flex-wrap gap-2"><Button variant="outline" disabled={locked} onClick={() => setDiscardWarning(false)}>Keep draft</Button><Button disabled={locked} onClick={() => void startBooking(true)}>Start again</Button></div></div>}
          </> : <Button className="h-14 justify-start" onClick={() => void startBooking()} disabled={locked}><CalendarPlus />Create a new booking</Button>}</div>}
          {screen === 'service' && options && <fieldset disabled={locked} className="min-w-0 space-y-4">
            <BookingServiceSelection options={options} value={selection} onChange={value=>store.update({serviceId:undefined,serviceIds:value.serviceIds,packageId:value.mode==='bundle'?value.packageId:undefined,propertyType:value.mode==='bundle'?value.propertyType:undefined})} />
            <div><label htmlFor="assistant-unit-count" className="mb-2 block text-sm font-semibold">Number of aircon units</label><NativeSelect id="assistant-unit-count" value={draft.numberOfUnits} onChange={event => store.update({ numberOfUnits: Number(event.target.value) })}>{Array.from({ length: 20 }, (_, index) => index + 1).map(count => <option key={count} value={count}>{count} {count === 1 ? 'aircon unit' : 'aircon units'}</option>)}</NativeSelect></div>
            <Button variant="outline" className="w-full" aria-expanded={help === 'service'} onClick={() => setHelp(help === 'service' ? null : 'service')}><HelpCircle className="size-4" />Help me choose a service</Button>
          </fieldset>}
          {screen === 'address' && <fieldset disabled={locked} className="min-w-0 space-y-4">
            <BookingAddressField key={context.customer.userId} expectedUserId={context.customer.userId} addresses={context.addresses} value={draft.serviceAddress} postalCode={draft.postalCode} onPostalCodeChange={postalCode=>store.update({postalCode})} onChange={value => store.update({ serviceAddress: value })} onAddressSaved={addressSaved} onEditingChange={setAddressEditorOpen} />
            <div><label htmlFor="assistant-phone" className="mb-2 block text-sm font-medium">Contact phone</label><Input id="assistant-phone" type="tel" autoComplete="tel" maxLength={30} value={draft.phone} aria-invalid={Boolean(phoneError)} aria-describedby="assistant-phone-help" onBlur={() => setPhoneTouched(true)} onChange={event => store.update({ phone: event.target.value })} /><p id="assistant-phone-help" className={'mt-2 text-xs ' + (phoneError ? 'text-red-700' : 'text-muted-foreground')}>{phoneError || 'Singapore: 8 digits, or +country code for an international number.'}</p></div>
            <div><label htmlFor="assistant-notes" className="mb-2 block text-sm font-medium">Problem / Other remarks (optional)</label><Textarea id="assistant-notes" maxLength={1000} value={draft.notes} onChange={event => store.update({ notes: event.target.value })} /><p className="mt-1 text-right text-xs text-muted-foreground">{draft.notes.length}/1000</p></div>
          </fieldset>}
          {screen === 'schedule' && <fieldset disabled={locked} className="min-w-0 space-y-4">
            <p className="rounded-xl bg-primary/5 p-3 text-sm leading-6">{bookingScheduleNotice}</p>
            <div className="space-y-2 text-sm font-medium"><label htmlFor="assistant-date">{annual ? 'First preferred visit date' : 'Preferred date'}</label><EnglishDatePicker id="assistant-date" min={earliestBookingDate()} disabled={locked} aria-invalid={Boolean(bookingDateError(draft.preferredDate)) || availability.selectedDateBlocked} value={draft.preferredDate} blockedDates={availability.blockedDates} onMonthChange={availability.onMonthChange} onChange={value => { store.update({ preferredDate: value }); setConflicts([]); setError(''); }} /></div>
            {availability.checking && <p role="status" className="text-xs text-muted-foreground">Checking dates at this address…</p>}
            {availability.selectedDateBlocked && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{bookingConflictMessage}</p>}
            {availability.error && <p className="text-xs text-muted-foreground">The calendar check is unavailable. All dates will be checked before confirmation.</p>}
            {conflicts.length > 0 && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800"><p className="font-semibold">Choose another first date to resolve these visits:</p><ul className="mt-2 space-y-2">{conflicts.map(item => <li key={item.visitNumber}><strong>Visit {item.visitNumber} · {formatDate(item.preferredDate)}</strong><br />{item.message}</li>)}</ul></div>}
            <p className="text-sm font-medium">Preferred service time</p><div className="grid grid-cols-2 gap-2">{times.map(time => <Button key={time} className="h-auto whitespace-normal py-3" disabled={locked || !slotAvailability.checked || !slotAvailability.isAvailable(timeCodes[time])} variant={draft.timeWindow === time ? 'default' : 'outline'} aria-pressed={draft.timeWindow === time} onClick={() => store.update({ timeWindow: time })}>{formatServiceWindow(time,selected.durationMinutes)}{!slotAvailability.checked ? ' · Not checked' : slotAvailability.isAvailable(timeCodes[time]) ? '' : ' · Unavailable'}</Button>)}</div>
            {slotAvailability.loading && <p role="status" className="text-xs text-muted-foreground">Checking team availability…</p>}
            {slotAvailability.error && <div role="alert" className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm"><p>Unable to check service times. Availability has not been confirmed.</p><Button variant="outline" size="sm" onClick={slotAvailability.retry} disabled={locked}>Retry availability check</Button></div>}
            {selectedSlotFull && <p role="alert" className="text-xs text-red-700">This service time is fully booked.</p>}
            {annual && <AnnualBookingSummary durationMinutes={selected.durationMinutes} firstDate={draft.preferredDate} timeSlot={draft.timeWindow} totalAmount={selected.estimate} collapsible />}
            <p className="text-xs leading-5 text-muted-foreground">All {annual ? 'four dates' : 'dates'} are checked before review and again on confirmation. {bookingFrequencyNotice}</p>
          </fieldset>}
          {(screen === 'review' || screen === 'success') && <>
            {receipt && <div role="status" className="rounded-xl bg-emerald-50 p-4 text-emerald-900"><p className="flex items-center gap-2 font-bold"><CheckCircle2 className="size-5" />{receipt.annualBundle ? 'Four booking requests saved' : 'Booking ' + (receipt.bookingReference || 'Reference unavailable')}</p><p className="mt-1">{currentBooking ? 'Latest checked status' : 'Status when submitted'}{annual ? ' · First visit' : ''}: {bookingStatusLabel(currentBooking?.status ?? receipt.status)}</p><Button variant="outline" size="sm" className="mt-3" disabled={locked} onClick={() => void loadAssistant()}>Refresh booking status</Button></div>}
            {receipt && bookingId && <div className="grid gap-2"><Button nativeButton={false} render={<Link href={'/customer/bookings/' + bookingId} />} onClick={() => void closeAssistant()} className="w-full">View this booking</Button><a href={bookingSupportLink(receipt.bookingReference || 'Reference unavailable')} className="inline-flex items-center justify-center gap-2 py-2 text-sm font-medium text-primary underline underline-offset-4"><Mail className="size-4" />Contact support about this booking</a></div>}
            {priceChanged && !receipt && <div role="status" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">The current price or reward conversion differs from the earlier review. Check the updated amounts before confirming.</div>}
            <div className="space-y-3 rounded-xl border p-4 text-sm">
              {receipt && <p className="text-xs text-muted-foreground">Original submission details. Open the booking to see any later schedule, service or price changes.</p>}
              {[
                { key: 'service' as AssistantStep, title: 'Service & quantity', value: (quote?.serviceName || selected.label || 'Service unavailable') + ' · ' + draft.numberOfUnits + ' aircon unit(s)' },
                { key: 'address' as AssistantStep, title: 'Address & contact', value: draft.serviceAddress + '\n' + draft.phone },
                { key: 'schedule' as AssistantStep, title: annual ? 'First preferred visit' : 'Preferred visit', value: formatDate(draft.preferredDate) + '\n' + formatServiceWindow(draft.timeWindow,selected.durationMinutes) },
              ].map(item => <div key={item.key} className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-xs text-muted-foreground">{item.title}</p><p className="mt-1 whitespace-pre-line break-words font-medium">{item.value}</p></div>{!receipt && <Button variant="ghost" size="sm" disabled={locked || savedProblem} aria-label={'Edit ' + item.title.toLowerCase()} onClick={() => edit(item.key)}><Pencil className="size-3" />Edit</Button>}</div>)}
              {draft.notes && <div><p className="text-xs text-muted-foreground">Problem / Other remarks</p><p className="mt-1 whitespace-pre-line break-words">{draft.notes}</p></div>}
              <div className="flex items-baseline justify-between gap-3 border-t pt-3"><span>{annual ? 'Annual estimate' : 'Visit estimate'} · SGD</span><strong className="text-xl text-primary">{formatMoney(receipt?.annualBundle?.totalAmount ?? receipt?.totalAmount ?? estimate)}</strong></div>
            </div>
            {annual && <AnnualBookingSummary durationMinutes={selected.durationMinutes} firstDate={draft.preferredDate} timeSlot={draft.timeWindow} totalAmount={estimate} saved={receipt?.annualBundle} compact />}
            {!receipt && <BookingRewardSelection key={`${context.customer.userId}:${record?.draftId}:${rewardRefresh}`} amount={rewardAmount} annual={annual} value={draft.rewardPoints ?? 0} onChange={rewardPoints => { store.update({ rewardPoints }); setError(''); setPriceChanged(false); }} onValidityChange={setRewardsValid} disabled={locked || savedProblem} />}
            {!receipt && quote?.rewardReservation && !store.dirty && record?.status === 'reviewed' && <p className="rounded-xl bg-primary/5 p-3 text-sm">Reviewed reward discount: {formatMoney(quote.rewardReservation.discount)} for {quote.rewardReservation.points} points. {annual ? 'First visit' : 'Visit'} estimate after rewards: {formatMoney(Math.max(0, rewardAmount - quote.rewardReservation.discount))}.</p>}
            {receipt && receiptReward && <div className="space-y-1 rounded-xl bg-primary/5 p-3 text-sm"><p className="text-xs text-muted-foreground">{currentBooking ? 'Latest checked points status' : 'Points when submitted'}</p><p className="font-semibold">{receiptReward.points} loyalty points {receiptReward.status === 'Redeemed' ? 'used' : receiptReward.status === 'Released' ? 'returned' : 'reserved'} · {formatMoney(receiptReward.discount)} {receiptReward.status === 'Released' ? 'discount released' : 'discount'}</p><p>{receiptReward.status === 'Released' ? 'The reserved points were returned to your available balance. This discount no longer applies.' : receiptReward.status === 'Reserved' ? 'Reserved points are unavailable for other bookings and will be settled when this order is completed.' : 'This points discount has been applied to the completed order.'}</p>{receipt.annualBundle && receiptReward.status !== 'Released' && <p>The discount applies to the first visit only.</p>}</div>}
            <p className="text-xs leading-5 text-muted-foreground">{bookingChangeNotice} {bookingConfirmationNotice(annual)}</p>
            {selected.pricingNote && <p className="text-xs leading-5 text-muted-foreground">{selected.pricingNote}</p>}
            {!receipt && <p className="text-xs leading-5 text-muted-foreground">Your request will be saved as Awaiting confirmation. Preferred dates and times still need the service team's confirmation.</p>}
          </>}
          {screen !== 'menu' && screen !== 'review' && screen !== 'success' && selected.valid && <details className="rounded-xl border p-3 text-sm"><summary className="cursor-pointer font-medium">Your selected answers</summary><dl className="mt-3 space-y-2 text-xs"><div><dt className="text-muted-foreground">Service</dt><dd>{selected.label} · {draft.numberOfUnits} unit(s) · {formatMoney(selected.estimate)} {annual ? 'per year' : 'per visit'}</dd></div>{draft.serviceAddress && <div><dt className="text-muted-foreground">Address</dt><dd className="break-words">{draft.serviceAddress}</dd></div>}{draft.preferredDate && <div><dt className="text-muted-foreground">Preferred date</dt><dd>{formatDate(draft.preferredDate)} · {formatServiceWindow(draft.timeWindow,selected.durationMinutes)}</dd></div>}</dl></details>}
          {screen !== 'success' && <div className="border-t pt-3">
            <Button variant="outline" size="sm" onClick={() => setChatOpen(true)}><MessageCircle className="size-4" />Ask a common question</Button>
            {help === 'service' && <div className="mt-3 space-y-3 rounded-xl bg-muted p-3 text-sm"><p>Choose the closest description. Compatible services and your written notes are kept. Your technician will assess the cause on site.</p><div className="grid grid-cols-2 gap-2">{homepageIssues.map(issue => <Button key={issue.id} variant="outline" disabled={locked} className="h-auto whitespace-normal py-2" onClick={() => chooseIssue(issue.id === 'needs-cleaning' ? 'cleaning' : 'repair', issue.name + ': ' + issue.description)}>{issue.name}</Button>)}</div><Button variant="outline" disabled={locked} className="w-full h-auto whitespace-normal py-2" onClick={() => chooseIssue('annual-cleaning')}>I want quarterly cleaning all year</Button>{issueProposal && <div role="alert" className="space-y-3 rounded-xl border border-amber-300 bg-background p-3"><p>Switch your current service selection to <strong>{issueProposal.label}</strong>? Annual care and one-off services are booked separately. Your written notes will stay.</p><div className="flex flex-wrap gap-2"><Button variant="outline" disabled={locked} onClick={() => setIssueProposal(null)}>Keep current services</Button><Button disabled={locked} onClick={() => chooseIssue(issueProposal.code, issueProposal.note, true)}>Switch service</Button></div></div>}</div>}
            <a href={supportHref} className="mt-3 inline-flex items-center gap-2 text-xs font-medium text-primary underline underline-offset-4"><Mail className="size-3" />Contact support</a>
          </div>}
        </>}
      </div>
      {context && <div hidden={chatActive} className={chatActive ? 'hidden' : 'shrink-0 border-t bg-background p-4'}>
        {record?.status !== 'completed' && <p role="status" className={'mb-3 text-xs ' + (savedProblem ? 'text-red-700' : 'text-muted-foreground')}>{store.saveStatus === 'saving' ? 'Saving your answers to your account…' : store.saveStatus === 'dirty' ? 'Changes waiting to save…' : store.saveStatus === 'saved' ? 'Draft saved to your account. You can resume after signing in.' : store.saveStatus === 'error' ? 'Latest changes are not saved. Retry saving before continuing.' : store.saveStatus === 'conflict' ? 'Another session changed this draft.' : store.saveStatus === 'auth' ? 'Sign in to continue saving.' : 'Start a booking to save your draft.'}</p>}
        <div className="flex flex-wrap items-center justify-between gap-2">
          {screen !== 'menu' && screen !== 'success' && <Button variant="outline" disabled={locked || savedProblem || addressEditorOpen} onClick={() => screen === 'service' ? setScreen('menu') : void move(steps[Math.max(0, steps.indexOf(screen as AssistantStep) - 1)])}>Back</Button>}
          {(['service', 'address', 'schedule'] as Screen[]).includes(screen) && <Button disabled={locked || savedProblem || addressEditorOpen || (screen === 'service' && !selected.valid) || (screen === 'schedule' && (availability.selectedDateBlocked || !slotAvailability.checked || selectedSlotFull))} onClick={continueStep}>{editingReview ? 'Return to review' : screen === 'schedule' ? 'Review booking' : 'Continue'}</Button>}
          {screen === 'review' && !receipt && (record?.status !== 'reviewed' || !quote || store.dirty ? <Button disabled={locked || savedProblem || !canReview || !rewardsValid} onClick={review}>Check price, points &amp; dates</Button> : <Button disabled={locked || savedProblem || !rewardsValid} onClick={confirm}>{priceChanged ? 'Confirm updated price' : 'Confirm booking'}</Button>)}
          {screen === 'success' && <Button variant="outline" className="w-full" disabled={locked} onClick={() => void startBooking(true)}><CalendarPlus className="size-4" />Book another service</Button>}
        </div>
      </div>}
    </DialogContent>
  </Dialog>;
}
