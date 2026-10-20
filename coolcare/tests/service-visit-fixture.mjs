export async function arrangeVisitForNow(c,jobId) {
  await c.execute(`UPDATE work_order other JOIN assignment oa ON oa.assignment_id=other.assignment_id
    JOIN (SELECT a.technician_id FROM work_order w JOIN assignment a ON a.assignment_id=w.assignment_id WHERE w.job_id=?) target ON target.technician_id=oa.technician_id
    SET other.current_status='Assigned' WHERE other.job_id<>? AND other.current_status='In Progress'`,[jobId,jobId]);
  await c.execute(`UPDATE work_order SET appointment_date=DATE(DATE_ADD(UTC_TIMESTAMP(),INTERVAL 8 HOUR)),appointment_time='00:00:00' WHERE job_id=?`,[jobId]);
}
