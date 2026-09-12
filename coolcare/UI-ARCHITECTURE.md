# Shared UI and application architecture

The running application uses React on the frontend, Node.js with Express for HTTP APIs, and MySQL for persisted business data. Vinext provides the main frontend routing/build; the technician portal retains its Vite entry point and existing URLs.

## UI foundation

- `components/ui/`: shared shadcn/ui components built on Base UI. Buttons, text inputs, textareas, native selects, dialogs and technician badges are reused across the imported portals.
- `app/globals.css`: shared Tailwind theme and explicit source scanning for both builds. The primary brand color is `#003f87`.
- `lib/utils.ts`: Tailwind class merging includes the imported site's custom typography sizes, so font-size classes do not remove text colors.
- `components/ui/site-icon.tsx`: converts the imported site's icon names into bundled Lucide SVGs. No icon-font download is needed for these controls.
- `technician/vite.config.js`: resolves the same shared source components and deduplicates React. Install dependencies from the repository root using the documented setup before building the technician entry point.

Page layouts, service content, English copy, URLs and API contracts are preserved. Page-specific CSS still controls layouts and table presentation; it is not a separate component library. Use shared components for new controls rather than copying raw button/input styles into a portal.

Native select elements and native checkbox/radio inputs are intentionally exposed through shared styled controls to retain browser form semantics. Booking, password recovery and technician details use the shared Base UI dialog with keyboard dismissal and modal focus management.

## Customer assistant

The authenticated customer Dashboard exposes **Ask CoolCare Assistant**. This is a button-guided React assistant, with no external AI provider or API key. It reuses the shared dialog, buttons and fields, preserving the Dashboard layout.

- Booking history uses `GET /api/customer/bookings` and includes active, completed and cancelled bookings. Customers can filter/search references and inspect their own booking details.
- Booking creation walks through service, unit count, preferred schedule, address/contact and a review step. Offers come from `GET /api/public/offers`; `POST /api/public/bookings` persists the confirmed request in the existing MySQL transaction. Saved addresses are optional, so new customers can book too.
- Authentication, customer ownership and CSRF remain enforced by the existing API. A stable request UUID is reused after uncertain submission failures; editing is locked until the request is resolved, avoiding a second booking on retry. Closing/reopening preserves an unfinished draft for the same customer; switching customers clears it.
- Successful creation displays the server booking ID, status and amount, refreshes the Dashboard and can immediately be looked up in booking history. Conversation state stays in memory; no chat transcript is stored in the seeded chatbot tables.

## Data boundary (existing portals)

React calls `/api/...`; Express validates the request and session, checks authorization and accesses MySQL. React never receives database credentials. Postman calls the same API. No database or API migration is required for the UI consolidation.

## Validation

The booking workflow extension uses the same UI primitives and adds `booking-service-selection.tsx` shared by all three customer booking surfaces, plus `inventory-transaction-details.tsx` for admin corrections. API contracts, package snapshots, stock audit and mail setup are documented in [BOOKING-WORKFLOWS.md](BOOKING-WORKFLOWS.md).

Validation of the extension covers 28 unit/integration tests, TypeScript and both builds. Real MySQL tests cover rolling address limits, parallel request locks, multi-service pricing, subscription ownership and balance, transactional mail queuing/retry, stock corrections/audit/idempotency and technician authorization. Mutating automated fixtures roll back. Browser checks cover real assistant submission and a received local email, the public booking modal, bundle/membership selection, technician report details/excess acknowledgement and admin correction controls at desktop and narrow widths. Stock mutations were verified with the rollback API tests; browser stock forms were reviewed without submitting inventory changes. This is targeted workflow coverage, not an exhaustive regression of every page.

TypeScript, the 17 existing unit/integration tests and both production builds passed during this change. Browser checks covered customer sign-in, the booking dialog and Escape dismissal, technician sign-in/list/details, and administrator sign-in/parts. Narrow viewport checks led to wrapped booking time labels; desktop inventory was checked at 1440px. This is targeted regression coverage, not an exhaustive click test of every page.
