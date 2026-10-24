# Technician performance and visit feedback

Run the normal `npm run db:up` flow to apply migration 29 before restarting the API.
No old performance scores or service reports are deleted. The old
`technician_performance_score` table remains as legacy data and is not silently
converted into customer feedback.

## Pages and access

- Customer: `/customer/feedback` shows only that customer's closed visits and
  accepts one editable 1–5 star rating and optional comment per completed visit.
- Admin: `/admin/performance` shows date-filtered summaries, per-technician
  measures, visit details, quality assessments, settings and audit history.
- Technician: `/technician/index.html#performance` shows only visits attributed
  to the signed-in technician, customer feedback and quality assessment reasons.

All website copy, dates and times use English and Singapore time. Date filters
default to the last 90 calendar days and accept ranges up to 367 days.
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
a different technician. Return visits have independent reports and scores.

Migration 29 imports only legacy visit snapshots with one unambiguous record per
report. It preserves the historical technician/start/end, and leaves unknown
scheduled time NULL. Legacy combined reports, or reports without a reliable visit
snapshot, are excluded rather than attributed to the current assignment.

Report submission and checklist presence are displayed as counts. Their contents,
return reason and unavailable parts provide context for an administrator's
assessment. Missing parts, customer rescheduling, extensions and returns do not
automatically subtract points.

## Scoring

Defaults: customer feedback 40%, administrator quality 40%, service start
punctuality 20%. A rating is converted from stars to 100 points (`stars × 20`).
Administrator quality is 0–100 and requires a reason.

Service start punctuality is 100 when service starts no later than 15 minutes
after the captured scheduled start, otherwise 0. It measures the recorded service
start, **not GPS arrival**. The grace period is configurable from 0 to 60 minutes.
No start/schedule evidence means unavailable, not zero.

The headline composite is the average of visits with all three measures, shown
only after at least five fully scored visits. Coverage and each component's
sample size are displayed. Missing components are never silently reweighted.
An administrator can change positive integer weights totaling 100 and the grace
period, with a reason. Current views recalculate under the current settings;
source ratings, assessments and configuration change history stay intact.

## API

Mount `createPerformanceRouter(pool)` at `/api/performance` behind the existing
session and CSRF middleware.

| Method | Path | Access |
| --- | --- | --- |
| GET | `/customer/visits?from=YYYY-MM-DD&to=YYYY-MM-DD` | Own customer visits |
| PUT | `/customer/visits/:reportId/feedback` | Owning customer |
| GET | `/admin?from=YYYY-MM-DD&to=YYYY-MM-DD&technicianId=123` | Admin/Owner |
| PUT | `/admin/visits/:reportId/quality` | Admin/Owner |
| PUT | `/admin/settings` | Admin/Owner |
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
