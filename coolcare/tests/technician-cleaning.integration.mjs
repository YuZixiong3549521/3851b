import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createApp} from '../server/app.mjs';
import {getTechnicianJobDetails,saveCleaningAssessment} from '../server/technician.mjs';
import {openPrivilegedFixtureConnection} from './privileged-fixture.mjs';
import {minimumBookingDate,nextWeekday,addCalendarDays,singaporeToday} from '../server/customer/booking-schedule.mjs';
async function fixture(work){
 const c=await openPrivilegedFixtureConnection();await c.beginTransaction();
 const handle={execute:c.execute.bind(c),query:c.query.bind(c),beginTransaction:()=>c.query('SAVEPOINT cleaning_test'),commit:()=>c.query('RELEASE SAVEPOINT cleaning_test'),rollback:()=>c.query('ROLLBACK TO SAVEPOINT cleaning_test'),release:()=>{}};
 const db={execute:c.execute.bind(c),query:c.query.bind(c),getConnection:async()=>handle};
 try{
  const [technicians]=await c.execute(`SELECT t.technician_id AS technicianId,u.user_id AS userId,u.email
    FROM technician t JOIN user_account u ON u.user_id=t.user_id WHERE u.email IN ('chris.lim@coolcare.demo','farah.ahmad@coolcare.demo')`);
  const [[admin]]=await c.execute('SELECT user_id FROM admin_profile ORDER BY user_id LIMIT 1');
  const [account]=await c.execute(`INSERT INTO user_account(role_id,full_name,email,password_hash,phone)
    SELECT role_id,'Cleaning Workflow Fixture',?,'unusable-test-password','91234567' FROM role WHERE role_name='Customer'`,[`cleaning-${randomUUID()}@example.test`]);
  const [customer]=await c.execute('INSERT INTO customer(user_id) VALUES (?)',[account.insertId]);
  const customerId=customer.insertId;
  const [address]=await c.execute("INSERT INTO service_address(customer_id,address_label,address_line,is_default) VALUES (?,'Test','90 Cleaning Fixture Street #02-03',TRUE)",[customerId]);
  const addressId=address.insertId;
  const [unit]=await c.execute('INSERT INTO aircon_unit(customer_id,address_id,installation_location) VALUES (?,?,?)',[customerId,addressId,'Fixture living room']);
  async function createJob({technicianEmail='farah.ahmad@coolcare.demo',serviceCode='cleaning',status='Assigned',date=nextWeekday(minimumBookingDate())}={}) {
    const actor=technicians.find(technician=>technician.email===technicianEmail);assert.ok(actor);
    const [[service]]=await c.execute(`SELECT s.service_id,s.service_name,s.base_price,p.additional_unit_price FROM service_catalog s
      JOIN simple_service_catalog sc ON sc.service_id=s.service_id JOIN web_service_pricing p ON p.service_id=s.service_id WHERE sc.code=?`,[serviceCode]);
    const [booking]=await c.execute(`INSERT INTO booking(customer_id,address_id,service_id,preferred_service_date,preferred_time_slot,booking_status,total_amount,problem_description)
      VALUES (?,?,?,?,'09:00 - 11:00',?,?,?)`,[customerId,addressId,service.service_id,date,status,service.base_price,'Rollback-only cleaning workflow fixture']);
    const bookingId=booking.insertId;
    await c.execute('INSERT INTO booking_aircon_unit(booking_id,unit_id) VALUES (?,?)',[bookingId,unit.insertId]);
    await c.execute(`INSERT INTO booking_service(booking_id,service_id,service_name,base_price,additional_unit_price,quantity,line_total)
      VALUES (?,?,?,?,?,1,?)`,[bookingId,service.service_id,service.service_name,service.base_price,service.additional_unit_price,service.base_price]);
    const [assignment]=await c.execute('INSERT INTO assignment(booking_id,technician_id,assigned_by_admin_id,assignment_status) VALUES (?,?,?,?)',
      [bookingId,actor.technicianId,admin.user_id,status==='Completed'?'Completed':'Accepted']);
    const [order]=await c.execute(`INSERT INTO work_order(booking_id,assignment_id,appointment_date,appointment_time,current_status)
      VALUES (?,?,?,'09:00:00',?)`,[bookingId,assignment.insertId,`${date} 09:00:00`,status]);
    const jobId=order.insertId;
    if(status==='Completed')await c.execute(`INSERT INTO service_report(job_id,work_performed,problem_found,solution_applied,started_at,completed_at,submitted_time)
      VALUES (?,'Cleaned filters and confirmed drainage.','Dust buildup.','Filters washed; drain flushed.',?,?,?)`,
      [jobId,`${date} 09:00:00`,`${date} 10:00:00`,`${date} 02:05:00`]);
    return {jobId,bookingId,technicianId:actor.technicianId,userId:actor.userId,customerId,addressId,totalAmount:Number(service.base_price)};
  }
  const job=await createJob();
  await work(db,c,job,createJob);
 }finally{await c.rollback();await c.end();}
}

test('cleaning assessment persists an explicit method and audit; retries, stale versions and transaction rollback preserve prices and reports',async()=>fixture(async(db,c,job)=>{
 const [reportsBefore]=await c.execute('SELECT * FROM service_report ORDER BY report_id');
 const [[initial]]=await c.execute('SELECT version FROM work_order_cleaning_assessment WHERE job_id=?',[job.jobId]);
 const baseVersion=initial?.version??0;
 const input={requestId:randomUUID(),expectedVersion:baseVersion,method:'Regular',note:'Filters have light dust; regular cleaning is recommended.'};
 const saved=await saveCleaningAssessment(db,job.userId,job.jobId,input);assert.equal(saved.method,'Regular');assert.equal(saved.version,baseVersion+1);
 assert.equal((await saveCleaningAssessment(db,job.userId,job.jobId,input)).replayed,true);
 await assert.rejects(saveCleaningAssessment(db,job.userId,job.jobId,{...input,note:'A different note with the same request.'}),/different assessment/);
 await assert.rejects(saveCleaningAssessment(db,job.userId,job.jobId,{...input,requestId:randomUUID()}),/updated elsewhere/);
 const chemical={requestId:randomUUID(),expectedVersion:saved.version,method:'Chemical',note:'Inspection found buildup. Discuss chemical cleaning and an extra-work quote with the customer before proceeding.'};
 const revised=await saveCleaningAssessment(db,job.userId,job.jobId,chemical);assert.equal(revised.version,baseVersion+2);
 const detail=await getTechnicianJobDetails(db,job.technicianId,job.jobId);assert.equal(detail.job.cleaningAssessment.method,'Chemical');assert.equal(detail.cleaningAssessmentHistory[0].beforeMethod,'Regular');assert.equal(detail.cleaningAssessmentHistory[0].afterMethod,'Chemical');assert.ok(detail.cleaningAssessmentHistory[0].changedBy);
 const [[price]]=await c.execute('SELECT total_amount FROM booking WHERE booking_id=?',[job.bookingId]);assert.equal(price.total_amount,job.totalAmount);
 const [reportsAfter]=await c.execute('SELECT * FROM service_report ORDER BY report_id');assert.deepEqual(reportsAfter,reportsBefore,'Cleaning assessment never rewrites original service reports.');
 const normal=await db.getConnection();const failing={getConnection:async()=>({...normal,execute:async(sql,values)=>{if(sql.startsWith('UPDATE work_order SET'))throw new Error('Injected work-order failure');return normal.execute(sql,values);}})};
 await assert.rejects(saveCleaningAssessment(failing,job.userId,job.jobId,{...chemical,requestId:randomUUID(),expectedVersion:revised.version,method:'Regular'}),/Injected work-order failure/);
 const [[after]]=await c.execute('SELECT cleaning_method,version FROM work_order_cleaning_assessment WHERE job_id=?',[job.jobId]);assert.equal(after.cleaning_method,'Chemical');assert.equal(after.version,revised.version);
}));

test('cleaning assessment HTTP requires technician ownership and CSRF and rejects completed historical work',async()=>fixture(async(db,c,job,createJob)=>{
 const completed=await createJob({technicianEmail:'chris.lim@coolcare.demo',status:'Completed',date:nextWeekday(addCalendarDays(singaporeToday(),-30))});
 const repair=await createJob({serviceCode:'repair'});
 const server=createApp({pool:db,secret:process.env.SESSION_SECRET}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 let cookie='',csrf='';
 async function req(path,method='GET',body){const response=await fetch(`http://127.0.0.1:${server.address().port}`+path,{method,headers:{Cookie:cookie,'X-CSRF-Token':csrf,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];return response;}
 async function login(email){csrf=(await(await req('/api/session')).json()).csrf;csrf=(await(await req('/api/public/login','POST',{email,password:'CoolCareDemo2026!'})).json()).csrf;}
 const input={requestId:randomUUID(),expectedVersion:0,method:'Chemical',note:'Inspect buildup and obtain agreement for any extra work.'};
 try{
  csrf=(await(await req('/api/session')).json()).csrf;assert.equal((await req(`/api/technician/jobs/${job.jobId}/cleaning-assessment`,'PATCH',input)).status,401);
  await login('alice.tan@coolcare.demo');assert.equal((await req(`/api/technician/jobs/${job.jobId}/cleaning-assessment`,'PATCH',input)).status,403);
  await login('chris.lim@coolcare.demo');assert.equal((await req(`/api/technician/jobs/${job.jobId}/cleaning-assessment`,'PATCH',input)).status,404);
  assert.equal((await req(`/api/technician/jobs/${completed.jobId}/cleaning-assessment`,'PATCH',input)).status,409);
  await login('farah.ahmad@coolcare.demo');const correctCsrf=csrf;csrf='wrong';assert.equal((await req(`/api/technician/jobs/${job.jobId}/cleaning-assessment`,'PATCH',input)).status,403);csrf=correctCsrf;
  assert.equal((await req(`/api/technician/jobs/${job.jobId}/cleaning-assessment`,'PATCH',{...input,note:''})).status,400);
  const [[initial]]=await c.execute('SELECT version FROM work_order_cleaning_assessment WHERE job_id=?',[job.jobId]);
  const valid={...input,expectedVersion:initial?.version??0};const response=await req(`/api/technician/jobs/${job.jobId}/cleaning-assessment`,'PATCH',valid);assert.equal(response.status,200);assert.equal((await response.json()).method,'Chemical');
  assert.equal((await req(`/api/technician/jobs/${job.jobId}/cleaning-assessment`,'PATCH',{...valid,requestId:randomUUID()})).status,409);
  assert.equal((await req(`/api/technician/jobs/${repair.jobId}/cleaning-assessment`,'PATCH',{...input,requestId:randomUUID()})).status,400,'a real Repair snapshot is not eligible for a cleaning assessment');
 }finally{await new Promise(r=>server.close(r));}
}));

test('annual bundle work orders expose only earlier completed reports in their own series without inferring old cleaning methods',async()=>fixture(async(db,c,job,createJob)=>{
 const previous=await createJob({status:'Completed',date:'2026-08-10'});
 const unrelated=await createJob({status:'Completed',date:'2026-07-10'});
 // All work orders and reports belong to this rollback fixture. A rich business
 // seed can therefore contain real assessments and annual links without being
 // rewritten merely to manufacture a missing-method compatibility case.
 const [[pack]]=await c.execute("SELECT package_id FROM simple_package_catalog WHERE code='annual-cleaning'");
 const [series]=await c.execute(`INSERT INTO annual_booking_series(customer_id,address_id,package_id,package_name,first_service_date,unit_count,total_amount,request_id)
  VALUES(?,?,?,'Annual Cleaning Bundle','2026-08-10',1,180,?)`,[previous.customerId,previous.addressId,pack.package_id,randomUUID()]);
 await c.execute(`INSERT INTO annual_booking_visit(booking_id,series_id,visit_number,scheduled_date,window_start,window_end) VALUES
  (?,?,1,'2026-08-10','2026-08-10','2026-11-10'),(?,?,2,'2026-11-10','2026-11-10','2027-02-10')`,[previous.bookingId,series.insertId,job.bookingId,series.insertId]);
 const detail=await getTechnicianJobDetails(db,job.technicianId,job.jobId);
 assert.equal(detail.job.annualSeriesId,series.insertId);assert.equal(detail.job.annualVisitNumber,2);assert.equal(detail.annualHistory.length,1);assert.equal(detail.annualHistory[0].jobId,previous.jobId);assert.equal(detail.annualHistory[0].cleaningMethod,null);
 assert.ok(detail.addressHistory.every(report=>report.address===detail.job.address));
 assert.ok(detail.addressHistory.some(report=>report.jobId===unrelated.jobId),'other completed work at this address remains visible in address history');
 assert.ok(!detail.annualHistory.some(report=>report.jobId===unrelated.jobId),'unrelated address reports do not leak into the annual series');
}));
