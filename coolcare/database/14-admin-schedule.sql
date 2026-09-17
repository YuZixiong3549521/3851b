USE coolcare_service_app;

-- Record idempotent administrator schedule changes alongside review and
-- dispatch operations. Reapplying the enum definition is safe.
ALTER TABLE booking_admin_operation
  MODIFY operation_type ENUM('Approve','Reject','Dispatch','Redispatch','Reschedule') NOT NULL;
