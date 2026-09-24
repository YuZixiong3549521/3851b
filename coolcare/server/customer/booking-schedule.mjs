import { HttpError } from './errors.mjs';

export const BOOKING_TIME_ZONE='Asia/Singapore';
export const MINIMUM_BOOKING_DAYS=14;
export const MINIMUM_CHANGE_HOURS=72;
const singaporeCalendar=new Intl.DateTimeFormat('en-CA',{timeZone:BOOKING_TIME_ZONE,year:'numeric',month:'2-digit',day:'2-digit'});

export function singaporeToday(now=new Date()) {
  const parts=Object.fromEntries(singaporeCalendar.formatToParts(now).map(part=>[part.type,part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function isCalendarDate(value) {
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
  const date=new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime())&&date.toISOString().slice(0,10)===value;
}

export function addCalendarDays(value,days) {
  const date=new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate()+days);
  return date.toISOString().split('T')[0];
}

export function minimumBookingDate(now=new Date()) {
  return addCalendarDays(singaporeToday(now),MINIMUM_BOOKING_DAYS);
}

export function isWeekday(value) {
  const day=new Date(`${value}T00:00:00Z`).getUTCDay();
  return day>=1&&day<=5;
}

export function nextWeekday(value) {
  const day=new Date(`${value}T00:00:00Z`).getUTCDay();
  return addCalendarDays(value,day===6?2:day===0?1:0);
}

export function assertBookableDate(value,now=new Date()) {
  if(!isCalendarDate(value))throw new HttpError(400,'Choose a valid service date.');
  const earliest=minimumBookingDate(now);
  if(value<earliest)throw new HttpError(400,`Book at least 14 calendar days in advance. The earliest date is ${nextWeekday(earliest)} (Singapore time).`);
  if(!isWeekday(value))throw new HttpError(400,'We are closed on Saturdays and Sundays. Choose a weekday.');
}

export function appointmentInstant(date,time='09:00:00') {
  return new Date(`${String(date).slice(0,10)}T${String(time).slice(0,8)}+08:00`);
}

export function canChangeAppointment(date,time,now=new Date()) {
  return appointmentInstant(date,time).getTime()-now.getTime()>=MINIMUM_CHANGE_HOURS*3600000;
}

export function assertChangeNotice(date,time,now=new Date()) {
  if(!canChangeAppointment(date,time,now))throw new HttpError(409,'Changes and cancellations require at least 3 days (72 hours) before the original appointment. Contact support for assistance.');
}

export function assertRescheduleDate(date,time,now=new Date()) {
  if(!isCalendarDate(date))throw new HttpError(400,'Choose a valid service date.');
  if(!isWeekday(date))throw new HttpError(400,'We are closed on Saturdays and Sundays. Choose a weekday.');
  if(!canChangeAppointment(date,time,now))throw new HttpError(400,'Choose a new appointment at least 3 days (72 hours) from now.');
}
