
import { SiteIcon } from '@/components/ui/site-icon';
import { Button } from '@/components/ui/button';
import React, { useEffect, useState } from 'react';
import { apiFetch } from '../api';
import { formatMoney } from '@/lib/format';
import { PageRoute, ProblemItem } from '../types';

interface HomePageProps {
  onNavigate: (page: PageRoute, hash?: string) => void;
  onOpenBooking: (serviceName?: string) => void;
}

export const HomePage: React.FC<HomePageProps> = ({ onNavigate, onOpenBooking }) => {
  const [selectedIssue, setSelectedIssue] = useState<string | null>(null);
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [prices, setPrices] = useState<Array<{ name: string; base: number; perUnit: number }>>([]);
  useEffect(() => {
    let active = true;
    apiFetch('/api/public/offers').then(response => {
      if (!response.ok) throw new Error('Prices unavailable');
      return response.json();
    }).then(data => { if (active) setPrices(data.offers); }).catch(() => { if (active) setPrices([]); });
    return () => { active = false; };
  }, []);
  const priceFor = (name: string) => {
    const offer = prices.find(item => item.name === name);
    return offer ? formatMoney(Number(offer.base)) : 'See price when booking';
  };

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
        <div className="absolute inset-0 z-0 opacity-20 pointer-events-none bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-ac-primary-fixed via-ac-background to-ac-background"></div>
        <div className="max-w-container-max mx-auto px-gutter relative z-10">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-lg items-center">
            {/* Hero Text */}
            <div className="flex flex-col gap-md max-w-2xl">
              <div className="inline-flex items-center gap-xs bg-ac-surface-container text-ac-primary font-label-sm text-label-sm px-sm py-xs rounded-full w-fit mb-xs">
                <SiteIcon className=" text-[16px]">verified</SiteIcon>
                <span>Aircon Care, Made Simple</span>
              </div>
              <h1 className="font-display-lg-mobile md:font-display-lg text-display-lg-mobile md:text-display-lg text-ac-on-background font-bold tracking-tight">
                Keep Your Air Conditioner Running at Its Best
              </h1>
              <p className="font-body-lg text-body-lg text-ac-on-surface-variant max-w-xl">
                Professional air conditioning cleaning, maintenance and repair services designed to keep your home comfortable all year round. Fast, reliable, and transparent.
              </p>
              <div className="flex flex-col sm:flex-row gap-sm mt-sm">
                <Button variant="ghost"
                  onClick={() => onOpenBooking()}
                  className="inline-flex items-center justify-center bg-ac-primary text-ac-on-primary font-label-md text-label-md h-12 px-md rounded-full shadow-sm hover:shadow-md hover:bg-ac-on-primary-fixed transition-all active:scale-95 cursor-pointer border-none"
                >
                  Book a Service
                  <SiteIcon className=" ml-xs text-[20px]">arrow_forward</SiteIcon>
                </Button>
                <a
                  href="#services"
                  className="inline-flex items-center justify-center bg-transparent text-ac-primary border-2 border-ac-primary font-label-md text-label-md h-12 px-md rounded-full hover:bg-ac-primary-fixed/20 transition-all active:scale-95 text-decoration-none cursor-pointer"
                >
                  Explore Our Services
                </a>
              </div>
              <div className="flex items-center gap-sm mt-md pt-sm border-t border-ac-outline-variant/30">
                <div className="flex -space-x-2">
                  <img
                    className="w-10 h-10 rounded-full border-2 border-ac-surface object-cover"
                    alt="Satisfied customer"
                    src="https://lh3.googleusercontent.com/aida-public/AB6AXuDgYC0WJ-FWfXJOaHfUuZiAFZ3jrHGoRvVpINRyGiWc4B0upOgEPOAXM81uxJqqiso6DxPNAAfQCO6glOb64kpdR_Wu1t4n9BZWma8PqbHhQUGoL8XCUYzg18kjVaRaOiYOD7vd5vwK2B17iqsAUxj4zTitjd7KKXLYUPNVmBhqXmljdUFuIAwksWZ4YgwwJ7Yzi_OEYLoS-pNEtKC6KMsr_-HGXSq6JMSP1depeg4DZ9rLWswtzK1rhw"
                  />
                  <img
                    className="w-10 h-10 rounded-full border-2 border-ac-surface object-cover"
                    alt="Customer in office"
                    src="https://lh3.googleusercontent.com/aida-public/AB6AXuCMOo4AntS3C8_Yj20SxyHtOk5VcvfpFxCKxeI1Iig1t-IIkD906NLLMwV8t9IOS9QTvvwRZyrGXIyV67RDoKJzaNk_ILnFkThS3dPIYDbK4KOs7WMYapIUxgDh4ge9KTqK9LVEo6uT0Ewp4mcs4B5R-lb_kNZcWQ7bZtGTlOKlYd3iO5h8kQ0Hm9qWaBnTvHAk5pKd_tiV4RYha3J9RuoyTpkjsBUOpvG2wOAhdojl8_BMZ-q8xBqt3g"
                  />
                  <img
                    className="w-10 h-10 rounded-full border-2 border-ac-surface object-cover"
                    alt="Smiling customer"
                    src="https://lh3.googleusercontent.com/aida-public/AB6AXuD_b5IauYO_Ct_s7hcwaplEs9NfZqKZcwIYp9ns3Ah0v61As0kysreTnVzLmqCU3CyBuKB7rgvKbNQaZGg2kq0dxFOCgdqaFXbgs9qIpjjgdMuxW6CguKMSsSblIT5tnUmyyixDHPKY2ut0DrkN8R4yh0e8HE0eBnKXd_IRXxWvDHtgkD_mhu912BYp4-FOZ39C3a0FGRotRvYaCBakuvf3tBpcPswcdkXE4ajk4R3Z0BhY2SRnPs51mQ"
                  />
                </div>
                <p className="font-label-sm text-label-sm text-ac-on-surface-variant">
                  Cleaning, Repair <br />
                  and Quarterly Care
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
              <div className="absolute inset-0 bg-gradient-to-t from-ac-on-background/80 via-transparent to-transparent pointer-events-none"></div>
              {/* Floating Badges */}
              <div className="absolute bottom-md left-md right-md flex gap-sm justify-between items-end">
                <div className="bg-ac-surface/90 backdrop-blur-sm p-sm rounded-xl shadow-md border border-ac-outline-variant/20 max-w-[200px]">
                  <div className="flex items-center gap-xs text-ac-tertiary-container mb-xs">
                    <SiteIcon className=" text-[20px]" style={{ fontVariationSettings: "'FILL' 1" }}>
                      star
                    </SiteIcon>
                    <span className="font-label-md text-label-md font-bold">Your Service Records</span>
                  </div>
                  <p className="font-label-sm text-label-sm text-ac-on-surface-variant leading-tight">
                    Bookings and completed reports in your account.
                  </p>
                </div>
                <Button variant="ghost"
                  onClick={() => onOpenBooking('Repair')}
                  className="bg-ac-primary-container text-ac-on-primary-container p-sm rounded-full shadow-md flex items-center justify-center w-14 h-14 cursor-pointer border-none hover:scale-105 transition-transform"
                  title="Book a repair assessment"
                >
                  <SiteIcon className=" text-[28px]">support_agent</SiteIcon>
                </Button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* About AC Care (Bento Grid) */}
      <section className="py-xl bg-ac-surface-container-low" id="about">
        <div className="max-w-container-max mx-auto px-gutter">
          <div className="text-center max-w-2xl mx-auto mb-lg">
            <h2 className="font-headline-md text-headline-md text-ac-on-background mb-sm font-bold">Why Choose AC Care?</h2>
            <p className="font-body-md text-body-md text-ac-on-surface-variant">
              We bring transparency, digital convenience, and technical excellence to air conditioning maintenance. Experience the modern way to care for your cooling systems.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-md">
            {/* Feature 1 */}
            <div className="bg-ac-surface p-md rounded-xl shadow-sm border border-ac-outline-variant/30 hover:shadow-md transition-shadow group flex flex-col h-full">
              <div className="w-12 h-12 rounded-full bg-ac-primary-fixed flex items-center justify-center text-ac-primary mb-md group-hover:scale-110 transition-transform">
                <SiteIcon className=" text-[24px]">touch_app</SiteIcon>
              </div>
              <h3 className="font-headline-sm text-headline-sm text-ac-on-background mb-xs font-semibold">Simple Booking</h3>
              <p className="font-body-md text-body-md text-ac-on-surface-variant flex-grow">
                Schedule your service in seconds through our intuitive platform. Select your issue, choose a time, and we handle the rest.
              </p>
            </div>
            {/* Feature 2 */}
            <div className="bg-ac-surface p-md rounded-xl shadow-sm border border-ac-outline-variant/30 hover:shadow-md transition-shadow group flex flex-col h-full">
              <div className="w-12 h-12 rounded-full bg-ac-tertiary-fixed flex items-center justify-center text-ac-tertiary-container mb-md group-hover:scale-110 transition-transform">
                <SiteIcon className=" text-[24px]">engineering</SiteIcon>
              </div>
              <h3 className="font-headline-sm text-headline-sm text-ac-on-background mb-xs font-semibold">Professional Service</h3>
              <p className="font-body-md text-body-md text-ac-on-surface-variant flex-grow">
                Your assigned technician reviews the unit, records the cleaning method and explains any additional work before proceeding.
              </p>
            </div>
            {/* Feature 3 */}
            <div className="bg-ac-surface p-md rounded-xl shadow-sm border border-ac-outline-variant/30 hover:shadow-md transition-shadow group flex flex-col h-full">
              <div className="w-12 h-12 rounded-full bg-ac-secondary-fixed flex items-center justify-center text-ac-on-secondary-fixed-variant mb-md group-hover:scale-110 transition-transform">
                <SiteIcon className=" text-[24px]">description</SiteIcon>
              </div>
              <h3 className="font-headline-sm text-headline-sm text-ac-on-background mb-xs font-semibold">Digital Service Records</h3>
              <p className="font-body-md text-body-md text-ac-on-surface-variant flex-grow">
                Access comprehensive digital reports after every visit, detailing the health of your unit and work performed.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Our Services (Glassmorphism Cards) */}
      <section className="py-xl relative" id="services">
        <div className="absolute inset-0 bg-gradient-to-b from-ac-background to-ac-surface-container-highest z-0"></div>
        <div className="max-w-container-max mx-auto px-gutter relative z-10">
          <div className="flex flex-col md:flex-row justify-between items-end mb-lg gap-sm">
            <div className="max-w-xl">
              <h2 className="font-headline-md text-headline-md text-ac-on-background mb-sm font-bold">Choose the Care You Need</h2>
              <p className="font-body-md text-body-md text-ac-on-surface-variant">
                Choose cleaning, repair or four quarterly cleaning visits. Your technician will assess your aircon and recommend the right method.
              </p>
            </div>
            <Button variant="ghost"
              onClick={() => onOpenBooking()}
              className="text-ac-primary font-label-md text-label-md hover:underline inline-flex items-center cursor-pointer border-none bg-transparent p-0"
            >
              View All Services <SiteIcon className=" ml-xs text-[18px]">arrow_forward</SiteIcon>
            </Button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-md">
            {/* Service 1 */}
            <div className="bg-ac-surface/80 backdrop-blur-md p-md rounded-2xl shadow-sm border border-ac-outline-variant/50 hover:shadow-md hover:border-ac-primary/50 transition-all flex flex-col">
              <div className="h-48 rounded-xl bg-ac-surface-dim mb-md overflow-hidden relative">
                <img
                  className="w-full h-full object-cover"
                  alt="Air Conditioning Cleaning"
                  src="https://lh3.googleusercontent.com/aida-public/AB6AXuD-Hoe8MDSP2jC3h6T0onhXBxQ7umz9UdM-rrSXufFBRxz3bS2H57hXf6xmMIyU0c1S5rrmkB09lbrvYNlhs_oxAycROqK12II2tRB54WJCNKH8Idt6aOfByv4dheAevfoBXPLdS4u8z3pMj6G7u-WUu3NijtyQxlLLFYzWPZnid_E3J42sLoN6LaVLiOe6h4nXjGb-r8lDx5dqdRUFmyYFssu3fSDEZ-ATEF07oR42QXrdgfp1nKixnQ"
                />
                <div className="absolute top-sm right-sm bg-ac-surface/90 text-ac-primary px-sm py-xs rounded-full font-label-sm text-label-sm shadow-sm backdrop-blur-sm font-semibold">
                  One-off Care
                </div>
              </div>
              <h3 className="font-headline-sm text-headline-sm text-ac-on-background mb-sm font-semibold">Cleaning</h3>
              <ul className="font-body-md text-body-md text-ac-on-surface-variant space-y-2 mb-md flex-grow">
                <li className="flex items-start gap-xs">
                  <SiteIcon className=" text-ac-primary text-[20px]">check_circle</SiteIcon> One cleaning visit
                </li>
                <li className="flex items-start gap-xs">
                  <SiteIcon className=" text-ac-primary text-[20px]">check_circle</SiteIcon> Method assessed by your technician
                </li>
                <li className="flex items-start gap-xs">
                  <SiteIcon className=" text-ac-primary text-[20px]">check_circle</SiteIcon> Additional work quoted first
                </li>
              </ul>
              <Button variant="ghost"
                onClick={() => onOpenBooking('Cleaning')}
                className="w-full inline-flex items-center justify-center bg-ac-primary-fixed text-ac-on-primary-fixed font-label-md text-label-md h-12 rounded-lg hover:bg-ac-primary hover:text-ac-on-primary transition-colors cursor-pointer border-none"
              >
                Book Cleaning
              </Button>
            </div>

            {/* Service 2 */}
            <div className="bg-ac-surface/80 backdrop-blur-md p-md rounded-2xl shadow-sm border border-ac-outline-variant/50 hover:shadow-md hover:border-ac-primary/50 transition-all flex flex-col">
              <div className="h-48 rounded-xl bg-ac-surface-dim mb-md overflow-hidden relative">
                <img
                  className="w-full h-full object-cover"
                  alt="Quarterly aircon care"
                  src="https://lh3.googleusercontent.com/aida-public/AB6AXuCB4edGVsgX9v6-hNq7ov6zk5XccEWy0IYJ67x28o98-3ShA66todNyvhsuFCYqR6dyuBrTjEG21dyI-U6x1Tdvv7GcPus9VVcy8i3LThWKNRSAJxgyqaYfQSgPWgyAbQ5DzRKQ-6MqFd-e4AbsL7ykyzSRRFvT73FHOZR5Hy0Ih4RoP2QOZwWdXWDLB97Zo-ITgMcwxK0HFT9ELdtWe6iNS8qhiHGBFaYEj94wT8KhgkKqex2fh0O3MQ"
                />
              </div>
              <h3 className="font-headline-sm text-headline-sm text-ac-on-background mb-sm font-semibold">Annual Cleaning Bundle</h3>
              <ul className="font-body-md text-body-md text-ac-on-surface-variant space-y-2 mb-md flex-grow">
                <li className="flex items-start gap-xs">
                  <SiteIcon className=" text-ac-primary text-[20px]">check_circle</SiteIcon> Four cleaning visits per year
                </li>
                <li className="flex items-start gap-xs">
                  <SiteIcon className=" text-ac-primary text-[20px]">check_circle</SiteIcon> One visit every three months
                </li>
                <li className="flex items-start gap-xs">
                  <SiteIcon className=" text-ac-primary text-[20px]">check_circle</SiteIcon> One address, the same selected units
                </li>
              </ul>
              <Button variant="ghost"
                onClick={() => onOpenBooking('Annual Cleaning Bundle')}
                className="w-full inline-flex items-center justify-center bg-ac-primary-fixed text-ac-on-primary-fixed font-label-md text-label-md h-12 rounded-lg hover:bg-ac-primary hover:text-ac-on-primary transition-colors cursor-pointer border-none"
              >
                Book Annual Bundle
              </Button>
            </div>

            {/* Service 3 */}
            <div className="bg-ac-surface/80 backdrop-blur-md p-md rounded-2xl shadow-sm border border-ac-outline-variant/50 hover:shadow-md hover:border-ac-primary/50 transition-all flex flex-col">
              <div className="h-48 rounded-xl bg-ac-surface-dim mb-md overflow-hidden relative">
                <img
                  className="w-full h-full object-cover"
                  alt="Air Conditioning Repair"
                  src="https://lh3.googleusercontent.com/aida-public/AB6AXuCUq_H7G5DhHcNiKvMYBxa55-VzXvKtQu5Fgw4MuWrsdGkMLUJu8ROEP8ctICQ3Ub-SbA8G18yrhLfkToYkKkBWVKJLxP9JDMct1TG3YxKyd-dElL4Hjbf2YRM6AeE_v4rSZUILdj07SasCN_hBltI0z4raUtdOb4afyMnhTvztInOVZvjW2ecfszpPHO8nzUx_veGrCoG60LM1BqtjJGIT6K_p1ZPiWF2B-7FDvtVm-0Bf8YNhZAFSEQ"
                />
              </div>
              <h3 className="font-headline-sm text-headline-sm text-ac-on-background mb-sm font-semibold">Repair</h3>
              <ul className="font-body-md text-body-md text-ac-on-surface-variant space-y-2 mb-md flex-grow">
                <li className="flex items-start gap-xs">
                  <SiteIcon className=" text-ac-primary text-[20px]">check_circle</SiteIcon> On-site fault diagnosis
                </li>
                <li className="flex items-start gap-xs">
                  <SiteIcon className=" text-ac-primary text-[20px]">check_circle</SiteIcon> Tell us what is happening
                </li>
                <li className="flex items-start gap-xs">
                  <SiteIcon className=" text-ac-primary text-[20px]">check_circle</SiteIcon> Repair and parts quoted after inspection
                </li>
              </ul>
              <Button variant="ghost"
                onClick={() => onOpenBooking('Repair')}
                className="w-full inline-flex items-center justify-center bg-ac-primary-fixed text-ac-on-primary-fixed font-label-md text-label-md h-12 rounded-lg hover:bg-ac-primary hover:text-ac-on-primary transition-colors cursor-pointer border-none"
              >
                Book Repair
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Identifying the Issue */}
      <section className="py-16 sm:py-20 lg:py-24 bg-ac-background border-t border-ac-outline-variant/20" id="diagnostic">
        <div className="max-w-[1320px] mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-2xl mx-auto mb-10 sm:mb-12">
            <h2 className="text-2xl sm:text-3xl md:text-4xl font-extrabold text-ac-on-background tracking-tight">
              Identifying the Issue
            </h2>
            <p className="mt-3 text-sm sm:text-base text-ac-on-surface-variant leading-relaxed">
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
                      ? 'bg-ac-primary-fixed/20 border-2 border-ac-primary shadow-md -translate-y-1'
                      : 'bg-ac-surface border border-ac-outline-variant/50 shadow-xs hover:shadow-md hover:border-ac-primary/50 hover:-translate-y-1'
                  }`}
                >
                  <div className="flex flex-col items-center">
                    <div
                      className={`w-14 h-14 sm:w-16 sm:h-16 rounded-full flex items-center justify-center mb-3.5 shrink-0 transition-transform duration-200 group-hover:scale-105 ${problem.colorClass}`}
                    >
                      <SiteIcon className=" text-[26px] sm:text-[28px]">{problem.icon}</SiteIcon>
                    </div>
                    <h3 className="font-bold text-sm sm:text-base text-ac-on-background mb-1.5 leading-snug">
                      {problem.name}
                    </h3>
                    <p className="text-xs text-ac-on-surface-variant leading-relaxed text-center">
                      {problem.description}
                    </p>
                  </div>

                  {isSelected && (
                    <div className="mt-3 inline-flex items-center gap-1 text-[11px] font-bold text-ac-primary bg-ac-primary/10 px-2.5 py-0.5 rounded-full">
                      <SiteIcon className=" text-[14px]">check</SiteIcon>
                      <span>Selected</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="mt-10 sm:mt-12 text-center">
            <Button variant="ghost"
              type="button"
              onClick={() => onOpenBooking(selectedIssue === 'needs-cleaning' ? 'Cleaning' : 'Repair')}
              className="inline-flex items-center justify-center gap-2 bg-ac-primary hover:bg-ac-primary/90 active:scale-[0.98] text-ac-on-primary font-semibold text-sm sm:text-base h-12 px-8 rounded-xl shadow-sm hover:shadow-md transition-all cursor-pointer border-none whitespace-nowrap"
            >
              <SiteIcon className=" text-[20px]">search</SiteIcon>
              <span>Book an Assessment</span>
            </Button>
          </div>
        </div>
      </section>

      {/* How AC Care Works */}
      <section className="py-16 sm:py-20 lg:py-24 bg-ac-surface-container-low overflow-hidden" id="how-it-works">
        <div className="max-w-[1320px] mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-2xl mx-auto mb-12 sm:mb-16">
            <h2 className="text-2xl sm:text-3xl md:text-4xl font-extrabold text-ac-on-background tracking-tight">
              How AC Care Works
            </h2>
            <p className="mt-3 text-sm sm:text-base text-ac-on-surface-variant leading-relaxed">
              A streamlined, transparent process designed to get your AC running perfectly with zero hassle.
            </p>
          </div>

          <div className="relative">
            {/* Horizontal Timeline Connector (Desktop) */}
            <div className="hidden lg:block absolute top-10 left-[10%] right-[10%] h-[2px] bg-ac-outline-variant/60 -z-0"></div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-8 lg:gap-6 relative z-10">
              {/* Step 1 */}
              <div className="flex flex-col items-center text-center group">
                <div className="w-20 h-20 rounded-full bg-ac-surface border-2 border-ac-primary/30 flex items-center justify-center text-ac-primary shadow-xs group-hover:border-ac-primary group-hover:shadow-md transition-all z-10 shrink-0 mb-3">
                  <SiteIcon className=" text-[32px]">touch_app</SiteIcon>
                </div>
                <span className="inline-block text-[11px] font-bold text-ac-primary bg-ac-primary/10 px-2.5 py-0.5 rounded-full mb-2">
                  01
                </span>
                <h4 className="text-base font-bold text-ac-on-background mb-1.5 leading-snug">
                  Choose Service
                </h4>
                <p className="text-xs sm:text-sm text-ac-on-surface-variant leading-relaxed max-w-[200px] mx-auto">
                  Select the type of maintenance or repair you need.
                </p>
              </div>

              {/* Step 2 */}
              <div className="flex flex-col items-center text-center group">
                <div className="w-20 h-20 rounded-full bg-ac-surface border-2 border-ac-primary/30 flex items-center justify-center text-ac-primary shadow-xs group-hover:border-ac-primary group-hover:shadow-md transition-all z-10 shrink-0 mb-3">
                  <SiteIcon className=" text-[32px]">calendar_month</SiteIcon>
                </div>
                <span className="inline-block text-[11px] font-bold text-ac-primary bg-ac-primary/10 px-2.5 py-0.5 rounded-full mb-2">
                  02
                </span>
                <h4 className="text-base font-bold text-ac-on-background mb-1.5 leading-snug">
                  Select Date/Time
                </h4>
                <p className="text-xs sm:text-sm text-ac-on-surface-variant leading-relaxed max-w-[200px] mx-auto">
                  Pick a convenient slot that fits your schedule.
                </p>
              </div>

              {/* Step 3 */}
              <div className="flex flex-col items-center text-center group">
                <div className="w-20 h-20 rounded-full bg-ac-surface border-2 border-ac-primary/30 flex items-center justify-center text-ac-primary shadow-xs group-hover:border-ac-primary group-hover:shadow-md transition-all z-10 shrink-0 mb-3">
                  <SiteIcon className=" text-[32px]">person_check</SiteIcon>
                </div>
                <span className="inline-block text-[11px] font-bold text-ac-primary bg-ac-primary/10 px-2.5 py-0.5 rounded-full mb-2">
                  03
                </span>
                <h4 className="text-base font-bold text-ac-on-background mb-1.5 leading-snug">
                  Technician Assignment
                </h4>
                <p className="text-xs sm:text-sm text-ac-on-surface-variant leading-relaxed max-w-[200px] mx-auto">
                  The service team confirms availability and assigns a technician.
                </p>
              </div>

              {/* Step 4 */}
              <div className="flex flex-col items-center text-center group">
                <div className="w-20 h-20 rounded-full bg-ac-surface border-2 border-ac-primary/30 flex items-center justify-center text-ac-primary shadow-xs group-hover:border-ac-primary group-hover:shadow-md transition-all z-10 shrink-0 mb-3">
                  <SiteIcon className=" text-[32px]">build</SiteIcon>
                </div>
                <span className="inline-block text-[11px] font-bold text-ac-primary bg-ac-primary/10 px-2.5 py-0.5 rounded-full mb-2">
                  04
                </span>
                <h4 className="text-base font-bold text-ac-on-background mb-1.5 leading-snug">
                  Service in Progress
                </h4>
                <p className="text-xs sm:text-sm text-ac-on-surface-variant leading-relaxed max-w-[200px] mx-auto">
                  Professional servicing at your location.
                </p>
              </div>

              {/* Step 5 */}
              <div className="flex flex-col items-center text-center group">
                <div className="w-20 h-20 rounded-full bg-ac-surface border-2 border-emerald-400 flex items-center justify-center text-emerald-600 shadow-xs group-hover:border-emerald-500 group-hover:shadow-md transition-all z-10 shrink-0 mb-3">
                  <SiteIcon className=" text-[32px]">task_alt</SiteIcon>
                </div>
                <span className="inline-block text-[11px] font-bold text-emerald-700 bg-emerald-100 px-2.5 py-0.5 rounded-full mb-2">
                  05
                </span>
                <h4 className="text-base font-bold text-ac-on-background mb-1.5 leading-snug">
                  Service Completed
                </h4>
                <p className="text-xs sm:text-sm text-ac-on-surface-variant leading-relaxed max-w-[200px] mx-auto">
                  Receive a digital report and enjoy cool air.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Current Promotions */}
      <section className="py-xl bg-ac-background" id="promotions">
        <div className="max-w-container-max mx-auto px-gutter">
          <div className="flex flex-col md:flex-row justify-between items-end mb-lg gap-sm">
            <div className="max-w-xl">
              <h2 className="font-headline-md text-headline-md text-ac-on-background mb-sm font-bold">Simple Service Pricing</h2>
              <p className="font-body-md text-body-md text-ac-on-surface-variant">
                Prices in SGD for residential wall-mounted aircon units. Review your unit count and estimate before booking.
              </p>
            </div>
          </div>
          {/* Horizontal Scroll Snap for Promos */}
          <div className="flex overflow-x-auto pb-md snap-x snap-mandatory gap-md hide-scrollbar">
            {/* Promo 1 */}
            <div className="min-w-[300px] md:min-w-[350px] snap-start bg-ac-primary-container text-ac-on-primary-container p-md rounded-2xl shadow-sm flex flex-col relative overflow-hidden">
              <div className="absolute -right-8 -top-8 w-32 h-32 bg-ac-primary/20 rounded-full blur-2xl pointer-events-none"></div>
              <div className="inline-flex bg-ac-on-primary text-ac-primary px-sm py-xs rounded-full font-label-sm text-label-sm w-fit mb-md shadow-sm font-semibold">
                One Visit
              </div>
              <h3 className="font-headline-sm text-headline-sm font-bold mb-xs relative z-10">Cleaning · {priceFor('Cleaning')}</h3>
              <p className="font-body-md text-body-md opacity-90 mb-lg relative z-10 flex-grow">
                First-unit cleaning price. Add your other units when booking. Your technician assesses the cleaning method on site; additional work is quoted first.
              </p>
              <Button variant="ghost"
                onClick={() => onOpenBooking('Cleaning')}
                className="inline-flex items-center justify-center bg-ac-on-primary text-ac-primary font-label-md text-label-md h-10 px-md rounded-lg w-fit hover:bg-ac-surface transition-colors relative z-10 cursor-pointer border-none font-semibold"
              >
                Book Cleaning
              </Button>
            </div>
            {/* Promo 2 */}
            <div className="min-w-[300px] md:min-w-[350px] snap-start bg-ac-surface-container-high border border-ac-outline-variant/50 p-md rounded-2xl shadow-sm flex flex-col">
              <div className="inline-flex bg-ac-tertiary-fixed text-ac-on-tertiary-fixed-variant px-sm py-xs rounded-full font-label-sm text-label-sm w-fit mb-md shadow-sm font-semibold">
                Diagnosis First
              </div>
              <h3 className="font-headline-sm text-headline-sm font-bold text-ac-on-background mb-xs">Repair · {priceFor('Repair')}</h3>
              <p className="font-body-md text-body-md text-ac-on-surface-variant mb-lg flex-grow">
                The visit fee covers diagnosis. Repair labour, replacement parts and other work are quoted after inspection for your approval.
              </p>
              <Button variant="ghost"
                onClick={() => onOpenBooking('Repair')}
                className="inline-flex items-center justify-center bg-ac-primary text-ac-on-primary font-label-md text-label-md h-10 px-md rounded-lg w-fit hover:bg-ac-primary-fixed hover:text-ac-on-primary-fixed transition-colors cursor-pointer border-none"
              >
                Book Repair
              </Button>
            </div>
            {/* Promo 3 */}
            <div className="min-w-[300px] md:min-w-[350px] snap-start bg-ac-surface-container-high border border-ac-outline-variant/50 p-md rounded-2xl shadow-sm flex flex-col">
              <div className="inline-flex bg-ac-surface-variant text-ac-on-surface-variant px-sm py-xs rounded-full font-label-sm text-label-sm w-fit mb-md shadow-sm font-semibold">
                Four Quarterly Visits
              </div>
              <h3 className="font-headline-sm text-headline-sm font-bold text-ac-on-background mb-xs">Annual Cleaning Bundle · {priceFor('Annual Cleaning Bundle')}</h3>
              <p className="font-body-md text-body-md text-ac-on-surface-variant mb-lg flex-grow">
                Annual price for one unit. Four cleaning visits, three months apart, at the same address. Review all four dates and pay per visit after service.
              </p>
              <Button variant="ghost"
                onClick={() => onOpenBooking('Annual Cleaning Bundle')}
                className="inline-flex items-center justify-center bg-ac-primary text-ac-on-primary font-label-md text-label-md h-10 px-md rounded-lg w-fit hover:bg-ac-primary-fixed hover:text-ac-on-primary-fixed transition-colors cursor-pointer border-none"
              >
                Book Annual Bundle
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Service expectations */}
      <section className="py-xl bg-ac-surface-container-highest">
        <div className="max-w-container-max mx-auto px-gutter">
          <div className="text-center mb-lg">
            <h2 className="font-headline-md text-headline-md text-ac-on-background mb-sm font-bold">Care You Can Follow</h2>
            <p className="font-body-md text-body-md text-ac-on-surface-variant max-w-2xl mx-auto">Know what you are requesting and keep your service records together.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-md">
            {[
              { icon: 'receipt_long', title: 'Review the price', text: 'See the service estimate before you submit. Repair work, chemical treatment and parts are quoted separately when required.' },
              { icon: 'build', title: 'Let the technician assess', text: 'Choose cleaning or repair and describe the issue. The assigned technician records the appropriate cleaning method after checking your unit.' },
              { icon: 'calendar_month', title: 'Keep track of every visit', text: 'The annual bundle creates four linked quarterly bookings. Sign in to view upcoming dates and completed service reports.' },
            ].map(item => <div key={item.title} className="bg-ac-surface p-md rounded-2xl shadow-sm border border-ac-outline-variant/20">
              <SiteIcon className="text-ac-primary text-[28px] mb-sm">{item.icon}</SiteIcon>
              <h3 className="font-label-md text-label-md text-ac-on-background font-semibold mb-sm">{item.title}</h3>
              <p className="font-body-md text-body-md text-ac-on-surface-variant">{item.text}</p>
            </div>)}
          </div>
        </div>
      </section>

      {/* FAQ Section */}
      <section className="py-xl bg-ac-background" id="faq">
        <div className="max-w-container-max mx-auto px-gutter flex flex-col lg:flex-row gap-lg">
          <div className="lg:w-1/3">
            <h2 className="font-headline-md text-headline-md text-ac-on-background mb-sm font-bold">Frequently Asked Questions</h2>
            <p className="font-body-md text-body-md text-ac-on-surface-variant mb-md">
              Got a question? We're here to help. If you don't see your answer here, feel free to contact our support team.
            </p>
            <a
              className="inline-flex items-center gap-xs text-ac-primary font-label-md text-label-md hover:underline font-semibold"
              href="#contact"
            >
              Contact Support <SiteIcon className=" text-[18px]">arrow_forward</SiteIcon>
            </a>
          </div>
          <div className="lg:w-2/3 flex flex-col gap-sm">
            {/* FAQ 1 */}
            <div className="bg-ac-surface border border-ac-outline-variant/30 rounded-xl overflow-hidden shadow-sm transition-colors">
              <Button variant="ghost"
                className="w-full text-left px-md py-sm flex justify-between items-center bg-ac-surface hover:bg-ac-surface-container-low transition-colors cursor-pointer border-none"
                onClick={() => toggleFaq(1)}
              >
                <span className="font-label-md text-label-md text-ac-on-background font-semibold">
                  How often should I service my air conditioner?
                </span>
                <SiteIcon
                  className={` text-ac-outline transition-transform duration-300 ${
                    openFaq === 1 ? 'rotate-180 text-ac-primary' : ''
                  }`}
                >
                  expand_more
                </SiteIcon>
              </Button>
              {openFaq === 1 && (
                <div className="bg-ac-surface-container-lowest border-t border-ac-outline-variant/10 px-md pb-sm pt-xs font-body-md text-body-md text-ac-on-surface-variant animate-in fade-in duration-200">
                  Our Annual Cleaning Bundle includes four visits, three months apart from your first preferred date. Your technician assesses the unit at each visit and decides whether regular or chemical cleaning is appropriate. Additional work and any extra charge must be agreed with you first.
                </div>
              )}
            </div>

            {/* FAQ 2 */}
            <div className="bg-ac-surface border border-ac-outline-variant/30 rounded-xl overflow-hidden shadow-sm transition-colors">
              <Button variant="ghost"
                className="w-full text-left px-md py-sm flex justify-between items-center bg-ac-surface hover:bg-ac-surface-container-low transition-colors cursor-pointer border-none"
                onClick={() => toggleFaq(2)}
              >
                <span className="font-label-md text-label-md text-ac-on-background font-semibold">
                  Do I need to choose a cleaning method?
                </span>
                <SiteIcon
                  className={` text-ac-outline transition-transform duration-300 ${
                    openFaq === 2 ? 'rotate-180 text-ac-primary' : ''
                  }`}
                >
                  expand_more
                </SiteIcon>
              </Button>
              {openFaq === 2 && (
                <div className="bg-ac-surface-container-lowest border-t border-ac-outline-variant/10 px-md pb-sm pt-xs font-body-md text-body-md text-ac-on-surface-variant animate-in fade-in duration-200">
                  No. Select Cleaning for a single visit or Annual Cleaning Bundle for quarterly care. Your technician checks the condition and records the recommended method. The displayed price covers routine cleaning; chemical treatment, repairs and parts require a separate quote if needed.
                </div>
              )}
            </div>

            {/* FAQ 3 */}
            <div className="bg-ac-surface border border-ac-outline-variant/30 rounded-xl overflow-hidden shadow-sm transition-colors">
              <Button variant="ghost"
                className="w-full text-left px-md py-sm flex justify-between items-center bg-ac-surface hover:bg-ac-surface-container-low transition-colors cursor-pointer border-none"
                onClick={() => toggleFaq(3)}
              >
                <span className="font-label-md text-label-md text-ac-on-background font-semibold">
                  Do I need to create an account to book?
                </span>
                <SiteIcon
                  className={` text-ac-outline transition-transform duration-300 ${
                    openFaq === 3 ? 'rotate-180 text-ac-primary' : ''
                  }`}
                >
                  expand_more
                </SiteIcon>
              </Button>
              {openFaq === 3 && (
                <div className="bg-ac-surface-container-lowest border-t border-ac-outline-variant/10 px-md pb-sm pt-xs font-body-md text-body-md text-ac-on-surface-variant animate-in fade-in duration-200">
                  Yes, creating a free account allows us to save your property details, track your service history, provide digital reports, and manage your upcoming bookings efficiently.
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="py-xl relative overflow-hidden bg-ac-primary text-ac-on-primary">
        <div className="absolute inset-0 z-0 opacity-10 pointer-events-none bg-[radial-gradient(ellipse_at_bottom_left,_var(--tw-gradient-stops))] from-white via-transparent to-transparent"></div>
        <div className="max-w-3xl mx-auto px-gutter relative z-10 text-center">
          <h2 className="font-display-lg-mobile md:font-headline-md text-display-lg-mobile md:text-headline-md mb-md font-bold text-white">
            Ready to Take Care of Your Air Conditioner?
          </h2>
          <p className="font-body-lg text-body-lg opacity-90 mb-lg text-white/90">
            Choose a single visit or plan your quarterly cleaning for the year ahead.
          </p>
          <div className="flex flex-col sm:flex-row gap-md justify-center items-center">
            <Button variant="ghost"
              onClick={() => onOpenBooking()}
              className="inline-flex items-center justify-center bg-ac-on-primary text-ac-primary font-label-md text-label-md h-12 px-lg rounded-full shadow-md hover:bg-ac-surface transition-all active:scale-95 w-full sm:w-auto cursor-pointer border-none font-semibold"
            >
              Book a Service
            </Button>
            <Button variant="ghost"
              onClick={() => onNavigate('register')}
              className="inline-flex items-center justify-center bg-transparent border-2 border-ac-on-primary text-ac-on-primary font-label-md text-label-md h-12 px-lg rounded-full hover:bg-ac-on-primary/10 transition-all active:scale-95 w-full sm:w-auto cursor-pointer font-semibold"
            >
              Create Account
            </Button>
          </div>
        </div>
      </section>
    </main>
  );
};
