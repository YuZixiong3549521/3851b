CREATE TABLE IF NOT EXISTS technician_portal_profile (
 technician_id INT UNSIGNED PRIMARY KEY,
 primary_region VARCHAR(120) NOT NULL DEFAULT '',
 FOREIGN KEY (technician_id) REFERENCES technician(technician_id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS service_report_revision (
 request_id CHAR(36) PRIMARY KEY,
 job_id INT UNSIGNED NOT NULL,
 actor_user_id INT UNSIGNED NOT NULL,
 version INT UNSIGNED NOT NULL,
 payload_hash CHAR(64) NOT NULL,
 before_json JSON NULL,
 after_json JSON NOT NULL,
 changed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE KEY job_version(job_id,version),
 FOREIGN KEY(job_id) REFERENCES work_order(job_id),
 FOREIGN KEY(actor_user_id) REFERENCES user_account(user_id)
) ENGINE=InnoDB;
