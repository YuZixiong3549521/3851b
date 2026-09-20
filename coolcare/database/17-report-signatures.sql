CREATE TABLE IF NOT EXISTS report_signature (
 signature_id CHAR(36) PRIMARY KEY,
 job_id INT UNSIGNED NOT NULL,
 uploaded_by_user_id INT UNSIGNED NOT NULL,
 signer ENUM('customer','technician') NOT NULL,
 content_hash CHAR(64) NOT NULL,
 base_version CHAR(64) NOT NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(job_id) REFERENCES work_order(job_id),
 FOREIGN KEY(uploaded_by_user_id) REFERENCES user_account(user_id)
) ENGINE=InnoDB;
