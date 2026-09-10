-- CoolCare Semester 2 demonstration data
-- Run schema.sql first. Run this file once on a new coolcare_service_app database.

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
INSERT INTO admin_profile (user_id, department, position) VALUES
  (@norshida_user_id, 'Operations', 'Operations Manager'),
  (@mei_user_id, 'Customer Service', 'Service Coordinator');

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

INSERT INTO service_address (customer_id, address_label, address_line, postal_code, is_default) VALUES
  (@alice_customer_id, 'Home', 'Blk 123, Example Street, Singapore', '560123', TRUE),
  (@ben_customer_id, 'Office', '88 Demo Avenue, Singapore', '238888', TRUE);

SET @alice_address_id := (SELECT address_id FROM service_address WHERE customer_id = @alice_customer_id AND is_default = TRUE);
SET @ben_address_id := (SELECT address_id FROM service_address WHERE customer_id = @ben_customer_id AND is_default = TRUE);

INSERT INTO aircon_unit
  (customer_id, address_id, brand, model, serial_number, installation_location, warranty_status) VALUES
  (@alice_customer_id, @alice_address_id, 'Daikin', 'FTKF25A', 'ALICE-DAIKIN-001', 'Living Room', 'In Warranty'),
  (@alice_customer_id, @alice_address_id, 'Mitsubishi', 'MSY-GR10', 'ALICE-MITSU-002', 'Master Bedroom', 'Out of Warranty'),
  (@ben_customer_id, @ben_address_id, 'Panasonic', 'CS-XPU10', 'BEN-PANA-001', 'Meeting Room', 'Unknown');

SET @alice_unit_1 := (SELECT unit_id FROM aircon_unit WHERE serial_number = 'ALICE-DAIKIN-001');
SET @alice_unit_2 := (SELECT unit_id FROM aircon_unit WHERE serial_number = 'ALICE-MITSU-002');
SET @ben_unit_1 := (SELECT unit_id FROM aircon_unit WHERE serial_number = 'BEN-PANA-001');

INSERT INTO customer_subscription
  (customer_id, package_id, start_date, end_date, next_service_due, remaining_service_count, subscription_status) VALUES
  (@alice_customer_id, @annual_package_id, '2026-01-01', '2026-12-31', '2026-09-15', 2, 'Active'),
  (@ben_customer_id, @quarterly_package_id, '2026-07-01', '2026-09-30', '2026-09-20', 1, 'Active');

SET @alice_subscription_id := (SELECT subscription_id FROM customer_subscription WHERE customer_id = @alice_customer_id AND package_id = @annual_package_id);
SET @ben_subscription_id := (SELECT subscription_id FROM customer_subscription WHERE customer_id = @ben_customer_id AND package_id = @quarterly_package_id);

INSERT INTO loyalty_account (customer_id, current_points, loyalty_tier) VALUES
  (@alice_customer_id, 230, 'Silver'),
  (@ben_customer_id, 80, 'Bronze');

SET @alice_loyalty_id := (SELECT loyalty_account_id FROM loyalty_account WHERE customer_id = @alice_customer_id);
SET @ben_loyalty_id := (SELECT loyalty_account_id FROM loyalty_account WHERE customer_id = @ben_customer_id);

INSERT INTO promotion
  (promotion_name, description, discount_type, discount_value, start_date, end_date, promotion_status) VALUES
  ('August Service Offer', 'Ten percent off selected chemical wash bookings.', 'Percentage', 10.00, '2026-08-01', '2026-08-31', 'Active'),
  ('Annual Plan Launch', 'Fixed discount for the Annual Care Plan.', 'Fixed Amount', 20.00, '2026-07-01', '2026-12-31', 'Active');

SET @august_offer_id := (SELECT promotion_id FROM promotion WHERE promotion_name = 'August Service Offer');
SET @annual_plan_offer_id := (SELECT promotion_id FROM promotion WHERE promotion_name = 'Annual Plan Launch');

INSERT INTO package_promotion (package_id, promotion_id) VALUES
  (@annual_package_id, @annual_plan_offer_id);

-- Three bookings show completed, assigned and submitted states.
INSERT INTO booking
  (customer_id, address_id, service_id, subscription_id, preferred_service_date, preferred_time_slot,
   problem_description, booking_status, total_amount) VALUES
  (@alice_customer_id, @alice_address_id, @package_service_id, @alice_subscription_id, '2026-08-10', '10:00 - 12:00',
   'Scheduled maintenance visit. Please clean both indoor units.', 'Completed', 0.00),
  (@ben_customer_id, @ben_address_id, @repair_service_id, NULL, '2026-09-05', '14:00 - 16:00',
   'Aircon is not cooling well in the meeting room.', 'Assigned', 80.00),
  (@alice_customer_id, @alice_address_id, @chemical_wash_id, NULL, '2026-09-18', '09:00 - 11:00',
   'Water leakage from the living-room unit after several hours of use.', 'Submitted', 108.00);

SET @alice_completed_booking_id := (SELECT booking_id FROM booking WHERE problem_description = 'Scheduled maintenance visit. Please clean both indoor units.');
SET @ben_assigned_booking_id := (SELECT booking_id FROM booking WHERE problem_description = 'Aircon is not cooling well in the meeting room.');
SET @alice_submitted_booking_id := (SELECT booking_id FROM booking WHERE problem_description = 'Water leakage from the living-room unit after several hours of use.');

INSERT INTO booking_aircon_unit (booking_id, unit_id) VALUES
  (@alice_completed_booking_id, @alice_unit_1),
  (@alice_completed_booking_id, @alice_unit_2),
  (@ben_assigned_booking_id, @ben_unit_1),
  (@alice_submitted_booking_id, @alice_unit_1);

INSERT INTO booking_promotion (booking_id, promotion_id) VALUES
  (@alice_submitted_booking_id, @august_offer_id);

INSERT INTO booking_change_request
  (booking_id, request_type, requested_service_date, requested_time_slot, reason, request_status) VALUES
  (@alice_submitted_booking_id, 'Reschedule', '2026-09-20', '14:00 - 16:00', 'Customer will be away on the original date.', 'Pending');

INSERT INTO booking_status_history (booking_id, old_status, new_status, changed_by_user_id, change_note) VALUES
  (@alice_completed_booking_id, NULL, 'Submitted', @alice_user_id, 'Booking created from annual maintenance subscription.'),
  (@alice_completed_booking_id, 'Submitted', 'Confirmed', @mei_user_id, 'Appointment confirmed with customer.'),
  (@alice_completed_booking_id, 'Confirmed', 'Assigned', @mei_user_id, 'Technician assigned.'),
  (@alice_completed_booking_id, 'Assigned', 'Completed', @chris_user_id, 'Service report submitted.'),
  (@ben_assigned_booking_id, NULL, 'Submitted', @ben_user_id, 'Booking created by customer.'),
  (@ben_assigned_booking_id, 'Submitted', 'Assigned', @mei_user_id, 'Technician assigned for inspection.'),
  (@alice_submitted_booking_id, NULL, 'Submitted', @alice_user_id, 'Booking created from customer portal.');

INSERT INTO loyalty_transaction (loyalty_account_id, booking_id, transaction_type, points, description) VALUES
  (@alice_loyalty_id, @alice_completed_booking_id, 'Earned', 100, 'Points earned after completed annual maintenance visit.'),
  (@alice_loyalty_id, NULL, 'Adjusted', 130, 'Welcome and package loyalty-point adjustment.'),
  (@ben_loyalty_id, @ben_assigned_booking_id, 'Earned', 80, 'Pending points to be confirmed after service completion.');

INSERT INTO assignment (booking_id, technician_id, assigned_by_admin_id, assignment_status) VALUES
  (@alice_completed_booking_id, @chris_technician_id, @mei_user_id, 'Completed'),
  (@ben_assigned_booking_id, @farah_technician_id, @mei_user_id, 'Accepted');

SET @alice_assignment_id := (SELECT assignment_id FROM assignment WHERE booking_id = @alice_completed_booking_id);
SET @ben_assignment_id := (SELECT assignment_id FROM assignment WHERE booking_id = @ben_assigned_booking_id);

INSERT INTO work_order
  (booking_id, assignment_id, appointment_date, appointment_time, priority_level, reported_problem, current_status) VALUES
  (@alice_completed_booking_id, @alice_assignment_id, '2026-08-10 10:00:00', '10:00:00', 'Normal',
   'Scheduled package maintenance for two aircon units.', 'Completed'),
  (@ben_assigned_booking_id, @ben_assignment_id, '2026-09-05 14:00:00', '14:00:00', 'High',
   'Weak cooling reported in meeting-room aircon unit.', 'Assigned');

SET @alice_job_id := (SELECT job_id FROM work_order WHERE assignment_id = @alice_assignment_id);
SET @ben_job_id := (SELECT job_id FROM work_order WHERE assignment_id = @ben_assignment_id);

INSERT INTO service_report
  (job_id, work_performed, problem_found, solution_applied, checklist_result, submitted_time,
   customer_signature_url, technician_signature_url) VALUES
  (@alice_job_id, 'Cleaned filters, checked drainage and tested cooling performance for two units.',
   'Dust accumulation found in indoor-unit filters.',
   'Filters cleaned and drainage flow confirmed.',
   'All checklist items passed.', '2026-08-10 11:40:00',
   'https://example.com/signatures/alice-customer.png',
   'https://example.com/signatures/chris-technician.png');

INSERT INTO photo (job_id, photo_url, description, captured_time) VALUES
  (@alice_job_id, 'https://example.com/photos/alice-before.jpg', 'Indoor-unit filter before cleaning.', '2026-08-10 10:15:00'),
  (@alice_job_id, 'https://example.com/photos/alice-after.jpg', 'Indoor-unit filter after cleaning.', '2026-08-10 11:20:00');

INSERT INTO technician_performance_score
  (technician_id, job_id, scored_by_admin_id, punctuality_score, service_quality_score, customer_rating, overall_score, comments) VALUES
  (@chris_technician_id, @alice_job_id, @mei_user_id, 5.00, 4.80, 5.00, 4.93,
   'Arrived on time, completed the checklist and submitted a clear report.');

INSERT INTO part (part_name, unit_price, status, current_stock) VALUES
  ('Aircon Filter', 18.00, 'Active', 25),
  ('Drain Hose', 12.50, 'Active', 40),
  ('Capacitor 35uF', 35.00, 'Active', 12);

SET @filter_part_id := (SELECT part_id FROM part WHERE part_name = 'Aircon Filter');
SET @hose_part_id := (SELECT part_id FROM part WHERE part_name = 'Drain Hose');
SET @capacitor_part_id := (SELECT part_id FROM part WHERE part_name = 'Capacitor 35uF');

INSERT INTO inventory_transaction
  (job_id, part_id, transaction_type, quantity, remarks, admin_user_id) VALUES
  (NULL, @filter_part_id, 'Stock In', 30, 'Initial demonstration stock.', @norshida_user_id),
  (@alice_job_id, @filter_part_id, 'Stock Out', 5, 'Filters used during scheduled maintenance.', @mei_user_id),
  (NULL, @hose_part_id, 'Stock In', 40, 'Initial demonstration stock.', @norshida_user_id),
  (NULL, @capacitor_part_id, 'Stock In', 12, 'Initial demonstration stock.', @norshida_user_id);

INSERT INTO chatbot_conversation (customer_id, conversation_status, started_at, ended_at) VALUES
  (@ben_customer_id, 'Closed', '2026-08-28 09:10:00', '2026-08-28 09:14:00');

SET @ben_conversation_id := (SELECT conversation_id FROM chatbot_conversation WHERE customer_id = @ben_customer_id ORDER BY conversation_id DESC LIMIT 1);

INSERT INTO chatbot_message (conversation_id, sender_type, message_content, created_at) VALUES
  (@ben_conversation_id, 'Customer', 'I want to know the status of my aircon repair booking.', '2026-08-28 09:10:00'),
  (@ben_conversation_id, 'Chatbot', 'Your booking has been assigned to a technician.', '2026-08-28 09:10:05'),
  (@ben_conversation_id, 'Customer', 'Can I change the appointment time?', '2026-08-28 09:11:00'),
  (@ben_conversation_id, 'Chatbot', 'You can submit a reschedule request from your booking details page.', '2026-08-28 09:11:06');

-- Quick verification queries (run manually in MySQL Workbench if needed):
-- SELECT * FROM vw_daily_jobs_dashboard;
-- SELECT * FROM vw_monthly_revenue_summary;
-- SELECT * FROM vw_technician_performance;
-- SELECT * FROM vw_customer_loyalty_summary;
-- SELECT * FROM vw_inventory_stock_summary;
