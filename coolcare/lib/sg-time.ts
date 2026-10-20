/** Calendar dates have no timezone. These helpers are only for date-and-time values. */
const singaporeFormatter = new Intl.DateTimeFormat('en-SG', {
  day: '2-digit', month: 'short', year: 'numeric',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
  hour12: true, timeZone: 'Asia/Singapore',
});
const offset = 8 * 60 * 60 * 1000;

function instant(value: string | Date | null | undefined, wallClock = false): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const normalized = value.trim().replace(' ', 'T');
  const withZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized)
    ? normalized
    : normalized + (wallClock ? '+08:00' : 'Z');
  const date = new Date(withZone);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Actual instants: ISO timestamps, or legacy database values stored as UTC. */
export function formatInstantDateTime(value: string | Date | null | undefined): string {
  const date = instant(value);
  return date ? `${singaporeFormatter.format(date)} SGT` : 'Not recorded';
}

/** Appointment/report DATETIME fields deliberately store Singapore wall-clock time. */
export function formatSingaporeDateTime(value: string | null | undefined): string {
  const date = instant(value, true);
  return date ? `${singaporeFormatter.format(date)} SGT` : 'Not recorded';
}

/** An instant to the English editor's YYYY-MM-DDTHH:mm:ss Singapore wall-clock value. */
export function toSingaporeDateTimeInput(value: string | null | undefined): string {
  const date = instant(value);
  return date ? new Date(date.getTime() + offset).toISOString().slice(0, 19) : '';
}

/** Singapore editor value to an explicit UTC instant; reject invalid dates/times. */
export function fromSingaporeDateTimeInput(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value)) return null;
  const full = value.length === 16 ? value + ':00' : value;
  const date = instant(full, true);
  if (!date || toSingaporeDateTimeInput(date.toISOString()) !== full) return null;
  return date.toISOString().replace('.000Z', 'Z');
}
