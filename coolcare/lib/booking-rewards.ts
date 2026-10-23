export type BookingRewardRules = { redemptionPoints: number; redemptionValue: number };

/** Whole redemption blocks, capped by both the live wallet and this visit's price. */
export function bookingRewardPreview(amount: number, available: number, points: number, rules: BookingRewardRules) {
  const cents = Math.round(amount * 100);
  const blockCents = Math.round(rules.redemptionValue * 100);
  const validRules = Number.isSafeInteger(rules.redemptionPoints) && rules.redemptionPoints > 0 && Number.isSafeInteger(blockCents) && blockCents > 0;
  const maxPoints = validRules && Number.isSafeInteger(cents) && cents >= 0 && Number.isFinite(available)
    ? Math.min(Math.floor(Math.max(0, available) / rules.redemptionPoints), Math.floor(cents / blockCents), Math.floor(10_000_000 / rules.redemptionPoints)) * rules.redemptionPoints : 0;
  const valid = Number.isSafeInteger(points) && points >= 0 && points <= maxPoints && (points === 0 || (validRules && points % rules.redemptionPoints === 0));
  const discountCents = valid && points > 0 ? points / rules.redemptionPoints * blockCents : 0;
  return { maxPoints, valid, discount: discountCents / 100, netAmount: (cents - discountCents) / 100 };
}
