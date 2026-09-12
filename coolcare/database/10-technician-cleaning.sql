USE coolcare_service_app;

-- A missing assessment means that the technician has not recorded a decision.
-- Never infer a method from a legacy report or update its historical content.
CREATE TABLE IF NOT EXISTS work_order_cleaning_assessment (
 job_id INT UNSIGNED PRIMARY KEY,
 cleaning_method ENUM('Regular','Chemical') NOT NULL,
 assessment_note VARCHAR(1500) NOT NULL,
 version INT UNSIGNED NOT NULL,
 assessed_by_user_id INT UNSIGNED NOT NULL,
 created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 CONSTRAINT fk_cleaning_assessment_job FOREIGN KEY(job_id) REFERENCES work_order(job_id),
 CONSTRAINT fk_cleaning_assessment_user FOREIGN KEY(assessed_by_user_id) REFERENCES user_account(user_id),
 CONSTRAINT chk_cleaning_assessment_version CHECK(version>0)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS work_order_cleaning_assessment_revision (
 revision_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 request_id CHAR(36) NOT NULL UNIQUE,
 payload_hash CHAR(64) NOT NULL,
 job_id INT UNSIGNED NOT NULL,
 changed_by_user_id INT UNSIGNED NOT NULL,
 before_method ENUM('Regular','Chemical') NULL,
 after_method ENUM('Regular','Chemical') NOT NULL,
 before_note VARCHAR(1500) NULL,
 after_note VARCHAR(1500) NOT NULL,
 before_version INT UNSIGNED NOT NULL,
 after_version INT UNSIGNED NOT NULL,
 changed_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 CONSTRAINT fk_cleaning_revision_job FOREIGN KEY(job_id) REFERENCES work_order(job_id),
 CONSTRAINT fk_cleaning_revision_user FOREIGN KEY(changed_by_user_id) REFERENCES user_account(user_id),
 CONSTRAINT chk_cleaning_revision_version CHECK(after_version=before_version+1),
 UNIQUE KEY uq_cleaning_revision_version(job_id,after_version)
) ENGINE=InnoDB;
