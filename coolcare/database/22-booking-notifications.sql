USE coolcare_service_app;
CREATE TABLE IF NOT EXISTS customer_booking_notice (
  booking_id INT UNSIGNED NOT NULL,
  user_id INT UNSIGNED NOT NULL,
  notice_key VARCHAR(80) NOT NULL,
  read_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (booking_id,user_id,notice_key),
  CONSTRAINT fk_notice_booking FOREIGN KEY (booking_id) REFERENCES booking(booking_id) ON DELETE CASCADE,
  CONSTRAINT fk_notice_user FOREIGN KEY (user_id) REFERENCES user_account(user_id) ON DELETE CASCADE
);
