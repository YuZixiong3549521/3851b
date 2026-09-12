# Booking, annual cleaning, inventory and mail workflows

## Booking rules

- New appointments and self-service reschedules must be at least **14 calendar days after today's date in Asia/Singapore**, and service dates must be **Monday through Friday**. Saturday and Sunday are closed. The 14th day is eligible when it is a weekday; otherwise the earliest date is the following Monday. Both creation APIs and rescheduling enforce this on the server as well as in the UI.
- Each customer can have at most **two non-cancelled bookings for the same service address in any consecutive seven calendar days**, measured using preferred service dates. This is not a requirement to book seven days in advance and is not a limit of two bookings across the whole system.
- The server checks both creation APIs and rescheduling. Formatting differences in an address are normalized; distinct apartment/unit identifiers must remain distinguishable. All creation and rescheduling requests for a customer serialize behind a database row lock, so simultaneous requests cannot bypass the limit.
- Existing records remain intact, including any historical records that exceed the new policy. Cancelling an eligible request frees its place in the limit.
- Both My Bookings pages show only active requests, including unfinished requests whose scheduled date has passed. Completed and cancelled records remain accessible under Booking History (`/customer/history`); completed service reports remain available. List APIs retain historical records for compatibility.
- Registered, signed-in customers choose exactly one of **Cleaning**, **Repair** and **Annual Cleaning Bundle**. The public booking dialog, customer booking page and assistant share this selection model. New requests cannot use retired services, memberships or old multi-service selections to bypass it.
- Prices come from the database. Each booking stores service and price snapshots; historical single-service and multi-service orders remain readable. Current prices and the Singapore market references used to choose them are documented in [SERVICE-PRICING.md](SERVICE-PRICING.md).

## Customer addresses and upcoming bookings

The customer booking page accepts a typed service address and an AC count of 1–10. Customers do not need to select registered equipment. The count determines prices and the work order's unit/part allowance; server-side booking records retain the unit links required by existing technician workflows.

**Add new address** saves an address to the signed-in customer through `POST /api/customer/addresses`. The JSON body contains `addressLine`, optional `label` and six-digit Singapore `postalCode`, and optional `expectedUserId` for account-change detection. The response contains `{ address: { addressId, label, addressLine, postalCode, isDefault } }`. Saving does not create a booking or require any existing AC units. Normalized duplicates return the customer's existing address, including safe retries, without rewriting addresses linked to historical orders. Authentication, CSRF and customer ownership are enforced.

`POST /api/customer/bookings` additionally accepts `serviceAddress` and `numberOfUnits`, alongside the existing service/package, preferred date, `timeSlot`, notes and request ID fields. An optional saved `addressId` must belong to the customer and match the submitted address. The previous `addressId`/`unitIds` payload remains compatible. Both forms use the same transactional booking, pricing, schedule, address quota and request-id protections.

Dashboard UPCOMING uses the nearest appointment start at or after the current Singapore time, excluding completed, cancelled and already-started bookings. The count and card use the same sorted set, refreshed on minute changes and when returning to the page. Older unfinished requests remain available in My Bookings under Active.

## Annual cleaning and historical packages

The active catalogue has two service records and exactly one annual bundle. `simple_service_catalog` and `simple_package_catalog` identify these entries without renaming old services or rewriting old orders. `maintenance_package`, `package_service`, `web_package_details` and `web_service_pricing` hold the current price configuration; `booking_service` and `booking_package` preserve snapshots.

An annual request creates one `annual_booking_series` and four linked `annual_booking_visit`/`booking` records for the same customer, address and selected units. Dates are based on the first preferred date, at offsets of 0, 3, 6 and 9 months. Calendar dates clamp to the last day of the target month when needed; a subsequent visit falling on Saturday or Sunday moves forward to Monday. Each date is computed from the original first-visit anchor, so that shift does not drift later quarters. The original quarterly windows remain unchanged. The confirmation preview and saved dates use the same rule. All four visits, quota checks, price allocations and emails are in one transaction. A stable request ID returns the original series on retry, including after the original date is inside the new lead-time window.

The series stores the annual price; each booking stores only its allocated visit amount. No payment or automatic renewal is created. Visits start as Submitted and require availability confirmation. Each unassigned Submitted visit can be cancelled independently, or rescheduled within its original three-month window. Cancelling one visit does not move other visits or assert that a refund occurred. The original series price stays as an agreed-at-submission estimate, with actual visit statuses shown separately.

Membership selection and new membership redemption are removed. Old package definitions are retired from the active catalogue; existing subscriptions, balances, bookings and reports remain intact for historical reading. Cancelling an eligible historical membership order still restores a previously reserved visit. Migration reruns preserve configured prices and existing series.

## Inventory and technician access

- Each part has a stock unit, recommended quantity per AC and usage note. Recommendations are planning defaults and are editable by an administrator. New catalog parts start with zero stock; actual receiving is recorded through Stock In.
- The recommended quantity for a work order is the number of linked AC units multiplied by that part's standard, rounded up to a whole stock unit. Existing net issues to that work order are counted, so splitting an issue does not hide excess usage.
- Exceeding the recommendation gives a warning and requires acknowledgement; it is not a permanent prohibition. Stock cannot become negative.
- A technician can issue parts only from their own assigned work order. They cannot edit inventory history or receive stock. An administrator can correct Stock In / Stock Out quantities, occurrence time and description.
- Corrections apply only the stock difference and keep an immutable before/after audit record, modifier, modification timestamp and version. Concurrent/stale edits are rejected, and retrying the same correction request does not adjust stock again.
- Technician details show the linked address, recent three completed reports for that address, earlier completed visits in the same annual series and legacy package records, work performed and inventory use. Actual duration is shown only where start/end timestamps were recorded; missing historic timings are not invented.
- A technician can save Regular or Chemical cleaning plus an assessment note on their own active Cleaning work order. `work_order_cleaning_assessment` and its revision table preserve the decision, author, time and version. Stale edits are rejected, retries are idempotent and completed/cancelled jobs are read-only. This records a technical assessment; it does not add a charge or approve extra work on the customer's behalf.

## Booking emails and the local inbox

New bookings enqueue one email in `booking_email_outbox` in the same database transaction. A background worker sends committed messages, records the result and retries transient failures. An email failure does not delete a saved booking or require the customer to create another order. The recipient comes from the authenticated customer's database account.

Default local mode uses [Mailpit](https://mailpit.axllent.org/docs/install/docker/) at **http://localhost:8025**. It receives real SMTP messages from the application and displays them in a browser. It is a classroom/test inbox: messages addressed to customer accounts are captured locally and **are not delivered to external personal inboxes**. Mailpit data is stored in a separate Docker volume. It has no external forwarding configuration.

Start everything using the existing commands:

```powershell
npm run setup
npm run db:up
npm start
```

The setup process preserves existing credentials and defaults missing `MAIL_MODE` to `local`. SMTP and the test inbox bind only to the local computer. In local mode the display sender is `CoolCare Demo <bookings@coolcare.test>`; this is not a registered public mailbox.

For real delivery, configure a verified sender/provider in the untracked `coolcare/.env.local` and restart the API:

```dotenv
MAIL_MODE=smtp
SMTP_HOST=your-provider-host
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-account
SMTP_PASSWORD=your-provider-password-or-app-password
MAIL_FROM=CoolCare <your-verified-sender@example.com>
```

SMTP mode requires TLS. For an implicit-TLS provider on port 465, set `SMTP_SECURE=true`. Connection settings follow [Nodemailer SMTP](https://nodemailer.com/smtp). Store credentials locally, never in Git. Changing the delivery mode does not forward old local demo emails to external recipients: each queued message retains its original mode.

The outbox tracks Pending / Sending / Sent, attempt count, next attempt, last error code and sent time. A stable Message-ID is reused on retries; SMTP cannot guarantee exactly-once delivery if the connection drops after acceptance. A saved booking is nevertheless idempotent and never duplicated by email retry. Historical orders are not automatically emailed by migration/import.
