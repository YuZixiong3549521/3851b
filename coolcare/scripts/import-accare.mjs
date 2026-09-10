import { DatabaseSync } from 'node:sqlite';
import mysql from 'mysql2/promise';
import { resolve } from 'node:path';
import { createPublicBooking } from '../server/public-site.mjs';
process.loadEnvFile(resolve(import.meta.dirname,'../.env.local'));
const db=new DatabaseSync(resolve(import.meta.dirname,'../../accare/backend/ac-care.db'),{readOnly:true});
const pool=mysql.createPool({host:process.env.DB_HOST,port:Number(process.env.DB_PORT),user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME,dateStrings:true,decimalNumbers:true});
let users=0,bookings=0;
try{
 for(const old of db.prepare('SELECT * FROM users').all()){
  const key=`accare-v1:user:${old.id}`;const [[done]]=await pool.execute('SELECT target_id FROM web_legacy_import WHERE source_key=?',[key]);if(done)continue;
  const c=await pool.getConnection();try{await c.beginTransaction();let [[existing]]=await c.execute('SELECT user_id,role_id FROM user_account WHERE email=?',[old.email.toLowerCase()]);const [[role]]=await c.query("SELECT role_id FROM role WHERE role_name='Customer'");
  if(existing&&existing.role_id!==role.role_id)throw new Error('A legacy email conflicts with a staff account; import stopped.');
  if(!existing){if(!/^\$2[aby]\$/.test(old.password))throw new Error('A legacy password is not bcrypt; import stopped.');const [r]=await c.execute('INSERT INTO user_account(role_id,full_name,email,password_hash,phone) VALUES (?,?,?,?,?)',[role.role_id,old.full_name,old.email.toLowerCase(),old.password,old.phone]);existing={user_id:r.insertId};await c.execute('INSERT INTO customer(user_id) VALUES (?)',[existing.user_id]);users++;}
  await c.execute('INSERT INTO web_legacy_import(source_key,target_id) VALUES (?,?)',[key,existing.user_id]);await c.commit();}catch(e){await c.rollback();throw e;}finally{c.release();}
 }
 for(const old of db.prepare('SELECT * FROM bookings').all()){
  const key=`accare-v1:booking:${old.id}`;const [[done]]=await pool.execute('SELECT target_id FROM web_legacy_import WHERE source_key=?',[key]);if(done)continue;
  const [[mapping]]=await pool.execute('SELECT target_id FROM web_legacy_import WHERE source_key=?',[`accare-v1:user:${old.user_id}`]);if(!mapping)throw new Error('Legacy customer mapping missing.');
  const c=await pool.getConnection();try{await c.beginTransaction();const handle={execute:c.execute.bind(c),query:c.query.bind(c),beginTransaction:()=>c.query('SAVEPOINT legacy_booking'),commit:()=>c.query('RELEASE SAVEPOINT legacy_booking'),rollback:()=>c.query('ROLLBACK TO SAVEPOINT legacy_booking'),release:()=>{}};
  const result=await createPublicBooking({getConnection:async()=>handle},{id:mapping.target_id},{serviceType:old.service_type==='Maintenance'?'Regular Maintenance':old.service_type,servicePackage:old.service_package||old.service_type,numberOfUnits:old.number_of_units,preferredDate:old.preferred_date,timeWindow:old.time_window,serviceAddress:old.service_address,symptoms:old.symptoms||undefined,specialNotes:old.special_notes||undefined},{legacy:true});
  const status=({Pending:'Submitted',Confirmed:'Confirmed',Cancelled:'Cancelled',Completed:'Completed'})[old.booking_status];if(!status)throw new Error('Unsupported legacy booking status.');
  await c.execute('UPDATE booking SET booking_status=?,created_at=?,total_amount=NULL WHERE booking_id=?',[status,old.created_at,result.id]);
  if(status!=='Submitted')await c.execute('INSERT INTO booking_status_history(booking_id,old_status,new_status,changed_by_user_id,change_note) VALUES (?,?,?,?,?)',[result.id,'Submitted',status,mapping.target_id,'Original status imported from AC Care SQLite.']);
  await c.execute('INSERT INTO web_legacy_import(source_key,target_id) VALUES (?,?)',[key,result.id]);await c.commit();bookings++;}catch(e){await c.rollback();throw e;}finally{c.release();}
 }
 console.log(`Imported ${users} accounts and ${bookings} bookings. Existing imports skipped.`);
}finally{db.close();await pool.end();}
