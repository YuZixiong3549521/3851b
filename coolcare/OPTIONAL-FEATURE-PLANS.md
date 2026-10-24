# Annual maintenance plans

`/customer/plans` lists the signed-in customer's annual booking series. It uses the four existing `annual_booking_visit` rows as the entitlement record; it does not revive Membership or copy balances into the legacy subscription tables.

Each plan displays its original price and property snapshot, address, AC count, annual term, quarterly bookings, completed count, open count and closed-without-completion count. A return visit remains attached to the original quarterly booking and never consumes another entitlement. Cancelled, rejected and expired bookings do not count as completed.

Plan state is derived on each read from the current bookings and Singapore date. Four completed quarterly bookings mean Completed. Four closed, unused bookings mean Cancelled (all-expired means Expired). At the end of the final quarter, an unfinished ordinary plan is Expired; an ongoing service or return obligation stays visible as Active until resolved. Individual changes and cancellations use the existing booking detail flow, retaining ownership, 72-hour notice, quarterly windows and service-start restrictions.

## Confirmation and retained visits

The first quarterly booking uses the normal confirmation deadline (48 hours by default). Visits 2–4 reserve their quarterly dates and capacity with `expires_at=NULL`; they still require individual administrator confirmation and dispatch. A customer rescheduling one of these subsequent visits retains that no-expiry policy. A later visit is not a fresh purchase and must not expire two days after the annual plan is requested.

Cancellation, rejection or expiry is scoped to the affected visit, including visit 1. Other quarterly bookings, their price snapshots and the annual series are preserved. My Plans explicitly identifies closed visits alongside the remaining reservations and links each booking for management. There is no automatic replacement of closed visits and no automatic cancellation of the whole series.

Migration `31-annual-confirmation.sql` removes incorrect deadlines only from future Submitted visits 2–4. It does not reopen Expired, Cancelled or Rejected bookings, change past bookings or alter contract snapshots. The expiry worker and mutation guard also exclude subsequent annual visits with legacy deadlines. An administrator can still reject or a customer can still cancel an individual reservation under the existing rules.

## Renewal and reminders

There is no automatic charging or automatic renewal. Renewal opens 60 days before the final scheduled quarterly visit, or after all four visits are complete. This lets the customer renew before the final visit instead of waiting until its quarterly window ends. The customer opens `/customer/book?renewPlan=<seriesId>`, reviews the latest catalogue price, property type and all four dates, then submits normally. The new first visit must be on or after the prior term's end and obey the existing minimum 14 days / weekday rule.

An early renewal submitted strictly before the last scheduled visit starts earns **100 bonus points after the new plan's first quarterly booking completes**. My Plans and the renewal form show the exact deadline in English/Singapore time. The source final visit must still be awaiting its first service; completed, in-progress, closed and return visits do not qualify. The booking transaction re-reads source bookings under shared locks, so a concurrent reschedule or service update cannot leave an old offer valid. Migration `34-early-renewal-rewards.sql` stores the accepted points and deadline as an immutable offer snapshot. Later source schedule changes do not rewrite an accepted offer.

My Plans previews the 100-point promotion and deadline even before the renewal window opens, with its opening date. The new booking form sends `expectedRenewalOffer: {points, deadline}` when it displays an eligible bonus. If the source appointment or offer eligibility changes, the server returns 409 and rolls back the new booking; the form requires refreshing and reviewing the offer before confirming again. Older clients may omit this optional field and retain the original renewal contract. Source locks use NOWAIT and return a retryable 409 during simultaneous service updates rather than waiting in the opposite customer/booking lock order.

The bonus is a separate ledger entry from normal completion points. It is awarded inside the same transaction as completion, once for renewed visit 1; a retry, report edit or return visit cannot repeat it. A cancelled, rejected or expired first renewed booking earns no bonus, and later quarterly completions do not transfer that reward to another visit. Existing renewals and historical completed orders are not backfilled. My Plans shows pending, awarded or ineligible status; the rewards ledger explains the bonus when awarded. This is a fixed 100-point offer, whose cash-equivalent discount depends on the current redemption rules.

The website has no payment or receipt-entry workflow. Each quarterly booking can earn completion rewards once, based on that visit's allocated service amount plus technician extras and less any applied reward discount. Return visits and report edits do not create another reward for the same booking. Historical Completed bookings are not backfilled. See [COMMERCE-REWARDS.md](COMMERCE-REWARDS.md).

The booking transaction validates ownership under the same customer row lock used by every booking creation. The original series and its renewal link are immutable and need no update privileges. `annual_plan_renewal` links the reviewed new series to its source with unique keys. The ordinary booking request ID handles retries; a second request ID cannot create another renewal of the same plan. Customers are directed to their existing renewed plan instead.

Reminders are in-app on My Plans, generated from current persisted data when the page loads and on its normal focus/minute refresh: next quarterly appointment within seven days, and renewal eligibility. Acknowledgement is stored in `annual_plan_notice`; changing the appointment produces a new reminder key. No external email is sent by this feature.

## API

All endpoints mount after existing customer session/role middleware. Mutations use the application's CSRF protection.

- `GET /api/customer/plans`: owned plans, summary and unread reminders.
- `GET /api/customer/plans/:id/renewal`: current-price booking prefill, or `existingRenewalSeriesId`. Read-only.
- `POST /api/customer/plans/:id/notices/read`: `{noticeKey}`; validates the owned current reminder and is idempotent.
- Standard booking creation accepts optional `renewalOfSeriesId` and applies renewal validation and linkage within its existing transaction.
- `GET /api/commerce/admin/plans`: authenticated Admin/Owner view of all yearly packages, customer details, quarterly bookings, usage, original annual value, renewal links and bonus status. The `/admin/plans` page supports customer/address searches, status filtering and direct order links. It is read-only; booking changes use their existing guarded order workflows.

Migration `28-annual-plans.sql` adds renewal links and notice acknowledgements. Migration `34-early-renewal-rewards.sql` adds future early-renewal offer/award records. Existing bookings, prices, reports and subscription history are retained.
