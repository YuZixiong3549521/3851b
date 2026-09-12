import express from 'express';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { AppError } from './inventory.mjs';
import { lockCustomer, assertAddressBookingLimit, resolveBookingSelection, restoreMembershipVisit, attachBookingSelections,getBookingOptions } from './customer/booking-options.mjs';
import { writeSelectedBookings,describeCreatedBooking } from './customer/booking-writer.mjs';
import { assertAnnualRescheduleWindow } from './customer/annual-bookings.mjs';
import { isCalendarDate,assertBookableDate } from './customer/booking-schedule.mjs';
import { addressLineSchema,findOrCreateServiceAddress,addressUnitIds } from './customer/address-service.mjs';

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
 const [[user]]=await pool.execute(`SELECT u.user_id AS id,u.full_name AS name,u.full_name AS fullName,u.email,u.phone,r.role_name AS role,p.property_type AS propertyType
 FROM user_account u JOIN role r ON r.role_id=u.role_id LEFT JOIN web_customer_profile p ON p.user_id=u.user_id WHERE u.user_id=? AND u.status='Active'`,[id]);
 if(!user || (role && user.role!==role)) throw new AppError('This account cannot access this portal.',403);
 return user;
}
export async function createPublicBooking(pool,user,input,{legacy=false}={}) {
 const data=z.object({expectedUserId:z.coerce.number().int().positive().optional(),serviceType:z.string().min(1).max(120).optional(),serviceId:z.coerce.number().int().positive().optional(),serviceIds:z.array(z.coerce.number().int().positive()).min(1).max(10).optional(),packageId:z.coerce.number().int().positive().optional(),subscriptionId:z.coerce.number().int().positive().optional(),servicePackage:z.string().max(120).optional(),numberOfUnits:z.coerce.number().int().min(1).max(10),preferredDate:legacy?z.string():date,timeWindow:legacy?z.string():z.enum(times),serviceAddress:addressLineSchema,addressId:z.coerce.number().int().positive().optional(),phone:z.string().max(30).optional(),symptoms:z.string().max(1000).optional(),specialNotes:z.string().max(1000).optional(),requestId:z.uuid().optional()}).parse(input);
 if(data.expectedUserId !== undefined && data.expectedUserId !== Number(user.id))throw new AppError('Your signed-in account changed. Reload before booking.',409);
 const conn=await pool.getConnection();
 try {
  await conn.beginTransaction();
  const customer=await lockCustomer(conn,user.id);
  if(data.requestId){const [[existing]]=await conn.execute('SELECT b.booking_id FROM web_booking_details d JOIN booking b ON b.booking_id=d.booking_id WHERE d.request_id=? AND b.customer_id=?',[data.requestId,customer.customerId]);if(existing){const booking=await describeCreatedBooking(conn,existing.booking_id,{legacy});await conn.commit();return {...booking,id:booking.bookingId};}}
  const selection=await resolveBookingSelection(conn,customer.customerId,data,data.numberOfUnits,{legacy});
  const address=await findOrCreateServiceAddress(conn,customer.customerId,data.serviceAddress,{addressId:data.addressId});
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
 const [[assigned]]=await c.execute('SELECT COUNT(*) AS count FROM assignment WHERE booking_id=?',[bookingId]);
 if(b.booking_status!=='Submitted'||assigned.count>0)throw new AppError('Only unassigned, submitted bookings can be changed. Please contact the service team.',409);
 if(action==='reschedule'){
  assertBookableDate(patch.preferredDate);
  await assertAnnualRescheduleWindow(c,bookingId,patch.preferredDate);
  const [[address]]=await c.execute('SELECT address_line FROM service_address WHERE address_id=?',[b.address_id]);
  await assertAddressBookingLimit(c,customer.customerId,address.address_line,patch.preferredDate,bookingId);
  if(b.subscription_id){const [[subscription]]=await c.execute('SELECT start_date,end_date,subscription_status FROM customer_subscription WHERE subscription_id=? AND customer_id=? FOR UPDATE',[b.subscription_id,customer.customerId]);if(!subscription||subscription.subscription_status!=='Active'||patch.preferredDate<String(subscription.start_date).slice(0,10)||patch.preferredDate>String(subscription.end_date).slice(0,10))throw new AppError('Choose a date within your active membership period.',409);}
  await c.execute('UPDATE booking SET preferred_service_date=?,preferred_time_slot=? WHERE booking_id=?',[patch.preferredDate,patch.timeWindow,bookingId]);
 }
 else {await c.execute("UPDATE booking SET booking_status='Cancelled' WHERE booking_id=?",[bookingId]);await restoreMembershipVisit(c,bookingId);}
 await c.execute('INSERT INTO booking_change_request(booking_id,request_type,requested_service_date,requested_time_slot,reason,request_status) VALUES (?,?,?,?,?,?)',[bookingId,action==='reschedule'?'Reschedule':'Cancel',patch.preferredDate||null,patch.timeWindow||null,'Customer self-service before assignment','Approved']);
 await c.execute('INSERT INTO booking_status_history(booking_id,old_status,new_status,changed_by_user_id,change_note) VALUES (?,?,?,?,?)',[bookingId,b.booking_status,action==='reschedule'?b.booking_status:'Cancelled',user.id,action==='reschedule'?'Customer rescheduled before assignment.':'Customer cancelled before assignment.']);
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
 r.get('/offers',async(_req,res)=>{const options=await getBookingOptions(pool);res.json({currency:'SGD',offers:[...options.services.map(service=>({name:service.name,base:service.basePrice,perUnit:service.additionalUnitPrice,serviceId:service.serviceId,code:service.code,pricingNote:service.pricingNote})),...options.bundles.map(bundle=>({name:bundle.name,base:bundle.price,perUnit:bundle.additionalUnitPrice,packageId:bundle.packageId,serviceIds:bundle.serviceIds,includedVisits:bundle.includedVisits,code:bundle.code,pricingNote:bundle.pricingNote}))]});});
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
