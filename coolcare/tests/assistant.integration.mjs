import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import mysql from 'mysql2/promise';
import {createApp} from '../server/app.mjs';
import {annualVisitSchedule} from '../server/customer/annual-bookings.mjs';
import {addCalendarDays,minimumBookingDate,nextWeekday} from '../server/customer/booking-schedule.mjs';

const pool=mysql.createPool({host:process.env.DB_HOST,port:Number(process.env.DB_PORT),user:process.env.DB_USER,
  password:process.env.DB_PASSWORD,database:process.env.DB_NAME,dateStrings:true,decimalNumbers:true,connectionLimit:4});
after(()=>pool.end());
const prefix='/api/customer/assistant';
const json=value=>typeof value==='string'?JSON.parse(value):value;
const futureDate=()=>nextWeekday(addCalendarDays(minimumBookingDate(),21));
const identity=(user,state)=>({expectedUserId:Number(user.id),draftId:state?.draftId??null,revision:state?.revision??0});
const emptyDraft=()=>({step:'service',numberOfUnits:2,serviceAddress:'',phone:'',preferredDate:'',
  timeWindow:'09:00 AM - 11:00 AM',notes:''});

// Every fixture owns an uncommitted account and all its records. Application
// transactions use savepoints so successful HTTP requests remain rollback-only.
// Hooks simulate read changes/failures without editing the shared live catalogue.
async function fixture(work) {
  const connection=await pool.getConnection();
  await connection.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
  await connection.beginTransaction();
  const hooks={before:null,after:null};
  async function run(method,sql,values) {
    // The real workflow sets this before starting its own transaction. Our
    // outer rollback transaction already uses that isolation level.
    if(sql==='SET TRANSACTION ISOLATION LEVEL READ COMMITTED')return [[],[]];
    if(hooks.before)await hooks.before(sql,values);
    const result=await connection[method](sql,values);
    return hooks.after?await hooks.after(sql,result):result;
  }
  const handle={execute:(sql,values)=>run('execute',sql,values),query:(sql,values)=>run('query',sql,values),
    beginTransaction:()=>connection.query('SAVEPOINT assistant_test'),
    commit:()=>connection.query('RELEASE SAVEPOINT assistant_test'),
    rollback:()=>connection.query('ROLLBACK TO SAVEPOINT assistant_test'),release:()=>{}};
  const db={execute:handle.execute,query:handle.query,getConnection:async()=>handle};
  let server;
  async function start() {
    server=createApp({pool:db,secret:process.env.SESSION_SECRET}).listen(0,'127.0.0.1');
    await new Promise(resolve=>server.once('listening',resolve));
  }
  async function restart() {
    await new Promise(resolve=>server.close(resolve));
    await start();
  }
  function newClient() {
    const client={cookie:'',csrf:'',user:null};
    client.raw=async(path,method='GET',body,headers={})=>{
      const response=await fetch(`http://127.0.0.1:${server.address().port}${path}`,{method,
        headers:{Cookie:client.cookie,'X-CSRF-Token':client.csrf,'Content-Type':'application/json',...headers},
        body:body===undefined?undefined:JSON.stringify(body)});
      if(response.headers.get('set-cookie'))client.cookie=response.headers.get('set-cookie').split(';')[0];
      return response;
    };
    client.request=async(...args)=>{
      const response=await client.raw(...args);
      return {status:response.status,data:await response.json()};
    };
    client.session=async()=>{client.csrf=(await client.request('/api/session')).data.csrf;};
    client.login=async account=>{
      await client.session();
      const result=await client.request('/api/public/login','POST',account);
      assert.equal(result.status,200,JSON.stringify(result.data));
      client.csrf=result.data.csrf;client.user=result.data.user;
    };
    return client;
  }
  async function customer(name='Assistant Integration') {
    const client=newClient();await client.session();
    const account={fullName:name,email:`assistant-${randomUUID()}@example.test`,phone:'+65 9123 4567',
      password:'TestPassword2026!',confirmPassword:'TestPassword2026!'};
    const registration=await client.request('/api/public/register','POST',account);
    assert.equal(registration.status,201,JSON.stringify(registration.data));
    await client.login(account);
    const context=(await client.request('/api/customer/customer-context')).data;
    return {client,account,user:client.user,customerId:context.customer.customerId};
  }
  await start();
  try {await work({connection,hooks,newClient,customer,restart});}
  finally {await new Promise(resolve=>server.close(resolve));await connection.rollback();connection.release();}
}

async function save(client,draft,state=null) {
  const response=await client.request(`${prefix}/draft`,'PUT',{...identity(client.user,state),draft});
  assert.equal(response.status,200,JSON.stringify(response.data));
  return response.data.state;
}
async function review(client,state) {
  const response=await client.request(`${prefix}/review`,'POST',identity(client.user,state));
  assert.equal(response.status,200,JSON.stringify(response.data));
  return response.data.state;
}
function confirmInput(client,state) {return {...identity(client.user,state),quoteId:state.quote.quoteId};}
async function selectedDraft(client,overrides={}) {
  const response=await client.request('/api/customer/booking-options');assert.equal(response.status,200);
  return {...emptyDraft(),step:'review',serviceId:response.data.services.find(service=>service.code==='cleaning').serviceId,
    serviceAddress:'91 Assistant Fixture Street #04-12',phone:'+65 9123 4567',preferredDate:futureDate(),...overrides};
}
async function recordCounts(connection,customerId) {
  const [[row]]=await connection.execute(`SELECT
    (SELECT COUNT(*) FROM booking WHERE customer_id=?) AS bookings,
    (SELECT COUNT(*) FROM annual_booking_series WHERE customer_id=?) AS series,
    (SELECT COUNT(*) FROM service_address WHERE customer_id=?) AS addresses,
    (SELECT COUNT(*) FROM aircon_unit WHERE customer_id=?) AS units,
    (SELECT COUNT(*) FROM booking_email_outbox e JOIN booking b ON b.booking_id=e.booking_id WHERE b.customer_id=?) AS emails`,
  Array(5).fill(customerId));
  return row;
}

test('assistant drafts require customer sessions and CSRF, isolate ownership, and survive a new API instance',async()=>fixture(async({connection,newClient,customer,restart})=>{
  const anonymous=newClient();
  assert.equal((await anonymous.request(`${prefix}/draft`)).status,401);
  assert.equal((await anonymous.request(`${prefix}/draft`,'PUT',{})).status,403);
  await anonymous.session();
  assert.equal((await anonymous.request(`${prefix}/draft`,'PUT',{})).status,401);
  const {client,account,user,customerId}=await customer();
  assert.deepEqual((await client.request(`${prefix}/draft`)).data,{state:null});
  const partial={...emptyDraft(),step:'address',serviceAddress:'91 Partial Address',notes:'Keep this unfinished note.'};
  const payload={...identity(user,null),draft:partial};
  assert.equal((await client.request(`${prefix}/draft`,'PUT',payload,{'X-CSRF-Token':'wrong'})).status,403);
  const mismatch=await client.request(`${prefix}/draft`,'PUT',{...payload,expectedUserId:user.id+100000});
  assert.equal(mismatch.status,409);assert.equal(mismatch.data.code,'ACCOUNT_CHANGED');
  assert.deepEqual((await client.request(`${prefix}/draft`)).data,{state:null});
  const state=await save(client,partial);
  assert.equal(state.status,'editing');assert.equal(state.userId,user.id);assert.equal(state.revision,1);
  assert.match(state.updatedAt,/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/);
  assert.ok(Math.abs(Date.now()-new Date(state.updatedAt).getTime())<10_000,'last saved timestamp is the actual UTC instant');
  assert.match(state.requestId,/^[a-f0-9-]{36}$/i);assert.deepEqual(state.draft,partial);
  assert.equal(state.quote,null);assert.equal(state.booking,null);
  const [[persisted]]=await connection.execute('SELECT * FROM assistant_booking_draft WHERE draft_id=?',[state.draftId]);
  assert.equal(persisted.customer_id,customerId);assert.equal(persisted.current_customer_id,customerId);
  assert.equal(persisted.request_id,state.requestId);assert.deepEqual(json(persisted.draft_data),partial);
  await restart();
  const reloaded=newClient();await reloaded.login(account);
  assert.deepEqual((await reloaded.request(`${prefix}/draft`)).data.state,state,'draft survives loss of the process session store');
  const other=await customer('Other Assistant Customer');
  assert.deepEqual((await other.client.request(`${prefix}/draft`)).data,{state:null});
  for(const [route,method,body] of [
    ['draft','PUT',{...identity(other.user,state),draft:{...partial,notes:'Foreign write'}}],
    ['review','POST',identity(other.user,state)],
    ['confirm','POST',{...identity(other.user,state),quoteId:randomUUID()}],
    ['new','POST',identity(other.user,state)],
  ]) {
    const result=await other.client.request(`${prefix}/${route}`,method,body);
    assert.equal(result.status,409);assert.equal(result.data.state,null,'a foreign draft must not leak into the response');
  }
  assert.deepEqual((await reloaded.request(`${prefix}/draft`)).data.state,state);
  const technician=newClient();await technician.login({email:'chris.lim@coolcare.demo',password:'CoolCareDemo2026!'});
  assert.equal((await technician.request(`${prefix}/draft`)).status,403);
  assert.equal((await technician.request(`${prefix}/new`,'POST',identity(technician.user,state))).status,403);
  assert.deepEqual(await recordCounts(connection,customerId),{bookings:0,series:0,addresses:0,units:0,emails:0});
}));

test('assistant partial saves use optimistic revisions, safely replay a save, and reject stale reset or edit races',async()=>fixture(async({connection,customer})=>{
  const {client,customerId}=await customer();
  const first=await save(client,emptyDraft());
  const changed={...first.draft,step:'address',serviceAddress:'54 Saved Draft Avenue'};
  const input={...identity(client.user,first),draft:changed};
  const updated=await save(client,changed,first);
  assert.equal(updated.revision,first.revision+1);assert.equal(updated.requestId,first.requestId);
  const replay=await client.request(`${prefix}/draft`,'PUT',input);
  assert.equal(replay.status,200);assert.deepEqual(replay.data.state,updated,'the exact lost save response can be recovered');
  assert.deepEqual(await save(client,changed,updated),updated,'saving unchanged content does not invent another revision');
  const stale=await client.request(`${prefix}/draft`,'PUT',{...input,draft:{...changed,notes:'Stale tab'}});
  assert.equal(stale.status,409);assert.equal(stale.data.code,'DRAFT_CONFLICT');assert.deepEqual(stale.data.state,updated);
  const staleReset=await client.request(`${prefix}/new`,'POST',identity(client.user,first));
  assert.equal(staleReset.status,409);assert.deepEqual(staleReset.data.state,updated);
  const resetInput=identity(client.user,updated);
  const reset=await client.request(`${prefix}/new`,'POST',resetInput);
  assert.equal(reset.status,200);
  const next=reset.data.state;assert.notEqual(next.draftId,updated.draftId);assert.notEqual(next.requestId,updated.requestId);
  assert.equal(next.status,'editing');assert.equal(next.draft.serviceAddress,'');
  const duplicateReset=await client.request(`${prefix}/new`,'POST',resetInput);
  assert.equal(duplicateReset.status,409);assert.equal(duplicateReset.data.state.draftId,next.draftId);
  assert.equal((await client.request(`${prefix}/draft`,'PUT',input)).status,409,'late save cannot revive an archived draft');
  assert.equal((await client.request(`${prefix}/draft`,'PUT',{...identity(client.user,null),draft:emptyDraft()})).status,409,'two initial tabs cannot create two active drafts');
  const [rows]=await connection.execute('SELECT draft_id,current_customer_id FROM assistant_booking_draft WHERE customer_id=?',[customerId]);
  assert.equal(rows.length,2);assert.deepEqual(rows.filter(row=>row.current_customer_id!==null).map(row=>row.draft_id),[next.draftId]);
}));

test('assistant review validates contact phone and calendar rules without creating addresses or bookings',async()=>fixture(async({connection,customer})=>{
  const {client,customerId}=await customer();
  let state=await save(client,await selectedDraft(client,{phone:'not-a-phone'}));
  const badPhone=await client.request(`${prefix}/review`,'POST',identity(client.user,state));
  assert.equal(badPhone.status,400);assert.equal(badPhone.data.code,'VALIDATION_ERROR');
  assert.ok(badPhone.data.details.fieldErrors.phone.length);
  state=await save(client,{...state.draft,phone:'+65 9123 4567',preferredDate:'2028-02-30'},state);
  const badDate=await client.request(`${prefix}/review`,'POST',identity(client.user,state));
  assert.equal(badDate.status,400);assert.ok(badDate.data.details.fieldErrors.preferredDate.length);
  const minimum=minimumBookingDate();
  const day=new Date(`${minimum}T00:00:00Z`).getUTCDay();
  const saturday=addCalendarDays(minimum,(6-day+7)%7);
  for(const preferredDate of [addCalendarDays(minimum,-1),saturday,addCalendarDays(saturday,1)]) {
    state=await save(client,{...state.draft,preferredDate},state);
    const result=await client.request(`${prefix}/review`,'POST',identity(client.user,state));
    assert.equal(result.status,409);assert.equal(result.data.code,'SCHEDULE_CONFLICT');
    assert.equal(result.data.details.conflicts[0].preferredDate,preferredDate);
  }
  for(const numberOfUnits of [0,11,2.5])assert.equal((await client.request(`${prefix}/draft`,'PUT',{
    ...identity(client.user,state),draft:{...state.draft,numberOfUnits},
  })).status,400);
  state=await save(client,{...state.draft,preferredDate:futureDate()},state);
  state=await review(client,state);assert.equal(state.status,'reviewed');assert.equal(state.quote.totalAmount,75);
  assert.equal(state.quote.visits.length,1);
  const forged=await client.request(`${prefix}/confirm`,'POST',{...confirmInput(client,state),quoteId:randomUUID()});
  assert.equal(forged.status,409);assert.equal(forged.data.code,'REVIEW_REQUIRED');
  assert.deepEqual(await recordCounts(connection,customerId),{bookings:0,series:0,addresses:0,units:0,emails:0});
}));

test('assistant annual review reports every conflicting quarter and confirmation rechecks a later visit',async()=>fixture(async({connection,customer})=>{
  const {client,customerId}=await customer();
  const options=(await client.request('/api/customer/booking-options')).data;
  const draft=await selectedDraft(client,{serviceId:undefined,packageId:options.bundles[0].packageId});
  const schedule=annualVisitSchedule(draft.preferredDate,260);
  const conflicts=[];
  for(const visit of schedule) {
    const bookings=[];
    for(let index=0;index<2;index++) {
      const result=await client.request('/api/public/bookings','POST',{expectedUserId:client.user.id,
        serviceId:options.services[0].serviceId,serviceAddress:draft.serviceAddress,numberOfUnits:1,
        preferredDate:visit.preferredDate,timeWindow:draft.timeWindow,requestId:randomUUID()});
      assert.equal(result.status,201,JSON.stringify(result.data));bookings.push(result.data.booking.bookingId);
    }
    conflicts.push(bookings);
  }
  const state=await save(client,draft);
  const blocked=await client.request(`${prefix}/review`,'POST',identity(client.user,state));
  assert.equal(blocked.status,409);assert.equal(blocked.data.code,'SCHEDULE_CONFLICT');
  assert.deepEqual(blocked.data.details.conflicts.map(({visitNumber,preferredDate})=>({visitNumber,preferredDate})),
    schedule.map(({visitNumber,preferredDate})=>({visitNumber,preferredDate})));
  assert.ok(blocked.data.details.conflicts.every(conflict=>conflict.message.includes('two bookings')));
  assert.deepEqual((await client.request(`${prefix}/draft`)).data.state,state,'failed review does not consume a revision or store a misleading quote');
  for(const bookings of conflicts)assert.equal((await client.request(`/api/customer/bookings/${bookings[0]}/status`,'PATCH',{status:'Cancelled'})).status,200);
  const reviewed=await review(client,state);assert.equal(reviewed.quote.visits.length,4);
  const fourth=await client.request('/api/public/bookings','POST',{serviceId:options.services[0].serviceId,
    serviceAddress:draft.serviceAddress.toUpperCase(),numberOfUnits:1,preferredDate:schedule[3].preferredDate,
    timeWindow:draft.timeWindow,requestId:randomUUID()});assert.equal(fourth.status,201);
  const before=await recordCounts(connection,customerId);
  const confirm=await client.request(`${prefix}/confirm`,'POST',confirmInput(client,reviewed));
  assert.equal(confirm.status,409);assert.equal(confirm.data.code,'SCHEDULE_CONFLICT');
  assert.deepEqual(confirm.data.details.conflicts.map(conflict=>conflict.visitNumber),[4]);
  assert.deepEqual(await recordCounts(connection,customerId),before,'a conflict on visit four cannot create the first three visits');
  assert.equal(before.series,0);assert.equal(before.bookings,9);assert.equal(before.emails,0);
}));

test('assistant requires a new reviewed price before committing, without modifying the live catalogue',async()=>fixture(async({connection,hooks,customer})=>{
  const {client,customerId}=await customer();
  const draft=await selectedDraft(client);
  const state=await review(client,await save(client,draft));
  assert.equal(state.quote.totalAmount,75);
  const [[original]]=await connection.execute('SELECT base_price FROM service_catalog WHERE service_id=?',[draft.serviceId]);
  let changedReads=0;
  hooks.after=(sql,result)=>{
    if(/SELECT\s+s\.service_id AS serviceId,s\.service_name AS name,s\.base_price AS basePrice/i.test(sql)) {
      changedReads++;
      return [result[0].map(row=>({...row,basePrice:Number(row.basePrice)+10})),result[1]];
    }
    return result;
  };
  const previous=confirmInput(client,state);
  const changed=await client.request(`${prefix}/confirm`,'POST',previous);
  assert.equal(changed.status,409);assert.equal(changed.data.code,'REVIEW_REQUIRED');
  const updated=changed.data.state;assert.equal(updated.status,'reviewed');assert.equal(updated.revision,state.revision+1);
  assert.equal(updated.quote.totalAmount,85);assert.notEqual(updated.quote.quoteId,state.quote.quoteId);
  assert.deepEqual((await client.request(`${prefix}/draft`)).data.state,updated,'replacement quote is durably saved despite the 409 response');
  assert.equal((await client.request(`${prefix}/confirm`,'POST',previous)).status,409);
  assert.deepEqual(await recordCounts(connection,customerId),{bookings:0,series:0,addresses:0,units:0,emails:0});
  const accepted=await client.request(`${prefix}/confirm`,'POST',confirmInput(client,updated));
  assert.equal(accepted.status,200,JSON.stringify(accepted.data));assert.equal(accepted.data.booking.totalAmount,85);
  assert.ok(changedReads>=2,'both confirmation attempts resolve the current service price');
  const [[snapshot]]=await connection.execute('SELECT base_price,line_total FROM booking_service WHERE booking_id=?',[accepted.data.booking.bookingId]);
  assert.equal(Number(snapshot.base_price),Number(original.base_price)+10);assert.equal(Number(snapshot.line_total),85);
  assert.equal(Number((await connection.execute('SELECT base_price FROM service_catalog WHERE service_id=?',[draft.serviceId]))[0][0].base_price),Number(original.base_price));
}));

test('assistant annual confirmation is atomic, recovers a lost response, and replays after service dates expire',async t=>{
  t.mock.timers.enable({apis:['Date'],now:new Date('2028-01-03T04:00:00Z')});
  try {await fixture(async({connection,hooks,customer,newClient})=>{
    const {client,account,customerId}=await customer();
    const options=(await client.request('/api/customer/booking-options')).data;
    const draft=await selectedDraft(client,{serviceId:undefined,packageId:options.bundles[0].packageId,preferredDate:'2028-01-31'});
    const reviewed=await review(client,await save(client,draft));
    assert.deepEqual(reviewed.quote.visits.map(visit=>visit.preferredDate),['2028-01-31','2028-05-01','2028-07-31','2028-10-31']);
    assert.deepEqual(reviewed.quote.visits.map(visit=>visit.totalAmount),[65,65,65,65]);
    const input=confirmInput(client,reviewed);
    let inserts=0;
    hooks.before=sql=>{
      if(sql.startsWith('INSERT INTO booking(')&&++inserts===4) {
        const error=new Error('Injected fourth assistant booking failure');error.status=503;throw error;
      }
    };
    const failed=await client.request(`${prefix}/confirm`,'POST',input);
    assert.equal(failed.status,503);assert.equal(inserts,4);
    assert.deepEqual(await recordCounts(connection,customerId),{bookings:0,series:0,addresses:0,units:0,emails:0});
    assert.deepEqual((await client.request(`${prefix}/draft`)).data.state,reviewed,'failed final write preserves the reviewed draft for the same retry');
    hooks.before=null;
    // Discard the successful body, as when a response is lost before the UI can
    // store a receipt. Recovery must use the original draft and request IDs.
    const discarded=await client.raw(`${prefix}/confirm`,'POST',input);assert.equal(discarded.status,200);await discarded.body.cancel();
    const completed=(await client.request(`${prefix}/draft`)).data.state;
    assert.equal(completed.status,'completed');assert.equal(completed.requestId,reviewed.requestId);
    const series=completed.booking.annualBundle;assert.equal(series.visits.length,4);assert.equal(series.totalAmount,260);
    assert.deepEqual(series.visits.map(visit=>visit.preferredDate),reviewed.quote.visits.map(visit=>visit.preferredDate));
    assert.ok(series.visits.every(visit=>visit.status==='Submitted'&&visit.totalAmount===65));
    assert.deepEqual(await recordCounts(connection,customerId),{bookings:4,series:1,addresses:1,units:2,emails:0});
    const [[links]]=await connection.execute(`SELECT COUNT(*) AS n,COUNT(DISTINCT u.unit_id) AS units FROM booking_aircon_unit u
      JOIN annual_booking_visit v ON v.booking_id=u.booking_id WHERE v.series_id=?`,[series.seriesId]);
    assert.equal(links.n,8);assert.equal(links.units,2);
    const [[stored]]=await connection.execute('SELECT booking_receipt FROM assistant_booking_draft WHERE draft_id=?',[reviewed.draftId]);
    assert.deepEqual(json(stored.booking_receipt),completed.booking);
    t.mock.timers.setTime(new Date('2029-02-01T04:00:00Z').getTime());
    const returning=newClient();await returning.login(account);
    const retry=await returning.request(`${prefix}/confirm`,'POST',input);
    assert.equal(retry.status,200);assert.deepEqual(retry.data.booking,completed.booking);
    assert.deepEqual(await recordCounts(connection,customerId),{bookings:4,series:1,addresses:1,units:2,emails:0});
    const badAccount=await returning.request(`${prefix}/confirm`,'POST',{...input,expectedUserId:returning.user.id+100000});
    assert.equal(badAccount.status,409);assert.equal(badAccount.data.code,'ACCOUNT_CHANGED','account checks also precede completed receipt recovery');
  });} finally {t.mock.timers.reset();}
});

test('assistant reset and confirmation races preserve the winning request and archived completed receipts',async()=>fixture(async({connection,customer})=>{
  const {client,customerId}=await customer();
  const reviewed=await review(client,await save(client,await selectedDraft(client)));
  const oldConfirm=confirmInput(client,reviewed);
  const reset=await client.request(`${prefix}/new`,'POST',identity(client.user,reviewed));assert.equal(reset.status,200);
  const late=await client.request(`${prefix}/confirm`,'POST',oldConfirm);
  assert.equal(late.status,409);assert.equal(late.data.code,'DRAFT_CONFLICT');assert.equal(late.data.state.draftId,reset.data.state.draftId);
  assert.equal((await recordCounts(connection,customerId)).bookings,0,'reset winning first prevents a late confirmation from creating an abandoned draft');
  const next=await review(client,await save(client,await selectedDraft(client),reset.data.state));
  const nextConfirm=confirmInput(client,next);
  const confirmed=await client.request(`${prefix}/confirm`,'POST',nextConfirm);assert.equal(confirmed.status,200);
  const completed=confirmed.data.state;
  const staleReset=await client.request(`${prefix}/new`,'POST',identity(client.user,next));
  assert.equal(staleReset.status,409);assert.equal(staleReset.data.state.status,'completed');
  assert.equal((await client.request(`${prefix}/draft`,'PUT',{...identity(client.user,completed),draft:await selectedDraft(client)})).status,409);
  const newDraft=await client.request(`${prefix}/new`,'POST',identity(client.user,completed));assert.equal(newDraft.status,200);
  const recovered=await client.request(`${prefix}/confirm`,'POST',nextConfirm);
  assert.equal(recovered.status,200);assert.deepEqual(recovered.data.booking,confirmed.data.booking,'an archived completed request still returns its immutable receipt');
  assert.equal((await client.request(`${prefix}/draft`)).data.state.draftId,newDraft.data.state.draftId,'receipt recovery does not replace the newer current draft');
  const [[active]]=await connection.execute('SELECT COUNT(*) AS n FROM assistant_booking_draft WHERE current_customer_id=?',[customerId]);assert.equal(active.n,1);
  assert.deepEqual(await recordCounts(connection,customerId),{bookings:1,series:0,addresses:1,units:2,emails:0});
}));
