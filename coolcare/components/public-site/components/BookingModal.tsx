
import { SiteIcon } from '@/components/ui/site-icon';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { BookingServiceSelection, bookingEmailMessage, bookingFrequencyNotice, emptyBookingSelection, getBookingSelection, type BookingSelection } from '@/components/booking-service-selection';
import { BookingAddressField } from '@/components/booking-address-field';
import { EnglishDatePicker } from '@/components/english-date-picker';
import { BookingAvailabilityNotice, bookingConflictMessage } from '@/components/booking-availability-notice';
import { useBookingAvailability } from '@/lib/use-booking-availability';
import { bookingStatusLabel } from '@/components/booking-status';
import { AnnualBookingSummary } from '@/components/annual-booking-summary';
import { coolcareApi } from '@/lib/coolcare-api';
import { formatDate, formatMoney } from '@/lib/format';
import { assertBookingConfirmation } from '@/lib/annual-booking';
import { bookingDateError, bookingScheduleNotice, earliestBookingDate } from '@/lib/booking-schedule';
import type { Address, AnnualBundle, BookingOptions, EmailNotification } from '@/lib/coolcare-types';
import { apiFetch as fetch } from '../api';
import React, { useState, useEffect, useRef } from 'react';
import { User, PageRoute } from '../types';

interface BookingModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultService?: string;
  currentUser: User | null;
  onNavigate: (page: PageRoute) => void;
  onBookingConfirmed: (summary: string) => void;
}

export const BookingModal: React.FC<BookingModalProps> = ({
  isOpen,
  onClose,
  defaultService,
  currentUser,
  onNavigate,
  onBookingConfirmed,
}) => {
  const [selection, setSelection] = useState<BookingSelection>(emptyBookingSelection);
  const [options, setOptions] = useState<BookingOptions | null>(null);
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [unitsCount, setUnitsCount] = useState(2);
  const [date, setDate] = useState(() => earliestBookingDate());
  const [timeSlot, setTimeSlot] = useState('09:00 AM - 11:00 AM');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [step, setStep] = useState<'form' | 'success'>('form');
  const [pricesReady,setPricesReady]=useState(false);
  const [error, setError] = useState('');
  const [retryLocked, setRetryLocked] = useState(false);
  const [addressEditorOpen, setAddressEditorOpen] = useState(false);
  const [created, setCreated] = useState<{ id: number; status: string; totalAmount: number; emailNotification?: EmailNotification; annualBundle?: AnnualBundle | null } | null>(null);
  const ownerId = useRef<string | number | null>(null);
  const lastPrefill = useRef<string | undefined>(undefined);
  const requestInFlight = useRef(false);
  const pendingRequest = useRef<Record<string, unknown> | null>(null);
  useEffect(() => {
    if (!isOpen || !currentUser) return;
    let active = true;
    setPricesReady(false); setError('');
    const accountChanged = ownerId.current !== currentUser.id;
    const prefillChanged = lastPrefill.current !== defaultService;
    if (accountChanged) {
      ownerId.current = currentUser.id;
      pendingRequest.current = null;
      setRequestId(crypto.randomUUID()); setSelection(emptyBookingSelection); setStep('form'); setCreated(null); setRetryLocked(false); setAddress(''); setNotes(''); setPhone(currentUser.phone || '');
    }
    Promise.all([coolcareApi.getBookingOptions(), coolcareApi.getCustomerContext()]).then(([nextOptions, context]) => { if (active) {
      if (context.customer.userId !== Number(currentUser.id)) throw new Error('Your signed-in account changed. Reload before booking.');
      if (!retryLocked || accountChanged) setOptions(nextOptions);
      setAddresses(context.addresses); setPricesReady(true);
      setAddress(value => value || context.addresses.find(item => item.isDefault)?.addressLine || context.addresses[0]?.addressLine || '');
      if (!retryLocked && defaultService) setSelection(value => {
        if (!prefillChanged && !accountChanged && (value.serviceIds.length || value.packageId)) return value;
        const bundle = nextOptions.bundles.find(item => item.name.toLowerCase() === defaultService.toLowerCase());
        if (bundle) return { mode: 'bundle', packageId: bundle.packageId, serviceIds: bundle.serviceIds };
        const match = nextOptions.services.find(item => item.name.toLowerCase() === defaultService.toLowerCase());
        return match ? { mode: 'custom', serviceIds: [match.serviceId] } : value;
      });
      lastPrefill.current = defaultService;
    } }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : 'Unable to load prices. Please reopen this window to retry.'); });
    return () => { active = false; };
  }, [isOpen, currentUser?.id, defaultService]);

  // Pre-fill user contact info if available
  useEffect(() => {
    if (currentUser?.phone) {
      setPhone(currentUser.phone);
    }
  }, [currentUser]);

  const [submitting,setSubmitting]=useState(false);
  const [requestId,setRequestId]=useState('');
  const availability = useBookingAvailability({ serviceAddress: address, selectedDate: date, enabled: Boolean(isOpen && currentUser && pricesReady && step === 'form' && !retryLocked) });
  if (!isOpen) return null;

  const selectedServices = getBookingSelection(options, selection, unitsCount);
  const serviceType = selectedServices.label;
  const estimatedTotal = selectedServices.estimate;

 const handleSubmit = async (e: React.FormEvent) => {
  e.preventDefault();

  if (!currentUser) {
    setError('Please sign in before booking a service.');
    return;
  }

  if(requestInFlight.current||addressEditorOpen||(!pendingRequest.current && (!pricesReady||!selectedServices.valid)))return;
  if (!pendingRequest.current && availability.selectedDateBlocked) { setError(bookingConflictMessage); return; }
  if (!pendingRequest.current && (address.trim().length < 5 || address.trim().length > 255)) { setError('Enter a service address between 5 and 255 characters.'); return; }
  if (!pendingRequest.current && bookingDateError(date)) { setError(bookingDateError(date)); return; }
  requestInFlight.current = true;
  setSubmitting(true); setError('');
  if (!pendingRequest.current) pendingRequest.current = {
    requestId, phone, expectedUserId: Number(currentUser.id), ...selectedServices.payload,
    numberOfUnits: unitsCount, preferredDate: date, timeWindow: timeSlot,
    serviceAddress: address, symptoms: notes, specialNotes: notes,
  };
  try {
    const response = await fetch('/api/public/bookings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(pendingRequest.current),
    });

    const data = await response.json();

    if (!response.ok) {
      throw Object.assign(new Error(data.message || data.error || 'Unable to create booking.'), { status: response.status });
    }

    assertBookingConfirmation(data.booking, Boolean(pendingRequest.current.packageId));
    setCreated({ ...data.booking, emailNotification: data.booking.emailNotification ?? data.emailNotification }); setRetryLocked(false); pendingRequest.current = null;
    setStep('success');

    onBookingConfirmed(
      data.booking.annualBundle ? `Four quarterly cleaning requests saved for ${unitsCount} unit(s). The service team will confirm availability.` : `Booking request saved for ${serviceType} on ${formatDate(date)} (${timeSlot}) for ${unitsCount} unit(s).`
    );

  } catch (reason) {
    const rejected = reason instanceof Error && 'status' in reason && Number(reason.status) < 500;
    if (rejected) pendingRequest.current = null;
    if (reason instanceof Error && reason.message.includes('signed-in account changed')) {
      setOptions(null); setAddresses([]); setSelection(emptyBookingSelection); setAddress(''); setPhone(''); setNotes(''); setPricesReady(false);
    }
    setRetryLocked(!rejected);
    setError(`${reason instanceof Error ? reason.message : 'Unable to reach the booking server.'}${rejected ? '' : ' Retry confirmation with the same details to safely check or complete this request.'}`);
  } finally {requestInFlight.current = false; setSubmitting(false);}
};
  const handleFinish = () => {
    if (requestInFlight.current) return;
    if (step !== 'success') { onClose(); return; }
    setStep('form');
    setRequestId(crypto.randomUUID()); setSelection(emptyBookingSelection); setCreated(null); setNotes('');
    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !submitting) handleFinish(); }}>
      {/* Modal Container: 650px - 800px on desktop */}
      <DialogContent showCloseButton={false} className="ac-site bg-ac-surface w-[calc(100%-2rem)] max-w-2xl sm:max-w-3xl rounded-2xl shadow-2xl border border-ac-outline-variant/40 p-5 sm:p-7 md:p-8 max-h-[92dvh] flex flex-col overflow-hidden" aria-describedby={undefined}>
        <DialogTitle className="sr-only">Schedule an AC Care Service</DialogTitle>
        {/* Close button */}
        <Button variant="ghost"
          type="button"
          onClick={handleFinish} disabled={submitting}
          className="absolute top-4 right-4 sm:top-5 sm:right-5 text-ac-outline hover:text-ac-on-surface bg-ac-surface-container-low hover:bg-ac-surface-container border-none cursor-pointer flex items-center justify-center p-1.5 rounded-full transition-colors z-10"
          aria-label="Close booking modal"
        >
          <SiteIcon className=" text-[22px]">close</SiteIcon>
        </Button>

        {step === 'form' ? (
          <div className="flex min-h-0 flex-col overflow-hidden">
            {/* Header */}
            <div className="flex items-center gap-3 mb-1 pr-10">
              <div className="w-10 h-10 rounded-xl bg-ac-primary/10 text-ac-primary flex items-center justify-center shrink-0">
                <SiteIcon className=" text-[24px]">calendar_month</SiteIcon>
              </div>
              <div>
                <h2 className="text-xl sm:text-2xl font-bold text-ac-on-background">
                  Schedule an AC Care Service
                </h2>
                <p className="text-xs sm:text-sm text-ac-on-surface-variant">
                  Choose your services, preferred time window and property details.
                </p>
              </div>
            </div>

            {/* Scrollable Form Body */}
            <form onSubmit={handleSubmit} className="mt-4 space-y-4 overflow-y-auto pr-1">
              {/* Authenticated Customer Banner */}
              {currentUser && (
                <div className="p-3 bg-ac-primary-fixed/50 rounded-xl border border-ac-primary-fixed-dim/60 text-xs flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <SiteIcon className=" text-ac-primary text-[18px]">verified</SiteIcon>
                    <span className="font-medium text-ac-on-primary-fixed">
                      Booking as <strong className="text-ac-primary">{currentUser.name}</strong> ({currentUser.email})
                    </span>
                  </div>
                  {currentUser.propertyType && (
                    <span className="text-ac-on-surface-variant hidden sm:inline">
                      {currentUser.propertyType}
                    </span>
                  )}
                </div>
              )}

              {!currentUser && <div className="space-y-3 rounded-xl border p-4 text-sm"><p>Sign in to book a service.</p><Button type="button" onClick={() => { onClose(); onNavigate('login'); }}>Sign in</Button></div>}
              {currentUser && !pricesReady && !error && <p role="status" className="text-sm">Loading your service options…</p>}
              <fieldset disabled={submitting || retryLocked || !currentUser || !pricesReady} className="min-w-0 space-y-4">
              {/* Service Selection */}
              <div>
                <label className="block text-xs sm:text-sm font-semibold text-ac-on-surface mb-1.5">
                  1. How would you like to book?
                </label>
                {options && <BookingServiceSelection options={options} value={selection} onChange={setSelection} units={unitsCount} disabled={submitting || retryLocked || !pricesReady} />}
              </div>

              {/* Units & Date Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs sm:text-sm font-semibold text-ac-on-surface mb-1.5">
                    2. Number of AC Units
                  </label>
                  <div className="flex items-center border border-ac-outline-variant rounded-xl bg-ac-surface-container-lowest overflow-hidden h-[42px]">
                    <Button variant="ghost"
                      type="button"
                      aria-label="Remove one AC unit"
                      onClick={() => setUnitsCount(Math.max(1, unitsCount - 1))}
                      className="w-12 h-full bg-ac-surface-container-low hover:bg-ac-surface-container font-bold text-ac-primary text-lg cursor-pointer border-none transition-colors flex items-center justify-center"
                    >
                      -
                    </Button>
                    <span className="flex-1 text-center font-bold text-sm sm:text-base text-ac-on-surface">
                      {unitsCount} {unitsCount === 1 ? 'Unit' : 'Units'}
                    </span>
                    <Button variant="ghost"
                      type="button"
                      aria-label="Add one AC unit"
                      onClick={() => setUnitsCount(Math.min(10, unitsCount + 1))}
                      className="w-12 h-full bg-ac-surface-container-low hover:bg-ac-surface-container font-bold text-ac-primary text-lg cursor-pointer border-none transition-colors flex items-center justify-center"
                    >
                      +
                    </Button>
                  </div>
                </div>

                <div>
                  <label htmlFor="public-preferred-date" className="block text-xs sm:text-sm font-semibold text-ac-on-surface mb-1.5">
                    {selectedServices.isAnnual ? '3. First Preferred Visit Date' : '3. Preferred Date'}
                  </label>
                  <EnglishDatePicker id="public-preferred-date" label={selectedServices.isAnnual ? 'First preferred visit date' : 'Preferred date'} min={earliestBookingDate()} aria-invalid={!retryLocked && (Boolean(bookingDateError(date)) || availability.selectedDateBlocked)} value={date} blockedDates={availability.blockedDates} onMonthChange={availability.onMonthChange} disabled={submitting || retryLocked || !pricesReady} onChange={value => { setDate(value); setError(bookingDateError(value)); }} />
                  <BookingAvailabilityNotice availability={availability} />
                </div>
              </div>

              {/* Time Window */}
              <div>
                <label className="block text-xs sm:text-sm font-semibold text-ac-on-surface mb-1.5">
                  4. Preferred Arrival Time Window
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                  {['09:00 AM - 11:00 AM', '11:00 AM - 01:00 PM', '02:00 PM - 04:00 PM', '04:00 PM - 06:00 PM'].map(
                    (slot) => (
                      <Button variant="ghost"
                        key={slot}
                        type="button"
                        onClick={() => setTimeSlot(slot)}
                        className={`h-auto whitespace-normal py-2 px-2 rounded-xl border text-center transition-all cursor-pointer font-medium ${
                          timeSlot === slot
                            ? 'bg-ac-primary text-ac-on-primary border-ac-primary font-bold shadow-xs'
                            : 'bg-ac-surface-container-lowest border-ac-outline-variant hover:border-ac-primary text-ac-on-surface'
                        }`}
                      >
                        {slot}
                      </Button>
                    )
                  )}
                </div>
                <p className="mt-3 rounded-xl bg-ac-primary/5 p-3 text-sm leading-6 text-ac-on-surface-variant">{bookingScheduleNotice}</p><p className="mt-2 text-xs leading-5 text-ac-on-surface-variant">{bookingFrequencyNotice}</p>
              </div>

              {/* Address & Phone */}
              {currentUser && <BookingAddressField key={currentUser.id} expectedUserId={Number(currentUser.id)} addresses={addresses} value={address} onChange={setAddress} onAddressSaved={saved => { setAddresses(current => [saved, ...current.filter(item => item.addressId !== saved.addressId)]); setAddress(saved.addressLine); }} onEditingChange={setAddressEditorOpen} />}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs sm:text-sm font-semibold text-ac-on-surface mb-1.5">
                    Contact Phone Number
                  </label>
                  <Input
                    type="tel"
                    required
                    maxLength={30}
                    placeholder="e.g. +65 9123 4567"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-ac-outline-variant bg-ac-surface-container-lowest text-sm text-ac-on-surface focus:outline-none focus:border-ac-primary focus:ring-2 focus:ring-ac-primary/20"
                  />
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className="block text-xs sm:text-sm font-semibold text-ac-on-surface mb-1.5">
                  Unit Symptoms / Technician Instructions (Optional)
                </label>
                <Textarea
                  rows={2}
                  maxLength={1000}
                  placeholder="e.g. Master bedroom unit has weak airflow, water drips occasionally from right drain..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-xl border border-ac-outline-variant bg-ac-surface-container-lowest text-sm text-ac-on-surface focus:outline-none focus:border-ac-primary focus:ring-2 focus:ring-ac-primary/20"
                />
              </div>
              </fieldset>
              {selectedServices.isAnnual && <AnnualBookingSummary firstDate={date} timeSlot={timeSlot} totalAmount={estimatedTotal} collapsible />}
              {selectedServices.pricingNote && <p className="text-sm text-ac-on-surface-variant">{selectedServices.pricingNote}</p>}
              {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}

              {/* Price Summary & Action Buttons */}
              <div className="sticky bottom-0 z-10 border-t border-ac-outline-variant/30 bg-ac-surface py-3 flex flex-col sm:flex-row items-center justify-between gap-4">
                <div>
                  <span className="text-xs text-ac-on-surface-variant block">{selectedServices.isAnnual ? 'Annual Estimate' : 'Visit Estimate'}</span>
                  <div className="flex items-baseline gap-2">
                    <span className="text-2xl font-extrabold text-ac-primary">
                      {selectedServices.valid ? formatMoney(estimatedTotal) : 'Choose services'}
                    </span>
                    <span className="text-xs text-ac-on-surface-variant">
                      (Pay after each service visit)
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-3 w-full sm:w-auto">
                  <Button variant="ghost"
                    type="button"
                    onClick={handleFinish} disabled={submitting}
                    className="flex-1 sm:flex-initial px-5 py-2.5 border border-ac-outline-variant rounded-full text-sm font-semibold text-ac-on-surface bg-transparent hover:bg-ac-surface-container-low cursor-pointer transition-colors"
                  >
                    Cancel
                  </Button>
                  <Button variant="ghost"
                    type="submit" disabled={submitting || addressEditorOpen || (!pendingRequest.current && (!pricesReady || !selectedServices.valid || availability.selectedDateBlocked))}
                    className="flex-1 sm:flex-initial px-6 py-2.5 bg-ac-primary text-ac-on-primary rounded-full text-sm font-semibold hover:opacity-90 active:scale-95 cursor-pointer border-none shadow-sm transition-all flex items-center justify-center gap-1.5"
                  >
                    {submitting ? 'Saving…' : retryLocked ? 'Retry confirmation' : 'Confirm Booking'}
                    <SiteIcon className=" text-[18px]">check</SiteIcon>
                  </Button>
                </div>
              </div>
            </form>
          </div>
        ) : (
          <div className="min-h-0 overflow-y-auto text-center py-6 sm:py-8 space-y-4 animate-in zoom-in-95 duration-200">
            <div className="w-16 h-16 rounded-full bg-ac-tertiary-fixed text-ac-tertiary-container mx-auto flex items-center justify-center shadow-sm">
              <SiteIcon className=" text-[36px]">task_alt</SiteIcon>
            </div>
            <h3 className="text-2xl font-bold text-ac-on-background">
              {created?.annualBundle ? 'Four Booking Requests Saved!' : 'Booking Submitted!'}
            </h3>
            <p className="text-sm text-ac-on-surface-variant max-w-md mx-auto">
              Your request for <strong className="text-ac-on-background">{serviceType}</strong> has been saved {created?.annualBundle ? 'with the first preferred visit on' : 'for'}{' '}
              <strong className="text-ac-on-background">{formatDate(date)}</strong> during <strong className="text-ac-on-background">{timeSlot}</strong>.
            </p>
            <div className="p-4 bg-ac-surface-container-low rounded-xl border border-ac-outline-variant/30 text-left text-xs sm:text-sm space-y-2 max-w-md mx-auto">
              <div className="flex justify-between"><span>Reference:</span><strong>#{created?.id}</strong></div>
              <div className="flex justify-between">
                <span className="text-ac-on-surface-variant">Service:</span>
                <span className="max-w-[70%] text-right font-semibold text-ac-on-background">{selectedServices.serviceNames}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-ac-on-surface-variant">Units Count:</span>
                <span className="font-semibold text-ac-on-background">{unitsCount} Unit(s)</span>
              </div>
              <div className="flex justify-between">
                <span className="text-ac-on-surface-variant">Address:</span>
                <span className="font-semibold text-ac-on-background truncate max-w-[200px]">{address}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-ac-on-surface-variant">{created?.annualBundle ? 'Annual Estimate:' : 'Visit Estimate:'}</span>
                <span className="font-bold text-ac-primary">{formatMoney(created?.annualBundle?.totalAmount ?? created?.totalAmount ?? estimatedTotal)}</span>
              </div>
              <div className="flex justify-between border-t border-ac-outline-variant/20 pt-2">
                <span className="text-ac-on-surface-variant">Status:</span>
                <span className="font-semibold text-ac-tertiary-container flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-ac-tertiary-container animate-ping"></span>
                  {bookingStatusLabel(created?.status ?? 'Submitted')}
                </span>
              </div>
            </div>
            {created?.annualBundle && <AnnualBookingSummary saved={created.annualBundle} totalAmount={created.annualBundle.totalAmount} />}
            {created?.emailNotification && <p role="status" className="text-sm text-ac-on-surface-variant">{bookingEmailMessage(created.emailNotification)}</p>}
            <Button variant="ghost"
              type="button"
              onClick={handleFinish}
              className="px-8 py-3 bg-ac-primary text-ac-on-primary rounded-full text-sm font-semibold hover:opacity-90 active:scale-95 transition-all cursor-pointer border-none shadow-sm"
            >
              Done & Return to Home
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
