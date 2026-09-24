USE coolcare_service_app;

-- New prices affect future quotes only. Existing booking and annual snapshots
-- are intentionally not rewritten. Repeated migration runs preserve edits.
CREATE TABLE IF NOT EXISTS booking_policy_migration (
 migration_key VARCHAR(80) PRIMARY KEY,
 applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;
SET @new_booking_policy = NOT EXISTS(SELECT 1 FROM booking_policy_migration WHERE migration_key='2026-09-24');
UPDATE service_catalog s JOIN simple_service_catalog c ON c.service_id=s.service_id
 SET s.base_price=50,s.estimated_duration_minutes=IF(c.code='cleaning',45,60)
 WHERE @new_booking_policy;
UPDATE web_service_pricing p JOIN simple_service_catalog c ON c.service_id=p.service_id
 SET p.additional_unit_price=IF(c.code='cleaning',50,0) WHERE @new_booking_policy;
UPDATE simple_service_catalog SET pricing_note=CASE code
 WHEN 'cleaning' THEN 'SGD 50 per aircon unit per visit. Allow approximately 45 minutes per unit. The technician assesses the cleaning method; extra work is quoted separately.'
 ELSE 'SGD 50 minimum diagnostic visit fee. Allow at least 60 minutes. Repair labour and replacement parts are additional fees recorded by your technician.' END
 WHERE @new_booking_policy;

CREATE TABLE IF NOT EXISTS annual_property_pricing (
 package_id INT UNSIGNED NOT NULL,
 property_type VARCHAR(40) NOT NULL,
 label VARCHAR(120) NOT NULL,
 included_units INT UNSIGNED NOT NULL,
 annual_price DECIMAL(10,2) NOT NULL,
 additional_unit_price DECIMAL(10,2) NOT NULL,
 display_order INT UNSIGNED NOT NULL,
 is_active BOOLEAN NOT NULL DEFAULT TRUE,
 PRIMARY KEY(package_id,property_type),
 FOREIGN KEY(package_id) REFERENCES maintenance_package(package_id),
 CHECK(included_units BETWEEN 1 AND 10),
 CHECK(annual_price>=0 AND additional_unit_price>=0)
) ENGINE=InnoDB;
INSERT IGNORE INTO annual_property_pricing(package_id,property_type,label,included_units,annual_price,additional_unit_price,display_order)
 SELECT package_id,'hdb-2-3','HDB 2- or 3-room',2,200,80,1 FROM simple_package_catalog WHERE code='annual-cleaning';
INSERT IGNORE INTO annual_property_pricing(package_id,property_type,label,included_units,annual_price,additional_unit_price,display_order)
 SELECT package_id,'hdb-4','HDB 4-room',3,260,80,2 FROM simple_package_catalog WHERE code='annual-cleaning';
INSERT IGNORE INTO annual_property_pricing(package_id,property_type,label,included_units,annual_price,additional_unit_price,display_order)
 SELECT package_id,'hdb-5-executive','HDB 5-room / Executive',4,320,80,3 FROM simple_package_catalog WHERE code='annual-cleaning';
INSERT IGNORE INTO annual_property_pricing(package_id,property_type,label,included_units,annual_price,additional_unit_price,display_order)
 SELECT package_id,'condo','Condominium / Apartment',4,360,80,4 FROM simple_package_catalog WHERE code='annual-cleaning';
INSERT IGNORE INTO annual_property_pricing(package_id,property_type,label,included_units,annual_price,additional_unit_price,display_order)
 SELECT package_id,'landed','Landed home',5,440,80,5 FROM simple_package_catalog WHERE code='annual-cleaning';

SET @ddl=IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='booking' AND column_name='estimated_duration_minutes')=0,
 'ALTER TABLE booking ADD COLUMN estimated_duration_minutes INT UNSIGNED NULL AFTER slot_end','SELECT 1');
PREPARE cc_stmt FROM @ddl; EXECUTE cc_stmt; DEALLOCATE PREPARE cc_stmt;
SET @ddl=IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='annual_booking_series' AND column_name='property_type')=0,
 'ALTER TABLE annual_booking_series ADD COLUMN property_type VARCHAR(40) NULL, ADD COLUMN property_label VARCHAR(120) NULL, ADD COLUMN included_units INT UNSIGNED NULL, ADD COLUMN base_annual_price DECIMAL(10,2) NULL, ADD COLUMN additional_unit_price DECIMAL(10,2) NULL','SELECT 1');
PREPARE cc_stmt FROM @ddl; EXECUTE cc_stmt; DEALLOCATE PREPARE cc_stmt;
INSERT IGNORE INTO booking_policy_migration(migration_key) VALUES ('2026-09-24');

-- Separate text marker also upgrades machines that applied the pricing policy
-- before the final technician-quoted repair wording was agreed.
SET @new_booking_text = NOT EXISTS(SELECT 1 FROM booking_policy_migration WHERE migration_key='2026-09-24-service-text');
UPDATE service_catalog s JOIN simple_service_catalog c ON c.service_id=s.service_id
 SET s.description=CASE c.code WHEN 'cleaning' THEN 'Cleaning for residential wall-mounted aircon units at SGD 50 per unit per visit. Allow approximately 45 minutes per unit. Your technician selects the cleaning method after assessment.'
 ELSE 'A SGD 50 minimum diagnostic visit fee covers assessment. Repair labour and replacement parts are additional fees quoted and recorded by your technician.' END
 WHERE @new_booking_text;
UPDATE simple_package_catalog SET pricing_note='Four quarterly cleaning visits priced by property type and included units. Your technician selects the cleaning method. Additional work is quoted separately. Pay after each visit; no payment is taken when booking.'
 WHERE code='annual-cleaning' AND @new_booking_text;
INSERT IGNORE INTO booking_policy_migration(migration_key) VALUES ('2026-09-24-service-text');
