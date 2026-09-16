-- CoolCare local bootstrap: accounts and catalogue only
-- Run schema.sql first, then migrations through npm run db:up.
-- Add connected synthetic business records explicitly with npm run db:sample; see SAMPLE-DATA.md.

USE coolcare_service_app;

-- Local demo accounts. All use the bcrypt hash documented in auth_demo_password.sql.
-- Replace these credentials before using this schema outside a local demonstration.
INSERT INTO user_account (role_id, full_name, email, password_hash, phone) VALUES
  ((SELECT role_id FROM role WHERE role_name = 'Customer'), 'Alice Tan', 'alice.tan@coolcare.demo', '$2a$10$ttwWVXZBWjxwxQUWgS.fj.X0q3rUNeqCWeyeCNbXNKUBZeHEpR/B.', '9123 4567'),
  ((SELECT role_id FROM role WHERE role_name = 'Customer'), 'Ben Lee', 'ben.lee@coolcare.demo', '$2a$10$ttwWVXZBWjxwxQUWgS.fj.X0q3rUNeqCWeyeCNbXNKUBZeHEpR/B.', '9234 5678'),
  ((SELECT role_id FROM role WHERE role_name = 'Technician'), 'Chris Lim', 'chris.lim@coolcare.demo', '$2a$10$ttwWVXZBWjxwxQUWgS.fj.X0q3rUNeqCWeyeCNbXNKUBZeHEpR/B.', '9345 6789'),
  ((SELECT role_id FROM role WHERE role_name = 'Technician'), 'Farah Ahmad', 'farah.ahmad@coolcare.demo', '$2a$10$ttwWVXZBWjxwxQUWgS.fj.X0q3rUNeqCWeyeCNbXNKUBZeHEpR/B.', '9456 7890'),
  ((SELECT role_id FROM role WHERE role_name = 'Admin'), 'Norshida Selamat', 'norshida@coolcare.demo', '$2a$10$ttwWVXZBWjxwxQUWgS.fj.X0q3rUNeqCWeyeCNbXNKUBZeHEpR/B.', '9567 8901'),
  ((SELECT role_id FROM role WHERE role_name = 'Admin'), 'Mei Wong', 'mei.wong@coolcare.demo', '$2a$10$ttwWVXZBWjxwxQUWgS.fj.X0q3rUNeqCWeyeCNbXNKUBZeHEpR/B.', '9678 9012');

SET @alice_user_id := (SELECT user_id FROM user_account WHERE email = 'alice.tan@coolcare.demo');
SET @ben_user_id := (SELECT user_id FROM user_account WHERE email = 'ben.lee@coolcare.demo');
SET @chris_user_id := (SELECT user_id FROM user_account WHERE email = 'chris.lim@coolcare.demo');
SET @farah_user_id := (SELECT user_id FROM user_account WHERE email = 'farah.ahmad@coolcare.demo');
SET @norshida_user_id := (SELECT user_id FROM user_account WHERE email = 'norshida@coolcare.demo');
SET @mei_user_id := (SELECT user_id FROM user_account WHERE email = 'mei.wong@coolcare.demo');

INSERT INTO customer (user_id) VALUES (@alice_user_id), (@ben_user_id);
INSERT INTO technician (user_id, availability_status) VALUES
  (@chris_user_id, 'Busy'),
  (@farah_user_id, 'Available');
INSERT INTO admin_profile (user_id, department, position, access_level) VALUES
  (@norshida_user_id, 'Operations', 'Operations Manager', 'Owner'),
  (@mei_user_id, 'Customer Service', 'Service Coordinator', 'Admin');

SET @alice_customer_id := (SELECT customer_id FROM customer WHERE user_id = @alice_user_id);
SET @ben_customer_id := (SELECT customer_id FROM customer WHERE user_id = @ben_user_id);
SET @chris_technician_id := (SELECT technician_id FROM technician WHERE user_id = @chris_user_id);
SET @farah_technician_id := (SELECT technician_id FROM technician WHERE user_id = @farah_user_id);

INSERT INTO service_catalog (service_name, description, base_price, estimated_duration_minutes) VALUES
  ('General Cleaning', 'Routine cleaning for regular aircon maintenance.', 45.00, 60),
  ('Chemical Wash', 'Deep cleaning for persistent dirt, odour or water leakage.', 120.00, 120),
  ('Repair Service', 'Technician inspection and repair for faults or weak cooling.', 80.00, 90),
  ('Maintenance Package Service', 'Scheduled maintenance visit included in a package.', 0.00, 60);

SET @general_cleaning_id := (SELECT service_id FROM service_catalog WHERE service_name = 'General Cleaning');
SET @chemical_wash_id := (SELECT service_id FROM service_catalog WHERE service_name = 'Chemical Wash');
SET @repair_service_id := (SELECT service_id FROM service_catalog WHERE service_name = 'Repair Service');
SET @package_service_id := (SELECT service_id FROM service_catalog WHERE service_name = 'Maintenance Package Service');

INSERT INTO maintenance_package
  (package_name, description, package_price, billing_interval, included_service_count) VALUES
  ('Annual Care Plan', 'Four scheduled maintenance visits over one year.', 160.00, 'Yearly', 4),
  ('Quarterly Comfort Plan', 'One scheduled maintenance visit every three months.', 55.00, 'Quarterly', 1);

SET @annual_package_id := (SELECT package_id FROM maintenance_package WHERE package_name = 'Annual Care Plan');
SET @quarterly_package_id := (SELECT package_id FROM maintenance_package WHERE package_name = 'Quarterly Comfort Plan');

INSERT INTO package_service (package_id, service_id, included_quantity) VALUES
  (@annual_package_id, @package_service_id, 4),
  (@quarterly_package_id, @package_service_id, 1);

-- Opening stock is recorded by the optional scenario loader, never an unbalanced counter.
INSERT INTO part (part_name, unit_price, status, current_stock) VALUES
  ('Aircon Filter', 18.00, 'Active', 0),
  ('Drain Hose', 12.50, 'Active', 0),
  ('Capacitor 35uF', 35.00, 'Active', 0);
