import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import mysql from 'mysql2/promise';
import {createApp} from '../server/app.mjs';
import {createBooking,getBookingDetail,getBookingReport} from '../server/customer/booking-service.mjs';
import {createCustomerAddress,manageCustomerAddress} from '../server/customer/address-service.mjs';
import {getBookingAvailability,updateCustomerProfile} from '../server/customer/customer-management.mjs';
import {getBookingOptions} from '../server/customer/booking-options.mjs';
import {minimumBookingDate,addCalendarDays,singaporeToday} from '../server/customer/booking-schedule.mjs';
import {changePublicBooking} from '../server/public-site.mjs';
import {getOwnedReportPhoto,reportPhotoDirectory} from '../server/customer/report-photos.mjs';
import {openPrivilegedFixtureConnection} from './privileged-fixture.mjs';

const pool=mysql.createPool({host:process.env.DB_HOST,port:Number(process.env.DB_PORT),user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME,dateStrings:true,decimalNumbers:true,connectionLimit:4});
after(()=>pool.end());
const monday=()=>{const date=minimumBookingDate();const weekday=new Date(`${date}T00:00:00Z`).getUTCDay();return addCalendarDays(date,(8-weekday)%7);};

async function fixture(work,{privileged=false}={}) {
  const c=privileged?await openPrivilegedFixtureConnection():await pool.getConnection();await c.beginTransaction();
  const handle={execute:c.execute.bind(c),query:c.query.bind(c),beginTransaction:()=>c.query('SAVEPOINT customer_management'),commit:()=>c.query('RELEASE SAVEPOINT customer_management'),rollback:()=>c.query('ROLLBACK TO SAVEPOINT customer_management'),release:()=>{}};
  const db={execute:c.execute.bind(c),query:c.query.bind(c),getConnection:async()=>handle};
  try {
    const [account]=await c.execute(`INSERT INTO user_account(role_id,full_name,email,password_hash,phone)
      SELECT role_id,'Customer Management Test',?,'unusable-test-password','12345678' FROM role WHERE role_name='Customer'`,[`management-${randomUUID()}@example.test`]);
    const [customer]=await c.execute('INSERT INTO customer(user_id) VALUES (?)',[account.insertId]);
    const options=await getBookingOptions(db);
    const user={id:account.insertId,customerId:customer.insertId};
    const create=(overrides={})=>createBooking(db,{serviceId:options.services[0].serviceId,serviceAddress:'78 Management Test Street #01-02',numberOfUnits:2,preferredDate:monday(),timeSlot:'09:00 - 11:00',requestId:randomUUID(),...overrides},user.id);
    await work(db,c,user,create,options);
  }finally{await c.rollback();if(privileged)await c.end();else c.release();}
}

test('address edits preserve historical bookings and annual locations; archive/default and profile changes remain owned',async()=>fixture(async(db,c,user,create,options)=>{
  const first=await createCustomerAddress(db,user.id,{addressLine:'78 Management Test Street #01-02',postalCode:'012345',label:'Home'});
  const other=await createCustomerAddress(db,user.id,{addressLine:'80 Management Test Street #03-04',label:'Office'});
  const annual=await create({addressId:first.addressId,packageId:options.bundles[0].packageId,serviceId:undefined});
  const detail=await getBookingDetail(db,annual.bookingId,user.id);
  assert.equal(detail.addressId,first.addressId);assert.equal(detail.numberOfUnits,2);assert.equal(detail.canModify,true);assert.equal(detail.statusTimeline.at(-1).status,'Submitted');
  const changed=await manageCustomerAddress(db,user.id,first.addressId,'update',{addressLine:'79 Management Test Street #02-03',postalCode:'012346',label:'New home'});
  assert.notEqual(changed.addressId,first.addressId);assert.equal(changed.isDefault,true);
  assert.deepEqual(await manageCustomerAddress(db,user.id,first.addressId,'update',{addressLine:changed.addressLine,postalCode:changed.postalCode,label:changed.label}),changed,'exact clone retry returns the replacement without cloning twice');
  await assert.rejects(manageCustomerAddress(db,user.id,first.addressId,'update',{addressLine:'Different stale edit Street'}),error=>error.status===409);
  const [[old]]=await c.execute('SELECT address_line,postal_code,is_archived,is_default FROM service_address WHERE address_id=?',[first.addressId]);
  assert.deepEqual(old,{address_line:first.addressLine,postal_code:'012345',is_archived:1,is_default:0});
  const [[series]]=await c.execute('SELECT address_id FROM annual_booking_series WHERE series_id=?',[annual.annualBundle.seriesId]);
  assert.equal(series.address_id,first.addressId);
  assert.equal((await getBookingDetail(db,annual.bookingId,user.id)).addressLine,first.addressLine);
  assert.equal((await createCustomerAddress(db,user.id,{addressLine:changed.addressLine})).addressId,changed.addressId,'retries reuse active replacement');
  await assert.rejects(create({addressId:first.addressId,serviceAddress:first.addressLine}),error=>error.status===400,'archived addresses cannot be used for new bookings');
  await manageCustomerAddress(db,user.id,other.addressId,'default');
  await manageCustomerAddress(db,user.id,other.addressId,'archive');
  assert.deepEqual(await manageCustomerAddress(db,user.id,other.addressId,'archive'),{success:true},'archive retry is safe');
  const [active]=await c.execute('SELECT address_id,is_default FROM service_address WHERE customer_id=? AND is_archived=FALSE',[user.customerId]);
  assert.deepEqual(active,[{address_id:changed.addressId,is_default:1}]);
  const [[foreign]]=await c.execute('SELECT address_id FROM service_address WHERE customer_id<>? LIMIT 1',[user.customerId]);
  for(const action of ['update','default','archive'])await assert.rejects(manageCustomerAddress(db,user.id,foreign.address_id,action,{addressLine:'Cannot change another customer'}),error=>error.status===404);
  const profile=await updateCustomerProfile(db,user.id,{fullName:' Updated Customer ',phone:' 87654321 '});
  assert.equal(profile.fullName,'Updated Customer');assert.equal(profile.phone,'87654321');
  await assert.rejects(updateCustomerProfile(db,user.id,{fullName:'Wrong account draft',phone:'99999999',expectedUserId:user.id+100000}),error=>error.status===409);
  const [[unchangedProfile]]=await c.execute('SELECT full_name,phone FROM user_account WHERE user_id=?',[user.id]);
  assert.deepEqual(unchangedProfile,{full_name:'Updated Customer',phone:'87654321'},'a stale profile form cannot modify a different signed-in account');
  await assert.rejects(updateCustomerProfile(db,user.id,{fullName:'Forbidden',phone:'12345678',email:'replaced@example.test'}),error=>error.status===400);
  const [[stored]]=await c.execute('SELECT full_name,email FROM user_account WHERE user_id=?',[user.id]);
  assert.equal(stored.full_name,'Updated Customer');assert.equal(stored.email,profile.email);
}));

test('availability previews enforce exact rolling seven-day rules, calendar bounds and owned exclusions',async()=>fixture(async(db,c,user,create)=>{
  const first=await create();
  const second=await create({preferredDate:addCalendarDays(monday(),4),serviceAddress:' 78 MANAGEMENT TEST STREET, #01-02 '});
  const input={serviceAddress:'78 Management Test Street #01-02',from:monday(),to:addCalendarDays(monday(),20)};
  const preview=await getBookingAvailability(db,user.id,input);
  assert.equal(preview.timeZone,'Asia/Singapore');assert.equal(preview.existingBookings.length,2);
  assert.ok(preview.blockedDates.includes(addCalendarDays(monday(),2)));
  assert.ok(preview.blockedDates.includes(addCalendarDays(monday(),5)),'Saturday is blocked');
  assert.ok(!preview.blockedDates.includes(addCalendarDays(monday(),11)),'following Friday is outside existing seven-day windows');
  await assert.rejects(create({preferredDate:addCalendarDays(monday(),2)}),error=>error.status===409,'write agrees with preview');
  const own=await getBookingAvailability(db,user.id,{...input,excludeBookingId:first.bookingId});
  assert.equal(own.existingBookings.length,1);assert.ok(!own.blockedDates.includes(addCalendarDays(monday(),2)));
  const [[foreign]]=await c.execute('SELECT booking_id,address_id FROM booking WHERE customer_id<>? LIMIT 1',[user.customerId]);
  await assert.rejects(getBookingAvailability(db,user.id,{...input,excludeBookingId:foreign.booking_id}),error=>error.status===404);
  await assert.rejects(getBookingAvailability(db,user.id,{...input,addressId:foreign.address_id}),error=>error.status===404);
  await assert.rejects(getBookingAvailability(db,user.id,{...input,to:addCalendarDays(input.from,62)}),error=>error.status===400);
  await assert.rejects(getBookingAvailability(db,user.id,{...input,from:'2026-02-30'}),error=>error.status===400);
  await assert.rejects(getBookingAvailability(db,user.id,{from:'9999-11-01',to:'9999-12-31'}),error=>error.status===400,'surrounding quota days cannot overflow the supported calendar');
  const early=await getBookingAvailability(db,user.id,{from:singaporeToday(),to:addCalendarDays(singaporeToday(),13)});
  assert.equal(early.blockedDates.length,14);
  await changePublicBooking(db,user,second.bookingId,'cancel',{status:'Cancelled'});
  const afterCancel=await getBookingAvailability(db,user.id,input);
  assert.equal(afterCancel.existingBookings.length,1);assert.ok(!afterCancel.blockedDates.includes(addCalendarDays(monday(),2)));
  const booking=await getBookingDetail(db,first.bookingId,user.id);
  await manageCustomerAddress(db,user.id,booking.addressId,'archive');
  await assert.rejects(getBookingAvailability(db,user.id,{...input,addressId:booking.addressId}),error=>error.status===404);
  assert.equal((await getBookingAvailability(db,user.id,{...input,addressId:booking.addressId,excludeBookingId:first.bookingId})).existingBookings.length,0,'owned reschedule can preview an archived historical location');
}));

test('customer HTTP management aliases require login, customer ownership and CSRF; detail includes real status changes',async()=>fixture(async(db,c,user,create)=>{
  const booking=await create();
  const [[demo]]=await c.execute("SELECT password_hash FROM user_account WHERE email='alice.tan@coolcare.demo'");
  // Reuse an existing test hash without granting extra writes to password_hash.
  const [httpAccount]=await c.execute(`INSERT INTO user_account(role_id,full_name,email,password_hash,phone)
    SELECT role_id,'HTTP Management Test',?,?,'12345678' FROM role WHERE role_name='Customer'`,[`http-management-${randomUUID()}@example.test`,demo.password_hash]);
  const [[account]]=await c.execute('SELECT email FROM user_account WHERE user_id=?',[httpAccount.insertId]);
  const [httpCustomer]=await c.execute('INSERT INTO customer(user_id) VALUES (?)',[httpAccount.insertId]);
  const httpBooking=await createBooking(db,{serviceId:(await getBookingOptions(db)).services[0].serviceId,serviceAddress:'90 HTTP Management Street',numberOfUnits:1,preferredDate:monday(),timeSlot:'09:00 - 11:00',requestId:randomUUID()},httpAccount.insertId);
  const server=createApp({pool:db,secret:process.env.SESSION_SECRET}).listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  let cookie='',csrf='';
  const request=async(path,method='GET',body)=>{const response=await fetch(`http://127.0.0.1:${server.address().port}${path}`,{method,headers:{Cookie:cookie,'X-CSRF-Token':csrf,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];return response;};
  try {
    assert.equal((await request(`/api/customer/bookings/${httpBooking.bookingId}`)).status,401);
    csrf=(await(await request('/api/session')).json()).csrf;
    const login=await(await request('/api/public/login','POST',{email:account.email,password:'CoolCareDemo2026!'})).json();csrf=login.csrf;
    assert.equal((await request(`/api/customer/bookings/${booking.bookingId}`)).status,404);
    assert.equal((await request(`/api/customer/bookings/${booking.bookingId}/status`,'PATCH',{status:'Cancelled'})).status,404);
    const detail=(await(await request(`/api/customer/bookings/${httpBooking.bookingId}`)).json()).booking;assert.equal(detail.canModify,true);
    const validCsrf=csrf;csrf='wrong';
    for(const [path,method,body] of [[`/bookings/${httpBooking.bookingId}/status`,'PATCH',{status:'Cancelled'}],['/profile','PATCH',{fullName:'Wrong token',phone:'12345678'}],[`/addresses/${detail.addressId}`,'DELETE',undefined]])assert.equal((await request('/api/customer'+path,method,body)).status,403);
    csrf=validCsrf;
    assert.equal((await request('/api/customer/profile','PATCH',{fullName:'HTTP Updated',phone:'87654321'})).status,200);
    const session=(await(await request('/api/public/session')).json()).user;assert.equal(session.name,'HTTP Updated');
    assert.equal((await request(`/api/customer/bookings/${httpBooking.bookingId}/reschedule`,'PATCH',{preferredDate:addCalendarDays(monday(),1),timeWindow:'11:00 - 13:00'})).status,200);
    const revised=(await(await request(`/api/customer/bookings/${httpBooking.bookingId}`)).json()).booking;
    assert.equal(revised.preferredDate,addCalendarDays(monday(),1));assert.match(revised.statusTimeline.at(-1).remarks,/rescheduled/);
    const auditCount=async id=>(await c.execute(`SELECT (SELECT COUNT(*) FROM booking_status_history WHERE booking_id=?) AS history,
      (SELECT COUNT(*) FROM booking_change_request WHERE booking_id=?) AS changes`,[id,id]))[0][0];
    const rescheduleAudit=await auditCount(httpBooking.bookingId);
    assert.equal((await request(`/api/customer/bookings/${httpBooking.bookingId}/reschedule`,'PATCH',{preferredDate:revised.preferredDate,timeWindow:revised.timeSlot})).status,200);
    assert.deepEqual(await auditCount(httpBooking.bookingId),rescheduleAudit,'an identical reschedule retry adds no audit entries');
    assert.equal((await request(`/api/customer/bookings/${httpBooking.bookingId}/status`,'PATCH',{status:'Cancelled'})).status,200);
    const cancelled=(await(await request(`/api/customer/bookings/${httpBooking.bookingId}`)).json()).booking;
    assert.equal(cancelled.canModify,false);assert.equal(cancelled.statusTimeline.at(-1).status,'Cancelled');
    const cancelAudit=await auditCount(httpBooking.bookingId);
    assert.equal((await request(`/api/customer/bookings/${httpBooking.bookingId}/status`,'PATCH',{status:'Cancelled'})).status,200);
    assert.equal((await request(`/api/customer/bookings/${httpBooking.bookingId}/reschedule`,'PATCH',{preferredDate:revised.preferredDate,timeWindow:revised.timeSlot})).status,200,'an exact schedule retry after cancellation is still a no-op');
    assert.deepEqual(await auditCount(httpBooking.bookingId),cancelAudit,'an identical cancellation retry adds no audit entries');
    assert.equal((await request(`/api/customer/bookings/${httpBooking.bookingId}/reschedule`,'PATCH',{preferredDate:addCalendarDays(monday(),2),timeWindow:'11:00 - 13:00'})).status,409);
    const [[assigned]]=await c.execute(`SELECT b.booking_id,c.user_id FROM booking b JOIN customer c ON c.customer_id=b.customer_id JOIN assignment a ON a.booking_id=b.booking_id LIMIT 1`);
    assert.equal((await getBookingDetail(db,assigned.booking_id,assigned.user_id)).canModify,false);
    const [restricted]=await c.execute(`SELECT b.booking_id,c.user_id,b.preferred_service_date,b.preferred_time_slot
      FROM booking b JOIN customer c ON c.customer_id=b.customer_id WHERE b.booking_status IN ('Assigned','Completed')`);
    assert.ok(restricted.length>=2);
    for(const row of restricted) {
      const previousAudit=await auditCount(row.booking_id);
      await assert.rejects(changePublicBooking(db,{id:row.user_id},row.booking_id,'reschedule',{preferredDate:addCalendarDays(monday(),60),timeWindow:'11:00 - 13:00'}),error=>error.status===409);
      await assert.rejects(changePublicBooking(db,{id:row.user_id},row.booking_id,'cancel',{status:'Cancelled'}),error=>error.status===409);
      assert.deepEqual(await auditCount(row.booking_id),previousAudit,'assigned/completed data remains unchanged');
    }
  }finally{await new Promise(resolve=>server.close(resolve));}
}));

test('customer timestamps represent stable UTC instants independently of the MySQL session timezone',async()=>fixture(async(db,c,user,create)=>{
  const booking=await create();
  const [[instant]]=await c.execute('SELECT UNIX_TIMESTAMP(created_at) AS epoch FROM booking WHERE booking_id=?',[booking.bookingId]);
  const utc=await getBookingDetail(db,booking.bookingId,user.id);
  assert.equal(utc.createdAt,new Date(instant.epoch*1000).toISOString());
  assert.ok(utc.statusTimeline.every(entry=>entry.changedAt.endsWith('Z')));
  const [[existing]]=await c.execute(`SELECT b.booking_id AS bookingId,c.user_id AS userId
    FROM service_report sr JOIN work_order w ON w.job_id=sr.job_id JOIN booking b ON b.booking_id=w.booking_id JOIN customer c ON c.customer_id=b.customer_id LIMIT 1`);
  const reportUtc=await getBookingReport(db,existing.bookingId,existing.userId);
  const [[session]]=await c.query('SELECT @@SESSION.time_zone AS zone');
  try {
    await c.execute("SET time_zone='+08:00'");
    const singapore=await getBookingDetail(db,booking.bookingId,user.id);
    assert.equal(singapore.createdAt,utc.createdAt);assert.deepEqual(singapore.statusTimeline,utc.statusTimeline);
    const reportSingapore=await getBookingReport(db,existing.bookingId,existing.userId);
    assert.equal(reportSingapore.submittedTime,reportUtc.submittedTime);
    assert.deepEqual(reportSingapore.photos,reportUtc.photos);
  }finally{await c.execute('SET time_zone=?',[session.zone]);}
}));

test('reports expose actual inventory usage without inferred duration or public photo URLs',async()=>fixture(async(db,c,user)=>{
  const [[existing]]=await c.execute(`SELECT b.booking_id AS bookingId,c.user_id AS userId,w.job_id AS jobId,sr.started_at,sr.completed_at,
    TIMESTAMPDIFF(MINUTE,sr.started_at,sr.completed_at) AS durationMinutes
    FROM service_report sr JOIN work_order w ON w.job_id=sr.job_id JOIN booking b ON b.booking_id=w.booking_id JOIN customer c ON c.customer_id=b.customer_id LIMIT 1`);
  const [part]=await c.execute("INSERT INTO part(part_name,current_stock) VALUES (?,0)",['QA Report Part '+randomUUID()]);
  await c.execute("INSERT INTO inventory_transaction(job_id,part_id,transaction_type,quantity) VALUES (?,?,'Stock Out',3),(?,?,'Return',1)",[existing.jobId,part.insertId,existing.jobId,part.insertId]);
  const report=await getBookingReport(db,existing.bookingId,existing.userId);
  assert.equal(report.durationMinutes,existing.durationMinutes);
  assert.deepEqual(report.partsUsed.find(item=>item.partId===part.insertId),{partId:part.insertId,partName:(await c.execute('SELECT part_name FROM part WHERE part_id=?',[part.insertId]))[0][0].part_name,unit:'piece',quantity:2});
  assert.ok(report.photos.every(photo=>photo.photoUrl===null||photo.photoUrl.startsWith(`/api/customer/bookings/${existing.bookingId}/photos/`)));
  await assert.rejects(getBookingReport(db,existing.bookingId,user.id),error=>error.status===404);
  const photo=report.photos[0];
  if(photo)await assert.rejects(getOwnedReportPhoto(db,user.id,existing.bookingId,photo.photoId),error=>error.status===404);
}));

test('authenticated report image HTTP serves private dot-directory bytes only to the owning customer',async()=>fixture(async(db,c)=>{
  const [[owned]]=await c.execute(`SELECT b.booking_id AS bookingId,w.job_id AS jobId
    FROM service_report r JOIN work_order w ON w.job_id=r.job_id JOIN booking b ON b.booking_id=w.booking_id
    JOIN customer c ON c.customer_id=b.customer_id JOIN user_account u ON u.user_id=c.user_id
    WHERE u.email='alice.tan@coolcare.demo' ORDER BY r.report_id LIMIT 1`);
  assert.ok(owned,'The documented customer has a completed service report.');
  const filename=`http-photo-${randomUUID()}.png`;
  const path=join(reportPhotoDirectory,filename);
  const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j7z0AAAAASUVORK5CYII=','base64');
  await mkdir(reportPhotoDirectory,{recursive:true});await writeFile(path,bytes);
  let server;
  let cookie='',csrf='';
  const request=async(url,method='GET',body)=>{const response=await fetch(`http://127.0.0.1:${server.address().port}${url}`,{method,headers:{Cookie:cookie,'X-CSRF-Token':csrf,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];return response;};
  try {
    // Real private metadata and bytes are isolated to this rollback fixture.
    // The sample business dataset does not need invented or missing photo URLs.
    const [photo]=await c.execute('INSERT INTO photo(job_id,photo_url,description) VALUES (?,?,?)',[owned.jobId,filename,'Private HTTP test image; removed after verification.']);
    owned.photoId=photo.insertId;
    server=createApp({pool:db,secret:process.env.SESSION_SECRET}).listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
    const url=`/api/customer/bookings/${owned.bookingId}/photos/${owned.photoId}`;
    assert.equal((await request(url)).status,401);
    csrf=(await(await request('/api/session')).json()).csrf;
    csrf=(await(await request('/api/public/login','POST',{email:'alice.tan@coolcare.demo',password:'CoolCareDemo2026!'})).json()).csrf;
    const image=await request(url);assert.equal(image.status,200);assert.equal(image.headers.get('content-type'),'image/png');assert.equal(image.headers.get('cache-control'),'private, no-store');
    assert.deepEqual(Buffer.from(await image.arrayBuffer()),bytes);
    assert.equal((await request(`/api/customer/bookings/${owned.bookingId+100000}/photos/${owned.photoId}`)).status,404);
    const account={fullName:'Photo Access QA',email:`photo-access-${randomUUID()}@example.test`,phone:'12345678',password:'TestPhotoPassword2026!',confirmPassword:'TestPhotoPassword2026!'};
    assert.equal((await request('/api/public/register','POST',account)).status,201);
    csrf=(await(await request('/api/public/login','POST',account)).json()).csrf;
    assert.equal((await request(url)).status,404,'another customer cannot read the private image');
  }finally{if(server)await new Promise(resolve=>server.close(resolve));await unlink(path);}
},{privileged:true}));
