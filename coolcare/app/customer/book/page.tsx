'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, CalendarCheck, Check, Clock3, MapPin, Snowflake, Wind } from 'lucide-react';
import { CoolCareShell } from '@/components/coolcare-shell';
import { BookingServiceSelection, bookingEmailMessage, bookingFrequencyNotice, emptyBookingSelection, getBookingSelection, type BookingSelection } from '@/components/booking-service-selection';
import { AnnualBookingSummary } from '@/components/annual-booking-summary';
import { PageError, PageLoading } from '@/components/page-state';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { FieldError, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { coolcareApi } from '@/lib/coolcare-api';
import { formatMoney } from '@/lib/format';
import { assertBookingConfirmation } from '@/lib/annual-booking';
import { bookingDateError, bookingScheduleNotice, earliestBookingDate } from '@/lib/booking-schedule';
import type { BookingInput, BookingOptions, CreatedBooking, CustomerContext } from '@/lib/coolcare-types';

const steps = ['Service', 'Aircon units', 'Schedule', 'Review'];
const timeSlots: BookingInput['timeSlot'][] = ['09:00 - 11:00', '11:00 - 13:00', '14:00 - 16:00', '16:00 - 18:00'];

type FormState = {
  addressId: number | null;
  unitIds: number[];
  preferredDate: string;
  timeSlot: BookingInput['timeSlot'] | '';
  problemDescription: string;
};

const initialForm: FormState = { addressId: null, unitIds: [], preferredDate: '', timeSlot: '', problemDescription: '' };

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

  useEffect(() => {
    requestId.current = crypto.randomUUID();
    Promise.all([coolcareApi.getCustomerContext(), coolcareApi.getBookingOptions()])
      .then(([nextContext, nextOptions]) => {
        setContext(nextContext);
        setOptions(nextOptions);
        setForm((current) => ({ ...current, addressId: nextContext.addresses.find((address) => address.isDefault)?.addressId ?? nextContext.addresses[0]?.addressId ?? null }));
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : 'Unable to load booking information.'));
  }, []);

  const selectedAddress = context?.addresses.find((address) => address.addressId === form.addressId);
  const selectedUnits = context?.units.filter((unit) => form.unitIds.includes(unit.unitId)) ?? [];
  const selectedServices = getBookingSelection(options, selection, Math.max(1, selectedUnits.length));
  const total = selectedUnits.length ? selectedServices.estimate : 0;
  const minimumDate = earliestBookingDate();

  const submitBooking = useCallback(async (input: BookingInput) => {
    if (!context) throw new Error('Wait for your account details to load before booking.');
    if (!pendingRequest.current) {
      const dateError = bookingDateError(input.preferredDate);
      if (dateError) throw Object.assign(new Error(dateError), { status: 400 });
    }
    if (!pendingRequest.current) pendingRequest.current = { ...input, expectedUserId: context.customer.userId, requestId: input.requestId || requestId.current };
    const result = await coolcareApi.createBooking(pendingRequest.current);
    assertBookingConfirmation(result, Boolean(pendingRequest.current.packageId));
    setCreated(result);
    pendingRequest.current = null;
    return result;
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
          preferredDate: { type: 'string', format: 'date' },
          timeSlot: { type: 'string', enum: timeSlots },
          problemDescription: { type: 'string', maxLength: 1000 },
        },
        required: ['addressId', 'unitIds', 'preferredDate', 'timeSlot'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute: async (input: unknown) => submitBooking(input as BookingInput),
    }, { signal: lifecycle.signal })).catch(() => undefined);
    return () => lifecycle.abort();
  }, [submitBooking]);

  function validateCurrentStep() {
    if (step === 1 && !selectedServices.valid) return 'Choose Cleaning, Repair or the Annual Cleaning Bundle to continue.';
    if (step === 2 && !form.addressId) return 'Select a service address.';
    if (step === 2 && form.unitIds.length === 0) return 'Select at least one aircon unit.';
    if (step === 3 && bookingDateError(form.preferredDate)) return bookingDateError(form.preferredDate);
    if (step === 3 && !form.timeSlot) return 'Choose a preferred time slot.';
    return '';
  }

  function nextStep() {
    const validationMessage = validateCurrentStep();
    if (validationMessage) return setFieldError(validationMessage);
    setFieldError('');
    setStep((current) => Math.min(4, current + 1));
  }

  async function handleConfirm() {
    if (!selectedServices.valid || !form.addressId || !form.timeSlot || submittingRequest.current) return;
    submittingRequest.current = true;
    setSubmitting(true);
    setFieldError('');
    try {
      await submitBooking({
        ...selectedServices.payload,
        addressId: form.addressId,
        unitIds: form.unitIds,
        preferredDate: form.preferredDate,
        timeSlot: form.timeSlot,
        problemDescription: form.problemDescription,
      });
    } catch (reason) {
      const rejected = reason instanceof Error && 'status' in reason && Number(reason.status) < 500;
      if (rejected) pendingRequest.current = null;
      if (reason instanceof Error && reason.message.includes('signed-in account changed')) {
        setContext(null); setOptions(null); setSelection(emptyBookingSelection); setForm(initialForm); setError(reason.message);
      }
      setRetryLocked(!rejected);
      setFieldError(`${reason instanceof Error ? reason.message : 'Unable to create the booking.'}${rejected ? '' : ' Retry confirmation with the same details to safely check or complete this request.'}`);
    } finally {
      submittingRequest.current = false;
      setSubmitting(false);
    }
  }

  function toggleUnit(unitId: number, checked: boolean) {
    setForm((current) => ({
      ...current,
      unitIds: checked ? [...current.unitIds, unitId] : current.unitIds.filter((id) => id !== unitId),
    }));
  }

  function startAnotherBooking() {
    pendingRequest.current = null;
    requestId.current = crypto.randomUUID();
    setSelection(emptyBookingSelection);
    setRetryLocked(false);
    coolcareApi.getBookingOptions().then(setOptions).catch(() => setError('Unable to refresh booking options. Please reload before booking again.'));
    setForm({ ...initialForm, preferredDate: earliestBookingDate(), addressId: context?.addresses.find((address) => address.isDefault)?.addressId ?? null });
    setStep(1);
    setCreated(null);
    setFieldError('');
  }

  return (
    <CoolCareShell>
      <div className="mx-auto max-w-5xl px-5 py-8 sm:px-8 lg:px-10 lg:py-10">
        <div className="mb-8"><p className="text-sm font-semibold text-primary">BOOK SERVICE</p><h1 className="mt-1 text-3xl font-bold tracking-tight">Plan your maintenance visit</h1><p className="mt-2 text-sm text-muted-foreground">Choose the service, units and preferred schedule. We will save your request as Submitted.</p></div>

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
                  <BookingServiceSelection options={options} value={selection} onChange={setSelection} units={Math.max(1, selectedUnits.length)} />
                </FieldSet>
              )}

              {step === 2 && (
                <div><h2 className="text-xl font-bold">Where should we service?</h2><p className="mt-1 text-sm text-muted-foreground">Select units registered at your chosen service address.</p>
                  <div className="mt-6"><FieldLabel htmlFor="address">Service address</FieldLabel><Select value={form.addressId ?? undefined} onValueChange={(value) => setForm((current) => ({ ...current, addressId: Number(value), unitIds: [] }))}><SelectTrigger id="address" className="mt-2 h-12 w-full"><SelectValue placeholder="Choose an address" /></SelectTrigger><SelectContent>{context.addresses.map((address) => <SelectItem key={address.addressId} value={address.addressId}>{address.label ? `${address.label} · ` : ''}{address.addressLine}</SelectItem>)}</SelectContent></Select></div>
                  <FieldSet className="mt-7"><FieldLegend>Select aircon units</FieldLegend><div className="grid gap-3 sm:grid-cols-2">{context.units.filter(unit => unit.addressId === form.addressId).map((unit) => {
                    const checked = form.unitIds.includes(unit.unitId);
                    return <FieldLabel key={unit.unitId} className="cursor-pointer rounded-2xl border bg-white p-4 has-data-checked:border-primary has-data-checked:bg-primary/5"><Checkbox checked={checked} onCheckedChange={(next) => toggleUnit(unit.unitId, Boolean(next))} aria-label={`Select ${unit.brand} in ${unit.location}`} /><span><span className="block font-semibold">{unit.brand} {unit.model}</span><span className="mt-1 block text-sm font-normal text-muted-foreground">{unit.location} · {unit.warrantyStatus}</span></span></FieldLabel>;
                  })}</div></FieldSet>
                  {context.units.filter(unit => unit.addressId === form.addressId).length === 0 && <p className="mt-4 text-sm text-muted-foreground">No units are registered here. You can use the Dashboard assistant to book with a new address or unit count.</p>}
                </div>
              )}

              {step === 3 && (
                <div><h2 className="text-xl font-bold">Choose a preferred schedule</h2><p className="mt-1 text-sm text-muted-foreground">An administrator will confirm availability after submission.</p><p className="mt-3 rounded-xl bg-primary/5 p-3 text-sm">{bookingScheduleNotice}</p><p className="mt-3 text-xs text-muted-foreground">{bookingFrequencyNotice}</p>
                  <div className="mt-6 grid gap-5 sm:grid-cols-2"><div><FieldLabel htmlFor="preferred-date">{selectedServices.isAnnual ? 'First preferred visit date' : 'Preferred date'}</FieldLabel><Input id="preferred-date" type="date" min={minimumDate} aria-invalid={Boolean(bookingDateError(form.preferredDate))} value={form.preferredDate} onChange={(event) => { setForm((current) => ({ ...current, preferredDate: event.target.value })); setFieldError(bookingDateError(event.target.value)); }} className="mt-2 h-12" /></div><div><FieldLabel htmlFor="time-slot">Preferred time</FieldLabel><Select value={form.timeSlot || undefined} onValueChange={(value) => setForm((current) => ({ ...current, timeSlot: value as BookingInput['timeSlot'] }))}><SelectTrigger id="time-slot" className="mt-2 h-12 w-full"><SelectValue placeholder="Choose a time slot" /></SelectTrigger><SelectContent>{timeSlots.map((slot) => <SelectItem key={slot} value={slot}>{slot}</SelectItem>)}</SelectContent></Select></div></div>
                  {selectedServices.isAnnual && <div className="mt-5"><AnnualBookingSummary firstDate={form.preferredDate} timeSlot={form.timeSlot} totalAmount={total} /></div>}
                  <div className="mt-6"><FieldLabel htmlFor="problem-description">Problem description <span className="font-normal text-muted-foreground">(optional)</span></FieldLabel><Textarea id="problem-description" value={form.problemDescription} onChange={(event) => setForm((current) => ({ ...current, problemDescription: event.target.value }))} maxLength={1000} placeholder="Tell the technician about leaks, noise, weak cooling or other concerns." className="mt-2 min-h-28 resize-y" /><p className="mt-1 text-right text-xs text-muted-foreground">{form.problemDescription.length}/1000</p></div>
                </div>
              )}

              {step === 4 && (
                <div><h2 className="text-xl font-bold">Review your request</h2><p className="mt-1 text-sm text-muted-foreground">Check your services and visit details before confirming.</p>
                  <dl className="mt-6 divide-y divide-border rounded-2xl border border-border bg-muted/35 px-5">
                    <ReviewRow icon={Snowflake} label="Services" value={`${selectedServices.label}${selection.mode !== 'custom' ? ` · ${selectedServices.serviceNames}` : ''}`} />
                    <ReviewRow icon={MapPin} label="Address" value={`${selectedAddress?.addressLine ?? ''}${selectedAddress?.postalCode ? `, ${selectedAddress.postalCode}` : ''}`} />
                    <ReviewRow icon={Wind} label="Aircon units" value={selectedUnits.map((unit) => `${unit.brand} · ${unit.location}`).join(', ')} />
                    <ReviewRow icon={CalendarCheck} label="Schedule" value={`${form.preferredDate} · ${form.timeSlot}`} />
                    <ReviewRow icon={Clock3} label={selectedServices.isAnnual ? 'Annual estimate' : 'Visit estimate'} value={formatMoney(total)} />
                  </dl>
                  {selectedServices.isAnnual && <div className="mt-5"><AnnualBookingSummary firstDate={form.preferredDate} timeSlot={form.timeSlot} totalAmount={total} /></div>}
                  {selectedServices.pricingNote && <p className="mt-4 text-sm text-muted-foreground">{selectedServices.pricingNote}</p>}
                  {form.problemDescription && <div className="mt-5 rounded-2xl border border-border p-4"><p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Problem description</p><p className="mt-2 text-sm leading-6">{form.problemDescription}</p></div>}
                </div>
              )}

              {fieldError && <FieldError className="mt-5">{fieldError}</FieldError>}
              <div className="mt-8 flex items-center justify-between gap-3"><Button variant="ghost" disabled={step === 1 || submitting || retryLocked} onClick={() => { setFieldError(''); setStep((current) => Math.max(1, current - 1)); }}><ArrowLeft className="size-4" aria-hidden="true" />Back</Button>{step < 4 ? <Button onClick={nextStep}>Continue<ArrowRight className="size-4" aria-hidden="true" /></Button> : <Button onClick={handleConfirm} disabled={submitting}>{submitting ? 'Saving…' : retryLocked ? 'Retry confirmation' : 'Confirm booking'}<Check className="size-4" aria-hidden="true" /></Button>}</div>
            </CardContent></Card>
          </>
        )}

        {created && (
          <>
          <Alert className="rounded-3xl border-secondary/25 bg-[linear-gradient(145deg,#eff5ff,#ecfffb)] p-7 sm:p-10"><div className="grid size-14 place-items-center rounded-full bg-secondary text-white"><Check className="size-7" aria-hidden="true" /></div><div className="ml-0 sm:ml-2"><AlertTitle className="text-2xl font-bold">{created.annualBundle ? 'Four booking requests saved' : 'Booking submitted'}</AlertTitle><AlertDescription className="mt-3 max-w-xl text-base leading-7">{created.annualBundle ? 'Your four quarterly cleaning visits have been saved as requests. The service team will confirm each date and time.' : 'Your ' + created.serviceName + ' request has been saved. The service team will confirm availability.'}</AlertDescription><div className="mt-5 flex flex-wrap gap-6"><div><p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Reference</p><p className="mt-1 font-mono font-bold text-foreground">{created.bookingReference}</p></div><div><p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Status</p><p className="mt-1 font-semibold text-amber-700">{created.status}</p></div><div><p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{created.annualBundle ? 'Annual estimate' : 'Visit estimate'}</p><p className="mt-1 font-semibold text-foreground">{formatMoney(created.annualBundle?.totalAmount ?? created.totalAmount)}</p></div></div><div className="mt-7 flex flex-wrap gap-3"><Button nativeButton={false} render={<Link href="/customer/bookings" />}>View my bookings</Button><Button variant="outline" onClick={startAnotherBooking}>Book another service</Button></div></div></Alert>
          {created.emailNotification && <p role="status" className="mt-4 text-sm text-muted-foreground">{bookingEmailMessage(created.emailNotification)}</p>}
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
