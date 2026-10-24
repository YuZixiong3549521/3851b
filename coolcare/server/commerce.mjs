import { withBookingReference } from './booking-reference.mjs';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { AppError, idSchema } from './inventory.mjs';
import { isCalendarDate } from './customer/booking-schedule.mjs';
import { readBookingAmounts } from './booking-amounts.mjs';
import { groupServicePeriods } from './report-periods.mjs';
import { listAdminAnnualPlans } from './customer/plans.mjs';

const terminal = new Set(['Cancelled', 'Rejected', 'Expired']);
const money = z.coerce.number().finite().positive().max(9999999.99).refine(v => Math.abs(v * 100 - Math.round(v * 100)) < 0.000001, 'Use at most two decimal places.');
const date = z.string().refine(isCalendarDate, 'Enter a valid calendar date.');
const request = { requestId: z.uuid() };
const redemptionSchema = z.object({ ...request, points: z.number().int().min(0).max(10000000) }).strict();
export const bookingRewardPointsSchema = z.number().int().min(0).max(10000000);
export const bookingRewardRuleVersionSchema = z.number().int().positive();
const adjustSchema = z.object({ ...request, points: z.number().int().min(-1000000).max(1000000).refine(v => v !== 0), reason: z.string().trim().min(5).max(500) }).strict();
const ruleSchema = z.object({ ...request, expectedVersion: z.number().int().positive(), pointsPerDollar: z.number().int().min(0).max(100), redemptionPoints: z.number().int().min(1).max(1000000), redemptionValue: money, reason: z.string().trim().min(5).max(500) }).strict();
const dollars = v => Math.round(Number(v || 0) * 100);
const number = v => Number(v || 0);
const hash = input => createHash('sha256').update(JSON.stringify(input)).digest('hex');
const json = value => typeof value === 'string' ? JSON.parse(value) : value;
const instant = value => value == null ? null : new Date(Number(value) * 1000).toISOString();
export function earnedPoints(cents, rate) { return Math.floor(Math.max(0, cents) * rate / 100); }
export function safeCsv(rows) {
  return '\uFEFF' + rows.map(row => row.map(value => {
    let text = String(value ?? '');
    if (/^[\s]*[=+\-@\t\r]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  }).join(',')).join('\r\n');
}
async function transaction(pool, work) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const c = await pool.getConnection();
    try { await c.beginTransaction(); const result = await work(c); await c.commit(); return result; }
    catch (e) {
      await c.rollback().catch(() => undefined);
      // InnoDB rolls back the entire deadlocked transaction. Retain the same
      // UUID and inputs on retry; never retry an unknown network/commit outcome.
      if (e.code !== 'ER_LOCK_DEADLOCK' || attempt === 2) throw e;
    } finally { c.release(); }
    await new Promise(resolve => setTimeout(resolve, 10 * (attempt + 1)));
  }
}
async function replay(c, actorId, input) {
  const [[row]] = await c.execute('SELECT * FROM commerce_operation WHERE request_id=? FOR SHARE', [input.requestId]);
  if (!row) return null;
  if (row.actor_user_id !== actorId || row.payload_hash !== hash(input)) throw new AppError('This request ID was already used for a different operation.', 409);
  return json(row.result_json);
}
async function remember(c, actorId, input, result) {
  await c.execute('INSERT INTO commerce_operation(request_id,actor_user_id,payload_hash,result_json) VALUES (?,?,?,?)', [input.requestId, actorId, hash(input), JSON.stringify(result)]);
  return result;
}
async function lockBooking(c, bookingId, customerId) {
  const [[b]] = await c.execute('SELECT * FROM booking WHERE booking_id=? FOR UPDATE', [bookingId]);
  if (!b || (customerId !== undefined && b.customer_id !== customerId)) throw new AppError('Booking not found.', 404);
  return b;
}
async function lockAccount(c, customerId) {
  // Acquire the wallet's exclusive unique-key lock directly. INSERT IGNORE
  // takes a shared duplicate-key lock that concurrent completions can deadlock
  // while upgrading in the following SELECT FOR UPDATE.
  await c.execute('INSERT INTO loyalty_account(customer_id) VALUES (?) ON DUPLICATE KEY UPDATE customer_id=loyalty_account.customer_id', [customerId]);
  const [[account]] = await c.execute('SELECT * FROM loyalty_account WHERE customer_id=? FOR UPDATE', [customerId]);
  return account;
}
async function rule(c, lock = false) {
  const [[r]] = await c.query('SELECT version,points_per_dollar AS pointsPerDollar,redemption_points AS redemptionPoints,redemption_value AS redemptionValue FROM reward_rule WHERE rule_id=1' + (lock === 'share' ? ' FOR SHARE' : lock ? ' FOR UPDATE' : ''));
  return { ...r, redemptionValue: number(r.redemptionValue) };
}
async function bookingValue(c, b) {
  // Extras belong to the booking. Return visits do not create another reward.
  const [extras] = await c.execute(`SELECT p.additional_repair_fee AS fee FROM work_order w
    JOIN assignment a ON a.assignment_id=w.assignment_id JOIN service_progress p ON p.job_id=w.job_id
    WHERE w.booking_id=? AND a.assignment_status NOT IN ('Cancelled','Reassigned','Declined') FOR SHARE`, [b.booking_id]);
  const [[reservation]] = await c.execute('SELECT * FROM reward_reservation WHERE booking_id=? FOR SHARE', [b.booking_id]);
  const additionalFee = extras.reduce((sum, r) => sum + dollars(r.fee), 0);
  const quote = b.total_amount === null ? null : dollars(b.total_amount) + additionalFee;
  const discount = reservation && reservation.status !== 'Released' ? dollars(reservation.discount_amount) : 0;
  return { quote: quote === null ? null : Math.max(0, quote), additionalFee, discount, reservation };
}
async function appendPoints(c, account, bookingId, points, type, description) {
  const [result] = await c.execute(`INSERT INTO loyalty_transaction(loyalty_account_id,booking_id,transaction_type,points,description) VALUES (?,?,?,?,?)`, [account.loyalty_account_id, bookingId, type, points, description.slice(0, 255)]);
  await c.execute('UPDATE loyalty_account SET current_points=current_points+? WHERE loyalty_account_id=?', [points, account.loyalty_account_id]);
  account.current_points += points;
  return result.insertId;
}
export function completionRedemption({ quoteCents, balance, otherReserved, points, blockPoints, blockValueCents }) {
  const spendable = Math.max(0, balance - otherReserved);
  if (quoteCents === null || blockPoints <= 0 || blockValueCents <= 0) return { points: 0, discountCents: 0 };
  const blocks = Math.max(0, Math.min(Math.floor(points / blockPoints), Math.floor(spendable / blockPoints), Math.floor(quoteCents / blockValueCents)));
  return { points: blocks * blockPoints, discountCents: blocks * blockValueCents };
}
// The caller owns the transaction and has transitioned booking to Completed.
// An error rolls back both service completion and its reward; no external side
// effect or payment is involved. Repeated returns/report submissions are no-ops.
export async function awardCompletedBookingRewards(c, rawBookingId) {
  const bookingId = idSchema.parse(rawBookingId), b = await lockBooking(c, bookingId);
  if (b.booking_status !== 'Completed') throw new AppError('Rewards are granted only when the booking is completed.', 409);
  const account = await lockAccount(c, b.customer_id);
  // Insert before reading to avoid missing-row gap-lock upgrades on simultaneous
  // completions of different wallets. The placeholder cannot survive rollback.
  const [claim] = await c.execute("INSERT IGNORE INTO booking_completion_reward(booking_id,loyalty_account_id,outcome) VALUES (?,?,'Pending')", [bookingId, account.loyalty_account_id]);
  if (!claim.affectedRows) {
    const [[done]] = await c.execute('SELECT * FROM booking_completion_reward WHERE booking_id=? FOR SHARE', [bookingId]);
    return { bookingId, awardedPoints: done.awarded_points, redeemedPoints: done.redeemed_points, outcome: done.outcome, replayed: true };
  }
  const state = await bookingValue(c, b), config = await rule(c, 'share');
  const reservation = state.reservation;
  const requestedPoints = reservation?.status === 'Reserved' ? reservation.points : 0;
  let redeemedPoints = 0, discount = reservation?.status === 'Redeemed' ? state.discount : 0, note = '';
  if (requestedPoints) {
    const [other] = await c.execute("SELECT points FROM reward_reservation WHERE loyalty_account_id=? AND booking_id<>? AND status='Reserved' FOR SHARE", [account.loyalty_account_id, bookingId]);
    const redemption = completionRedemption({
      quoteCents: state.quote, balance: account.current_points, otherReserved: other.reduce((sum, r) => sum + r.points, 0),
      points: requestedPoints, blockPoints: reservation.redemption_points || requestedPoints,
      blockValueCents: dollars(reservation.redemption_value || reservation.discount_amount),
    });
    redeemedPoints = redemption.points; discount = redemption.discountCents;
    if (redeemedPoints !== requestedPoints) {
      note = `Reserved reward reduced from ${requestedPoints} to ${redeemedPoints} points at completion because the available balance or service value changed.`;
      await appendPoints(c, account, bookingId, 0, 'Adjusted', note);
    }
    if (redeemedPoints) await appendPoints(c, account, bookingId, -redeemedPoints, 'Redeemed', 'Reserved reward applied when the service was completed.');
    await c.execute('UPDATE reward_reservation SET points=?,discount_amount=?,status=?,reason=? WHERE booking_id=?', [redeemedPoints, discount / 100, redeemedPoints ? 'Redeemed' : 'Released', note || 'Reward applied when the service was completed.', bookingId]);
  }
  const net = state.quote === null ? null : Math.max(0, state.quote - discount);
  const earned = net === null ? 0 : earnedPoints(net, config.pointsPerDollar);
  if (earned) await appendPoints(c, account, bookingId, earned, 'Earned', 'Earned once for the completed booking, based on its service amount after rewards.');
  const outcome = net === null ? 'Unknown price' : 'Awarded';
  if (net === null) note ||= 'No recorded service price; no points were awarded. Service completion was preserved.';
  await c.execute(`UPDATE booking_completion_reward SET outcome=?,base_amount=?,additional_fee=?,gross_amount=?,discount_amount=?,net_amount=?,requested_points=?,redeemed_points=?,awarded_points=?,points_per_dollar=?,rule_version=?,note=?,completed_at=CURRENT_TIMESTAMP() WHERE booking_id=?`,
    [outcome, b.total_amount, state.additionalFee / 100, state.quote === null ? null : state.quote / 100, discount / 100, net === null ? null : net / 100, requestedPoints, redeemedPoints, earned, config.pointsPerDollar, config.version, note, bookingId]);
  // Only visit 1 of an eligible, snapshotted renewal receives this separate
  // promotional award. Wallet + booking locks and the completion marker make
  // retries, later reports and return completions unable to award it twice.
  const [[bonus]] = await c.execute(`SELECT bonus.* FROM annual_renewal_bonus bonus
    JOIN annual_booking_visit v ON v.series_id=bonus.renewed_series_id
    WHERE v.booking_id=? AND v.visit_number=1 FOR UPDATE`, [bookingId]);
  let bonusPoints = 0;
  if (bonus && !bonus.loyalty_transaction_id) {
    bonusPoints = Number(bonus.points);
    const transactionId = await appendPoints(c, account, bookingId, bonusPoints, 'Earned',
      `Early annual renewal bonus for plan #${bonus.renewed_series_id}; first renewed service completed.`);
    await c.execute('UPDATE annual_renewal_bonus SET loyalty_transaction_id=?,awarded_at=CURRENT_TIMESTAMP() WHERE renewed_series_id=?',
      [transactionId, bonus.renewed_series_id]);
  }
  return { bookingId, awardedPoints: earned, bonusPoints, redeemedPoints, outcome, replayed: false };
}
export async function reserveReward(pool, actorId, customerId, rawBookingId, raw) {
  const bookingId = idSchema.parse(rawBookingId), data = redemptionSchema.parse(raw);
  const input = { action: 'reserve', bookingId, ...data };
  return transaction(pool, async c => {
    const b = await lockBooking(c, bookingId, customerId);
    const account = await lockAccount(c, customerId);
    const previous = await replay(c, actorId, input); if (previous) return previous;
    const state = await bookingValue(c, b);
    if (state.reservation?.status === 'Redeemed') throw new AppError('This reward has already been applied to the completed service.', 409);
    if (!data.points) {
      await releaseBookingRewardReservation(c, bookingId, 'Released by customer.');
      return remember(c, actorId, input, { bookingId, points: 0, discount: 0 });
    }
    if (terminal.has(b.booking_status) || b.booking_status === 'Completed') throw new AppError('Reserve rewards before the booking is completed or closed.', 409);
    const [[processed]] = await c.execute('SELECT booking_id FROM booking_completion_reward WHERE booking_id=? FOR SHARE', [bookingId]);
    if (processed) throw new AppError('This booking has already been processed for rewards. A return visit does not earn or redeem again.', 409);
    if (state.quote === null) throw new AppError('This booking does not have a recorded price.', 409);
    const selected = await validateRewardSelection(c, account, state.quote, data.points, bookingId);
    await saveRewardReservation(c, bookingId, account, selected, 'Reserved by customer.');
    return remember(c, actorId, input, { bookingId, points: data.points, discount: selected.discount });
  });
}

async function validateRewardSelection(c, account, quoteCents, points, bookingId = 0, expectedRuleVersion) {
  const config = await rule(c, 'share');
  const invalid = (message, status = 400) => Object.assign(new AppError(message, status), { code: 'REWARD_SELECTION_INVALID', details: { fieldErrors: { rewardPoints: [message] } } });
  if (expectedRuleVersion !== undefined && expectedRuleVersion !== config.version) throw invalid('Reward rules changed. Refresh the points estimate before submitting your booking.', 409);
  if (points % config.redemptionPoints) throw invalid(`Redeem in multiples of ${config.redemptionPoints} points.`);
  const discountCents = points / config.redemptionPoints * dollars(config.redemptionValue);
  if (quoteCents === null) throw invalid('This booking does not have a recorded price.', 409);
  if (discountCents > quoteCents) throw invalid('The reward cannot exceed the service total.');
  const [reserved] = await c.execute(`SELECT points FROM reward_reservation WHERE loyalty_account_id=? AND status='Reserved' AND booking_id<>? FOR SHARE`, [account.loyalty_account_id, bookingId]);
  if (points > Math.max(0, account.current_points - reserved.reduce((sum, r) => sum + r.points, 0))) throw invalid('Not enough available points. Other bookings may already reserve some points.', 409);
  return { points, discount: discountCents / 100, ruleVersion: config.version, redemptionPoints: config.redemptionPoints, redemptionValue: config.redemptionValue };
}

async function saveRewardReservation(c, bookingId, account, selected, reason) {
  await c.execute(`INSERT INTO reward_reservation(booking_id,loyalty_account_id,points,discount_amount,rule_version,status,reason,redemption_points,redemption_value)
    VALUES (?,?,?,?,?,'Reserved',?,?,?) ON DUPLICATE KEY UPDATE points=VALUES(points),discount_amount=VALUES(discount_amount),rule_version=VALUES(rule_version),status='Reserved',reason=VALUES(reason),redemption_points=VALUES(redemption_points),redemption_value=VALUES(redemption_value)`,
  [bookingId, account.loyalty_account_id, selected.points, selected.discount, selected.ruleVersion, reason, selected.redemptionPoints, selected.redemptionValue]);
}

// These helpers use the caller's transaction, never a second connection. The
// wallet lock serializes creation with other reservations and completion rewards.
export async function quoteBookingReward(c, customerId, amount, points = 0, expectedRuleVersion) {
  bookingRewardPointsSchema.parse(points);
  if (!points) return null;
  const account = await lockAccount(c, customerId);
  return validateRewardSelection(c, account, amount === null ? null : dollars(amount), points, 0, expectedRuleVersion);
}

export async function reserveCreatedBookingReward(c, customerId, bookingId, points = 0, expectedRuleVersion) {
  bookingRewardPointsSchema.parse(points);
  if (!points) return null;
  const b = await lockBooking(c, bookingId, customerId);
  if (b.booking_status !== 'Submitted') throw new AppError('Rewards for a new booking must be selected when it is submitted.', 409);
  const account = await lockAccount(c, customerId);
  const selected = await validateRewardSelection(c, account, b.total_amount === null ? null : dollars(b.total_amount), points, bookingId, expectedRuleVersion);
  await saveRewardReservation(c, bookingId, account, selected, 'Selected when the booking was created.');
  return { bookingId, points, discount: selected.discount, status: 'Reserved' };
}
// Call in the existing cancellation/rejection/expiry transaction AFTER locking
// booking. Wallet is always acquired after booking to match payment/redemption.
export async function releaseBookingRewardReservation(c, bookingId, reason = 'Booking closed.') {
  const [[b]] = await c.execute('SELECT customer_id FROM booking WHERE booking_id=? FOR SHARE', [bookingId]);
  if (!b) return;
  // Do not lock reservation rows before the wallet: another booking's reserve
  // operation locks the wallet and then all active reservation rows.
  const [[account]] = await c.execute('SELECT loyalty_account_id FROM loyalty_account WHERE customer_id=? FOR UPDATE', [b.customer_id]);
  if (!account) return;
  await c.execute("UPDATE reward_reservation SET status='Released',reason=? WHERE booking_id=? AND status='Reserved'", [reason.slice(0, 255), bookingId]);
}
export async function adjustReward(pool, actorId, customerId, raw) {
  customerId = idSchema.parse(customerId);
  const data = adjustSchema.parse(raw), input = { action: 'adjust', customerId, ...data };
  return transaction(pool, async c => {
    const [[exists]] = await c.execute('SELECT customer_id FROM customer WHERE customer_id=?', [customerId]);
    if (!exists) throw new AppError('Customer not found.', 404);
    const account = await lockAccount(c, customerId);
    const previous = await replay(c, actorId, input); if (previous) return previous;
    const id = await appendPoints(c, account, null, data.points, 'Adjusted', data.reason);
    await c.execute('INSERT INTO reward_adjustment_audit(loyalty_transaction_id,actor_user_id,reason) VALUES (?,?,?)', [id, actorId, data.reason]);
    return remember(c, actorId, input, { transactionId: id, balance: account.current_points });
  });
}
export async function updateRewardRule(pool, actorId, raw) {
  const data = ruleSchema.parse(raw), input = { action: 'rule', ...data };
  return transaction(pool, async c => {
    const current = await rule(c, true), previous = await replay(c, actorId, input); if (previous) return previous;
    if (current.version !== data.expectedVersion) throw new AppError('Reward rules changed. Refresh before editing.', 409);
    const version = current.version + 1;
    await c.execute('UPDATE reward_rule SET version=?,points_per_dollar=?,redemption_points=?,redemption_value=? WHERE rule_id=1', [version, data.pointsPerDollar, data.redemptionPoints, data.redemptionValue]);
    await c.execute('INSERT INTO reward_rule_audit(version,actor_user_id,rule_json,reason) VALUES (?,?,?,?)', [version, actorId, JSON.stringify({ before: current, after: data }), data.reason]);
    return remember(c, actorId, input, { version });
  });
}

export async function listRewardBookings(pool, customerId) {
  const [rows] = await pool.execute(`SELECT b.booking_id AS bookingId,b.created_at AS bookingCreatedAt,b.customer_id AS customerId,b.booking_status AS status,b.preferred_service_date AS serviceDate,
    b.total_amount AS baseAmount,u.full_name AS customerName,u.email,
    COALESCE((SELECT bp.package_name FROM booking_package bp WHERE bp.booking_id=b.booking_id),
      (SELECT GROUP_CONCAT(bs.service_name ORDER BY bs.service_id SEPARATOR ', ') FROM booking_service bs WHERE bs.booking_id=b.booking_id),s.service_name) AS serviceName,
    COALESCE((SELECT SUM(p.additional_repair_fee) FROM work_order w JOIN assignment a ON a.assignment_id=w.assignment_id JOIN service_progress p ON p.job_id=w.job_id WHERE w.booking_id=b.booking_id AND a.assignment_status NOT IN ('Cancelled','Reassigned','Declined')),0) AS additionalFee,
    COALESCE(IF(r.status IN ('Reserved','Redeemed'),r.discount_amount,0),0) AS discount,r.status AS rewardStatus,COALESCE(r.points,0) AS rewardPoints,
    done.outcome AS completionOutcome,done.gross_amount AS completedGrossAmount,done.discount_amount AS completedDiscount,
    done.net_amount AS completedNetAmount,done.awarded_points AS awardedPoints,done.redeemed_points AS redeemedPoints,UNIX_TIMESTAMP(done.completed_at) AS completedAt,done.note AS completionNote
    FROM booking b JOIN customer c ON c.customer_id=b.customer_id JOIN user_account u ON u.user_id=c.user_id
    JOIN service_catalog s ON s.service_id=b.service_id LEFT JOIN reward_reservation r ON r.booking_id=b.booking_id
    LEFT JOIN booking_completion_reward done ON done.booking_id=b.booking_id
    ${customerId === undefined ? '' : 'WHERE b.customer_id=?'} ORDER BY b.booking_id DESC LIMIT 1000`, customerId === undefined ? [] : [customerId]);
  const amounts = await readBookingAmounts(pool, rows.map(row => row.bookingId));
  return rows.map(row => {
    const value = amounts.get(row.bookingId), quote = value.grossAmount;
    const { completionOutcome, completedGrossAmount, completedDiscount, completedNetAmount, awardedPoints, redeemedPoints, completedAt, completionNote, ...booking } = row;
    return { ...withBookingReference(booking), baseAmount: value.baseAmount, additionalFee: value.additionalFee, quote, discount: value.discountAmount,
      netServiceAmount: value.netServiceAmount, amounts: value,
      canReserve: !terminal.has(row.status) && row.status !== 'Completed' && !completionOutcome && row.rewardStatus !== 'Redeemed' && quote !== null,
      completionReward: completionOutcome ? { outcome: completionOutcome, grossAmount: completedGrossAmount === null ? null : number(completedGrossAmount), discountAmount: number(completedDiscount), netServiceAmount: completedNetAmount === null ? null : number(completedNetAmount), awardedPoints, redeemedPoints, completedAt: instant(completedAt), note: completionNote } : null };
  });
}
export async function rewardsSummary(pool, customerId) {
  const config = await rule(pool);
  const [[account]] = await pool.execute(`SELECT a.loyalty_account_id AS id,a.current_points AS balance,
    (SELECT COALESCE(SUM(points),0) FROM reward_reservation WHERE loyalty_account_id=a.loyalty_account_id AND status='Reserved') AS reserved
    FROM loyalty_account a WHERE customer_id=?`, [customerId]);
  const [history] = account ? await pool.execute(`SELECT t.loyalty_transaction_id AS id,t.booking_id AS bookingId,b.created_at AS bookingCreatedAt,t.transaction_type AS type,t.points,t.description,UNIX_TIMESTAMP(t.created_at) AS createdAt,u.full_name AS adjustedBy
    FROM loyalty_transaction t LEFT JOIN booking b ON b.booking_id=t.booking_id LEFT JOIN reward_adjustment_audit a ON a.loyalty_transaction_id=t.loyalty_transaction_id LEFT JOIN user_account u ON u.user_id=a.actor_user_id
    WHERE t.loyalty_account_id=? ORDER BY t.loyalty_transaction_id DESC LIMIT 200`, [account.id]) : [[]];
  const balance = number(account?.balance), reserved = number(account?.reserved);
  const bookings = await listRewardBookings(pool, customerId);
  return { rules: config, balance, reserved, available: Math.max(0, balance - reserved), debt: Math.max(0, -balance), history: history.map(row => ({ ...withBookingReference(row), createdAt: instant(row.createdAt) })), bookings };
}

export const reportFilterSchema = z.object({ from: date, to: date, serviceId: idSchema.optional(), serviceGroup: z.enum(['annual']).optional(), technicianId: idSchema.optional(), groupBy: z.enum(['day', 'quarter', 'year']).default('day') }).strict()
  .refine(v => !(v.serviceId && v.serviceGroup), 'Choose a service or the annual bundle filter.')
  .refine(v => v.from <= v.to && (Date.parse(v.to) - Date.parse(v.from)) / 86400000 <= 1830, 'Choose a date range of at most five years.');
function bookingFilter(filters, alias = 'b') {
  const clauses = [], values = [];
  if (filters.serviceId) { clauses.push(`(${alias}.service_id=? OR EXISTS(SELECT 1 FROM booking_service bs WHERE bs.booking_id=${alias}.booking_id AND bs.service_id=?))`); values.push(filters.serviceId, filters.serviceId); }
  if (filters.serviceGroup === 'annual') clauses.push(`EXISTS(SELECT 1 FROM annual_booking_visit av WHERE av.booking_id=${alias}.booking_id)`);
  if (filters.technicianId) {
    clauses.push(`(EXISTS(SELECT 1 FROM assignment fa WHERE fa.booking_id=${alias}.booking_id AND fa.technician_id=? AND fa.assignment_status NOT IN ('Cancelled','Reassigned','Declined'))
      OR EXISTS(SELECT 1 FROM performance_visit fv JOIN work_order fw ON fw.job_id=fv.job_id WHERE fw.booking_id=${alias}.booking_id AND fv.technician_id=?))`);
    values.push(filters.technicianId, filters.technicianId);
  }
  return { sql: clauses.length ? ' AND ' + clauses.join(' AND ') : '', values };
}
export async function commerceReport(pool, raw) {
  const filters = reportFilterSchema.parse(raw), f = bookingFilter(filters);
  const [orderRows] = await pool.execute(`SELECT b.booking_id AS bookingId,b.created_at AS bookingCreatedAt,b.booking_status AS status,b.preferred_service_date AS serviceDate,
    b.total_amount AS baseAmount,done.gross_amount AS completionGrossAmount,done.net_amount AS completionNetAmount,
    COALESCE(IF(done.outcome IN ('Awarded','Unknown price'),done.discount_amount,NULL),IF(r.status='Redeemed',r.discount_amount,0),0) AS rewardDiscount,
    COALESCE((SELECT bp.package_name FROM booking_package bp WHERE bp.booking_id=b.booking_id),
      (SELECT GROUP_CONCAT(bs.service_name ORDER BY bs.service_id SEPARATOR ', ') FROM booking_service bs WHERE bs.booking_id=b.booking_id),s.service_name) AS serviceName,
    COALESCE((SELECT SUM(p.additional_repair_fee) FROM work_order w JOIN assignment a ON a.assignment_id=w.assignment_id JOIN service_progress p ON p.job_id=w.job_id WHERE w.booking_id=b.booking_id AND a.assignment_status NOT IN ('Cancelled','Reassigned','Declined')),0) AS additionalFee,
    (SELECT COUNT(*) FROM service_visit_record v JOIN work_order w ON w.job_id=v.job_id WHERE w.booking_id=b.booking_id AND v.outcome='Return required'${filters.technicianId ? ' AND v.technician_id=?' : ''}) AS returns,
    (SELECT COUNT(*) FROM service_report r JOIN work_order w ON w.job_id=COALESCE(r.job_id,r.archived_job_id)
      JOIN assignment va ON va.assignment_id=w.assignment_id LEFT JOIN performance_visit pv ON pv.report_id=r.report_id
      WHERE w.booking_id=b.booking_id AND r.started_at IS NOT NULL${filters.technicianId ? ' AND pv.technician_id=?' : ''}) AS visits
    FROM booking b JOIN service_catalog s ON s.service_id=b.service_id LEFT JOIN booking_completion_reward done ON done.booking_id=b.booking_id
    LEFT JOIN reward_reservation r ON r.booking_id=b.booking_id
    WHERE b.preferred_service_date BETWEEN ? AND ?${f.sql} ORDER BY b.preferred_service_date,b.booking_id`, [...(filters.technicianId ? [filters.technicianId, filters.technicianId] : []), filters.from, filters.to, ...f.values]);
  const orders = orderRows.map(withBookingReference);
  const [parts] = await pool.execute(`SELECT p.part_id AS partId,p.part_name AS name,p.stock_unit AS unit,
    SUM(IF(i.transaction_type='Stock Out',i.quantity,0)) AS issued,SUM(IF(i.transaction_type='Return',i.quantity,0)) AS returned
    FROM inventory_transaction i JOIN part p ON p.part_id=i.part_id JOIN work_order w ON w.job_id=i.job_id JOIN booking b ON b.booking_id=w.booking_id
    WHERE i.created_at >= FROM_UNIXTIME(?) AND i.created_at < FROM_UNIXTIME(?)
    AND i.transaction_type IN ('Stock Out','Return')${f.sql} GROUP BY p.part_id,p.part_name,p.stock_unit ORDER BY issued DESC,p.part_id`, [Date.parse(filters.from + 'T00:00:00+08:00') / 1000, Date.parse(filters.to + 'T00:00:00+08:00') / 1000 + 86400, ...f.values]);
  const [[bundles]] = await pool.execute(`SELECT COUNT(*) AS scheduledVisits,COALESCE(SUM(b.booking_status='Completed'),0) AS completedVisits,COUNT(DISTINCT v.series_id) AS plans
    FROM annual_booking_visit v JOIN booking b ON b.booking_id=v.booking_id WHERE b.preferred_service_date BETWEEN ? AND ?${f.sql}`, [filters.from, filters.to, ...f.values]);
  const [serviceRows] = await pool.query(`SELECT s.service_id AS id,s.service_name AS name,
    EXISTS(SELECT 1 FROM simple_service_catalog catalogue WHERE catalogue.service_id=s.service_id) AS isCurrent
    FROM service_catalog s ORDER BY isCurrent DESC,s.service_name`);
  const services = serviceRows.map(row => ({ ...row, isCurrent: Boolean(row.isCurrent) }));
  const [technicians] = await pool.query('SELECT t.technician_id AS id,u.full_name AS name FROM technician t JOIN user_account u ON u.user_id=t.user_id ORDER BY u.full_name');
  const total = orders.length, completed = orders.filter(o => o.status === 'Completed').length, cancelled = orders.filter(o => o.status === 'Cancelled').length;
  const returnOrders = orders.filter(o => number(o.returns) > 0).length;
  const amounts = await readBookingAmounts(pool, orders.map(o => o.bookingId));
  const mapped = orders.map(o => {
    const value = amounts.get(o.bookingId);
    const { completionGrossAmount, completionNetAmount, ...order } = o;
    return { ...order, baseAmount: value.baseAmount, additionalFee: value.additionalFee,
      serviceAmount: value.grossAmount, rewardDiscount: value.discountAmount,
      netServiceAmount: value.netServiceAmount, awardedPoints: value.awardedPoints };
  });
  const daily = new Map();
  for (const order of mapped.filter(o => o.status === 'Completed')) {
    const row = daily.get(order.serviceDate) || { date: order.serviceDate, completed: 0, serviceAmount: 0, rewardDiscounts: 0, netServiceAmount: 0 };
    row.completed++;
    row.serviceAmount += dollars(order.serviceAmount);
    row.rewardDiscounts += dollars(order.rewardDiscount);
    row.netServiceAmount += dollars(order.netServiceAmount);
    daily.set(order.serviceDate, row);
  }
  const dailyService = [...daily.values()].map(r => ({ ...r, serviceAmount: r.serviceAmount / 100, rewardDiscounts: r.rewardDiscounts / 100, netServiceAmount: r.netServiceAmount / 100 }));
  const completedRows = mapped.filter(o => o.status === 'Completed');
  return { filters, summary: { orders: total, completed, cancelled, returnOrders, visits: orders.reduce((s, o) => s + number(o.visits), 0), completionRate: total ? Math.round(completed / total * 1000) / 10 : 0, cancellationRate: total ? Math.round(cancelled / total * 1000) / 10 : 0, returnRate: total ? Math.round(returnOrders / total * 1000) / 10 : 0,
    completedServiceAmount: completedRows.reduce((sum, o) => sum + dollars(o.serviceAmount), 0) / 100,
    rewardDiscounts: completedRows.reduce((sum, o) => sum + dollars(o.rewardDiscount), 0) / 100,
    completedNetServiceAmount: completedRows.reduce((sum, o) => sum + dollars(o.netServiceAmount), 0) / 100,
    unknownCompletedPrices: completedRows.filter(o => o.serviceAmount === null).length }, orders: mapped, dailyService, periodService: groupServicePeriods(dailyService, filters.groupBy), parts, bundles, services, technicians };
}
function reportCsv(data) {
  return safeCsv([
    ['CoolCare reports', `${data.filters.from} to ${data.filters.to}`],
    ['Metric', 'Value'], ...Object.entries(data.summary),
    ['Service filter', data.filters.serviceGroup === 'annual' ? 'Annual Cleaning Bundle' : data.services.find(s => s.id === data.filters.serviceId)?.name ?? 'All'],
    ['Technician filter', data.technicians.find(t => t.id === data.filters.technicianId)?.name ?? 'All'],
    ['Group values by', data.filters.groupBy],
    [], ['Scheduled service period', 'Completed bookings', 'Service amount SGD', 'Reward discounts SGD', 'Net service amount SGD'], ...data.periodService.map(r => [r.period, r.completed, r.serviceAmount, r.rewardDiscounts, r.netServiceAmount]),
    [], ['Booking', 'Service date', 'Service', 'Status', 'Started visits', 'Return requests', 'Service amount SGD', 'Reward discount SGD', 'Net service amount SGD'], ...data.orders.map(r => [r.bookingReference, r.serviceDate, r.serviceName, r.status, r.visits, r.returns, r.serviceAmount, r.rewardDiscount, r.netServiceAmount]),
    [], ['Part', 'Unit', 'Issued', 'Returned'], ...data.parts.map(r => [r.name, r.unit, r.issued, r.returned]),
  ]);
}
export function registerCommerceRoutes(app, pool) {
  const auth = role => async (req, _res, next) => {
    const userId = req.session.portalUser?.id ?? req.session.user?.user_id;
    if (!userId) throw new AppError('Please sign in.', 401);
    const [[user]] = await pool.execute(`SELECT u.user_id AS id,r.role_name AS role,c.customer_id AS customerId FROM user_account u JOIN role r ON r.role_id=u.role_id LEFT JOIN customer c ON c.user_id=u.user_id WHERE u.user_id=? AND u.status='Active'`, [userId]);
    if (!user || user.role !== role) throw new AppError('This account cannot access these records.', 403);
    req.commerceUser = user; next();
  };
  app.use('/api/commerce', (_req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); });
  app.use('/api/commerce/customer', auth('Customer'));
  app.use('/api/commerce/admin', auth('Admin'));
  app.get('/api/commerce/admin/plans', async (_req, res) => res.json(await listAdminAnnualPlans(pool)));
  app.get('/api/commerce/customer/rewards', async (req, res) => res.json(await rewardsSummary(pool, req.commerceUser.customerId)));
  app.post('/api/commerce/customer/rewards/:bookingId', async (req, res) => res.json(await reserveReward(pool, req.commerceUser.id, req.commerceUser.customerId, req.params.bookingId, req.body)));
  app.all(['/api/commerce/admin/payments','/api/commerce/admin/payments/:bookingId'], (_req, res) => res.status(410).json({ error: 'Payment management has been removed. Rewards are awarded when the booking is completed.' }));
  app.get('/api/commerce/admin/rewards', async (_req, res) => {
    const [customers] = await pool.query('SELECT c.customer_id AS id,u.full_name AS name,u.email,COALESCE(a.current_points,0) AS points FROM customer c JOIN user_account u ON u.user_id=c.user_id LEFT JOIN loyalty_account a ON a.customer_id=c.customer_id ORDER BY u.full_name');
    const [ruleHistory] = await pool.query('SELECT a.version,a.reason,a.rule_json AS rules,UNIX_TIMESTAMP(a.created_at) AS createdAt,u.full_name AS changedBy FROM reward_rule_audit a JOIN user_account u ON u.user_id=a.actor_user_id ORDER BY a.version DESC LIMIT 30');
    res.json({ bookings: await listRewardBookings(pool), customers, rules: await rule(pool), ruleHistory: ruleHistory.map(row => ({ ...row, createdAt: instant(row.createdAt) })) });
  });
  app.get('/api/commerce/admin/rewards/:customerId', async (req, res) => res.json(await rewardsSummary(pool, idSchema.parse(req.params.customerId))));
  app.post('/api/commerce/admin/rewards/:customerId/adjust', async (req, res) => res.json(await adjustReward(pool, req.commerceUser.id, req.params.customerId, req.body)));
  app.patch('/api/commerce/admin/reward-rules', async (req, res) => res.json(await updateRewardRule(pool, req.commerceUser.id, req.body)));
  app.get('/api/commerce/admin/reports', async (req, res) => res.json(await commerceReport(pool, req.query)));
  app.get('/api/commerce/admin/reports.csv', async (req, res) => {
    const report = await commerceReport(pool, req.query);
    res.set('Content-Type', 'text/csv; charset=utf-8').set('Content-Disposition', 'attachment; filename="coolcare-report.csv"').send(reportCsv(report));
  });
}
