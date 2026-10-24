USE coolcare_service_app;

-- Only newly accepted early renewals receive an offer snapshot. Existing
-- renewals and completed orders are deliberately not backfilled.
CREATE TABLE IF NOT EXISTS annual_renewal_bonus (
 renewed_series_id INT UNSIGNED NOT NULL PRIMARY KEY,
 source_series_id INT UNSIGNED NOT NULL UNIQUE,
 points INT UNSIGNED NOT NULL,
 deadline_at DATETIME NOT NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 loyalty_transaction_id INT UNSIGNED NULL UNIQUE,
 awarded_at TIMESTAMP NULL,
 FOREIGN KEY(renewed_series_id) REFERENCES annual_booking_series(series_id),
 FOREIGN KEY(source_series_id) REFERENCES annual_booking_series(series_id),
 FOREIGN KEY(loyalty_transaction_id) REFERENCES loyalty_transaction(loyalty_transaction_id),
 CHECK(points > 0)
);
