-- CoolCare Semester 2 database schema
-- MySQL 8.0+ | Run this file in MySQL Workbench.

CREATE DATABASE IF NOT EXISTS coolcare_service_app
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE coolcare_service_app;

-- Shared accounts -----------------------------------------------------------
CREATE TABLE role (
  role_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  role_name VARCHAR(30) NOT NULL UNIQUE,
  description VARCHAR(255)
) ENGINE=InnoDB;

CREATE TABLE user_account (
  user_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  role_id INT UNSIGNED NOT NULL,
  full_name VARCHAR(120) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  phone VARCHAR(30),
  status ENUM('Active', 'Inactive', 'Suspended') NOT NULL DEFAULT 'Active',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_user_account_role FOREIGN KEY (role_id) REFERENCES role(role_id)
) ENGINE=InnoDB;

CREATE TABLE customer (
  customer_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL UNIQUE,
  CONSTRAINT fk_customer_user FOREIGN KEY (user_id)
    REFERENCES user_account(user_id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE technician (
  technician_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL UNIQUE,
  availability_status ENUM('Available', 'Busy', 'Unavailable', 'On Leave')
    NOT NULL DEFAULT 'Available',
  last_assigned_at DATETIME NULL,
  CONSTRAINT fk_technician_user FOREIGN KEY (user_id)
    REFERENCES user_account(user_id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE technician_capacity_lock (
  lock_id TINYINT UNSIGNED PRIMARY KEY,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT chk_technician_capacity_lock CHECK (lock_id = 1)
) ENGINE=InnoDB;
INSERT INTO technician_capacity_lock(lock_id) VALUES (1);

CREATE TABLE admin_profile (
  user_id INT UNSIGNED PRIMARY KEY,
  department VARCHAR(100),
  position VARCHAR(100),
  access_level ENUM('Owner', 'Admin') NOT NULL DEFAULT 'Admin',
  owner_singleton TINYINT GENERATED ALWAYS AS (CASE WHEN access_level = 'Owner' THEN 1 ELSE NULL END) STORED UNIQUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_admin_profile_user FOREIGN KEY (user_id)
    REFERENCES user_account(user_id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Service catalogue, packages and subscriptions ----------------------------
CREATE TABLE service_catalog (
  service_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  service_name VARCHAR(120) NOT NULL UNIQUE,
  description TEXT,
  base_price DECIMAL(10,2) NOT NULL,
  estimated_duration_minutes INT UNSIGNED NOT NULL,
  service_status ENUM('Active', 'Inactive') NOT NULL DEFAULT 'Active',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE maintenance_package (
  package_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  package_name VARCHAR(120) NOT NULL UNIQUE,
  description TEXT,
  package_price DECIMAL(10,2) NOT NULL,
  billing_interval ENUM('Monthly', 'Quarterly', 'Yearly') NOT NULL,
  included_service_count INT UNSIGNED NOT NULL DEFAULT 1,
  package_status ENUM('Active', 'Inactive') NOT NULL DEFAULT 'Active',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE package_service (
  package_id INT UNSIGNED NOT NULL,
  service_id INT UNSIGNED NOT NULL,
  included_quantity INT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (package_id, service_id),
  CONSTRAINT fk_package_service_package FOREIGN KEY (package_id)
    REFERENCES maintenance_package(package_id) ON DELETE CASCADE,
  CONSTRAINT fk_package_service_service FOREIGN KEY (service_id)
    REFERENCES service_catalog(service_id)
) ENGINE=InnoDB;

CREATE TABLE customer_subscription (
  subscription_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  customer_id INT UNSIGNED NOT NULL,
  package_id INT UNSIGNED NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  next_service_due DATE NULL,
  remaining_service_count INT UNSIGNED NOT NULL DEFAULT 0,
  subscription_status ENUM('Active', 'Paused', 'Expired', 'Cancelled')
    NOT NULL DEFAULT 'Active',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_subscription_dates CHECK (end_date >= start_date),
  CONSTRAINT fk_customer_subscription_customer FOREIGN KEY (customer_id)
    REFERENCES customer(customer_id) ON DELETE CASCADE,
  CONSTRAINT fk_customer_subscription_package FOREIGN KEY (package_id)
    REFERENCES maintenance_package(package_id)
) ENGINE=InnoDB;

CREATE TABLE loyalty_account (
  loyalty_account_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  customer_id INT UNSIGNED NOT NULL UNIQUE,
  current_points INT NOT NULL DEFAULT 0,
  loyalty_tier ENUM('Bronze', 'Silver', 'Gold', 'Platinum') NOT NULL DEFAULT 'Bronze',
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_loyalty_account_customer FOREIGN KEY (customer_id)
    REFERENCES customer(customer_id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Customer, equipment and booking ------------------------------------------
CREATE TABLE service_address (
  address_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  customer_id INT UNSIGNED NOT NULL,
  address_label VARCHAR(80),
  address_line VARCHAR(255) NOT NULL,
  postal_code VARCHAR(20),
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  CONSTRAINT fk_service_address_customer FOREIGN KEY (customer_id)
    REFERENCES customer(customer_id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE aircon_unit (
  unit_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  customer_id INT UNSIGNED NOT NULL,
  address_id INT UNSIGNED,
  brand VARCHAR(80),
  model VARCHAR(100),
  serial_number VARCHAR(100) UNIQUE,
  installation_location VARCHAR(150),
  warranty_status ENUM('In Warranty', 'Out of Warranty', 'Unknown')
    NOT NULL DEFAULT 'Unknown',
  CONSTRAINT fk_aircon_unit_customer FOREIGN KEY (customer_id)
    REFERENCES customer(customer_id) ON DELETE CASCADE,
  CONSTRAINT fk_aircon_unit_address FOREIGN KEY (address_id)
    REFERENCES service_address(address_id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE booking (
  booking_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  customer_id INT UNSIGNED NOT NULL,
  address_id INT UNSIGNED NOT NULL,
  service_id INT UNSIGNED NOT NULL,
  subscription_id INT UNSIGNED NULL,
  preferred_service_date DATE NOT NULL,
  preferred_time_slot VARCHAR(50) NOT NULL,
  slot_start TIME NULL,
  slot_end TIME NULL,
  problem_description TEXT,
  booking_status ENUM('Submitted', 'Confirmed', 'Assigned', 'On The Way', 'In Progress', 'Completed', 'Rejected', 'Cancelled')
    NOT NULL DEFAULT 'Submitted',
  total_amount DECIMAL(10,2),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_booking_customer FOREIGN KEY (customer_id)
    REFERENCES customer(customer_id),
  CONSTRAINT fk_booking_address FOREIGN KEY (address_id)
    REFERENCES service_address(address_id),
  CONSTRAINT fk_booking_service FOREIGN KEY (service_id)
    REFERENCES service_catalog(service_id),
  CONSTRAINT fk_booking_subscription FOREIGN KEY (subscription_id)
    REFERENCES customer_subscription(subscription_id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE booking_aircon_unit (
  booking_id INT UNSIGNED NOT NULL,
  unit_id INT UNSIGNED NOT NULL,
  PRIMARY KEY (booking_id, unit_id),
  CONSTRAINT fk_booking_aircon_unit_booking FOREIGN KEY (booking_id)
    REFERENCES booking(booking_id) ON DELETE CASCADE,
  CONSTRAINT fk_booking_aircon_unit_unit FOREIGN KEY (unit_id)
    REFERENCES aircon_unit(unit_id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE booking_change_request (
  request_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  booking_id INT UNSIGNED NOT NULL,
  request_type ENUM('Reschedule', 'Cancel', 'Update Details') NOT NULL,
  requested_service_date DATE,
  requested_time_slot VARCHAR(50),
  reason TEXT,
  request_status ENUM('Pending', 'Approved', 'Rejected', 'Cancelled') NOT NULL DEFAULT 'Pending',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_booking_change_request_booking FOREIGN KEY (booking_id)
    REFERENCES booking(booking_id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE booking_status_history (
  history_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  booking_id INT UNSIGNED NOT NULL,
  old_status VARCHAR(40),
  new_status VARCHAR(40) NOT NULL,
  changed_by_user_id INT UNSIGNED,
  change_note VARCHAR(500),
  changed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_booking_status_history_booking FOREIGN KEY (booking_id)
    REFERENCES booking(booking_id) ON DELETE CASCADE,
  CONSTRAINT fk_booking_status_history_user FOREIGN KEY (changed_by_user_id)
    REFERENCES user_account(user_id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE loyalty_transaction (
  loyalty_transaction_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  loyalty_account_id INT UNSIGNED NOT NULL,
  booking_id INT UNSIGNED NULL,
  transaction_type ENUM('Earned', 'Redeemed', 'Expired', 'Adjusted') NOT NULL,
  points INT NOT NULL,
  description VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_loyalty_transaction_account FOREIGN KEY (loyalty_account_id)
    REFERENCES loyalty_account(loyalty_account_id) ON DELETE CASCADE,
  CONSTRAINT fk_loyalty_transaction_booking FOREIGN KEY (booking_id)
    REFERENCES booking(booking_id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- Promotions ---------------------------------------------------------------
CREATE TABLE promotion (
  promotion_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  promotion_name VARCHAR(120) NOT NULL,
  description TEXT,
  discount_type ENUM('Percentage', 'Fixed Amount') NOT NULL,
  discount_value DECIMAL(10,2) NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  promotion_status ENUM('Draft', 'Active', 'Expired', 'Inactive') NOT NULL DEFAULT 'Draft',
  CONSTRAINT chk_promotion_dates CHECK (end_date >= start_date)
) ENGINE=InnoDB;

CREATE TABLE booking_promotion (
  booking_promotion_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  booking_id INT UNSIGNED NOT NULL,
  promotion_id INT UNSIGNED NOT NULL,
  applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_booking_promotion (booking_id, promotion_id),
  CONSTRAINT fk_booking_promotion_booking FOREIGN KEY (booking_id)
    REFERENCES booking(booking_id) ON DELETE CASCADE,
  CONSTRAINT fk_booking_promotion_promotion FOREIGN KEY (promotion_id)
    REFERENCES promotion(promotion_id)
) ENGINE=InnoDB;

CREATE TABLE package_promotion (
  package_promotion_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  package_id INT UNSIGNED NOT NULL,
  promotion_id INT UNSIGNED NOT NULL,
  applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_package_promotion (package_id, promotion_id),
  CONSTRAINT fk_package_promotion_package FOREIGN KEY (package_id)
    REFERENCES maintenance_package(package_id) ON DELETE CASCADE,
  CONSTRAINT fk_package_promotion_promotion FOREIGN KEY (promotion_id)
    REFERENCES promotion(promotion_id)
) ENGINE=InnoDB;

-- Admin allocation and technician execution --------------------------------
CREATE TABLE assignment (
  assignment_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  booking_id INT UNSIGNED NOT NULL,
  technician_id INT UNSIGNED NOT NULL,
  assigned_by_admin_id INT UNSIGNED NOT NULL,
  dispatch_request_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL UNIQUE,
  assignment_status ENUM('Assigned', 'Accepted', 'Declined', 'Reassigned', 'Cancelled', 'Completed')
    NOT NULL DEFAULT 'Assigned',
  assigned_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_assignment_booking FOREIGN KEY (booking_id)
    REFERENCES booking(booking_id),
  CONSTRAINT fk_assignment_technician FOREIGN KEY (technician_id)
    REFERENCES technician(technician_id),
  CONSTRAINT fk_assignment_admin FOREIGN KEY (assigned_by_admin_id)
    REFERENCES admin_profile(user_id)
) ENGINE=InnoDB;

CREATE TABLE work_order (
  job_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  booking_id INT UNSIGNED NOT NULL,
  assignment_id INT UNSIGNED NOT NULL UNIQUE,
  appointment_date DATETIME NOT NULL,
  appointment_time TIME,
  priority_level ENUM('Low', 'Normal', 'High', 'Urgent') NOT NULL DEFAULT 'Normal',
  reported_problem TEXT,
  current_status ENUM('Assigned', 'On The Way', 'In Progress', 'Completed', 'Cancelled')
    NOT NULL DEFAULT 'Assigned',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_work_order_booking FOREIGN KEY (booking_id)
    REFERENCES booking(booking_id),
  CONSTRAINT fk_work_order_assignment FOREIGN KEY (assignment_id)
    REFERENCES assignment(assignment_id)
) ENGINE=InnoDB;

CREATE TABLE service_report (
  report_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  job_id INT UNSIGNED NOT NULL UNIQUE,
  work_performed TEXT NOT NULL,
  problem_found TEXT,
  solution_applied TEXT,
  checklist_result TEXT,
  submitted_time TIMESTAMP NULL,
  customer_signature_url VARCHAR(500),
  technician_signature_url VARCHAR(500),
  CONSTRAINT fk_service_report_work_order FOREIGN KEY (job_id)
    REFERENCES work_order(job_id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE technician_performance_score (
  performance_score_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  technician_id INT UNSIGNED NOT NULL,
  job_id INT UNSIGNED NOT NULL UNIQUE,
  scored_by_admin_id INT UNSIGNED NOT NULL,
  punctuality_score DECIMAL(3,2) NOT NULL,
  service_quality_score DECIMAL(3,2) NOT NULL,
  customer_rating DECIMAL(3,2) NULL,
  overall_score DECIMAL(3,2) NOT NULL,
  comments VARCHAR(500) NULL,
  scored_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_punctuality_score CHECK (punctuality_score BETWEEN 0 AND 5),
  CONSTRAINT chk_service_quality_score CHECK (service_quality_score BETWEEN 0 AND 5),
  CONSTRAINT chk_customer_rating CHECK (customer_rating BETWEEN 0 AND 5),
  CONSTRAINT chk_overall_score CHECK (overall_score BETWEEN 0 AND 5),
  CONSTRAINT fk_performance_score_technician FOREIGN KEY (technician_id)
    REFERENCES technician(technician_id),
  CONSTRAINT fk_performance_score_job FOREIGN KEY (job_id)
    REFERENCES work_order(job_id) ON DELETE CASCADE,
  CONSTRAINT fk_performance_score_admin FOREIGN KEY (scored_by_admin_id)
    REFERENCES admin_profile(user_id)
) ENGINE=InnoDB;

CREATE TABLE photo (
  photo_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  job_id INT UNSIGNED NOT NULL,
  photo_url VARCHAR(500) NOT NULL,
  description VARCHAR(255),
  captured_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_photo_work_order FOREIGN KEY (job_id)
    REFERENCES work_order(job_id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Inventory ----------------------------------------------------------------
CREATE TABLE part (
  part_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  part_name VARCHAR(120) NOT NULL,
  unit_price DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  status ENUM('Active', 'Inactive', 'Discontinued') NOT NULL DEFAULT 'Active',
  current_stock INT NOT NULL DEFAULT 0
) ENGINE=InnoDB;

CREATE TABLE inventory_transaction (
  transaction_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  job_id INT UNSIGNED,
  part_id INT UNSIGNED NOT NULL,
  transaction_type ENUM('Stock In', 'Stock Out', 'Adjustment', 'Return') NOT NULL,
  quantity INT NOT NULL,
  remarks VARCHAR(500),
  admin_user_id INT UNSIGNED,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_inventory_quantity CHECK (quantity > 0),
  CONSTRAINT fk_inventory_transaction_job FOREIGN KEY (job_id)
    REFERENCES work_order(job_id),
  CONSTRAINT fk_inventory_transaction_part FOREIGN KEY (part_id)
    REFERENCES part(part_id),
  CONSTRAINT fk_inventory_transaction_admin FOREIGN KEY (admin_user_id)
    REFERENCES admin_profile(user_id)
) ENGINE=InnoDB;

-- Chatbot ------------------------------------------------------------------
CREATE TABLE chatbot_conversation (
  conversation_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  customer_id INT UNSIGNED,
  conversation_status ENUM('Open', 'Closed', 'Escalated') NOT NULL DEFAULT 'Open',
  started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ended_at TIMESTAMP NULL,
  CONSTRAINT fk_chatbot_conversation_customer FOREIGN KEY (customer_id)
    REFERENCES customer(customer_id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE chatbot_message (
  message_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  conversation_id INT UNSIGNED NOT NULL,
  sender_type ENUM('Customer', 'Chatbot', 'Admin') NOT NULL,
  message_content TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_chatbot_message_conversation FOREIGN KEY (conversation_id)
    REFERENCES chatbot_conversation(conversation_id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Development baseline roles. Store real account passwords only as bcrypt hashes.
INSERT INTO role (role_name, description) VALUES
  ('Customer', 'Customer booking and service-history access'),
  ('Technician', 'Assigned job and service-report access'),
  ('Admin', 'Operational management and technician allocation')
ON DUPLICATE KEY UPDATE description = VALUES(description);

CREATE INDEX idx_booking_customer_status ON booking(customer_id, booking_status);
CREATE INDEX idx_booking_capacity ON booking(preferred_service_date, booking_status, slot_start, slot_end);
CREATE INDEX idx_booking_service ON booking(service_id);
CREATE INDEX idx_subscription_customer_status ON customer_subscription(customer_id, subscription_status);
CREATE INDEX idx_assignment_booking_status ON assignment(booking_id, assignment_status);
CREATE INDEX idx_assignment_technician_status ON assignment(technician_id, assignment_status);
CREATE INDEX idx_work_order_status_date ON work_order(current_status, appointment_date);
CREATE INDEX idx_inventory_transaction_part ON inventory_transaction(part_id, created_at);
CREATE INDEX idx_chatbot_message_conversation ON chatbot_message(conversation_id, created_at);

-- Analytics views are derived from operational data and do not duplicate it.
CREATE OR REPLACE VIEW vw_daily_jobs_dashboard AS
SELECT
  DATE(w.appointment_date) AS service_date,
  COUNT(*) AS total_jobs,
  SUM(w.current_status = 'Assigned') AS assigned_jobs,
  SUM(w.current_status = 'In Progress') AS in_progress_jobs,
  SUM(w.current_status = 'Completed') AS completed_jobs
FROM work_order w
GROUP BY DATE(w.appointment_date);

CREATE OR REPLACE VIEW vw_monthly_revenue_summary AS
SELECT
  DATE_FORMAT(b.preferred_service_date, '%Y-%m') AS revenue_month,
  COUNT(*) AS completed_booking_count,
  COALESCE(SUM(b.total_amount), 0) AS total_revenue
FROM booking b
WHERE b.booking_status = 'Completed'
GROUP BY DATE_FORMAT(b.preferred_service_date, '%Y-%m');

CREATE OR REPLACE VIEW vw_technician_performance AS
SELECT
  t.technician_id,
  u.full_name AS technician_name,
  COUNT(ps.performance_score_id) AS scored_jobs,
  ROUND(AVG(ps.punctuality_score), 2) AS average_punctuality_score,
  ROUND(AVG(ps.service_quality_score), 2) AS average_quality_score,
  ROUND(AVG(ps.overall_score), 2) AS average_overall_score
FROM technician t
JOIN user_account u ON u.user_id = t.user_id
LEFT JOIN technician_performance_score ps ON ps.technician_id = t.technician_id
GROUP BY t.technician_id, u.full_name;

CREATE OR REPLACE VIEW vw_customer_loyalty_summary AS
SELECT
  c.customer_id,
  u.full_name AS customer_name,
  la.loyalty_tier,
  la.current_points,
  COALESCE(SUM(CASE WHEN lt.transaction_type = 'Earned' THEN lt.points ELSE 0 END), 0) AS total_points_earned,
  COALESCE(SUM(CASE WHEN lt.transaction_type = 'Redeemed' THEN ABS(lt.points) ELSE 0 END), 0) AS total_points_redeemed
FROM loyalty_account la
JOIN customer c ON c.customer_id = la.customer_id
JOIN user_account u ON u.user_id = c.user_id
LEFT JOIN loyalty_transaction lt ON lt.loyalty_account_id = la.loyalty_account_id
GROUP BY c.customer_id, u.full_name, la.loyalty_tier, la.current_points;

CREATE OR REPLACE VIEW vw_inventory_stock_summary AS
SELECT
  part_id,
  part_name,
  current_stock,
  unit_price,
  current_stock * unit_price AS stock_value
FROM part;
