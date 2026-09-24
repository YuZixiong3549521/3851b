import test from 'node:test';
import assert from 'node:assert/strict';
import {singaporeToday,minimumBookingDate,assertBookableDate,nextWeekday,isWeekday,isCalendarDate,addCalendarDays,assertChangeNotice,assertRescheduleDate} from './booking-schedule.mjs';
import {bookingServiceSlot} from '../scheduling.mjs';

test('lead time uses Singapore calendar dates at the UTC midnight boundary',()=>{
  const before=new Date('2026-09-14T15:59:59Z');
  const after=new Date('2026-09-14T16:00:00Z');
  assert.equal(singaporeToday(before),'2026-09-14');assert.equal(singaporeToday(after),'2026-09-15');
  assert.equal(minimumBookingDate(before),'2026-09-28');assert.equal(minimumBookingDate(after),'2026-09-29');
  assert.doesNotThrow(()=>assertBookableDate('2026-09-28',before));
  assert.throws(()=>assertBookableDate('2026-09-28',after),error=>error.status===400&&error.message.includes('14 calendar days'));
  assert.equal(minimumBookingDate(new Date('2026-09-14T00:00:00Z')),minimumBookingDate(before));
});

test('change deadline uses exact Singapore appointment time and a 72-hour boundary',()=>{
  const now=new Date('2026-09-14T01:00:00Z');
  assert.doesNotThrow(()=>assertChangeNotice('2026-09-17','09:00:00',now));
  assert.throws(()=>assertChangeNotice('2026-09-17','08:59:59',now),/72 hours/);
  assert.doesNotThrow(()=>assertRescheduleDate('2026-09-17','09:00:00',now));
  assert.throws(()=>assertRescheduleDate('2026-09-19','09:00:00',now),/closed/);
  assert.throws(()=>assertRescheduleDate('2026-09-16','09:00:00',now),/72 hours/);
});

test('unit-scaled duration reserves beyond the arrival window and excludes late finishes',()=>{
  assert.equal(bookingServiceSlot('09:00 - 11:00',45).end,'09:45:00');
  assert.equal(bookingServiceSlot('09:00 - 11:00',225).end,'12:45:00');
  assert.equal(bookingServiceSlot('16:00 - 18:00',120).end,'18:00:00');
  assert.throws(()=>bookingServiceSlot('16:00 - 18:00',135),/after 6:00 PM/);
});

test('booking and rescheduling accept the weekday 14-day boundary but reject weekends and invalid dates',()=>{
  const now=new Date('2026-09-14T04:00:00Z');
  assert.throws(()=>assertBookableDate('2026-09-27',now),error=>error.status===400&&error.message.includes('14 calendar days'));
  assert.doesNotThrow(()=>assertBookableDate('2026-09-28',now));
  for(const closedDate of ['2026-10-03','2026-10-04'])assert.throws(()=>assertBookableDate(closedDate,now),error=>error.status===400&&error.message.includes('closed'));
  assert.equal(nextWeekday('2026-10-03'),'2026-10-05');assert.equal(nextWeekday('2026-10-04'),'2026-10-05');
  assert.equal(nextWeekday('2026-10-05'),'2026-10-05');assert.equal(isWeekday('2026-10-05'),true);
  assert.equal(isCalendarDate('2028-02-29'),true);assert.equal(isCalendarDate('2027-02-29'),false);
  assert.throws(()=>assertBookableDate('2027-02-30',now),error=>error.status===400);
  assert.equal(addCalendarDays('2028-02-28',2),'2028-03-01');
});
