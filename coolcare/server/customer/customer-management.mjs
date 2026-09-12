import { z } from 'zod';
import { HttpError } from './errors.mjs';
import { getDemoCustomer } from './customer.mjs';
import { lockCustomer,normalizeAddress,exceedsWeeklyLimit } from './booking-options.mjs';
import { isCalendarDate,addCalendarDays,minimumBookingDate,nextWeekday,isWeekday,BOOKING_TIME_ZONE } from './booking-schedule.mjs';
import { addressLineSchema } from './address-service.mjs';

export async function updateCustomerProfile(pool,userId,untrustedInput) {
  const parsed=z.object({fullName:z.string().trim().min(1).max(120),phone:z.string().trim().max(30).refine(value=>value===''||value.length>=3,'Enter a valid phone number.').nullable(),expectedUserId:z.coerce.number().int().positive().optional()}).strict().safeParse(untrustedInput);
  if(!parsed.success)throw new HttpError(400,'Please check your name and phone number. Your email cannot be changed here.',z.flattenError(parsed.error).fieldErrors);
  if(parsed.data.expectedUserId!==undefined&&parsed.data.expectedUserId!==Number(userId))throw new HttpError(409,'Your signed-in account changed. Reload before updating your profile.');
  const c=await pool.getConnection();
  try {
    await c.beginTransaction();
    await lockCustomer(c,userId);
    await c.execute('UPDATE user_account SET full_name=?,phone=? WHERE user_id=? AND status=\'Active\'',
      [parsed.data.fullName,parsed.data.phone||null,userId]);
    const customer=await getDemoCustomer(c,userId);
    await c.commit();
    return customer;
  }catch(error){await c.rollback();throw error;}finally{c.release();}
}

const calendar=z.string().refine(isCalendarDate);
const availabilitySchema=z.object({serviceAddress:addressLineSchema.optional(),addressId:z.coerce.number().int().positive().optional(),
  from:calendar,to:calendar,excludeBookingId:z.coerce.number().int().positive().optional()});

export async function getBookingAvailability(pool,userId,untrustedInput) {
  const parsed=availabilitySchema.safeParse(untrustedInput);
  if(!parsed.success)throw new HttpError(400,'Choose a valid address and calendar range.');
  const input=parsed.data;
  // MySQL DATE and the six surrounding quota days must stay within bounds.
  if(input.from<'1000-01-07'||input.to>'9999-12-25')throw new HttpError(400,'Choose a valid calendar range.');
  if(input.to<input.from||input.to>addCalendarDays(input.from,61))throw new HttpError(400,'Request at most 62 calendar days at a time.');
  const customer=await getDemoCustomer(pool,userId);
  let addressLine=input.serviceAddress;
  let excluded;
  if(input.excludeBookingId) {
    const [[owned]]=await pool.execute('SELECT booking_id,address_id FROM booking WHERE booking_id=? AND customer_id=?',[input.excludeBookingId,customer.customerId]);
    if(!owned)throw new HttpError(404,'Booking not found.');
    excluded=owned;
  }
  if(input.addressId) {
    const [[owned]]=await pool.execute('SELECT address_line,is_archived FROM service_address WHERE address_id=? AND customer_id=?',[input.addressId,customer.customerId]);
    // A saved location may be archived while its historical booking is still
    // eligible for rescheduling. Only that owned booking may use the archive.
    if(!owned||(owned.is_archived&&excluded?.address_id!==input.addressId))throw new HttpError(404,'Address not found.');
    if(addressLine&&normalizeAddress(addressLine)!==normalizeAddress(owned.address_line))throw new HttpError(400,'The selected address does not match the service address.');
    addressLine=owned.address_line;
  }
  let existingBookings=[];
  if(addressLine) {
    const [rows]=await pool.execute(`SELECT b.booking_id AS bookingId,b.preferred_service_date AS preferredDate,
      b.preferred_time_slot AS timeSlot,b.booking_status AS status,sa.address_line AS addressLine
      FROM booking b JOIN service_address sa ON sa.address_id=b.address_id
      WHERE b.customer_id=? AND b.booking_status<>'Cancelled' AND b.booking_id<>?
      AND b.preferred_service_date BETWEEN ? AND ? ORDER BY b.preferred_service_date,b.booking_id`,
      [customer.customerId,input.excludeBookingId??0,addCalendarDays(input.from,-6),addCalendarDays(input.to,6)]);
    existingBookings=rows.filter(row=>normalizeAddress(row.addressLine)===normalizeAddress(addressLine)).map(({addressLine,...booking})=>booking);
  }
  const earliestDate=nextWeekday(minimumBookingDate());
  const existingDates=existingBookings.map(booking=>booking.preferredDate);
  const blockedDates=[];
  for(let date=input.from;date<=input.to;date=addCalendarDays(date,1)) {
    if(date<earliestDate||!isWeekday(date)||exceedsWeeklyLimit(existingDates,date))blockedDates.push(date);
  }
  return {blockedDates,existingBookings,earliestDate,timeZone:BOOKING_TIME_ZONE};
}
