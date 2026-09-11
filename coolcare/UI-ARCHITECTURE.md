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

## Data boundary

React calls `/api/...`; Express validates the request and session, checks authorization and accesses MySQL. React never receives database credentials. Postman calls the same API. No database or API migration is required for the UI consolidation.

## Validation

TypeScript, the 17 existing unit/integration tests and both production builds passed during this change. Browser checks covered customer sign-in, the booking dialog and Escape dismissal, technician sign-in/list/details, and administrator sign-in/parts. Narrow viewport checks led to wrapped booking time labels; desktop inventory was checked at 1440px. This is targeted regression coverage, not an exhaustive click test of every page.
