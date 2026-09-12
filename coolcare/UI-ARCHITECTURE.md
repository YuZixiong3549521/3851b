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

## Public homepage

The CoolCare homepage retains the imported blue/white visual style and images, with a single services-and-pricing section, service process, FAQ and real email contact. Prices come from `GET /api/public/offers`; quantity changes recalculate the visit/annual estimate without replacing a failed catalogue response with sample prices. `lib/homepage-offers.ts` also maps symptom IDs to the appropriate service, including Needs Cleaning → Cleaning.

Booking intent (service, quantity and symptoms) stays in React memory through the homepage login/register flow, then prefills the authenticated booking dialog. A generic Book a service action preserves an unfinished draft. An uncertain submitted request retains its original payload and request UUID until confirmation is resolved. Refreshing the page does not preserve an unsubmitted intent. Normal login opens the role dashboard; all customer My Bookings entry points and old `/#/bookings` bookmarks resolve to `/customer/bookings`. Old `#about` and `#promotions` anchors lead to the process and combined services sections respectively.

Account navigation uses the shared dropdown and a compact mobile disclosure. Signed-in customers see Dashboard/My Bookings instead of account creation prompts. The contact section uses `lib/customer-support.ts`; clicking the email opens the user's mail application, without sending automatically. Public FAQs explain the same 14-day, weekday, rolling-address and self-service change rules enforced by the API.

## Customer assistant

The authenticated customer Dashboard exposes **Ask CoolCare Assistant**. This is a button-guided React assistant, with no external AI provider or API key. It reuses the shared dialog, buttons and fields, preserving the Dashboard layout.

- The assistant focuses on creating bookings. Booking history and existing order details remain available in the customer booking pages.
- Booking creation walks through Cleaning, Repair or Annual Cleaning Bundle, unit count, address/contact, preferred schedule and a review step. Current services and the single annual bundle come from `GET /api/customer/booking-options`; `POST /api/public/bookings` persists the confirmed request in MySQL. The annual review shows four quarterly dates and the annual/per-visit price; all four bookings are created atomically. Saved addresses are optional, so new customers can book too.
- Authentication, customer ownership and CSRF remain enforced by the existing API. A stable request UUID is reused after uncertain submission failures; editing is locked until the request is resolved, avoiding a second booking on retry. Closing/reopening preserves an unfinished draft for the same customer; switching customers clears it.
- Successful creation displays the server booking ID, status and amount (all four visit IDs for an annual bundle), refreshes the Dashboard and offers to start another booking. Conversation state stays in memory; no chat transcript is stored in the seeded chatbot tables.

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

Current validation covers 69 unit/integration tests, TypeScript and both builds. Real MySQL checks cover address saving/deduplication, count-based and legacy booking inputs, rolling address limits, customer locks, the three-choice catalogue, 14-day lead time and weekdays, annual dates and price allocations, all-or-nothing four-visit creation/email queuing, expired-date retries, quarterly rescheduling, cancellation, historical data retention, stock audit and technician assessment authorization/versioning. Singapore midnight boundaries and nearest upcoming appointment sorting are unit-tested. Mutating automated fixtures roll back.

Homepage checks cover desktop (1280px) and phone (390px) layouts, live catalogue estimates for 1–3 units, annual per-visit amounts, guest service/quantity/symptom selection through register/login navigation, authenticated draft reopening, replacing automatic symptoms while preserving written notes, FAQ disclosure, mobile menu keyboard dismissal, real support mail links and legacy My Bookings login redirects. This browser pass does not submit new bookings or send mail; existing MySQL orders remain unchanged. Price validation and issue-to-service mapping also have unit regression coverage.

The address-flow browser check uses a new customer with no equipment, saves and rereads an address, creates four annual visits and a typed-address single visit, verifies their real MySQL quantities/prices/unit links, checks nearest-upcoming selection, and corrects a definitively rejected WebMCP request. Desktop and 390px layouts were inspected. The isolated QA account, addresses and bookings were removed afterward.

The latest browser checks cover both active booking lists, completed/cancelled history, date rejection in all three creation forms, quarterly Monday previews and mobile rescheduling at desktop/390px widths. Nine live HTTP rejection checks cover day 13, Saturday and Sunday through both creation APIs and rescheduling; existing bookings remain unchanged.

Browser checks cover login requirements, current homepage prices and booking prefill, the public booking dialog, customer Repair review, a real four-visit assistant submission/retry, the customer list and a technician assessment saved through the actual API. Desktop and 390px layouts were reviewed. Annual QA orders were cancelled afterward, and isolated technician QA fixtures were removed without changing existing reports or inventory. Earlier inventory tests remain in the suite; this is targeted workflow coverage, not a full public-launch acceptance test.

The customer management acceptance check covers desktop and 390px layouts, profile persistence, defaults, address replacement/archive without rewriting old orders, chronological/grouped orders, owned details, cancellation/rescheduling and the assistant's real four-visit submission. English calendar labels and keyboard navigation were inspected, and date tests run under a Chinese locale and several timezones. A private synthetic QA image verified authenticated photo loading/zoom separately from missing legacy-image fallbacks. Isolated QA records and the test image are cleaned after verification. The operating-system print/PDF dialog is not part of this browser acceptance scope.
