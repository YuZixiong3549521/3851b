import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import mysql from 'mysql2/promise';
import {openPrivilegedFixtureConnection} from './privileged-fixture.mjs';
import {getReport,saveReport} from '../server/technician-pages.mjs';
import {getServiceProgress,updateServiceProgress} from '../server/service-progress.mjs';
import {updateTechnicianJobStatus,getTechnicianJobs} from '../server/technician.mjs';
const pool=mysql.createPool({host:process.env.DB_HOST,port:Number(process.env.DB_PORT),user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME,dateStrings:true,connectionLimit:4});
after(()=>pool.end());
test('start dates are enforced by the API, and simultaneous starts allow only one live visit per technician',async()=>{
 const c=await openPrivilegedFixtureConnection(),bookings=[],jobs=[],assignments=[];
 let userId,technicianId;
 try {
  await c.beginTransaction();
  const [[base]]=await c.query('SELECT customer_id,address_id,service_id FROM booking LIMIT 1');
  const [[admin]]=await c.query('SELECT user_id FROM admin_profile LIMIT 1');
  const [[role]]=await c.query("SELECT role_id FROM role WHERE role_name='Technician'");
  const [user]=await c.execute("INSERT INTO user_account(role_id,full_name,email,password_hash) VALUES (?,'Isolated visit start test',?,'unused-test-password')",[role.role_id,`visit-start-${randomUUID()}@coolcare.test`]);userId=user.insertId;
  const [tech]=await c.execute('INSERT INTO technician(user_id) VALUES (?)',[userId]);technicianId=tech.insertId;
  for(let i=0;i<2;i++){
   const [b]=await c.execute("INSERT INTO booking(customer_id,address_id,service_id,preferred_service_date,preferred_time_slot,booking_status,total_amount) VALUES (?,?,?,DATE(DATE_ADD(UTC_TIMESTAMP(),INTERVAL 8 HOUR)),'09:00 - 11:00','Assigned',100)",[base.customer_id,base.address_id,base.service_id]);bookings.push(b.insertId);
   const [a]=await c.execute("INSERT INTO assignment(booking_id,technician_id,assigned_by_admin_id,assignment_status) VALUES (?,?,?,'Assigned')",[b.insertId,technicianId,admin.user_id]);assignments.push(a.insertId);
   const [w]=await c.execute("INSERT INTO work_order(booking_id,assignment_id,appointment_date,appointment_time,current_status) VALUES (?,?,DATE(DATE_ADD(UTC_TIMESTAMP(),INTERVAL 8 HOUR)),'00:00:00','Assigned')",[b.insertId,a.insertId]);jobs.push(w.insertId);
  }
  await c.commit();
  const input=()=>({requestId:randomUUID(),expectedStatus:'Assigned',status:'In Progress'});
  await c.execute('UPDATE work_order SET appointment_date=DATE_ADD(appointment_date,INTERVAL 1 DAY) WHERE job_id=?',[jobs[0]]);
  await assert.rejects(updateTechnicianJobStatus(pool,userId,jobs[0],input()),e=>e.status===409&&/scheduled date/.test(e.message));
  assert.equal((await getTechnicianJobs(pool,technicianId,jobs[0]))[0].canStart,false);
  await c.execute("UPDATE work_order SET current_status='In Progress' WHERE job_id=?",[jobs[0]]);
  await assert.rejects(updateTechnicianJobStatus(pool,userId,jobs[0],{requestId:randomUUID(),expectedStatus:'In Progress',status:'Completed'}),e=>e.status===409&&/future service/.test(e.message));
  const futureDraft=await getReport(pool,userId,jobs[0]);assert.equal(futureDraft.canEdit,false);
  await assert.rejects(saveReport(pool,userId,jobs[0],{requestId:randomUUID(),expectedVersion:futureDraft.version,report:{workPerformed:'Cannot complete a future visit',checklist:'Checks recorded',problemFound:'',solutionApplied:'',customerSignatureUrl:'',technicianSignatureUrl:''}}),e=>e.status===409&&/future service/.test(e.message));
  await c.execute("UPDATE work_order SET current_status='Assigned' WHERE job_id=?",[jobs[0]]);
  await c.execute('UPDATE work_order SET appointment_date=DATE_SUB(appointment_date,INTERVAL 2 DAY) WHERE job_id=?',[jobs[0]]);
  await assert.rejects(updateTechnicianJobStatus(pool,userId,jobs[0],input()),e=>e.status===409&&/passed/.test(e.message));
  await c.execute('UPDATE work_order SET appointment_date=DATE_ADD(appointment_date,INTERVAL 1 DAY) WHERE job_id=?',[jobs[0]]);
  const requests=jobs.map(input);
  const results=await Promise.allSettled(jobs.map((id,i)=>updateTechnicianJobStatus(pool,userId,id,requests[i])));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1,JSON.stringify(results));
  const failed=results.find(r=>r.status==='rejected');assert.equal(failed.reason.status,409);assert.match(failed.reason.message,/before starting another service/);
  const winner=results.findIndex(r=>r.status==='fulfilled');
  assert.equal((await updateTechnicianJobStatus(pool,userId,jobs[winner],requests[winner])).replayed,true);
  const [active]=await c.execute("SELECT job_id FROM work_order WHERE job_id IN (?,?) AND current_status='In Progress'",jobs);assert.equal(active.length,1);
  const [reports]=await c.execute('SELECT report_id,visit_technician_id,visit_service_date,visit_start_time FROM service_report WHERE job_id IN (?,?)',jobs);assert.equal(reports.length,1);assert.equal(reports[0].visit_technician_id,technicianId);assert.ok(reports[0].visit_service_date);
  await c.execute("UPDATE booking SET service_id=(SELECT service_id FROM simple_service_catalog WHERE code='repair') WHERE booking_id=?",[bookings[winner]]);
  await c.execute("INSERT INTO booking_completion_reward(booking_id,outcome,note) VALUES (?,'Historical','Isolated completed return fixture')",[bookings[winner]]);
  const frozen=await getServiceProgress(pool,jobs[winner]);assert.equal(frozen.repairQuoteLocked,true);
  await assert.rejects(updateServiceProgress(pool,userId,jobs[winner],{requestId:randomUUID(),expectedVersion:frozen.version,action:'repair-quote',amount:50,notes:'Must not change completed money on a later visit.'}),e=>e.status===409&&/charges are locked/.test(e.message));
  const [[otherTech]]=await c.execute('SELECT technician_id FROM technician WHERE technician_id<>? LIMIT 1',[technicianId]);
  await c.execute('UPDATE service_report SET visit_technician_id=? WHERE job_id=?',[otherTech.technician_id,jobs[winner]]);
  await assert.rejects(updateTechnicianJobStatus(pool,userId,jobs[winner],{requestId:randomUUID(),expectedStatus:'In Progress',status:'Completed',report:{workPerformed:'Must not overwrite a predecessor report',checklist:'Checks',problemFound:'',solutionApplied:''}}),e=>e.status===409&&/previous technician/.test(e.message));
  const [[untouched]]=await c.execute('SELECT work_performed FROM service_report WHERE job_id=?',[jobs[winner]]);assert.equal(untouched.work_performed,'');
  const loser=1-winner;const [blocked]=await getTechnicianJobs(pool,technicianId,jobs[loser]);assert.equal(blocked.canStart,false);assert.match(blocked.startBlockedReason,/before starting another service/);
 } finally {
  await c.rollback();
  await c.beginTransaction();
  for(const id of jobs){
   await c.execute('DELETE FROM technician_work_operation WHERE job_id=?',[id]);
   await c.execute('DELETE FROM performance_visit WHERE job_id=?',[id]);
   await c.execute('DELETE vm FROM visit_member vm JOIN service_report r ON r.report_id=vm.report_id WHERE r.job_id=? OR r.archived_job_id=?',[id,id]);
   await c.execute('DELETE FROM service_report WHERE job_id=? OR archived_job_id=?',[id,id]);
   await c.execute('DELETE FROM work_order WHERE job_id=?',[id]);
  }
  for(const id of assignments)await c.execute('DELETE FROM assignment WHERE assignment_id=?',[id]);
  for(const id of bookings){await c.execute('DELETE FROM booking_completion_reward WHERE booking_id=?',[id]);await c.execute('DELETE FROM booking_status_history WHERE booking_id=?',[id]);await c.execute('DELETE FROM booking WHERE booking_id=?',[id]);}
  if(technicianId)await c.execute('DELETE FROM technician WHERE technician_id=?',[technicianId]);
  if(userId)await c.execute('DELETE FROM user_account WHERE user_id=?',[userId]);
  await c.commit();await c.end();
 }
});

test('local timing test mode runs future visits through both completion paths without relaxing ownership or duplicate protections',async()=>{
 const c=await openPrivilegedFixtureConnection();
 const oldMode=process.env.SERVICE_TIMING_TEST_MODE,oldEnvironment=process.env.NODE_ENV;
 // Keep every synthetic account, order, report, performance visit and reward in
 // one outer transaction. Application commits release a savepoint only.
 const executor={execute:c.execute.bind(c),query:c.query.bind(c),
  beginTransaction:()=>c.query('SAVEPOINT timing_mode_operation'),
  commit:()=>c.query('RELEASE SAVEPOINT timing_mode_operation'),
  rollback:()=>c.query('ROLLBACK TO SAVEPOINT timing_mode_operation'),release(){}};
 const db={...executor,getConnection:async()=>executor};
 try {
  process.env.SERVICE_TIMING_TEST_MODE='true';
  process.env.NODE_ENV='test';
  await c.beginTransaction();
  const [[admin]]=await c.query('SELECT user_id FROM admin_profile LIMIT 1');
  const [[service]]=await c.query("SELECT service_id FROM simple_service_catalog WHERE code='cleaning' LIMIT 1");
  const [[date]]=await c.query("SELECT DATE_FORMAT(DATE_ADD(UTC_TIMESTAMP(),INTERVAL 90 DAY),'%Y-%m-%d') AS scheduledDate");
  const users=[];
  for(const [role,name] of [['Customer','Timing mode customer'],['Technician','Timing mode technician'],['Technician','Timing mode other technician']]){
   const [u]=await c.execute(`INSERT INTO user_account(role_id,full_name,email,password_hash)
     SELECT role_id,?,?,'disabled-test-password' FROM role WHERE role_name=?`,[name,`timing-mode-${randomUUID()}@coolcare.test`,role]);
   users.push(u.insertId);
  }
  const [customer]=await c.execute('INSERT INTO customer(user_id) VALUES (?)',[users[0]]);
  const [address]=await c.execute('INSERT INTO service_address(customer_id,address_line,postal_code) VALUES (?,?,?)',[customer.insertId,'Isolated service timing test address','560123']);
  const [tech]=await c.execute('INSERT INTO technician(user_id) VALUES (?)',[users[1]]);
  await c.execute('INSERT INTO technician(user_id) VALUES (?)',[users[2]]);
  const bookings=[],jobs=[];
  for(let i=0;i<2;i++){
   const [b]=await c.execute("INSERT INTO booking(customer_id,address_id,service_id,preferred_service_date,preferred_time_slot,booking_status,total_amount) VALUES (?,?,?,?,'09:00 - 11:00','Assigned',100)",[customer.insertId,address.insertId,service.service_id,date.scheduledDate]);
   bookings.push(b.insertId);
   const [a]=await c.execute("INSERT INTO assignment(booking_id,technician_id,assigned_by_admin_id,assignment_status) VALUES (?,?,?,'Assigned')",[b.insertId,tech.insertId,admin.user_id]);
   const [w]=await c.execute("INSERT INTO work_order(booking_id,assignment_id,appointment_date,appointment_time,current_status) VALUES (?,?,?,'09:00:00','Assigned')",[b.insertId,a.insertId,date.scheduledDate]);
   jobs.push(w.insertId);
  }
  const start=()=>({requestId:randomUUID(),expectedStatus:'Assigned',status:'In Progress'});
  const firstStart=start(),secondStart=start();
  const [available]=await getTechnicianJobs(db,tech.insertId,jobs[0]);
  assert.equal(available.serviceTimingTestMode,true);
  assert.equal(available.canStart,true);
  assert.equal(available.canComplete,true);
  await assert.rejects(updateTechnicianJobStatus(db,users[2],jobs[0],start()),e=>e.status===404);
  await assert.rejects(updateTechnicianJobStatus(db,users[1],jobs[0],{requestId:randomUUID(),expectedStatus:'In Progress',status:'Completed'}),e=>e.status===409&&/status step/.test(e.message));
  await updateTechnicianJobStatus(db,users[1],jobs[0],firstStart);
  assert.equal((await updateTechnicianJobStatus(db,users[1],jobs[0],firstStart)).replayed,true);
  const [blocked]=await getTechnicianJobs(db,tech.insertId,jobs[1]);
  assert.equal(blocked.canStart,false);
  assert.match(blocked.startBlockedReason,/before starting another service/);
  await assert.rejects(updateTechnicianJobStatus(db,users[1],jobs[1],secondStart),e=>e.status===409&&/before starting another service/.test(e.message));
  await assert.rejects(getReport(db,users[2],jobs[0]),e=>e.status===404);
  assert.equal((await getReport(db,users[1],jobs[0])).canEdit,true);
  const end={requestId:randomUUID(),expectedStatus:'In Progress',status:'Completed'};
  await updateTechnicianJobStatus(db,users[1],jobs[0],end);
  assert.equal((await updateTechnicianJobStatus(db,users[1],jobs[0],end)).replayed,true);
  const report={workPerformed:'Synthetic future visit completed in local test mode',problemFound:'',solutionApplied:'Filters cleaned',checklist:'Cooling checked',customerSignatureUrl:'',technicianSignatureUrl:''};
  const ended=await getReport(db,users[1],jobs[0]);
  const firstSubmission={requestId:randomUUID(),expectedVersion:ended.version,report};
  await saveReport(db,users[1],jobs[0],firstSubmission);
  assert.equal((await saveReport(db,users[1],jobs[0],firstSubmission)).replayed,true);
  await updateTechnicianJobStatus(db,users[1],jobs[1],secondStart);
  const draft=await getReport(db,users[1],jobs[1]);
  assert.equal(draft.canEdit,true);
  const secondSubmission={requestId:randomUUID(),expectedVersion:draft.version,report};
  await assert.rejects(saveReport(db,users[2],jobs[1],secondSubmission),e=>e.status===404);
  await saveReport(db,users[1],jobs[1],secondSubmission);
  assert.equal((await saveReport(db,users[1],jobs[1],secondSubmission)).replayed,true);
  const [visits]=await c.execute(`SELECT w.current_status,b.booking_status,a.assignment_status,
    DATE_FORMAT(w.appointment_date,'%Y-%m-%d') AS scheduledDate,w.appointment_time AS scheduledTime,
    DATE_FORMAT(r.visit_service_date,'%Y-%m-%d') AS reportDate,r.visit_start_time AS reportTime,
    r.visit_technician_id AS reportTechnician,
    ABS(TIMESTAMPDIFF(SECOND,r.started_at,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 8 HOUR))) AS startedSecondsAgo,
    ABS(TIMESTAMPDIFF(SECOND,r.completed_at,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 8 HOUR))) AS completedSecondsAgo,
    (r.completed_at>=r.started_at) AS chronological,
    (p.scheduled_start=TIMESTAMP(DATE(w.appointment_date),w.appointment_time)) AS performanceSchedulePreserved,
    (p.actual_start=r.started_at AND ABS(TIMESTAMPDIFF(SECOND,p.actual_end,r.completed_at))<=2) AS actualPerformanceTimes
    FROM work_order w JOIN booking b ON b.booking_id=w.booking_id JOIN assignment a ON a.assignment_id=w.assignment_id
    JOIN service_report r ON r.job_id=w.job_id JOIN performance_visit p ON p.report_id=r.report_id
    WHERE w.job_id IN (?,?)`,jobs);
  assert.equal(visits.length,2);
  for(const visit of visits){
   assert.equal(visit.current_status,'Completed');
   assert.equal(visit.booking_status,'Completed');
   assert.equal(visit.assignment_status,'Completed');
   assert.equal(visit.scheduledDate,date.scheduledDate);
   assert.equal(visit.reportDate,date.scheduledDate);
   assert.equal(visit.scheduledTime,'09:00:00');
   assert.equal(visit.reportTime,'09:00:00');
   assert.equal(visit.reportTechnician,tech.insertId);
   assert.ok(Number.isFinite(visit.startedSecondsAgo)&&visit.startedSecondsAgo>=0&&visit.startedSecondsAgo<120);
   assert.ok(Number.isFinite(visit.completedSecondsAgo)&&visit.completedSecondsAgo>=0&&visit.completedSecondsAgo<120);
   assert.equal(visit.chronological,1);
   assert.equal(visit.performanceSchedulePreserved,1);
   assert.equal(visit.actualPerformanceTimes,1);
  }
  const [[counts]]=await c.execute(`SELECT
    (SELECT COUNT(*) FROM service_report_revision WHERE job_id IN (?,?)) AS revisions,
    (SELECT COUNT(*) FROM service_visit_record WHERE job_id IN (?,?)) AS visits,
    (SELECT COUNT(*) FROM booking_status_history WHERE booking_id IN (?,?)) AS transitions,
    (SELECT COUNT(*) FROM booking_completion_reward WHERE booking_id IN (?,?)) AS rewards,
    (SELECT COUNT(*) FROM loyalty_transaction WHERE booking_id IN (?,?) AND transaction_type='Earned') AS earnings`,[...jobs,...jobs,...bookings,...bookings,...bookings]);
  assert.equal(counts.revisions,2);
  assert.equal(counts.visits,2);
  assert.equal(counts.transitions,4);
  assert.equal(counts.rewards,2);
  const [[rule]]=await c.query('SELECT points_per_dollar FROM reward_rule WHERE rule_id=1');
  assert.equal(counts.earnings,Number(rule.points_per_dollar)>0?2:0);
 } finally {
  if(oldMode===undefined)delete process.env.SERVICE_TIMING_TEST_MODE;else process.env.SERVICE_TIMING_TEST_MODE=oldMode;
  if(oldEnvironment===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=oldEnvironment;
  await c.rollback();
  await c.end();
 }
});
