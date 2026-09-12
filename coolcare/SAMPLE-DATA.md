# Connected local sample data

These are **synthetic development scenarios**, not records of real customers or completed field work. They use Singapore-style addresses, equipment, service notes, prices from the current catalogue and connected booking, work-order, report and stock records. No personal database export is published in GitHub.

## Load on a new computer

From the repository root, with Docker Desktop running:

```powershell
npm run setup
npm run db:up
npm run db:sample
npm start
```

`seed.sql` bootstraps local accounts and reference catalogue records only. Migrations install the current Cleaning, Repair and Annual Cleaning Bundle catalogue. The optional sample loader runs **after** migrations. Normal setup, startup, migration and Git pull never replace existing business data.

## Review or replace an existing local dataset

Stop `npm start` before applying the loader. Existing records require an explicit `--replace`:

```powershell
npm run db:sample -- --plan
npm run db:sample -- --replace --dry-run --as-of=2026-09-12
npm run db:sample -- --replace --as-of=2026-09-12
npm start
```

- `--plan` lists the business tables and row counts without changing data.
- `--dry-run` builds and validates the replacement, then rolls the transaction back. MySQL auto-increment IDs may still advance.
- `--as-of` selects the Singapore calendar date for the scenarios. Omit it to use today's Singapore date. Use the same date on each machine for matching schedules; generated IDs and request UUIDs need not match.
- The loader replaces bookings, addresses, equipment, annual series, work orders, reports, inventory movements and associated old business records, including assistant drafts, email outbox, legacy subscriptions, promotions and loyalty records.
- Existing accounts, password hashes, customer profiles, roles, catalogue configuration and part definitions remain. Existing customers outside the six scenario accounts remain able to log in, with no seeded bookings or addresses. Missing scenario accounts are added; existing passwords are never reset.
- It only runs against the local CoolCare database, verifies that the Docker backup and writer use the same MySQL server, checks foreign-key dependencies, serializes concurrent loads and applies business changes in one transaction. It never disables foreign keys or deletes Docker volumes.

Each write attempt first creates a full private SQL backup under `coolcare/.local/backups/realistic-data-*/before.sql`. The latest successful scenario manifest is `coolcare/.local/realistic-data-last-run.json`. Both remain ignored by Git. Keep the backup until you are satisfied with the replacement. To restore, stop the API and import the chosen backup into the verified local MySQL instance with an administrative MySQL client, explicitly selecting `coolcare_service_app` as the target database. The dump does not include a `USE` statement. The backup contains private account data and must stay local.

## Scenarios

| Records | Count / content |
| --- | --- |
| Scenario customers | 6, with 8 addresses and 23 registered units |
| Technicians | 3 scenario technicians; existing administrators retained |
| Bookings | 28: 10 Completed, 2 Cancelled, 7 Submitted, 6 Assigned, 3 Confirmed |
| Annual bundles | 2, each with 4 quarterly visits; Alice has 2 completed and 2 future visits; Ben has 4 future visits |
| Work orders / maintenance reports | 16 / 10, with findings, solutions, durations and parts usage |
| Cleaning assessments | 7 regular-cleaning assessments with initial audit records |
| Inventory | 11 opening receipts, 14 work-order issues and 1 unused-material return |
| Inventory correction | 1 receipt corrected from 78 to 80 metres of hose, retaining the original operation and amendment audit |
| Low-stock examples | Condensate Pump: 7; Fan Motor: 5 |

Counts describe the supplied scenarios. Extra existing accounts or custom part definitions are retained, so totals on different machines can differ. Future active appointments follow the 14-day notice, weekday and address quota rules. Past work is represented as historical records, not submitted through the new-booking API. All amounts are SGD estimates from the configured catalogue, without invented payment receipts. Parts issued and returned reconcile to warehouse stock.

Alice and Ben retain their documented `@coolcare.demo` logins. New fictional customer accounts are `priya.nair@example.test`, `marcus.goh@example.test`, `nur.aisyah@example.test` and `evelyn.koh@example.test`; the additional technician is `daniel.ong@example.test`. Newly created sample accounts use `CoolCareDemo2026!`. These credentials are for local development only.

The loader does not queue appointment emails, send messages, create fake photo/signature links or add chatbot transcripts. Create a new booking normally to demonstrate actual API persistence and the local Mailpit notification flow. Existing Postman collections continue to work; use returned IDs rather than expecting IDs from another machine.

`database/verify.sql` contains read-only counts and integrity queries. The required regression checks remain documented in the repository README; a seeded local database is needed for the integration suite. A few tests create isolated records using the local root credential and roll back their transactions; application permissions remain unchanged.
