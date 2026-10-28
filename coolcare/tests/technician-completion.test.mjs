import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {statusUpdateSchema,updateTechnicianJobStatus} from '../server/technician.mjs';
const report={workPerformed:'Cleaned filters and inspected unit',problemFound:'Dust',solutionApplied:'Filter cleaning',checklist:'Cooling and drainage checked'};
const payload=()=>({requestId:randomUUID(),expectedStatus:'In Progress',status:'Completed',report});
test('ending service allows a pending report; submitted reports still require valid content',()=>{
 const data=payload();assert.equal(statusUpdateSchema.parse({...data,report:undefined}).report,undefined);
 assert.throws(()=>statusUpdateSchema.parse({...data,report:{...report,workPerformed:' '}}));
 assert.throws(()=>statusUpdateSchema.parse({...data,report:{...report,checklist:''}}));
 assert.equal(statusUpdateSchema.parse(data).report.workPerformed,report.workPerformed);
});
function database({owner=true,failReport=false,failReward=false,failBonus=false,previous=null,status='In Progress'}={}){
 const calls=[];const conn={beginTransaction:async()=>calls.push('begin'),commit:async()=>calls.push('commit'),rollback:async()=>calls.push('rollback'),release:()=>calls.push('release'),execute:async(sql,args)=>{
 calls.push(sql);
 if(sql.startsWith('SELECT t.technician_id AS technicianId'))return [[{technicianId:7,fullName:'Test technician',userId:7,isLead:1}]];
 if(sql.startsWith('SELECT booking_id'))return [[{booking_id:2}]];
 if(sql.startsWith('SELECT w.assignment_id'))return [[{report_id:1,technician_id:7,started_at:null}]];
 if(sql.startsWith('SELECT w.*'))return [owner?[{job_id:1,booking_id:2,assignment_id:3,current_status:status,booking_status:status,assignment_status:'Accepted',technician_id:7,serviceDate:new Date(Date.now()+8*3600000).toISOString().slice(0,10),serviceTime:'00:00:00'}]:[]];
 if(sql.startsWith('SELECT w.job_id FROM work_order'))return [[]];
 if(sql.startsWith('SELECT payload_hash'))return [previous?[previous]:[]];
 if(sql.startsWith('SELECT * FROM booking'))return [[{booking_id:2,customer_id:4,booking_status:'Completed',total_amount:100}]];
 if(sql.startsWith('SELECT * FROM loyalty_account'))return [[{loyalty_account_id:5,current_points:0}]];
 if(sql.startsWith('SELECT p.additional_repair_fee')||sql.startsWith('SELECT * FROM reward_reservation'))return [[]];
 if(sql.startsWith('SELECT version,points_per_dollar'))return [[{version:1,pointsPerDollar:1,redemptionPoints:100,redemptionValue:5}]];
 if(sql.startsWith('SELECT bonus.*'))return [failBonus?[{renewed_series_id:11,points:100,loyalty_transaction_id:null}]:[]];
 if(failBonus&&sql.startsWith('UPDATE annual_renewal_bonus'))throw new Error('renewal bonus persistence failed');
 if(failReport&&sql.includes('INSERT INTO service_report'))throw new Error('report persistence failed');
 if(failReward&&sql.includes('INSERT INTO loyalty_transaction'))throw new Error('reward persistence failed');
 return [{affectedRows:1}];
 }};conn.query=conn.execute;return {calls,getConnection:async()=>conn};
}
test('an unowned job cannot write a report or status',async()=>{const db=database({owner:false});await assert.rejects(updateTechnicianJobStatus(db,7,1,payload()),e=>e.status===404);assert.ok(db.calls.includes('rollback'));assert.ok(!db.calls.some(s=>s.startsWith('UPDATE')));});
test('failed report storage rolls back before any completion status is written',async()=>{const db=database({failReport:true});await assert.rejects(updateTechnicianJobStatus(db,7,1,payload()),/report persistence/);assert.ok(db.calls.includes('rollback'));assert.ok(!db.calls.includes('commit'));assert.ok(!db.calls.some(s=>s.startsWith('UPDATE work_order')));});
test('completion saves the report, rewards and all status tables in one transaction',async()=>{const db=database();await updateTechnicianJobStatus(db,7,1,payload());for(const table of ['work_order','booking','assignment'])assert.ok(db.calls.some(s=>s.startsWith('UPDATE '+table)));assert.ok(db.calls.some(s=>s.includes('INSERT INTO service_report')));assert.ok(db.calls.some(s=>s.includes('INSERT INTO technician_work_operation')));const rewardIndex=db.calls.findIndex(s=>s.startsWith('INSERT INTO loyalty_transaction'));assert.ok(rewardIndex>=0&&rewardIndex<db.calls.indexOf('commit'));assert.ok(db.calls.includes('commit'));});
test('failed reward storage rolls back completion and does not acknowledge success',async()=>{const db=database({failReward:true});await assert.rejects(updateTechnicianJobStatus(db,7,1,payload()),/reward persistence/);assert.ok(db.calls.some(s=>s.startsWith('UPDATE booking')));assert.ok(db.calls.includes('rollback'));assert.ok(!db.calls.includes('commit'));assert.ok(!db.calls.some(s=>s.includes('INSERT INTO technician_work_operation')));});

test('failed early-renewal bonus storage rolls back service completion and normal points together',async()=>{const db=database({failBonus:true});await assert.rejects(updateTechnicianJobStatus(db,7,1,payload()),/renewal bonus persistence/);assert.ok(db.calls.some(s=>s.startsWith('UPDATE booking')));assert.ok(db.calls.includes('rollback'));assert.ok(!db.calls.includes('commit'));assert.ok(!db.calls.some(s=>s.includes('INSERT INTO technician_work_operation')));});
test('reusing a request ID with changed content conflicts',async()=>{const db=database({previous:{payload_hash:'different'}});await assert.rejects(updateTechnicianJobStatus(db,7,1,payload()),e=>e.status===409);assert.ok(db.calls.includes('rollback'));});
test('a completed job cannot be completed again with a new request',async()=>{const db=database({status:'Completed'});await assert.rejects(updateTechnicianJobStatus(db,7,1,payload()),e=>e.status===409);});

test('assigned jobs can start service directly',async()=>{const db=database({status:'Assigned'});await updateTechnicianJobStatus(db,7,1,{requestId:randomUUID(),expectedStatus:'Assigned',status:'In Progress'});assert.ok(db.calls.includes('commit'));});
test('end service records completion without submitting report text',async()=>{const db=database();await updateTechnicianJobStatus(db,7,1,{...payload(),report:undefined});assert.ok(db.calls.includes('commit'));assert.ok(db.calls.some(s=>s.includes('completed_at')));assert.ok(!db.calls.some(s=>s.includes('submitted_time')));});
