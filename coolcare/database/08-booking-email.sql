USE coolcare_service_app;
CREATE TABLE IF NOT EXISTS booking_email_outbox (
 email_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 booking_id INT UNSIGNED NOT NULL UNIQUE,
 recipient VARCHAR(255) NOT NULL,
 subject VARCHAR(255) NOT NULL,
 body_text MEDIUMTEXT NOT NULL,
 body_html MEDIUMTEXT NOT NULL,
 message_id VARCHAR(255) NOT NULL UNIQUE,
 delivery_mode ENUM('local','smtp','disabled') NOT NULL,
 status ENUM('Pending','Sending','Sent') NOT NULL DEFAULT 'Pending',
 attempts INT UNSIGNED NOT NULL DEFAULT 0,
 next_attempt_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 locked_at DATETIME NULL,
 sent_at DATETIME NULL,
 last_error VARCHAR(100) NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY (booking_id) REFERENCES booking(booking_id),
 INDEX idx_mail_pending(status,next_attempt_at)
) ENGINE=InnoDB;
