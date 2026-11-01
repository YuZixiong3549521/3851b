export function matchesPlanAttention(plan, filter, today) {
  if (!filter || filter === 'all') return true;
  if (filter === 'reminder-due') return Boolean(plan.reminder?.due);
  if (filter === 'contacted') return Boolean(plan.reminder?.contacted);
  const unrenewed = !plan.existingRenewalSeriesId && plan.status !== 'Cancelled';
  if (filter === 'unrenewed') return unrenewed;
  if (filter === 'renewable') return unrenewed && plan.canRenew;
  if (filter === 'bonus') return plan.earlyRenewalEligible;
  if (filter === 'expiring') {
    const until = new Date(`${today}T00:00:00Z`);
    until.setUTCDate(until.getUTCDate() + 30);
    return unrenewed && plan.status === 'Active' && plan.validUntil >= today && plan.validUntil <= until.toISOString().slice(0, 10);
  }
  if (filter === 'bonus-soon') {
    const deadline = plan.earlyRenewalDeadline ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(plan.earlyRenewalDeadline)) : '';
    const until = new Date(`${today}T00:00:00Z`);
    until.setUTCDate(until.getUTCDate() + 14);
    return plan.earlyRenewalEligible && deadline >= today && deadline <= until.toISOString().slice(0, 10);
  }
  return false;
}
