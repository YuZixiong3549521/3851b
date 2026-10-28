USE coolcare_service_app;

CREATE TABLE IF NOT EXISTS reward_activity (
 activity_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 booking_id INT UNSIGNED NOT NULL,
 loyalty_account_id INT UNSIGNED NOT NULL,
 kind ENUM('Reserved','Returned','Settled','Existing reservation','Previously returned') NOT NULL,
 available_delta INT NOT NULL,
 points INT UNSIGNED NOT NULL,
 description VARCHAR(255) NOT NULL,
 created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 migration_key VARCHAR(80) NULL UNIQUE,
 FOREIGN KEY(booking_id) REFERENCES booking(booking_id),
 FOREIGN KEY(loyalty_account_id) REFERENCES loyalty_account(loyalty_account_id),
 INDEX reward_activity_wallet(loyalty_account_id,created_at)
) ENGINE=InnoDB;
INSERT IGNORE INTO reward_activity(booking_id,loyalty_account_id,kind,available_delta,points,description,created_at,migration_key)
 SELECT booking_id,loyalty_account_id,IF(status='Reserved','Existing reservation','Previously returned'),
 IF(status='Reserved',-points,points),points,CONCAT('Existing recorded reward state: ',reason),updated_at,CONCAT('reservation:',booking_id)
 FROM reward_reservation rr WHERE status IN ('Reserved','Released') AND points>0
 AND NOT EXISTS(SELECT 1 FROM reward_activity ra WHERE ra.booking_id=rr.booking_id);

CREATE TABLE IF NOT EXISTS assignment_member (
 assignment_id INT UNSIGNED NOT NULL,
 technician_id INT UNSIGNED NOT NULL,
 PRIMARY KEY(assignment_id,technician_id),
 FOREIGN KEY(assignment_id) REFERENCES assignment(assignment_id),
 FOREIGN KEY(technician_id) REFERENCES technician(technician_id),
 INDEX assignment_member_technician(technician_id,assignment_id)
) ENGINE=InnoDB;
INSERT IGNORE INTO assignment_member SELECT assignment_id,technician_id FROM assignment;

CREATE TABLE IF NOT EXISTS visit_member (
 report_id INT UNSIGNED NOT NULL,
 technician_id INT UNSIGNED NOT NULL,
 is_lead BOOLEAN NOT NULL DEFAULT FALSE,
 PRIMARY KEY(report_id,technician_id),
 FOREIGN KEY(report_id) REFERENCES service_report(report_id),
 FOREIGN KEY(technician_id) REFERENCES technician(technician_id)
) ENGINE=InnoDB;
INSERT IGNORE INTO visit_member SELECT report_id,technician_id,TRUE FROM performance_visit;

SET @ddl=IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='booking' AND column_name='required_technicians')=0,
 'ALTER TABLE booking ADD COLUMN required_technicians INT UNSIGNED NOT NULL DEFAULT 1, ADD COLUMN cleaning_minutes_per_unit INT UNSIGNED NULL, ADD COLUMN diagnostic_minutes INT UNSIGNED NULL','SELECT 1');
PREPARE team_stmt FROM @ddl; EXECUTE team_stmt; DEALLOCATE PREPARE team_stmt;
