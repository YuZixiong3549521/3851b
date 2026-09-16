import express from 'express';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import { sessionUser } from './public-site.mjs';
import { AppError, idSchema, recordTransaction } from './inventory.mjs';

// Local demo identity is chosen on the server, never from browser query parameters.
export async function getTechnician(pool, email = process.env.DEMO_TECHNICIAN_EMAIL ?? 'chris.lim@coolcare.demo') {
  const [[row]] = await pool.execute(`SELECT t.technician_id AS technicianId, u.full_name AS name,
    u.email, t.availability_status AS availability
    FROM technician t JOIN user_account u ON u.user_id=t.user_id
    JOIN role r ON r.role_id=u.role_id
    WHERE u.email=? AND u.status='Active' AND r.role_name='Technician' LIMIT 1`, [email]);
  if (!row) throw new AppError('The demonstration technician is unavailable. Check the local database configuration.',503);
  return {...row, role:'Field Technician', initials:row.name.split(/\s+/).map(s=>s[0]).slice(0,2).join('')};
}

export async function getTechnicianJobs(pool, technicianId, jobId) {
  const [rows] = await pool.execute(`SELECT w.job_id AS jobId, w.booking_id AS bookingId,
    u.full_name AS customer, DATE_FORMAT(w.appointment_date,'%Y-%m-%d') AS date,
    COALESCE(DATE_FORMAT(w.appointment_time,'%H:%i'),'') AS time,
    COALESCE((SELECT GROUP_CONCAT(bs.service_name ORDER BY bs.service_id SEPARATOR ', ') FROM booking_service bs WHERE bs.booking_id=b.booking_id),sc.service_name) AS serviceType, sa.address_line AS address,
    b.address_id AS addressId,b.customer_id AS customerId,b.subscription_id AS subscriptionId,
    COALESCE((SELECT SUM(cat.estimated_duration_minutes) FROM booking_service bs JOIN service_catalog cat ON cat.service_id=bs.service_id WHERE bs.booking_id=b.booking_id),sc.estimated_duration_minutes) AS estimatedDurationMinutes,
    (SELECT COUNT(*) FROM booking_aircon_unit bau WHERE bau.booking_id=b.booking_id) AS acCount,
    DATE_FORMAT(w.updated_at,'%Y-%m-%d %H:%i:%s') AS lastModified,
    (EXISTS(SELECT 1 FROM simple_service_catalog ss WHERE ss.service_id=b.service_id AND ss.code='cleaning')
      OR EXISTS(SELECT 1 FROM booking_service bs JOIN simple_service_catalog ss ON ss.service_id=bs.service_id WHERE bs.booking_id=b.booking_id AND ss.code='cleaning')) AS cleaningEligible,
    av.series_id AS annualSeriesId,av.visit_number AS annualVisitNumber,
    av.window_start AS annualWindowStart,av.window_end AS annualWindowEnd,
    w.priority_level AS priority, w.current_status AS status,
    COALESCE(w.reported_problem,b.problem_description,'') AS reportedProblem
    FROM work_order w JOIN assignment a ON a.assignment_id=w.assignment_id AND a.booking_id=w.booking_id
    JOIN booking b ON b.booking_id=w.booking_id JOIN customer c ON c.customer_id=b.customer_id
    JOIN user_account u ON u.user_id=c.user_id JOIN service_catalog sc ON sc.service_id=b.service_id
    JOIN service_address sa ON sa.address_id=b.address_id
    LEFT JOIN annual_booking_visit av ON av.booking_id=b.booking_id
    WHERE a.technician_id=? AND a.assignment_status NOT IN ('Declined','Reassigned','Cancelled')
    ${jobId === undefined ? '' : 'AND w.job_id=?'}
    ORDER BY w.appointment_date,w.appointment_time,w.job_id`,jobId === undefined ? [technicianId] : [technicianId,jobId]);
  return rows.map(row=>({...row,cleaningEligible:Boolean(row.cleaningEligible),id:`WO-${String(row.jobId).padStart(4,'0')}`,
    status:row.status==='On The Way'?'On the Way':row.status,
    initials:row.customer.split(/\s+/).map(s=>s[0]).slice(0,2).join('')}));
}

export const cleaningAssessmentSchema=z.object({
 requestId:z.uuid(),expectedVersion:z.number().int().min(0).max(4294967294),
 method:z.enum(['Regular','Chemical']),note:z.string().trim().min(5).max(1500),
}).strict();

export async function saveCleaningAssessment(pool,technicianUserId,jobId,raw) {
 const data=cleaningAssessmentSchema.parse(raw);
 const hash=createHash('sha256').update(JSON.stringify({...data,technicianUserId,jobId})).digest('hex');
 const conn=await pool.getConnection();
 try {
  await conn.beginTransaction();
  // Lock the work order even before an assessment exists; status and first-write races serialize here.
  const [[work]]=await conn.execute('SELECT * FROM work_order WHERE job_id=? FOR UPDATE',[jobId]);
  if(!work)throw new AppError('Job not found for this technician.',404);
  const [[owner]]=await conn.execute(`SELECT a.technician_id FROM assignment a JOIN technician t ON t.technician_id=a.technician_id
    JOIN user_account u ON u.user_id=t.user_id WHERE a.assignment_id=? AND a.booking_id=? AND t.user_id=? AND u.status='Active'
    AND a.assignment_status NOT IN ('Declined','Reassigned','Cancelled')`,[work.assignment_id,work.booking_id,technicianUserId]);
  if(!owner)throw new AppError('Job not found for this technician.',404);
  const [[previous]]=await conn.execute('SELECT * FROM work_order_cleaning_assessment_revision WHERE request_id=?',[data.requestId]);
  if(previous){
   if(previous.payload_hash!==hash)throw new AppError('This request was already used for a different assessment.',409);
   await conn.commit();return {jobId,method:previous.after_method,note:previous.after_note,version:previous.after_version,replayed:true};
  }
  if(['Completed','Cancelled'].includes(work.current_status))throw new AppError('Completed and cancelled work orders are read-only.',409);
  const [job]=await getTechnicianJobs(conn,owner.technician_id,jobId);
  if(!job.cleaningEligible)throw new AppError('A cleaning assessment is only available for a Cleaning work order.',400);
  const [[current]]=await conn.execute('SELECT * FROM work_order_cleaning_assessment WHERE job_id=?',[jobId]);
  const version=current?.version??0;
  if(version!==data.expectedVersion)throw new AppError('This assessment was updated elsewhere. Reload the work order before saving your decision.',409);
  const next=version+1;
  await conn.execute(`INSERT INTO work_order_cleaning_assessment_revision
   (request_id,payload_hash,job_id,changed_by_user_id,before_method,after_method,before_note,after_note,before_version,after_version)
   VALUES(?,?,?,?,?,?,?,?,?,?)`,[data.requestId,hash,jobId,technicianUserId,current?.cleaning_method??null,data.method,current?.assessment_note??null,data.note,version,next]);
  if(current)await conn.execute('UPDATE work_order_cleaning_assessment SET cleaning_method=?,assessment_note=?,version=?,assessed_by_user_id=?,updated_at=CURRENT_TIMESTAMP(6) WHERE job_id=?',[data.method,data.note,next,technicianUserId,jobId]);
  else await conn.execute('INSERT INTO work_order_cleaning_assessment(job_id,cleaning_method,assessment_note,version,assessed_by_user_id) VALUES(?,?,?,?,?)',[jobId,data.method,data.note,next,technicianUserId]);
  await conn.execute('UPDATE work_order SET updated_at=CURRENT_TIMESTAMP WHERE job_id=?',[jobId]);
  await conn.commit();return {jobId,method:data.method,note:data.note,version:next,replayed:false};
 }catch(error){await conn.rollback();throw error;}finally{conn.release();}
}

export async function getTechnicianJobDetails(pool, technicianId, jobId) {
  const [job]=await getTechnicianJobs(pool,technicianId,jobId);
  if(!job)throw new AppError('Job not found for this technician.',404);
  const reportSelect=`SELECT r.report_id AS reportId,w.job_id AS jobId,b.booking_id AS bookingId,
    b.subscription_id AS subscriptionId,mp.package_name AS packageName,sa.address_line AS address,
    DATE_FORMAT(w.appointment_date,'%Y-%m-%d') AS date,r.work_performed AS workPerformed,
    r.problem_found AS problemFound,r.solution_applied AS solutionApplied,r.checklist_result AS checklist,
    r.submitted_time AS submittedAt,r.started_at AS startedAt,r.completed_at AS completedAt,
    ca.cleaning_method AS cleaningMethod,ca.assessment_note AS cleaningAssessmentNote,
    CASE WHEN r.started_at IS NOT NULL AND r.completed_at IS NOT NULL THEN TIMESTAMPDIFF(MINUTE,r.started_at,r.completed_at) ELSE NULL END AS durationMinutes
    FROM service_report r JOIN work_order w ON w.job_id=r.job_id JOIN booking b ON b.booking_id=w.booking_id
    JOIN service_address sa ON sa.address_id=b.address_id
    LEFT JOIN customer_subscription sub ON sub.subscription_id=b.subscription_id
    LEFT JOIN maintenance_package mp ON mp.package_id=sub.package_id
    LEFT JOIN work_order_cleaning_assessment ca ON ca.job_id=w.job_id`;
  const [[report]]=await pool.execute(reportSelect+' WHERE w.job_id=?',[jobId]);
  const [addressHistory]=await pool.execute(reportSelect+` WHERE b.customer_id=? AND b.address_id=? AND w.current_status='Completed' AND w.job_id<>?
    ORDER BY COALESCE(r.completed_at,r.submitted_time,w.appointment_date) DESC,r.report_id DESC LIMIT 3`,[job.customerId,job.addressId,jobId]);
  const [packageHistory]=await pool.execute(reportSelect+` WHERE b.customer_id=? AND b.subscription_id IS NOT NULL AND w.current_status='Completed' AND w.job_id<>?
    ORDER BY COALESCE(r.completed_at,r.submitted_time,w.appointment_date) DESC,r.report_id DESC`,[job.customerId,jobId]);
  const [packages]=await pool.execute(`SELECT s.subscription_id AS subscriptionId,mp.package_name AS packageName,s.remaining_service_count AS remainingVisits,s.start_date AS startDate,s.end_date AS endDate,s.subscription_status AS status
    FROM customer_subscription s JOIN maintenance_package mp ON mp.package_id=s.package_id WHERE s.customer_id=? ORDER BY s.created_at DESC`,[job.customerId]);
  const [annualHistory]=job.annualSeriesId?await pool.execute(reportSelect+` JOIN annual_booking_visit av ON av.booking_id=b.booking_id
    JOIN annual_booking_series series ON series.series_id=av.series_id
    WHERE av.series_id=? AND av.visit_number<? AND series.customer_id=? AND b.customer_id=? AND w.current_status='Completed'
    ORDER BY av.visit_number DESC`,[job.annualSeriesId,job.annualVisitNumber,job.customerId,job.customerId]):[[]];
  const [[cleaningAssessment]]=await pool.execute(`SELECT ca.cleaning_method AS method,ca.assessment_note AS note,ca.version,
    ca.updated_at AS updatedAt,u.full_name AS assessedBy FROM work_order_cleaning_assessment ca
    JOIN user_account u ON u.user_id=ca.assessed_by_user_id WHERE ca.job_id=?`,[jobId]);
  const [cleaningAssessmentHistory]=await pool.execute(`SELECT ca.before_method AS beforeMethod,ca.after_method AS afterMethod,
    ca.before_note AS beforeNote,ca.after_note AS afterNote,ca.after_version AS version,ca.changed_at AS changedAt,u.full_name AS changedBy
    FROM work_order_cleaning_assessment_revision ca JOIN user_account u ON u.user_id=ca.changed_by_user_id WHERE ca.job_id=? ORDER BY ca.after_version DESC`,[jobId]);
  const jobIds=[...new Set([jobId,...addressHistory.map(r=>r.jobId),...packageHistory.map(r=>r.jobId),...annualHistory.map(r=>r.jobId)])];
  const [inventory]=await pool.query(`SELECT t.transaction_id AS transactionId,t.job_id AS jobId,p.part_name AS partName,p.stock_unit AS stockUnit,t.transaction_type AS type,t.quantity,t.remarks,t.created_at AS occurredAt,t.modified_at AS lastModified
    FROM inventory_transaction t JOIN part p ON p.part_id=t.part_id WHERE t.job_id IN (?) AND t.transaction_type IN ('Stock Out','Return') ORDER BY t.created_at DESC,t.transaction_id DESC`,[jobIds]);
  const attach=r=>({...r,inventory:inventory.filter(t=>t.jobId===r.jobId)});
  return {job:{...job,report:report?attach(report):null,inventory:inventory.filter(t=>t.jobId===jobId),cleaningAssessment:cleaningAssessment??null},addressHistory:addressHistory.map(attach),packageHistory:packageHistory.map(attach),packages,annualHistory:annualHistory.map(attach),cleaningAssessmentHistory};
}

const statusTransition={Assigned:'On The Way','On The Way':'In Progress','In Progress':'Completed'};
export async function updateTechnicianJobStatus(pool,technicianUserId,jobId,raw) {
  const data=z.object({requestId:z.uuid(),expectedStatus:z.enum(['Assigned','On The Way','In Progress']),status:z.enum(['On The Way','In Progress','Completed'])}).strict().parse(raw);
  const connection=await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[work]]=await connection.execute(`SELECT w.*,a.technician_id,a.assignment_status,b.booking_status
      FROM work_order w JOIN assignment a ON a.assignment_id=w.assignment_id AND a.booking_id=w.booking_id
      JOIN technician t ON t.technician_id=a.technician_id JOIN user_account u ON u.user_id=t.user_id
      JOIN booking b ON b.booking_id=w.booking_id
      WHERE w.job_id=? AND t.user_id=? AND u.status='Active' FOR UPDATE`,[jobId,technicianUserId]);
    if(!work||['Declined','Reassigned','Cancelled'].includes(work.assignment_status))throw new AppError('Job not found for this technician.',404);
    if(work.current_status===data.status){await connection.commit();return {jobId,status:data.status,replayed:true};}
    if(work.current_status!==data.expectedStatus||statusTransition[work.current_status]!==data.status) {
      throw new AppError('Reload this work order and complete each status step in order.',409);
    }
    await connection.execute('UPDATE work_order SET current_status=? WHERE job_id=?',[data.status,jobId]);
    await connection.execute('UPDATE booking SET booking_status=? WHERE booking_id=?',[data.status,work.booking_id]);
    await connection.execute('UPDATE assignment SET assignment_status=? WHERE assignment_id=?',[data.status==='Completed'?'Completed':'Accepted',work.assignment_id]);
    const notes={'On The Way':'Technician is travelling to the confirmed service address.','In Progress':'Technician arrived and started the service.','Completed':'Technician completed the service visit.'};
    await connection.execute(`INSERT INTO booking_status_history(booking_id,old_status,new_status,changed_by_user_id,change_note)
      VALUES (?,?,?,?,?)`,[work.booking_id,work.booking_status,data.status,technicianUserId,notes[data.status]]);
    await connection.commit();return {jobId,bookingId:work.booking_id,status:data.status,replayed:false};
  }catch(error){await connection.rollback();throw error;}finally{connection.release();}
}

async function stockOptions(pool,technicianId,jobId) {
  const [job]=await getTechnicianJobs(pool,technicianId,jobId);
  if(!job)throw new AppError('Job not found for this technician.',404);
  const [parts]=await pool.execute(`SELECT p.*,COALESCE(used.issued,0) AS issued
    FROM part p LEFT JOIN (SELECT part_id,GREATEST(0,SUM(CASE WHEN transaction_type='Stock Out' THEN quantity WHEN transaction_type='Return' THEN -quantity ELSE 0 END)) AS issued
      FROM inventory_transaction WHERE job_id=? GROUP BY part_id) used ON used.part_id=p.part_id
    WHERE p.status='Active' ORDER BY p.part_name`,[jobId]);
  return {jobId,acCount:job.acCount,parts:parts.map(p=>({...p,recommended:Math.ceil(job.acCount*Number(p.recommended_units_per_ac))}))};
}

export function createTechnicianRouter(pool) {
  const router = express.Router();
  router.use(async(req,_res,next)=>{req.technicianUser=await sessionUser(pool,req,'Technician');next();});
  router.get('/jobs',async (req,res)=>{
    const technician=await getTechnician(pool,req.technicianUser.email);
    res.json({technician,jobs:await getTechnicianJobs(pool,technician.technicianId)});
  });
  router.get('/jobs/:jobId',async (req,res)=>{
    if(!/^[1-9]\d*$/.test(req.params.jobId) || !Number.isSafeInteger(Number(req.params.jobId))) throw new AppError('Invalid job identifier.',400);
    const technician=await getTechnician(pool,req.technicianUser.email);
    res.json(await getTechnicianJobDetails(pool,technician.technicianId,Number(req.params.jobId)));
  });
  router.get('/jobs/:jobId/parts',async(req,res)=>{
    const technician=await getTechnician(pool,req.technicianUser.email);
    res.json(await stockOptions(pool,technician.technicianId,idSchema.parse(req.params.jobId)));
  });
  router.patch('/jobs/:jobId/cleaning-assessment',async(req,res)=>res.json(await saveCleaningAssessment(pool,req.technicianUser.id,idSchema.parse(req.params.jobId),req.body)));
  router.patch('/jobs/:jobId/status',async(req,res)=>res.json(await updateTechnicianJobStatus(pool,req.technicianUser.id,idSchema.parse(req.params.jobId),req.body)));
  router.post('/jobs/:jobId/stock-out',async(req,res)=>{
    const jobId=idSchema.parse(req.params.jobId);
    if(req.body.transaction_type!==undefined&&req.body.transaction_type!=='Stock Out')throw new AppError('Technicians can only issue stock.',403);
    if(req.body.job_id!==undefined&&Number(req.body.job_id)!==jobId)throw new AppError('The selected work order does not match the request.',400);
    res.status(201).json(await recordTransaction(pool,{...req.body,job_id:jobId,transaction_type:'Stock Out'},null,req.technicianUser.id));
  });
  router.use((_req,_res,next)=>next(new AppError('Technician endpoint not found.',404)));
  return router;
}
