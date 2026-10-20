# Collections, rewards and operational reports

The Admin **Reports & analytics** and **Payments & rewards** pages use real MySQL
records. Customers access **My Rewards** from the customer navigation. No payment
provider or card information is required: Admin records money actually received
offline, and the application stores the receipt or refund with its actor, date,
method, reference and explanation. No historical receipt is inferred from an
existing booking price. The migration preserves all existing orders and points.

## Settlement

- A receipt can be recorded only when the booking is Completed. The amount may
  not exceed the current booking quote plus technician extras, less an applied
  or reserved reward and existing net payments. Unknown legacy prices cannot be
  collected through this screen.
- Partial receipts are supported. Refunds cannot exceed the recorded net cash
  received. Both are immutable; a correction uses a refund and a new receipt,
  never an overwritten ledger entry.
- Each quarterly bundle booking has its own settlement. Return visits remain on
  their original booking and do not create a second invoice or duplicate earning.
- Changing a technician's quote changes the outstanding balance, not recorded
  cash. Overpayment following a quote reduction is visible and is corrected
  through an actual refund.
- Payment dates are calendar dates in Singapore, may not be in the future, and
  must reflect the actual receipt/refund date. Record creation timestamps are
  preserved separately.

## Reward accounting

Initial rules are one point per SGD 1 actually paid for completed service, and
100 points for a SGD 5 discount. Admin can save a new rule version with a reason;
rule history preserves the actor and before/after configuration.

The earning rate is fixed by a booking's first receipt. Earning is calculated on
the cumulative net amount received for that booking, rounded down once. Splitting
one payment into several smaller receipts cannot increase points. Refunding
money recalculates that target and adds a reversing transaction. If the customer
has already spent the points, their balance may become negative. Available
points never go below zero; later earnings clear the debt before they are
spendable. Administrators can make an audited positive or negative adjustment
with a required reason.

Customers can reserve whole redemption blocks against their own unpaid, priced,
non-cancelled bookings before the first receipt. The balance is the ledger total;
available points equal `max(0, balance - active reservations)`. Booking then wallet
locks serialize simultaneous spending across bookings. A reservation stores its
original rule version and discount. Customers can replace/release it before
payment. Cancellation, rejection and expiry release unused reservations inside
the existing booking transaction.

The discount must be less than the service total (at least SGD 0.01 remains
payable). At the first actual receipt, reserved points are deducted once and the
reservation becomes Redeemed. This implementation does not create artificial
zero-dollar receipts. Applied discounts are not cash: a cash refund reverses
earning but does not automatically return redeemed discount points. A justified
points correction can be recorded by Admin with its audit reason. If a refund or
adjustment leaves insufficient points to honour another reservation, payment is
blocked until that reservation is reduced or released.

## Reports

Filters accept a date range of at most 367 days, a service and/or a technician.
Order metrics use scheduled service dates and count one booking once, including
combined services. A technician filter selects orders assigned to them or with a
recorded visit by them; money and parts remain whole-order totals and are not
attributed individual earnings. Started report records are counted separately as visits;
historical missing visit records are not invented. Return requests are counted
against the original order. Completed quoted service value is before rewards
and is explicitly separate from cash receipts, refunds and net received.

Cash totals use actual payment dates. Work-order part movements use Singapore
stock-movement dates and distinguish issues from returned parts. Bundle usage
counts the original quarterly entitlements, not return visits. The chart has an
equivalent accessible data table. CSV exports escape quotes and neutralise
spreadsheet formula prefixes, including text with leading whitespace.

## API and persistence

All routes are under `/api/commerce`. Existing session authentication and global
CSRF apply; the module also reloads the active user's role from MySQL. Responses
are private/no-store. Customer ownership is enforced on every reservation.

| Method | Route after `/api/commerce` | Purpose |
| --- | --- | --- |
| GET | `/admin/reports?from=YYYY-MM-DD&to=YYYY-MM-DD&serviceId=&technicianId=` | Operational aggregates and source rows |
| GET | `/admin/reports.csv` with the same non-empty filter parameters | CSV export |
| GET | `/admin/payments` | Latest 1,000 bookings, latest 200 ledger records, customers and rule history |
| POST | `/admin/payments/:bookingId` | Receipt/refund: `requestId`, `kind`, `amount`, `method`, `receivedDate`, `reference`, `notes` |
| GET | `/admin/rewards/:customerId` | Customer points, reservations, payments and history |
| POST | `/admin/rewards/:customerId/adjust` | `requestId`, signed non-zero `points`, `reason` |
| PATCH | `/admin/reward-rules` | `requestId`, `expectedVersion`, `pointsPerDollar`, `redemptionPoints`, `redemptionValue`, `reason` |
| GET | `/customer/rewards` | Signed-in customer's wallet, eligible bookings and history |
| POST | `/customer/rewards/:bookingId` | `requestId`, `points`; zero releases an unused reservation |

Every mutation takes a UUID request ID. Identical retries return the original
result without repeating the ledger operation; a changed payload or actor using
the same ID receives a conflict. Rule edits also require the current version.
Migration `27-commerce-rewards.sql` adds payment, operation, rule/audit,
reservation, per-booking earning and adjustment-audit tables; it reuses
`loyalty_account` and `loyalty_transaction`.
