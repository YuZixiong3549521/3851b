'use client';

import { useId, useState } from 'react';
import { format } from 'date-fns';
import { enGB } from 'date-fns/locale';
import { CalendarDays } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverDescription, PopoverTitle, PopoverTrigger } from '@/components/ui/popover';
import { calendarDateUnavailable, calendarDateValue, englishCalendarDate, parseCalendarDate } from '@/lib/english-date';
import { singaporeToday } from '@/lib/booking-schedule';
import { cn } from '@/lib/utils';

export type EnglishDatePickerProps = {
  id?: string;
  value: string;
  onChange: (iso: string) => void;
  min?: string;
  max?: string;
  disabled?: boolean;
  blockedDates?: string[];
  disableWeekends?: boolean;
  label?: string;
  placeholder?: string;
  onMonthChange?: (date: Date) => void;
  className?: string;
  'aria-invalid'?: boolean;
};

export function EnglishDatePicker({ id, value, onChange, min, max, disabled, blockedDates = [], disableWeekends = true, label = 'Preferred date', placeholder = 'Choose a date', onMonthChange, className, 'aria-invalid': invalid }: EnglishDatePickerProps) {
  const generatedId = useId();
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState<Date>();
  const selected = parseCalendarDate(value);
  const firstDate = parseCalendarDate(min ?? '');
  const lastDate = parseCalendarDate(max ?? '');
  const changeMonth = (date: Date) => { setMonth(date); onMonthChange?.(date); };
  const dateIsDisabled = (date: Date) => calendarDateUnavailable(calendarDateValue(date), { min, max, disableWeekends, blockedDates });

  return <Popover open={open} onOpenChange={next => {
    setOpen(next);
    if (next) changeMonth(selected && (!firstDate || selected >= firstDate) && (!lastDate || selected <= lastDate) ? selected : firstDate ?? new Date());
  }}>
    <PopoverTrigger render={<Button id={id ?? generatedId} type="button" variant="outline" disabled={disabled} aria-invalid={invalid} aria-label={`${label}${selected ? ': ' + englishCalendarDate(value) : ''}`} className={cn('h-12 w-full justify-start gap-3 rounded-xl bg-background text-left font-normal', className)} />}>
      <CalendarDays className="size-4 shrink-0 text-primary" aria-hidden="true" />
      <span className={!selected ? 'text-muted-foreground' : undefined}>{selected ? englishCalendarDate(value) : placeholder}</span>
    </PopoverTrigger>
    <PopoverContent align="start" className="w-auto max-w-[calc(100vw-2rem)] gap-0 rounded-2xl p-2" lang="en-GB">
      <PopoverTitle className="px-2 pt-2 text-sm">{label}</PopoverTitle>
      <PopoverDescription className="px-2 pt-1 text-xs">{disableWeekends ? 'Monday to Friday' : 'Choose a date'}{min ? ' · From ' + englishCalendarDate(min) : ''}</PopoverDescription>
      <Calendar mode="single" locale={enGB} weekStartsOn={1} today={parseCalendarDate(singaporeToday())} autoFocus month={month ?? selected ?? firstDate} onMonthChange={changeMonth} selected={selected} startMonth={firstDate} endMonth={lastDate} disabled={dateIsDisabled} required onSelect={date => {
        if (!date || dateIsDisabled(date)) return;
        onChange(calendarDateValue(date)); setOpen(false);
      }} labels={{
        labelNext: () => 'Next month', labelPrevious: () => 'Previous month',
        labelGrid: date => format(date, 'MMMM yyyy', { locale: enGB }),
        labelWeekday: date => format(date, 'EEEE', { locale: enGB }),
        labelDayButton: (date, modifiers) => `${format(date, 'EEEE, d MMMM yyyy', { locale: enGB })}${modifiers.today ? ', today' : ''}${modifiers.selected ? ', selected' : ''}`,
      }} formatters={{ formatCaption: date => format(date, 'MMMM yyyy', { locale: enGB }), formatWeekdayName: date => format(date, 'EEE', { locale: enGB }) }} className="[--cell-size:2.5rem]" />
      <p className="px-2 pb-2 text-xs text-muted-foreground">Unavailable dates cannot be selected. Singapore time.</p>
    </PopoverContent>
  </Popover>;
}
