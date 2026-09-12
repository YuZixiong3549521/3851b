// Calendar dates are local calendar values, never UTC instants. Explicit English
// formatting keeps the booking UI independent of the operating system language.
export function parseCalendarDate(value: string): Date | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day, 12);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : undefined;
}

export function calendarDateValue(date: Date): string {
  return `${date.getFullYear().toString().padStart(4, '0')}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')}`;
}

export function englishCalendarDate(value: string): string {
  const date = parseCalendarDate(value);
  if (!date) return '';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}`;
}

export function calendarDateUnavailable(value: string, options: { min?: string; max?: string; disableWeekends?: boolean; blockedDates?: string[] } = {}): boolean {
  const date = parseCalendarDate(value);
  return !date || Boolean(options.min && value < options.min) || Boolean(options.max && value > options.max)
    || Boolean(options.disableWeekends && (date.getDay() === 0 || date.getDay() === 6)) || Boolean(options.blockedDates?.includes(value));
}
