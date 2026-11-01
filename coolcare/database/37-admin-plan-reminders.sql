USE coolcare_service_app;
CREATE TABLE IF NOT EXISTS admin_plan_reminder (
 reminder_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 request_id CHAR(36) NOT NULL UNIQUE,
 series_id INT UNSIGNED NOT NULL,
 actor_user_id INT UNSIGNED NOT NULL,
 reminder_key VARCHAR(120) NOT NULL,
 channel ENUM('Phone','Email','Other') NOT NULL,
 note VARCHAR(1500) NOT NULL,
 payload_hash CHAR(64) NOT NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 INDEX(series_id,reminder_id),
 FOREIGN KEY(series_id) REFERENCES annual_booking_series(series_id) ON DELETE CASCADE,
 FOREIGN KEY(actor_user_id) REFERENCES user_account(user_id)
);
