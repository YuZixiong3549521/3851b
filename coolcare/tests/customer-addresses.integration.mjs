import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import mysql from 'mysql2/promise';
import {createApp} from '../server/app.mjs';
import {minimumBookingDate,nextWeekday,singaporeToday,addCalendarDays} from '../server/customer/booking-schedule.mjs';
import {createCustomerAddress} from '../server/customer/address-service.mjs';
import {lockCustomer} from '../server/customer/booking-options.mjs';

const pool=mysql.createPool({host:process.env.DB_HOST,port:Number(process.env.DB_PORT),user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME,dateStrings:true,decimalNumbers:true,connectionLimit:4});
after(()=>pool.end());

test('new customer can save an address without AC records and book by count through authenticated HTTP',async()=>{
  const c=await pool.getConnection();await c.beginTransaction();
  const handle={execute:c.execute.bind(c),query:c.query.bind(c),beginTransaction:()=>c.query('SAVEPOINT address_test'),commit:()=>c.query('RELEASE SAVEPOINT address_test'),rollback:()=>c.query('ROLLBACK TO SAVEPOINT address_test'),release:()=>{}};
  const db={execute:c.execute.bind(c),query:c.query.bind(c),getConnection:async()=>handle};
  const server=createApp({pool:db,secret:process.env.SESSION_SECRET}).listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  let cookie='',csrf='';
  async function request(path,method='GET',body){
    const response=await fetch(`http://127.0.0.1:${server.address().port}`+path,{method,headers:{Cookie:cookie,'X-CSRF-Token':csrf,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
    if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];return response;
  }
  async function state(){return (await(await request('/api/customer/customer-context')).json());}
  try {
    csrf=(await(await request('/api/session')).json()).csrf;
    assert.equal((await request('/api/customer/addresses','POST',{addressLine:'123 New Street'})).status,401);
    const account={fullName:'Address Integration',email:`address-${randomUUID()}@example.test`,phone:'12345678',password:'TestPassword2026!',confirmPassword:'TestPassword2026!'};
    assert.equal((await request('/api/public/register','POST',account)).status,201);
    const login=await(await request('/api/public/login','POST',account)).json();csrf=login.csrf;
    let context=await state();assert.equal(context.addresses.length,0);assert.equal(context.units.length,0);
    const addressInput={addressLine:'  77 New Customer Street #01-02  ',label:' Home ',postalCode:' 012345 ',expectedUserId:String(login.user.id),userId:1,customerId:1};
    const correctCsrf=csrf;csrf='incorrect';assert.equal((await request('/api/customer/addresses','POST',addressInput)).status,403);csrf=correctCsrf;
    assert.equal((await request('/api/customer/addresses','POST',{...addressInput,expectedUserId:login.user.id+100000})).status,409);
    for(const invalid of [{postalCode:'12345'},{addressLine:'    '},{label:'x'.repeat(81)}])assert.equal((await request('/api/customer/addresses','POST',{...addressInput,...invalid})).status,400);
    const savedResponse=await request('/api/customer/addresses','POST',addressInput);assert.equal(savedResponse.status,201);
    const saved=(await savedResponse.json()).address;
    assert.equal(saved.addressLine,'77 New Customer Street #01-02');assert.equal(saved.label,'Home');assert.equal(saved.postalCode,'012345');assert.equal(saved.isDefault,true);
    const repeated=(await(await request('/api/customer/addresses','POST',{...addressInput,addressLine:'77 NEW CUSTOMER STREET, #01-02',label:'Changed',postalCode:'999999'})).json()).address;
    assert.deepEqual(repeated,saved,'retry returns stored fields without rewriting existing address information');
    context=await state();assert.equal(context.addresses.length,1);assert.equal(context.units.length,0,'saving an address alone does not register equipment');
    const [[persisted]]=await c.execute('SELECT customer_id,address_line,postal_code FROM service_address WHERE address_id=?',[saved.addressId]);
    assert.equal(persisted.customer_id,context.customer.customerId);assert.equal(persisted.postal_code,'012345');
    const options=await(await request('/api/customer/booking-options')).json();
    const payload={serviceAddress:saved.addressLine,addressId:saved.addressId,numberOfUnits:2,serviceIds:options.bundles[0].serviceIds,packageId:options.bundles[0].packageId,preferredDate:nextWeekday(minimumBookingDate()),timeSlot:'09:00 - 11:00',requestId:randomUUID(),expectedUserId:login.user.id,customerId:1,userId:1};
    const [[foreign]]=await c.execute('SELECT address_id,address_line FROM service_address WHERE customer_id<>? LIMIT 1',[context.customer.customerId]);assert.ok(foreign);
    assert.equal((await request('/api/customer/bookings','POST',{...payload,addressId:foreign.address_id,serviceAddress:foreign.address_line})).status,400);
    assert.equal((await request('/api/customer/bookings','POST',{...payload,serviceAddress:'A different address'})).status,400);
    assert.equal((await request('/api/customer/bookings','POST',{...payload,expectedUserId:login.user.id+100000})).status,409);
    for(const count of [0,11,2.5])assert.equal((await request('/api/customer/bookings','POST',{...payload,numberOfUnits:count})).status,400);
    assert.equal((await request('/api/customer/bookings','POST',{...payload,unitIds:[1]})).status,400);
    const createdResponse=await request('/api/customer/bookings','POST',payload);assert.equal(createdResponse.status,201);
    const annual=(await createdResponse.json()).booking;
    assert.equal(annual.annualBundle.visits.length,4);assert.equal(annual.annualBundle.totalAmount,260);assert.equal(annual.totalAmount,65);
    assert.equal((await(await request('/api/customer/bookings','POST',payload)).json()).booking.bookingId,annual.bookingId);
    context=await state();assert.equal(context.units.length,2);
    const [[links]]=await c.execute(`SELECT COUNT(*) AS n,COUNT(DISTINCT bu.unit_id) AS equipment FROM booking_aircon_unit bu
      JOIN annual_booking_visit v ON v.booking_id=bu.booking_id WHERE v.series_id=?`,[annual.annualBundle.seriesId]);assert.equal(links.n,8);assert.equal(links.equipment,2);
    const [[messages]]=await c.execute(`SELECT COUNT(*) AS n FROM booking_email_outbox e JOIN annual_booking_visit v ON v.booking_id=e.booking_id WHERE v.series_id=?`,[annual.annualBundle.seriesId]);assert.equal(messages.n,4);
    const direct={serviceAddress:'25 Direct Typed Street #03-04',numberOfUnits:3,serviceIds:[options.services.find(service=>service.code==='cleaning').serviceId],preferredDate:payload.preferredDate,timeSlot:payload.timeSlot,requestId:randomUUID(),expectedUserId:login.user.id};
    const directResponse=await request('/api/customer/bookings','POST',direct);assert.equal(directResponse.status,201);
    const oneOff=(await directResponse.json()).booking;assert.equal(oneOff.totalAmount,100);
    assert.equal((await(await request('/api/customer/bookings','POST',direct)).json()).booking.bookingId,oneOff.bookingId);
    context=await state();assert.equal(context.addresses.length,2);assert.equal(context.units.length,5);
    const countsBefore={addresses:context.addresses.length,units:context.units.length};
    assert.equal((await request('/api/customer/bookings','POST',{...direct,serviceAddress:'Rollback Invalid Date Street',preferredDate:singaporeToday(),requestId:randomUUID()})).status,400);
    assert.equal((await request('/api/customer/bookings','POST',{...direct,serviceAddress:'Rollback Invalid Service Street',serviceIds:[99999999],requestId:randomUUID()})).status,400);
    context=await state();assert.deepEqual({addresses:context.addresses.length,units:context.units.length},countsBefore,'invalid creation rolls back new address and unit rows');
    const firstUnit=context.units.find(unit=>unit.addressId===saved.addressId);
    const legacy={serviceId:options.services[0].serviceId,addressId:saved.addressId,unitIds:[firstUnit.unitId],preferredDate:nextWeekday(addCalendarDays(payload.preferredDate,21)),timeSlot:payload.timeSlot,requestId:randomUUID()};
    assert.equal((await request('/api/customer/bookings','POST',legacy)).status,201,'registered-unit requests remain supported');
    await request('/api/public/logout','POST',{});csrf=(await(await request('/api/session')).json()).csrf;
    const tech=await(await request('/api/public/login','POST',{email:'chris.lim@coolcare.demo',password:'CoolCareDemo2026!'})).json();csrf=tech.csrf;
    assert.equal((await request('/api/customer/addresses','POST',{addressLine:'Technician cannot add a customer address'})).status,403);
  }finally {await new Promise(resolve=>server.close(resolve));await c.rollback();c.release();}
});

test('address saving waits for the customer lock and returns an existing address without overwriting it',async()=>{
  const [[existing]]=await pool.query(`SELECT c.user_id,a.address_id,a.address_line FROM customer c
    JOIN service_address a ON a.customer_id=c.customer_id ORDER BY a.address_id LIMIT 1`);
  const blocker=await pool.getConnection();const worker=await pool.getConnection();let pending;let acquired=false;let signal;
  const attempted=new Promise(resolve=>{signal=resolve;});
  try {
    await blocker.beginTransaction();await lockCustomer(blocker,existing.user_id);
    const handle={execute:async(sql,values)=>{const locks=sql.includes('FROM customer')&&sql.includes('FOR UPDATE');if(locks)signal();const result=await worker.execute(sql,values);if(locks)acquired=true;return result;},query:worker.query.bind(worker),beginTransaction:worker.beginTransaction.bind(worker),commit:worker.rollback.bind(worker),rollback:worker.rollback.bind(worker),release:()=>{}};
    pending=createCustomerAddress({getConnection:async()=>handle},existing.user_id,{addressLine:` ${existing.address_line.toUpperCase()} `,label:'Must not overwrite'});
    await attempted;await new Promise(resolve=>setTimeout(resolve,60));assert.equal(acquired,false);
    await blocker.rollback();const saved=await pending;assert.equal(saved.addressId,existing.address_id);assert.equal(saved.addressLine,existing.address_line);assert.notEqual(saved.label,'Must not overwrite');
  }finally {await blocker.rollback();if(pending)await pending.catch(()=>{});await worker.rollback();blocker.release();worker.release();}
});
