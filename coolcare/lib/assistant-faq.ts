import type { BookingOptions } from './coolcare-types';

export const assistantQuestions = [
  { id: 'services', group: 'Services & prices', question: 'Which service should I choose?', short: 'Choose a service' },
  { id: 'prices', group: 'Services & prices', question: 'How much does a service cost?', short: 'Service prices' },
  { id: 'repair', group: 'Services & prices', question: 'Are there additional repair charges?', short: 'Repair charges' },
  { id: 'dates', group: 'Bookings & changes', question: 'When can I book an appointment?', short: 'Booking dates' },
  { id: 'address', group: 'Bookings & changes', question: 'Can I book twice at the same address?', short: 'Same-address bookings' },
  { id: 'changes', group: 'Bookings & changes', question: 'Can I change or cancel my appointment?', short: 'Change or cancel' },
  { id: 'confirmation', group: 'Bookings & changes', question: 'Is my booking confirmed immediately?', short: 'Booking confirmation' },
  { id: 'annual', group: 'Annual care & rewards', question: 'How do the four annual bundle visits work?', short: 'Annual bundle' },
  { id: 'points', group: 'Annual care & rewards', question: 'How do I use and earn loyalty points?', short: 'Loyalty points' },
  { id: 'returned-points', group: 'Annual care & rewards', question: 'What happens to points if a booking is rejected?', short: 'Returned points' },
  { id: 'updates', group: 'Help & service updates', question: 'Where will I receive booking updates?', short: 'Booking updates' },
  { id: 'support', group: 'Help & service updates', question: 'How can I contact the service team?', short: 'Contact support' },
] as const;

export type AssistantQuestionId = typeof assistantQuestions[number]['id'];
export type AssistantAnswer = { question: string; paragraphs: string[]; action?: 'booking' | 'support' };

const money = (amount: number) => new Intl.NumberFormat('en-SG', { style: 'currency', currency: 'SGD', currencyDisplay: 'code' }).format(amount);

function cataloguePrices(options: BookingOptions | null): string[] {
  if (!options) return ['Current prices have not loaded. Return to Booking and reload the assistant before checking an estimate. No price has been assumed.'];
  const prices = options.services.filter(service => service.code === 'cleaning' || service.code === 'repair').map(service => {
    const base = Number(service.basePrice), extra = Number(service.additionalUnitPrice ?? 0);
    if (service.code === 'repair') return `${service.name}: ${money(base)} minimum diagnostic fee${extra ? ` for the first unit, plus ${money(extra)} for each additional unit` : ''}. Additional repair work and parts are quoted by the technician.`;
    return `${service.name}: ${base === extra ? `${money(base)} per unit, per visit` : `${money(base)} for the first unit${extra ? `, plus ${money(extra)} for each additional unit` : ', with no additional unit charge in the current catalogue'}`}. The technician decides the cleaning method after inspection.`;
  });
  const bundle = options.bundles.find(item => item.code === 'annual-cleaning');
  const tiers = bundle?.propertyPrices?.map(tier => Number(tier.price)).filter(price => Number.isFinite(price) && price >= 0) ?? [];
  if (bundle) prices.push(tiers.length ? `${bundle.name}: from ${money(Math.min(...tiers))} for four quarterly visits. The total depends on the property type, included units and any additional units.` : `${bundle.name}: choose a property type and unit count in Booking to check its current price.`);
  return prices.length ? [...prices, 'These catalogue prices were loaded for this assistant session. Review shows the estimate for your exact selection and checks the latest price before confirmation. No online payment is collected.'] : ['No services are currently available. Please contact the service team.'];
}

/** Curated answers, never an order lookup or an unverified price estimate. */
export function answerAssistantQuestion(id: AssistantQuestionId, options: BookingOptions | null): AssistantAnswer {
  const question = assistantQuestions.find(item => item.id === id)?.question;
  if (!question) throw new Error('Choose a question from the list.');
  const answers: Record<Exclude<AssistantQuestionId, 'prices'>, Omit<AssistantAnswer, 'question'>> = {
    services: { paragraphs: ['Choose Cleaning for a maintenance clean, Repair for a fault or inspection, or Annual Cleaning Bundle for quarterly care. Your technician decides whether regular or chemical cleaning is appropriate.', 'Cleaning and Repair can be combined in one visit at one address. An annual bundle is booked separately.'], action: 'booking' },
    repair: { paragraphs: ['Repair starts with the minimum diagnostic fee shown in the current catalogue. The technician quotes and records additional labour or parts, with an explanation in your booking.', 'The initial booking estimate does not include repair extras that have not yet been assessed. No payment is collected through this website.'] },
    dates: { paragraphs: ['New appointments must be at least 14 calendar days ahead in Singapore time, Monday to Friday. There are no Saturday or Sunday service appointments.', 'Available times depend on the number of units, service duration and the team schedule. Select a date in Booking to check the current slots. A preferred slot still needs the service team’s confirmation.'], action: 'booking' },
    address: { paragraphs: ['There can be one cleaning appointment per address in each Monday–Sunday calendar week. Annual bundle visits and combined Cleaning + Repair visits count towards this limit.', 'Cancelled, rejected and expired requests do not count. Repair-only visits are not restricted by the cleaning limit.'] },
    changes: { paragraphs: ['Eligible appointments can be changed or cancelled from their booking detail page at least 72 hours before the original start time. A new appointment must also be at least 72 hours ahead and on a weekday.', 'Annual visits must stay within their quarterly window. Started work and some visits with service or stock activity cannot be changed online; contact the service team for help.'], action: 'support' },
    confirmation: { paragraphs: ['Submitting saves a real request as Awaiting confirmation. The service team confirms the request and arranges an available technician or team.', 'Check the confirmation deadline on the booking. Annual visits 2–4 need their own confirmation and do not automatically expire like an unconfirmed first visit.'] },
    annual: { paragraphs: ['One annual bundle contains four separate cleaning visits at the same address with the same AC count. They are planned from your first date, then three, six and nine months later. Later dates falling on a weekend move to Monday.', 'Each visit has its own booking, status and report. For example, two completed visits and two awaiting service means 2 of 4 visits completed, not a completed annual plan.', 'The annual price depends on your property type and AC count and is divided between the four visits. Review all four dates and amounts before submitting. You can request eligible visit changes within the 72-hour rule and quarterly window.'], action: 'booking' },
    points: { paragraphs: ['Select available loyalty points at the booking Review step, before you submit. The current conversion, available balance and discount limit are shown there. For an annual bundle, the discount applies to the first visit.', 'Reserved points cannot be used on another booking. The reservation is settled when the order completes, and eligible completed service value earns points under the current reward rules. Fully discounted orders earn no new points.'] },
    'returned-points': { paragraphs: ['Unused reserved points are returned when the booking is cancelled, rejected or expires. My Rewards shows the actual reservation or return activity.', 'If you did not reserve points for that booking, there are no points to return. A completed order’s already-used discount is not an unused reservation.'] },
    updates: { paragraphs: ['Check My Bookings for the latest status, technician assignment and service updates. After completion, submitted service reports are available in Booking History.', 'A booking email is queued after a successful technician assignment. Delivery depends on the configured email service; the saved booking status remains the reliable in-app record. Opening an email support link does not send a message automatically.'] },
    support: { paragraphs: ['Use Email support to open a message to the CoolCare service team. Include your booking reference if your question is about an existing visit.', 'Your own email application sends the message. Never include your password.'], action: 'support' },
  };
  return id === 'prices' ? { question, paragraphs: cataloguePrices(options), action: 'booking' } : { question, ...answers[id] };
}
