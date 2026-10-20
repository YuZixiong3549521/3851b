USE coolcare_service_app;

-- Future completions preserve the breakdown as well as gross/net amounts.
-- Historical splits cannot be reconstructed reliably from mutable job records.
SET @ddl = IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='booking_completion_reward' AND COLUMN_NAME='base_amount'),
 'DO 0','ALTER TABLE booking_completion_reward ADD COLUMN base_amount DECIMAL(10,2) NULL, ADD COLUMN additional_fee DECIMAL(10,2) NULL');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
