USE coolcare_service_app;
ALTER TABLE booking MODIFY booking_status ENUM('Submitted','Confirmed','Assigned','On The Way','In Progress','Completed','Rejected','Cancelled','Expired','Awaiting return arrangement','Return visit') NOT NULL DEFAULT 'Submitted';
ALTER TABLE work_order MODIFY current_status ENUM('Assigned','On The Way','In Progress','Completed','Cancelled','Awaiting return arrangement','Return visit') NOT NULL DEFAULT 'Assigned';
ALTER TABLE service_progress MODIFY follow_up_status ENUM('None','Required','Awaiting customer','Awaiting confirmation','Scheduled','In Progress','Completed') NOT NULL DEFAULT 'None';
ALTER TABLE service_progress_event MODIFY kind ENUM('Extension','Return required','Return invited','Return requested','Return scheduled','Return started','Return completed','Repair quote') NOT NULL;
CREATE TABLE IF NOT EXISTS return_visit_operation (
 request_id CHAR(36) PRIMARY KEY, job_id INT UNSIGNED NOT NULL, actor_user_id INT UNSIGNED NOT NULL,
 payload_hash CHAR(64) NOT NULL, result_json JSON NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(job_id) REFERENCES work_order(job_id)
);
CREATE TABLE IF NOT EXISTS service_visit_record (
 visit_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, job_id INT UNSIGNED NOT NULL, report_id INT UNSIGNED NOT NULL,
 technician_id INT UNSIGNED NOT NULL, started_at DATETIME NULL, ended_at DATETIME NOT NULL,
 outcome VARCHAR(40) NOT NULL, report_snapshot JSON NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(job_id) REFERENCES work_order(job_id), FOREIGN KEY(report_id) REFERENCES service_report(report_id)
);
