USE coolcare_service_app;
CREATE TABLE IF NOT EXISTS admin_review_follow_up (
 report_id INT UNSIGNED PRIMARY KEY,
 status ENUM('Open','In progress','Resolved') NOT NULL,
 note VARCHAR(1500) NOT NULL,
 feedback_version INT UNSIGNED NOT NULL,
 version INT UNSIGNED NOT NULL,
 updated_by INT UNSIGNED NOT NULL,
 updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 FOREIGN KEY(report_id) REFERENCES performance_feedback(report_id) ON DELETE CASCADE,
 FOREIGN KEY(updated_by) REFERENCES user_account(user_id)
);
CREATE TABLE IF NOT EXISTS admin_review_follow_up_event (
 request_id CHAR(36) PRIMARY KEY,
 report_id INT UNSIGNED NOT NULL,
 actor_user_id INT UNSIGNED NOT NULL,
 payload_hash CHAR(64) NOT NULL,
 before_json JSON NULL,
 after_json JSON NOT NULL,
 result_json JSON NOT NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(report_id) REFERENCES performance_feedback(report_id) ON DELETE CASCADE,
 FOREIGN KEY(actor_user_id) REFERENCES user_account(user_id)
);
