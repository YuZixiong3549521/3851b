import mysql from 'mysql2/promise';
import { resolve } from 'node:path';
import { mkdir,writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createConnection } from 'node:net';
import { isCalendarDate,singaporeToday } from '../server/customer/booking-schedule.mjs';

const root=resolve(import.meta.dirname,'..');
const args=process.argv.slice(2);
if(args.includes('--help')){
 console.log('Usage: npm run db:sample -- [--plan|--dry-run] [--replace] [--as-of=YYYY-MM-DD]\nCreates synthetic, connected business records. Existing business data requires --replace.\nStop npm start first. A private local SQL backup is made before every write.\n--dry-run builds and validates the dataset inside a rolled-back transaction.\nAccounts/passwords, catalogue configuration and schema are preserved.');
 process.exit(0);
}
for(const arg of args)if(!['--plan','--dry-run','--replace'].includes(arg)&&!arg.startsWith('--as-of='))throw new Error('Unknown argument: '+arg);
if(args.includes('--plan')&&args.includes('--dry-run'))throw new Error('Choose either --plan or --dry-run.');
process.loadEnvFile(resolve(root,'.env.local'));
const asOf=args.find(arg=>arg.startsWith('--as-of='))?.slice(8)||singaporeToday();
if(!isCalendarDate(asOf)||asOf<'2001-01-01'||asOf>'2098-12-31')throw new Error('Use a valid as-of date between 2001 and 2098.');
if(!['127.0.0.1','localhost','::1'].includes(process.env.DB_HOST)||process.env.DB_NAME!=='coolcare_service_app')throw new Error('This sample-data tool only supports the local CoolCare database.');
if(!process.env.MYSQL_ROOT_PASSWORD)throw new Error('The local MYSQL_ROOT_PASSWORD from setup is required.');
const clearTables=[
 'assistant_booking_draft','work_order_cleaning_assessment_revision','work_order_cleaning_assessment',
 'inventory_transaction_revision','inventory_web_operation','inventory_transaction',
 'photo','technician_performance_score','service_report','work_order','assignment',
 'booking_email_outbox','web_booking_details','booking_service','booking_package','annual_booking_visit',
 'booking_aircon_unit','booking_promotion','booking_change_request','booking_status_history','loyalty_transaction',
 'booking','annual_booking_series','customer_subscription','loyalty_account','package_promotion','promotion',
 'aircon_unit','service_address','chatbot_message','chatbot_conversation','web_legacy_import',
];
async function apiIsRunning(){return new Promise(resolve=>{
 const socket=createConnection({host:'127.0.0.1',port:Number(process.env.API_PORT||3001)});
 socket.setTimeout(1000);socket.once('connect',()=>{socket.destroy();resolve(true);});
 socket.once('error',()=>resolve(false));socket.once('timeout',()=>{socket.destroy();resolve(false);});
});}
async function backup(db){
 const [[writer]]=await db.query('SELECT @@server_uuid AS uuid');
 const identity=spawnSync('docker',['compose','--env-file','.env.local','exec','-T','database','sh','-c','exec mysql -uroot -p"$MYSQL_ROOT_PASSWORD" -N -B -e "SELECT @@server_uuid"'],{cwd:root,encoding:'utf8',windowsHide:true});
 if(identity.status!==0||identity.stdout.trim()!==writer.uuid)throw new Error('Backup server and configured database do not match. No data was changed.');
 const dir=resolve(root,'.local/backups','realistic-data-'+new Date().toISOString().replaceAll(':','-'));
 await mkdir(dir,{recursive:true});
 const dump=spawnSync('docker',['compose','--env-file','.env.local','exec','-T','database','sh','-c','exec mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" --single-transaction --routines --triggers --no-tablespaces coolcare_service_app'],{cwd:root,encoding:'utf8',windowsHide:true,maxBuffer:128*1024*1024});
 if(dump.status!==0||!dump.stdout.includes('Dump completed'))throw new Error('Backup failed; nothing was replaced. '+dump.stderr);
 const path=resolve(dir,'before.sql');await writeFile(path,dump.stdout,{mode:0o600});return path;
}
const db=await mysql.createConnection({host:process.env.DB_HOST,port:Number(process.env.DB_PORT),user:'root',password:process.env.MYSQL_ROOT_PASSWORD,database:process.env.DB_NAME,dateStrings:true,decimalNumbers:true,timezone:'Z'});
let inTransaction=false,locked=false;
try{
 await db.query("SET time_zone='+00:00'");
 const [schemaTables]=await db.execute("SELECT TABLE_NAME name FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_TYPE='BASE TABLE'",[process.env.DB_NAME]);
 const available=new Set(schemaTables.map(row=>row.name));
 for(const table of clearTables)if(!available.has(table))throw new Error('Run npm run db:up first; required table is missing: '+table);
 const counts={};for(const table of clearTables){const [[row]]=await db.query('SELECT COUNT(*) n FROM ??',[table]);counts[table]=row.n;}
 const [edges]=await db.execute('SELECT TABLE_NAME child,REFERENCED_TABLE_NAME parent FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=? AND REFERENCED_TABLE_NAME IS NOT NULL',[process.env.DB_NAME]);
 const pending=new Set(clearTables),order=[];
 for(const edge of edges)if(pending.has(edge.parent)&&!pending.has(edge.child))throw new Error('A retained table references replaced business data: '+edge.child+'. Review before replacing.');
 while(pending.size){
  const next=[...pending].find(table=>!edges.some(edge=>edge.parent===table&&edge.child!==table&&pending.has(edge.child)));
  if(!next)throw new Error('Unexpected cyclic business relationship. No data was changed.');
  order.push(next);pending.delete(next);
 }
 console.log(JSON.stringify({asOf,replace:args.includes('--replace'),businessRows:counts,preserves:'Accounts, passwords, roles, service/package/part configuration and schema'},null,2));
 if(!args.includes('--plan')){
  if(!args.includes('--replace')&&Object.values(counts).some(n=>n>0))throw new Error('Business data already exists. Use --plan to review it; explicit --replace is required to replace it.');
  if(await apiIsRunning())throw new Error('Stop npm start before applying sample data, then run it again afterward.');
  const [[lock]]=await db.query("SELECT GET_LOCK('coolcare-realistic-data',10) acquired");if(lock.acquired!==1)throw new Error('Another sample-data process is running.');locked=true;
  if(!args.includes('--replace'))for(const table of clearTables){
   const [[row]]=await db.query('SELECT COUNT(*) n FROM ??',[table]);
   if(row.n>0)throw new Error('Business data now exists. Explicit --replace is required.');
  }
  const backupPath=await backup(db);
  const {seedRealisticData}=await import('../database/realistic-data.mjs');
  await db.beginTransaction();inTransaction=true;
  await db.query('SELECT customer_id FROM customer ORDER BY customer_id FOR UPDATE');
  await db.query('SELECT part_id FROM part ORDER BY part_id FOR UPDATE');
  const [originalAccounts]=await db.query('SELECT user_id,role_id,full_name,email,password_hash,phone FROM user_account ORDER BY user_id FOR UPDATE');
  await db.query('UPDATE service_address SET replacement_address_id=NULL');
  for(const table of order)await db.query('DELETE FROM ??',[table]);
  await db.query('UPDATE part SET current_stock=0');
  const result=await seedRealisticData(db,{asOf});
  const [currentAccounts]=await db.query('SELECT user_id,role_id,full_name,email,password_hash,phone FROM user_account ORDER BY user_id');
  const accountsById=new Map(currentAccounts.map(row=>[row.user_id,JSON.stringify(row)]));
  if(originalAccounts.some(row=>accountsById.get(row.user_id)!==JSON.stringify(row)))throw new Error('An existing login account changed; replacement rolled back.');
  const integrityChecks=[
   ['booking address ownership',`SELECT b.booking_id FROM booking b JOIN service_address a ON a.address_id=b.address_id WHERE b.customer_id<>a.customer_id`],
   ['equipment ownership',`SELECT b.booking_id FROM booking b JOIN booking_aircon_unit bu ON bu.booking_id=b.booking_id JOIN aircon_unit u ON u.unit_id=bu.unit_id WHERE b.customer_id<>u.customer_id OR b.address_id<>u.address_id`],
   ['annual visit count and price',`SELECT s.series_id FROM annual_booking_series s LEFT JOIN annual_booking_visit v ON v.series_id=s.series_id LEFT JOIN booking b ON b.booking_id=v.booking_id GROUP BY s.series_id,s.total_amount HAVING COUNT(v.booking_id)<>4 OR SUM(b.total_amount)<>s.total_amount`],
   ['work order assignment',`SELECT w.job_id FROM work_order w JOIN assignment a ON a.assignment_id=w.assignment_id WHERE w.booking_id<>a.booking_id`],
   ['weekday schedule',`SELECT booking_id FROM booking WHERE booking_status<>'Cancelled' AND WEEKDAY(preferred_service_date)>4`],
   ['address quota',`SELECT b.booking_id FROM booking b JOIN booking other ON other.customer_id=b.customer_id AND other.address_id=b.address_id AND other.preferred_service_date BETWEEN b.preferred_service_date AND DATE_ADD(b.preferred_service_date,INTERVAL 6 DAY) WHERE b.booking_status<>'Cancelled' AND other.booking_status<>'Cancelled' GROUP BY b.booking_id HAVING COUNT(*)>2`],
   ['technician schedule',`SELECT a.technician_id FROM assignment a JOIN work_order w ON w.assignment_id=a.assignment_id GROUP BY a.technician_id,w.appointment_date HAVING COUNT(*)>1`],
   ['report timing',`SELECT report_id FROM service_report WHERE completed_at<started_at OR CONVERT_TZ(submitted_time,'+00:00','+08:00')<completed_at`],
  ];
  for(const [label,sql] of integrityChecks){const [invalid]=await db.query(sql);if(invalid.length)throw new Error('Invalid '+label+'; replacement rolled back.');}
  const [shortNotice]=await db.execute("SELECT booking_id FROM booking WHERE booking_status NOT IN ('Completed','Cancelled') AND preferred_service_date<DATE_ADD(?,INTERVAL 14 DAY)",[asOf]);
  if(shortNotice.length)throw new Error('Upcoming appointments violate the 14-day notice rule.');
  const [invalidStock]=await db.query(`SELECT p.part_id FROM part p LEFT JOIN (SELECT part_id,SUM(CASE WHEN transaction_type IN ('Stock In','Return') THEN quantity WHEN transaction_type='Stock Out' THEN -quantity ELSE 0 END) net FROM inventory_transaction GROUP BY part_id) t ON t.part_id=p.part_id WHERE p.current_stock<>COALESCE(t.net,0) OR p.current_stock<0`);
  if(invalidStock.length)throw new Error('Stock ledger does not reconcile; replacement rolled back.');
  const [[mail]]=await db.query('SELECT COUNT(*) n FROM booking_email_outbox');if(mail.n!==0)throw new Error('Sample data must not enqueue customer notifications.');
  if(args.includes('--dry-run')){await db.rollback();inTransaction=false;console.log(JSON.stringify({dryRun:true,asOf,backupPath,counts:result.counts},null,2));}
  else {
  await db.commit();inTransaction=false;
  const summary={dataset:'CoolCare synthetic business scenarios',asOf,createdAt:new Date().toISOString(),backupPath,...result};
  console.log(JSON.stringify({committed:true,dataset:summary.dataset,asOf,backupPath,counts:result.counts},null,2));
  try { await writeFile(resolve(root,'.local/realistic-data-last-run.json'),JSON.stringify(summary,null,2),{mode:0o600}); }
  catch(error) { console.warn('Data was committed and backed up, but the local manifest could not be written: '+error.message); }
  }
 }
}catch(error){if(inTransaction)await db.rollback();throw error;}finally{if(locked)await db.query("SELECT RELEASE_LOCK('coolcare-realistic-data')");await db.end();}
