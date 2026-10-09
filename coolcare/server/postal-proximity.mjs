export function postalProximity(destination, origin) {
  const valid = (value) => /^\d{6}$/.test(String(value ?? '').trim());
  if (!valid(destination) || !valid(origin))
    return { rank: 3, label: 'Location unavailable', basis: 'unknown' };
  const target = String(destination).trim(),
    source = String(origin).trim();
  if (target === source)
    return { rank: 0, label: 'Same postal code', basis: 'postal-code' };
  if (target.slice(0, 2) === source.slice(0, 2))
    return { rank: 1, label: 'Same postal sector', basis: 'postal-sector' };
  return { rank: 2, label: 'Different postal sector', basis: 'postal-sector' };
}

export function travelLaborCost(bufferMinutes, hourlyLaborCost) {
  if (hourlyLaborCost == null || hourlyLaborCost === '') return null;
  const minutes = Number(bufferMinutes ?? 30),
    hourly = Number(hourlyLaborCost);
  if (!Number.isFinite(hourly) || hourly < 0) return null;
  return Math.round((hourly * minutes * 100) / 60) / 100;
}

export async function addDispatchProximity(connection, booking, technicians) {
  const [[destination]] = await connection.execute(
    'SELECT postal_code FROM service_address WHERE address_id=?',
    [booking.address_id],
  );
  const date = String(booking.preferred_service_date).slice(0, 10);
  for (const technician of technicians) {
    const [[previous]] = await connection.execute(
      `SELECT sa.postal_code AS postalCode,b.booking_id AS bookingId
      FROM assignment a JOIN work_order w ON w.assignment_id=a.assignment_id
      JOIN booking b ON b.booking_id=w.booking_id JOIN service_address sa ON sa.address_id=b.address_id
      WHERE a.technician_id=? AND b.preferred_service_date=? AND b.slot_end<=? AND b.booking_id<>?
      AND a.assignment_status NOT IN ('Declined','Reassigned','Cancelled') AND w.current_status<>'Cancelled'
      ORDER BY b.slot_end DESC,b.booking_id DESC LIMIT 1`,
      [technician.technicianId, date, booking.slot_start, booking.booking_id],
    );
    const originPostalCode =
      previous?.postalCode || technician.basePostalCode || null;
    technician.proximity = {
      ...postalProximity(destination?.postal_code, originPostalCode),
      originPostalCode,
      origin: previous?.postalCode
        ? 'Previous visit that day'
        : technician.basePostalCode
          ? 'Technician base'
          : 'Not recorded',
      previousBookingId: previous?.postalCode ? previous.bookingId : null,
    };
    technician.travelPlan = {
      bufferMinutes: Number(booking.travel_buffer_minutes ?? 30),
      trafficNote: booking.traffic_note || null,
      hourlyLaborCost:
        technician.hourlyLaborCost == null
          ? null
          : Number(technician.hourlyLaborCost),
      estimatedLaborCost: travelLaborCost(
        booking.travel_buffer_minutes,
        technician.hourlyLaborCost,
      ),
    };
  }
  return technicians;
}

export function compareDispatchCandidates(a, b) {
  const aCost = a.travelPlan?.estimatedLaborCost,
    bCost = b.travelPlan?.estimatedLaborCost;
  return (
    (a.proximity?.rank ?? 3) - (b.proximity?.rank ?? 3) ||
    Number(aCost == null) - Number(bCost == null) ||
    (aCost ?? 0) - (bCost ?? 0) ||
    Number(a.dailyJobs || 0) - Number(b.dailyJobs || 0) ||
    String(a.lastAssignedAt || '').localeCompare(
      String(b.lastAssignedAt || ''),
    ) ||
    Number(a.technicianId) - Number(b.technicianId)
  );
}
