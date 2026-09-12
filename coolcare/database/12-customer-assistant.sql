USE coolcare_service_app;

-- Durable, account-owned assistant drafts. Previous drafts remain available for
-- receipt recovery; only one current draft is allowed for each customer.
CREATE TABLE IF NOT EXISTS assistant_booking_draft (
  draft_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  customer_id INT UNSIGNED NOT NULL,
  current_customer_id INT UNSIGNED NULL,
  revision INT UNSIGNED NOT NULL DEFAULT 1,
  draft_status ENUM('editing','reviewed','completed') NOT NULL DEFAULT 'editing',
  request_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  draft_data JSON NOT NULL,
  reviewed_quote JSON NULL,
  quote_fingerprint CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  booking_receipt JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_assistant_current_customer (current_customer_id),
  UNIQUE KEY uq_assistant_request (request_id),
  KEY ix_assistant_customer (customer_id,created_at),
  CONSTRAINT fk_assistant_customer FOREIGN KEY (customer_id) REFERENCES customer(customer_id) ON DELETE CASCADE,
  CONSTRAINT chk_assistant_current_owner CHECK (current_customer_id IS NULL OR current_customer_id=customer_id)
);
