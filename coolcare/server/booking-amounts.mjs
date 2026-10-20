const cents = value => Math.round(Number(value || 0) * 100);
const amount = value => value == null ? null : cents(value) / 100;

// One read model for booking cards, rewards and analytics. A completed amount
// is immutable, including an explicitly unknown price; never replace it with
// a subsequently changed estimate. Earlier records may lack a reliable split.
export function mapBookingAmounts(row) {
  const frozen = ['Awarded', 'Unknown price'].includes(row.completionOutcome);
  const base = frozen ? amount(row.completedBaseAmount) : amount(row.baseAmount);
  const extras = frozen ? amount(row.completedAdditionalFee) : amount(row.additionalFee ?? 0);
  const gross = frozen ? amount(row.completedGrossAmount) : base === null ? null : (cents(base) + cents(extras)) / 100;
  const discount = frozen ? amount(row.completedDiscount) ?? 0
    : ['Reserved', 'Redeemed'].includes(row.rewardStatus) ? amount(row.discount) ?? 0 : 0;
  return {
    baseAmount: base, additionalFee: extras, grossAmount: gross, discountAmount: discount,
    netServiceAmount: frozen ? amount(row.completedNetAmount) : gross === null ? null : Math.max(0, cents(gross) - cents(discount)) / 100,
    rewardStatus: row.rewardStatus ?? null,
    awardedPoints: Number(row.awardedPoints || 0),
    redeemedPoints: Number(row.redeemedPoints || 0),
    completionOutcome: row.completionOutcome ?? null,
    isFinal: frozen,
  };
}

export async function readBookingAmounts(pool, bookingIds) {
  const ids = [...new Set(bookingIds.map(Number))];
  const result = new Map();
  // IDs must come from a caller's already-authorised booking selection.
  for (let offset = 0; offset < ids.length; offset += 500) {
    const batch = ids.slice(offset, offset + 500);
    const [rows] = await pool.execute(`SELECT b.booking_id AS bookingId,b.total_amount AS baseAmount,
      COALESCE((SELECT SUM(p.additional_repair_fee) FROM work_order w
        JOIN assignment a ON a.assignment_id=w.assignment_id JOIN service_progress p ON p.job_id=w.job_id
        WHERE w.booking_id=b.booking_id AND a.assignment_status NOT IN ('Cancelled','Reassigned','Declined')),0) AS additionalFee,
      r.status AS rewardStatus,r.discount_amount AS discount,
      d.outcome AS completionOutcome,d.base_amount AS completedBaseAmount,d.additional_fee AS completedAdditionalFee,
      d.gross_amount AS completedGrossAmount,d.discount_amount AS completedDiscount,d.net_amount AS completedNetAmount,
      d.awarded_points AS awardedPoints,d.redeemed_points AS redeemedPoints
      FROM booking b LEFT JOIN reward_reservation r ON r.booking_id=b.booking_id
      LEFT JOIN booking_completion_reward d ON d.booking_id=b.booking_id
      WHERE b.booking_id IN (${batch.map(() => '?').join(',')})`, batch);
    for (const row of rows) result.set(row.bookingId, mapBookingAmounts(row));
  }
  return result;
}
