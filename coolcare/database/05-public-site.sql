USE coolcare_service_app;
CREATE TABLE IF NOT EXISTS web_customer_profile (
 user_id INT UNSIGNED PRIMARY KEY, property_type VARCHAR(120),
 FOREIGN KEY (user_id) REFERENCES user_account(user_id)
);
CREATE TABLE IF NOT EXISTS web_booking_details (
 booking_id INT UNSIGNED PRIMARY KEY, service_package VARCHAR(120),
 contact_phone VARCHAR(30), special_notes TEXT, request_id CHAR(36) UNIQUE,
 FOREIGN KEY (booking_id) REFERENCES booking(booking_id)
);
CREATE TABLE IF NOT EXISTS web_legacy_import (
 source_key VARCHAR(120) PRIMARY KEY, target_id INT UNSIGNED NOT NULL
);
