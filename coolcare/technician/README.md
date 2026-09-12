# CoolCare technician portal

This directory is the technician frontend of the maintained CoolCare application. It uses React and Vite, reuses the shared UI in ../components/ui/ and imports the shared theme from ../app/globals.css.

## Run the application

From the repository root:

    npm run setup
    npm run db:up
    npm start

Sign in with a technician account at http://localhost:3000/#/login, then open http://localhost:3000/technician/index.html.

The root startup script builds this frontend into coolcare/public/technician/. That generated directory is ignored by Git; it is recreated from the source in this directory. No original upload or external source directory is required.

The portal calls the authenticated Node API at /api/technician/jobs. Database credentials stay on the server. A technician sees assigned work orders, related service reports and the permitted inventory issue and cleaning-assessment actions. API errors are displayed with retry controls; they do not fall back to mock data.

## Source and checks

- src/pages/: Dashboard and My Jobs.
- src/components/: shared portal navigation, job tables and the work-order drawer.
- src/services/jobService.js: API requests and portal date handling.
- src/utils/: job filtering, statistics and unit tests.
- src/data/mockJobs.js: deterministic test data, also available through the explicit VITE_USE_MOCK=true development override. It is not the normal application data source.

Run the technician checks from the repository root:

    npm --prefix coolcare/technician test
    npm --prefix coolcare/technician run build

The root npm test and npm run build commands already include these checks/builds. Use the root start command for the integrated site rather than starting a second technician server.

The production deployment must serve the generated /technician/ assets and proxy /api to the authenticated Node server. See the repository README and ../UI-ARCHITECTURE.md for setup, routes and shared UI conventions.
