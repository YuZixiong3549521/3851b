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
