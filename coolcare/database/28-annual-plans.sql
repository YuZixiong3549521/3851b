USE coolcare_service_app;

-- A renewal is another reviewed annual booking, never an automatic charge.
-- Unique links make retries with a new request ID unable to renew twice.
CREATE TABLE IF NOT EXISTS annual_plan_renewal (
 source_series_id INT UNSIGNED NOT NULL PRIMARY KEY,
 renewed_series_id INT UNSIGNED NOT NULL UNIQUE,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(source_series_id) REFERENCES annual_booking_series(series_id),
 FOREIGN KEY(renewed_series_id) REFERENCES annual_booking_series(series_id),
 CHECK(source_series_id <> renewed_series_id)
);

-- Only reminder acknowledgements are stored. Plan usage remains derived from
-- the existing quarterly booking rows, so return visits cannot consume twice.
CREATE TABLE IF NOT EXISTS annual_plan_notice (
 series_id INT UNSIGNED NOT NULL,
 user_id INT UNSIGNED NOT NULL,
 notice_key VARCHAR(180) NOT NULL,
 read_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(series_id,user_id,notice_key),
 FOREIGN KEY(series_id) REFERENCES annual_booking_series(series_id) ON DELETE CASCADE,
 FOREIGN KEY(user_id) REFERENCES user_account(user_id) ON DELETE CASCADE
);
