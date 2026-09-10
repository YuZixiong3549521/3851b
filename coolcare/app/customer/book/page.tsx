'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, CalendarCheck, Check, Clock3, MapPin, Snowflake, Wind } from 'lucide-react';
import { CoolCareShell } from '@/components/coolcare-shell';
import { PageError, PageLoading } from '@/components/page-state';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { FieldError, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { coolcareApi } from '@/lib/coolcare-api';
import { formatMoney } from '@/lib/format';
import type { BookingInput, CreatedBooking, CustomerContext, Service } from '@/lib/coolcare-types';

const steps = ['Service', 'Aircon units', 'Schedule', 'Review'];
const timeSlots: BookingInput['timeSlot'][] = ['09:00 - 11:00', '11:00 - 13:00', '14:00 - 16:00', '16:00 - 18:00'];

type FormState = {
  serviceId: number | null;
  addressId: number | null;
  unitIds: number[];
  preferredDate: string;
  timeSlot: BookingInput['timeSlot'] | '';
  problemDescription: string;
};

const initialForm: FormState = { serviceId: null, addressId: null, unitIds: [], preferredDate: '', timeSlot: '', problemDescription: '' };

export default function BookServicePage() {
  const [step, setStep] = useState(1);
  const [context, setContext] = useState<CustomerContext | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [form, setForm] = useState<FormState>(initialForm);
  const [error, setError] = useState('');
  const [fieldError, setFieldError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState<CreatedBooking | null>(null);

  useEffect(() => {
    Promise.all([coolcareApi.getCustomerContext(), coolcareApi.getServices()])
      .then(([nextContext, nextServices]) => {
        setContext(nextContext);
        setServices(nextServices);
        setForm((current) => ({ ...current, addressId: nextContext.addresses.find((address) => address.isDefault)?.addressId ?? nextContext.addresses[0]?.addressId ?? null }));
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : 'Unable to load booking information.'));
  }, []);

  const selectedService = services.find((service) => service.serviceId === form.serviceId);
  const selectedAddress = context?.addresses.find((address) => address.addressId === form.addressId);
  const selectedUnits = context?.units.filter((unit) => form.unitIds.includes(unit.unitId)) ?? [];
  const total = selectedUnits.length ? (selectedService?.basePrice ?? 0) + Math.max(0, selectedUnits.length - 1) * (selectedService?.additionalUnitPrice ?? selectedService?.basePrice ?? 0) : 0;
  const minimumDate = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const submitBooking = useCallback(async (input: BookingInput) => {
    const result = await coolcareApi.createBooking(input);
    setCreated(result);
    return result;
  }, []);

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
      description: 'Create an air-conditioning service booking for the current demonstration customer and display the confirmation.',
      inputSchema: {
        type: 'object',
        properties: {
          serviceId: { type: 'integer', minimum: 1 },
          addressId: { type: 'integer', minimum: 1 },
          unitIds: { type: 'array', items: { type: 'integer', minimum: 1 }, minItems: 1 },
          preferredDate: { type: 'string', format: 'date' },
          timeSlot: { type: 'string', enum: timeSlots },
          problemDescription: { type: 'string', maxLength: 1000 },
        },
        required: ['serviceId', 'addressId', 'unitIds', 'preferredDate', 'timeSlot'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute: async (input: unknown) => submitBooking(input as BookingInput),
    }, { signal: lifecycle.signal })).catch(() => undefined);
    return () => lifecycle.abort();
  }, [submitBooking]);

  function validateCurrentStep() {
    if (step === 1 && !form.serviceId) return 'Select a service to continue.';
    if (step === 2 && !form.addressId) return 'Select a service address.';
    if (step === 2 && form.unitIds.length === 0) return 'Select at least one aircon unit.';
    if (step === 3 && !form.preferredDate) return 'Choose a preferred service date.';
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
    if (!form.serviceId || !form.addressId || !form.timeSlot) return;
    setSubmitting(true);
    setFieldError('');
    try {
      await submitBooking({
        serviceId: form.serviceId,
        addressId: form.addressId,
        unitIds: form.unitIds,
        preferredDate: form.preferredDate,
        timeSlot: form.timeSlot,
        problemDescription: form.problemDescription,
      });
    } catch (reason) {
      setFieldError(reason instanceof Error ? reason.message : 'Unable to create the booking.');
    } finally {
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
    setForm({ ...initialForm, addressId: context?.addresses.find((address) => address.isDefault)?.addressId ?? null });
    setStep(1);
    setCreated(null);
    setFieldError('');
  }

  return (
    <CoolCareShell>
      <div className="mx-auto max-w-5xl px-5 py-8 sm:px-8 lg:px-10 lg:py-10">
        <div className="mb-8"><p className="text-sm font-semibold text-primary">BOOK SERVICE</p><h1 className="mt-1 text-3xl font-bold tracking-tight">Plan your maintenance visit</h1><p className="mt-2 text-sm text-muted-foreground">Choose the service, units and preferred schedule. We will save your request as Submitted.</p></div>

        {!context && !error && <PageLoading />}
        {error && <PageError message={`${error} Start the database and customer API, then refresh this page.`} />}
        {context && !created && (
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
                <FieldSet><FieldLegend className="text-xl font-bold">What does your aircon need?</FieldLegend><p className="-mt-2 text-sm text-muted-foreground">Prices shown are per selected unit.</p>
                  <RadioGroup value={form.serviceId ?? ''} onValueChange={(value) => setForm((current) => ({ ...current, serviceId: Number(value) }))} className="mt-4 grid gap-4 md:grid-cols-2">
                    {services.map((service) => (
                      <FieldLabel key={service.serviceId} className="cursor-pointer rounded-2xl border bg-white p-5 has-data-checked:border-primary has-data-checked:bg-primary/5">
                        <RadioGroupItem value={service.serviceId} aria-label={service.serviceName} />
                        <span className="flex-1"><span className="block font-semibold">{service.serviceName}</span><span className="mt-1 block text-sm font-normal leading-5 text-muted-foreground">{service.description}</span><span className="mt-3 block text-sm font-semibold text-primary">{formatMoney(service.basePrice)} · {service.durationMinutes} min</span></span>
                      </FieldLabel>
                    ))}
                  </RadioGroup>
                </FieldSet>
              )}

              {step === 2 && (
                <div><h2 className="text-xl font-bold">Where should we service?</h2><p className="mt-1 text-sm text-muted-foreground">Only units registered to this demonstration customer are available.</p>
                  <div className="mt-6"><FieldLabel htmlFor="address">Service address</FieldLabel><Select value={form.addressId ?? undefined} onValueChange={(value) => setForm((current) => ({ ...current, addressId: Number(value) }))}><SelectTrigger id="address" className="mt-2 h-12 w-full"><SelectValue placeholder="Choose an address" /></SelectTrigger><SelectContent>{context.addresses.map((address) => <SelectItem key={address.addressId} value={address.addressId}>{address.label ? `${address.label} · ` : ''}{address.addressLine}</SelectItem>)}</SelectContent></Select></div>
                  <FieldSet className="mt-7"><FieldLegend>Select aircon units</FieldLegend><div className="grid gap-3 sm:grid-cols-2">{context.units.map((unit) => {
                    const checked = form.unitIds.includes(unit.unitId);
                    return <FieldLabel key={unit.unitId} className="cursor-pointer rounded-2xl border bg-white p-4 has-data-checked:border-primary has-data-checked:bg-primary/5"><Checkbox checked={checked} onCheckedChange={(next) => toggleUnit(unit.unitId, Boolean(next))} aria-label={`Select ${unit.brand} in ${unit.location}`} /><span><span className="block font-semibold">{unit.brand} {unit.model}</span><span className="mt-1 block text-sm font-normal text-muted-foreground">{unit.location} · {unit.warrantyStatus}</span></span></FieldLabel>;
                  })}</div></FieldSet>
                </div>
              )}

              {step === 3 && (
                <div><h2 className="text-xl font-bold">Choose a preferred schedule</h2><p className="mt-1 text-sm text-muted-foreground">An administrator will confirm availability after submission.</p>
                  <div className="mt-6 grid gap-5 sm:grid-cols-2"><div><FieldLabel htmlFor="preferred-date">Preferred date</FieldLabel><Input id="preferred-date" type="date" min={minimumDate} value={form.preferredDate} onChange={(event) => setForm((current) => ({ ...current, preferredDate: event.target.value }))} className="mt-2 h-12" /></div><div><FieldLabel htmlFor="time-slot">Preferred time</FieldLabel><Select value={form.timeSlot || undefined} onValueChange={(value) => setForm((current) => ({ ...current, timeSlot: value as BookingInput['timeSlot'] }))}><SelectTrigger id="time-slot" className="mt-2 h-12 w-full"><SelectValue placeholder="Choose a time slot" /></SelectTrigger><SelectContent>{timeSlots.map((slot) => <SelectItem key={slot} value={slot}>{slot}</SelectItem>)}</SelectContent></Select></div></div>
                  <div className="mt-6"><FieldLabel htmlFor="problem-description">Problem description <span className="font-normal text-muted-foreground">(optional)</span></FieldLabel><Textarea id="problem-description" value={form.problemDescription} onChange={(event) => setForm((current) => ({ ...current, problemDescription: event.target.value }))} maxLength={1000} placeholder="Tell the technician about leaks, noise, weak cooling or other concerns." className="mt-2 min-h-28 resize-y" /><p className="mt-1 text-right text-xs text-muted-foreground">{form.problemDescription.length}/1000</p></div>
                </div>
              )}

              {step === 4 && (
                <div><h2 className="text-xl font-bold">Review your request</h2><p className="mt-1 text-sm text-muted-foreground">Check the details before saving this booking to the database.</p>
                  <dl className="mt-6 divide-y divide-border rounded-2xl border border-border bg-muted/35 px-5">
                    <ReviewRow icon={Snowflake} label="Service" value={selectedService?.serviceName ?? ''} />
                    <ReviewRow icon={MapPin} label="Address" value={`${selectedAddress?.addressLine ?? ''}${selectedAddress?.postalCode ? `, ${selectedAddress.postalCode}` : ''}`} />
                    <ReviewRow icon={Wind} label="Aircon units" value={selectedUnits.map((unit) => `${unit.brand} · ${unit.location}`).join(', ')} />
                    <ReviewRow icon={CalendarCheck} label="Schedule" value={`${form.preferredDate} · ${form.timeSlot}`} />
                    <ReviewRow icon={Clock3} label="Estimated total" value={formatMoney(total)} />
                  </dl>
                  {form.problemDescription && <div className="mt-5 rounded-2xl border border-border p-4"><p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Problem description</p><p className="mt-2 text-sm leading-6">{form.problemDescription}</p></div>}
                </div>
              )}

              {fieldError && <FieldError className="mt-5">{fieldError}</FieldError>}
              <div className="mt-8 flex items-center justify-between gap-3"><Button variant="ghost" disabled={step === 1 || submitting} onClick={() => { setFieldError(''); setStep((current) => Math.max(1, current - 1)); }}><ArrowLeft className="size-4" aria-hidden="true" />Back</Button>{step < 4 ? <Button onClick={nextStep}>Continue<ArrowRight className="size-4" aria-hidden="true" /></Button> : <Button onClick={handleConfirm} disabled={submitting}>{submitting ? 'Saving…' : 'Confirm booking'}<Check className="size-4" aria-hidden="true" /></Button>}</div>
            </CardContent></Card>
          </>
        )}

        {created && (
          <Alert className="rounded-3xl border-secondary/25 bg-[linear-gradient(145deg,#eff5ff,#ecfffb)] p-7 sm:p-10"><div className="grid size-14 place-items-center rounded-full bg-secondary text-white"><Check className="size-7" aria-hidden="true" /></div><div className="ml-0 sm:ml-2"><AlertTitle className="text-2xl font-bold">Booking submitted</AlertTitle><AlertDescription className="mt-3 max-w-xl text-base leading-7">Your {created.serviceName} request has been saved. An administrator will confirm the appointment.</AlertDescription><div className="mt-5 flex flex-wrap gap-6"><div><p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Reference</p><p className="mt-1 font-mono font-bold text-foreground">{created.bookingReference}</p></div><div><p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Status</p><p className="mt-1 font-semibold text-amber-700">{created.status}</p></div><div><p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Estimated total</p><p className="mt-1 font-semibold text-foreground">{formatMoney(created.totalAmount)}</p></div></div><div className="mt-7 flex flex-wrap gap-3"><Button render={<Link href="/customer/bookings" />}>View my bookings</Button><Button variant="outline" onClick={startAnotherBooking}>Book another service</Button></div></div></Alert>
        )}
      </div>
    </CoolCareShell>
  );
}

function ReviewRow({ icon: Icon, label, value }: { icon: typeof Snowflake; label: string; value: string }) {
  return <div className="grid gap-2 py-4 sm:grid-cols-[180px_1fr]"><dt className="flex items-center gap-2 text-sm font-medium text-muted-foreground"><Icon className="size-4" aria-hidden="true" />{label}</dt><dd className="text-sm font-semibold sm:text-right">{value}</dd></div>;
}
