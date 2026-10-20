USE coolcare_service_app;

-- Cash received is deliberately separate from quoted booking amounts. No
-- historical receipt or loyalty earning is inferred by this migration.
CREATE TABLE IF NOT EXISTS commerce_payment (
 payment_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 booking_id INT UNSIGNED NOT NULL,
 kind ENUM('Receipt','Refund') NOT NULL,
 amount DECIMAL(10,2) NOT NULL,
 method ENUM('Cash','PayNow','Bank transfer','Card','Other') NOT NULL,
 received_date DATE NOT NULL,
 reference VARCHAR(120) NOT NULL DEFAULT '',
 notes VARCHAR(1000) NOT NULL,
 actor_user_id INT UNSIGNED NOT NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK(amount > 0),
 FOREIGN KEY(booking_id) REFERENCES booking(booking_id),
 FOREIGN KEY(actor_user_id) REFERENCES user_account(user_id),
 KEY payment_date(received_date,booking_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS commerce_operation (
 request_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 actor_user_id INT UNSIGNED NOT NULL,
 payload_hash CHAR(64) NOT NULL,
 result_json JSON NOT NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(actor_user_id) REFERENCES user_account(user_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS reward_rule (
 rule_id INT UNSIGNED PRIMARY KEY,
 version INT UNSIGNED NOT NULL DEFAULT 1,
 points_per_dollar INT UNSIGNED NOT NULL DEFAULT 1,
 redemption_points INT UNSIGNED NOT NULL DEFAULT 100,
 redemption_value DECIMAL(10,2) NOT NULL DEFAULT 5,
 updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 CHECK(points_per_dollar BETWEEN 0 AND 100),
 CHECK(redemption_points > 0),
 CHECK(redemption_value > 0)
) ENGINE=InnoDB;
INSERT IGNORE INTO reward_rule(rule_id) VALUES (1);

CREATE TABLE IF NOT EXISTS reward_rule_audit (
 audit_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 version INT UNSIGNED NOT NULL UNIQUE,
 actor_user_id INT UNSIGNED NOT NULL,
 rule_json JSON NOT NULL,
 reason VARCHAR(500) NOT NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(actor_user_id) REFERENCES user_account(user_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS reward_reservation (
 booking_id INT UNSIGNED PRIMARY KEY,
 loyalty_account_id INT UNSIGNED NOT NULL,
 points INT UNSIGNED NOT NULL,
 discount_amount DECIMAL(10,2) NOT NULL,
 rule_version INT UNSIGNED NOT NULL,
 status ENUM('Reserved','Redeemed','Released') NOT NULL DEFAULT 'Reserved',
 reason VARCHAR(255) NOT NULL DEFAULT '',
 updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 FOREIGN KEY(booking_id) REFERENCES booking(booking_id),
 FOREIGN KEY(loyalty_account_id) REFERENCES loyalty_account(loyalty_account_id),
 KEY reward_reservation_account(loyalty_account_id,status)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS reward_booking_earning (
 booking_id INT UNSIGNED PRIMARY KEY,
 loyalty_account_id INT UNSIGNED NOT NULL,
 points_per_dollar INT UNSIGNED NOT NULL,
 rule_version INT UNSIGNED NOT NULL,
 awarded_points INT NOT NULL DEFAULT 0,
 updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 FOREIGN KEY(booking_id) REFERENCES booking(booking_id),
 FOREIGN KEY(loyalty_account_id) REFERENCES loyalty_account(loyalty_account_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS reward_adjustment_audit (
 audit_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 loyalty_transaction_id INT UNSIGNED NOT NULL UNIQUE,
 actor_user_id INT UNSIGNED NOT NULL,
 reason VARCHAR(500) NOT NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(loyalty_transaction_id) REFERENCES loyalty_transaction(loyalty_transaction_id),
 FOREIGN KEY(actor_user_id) REFERENCES user_account(user_id)
) ENGINE=InnoDB;
