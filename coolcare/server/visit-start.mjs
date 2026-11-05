// Explicit local testing opt-in; production always enforces appointment start timing.
export function serviceTimingTestMode(env = process.env) {
  return env.SERVICE_TIMING_TEST_MODE === 'true' && env.NODE_ENV !== 'production';
}

// Appointment DATETIME/TIME values are Singapore wall time, independent of host timezone.
export function visitStartBlockReason(date, time, now = new Date(), activeJobId = null) {
  const sg = new Date(now.getTime() + 8 * 3600000).toISOString();
  const today = sg.slice(0, 10);
  if (!date || !time) return 'This appointment has no scheduled start. Ask the administrator to arrange its date and time.';
  if (activeJobId) return `Finish work order WO-${activeJobId} before starting another service.`;
  if (serviceTimingTestMode()) return null;
  if (date !== today) return date > today
    ? 'Service can only start on its scheduled date (Singapore time).'
    : 'This appointment date has passed. Ask the administrator to arrange a new date.';
  if (String(time).slice(0, 8).padEnd(8, ':00') > sg.slice(11, 19)) return 'Service cannot start before its scheduled appointment time (Singapore time).';
  return null;
}

function recordedStartInstant(startedAt) {
  // service_report.started_at is a Singapore-wall-time DATETIME, not host local time.
  const value=typeof startedAt==='string'?startedAt.trim().replace(' ','T'):'';
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?$/.test(value))return null;
  const instant=Date.parse(value+'+08:00');
  if(!Number.isFinite(instant)||new Date(instant+8*3600000).toISOString().slice(0,19)!==value.slice(0,19))return null;
  return instant;
}

export function visitCompletionBlockReason(_date, now = new Date(), startedAt = null) {
  const start=recordedStartInstant(startedAt);
  if(start===null)return 'This visit has no valid recorded start. Ask the administrator to check the service record.';
  if(start>now.getTime())return 'The recorded service start is in the future. Ask the administrator to check the service record.';
  // An already-started visit may predate its appointment after migration or local
  // testing. Finish that actual visit without rewriting its schedule or start.
  // Status, current report ownership and idempotency are checked by the caller.
  return null;
}

export function visitCompletionTimingNotice(date, now = new Date(), startedAt = null) {
  if(visitCompletionBlockReason(date,now,startedAt))return null;
  return String(startedAt).slice(0,10)<date
    ? 'This visit started before its scheduled date. Completing it records the actual finish time and keeps the original appointment and start history.' : null;
}
