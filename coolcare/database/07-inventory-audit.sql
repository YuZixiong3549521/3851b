USE coolcare_service_app;

-- Repeat-safe additive migration; original part IDs and stock are preserved.
SET @ddl = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='part' AND column_name='recommended_units_per_ac')=0,
 'ALTER TABLE part ADD COLUMN recommended_units_per_ac DECIMAL(8,2) NOT NULL DEFAULT 1.00, ADD COLUMN stock_unit VARCHAR(30) NOT NULL DEFAULT ''piece'', ADD COLUMN usage_note VARCHAR(255) NULL', 'SELECT 1');
PREPARE cc_stmt FROM @ddl; EXECUTE cc_stmt; DEALLOCATE PREPARE cc_stmt;
SET @ddl = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='inventory_transaction' AND column_name='version')=0,
 'ALTER TABLE inventory_transaction ADD COLUMN modified_at DATETIME(6) NULL, ADD COLUMN version INT UNSIGNED NOT NULL DEFAULT 1, ADD COLUMN performed_by_user_id INT UNSIGNED NULL, ADD CONSTRAINT fk_inventory_actor FOREIGN KEY (performed_by_user_id) REFERENCES user_account(user_id)', 'SELECT 1');
PREPARE cc_stmt FROM @ddl; EXECUTE cc_stmt; DEALLOCATE PREPARE cc_stmt;
SET @ddl = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='service_report' AND column_name='started_at')=0,
 'ALTER TABLE service_report ADD COLUMN started_at DATETIME NULL, ADD COLUMN completed_at DATETIME NULL, ADD CONSTRAINT chk_report_duration CHECK (completed_at IS NULL OR started_at IS NULL OR completed_at >= started_at)', 'SELECT 1');
PREPARE cc_stmt FROM @ddl; EXECUTE cc_stmt; DEALLOCATE PREPARE cc_stmt;

CREATE TABLE IF NOT EXISTS inventory_transaction_revision (
 revision_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 request_id CHAR(36) NOT NULL UNIQUE,
 payload_hash CHAR(64) NOT NULL,
 transaction_id INT UNSIGNED NOT NULL,
 changed_by_user_id INT UNSIGNED NOT NULL,
 before_quantity INT NOT NULL, after_quantity INT NOT NULL,
 before_occurred_at DATETIME NOT NULL, after_occurred_at DATETIME NOT NULL,
 before_remarks VARCHAR(500) NULL, after_remarks VARCHAR(500) NULL,
 before_version INT UNSIGNED NOT NULL, after_version INT UNSIGNED NOT NULL,
 stock_before INT NOT NULL, stock_delta INT NOT NULL, stock_after INT NOT NULL,
 changed_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 CONSTRAINT fk_inventory_revision_tx FOREIGN KEY (transaction_id) REFERENCES inventory_transaction(transaction_id),
 CONSTRAINT fk_inventory_revision_actor FOREIGN KEY (changed_by_user_id) REFERENCES user_account(user_id),
 CONSTRAINT chk_inventory_revision_stock CHECK (stock_before>=0 AND stock_after>=0 AND stock_after=stock_before+stock_delta),
 CONSTRAINT chk_inventory_revision_quantity CHECK (before_quantity>0 AND after_quantity>0),
 UNIQUE KEY uq_inventory_revision_version (transaction_id, after_version)
) ENGINE=InnoDB;

-- Demonstration recommendations, not manufacturer specifications or compulsory usage.
-- Apply standards to the original catalogue once, preserving later administrator edits.
UPDATE part SET recommended_units_per_ac=1,stock_unit='piece',usage_note='One replacement filter per AC when replacement is needed.' WHERE part_name='Aircon Filter' AND usage_note IS NULL;
UPDATE part SET recommended_units_per_ac=2,stock_unit='metre',usage_note='Allow two metres per AC; confirm the actual route on site.' WHERE part_name='Drain Hose' AND usage_note IS NULL;
UPDATE part SET recommended_units_per_ac=1,stock_unit='piece',usage_note='One matching capacitor per AC; confirm the electrical rating.' WHERE part_name='Capacitor 35uF' AND usage_note IS NULL;

INSERT INTO part (part_name,unit_price,status,current_stock,recommended_units_per_ac,stock_unit,usage_note)
SELECT catalog.part_name,catalog.price,'Active',0,catalog.allowance,catalog.unit,catalog.note FROM (
 SELECT 'Coil Cleaner (500 mL)' AS part_name,15.00 AS price,1 AS allowance,'bottle' AS unit,'One bottle per AC for a cleaning visit; confirm product instructions.' AS note
 UNION ALL SELECT 'Insulation Tube (1 m)',6.00,2,'metre','Allow two metres per AC; measure damaged insulation before issue.'
 UNION ALL SELECT 'Drain Elbow',3.00,2,'piece','Allow two elbows per AC for a drainage repair.'
 UNION ALL SELECT 'Cable Tie',0.25,4,'piece','Allow four cable ties per AC for securing service components.'
 UNION ALL SELECT 'Refrigerant R32 (1 kg)',30.00,1,'cylinder','One 1 kg service cylinder per AC as a planning allowance; actual charging requires qualified measurement.'
 UNION ALL SELECT 'Condensate Pump',65.00,1,'piece','One compatible replacement pump per AC when required.'
 UNION ALL SELECT 'Fan Motor',90.00,1,'piece','One compatible motor per AC when a replacement is diagnosed.'
 UNION ALL SELECT 'Temperature Sensor',18.00,1,'piece','One compatible replacement sensor per AC when required.'
) catalog WHERE NOT EXISTS (SELECT 1 FROM part p WHERE p.part_name=catalog.part_name);
