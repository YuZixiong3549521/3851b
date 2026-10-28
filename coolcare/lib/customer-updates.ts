export function notifyCustomerUpdate() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event('coolcare:bookings-updated'));
  if (typeof BroadcastChannel !== 'undefined') {
    const channel = new BroadcastChannel('coolcare-customer-updates');
    channel.postMessage('refresh');
    channel.close();
  }
}
