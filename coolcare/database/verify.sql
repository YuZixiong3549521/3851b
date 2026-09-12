-- Read-only checks for the current schema and optional connected sample data.
-- Empty legacy tables, email queues, drafts and photos are valid.
USE coolcare_service_app;
SET time_zone='+00:00';

SELECT booking_status, COUNT(*) AS booking_count FROM booking GROUP BY booking_status;
SELECT 'service_address' AS entity, COUNT(*) AS row_count FROM service_address
UNION ALL SELECT 'aircon_unit', COUNT(*) FROM aircon_unit
UNION ALL SELECT 'annual_booking_series', COUNT(*) FROM annual_booking_series
UNION ALL SELECT 'work_order', COUNT(*) FROM work_order
UNION ALL SELECT 'service_report', COUNT(*) FROM service_report
UNION ALL SELECT 'inventory_transaction', COUNT(*) FROM inventory_transaction;

-- Each mismatch query should return zero rows.
SELECT b.booking_id AS incorrect_address_owner
FROM booking b JOIN service_address a ON a.address_id=b.address_id
WHERE b.customer_id<>a.customer_id;
SELECT b.booking_id AS incorrect_unit_owner_or_address, u.unit_id
FROM booking b JOIN booking_aircon_unit bu ON bu.booking_id=b.booking_id
JOIN aircon_unit u ON u.unit_id=bu.unit_id
WHERE b.customer_id<>u.customer_id OR b.address_id<>u.address_id;
SELECT w.job_id AS incorrect_work_order_link
FROM work_order w JOIN assignment a ON a.assignment_id=w.assignment_id
WHERE w.booking_id<>a.booking_id;
SELECT s.series_id AS incorrect_annual_visits_or_total
FROM annual_booking_series s LEFT JOIN annual_booking_visit v ON v.series_id=s.series_id
LEFT JOIN booking b ON b.booking_id=v.booking_id
GROUP BY s.series_id,s.total_amount
HAVING COUNT(v.booking_id)<>4 OR SUM(b.total_amount)<>s.total_amount;
SELECT b.booking_id AS incorrect_annual_owner_or_address
FROM booking b JOIN annual_booking_visit v ON v.booking_id=b.booking_id
JOIN annual_booking_series s ON s.series_id=v.series_id
WHERE b.customer_id<>s.customer_id OR b.address_id<>s.address_id;
SELECT report_id AS incorrect_report_timing FROM service_report
WHERE completed_at<started_at OR CONVERT_TZ(submitted_time,'+00:00','+08:00')<completed_at;

-- Future weekdays and rolling address quota. An older dataset can contain past appointments.
SELECT booking_id AS weekend_booking FROM booking
WHERE booking_status<>'Cancelled' AND WEEKDAY(preferred_service_date)>4;
SELECT b.booking_id AS address_week_exceeds_two
FROM booking b JOIN booking nearby ON nearby.customer_id=b.customer_id AND nearby.address_id=b.address_id
 AND nearby.preferred_service_date BETWEEN b.preferred_service_date AND DATE_ADD(b.preferred_service_date, INTERVAL 6 DAY)
WHERE b.booking_status<>'Cancelled' AND nearby.booking_status<>'Cancelled'
GROUP BY b.booking_id HAVING COUNT(*)>2;

-- Current quantities already include admin revisions: do not add revision deltas twice.
-- Adjustment direction comes from the original web operation.
SELECT p.part_name,p.current_stock,COALESCE(SUM(CASE
 WHEN t.transaction_type IN ('Stock In','Return') THEN t.quantity
 WHEN t.transaction_type='Stock Out' THEN -t.quantity
 WHEN t.transaction_type='Adjustment' THEN o.stock_delta ELSE 0 END),0) AS ledger_stock
FROM part p LEFT JOIN inventory_transaction t ON t.part_id=p.part_id
LEFT JOIN inventory_web_operation o ON o.transaction_id=t.transaction_id
GROUP BY p.part_id,p.part_name,p.current_stock
HAVING p.current_stock<>ledger_stock OR p.current_stock<0;
SELECT t.transaction_id AS adjustment_missing_direction
FROM inventory_transaction t LEFT JOIN inventory_web_operation o ON o.transaction_id=t.transaction_id
WHERE t.transaction_type='Adjustment' AND o.transaction_id IS NULL;

SELECT p.part_name,p.current_stock,p.stock_unit,p.recommended_units_per_ac FROM part p ORDER BY p.part_name;
