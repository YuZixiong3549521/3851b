export type HomepageOffer = {
  name: string;
  base: number;
  perUnit: number;
  includedVisits?: number;
};

const serviceNames = ['Cleaning', 'Repair', 'Annual Cleaning Bundle'];

/** A failed or incomplete catalogue must never turn into an advertised zero price. */
export function readHomepageOffers(value: unknown): HomepageOffer[] {
  if (!value || typeof value !== 'object') return [];
  const data = value as { currency?: unknown; offers?: unknown };
  if (data.currency !== 'SGD' || !Array.isArray(data.offers)) return [];
  const amount = (input: unknown) => (typeof input === 'number' || (typeof input === 'string' && input.trim() !== '')) && Number.isFinite(Number(input)) && Number(input) >= 0;
  return data.offers.flatMap((input): HomepageOffer[] => {
    if (!input || typeof input !== 'object') return [];
    const item = input as Record<string, unknown>;
    if (!serviceNames.includes(String(item.name)) || !amount(item.base) || !amount(item.perUnit)) return [];
    if (item.name === 'Annual Cleaning Bundle' && Number(item.includedVisits) !== 4) return [];
    return [{ name: String(item.name), base: Number(item.base), perUnit: Number(item.perUnit), includedVisits: item.name === 'Annual Cleaning Bundle' ? 4 : undefined }];
  });
}

export function homepageOfferTotal(offer: HomepageOffer | undefined, numberOfUnits: number): number | null {
  if (!offer || !Number.isInteger(numberOfUnits) || numberOfUnits < 1 || numberOfUnits > 10) return null;
  return Math.round((offer.base + offer.perUnit * (numberOfUnits - 1)) * 100) / 100;
}

export const homepageIssues = [
  { id: 'poor-cooling', name: 'Poor Cooling', description: 'The aircon is not cooling effectively.', icon: 'thermostat', colorClass: 'bg-rose-50 text-rose-600', serviceName: 'Repair' },
  { id: 'water-leakage', name: 'Water Leakage', description: 'Water is dripping or leaking from the unit.', icon: 'water_drop', colorClass: 'bg-slate-100 text-slate-700', serviceName: 'Repair' },
  { id: 'unusual-noise', name: 'Unusual Noise', description: 'Strange or loud sounds are coming from the aircon.', icon: 'volume_up', colorClass: 'bg-indigo-50 text-indigo-600', serviceName: 'Repair' },
  { id: 'weak-airflow', name: 'Weak Airflow', description: 'Airflow is weak or inconsistent.', icon: 'air', colorClass: 'bg-sky-50 text-sky-600', serviceName: 'Repair' },
  { id: 'electrical-issues', name: 'Electrical Issues', description: 'There may be a power, wiring or electrical fault.', icon: 'electrical_services', colorClass: 'bg-amber-50 text-amber-700', serviceName: 'Repair' },
  { id: 'needs-cleaning', name: 'Needs Cleaning', description: 'Dust or dirt may be affecting the unit.', icon: 'cleaning_services', colorClass: 'bg-emerald-50 text-emerald-600', serviceName: 'Cleaning' },
] as const;

export function bookingForHomepageIssue(issueId: string | null) {
  const issue = homepageIssues.find(item => item.id === issueId);
  return issue ? { serviceName: issue.serviceName, symptoms: `${issue.name}: ${issue.description}` } : null;
}
