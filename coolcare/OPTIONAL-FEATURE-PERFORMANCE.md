# Technician performance and visit feedback

Run the normal `npm run db:up` flow to apply migration 29 before restarting the API.
No old performance scores or service reports are deleted. The old
`technician_performance_score` table remains as legacy data and is not silently
converted into customer feedback.

## Pages and access

- Customer: `/customer/feedback` shows only that customer's closed visits and
  accepts one editable 1–5 star rating and optional comment per completed visit.
- Admin: `/admin/performance` shows date-filtered customer ratings, review
  counts, completed visits, return visits and service start records.
- Technician: `/technician/index.html#performance` shows only visits attributed
  to the signed-in technician, including customer stars and comments.

The website no longer exposes Scoring settings, composite scores, administrator
quality scores or quality-assessment editing. The related historical database
records and API contracts remain intact for compatibility; no migration or data
deletion is required. Customer feedback remains editable only by its owner.

All website copy, dates and times use English and Singapore time. Date filters
default to the last 90 calendar days and accept ranges up to 367 days. The period
is based on when a visit ended, and the page shows the currently applied range
separately from pending date-input changes.
The Reviews filter separates customer-rated visits from completed visits awaiting
feedback. Technicians can read the stars and comments for their captured visits,
including archived visits after reassignment, but cannot edit customer reviews.

The Customer dashboard and booking detail reminder asks for a rating after a
visit ends as Completed, even if the service report is still being prepared.
`GET /api/performance/customer/pending-feedback?bookingId=123` returns up to five
owned, unrated completed visits and the total pending count; `bookingId` is optional.
The reminder disappears once feedback is saved. Direct links use
`/customer/feedback?reportId=123`, and the visits API accepts the same `reportId`
to select the owned visit regardless of the default date window. Return-required
and unfinished visits are excluded from rating reminders. No migration is needed.

## Capturing evidence

`performance_visit` is keyed by the individual `service_report.report_id`.
The real Start service transaction captures the assigned technician, the
scheduled service date/time and server-recorded actual start. Completing a visit
or requesting a return captures its end and outcome in the same transaction.
These fields are not rewritten when the work order is rescheduled or assigned to
a different technician. Return visits have independent reports and feedback.

Migration 29 imports only legacy visit snapshots with one unambiguous record per
report. It preserves the historical technician/start/end, and leaves unknown
scheduled time NULL. Legacy combined reports, or reports without a reliable visit
snapshot, are excluded rather than attributed to the current assignment.

Report submission and checklist presence are displayed as counts. Their contents,
return reason and unavailable parts provide context for the service team.
An unrated visit shows "Not yet rated", and does not count as a zero-star review.
The summary table includes the number of reviews beside the customer average.

## Customer ratings and service starts

Customer ratings are shown on their original 1–5 star scale. Their average uses
only submitted ratings, with the sample size displayed alongside it. Completed
visits and visits requiring a return are separate operational counts.

Service start punctuality is the percentage of captured visits starting no later
than the stored grace period after their scheduled start (default 15 minutes).
It measures the recorded service start, **not GPS arrival**. The page explains
the applied grace period and shows how many visits have both timestamps. Missing
timestamps remain unavailable, not zero.

Legacy composite calculations, administrator quality assessments and weight
settings are retained on the server for existing API clients. The current pages
do not show or edit them, and their settings do not alter the customer star
average. Historical assessment and configuration audit entries are preserved.

## API

Mount `createPerformanceRouter(pool)` at `/api/performance` behind the existing
session and CSRF middleware.

| Method | Path | Access |
| --- | --- | --- |
| GET | `/customer/visits?from=YYYY-MM-DD&to=YYYY-MM-DD` | Own customer visits |
| PUT | `/customer/visits/:reportId/feedback` | Owning customer |
| GET | `/admin?from=YYYY-MM-DD&to=YYYY-MM-DD&technicianId=123` | Admin/Owner |
| PUT | `/admin/visits/:reportId/quality` | Admin/Owner, legacy compatibility only; no website control |
| PUT | `/admin/settings` | Admin/Owner, legacy compatibility only; no website control |
| GET | `/technician?from=YYYY-MM-DD&to=YYYY-MM-DD` | Own technician visits |

Every PUT requires `requestId` (UUID) and `expectedVersion`.
Feedback adds `stars`, `comment`; quality adds `score`, `reason`; settings adds
`customerWeight`, `qualityWeight`, `punctualityWeight`, `graceMinutes`, `reason`.
The server serializes writes by report/settings row, returns 409 on stale
versions or reused request IDs with different content, and replays identical
successful requests. Feedback and quality use independent versions. Admins cannot
alter customer feedback through the quality endpoint. Audit rows are append-only.

Application grants: SELECT/INSERT/UPDATE on `performance_visit`,
`performance_feedback`, `performance_quality`, `performance_settings`;
SELECT/INSERT on `performance_operation`. Data stays in MySQL; no browser-local
business state or external scoring service is required.
