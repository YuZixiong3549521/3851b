const singaporeDay = (value) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Singapore',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(value));

export function planReminderKey(plan) {
  return `${plan.validUntil}:${plan.earlyRenewalDeadline ?? 'no-final-visit'}`;
}

export function describePlanReminder(plan, history = [], now = new Date()) {
  const key = planReminderKey(plan);
  const today = singaporeDay(now);
  const until = new Date(`${today}T00:00:00Z`);
  until.setUTCDate(until.getUTCDate() + 14);
  const finalDate = plan.earlyRenewalDeadline
    ? singaporeDay(plan.earlyRenewalDeadline)
    : plan.validUntil;
  const dueDate = [finalDate, plan.validUntil].sort((a, b) =>
    a.localeCompare(b),
  )[0];
  const available =
    !plan.existingRenewalSeriesId && plan.status !== 'Cancelled';
  const contacted = history.some((item) => item.reminderKey === key);
  return {
    key,
    dueDate,
    available,
    contacted,
    due: available && !contacted && dueDate <= until.toISOString().slice(0, 10),
    history,
  };
}
