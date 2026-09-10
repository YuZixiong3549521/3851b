-- CoolCare database verification queries
-- Expected result: no missing/unexpected objects, data in every entity table,
-- zero integrity mismatches, and populated dashboard views.
USE coolcare_service_app;

-- Confirm the expected object counts.
SELECT
  (SELECT COUNT(*)
   FROM information_schema.tables
   WHERE table_schema = 'coolcare_service_app' AND table_type = 'BASE TABLE') AS entity_table_count,
  (SELECT COUNT(*)
   FROM information_schema.tables
   WHERE table_schema = 'coolcare_service_app' AND table_type = 'VIEW') AS analytics_view_count;

-- An empty result means that no required entity table is missing.
WITH expected_tables (table_name) AS (
  SELECT 'role' UNION ALL
  SELECT 'user_account' UNION ALL
  SELECT 'customer' UNION ALL
  SELECT 'technician' UNION ALL
  SELECT 'admin_profile' UNION ALL
  SELECT 'service_catalog' UNION ALL
  SELECT 'maintenance_package' UNION ALL
  SELECT 'package_service' UNION ALL
  SELECT 'customer_subscription' UNION ALL
  SELECT 'loyalty_account' UNION ALL
  SELECT 'service_address' UNION ALL
  SELECT 'aircon_unit' UNION ALL
  SELECT 'booking' UNION ALL
  SELECT 'booking_aircon_unit' UNION ALL
  SELECT 'booking_change_request' UNION ALL
  SELECT 'booking_status_history' UNION ALL
  SELECT 'loyalty_transaction' UNION ALL
  SELECT 'promotion' UNION ALL
  SELECT 'booking_promotion' UNION ALL
  SELECT 'package_promotion' UNION ALL
  SELECT 'assignment' UNION ALL
  SELECT 'work_order' UNION ALL
  SELECT 'service_report' UNION ALL
  SELECT 'technician_performance_score' UNION ALL
  SELECT 'photo' UNION ALL
  SELECT 'part' UNION ALL
  SELECT 'inventory_transaction' UNION ALL
  SELECT 'chatbot_conversation' UNION ALL
  SELECT 'chatbot_message'
)
SELECT e.table_name AS missing_entity_table
FROM expected_tables e
LEFT JOIN information_schema.tables t
  ON t.table_schema = 'coolcare_service_app'
 AND t.table_type = 'BASE TABLE'
 AND t.table_name = e.table_name
WHERE t.table_name IS NULL
ORDER BY e.table_name;

-- An empty result means that the schema has no unexpected entity tables.
WITH expected_tables (table_name) AS (
  SELECT 'role' UNION ALL
  SELECT 'user_account' UNION ALL
  SELECT 'customer' UNION ALL
  SELECT 'technician' UNION ALL
  SELECT 'admin_profile' UNION ALL
  SELECT 'service_catalog' UNION ALL
  SELECT 'maintenance_package' UNION ALL
  SELECT 'package_service' UNION ALL
  SELECT 'customer_subscription' UNION ALL
  SELECT 'loyalty_account' UNION ALL
  SELECT 'service_address' UNION ALL
  SELECT 'aircon_unit' UNION ALL
  SELECT 'booking' UNION ALL
  SELECT 'booking_aircon_unit' UNION ALL
  SELECT 'booking_change_request' UNION ALL
  SELECT 'booking_status_history' UNION ALL
  SELECT 'loyalty_transaction' UNION ALL
  SELECT 'promotion' UNION ALL
  SELECT 'booking_promotion' UNION ALL
  SELECT 'package_promotion' UNION ALL
  SELECT 'assignment' UNION ALL
  SELECT 'work_order' UNION ALL
  SELECT 'service_report' UNION ALL
  SELECT 'technician_performance_score' UNION ALL
  SELECT 'photo' UNION ALL
  SELECT 'part' UNION ALL
  SELECT 'inventory_transaction' UNION ALL
  SELECT 'chatbot_conversation' UNION ALL
  SELECT 'chatbot_message'
)
SELECT t.table_name AS unexpected_entity_table
FROM information_schema.tables t
LEFT JOIN expected_tables e ON e.table_name = t.table_name
WHERE t.table_schema = 'coolcare_service_app'
  AND t.table_type = 'BASE TABLE'
  AND e.table_name IS NULL
ORDER BY t.table_name;

-- An empty result means that no required analytics view is missing.
WITH expected_views (view_name) AS (
  SELECT 'vw_daily_jobs_dashboard' UNION ALL
  SELECT 'vw_monthly_revenue_summary' UNION ALL
  SELECT 'vw_technician_performance' UNION ALL
  SELECT 'vw_customer_loyalty_summary' UNION ALL
  SELECT 'vw_inventory_stock_summary'
)
SELECT e.view_name AS missing_analytics_view
FROM expected_views e
LEFT JOIN information_schema.tables t
  ON t.table_schema = 'coolcare_service_app'
 AND t.table_type = 'VIEW'
 AND t.table_name = e.view_name
WHERE t.table_name IS NULL
ORDER BY e.view_name;

-- An empty result means that the schema has no unexpected analytics views.
WITH expected_views (view_name) AS (
  SELECT 'vw_daily_jobs_dashboard' UNION ALL
  SELECT 'vw_monthly_revenue_summary' UNION ALL
  SELECT 'vw_technician_performance' UNION ALL
  SELECT 'vw_customer_loyalty_summary' UNION ALL
  SELECT 'vw_inventory_stock_summary'
)
SELECT t.table_name AS unexpected_analytics_view
FROM information_schema.tables t
LEFT JOIN expected_views e ON e.view_name = t.table_name
WHERE t.table_schema = 'coolcare_service_app'
  AND t.table_type = 'VIEW'
  AND e.view_name IS NULL
ORDER BY t.table_name;

-- Confirm that seed.sql populated every entity table.
SELECT 'role' AS entity_table, COUNT(*) AS row_count FROM role
UNION ALL SELECT 'user_account', COUNT(*) FROM user_account
UNION ALL SELECT 'customer', COUNT(*) FROM customer
UNION ALL SELECT 'technician', COUNT(*) FROM technician
UNION ALL SELECT 'admin_profile', COUNT(*) FROM admin_profile
UNION ALL SELECT 'service_catalog', COUNT(*) FROM service_catalog
UNION ALL SELECT 'maintenance_package', COUNT(*) FROM maintenance_package
UNION ALL SELECT 'package_service', COUNT(*) FROM package_service
UNION ALL SELECT 'customer_subscription', COUNT(*) FROM customer_subscription
UNION ALL SELECT 'loyalty_account', COUNT(*) FROM loyalty_account
UNION ALL SELECT 'service_address', COUNT(*) FROM service_address
UNION ALL SELECT 'aircon_unit', COUNT(*) FROM aircon_unit
UNION ALL SELECT 'booking', COUNT(*) FROM booking
UNION ALL SELECT 'booking_aircon_unit', COUNT(*) FROM booking_aircon_unit
UNION ALL SELECT 'booking_change_request', COUNT(*) FROM booking_change_request
UNION ALL SELECT 'booking_status_history', COUNT(*) FROM booking_status_history
UNION ALL SELECT 'loyalty_transaction', COUNT(*) FROM loyalty_transaction
UNION ALL SELECT 'promotion', COUNT(*) FROM promotion
UNION ALL SELECT 'booking_promotion', COUNT(*) FROM booking_promotion
UNION ALL SELECT 'package_promotion', COUNT(*) FROM package_promotion
UNION ALL SELECT 'assignment', COUNT(*) FROM assignment
UNION ALL SELECT 'work_order', COUNT(*) FROM work_order
UNION ALL SELECT 'service_report', COUNT(*) FROM service_report
UNION ALL SELECT 'technician_performance_score', COUNT(*) FROM technician_performance_score
UNION ALL SELECT 'photo', COUNT(*) FROM photo
UNION ALL SELECT 'part', COUNT(*) FROM part
UNION ALL SELECT 'inventory_transaction', COUNT(*) FROM inventory_transaction
UNION ALL SELECT 'chatbot_conversation', COUNT(*) FROM chatbot_conversation
UNION ALL SELECT 'chatbot_message', COUNT(*) FROM chatbot_message
ORDER BY entity_table;

-- Confirm that denormalised part.current_stock agrees with the seeded ledger.
-- Adjustment rows are intentionally excluded because the application must define
-- whether an adjustment is an increase, decrease or absolute stock count.
SELECT
  p.part_name,
  p.current_stock,
  COALESCE(SUM(
    CASE
      WHEN it.transaction_type IN ('Stock In', 'Return') THEN it.quantity
      WHEN it.transaction_type = 'Stock Out' THEN -it.quantity
      ELSE 0
    END
  ), 0) AS ledger_stock,
  p.current_stock = COALESCE(SUM(
    CASE
      WHEN it.transaction_type IN ('Stock In', 'Return') THEN it.quantity
      WHEN it.transaction_type = 'Stock Out' THEN -it.quantity
      ELSE 0
    END
  ), 0) AS stock_matches
FROM part p
LEFT JOIN inventory_transaction it ON it.part_id = p.part_id
GROUP BY p.part_id, p.part_name, p.current_stock
ORDER BY p.part_id;

-- All three mismatch counts must be zero.
SELECT
  (SELECT COUNT(*)
   FROM booking b
   JOIN service_address sa ON sa.address_id = b.address_id
   WHERE b.customer_id <> sa.customer_id) AS customer_address_mismatches,
  (SELECT COUNT(*)
   FROM booking_aircon_unit bau
   JOIN booking b ON b.booking_id = bau.booking_id
   JOIN aircon_unit au ON au.unit_id = bau.unit_id
   WHERE b.customer_id <> au.customer_id) AS customer_unit_mismatches,
  (SELECT COUNT(*)
   FROM booking b
   JOIN customer_subscription cs ON cs.subscription_id = b.subscription_id
   WHERE b.customer_id <> cs.customer_id) AS customer_subscription_mismatches;

-- Dashboard and analytics examples.
SELECT * FROM vw_daily_jobs_dashboard ORDER BY service_date;
SELECT * FROM vw_monthly_revenue_summary ORDER BY revenue_month;
SELECT * FROM vw_technician_performance ORDER BY technician_id;
SELECT * FROM vw_customer_loyalty_summary ORDER BY customer_id;
SELECT * FROM vw_inventory_stock_summary ORDER BY part_id;
