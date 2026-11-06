# CoolCare presentation checklist

Use this checklist for a rehearsed coursework demonstration against the agreed
application and database. It does not import historical orders, reset existing
data, change catalogue prices or send messages. Additional historical sample data
remains a separate, deferred task. Existing synthetic records must be described
as coursework examples, never as real customers or endorsements.

## Before the presentation

- Agree on the exact website URL, presentation time and validated Git commit.
  Let the last GitHub Actions build and deployment finish, then check `/healthz`,
  `/api/health` and an authenticated page for each role.
- Ask the team to pause pushes and manual Azure publishing during the rehearsal
  and presentation. Keep CI and its deployment queue enabled. Resume normal
  development afterwards. The current session store is in memory, so a server
  restart signs users out; run one App Service instance for this version.
- Confirm the database operator has a usable private database backup and a
  separate media backup. Do not delete orders, replace the database or reset a
  Docker volume to prepare a demonstration.
- Confirm Azure's `/home` storage is persistent. Private photos and signatures
  now use `/home/coolcare-data` on App Service, or the absolute directory selected
  by `COOLCARE_DATA_DIR`. Before the first deployment using this location, preserve
  any existing `wwwroot/.local/service-photos` and `.local/report-signatures`.
  Startup copies surviving legacy files without deleting or overwriting them;
  it cannot recover files that an earlier deployment already removed.
- After a planned rehearsal deployment, reopen one previously uploaded photo and
  signature through the normal authenticated report. Check that both still load.
  See [Azure deployment](AZURE-DEPLOYMENT.md) for the operator settings.
- Use the three Demo Fast Sign-In buttons to fill the presentation email address,
  enter its password, then click Sign In. Verify that the actual Customer, Technician and Admin accounts
  can sign in before the session starts. Other account credentials stay private.
- Open **three independent browser profiles**: Customer, Admin and Technician.
  Three tabs in one profile share the same login cookie and are not sufficient.
  Keep a written booking reference beside the presentation so every role opens
  the same record.
- Check the affected screens on a narrow viewport as well as the presentation
  display. Rehearse loading, back navigation, sign-out and sign-in. Keep a local
  runnable copy and a short recorded walkthrough available if venue connectivity
  fails; label any fallback clearly.

## Main demonstration: one connected service request

| Step | Portal | Action and evidence |
| --- | --- | --- |
| 1 | Customer | Sign in normally. Explain Cleaning, Repair and the Annual Cleaning Bundle using the current catalogue. Open the guided assistant or Book Service. |
| 2 | Customer | Choose a service, unit count, address and weekday at least 14 days ahead. Show the calculated duration and reviewed estimate. If points are available, select a reward discount before submitting. |
| 3 | Customer | Submit once. Record the returned booking reference, open its detail page and refresh it to show that the order is saved in the database. Its initial state is awaiting confirmation. |
| 4 | Admin | Search the exact reference. Review address, remarks, service and quantity, then confirm the request. Dispatch separately, showing the proposed technician or team and postal-area information. |
| 5 | Technician | Open the same booking under its assigned work order. Show the lead/team and appointment. Start the visit and record the cleaning assessment or repair findings. |
| 6 | Technician | Record the parts actually used in the demonstration through the work-order stock-out action. Show per-unit guidance and any excess-use explanation. For Repair, record any additional labour/parts charge with its reason. |
| 7 | Technician | Complete the service report: work performed, checks, findings, solution and any return-visit or extension details. Use permitted demonstration images and explicitly identified demonstration signatures where required; do not fabricate customer authorisation. Submit the report and complete the visit, or submit the pending report after End service. |
| 8 | Customer | Refresh Booking History. Open the same report, show the scheduled visit and actual recorded times, parts, photographs and signature records. Show the awarded points and submit a service rating/comment. |
| 9 | Admin | Open that booking, the inventory movement, customer reward activity and technician review. In Reports & analytics, use **Actual completion date** and a period containing today's Singapore date. Show the resulting completed service value and relevant CSV/data table. |

Keep the existing early-start capability for coursework testing. A future
appointment may be started and completed during the demonstration; its planned
date stays unchanged and the actual start/end times reflect the actions just
performed. Explain this distinction. Do not edit timestamps or weaken ownership,
team-conflict or status-sequence checks to make the demonstration work.

An order marked Completed can still have a report pending submission. Finish the
report as well, so the customer does not reach an empty result. Historical reports
without a saved appointment snapshot must retain the honest missing-data label;
the current booking date is not proof of the original visit date.

## Additional scenarios

| Scenario | What to demonstrate |
| --- | --- |
| Rejected booking | Use a separate eligible request with reserved points. Admin chooses a rejection reason. Customer sees the reason and the actual points-return activity. The rejected order remains in history. |
| Annual renewal | Use an existing plan whose last visit is within the permitted renewal window. Review its four visits and the renewal deadline, then confirm the new plan at its reviewed price. The 100-point early-renewal bonus is awarded only after the new plan's first service is completed. A cancelled, rejected or expired first visit earns no bonus. |
| Assistant recovery | Save an unfinished draft, close/reopen the assistant and resume it. Show that service symptoms preserve compatible selections and that replacing a draft requires a deliberate choice. Retry an availability error instead of treating unchecked times as available. |
| Schedule conflict | Show a date/time rejected by the real availability or same-address cleaning rule and choose an allowed option. Avoid modifying shared capacity or business rules just for the presentation. |
| Reports | Compare a quarter and a year containing existing completed records. Explain the date basis and that the figures represent service value, not money received. Empty periods should remain empty. |

If no existing plan is eligible for early renewal, demonstrate its actual
eligibility date and explain the rule, then arrange a separately authorised
scenario before a later rehearsal. Do not change old visits or add historical
records silently. Likewise, if a customer has no points, show that state or use
an explicitly agreed, audited adjustment through the normal Admin workflow.

## Communication and presentation claims

- Customer support opens an email draft; clicking the link does not send it.
- An assignment email record is not evidence of external delivery. Only claim
  that the customer received an email after verifying delivery to the intended
  test recipient. Local Mailpit is a development inbox, not an external mailbox.
- Google/Apple sign-in and automatic password recovery are outside the current
  demonstration scope. Use ordinary email/password sign-in and the displayed
  support route.
- No online payment is collected. Recorded technician charges and loyalty
  discounts must not be described as paid invoices or payment receipts.
- Postal-area dispatch is an approximate proximity aid. It is not live GPS
  tracking, measured road distance or guaranteed travel time.

## Rehearsal sign-off

Record the validated commit, application URL, rehearsal date, three role accounts
(without passwords), main booking reference, additional scenario references and
the observed results in the team's private presentation notes. Include any
unverified external delivery or Azure storage setting. Repeat only affected
checks after a later change; do not assume a successful deployment proves the
whole business workflow.
