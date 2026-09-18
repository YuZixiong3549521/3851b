import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import mysql from 'mysql2/promise';
import { createPublicBooking, changePublicBooking } from '../server/public-site.mjs';
import { createBooking, listBookings } from '../server/customer/booking-service.mjs';
import { getBookingOptions, lockCustomer } from '../server/customer/booking-options.mjs';
import { addCalendarMonths } from '../server/customer/annual-bookings.mjs';
import {addCalendarDays,singaporeToday,minimumBookingDate,nextWeekday,isWeekday} from '../server/customer/booking-schedule.mjs';
import {openPrivilegedFixtureConnection} from './privileged-fixture.mjs';

const pool=mysql.createPool({host:process.env.DB_HOST,port:Number(process.env.DB_PORT),user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME,dateStrings:true,decimalNumbers:true,connectionLimit:4});
after(()=>pool.end());
const date=offset=>{
  const candidate=addCalendarDays(singaporeToday(),30);
  const day=new Date(`${candidate}T00:00:00Z`).getUTCDay();
  return addCalendarDays(candidate,(8-day)%7+offset);
};
const body=(overrides={})=>({serviceType:'Cleaning',numberOfUnits:2,preferredDate:date(0),timeWindow:'09:00 AM - 11:00 AM',serviceAddress:'42 Rules Test Avenue #02-10',requestId:randomUUID(),...overrides});

async function rollbackFixture(work,{privileged=false}={}) {
  const connection=privileged?await openPrivilegedFixtureConnection():await pool.getConnection();
  await connection.beginTransaction();
  const handle={execute:connection.execute.bind(connection),query:connection.query.bind(connection),beginTransaction:()=>connection.query('SAVEPOINT booking_rules'),commit:()=>connection.query('RELEASE SAVEPOINT booking_rules'),rollback:()=>connection.query('ROLLBACK TO SAVEPOINT booking_rules'),release:()=>{}};
  const db={execute:connection.execute.bind(connection),query:connection.query.bind(connection),getConnection:async()=>handle};
  try {
    const [account]=await connection.execute("INSERT INTO user_account(role_id,full_name,email,password_hash,phone) SELECT role_id,'Booking Rules Test',?,'unusable-test-password','12345678' FROM role WHERE role_name='Customer'",[`rules-${randomUUID()}@example.test`]);
    const [customer]=await connection.execute('INSERT INTO customer(user_id) VALUES (?)',[account.insertId]);
    await work(db,connection,{id:account.insertId,customerId:customer.insertId});
  } finally {await connection.rollback();if(privileged)await connection.end();else connection.release();}
}

for(const route of ['public','customer'])test(`${route} enforces Singapore day-14 and weekdays for create/reschedule while expired-date retries return the receipt`,async t=>{
  t.mock.timers.enable({apis:['Date'],now:new Date('2026-09-14T04:00:00Z')});
  try {await rollbackFixture(async(db,c,user)=>{
    const [address]=await c.execute("INSERT INTO service_address(customer_id,address_line) VALUES (?,'Schedule Boundary Address')",[user.customerId]);
    const [unit]=await c.execute('INSERT INTO aircon_unit(customer_id,address_id) VALUES (?,?)',[user.customerId,address.insertId]);
    const [[service]]=await c.execute("SELECT service_id FROM simple_service_catalog WHERE code='cleaning'");
    const input=route==='public'?body({preferredDate:'2026-09-28',numberOfUnits:1,serviceAddress:'Schedule Boundary Address'}):{
      serviceId:service.service_id,addressId:address.insertId,unitIds:[unit.insertId],preferredDate:'2026-09-28',timeSlot:'09:00 - 11:00',requestId:randomUUID(),
    };
    const create=payload=>route==='public'?createPublicBooking(db,user,payload):createBooking(db,payload,user.id);
    await assert.rejects(create({...input,preferredDate:'2026-09-27'}),error=>error.status===400&&error.message.includes('14 calendar days'));
    for(const weekend of ['2026-10-03','2026-10-04'])await assert.rejects(create({...input,preferredDate:weekend}),error=>error.status===400&&error.message.includes('closed'));
    const booking=await create(input);
    const id=booking.bookingId;
    await assert.rejects(changePublicBooking(db,user,id,'reschedule',{preferredDate:'2026-09-27',timeWindow:'09:00 AM - 11:00 AM'}),error=>error.status===400&&error.message.includes('14 calendar days'));
    for(const weekend of ['2026-10-03','2026-10-04'])await assert.rejects(changePublicBooking(db,user,id,'reschedule',{preferredDate:weekend,timeWindow:'09:00 AM - 11:00 AM'}),error=>error.status===400&&error.message.includes('closed'));
    await changePublicBooking(db,user,id,'reschedule',{preferredDate:'2026-09-29',timeWindow:'09:00 AM - 11:00 AM'});
    t.mock.timers.setTime(new Date('2026-09-29T16:00:00Z').getTime());
    assert.equal((await create(input)).bookingId,id,'same request still returns its receipt even after the original date is past');
    await assert.rejects(create({...input,requestId:randomUUID()}),error=>error.status===400&&error.message.includes('14 calendar days'));
    const [[count]]=await c.execute('SELECT COUNT(*) AS n FROM booking WHERE customer_id=?',[user.customerId]);assert.equal(count.n,1);
    const [[mail]]=await c.execute('SELECT COUNT(*) AS n FROM booking_email_outbox WHERE booking_id=?',[id]);assert.equal(mail.n,0);
  });} finally {t.mock.timers.reset();}
});

test('both booking routes enforce normalized address limits, cancellation and rescheduling with real MySQL',async()=>rollbackFixture(async(db,c,user)=>{
  const first=await createPublicBooking(db,user,body());
  const secondInput=body({preferredDate:date(4),serviceAddress:'  42 RULES TEST AVENUE, #02-10  '});
  const second=await createPublicBooking(db,user,secondInput);
  assert.equal((await createPublicBooking(db,user,secondInput)).id,second.id,'retries succeed even when at the limit');
  await assert.rejects(createPublicBooking(db,user,body({preferredDate:date(2)})),error=>error.status===409);
  const [[address]]=await c.execute('SELECT address_id FROM booking WHERE booking_id=?',[first.id]);
  const [units]=await c.execute('SELECT unit_id FROM booking_aircon_unit WHERE booking_id=?',[first.id]);
  const [[service]]=await c.execute("SELECT service_id FROM service_catalog WHERE service_name='Cleaning'");
  const customerInput={serviceId:service.service_id,addressId:address.address_id,unitIds:units.map(u=>u.unit_id),preferredDate:date(2),timeSlot:'09:00 - 11:00',requestId:randomUUID()};
  await assert.rejects(createPublicBooking(db,user,{...secondInput,expectedUserId:user.id+100000}),error=>error.status===409 && error.message.includes('signed-in account changed'));
  await assert.rejects(createBooking(db,{...customerInput,expectedUserId:user.id+100000},user.id),error=>error.status===409 && error.message.includes('signed-in account changed'));
  assert.equal((await createPublicBooking(db,user,{...secondInput,expectedUserId:String(user.id)})).id,second.id,'string user IDs match without changing retry behavior');
  await assert.rejects(createBooking(db,customerInput,user.id),error=>error.status===409);
  await changePublicBooking(db,user,first.id,'cancel',{status:'Cancelled'});
  const replacement=await createBooking(db,customerInput,user.id);
  assert.equal((await createBooking(db,customerInput,user.id)).bookingId,replacement.bookingId);
  await assert.rejects(createBooking(db,{...customerInput,expectedUserId:user.id+100000},user.id),error=>error.status===409 && error.message.includes('signed-in account changed'));
  assert.equal((await createBooking(db,{...customerInput,expectedUserId:String(user.id)},user.id)).bookingId,replacement.bookingId);
  const later=await createPublicBooking(db,user,body({preferredDate:date(11)}));
  await assert.rejects(changePublicBooking(db,user,later.id,'reschedule',{preferredDate:date(3),timeWindow:'09:00 AM - 11:00 AM'}),error=>error.status===409);
  await changePublicBooking(db,user,later.id,'reschedule',{preferredDate:date(14),timeWindow:'09:00 AM - 11:00 AM'});
  const other=await createPublicBooking(db,user,body({serviceAddress:'42 Rules Test Avenue #02-11'}));
  assert.ok(other.id,'another unit address has its own quota');
  const [[count]]=await c.execute('SELECT COUNT(*) AS n FROM service_address WHERE customer_id=?',[user.customerId]);
  assert.equal(count.n,2,'format variants reuse the existing address');
  const [[email]]=await c.execute('SELECT COUNT(*) AS n FROM booking_email_outbox WHERE booking_id=?',[replacement.bookingId]);
  assert.equal(email.n,0,'retry remains silent before dispatch');
}));

test('only three current choices are exposed, prices are authoritative and equipment belongs to the address',async()=>rollbackFixture(async(db,c,user)=>{
  const options=await getBookingOptions(db,user.customerId);
  assert.deepEqual(options.services.map(service=>service.code),['cleaning','repair']);
  assert.equal(options.bundles.length,1);assert.equal(options.bundles[0].includedVisits,4);
  assert.deepEqual(options.memberships,[]);assert.deepEqual(options.subscriptions,[]);
  const selected=options.services[0];
  const result=await createPublicBooking(db,user,body({serviceType:undefined,serviceIds:[selected.serviceId],totalAmount:1}));
  assert.equal(result.totalAmount,selected.basePrice+selected.additionalUnitPrice);
  const [[snapshot]]=await c.execute('SELECT COUNT(*) AS n,SUM(line_total) AS total FROM booking_service WHERE booking_id=?',[result.id]);
  assert.equal(snapshot.n,1);assert.equal(Number(snapshot.total),result.totalAmount);
  const list=await listBookings(db,'all',user.id);
  assert.equal(list[0].services.length,1);assert.equal(list[0].serviceName,'Cleaning');
  const repair=await createPublicBooking(db,user,body({serviceType:'Repair',numberOfUnits:5,preferredDate:date(8)}));
  assert.equal(repair.totalAmount,options.services[1].basePrice);
  await assert.rejects(createPublicBooking(db,user,body({serviceIds:options.services.map(service=>service.serviceId),preferredDate:date(20)})),error=>error.status===400);
  const [[address]]=await c.execute('SELECT address_id FROM booking WHERE booking_id=?',[result.id]);
  const [ownedUnits]=await c.execute('SELECT unit_id FROM booking_aircon_unit WHERE booking_id=?',[result.id]);
  await assert.rejects(createBooking(db,{serviceIds:options.services.map(service=>service.serviceId),addressId:address.address_id,unitIds:ownedUnits.map(u=>u.unit_id),preferredDate:date(30),timeSlot:'09:00 - 11:00'},user.id),error=>error.status===400);
  const [differentAddress]=await c.execute("INSERT INTO service_address(customer_id,address_line) VALUES (?,'Different unit address')",[user.customerId]);
  const [differentUnit]=await c.execute('INSERT INTO aircon_unit(customer_id,address_id) VALUES (?,?)',[user.customerId,differentAddress.insertId]);
  await assert.rejects(createBooking(db,{serviceIds:[selected.serviceId],addressId:address.address_id,unitIds:[differentUnit.insertId],preferredDate:date(30),timeSlot:'09:00 - 11:00'},user.id),error=>error.status===400);
  await assert.rejects(createBooking(db,{serviceIds:[selected.serviceId],addressId:address.address_id,unitIds:[differentUnit.insertId],preferredDate:'2028-02-30',timeSlot:'09:00 - 11:00'},user.id),error=>error.status===400);
}));

test('retired services and memberships reject new bookings while historical rows and import remain intact',async()=>rollbackFixture(async(db,c,user)=>{
  // Compatibility belongs in a scoped historical fixture, not in today's
  // business sample data or a specific old customer's subscription.
  const serviceName='Retired cleaning '+randomUUID();
  const [service]=await c.execute("INSERT INTO service_catalog(service_name,base_price,estimated_duration_minutes,service_status) VALUES (?,65,90,'Inactive')",[serviceName]);
  await c.execute('INSERT INTO web_service_pricing(service_id,additional_unit_price,customer_visible) VALUES (?,45,FALSE)',[service.insertId]);
  const packageName='Retired membership '+randomUUID();
  const [pack]=await c.execute("INSERT INTO maintenance_package(package_name,package_price,billing_interval,included_service_count,package_status) VALUES (?,160,'Yearly',4,'Inactive')",[packageName]);
  await c.execute("INSERT INTO web_package_details(package_id,package_kind,included_units) VALUES (?,'Membership',1)",[pack.insertId]);
  await c.execute('INSERT INTO package_service(package_id,service_id,included_quantity) VALUES (?,?,4)',[pack.insertId,service.insertId]);
  const [subscription]=await c.execute(`INSERT INTO customer_subscription(customer_id,package_id,start_date,end_date,remaining_service_count,subscription_status)
    VALUES (?,?,'2020-01-01','2020-12-31',2,'Expired')`,[user.customerId,pack.insertId]);
  const legacy=await createPublicBooking(db,user,body({serviceType:serviceName,preferredDate:'2020-01-31'}),{legacy:true});
  await c.execute('UPDATE booking SET subscription_id=? WHERE booking_id=?',[subscription.insertId,legacy.id]);
  await c.execute('INSERT INTO booking_package(booking_id,package_id,package_name,subscription_id,visit_reserved) VALUES (?,?,?,?,FALSE)',[legacy.id,pack.insertId,packageName,subscription.insertId]);
  const [subscriptions]=await c.execute('SELECT * FROM customer_subscription WHERE subscription_id=?',[subscription.insertId]);
  await assert.rejects(createPublicBooking(db,user,body({subscriptionId:subscription.insertId})),error=>error.status===400);
  await assert.rejects(createPublicBooking(db,user,body({packageId:pack.insertId})),error=>error.status===400);
  await assert.rejects(createPublicBooking(db,user,body({serviceIds:[service.insertId]})),error=>error.status===400);
  await assert.rejects(createPublicBooking(db,user,body({serviceType:serviceName,legacy:true})),error=>error.status===400,'the browser cannot enable the internal legacy import exemption');
  const [[oldBooking]]=await c.execute('SELECT preferred_service_date,total_amount FROM booking WHERE booking_id=?',[legacy.id]);
  assert.equal(oldBooking.preferred_service_date,'2020-01-31');assert.equal(Number(oldBooking.total_amount),110);
  const [[mail]]=await c.execute('SELECT COUNT(*) AS n FROM booking_email_outbox WHERE booking_id=?',[legacy.id]);assert.equal(mail.n,0);
  const [[address]]=await c.execute('SELECT address_id FROM booking WHERE booking_id=?',[legacy.id]);
  const [units]=await c.execute('SELECT unit_id FROM booking_aircon_unit WHERE booking_id=?',[legacy.id]);
  await assert.rejects(createBooking(db,{subscriptionId:subscription.insertId,addressId:address.address_id,unitIds:units.map(u=>u.unit_id),preferredDate:date(0),timeSlot:'09:00 - 11:00'},user.id),error=>error.status===400);
  assert.deepEqual((await c.execute('SELECT * FROM customer_subscription WHERE subscription_id=?',[subscription.insertId]))[0],subscriptions);
  const [history]=await listBookings(db,'all',user.id);
  assert.equal(history.bookingId,legacy.id);assert.equal(history.package.subscriptionId,subscription.insertId);assert.equal(history.package.name,packageName);
  assert.equal(history.totalAmount,110);assert.equal(history.services[0].name,serviceName);
},{privileged:true}));

test('booking submission does not queue customer email before dispatch',async()=>rollbackFixture(async(db,c,user)=>{
  const input=body();
  const created=await createPublicBooking(db,user,input);
  assert.ok(created.id);
  assert.equal((await createPublicBooking(db,user,input)).id,created.id);
  const [[mail]]=await c.execute('SELECT COUNT(*) AS n FROM booking_email_outbox WHERE booking_id=?',[created.id]);
  assert.equal(Number(mail.n),0);
}));

for(const route of ['public','customer'])test(`${route} annual bundle creates four real quarterly visits without pre-dispatch email, supports retry and scoped changes`,async()=>rollbackFixture(async(db,c,user)=>{
  const options=await getBookingOptions(db,user.customerId);
  const bundle=options.bundles[0];
  const firstDate=nextWeekday(`${new Date().getFullYear()+1}-01-31`);
  const [address]=await c.execute("INSERT INTO service_address(customer_id,address_line) VALUES (?,'Annual Test Address')",[user.customerId]);
  const [unit1]=await c.execute('INSERT INTO aircon_unit(customer_id,address_id) VALUES (?,?)',[user.customerId,address.insertId]);
  const [unit2]=await c.execute('INSERT INTO aircon_unit(customer_id,address_id) VALUES (?,?)',[user.customerId,address.insertId]);
  const input=route==='public'?body({packageId:bundle.packageId,serviceIds:bundle.serviceIds,preferredDate:firstDate,serviceAddress:'Annual Test Address'}):{
    packageId:bundle.packageId,serviceIds:bundle.serviceIds,addressId:address.insertId,unitIds:[unit1.insertId,unit2.insertId],preferredDate:firstDate,timeSlot:'09:00 - 11:00',requestId:randomUUID(),
  };
  const create=()=>route==='public'?createPublicBooking(db,user,input):createBooking(db,input,user.id);
  const booking=await create();
  const series=booking.annualBundle;
  assert.equal(series.name,'Annual Cleaning Bundle');assert.equal(series.visits.length,4);
  const expectedTotal=bundle.price+bundle.additionalUnitPrice;
  assert.equal(series.totalAmount,expectedTotal);
  assert.equal(series.visits.reduce((sum,visit)=>sum+visit.totalAmount,0),expectedTotal);
  assert.equal(booking.totalAmount,series.visits[0].totalAmount,'first visit never repeats the whole-year charge');
  assert.deepEqual(series.visits.map(visit=>visit.preferredDate),[0,3,6,9].map(month=>nextWeekday(addCalendarMonths(firstDate,month))));
  assert.ok(series.visits.every(visit=>isWeekday(visit.preferredDate)));
  assert.deepEqual(series.visits.map(visit=>visit.windowStart),[0,3,6,9].map(month=>addCalendarMonths(firstDate,month)));
  assert.equal((await create()).annualBundle.seriesId,series.seriesId);
  const [[counts]]=await c.execute(`SELECT COUNT(DISTINCT b.booking_id) AS bookings,COUNT(bu.unit_id) AS units
    FROM booking b JOIN booking_aircon_unit bu ON bu.booking_id=b.booking_id WHERE b.customer_id=?`,[user.customerId]);
  assert.equal(counts.bookings,4);assert.equal(counts.units,8);
  const [[mail]]=await c.execute(`SELECT COUNT(*) AS count FROM booking_email_outbox e
    JOIN annual_booking_visit v ON v.booking_id=e.booking_id WHERE v.series_id=?`,[series.seriesId]);
  assert.equal(Number(mail.count),0);
  const second=series.visits[1];
  await assert.rejects(changePublicBooking(db,user,second.bookingId,'reschedule',{preferredDate:nextWeekday(second.windowEnd),timeWindow:'09:00 AM - 11:00 AM'}),error=>error.status===409);
  await assert.rejects(changePublicBooking(db,user,second.bookingId,'reschedule',{preferredDate:firstDate,timeWindow:'09:00 AM - 11:00 AM'}),error=>error.status===409);
  const rescheduled=nextWeekday(addCalendarMonths(firstDate,4));
  await changePublicBooking(db,user,second.bookingId,'reschedule',{preferredDate:rescheduled,timeWindow:'09:00 AM - 11:00 AM'});
  await changePublicBooking(db,user,second.bookingId,'cancel',{status:'Cancelled'});
  const refreshed=(await create()).annualBundle;
  assert.equal(refreshed.visits[1].status,'Cancelled');assert.equal(refreshed.visits[1].preferredDate,rescheduled);
  assert.equal(refreshed.visits.filter(visit=>visit.status==='Submitted').length,3);
  assert.equal(refreshed.totalAmount,expectedTotal,'cancellation does not fabricate a payment or refund');
  const listed=await listBookings(db,'all',user.id);
  assert.equal(listed.length,4);assert.ok(listed.every(item=>item.annualBundle.seriesId===series.seriesId));
}));

test('annual later-visit quota failure rolls back the complete series and successful retry remains silent before dispatch',async()=>rollbackFixture(async(db,c,user)=>{
  const options=await getBookingOptions(db,user.customerId);
  const bundle=options.bundles[0];
  const firstDate=date(0);
  const thirdDate=nextWeekday(addCalendarMonths(firstDate,6));
  await createPublicBooking(db,user,body({preferredDate:thirdDate}));
  await createPublicBooking(db,user,body({preferredDate:thirdDate}));
  const annual=body({packageId:bundle.packageId,serviceIds:bundle.serviceIds,preferredDate:firstDate});
  await assert.rejects(createPublicBooking(db,user,annual),error=>error.status===409);
  let [[counts]]=await c.execute('SELECT COUNT(*) AS n FROM booking WHERE customer_id=?',[user.customerId]);assert.equal(counts.n,2);
  await c.execute("UPDATE booking SET booking_status='Cancelled' WHERE customer_id=?",[user.customerId]);
  const created=await createPublicBooking(db,user,{...annual,serviceAddress:'Atomic Annual Address'});
  assert.equal(created.annualBundle.visits.length,4);
  [[counts]]=await c.execute('SELECT COUNT(*) AS n FROM booking WHERE customer_id=?',[user.customerId]);assert.equal(counts.n,6);
  const [[series]]=await c.execute('SELECT COUNT(*) AS n FROM annual_booking_series WHERE customer_id=?',[user.customerId]);assert.equal(series.n,1);
  const [[emails]]=await c.execute('SELECT COUNT(*) AS n FROM booking_email_outbox e JOIN booking b ON b.booking_id=e.booking_id WHERE b.customer_id=?',[user.customerId]);assert.equal(emails.n,0);
}));

test('public and customer requests wait for the same customer lock before reading booking limits',async()=>{
  const [[fixture]]=await pool.query(`SELECT c.user_id,c.customer_id,sa.address_id,au.unit_id,sc.service_id
    FROM customer c JOIN service_address sa ON sa.customer_id=c.customer_id
    JOIN aircon_unit au ON au.address_id=sa.address_id AND au.customer_id=c.customer_id
    CROSS JOIN service_catalog sc WHERE sc.service_name='Cleaning' AND sa.is_archived=FALSE ORDER BY c.customer_id LIMIT 1`);
  for(const route of ['public','customer']) {
    const blocker=await pool.getConnection();
    const worker=await pool.getConnection();
    let attemptedResolve;
    const attempted=new Promise(resolve=>{attemptedResolve=resolve;});
    let acquired=false;
    let pending;
    try {
      await blocker.beginTransaction();
      await lockCustomer(blocker,fixture.user_id);
      const handle={execute:async(sql,values)=>{
        const locking=sql.includes('FROM customer')&&sql.includes('FOR UPDATE');
        if(locking)attemptedResolve();
        const result=await worker.execute(sql,values);
        if(locking)acquired=true;
        return result;
      },query:worker.query.bind(worker),beginTransaction:worker.beginTransaction.bind(worker),commit:worker.rollback.bind(worker),rollback:worker.rollback.bind(worker),release:()=>{}};
      const db={getConnection:async()=>handle};
      pending=route==='public'
        ?createPublicBooking(db,{id:fixture.user_id},body({preferredDate:date(365),serviceAddress:'Concurrent Test '+randomUUID()}))
        :createBooking(db,{serviceId:fixture.service_id,addressId:fixture.address_id,unitIds:[fixture.unit_id],preferredDate:date(365),timeSlot:'09:00 - 11:00'},fixture.user_id);
      await attempted;
      await new Promise(resolve=>setTimeout(resolve,60));
      assert.equal(acquired,false,`${route} must wait before checking the address quota`);
      await blocker.rollback();
      assert.ok(await pending);
      assert.equal(acquired,true);
    }finally {
      await blocker.rollback();
      if(pending)await pending.catch(()=>{});
      await worker.rollback();
      blocker.release();worker.release();
    }
  }
});
