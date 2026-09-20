CREATE TABLE IF NOT EXISTS technician_work_operation (
 request_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 job_id INT UNSIGNED NOT NULL,
 actor_user_id INT UNSIGNED NOT NULL,
 payload_hash CHAR(64) NOT NULL,
 result_json JSON NOT NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY (job_id) REFERENCES work_order(job_id),
 FOREIGN KEY (actor_user_id) REFERENCES user_account(user_id)
) ENGINE=InnoDB;
