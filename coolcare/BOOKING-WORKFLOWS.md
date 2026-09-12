# Booking, membership, inventory and mail workflows

## Booking rules

- Each customer can have at most **two non-cancelled bookings for the same service address in any consecutive seven calendar days**, measured using preferred service dates. This is not a requirement to book seven days in advance and is not a limit of two bookings across the whole system.
- The server checks both creation APIs and rescheduling. Formatting differences in an address are normalized; distinct apartment/unit identifiers must remain distinguishable. All creation and rescheduling requests for a customer serialize behind a database row lock, so simultaneous requests cannot bypass the limit.
- Existing records remain intact, including any historical records that exceed the new policy. Cancelling an eligible request frees its place in the limit.
- **Build your own** selects multiple services in one booking. **Service bundle** selects a predefined combination. **Use my membership** redeems an existing customer subscription. The public booking dialog, customer booking page and assistant share this selection model.
- Prices come from the database. Each booking stores all service lines and price snapshots; old single-service orders remain readable. Bundle and individual-service prices are configurable demonstration defaults, not externally sourced quotations.

## Packages and memberships

`maintenance_package`, `package_service` and `customer_subscription` remain the core package tables. `web_package_details` separates one-off bundles from memberships and records included units and additional-unit prices. `web_service_pricing` controls customer-visible services and additional-unit pricing. `booking_service` and `booking_package` preserve the actual selection for each order.

A membership belongs to a **customer**, so eligible visits can use that customer's service addresses. The initial usage policy reserves **one visit per confirmed submission**, independent of the number of services included in that visit. It is deducted atomically with the booking and restored once on an eligible cancellation. Selected service dates must fall within the active subscription's dates. There is no new payment or membership purchase system in this change; existing owned subscriptions can be redeemed.

New proposed catalog entries include Essential Care Bundle, Deep Care Bundle and CoolCare Annual Membership. Existing package prices, subscriptions, balances and past bookings are preserved. Migrations may be rerun without recreating records or resetting balances.

## Inventory and technician access

- Each part has a stock unit, recommended quantity per AC and usage note. Recommendations are planning defaults and are editable by an administrator. New catalog parts start with zero stock; actual receiving is recorded through Stock In.
- The recommended quantity for a work order is the number of linked AC units multiplied by that part's standard, rounded up to a whole stock unit. Existing net issues to that work order are counted, so splitting an issue does not hide excess usage.
- Exceeding the recommendation gives a warning and requires acknowledgement; it is not a permanent prohibition. Stock cannot become negative.
- A technician can issue parts only from their own assigned work order. They cannot edit inventory history or receive stock. An administrator can correct Stock In / Stock Out quantities, occurrence time and description.
- Corrections apply only the stock difference and keep an immutable before/after audit record, modifier, modification timestamp and version. Concurrent/stale edits are rejected, and retrying the same correction request does not adjust stock again.
- Technician details show the linked address, recent three completed reports for that address, the customer's prior membership reports, work performed and inventory use. Actual duration is shown only where start/end timestamps were recorded; missing historic timings are not invented.

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
