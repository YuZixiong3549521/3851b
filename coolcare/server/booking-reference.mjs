// Display identity comes from the booking's creation date, never a visit or ledger date.
export function bookingReference(bookingId, createdAt) {
  const date = createdAt instanceof Date
    ? (Number.isFinite(createdAt.getTime()) ? createdAt.toISOString() : '')
    : String(createdAt ?? '');
  const year = /^([1-9]\d{3})-\d{2}-\d{2}(?:[ T]|$)/.exec(date)?.[1];
  if (!year || !Number.isSafeInteger(Number(bookingId)) || Number(bookingId) < 1)
    return 'Reference unavailable';
  return `BK-${year}-${String(Number(bookingId)).padStart(4, '0')}`;
}

export const withBookingReference = (row) => ({
  ...row,
  bookingReference: bookingReference(row.bookingId,
    Object.hasOwn(row, 'bookingCreatedAt') ? row.bookingCreatedAt : row.createdAt),
});

// The full reference carries a year constraint; legacy forms identify by ID alone.
export function parseBookingSearch(value) {
  const text = String(value ?? '').trim();
  const full = /^BK-([1-9]\d{3})-(\d+)$/i.exec(text);
  const short = /^(?:BK-|#)?(\d+)$/i.exec(text);
  if (!full && !short) return null;
  const id = Number(full ? full[2] : short[1]);
  if (!Number.isSafeInteger(id) || id < 1) return null;
  return { id, year: full ? Number(full[1]) : null };
}
