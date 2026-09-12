USE coolcare_service_app;

-- Additive, repeatable catalogue and booking snapshots. Prices are editable demo
-- defaults; existing catalogue prices, subscriptions and historical orders stay intact.
CREATE TABLE IF NOT EXISTS web_service_pricing (
 service_id INT UNSIGNED PRIMARY KEY,
 additional_unit_price DECIMAL(10,2) NOT NULL,
 customer_visible BOOLEAN NOT NULL DEFAULT TRUE,
 FOREIGN KEY (service_id) REFERENCES service_catalog(service_id)
);
INSERT IGNORE INTO web_service_pricing(service_id,additional_unit_price,customer_visible)
SELECT service_id,CASE service_name
 WHEN 'Air Conditioning Cleaning' THEN 45 WHEN 'Regular Maintenance' THEN 55
 WHEN 'Air Conditioning Repair' THEN 0 WHEN 'General Inspection / Diagnostic' THEN 0
 WHEN '3-Unit Bundle Deal ($50 Off)' THEN 35 WHEN 'Annual Maintenance Contract' THEN 80
 ELSE base_price END,
 service_name IN ('Air Conditioning Cleaning','Regular Maintenance','Air Conditioning Repair','General Inspection / Diagnostic','Chemical Wash')
FROM service_catalog;

CREATE TABLE IF NOT EXISTS web_package_details (
 package_id INT UNSIGNED PRIMARY KEY,
 package_kind ENUM('Bundle','Membership') NOT NULL,
 included_units INT UNSIGNED NOT NULL DEFAULT 1,
 additional_unit_price DECIMAL(10,2) NOT NULL DEFAULT 0,
 FOREIGN KEY (package_id) REFERENCES maintenance_package(package_id)
);
INSERT IGNORE INTO web_package_details(package_id,package_kind)
SELECT package_id,'Membership' FROM maintenance_package;

INSERT IGNORE INTO maintenance_package(package_name,description,package_price,billing_interval,included_service_count)
VALUES ('Essential Care Bundle','One visit including aircon cleaning and a diagnostic inspection. First unit included; each additional unit costs $55.',99,'Monthly',1),
 ('Deep Care Bundle','One visit including chemical wash and a diagnostic inspection. First unit included; each additional unit costs $100.',155,'Monthly',1),
 ('CoolCare Annual Membership','Four cleaning and inspection visits over one year. Membership belongs to the customer and can be used at their saved service addresses.',360,'Yearly',4);
INSERT INTO web_package_details(package_id,package_kind,included_units,additional_unit_price)
SELECT package_id,'Bundle',1,CASE package_name WHEN 'Essential Care Bundle' THEN 55 ELSE 100 END
FROM maintenance_package WHERE package_name IN ('Essential Care Bundle','Deep Care Bundle')
ON DUPLICATE KEY UPDATE package_kind='Bundle';
INSERT IGNORE INTO web_package_details(package_id,package_kind)
SELECT package_id,'Membership' FROM maintenance_package WHERE package_name='CoolCare Annual Membership';

INSERT IGNORE INTO package_service(package_id,service_id,included_quantity)
SELECT p.package_id,s.service_id,1 FROM maintenance_package p CROSS JOIN service_catalog s
WHERE (p.package_name='Essential Care Bundle' AND s.service_name IN ('Air Conditioning Cleaning','General Inspection / Diagnostic'))
 OR (p.package_name='Deep Care Bundle' AND s.service_name IN ('Chemical Wash','General Inspection / Diagnostic'))
 OR (p.package_name IN ('Annual Care Plan','Quarterly Comfort Plan','CoolCare Annual Membership') AND s.service_name IN ('Air Conditioning Cleaning','General Inspection / Diagnostic'));

CREATE TABLE IF NOT EXISTS booking_service (
 booking_id INT UNSIGNED NOT NULL,
 service_id INT UNSIGNED NOT NULL,
 service_name VARCHAR(120) NOT NULL,
 base_price DECIMAL(10,2) NOT NULL,
 additional_unit_price DECIMAL(10,2) NOT NULL,
 quantity INT UNSIGNED NOT NULL,
 line_total DECIMAL(10,2) NOT NULL,
 PRIMARY KEY(booking_id,service_id),
 FOREIGN KEY(booking_id) REFERENCES booking(booking_id) ON DELETE CASCADE,
 FOREIGN KEY(service_id) REFERENCES service_catalog(service_id)
);
CREATE TABLE IF NOT EXISTS booking_package (
 booking_id INT UNSIGNED PRIMARY KEY,
 package_id INT UNSIGNED NOT NULL,
 package_name VARCHAR(120) NOT NULL,
 subscription_id INT UNSIGNED NULL,
 visit_reserved BOOLEAN NOT NULL DEFAULT FALSE,
 FOREIGN KEY(booking_id) REFERENCES booking(booking_id) ON DELETE CASCADE,
 FOREIGN KEY(package_id) REFERENCES maintenance_package(package_id),
 FOREIGN KEY(subscription_id) REFERENCES customer_subscription(subscription_id)
);
