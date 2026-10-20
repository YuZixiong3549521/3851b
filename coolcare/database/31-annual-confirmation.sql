USE coolcare_service_app;

-- The initial annual request keeps its normal confirmation deadline. Subsequent
-- quarterly visits are reservations in the same immutable annual contract.
-- Correct only future, still-pending reservations; never revive closed orders,
-- alter assignments or change the original quarterly dates and price snapshots.
UPDATE booking b
JOIN annual_booking_visit v ON v.booking_id=b.booking_id
SET b.expires_at=NULL
WHERE v.visit_number>1
  AND b.booking_status='Submitted'
  AND b.expires_at IS NOT NULL
  AND b.preferred_service_date>=DATE(DATE_ADD(UTC_TIMESTAMP(),INTERVAL 8 HOUR));
