import { bookingReference as reference } from '../booking-reference.mjs';
import { asyncRoute, HttpError } from './errors.mjs';
import { addCalendarDays, appointmentInstant, minimumBookingDate, nextWeekday, singaporeToday } from './booking-schedule.mjs';
import { addCalendarMonths } from './annual-bookings.mjs';
import { getBookingOptions } from './booking-options.mjs';

const inactiveStatuses = new Set(['Cancelled', 'Rejected', 'Expired']);
const preServiceStatuses = new Set(['Submitted', 'Confirmed', 'Assigned', 'On The Way']);
export const EARLY_RENEWAL_POINTS = 100;
const id = value => {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 1) throw new HttpError(400, 'Invalid plan identifier.');
  return result;
};
const day = value => String(value).slice(0, 10);

/** Booking status, not report/return count, determines the quarterly entitlement. */
export function describeAnnualPlan(series, visits, now = new Date()) {
  const today = singaporeToday(now);
  const validUntil = visits.map(visit => day(visit.windowEnd)).sort().at(-1)
    ?? addCalendarMonths(day(series.firstServiceDate), 12);
  const completedVisits = visits.filter(visit => visit.status === 'Completed').length;
  const inactiveVisits = visits.filter(visit => inactiveStatuses.has(visit.status)).length;
  const activeVisits = visits.filter(visit => visit.status !== 'Completed' && !inactiveStatuses.has(visit.status));
  const returnPending = activeVisits.some(visit => /return/i.test(visit.status) || ['On The Way', 'In Progress'].includes(visit.status));
  let status = 'Active';
  if (visits.length === 4 && completedVisits === 4) status = 'Completed';
  else if (visits.length > 0 && inactiveVisits === visits.length) status = visits.every(visit => visit.status === 'Expired') ? 'Expired' : 'Cancelled';
  else if (today >= validUntil && !returnPending) status = 'Expired';
  const nextVisit = activeVisits
    .filter(visit => appointmentInstant(visit.preferredDate, visit.slotStart || '09:00:00') >= now)
    .sort((a, b) => `${a.preferredDate} ${a.slotStart}`.localeCompare(`${b.preferredDate} ${b.slotStart}`))[0] ?? null;
  const finalVisit = visits.find(visit => Number(visit.visitNumber) === 4);
  const earlyRenewalDeadline = finalVisit?.slotStart
    ? appointmentInstant(finalVisit.preferredDate, finalVisit.slotStart) : null;
  // Open before the final appointment, rather than after it near term expiry.
  const renewalOpenDate = addCalendarDays(finalVisit?.preferredDate || validUntil, -60);
  const existingRenewalSeriesId = series.existingRenewalSeriesId ? Number(series.existingRenewalSeriesId) : null;
  const canRenew = !existingRenewalSeriesId && status !== 'Cancelled' && (today >= renewalOpenDate || status === 'Completed');
  const earlyRenewalPromotionAvailable = !existingRenewalSeriesId && status === 'Active' && earlyRenewalDeadline > now
    && preServiceStatuses.has(finalVisit?.status);
  const earlyRenewalEligible = canRenew && earlyRenewalPromotionAvailable;
  const minimumFirstDate = nextWeekday([validUntil, minimumBookingDate(now)].sort().at(-1));
  const closedVisits = visits.filter(visit => inactiveStatuses.has(visit.status));
  const attentionMessage = closedVisits.length && activeVisits.length
    ? `${closedVisits.map(visit => `Visit ${visit.visitNumber} is ${visit.status.toLowerCase()}`).join('; ')}. The other ${activeVisits.length} quarterly ${activeVisits.length === 1 ? 'visit remains' : 'visits remain'} reserved. Review each open booking to manage its date or contact support. Closing one visit does not cancel the other visits.`
    : null;
  return {
    ...series,
    seriesId: Number(series.seriesId),
    totalAmount: Number(series.totalAmount),
    unitCount: Number(series.unitCount),
    includedUnits: series.includedUnits == null ? null : Number(series.includedUnits),
    baseAnnualPrice: series.baseAnnualPrice == null ? null : Number(series.baseAnnualPrice),
    additionalUnitPrice: series.additionalUnitPrice == null ? null : Number(series.additionalUnitPrice),
    validFrom: day(series.firstServiceDate),
    validUntil,
    status,
    totalVisits: 4,
    completedVisits,
    remainingVisits: activeVisits.length,
    unusedClosedVisits: inactiveVisits,
    attentionMessage,
    nextVisit,
    renewalOpenDate,
    canRenew,
    minimumFirstDate,
    existingRenewalSeriesId,
    earlyRenewalPoints: EARLY_RENEWAL_POINTS,
    earlyRenewalDeadline: earlyRenewalDeadline?.toISOString() ?? null,
    earlyRenewalEligible: Boolean(earlyRenewalEligible),
    earlyRenewalPromotionAvailable: Boolean(earlyRenewalPromotionAvailable),
    earlyRenewalReward: series.renewalBonusPoints ? {
      points: Number(series.renewalBonusPoints),
      deadline: series.renewalBonusDeadline,
      status: series.renewalBonusAwardedEpoch ? 'Awarded'
        : inactiveStatuses.has(visits.find(visit => Number(visit.visitNumber) === 1)?.status) ? 'Not eligible' : 'Pending first completion',
      awardedAt: series.renewalBonusAwardedEpoch ? new Date(Number(series.renewalBonusAwardedEpoch) * 1000).toISOString() : null,
    } : null,
    visits,
  };
}

export function annualPlanReminders(plans, now = new Date()) {
  const today = singaporeToday(now);
  const soon = addCalendarDays(today, 7);
  return plans.flatMap(plan => {
    const reminders = [];
    if (plan.canRenew) reminders.push({
      seriesId: plan.seriesId,
      key: `renewal:${plan.validUntil}`,
      kind: 'renewal',
      title: plan.status === 'Expired' ? 'Your annual plan has ended' : 'Plan your next year of care',
      message: plan.earlyRenewalEligible
        ? `Renew before your final visit on ${plan.visits.find(visit => Number(visit.visitNumber) === 4).preferredDate} to earn ${plan.earlyRenewalPoints} bonus points after the renewed plan's first service is completed. Review My Plans for the exact deadline.`
        : `Your current plan ends on ${plan.validUntil}. Review current prices and choose the first visit for a new annual plan. No automatic renewal or charge applies.`,
    });
    if (plan.nextVisit && plan.nextVisit.preferredDate <= soon) reminders.push({
      seriesId: plan.seriesId,
      key: `visit:${plan.nextVisit.bookingId}:${plan.nextVisit.preferredDate}:${plan.nextVisit.slotStart}:${plan.nextVisit.status}`,
      kind: 'visit',
      bookingId: plan.nextVisit.bookingId,
      title: `Quarterly visit ${plan.nextVisit.visitNumber} is coming up`,
      message: `${plan.nextVisit.reference} is scheduled for ${plan.nextVisit.preferredDate}. Changes require at least 72 hours' notice.`,
    });
    return reminders;
  });
}

async function readPlans(executor, userId, { seriesId, now = new Date() } = {}) {
  const [series] = await executor.execute(`SELECT s.series_id AS seriesId,s.customer_id AS customerId,
    s.package_id AS packageId,s.package_name AS name,s.first_service_date AS firstServiceDate,
    s.unit_count AS unitCount,s.total_amount AS totalAmount,s.property_type AS propertyType,
    s.property_label AS propertyLabel,s.included_units AS includedUnits,s.base_annual_price AS baseAnnualPrice,
    s.additional_unit_price AS additionalUnitPrice,s.address_id AS addressId,a.address_line AS addressLine,
    a.postal_code AS postalCode,a.is_archived AS addressArchived,r.renewed_series_id AS existingRenewalSeriesId,
    p.source_series_id AS renewedFromSeriesId,u.full_name AS customerName,u.email,
    bonus.points AS renewalBonusPoints,DATE_FORMAT(bonus.deadline_at,'%Y-%m-%dT%H:%i:%sZ') AS renewalBonusDeadline,
    UNIX_TIMESTAMP(bonus.awarded_at) AS renewalBonusAwardedEpoch
    FROM annual_booking_series s JOIN customer c ON c.customer_id=s.customer_id
    JOIN user_account u ON u.user_id=c.user_id
    JOIN service_address a ON a.address_id=s.address_id
    LEFT JOIN annual_plan_renewal r ON r.source_series_id=s.series_id
    LEFT JOIN annual_plan_renewal p ON p.renewed_series_id=s.series_id
    LEFT JOIN annual_renewal_bonus bonus ON bonus.renewed_series_id=s.series_id
    WHERE ${userId === null ? '1=1' : 'c.user_id=?'} ${seriesId ? 'AND s.series_id=?' : ''}
    ORDER BY s.first_service_date DESC,s.series_id DESC`, [...(userId === null ? [] : [userId]), ...(seriesId ? [seriesId] : [])]);
  if (!series.length) return [];
  const ids = series.map(item => item.seriesId);
  const [visits] = await executor.execute(`SELECT v.series_id AS seriesId,v.visit_number AS visitNumber,
    v.window_start AS windowStart,v.window_end AS windowEnd,b.booking_id AS bookingId,b.created_at AS createdAt,
    b.booking_status AS status,b.preferred_service_date AS preferredDate,b.preferred_time_slot AS timeSlot,
    b.slot_start AS slotStart,b.slot_end AS slotEnd,b.total_amount AS totalAmount
    FROM annual_booking_visit v JOIN booking b ON b.booking_id=v.booking_id
    WHERE v.series_id IN (${ids.map(() => '?').join(',')}) ORDER BY v.visit_number`, ids);
  return series.map(item => describeAnnualPlan(item, visits.filter(visit => visit.seriesId === item.seriesId)
    .map(visit => ({ ...visit, totalAmount: Number(visit.totalAmount), reference: reference(visit.bookingId, visit.createdAt), bookingReference: reference(visit.bookingId, visit.createdAt) })), now));
}

export async function listAnnualPlans(executor, userId, now = new Date()) {
  const plans = await readPlans(executor, userId, { now });
  const [notices] = await executor.execute('SELECT series_id AS seriesId,notice_key AS noticeKey FROM annual_plan_notice WHERE user_id=?', [userId]);
  const reminders = annualPlanReminders(plans, now).filter(reminder =>
    !notices.some(notice => notice.seriesId === reminder.seriesId && notice.noticeKey === reminder.key));
  return {
    plans,
    reminders,
    summary: {
      activePlans: plans.filter(plan => plan.status === 'Active').length,
      scheduledVisits: plans.reduce((sum, plan) => sum + plan.remainingVisits, 0),
      completedVisits: plans.reduce((sum, plan) => sum + plan.completedVisits, 0),
      renewalsAvailable: plans.filter(plan => plan.canRenew).length,
    },
  };
}

// Only called by the existing administrator-authenticated commerce route.
export async function listAdminAnnualPlans(executor, now = new Date()) {
  return { plans: await readPlans(executor, null, { now }) };
}

export async function getAnnualPlanRenewal(executor, userId, seriesId, now = new Date()) {
  const [plan] = await readPlans(executor, userId, { seriesId: id(seriesId), now });
  if (!plan) throw new HttpError(404, 'Annual plan not found.');
  if (plan.existingRenewalSeriesId) return { existingRenewalSeriesId: plan.existingRenewalSeriesId };
  if (!plan.canRenew) throw new HttpError(409, plan.status === 'Cancelled'
    ? 'This plan was cancelled. Start a new booking to choose another annual plan.'
    : `Renewal opens on ${plan.renewalOpenDate}, 60 days before your final scheduled visit.`);
  const options = await getBookingOptions(executor);
  const bundle = options.bundles.find(item => item.code === 'annual-cleaning');
  if (!bundle) throw new HttpError(409, 'The annual cleaning plan is currently unavailable. Contact support.');
  const tier = bundle.propertyPrices.find(item => item.propertyType === plan.propertyType);
  return {
    renewalOfSeriesId: plan.seriesId,
    packageId: bundle.packageId,
    propertyType: tier ? plan.propertyType : '',
    numberOfUnits: plan.unitCount,
    addressId: plan.addressArchived ? null : plan.addressId,
    serviceAddress: plan.addressLine,
    postalCode: plan.postalCode ?? '',
    minimumFirstDate: plan.minimumFirstDate,
    previousValidUntil: plan.validUntil,
    currentAnnualPrice: tier ? Number(tier.price) + Math.max(0, plan.unitCount - Number(tier.includedUnits)) * Number(tier.additionalUnitPrice) : null,
    earlyRenewalPoints: plan.earlyRenewalPoints,
    earlyRenewalDeadline: plan.earlyRenewalDeadline,
    earlyRenewalEligible: plan.earlyRenewalEligible,
    pricingNote: 'Renewals use the current catalogue price. Review the property type, dates and price before submitting. Pay after each service; no automatic payment is taken.',
  };
}

/** Call inside the booking transaction, after its customer lock and before writing any visits. */
export async function assertAnnualPlanRenewal(connection, context, now = new Date()) {
  if (context.renewalOfSeriesId == null) return null;
  const sourceSeriesId = id(context.renewalOfSeriesId);
  // All booking creation holds this same lock; series and renewal links are
  // immutable, so they do not need UPDATE privileges merely to lock a read.
  const [[owner]] = await connection.execute('SELECT user_id AS userId FROM customer WHERE customer_id=? FOR UPDATE', [context.customerId]);
  if (!owner) throw new HttpError(404, 'Customer profile not found.');
  const [plan] = await readPlans(connection, owner.userId, { seriesId: sourceSeriesId, now });
  if (!plan) throw new HttpError(404, 'Annual plan not found.');
  if (!context.packageId) throw new HttpError(400, 'Choose an annual cleaning plan to renew.');
  const [[catalog]] = await connection.execute("SELECT package_id FROM simple_package_catalog WHERE package_id=? AND code='annual-cleaning'", [context.packageId]);
  if (!catalog) throw new HttpError(400, 'Choose an annual cleaning plan to renew.');
  // A current locking read also handles a caller that established an earlier
  // repeatable-read snapshot before acquiring the customer lock. FOR SHARE
  // needs only SELECT and avoids granting UPDATE on immutable history.
  const [[renewed]] = await connection.execute('SELECT renewed_series_id FROM annual_plan_renewal WHERE source_series_id=? FOR SHARE', [sourceSeriesId]);
  if (renewed) throw new HttpError(409, 'This plan has already been renewed. Open My Plans to view the existing renewal.');
  if (!plan.canRenew) throw new HttpError(409, plan.status === 'Cancelled'
    ? 'This cancelled plan cannot be renewed. Start a new annual booking.'
    : `Renewal opens on ${plan.renewalOpenDate}.`);
  if (context.preferredDate < plan.minimumFirstDate) throw new HttpError(400, `Your renewed plan must start on or after ${plan.minimumFirstDate}, after the current plan's final quarterly window.`);
  return sourceSeriesId;
}

export async function linkAnnualPlanRenewal(connection, sourceSeriesId, renewedSeriesId, now = new Date(), expectedOffer) {
  if (sourceSeriesId == null) return;
  // Read current rows under locks, not the transaction's earlier snapshot: a
  // reschedule, completion or cancellation must not leave a stale offer valid.
  let visits;
  try {
    [visits] = await connection.execute(`SELECT v.visit_number AS visitNumber,
      b.preferred_service_date AS preferredDate,b.slot_start AS slotStart,b.booking_status AS status
      FROM annual_booking_visit v JOIN booking b ON b.booking_id=v.booking_id
      WHERE v.series_id=? ORDER BY v.visit_number FOR SHARE NOWAIT`, [id(sourceSeriesId)]);
  } catch (error) {
    // Booking creation already owns the customer lock. A simultaneous service
    // completion can own a source booking while creating that customer's first
    // wallet. Do not wait in the opposite lock order: roll back and retry safely.
    if (error.code === 'ER_LOCK_NOWAIT') throw new HttpError(409, 'A service or schedule update is in progress. Refresh My Plans and retry your renewal.');
    throw error;
  }
  const finalVisit = visits.find(visit => Number(visit.visitNumber) === 4);
  const deadline = finalVisit?.slotStart ? appointmentInstant(finalVisit.preferredDate, finalVisit.slotStart) : null;
  const eligible = deadline > now && preServiceStatuses.has(finalVisit?.status)
    && visits.some(visit => !inactiveStatuses.has(visit.status));
  if (expectedOffer && (!eligible || expectedOffer.points !== EARLY_RENEWAL_POINTS
    || new Date(expectedOffer.deadline).getTime() !== deadline?.getTime())) {
    throw new HttpError(409, 'The early renewal offer changed. Refresh the renewal offer and review it before confirming. No booking has been created.');
  }
  await connection.execute('INSERT INTO annual_plan_renewal(source_series_id,renewed_series_id) VALUES (?,?)', [id(sourceSeriesId), id(renewedSeriesId)]);
  if (eligible) {
    await connection.execute(`INSERT INTO annual_renewal_bonus(renewed_series_id,source_series_id,points,deadline_at)
      VALUES (?,?,?,?)`, [id(renewedSeriesId), id(sourceSeriesId), EARLY_RENEWAL_POINTS, deadline.toISOString().slice(0, 19).replace('T', ' ')]);
  }
}

export async function dismissAnnualPlanNotice(executor, userId, seriesId, noticeKey, now = new Date()) {
  const ownedId = id(seriesId);
  if (typeof noticeKey !== 'string' || noticeKey.length > 180) throw new HttpError(400, 'Invalid plan reminder.');
  const [plan] = await readPlans(executor, userId, { seriesId: ownedId, now });
  if (!plan) throw new HttpError(404, 'Annual plan not found.');
  if (!annualPlanReminders([plan], now).some(reminder => reminder.key === noticeKey)) {
    throw new HttpError(409, 'This reminder has changed. Refresh My Plans.');
  }
  await executor.execute('INSERT IGNORE INTO annual_plan_notice(series_id,user_id,notice_key) VALUES (?,?,?)', [ownedId, userId, noticeKey]);
  return { success: true };
}

/** Mount after the existing customer session/role middleware; app CSRF remains enforced. */
export function registerAnnualPlanRoutes(app, pool) {
  app.get('/plans', asyncRoute(async (req, res) => {
    res.set('Cache-Control', 'private, no-store');
    res.json(await listAnnualPlans(pool, req.customerUser.id));
  }));
  app.get('/plans/:id/renewal', asyncRoute(async (req, res) => {
    res.set('Cache-Control', 'private, no-store');
    res.json(await getAnnualPlanRenewal(pool, req.customerUser.id, req.params.id));
  }));
  app.post('/plans/:id/notices/read', asyncRoute(async (req, res) =>
    res.json(await dismissAnnualPlanNotice(pool, req.customerUser.id, req.params.id, req.body.noticeKey))));
}
