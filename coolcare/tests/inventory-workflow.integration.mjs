import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import {randomUUID} from 'node:crypto';
import {createApp} from '../server/app.mjs';
import {savePart,recordTransaction,editTransaction} from '../server/inventory.mjs';
const pool=mysql.createPool({host:process.env.DB_HOST,port:Number(process.env.DB_PORT),user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME,dateStrings:true,decimalNumbers:true,connectionLimit:5});
after(()=>pool.end());
function nestedPool(c){const handle={execute:c.execute.bind(c),query:c.query.bind(c),beginTransaction:()=>c.query('SAVEPOINT inventory_workflow'),commit:()=>c.query('RELEASE SAVEPOINT inventory_workflow'),rollback:()=>c.query('ROLLBACK TO SAVEPOINT inventory_workflow'),release:()=>{}};return {execute:c.execute.bind(c),query:c.query.bind(c),getConnection:async()=>handle};}
async function rollback(work){const c=await pool.getConnection();await c.beginTransaction();try{await work(nestedPool(c),c);}finally{await c.rollback();c.release();}}
async function actors(c){const [[admin]]=await c.execute('SELECT user_id FROM admin_profile ORDER BY user_id LIMIT 1');return admin.user_id;}

test('inbound/outbound corrections update only the delta, preserve audit, reject stale versions and roll back failures',async()=>rollback(async(db,c)=>{
 const admin=await actors(c);
 const part=await savePart(db,{part_name:`Inventory workflow ${randomUUID()}`,unit_price:'5',status:'Active',recommended_units_per_ac:2,stock_unit:'metre',usage_note:'Test allowance'});
 const movement={request_id:randomUUID(),part_id:part.part_id,transaction_type:'Stock In',quantity:10,expected_stock:0};
 const received=await recordTransaction(db,movement,admin);
 const correction={request_id:randomUUID(),expected_version:1,quantity:15,occurred_at:'2026-09-01T10:15:00',remarks:'Corrected inbound count'};
 const updated=await editTransaction(db,received.transaction_id,correction,admin);assert.equal(updated.stock_after,15);assert.equal(updated.version,2);
 const retry=await editTransaction(db,received.transaction_id,correction,admin);assert.equal(retry.replayed,true);assert.equal(retry.stock_after,15);
 await assert.rejects(editTransaction(db,received.transaction_id,{...correction,quantity:16},admin),/different correction/);
 await assert.rejects(editTransaction(db,received.transaction_id,{...correction,request_id:randomUUID()},admin),/edited elsewhere/);
 const [[row]]=await c.execute('SELECT * FROM inventory_transaction WHERE transaction_id=?',[received.transaction_id]);assert.equal(row.quantity,15);assert.equal(row.version,2);assert.ok(row.modified_at);assert.equal(row.created_at,'2026-09-01 10:15:00');
 const [[audit]]=await c.execute('SELECT * FROM inventory_transaction_revision WHERE transaction_id=?',[received.transaction_id]);assert.equal(audit.before_quantity,10);assert.equal(audit.after_quantity,15);assert.equal(audit.stock_delta,5);assert.equal(audit.changed_by_user_id,admin);
 const out=await recordTransaction(db,{...movement,request_id:randomUUID(),transaction_type:'Stock Out',quantity:14,expected_stock:15},admin);
 await assert.rejects(editTransaction(db,received.transaction_id,{...correction,request_id:randomUUID(),expected_version:2,quantity:10},admin),/Not enough stock/);
 const reduced=await editTransaction(db,out.transaction_id,{...correction,request_id:randomUUID(),quantity:12},admin);assert.equal(reduced.stock_after,3);
 const described=await editTransaction(db,out.transaction_id,{...correction,request_id:randomUUID(),expected_version:2,quantity:12,remarks:'Description-only correction'},admin);assert.equal(described.stock_after,3);
 const normal=await db.getConnection();const failing={getConnection:async()=>({...normal,execute:async(sql,values)=>{if(sql.startsWith('UPDATE part SET current_stock'))throw new Error('Injected stock failure');return normal.execute(sql,values);}})};
 await assert.rejects(editTransaction(failing,out.transaction_id,{...correction,request_id:randomUUID(),expected_version:3,quantity:11},admin),/Injected stock failure/);
 const [[after]]=await c.execute('SELECT quantity,version FROM inventory_transaction WHERE transaction_id=?',[out.transaction_id]);assert.deepEqual(after,{quantity:12,version:3});
 const [[revisions]]=await c.execute('SELECT COUNT(*) AS n FROM inventory_transaction_revision WHERE transaction_id=?',[out.transaction_id]);assert.equal(revisions.n,2);
 const [[stock]]=await c.execute('SELECT current_stock FROM part WHERE part_id=?',[part.part_id]);assert.equal(stock.current_stock,3);
}));

test('technician stock-out requires own work order, explicit excess acknowledgement, real stock and CSRF; admin alone edits audit-backed records',async()=>rollback(async(db,c)=>{
 const admin=await actors(c),part=await savePart(db,{part_name:`Technician stock ${randomUUID()}`,unit_price:'1',status:'Active',recommended_units_per_ac:1});
 const received=await recordTransaction(db,{request_id:randomUUID(),part_id:part.part_id,transaction_type:'Stock In',quantity:20,expected_stock:0},admin);
 const server=createApp({pool:db,secret:process.env.SESSION_SECRET}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 let cookie='',csrf='';
 async function req(path,method='GET',body){const response=await fetch(`http://127.0.0.1:${server.address().port}`+path,{method,headers:{Cookie:cookie,'Content-Type':'application/json','X-CSRF-Token':csrf},body:body===undefined?undefined:JSON.stringify(body)});if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];return response;}
 try{
  assert.equal((await req('/api/technician/jobs')).status,401);csrf=(await(await req('/api/session')).json()).csrf;
  csrf=(await(await req('/api/public/login','POST',{email:'chris.lim@coolcare.demo',password:'CoolCareDemo2026!'})).json()).csrf;
  const {jobs}=await(await req('/api/technician/jobs')).json();const job=jobs[0];assert.ok(job);
  const detail=await(await req(`/api/technician/jobs/${job.jobId}`)).json();assert.equal(detail.job.address,job.address);assert.ok(Array.isArray(detail.addressHistory));assert.ok(detail.addressHistory.length<=3);assert.ok(Array.isArray(detail.packageHistory));
  const options=await(await req(`/api/technician/jobs/${job.jobId}/parts`)).json();const selected=options.parts.find(p=>p.part_id===part.part_id);assert.equal(selected.recommended,job.acCount);
  const excess={request_id:randomUUID(),part_id:part.part_id,quantity:selected.recommended+1,expected_stock:20};
  let response=await req(`/api/technician/jobs/${job.jobId}/stock-out`,'POST',excess);assert.equal(response.status,409);assert.match((await response.json()).error,/explicitly acknowledge/);
  const accepted={...excess,acknowledge_excess:true};response=await req(`/api/technician/jobs/${job.jobId}/stock-out`,'POST',accepted);assert.equal(response.status,201);const saved=await response.json();assert.equal(saved.stock_after,20-excess.quantity);
  const retry=await(await req(`/api/technician/jobs/${job.jobId}/stock-out`,'POST',accepted)).json();assert.equal(retry.replayed,true);assert.equal(retry.transaction_id,saved.transaction_id);
  const [[actor]]=await c.execute('SELECT admin_user_id,performed_by_user_id FROM inventory_transaction WHERE transaction_id=?',[saved.transaction_id]);assert.equal(actor.admin_user_id,null);assert.ok(actor.performed_by_user_id);
  assert.equal((await req(`/api/technician/jobs/${job.jobId}/stock-out`,'POST',{...accepted,request_id:randomUUID(),transaction_type:'Stock In'})).status,403);
  const [[otherJob]]=await c.execute(`SELECT w.job_id FROM work_order w JOIN assignment a ON a.assignment_id=w.assignment_id JOIN technician t ON t.technician_id=a.technician_id JOIN user_account u ON u.user_id=t.user_id WHERE u.email='farah.ahmad@coolcare.demo' LIMIT 1`);
  assert.ok(otherJob);assert.equal((await req(`/api/technician/jobs/${otherJob.job_id}/parts`)).status,404);assert.equal((await req(`/api/technician/jobs/${otherJob.job_id}/stock-out`,'POST',{...accepted,request_id:randomUUID(),expected_stock:saved.stock_after})).status,404);
  assert.equal((await req(`/api/technician/jobs/${job.jobId}/stock-out`,'POST',{...accepted,request_id:randomUUID(),quantity:100,expected_stock:saved.stock_after})).status,409);
  assert.equal((await req(`/api/transactions/${received.transaction_id}`,'PUT',{})).status,401);
  const goodCsrf=csrf;csrf='invalid';assert.equal((await req(`/api/technician/jobs/${job.jobId}/stock-out`,'POST',accepted)).status,403);csrf=goodCsrf;
  csrf=(await(await req('/api/login','POST',{email:'norshida@coolcare.demo',password:'CoolCareDemo2026!'})).json()).csrf;
  const edit={request_id:randomUUID(),expected_version:1,quantity:excess.quantity-1,occurred_at:'2026-09-11T10:30',remarks:'Admin verified count'};
  assert.equal((await req(`/api/transactions/${saved.transaction_id}`,'PUT',edit)).status,200);
  const corrected=await(await req(`/api/transactions/${saved.transaction_id}`)).json();assert.equal(corrected.transaction.quantity,excess.quantity-1);assert.equal(corrected.revisions.length,1);assert.ok(corrected.revisions[0].changed_by_name);
 }finally{await new Promise(r=>server.close(r));}
}));

test('concurrent stock operations wait on the part lock and cannot read uncommitted stock',async()=>{
 const first=await pool.getConnection(),second=await pool.getConnection();
 await first.beginTransaction();await second.beginTransaction();
 try{
  const [[part]]=await first.execute("SELECT * FROM part WHERE status='Active' AND current_stock>0 ORDER BY part_id LIMIT 1 FOR UPDATE");
  const admin=await actors(first);
  await first.execute('UPDATE part SET current_stock=current_stock+1 WHERE part_id=?',[part.part_id]);
  let settled=false;
  const waiting=recordTransaction(nestedPool(second),{request_id:randomUUID(),part_id:part.part_id,transaction_type:'Stock In',quantity:1,expected_stock:part.current_stock},admin).finally(()=>{settled=true;});
  await new Promise(r=>setTimeout(r,100));assert.equal(settled,false,'The second operation must wait while the part is locked.');
  await first.rollback();const result=await waiting;assert.equal(result.stock_before,part.current_stock);assert.equal(result.stock_after,part.current_stock+1);
 }finally{await first.rollback();await second.rollback();first.release();second.release();}
});
