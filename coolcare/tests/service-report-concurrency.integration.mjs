import {after,test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import mysql from 'mysql2/promise';
import {getReport,saveReport} from '../server/technician-pages.mjs';

const config={host:process.env.DB_HOST,port:Number(process.env.DB_PORT),database:process.env.DB_NAME,dateStrings:true};
const pool=mysql.createPool({...config,user:process.env.DB_USER,password:process.env.DB_PASSWORD,connectionLimit:3});
const root=mysql.createPool({...config,user:'root',password:process.env.MYSQL_ROOT_PASSWORD,connectionLimit:2});
after(()=>Promise.all([pool.end(),root.end()]));

test('a report writer waiting on another edit rejects its stale version rather than overwriting the committed report',async()=>{
 let bookingId,assignmentId,jobId,blocker,pending;
 try{
  const [[source]]=await root.execute(`SELECT b.customer_id,b.address_id,b.service_id,a.technician_id,a.assigned_by_admin_id,t.user_id
   FROM work_order w JOIN booking b ON b.booking_id=w.booking_id JOIN assignment a ON a.assignment_id=w.assignment_id
   JOIN technician t ON t.technician_id=a.technician_id JOIN user_account u ON u.user_id=t.user_id WHERE u.status='Active' LIMIT 1`);
  assert.ok(source);
  const [booking]=await root.execute("INSERT INTO booking(customer_id,address_id,service_id,preferred_service_date,preferred_time_slot,slot_start,slot_end,booking_status,problem_description) VALUES (?,?,?,'2035-02-06','09:00 - 11:00','09:00:00','11:00:00','Completed',?)",[source.customer_id,source.address_id,source.service_id,'Concurrent report fixture '+randomUUID()]);bookingId=booking.insertId;
  const [assignment]=await root.execute("INSERT INTO assignment(booking_id,technician_id,assigned_by_admin_id,assignment_status) VALUES (?,?,?,'Completed')",[bookingId,source.technician_id,source.assigned_by_admin_id]);assignmentId=assignment.insertId;
  const [work]=await root.execute("INSERT INTO work_order(booking_id,assignment_id,appointment_date,appointment_time,current_status) VALUES (?,?,'2035-02-06 09:00:00','09:00:00','Completed')",[bookingId,assignmentId]);jobId=work.insertId;
  await root.execute("INSERT INTO service_report(job_id,work_performed,checklist_result,submitted_time) VALUES (?,'Original service notes','Cooling checked',CURRENT_TIMESTAMP)",[jobId]);
  const initial=await getReport(pool,source.user_id,jobId);
  blocker=await root.getConnection();await blocker.beginTransaction();
  await blocker.execute('SELECT booking_id FROM booking WHERE booking_id=? FOR UPDATE',[bookingId]);
  await blocker.execute("UPDATE service_report SET work_performed='Latest committed service notes' WHERE job_id=?",[jobId]);
  let signal;const lookupRead=new Promise(resolve=>{signal=resolve;});
  const observed={getConnection:async()=>{const c=await pool.getConnection();return {execute:async(sql,args)=>{const result=await c.execute(sql,args);if(sql==='SELECT booking_id FROM work_order WHERE job_id=?')signal();return result;},query:c.query.bind(c),beginTransaction:c.beginTransaction.bind(c),commit:c.commit.bind(c),rollback:c.rollback.bind(c),release:c.release.bind(c)};}};
  pending=saveReport(observed,source.user_id,jobId,{requestId:randomUUID(),expectedVersion:initial.version,report:{workPerformed:'Stale editor would overwrite new notes',checklist:'Cooling checked'}}).then(()=>({saved:true}),error=>({error}));
  let timer;
  try{await Promise.race([lookupRead,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Concurrent writer did not reach its booking lookup')),5000);})]);}finally{clearTimeout(timer);}
  await blocker.commit();
  const outcome=await pending;assert.equal(outcome.error?.status,409);assert.equal(outcome.saved,undefined);
  const final=await getReport(pool,source.user_id,jobId);assert.equal(final.report.workPerformed,'Latest committed service notes');
 }finally{
  if(blocker){await blocker.rollback();blocker.release();}
  if(pending)await pending;
  if(jobId){await root.execute('DELETE FROM service_report_revision WHERE job_id=?',[jobId]);await root.execute('DELETE FROM service_report WHERE job_id=?',[jobId]);await root.execute('DELETE FROM work_order WHERE job_id=?',[jobId]);}
  if(assignmentId)await root.execute('DELETE FROM assignment WHERE assignment_id=?',[assignmentId]);
  if(bookingId)await root.execute('DELETE FROM booking WHERE booking_id=?',[bookingId]);
 }
});
