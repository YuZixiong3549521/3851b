// Appointment DATETIME/TIME values are Singapore wall time, independent of host timezone.
export function visitStartBlockReason(date, time, now = new Date(), activeJobId = null) {
  const sg = new Date(now.getTime() + 8 * 3600000).toISOString();
  const today = sg.slice(0, 10);
  if (!date || !time) return 'This appointment has no scheduled start. Ask the administrator to arrange its date and time.';
  if (date !== today) return date > today
    ? 'Service can only start on its scheduled date (Singapore time).'
    : 'This appointment date has passed. Ask the administrator to arrange a new date.';
  if (String(time).slice(0, 8).padEnd(8, ':00') > sg.slice(11, 19)) return 'Service cannot start before its scheduled appointment time (Singapore time).';
  if (activeJobId) return `Finish work order WO-${activeJobId} before starting another service.`;
  return null;
}

export function visitCompletionBlockReason(date, now = new Date()) {
  return date > new Date(now.getTime()+8*3600000).toISOString().slice(0,10)
    ? 'A future service visit cannot be completed. Check the scheduled Singapore service date.' : null;
}
