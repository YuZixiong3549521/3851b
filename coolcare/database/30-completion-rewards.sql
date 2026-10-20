USE coolcare_service_app;

-- A booking earns once when service completes. Prior payment records are kept
-- only as historical data; no receipt or payment is needed for new rewards.
CREATE TABLE IF NOT EXISTS booking_completion_reward (
 booking_id INT UNSIGNED PRIMARY KEY,
 loyalty_account_id INT UNSIGNED NULL,
 outcome ENUM('Pending','Awarded','Unknown price','Historical','Legacy reward') NOT NULL,
 gross_amount DECIMAL(10,2) NULL,
 discount_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
 net_amount DECIMAL(10,2) NULL,
 requested_points INT UNSIGNED NOT NULL DEFAULT 0,
 redeemed_points INT UNSIGNED NOT NULL DEFAULT 0,
 awarded_points INT UNSIGNED NOT NULL DEFAULT 0,
 points_per_dollar INT UNSIGNED NULL,
 rule_version INT UNSIGNED NULL,
 note VARCHAR(1000) NOT NULL DEFAULT '',
 completed_at TIMESTAMP NULL,
 processed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(booking_id) REFERENCES booking(booking_id),
 FOREIGN KEY(loyalty_account_id) REFERENCES loyalty_account(loyalty_account_id)
) ENGINE=InnoDB;

SET @ddl = IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='reward_reservation' AND COLUMN_NAME='redemption_points'),
 'DO 0','ALTER TABLE reward_reservation ADD COLUMN redemption_points INT UNSIGNED NULL, ADD COLUMN redemption_value DECIMAL(10,2) NULL');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Preserve the actual redemption block behind each earlier reservation. Where
-- no historical rule snapshot exists, treat that reservation as one whole block.
UPDATE reward_reservation r
 LEFT JOIN reward_rule current_rule ON current_rule.rule_id=1 AND current_rule.version=r.rule_version
 LEFT JOIN reward_rule_audit a ON a.version=r.rule_version
 SET r.redemption_points=COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(a.rule_json,'$.after.redemptionPoints')) AS UNSIGNED),current_rule.redemption_points,IF(r.rule_version=1,100,r.points)),
 r.redemption_value=COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(a.rule_json,'$.after.redemptionValue')) AS DECIMAL(10,2)),current_rule.redemption_value,IF(r.rule_version=1,5,r.discount_amount))
 WHERE r.redemption_points IS NULL;

START TRANSACTION;
SET @completion_reward_cutover = NOT EXISTS(SELECT 1 FROM booking_policy_migration WHERE migration_key='2026-10-completion-rewards');

INSERT IGNORE INTO booking_completion_reward
 (booking_id,loyalty_account_id,outcome,awarded_points,points_per_dollar,rule_version,note)
 SELECT booking_id,loyalty_account_id,'Legacy reward',GREATEST(0,awarded_points),points_per_dollar,rule_version,
 'Existing reward history retained; this booking will not earn again.'
 FROM reward_booking_earning WHERE @completion_reward_cutover;
INSERT IGNORE INTO booking_completion_reward(booking_id,outcome,note)
 SELECT b.booking_id,'Legacy reward','Existing booking-linked earned points retained; this booking will not earn again.'
 FROM booking b WHERE @completion_reward_cutover AND EXISTS(
 SELECT 1 FROM loyalty_transaction t WHERE t.booking_id=b.booking_id AND t.transaction_type='Earned');
INSERT IGNORE INTO booking_completion_reward(booking_id,outcome,note)
 SELECT booking_id,'Historical','Completed before completion-based rewards were enabled; no retrospective points were added.'
 FROM booking WHERE @completion_reward_cutover AND booking_status='Completed';
UPDATE reward_reservation r JOIN booking b ON b.booking_id=r.booking_id
 SET r.status='Released',r.reason='Unused reward reservation released when the previous payment workflow was retired.'
 WHERE @completion_reward_cutover AND r.status='Reserved' AND
 (b.booking_status IN ('Completed','Cancelled','Rejected','Expired') OR EXISTS(
 SELECT 1 FROM booking_completion_reward done WHERE done.booking_id=b.booking_id));
INSERT IGNORE INTO booking_policy_migration(migration_key) VALUES ('2026-10-completion-rewards');
COMMIT;
