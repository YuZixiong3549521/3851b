# Azure App Service

The GitHub workflow builds both portals, runs unit tests, and transfers a tar archive
so hidden build manifests survive the artifact upload. It excludes environment files
and local runtime data. The deployed `coolcare/` directory is the application root.
Its `npm start` runs the production launcher without `.env.local`, Docker, rebuilding,
or a development server.

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
