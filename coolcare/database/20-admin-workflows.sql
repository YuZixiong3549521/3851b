USE coolcare_service_app;

ALTER TABLE booking MODIFY booking_status ENUM('Submitted','Confirmed','Assigned','On The Way','In Progress','Completed','Rejected','Cancelled','Expired') NOT NULL DEFAULT 'Submitted';
SET @ddl = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='booking' AND column_name='expires_at')=0,
 'ALTER TABLE booking ADD COLUMN expires_at DATETIME NULL, ADD INDEX idx_booking_expiry (booking_status,expires_at)', 'SELECT 1');
PREPARE cc_stmt FROM @ddl; EXECUTE cc_stmt; DEALLOCATE PREPARE cc_stmt;
SET @ddl = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='booking' AND column_name='rejection_reason')=0,
 'ALTER TABLE booking ADD COLUMN rejection_reason VARCHAR(500) NULL, ADD COLUMN rejection_version INT UNSIGNED NOT NULL DEFAULT 0', 'SELECT 1');
PREPARE cc_stmt FROM @ddl; EXECUTE cc_stmt; DEALLOCATE PREPARE cc_stmt;
UPDATE booking b SET rejection_reason=(SELECT h.change_note FROM booking_status_history h WHERE h.booking_id=b.booking_id AND h.new_status='Rejected' ORDER BY h.history_id DESC LIMIT 1),rejection_version=1
 WHERE b.booking_status='Rejected' AND b.rejection_version=0;
SET @ddl = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='technician' AND column_name='base_postal_code')=0,
 'ALTER TABLE technician ADD COLUMN base_postal_code CHAR(6) NULL', 'SELECT 1');
PREPARE cc_stmt FROM @ddl; EXECUTE cc_stmt; DEALLOCATE PREPARE cc_stmt;
ALTER TABLE booking_admin_operation MODIFY operation_type ENUM('Approve','Reject','Dispatch','Redispatch','Reschedule','Edit rejection') NOT NULL;
