USE coolcare_service_app;

-- Archive saved addresses without changing the locations on historical orders,
-- annual series or equipment records. Repeat-safe and non-destructive.
SET @ddl = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='service_address' AND column_name='is_archived')=0,
 'ALTER TABLE service_address ADD COLUMN is_archived BOOLEAN NOT NULL DEFAULT FALSE, ADD INDEX ix_customer_active_address (customer_id,is_archived)', 'SELECT 1');
PREPARE cc_stmt FROM @ddl; EXECUTE cc_stmt; DEALLOCATE PREPARE cc_stmt;

-- Remember the edited address so an identical retry recovers its replacement.
SET @ddl = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='service_address' AND column_name='replacement_address_id')=0,
 'ALTER TABLE service_address ADD COLUMN replacement_address_id INT UNSIGNED NULL, ADD CONSTRAINT fk_address_replacement FOREIGN KEY (replacement_address_id) REFERENCES service_address(address_id)', 'SELECT 1');
PREPARE cc_stmt FROM @ddl; EXECUTE cc_stmt; DEALLOCATE PREPARE cc_stmt;
