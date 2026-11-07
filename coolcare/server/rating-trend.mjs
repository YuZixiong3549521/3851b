const average = values => values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length * 100) / 100 : null;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

function bounds(date, grouping) {
  const year = date.slice(0, 4), month = Number(date.slice(5, 7));
  const startMonth = grouping === 'year' ? 1 : grouping === 'quarter' ? Math.floor((month - 1) / 3) * 3 + 1 : month;
  const start = `${year}-${String(startMonth).padStart(2, '0')}-01`;
  const next = new Date(start + 'T00:00:00Z');
  next.setUTCMonth(next.getUTCMonth() + (grouping === 'year' ? 12 : grouping === 'quarter' ? 3 : 1));
  return { key: grouping === 'year' ? year : grouping === 'quarter' ? `${year}-Q${Math.ceil(month / 3)}` : date.slice(0, 7),
    start, end: new Date(next.getTime() - 86400000).toISOString().slice(0, 10), next: next.toISOString().slice(0, 10) };
}

// Input is already role-scoped. The captured visit date is Singapore local time;
// review edits update that visit's current rating rather than creating another review.
export function buildRatingTrends(visits, { from, to }) {
  const people = new Map();
  for (const visit of visits) {
    const technicianId = Number(visit.technicianId);
    if (!Number.isSafeInteger(technicianId) || technicianId < 1) continue;
    if (!people.has(technicianId)) people.set(technicianId, { technicianId, name: visit.technician, records: new Map() });
    const date = String(visit.actualEnd ?? '').slice(0, 10), stars = Number(visit.stars);
    if (visit.outcome !== 'Completed' || visit.stars == null || !Number.isInteger(stars) || stars < 1 || stars > 5 ||
        !datePattern.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date || date < from || date > to) continue;
    people.get(technicianId).records.set(visit.reportId, { reportId: visit.reportId, date, stars });
  }
  const dayCount = Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
  const split = new Date(Date.parse(from) + Math.ceil(dayCount / 2) * 86400000).toISOString().slice(0, 10);
  const earlierTo = new Date(Date.parse(split) - 86400000).toISOString().slice(0, 10);
  return [...people.values()].map(person => {
    const records = [...person.records.values()].sort((a, b) => a.date.localeCompare(b.date) || a.reportId - b.reportId);
    const periods = {};
    for (const grouping of ['month', 'quarter', 'year']) {
      const buckets = new Map();
      for (let cursor = from; cursor <= to;) {
        const range = bounds(cursor, grouping);
        buckets.set(range.key, { period: range.key, from: range.start < from ? from : range.start, to: range.end > to ? to : range.end,
          partial: range.start < from || range.end > to, values: [] });
        cursor = range.next;
      }
      for (const record of records) buckets.get(bounds(record.date, grouping).key).values.push(record.stars);
      periods[grouping] = [...buckets.values()].map(({ values, ...period }) => ({ ...period, count: values.length, average: average(values),
        positive: values.filter(value => value >= 4).length, neutral: values.filter(value => value === 3).length, negative: values.filter(value => value <= 2).length }));
    }
    const earlier = records.filter(record => record.date < split).map(record => record.stars);
    const later = records.filter(record => record.date >= split).map(record => record.stars);
    const enough = earlier.length >= 3 && later.length >= 3;
    const difference = enough ? Math.round((average(later) - average(earlier)) * 100) / 100 : null;
    return { technicianId: person.technicianId, name: person.name, count: records.length, average: average(records.map(record => record.stars)), periods,
      comparison: { minimumReviews: 3, earlier: { from, to: earlierTo, count: earlier.length, average: average(earlier) },
        later: { from: split <= to ? split : null, to, count: later.length, average: average(later) }, difference,
        direction: !enough ? 'insufficient' : difference > 0 ? 'higher' : difference < 0 ? 'lower' : 'unchanged' } };
  }).sort((a, b) => a.name.localeCompare(b.name, 'en'));
}
