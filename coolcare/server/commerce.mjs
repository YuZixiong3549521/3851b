import { createHash } from 'node:crypto';
import { z } from 'zod';
import { AppError, idSchema } from './inventory.mjs';
import { isCalendarDate } from './customer/booking-schedule.mjs';

const terminal = new Set(['Cancelled', 'Rejected', 'Expired']);
const money = z.coerce.number().finite().positive().max(9999999.99).refine(v => Math.abs(v * 100 - Math.round(v * 100)) < 0.000001, 'Use at most two decimal places.');
const date = z.string().refine(isCalendarDate, 'Enter a valid calendar date.');
const request = { requestId: z.uuid() };
export const paymentSchema = z.object({
  ...request, kind: z.enum(['Receipt', 'Refund']), amount: money,
  method: z.enum(['Cash', 'PayNow', 'Bank transfer', 'Card', 'Other']),
  receivedDate: date, reference: z.string().trim().max(120).default(''),
  notes: z.string().trim().min(5).max(1000),
}).strict();
const redemptionSchema = z.object({ ...request, points: z.number().int().min(0).max(10000000) }).strict();
const adjustSchema = z.object({ ...request, points: z.number().int().min(-1000000).max(1000000).refine(v => v !== 0), reason: z.string().trim().min(5).max(500) }).strict();
const ruleSchema = z.object({ ...request, expectedVersion: z.number().int().positive(), pointsPerDollar: z.number().int().min(0).max(100), redemptionPoints: z.number().int().min(1).max(1000000), redemptionValue: money, reason: z.string().trim().min(5).max(500) }).strict();
const dollars = v => Math.round(Number(v || 0) * 100);
const number = v => Number(v || 0);
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const hash = input => createHash('sha256').update(JSON.stringify(input)).digest('hex');
const json = value => typeof value === 'string' ? JSON.parse(value) : value;
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
  await c.execute('INSERT IGNORE INTO loyalty_account(customer_id) VALUES (?)', [customerId]);
  const [[account]] = await c.execute('SELECT * FROM loyalty_account WHERE customer_id=? FOR UPDATE', [customerId]);
  return account;
}
async function rule(c, lock = false) {
  const [[r]] = await c.query('SELECT version,points_per_dollar AS pointsPerDollar,redemption_points AS redemptionPoints,redemption_value AS redemptionValue FROM reward_rule WHERE rule_id=1' + (lock ? ' FOR UPDATE' : ''));
  return { ...r, redemptionValue: number(r.redemptionValue) };
}
async function bookingMoney(c, b) {
  // The current technician quote is charged once per booking; return visits do
  // not create independent invoice or loyalty earning records.
  const [extras] = await c.execute(`SELECT p.additional_repair_fee AS fee FROM work_order w
    JOIN assignment a ON a.assignment_id=w.assignment_id JOIN service_progress p ON p.job_id=w.job_id
    WHERE w.booking_id=? AND a.assignment_status NOT IN ('Cancelled','Reassigned','Declined') FOR SHARE`, [b.booking_id]);
  const [payments] = await c.execute('SELECT kind,amount FROM commerce_payment WHERE booking_id=? FOR SHARE', [b.booking_id]);
  const [[reservation]] = await c.execute('SELECT * FROM reward_reservation WHERE booking_id=? FOR SHARE', [b.booking_id]);
  const quote = b.total_amount === null ? null : dollars(b.total_amount) + extras.reduce((sum, r) => sum + dollars(r.fee), 0);
  const discount = reservation && reservation.status !== 'Released' ? dollars(reservation.discount_amount) : 0;
  const received = payments.filter(p => p.kind === 'Receipt').reduce((sum, p) => sum + dollars(p.amount), 0);
  const refunded = payments.filter(p => p.kind === 'Refund').reduce((sum, p) => sum + dollars(p.amount), 0);
  return { quote, discount, received, refunded, net: received - refunded, due: quote === null ? null : Math.max(0, quote - discount - received + refunded), reservation };
}
async function appendPoints(c, account, bookingId, points, type, description) {
  const [result] = await c.execute(`INSERT INTO loyalty_transaction(loyalty_account_id,booking_id,transaction_type,points,description) VALUES (?,?,?,?,?)`, [account.loyalty_account_id, bookingId, type, points, description.slice(0, 255)]);
  await c.execute('UPDATE loyalty_account SET current_points=current_points+? WHERE loyalty_account_id=?', [points, account.loyalty_account_id]);
  account.current_points += points;
  return result.insertId;
}
async function settleEarning(c, b, account, netCents) {
  const currentRule = await rule(c);
  await c.execute(`INSERT IGNORE INTO reward_booking_earning(booking_id,loyalty_account_id,points_per_dollar,rule_version) VALUES (?,?,?,?)`, [b.booking_id, account.loyalty_account_id, currentRule.pointsPerDollar, currentRule.version]);
  const [[earning]] = await c.execute('SELECT * FROM reward_booking_earning WHERE booking_id=? FOR UPDATE', [b.booking_id]);
  const target = earnedPoints(netCents, earning.points_per_dollar), delta = target - earning.awarded_points;
  if (delta) {
    await appendPoints(c, account, b.booking_id, delta, delta > 0 ? 'Earned' : 'Adjusted', delta > 0 ? 'Earned from recorded payment for completed service.' : 'Payment refund: earned points reversed. A negative balance offsets future earnings.');
    await c.execute('UPDATE reward_booking_earning SET awarded_points=? WHERE booking_id=?', [target, b.booking_id]);
  }
  return delta;
}
export async function recordPayment(pool, actorId, rawBookingId, raw) {
  const bookingId = idSchema.parse(rawBookingId), data = paymentSchema.parse(raw);
  const input = { action: 'payment', bookingId, ...data };
  if (data.receivedDate > today()) throw new AppError('Payment date cannot be in the future.');
  return transaction(pool, async c => {
    const b = await lockBooking(c, bookingId);
    const account = await lockAccount(c, b.customer_id);
    const previous = await replay(c, actorId, input); if (previous) return previous;
    const state = await bookingMoney(c, b), amount = dollars(data.amount);
    if (data.kind === 'Receipt') {
      if (b.booking_status !== 'Completed') throw new AppError('Record receipts only after the service is completed.', 409);
      if (state.quote === null) throw new AppError('This historical booking has no recorded price. Record an agreed price through the booking workflow before taking payment.', 409);
      if (amount > state.due) throw new AppError('Receipt exceeds the outstanding amount. Refresh the booking balance.', 409);
      if (state.reservation?.status === 'Reserved') {
        if (state.discount > state.quote) throw new AppError('The reserved discount exceeds the current price. Release or reduce the reservation first.', 409);
        if (account.current_points < state.reservation.points) throw new AppError('The reserved points are no longer available after a refund or adjustment. Release or reduce the reservation.', 409);
        await appendPoints(c, account, bookingId, -state.reservation.points, 'Redeemed', 'Reserved reward applied to the completed service.');
        await c.execute("UPDATE reward_reservation SET status='Redeemed' WHERE booking_id=?", [bookingId]);
      }
    } else if (amount > state.net) throw new AppError('Refund exceeds the recorded cash received for this booking.', 409);
    const [result] = await c.execute(`INSERT INTO commerce_payment(booking_id,kind,amount,method,received_date,reference,notes,actor_user_id) VALUES (?,?,?,?,?,?,?,?)`, [bookingId, data.kind, amount / 100, data.method, data.receivedDate, data.reference, data.notes, actorId]);
    const net = state.net + (data.kind === 'Receipt' ? amount : -amount);
    const pointsChange = await settleEarning(c, b, account, net);
    return remember(c, actorId, input, { paymentId: result.insertId, bookingId, netReceived: net / 100, pointsChange });
  });
}
export async function reserveReward(pool, actorId, customerId, rawBookingId, raw) {
  const bookingId = idSchema.parse(rawBookingId), data = redemptionSchema.parse(raw);
  const input = { action: 'reserve', bookingId, ...data };
  return transaction(pool, async c => {
    const b = await lockBooking(c, bookingId, customerId);
    const account = await lockAccount(c, customerId);
    const previous = await replay(c, actorId, input); if (previous) return previous;
    const state = await bookingMoney(c, b);
    if (state.reservation?.status === 'Redeemed') throw new AppError('This reward has already been applied to a payment.', 409);
    if (!data.points) {
      await releaseBookingRewardReservation(c, bookingId, 'Released by customer.');
      return remember(c, actorId, input, { bookingId, points: 0, discount: 0 });
    }
    if (terminal.has(b.booking_status)) throw new AppError('Rewards cannot be reserved on a closed request.', 409);
    if (state.received > 0) throw new AppError('Reserve rewards before the first payment.', 409);
    if (state.quote === null) throw new AppError('This booking does not have a recorded price.', 409);
    const config = await rule(c);
    if (data.points % config.redemptionPoints) throw new AppError(`Redeem in multiples of ${config.redemptionPoints} points.`);
    const discount = data.points / config.redemptionPoints * dollars(config.redemptionValue);
    // Leave at least one cent payable; payment records always represent actual
    // money. There is no fake zero-dollar receipt or fabricated point earning.
    if (discount >= state.quote) throw new AppError('The reward must be less than the service total; leave a cash balance to settle.');
    const [reserved] = await c.execute(`SELECT points FROM reward_reservation WHERE loyalty_account_id=? AND status='Reserved' AND booking_id<>? FOR SHARE`, [account.loyalty_account_id, bookingId]);
    if (data.points > Math.max(0, account.current_points - reserved.reduce((sum, r) => sum + r.points, 0))) throw new AppError('Not enough available points. Other bookings may already reserve some points.', 409);
    await c.execute(`INSERT INTO reward_reservation(booking_id,loyalty_account_id,points,discount_amount,rule_version,status,reason)
      VALUES (?,?,?,?,?,'Reserved','Reserved by customer.') ON DUPLICATE KEY UPDATE points=VALUES(points),discount_amount=VALUES(discount_amount),rule_version=VALUES(rule_version),status='Reserved',reason=VALUES(reason)`, [bookingId, account.loyalty_account_id, data.points, discount / 100, config.version]);
    return remember(c, actorId, input, { bookingId, points: data.points, discount: discount / 100 });
  });
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

export async function listPaymentBookings(pool, customerId) {
  const [rows] = await pool.execute(`SELECT b.booking_id AS bookingId,b.customer_id AS customerId,b.booking_status AS status,b.preferred_service_date AS serviceDate,
    b.total_amount AS baseAmount,u.full_name AS customerName,u.email,
    COALESCE((SELECT bp.package_name FROM booking_package bp WHERE bp.booking_id=b.booking_id),
      (SELECT GROUP_CONCAT(bs.service_name ORDER BY bs.service_id SEPARATOR ', ') FROM booking_service bs WHERE bs.booking_id=b.booking_id),s.service_name) AS serviceName,
    COALESCE((SELECT SUM(p.additional_repair_fee) FROM work_order w JOIN assignment a ON a.assignment_id=w.assignment_id JOIN service_progress p ON p.job_id=w.job_id WHERE w.booking_id=b.booking_id AND a.assignment_status NOT IN ('Cancelled','Reassigned','Declined')),0) AS additionalFee,
    COALESCE((SELECT SUM(IF(p.kind='Receipt',p.amount,-p.amount)) FROM commerce_payment p WHERE p.booking_id=b.booking_id),0) AS netReceived,
    COALESCE((SELECT SUM(p.amount) FROM commerce_payment p WHERE p.booking_id=b.booking_id AND p.kind='Receipt'),0) AS totalReceived,
    COALESCE((SELECT SUM(p.amount) FROM commerce_payment p WHERE p.booking_id=b.booking_id AND p.kind='Refund'),0) AS totalRefunded,
    COALESCE(IF(r.status IN ('Reserved','Redeemed'),r.discount_amount,0),0) AS discount,r.status AS rewardStatus,COALESCE(r.points,0) AS rewardPoints
    FROM booking b JOIN customer c ON c.customer_id=b.customer_id JOIN user_account u ON u.user_id=c.user_id
    JOIN service_catalog s ON s.service_id=b.service_id LEFT JOIN reward_reservation r ON r.booking_id=b.booking_id
    ${customerId === undefined ? '' : 'WHERE b.customer_id=?'} ORDER BY b.booking_id DESC LIMIT 1000`, customerId === undefined ? [] : [customerId]);
  return rows.map(row => {
    const quote = row.baseAmount === null ? null : (dollars(row.baseAmount) + dollars(row.additionalFee)) / 100;
    return { ...row, baseAmount: row.baseAmount === null ? null : number(row.baseAmount), additionalFee: number(row.additionalFee), quote, netReceived: number(row.netReceived), totalReceived: number(row.totalReceived), totalRefunded: number(row.totalRefunded), discount: number(row.discount), amountDue: quote === null ? null : Math.max(0, dollars(quote) - dollars(row.discount) - dollars(row.netReceived)) / 100 };
  });
}
export async function rewardsSummary(pool, customerId) {
  const config = await rule(pool);
  const [[account]] = await pool.execute(`SELECT a.loyalty_account_id AS id,a.current_points AS balance,
    (SELECT COALESCE(SUM(points),0) FROM reward_reservation WHERE loyalty_account_id=a.loyalty_account_id AND status='Reserved') AS reserved
    FROM loyalty_account a WHERE customer_id=?`, [customerId]);
  const [history] = account ? await pool.execute(`SELECT t.loyalty_transaction_id AS id,t.booking_id AS bookingId,t.transaction_type AS type,t.points,t.description,t.created_at AS createdAt,u.full_name AS adjustedBy
    FROM loyalty_transaction t LEFT JOIN reward_adjustment_audit a ON a.loyalty_transaction_id=t.loyalty_transaction_id LEFT JOIN user_account u ON u.user_id=a.actor_user_id
    WHERE t.loyalty_account_id=? ORDER BY t.loyalty_transaction_id DESC LIMIT 200`, [account.id]) : [[]];
  const balance = number(account?.balance), reserved = number(account?.reserved);
  const bookings = await listPaymentBookings(pool, customerId);
  const [payments] = await pool.execute(`SELECT p.payment_id AS id,p.booking_id AS bookingId,p.kind,p.amount,p.method,p.received_date AS receivedDate,p.reference,p.notes FROM commerce_payment p JOIN booking b ON b.booking_id=p.booking_id WHERE b.customer_id=? ORDER BY p.payment_id DESC LIMIT 200`, [customerId]);
  return { rules: config, balance, reserved, available: Math.max(0, balance - reserved), debt: Math.max(0, -balance), history, bookings, payments };
}

export const reportFilterSchema = z.object({ from: date, to: date, serviceId: idSchema.optional(), technicianId: idSchema.optional() }).strict().refine(v => v.from <= v.to && (Date.parse(v.to) - Date.parse(v.from)) / 86400000 <= 366, 'Choose a date range of at most 367 days.');
function bookingFilter(filters, alias = 'b') {
  const clauses = [], values = [];
  if (filters.serviceId) { clauses.push(`(${alias}.service_id=? OR EXISTS(SELECT 1 FROM booking_service bs WHERE bs.booking_id=${alias}.booking_id AND bs.service_id=?))`); values.push(filters.serviceId, filters.serviceId); }
  if (filters.technicianId) {
    clauses.push(`(EXISTS(SELECT 1 FROM assignment fa WHERE fa.booking_id=${alias}.booking_id AND fa.technician_id=? AND fa.assignment_status NOT IN ('Cancelled','Reassigned','Declined'))
      OR EXISTS(SELECT 1 FROM performance_visit fv JOIN work_order fw ON fw.job_id=fv.job_id WHERE fw.booking_id=${alias}.booking_id AND fv.technician_id=?))`);
    values.push(filters.technicianId, filters.technicianId);
  }
  return { sql: clauses.length ? ' AND ' + clauses.join(' AND ') : '', values };
}
export async function commerceReport(pool, raw) {
  const filters = reportFilterSchema.parse(raw), f = bookingFilter(filters);
  const [orders] = await pool.execute(`SELECT b.booking_id AS bookingId,b.booking_status AS status,b.preferred_service_date AS serviceDate,
    b.total_amount AS baseAmount,
    COALESCE((SELECT bp.package_name FROM booking_package bp WHERE bp.booking_id=b.booking_id),
      (SELECT GROUP_CONCAT(bs.service_name ORDER BY bs.service_id SEPARATOR ', ') FROM booking_service bs WHERE bs.booking_id=b.booking_id),s.service_name) AS serviceName,
    COALESCE((SELECT SUM(p.additional_repair_fee) FROM work_order w JOIN assignment a ON a.assignment_id=w.assignment_id JOIN service_progress p ON p.job_id=w.job_id WHERE w.booking_id=b.booking_id AND a.assignment_status NOT IN ('Cancelled','Reassigned','Declined')),0) AS additionalFee,
    (SELECT COUNT(*) FROM service_visit_record v JOIN work_order w ON w.job_id=v.job_id WHERE w.booking_id=b.booking_id AND v.outcome='Return required'${filters.technicianId ? ' AND v.technician_id=?' : ''}) AS returns,
    (SELECT COUNT(*) FROM service_report r JOIN work_order w ON w.job_id=COALESCE(r.job_id,r.archived_job_id)
      JOIN assignment va ON va.assignment_id=w.assignment_id LEFT JOIN performance_visit pv ON pv.report_id=r.report_id
      WHERE w.booking_id=b.booking_id AND r.started_at IS NOT NULL${filters.technicianId ? ' AND pv.technician_id=?' : ''}) AS visits
    FROM booking b JOIN service_catalog s ON s.service_id=b.service_id WHERE b.preferred_service_date BETWEEN ? AND ?${f.sql} ORDER BY b.preferred_service_date,b.booking_id`, [...(filters.technicianId ? [filters.technicianId, filters.technicianId] : []), filters.from, filters.to, ...f.values]);
  const [cash] = await pool.execute(`SELECT p.received_date AS date,SUM(IF(p.kind='Receipt',p.amount,0)) AS receipts,SUM(IF(p.kind='Refund',p.amount,0)) AS refunds
    FROM commerce_payment p JOIN booking b ON b.booking_id=p.booking_id WHERE p.received_date BETWEEN ? AND ?${f.sql} GROUP BY p.received_date ORDER BY p.received_date`, [filters.from, filters.to, ...f.values]);
  const [parts] = await pool.execute(`SELECT p.part_id AS partId,p.part_name AS name,p.stock_unit AS unit,
    SUM(IF(i.transaction_type='Stock Out',i.quantity,0)) AS issued,SUM(IF(i.transaction_type='Return',i.quantity,0)) AS returned
    FROM inventory_transaction i JOIN part p ON p.part_id=i.part_id JOIN work_order w ON w.job_id=i.job_id JOIN booking b ON b.booking_id=w.booking_id
    WHERE i.created_at >= DATE_SUB(?,INTERVAL 8 HOUR) AND i.created_at < DATE_SUB(DATE_ADD(?,INTERVAL 1 DAY),INTERVAL 8 HOUR)
    AND i.transaction_type IN ('Stock Out','Return')${f.sql} GROUP BY p.part_id,p.part_name,p.stock_unit ORDER BY issued DESC,p.part_id`, [filters.from, filters.to, ...f.values]);
  const [[bundles]] = await pool.execute(`SELECT COUNT(*) AS scheduledVisits,COALESCE(SUM(b.booking_status='Completed'),0) AS completedVisits,COUNT(DISTINCT v.series_id) AS plans
    FROM annual_booking_visit v JOIN booking b ON b.booking_id=v.booking_id WHERE b.preferred_service_date BETWEEN ? AND ?${f.sql}`, [filters.from, filters.to, ...f.values]);
  const [services] = await pool.query('SELECT service_id AS id,service_name AS name FROM service_catalog ORDER BY service_name');
  const [technicians] = await pool.query('SELECT t.technician_id AS id,u.full_name AS name FROM technician t JOIN user_account u ON u.user_id=t.user_id ORDER BY u.full_name');
  const total = orders.length, completed = orders.filter(o => o.status === 'Completed').length, cancelled = orders.filter(o => o.status === 'Cancelled').length;
  const returnOrders = orders.filter(o => number(o.returns) > 0).length;
  const quote = orders.filter(o => o.status === 'Completed' && o.baseAmount !== null).reduce((sum, o) => sum + dollars(o.baseAmount) + dollars(o.additionalFee), 0);
  const receipts = cash.reduce((sum, r) => sum + dollars(r.receipts), 0), refunds = cash.reduce((sum, r) => sum + dollars(r.refunds), 0);
  return { filters, summary: { orders: total, completed, cancelled, returnOrders, visits: orders.reduce((s, o) => s + number(o.visits), 0), completionRate: total ? Math.round(completed / total * 1000) / 10 : 0, cancellationRate: total ? Math.round(cancelled / total * 1000) / 10 : 0, returnRate: total ? Math.round(returnOrders / total * 1000) / 10 : 0, completedServiceAmount: quote / 100, unknownCompletedPrices: orders.filter(o => o.status === 'Completed' && o.baseAmount === null).length, receipts: receipts / 100, refunds: refunds / 100, netReceived: (receipts - refunds) / 100 }, orders, cash: cash.map(r => ({ ...r, receipts: number(r.receipts), refunds: number(r.refunds), net: number(r.receipts) - number(r.refunds) })), parts, bundles, services, technicians };
}
function reportCsv(data) {
  return safeCsv([
    ['CoolCare reports', `${data.filters.from} to ${data.filters.to}`],
    ['Metric', 'Value'], ...Object.entries(data.summary),
    [], ['Cash date', 'Receipts SGD', 'Refunds SGD', 'Net SGD'], ...data.cash.map(r => [r.date, r.receipts, r.refunds, r.net]),
    [], ['Booking', 'Service date', 'Service', 'Status', 'Started visits', 'Return requests', 'Base quote SGD', 'Additional quote SGD'], ...data.orders.map(r => [r.bookingId, r.serviceDate, r.serviceName, r.status, r.visits, r.returns, r.baseAmount, r.additionalFee]),
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
  app.get('/api/commerce/customer/rewards', async (req, res) => res.json(await rewardsSummary(pool, req.commerceUser.customerId)));
  app.post('/api/commerce/customer/rewards/:bookingId', async (req, res) => res.json(await reserveReward(pool, req.commerceUser.id, req.commerceUser.customerId, req.params.bookingId, req.body)));
  app.get('/api/commerce/admin/payments', async (_req, res) => {
    const [payments] = await pool.query(`SELECT p.payment_id AS id,p.booking_id AS bookingId,p.kind,p.amount,p.method,p.received_date AS receivedDate,p.reference,p.notes,u.full_name AS recordedBy FROM commerce_payment p JOIN user_account u ON u.user_id=p.actor_user_id ORDER BY p.payment_id DESC LIMIT 200`);
    const [customers] = await pool.query('SELECT c.customer_id AS id,u.full_name AS name,u.email,COALESCE(a.current_points,0) AS points FROM customer c JOIN user_account u ON u.user_id=c.user_id LEFT JOIN loyalty_account a ON a.customer_id=c.customer_id ORDER BY u.full_name');
    const [ruleHistory] = await pool.query('SELECT a.version,a.reason,a.rule_json AS rules,a.created_at AS createdAt,u.full_name AS changedBy FROM reward_rule_audit a JOIN user_account u ON u.user_id=a.actor_user_id ORDER BY a.version DESC LIMIT 30');
    res.json({ bookings: await listPaymentBookings(pool), payments, customers, rules: await rule(pool), ruleHistory });
  });
  app.post('/api/commerce/admin/payments/:bookingId', async (req, res) => res.json(await recordPayment(pool, req.commerceUser.id, req.params.bookingId, req.body)));
  app.get('/api/commerce/admin/rewards/:customerId', async (req, res) => res.json(await rewardsSummary(pool, idSchema.parse(req.params.customerId))));
  app.post('/api/commerce/admin/rewards/:customerId/adjust', async (req, res) => res.json(await adjustReward(pool, req.commerceUser.id, req.params.customerId, req.body)));
  app.patch('/api/commerce/admin/reward-rules', async (req, res) => res.json(await updateRewardRule(pool, req.commerceUser.id, req.body)));
  app.get('/api/commerce/admin/reports', async (req, res) => res.json(await commerceReport(pool, req.query)));
  app.get('/api/commerce/admin/reports.csv', async (req, res) => {
    const report = await commerceReport(pool, req.query);
    res.set('Content-Type', 'text/csv; charset=utf-8').set('Content-Disposition', 'attachment; filename="coolcare-report.csv"').send(reportCsv(report));
  });
}
