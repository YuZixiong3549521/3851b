import express from 'express';
import { sessionUser } from './public-site.mjs';
import { AppError } from './inventory.mjs';

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
    sc.service_name AS serviceType, sa.address_line AS address,
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
    const [job]=await getTechnicianJobs(pool,technician.technicianId,Number(req.params.jobId));
    if(!job) throw new AppError('Job not found for this technician.',404);
    res.json({job});
  });
  router.use((_req,_res,next)=>next(new AppError('Technician endpoint not found.',404)));
  return router;
}
