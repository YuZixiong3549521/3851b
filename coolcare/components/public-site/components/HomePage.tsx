import React, { useEffect, useState } from 'react';
import { SiteIcon } from '@/components/ui/site-icon';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/native-select';
import { annualVisitAmounts } from '@/lib/annual-booking';
import { formatMoney } from '@/lib/format';
import { customerSupportEmail } from '@/lib/customer-support';
import { bookingForHomepageIssue, homepageIssues, homepageOfferTotal, readHomepageOffers, type HomepageOffer } from '@/lib/homepage-offers';
import { apiFetch } from '../api';
import type { OpenBooking, PageRoute, User } from '../types';

interface HomePageProps {
  onNavigate: (page: PageRoute, hash?: string) => void;
  onOpenBooking: OpenBooking;
  currentUser: User | null;
}

const serviceCards = [
  {
    name: 'Cleaning', label: 'One-off care', action: 'Book Cleaning', imageAlt: 'Air conditioning cleaning',
    image: 'https://lh3.googleusercontent.com/aida-public/AB6AXuD-Hoe8MDSP2jC3h6T0onhXBxQ7umz9UdM-rrSXufFBRxz3bS2H57hXf6xmMIyU0c1S5rrmkB09lbrvYNlhs_oxAycROqK12II2tRB54WJCNKH8Idt6aOfByv4dheAevfoBXPLdS4u8z3pMj6G7u-WUu3NijtyQxlLLFYzWPZnid_E3J42sLoN6LaVLiOe6h4nXjGb-r8lDx5dqdRUFmyYFssu3fSDEZ-ATEF07oR42QXrdgfp1nKixnQ',
    features: ['One cleaning visit', 'Cleaning method assessed by your technician', 'Additional work quoted for your approval'],
  },
  {
    name: 'Annual Cleaning Bundle', label: 'Quarterly care', action: 'Book Annual Bundle', imageAlt: 'Quarterly aircon care',
    image: 'https://lh3.googleusercontent.com/aida-public/AB6AXuCB4edGVsgX9v6-hNq7ov6zk5XccEWy0IYJ67x28o98-3ShA66todNyvhsuFCYqR6dyuBrTjEG21dyI-U6x1Tdvv7GcPus9VVcy8i3LThWKNRSAJxgyqaYfQSgPWgyAbQ5DzRKQ-6MqFd-e4AbsL7ykyzSRRFvT73FHOZR5Hy0Ih4RoP2QOZwWdXWDLB97Zo-ITgMcwxK0HFT9ELdtWe6iNS8qhiHGBFaYEj94wT8KhgkKqex2fh0O3MQ',
    features: ['Four cleaning visits, three months apart', 'One address and AC count for all visits', 'Pay after each service'],
  },
  {
    name: 'Repair', label: 'Diagnosis first', action: 'Book Repair', imageAlt: 'Air conditioning repair',
    image: 'https://lh3.googleusercontent.com/aida-public/AB6AXuCUq_H7G5DhHcNiKvMYBxa55-VzXvKtQu5Fgw4MuWrsdGkMLUJu8ROEP8ctICQ3Ub-SbA8G18yrhLfkToYkKkBWVKJLxP9JDMct1TG3YxKyd-dElL4Hjbf2YRM6AeE_v4rSZUILdj07SasCN_hBltI0z4raUtdOb4afyMnhTvztInOVZvjW2ecfszpPHO8nzUx_veGrCoG60LM1BqtjJGIT6K_p1ZPiWF2B-7FDvtVm-0Bf8YNhZAFSEQ',
    features: ['On-site fault diagnosis', 'Tell us what is happening', 'Repair labour and parts quoted after inspection'],
  },
];

const faqs = [
  { question: 'When can I book a service?', answer: 'Choose a weekday at least 14 calendar days ahead, based on Singapore time. We operate Monday to Friday and do not offer weekend appointments. Your chosen date and time are a request; the service team must confirm availability before the visit is arranged.' },
  { question: 'Can I make more than one booking for the same address?', answer: 'Each customer can have at most two appointments for the same address within any rolling seven-day period of service dates. Cancelled bookings do not count. Check My Bookings before making another request to avoid booking the same visit twice.' },
  { question: 'How does the Annual Cleaning Bundle work?', answer: 'One request creates four linked cleaning visits at the same address, starting on your preferred date and then every three months. Later visits that fall on a weekend move to the following Monday. Review all four dates before submitting. The annual price is shared across the four visits and paid after each service; every appointment still needs confirmation.' },
  { question: 'Do I need to choose regular or chemical cleaning?', answer: 'No. Choose Cleaning for one visit or Annual Cleaning Bundle for quarterly care. Your technician assesses the aircon and records the appropriate method. The displayed estimate covers routine cleaning; chemical treatment, repair labour and replacement parts are quoted separately for your approval when needed.' },
  { question: 'Can I cancel or reschedule a booking?', answer: 'Open My Bookings to change a request that is still awaiting confirmation and has not been assigned. New dates must meet the 14-day notice, weekday and address limits. Annual visits also stay within their quarterly service window. Once a technician has been assigned, contact support for help. Completed and cancelled requests remain in Booking History.' },
  { question: 'Do I need an account or registered aircon units?', answer: 'You must register and sign in before booking. There is no separate membership to buy. Enter your service address and number of aircon units; you do not need to register or select individual units. You can save a new address during booking and manage your requests and service reports in your customer account.' },
];

const processSteps = [
  { icon: 'touch_app', title: 'Choose your care', text: 'Sign in, choose your service, and enter an address and AC count.' },
  { icon: 'calendar_month', title: 'Request a weekday', text: 'Pick a preferred slot at least 14 days ahead. The team confirms availability and assigns a technician.' },
  { icon: 'engineering', title: 'Get an on-site assessment', text: 'Your technician checks the unit and explains any extra work and price before proceeding.' },
  { icon: 'description', title: 'Keep your service records', text: 'Follow your requests in My Bookings and view completed maintenance reports in your account.' },
];
const primaryButton = 'h-12 rounded-full bg-ac-primary px-md text-ac-on-primary hover:bg-ac-on-primary-fixed hover:text-ac-on-primary shadow-sm';
const supportHref = 'mailto:' + customerSupportEmail + '?subject=CoolCare%20service%20enquiry';

export const HomePage: React.FC<HomePageProps> = ({ onNavigate, onOpenBooking, currentUser }) => {
  const [selectedIssue, setSelectedIssue] = useState<string | null>(null);
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [numberOfUnits, setNumberOfUnits] = useState(2);
  const [prices, setPrices] = useState<HomepageOffer[]>([]);
  const [priceState, setPriceState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [priceRefresh, setPriceRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    setPriceState('loading');
    apiFetch('/api/public/offers').then(response => {
      if (!response.ok) throw new Error('Prices unavailable');
      return response.json();
    }).then(data => {
      if (!active) return;
      const offers = readHomepageOffers(data);
      setPrices(offers);
      setPriceState(serviceCards.every(card => offers.some(offer => offer.name === card.name)) ? 'ready' : 'error');
    }).catch(() => {
      if (active) { setPrices([]); setPriceState('error'); }
    });
    return () => { active = false; };
  }, [priceRefresh]);
  const selectedAssessment = bookingForHomepageIssue(selectedIssue);
  const customer = currentUser && (!currentUser.role || currentUser.role === 'Customer');
  const dashboardHref = currentUser?.role === 'Admin' ? '/admin/inventory' : currentUser?.role === 'Technician' ? '/technician/index.html' : '/customer';

  return (
    <main>
      <section className="relative scroll-mt-24 pt-xl pb-xl md:pt-[88px] md:pb-[88px] overflow-hidden" id="home">
        <div className="absolute inset-0 opacity-20 pointer-events-none bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-ac-primary-fixed via-ac-background to-ac-background" />
        <div className="max-w-container-max mx-auto px-gutter relative">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-lg items-center">
            <div className="flex flex-col gap-md max-w-2xl">
              <div className="inline-flex items-center gap-xs bg-ac-surface-container text-ac-primary text-label-sm px-sm py-xs rounded-full w-fit">
                <SiteIcon className="text-[16px]">ac_unit</SiteIcon><span>Aircon care in Singapore</span>
              </div>
              <h1 className="text-display-lg-mobile md:text-display-lg text-ac-on-background font-bold tracking-tight">Keep Your Air Conditioner Running at Its Best</h1>
              <p className="text-body-lg text-ac-on-surface-variant max-w-xl">Cleaning, repair or a year of quarterly care. Choose what you need and leave the technical assessment to your CoolCare technician.</p>
              <div className="flex flex-col sm:flex-row gap-sm">
                {currentUser ? <>
                  <a href={dashboardHref} className="inline-flex items-center justify-center gap-2 h-12 rounded-full bg-ac-primary px-md text-ac-on-primary hover:bg-ac-on-primary-fixed shadow-sm font-semibold">Go to Dashboard <SiteIcon className="text-[20px]">arrow_forward</SiteIcon></a>
                  {customer ? <Button variant="outline" onClick={() => onNavigate('bookings')} className="h-12 rounded-full border-ac-primary text-ac-primary px-md">My Bookings</Button> :
                    <a href="#services" className="inline-flex items-center justify-center h-12 rounded-full border border-ac-primary text-ac-primary px-md">Explore Services</a>}
                </> : <>
                  <Button onClick={() => onOpenBooking(undefined, { numberOfUnits })} className={primaryButton}>Book a Service <SiteIcon className="text-[20px]">arrow_forward</SiteIcon></Button>
                  <a href="#services" className="inline-flex items-center justify-center h-12 rounded-full border border-ac-primary text-ac-primary px-md hover:bg-ac-primary-fixed/20 font-semibold">Explore Services &amp; Prices</a>
                </>}
              </div>
              <p className="text-sm text-ac-on-surface-variant leading-relaxed">Weekday appointments · At least 14 days ahead<br />Your requested slot is subject to confirmation.</p>
              <div className="flex flex-wrap gap-sm pt-6 border-t border-ac-outline-variant/30">
                {[{ icon: 'cleaning_services', text: 'Cleaning' }, { icon: 'build', text: 'Repair' }, { icon: 'calendar_month', text: 'Quarterly care' }].map(item =>
                  <span key={item.text} className="inline-flex items-center gap-2 text-sm text-ac-on-surface-variant"><span className="flex items-center justify-center w-9 h-9 rounded-full bg-ac-primary-fixed/50 text-ac-primary"><SiteIcon className="text-[18px]">{item.icon}</SiteIcon></span>{item.text}</span>)}
              </div>
            </div>
            <div className="relative h-[360px] md:h-[560px] w-full rounded-2xl overflow-hidden shadow-lg group">
              <img className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 motion-safe:group-hover:scale-105" alt="Technician servicing an air conditioning unit" width={720} height={720} fetchPriority="high"
                src="https://lh3.googleusercontent.com/aida-public/AB6AXuB9DImHj-m1yBtmceh8RMt2MVLMjVXD0Sxago7Yru19djqFNxG-3-2ipogBMmo5hUSl2t0cNKVneXhs4YpjKpZWby0jJJbaXwUQS4260BNTgyusHStEzYhcejXWxmGWCITxtOvCDAWNZmwr5m44HpfXycHp0l-4oIHj9g6tQlFSfLi3jFBRcZIdzdSnLMi0cbEedxl1n-14XD4bRbVcaYyITzPDXKMcSChTM_jS0b5BfRcxy_m0E6xcdA" />
              <div className="absolute inset-0 bg-gradient-to-t from-ac-on-background/80 via-transparent to-transparent pointer-events-none" />
              <div className="absolute bottom-6 left-6 right-6 flex gap-sm justify-between items-end">
                <div className="bg-ac-surface/95 backdrop-blur-sm p-sm rounded-xl shadow-md max-w-[220px]">
                  <div className="flex items-center gap-xs text-ac-primary mb-xs font-semibold"><SiteIcon className="text-[20px]">description</SiteIcon>Your Service Records</div>
                  <p className="text-sm text-ac-on-surface-variant">Bookings and completed reports in your account.</p>
                </div>
                <a href={supportHref} aria-label="Email CoolCare support" title="Email CoolCare support" className="bg-ac-primary-container text-ac-on-primary-container rounded-full shadow-md flex items-center justify-center w-14 h-14 shrink-0 hover:bg-ac-primary hover:text-ac-on-primary"><SiteIcon className="text-[28px]">support_agent</SiteIcon></a>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="scroll-mt-24 py-xl relative bg-ac-surface-container-low" id="services">
        <div className="max-w-container-max mx-auto px-gutter">
          <div className="flex flex-col md:flex-row justify-between md:items-end gap-md mb-lg">
            <div className="max-w-xl">
              <p className="text-sm font-semibold text-ac-primary mb-xs">SERVICES &amp; PRICING</p>
              <h2 className="text-headline-md text-ac-on-background mb-sm font-bold">Choose the Care You Need</h2>
              <p className="text-body-md text-ac-on-surface-variant">Three simple choices. See your estimate for residential wall-mounted aircon units, with all prices in SGD.</p>
            </div>
            <div className="w-full md:w-52 shrink-0">
              <label htmlFor="homepage-unit-count" className="block font-semibold text-sm text-ac-on-background mb-2">Number of aircon units</label>
              <NativeSelect id="homepage-unit-count" value={numberOfUnits} onChange={event => setNumberOfUnits(Number(event.target.value))} className="h-12 bg-ac-surface border-ac-outline-variant">
                {Array.from({ length: 10 }, (_, index) => index + 1).map(count => <option key={count} value={count}>{count} {count === 1 ? 'aircon unit' : 'aircon units'}</option>)}
              </NativeSelect>
            </div>
          </div>
          {priceState === 'error' && <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-ac-outline-variant bg-ac-surface px-md py-sm mb-md text-sm text-ac-on-surface-variant">
            <span>Some prices could not be loaded. Check the current estimate in booking before submitting.</span>
            <Button variant="outline" size="sm" onClick={() => setPriceRefresh(value => value + 1)}>Reload prices</Button>
          </div>}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-md">
            {serviceCards.map(card => {
              const offer = prices.find(item => item.name === card.name);
              const total = homepageOfferTotal(offer, numberOfUnits);
              const annual = card.name === 'Annual Cleaning Bundle';
              const visitAmounts = annual && total !== null ? annualVisitAmounts(total) : [];
              const equalVisits = visitAmounts.length > 0 && visitAmounts.every(amount => amount === visitAmounts[0]);
              return <article key={card.name} className="bg-ac-surface p-md rounded-2xl shadow-sm border border-ac-outline-variant/40 hover:shadow-md transition-shadow flex flex-col min-w-0">
                <div className="h-40 lg:h-44 rounded-xl bg-ac-surface-dim mb-md overflow-hidden relative">
                  <img className="w-full h-full object-cover" alt={card.imageAlt} src={card.image} width={480} height={240} loading="lazy" decoding="async" />
                  <span className="absolute top-4 right-4 bg-ac-surface/95 text-ac-primary px-sm py-xs rounded-full text-xs font-semibold">{card.label}</span>
                </div>
                <h3 className="text-headline-sm text-ac-on-background mb-sm font-semibold">{card.name}</h3>
                <div className="mb-md min-h-[100px]" aria-live="polite" aria-atomic="true">
                  {total === null ? <p className="text-ac-on-surface-variant py-2">{priceState === 'loading' ? 'Loading current price…' : 'Price available when booking'}</p> : <>
                    <p className="flex flex-wrap items-baseline gap-2"><strong className="text-3xl font-bold tracking-tight text-ac-primary">{formatMoney(total)}</strong><span className="text-sm text-ac-on-surface-variant">{annual ? '/ year' : card.name === 'Repair' ? '/ diagnosis visit' : '/ visit'}</span></p>
                    <p className="text-sm text-ac-on-surface-variant mt-2">For {numberOfUnits} {numberOfUnits === 1 ? 'aircon unit' : 'aircon units'} · SGD</p>
                    {annual && <p className="text-sm font-semibold text-ac-primary mt-1">{equalVisits ? formatMoney(visitAmounts[0]) + ' per visit · 4 visits' : 'First 3 visits ' + formatMoney(visitAmounts[0]) + ' each · final visit ' + formatMoney(visitAmounts[3])}</p>}
                  </>}
                </div>
                <ul className="text-sm text-ac-on-surface-variant space-y-3 mb-md flex-grow">{card.features.map(feature =>
                  <li key={feature} className="flex items-start gap-2"><SiteIcon className="text-ac-primary text-[18px] mt-0.5">check_circle</SiteIcon><span>{feature}</span></li>)}</ul>
                <Button onClick={() => onOpenBooking(card.name, { numberOfUnits })} className="w-full h-12 rounded-lg bg-ac-primary-fixed text-ac-on-primary-fixed hover:bg-ac-primary hover:text-ac-on-primary">{card.action}</Button>
              </article>;
            })}
          </div>
          <p className="text-sm text-ac-on-surface-variant mt-6 leading-relaxed">Estimates are checked again before you submit. Chemical treatment, repair labour and parts are additional when needed and require your approval.</p>
          <div className="scroll-mt-24 mt-8 pt-8 border-t border-ac-outline-variant/40" id="diagnostic">
            <div className="mb-md"><h3 className="text-headline-sm font-semibold text-ac-on-background mb-xs">Not sure which service?</h3><p className="text-sm text-ac-on-surface-variant">Select what you have noticed. We will add it to your booking notes for the technician to assess.</p></div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              {homepageIssues.map(issue => <Button key={issue.id} type="button" variant="outline" aria-pressed={selectedIssue === issue.id} onClick={() => setSelectedIssue(selectedIssue === issue.id ? null : issue.id)}
                className={'h-auto min-h-28 p-3 flex-col whitespace-normal text-center rounded-xl border shadow-xs ' + (selectedIssue === issue.id ? 'border-ac-primary bg-ac-primary-fixed/30 text-ac-primary ring-1 ring-ac-primary' : 'border-ac-outline-variant/50 bg-ac-surface text-ac-on-background hover:bg-ac-primary-fixed/20')}>
                <span className={'w-10 h-10 rounded-full flex items-center justify-center ' + issue.colorClass}><SiteIcon className="text-[22px]">{issue.icon}</SiteIcon></span><span className="text-sm font-semibold">{issue.name}</span>
              </Button>)}
            </div>
            {selectedAssessment && <div className="mt-6 rounded-xl bg-ac-surface p-md border border-ac-outline-variant/40 flex flex-col sm:flex-row gap-md sm:items-center sm:justify-between">
              <p className="text-sm text-ac-on-surface-variant max-w-xl"><span className="font-semibold text-ac-on-background">{selectedAssessment.symptoms}</span><br />This note will be included with your {selectedAssessment.serviceName.toLowerCase()} request.</p>
              <Button onClick={() => onOpenBooking(selectedAssessment.serviceName, { numberOfUnits, symptoms: selectedAssessment.symptoms })} className="h-12 rounded-lg bg-ac-primary text-ac-on-primary hover:bg-ac-on-primary-fixed shrink-0">{selectedAssessment.serviceName === 'Cleaning' ? 'Book Cleaning for This Issue' : 'Book a Repair Assessment'} <SiteIcon className="text-[18px]">arrow_forward</SiteIcon></Button>
            </div>}
          </div>
        </div>
      </section>

      <section className="scroll-mt-24 py-xl bg-ac-background" id="how-it-works">
        <div className="max-w-container-max mx-auto px-gutter">
          <div className="text-center max-w-2xl mx-auto mb-lg"><p className="text-sm font-semibold text-ac-primary mb-xs">HOW IT WORKS</p><h2 className="text-headline-md font-bold text-ac-on-background mb-sm">From Request to Service Report</h2><p className="text-body-md text-ac-on-surface-variant">Know what happens next, from your preferred appointment to the work recorded after your visit.</p></div>
          <ol className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-md">
            {processSteps.map((step, index) => <li key={step.title} className="bg-ac-surface p-md rounded-xl border border-ac-outline-variant/30">
              <div className="flex justify-between items-start mb-md"><span className="w-14 h-14 rounded-full bg-ac-primary-fixed/50 text-ac-primary flex items-center justify-center"><SiteIcon className="text-[28px]">{step.icon}</SiteIcon></span><span className="text-sm font-semibold text-ac-primary">{String(index + 1).padStart(2, '0')}</span></div>
              <h3 className="text-lg font-semibold text-ac-on-background mb-sm">{step.title}</h3><p className="text-sm text-ac-on-surface-variant leading-relaxed">{step.text}</p>
            </li>)}
          </ol>
        </div>
      </section>

      <section className="scroll-mt-24 py-xl bg-ac-surface-container-low" id="faq">
        <div className="max-w-container-max mx-auto px-gutter flex flex-col lg:flex-row gap-lg">
          <div className="lg:w-1/3">
            <p className="text-sm font-semibold text-ac-primary mb-xs">BEFORE YOU BOOK</p><h2 className="text-headline-md text-ac-on-background mb-sm font-bold">Frequently Asked Questions</h2>
            <p className="text-body-md text-ac-on-surface-variant mb-md">A few things to know before planning your next visit. Need help with your service?</p>
            <a className="inline-flex items-center gap-2 text-ac-primary font-semibold hover:underline" href={supportHref}>Contact Support <SiteIcon className="text-[18px]">mail</SiteIcon></a>
            <div className="mt-8 p-md rounded-xl bg-ac-primary text-ac-on-primary">
              <h3 className="text-lg font-semibold mb-2">{currentUser ? 'Your care, in one place' : 'Ready to plan your visit?'}</h3>
              <p className="text-sm mb-md text-ac-on-primary/90">{currentUser ? 'Use your dashboard to manage your account and follow your service requests.' : 'Create a free customer account to save addresses, request services and keep your reports together.'}</p>
              {currentUser ? <a href={dashboardHref} className="inline-flex items-center justify-center h-11 w-full rounded-lg bg-ac-on-primary text-ac-primary font-semibold hover:bg-ac-surface-container">Go to Dashboard</a> :
                <Button onClick={() => onNavigate('register')} className="w-full h-11 bg-ac-on-primary text-ac-primary hover:bg-ac-surface-container">Create Account</Button>}
            </div>
          </div>
          <div className="lg:w-2/3 flex flex-col gap-sm">
            {faqs.map((faq, index) => <div key={faq.question} className="bg-ac-surface border border-ac-outline-variant/30 rounded-xl overflow-hidden shadow-sm">
              <h3><Button variant="ghost" id={'homepage-faq-question-' + index} aria-expanded={openFaq === index} aria-controls={'homepage-faq-answer-' + index}
                className="w-full h-auto min-h-14 text-left px-md py-sm flex justify-between items-center gap-md whitespace-normal hover:bg-ac-surface-container-low" onClick={() => setOpenFaq(openFaq === index ? null : index)}>
                <span className="text-base text-ac-on-background font-semibold">{faq.question}</span><SiteIcon className={'text-ac-primary text-[20px] transition-transform ' + (openFaq === index ? 'rotate-180' : '')}>expand_more</SiteIcon>
              </Button></h3>
              <div id={'homepage-faq-answer-' + index} role="region" aria-labelledby={'homepage-faq-question-' + index} hidden={openFaq !== index} className="border-t border-ac-outline-variant/20 px-md py-sm text-sm leading-relaxed text-ac-on-surface-variant">{faq.answer}</div>
            </div>)}
          </div>
        </div>
      </section>
    </main>
  );
};
