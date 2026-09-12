export function formatDate(value: string, options?: Intl.DateTimeFormatOptions) {
  const day = value?.slice(0, 10);
  const date = new Date(`${day}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== day) return 'Date unavailable';
  return new Intl.DateTimeFormat('en-SG', { ...(options ?? {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }), timeZone: 'UTC' }).format(date);
}

// APIs send TIMESTAMP values with an explicit UTC offset. Offsetless legacy
// values represent Singapore local time. Never inherit the device locale/zone.
export function formatDateTime(value: string | null | undefined) {
  if (!value) return 'Date and time unavailable';
  const normalized = value.trim().replace(' ', 'T');
  const date = new Date(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized) ? normalized : `${normalized}+08:00`);
  if (!Number.isFinite(date.getTime())) return 'Date and time unavailable';
  return new Intl.DateTimeFormat('en-SG', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    hour12: true, timeZone: 'Asia/Singapore',
  }).format(date);
}

export function formatTimeSlot(value: string | null | undefined) {
  if (!value) return 'Time to be confirmed';
  const parts = value.split(/\s*[-–—]\s*/);
  const formatted = parts.map((part) => {
    const match = part.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
    if (!match) return null;
    let hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (minutes > 59 || (match[3] ? hours < 1 || hours > 12 : hours > 23)) return null;
    if (match[3]) hours = hours % 12 + (match[3].toUpperCase() === 'PM' ? 12 : 0);
    return `${String(hours % 12 || 12).padStart(2, '0')}:${match[2]} ${hours >= 12 ? 'PM' : 'AM'}`;
  });
  return formatted.every(Boolean) ? formatted.join(' – ') : value;
}

export function formatMoney(value: number | null) {
  return new Intl.NumberFormat('en-SG', { style: 'currency', currency: 'SGD' }).format(value ?? 0);
}
