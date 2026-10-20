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
