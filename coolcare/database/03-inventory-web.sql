USE coolcare_service_app;
CREATE TABLE IF NOT EXISTS inventory_web_operation (
 request_id CHAR(36) PRIMARY KEY,
 payload_hash CHAR(64) NOT NULL,
 transaction_id INT UNSIGNED NOT NULL UNIQUE,
 stock_before INT NOT NULL,
 stock_delta INT NOT NULL,
 stock_after INT NOT NULL,
 CONSTRAINT fk_web_operation_transaction FOREIGN KEY (transaction_id) REFERENCES inventory_transaction(transaction_id),
 CONSTRAINT chk_web_operation_stock CHECK (stock_before >= 0 AND stock_after >= 0 AND stock_delta <> 0 AND stock_after = stock_before + stock_delta)
) ENGINE=InnoDB;
