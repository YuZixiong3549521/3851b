export const sampleDataTables = [
  'booking_admin_operation', 'technician_work_operation', 'service_report_revision', 'report_signature',
  'service_photo_upload', 'return_visit_operation', 'service_visit_record',
  'service_progress_event', 'service_progress', 'customer_booking_notice',
  'assistant_booking_draft', 'work_order_cleaning_assessment_revision', 'work_order_cleaning_assessment',
  'inventory_transaction_revision', 'inventory_web_operation', 'inventory_transaction',
  'photo', 'technician_performance_score', 'service_report', 'work_order', 'assignment',
  'booking_email_outbox', 'web_booking_details', 'booking_service', 'booking_package', 'annual_booking_visit',
  'booking_aircon_unit', 'booking_promotion', 'booking_change_request', 'booking_status_history', 'loyalty_transaction',
  'booking', 'annual_booking_series', 'customer_subscription', 'loyalty_account', 'package_promotion', 'promotion',
  'aircon_unit', 'service_address', 'chatbot_message', 'chatbot_conversation', 'web_legacy_import',
];

export function sampleDataDeletionOrder(edges) {
  const pending = new Set(sampleDataTables);
  for (const edge of edges) {
    if (pending.has(edge.parent) && !pending.has(edge.child)) {
      throw new Error(`A retained table references replaced business data: ${edge.child}. Review before replacing.`);
    }
  }
  const order = [];
  while (pending.size) {
    const next = [...pending].find(table =>
      !edges.some(edge => edge.parent === table && edge.child !== table && pending.has(edge.child)));
    if (!next) throw new Error('Unexpected cyclic business relationship. No data was changed.');
    order.push(next);
    pending.delete(next);
  }
  return order;
}
