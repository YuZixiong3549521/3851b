import { test,after } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import mysql from 'mysql2/promise';
import { lockCustomer } from '../server/customer/booking-options.mjs';
import { getAssistantDraft,saveAssistantDraft,newAssistantDraft } from '../server/customer/assistant-workflow.mjs';

const pool=mysql.createPool({host:process.env.DB_HOST,port:Number(process.env.DB_PORT),user:process.env.DB_USER,
  password:process.env.DB_PASSWORD,database:process.env.DB_NAME,dateStrings:true,decimalNumbers:true,connectionLimit:3});
after(()=>pool.end());

test('assistant mutations wait on the same customer row lock as normal bookings, then roll back without storing a draft', {timeout:10000}, async()=>{
  const [[user]]=await pool.execute(`SELECT u.user_id AS id,u.phone FROM customer c JOIN user_account u ON u.user_id=c.user_id
    WHERE u.status='Active' ORDER BY (u.email='alice.tan@coolcare.demo'),c.customer_id LIMIT 1`);
  assert.ok(user,'A seeded customer is required for the read-only lock holder.');
  const holder=await pool.getConnection();
  let mutation,writer;
  let reachedCustomerLock;
  const lockAttempted=new Promise(resolve=>{reachedCustomerLock=resolve;});
  let settled=false;
  try {
    await holder.beginTransaction();
    // This is the exact shared lock used by both existing booking creators.
    await lockCustomer(holder,user.id);
    const {state:before}=await getAssistantDraft(holder,user);
    const rollbackOnlyPool={getConnection:async()=>{
      writer=await pool.getConnection();
      return {
        query:writer.query.bind(writer),
        execute:(sql,values)=>{
          if(sql.includes('FROM customer')&&sql.includes('FOR UPDATE'))reachedCustomerLock();
          return writer.execute(sql,values);
        },
        beginTransaction:writer.beginTransaction.bind(writer),
        // The workflow executes a real transaction on a separate connection;
        // only its final commit is replaced, so no fixture records can persist.
        commit:writer.rollback.bind(writer),rollback:writer.rollback.bind(writer),release:()=>{},
      };
    }};
    mutation=before
      ?newAssistantDraft(rollbackOnlyPool,user,{expectedUserId:user.id,draftId:before.draftId,revision:before.revision})
      :saveAssistantDraft(rollbackOnlyPool,user,{expectedUserId:user.id,draftId:null,revision:0,draft:{
        step:'service',numberOfUnits:2,serviceAddress:'',phone:'',preferredDate:'',timeWindow:'09:00 AM - 11:00 AM',notes:'',
      }});
    mutation.then(()=>{settled=true;},()=>{settled=true;});
    await Promise.race([lockAttempted,delay(2000).then(()=>{throw new Error('The assistant did not reach its customer lock.');})]);
    await delay(150);
    assert.equal(settled,false,'The assistant must not read or mutate a draft while another booking transaction owns its customer lock.');
    await holder.rollback();
    const result=await mutation;
    assert.equal(result.state.userId,user.id);
    assert.equal(result.state.status,'editing');
    assert.ok(result.state.draftId);
    assert.notEqual(result.state.draftId,before?.draftId);
    const [[created]]=await pool.execute('SELECT COUNT(*) AS count FROM assistant_booking_draft WHERE draft_id=?',[result.state.draftId]);
    assert.equal(created.count,0,'The successful workflow was rolled back instead of leaving a test draft in the customer account.');
    const {state:after}=await getAssistantDraft(pool,user);
    assert.deepEqual(after,before,'The original customer draft and receipt remain unchanged.');
  }finally {
    // Release the holder first even when an assertion fails, so the writer can
    // finish and roll back instead of leaving an outstanding lock or promise.
    await holder.rollback();
    if(mutation)await mutation.catch(()=>undefined);
    if(writer){await writer.rollback();writer.release();}
    holder.release();
  }
});
