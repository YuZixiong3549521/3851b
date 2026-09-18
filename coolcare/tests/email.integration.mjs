import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import mysql from 'mysql2/promise';
import { createPublicBooking } from '../server/public-site.mjs';
import { approveBooking, dispatchBooking } from '../server/admin-operations.mjs';
import { deliverPendingBookingEmails } from '../server/booking-email.mjs';
import {
  addCalendarDays,
  minimumBookingDate,
  nextWeekday,
} from '../server/customer/booking-schedule.mjs';

const pool=mysql.createPool({host:process.env.DB_HOST,port:Number(process.env.DB_PORT),user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME,dateStrings:true,decimalNumbers:true});
after(()=>pool.end());

test('only successful dispatch queues customer mail, which retries with the same message ID', async()=>{
 const c=await pool.getConnection();await c.beginTransaction();
 const handle={execute:c.execute.bind(c),query:c.query.bind(c),beginTransaction:()=>c.query('SAVEPOINT email_test'),commit:()=>c.query('RELEASE SAVEPOINT email_test'),rollback:()=>c.query('ROLLBACK TO SAVEPOINT email_test'),release:()=>{}};
 const db={execute:c.execute.bind(c),query:c.query.bind(c),getConnection:async()=>handle};
 try {
   const [[user]]=await c.query("SELECT u.user_id AS id,u.email,u.phone FROM user_account u JOIN customer c ON c.user_id=u.user_id ORDER BY c.customer_id LIMIT 1");
   const [[owner]]=await c.query(`SELECT u.user_id AS userId,u.full_name AS fullName,a.access_level AS accessLevel
     FROM admin_profile a JOIN user_account u ON u.user_id=a.user_id WHERE a.access_level='Owner' AND u.status='Active'`);
   assert.ok(owner);
   await c.execute("UPDATE user_account u JOIN technician t ON t.user_id=u.user_id SET u.status='Active'");
   await c.execute("UPDATE technician SET availability_status='Available'");
   const input={serviceType:'Cleaning',numberOfUnits:2,preferredDate:nextWeekday(addCalendarDays(minimumBookingDate(),365)),timeWindow:'09:00 AM - 11:00 AM',serviceAddress:`Email integration ${randomUUID()}`,requestId:randomUUID()};
   const created=await createPublicBooking(db,user,input);
   const repeat=await createPublicBooking(db,user,input);assert.equal(repeat.id,created.id);
   const [[beforeDispatch]]=await c.execute('SELECT COUNT(*) AS count FROM booking_email_outbox WHERE booking_id=?',[created.id]);
   assert.equal(Number(beforeDispatch.count),0);
   await approveBooking(db,owner,created.id,{requestId:randomUUID()});
   const dispatchRequest=randomUUID();
   await dispatchBooking(db,owner,created.id,{requestId:dispatchRequest});
   await dispatchBooking(db,owner,created.id,{requestId:dispatchRequest});
   const [[row]]=await c.execute("SELECT * FROM booking_email_outbox WHERE booking_id=? AND event_type='booking.assigned'",[created.id]);
   assert.equal(row.recipient,user.email);assert.equal(row.status,'Pending');
   const [[mailCount]]=await c.execute('SELECT COUNT(*) AS count FROM booking_email_outbox WHERE booking_id=?',[created.id]);
   assert.equal(Number(mailCount.count),1);
   // Scope the worker's claim to this transaction's new message, without touching pre-existing mail.
   const scoped={...db,getConnection:async()=>({...handle,execute:async(sql,args)=>sql.startsWith('SELECT * FROM booking_email_outbox WHERE delivery_mode=')?c.execute(sql.replace('WHERE delivery_mode=?','WHERE email_id=? AND delivery_mode=?'),[row.email_id,...args]):c.execute(sql,args)})};
   const sent=[];
   const transport={sendMail:async message=>{sent.push(message);throw Object.assign(new Error('Temporary outage'),{code:'ECONNECTION'});}};
   assert.equal(await deliverPendingBookingEmails(scoped,{transport,mode:row.delivery_mode,limit:1}),0);
   const [[failed]]=await c.execute('SELECT * FROM booking_email_outbox WHERE email_id=?',[row.email_id]);
   assert.equal(failed.status,'Pending');assert.equal(failed.attempts,1);assert.equal(failed.last_error,'ECONNECTION');
   await c.execute('UPDATE booking_email_outbox SET next_attempt_at=DATE_SUB(NOW(),INTERVAL 1 MINUTE) WHERE email_id=?',[row.email_id]);
   transport.sendMail=async message=>{sent.push(message);return {accepted:[user.email]};};
   assert.equal(await deliverPendingBookingEmails(scoped,{transport,mode:row.delivery_mode,limit:1}),1);
   assert.equal(sent[0].messageId,sent[1].messageId);assert.equal(sent[1].to.address,user.email);
   const [[success]]=await c.execute('SELECT status,attempts FROM booking_email_outbox WHERE email_id=?',[row.email_id]);
   assert.equal(success.status,'Sent');assert.equal(success.attempts,2);
   assert.equal(await deliverPendingBookingEmails(scoped,{transport,mode:row.delivery_mode,limit:1}),0);
 } finally { await c.rollback();c.release(); }
});
