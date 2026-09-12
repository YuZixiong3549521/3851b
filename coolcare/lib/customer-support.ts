export const customerSupportEmail = 'c3549521@uon.edu.au';

export function bookingSupportLink(bookingReference: string) {
  const subject = `CoolCare booking help - ${bookingReference}`;
  const body = `Hello CoolCare,\n\nI need help with booking ${bookingReference}.\n\nMy question:\n`;
  return `mailto:${customerSupportEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
