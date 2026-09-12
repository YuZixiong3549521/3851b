import express from 'express';
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
    w.priority_level AS priority, w.current_status AS status,
    COALESCE(w.reported_problem,b.problem_description,'') AS reportedProblem
    FROM work_order w JOIN assignment a ON a.assignment_id=w.assignment_id AND a.booking_id=w.booking_id
    JOIN booking b ON b.booking_id=w.booking_id JOIN customer c ON c.customer_id=b.customer_id
    JOIN user_account u ON u.user_id=c.user_id JOIN service_catalog sc ON sc.service_id=b.service_id
    JOIN service_address sa ON sa.address_id=b.address_id
    WHERE a.technician_id=? AND a.assignment_status NOT IN ('Declined','Reassigned','Cancelled')
    ${jobId === undefined ? '' : 'AND w.job_id=?'}
    ORDER BY w.appointment_date,w.appointment_time,w.job_id`,jobId === undefined ? [technicianId] : [technicianId,jobId]);
  return rows.map(row=>({...row,id:`WO-${String(row.jobId).padStart(4,'0')}`,
    status:row.status==='On The Way'?'On the Way':row.status,
    initials:row.customer.split(/\s+/).map(s=>s[0]).slice(0,2).join('')}));
}

export async function getTechnicianJobDetails(pool, technicianId, jobId) {
  const [job]=await getTechnicianJobs(pool,technicianId,jobId);
  if(!job)throw new AppError('Job not found for this technician.',404);
  const reportSelect=`SELECT r.report_id AS reportId,w.job_id AS jobId,b.booking_id AS bookingId,
    b.subscription_id AS subscriptionId,mp.package_name AS packageName,sa.address_line AS address,
    DATE_FORMAT(w.appointment_date,'%Y-%m-%d') AS date,r.work_performed AS workPerformed,
    r.problem_found AS problemFound,r.solution_applied AS solutionApplied,r.checklist_result AS checklist,
    r.submitted_time AS submittedAt,r.started_at AS startedAt,r.completed_at AS completedAt,
    CASE WHEN r.started_at IS NOT NULL AND r.completed_at IS NOT NULL THEN TIMESTAMPDIFF(MINUTE,r.started_at,r.completed_at) ELSE NULL END AS durationMinutes
    FROM service_report r JOIN work_order w ON w.job_id=r.job_id JOIN booking b ON b.booking_id=w.booking_id
    JOIN service_address sa ON sa.address_id=b.address_id
    LEFT JOIN customer_subscription sub ON sub.subscription_id=b.subscription_id
    LEFT JOIN maintenance_package mp ON mp.package_id=sub.package_id`;
  const [[report]]=await pool.execute(reportSelect+' WHERE w.job_id=?',[jobId]);
  const [addressHistory]=await pool.execute(reportSelect+` WHERE b.customer_id=? AND b.address_id=? AND w.current_status='Completed' AND w.job_id<>?
    ORDER BY COALESCE(r.completed_at,r.submitted_time,w.appointment_date) DESC,r.report_id DESC LIMIT 3`,[job.customerId,job.addressId,jobId]);
  const [packageHistory]=await pool.execute(reportSelect+` WHERE b.customer_id=? AND b.subscription_id IS NOT NULL AND w.current_status='Completed' AND w.job_id<>?
    ORDER BY COALESCE(r.completed_at,r.submitted_time,w.appointment_date) DESC,r.report_id DESC`,[job.customerId,jobId]);
  const [packages]=await pool.execute(`SELECT s.subscription_id AS subscriptionId,mp.package_name AS packageName,s.remaining_service_count AS remainingVisits,s.start_date AS startDate,s.end_date AS endDate,s.subscription_status AS status
    FROM customer_subscription s JOIN maintenance_package mp ON mp.package_id=s.package_id WHERE s.customer_id=? ORDER BY s.created_at DESC`,[job.customerId]);
  const jobIds=[...new Set([jobId,...addressHistory.map(r=>r.jobId),...packageHistory.map(r=>r.jobId)])];
  const [inventory]=await pool.query(`SELECT t.transaction_id AS transactionId,t.job_id AS jobId,p.part_name AS partName,p.stock_unit AS stockUnit,t.transaction_type AS type,t.quantity,t.remarks,t.created_at AS occurredAt,t.modified_at AS lastModified
    FROM inventory_transaction t JOIN part p ON p.part_id=t.part_id WHERE t.job_id IN (?) AND t.transaction_type IN ('Stock Out','Return') ORDER BY t.created_at DESC,t.transaction_id DESC`,[jobIds]);
  const attach=r=>({...r,inventory:inventory.filter(t=>t.jobId===r.jobId)});
  return {job:{...job,report:report?attach(report):null,inventory:inventory.filter(t=>t.jobId===jobId)},addressHistory:addressHistory.map(attach),packageHistory:packageHistory.map(attach),packages};
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
  router.post('/jobs/:jobId/stock-out',async(req,res)=>{
    const jobId=idSchema.parse(req.params.jobId);
    if(req.body.transaction_type!==undefined&&req.body.transaction_type!=='Stock Out')throw new AppError('Technicians can only issue stock.',403);
    if(req.body.job_id!==undefined&&Number(req.body.job_id)!==jobId)throw new AppError('The selected work order does not match the request.',400);
    res.status(201).json(await recordTransaction(pool,{...req.body,job_id:jobId,transaction_type:'Stock Out'},null,req.technicianUser.id));
  });
  router.use((_req,_res,next)=>next(new AppError('Technician endpoint not found.',404)));
  return router;
}
