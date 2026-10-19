USE coolcare_service_app;

SET @ddl = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='booking' AND column_name='admin_waiting_since')=0,
 'ALTER TABLE booking ADD COLUMN admin_waiting_since DATETIME NULL, ADD COLUMN admin_waiting_reason VARCHAR(500) NULL, ADD INDEX idx_admin_waiting (booking_status,admin_waiting_since)', 'SELECT 1');
PREPARE cc_stmt FROM @ddl; EXECUTE cc_stmt; DEALLOCATE PREPARE cc_stmt;

ALTER TABLE booking_admin_operation MODIFY operation_type ENUM('Approve','Reject','Dispatch','Redispatch','Reschedule','Edit rejection','Edit travel plan','Queue for dispatch','Retry customer email') NOT NULL;
