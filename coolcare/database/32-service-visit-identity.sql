USE coolcare_service_app;
-- A report belongs to the visit that created it, not to the mutable next assignment.
SET @ddl = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='service_report' AND column_name='visit_technician_id')=0, 'ALTER TABLE service_report ADD COLUMN visit_technician_id INT UNSIGNED NULL, ADD COLUMN visit_service_date DATE NULL, ADD COLUMN visit_start_time TIME NULL, ADD CONSTRAINT fk_report_visit_technician FOREIGN KEY (visit_technician_id) REFERENCES technician(technician_id)', 'SELECT 1');
PREPARE cc_stmt FROM @ddl; EXECUTE cc_stmt; DEALLOCATE PREPARE cc_stmt;
UPDATE service_report r JOIN performance_visit p ON p.report_id=r.report_id
SET r.visit_technician_id=p.technician_id,r.visit_service_date=DATE(p.scheduled_start),r.visit_start_time=TIME(p.scheduled_start)
WHERE r.visit_technician_id IS NULL;
UPDATE service_report r JOIN (SELECT report_id,MIN(technician_id) AS technician_id FROM service_visit_record GROUP BY report_id HAVING COUNT(DISTINCT technician_id)=1) v ON v.report_id=r.report_id
SET r.visit_technician_id=v.technician_id WHERE r.visit_technician_id IS NULL;
-- Current reports without return reassignment retain the current appointment identity.
UPDATE service_report r JOIN work_order w ON w.job_id=r.job_id JOIN assignment a ON a.assignment_id=w.assignment_id
SET r.visit_technician_id=COALESCE(r.visit_technician_id,a.technician_id),r.visit_service_date=COALESCE(r.visit_service_date,DATE(w.appointment_date)),r.visit_start_time=COALESCE(r.visit_start_time,w.appointment_time)
WHERE w.current_status<>'Return visit' AND (r.visit_technician_id IS NULL OR r.visit_technician_id=a.technician_id)
AND NOT EXISTS(SELECT 1 FROM service_progress_event e WHERE e.job_id=w.job_id AND e.kind='Return scheduled');
-- Previously scheduled returns may still point at a predecessor report. Preserve it;
-- its new technician cannot edit it and will get a new report when the visit starts.
UPDATE service_report r JOIN work_order w ON w.job_id=r.job_id
SET r.archived_job_id=r.job_id,r.job_id=NULL WHERE w.current_status='Return visit';
