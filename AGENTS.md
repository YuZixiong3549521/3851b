# CoolCare team instructions

## Active application

- Work in `coolcare/`. The top-level `accare/`, `aircon-technician-portal/`, `CoolCare_Customer_App/` and `CoolCare_Website_20260908_150040/` directories are original source references, not the running application.
- Read `README.md` and `coolcare/UI-ARCHITECTURE.md` before changing application behavior or UI.
- Keep all user-facing website text in English. Preserve the existing page layouts unless the task explicitly requests a redesign.
- The frontend is React, the API is Node.js/Express, and business data is persisted in MySQL. Keep the existing routes and API contracts compatible.

## Shared UI

- Reuse `coolcare/components/ui/` (shadcn/ui with Base UI), Tailwind and Lucide. Do not introduce another UI library or copy these components into individual portals for routine changes.
- Keep common colors and tokens in `coolcare/app/globals.css`. Both frontend builds share these styles and components; check both when editing shared UI.
- The technician entry point remains in `coolcare/technician/`; its Vite alias resolves shared components in the parent application.

## Database and API

- Browser code calls the API; database access and credentials stay on the server.
- Preserve session authentication, CSRF, role checks, record ownership, transactions and idempotency. Do not replace database operations with mock data or localStorage to make a demo appear successful.
- Make schema changes through reviewed migration scripts in `coolcare/database/` and the existing migration flow. Preserve existing data; do not reset Docker volumes to resolve routine setup errors.
- `.env.local`, dependency folders, runtime caches and generated technician assets must remain untracked.
- Each developer has a separate local database. Git transfers code and migrations, not local orders, sessions or Docker data volumes. Demo order IDs differ between machines.

## Validation and collaboration

- Use root setup/start scripts documented in README. Avoid starting duplicate local servers.
- Run checks relevant to the changes: `npm test`, `npm --prefix coolcare run test:db`, `node coolcare/node_modules/typescript/bin/tsc --noEmit -p coolcare/tsconfig.json`, and `npm run build`.
- Database integration tests need the local database running. For UI changes also check the affected pages and a narrow viewport; report the actual test scope and any untested areas.
- Inspect Git status first and preserve other people's uncommitted work. For new team tasks, use a separate `codex/<short-task-name>` branch and submit a pull request; follow explicit user branch/push instructions when provided.
- Never force-push shared branches. Check upstream changes before pushing, and do not commit local credentials or test session cookies.
- Keep changes scoped to the assigned task. Update setup/API/UI documentation when changing those interfaces.
