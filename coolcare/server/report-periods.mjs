// Group already-authorised completed amounts by their Singapore service date.
// Monetary additions stay in cents, including when several dates share a period.
export function groupServicePeriods(daily, grouping = 'day') {
  const periods = new Map();
  for (const row of daily) {
    const year = row.date.slice(0, 4);
    const period = grouping === 'year' ? year : grouping === 'quarter'
      ? `${year}-Q${Math.ceil(Number(row.date.slice(5, 7)) / 3)}` : row.date;
    const total = periods.get(period) ?? { period, completed: 0, serviceAmount: 0, rewardDiscounts: 0, netServiceAmount: 0 };
    total.completed += Number(row.completed);
    for (const key of ['serviceAmount', 'rewardDiscounts', 'netServiceAmount']) total[key] += Math.round(Number(row[key] || 0) * 100);
    periods.set(period, total);
  }
  return [...periods.values()].sort((a, b) => a.period.localeCompare(b.period)).map(row => ({
    ...row, serviceAmount: row.serviceAmount / 100, rewardDiscounts: row.rewardDiscounts / 100, netServiceAmount: row.netServiceAmount / 100,
  }));
}

const activeStatuses = new Set(['Submitted', 'Confirmed', 'Assigned', 'On The Way', 'In Progress', 'Awaiting return arrangement', 'Return visit']);
const closedStatuses = new Set(['Cancelled', 'Rejected', 'Expired']);
const serviceGroups = new Set(['cleaning', 'repair', 'combined', 'annual']);

// Codes come from catalogue links, never customer-facing names. A historical or
// mixed unsupported service remains visible in Other instead of being guessed.
export function classifyReportService(isAnnual, codes) {
  if (isAnnual) return 'annual';
  const values = new Set(String(codes ?? '').split(',').filter(Boolean));
  if (!values.size || [...values].some(code => !['cleaning', 'repair'].includes(code))) return 'other';
  if (values.has('cleaning') && values.has('repair')) return 'combined';
  return values.has('cleaning') ? 'cleaning' : 'repair';
}

function periodBounds(date, grouping) {
  const year = date.slice(0, 4), month = Number(date.slice(5, 7));
  const start = grouping === 'year' ? `${year}-01-01`
    : grouping === 'quarter' ? `${year}-${String(Math.floor((month - 1) / 3) * 3 + 1).padStart(2, '0')}-01` : date;
  const next = new Date(`${start}T00:00:00Z`);
  if (grouping === 'year') next.setUTCFullYear(next.getUTCFullYear() + 1);
  else if (grouping === 'quarter') next.setUTCMonth(next.getUTCMonth() + 3);
  else next.setUTCDate(next.getUTCDate() + 1);
  return {
    period: grouping === 'year' ? year : grouping === 'quarter' ? `${year}-Q${Math.ceil(month / 3)}` : date,
    start, end: new Date(next.getTime() - 86400000).toISOString().slice(0, 10),
    next: next.toISOString().slice(0, 10),
  };
}

// Input rows have already passed the report's date/service/technician filters.
// Populate every calendar period so an empty quarter is not silently skipped.
export function buildReportAnalytics(orders, { from, to, groupBy = 'day' }) {
  const periods = new Map();
  for (let cursor = from; cursor <= to;) {
    const bounds = periodBounds(cursor, groupBy);
    periods.set(bounds.period, {
      period: bounds.period, from: bounds.start < from ? from : bounds.start,
      to: bounds.end > to ? to : bounds.end,
      partial: bounds.start < from || bounds.end > to,
      orders: 0, completed: 0, active: 0, closed: 0, other: 0,
      unknownCompletedPrices: 0, serviceAmount: 0, rewardDiscounts: 0, netServiceAmount: 0,
      services: { cleaning: 0, repair: 0, combined: 0, annual: 0, other: 0 },
      annual: { visits: 0, completed: 0, active: 0, closed: 0, other: 0 },
    });
    cursor = bounds.next;
  }
  for (const order of orders) {
    if (order.serviceDate < from || order.serviceDate > to) continue;
    const row = periods.get(periodBounds(order.serviceDate, groupBy).period);
    const status = order.status === 'Completed' ? 'completed'
      : activeStatuses.has(order.status) ? 'active' : closedStatuses.has(order.status) ? 'closed' : 'other';
    const service = serviceGroups.has(order.serviceGroup) ? order.serviceGroup : 'other';
    row.orders++;
    row[status]++;
    row.services[service]++;
    if (order.isAnnual) { row.annual.visits++; row.annual[status]++; }
    if (status === 'completed') {
      if (order.serviceAmount == null) row.unknownCompletedPrices++;
      for (const [source, target] of [['serviceAmount', 'serviceAmount'], ['rewardDiscount', 'rewardDiscounts'], ['netServiceAmount', 'netServiceAmount']]) {
        if (order[source] != null) row[target] += Math.round(Number(order[source]) * 100);
      }
    }
  }
  return { periods: [...periods.values()].map(row => ({ ...row,
    serviceAmount: row.serviceAmount / 100, rewardDiscounts: row.rewardDiscounts / 100,
    netServiceAmount: row.netServiceAmount / 100,
  })) };
}
