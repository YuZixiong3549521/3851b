USE coolcare_service_app;

-- Staff invitations, booking review and capacity-aware dispatch. Every DDL
-- change is repeat-safe because this migration is applied on each db:up.

SET @ddl = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='admin_profile' AND column_name='access_level')=0,
 'ALTER TABLE admin_profile ADD COLUMN access_level ENUM(''Owner'',''Admin'') NOT NULL DEFAULT ''Admin'' AFTER position', 'SELECT 1');
PREPARE cc_stmt FROM @ddl; EXECUTE cc_stmt; DEALLOCATE PREPARE cc_stmt;

-- Preserve existing installations by promoting the oldest active admin when
-- no Owner has been selected yet. Seed data therefore promotes Norshida.
SET @owner_count = (SELECT COUNT(*) FROM admin_profile WHERE access_level='Owner');
SET @first_admin = (SELECT a.user_id FROM admin_profile a JOIN user_account u ON u.user_id=a.user_id
  WHERE u.status='Active' ORDER BY u.created_at,u.user_id LIMIT 1);
UPDATE admin_profile SET access_level='Owner' WHERE user_id=@first_admin AND @owner_count=0;

SET @ddl = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='admin_profile' AND column_name='owner_singleton')=0,
 'ALTER TABLE admin_profile ADD COLUMN owner_singleton TINYINT GENERATED ALWAYS AS (CASE WHEN access_level=''Owner'' THEN 1 ELSE NULL END) STORED, ADD UNIQUE KEY uq_admin_single_owner (owner_singleton)', 'SELECT 1');
PREPARE cc_stmt FROM @ddl; EXECUTE cc_stmt; DEALLOCATE PREPARE cc_stmt;

SET @ddl = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='technician' AND column_name='last_assigned_at')=0,
 'ALTER TABLE technician ADD COLUMN last_assigned_at DATETIME NULL AFTER availability_status', 'SELECT 1');
PREPARE cc_stmt FROM @ddl; EXECUTE cc_stmt; DEALLOCATE PREPARE cc_stmt;

CREATE TABLE IF NOT EXISTS technician_capacity_lock (
  lock_id TINYINT UNSIGNED PRIMARY KEY,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT chk_technician_capacity_lock CHECK (lock_id=1)
) ENGINE=InnoDB;
INSERT INTO technician_capacity_lock(lock_id) VALUES (1) ON DUPLICATE KEY UPDATE lock_id=VALUES(lock_id);

-- Rejected is distinct from a customer cancellation. Normalized times retain
-- the original preferred_time_slot text for compatible API responses.
ALTER TABLE booking MODIFY booking_status ENUM('Submitted','Confirmed','Assigned','On The Way','In Progress','Completed','Rejected','Cancelled') NOT NULL DEFAULT 'Submitted';
SET @ddl = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='booking' AND column_name='slot_start')=0,
 'ALTER TABLE booking ADD COLUMN slot_start TIME NULL AFTER preferred_time_slot, ADD COLUMN slot_end TIME NULL AFTER slot_start', 'SELECT 1');
PREPARE cc_stmt FROM @ddl; EXECUTE cc_stmt; DEALLOCATE PREPARE cc_stmt;

UPDATE booking SET
 slot_start=CASE
  WHEN preferred_time_slot IN ('09:00 AM - 11:00 AM','09:00 - 11:00') THEN '09:00:00'
  WHEN preferred_time_slot IN ('11:00 AM - 01:00 PM','11:00 - 13:00') THEN '11:00:00'
  WHEN preferred_time_slot='11:30 AM - 01:30 PM' THEN '11:30:00'
  WHEN preferred_time_slot IN ('02:00 PM - 04:00 PM','14:00 - 16:00') THEN '14:00:00'
  WHEN preferred_time_slot IN ('04:00 PM - 06:00 PM','16:00 - 18:00') THEN '16:00:00'
  WHEN preferred_time_slot='04:30 PM - 06:30 PM' THEN '16:30:00'
  ELSE slot_start END,
 slot_end=CASE
  WHEN preferred_time_slot IN ('09:00 AM - 11:00 AM','09:00 - 11:00') THEN '11:00:00'
  WHEN preferred_time_slot IN ('11:00 AM - 01:00 PM','11:00 - 13:00') THEN '13:00:00'
  WHEN preferred_time_slot='11:30 AM - 01:30 PM' THEN '13:30:00'
  WHEN preferred_time_slot IN ('02:00 PM - 04:00 PM','14:00 - 16:00') THEN '16:00:00'
  WHEN preferred_time_slot IN ('04:00 PM - 06:00 PM','16:00 - 18:00') THEN '18:00:00'
  WHEN preferred_time_slot='04:30 PM - 06:30 PM' THEN '18:30:00'
  ELSE slot_end END
WHERE slot_start IS NULL OR slot_end IS NULL;

SET @ddl = IF((SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='booking' AND index_name='idx_booking_capacity')=0,
 'ALTER TABLE booking ADD INDEX idx_booking_capacity (preferred_service_date,booking_status,slot_start,slot_end)', 'SELECT 1');
PREPARE cc_stmt FROM @ddl; EXECUTE cc_stmt; DEALLOCATE PREPARE cc_stmt;

CREATE TABLE IF NOT EXISTS service_day_capacity_lock (
  service_date DATE PRIMARY KEY,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS staff_invitation (
  invitation_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  role_name ENUM('Admin','Technician') NOT NULL,
  token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
  invited_by_user_id INT UNSIGNED NULL,
  expires_at DATETIME NOT NULL,
  accepted_at DATETIME NULL,
  revoked_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_staff_invitation_user FOREIGN KEY (user_id) REFERENCES user_account(user_id) ON DELETE CASCADE,
  CONSTRAINT fk_staff_invitation_actor FOREIGN KEY (invited_by_user_id) REFERENCES user_account(user_id) ON DELETE SET NULL,
  INDEX ix_staff_invitation_user (user_id,created_at),
  INDEX ix_staff_invitation_expiry (expires_at,accepted_at,revoked_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS booking_admin_operation (
  operation_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  request_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
  booking_id INT UNSIGNED NOT NULL,
  actor_user_id INT UNSIGNED NOT NULL,
  operation_type ENUM('Approve','Reject','Dispatch','Redispatch') NOT NULL,
  payload_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  result_json JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_booking_admin_operation_booking FOREIGN KEY (booking_id) REFERENCES booking(booking_id) ON DELETE CASCADE,
  CONSTRAINT fk_booking_admin_operation_actor FOREIGN KEY (actor_user_id) REFERENCES user_account(user_id),
  INDEX ix_booking_admin_operation_booking (booking_id,created_at)
) ENGINE=InnoDB;

SET @ddl = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='assignment' AND column_name='dispatch_request_id')=0,
 'ALTER TABLE assignment ADD COLUMN dispatch_request_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER assigned_by_admin_id, ADD UNIQUE KEY uq_assignment_dispatch_request (dispatch_request_id)', 'SELECT 1');
PREPARE cc_stmt FROM @ddl; EXECUTE cc_stmt; DEALLOCATE PREPARE cc_stmt;

-- Generalize the existing reliable mail outbox while retaining every queued or
-- delivered booking-received message.
SET @ddl = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='booking_email_outbox' AND column_name='event_type')=0,
 'ALTER TABLE booking_email_outbox ADD COLUMN invitation_id BIGINT UNSIGNED NULL AFTER booking_id, ADD COLUMN event_type VARCHAR(50) NOT NULL DEFAULT ''booking.received'' AFTER invitation_id, ADD COLUMN event_key VARCHAR(190) NULL AFTER event_type', 'SELECT 1');
PREPARE cc_stmt FROM @ddl; EXECUTE cc_stmt; DEALLOCATE PREPARE cc_stmt;

SET @ddl = IF((SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='booking_email_outbox' AND index_name='idx_mail_booking')=0,
 'ALTER TABLE booking_email_outbox ADD INDEX idx_mail_booking (booking_id)', 'SELECT 1');
PREPARE cc_stmt FROM @ddl; EXECUTE cc_stmt; DEALLOCATE PREPARE cc_stmt;

SET @mail_unique = (SELECT index_name FROM information_schema.statistics
 WHERE table_schema=DATABASE() AND table_name='booking_email_outbox' AND column_name='booking_id'
 AND non_unique=0 AND index_name<>'PRIMARY' LIMIT 1);
SET @ddl = IF(@mail_unique IS NULL, 'SELECT 1', CONCAT('ALTER TABLE booking_email_outbox DROP INDEX `',REPLACE(@mail_unique,'`','``'),'`'));
PREPARE cc_stmt FROM @ddl; EXECUTE cc_stmt; DEALLOCATE PREPARE cc_stmt;

ALTER TABLE booking_email_outbox MODIFY booking_id INT UNSIGNED NULL;
UPDATE booking_email_outbox SET event_type='booking.received',event_key=CONCAT('booking.received:',booking_id) WHERE event_key IS NULL;
ALTER TABLE booking_email_outbox MODIFY event_key VARCHAR(190) NOT NULL;

SET @ddl = IF((SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='booking_email_outbox' AND index_name='uq_mail_event')=0,
 'ALTER TABLE booking_email_outbox ADD UNIQUE KEY uq_mail_event (event_key)', 'SELECT 1');
PREPARE cc_stmt FROM @ddl; EXECUTE cc_stmt; DEALLOCATE PREPARE cc_stmt;

SET @ddl = IF((SELECT COUNT(*) FROM information_schema.table_constraints WHERE constraint_schema=DATABASE() AND table_name='booking_email_outbox' AND constraint_name='fk_mail_invitation')=0,
 'ALTER TABLE booking_email_outbox ADD CONSTRAINT fk_mail_invitation FOREIGN KEY (invitation_id) REFERENCES staff_invitation(invitation_id) ON DELETE SET NULL', 'SELECT 1');
PREPARE cc_stmt FROM @ddl; EXECUTE cc_stmt; DEALLOCATE PREPARE cc_stmt;
