import { HttpError } from './errors.mjs';
import { isCalendarDate,nextWeekday } from './booking-schedule.mjs';

// Each anniversary uses the original day, so Jan 31 -> Apr 30 -> Jul 31.
export function addCalendarMonths(dateText, months) {
  const [year,month,day]=dateText.split('-').map(Number);
  const first=new Date(Date.UTC(year,month-1+months,1));
  const last=new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth()+1,0)).getUTCDate();
  return `${first.getUTCFullYear()}-${String(first.getUTCMonth()+1).padStart(2,'0')}-${String(Math.min(day,last)).padStart(2,'0')}`;
}

export function annualVisitSchedule(firstDate,totalAmount) {
  if(!isCalendarDate(firstDate))throw new HttpError(400,'Choose a valid first service date.');
  const cents=Math.round(Number(totalAmount)*100);
  const perVisit=Math.floor(cents/4);
  const visits=Array.from({length:4},(_,index)=>({
    visitNumber:index+1,
    preferredDate:addCalendarMonths(firstDate,index*3),
    windowStart:addCalendarMonths(firstDate,index*3),
    windowEnd:addCalendarMonths(firstDate,(index+1)*3),
    totalAmount:(index===3?cents-perVisit*3:perVisit)/100,
  }));
  if(visits.some(visit=>![visit.preferredDate,visit.windowStart,visit.windowEnd].every(value=>/^\d{4}-\d{2}-\d{2}$/.test(value)))) {
    throw new HttpError(400,'Choose a first date whose four quarterly visits and final quarterly window fit within the supported calendar.');
  }
  // Keep the chosen first date and original quarter boundaries. Later anniversaries
  // that fall on a closed weekend move to the following Monday within that quarter.
  for(const visit of visits) {
    if(visit.visitNumber>1)visit.preferredDate=nextWeekday(visit.preferredDate);
    if(!isCalendarDate(visit.preferredDate)||visit.preferredDate<visit.windowStart||visit.preferredDate>=visit.windowEnd) {
      throw new HttpError(400,'The annual visit dates must fit within their quarterly windows. Choose another first date.');
    }
  }
  return visits;
}

export async function attachAnnualBundles(executor,bookings,idKey='bookingId') {
  if(!bookings.length)return bookings;
  const ids=bookings.map(b=>b[idKey]);
  const [links]=await executor.execute(`SELECT v.booking_id AS bookingId,v.series_id AS seriesId,v.visit_number AS visitNumber,
    v.window_start AS windowStart,v.window_end AS windowEnd,s.package_name AS name,s.total_amount AS totalAmount,
    s.first_service_date AS firstServiceDate FROM annual_booking_visit v JOIN annual_booking_series s ON s.series_id=v.series_id
    WHERE v.booking_id IN (${ids.map(()=>'?').join(',')})`,ids);
  if(!links.length)return bookings.map(b=>({...b,annualBundle:null}));
  const seriesIds=[...new Set(links.map(v=>v.seriesId))];
  const [visits]=await executor.execute(`SELECT v.series_id AS seriesId,b.booking_id AS bookingId,v.visit_number AS visitNumber,
    b.preferred_service_date AS preferredDate,b.preferred_time_slot AS timeSlot,b.total_amount AS totalAmount,
    b.booking_status AS status,v.window_start AS windowStart,v.window_end AS windowEnd
    FROM annual_booking_visit v JOIN booking b ON b.booking_id=v.booking_id
    WHERE v.series_id IN (${seriesIds.map(()=>'?').join(',')}) ORDER BY v.visit_number`,seriesIds);
  return bookings.map(booking=>{
    const link=links.find(v=>v.bookingId===booking[idKey]);
    return {...booking,annualBundle:link?{...link,totalAmount:Number(link.totalAmount),visits:visits.filter(v=>v.seriesId===link.seriesId).map(v=>({...v,totalAmount:Number(v.totalAmount)}))}:null};
  });
}

export async function assertAnnualRescheduleWindow(connection,bookingId,preferredDate) {
  const [[visit]]=await connection.execute('SELECT visit_number,window_start,window_end FROM annual_booking_visit WHERE booking_id=?',[bookingId]);
  if(visit && (preferredDate<String(visit.window_start).slice(0,10)||preferredDate>=String(visit.window_end).slice(0,10))) {
    throw new HttpError(409,`Visit ${visit.visit_number} must stay within its quarterly window (${visit.window_start} to before ${visit.window_end}).`);
  }
}
