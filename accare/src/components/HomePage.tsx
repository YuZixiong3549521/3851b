import React, { useState } from 'react';
import { PageRoute, ProblemItem } from '../types';

interface HomePageProps {
  onNavigate: (page: PageRoute, hash?: string) => void;
  onOpenBooking: (serviceName?: string) => void;
}

export const HomePage: React.FC<HomePageProps> = ({ onNavigate, onOpenBooking }) => {
  const [selectedIssue, setSelectedIssue] = useState<string | null>(null);
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  const toggleFaq = (index: number) => {
    setOpenFaq(openFaq === index ? null : index);
  };

  const problems: ProblemItem[] = [
    {
      id: 'poor-cooling',
      name: 'Poor Cooling',
      description: 'Your AC is not cooling effectively.',
      icon: 'thermostat',
      colorClass: 'bg-rose-50 text-rose-600 border border-rose-200/80',
      textColorClass: 'text-rose-600',
    },
    {
      id: 'water-leakage',
      name: 'Water Leakage',
      description: 'Water is dripping or leaking from the unit.',
      icon: 'water_drop',
      colorClass: 'bg-slate-100 text-slate-700 border border-slate-200/80',
      textColorClass: 'text-slate-700',
    },
    {
      id: 'unusual-noise',
      name: 'Unusual Noise',
      description: 'Strange or loud sounds are coming from the AC.',
      icon: 'volume_up',
      colorClass: 'bg-indigo-50 text-indigo-600 border border-indigo-200/80',
      textColorClass: 'text-indigo-600',
    },
    {
      id: 'weak-airflow',
      name: 'Weak Airflow',
      description: 'Airflow is weak or inconsistent.',
      icon: 'air',
      colorClass: 'bg-sky-50 text-sky-600 border border-sky-200/80',
      textColorClass: 'text-sky-600',
    },
    {
      id: 'electrical-issues',
      name: 'Electrical Issues',
      description: 'Possible power, wiring, or electrical faults.',
      icon: 'electrical_services',
      colorClass: 'bg-amber-50 text-amber-700 border border-amber-200/80',
      textColorClass: 'text-amber-700',
    },
    {
      id: 'needs-cleaning',
      name: 'Needs Cleaning',
      description: 'Dust or dirt may be affecting the unit.',
      icon: 'cleaning_services',
      colorClass: 'bg-emerald-50 text-emerald-600 border border-emerald-200/80',
      textColorClass: 'text-emerald-600',
    },
  ];

  return (
    <main>
      {/* Hero Section */}
      <section className="relative pt-xl pb-xl md:pt-[120px] md:pb-[120px] overflow-hidden" id="home">
        {/* Background Decoration */}
        <div className="absolute inset-0 z-0 opacity-20 pointer-events-none bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-primary-fixed via-background to-background"></div>
        <div className="max-w-container-max mx-auto px-gutter relative z-10">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-lg items-center">
            {/* Hero Text */}
            <div className="flex flex-col gap-md max-w-2xl">
              <div className="inline-flex items-center gap-xs bg-surface-container text-primary font-label-sm text-label-sm px-sm py-xs rounded-full w-fit mb-xs">
                <span className="material-symbols-outlined text-[16px]">verified</span>
                <span>Certified Professionals</span>
              </div>
              <h1 className="font-display-lg-mobile md:font-display-lg text-display-lg-mobile md:text-display-lg text-on-background font-bold tracking-tight">
                Keep Your Air Conditioner Running at Its Best
              </h1>
              <p className="font-body-lg text-body-lg text-on-surface-variant max-w-xl">
                Professional air conditioning cleaning, maintenance and repair services designed to keep your home comfortable all year round. Fast, reliable, and transparent.
              </p>
              <div className="flex flex-col sm:flex-row gap-sm mt-sm">
                <button
                  onClick={() => onOpenBooking()}
                  className="inline-flex items-center justify-center bg-primary text-on-primary font-label-md text-label-md h-12 px-md rounded-full shadow-sm hover:shadow-md hover:bg-on-primary-fixed transition-all active:scale-95 cursor-pointer border-none"
                >
                  Book a Service
                  <span className="material-symbols-outlined ml-xs text-[20px]">arrow_forward</span>
                </button>
                <a
                  href="#services"
                  className="inline-flex items-center justify-center bg-transparent text-primary border-2 border-primary font-label-md text-label-md h-12 px-md rounded-full hover:bg-primary-fixed/20 transition-all active:scale-95 text-decoration-none cursor-pointer"
                >
                  Explore Our Services
                </a>
              </div>
              <div className="flex items-center gap-sm mt-md pt-sm border-t border-outline-variant/30">
                <div className="flex -space-x-2">
                  <img
                    className="w-10 h-10 rounded-full border-2 border-surface object-cover"
                    alt="Satisfied customer"
                    src="https://lh3.googleusercontent.com/aida-public/AB6AXuDgYC0WJ-FWfXJOaHfUuZiAFZ3jrHGoRvVpINRyGiWc4B0upOgEPOAXM81uxJqqiso6DxPNAAfQCO6glOb64kpdR_Wu1t4n9BZWma8PqbHhQUGoL8XCUYzg18kjVaRaOiYOD7vd5vwK2B17iqsAUxj4zTitjd7KKXLYUPNVmBhqXmljdUFuIAwksWZ4YgwwJ7Yzi_OEYLoS-pNEtKC6KMsr_-HGXSq6JMSP1depeg4DZ9rLWswtzK1rhw"
                  />
                  <img
                    className="w-10 h-10 rounded-full border-2 border-surface object-cover"
                    alt="Customer in office"
                    src="https://lh3.googleusercontent.com/aida-public/AB6AXuCMOo4AntS3C8_Yj20SxyHtOk5VcvfpFxCKxeI1Iig1t-IIkD906NLLMwV8t9IOS9QTvvwRZyrGXIyV67RDoKJzaNk_ILnFkThS3dPIYDbK4KOs7WMYapIUxgDh4ge9KTqK9LVEo6uT0Ewp4mcs4B5R-lb_kNZcWQ7bZtGTlOKlYd3iO5h8kQ0Hm9qWaBnTvHAk5pKd_tiV4RYha3J9RuoyTpkjsBUOpvG2wOAhdojl8_BMZ-q8xBqt3g"
                  />
                  <img
                    className="w-10 h-10 rounded-full border-2 border-surface object-cover"
                    alt="Smiling customer"
                    src="https://lh3.googleusercontent.com/aida-public/AB6AXuD_b5IauYO_Ct_s7hcwaplEs9NfZqKZcwIYp9ns3Ah0v61As0kysreTnVzLmqCU3CyBuKB7rgvKbNQaZGg2kq0dxFOCgdqaFXbgs9qIpjjgdMuxW6CguKMSsSblIT5tnUmyyixDHPKY2ut0DrkN8R4yh0e8HE0eBnKXd_IRXxWvDHtgkD_mhu912BYp4-FOZ39C3a0FGRotRvYaCBakuvf3tBpcPswcdkXE4ajk4R3Z0BhY2SRnPs51mQ"
                  />
                </div>
                <p className="font-label-sm text-label-sm text-on-surface-variant">
                  Trusted by 5,000+ <br />
                  Happy Customers
                </p>
              </div>
            </div>
            {/* Hero Image Area (Bento-style composition) */}
            <div className="relative h-[400px] md:h-[600px] w-full rounded-2xl overflow-hidden shadow-lg group">
              <img
                className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                alt="AC Care technician servicing unit"
                src="https://lh3.googleusercontent.com/aida-public/AB6AXuB9DImHj-m1yBtmceh8RMt2MVLMjVXD0Sxago7Yru19djqFNxG-3-2ipogBMmo5hUSl2t0cNKVneXhs4YpjKpZWby0jJJbaXwUQS4260BNTgyusHStEzYhcejXWxmGWCITxtOvCDAWNZmwr5m44HpfXycHp0l-4oIHj9g6tQlFSfLi3jFBRcZIdzdSnLMi0cbEedxl1n-14XD4bRbVcaYyITzPDXKMcSChTM_jS0b5BfRcxy_m0E6xcdA"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-on-background/80 via-transparent to-transparent pointer-events-none"></div>
              {/* Floating Badges */}
              <div className="absolute bottom-md left-md right-md flex gap-sm justify-between items-end">
                <div className="bg-surface/90 backdrop-blur-sm p-sm rounded-xl shadow-md border border-outline-variant/20 max-w-[200px]">
                  <div className="flex items-center gap-xs text-tertiary-container mb-xs">
                    <span className="material-symbols-outlined text-[20px]" style={{ fontVariationSettings: "'FILL' 1" }}>
                      star
                    </span>
                    <span className="font-label-md text-label-md font-bold">4.9/5 Rating</span>
                  </div>
                  <p className="font-label-sm text-label-sm text-on-surface-variant leading-tight">
                    Consistently highly rated by our community.
                  </p>
                </div>
                <button
                  onClick={() => onOpenBooking('Customer Support / Diagnostic Inquiry')}
                  className="bg-primary-container text-on-primary-container p-sm rounded-full shadow-md flex items-center justify-center w-14 h-14 cursor-pointer border-none hover:scale-105 transition-transform"
                  title="Contact Support"
                >
                  <span className="material-symbols-outlined text-[28px]">support_agent</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* About AC Care (Bento Grid) */}
      <section className="py-xl bg-surface-container-low" id="about">
        <div className="max-w-container-max mx-auto px-gutter">
          <div className="text-center max-w-2xl mx-auto mb-lg">
            <h2 className="font-headline-md text-headline-md text-on-background mb-sm font-bold">Why Choose AC Care?</h2>
            <p className="font-body-md text-body-md text-on-surface-variant">
              We bring transparency, digital convenience, and technical excellence to air conditioning maintenance. Experience the modern way to care for your cooling systems.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-md">
            {/* Feature 1 */}
            <div className="bg-surface p-md rounded-xl shadow-sm border border-outline-variant/30 hover:shadow-md transition-shadow group flex flex-col h-full">
              <div className="w-12 h-12 rounded-full bg-primary-fixed flex items-center justify-center text-primary mb-md group-hover:scale-110 transition-transform">
                <span className="material-symbols-outlined text-[24px]">touch_app</span>
              </div>
              <h3 className="font-headline-sm text-headline-sm text-on-background mb-xs font-semibold">Simple Booking</h3>
              <p className="font-body-md text-body-md text-on-surface-variant flex-grow">
                Schedule your service in seconds through our intuitive platform. Select your issue, choose a time, and we handle the rest.
              </p>
            </div>
            {/* Feature 2 */}
            <div className="bg-surface p-md rounded-xl shadow-sm border border-outline-variant/30 hover:shadow-md transition-shadow group flex flex-col h-full">
              <div className="w-12 h-12 rounded-full bg-tertiary-fixed flex items-center justify-center text-tertiary-container mb-md group-hover:scale-110 transition-transform">
                <span className="material-symbols-outlined text-[24px]">engineering</span>
              </div>
              <h3 className="font-headline-sm text-headline-sm text-on-background mb-xs font-semibold">Professional Service</h3>
              <p className="font-body-md text-body-md text-on-surface-variant flex-grow">
                All our technicians are certified, rigorously trained, and equipped with the latest diagnostic tools for precise care.
              </p>
            </div>
            {/* Feature 3 */}
            <div className="bg-surface p-md rounded-xl shadow-sm border border-outline-variant/30 hover:shadow-md transition-shadow group flex flex-col h-full">
              <div className="w-12 h-12 rounded-full bg-secondary-fixed flex items-center justify-center text-on-secondary-fixed-variant mb-md group-hover:scale-110 transition-transform">
                <span className="material-symbols-outlined text-[24px]">description</span>
              </div>
              <h3 className="font-headline-sm text-headline-sm text-on-background mb-xs font-semibold">Digital Service Records</h3>
              <p className="font-body-md text-body-md text-on-surface-variant flex-grow">
                Access comprehensive digital reports after every visit, detailing the health of your unit and work performed.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Our Services (Glassmorphism Cards) */}
      <section className="py-xl relative" id="services">
        <div className="absolute inset-0 bg-gradient-to-b from-background to-surface-container-highest z-0"></div>
        <div className="max-w-container-max mx-auto px-gutter relative z-10">
          <div className="flex flex-col md:flex-row justify-between items-end mb-lg gap-sm">
            <div className="max-w-xl">
              <h2 className="font-headline-md text-headline-md text-on-background mb-sm font-bold">Comprehensive Services</h2>
              <p className="font-body-md text-body-md text-on-surface-variant">
                From routine chemical washes to complex compressor repairs, we provide full-spectrum care for your cooling systems.
              </p>
            </div>
            <button
              onClick={() => onOpenBooking()}
              className="text-primary font-label-md text-label-md hover:underline inline-flex items-center cursor-pointer border-none bg-transparent p-0"
            >
              View All Services <span className="material-symbols-outlined ml-xs text-[18px]">arrow_forward</span>
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-md">
            {/* Service 1 */}
            <div className="bg-surface/80 backdrop-blur-md p-md rounded-2xl shadow-sm border border-outline-variant/50 hover:shadow-md hover:border-primary/50 transition-all flex flex-col">
              <div className="h-48 rounded-xl bg-surface-dim mb-md overflow-hidden relative">
                <img
                  className="w-full h-full object-cover"
                  alt="Air Conditioning Cleaning"
                  src="https://lh3.googleusercontent.com/aida-public/AB6AXuD-Hoe8MDSP2jC3h6T0onhXBxQ7umz9UdM-rrSXufFBRxz3bS2H57hXf6xmMIyU0c1S5rrmkB09lbrvYNlhs_oxAycROqK12II2tRB54WJCNKH8Idt6aOfByv4dheAevfoBXPLdS4u8z3pMj6G7u-WUu3NijtyQxlLLFYzWPZnid_E3J42sLoN6LaVLiOe6h4nXjGb-r8lDx5dqdRUFmyYFssu3fSDEZ-ATEF07oR42QXrdgfp1nKixnQ"
                />
                <div className="absolute top-sm right-sm bg-surface/90 text-primary px-sm py-xs rounded-full font-label-sm text-label-sm shadow-sm backdrop-blur-sm font-semibold">
                  Most Popular
                </div>
              </div>
              <h3 className="font-headline-sm text-headline-sm text-on-background mb-sm font-semibold">Air Conditioning Cleaning</h3>
              <ul className="font-body-md text-body-md text-on-surface-variant space-y-2 mb-md flex-grow">
                <li className="flex items-start gap-xs">
                  <span className="material-symbols-outlined text-primary text-[20px]">check_circle</span> General Cleaning
                </li>
                <li className="flex items-start gap-xs">
                  <span className="material-symbols-outlined text-primary text-[20px]">check_circle</span> Chemical Overhaul
                </li>
                <li className="flex items-start gap-xs">
                  <span className="material-symbols-outlined text-primary text-[20px]">check_circle</span> Filter Replacement
                </li>
              </ul>
              <button
                onClick={() => onOpenBooking('Air Conditioning Cleaning')}
                className="w-full inline-flex items-center justify-center bg-primary-fixed text-on-primary-fixed font-label-md text-label-md h-12 rounded-lg hover:bg-primary hover:text-on-primary transition-colors cursor-pointer border-none"
              >
                Book Cleaning
              </button>
            </div>

            {/* Service 2 */}
            <div className="bg-surface/80 backdrop-blur-md p-md rounded-2xl shadow-sm border border-outline-variant/50 hover:shadow-md hover:border-primary/50 transition-all flex flex-col">
              <div className="h-48 rounded-xl bg-surface-dim mb-md overflow-hidden relative">
                <img
                  className="w-full h-full object-cover"
                  alt="Regular Maintenance"
                  src="https://lh3.googleusercontent.com/aida-public/AB6AXuCB4edGVsgX9v6-hNq7ov6zk5XccEWy0IYJ67x28o98-3ShA66todNyvhsuFCYqR6dyuBrTjEG21dyI-U6x1Tdvv7GcPus9VVcy8i3LThWKNRSAJxgyqaYfQSgPWgyAbQ5DzRKQ-6MqFd-e4AbsL7ykyzSRRFvT73FHOZR5Hy0Ih4RoP2QOZwWdXWDLB97Zo-ITgMcwxK0HFT9ELdtWe6iNS8qhiHGBFaYEj94wT8KhgkKqex2fh0O3MQ"
                />
              </div>
              <h3 className="font-headline-sm text-headline-sm text-on-background mb-sm font-semibold">Regular Maintenance</h3>
              <ul className="font-body-md text-body-md text-on-surface-variant space-y-2 mb-md flex-grow">
                <li className="flex items-start gap-xs">
                  <span className="material-symbols-outlined text-primary text-[20px]">check_circle</span> Bi-Annual Inspections
                </li>
                <li className="flex items-start gap-xs">
                  <span className="material-symbols-outlined text-primary text-[20px]">check_circle</span> Gas Top-Up (Freon)
                </li>
                <li className="flex items-start gap-xs">
                  <span className="material-symbols-outlined text-primary text-[20px]">check_circle</span> Performance Diagnostics
                </li>
              </ul>
              <button
                onClick={() => onOpenBooking('Regular Maintenance')}
                className="w-full inline-flex items-center justify-center bg-primary-fixed text-on-primary-fixed font-label-md text-label-md h-12 rounded-lg hover:bg-primary hover:text-on-primary transition-colors cursor-pointer border-none"
              >
                Book Maintenance
              </button>
            </div>

            {/* Service 3 */}
            <div className="bg-surface/80 backdrop-blur-md p-md rounded-2xl shadow-sm border border-outline-variant/50 hover:shadow-md hover:border-primary/50 transition-all flex flex-col">
              <div className="h-48 rounded-xl bg-surface-dim mb-md overflow-hidden relative">
                <img
                  className="w-full h-full object-cover"
                  alt="Air Conditioning Repair"
                  src="https://lh3.googleusercontent.com/aida-public/AB6AXuCUq_H7G5DhHcNiKvMYBxa55-VzXvKtQu5Fgw4MuWrsdGkMLUJu8ROEP8ctICQ3Ub-SbA8G18yrhLfkToYkKkBWVKJLxP9JDMct1TG3YxKyd-dElL4Hjbf2YRM6AeE_v4rSZUILdj07SasCN_hBltI0z4raUtdOb4afyMnhTvztInOVZvjW2ecfszpPHO8nzUx_veGrCoG60LM1BqtjJGIT6K_p1ZPiWF2B-7FDvtVm-0Bf8YNhZAFSEQ"
                />
              </div>
              <h3 className="font-headline-sm text-headline-sm text-on-background mb-sm font-semibold">Air Conditioning Repair</h3>
              <ul className="font-body-md text-body-md text-on-surface-variant space-y-2 mb-md flex-grow">
                <li className="flex items-start gap-xs">
                  <span className="material-symbols-outlined text-primary text-[20px]">check_circle</span> Water Leak Fixes
                </li>
                <li className="flex items-start gap-xs">
                  <span className="material-symbols-outlined text-primary text-[20px]">check_circle</span> Compressor Replacement
                </li>
                <li className="flex items-start gap-xs">
                  <span className="material-symbols-outlined text-primary text-[20px]">check_circle</span> Circuit Board Repairs
                </li>
              </ul>
              <button
                onClick={() => onOpenBooking('Air Conditioning Repair')}
                className="w-full inline-flex items-center justify-center bg-primary-fixed text-on-primary-fixed font-label-md text-label-md h-12 rounded-lg hover:bg-primary hover:text-on-primary transition-colors cursor-pointer border-none"
              >
                Book Repair
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Identifying the Issue */}
      <section className="py-16 sm:py-20 lg:py-24 bg-background border-t border-outline-variant/20" id="diagnostic">
        <div className="max-w-[1320px] mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-2xl mx-auto mb-10 sm:mb-12">
            <h2 className="text-2xl sm:text-3xl md:text-4xl font-extrabold text-on-background tracking-tight">
              Identifying the Issue
            </h2>
            <p className="mt-3 text-sm sm:text-base text-on-surface-variant leading-relaxed">
              Experiencing issues with your unit? Select a common problem below to find the right service solution.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 sm:gap-5">
            {problems.map((problem) => {
              const isSelected = selectedIssue === problem.name;
              return (
                <div
                  key={problem.id}
                  onClick={() => setSelectedIssue(isSelected ? null : problem.name)}
                  className={`relative rounded-2xl p-5 text-center transition-all duration-200 cursor-pointer group flex flex-col items-center justify-between h-full select-none ${
                    isSelected
                      ? 'bg-primary-fixed/20 border-2 border-primary shadow-md -translate-y-1'
                      : 'bg-surface border border-outline-variant/50 shadow-xs hover:shadow-md hover:border-primary/50 hover:-translate-y-1'
                  }`}
                >
                  <div className="flex flex-col items-center">
                    <div
                      className={`w-14 h-14 sm:w-16 sm:h-16 rounded-full flex items-center justify-center mb-3.5 shrink-0 transition-transform duration-200 group-hover:scale-105 ${problem.colorClass}`}
                    >
                      <span className="material-symbols-outlined text-[26px] sm:text-[28px]">{problem.icon}</span>
                    </div>
                    <h3 className="font-bold text-sm sm:text-base text-on-background mb-1.5 leading-snug">
                      {problem.name}
                    </h3>
                    <p className="text-xs text-on-surface-variant leading-relaxed text-center">
                      {problem.description}
                    </p>
                  </div>

                  {isSelected && (
                    <div className="mt-3 inline-flex items-center gap-1 text-[11px] font-bold text-primary bg-primary/10 px-2.5 py-0.5 rounded-full">
                      <span className="material-symbols-outlined text-[14px]">check</span>
                      <span>Selected</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="mt-10 sm:mt-12 text-center">
            <button
              type="button"
              onClick={() => onOpenBooking(selectedIssue ? `Inspection for: ${selectedIssue}` : 'General Inspection / Diagnostic')}
              className="inline-flex items-center justify-center gap-2 bg-primary hover:bg-primary/90 active:scale-[0.98] text-on-primary font-semibold text-sm sm:text-base h-12 px-8 rounded-xl shadow-sm hover:shadow-md transition-all cursor-pointer border-none whitespace-nowrap"
            >
              <span className="material-symbols-outlined text-[20px]">search</span>
              <span>Request an Inspection</span>
            </button>
          </div>
        </div>
      </section>

      {/* How AC Care Works */}
      <section className="py-16 sm:py-20 lg:py-24 bg-surface-container-low overflow-hidden" id="how-it-works">
        <div className="max-w-[1320px] mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-2xl mx-auto mb-12 sm:mb-16">
            <h2 className="text-2xl sm:text-3xl md:text-4xl font-extrabold text-on-background tracking-tight">
              How AC Care Works
            </h2>
            <p className="mt-3 text-sm sm:text-base text-on-surface-variant leading-relaxed">
              A streamlined, transparent process designed to get your AC running perfectly with zero hassle.
            </p>
          </div>

          <div className="relative">
            {/* Horizontal Timeline Connector (Desktop) */}
            <div className="hidden lg:block absolute top-10 left-[10%] right-[10%] h-[2px] bg-outline-variant/60 -z-0"></div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-8 lg:gap-6 relative z-10">
              {/* Step 1 */}
              <div className="flex flex-col items-center text-center group">
                <div className="w-20 h-20 rounded-full bg-surface border-2 border-primary/30 flex items-center justify-center text-primary shadow-xs group-hover:border-primary group-hover:shadow-md transition-all z-10 shrink-0 mb-3">
                  <span className="material-symbols-outlined text-[32px]">touch_app</span>
                </div>
                <span className="inline-block text-[11px] font-bold text-primary bg-primary/10 px-2.5 py-0.5 rounded-full mb-2">
                  01
                </span>
                <h4 className="text-base font-bold text-on-background mb-1.5 leading-snug">
                  Choose Service
                </h4>
                <p className="text-xs sm:text-sm text-on-surface-variant leading-relaxed max-w-[200px] mx-auto">
                  Select the type of maintenance or repair you need.
                </p>
              </div>

              {/* Step 2 */}
              <div className="flex flex-col items-center text-center group">
                <div className="w-20 h-20 rounded-full bg-surface border-2 border-primary/30 flex items-center justify-center text-primary shadow-xs group-hover:border-primary group-hover:shadow-md transition-all z-10 shrink-0 mb-3">
                  <span className="material-symbols-outlined text-[32px]">calendar_month</span>
                </div>
                <span className="inline-block text-[11px] font-bold text-primary bg-primary/10 px-2.5 py-0.5 rounded-full mb-2">
                  02
                </span>
                <h4 className="text-base font-bold text-on-background mb-1.5 leading-snug">
                  Select Date/Time
                </h4>
                <p className="text-xs sm:text-sm text-on-surface-variant leading-relaxed max-w-[200px] mx-auto">
                  Pick a convenient slot that fits your schedule.
                </p>
              </div>

              {/* Step 3 */}
              <div className="flex flex-col items-center text-center group">
                <div className="w-20 h-20 rounded-full bg-surface border-2 border-primary/30 flex items-center justify-center text-primary shadow-xs group-hover:border-primary group-hover:shadow-md transition-all z-10 shrink-0 mb-3">
                  <span className="material-symbols-outlined text-[32px]">person_check</span>
                </div>
                <span className="inline-block text-[11px] font-bold text-primary bg-primary/10 px-2.5 py-0.5 rounded-full mb-2">
                  03
                </span>
                <h4 className="text-base font-bold text-on-background mb-1.5 leading-snug">
                  Technician Assignment
                </h4>
                <p className="text-xs sm:text-sm text-on-surface-variant leading-relaxed max-w-[200px] mx-auto">
                  A certified expert is assigned to your request.
                </p>
              </div>

              {/* Step 4 */}
              <div className="flex flex-col items-center text-center group">
                <div className="w-20 h-20 rounded-full bg-surface border-2 border-primary/30 flex items-center justify-center text-primary shadow-xs group-hover:border-primary group-hover:shadow-md transition-all z-10 shrink-0 mb-3">
                  <span className="material-symbols-outlined text-[32px]">build</span>
                </div>
                <span className="inline-block text-[11px] font-bold text-primary bg-primary/10 px-2.5 py-0.5 rounded-full mb-2">
                  04
                </span>
                <h4 className="text-base font-bold text-on-background mb-1.5 leading-snug">
                  Service in Progress
                </h4>
                <p className="text-xs sm:text-sm text-on-surface-variant leading-relaxed max-w-[200px] mx-auto">
                  Professional servicing at your location.
                </p>
              </div>

              {/* Step 5 */}
              <div className="flex flex-col items-center text-center group">
                <div className="w-20 h-20 rounded-full bg-surface border-2 border-emerald-400 flex items-center justify-center text-emerald-600 shadow-xs group-hover:border-emerald-500 group-hover:shadow-md transition-all z-10 shrink-0 mb-3">
                  <span className="material-symbols-outlined text-[32px]">task_alt</span>
                </div>
                <span className="inline-block text-[11px] font-bold text-emerald-700 bg-emerald-100 px-2.5 py-0.5 rounded-full mb-2">
                  05
                </span>
                <h4 className="text-base font-bold text-on-background mb-1.5 leading-snug">
                  Service Completed
                </h4>
                <p className="text-xs sm:text-sm text-on-surface-variant leading-relaxed max-w-[200px] mx-auto">
                  Receive a digital report and enjoy cool air.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Current Promotions */}
      <section className="py-xl bg-background" id="promotions">
        <div className="max-w-container-max mx-auto px-gutter">
          <div className="flex flex-col md:flex-row justify-between items-end mb-lg gap-sm">
            <div className="max-w-xl">
              <h2 className="font-headline-md text-headline-md text-on-background mb-sm font-bold">Current Promotions</h2>
              <p className="font-body-md text-body-md text-on-surface-variant">
                Take advantage of our seasonal offers and bundle deals for the best value.
              </p>
            </div>
          </div>
          {/* Horizontal Scroll Snap for Promos */}
          <div className="flex overflow-x-auto pb-md snap-x snap-mandatory gap-md hide-scrollbar">
            {/* Promo 1 */}
            <div className="min-w-[300px] md:min-w-[350px] snap-start bg-primary-container text-on-primary-container p-md rounded-2xl shadow-sm flex flex-col relative overflow-hidden">
              <div className="absolute -right-8 -top-8 w-32 h-32 bg-primary/20 rounded-full blur-2xl pointer-events-none"></div>
              <div className="inline-flex bg-on-primary text-primary px-sm py-xs rounded-full font-label-sm text-label-sm w-fit mb-md shadow-sm font-semibold">
                New Customer
              </div>
              <h3 className="font-headline-sm text-headline-sm font-bold mb-xs relative z-10">20% Off First Cleaning</h3>
              <p className="font-body-md text-body-md opacity-90 mb-lg relative z-10 flex-grow">
                Welcome to AC Care! Get a significant discount on your first general cleaning service.
              </p>
              <button
                onClick={() => onOpenBooking('20% Off First Cleaning Promo')}
                className="inline-flex items-center justify-center bg-on-primary text-primary font-label-md text-label-md h-10 px-md rounded-lg w-fit hover:bg-surface transition-colors relative z-10 cursor-pointer border-none font-semibold"
              >
                Claim Offer
              </button>
            </div>
            {/* Promo 2 */}
            <div className="min-w-[300px] md:min-w-[350px] snap-start bg-surface-container-high border border-outline-variant/50 p-md rounded-2xl shadow-sm flex flex-col">
              <div className="inline-flex bg-tertiary-fixed text-on-tertiary-fixed-variant px-sm py-xs rounded-full font-label-sm text-label-sm w-fit mb-md shadow-sm font-semibold">
                Popular
              </div>
              <h3 className="font-headline-sm text-headline-sm font-bold text-on-background mb-xs">3-Unit Bundle Deal</h3>
              <p className="font-body-md text-body-md text-on-surface-variant mb-lg flex-grow">
                Have multiple units? Clean 3 units in one visit and save $50 on the total bill.
              </p>
              <button
                onClick={() => onOpenBooking('3-Unit Bundle Deal ($50 Off)')}
                className="inline-flex items-center justify-center bg-primary text-on-primary font-label-md text-label-md h-10 px-md rounded-lg w-fit hover:bg-primary-fixed hover:text-on-primary-fixed transition-colors cursor-pointer border-none"
              >
                Book Bundle
              </button>
            </div>
            {/* Promo 3 */}
            <div className="min-w-[300px] md:min-w-[350px] snap-start bg-surface-container-high border border-outline-variant/50 p-md rounded-2xl shadow-sm flex flex-col">
              <div className="inline-flex bg-surface-variant text-on-surface-variant px-sm py-xs rounded-full font-label-sm text-label-sm w-fit mb-md shadow-sm font-semibold">
                Maintenance
              </div>
              <h3 className="font-headline-sm text-headline-sm font-bold text-on-background mb-xs">Annual Contract (10% Off)</h3>
              <p className="font-body-md text-body-md text-on-surface-variant mb-lg flex-grow">
                Sign up for a 1-year maintenance plan (2 visits) and receive a 10% discount.
              </p>
              <button
                onClick={() => onOpenBooking('Annual Maintenance Contract (10% Off)')}
                className="inline-flex items-center justify-center bg-primary text-on-primary font-label-md text-label-md h-10 px-md rounded-lg w-fit hover:bg-primary-fixed hover:text-on-primary-fixed transition-colors cursor-pointer border-none"
              >
                View Plans
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Customer Testimonials */}
      <section className="py-xl bg-surface-container-highest">
        <div className="max-w-container-max mx-auto px-gutter">
          <div className="text-center mb-lg">
            <h2 className="font-headline-md text-headline-md text-on-background mb-sm font-bold">What Our Customers Say</h2>
            <p className="font-body-md text-body-md text-on-surface-variant max-w-2xl mx-auto">
              Real experiences from homeowners who trust AC Care for their cooling needs.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-md">
            {/* Testimonial 1 */}
            <div className="bg-surface p-md rounded-2xl shadow-sm border border-outline-variant/20">
              <div className="flex items-center gap-xs text-tertiary-container mb-sm">
                {[1, 2, 3, 4, 5].map((i) => (
                  <span key={i} className="material-symbols-outlined text-[20px]" style={{ fontVariationSettings: "'FILL' 1" }}>
                    star
                  </span>
                ))}
              </div>
              <p className="font-body-md text-body-md text-on-surface mb-md">
                "Incredibly professional service. The technician arrived exactly on time, diagnosed the issue quickly, and left the area spotless. The digital report afterward was a great touch."
              </p>
              <div className="flex items-center gap-sm">
                <div className="w-10 h-10 rounded-full bg-primary-fixed flex items-center justify-center text-primary font-bold">
                  AT
                </div>
                <div>
                  <h4 className="font-label-md text-label-md text-on-background font-semibold">Alex T.</h4>
                  <p className="font-label-sm text-label-sm text-on-surface-variant">Residential Customer</p>
                </div>
              </div>
            </div>
            {/* Testimonial 2 */}
            <div className="bg-surface p-md rounded-2xl shadow-sm border border-outline-variant/20">
              <div className="flex items-center gap-xs text-tertiary-container mb-sm">
                {[1, 2, 3, 4, 5].map((i) => (
                  <span key={i} className="material-symbols-outlined text-[20px]" style={{ fontVariationSettings: "'FILL' 1" }}>
                    star
                  </span>
                ))}
              </div>
              <p className="font-body-md text-body-md text-on-surface mb-md">
                "Booking was so easy compared to calling around different companies. The chemical wash made my 5-year-old AC unit run like it's brand new again. Highly recommend!"
              </p>
              <div className="flex items-center gap-sm">
                <div className="w-10 h-10 rounded-full bg-secondary-fixed flex items-center justify-center text-on-secondary-fixed font-bold">
                  JL
                </div>
                <div>
                  <h4 className="font-label-md text-label-md text-on-background font-semibold">Jamie L.</h4>
                  <p className="font-label-sm text-label-sm text-on-surface-variant">First-time User</p>
                </div>
              </div>
            </div>
            {/* Testimonial 3 */}
            <div className="bg-surface p-md rounded-2xl shadow-sm border border-outline-variant/20">
              <div className="flex items-center gap-xs text-tertiary-container mb-sm">
                {[1, 2, 3, 4].map((i) => (
                  <span key={i} className="material-symbols-outlined text-[20px]" style={{ fontVariationSettings: "'FILL' 1" }}>
                    star
                  </span>
                ))}
                <span className="material-symbols-outlined text-[20px]">star_half</span>
              </div>
              <p className="font-body-md text-body-md text-on-surface mb-md">
                "The transparent pricing is what sold me. No hidden fees or surprise charges at the end. The technician explained exactly what was wrong before starting the repair."
              </p>
              <div className="flex items-center gap-sm">
                <div className="w-10 h-10 rounded-full bg-tertiary-fixed flex items-center justify-center text-on-tertiary-fixed font-bold">
                  SK
                </div>
                <div>
                  <h4 className="font-label-md text-label-md text-on-background font-semibold">Sam K.</h4>
                  <p className="font-label-sm text-label-sm text-on-surface-variant">Maintenance Plan Member</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ Section */}
      <section className="py-xl bg-background" id="faq">
        <div className="max-w-container-max mx-auto px-gutter flex flex-col lg:flex-row gap-lg">
          <div className="lg:w-1/3">
            <h2 className="font-headline-md text-headline-md text-on-background mb-sm font-bold">Frequently Asked Questions</h2>
            <p className="font-body-md text-body-md text-on-surface-variant mb-md">
              Got a question? We're here to help. If you don't see your answer here, feel free to contact our support team.
            </p>
            <a
              className="inline-flex items-center gap-xs text-primary font-label-md text-label-md hover:underline font-semibold"
              href="#contact"
            >
              Contact Support <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
            </a>
          </div>
          <div className="lg:w-2/3 flex flex-col gap-sm">
            {/* FAQ 1 */}
            <div className="bg-surface border border-outline-variant/30 rounded-xl overflow-hidden shadow-sm transition-colors">
              <button
                className="w-full text-left px-md py-sm flex justify-between items-center bg-surface hover:bg-surface-container-low transition-colors cursor-pointer border-none"
                onClick={() => toggleFaq(1)}
              >
                <span className="font-label-md text-label-md text-on-background font-semibold">
                  How often should I service my air conditioner?
                </span>
                <span
                  className={`material-symbols-outlined text-outline transition-transform duration-300 ${
                    openFaq === 1 ? 'rotate-180 text-primary' : ''
                  }`}
                >
                  expand_more
                </span>
              </button>
              {openFaq === 1 && (
                <div className="bg-surface-container-lowest border-t border-outline-variant/10 px-md pb-sm pt-xs font-body-md text-body-md text-on-surface-variant animate-in fade-in duration-200">
                  For optimal performance and energy efficiency, we recommend a general cleaning every 3 to 4 months, and a major service (like a chemical wash) once a year. High-usage units may require more frequent servicing.
                </div>
              )}
            </div>

            {/* FAQ 2 */}
            <div className="bg-surface border border-outline-variant/30 rounded-xl overflow-hidden shadow-sm transition-colors">
              <button
                className="w-full text-left px-md py-sm flex justify-between items-center bg-surface hover:bg-surface-container-low transition-colors cursor-pointer border-none"
                onClick={() => toggleFaq(2)}
              >
                <span className="font-label-md text-label-md text-on-background font-semibold">
                  What is included in a General Cleaning?
                </span>
                <span
                  className={`material-symbols-outlined text-outline transition-transform duration-300 ${
                    openFaq === 2 ? 'rotate-180 text-primary' : ''
                  }`}
                >
                  expand_more
                </span>
              </button>
              {openFaq === 2 && (
                <div className="bg-surface-container-lowest border-t border-outline-variant/10 px-md pb-sm pt-xs font-body-md text-body-md text-on-surface-variant animate-in fade-in duration-200">
                  General cleaning includes washing the air filters, cleaning the indoor evaporator coil, clearing the drainage pipe to prevent water leaks, checking the gas pressure, and testing the overall system performance.
                </div>
              )}
            </div>

            {/* FAQ 3 */}
            <div className="bg-surface border border-outline-variant/30 rounded-xl overflow-hidden shadow-sm transition-colors">
              <button
                className="w-full text-left px-md py-sm flex justify-between items-center bg-surface hover:bg-surface-container-low transition-colors cursor-pointer border-none"
                onClick={() => toggleFaq(3)}
              >
                <span className="font-label-md text-label-md text-on-background font-semibold">
                  Do I need to create an account to book?
                </span>
                <span
                  className={`material-symbols-outlined text-outline transition-transform duration-300 ${
                    openFaq === 3 ? 'rotate-180 text-primary' : ''
                  }`}
                >
                  expand_more
                </span>
              </button>
              {openFaq === 3 && (
                <div className="bg-surface-container-lowest border-t border-outline-variant/10 px-md pb-sm pt-xs font-body-md text-body-md text-on-surface-variant animate-in fade-in duration-200">
                  Yes, creating a free account allows us to save your property details, track your service history, provide digital reports, and manage your upcoming bookings efficiently.
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="py-xl relative overflow-hidden bg-primary text-on-primary">
        <div className="absolute inset-0 z-0 opacity-10 pointer-events-none bg-[radial-gradient(ellipse_at_bottom_left,_var(--tw-gradient-stops))] from-white via-transparent to-transparent"></div>
        <div className="max-w-3xl mx-auto px-gutter relative z-10 text-center">
          <h2 className="font-display-lg-mobile md:font-headline-md text-display-lg-mobile md:text-headline-md mb-md font-bold text-white">
            Ready to Take Care of Your Air Conditioner?
          </h2>
          <p className="font-body-lg text-body-lg opacity-90 mb-lg text-white/90">
            Join thousands of satisfied customers who trust AC Care for their home comfort.
          </p>
          <div className="flex flex-col sm:flex-row gap-md justify-center items-center">
            <button
              onClick={() => onOpenBooking()}
              className="inline-flex items-center justify-center bg-on-primary text-primary font-label-md text-label-md h-12 px-lg rounded-full shadow-md hover:bg-surface transition-all active:scale-95 w-full sm:w-auto cursor-pointer border-none font-semibold"
            >
              Book a Service
            </button>
            <button
              onClick={() => onNavigate('register')}
              className="inline-flex items-center justify-center bg-transparent border-2 border-on-primary text-on-primary font-label-md text-label-md h-12 px-lg rounded-full hover:bg-on-primary/10 transition-all active:scale-95 w-full sm:w-auto cursor-pointer font-semibold"
            >
              Create Account
            </button>
          </div>
        </div>
      </section>
    </main>
  );
};
