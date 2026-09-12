USE coolcare_service_app;

-- Customer choices are deliberately separate from the historical service rows.
-- Existing bookings, subscriptions, package links and price snapshots are kept.
CREATE TABLE IF NOT EXISTS simple_service_catalog (
 service_id INT UNSIGNED PRIMARY KEY,
 code ENUM('cleaning','repair') NOT NULL UNIQUE,
 pricing_note VARCHAR(500) NOT NULL,
 FOREIGN KEY(service_id) REFERENCES service_catalog(service_id)
);
CREATE TABLE IF NOT EXISTS simple_package_catalog (
 package_id INT UNSIGNED PRIMARY KEY,
 code VARCHAR(40) NOT NULL UNIQUE,
 included_visits INT UNSIGNED NOT NULL DEFAULT 4,
 interval_months INT UNSIGNED NOT NULL DEFAULT 3,
 pricing_note VARCHAR(500) NOT NULL,
 FOREIGN KEY(package_id) REFERENCES maintenance_package(package_id)
);

INSERT IGNORE INTO service_catalog(service_name,description,base_price,estimated_duration_minutes)
VALUES ('Cleaning','Routine cleaning for residential wall-mounted aircon units. Your technician assesses each unit and selects the appropriate cleaning method.',50,90),
 ('Repair','Fault diagnosis for residential wall-mounted aircon units. Your technician quotes any repair labour and replacement parts after assessment.',50,90);
INSERT IGNORE INTO simple_service_catalog(service_id,code,pricing_note)
SELECT service_id,IF(service_name='Cleaning','cleaning','repair'),
 IF(service_name='Cleaning','Routine cleaning and normal travel included. Chemical cleaning or extra work is quoted for approval after assessment.',
 'Diagnostic visit, including normal travel. Repair labour and replacement parts are quoted for approval after diagnosis; this is not an all-inclusive repair price.')
FROM service_catalog WHERE service_name IN ('Cleaning','Repair');
INSERT IGNORE INTO web_service_pricing(service_id,additional_unit_price,customer_visible)
SELECT service_id,IF(service_name='Cleaning',25,0),TRUE FROM service_catalog WHERE service_name IN ('Cleaning','Repair');
UPDATE web_service_pricing SET customer_visible=(service_id IN (SELECT service_id FROM simple_service_catalog));

INSERT IGNORE INTO maintenance_package(package_name,description,package_price,billing_interval,included_service_count)
VALUES ('Annual Cleaning Bundle','Four routine cleaning visits for residential wall-mounted aircon units, one every three months. The technician chooses the appropriate method after assessment.',180,'Yearly',4);
INSERT IGNORE INTO web_package_details(package_id,package_kind,included_units,additional_unit_price)
SELECT package_id,'Bundle',1,80 FROM maintenance_package WHERE package_name='Annual Cleaning Bundle';
INSERT IGNORE INTO simple_package_catalog(package_id,code,included_visits,interval_months,pricing_note)
SELECT package_id,'annual-cleaning',4,3,'Four routine cleaning visits with normal travel included. Chemical cleaning or extra work is quoted for approval. No payment is taken when booking.'
FROM maintenance_package WHERE package_name='Annual Cleaning Bundle';
INSERT IGNORE INTO package_service(package_id,service_id,included_quantity)
SELECT p.package_id,s.service_id,4 FROM maintenance_package p CROSS JOIN service_catalog s
WHERE p.package_name='Annual Cleaning Bundle' AND s.service_name='Cleaning';
UPDATE maintenance_package SET package_status='Inactive' WHERE package_id NOT IN (SELECT package_id FROM simple_package_catalog);

CREATE TABLE IF NOT EXISTS annual_booking_series (
 series_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 customer_id INT UNSIGNED NOT NULL,
 address_id INT UNSIGNED NOT NULL,
 package_id INT UNSIGNED NOT NULL,
 package_name VARCHAR(120) NOT NULL,
 first_service_date DATE NOT NULL,
 unit_count INT UNSIGNED NOT NULL,
 total_amount DECIMAL(10,2) NOT NULL,
 request_id CHAR(36) NULL UNIQUE,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(customer_id) REFERENCES customer(customer_id),
 FOREIGN KEY(address_id) REFERENCES service_address(address_id),
 FOREIGN KEY(package_id) REFERENCES maintenance_package(package_id)
);
CREATE TABLE IF NOT EXISTS annual_booking_visit (
 booking_id INT UNSIGNED PRIMARY KEY,
 series_id INT UNSIGNED NOT NULL,
 visit_number INT UNSIGNED NOT NULL,
 scheduled_date DATE NOT NULL,
 window_start DATE NOT NULL,
 window_end DATE NOT NULL,
 UNIQUE(series_id,visit_number),
 CHECK(visit_number BETWEEN 1 AND 4),
 CHECK(window_end > window_start),
 FOREIGN KEY(booking_id) REFERENCES booking(booking_id) ON DELETE CASCADE,
 FOREIGN KEY(series_id) REFERENCES annual_booking_series(series_id)
);
