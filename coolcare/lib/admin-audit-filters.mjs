// Shared labels keep the log filter and server classification in agreement.
export const auditCategories = [
  { value: 'dispatch', label: 'Confirmation & dispatch', actions: ['Approve', 'Dispatch', 'Redispatch', 'Queue for dispatch'] },
  { value: 'schedule', label: 'Schedule & travel', actions: ['Reschedule', 'Edit travel plan'] },
  { value: 'rejection', label: 'Rejection', actions: ['Reject', 'Edit rejection'] },
  { value: 'email', label: 'Customer email', actions: ['Retry customer email'] },
];
export const auditActions = auditCategories.flatMap(category => category.actions);
export const auditFilterKeys = ['bookingId', 'category', 'action', 'actorId', 'from', 'to', 'q', 'sort', 'pageSize'];
export const auditCategoryFor = action => auditCategories.find(category => category.actions.includes(action))?.label ?? 'Other';
