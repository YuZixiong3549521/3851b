// Singapore subscriber prefixes follow IMDA's National Numbering Plan.
// https://www.imda.gov.sg/regulations-and-licensing-listing/numbering/national-numbering-plan-and-allocation-process
// This checks a plausible contact format, not whether a number is assigned or reachable.
export function normalizePhoneNumber(value) {
  if (typeof value !== 'string' || value.length > 40 || !/^[+\d\s().-]+$/.test(value.trim())) return null;
  const compact = value.trim().replace(/[\s().-]/g, '');
  if (/^[3689]\d{7}$/.test(compact)) return '+65' + compact;
  if (compact.startsWith('+65')) return /^\+65[3689]\d{7}$/.test(compact) ? compact : null;
  return /^\+[1-9]\d{7,14}$/.test(compact) ? compact : null;
}

export function phoneNumberError(value) {
  if (typeof value !== 'string' || !value.trim()) return 'Enter a contact phone number.';
  return normalizePhoneNumber(value) ? '' : 'Enter an 8-digit Singapore number, or an international number with + and its country code.';
}
