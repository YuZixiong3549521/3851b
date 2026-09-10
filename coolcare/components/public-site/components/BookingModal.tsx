import { apiFetch as fetch } from '../api';
import React, { useState, useEffect } from 'react';
import { User, PageRoute } from '../types';

interface BookingModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultService?: string;
  currentUser: User | null;
  onNavigate: (page: PageRoute) => void;
  onBookingConfirmed: (summary: string) => void;
}

const SERVICE_PRICING: Record<string, { base: number; perUnit: number; desc: string }> = {
  'Air Conditioning Cleaning': {
    base: 65,
    perUnit: 45,
    desc: 'Deep ultrasonic coil cleaning, antimicrobial rinse & filter rejuvenation',
  },
  'Regular Maintenance': {
    base: 85,
    perUnit: 55,
    desc: 'Comprehensive 24-point check, refrigerant pressure test & electrical audit',
  },
  'Air Conditioning Repair': {
    base: 120,
    perUnit: 0,
    desc: 'Precision diagnostic, leak rectification & OEM part replacement',
  },
  'General Inspection / Diagnostic': {
    base: 50,
    perUnit: 0,
    desc: 'Airflow velocity measurement, thermal leak scan & system health report',
  },
  '3-Unit Bundle Deal ($50 Off)': {
    base: 145,
    perUnit: 35,
    desc: 'Special bundle deal: 3 indoor units full chemical service with $50 savings',
  },
  'Annual Maintenance Contract': {
    base: 240,
    perUnit: 80,
    desc: '4 scheduled seasonal visits per year + emergency priority dispatch',
  },
};

export const BookingModal: React.FC<BookingModalProps> = ({
  isOpen,
  onClose,
  defaultService,
  currentUser,
  onNavigate,
  onBookingConfirmed,
}) => {
  const [serviceType, setServiceType] = useState(defaultService || 'Air Conditioning Cleaning');
  const [unitsCount, setUnitsCount] = useState(2);
  const [date, setDate] = useState(() => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow.toISOString().split('T')[0];
  });
  const [timeSlot, setTimeSlot] = useState('09:00 AM - 11:00 AM');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [step, setStep] = useState<'form' | 'success'>('form');
  const [prices,setPrices]=useState(SERVICE_PRICING);
  const [pricesReady,setPricesReady]=useState(false);
  useEffect(()=>{if(isOpen){setPricesReady(false);fetch('/api/public/offers').then(async response=>{if(!response.ok)throw new Error();return response.json();}).then(data=>{setPrices(Object.fromEntries(data.offers.map((offer:any)=>[offer.name,{...SERVICE_PRICING[offer.name],base:offer.base,perUnit:offer.perUnit}])));setPricesReady(true);}).catch(()=>alert('Unable to load current prices. Please close this window and retry.'));}},[isOpen]);

  // Sync default service when passed
  useEffect(() => {
    if (defaultService) {
      const service = SERVICE_PRICING[defaultService] ? defaultService : defaultService.includes('Annual') ? 'Annual Maintenance Contract' : defaultService.includes('Cleaning') ? 'Air Conditioning Cleaning' : 'General Inspection / Diagnostic';
      setServiceType(service);
      setNotes(service===defaultService ? '' : `Request: ${defaultService}. Please confirm eligibility and any discount before confirming the appointment.`);
    }
  }, [defaultService]);

  // Pre-fill user contact info if available
  useEffect(() => {
    if (currentUser?.phone) {
      setPhone(currentUser.phone);
    }
  }, [currentUser]);

  const [submitting,setSubmitting]=useState(false);
  const [requestId,setRequestId]=useState('');
  useEffect(()=>{if(isOpen){setStep('form');setRequestId(crypto.randomUUID());}},[isOpen]);
  if (!isOpen) return null;

  const currentPriceConfig = prices[serviceType] || { base: 0, perUnit: 0, desc: '' };
  const estimatedTotal =
    currentPriceConfig.perUnit > 0
      ? currentPriceConfig.base + Math.max(0, unitsCount - 1) * currentPriceConfig.perUnit
      : currentPriceConfig.base;

 const handleSubmit = async (e: React.FormEvent) => {
  e.preventDefault();

  if (!currentUser) {
    alert('Please sign in before booking a service.');
    return;
  }

  if(submitting||!pricesReady)return;
  setSubmitting(true);
  try {
    const response = await fetch('/api/public/bookings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        requestId, phone,
        serviceType: serviceType,
        servicePackage: serviceType,
        numberOfUnits: unitsCount,
        preferredDate: date,
        timeWindow: timeSlot,
        serviceAddress: address,
        symptoms: notes,
        specialNotes: notes,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      alert(data.message || 'Unable to create booking.');
      return;
    }

    console.log('Booking saved to database:', data);

    setStep('success');

    onBookingConfirmed(
      `Appointment booked for ${serviceType} on ${date} (${timeSlot}) for ${unitsCount} unit(s).`
    );

  } catch (error) {
    console.error('Booking error:', error);

    alert(
      'Unable to connect to the booking server. Please make sure the backend is running.'
    );
  } finally {setSubmitting(false);}
}; 
  const handleFinish = () => {
    setStep('form');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 md:p-6 overflow-y-auto animate-in fade-in">
      {/* Modal Container: 650px - 800px on desktop */}
      <div className="bg-ac-surface w-full max-w-2xl sm:max-w-3xl rounded-2xl shadow-2xl border border-ac-outline-variant/40 p-5 sm:p-7 md:p-8 relative my-auto max-h-[92vh] flex flex-col">
        {/* Close button */}
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 sm:top-5 sm:right-5 text-ac-outline hover:text-ac-on-surface bg-ac-surface-container-low hover:bg-ac-surface-container border-none cursor-pointer flex items-center justify-center p-1.5 rounded-full transition-colors z-10"
          aria-label="Close booking modal"
        >
          <span className="material-symbols-outlined text-[22px]">close</span>
        </button>

        {step === 'form' ? (
          <div className="flex flex-col overflow-hidden">
            {/* Header */}
            <div className="flex items-center gap-3 mb-1 pr-10">
              <div className="w-10 h-10 rounded-xl bg-ac-primary/10 text-ac-primary flex items-center justify-center shrink-0">
                <span className="material-symbols-outlined text-[24px]">calendar_month</span>
              </div>
              <div>
                <h2 className="text-xl sm:text-2xl font-bold text-ac-on-background">
                  Schedule an AC Care Service
                </h2>
                <p className="text-xs sm:text-sm text-ac-on-surface-variant">
                  Select your service package, preferred time window, and property details. Promotional eligibility is confirmed by the service team.
                </p>
              </div>
            </div>

            {/* Scrollable Form Body */}
            <form onSubmit={handleSubmit} className="mt-4 space-y-4 overflow-y-auto pr-1">
              {/* Authenticated Customer Banner */}
              {currentUser && (
                <div className="p-3 bg-ac-primary-fixed/50 rounded-xl border border-ac-primary-fixed-dim/60 text-xs flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-ac-primary text-[18px]">verified</span>
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

              {/* Service Selection */}
              <div>
                <label className="block text-xs sm:text-sm font-semibold text-ac-on-surface mb-1.5">
                  1. Select Service Package
                </label>
                <div className="relative">
                  <select
                    value={serviceType}
                    onChange={(e) => setServiceType(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-ac-outline-variant bg-ac-surface-container-lowest text-sm text-ac-on-surface focus:outline-none focus:border-ac-primary focus:ring-2 focus:ring-ac-primary/20 cursor-pointer appearance-none"
                  >
                    <option value="Air Conditioning Cleaning">Air Conditioning Cleaning (Coil Deep Wash & Disinfection)</option>
                    <option value="Regular Maintenance">Regular Maintenance (24-Point Check & Gas Pressure Top-Up)</option>
                    <option value="Air Conditioning Repair">Air Conditioning Repair (Leak Fixes / Compressor / PCB)</option>
                    <option value="General Inspection / Diagnostic">General Inspection / Problem Diagnosis</option>
                    <option value="3-Unit Bundle Deal ($50 Off)">3-Unit Bundle Deal ($50 Special Savings)</option>
                    <option value="Annual Maintenance Contract">Annual Maintenance Contract (4 Visits + Priority)</option>
                  </select>
                  <span className="material-symbols-outlined absolute right-3 top-1/2 -translate-y-1/2 text-ac-outline pointer-events-none text-[20px]">
                    expand_more
                  </span>
                </div>
                {currentPriceConfig.desc && (
                  <p className="text-xs text-ac-on-surface-variant mt-1">
                    {currentPriceConfig.desc}
                  </p>
                )}
              </div>

              {/* Units & Date Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs sm:text-sm font-semibold text-ac-on-surface mb-1.5">
                    2. Number of AC Units
                  </label>
                  <div className="flex items-center border border-ac-outline-variant rounded-xl bg-ac-surface-container-lowest overflow-hidden h-[42px]">
                    <button
                      type="button"
                      onClick={() => setUnitsCount(Math.max(1, unitsCount - 1))}
                      className="w-12 h-full bg-ac-surface-container-low hover:bg-ac-surface-container font-bold text-ac-primary text-lg cursor-pointer border-none transition-colors flex items-center justify-center"
                    >
                      -
                    </button>
                    <span className="flex-1 text-center font-bold text-sm sm:text-base text-ac-on-surface">
                      {unitsCount} {unitsCount === 1 ? 'Unit' : 'Units'}
                    </span>
                    <button
                      type="button"
                      onClick={() => setUnitsCount(unitsCount + 1)}
                      className="w-12 h-full bg-ac-surface-container-low hover:bg-ac-surface-container font-bold text-ac-primary text-lg cursor-pointer border-none transition-colors flex items-center justify-center"
                    >
                      +
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs sm:text-sm font-semibold text-ac-on-surface mb-1.5">
                    3. Preferred Date
                  </label>
                  <input
                    type="date"
                    required
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-xl border border-ac-outline-variant bg-ac-surface-container-lowest text-sm text-ac-on-surface focus:outline-none focus:border-ac-primary focus:ring-2 focus:ring-ac-primary/20 h-[42px]"
                  />
                </div>
              </div>

              {/* Time Window */}
              <div>
                <label className="block text-xs sm:text-sm font-semibold text-ac-on-surface mb-1.5">
                  4. Preferred Arrival Time Window
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                  {['09:00 AM - 11:00 AM', '11:30 AM - 01:30 PM', '02:00 PM - 04:00 PM', '04:30 PM - 06:30 PM'].map(
                    (slot) => (
                      <button
                        key={slot}
                        type="button"
                        onClick={() => setTimeSlot(slot)}
                        className={`py-2 px-2 rounded-xl border text-center transition-all cursor-pointer font-medium ${
                          timeSlot === slot
                            ? 'bg-ac-primary text-ac-on-primary border-ac-primary font-bold shadow-xs'
                            : 'bg-ac-surface-container-lowest border-ac-outline-variant hover:border-ac-primary text-ac-on-surface'
                        }`}
                      >
                        {slot}
                      </button>
                    )
                  )}
                </div>
              </div>

              {/* Address & Phone */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs sm:text-sm font-semibold text-ac-on-surface mb-1.5">
                    5. Service Address & Unit Location
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. 742 Evergreen Terrace, Apt 4B"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-ac-outline-variant bg-ac-surface-container-lowest text-sm text-ac-on-surface focus:outline-none focus:border-ac-primary focus:ring-2 focus:ring-ac-primary/20"
                  />
                </div>

                <div>
                  <label className="block text-xs sm:text-sm font-semibold text-ac-on-surface mb-1.5">
                    Contact Phone Number
                  </label>
                  <input
                    type="tel"
                    required
                    placeholder="+1 (555) 019-2834"
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
                <textarea
                  rows={2}
                  placeholder="e.g. Master bedroom unit has weak airflow, water drips occasionally from right drain..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-xl border border-ac-outline-variant bg-ac-surface-container-lowest text-sm text-ac-on-surface focus:outline-none focus:border-ac-primary focus:ring-2 focus:ring-ac-primary/20"
                />
              </div>

              {/* Price Summary & Action Buttons */}
              <div className="pt-2 border-t border-ac-outline-variant/30 flex flex-col sm:flex-row items-center justify-between gap-4">
                <div>
                  <span className="text-xs text-ac-on-surface-variant block">Estimated Price</span>
                  <div className="flex items-baseline gap-2">
                    <span className="text-2xl font-extrabold text-ac-primary">
                      ${estimatedTotal}
                    </span>
                    <span className="text-xs text-ac-on-surface-variant">
                      (Pay after technician completion)
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-3 w-full sm:w-auto">
                  <button
                    type="button"
                    onClick={onClose}
                    className="flex-1 sm:flex-initial px-5 py-2.5 border border-ac-outline-variant rounded-full text-sm font-semibold text-ac-on-surface bg-transparent hover:bg-ac-surface-container-low cursor-pointer transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit" disabled={submitting||!pricesReady}
                    className="flex-1 sm:flex-initial px-6 py-2.5 bg-ac-primary text-ac-on-primary rounded-full text-sm font-semibold hover:opacity-90 active:scale-95 cursor-pointer border-none shadow-sm transition-all flex items-center justify-center gap-1.5"
                  >
                    Confirm Booking
                    <span className="material-symbols-outlined text-[18px]">check</span>
                  </button>
                </div>
              </div>
            </form>
          </div>
        ) : (
          <div className="text-center py-6 sm:py-8 space-y-4 animate-in zoom-in-95 duration-200">
            <div className="w-16 h-16 rounded-full bg-ac-tertiary-fixed text-ac-tertiary-container mx-auto flex items-center justify-center shadow-sm">
              <span className="material-symbols-outlined text-[36px]">task_alt</span>
            </div>
            <h3 className="text-2xl font-bold text-ac-on-background">
              Booking Submitted!
            </h3>
            <p className="text-sm text-ac-on-surface-variant max-w-md mx-auto">
              Your request for <strong className="text-ac-on-background">{serviceType}</strong> has been saved for{' '}
              <strong className="text-ac-on-background">{date}</strong> during <strong className="text-ac-on-background">{timeSlot}</strong>.
            </p>
            <div className="p-4 bg-ac-surface-container-low rounded-xl border border-ac-outline-variant/30 text-left text-xs sm:text-sm space-y-2 max-w-md mx-auto">
              <div className="flex justify-between">
                <span className="text-ac-on-surface-variant">Service:</span>
                <span className="font-semibold text-ac-on-background">{serviceType}</span>
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
                <span className="text-ac-on-surface-variant">Estimated Fee:</span>
                <span className="font-bold text-ac-primary">${estimatedTotal}</span>
              </div>
              <div className="flex justify-between border-t border-ac-outline-variant/20 pt-2">
                <span className="text-ac-on-surface-variant">Status:</span>
                <span className="font-semibold text-ac-tertiary-container flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-ac-tertiary-container animate-ping"></span>
                  Awaiting Confirmation
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={handleFinish}
              className="px-8 py-3 bg-ac-primary text-ac-on-primary rounded-full text-sm font-semibold hover:opacity-90 active:scale-95 transition-all cursor-pointer border-none shadow-sm"
            >
              Done & Return to Home
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
