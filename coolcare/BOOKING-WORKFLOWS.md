# Booking, annual cleaning, inventory and mail workflows

## Booking rules

- New appointments and self-service reschedules must be at least **14 calendar days after today's date in Asia/Singapore**, and service dates must be **Monday through Friday**. Saturday and Sunday are closed. The 14th day is eligible when it is a weekday; otherwise the earliest date is the following Monday. Both creation APIs and rescheduling enforce this on the server as well as in the UI.
- Each customer can have at most **two non-cancelled bookings for the same service address in any consecutive seven calendar days**, measured using preferred service dates. This is not a requirement to book seven days in advance and is not a limit of two bookings across the whole system.
- The server checks both creation APIs and rescheduling. Formatting differences in an address are normalized; distinct apartment/unit identifiers must remain distinguishable. All creation and rescheduling requests for a customer serialize behind a database row lock, so simultaneous requests cannot bypass the limit.
- Existing records remain intact, including any historical records that exceed the new policy. Cancelling an eligible request frees its place in the limit.
- Both My Bookings pages show active requests, including Confirmed, Assigned and unfinished requests whose scheduled date has passed. Completed, Rejected and Cancelled records remain accessible under Booking History (`/customer/history`); rejection reasons and completed service reports remain available. List APIs retain historical records for compatibility.
- Registered, signed-in customers choose exactly one of **Cleaning**, **Repair** and **Annual Cleaning Bundle**. The public booking dialog, customer booking page and assistant share this selection model. New requests cannot use retired services, memberships or old multi-service selections to bypass it.
- Prices come from the database. Each booking stores service and price snapshots; historical single-service and multi-service orders remain readable. Current prices and the Singapore market references used to choose them are documented in [SERVICE-PRICING.md](SERVICE-PRICING.md).
- Submitted, Confirmed, Assigned, On The Way and In Progress bookings reserve team capacity. Rejected, Cancelled and Completed bookings release it. The four standard time windows remain unchanged; availability responses expose only `available`, never staff counts.
- Customer submission and rescheduling lock each affected service date and repeat the capacity check inside the write transaction. Annual bundles lock and reserve all four visit dates atomically, so one full date rolls back the whole series. A current locking read prevents two concurrent transactions from both taking the final team place.

## Saved customer assistant API

The button-guided assistant is available only after customer sign-in. These endpoints live under `/api/customer/assistant`, use the existing session and CSRF middleware, and access only the signed-in customer's records. Migration `12-customer-assistant.sql` adds `assistant_booking_draft`; apply it with the existing `npm run db:up` flow. Existing bookings and older creation APIs are preserved.

| Endpoint | Request and behavior |
| --- | --- |
| `GET /draft` | Returns `{ state: null }` until the first save, otherwise the current account-owned state. Does not create a row. |
| `PUT /draft` | `{ expectedUserId, draftId, revision, draft }`; use `null` and `0` only for the first save. Allows incomplete drafts; saves serialize behind the customer lock. |
| `POST /review` | `{ expectedUserId, draftId, revision }`; validates phone, address, service and every visit, then stores a current quote. |
| `POST /confirm` | The review identity plus `quoteId`; rechecks schedule and locked catalogue terms, creates the order(s) and receipt in one transaction. |
| `POST /new` | Current identity and revision; explicitly archives the current draft and creates an empty one. Stale tabs cannot reset a newer draft. |

The `draft` fields are `step`, `serviceId` or `packageId`, `numberOfUnits`, `serviceAddress`, `phone`, `preferredDate`, `timeWindow` and `notes`. `state` includes `draftId`, `userId`, `revision`, `status` (`editing`, `reviewed`, `completed`), `requestId`, `draft`, `quote`, `booking` and `updatedAt`. A quote includes `quoteId`, SGD total, service name and every visit's number, date and amount. The receipt uses the existing confirmed-booking shape and actual booking ID.

Revision conflicts return HTTP 409 with `code: "DRAFT_CONFLICT"` and the current state. Schedule conflicts use `SCHEDULE_CONFLICT` and `details.conflicts` containing visit numbers, dates and messages. Format errors use `VALIDATION_ERROR` with `details.fieldErrors`. If catalogue terms changed after review, confirmation returns 409 `REVIEW_REQUIRED`, commits the updated quote, and creates no order until the customer confirms again. These checks include later annual visits, not only the first date.

The browser reconciles uncertain saves and confirmations before sending new changes. Completed confirmations recover the same persisted receipt before stale-revision or lead-time validation, including after that draft has been archived. Archived unfinished drafts cannot create bookings. The durable receipt, bookings, price snapshots and email queue commit together; a failure rolls the transaction back. Draft data is kept on the server under customer ownership, not in browser localStorage. No external language model or chat-history access is involved.

## Customer addresses and upcoming bookings

The customer booking page accepts a typed service address and an AC count of 1–10. Customers do not need to select registered equipment. The count determines prices and the work order's unit/part allowance; server-side booking records retain the unit links required by existing technician workflows.

**Add new address** saves an address to the signed-in customer through `POST /api/customer/addresses`. The JSON body contains `addressLine`, optional `label` and six-digit Singapore `postalCode`, and optional `expectedUserId` for account-change detection. The response contains `{ address: { addressId, label, addressLine, postalCode, isDefault } }`. Saving does not create a booking or require any existing AC units. Normalized duplicates return the customer's existing address, including safe retries, without rewriting addresses linked to historical orders. Authentication, CSRF and customer ownership are enforced.

`POST /api/customer/bookings` additionally accepts `serviceAddress` and `numberOfUnits`, alongside the existing service/package, preferred date, `timeSlot`, notes and request ID fields. An optional saved `addressId` must belong to the customer and match the submitted address. The previous `addressId`/`unitIds` payload remains compatible. Both forms use the same transactional booking, pricing, schedule, address quota and request-id protections.

Dashboard UPCOMING uses the nearest appointment start at or after the current Singapore time, excluding completed, cancelled and already-started bookings. The count and card use the same sorted set, refreshed on minute changes and when returning to the page. Older unfinished requests remain available in My Bookings under Active.

## Customer self-service API

All endpoints below are under `/api/customer`, require a customer session, and enforce record ownership. Mutations also require the existing CSRF token.

| Endpoint | Behavior |
| --- | --- |
| `GET /bookings/:id` | Booking plus chronological `statusTimeline`, `addressId`, `numberOfUnits` and `canModify`. |
| `PATCH /bookings/:id/reschedule` | `{ preferredDate, timeWindow }`; applies the same notice, weekday, quarterly-window and address quota rules as the existing public endpoint. |
| `PATCH /bookings/:id/status` | `{ status: "Cancelled" }`; only an unassigned Submitted visit can first be cancelled. |
| `GET /booking-availability` | `serviceAddress` and/or owned `addressId`, `from`, `to` (maximum 62 days), optional owned `excludeBookingId`; returns blocked dates, nearby existing bookings, earliest date and Singapore timezone. Advisory only. |
| `GET /slot-availability` | Comma-separated `dates` (one to four calendar dates); returns the four standard slots with an `available` boolean. Dashboard booking, rescheduling and the assistant share this advisory endpoint; the write transaction remains authoritative. |
| `PATCH /profile` | `{ fullName, phone }`; sign-in email remains read-only. |
| `PATCH /addresses/:id` | Same address fields as creation; safely preserves historical locations. |
| `PATCH /addresses/:id/default` | Makes an active owned address the default. |
| `DELETE /addresses/:id` | Archives the address, preserving existing orders and equipment. |
| `GET /bookings/:id/photos/:photoId` | Streams an existing photo only after booking/photo ownership checks. |

Identical cancellation/rescheduling retries return success without duplicate history entries; ownership is checked first and other changes to assigned/completed visits remain prohibited. After an uncertain network failure, the UI locks the exact pending change and offers to retry it. Address edits and booking writers serialize on the customer row. Editing the physical address or postal code of a location referenced by an order creates a replacement and archives the previous address. Migration `11-customer-address-management.sql` adds archive metadata and the replacement link so exact retries recover the same replacement. Defaults are reassigned when necessary; migrations never clear existing records.

Customer detail timelines and report timestamps use explicit UTC ISO values from MySQL `TIMESTAMP` data. The UI renders these in English in Asia/Singapore. Service dates are calendar dates and are not shifted by the browser timezone.

Report responses include `durationMinutes`, `partsUsed` and each photo's nullable `photoUrl`. Duration is calculated only from recorded job start/end times; parts use comes from actual net stock issues. Private files belong under `coolcare/.local/service-photos/`, with relative paths recorded in `photo.photo_url`; only supported raster image extensions are served. Absolute/external paths, traversal and directory-link escapes are rejected. Missing legacy files produce `photoUrl: null`; a filename alone is not shown as real photo evidence. This adds secure reading and print/PDF styles, not a new technician upload workflow.

## Annual cleaning and historical packages

The active catalogue has two service records and exactly one annual bundle. `simple_service_catalog` and `simple_package_catalog` identify these entries without renaming old services or rewriting old orders. `maintenance_package`, `package_service`, `web_package_details` and `web_service_pricing` hold the current price configuration; `booking_service` and `booking_package` preserve snapshots.

An annual request creates one `annual_booking_series` and four linked `annual_booking_visit`/`booking` records for the same customer, address and selected units. Dates are based on the first preferred date, at offsets of 0, 3, 6 and 9 months. Calendar dates clamp to the last day of the target month when needed; a subsequent visit falling on Saturday or Sunday moves forward to Monday. Each date is computed from the original first-visit anchor, so that shift does not drift later quarters. The original quarterly windows remain unchanged. The confirmation preview and saved dates use the same rule. All four visits, quota checks, price allocations and emails are in one transaction. A stable request ID returns the original series on retry, including after the original date is inside the new lead-time window.

The series stores the annual price; each booking stores only its allocated visit amount. No payment or automatic renewal is created. Visits start as Submitted and require availability confirmation. Each unassigned Submitted visit can be cancelled independently, or rescheduled within its original three-month window. Cancelling one visit does not move other visits or assert that a refund occurred. The original series price stays as an agreed-at-submission estimate, with actual visit statuses shown separately.

Membership selection and new membership redemption are removed. Old package definitions are retired from the active catalogue; existing subscriptions, balances, bookings and reports remain intact for historical reading. Cancelling an eligible historical membership order still restores a previously reserved visit. Migration reruns preserve configured prices and existing series.

## Staff invitations and ownership

Public registration always creates a Customer and does not accept a staff role. The first Owner is created with `npm run staff:bootstrap-owner`; migration assigns the earliest valid Admin as Owner for an existing installation, with Norshida as the realistic-data Owner. A generated unique key ensures there can be only one Owner.

An Owner can invite an Admin. An Owner or Admin can invite a Technician. The invited account remains Inactive until the recipient opens the 48-hour link and sets a password at `/activate`. Invitation records store only a SHA-256 token hash, reject an existing email, can be revoked or reissued, and can be consumed once. Validation and acceptance use `POST /api/public/staff-invitations/validate` and `POST /api/public/staff-invitations/accept`; neither endpoint discloses the stored token.

Only the Owner can view, invite, suspend or reactivate Admin accounts and transfer ownership. Transfer locks both Admin profiles and changes the old Owner and target Active Admin in one transaction, preserving exactly one Owner. Owner/Admin can manage Technician account and availability status. A Technician with a future unfinished assignment must be reassigned before suspension, Unavailable or On Leave can be applied; the operation also refuses a change that would leave any reserved slot above the remaining team capacity.

## Review, dispatch and job status

The booking state machine is `Submitted → Confirmed → Assigned → On The Way → In Progress → Completed`. Approval and dispatch are deliberately separate Admin actions: Orders changes only Submitted to Confirmed; Dispatch accepts only Confirmed and creates the assignment and work order. Rejecting a Submitted booking requires a customer-visible reason and moves it to the distinct Rejected state. Customer cancellation remains Cancelled.

Automatic dispatch considers only Active Technicians whose availability is neither Unavailable nor On Leave and who have no overlapping unfinished work order. It chooses the lowest unfinished-work count on the target date, then the oldest `last_assigned_at`, then technician ID. The transaction locks the booking, service date and technician roster, rechecks conflicts, creates assignment/work order/history, updates the booking to Assigned and advances `last_assigned_at`. A request UUID makes a successful retry return the original result. Before work starts, redispatch cancels the old work order, marks the old assignment Reassigned and creates the replacement atomically.

Admin operations are mounted under `/api/admin`: booking list/detail, `/bookings/:id/approve`, `/reject`, `/dispatch` and `/redispatch`; technician/admin invitations and status; invitation revocation; and `/owner/transfer`. The UI is the unified Admin Console at `/admin/orders`, with Orders, Dispatch, Technicians, Owner-only Admins and Inventory. `/admin/inventory` remains a compatible entry point.

Technicians update only their own work through `PATCH /api/technician/jobs/:jobId/status`. The accepted next state is fixed by the current state, so steps cannot be skipped or repeated. Each transition updates booking, work order, assignment and booking history in one transaction. Completion releases capacity.

## Inventory and technician access

- Each part has a stock unit, recommended quantity per AC and usage note. Recommendations are planning defaults and are editable by an administrator. New catalog parts start with zero stock; actual receiving is recorded through Stock In.
- The recommended quantity for a work order is the number of linked AC units multiplied by that part's standard, rounded up to a whole stock unit. Existing net issues to that work order are counted, so splitting an issue does not hide excess usage.
- Exceeding the recommendation gives a warning and requires acknowledgement; it is not a permanent prohibition. Stock cannot become negative.
- A technician can issue parts only from their own assigned work order. They cannot edit inventory history or receive stock. An administrator can correct Stock In / Stock Out quantities, occurrence time and description.
- Corrections apply only the stock difference and keep an immutable before/after audit record, modifier, modification timestamp and version. Concurrent/stale edits are rejected, and retrying the same correction request does not adjust stock again.
- Technician details show the linked address, recent three completed reports for that address, earlier completed visits in the same annual series and legacy package records, work performed and inventory use. Actual duration is shown only where start/end timestamps were recorded; missing historic timings are not invented.
- A technician can save Regular or Chemical cleaning plus an assessment note on their own active Cleaning work order. `work_order_cleaning_assessment` and its revision table preserve the decision, author, time and version. Stale edits are rejected, retries are idempotent and completed/cancelled jobs are read-only. This records a technical assessment; it does not add a charge or approve extra work on the customer's behalf.

## Transactional emails and the local inbox

Business changes enqueue email events in the same transaction through the generic outbox. Supported messages include staff invitation, order received, order approved, rejection with its reason, and assignment with the Technician name. Existing booking email rows remain compatible. A background worker sends committed messages, records the result and retries transient failures. Delivery failure never rolls back an already committed business operation.

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
