CREATE TABLE IF NOT EXISTS service_photo_upload (
 request_id CHAR(36) PRIMARY KEY,
 photo_id INT UNSIGNED NOT NULL UNIQUE,
 uploaded_by_user_id INT UNSIGNED NOT NULL,
 payload_hash CHAR(64) NOT NULL,
 FOREIGN KEY(photo_id) REFERENCES photo(photo_id),
 FOREIGN KEY(uploaded_by_user_id) REFERENCES user_account(user_id)
) ENGINE=InnoDB;
