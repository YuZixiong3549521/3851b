# CoolCare Customer Portal

A runnable customer-facing implementation of the CoolCare Stitch design. The current MVP intentionally has no login screen. It uses the seeded Alice Tan account as a server-side demonstration customer.

## Technology

- React with Vinext and Vite for the customer interface
- Tailwind CSS and accessible Shadcn primitives for styling and controls
- Node.js and Express for the REST API
- MySQL 8.4 with the shared CoolCare schema and seed data

## Local setup

Requirements: Node.js 22.13 or newer and Docker Desktop.

1. Copy `.env.example` to `.env` if you need to change any defaults.
2. Start Docker Desktop.
3. Start MySQL: `npm run db:up`
4. Verify the shared baseline: `npm run db:verify`
5. Start the API in one terminal: `npm run dev:api`
6. Start the customer interface in another terminal: `npm run dev`
7. Open `http://localhost:3000`.

The API runs on `http://localhost:4000` and MySQL is exposed locally on port `3307`.

## Core demonstration flow

1. Open Dashboard directly; authentication is outside this MVP scope.
2. Open Book Service and complete all four steps.
3. Confirm the request and note the database-generated booking reference.
4. Open My Bookings to confirm the Submitted record persists after refresh.
5. Open Maintenance History and view the seeded completed service report.

## Useful checks

- `npm test` validates the booking payload contract.
- `npm run db:verify` confirms 29 tables, 5 views and the required seed records.
- `npm run smoke:api` checks the running database-backed customer endpoints.
- `npm run build` creates the production frontend build.

Do not commit a real `.env` file or expose MySQL credentials in frontend code.
