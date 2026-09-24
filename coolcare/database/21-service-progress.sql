-- Each visit retains one work order and report; follow-up work is appended to it.
USE coolcare_service_app;
CREATE TABLE IF NOT EXISTS service_progress (
 job_id INT UNSIGNED PRIMARY KEY,
 revision INT UNSIGNED NOT NULL DEFAULT 0,
 extension_minutes INT UNSIGNED NOT NULL DEFAULT 0,
 expected_end_time TIME NULL,
 follow_up_status ENUM('None','Required','Scheduled','In Progress','Completed') NOT NULL DEFAULT 'None',
 follow_up_date DATE NULL,
 follow_up_start TIME NULL,
 follow_up_end TIME NULL,
 additional_repair_fee DECIMAL(10,2) NOT NULL DEFAULT 0,
 repair_quote_note VARCHAR(2000) NOT NULL DEFAULT '',
 updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 FOREIGN KEY(job_id) REFERENCES work_order(job_id),
 KEY follow_up_capacity(follow_up_date,follow_up_status)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS service_progress_event (
 event_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 request_id CHAR(36) NOT NULL UNIQUE,
 payload_hash CHAR(64) NOT NULL,
 result_json JSON NOT NULL,
 job_id INT UNSIGNED NOT NULL,
 report_id INT UNSIGNED NOT NULL,
 actor_user_id INT UNSIGNED NOT NULL,
 revision INT UNSIGNED NOT NULL,
 kind ENUM('Extension','Return required','Return scheduled','Return started','Return completed','Repair quote') NOT NULL,
 minutes INT UNSIGNED NULL,
 amount DECIMAL(10,2) NULL,
 reason VARCHAR(100) NOT NULL,
 notes VARCHAR(2000) NOT NULL,
 part_notes VARCHAR(2000) NOT NULL DEFAULT '',
 follow_up_date DATE NULL,
 follow_up_start TIME NULL,
 follow_up_end TIME NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE KEY job_revision(job_id,revision),
 FOREIGN KEY(job_id) REFERENCES work_order(job_id),
 FOREIGN KEY(report_id) REFERENCES service_report(report_id),
 FOREIGN KEY(actor_user_id) REFERENCES user_account(user_id)
) ENGINE=InnoDB;
