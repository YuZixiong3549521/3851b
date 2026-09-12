import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import {randomUUID} from 'node:crypto';
import {createApp} from '../server/app.mjs';
import {getTechnicianJobDetails,saveCleaningAssessment} from '../server/technician.mjs';
const pool=mysql.createPool({host:process.env.DB_HOST,port:Number(process.env.DB_PORT),user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME,dateStrings:true,decimalNumbers:true,connectionLimit:4});
after(()=>pool.end());
async function fixture(work){
 const c=await pool.getConnection();await c.beginTransaction();
 const handle={execute:c.execute.bind(c),query:c.query.bind(c),beginTransaction:()=>c.query('SAVEPOINT cleaning_test'),commit:()=>c.query('RELEASE SAVEPOINT cleaning_test'),rollback:()=>c.query('ROLLBACK TO SAVEPOINT cleaning_test'),release:()=>{}};
 const db={execute:c.execute.bind(c),query:c.query.bind(c),getConnection:async()=>handle};
 try{
  const [[job]]=await c.execute(`SELECT w.job_id AS jobId,w.booking_id AS bookingId,t.technician_id AS technicianId,u.user_id AS userId,b.customer_id AS customerId,b.address_id AS addressId,b.total_amount AS totalAmount
   FROM work_order w JOIN assignment a ON a.assignment_id=w.assignment_id JOIN technician t ON t.technician_id=a.technician_id JOIN user_account u ON u.user_id=t.user_id JOIN booking b ON b.booking_id=w.booking_id
   WHERE u.email='farah.ahmad@coolcare.demo' AND w.current_status NOT IN ('Completed','Cancelled') LIMIT 1`);
  assert.ok(job,'A non-completed demo work order is required for rollback-only tests.');
  const [[service]]=await c.execute("SELECT service_id FROM simple_service_catalog WHERE code='cleaning'");
  await c.execute('UPDATE booking SET service_id=? WHERE booking_id=?',[service.service_id,job.bookingId]);
  await work(db,c,job);
 }finally{await c.rollback();c.release();}
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

test('cleaning assessment HTTP requires technician ownership and CSRF and rejects completed historical work',async()=>fixture(async(db,c,job)=>{
 const server=createApp({pool:db,secret:process.env.SESSION_SECRET}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 let cookie='',csrf='';
 async function req(path,method='GET',body){const response=await fetch(`http://127.0.0.1:${server.address().port}`+path,{method,headers:{Cookie:cookie,'X-CSRF-Token':csrf,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];return response;}
 async function login(email){csrf=(await(await req('/api/session')).json()).csrf;csrf=(await(await req('/api/public/login','POST',{email,password:'CoolCareDemo2026!'})).json()).csrf;}
 const input={requestId:randomUUID(),expectedVersion:0,method:'Chemical',note:'Inspect buildup and obtain agreement for any extra work.'};
 try{
  csrf=(await(await req('/api/session')).json()).csrf;assert.equal((await req(`/api/technician/jobs/${job.jobId}/cleaning-assessment`,'PATCH',input)).status,401);
  await login('alice.tan@coolcare.demo');assert.equal((await req(`/api/technician/jobs/${job.jobId}/cleaning-assessment`,'PATCH',input)).status,403);
  await login('chris.lim@coolcare.demo');assert.equal((await req(`/api/technician/jobs/${job.jobId}/cleaning-assessment`,'PATCH',input)).status,404);
  const [[completed]]=await c.execute(`SELECT w.job_id AS jobId FROM work_order w JOIN assignment a ON a.assignment_id=w.assignment_id JOIN technician t ON t.technician_id=a.technician_id JOIN user_account u ON u.user_id=t.user_id WHERE u.email='chris.lim@coolcare.demo' AND w.current_status='Completed' LIMIT 1`);assert.ok(completed);
  assert.equal((await req(`/api/technician/jobs/${completed.jobId}/cleaning-assessment`,'PATCH',input)).status,409);
  await login('farah.ahmad@coolcare.demo');const correctCsrf=csrf;csrf='wrong';assert.equal((await req(`/api/technician/jobs/${job.jobId}/cleaning-assessment`,'PATCH',input)).status,403);csrf=correctCsrf;
  assert.equal((await req(`/api/technician/jobs/${job.jobId}/cleaning-assessment`,'PATCH',{...input,note:''})).status,400);
  const [[initial]]=await c.execute('SELECT version FROM work_order_cleaning_assessment WHERE job_id=?',[job.jobId]);
  const valid={...input,expectedVersion:initial?.version??0};const response=await req(`/api/technician/jobs/${job.jobId}/cleaning-assessment`,'PATCH',valid);assert.equal(response.status,200);assert.equal((await response.json()).method,'Chemical');
  assert.equal((await req(`/api/technician/jobs/${job.jobId}/cleaning-assessment`,'PATCH',{...valid,requestId:randomUUID()})).status,409);
  const [[repair]]=await c.execute("SELECT service_id FROM simple_service_catalog WHERE code='repair'");
  await c.execute('UPDATE booking SET service_id=? WHERE booking_id=?',[repair.service_id,job.bookingId]);
  assert.equal((await req(`/api/technician/jobs/${job.jobId}/cleaning-assessment`,'PATCH',{...valid,requestId:randomUUID(),expectedVersion:valid.expectedVersion+1})).status,400);
 }finally{await new Promise(r=>server.close(r));}
}));

test('annual bundle work orders expose only earlier completed reports in their own series without inferring old cleaning methods',async()=>fixture(async(db,c,job)=>{
 const [[previous]]=await c.execute(`SELECT b.booking_id AS bookingId,b.customer_id AS customerId,b.address_id AS addressId,w.job_id AS jobId
  FROM service_report r JOIN work_order w ON w.job_id=r.job_id JOIN booking b ON b.booking_id=w.booking_id
  WHERE w.current_status='Completed' AND w.job_id<>? ORDER BY w.job_id LIMIT 1`,[job.jobId]);assert.ok(previous);
 // Temporarily align the assigned test booking with the existing report customer.
 // All fixture edits and annual links roll back; the historical report itself is untouched.
 await c.execute('UPDATE booking SET customer_id=?,address_id=? WHERE booking_id=?',[previous.customerId,previous.addressId,job.bookingId]);
 const [[pack]]=await c.execute("SELECT package_id FROM simple_package_catalog WHERE code='annual-cleaning'");
 const [series]=await c.execute(`INSERT INTO annual_booking_series(customer_id,address_id,package_id,package_name,first_service_date,unit_count,total_amount,request_id)
  VALUES(?,?,?,'Annual Cleaning Bundle','2026-08-10',1,180,?)`,[previous.customerId,previous.addressId,pack.package_id,randomUUID()]);
 await c.execute(`INSERT INTO annual_booking_visit(booking_id,series_id,visit_number,scheduled_date,window_start,window_end) VALUES
  (?,?,1,'2026-08-10','2026-08-10','2026-11-10'),(?,?,2,'2026-11-10','2026-11-10','2027-02-10')`,[previous.bookingId,series.insertId,job.bookingId,series.insertId]);
 const detail=await getTechnicianJobDetails(db,job.technicianId,job.jobId);
 assert.equal(detail.job.annualSeriesId,series.insertId);assert.equal(detail.job.annualVisitNumber,2);assert.equal(detail.annualHistory.length,1);assert.equal(detail.annualHistory[0].jobId,previous.jobId);assert.equal(detail.annualHistory[0].cleaningMethod,null);
 assert.ok(detail.addressHistory.every(report=>report.address===detail.job.address));
}));
