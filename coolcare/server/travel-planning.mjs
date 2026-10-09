export const DEFAULT_TRAVEL_BUFFER_MINUTES = 30;

export function normalizeTravelBuffer(value) {
  const minutes = Number(value);
  return Number.isInteger(minutes) && minutes >= 0 && minutes <= 180
    ? minutes
    : DEFAULT_TRAVEL_BUFFER_MINUTES;
}

export function travelStartTime(serviceStart, bufferMinutes) {
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(
    String(serviceStart ?? ''),
  );
  if (!match) throw new Error('Invalid service start time.');
  const serviceSeconds =
      Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3] || 0),
    plannedSeconds = Math.max(
      0,
      serviceSeconds - normalizeTravelBuffer(bufferMinutes) * 60,
    ),
    hours = Math.floor(plannedSeconds / 3600),
    minutes = Math.floor((plannedSeconds % 3600) / 60),
    seconds = plannedSeconds % 60;
  return [hours, minutes, seconds]
    .map((part) => String(part).padStart(2, '0'))
    .join(':');
}
