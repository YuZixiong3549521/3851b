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
  const [address, setAddress] = useState('124 Palm Avenue, Apt 4B');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [step, setStep] = useState<'form' | 'success'>('form');

  // Sync default service when passed
  useEffect(() => {
    if (defaultService) {
      setServiceType(defaultService);
    }
  }, [defaultService]);

  // Pre-fill user contact info if available
  useEffect(() => {
    if (currentUser?.phone) {
      setPhone(currentUser.phone);
    }
  }, [currentUser]);

  if (!isOpen) return null;

  const currentPriceConfig = SERVICE_PRICING[serviceType] || { base: 65, perUnit: 45, desc: '' };
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

  try {
    const response = await fetch('http://localhost:3001/api/bookings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        userId: currentUser.id,
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
  }
}; 
  const handleFinish = () => {
    setStep('form');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 md:p-6 overflow-y-auto animate-in fade-in">
      {/* Modal Container: 650px - 800px on desktop */}
      <div className="bg-surface w-full max-w-2xl sm:max-w-3xl rounded-2xl shadow-2xl border border-outline-variant/40 p-5 sm:p-7 md:p-8 relative my-auto max-h-[92vh] flex flex-col">
        {/* Close button */}
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 sm:top-5 sm:right-5 text-outline hover:text-on-surface bg-surface-container-low hover:bg-surface-container border-none cursor-pointer flex items-center justify-center p-1.5 rounded-full transition-colors z-10"
          aria-label="Close booking modal"
        >
          <span className="material-symbols-outlined text-[22px]">close</span>
        </button>

        {step === 'form' ? (
          <div className="flex flex-col overflow-hidden">
            {/* Header */}
            <div className="flex items-center gap-3 mb-1 pr-10">
              <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                <span className="material-symbols-outlined text-[24px]">calendar_month</span>
              </div>
              <div>
                <h2 className="text-xl sm:text-2xl font-bold text-on-background">
                  Schedule an AC Care Service
                </h2>
                <p className="text-xs sm:text-sm text-on-surface-variant">
                  Select your service package, preferred time window, and property details
                </p>
              </div>
            </div>

            {/* Scrollable Form Body */}
            <form onSubmit={handleSubmit} className="mt-4 space-y-4 overflow-y-auto pr-1">
              {/* Authenticated Customer Banner */}
              {currentUser && (
                <div className="p-3 bg-primary-fixed/50 rounded-xl border border-primary-fixed-dim/60 text-xs flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-primary text-[18px]">verified</span>
                    <span className="font-medium text-on-primary-fixed">
                      Booking as <strong className="text-primary">{currentUser.name}</strong> ({currentUser.email})
                    </span>
                  </div>
                  {currentUser.propertyType && (
                    <span className="text-on-surface-variant hidden sm:inline">
                      {currentUser.propertyType}
                    </span>
                  )}
                </div>
              )}

              {/* Service Selection */}
              <div>
                <label className="block text-xs sm:text-sm font-semibold text-on-surface mb-1.5">
                  1. Select Service Package
                </label>
                <div className="relative">
                  <select
                    value={serviceType}
                    onChange={(e) => setServiceType(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-outline-variant bg-surface-container-lowest text-sm text-on-surface focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 cursor-pointer appearance-none"
                  >
                    <option value="Air Conditioning Cleaning">Air Conditioning Cleaning (Coil Deep Wash & Disinfection)</option>
                    <option value="Regular Maintenance">Regular Maintenance (24-Point Check & Gas Pressure Top-Up)</option>
                    <option value="Air Conditioning Repair">Air Conditioning Repair (Leak Fixes / Compressor / PCB)</option>
                    <option value="General Inspection / Diagnostic">General Inspection / Problem Diagnosis</option>
                    <option value="3-Unit Bundle Deal ($50 Off)">3-Unit Bundle Deal ($50 Special Savings)</option>
                    <option value="Annual Maintenance Contract">Annual Maintenance Contract (4 Visits + Priority)</option>
                  </select>
                  <span className="material-symbols-outlined absolute right-3 top-1/2 -translate-y-1/2 text-outline pointer-events-none text-[20px]">
                    expand_more
                  </span>
                </div>
                {currentPriceConfig.desc && (
                  <p className="text-xs text-on-surface-variant mt-1">
                    {currentPriceConfig.desc}
                  </p>
                )}
              </div>

              {/* Units & Date Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs sm:text-sm font-semibold text-on-surface mb-1.5">
                    2. Number of AC Units
                  </label>
                  <div className="flex items-center border border-outline-variant rounded-xl bg-surface-container-lowest overflow-hidden h-[42px]">
                    <button
                      type="button"
                      onClick={() => setUnitsCount(Math.max(1, unitsCount - 1))}
                      className="w-12 h-full bg-surface-container-low hover:bg-surface-container font-bold text-primary text-lg cursor-pointer border-none transition-colors flex items-center justify-center"
                    >
                      -
                    </button>
                    <span className="flex-1 text-center font-bold text-sm sm:text-base text-on-surface">
                      {unitsCount} {unitsCount === 1 ? 'Unit' : 'Units'}
                    </span>
                    <button
                      type="button"
                      onClick={() => setUnitsCount(unitsCount + 1)}
                      className="w-12 h-full bg-surface-container-low hover:bg-surface-container font-bold text-primary text-lg cursor-pointer border-none transition-colors flex items-center justify-center"
                    >
                      +
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs sm:text-sm font-semibold text-on-surface mb-1.5">
                    3. Preferred Date
                  </label>
                  <input
                    type="date"
                    required
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-xl border border-outline-variant bg-surface-container-lowest text-sm text-on-surface focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 h-[42px]"
                  />
                </div>
              </div>

              {/* Time Window */}
              <div>
                <label className="block text-xs sm:text-sm font-semibold text-on-surface mb-1.5">
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
                            ? 'bg-primary text-on-primary border-primary font-bold shadow-xs'
                            : 'bg-surface-container-lowest border-outline-variant hover:border-primary text-on-surface'
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
                  <label className="block text-xs sm:text-sm font-semibold text-on-surface mb-1.5">
                    5. Service Address & Unit Location
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. 742 Evergreen Terrace, Apt 4B"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-outline-variant bg-surface-container-lowest text-sm text-on-surface focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                  />
                </div>

                <div>
                  <label className="block text-xs sm:text-sm font-semibold text-on-surface mb-1.5">
                    Contact Phone Number
                  </label>
                  <input
                    type="tel"
                    required
                    placeholder="+1 (555) 019-2834"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-outline-variant bg-surface-container-lowest text-sm text-on-surface focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                  />
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className="block text-xs sm:text-sm font-semibold text-on-surface mb-1.5">
                  Unit Symptoms / Technician Instructions (Optional)
                </label>
                <textarea
                  rows={2}
                  placeholder="e.g. Master bedroom unit has weak airflow, water drips occasionally from right drain..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-xl border border-outline-variant bg-surface-container-lowest text-sm text-on-surface focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                />
              </div>

              {/* Price Summary & Action Buttons */}
              <div className="pt-2 border-t border-outline-variant/30 flex flex-col sm:flex-row items-center justify-between gap-4">
                <div>
                  <span className="text-xs text-on-surface-variant block">Estimated Price</span>
                  <div className="flex items-baseline gap-2">
                    <span className="text-2xl font-extrabold text-primary">
                      ${estimatedTotal}
                    </span>
                    <span className="text-xs text-on-surface-variant">
                      (Pay after technician completion)
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-3 w-full sm:w-auto">
                  <button
                    type="button"
                    onClick={onClose}
                    className="flex-1 sm:flex-initial px-5 py-2.5 border border-outline-variant rounded-full text-sm font-semibold text-on-surface bg-transparent hover:bg-surface-container-low cursor-pointer transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="flex-1 sm:flex-initial px-6 py-2.5 bg-primary text-on-primary rounded-full text-sm font-semibold hover:opacity-90 active:scale-95 cursor-pointer border-none shadow-sm transition-all flex items-center justify-center gap-1.5"
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
            <div className="w-16 h-16 rounded-full bg-tertiary-fixed text-tertiary-container mx-auto flex items-center justify-center shadow-sm">
              <span className="material-symbols-outlined text-[36px]">task_alt</span>
            </div>
            <h3 className="text-2xl font-bold text-on-background">
              Booking Confirmed!
            </h3>
            <p className="text-sm text-on-surface-variant max-w-md mx-auto">
              We have assigned a certified AC Care technician for <strong className="text-on-background">{serviceType}</strong> on{' '}
              <strong className="text-on-background">{date}</strong> during <strong className="text-on-background">{timeSlot}</strong>.
            </p>
            <div className="p-4 bg-surface-container-low rounded-xl border border-outline-variant/30 text-left text-xs sm:text-sm space-y-2 max-w-md mx-auto">
              <div className="flex justify-between">
                <span className="text-on-surface-variant">Service:</span>
                <span className="font-semibold text-on-background">{serviceType}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-on-surface-variant">Units Count:</span>
                <span className="font-semibold text-on-background">{unitsCount} Unit(s)</span>
              </div>
              <div className="flex justify-between">
                <span className="text-on-surface-variant">Address:</span>
                <span className="font-semibold text-on-background truncate max-w-[200px]">{address}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-on-surface-variant">Estimated Fee:</span>
                <span className="font-bold text-primary">${estimatedTotal}</span>
              </div>
              <div className="flex justify-between border-t border-outline-variant/20 pt-2">
                <span className="text-on-surface-variant">Status:</span>
                <span className="font-semibold text-tertiary-container flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-tertiary-container animate-ping"></span>
                  Technician Dispatched
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={handleFinish}
              className="px-8 py-3 bg-primary text-on-primary rounded-full text-sm font-semibold hover:opacity-90 active:scale-95 transition-all cursor-pointer border-none shadow-sm"
            >
              Done & Return to Home
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

