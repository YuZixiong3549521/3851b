# Add connected synthetic coursework data

This optional tool appends 50 fictional business scenarios to the configured MySQL
database. It works with an existing dataset and does not replace orders, accounts,
passwords, catalogue prices or existing inventory history. All new people and reviews
are explicitly labelled **Synthetic** and use reserved `example.test` email addresses.
They are coursework examples, not real customers, work performed or endorsements.

The usual GitHub deployment transfers this tool with the application. **It never
runs automatically on deployment or application startup.** Git does not transfer
local MySQL data. The database operator runs the tool once against the intended
database after deployment. The same batch key is recorded in an existing
`commerce_operation` receipt; repeating it cannot create another 50 bookings.
No additional schema migration or public import API is introduced.

## Azure operator steps

1. Wait for the main-branch GitHub Actions build and deploy jobs to succeed.
2. Confirm the existing MySQL backup/recovery arrangement before importing. Keep
   the current backup; do not reset the database or run the local `db:sample --replace`.
3. Open **App Service → Development Tools → SSH**, using an account permitted to
   operate this application. The application's existing `DB_*` settings must be
   present in this shell. The tool never loads a local environment file implicitly
   and never prints passwords.
   The operator connection needs SELECT/INSERT/UPDATE for the scenario tables.
   The website's restricted runtime account may intentionally forbid updating
   historical reward timestamps (for example, `loyalty_transaction`). If the dry
   run reports this, use an authorized database operator's `DB_USER`/`DB_PASSWORD`
   for this shell session only, supplied securely by the database administrator.
   Do not change the website's stored credentials or widen its runtime privileges.
4. In the deployed application directory, preview the database and new scenarios:

   ```sh
   cd /home/site/wwwroot
   npm run db:coursework -- --plan --batch=coursework-2026-11-v1 --as-of=2026-11-06
   ```

5. Validate the full insert in a transaction that is rolled back:

   ```sh
   npm run db:coursework -- --dry-run --batch=coursework-2026-11-v1 --as-of=2026-11-06
   ```

6. Once the target and dry-run output are correct, append the batch:

   ```sh
   npm run db:coursework -- --apply --batch=coursework-2026-11-v1 --as-of=2026-11-06 --database="$DB_NAME"
   ```

7. Re-run the preview command to see the saved receipt and current counts. Refresh
   the website. There is no need to redeploy or restart after importing.

Use the same batch key and date on retry, including after an interrupted connection.
Do not choose a new key just because a result was not displayed: the original
transaction may already have committed. A replay returns `alreadyImported: true`.
The optional date is the reference Singapore date for the scenarios; for a new
batch it defaults to the current date when omitted. Use a current date if importing
later, so the upcoming examples remain upcoming. An explicitly different date on
an already imported batch is rejected. Dry runs can consume auto-increment IDs,
even though their data is rolled back.

## What the batch adds

| Data | Scenarios |
| --- | --- |
| Bookings | 50 total: 26 Completed, 9 Submitted, 6 Confirmed, 4 Assigned, 2 Cancelled, 2 Rejected, 1 Expired |
| Annual plans | 3 plans, with 4 linked quarterly bookings each, included in the 50 |
| Customers | 12 new synthetic customers with their own addresses and AC units |
| Technicians | 3 new active synthetic technicians, identified in their names |
| Completed work | Dated service reports, teams, assessments, feedback and completion rewards |
| Inventory | Additional receipts and work-order issues; existing stock is adjusted only by these new movements |
| History | Past quarters and the previous year, for quarterly and yearly comparisons |

The new active technicians add scheduling capacity. Future assigned examples belong
to these synthetic technicians; administrators can reassign them through normal
eligible-order controls. There is no fake In Progress visit that occupies an
existing technician. No existing staff availability is changed.

New synthetic accounts receive unknown random passwords; the tool does not publish
new login credentials or alter any existing demo account. An administrator can see
all examples. Existing customers and technicians retain their own records and do
not suddenly receive someone else's history. These new accounts are for data
demonstration, not additional quick-login identities.

## Demonstrate the data

- **Admin → Orders:** search `Synthetic`, compare status queues and open an order
  for its address, services, report, parts and price details. Existing orders remain.
- **Admin → Reports & analytics:** select a range spanning the reference date and
  previous year; compare quarterly/yearly completed service value. The value is not
  a payment receipt. Select actual completion dates to examine the seeded snapshots.
- **Admin → Yearly packages:** inspect the three new plans and all four visits.
- **Admin → Technician performance:** choose a synthetic technician to inspect
  completed visits and explicitly labelled synthetic customer feedback.
- **Admin → Inventory / Customer rewards:** inspect the new movement and points
  records and their associated bookings.

The import does not enqueue or send emails, submit fake signatures/photos, make
payments or invoke any third-party service. Existing queued emails are untouched.
Data integrity checks run before commit; failure rolls back the entire batch. A
database advisory lock serializes imports and a durable receipt prevents duplicate
inserts. Existing business readers and permissions remain unchanged.
The CLI attributes synthetic import audit records to the existing active Owner
administrator; it does not infer the identity of the Azure SSH operator.

## Local verification

Use the environment file explicitly from `coolcare/`:

```powershell
node --env-file=.env.local scripts/import-coursework.mjs --plan --batch=coursework-local-v1
node --env-file=.env.local scripts/import-coursework.mjs --dry-run --batch=coursework-local-v1
```

The database tests exercise preservation, full relationships, stock/reward
reconciliation, dry-run rollback and same-batch replay in rolled-back local fixtures.
Never point integration tests at the hosted database.
