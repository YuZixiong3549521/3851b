# Azure App Service

The GitHub workflow builds both portals, runs unit tests, and transfers a tar archive
so hidden build manifests survive the artifact upload. It excludes environment files
and local runtime data. The deployed `coolcare/` directory is the application root.
Its `npm start` runs the production launcher without `.env.local`, Docker, rebuilding,
or a development server.

Production workflow runs share a concurrency group. A new push waits for the active
publish to finish instead of starting another OneDeploy upload against the same
app (which can fail with HTTP 409). The active run is never cancelled; GitHub keeps
the latest pending run if several newer pushes arrive. Avoid starting a separate
manual Azure deployment while this workflow is publishing.

## App Service settings

Use Node.js 22 LTS on Linux and startup command `npm start`. Enable HTTPS Only.
In Environment variables, configure these application settings (values remain in
Azure, never in GitHub source or workflow output):

| Setting | Value |
| --- | --- |
| `NODE_ENV` | `production` (also enforced by the launcher) |
| `SCM_DO_BUILD_DURING_DEPLOYMENT` | `false`; GitHub Actions already builds and packages the application |
| `WEB_ORIGIN` | `https://coolcare-web-3851-hbdrdshsc9gjdbee.eastasia-01.azurewebsites.net` |
| `DB_HOST` | Reachable MySQL server hostname; localhost on your laptop is not reachable from Azure |
| `DB_PORT` | MySQL port, normally `3306` |
| `DB_USER`, `DB_PASSWORD`, `DB_NAME` | Existing MySQL application credentials/database |
| `SESSION_SECRET` | A securely generated random value of at least 32 characters |
| `DB_SSL` | `true` for a MySQL service requiring TLS; certificate validation remains enabled |
| `DB_SSL_CA` | Optional PEM CA certificate for a private MySQL CA |

`WEB_ORIGIN` can be omitted when App Service supplies `WEBSITE_HOSTNAME`; HTTPS is
inferred. Set it explicitly for a custom domain, which becomes the single allowed
application origin. Do not include a path. The platform supplies `PORT`; the fallback
is `8080`. Optional internal `WEB_PORT`/`API_PORT` default to `3000`/`3001` and must
differ from `PORT` and each other. They bind only to loopback. Do not expose them or
put localhost URLs into browser build variables. Both browser builds use `/api`.

Configure the database firewall/network to allow the App Service connection and
apply the existing reviewed database schema/migrations to that database before use.
The launcher does not seed, reset or migrate business data automatically. Existing
local Docker setup/migration scripts remain local tools.

To append coursework examples to an already populated hosted database, use the
explicit preview/dry-run/apply steps in [COURSEWORK-DATA.md](COURSEWORK-DATA.md).
This separate tool preserves existing records and records a replay-safe batch
receipt. It is never invoked by GitHub deployment or the production launcher.

Keep one App Service instance for the current in-memory session store. A restart
signs users out. Multiple instances require a shared session store before scaling.
The gateway trusts only the configured host and replaces forwarding headers; HTTPS
session cookies, existing origin checks, CSRF and role/ownership checks remain enabled.
For consistent rate limiting it uses the immediate upstream address rather than
trusting arbitrary client-supplied forwarding chains.

If email is needed, configure the existing `MAIL_MODE`, `MAIL_FROM` and SMTP settings
for a reachable SMTP service; the local Mailpit service is not a cloud mail server.
Report signatures/photos under `.local/` need persistent storage. On App Service
ensure the app runs under persistent `/home` storage (including App Service storage
for custom containers); back up runtime media separately from deployments.

## Verify

1. Push to `main` and check both GitHub Actions jobs complete.
2. In Log stream, look for `CoolCare production listener: 0.0.0.0:<port>` and the API
   and vinext production startup messages. Missing configuration logs only setting
   names, never secret values.
3. `/healthz` checks the gateway process only. `/api/health` must return
   `{"ready":true}` to confirm MySQL and the existing schema are reachable.
4. Open `/`, `/customer`, `/admin/orders` and `/technician/index.html`, sign in and
   verify an authenticated read. API calls must use the same HTTPS origin.

Local development is unchanged from the repository root: `npm start`. Inside
`coolcare/`, use `npm run start:local`. To run production locally, first build and
provide the same environment variables, then run root `npm run start:production`;
use an HTTPS reverse proxy with the configured origin for secure browser sessions.

## Remove the optional 2026-11-04 DEMO order batch

This maintenance task is never run by startup, migration or deployment. From the
deployed application directory, `node scripts/cleanup-demo-orders.mjs` previews only.
The explicitly requested `--apply` removes exactly 300 orders belonging to exactly
60 customers whose numbered DEMO names and `customerN@cc-demo-20261104.invalid`
emails both match. Accounts and other orders remain. It refuses a different batch
size, unknown/cyclic/shared dependencies, triggers, or stock/payment/reward/annual
visit records that require additional reconciliation. It never disables foreign keys.

Before deletion it writes a private, parent-first SQL restore backup under
`/home/demo-order-backups/`. Deletes run in one transaction and compare all retained
booking rows before committing. A failed check rolls back the entire operation.
Keep this backup private; it contains the removed business data. If restoration is
needed, use a MySQL administrative client on the same database while application
writes are paused, and import the generated SQL file. Existing matching IDs must
not have been recreated. Media files are retained; only their selected database
references are removed. No application credentials are included in this backup.
