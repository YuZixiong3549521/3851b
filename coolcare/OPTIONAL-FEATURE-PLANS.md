# Annual maintenance plans

`/customer/plans` lists the signed-in customer's annual booking series. It uses the four existing `annual_booking_visit` rows as the entitlement record; it does not revive Membership or copy balances into the legacy subscription tables.

Each plan displays its original price and property snapshot, address, AC count, annual term, quarterly bookings, completed count, open count and closed-without-completion count. A return visit remains attached to the original quarterly booking and never consumes another entitlement. Cancelled, rejected and expired bookings do not count as completed.

Plan state is derived on each read from the current bookings and Singapore date. Four completed quarterly bookings mean Completed. Four closed, unused bookings mean Cancelled (all-expired means Expired). At the end of the final quarter, an unfinished ordinary plan is Expired; an ongoing service or return obligation stays visible as Active until resolved. Individual changes and cancellations use the existing booking detail flow, retaining ownership, 72-hour notice, quarterly windows and service-start restrictions.

## Renewal and reminders

There is no automatic charging or automatic renewal. Renewal opens 60 days before the final quarterly window ends, or after all four visits are complete. The customer opens `/customer/book?renewPlan=<seriesId>`, reviews the latest catalogue price, property type and all four dates, then submits normally. The new first visit must be on or after the prior term's end and obey the existing minimum 14 days / weekday rule.

The booking transaction validates ownership under the same customer row lock used by every booking creation. The original series and its renewal link are immutable and need no update privileges. `annual_plan_renewal` links the reviewed new series to its source with unique keys. The ordinary booking request ID handles retries; a second request ID cannot create another renewal of the same plan. Customers are directed to their existing renewed plan instead.

Reminders are in-app on My Plans, generated from current persisted data when the page loads and on its normal focus/minute refresh: next quarterly appointment within seven days, and renewal eligibility. Acknowledgement is stored in `annual_plan_notice`; changing the appointment produces a new reminder key. No external email is sent by this feature.

## API

All endpoints mount after existing customer session/role middleware. Mutations use the application's CSRF protection.

- `GET /api/customer/plans`: owned plans, summary and unread reminders.
- `GET /api/customer/plans/:id/renewal`: current-price booking prefill, or `existingRenewalSeriesId`. Read-only.
- `POST /api/customer/plans/:id/notices/read`: `{noticeKey}`; validates the owned current reminder and is idempotent.
- Standard booking creation accepts optional `renewalOfSeriesId` and applies renewal validation and linkage within its existing transaction.

Migration `28-annual-plans.sql` only adds renewal links and notice acknowledgements. Existing bookings, prices, reports and subscription history are retained.
