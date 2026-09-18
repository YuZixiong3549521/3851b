'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, CalendarCheck, Check, Clock3, MapPin, Snowflake, Wind } from 'lucide-react';
import { CoolCareShell } from '@/components/coolcare-shell';
import { BookingServiceSelection, bookingFrequencyNotice, emptyBookingSelection, getBookingSelection, type BookingSelection } from '@/components/booking-service-selection';
import { bookingStatusLabel } from '@/components/booking-status';
import { AnnualBookingSummary } from '@/components/annual-booking-summary';
import { BookingAddressField } from '@/components/booking-address-field';
import { EnglishDatePicker } from '@/components/english-date-picker';
import { BookingAvailabilityNotice, bookingConflictMessage } from '@/components/booking-availability-notice';
import { useBookingAvailability } from '@/lib/use-booking-availability';
import { PageError, PageLoading } from '@/components/page-state';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { FieldError, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { coolcareApi } from '@/lib/coolcare-api';
import { formatDate, formatMoney } from '@/lib/format';
import { annualVisitDates,assertBookingConfirmation } from '@/lib/annual-booking';
import { bookingDateError, bookingScheduleNotice, earliestBookingDate } from '@/lib/booking-schedule';
import { useSlotAvailability } from '@/lib/use-slot-availability';
import type { Address, BookingInput, BookingOptions, CreatedBooking, CustomerContext } from '@/lib/coolcare-types';

const steps = ['Service', 'Address', 'Schedule', 'Review'];
const timeSlots: BookingInput['timeSlot'][] = ['09:00 - 11:00', '11:00 - 13:00', '14:00 - 16:00', '16:00 - 18:00'];

type FormState = {
  serviceAddress: string;
  numberOfUnits: number;
  preferredDate: string;
  timeSlot: BookingInput['timeSlot'] | '';
  problemDescription: string;
};

const initialForm: FormState = { serviceAddress: '', numberOfUnits: 1, preferredDate: '', timeSlot: '', problemDescription: '' };

export default function BookServicePage() {
  const [step, setStep] = useState(1);
  const [context, setContext] = useState<CustomerContext | null>(null);
  const [options, setOptions] = useState<BookingOptions | null>(null);
  const [selection, setSelection] = useState<BookingSelection>(emptyBookingSelection);
  const [form, setForm] = useState<FormState>(() => ({ ...initialForm, preferredDate: earliestBookingDate() }));
  const [error, setError] = useState('');
  const [fieldError, setFieldError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState<CreatedBooking | null>(null);
  const requestId = useRef('');
  const submittingRequest = useRef(false);
  const pendingRequest = useRef<BookingInput | null>(null);
  const [retryLocked, setRetryLocked] = useState(false);
  const [addressEditorOpen, setAddressEditorOpen] = useState(false);

  useEffect(() => {
    requestId.current = crypto.randomUUID();
    Promise.all([coolcareApi.getCustomerContext(), coolcareApi.getBookingOptions()])
      .then(([nextContext, nextOptions]) => {
        setContext(nextContext);
        setOptions(nextOptions);
        setForm((current) => ({ ...current, serviceAddress: nextContext.addresses.find((address) => address.isDefault)?.addressLine ?? nextContext.addresses[0]?.addressLine ?? '' }));
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : 'Unable to load booking information.'));
  }, []);

  const selectedAddress = context?.addresses.find((address) => address.addressLine === form.serviceAddress);
  const selectedServices = getBookingSelection(options, selection, Math.max(1, form.numberOfUnits));
  const total = form.numberOfUnits > 0 ? selectedServices.estimate : 0;
  const minimumDate = earliestBookingDate();
  const availability = useBookingAvailability({ serviceAddress: form.serviceAddress, selectedDate: form.preferredDate, enabled: Boolean(context && !created && step >= 2 && !retryLocked) });
  const slotDates=selectedServices.isAnnual?annualVisitDates(form.preferredDate):form.preferredDate?[form.preferredDate]:[];
  const slotAvailability=useSlotAvailability(slotDates,Boolean(context&&!created&&step>=3&&!retryLocked));
  const selectedSlotFull=Boolean(form.timeSlot&&!slotAvailability.isAvailable(form.timeSlot));

  const submitBooking = useCallback(async (input: BookingInput) => {
    if (!context) throw new Error('Wait for your account details to load before booking.');
    if (submittingRequest.current) throw new Error('A booking request is already being processed. Wait for its result.');
    submittingRequest.current = true;
    setSubmitting(true);
    setFieldError('');
    try {
      if (!pendingRequest.current) {
        const dateError = bookingDateError(input.preferredDate);
        if (dateError) throw Object.assign(new Error(dateError), { status: 400 });
        if (input.serviceAddress !== undefined || input.numberOfUnits !== undefined) {
          if (input.unitIds !== undefined) throw Object.assign(new Error('Use an AC unit count or individual units, not both.'), { status: 400 });
          if (typeof input.serviceAddress !== 'string' || input.serviceAddress.trim().length < 5 || input.serviceAddress.trim().length > 255) throw Object.assign(new Error('Enter a service address between 5 and 255 characters.'), { status: 400 });
          if (!Number.isInteger(input.numberOfUnits) || Number(input.numberOfUnits) < 1 || Number(input.numberOfUnits) > 10) throw Object.assign(new Error('Enter an AC unit count from 1 to 10.'), { status: 400 });
        }
      }
      if (!pendingRequest.current) pendingRequest.current = { ...input, expectedUserId: context.customer.userId, requestId: input.requestId || requestId.current };
      const result = await coolcareApi.createBooking(pendingRequest.current);
      assertBookingConfirmation(result, Boolean(pendingRequest.current.packageId));
      setCreated(result);
      pendingRequest.current = null;
      setRetryLocked(false);
      return result;
    } catch (reason) {
      const rejected = reason instanceof Error && 'status' in reason && Number(reason.status) >= 400 && Number(reason.status) < 500;
      if (rejected) pendingRequest.current = null;
      if (reason instanceof Error && reason.message.includes('signed-in account changed')) {
        setContext(null); setOptions(null); setSelection(emptyBookingSelection); setForm(initialForm); setError(reason.message);
      }
      setRetryLocked(!rejected);
      setFieldError(`${reason instanceof Error ? reason.message : 'Unable to create the booking.'}${rejected ? '' : ' Retry confirmation with the same details to safely check or complete this request.'}`);
      throw reason;
    } finally {
      submittingRequest.current = false;
      setSubmitting(false);
    }
  }, [context?.customer.userId]);

  useEffect(() => {
    const modelContext = (document as Document & {
      modelContext?: {
        registerTool: (tool: Record<string, unknown>, options?: { signal?: AbortSignal }) => void | Promise<void>;
      };
    }).modelContext;
    if (!modelContext?.registerTool) return;

    const lifecycle = new AbortController();
    Promise.resolve(modelContext.registerTool({
      name: 'create_booking',
      title: 'Create CoolCare booking',
      description: 'Create an air-conditioning service booking for the signed-in customer and display the confirmation.',
      inputSchema: {
        type: 'object',
        properties: {
          serviceId: { type: 'integer', minimum: 1 },
          serviceIds: { type: 'array', items: { type: 'integer', minimum: 1 }, minItems: 1 },
          packageId: { type: 'integer', minimum: 1 },
          requestId: { type: 'string', format: 'uuid' },
          addressId: { type: 'integer', minimum: 1 },
          unitIds: { type: 'array', items: { type: 'integer', minimum: 1 }, minItems: 1 },
          serviceAddress: { type: 'string', minLength: 5, maxLength: 255 },
          numberOfUnits: { type: 'integer', minimum: 1, maximum: 10 },
          preferredDate: { type: 'string', format: 'date' },
          timeSlot: { type: 'string', enum: timeSlots },
          problemDescription: { type: 'string', maxLength: 1000 },
        },
        required: ['preferredDate', 'timeSlot'],
        oneOf: [
          { required: ['serviceAddress', 'numberOfUnits'], not: { required: ['unitIds'] } },
          { required: ['addressId', 'unitIds'], not: { anyOf: [{ required: ['serviceAddress'] }, { required: ['numberOfUnits'] }] } },
        ],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute: async (input: unknown) => submitBooking(input as BookingInput),
    }, { signal: lifecycle.signal })).catch(() => undefined);
    return () => lifecycle.abort();
  }, [submitBooking]);

  function validateCurrentStep() {
    if (step === 1 && !selectedServices.valid) return 'Choose Cleaning, Repair or the Annual Cleaning Bundle to continue.';
    if (step === 2 && (form.serviceAddress.trim().length < 5 || form.serviceAddress.trim().length > 255)) return 'Enter a service address between 5 and 255 characters.';
    if (step === 2 && (!Number.isInteger(form.numberOfUnits) || form.numberOfUnits < 1 || form.numberOfUnits > 10)) return 'Enter an AC unit count from 1 to 10.';
    if (step === 3 && bookingDateError(form.preferredDate)) return bookingDateError(form.preferredDate);
    if (step === 3 && availability.selectedDateBlocked) return bookingConflictMessage;
    if (step === 3 && !form.timeSlot) return 'Choose a preferred time slot.';
    if (step === 3 && selectedSlotFull) return 'This service time is fully booked. Choose another available time.';
    return '';
  }

  function nextStep() {
    const validationMessage = validateCurrentStep();
    if (validationMessage) return setFieldError(validationMessage);
    setFieldError('');
    setStep((current) => Math.min(4, current + 1));
  }

  async function handleConfirm() {
    if (!selectedServices.valid || !form.timeSlot || submittingRequest.current || addressEditorOpen) return;
    if (!pendingRequest.current && (availability.selectedDateBlocked||selectedSlotFull)) { setFieldError(availability.selectedDateBlocked?bookingConflictMessage:'This service time is fully booked. Choose another available time.'); return; }
    try {
      await submitBooking({
        ...selectedServices.payload,
        serviceAddress: form.serviceAddress.trim(),
        numberOfUnits: form.numberOfUnits,
        preferredDate: form.preferredDate,
        timeSlot: form.timeSlot,
        problemDescription: form.problemDescription,
      });
    } catch {
      // The shared submit path displays errors for both the form and WebMCP.
    }
  }

  function handleAddressSaved(address: Address) {
    setContext(current => current ? { ...current, addresses: [address, ...current.addresses.filter(item => item.addressId !== address.addressId)] } : current);
    setForm(current => ({ ...current, serviceAddress: address.addressLine }));
    setFieldError('');
  }

  function startAnotherBooking() {
    pendingRequest.current = null;
    requestId.current = crypto.randomUUID();
    setSelection(emptyBookingSelection);
    setRetryLocked(false);
    coolcareApi.getBookingOptions().then(setOptions).catch(() => setError('Unable to refresh booking options. Please reload before booking again.'));
    setForm({ ...initialForm, preferredDate: earliestBookingDate(), serviceAddress: context?.addresses.find((address) => address.isDefault)?.addressLine ?? context?.addresses[0]?.addressLine ?? '' });
    setStep(1);
    setCreated(null);
    setFieldError('');
  }

  return (
    <CoolCareShell>
      <div className="mx-auto max-w-5xl px-5 pb-28 pt-8 sm:px-8 lg:px-10 lg:py-10">
        <div className="mb-8"><p className="text-sm font-semibold text-primary">BOOK SERVICE</p><h1 className="mt-1 text-3xl font-bold tracking-tight">Plan your maintenance visit</h1><p className="mt-2 text-sm text-muted-foreground">Choose a service, enter your address and unit count, then select a preferred schedule.</p></div>

        {!context && !error && <PageLoading />}
        {error && <PageError message={`${error} Please refresh this page to retry.`} />}
        {context && options && !error && !created && (
          <>
            <ol aria-label="Booking progress" className="mb-6 grid grid-cols-4 gap-2">
              {steps.map((label, index) => {
                const number = index + 1;
                const active = number === step;
                const complete = number < step;
                return <li key={label} aria-current={active ? 'step' : undefined} className={`rounded-2xl border px-3 py-3 text-center text-xs font-semibold sm:text-sm ${active ? 'border-primary bg-primary/10 text-primary' : complete ? 'border-secondary/30 bg-secondary/10 text-secondary' : 'border-border bg-white text-muted-foreground'}`}><span className="hidden sm:inline">{complete ? '✓ ' : `${number}. `}</span>{label}</li>;
              })}
            </ol>

            <Card className="border-border/80 shadow-sm"><CardContent className="p-5 sm:p-8">
              {step === 1 && (
                <FieldSet><FieldLegend className="text-xl font-bold">How would you like to book?</FieldLegend>
                  <BookingServiceSelection options={options} value={selection} onChange={setSelection} units={Math.max(1, form.numberOfUnits)} />
                </FieldSet>
              )}

              {step === 2 && (
                <div><h2 className="text-xl font-bold">Where should we service?</h2><p className="mt-1 text-sm text-muted-foreground">Choose a saved address or enter a new service address.</p>
                  <div className="mt-6"><BookingAddressField key={context.customer.userId} expectedUserId={context.customer.userId} addresses={context.addresses} value={form.serviceAddress} onChange={value => { setForm(current => ({ ...current, serviceAddress: value })); setFieldError(''); }} onAddressSaved={handleAddressSaved} onEditingChange={setAddressEditorOpen} /></div>
                  <div className="mt-7"><FieldLabel htmlFor="number-of-units">Number of AC units</FieldLabel><Input id="number-of-units" type="number" inputMode="numeric" min={1} max={10} step={1} value={form.numberOfUnits || ''} onChange={event => { setForm(current => ({ ...current, numberOfUnits: Number(event.target.value) })); setFieldError(''); }} className="mt-2 h-12 max-w-40" /><p className="mt-2 text-xs text-muted-foreground">Enter how many air conditioners need service (1–10).</p><p className="mt-3 text-sm font-semibold text-primary">{selectedServices.isAnnual ? 'Annual estimate' : 'Visit estimate'}: {formatMoney(total)}</p></div>
                </div>
              )}

              {step === 3 && (
                <div><h2 className="text-xl font-bold">Choose a preferred schedule</h2><p className="mt-1 text-sm text-muted-foreground">{bookingScheduleNotice}</p>
                  <div className="mt-6 grid gap-5 sm:grid-cols-2"><div><FieldLabel htmlFor="preferred-date">{selectedServices.isAnnual ? 'First preferred visit date' : 'Preferred date'}</FieldLabel><EnglishDatePicker id="preferred-date" label={selectedServices.isAnnual ? 'First preferred visit date' : 'Preferred date'} min={minimumDate} aria-invalid={Boolean(bookingDateError(form.preferredDate)) || availability.selectedDateBlocked} value={form.preferredDate} blockedDates={availability.blockedDates} onMonthChange={availability.onMonthChange} onChange={value => { setForm(current => ({ ...current, preferredDate: value })); setFieldError(bookingDateError(value)); }} className="mt-2" /></div><div><FieldLabel htmlFor="time-slot">Preferred time</FieldLabel><Select value={form.timeSlot || undefined} onValueChange={(value) => setForm((current) => ({ ...current, timeSlot: value as BookingInput['timeSlot'] }))}><SelectTrigger id="time-slot" className="mt-2 h-12 w-full"><SelectValue placeholder="Choose a time slot" /></SelectTrigger><SelectContent>{timeSlots.map((slot) => <SelectItem key={slot} value={slot} disabled={!slotAvailability.isAvailable(slot)}>{slot}{slotAvailability.isAvailable(slot)?'':' · Fully booked'}</SelectItem>)}</SelectContent></Select>{slotAvailability.loading&&<p className="mt-2 text-xs text-muted-foreground">Checking team availability…</p>}{slotAvailability.error&&<p className="mt-2 text-xs text-amber-800">Availability will be checked again when you confirm.</p>}{selectedSlotFull&&<p role="alert" className="mt-2 text-xs text-red-700">This service time is fully booked.</p>}</div></div>
                  <BookingAvailabilityNotice availability={availability} />
                  <p className="mt-3 text-xs text-muted-foreground">{bookingFrequencyNotice} The service team will confirm availability.</p>
                  {selectedServices.isAnnual && <div className="mt-5"><AnnualBookingSummary firstDate={form.preferredDate} timeSlot={form.timeSlot} totalAmount={total} collapsible /></div>}
                  <div className="mt-6"><FieldLabel htmlFor="problem-description">Problem description <span className="font-normal text-muted-foreground">(optional)</span></FieldLabel><Textarea id="problem-description" value={form.problemDescription} onChange={(event) => setForm((current) => ({ ...current, problemDescription: event.target.value }))} maxLength={1000} placeholder="Tell the technician about leaks, noise, weak cooling or other concerns." className="mt-2 min-h-28 resize-y" /><p className="mt-1 text-right text-xs text-muted-foreground">{form.problemDescription.length}/1000</p></div>
                </div>
              )}

              {step === 4 && (
                <div><h2 className="text-xl font-bold">Review your request</h2><p className="mt-1 text-sm text-muted-foreground">Check your services and visit details before confirming.</p>
                  <dl className="mt-6 divide-y divide-border rounded-2xl border border-border bg-muted/35 px-5">
                    <ReviewRow icon={Snowflake} label="Services" value={`${selectedServices.label}${selection.mode !== 'custom' ? ` · ${selectedServices.serviceNames}` : ''}`} />
                    <ReviewRow icon={MapPin} label="Address" value={`${form.serviceAddress}${selectedAddress?.postalCode ? `, ${selectedAddress.postalCode}` : ''}`} />
                    <ReviewRow icon={Wind} label="Number of AC units" value={String(form.numberOfUnits)} />
                    <ReviewRow icon={CalendarCheck} label="Schedule" value={`${formatDate(form.preferredDate)} · ${form.timeSlot}`} />
                    <ReviewRow icon={Clock3} label={selectedServices.isAnnual ? 'Annual estimate' : 'Visit estimate'} value={formatMoney(total)} />
                  </dl>
                  {selectedServices.isAnnual && <div className="mt-5"><AnnualBookingSummary firstDate={form.preferredDate} timeSlot={form.timeSlot} totalAmount={total} /></div>}
                  {selectedServices.pricingNote && <p className="mt-4 text-sm text-muted-foreground">{selectedServices.pricingNote}</p>}
                  {form.problemDescription && <div className="mt-5 rounded-2xl border border-border p-4"><p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Problem description</p><p className="mt-2 text-sm leading-6">{form.problemDescription}</p></div>}
                </div>
              )}

              {fieldError && <FieldError className="mt-5">{fieldError}</FieldError>}
              <div className="fixed inset-x-0 bottom-[calc(64px+max(8px,env(safe-area-inset-bottom)))] z-30 flex items-center justify-between gap-3 border-t bg-background/95 px-5 py-3 backdrop-blur lg:static lg:mt-8 lg:border-0 lg:bg-transparent lg:p-0"><Button variant="ghost" disabled={step === 1 || submitting || retryLocked || addressEditorOpen} onClick={() => { setFieldError(''); setStep((current) => Math.max(1, current - 1)); }}><ArrowLeft className="size-4" aria-hidden="true" />Back</Button>{step < 4 ? <Button disabled={addressEditorOpen || (step === 3 && (availability.selectedDateBlocked||selectedSlotFull||slotAvailability.loading))} onClick={nextStep}>Continue<ArrowRight className="size-4" aria-hidden="true" /></Button> : <Button onClick={handleConfirm} disabled={submitting || (!retryLocked && (availability.selectedDateBlocked||selectedSlotFull))}>{submitting ? 'Saving…' : retryLocked ? 'Retry confirmation' : 'Confirm booking'}<Check className="size-4" aria-hidden="true" /></Button>}</div>
            </CardContent></Card>
          </>
        )}

        {created && (
          <>
          <Alert className="rounded-3xl border-secondary/25 bg-[linear-gradient(145deg,#eff5ff,#ecfffb)] p-7 sm:p-10"><div className="grid size-14 place-items-center rounded-full bg-secondary text-white"><Check className="size-7" aria-hidden="true" /></div><div className="ml-0 sm:ml-2"><AlertTitle className="text-2xl font-bold">{created.annualBundle ? 'Four booking requests saved' : 'Booking submitted'}</AlertTitle><AlertDescription className="mt-3 max-w-xl text-base leading-7">{created.annualBundle ? 'Your four quarterly cleaning visits have been saved as requests. The service team will confirm each date and time.' : 'Your ' + created.serviceName + ' request has been saved. The service team will confirm availability.'}</AlertDescription><div className="mt-5 flex flex-wrap gap-6"><div><p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Reference</p><p className="mt-1 font-mono font-bold text-foreground">{created.bookingReference}</p></div><div><p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Status</p><p className="mt-1 font-semibold text-amber-700">{bookingStatusLabel(created.status)}</p></div><div><p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{created.annualBundle ? 'Annual estimate' : 'Visit estimate'}</p><p className="mt-1 font-semibold text-foreground">{formatMoney(created.annualBundle?.totalAmount ?? created.totalAmount)}</p></div></div><div className="mt-7 flex flex-wrap gap-3"><Button nativeButton={false} render={<Link href="/customer/bookings" />}>View my bookings</Button><Button variant="outline" onClick={startAnotherBooking}>Book another service</Button></div></div></Alert>
          {created.annualBundle && <div className="mt-5"><AnnualBookingSummary saved={created.annualBundle} totalAmount={created.annualBundle.totalAmount} /></div>}
          </>
        )}
      </div>
    </CoolCareShell>
  );
}

function ReviewRow({ icon: Icon, label, value }: { icon: typeof Snowflake; label: string; value: string }) {
  return <div className="grid gap-2 py-4 sm:grid-cols-[180px_1fr]"><dt className="flex items-center gap-2 text-sm font-medium text-muted-foreground"><Icon className="size-4" aria-hidden="true" />{label}</dt><dd className="text-sm font-semibold sm:text-right">{value}</dd></div>;
}
