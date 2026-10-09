USE coolcare_service_app;

SET @ddl = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='booking' AND column_name='travel_buffer_minutes')=0,
 'ALTER TABLE booking ADD COLUMN travel_buffer_minutes SMALLINT UNSIGNED NOT NULL DEFAULT 30 AFTER estimated_duration_minutes', 'SELECT 1');
PREPARE cc_stmt FROM @ddl; EXECUTE cc_stmt; DEALLOCATE PREPARE cc_stmt;

SET @ddl = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='booking' AND column_name='traffic_note')=0,
 'ALTER TABLE booking ADD COLUMN traffic_note VARCHAR(500) NULL AFTER travel_buffer_minutes', 'SELECT 1');
PREPARE cc_stmt FROM @ddl; EXECUTE cc_stmt; DEALLOCATE PREPARE cc_stmt;

SET @ddl = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='technician' AND column_name='hourly_labor_cost')=0,
 'ALTER TABLE technician ADD COLUMN hourly_labor_cost DECIMAL(10,2) NULL AFTER base_postal_code', 'SELECT 1');
PREPARE cc_stmt FROM @ddl; EXECUTE cc_stmt; DEALLOCATE PREPARE cc_stmt;

ALTER TABLE booking_admin_operation MODIFY operation_type ENUM('Approve','Reject','Dispatch','Redispatch','Reschedule','Edit rejection','Edit travel plan') NOT NULL;
