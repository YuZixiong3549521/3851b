import express from 'express';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { AppError } from './inventory.mjs';
import { lockCustomer, assertAddressBookingLimit, resolveBookingSelection, restoreMembershipVisit, attachBookingSelections,getBookingOptions,bookingIncludesCleaning } from './customer/booking-options.mjs';
import { writeSelectedBookings,describeCreatedBooking } from './customer/booking-writer.mjs';
import { assertAnnualRescheduleWindow } from './customer/annual-bookings.mjs';
import { isCalendarDate,assertChangeNotice,assertRescheduleDate } from './customer/booking-schedule.mjs';
import { addressLineSchema,findOrCreateServiceAddress,addressUnitIds } from './customer/address-service.mjs';
import { assertTeamCapacity,lockServiceDates,bookingServiceSlot } from './scheduling.mjs';
import {bookingExpiryDate,assertBookingNotExpired} from './order-expiry.mjs';
import { acceptStaffInvitation,validateStaffInvitation } from './staff-invitations.mjs';

export const offers = [
 ['Air Conditioning Cleaning',65,45],['Regular Maintenance',85,55],
 ['Air Conditioning Repair',120,0],['General Inspection / Diagnostic',50,0],
 ['3-Unit Bundle Deal ($50 Off)',145,35],['Annual Maintenance Contract',240,80],
];
const times=['09:00 AM - 11:00 AM','11:30 AM - 01:30 PM','02:00 PM - 04:00 PM','04:30 PM - 06:30 PM','11:00 AM - 01:00 PM','04:00 PM - 06:00 PM','09:00 - 11:00','11:00 - 13:00','14:00 - 16:00','16:00 - 18:00'];
// Calendar validity is stable. Lead time and weekdays are checked only for new
// writes, after looking up an owned request ID, so an old receipt remains retriable.
const date=z.string().refine(isCalendarDate,'Choose a valid service date.');
export async function sessionUser(pool,req,role) {
 const id=req.session.portalUser?.id;
 if(!id) throw new AppError('Please sign in to continue.',401);
 const [[user]]=await pool.execute(`SELECT u.user_id AS id,u.full_name AS name,u.full_name AS fullName,u.email,u.phone,r.role_name AS role,
 p.property_type AS propertyType,a.access_level AS accessLevel
 FROM user_account u JOIN role r ON r.role_id=u.role_id LEFT JOIN web_customer_profile p ON p.user_id=u.user_id
 LEFT JOIN admin_profile a ON a.user_id=u.user_id WHERE u.user_id=? AND u.status='Active'`,[id]);
 if(!user || (role && user.role!==role)) throw new AppError('This account cannot access this portal.',403);
 return user;
}
export async function createPublicBooking(pool,user,input,{legacy=false}={}) {
 const data=z.object({expectedUserId:z.coerce.number().int().positive().optional(),serviceType:z.string().min(1).max(120).optional(),serviceId:z.coerce.number().int().positive().optional(),serviceIds:z.array(z.coerce.number().int().positive()).min(1).max(10).optional(),packageId:z.coerce.number().int().positive().optional(),propertyType:z.string().trim().max(40).optional(),postalCode:z.string().trim().regex(/^\d{6}$/).optional(),subscriptionId:z.coerce.number().int().positive().optional(),servicePackage:z.string().max(120).optional(),numberOfUnits:z.coerce.number().int().min(1).max(10),preferredDate:legacy?z.string():date,timeWindow:legacy?z.string():z.enum(times),serviceAddress:addressLineSchema,addressId:z.coerce.number().int().positive().optional(),phone:z.string().max(30).optional(),symptoms:z.string().max(1000).optional(),specialNotes:z.string().max(1000).optional(),requestId:z.uuid().optional()}).parse(input);
 if(data.expectedUserId !== undefined && data.expectedUserId !== Number(user.id))throw new AppError('Your signed-in account changed. Reload before booking.',409);
 const conn=await pool.getConnection();
 try {
  await conn.beginTransaction();
  const customer=await lockCustomer(conn,user.id);
  if(data.requestId){const [[existing]]=await conn.execute('SELECT b.booking_id FROM web_booking_details d JOIN booking b ON b.booking_id=d.booking_id WHERE d.request_id=? AND b.customer_id=?',[data.requestId,customer.customerId]);if(existing){const booking=await describeCreatedBooking(conn,existing.booking_id);await conn.commit();return {...booking,id:booking.bookingId};}}
  const selection=await resolveBookingSelection(conn,customer.customerId,data,data.numberOfUnits,{legacy});
  const address=await findOrCreateServiceAddress(conn,customer.customerId,data.serviceAddress,{addressId:data.addressId,postalCode:data.postalCode,verifyPostalCode:true});
  const unitIds=await addressUnitIds(conn,customer.customerId,address.addressId,data.numberOfUnits);
  const booking=await writeSelectedBookings(conn,selection,{customerId:customer.customerId,userId:user.id,addressId:address.addressId,addressLine:address.addressLine,
    unitIds,preferredDate:data.preferredDate,timeSlot:data.timeWindow,
    problemDescription:data.symptoms,phone:data.phone||user.phone,specialNotes:data.specialNotes,servicePackage:data.servicePackage,requestId:data.requestId,legacy,source:'Created from AC Care website.'});
  await conn.commit();return {...booking,id:booking.bookingId};
 }catch(e){await conn.rollback();throw e;}finally{conn.release();}
}
export async function changePublicBooking(pool,user,id,action,input){
 const bookingId=z.coerce.number().int().positive().parse(id);
 const patch=action==='reschedule'?z.object({preferredDate:date,timeWindow:z.enum(times)}).parse(input):z.object({status:z.literal('Cancelled')}).parse(input);
 const c=await pool.getConnection();
 try{await c.beginTransaction();const customer=await lockCustomer(c,user.id);
 const [[b]]=await c.execute('SELECT * FROM booking WHERE booking_id=? AND customer_id=? FOR UPDATE',[bookingId,customer.customerId]);
 if(!b)throw new AppError('Booking not found.',404);
 // Exact no-ops safely recover a lost response, even after later assignment.
 // They never create another change request or status-history entry.
 const unchanged=action==='reschedule'
  ? String(b.preferred_service_date).slice(0,10)===patch.preferredDate&&b.preferred_time_slot===patch.timeWindow
  : b.booking_status==='Cancelled';
 if(unchanged){await c.commit();return {success:true};}
 await assertBookingNotExpired(c,b);
 if(!['Submitted','Confirmed','Assigned'].includes(b.booking_status))throw new AppError('This booking can no longer be changed. Please contact the service team.',409);
 assertChangeNotice(b.preferred_service_date,b.slot_start||'09:00:00');
 const slot=action==='reschedule'?bookingServiceSlot(patch.timeWindow,b.estimated_duration_minutes):null;
 if(action==='reschedule') {
  assertRescheduleDate(patch.preferredDate,slot.start);
  await assertAnnualRescheduleWindow(c,bookingId,patch.preferredDate);
  const [[address]]=await c.execute('SELECT address_line FROM service_address WHERE address_id=?',[b.address_id]);
  await assertAddressBookingLimit(c,customer.customerId,address.address_line,patch.preferredDate,bookingId,{includesCleaning:await bookingIncludesCleaning(c,bookingId)});
  if(b.subscription_id){const [[subscription]]=await c.execute('SELECT start_date,end_date,subscription_status FROM customer_subscription WHERE subscription_id=? AND customer_id=? FOR UPDATE',[b.subscription_id,customer.customerId]);if(!subscription||subscription.subscription_status!=='Active'||patch.preferredDate<String(subscription.start_date).slice(0,10)||patch.preferredDate>String(subscription.end_date).slice(0,10))throw new AppError('Choose a date within your active membership period.',409);}
 }
 await lockServiceDates(c,[b.preferred_service_date,...(action==='reschedule'?[patch.preferredDate]:[])]);
 if(action==='reschedule')await assertTeamCapacity(c,[{date:patch.preferredDate,start:slot.start,end:slot.end}],{excludeBookingId:bookingId});
 const [work]=await c.execute(`SELECT w.job_id,w.current_status,sr.started_at,
   EXISTS(SELECT 1 FROM inventory_transaction it WHERE it.job_id=w.job_id) AS hasInventoryActivity
   FROM work_order w LEFT JOIN service_report sr ON sr.job_id=w.job_id WHERE w.booking_id=? ORDER BY w.job_id FOR UPDATE`,[bookingId]);
 if(work.some(job=>job.started_at||['In Progress','Completed'].includes(job.current_status)))throw new AppError('Service has already started. Contact the service team to arrange changes.',409);
 if(work.some(job=>job.hasInventoryActivity))throw new AppError('Parts have already been issued for this visit. Contact support so the team can safely rearrange the work and inventory.',409);
 await c.execute("UPDATE assignment SET assignment_status='Cancelled' WHERE booking_id=? AND assignment_status NOT IN ('Declined','Reassigned','Cancelled','Completed')",[bookingId]);
 await c.execute("UPDATE work_order SET current_status='Cancelled' WHERE booking_id=? AND current_status NOT IN ('Completed','Cancelled')",[bookingId]);
 if(action==='reschedule') {
  await c.execute("UPDATE booking SET preferred_service_date=?,preferred_time_slot=?,slot_start=?,slot_end=?,booking_status='Submitted',expires_at=? WHERE booking_id=?",[patch.preferredDate,patch.timeWindow,slot.start,slot.end,bookingExpiryDate(),bookingId]);
  await c.execute('UPDATE annual_booking_visit SET scheduled_date=? WHERE booking_id=?',[patch.preferredDate,bookingId]);
 } else {
  await c.execute("UPDATE booking SET booking_status='Cancelled',expires_at=NULL WHERE booking_id=?",[bookingId]);
  await restoreMembershipVisit(c,bookingId);
 }
 await c.execute('INSERT INTO booking_change_request(booking_id,request_type,requested_service_date,requested_time_slot,reason,request_status) VALUES (?,?,?,?,?,?)',[bookingId,action==='reschedule'?'Reschedule':'Cancel',patch.preferredDate||null,patch.timeWindow||null,'Customer self-service with at least 72 hours notice','Approved']);
 const oldServiceTime=b.slot_start&&b.slot_end?`${String(b.slot_start).slice(0,5)} - ${String(b.slot_end).slice(0,5)}`:b.preferred_time_slot;
 const newServiceTime=slot?`${slot.start.slice(0,5)} - ${slot.end.slice(0,5)}`:null;
 await c.execute('INSERT INTO booking_status_history(booking_id,old_status,new_status,changed_by_user_id,change_note) VALUES (?,?,?,?,?)',[bookingId,b.booking_status,action==='reschedule'?'Submitted':'Cancelled',user.id,action==='reschedule'?'Customer rescheduled from '+String(b.preferred_service_date).slice(0,10)+' '+oldServiceTime+' to '+patch.preferredDate+' '+newServiceTime+' (Singapore time). Previous assignment released; awaiting confirmation.':'Customer cancelled with at least 72 hours notice. Previous assignment released.']);
 await c.commit();return {success:true};
 }catch(e){await c.rollback();throw e;}finally{c.release();}
}
export function createPublicRouter(pool){
 const r=express.Router();
 const limiter=rateLimit({windowMs:15*60*1000,limit:30,standardHeaders:true,legacyHeaders:false});
 r.get('/session',async(req,res)=>res.json({success:true,user:req.session.portalUser?await sessionUser(pool,req):null}));
 r.post('/register',limiter,async(req,res)=>{
  const d=z.object({fullName:z.string().trim().min(1).max(120),email:z.email().max(255),phone:z.string().trim().min(3).max(30),propertyType:z.string().max(120).optional(),password:z.string().min(8).max(72),confirmPassword:z.string()}).refine(v=>v.password===v.confirmPassword,'Passwords do not match.').parse(req.body);
  const hash=await bcrypt.hash(d.password,12),c=await pool.getConnection();
  try{await c.beginTransaction();const [[role]]=await c.query("SELECT role_id FROM role WHERE role_name='Customer'");const [row]=await c.execute('INSERT INTO user_account(role_id,full_name,email,password_hash,phone) VALUES (?,?,?,?,?)',[role.role_id,d.fullName,d.email.toLowerCase(),hash,d.phone]);await c.execute('INSERT INTO customer(user_id) VALUES (?)',[row.insertId]);await c.execute('INSERT INTO web_customer_profile(user_id,property_type) VALUES (?,?)',[row.insertId,d.propertyType||null]);await c.commit();res.status(201).json({success:true,user:{id:row.insertId,fullName:d.fullName,email:d.email}});}catch(e){await c.rollback();if(e.code==='ER_DUP_ENTRY')throw new AppError('An account with this email already exists.',409);throw e;}finally{c.release();}
 });
 r.post('/login',limiter,async(req,res)=>{
  const d=z.object({email:z.email().max(255),password:z.string().min(1).max(72),rememberMe:z.boolean().optional()}).parse(req.body);
  const [[row]]=await pool.execute('SELECT u.user_id,u.password_hash,u.status,r.role_name FROM user_account u JOIN role r ON r.role_id=u.role_id WHERE u.email=?',[d.email.toLowerCase()]);
  const valid=await bcrypt.compare(d.password,row?.password_hash||'$2a$10$ttwWVXZBWjxwxQUWgS.fj.X0q3rUNeqCWeyeCNbXNKUBZeHEpR/B.');
  if(!row||!valid||row.status!=='Active')throw new AppError('Incorrect email or password.',401);
  await new Promise((resolve,reject)=>req.session.regenerate(e=>e?reject(e):resolve()));
  req.session.portalUser={id:row.user_id};req.session.csrf=randomBytes(24).toString('hex');
  req.session.cookie.maxAge=d.rememberMe?7*86400000:8*3600000;
  const user=await sessionUser(pool,req);if(user.role==='Admin')req.session.user={user_id:user.id,full_name:user.name,email:user.email};
  res.json({success:true,user,csrf:req.session.csrf});
 });
 r.post('/logout',(req,res,next)=>req.session.destroy(e=>e?next(e):res.clearCookie('coolcare.sid').json({success:true})));
 r.post('/staff-invitations/validate',limiter,async(req,res)=>res.json({success:true,invitation:await validateStaffInvitation(pool,req.body?.token)}));
 r.post('/staff-invitations/accept',limiter,async(req,res)=>res.json(await acceptStaffInvitation(pool,req,req.body)));
 r.get('/offers',async(_req,res)=>{const options=await getBookingOptions(pool);res.json({currency:'SGD',offers:[...options.services.map(service=>({name:service.name,base:service.basePrice,perUnit:service.additionalUnitPrice,serviceId:service.serviceId,code:service.code,pricingNote:service.pricingNote,durationMinutes:service.durationMinutes,durationPerUnit:Boolean(service.durationPerUnit),durationMinutesPerUnit:service.durationMinutesPerUnit,minimumDurationMinutes:service.minimumDurationMinutes})),...options.bundles.map(bundle=>({name:bundle.name,base:bundle.price,perUnit:bundle.additionalUnitPrice,packageId:bundle.packageId,serviceIds:bundle.serviceIds,includedVisits:bundle.includedVisits,includedUnits:bundle.includedUnits,code:bundle.code,pricingNote:bundle.pricingNote,propertyPrices:bundle.propertyPrices}))]});});
 r.use(async(req,_res,next)=>{req.customerUser=await sessionUser(pool,req,'Customer');next();});
 r.get('/bookings/user/:userId',async(req,res)=>{
  if(String(req.customerUser.id)!==req.params.userId)throw new AppError('Booking access denied.',403);
  const [bookings]=await pool.execute(`SELECT b.booking_id AS id,c.user_id,sc.service_name AS service_type,COALESCE(d.service_package,sc.service_name) AS service_package,
   (SELECT COUNT(*) FROM booking_aircon_unit bu WHERE bu.booking_id=b.booking_id) AS number_of_units,
   b.preferred_service_date AS preferred_date,b.preferred_time_slot AS time_window,sa.address_line AS service_address,
   b.problem_description AS symptoms,d.special_notes,b.booking_status,b.created_at,b.total_amount
   FROM booking b JOIN customer c ON c.customer_id=b.customer_id JOIN service_catalog sc ON sc.service_id=b.service_id JOIN service_address sa ON sa.address_id=b.address_id LEFT JOIN web_booking_details d ON d.booking_id=b.booking_id WHERE c.user_id=? ORDER BY b.created_at DESC,b.booking_id DESC`,[req.customerUser.id]);res.json({success:true,bookings:await attachBookingSelections(pool,bookings,'id')});
 });
 r.post('/bookings',async(req,res)=>res.status(201).json({success:true,booking:await createPublicBooking(pool,req.customerUser,req.body)}));
 r.patch('/bookings/:id/status',async(req,res)=>res.json(await changePublicBooking(pool,req.customerUser,req.params.id,'cancel',req.body)));
 r.patch('/bookings/:id/reschedule',async(req,res)=>res.json(await changePublicBooking(pool,req.customerUser,req.params.id,'reschedule',req.body)));
 r.use((error,_req,res,_next)=>{const status=error.status|| (error instanceof z.ZodError?400:500);res.status(status).json({success:false,message:status===500?'The service is temporarily unavailable.':error.message});});
 return r;
}
