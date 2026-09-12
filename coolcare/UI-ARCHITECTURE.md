# Shared UI and application architecture

The running application uses React on the frontend, Node.js with Express for HTTP APIs, and MySQL for persisted business data. Vinext provides the main frontend routing/build; the technician portal retains its Vite entry point and existing URLs.

`coolcare/` is self-contained: both frontend sources, shared UI, server code, runtime assets and database migrations are tracked here. Setup and builds do not copy files from the old uploaded projects. Those references are ignored locally and absent from new checkouts; see [ORIGINS.md](ORIGINS.md). The optional SQLite importer requires an explicit local source path and is not part of normal startup.

## UI foundation

- `components/ui/`: shared shadcn/ui components built on Base UI. Buttons, text inputs, textareas, native selects, dialogs and technician badges are reused across the imported portals.
- `app/globals.css`: shared Tailwind theme and explicit source scanning for both builds. The primary brand color is `#003f87`.
- `lib/utils.ts`: Tailwind class merging includes the imported site's custom typography sizes, so font-size classes do not remove text colors.
- `components/ui/site-icon.tsx`: converts the imported site's icon names into bundled Lucide SVGs. No icon-font download is needed for these controls.
- `technician/vite.config.js`: resolves the same shared source components and deduplicates React. Install dependencies from the repository root using the documented setup before building the technician entry point.

Page layouts, service content, English copy, URLs and API contracts are preserved. Page-specific CSS still controls layouts and table presentation; it is not a separate component library. Use shared components for new controls rather than copying raw button/input styles into a portal.

Native select elements and native checkbox/radio inputs are intentionally exposed through shared styled controls to retain browser form semantics. Booking, password recovery and technician details use the shared Base UI dialog with keyboard dismissal and modal focus management.

## Public homepage

The CoolCare homepage retains the imported blue/white visual style and images, with a single services-and-pricing section, service process, FAQ and real email contact. Prices come from `GET /api/public/offers`; quantity changes recalculate the visit/annual estimate without replacing a failed catalogue response with sample prices. `lib/homepage-offers.ts` also maps symptom IDs to the appropriate service, including Needs Cleaning → Cleaning.

Booking intent (service, quantity and symptoms) stays in React memory through the homepage login/register flow, then prefills the authenticated booking dialog. A generic Book a service action preserves an unfinished draft. An uncertain submitted request retains its original payload and request UUID until confirmation is resolved. Refreshing the page does not preserve an unsubmitted intent. Normal login opens the role dashboard; all customer My Bookings entry points and old `/#/bookings` bookmarks resolve to `/customer/bookings`. Old `#about` and `#promotions` anchors lead to the process and combined services sections respectively.

Account navigation uses the shared dropdown and a compact mobile disclosure. Signed-in customers see Dashboard/My Bookings instead of account creation prompts. The contact section uses `lib/customer-support.ts`; clicking the email opens the user's mail application, without sending automatically. Public FAQs explain the same 14-day, weekday, rolling-address and self-service change rules enforced by the API.

## Customer assistant

The authenticated customer Dashboard exposes **Ask CoolCare Assistant**. This is a button-guided React assistant, with no external AI provider or API key. It reuses the shared dialog, buttons and fields, preserving the Dashboard layout.

- The assistant focuses on creating bookings. Booking history and existing order details remain available in the customer booking pages.
- Four compact steps cover service/count, address/contact, schedule and review. Current choices and prices come from `GET /api/customer/booking-options`. Deterministic service guidance, symptom buttons and FAQs help customers choose; a technician still decides the cleaning method. Review offers direct service/address/schedule edits without discarding the other answers.
- `useAssistantDraft` serializes autosaves to `/api/customer/assistant/draft`. MySQL stores one current account-owned draft, its revision, server-generated request UUID, reviewed quote and completed receipt. No personal draft data is written to localStorage and no chat transcript is stored in the old seeded chatbot tables. Closing, refreshing and signing back in can restore the saved draft; conflicting tabs must reload it before continuing.
- `/assistant/review` validates contact data and every annual visit against current booking rules and address quotas. `/assistant/confirm` locks and compares catalogue terms before creating orders. A changed quote is saved and displayed for explicit reconfirmation. The existing shared booking writer persists all four visits and their email outbox records atomically; the older booking APIs remain compatible.
- A lost confirmation response is reconciled with the saved server receipt before editing or starting another booking. Completed retries return the same receipt even after the appointment date passes. Successful creation shows real order IDs, amount and email status, refreshes the Dashboard, and links directly to the newly created booking. Support uses the configured customer support email.
- A named `returnTo=assistant` login target returns to `/customer?assistant=resume`; arbitrary redirect URLs are not accepted. Phone fields accept an eight-digit Singapore number or an international number with a country code, show inline errors and normalize confirmed numbers. This checks format, not phone ownership or reachability.

All booking and reschedule forms require at least 14 calendar days of notice in Asia/Singapore and Monday–Friday service dates, backed by server validation. Annual previews roll subsequent weekend visits forward to Monday without moving the original quarterly anchor. Both My Bookings pages show active requests only; Booking History keeps completed reports and cancelled requests in separate tabs. Existing data and list API contracts are preserved.

The customer booking page retains four steps: Service, Address, Schedule and Review. Address entry is editable text with an optional saved-address chooser, **Add new address**, and an AC count instead of individual equipment checkboxes. The shared fields save addresses through the authenticated API and make the returned address immediately available for booking; customers with no registered equipment can complete the flow. UPCOMING uses appointment start times in Singapore, and its count and nearest-appointment card share the same filter, including same-day time handling and updates when the clock changes or the page regains focus.

## Customer management and English dates

The Dashboard shows the nearest upcoming visit before account metrics. Active orders are sorted by service date and grouped by actual annual series ID, with later visits collapsed. `/customer/bookings/:bookingId` displays an owned booking, its status timeline and notes. Only unassigned Submitted requests expose self-service changes. Submitted is labelled **Awaiting confirmation** in the customer UI without changing database status values. Support uses a booking-reference `mailto:` link configured in `lib/customer-support.ts`.

`use-customer-resource.ts` refreshes booking data on focus, visibility, reconnect and every visible minute. It scopes cached data and asynchronous completions to the current loader; detail pages also remount by booking ID so navigation cannot combine one booking's display with another booking's mutation target. Permission/not-found errors clear stale records.

The avatar menu replaces the customer staff switcher. `/customer/account` updates name and phone, while `/customer/addresses` manages saved/default/archived addresses. Address edits preserve historical booking locations on the server. Reports show stored work duration, actual net parts use and authenticated local photos, with missing-data fallbacks, image zoom and print styles for browser PDF saving.

`EnglishDatePicker` uses the shared Calendar/Popover and explicit `enGB` locale for months, weekdays, accessible names and date labels. It replaces native date inputs in customer booking, assistant, public booking and public rescheduling. Calendar dates remain `YYYY-MM-DD` API values; display formatters fix English and Singapore time rather than inheriting the OS locale. Address availability previews disable quota-conflicting dates; final server transactions remain authoritative. Mobile booking actions stay above the bottom navigation, and annual schedule previews can collapse.

## Data boundary (existing portals)

React calls `/api/...`; Express validates the request and session, checks authorization and accesses MySQL. React never receives database credentials. Postman calls the same API. No database or API migration is required for the UI consolidation.

## Validation

The booking workflow extension uses the same UI primitives and adds `booking-service-selection.tsx` shared by all three customer booking surfaces, plus `inventory-transaction-details.tsx` for admin corrections. API contracts, package snapshots, stock audit and mail setup are documented in [BOOKING-WORKFLOWS.md](BOOKING-WORKFLOWS.md).

Current validation covers 79 unit/integration tests. Real MySQL checks cover address saving/deduplication, count-based and legacy booking inputs, rolling address limits, customer locks, the three-choice catalogue, 14-day lead time and weekdays, annual dates and price allocations, all-or-nothing four-visit creation/email queuing, expired-date retries, quarterly rescheduling, cancellation, historical data retention, stock audit and technician assessment authorization/versioning. Assistant tests cover account/CSRF boundaries, durable drafts across fresh API sessions, stale revisions and reset races, real customer-lock contention, UTC save timestamps, all four quarterly conflicts, price reconfirmation, atomic receipt persistence and recovery after service dates expire. Singapore midnight boundaries, nearest upcoming appointment sorting and phone formats are unit-tested. Mutating automated fixtures roll back.

Homepage checks cover desktop (1280px) and phone (390px) layouts, live catalogue estimates for 1–3 units, annual per-visit amounts, guest service/quantity/symptom selection through register/login navigation, authenticated draft reopening, replacing automatic symptoms while preserving written notes, FAQ disclosure, mobile menu keyboard dismissal, real support mail links and legacy My Bookings login redirects. This browser pass does not submit new bookings or send mail; existing MySQL orders remain unchanged. Price validation and issue-to-service mapping also have unit regression coverage.

The address-flow browser check uses a new customer with no equipment, saves and rereads an address, creates four annual visits and a typed-address single visit, verifies their real MySQL quantities/prices/unit links, checks nearest-upcoming selection, and corrects a definitively rejected WebMCP request. Desktop and 390px layouts were inspected. The isolated QA account, addresses and bookings were removed afterward.

The latest browser checks cover both active booking lists, completed/cancelled history, date rejection in all three creation forms, quarterly Monday previews and mobile rescheduling at desktop/390px widths. Nine live HTTP rejection checks cover day 13, Saturday and Sunday through both creation APIs and rescheduling; existing bookings remain unchanged.

Browser checks cover login requirements, current homepage prices and booking prefill, the public booking dialog, customer Repair review, a real four-visit assistant submission/retry, the customer list and a technician assessment saved through the actual API. Desktop and 390px layouts were reviewed. Annual QA orders were cancelled afterward, and isolated technician QA fixtures were removed without changing existing reports or inventory. Earlier inventory tests remain in the suite; this is targeted workflow coverage, not a full public-launch acceptance test.

The customer management acceptance check covers desktop and 390px layouts, profile persistence, defaults, address replacement/archive without rewriting old orders, chronological/grouped orders, owned details, cancellation/rescheduling and the assistant's real four-visit submission. English calendar labels and keyboard navigation were inspected, and date tests run under a Chinese locale and several timezones. A private synthetic QA image verified authenticated photo loading/zoom separately from missing legacy-image fallbacks. Isolated QA records and the test image are cleaned after verification. The operating-system print/PDF dialog is not part of this browser acceptance scope.

The updated assistant was checked at 1280px and 390px: phone errors, new-address saving, service/symptom selection, reload and re-login recovery, direct review edits, English calendars, an obsolete quote requiring a second confirmation, real four-visit creation, receipt restoration, the exact new-order link, a fresh draft after success, and stale-session edit rejection/reload. The obsolete quote was confined to a synthetic customer's draft; shared catalogue prices were not changed. Original orders remained unchanged and synthetic records were removed. External mailbox delivery remains outside this local Mailpit acceptance check.
