# Completion rewards and service-value reports

The Admin **Reports & Analytics** and **Customer Rewards** pages use real MySQL
records. Customers access **My Rewards** from customer navigation. The website
has no payment, collection or refund workflow. Completing an order awards
loyalty points automatically; an administrator does not have to record a receipt.

The document keeps its existing filename so previously shared links continue to
work. Older payment records and audit tables remain in the database as inactive
history. They are not deleted, do not drive new rewards, and are not exposed
through active payment pages or APIs.

## Earning points when an order is completed

Default rules: one point per SGD 1 of the completed order's service amount, and
100 points for a SGD 5 reward discount. Admin can change the rules with a reason;
version history preserves the actor and configuration.

The earning basis is the booking's recorded service amount plus technician-set
additional fees, minus its applied reward discount. Points are rounded down to a
whole number once per booking. For example, a completed SGD 150 service with a
SGD 5 reward discount earns 145 points under the default rule. The earning does
not assert that money was collected.

Both **End service** and **Submit report & complete** run the completion rule
inside the existing transaction that changes the booking to Completed. The
booking, wallet, applied discount and earning record therefore succeed or roll
back together. The saved per-booking completion record freezes the earning
basis and rule version. Identical retries, later report submissions or edits,
and another completed return visit for that booking cannot award points twice.
Migration 33 also preserves the base service and additional-fee breakdown for
new completions. Booking cards, booking detail, rewards and analytics share
`server/booking-amounts.mjs`: pending orders include reserved discounts, while
completed orders use the recorded completion snapshot. Admin order lists and
details expose the same `amounts` summary without changing the legacy
`totalAmount` base-price field. Earlier snapshots without
a reliable base/extra split show their recorded total rather than reconstructing
an invented breakdown. An explicitly unknown completed price remains unknown.
Technicians cannot change repair extras after order completion through the API.
A return request which leaves an order awaiting further service is not a
Completed order and does not earn points yet.

Each quarterly booking in an annual plan earns once from its own allocated
visit value. The full annual price is not awarded on every visit, and the
technician's return visit does not create another quarterly entitlement.

Only completion events after this change take effect are eligible. Migration
and application startup do not award points to historical Completed orders.
Existing balances, prior transactions and administrative corrections remain
unchanged. Unknown historical service prices must not be replaced with an
invented earning amount. If a newly completed booking still has no recorded
price, service completion succeeds, the reward outcome is saved as **Unknown
price**, and no points are invented. Admin can make a documented points
adjustment when the missing amount is resolved.

## Reservations and administrative adjustments

Customers can reserve whole redemption blocks against their own eligible,
priced, unfinished bookings. The wallet balance is the points ledger total;
available points are `max(0, balance - active reservations)`. Booking and wallet
locks serialize simultaneous spending across different bookings. The
reservation stores its rule version, points and discount.

A customer can change or release an unused reservation before the order is
completed. At completion, the accepted reservation is consumed once and the net
service amount determines the new earning. Cancellation, rejection and expiry
release unused reservations in the existing booking transaction. A completed
order cannot acquire a new discount after its reward has been calculated.

Rewards can cover the full service amount. A fully discounted order earns zero
new points because its net service value is zero. If an administrative adjustment
or a changed service price makes the original reservation unusable, completion
reduces it to affordable whole redemption blocks while preserving points reserved
for other bookings. Any reduction or release records its reason in the points
history, including a zero-point audit entry. A points shortage does not prevent
the technician from finishing the service.

Admin can make a positive or negative points adjustment with a required reason
and append-only audit. Historical balances, including any existing negative
balance, are retained; available points never display a negative spendable
amount. Corrections use the points ledger rather than a receipt or refund form.

## Reports

Filters accept a date range of up to 367 days, a service and/or a technician.
The selector groups current and historical services without removing old
records. **Annual Cleaning Bundle** filters actual annual-visit links via
`serviceGroup=annual`; standalone Cleaning is excluded. Choose either this group
or a `serviceId`, not both. CSV export uses the same applied filters and includes
their human-readable labels.
Order metrics use scheduled service dates and count each booking once,
including combined Cleaning + Repair orders. A technician filter selects orders
assigned to them or with a recorded visit by them. Service-value and parts
figures remain whole-order totals, not earnings attributed to that technician.

Started report records are counted separately as visits. Technician-specific
visit counts use captured visit ownership, not a later reassignment. Historical
missing visit records are not invented. Return requests remain attached to the
original order; quarterly bundle usage counts the original entitlements rather
than return visits.

The monetary figures describe completed service value, reward discounts and net
service value after those discounts. The daily series uses scheduled service
dates, the same cohort as the order totals.
They do not describe receipts, refunds, money received, outstanding payments or
revenue collected. No historical payment is inferred from a completed booking.
Work-order parts figures use Singapore stock-movement dates and distinguish
issues from returned parts. Charts have equivalent accessible tables. CSV
exports escape quotes and neutralise spreadsheet formula prefixes, including
text with leading whitespace.

## Pages, API and persistence

Admin pages are `/admin/reports` and `/admin/rewards`. The old
`/admin/payments` page redirects to `/admin/rewards`; its payment forms are gone.
Customer points remain at `/customer/rewards`.

All order labels, including points activity, reward reservations and report CSV
exports, use `BK-{creation year}-{booking ID padded to at least four digits}`.
The server supplies `bookingReference` alongside the unchanged numeric `bookingId`.
The year comes from the booking, never the points transaction or service date.
Account adjustments without a booking continue to show `Account`.

Active API routes remain under `/api/commerce` for compatibility. Existing
session authentication and global CSRF protection apply, and the module reloads
the active user's role from MySQL. Responses are private/no-store. Customer
ownership is enforced on every reservation.

| Method | Route after `/api/commerce` | Purpose |
| --- | --- | --- |
| GET | `/admin/reports?from=YYYY-MM-DD&to=YYYY-MM-DD` | Operational counts, service values and source rows; optional `serviceId` or `serviceGroup=annual`, plus `technicianId` |
| GET | `/admin/reports.csv` with the same filters | CSV export |
| GET | `/admin/rewards` | Customer rewards management and rule history |
| GET | `/admin/rewards/:customerId` | Customer wallet, bookings, reservations and points history |
| POST | `/admin/rewards/:customerId/adjust` | `requestId`, signed non-zero `points`, `reason` |
| PATCH | `/admin/reward-rules` | `requestId`, `expectedVersion`, `pointsPerDollar`, `redemptionPoints`, `redemptionValue`, `reason` |
| GET | `/customer/rewards` | Signed-in customer's wallet, eligible bookings and points history |
| POST | `/customer/rewards/:bookingId` | `requestId`, `points`; zero releases an unused reservation |

There are no active receipt/refund endpoints. The previous admin payments GET
and POST endpoints return HTTP 410 (retired), rather than acting as alternative
reward APIs.
Every remaining customer/admin mutation takes a UUID request ID; identical
retries recover the original result without repeating ledger operations. Rule
edits also require the current version. Completion earning is invoked by the
server's authorized service-completion transaction, not a browser-accessible
"award points" endpoint.

Apply the normal `npm run db:up` migration flow before starting the updated API.
Migration `30-completion-rewards.sql` adds `booking_completion_reward`, keyed by
booking, to record gross/discount/net service values, earned and redeemed points,
the rule version, outcome and reason. Historical/legacy-reward markers prevent
old completed or already rewarded bookings from earning again. The helper
`awardCompletedBookingRewards(connection, bookingId)` runs only inside an
authorized completion transaction after the booking status changes.

Migrations preserve existing orders, wallets and historical financial audits;
they do not recreate payment operations or backfill completion points. Demo
login and local Mailpit remain unchanged for local development.
