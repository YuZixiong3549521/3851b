USE coolcare_service_app;

-- Report IDs identify individual visits; the current assignment can change later.
CREATE TABLE IF NOT EXISTS performance_visit (
 report_id INT UNSIGNED PRIMARY KEY,
 job_id INT UNSIGNED NOT NULL,
 technician_id INT UNSIGNED NOT NULL,
 scheduled_start DATETIME NULL,
 actual_start DATETIME NULL,
 actual_end DATETIME NULL,
 outcome VARCHAR(40) NULL,
 capture_source ENUM('Live','Historical snapshot') NOT NULL DEFAULT 'Live',
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(report_id) REFERENCES service_report(report_id),
 FOREIGN KEY(job_id) REFERENCES work_order(job_id),
 FOREIGN KEY(technician_id) REFERENCES technician(technician_id),
 INDEX performance_technician_end(technician_id,actual_end)
);
-- A legacy report shared by several visits/technicians has no unambiguous score
-- owner. Leave those records untouched and do not invent a scheduled start.
INSERT IGNORE INTO performance_visit
 (report_id,job_id,technician_id,actual_start,actual_end,outcome,capture_source)
SELECT v.report_id,v.job_id,v.technician_id,v.started_at,v.ended_at,v.outcome,'Historical snapshot'
 FROM service_visit_record v
 JOIN (SELECT report_id,MIN(visit_id) AS visit_id FROM service_visit_record
       GROUP BY report_id HAVING COUNT(*)=1) single_visit ON single_visit.visit_id=v.visit_id;

CREATE TABLE IF NOT EXISTS performance_feedback (
 report_id INT UNSIGNED PRIMARY KEY,
 stars TINYINT UNSIGNED NOT NULL,
 comment VARCHAR(1500) NOT NULL DEFAULT '',
 version INT UNSIGNED NOT NULL,
 customer_user_id INT UNSIGNED NOT NULL,
 updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(report_id) REFERENCES performance_visit(report_id),
 FOREIGN KEY(customer_user_id) REFERENCES user_account(user_id),
 CHECK(stars BETWEEN 1 AND 5)
);
CREATE TABLE IF NOT EXISTS performance_quality (
 report_id INT UNSIGNED PRIMARY KEY,
 score TINYINT UNSIGNED NOT NULL,
 reason VARCHAR(1500) NOT NULL,
 version INT UNSIGNED NOT NULL,
 admin_user_id INT UNSIGNED NOT NULL,
 updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(report_id) REFERENCES performance_visit(report_id),
 FOREIGN KEY(admin_user_id) REFERENCES user_account(user_id),
 CHECK(score BETWEEN 0 AND 100)
);
CREATE TABLE IF NOT EXISTS performance_settings (
 settings_id TINYINT UNSIGNED PRIMARY KEY,
 customer_weight TINYINT UNSIGNED NOT NULL DEFAULT 40,
 quality_weight TINYINT UNSIGNED NOT NULL DEFAULT 40,
 punctuality_weight TINYINT UNSIGNED NOT NULL DEFAULT 20,
 grace_minutes TINYINT UNSIGNED NOT NULL DEFAULT 15,
 version INT UNSIGNED NOT NULL DEFAULT 0,
 CHECK(customer_weight+quality_weight+punctuality_weight=100),
 CHECK(grace_minutes<=60)
);
INSERT IGNORE INTO performance_settings(settings_id) VALUES(1);
CREATE TABLE IF NOT EXISTS performance_operation (
 request_id CHAR(36) PRIMARY KEY,
 actor_user_id INT UNSIGNED NOT NULL,
 report_id INT UNSIGNED NULL,
 operation_kind ENUM('Customer feedback','Quality assessment','Settings') NOT NULL,
 payload_hash CHAR(64) NOT NULL,
 before_json JSON NULL,
 after_json JSON NOT NULL,
 result_json JSON NOT NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(actor_user_id) REFERENCES user_account(user_id),
 FOREIGN KEY(report_id) REFERENCES performance_visit(report_id),
 INDEX performance_audit_report(report_id,created_at)
);
