# CoolCare Admin Inventory Interface — Enhanced Stitch Prompts

## 使用方法

在同一个 Stitch 项目中依次使用三段提示词：先用 Prompt 1 生成页面，再用 Prompt 2 补齐跳转，最后用 Prompt 3 补齐状态与验证。不要为后两轮新建项目，以免设计风格发生变化。

## 数据与业务规则

- Part：`part_id`, `part_name`, `unit_price`, `status`, `current_stock`
- Part status：Active, Inactive, Discontinued
- Transaction：`transaction_id`, optional `job_id`, `part_id`, `transaction_type`, `quantity`, optional `remarks`, optional `admin_user_id`, `created_at`
- Transaction type：Stock In, Stock Out, Adjustment, Return
- Quantity must be an integer greater than zero
- Current Stock is read-only on part forms; all stock changes must create an inventory transaction
- Stock Out must never make projected stock negative
- Transactions are immutable audit records and must not have Edit or Delete actions
- For this prototype, Adjustment reveals required Increase/Decrease and Reason controls; the backend must later store the direction explicitly

## Prompt 1 — 完整页面与功能

```text
Create a polished, high-fidelity, responsive desktop web admin inventory-management prototype for CoolCare, an air-conditioning service company. Build SIX connected screens in ONE project using one reusable design system:

1. Inventory Overview
2. Parts Management
3. Part Details
4. Add/Edit Part
5. Inventory Transactions
6. Record Transaction

DESIGN SYSTEM
Use a professional light theme with a navy left sidebar, CoolCare blue primary actions, teal success accents, white cards, subtle borders and shadows, rounded 10px corners, Material Symbols icons, accessible contrast, and a dense but readable 1440px layout. Use consistent cards, tables, filters, forms, status chips, drawers, modals, empty states, tooltips, and toast notifications. Keep the interface practical and implementation-ready.

GLOBAL LAYOUT
Use a persistent sidebar with CoolCare logo, Dashboard, Bookings, Technicians, Inventory, Promotions, Customers, Reports, and Settings. Inventory is expanded with Overview, Parts, and Transactions sub-items. Clearly highlight the current page and preserve the expanded state. Add a persistent top bar with page title, global search, notification bell with unread badge, help, and admin avatar menu. Add clickable breadcrumbs on detail and form pages.

ROUTES
- /admin/inventory — Inventory Overview
- /admin/inventory/parts — Parts Management
- /admin/inventory/parts/new — Add Part
- /admin/inventory/parts/:partId — Part Details
- /admin/inventory/parts/:partId/edit — Edit Part
- /admin/inventory/transactions — Inventory Transactions
- /admin/inventory/transactions/new — Record Transaction

Do not create dead buttons. Every action must navigate, open a menu/modal/drawer, or show feedback. Out-of-scope sidebar modules may show “Module not included in this prototype” as a small toast.

INVENTORY OVERVIEW
Show clickable KPI cards for Total Parts, Total Units in Stock, Low Stock Items, and Total Stock Value. Add a stock-level bar chart, low-stock alerts, inventory value by status, recent transactions, and quick actions for Add Part, Record Transaction, View All Parts, and View All Transactions. Low-stock cards and alerts open the low-stock filtered parts list. A chart bar opens the relevant filtered parts list. A recent transaction opens a Transaction Details drawer.

PARTS MANAGEMENT
Create a searchable, sortable, paginated table with Part ID, Part Name, Unit Price, Status, Current Stock, Stock Value, and Actions. Include status and stock-level filters, active filter chips, Clear Filters, result count, rows per page, Export CSV, and Add Part. Part name or View opens Part Details. Edit opens Edit Part. Stock In and Stock Out open Record Transaction with part and type prefilled. Do not add hard delete. Disable stock actions for Discontinued parts and explain why with a tooltip.

PART DETAILS
Show Part ID, name, status, Unit Price, Current Stock, Stock Value, Stock Health, stock-level visualization, low-stock warning, and transaction history with search, type/date filters, and pagination. Include Edit Part, Record Transaction, Back to Parts, and View All Transactions. A transaction opens the read-only Transaction Details drawer. Breadcrumb: Inventory > Parts > Part Details.

ADD/EDIT PART
Use one consistent form for Add and Edit. Include Part Name, Unit Price, Status, and read-only Current Stock. New parts start at zero stock. Add required markers, helper text, inline validation, Cancel, and Save Part. Disable Save until valid and changed. Successful Add shows a toast then opens the new Part Details. Successful Edit returns to updated Part Details. Leaving with unsaved changes opens a Discard Changes modal.

INVENTORY TRANSACTIONS
Create a read-only audit table with Transaction ID, Date/Time, Part, Type, signed Quantity, Job ID, Remarks, and Admin. Include search, date range, part/type filters, removable filter chips, Clear Filters, sorting, pagination, result count, Export CSV, and Record Transaction. Stock In and Return are positive, Stock Out is negative, and Adjustment is neutral. A row opens Transaction Details. Never show Edit or Delete.

RECORD TRANSACTION
Create a validated form with Part, Transaction Type, Quantity, optional Job ID, Remarks, and read-only Admin. Show part details, current stock, signed stock change, and live projected stock. Quantity must be greater than zero. Block Stock Out if projected stock is negative. Offer “Not linked to a job” for legitimate unlinked transactions. Adjustment reveals required Increase/Decrease and Reason controls. The main action opens a review modal with Part, Type, Quantity, Current Stock, Change, Projected Stock, Job ID, and Admin. Confirm shows processing, prevents double submission, then shows success and opens Part Details with the new transaction first.

TRANSACTION DETAILS DRAWER
Create one reusable read-only drawer with Transaction ID, linked Part, Type, signed Quantity, Stock Before, Stock After, Job ID, Remarks, Admin, and Created At. It closes by Close, X, Escape, or overlay click. A linked Job shows View Job; because Jobs are out of scope, that action shows an informational toast.

SAMPLE DATA
- PT-0001, Aircon Filter, $18.00, Active, 25 units
- PT-0002, Drain Hose, $12.50, Active, 40 units
- PT-0003, Capacitor 35uF, $35.00, Active, 12 units
Recent activity: Stock In 30 Aircon Filters; Stock Out 5 Aircon Filters for WO-1001; Stock In 40 Drain Hoses; Stock In 12 Capacitors. Keep IDs, admins, dates, values, totals, and statuses consistent across every screen.
```

## Prompt 2 — 跳转与交互强化

```text
Continue the existing CoolCare Admin Inventory project. Do not redesign it. Keep the exact same sidebar, top bar, colors, typography, spacing, components, routes, and sample data. Make navigation and prototype interactions complete across all six screens.

GLOBAL
- Logo and Inventory > Overview -> Inventory Overview.
- Inventory > Parts -> Parts Management.
- Inventory > Transactions -> Inventory Transactions.
- Preserve active navigation state after every transition.
- Breadcrumb items are clickable except the current page.
- Back returns to the actual previous inventory page.
- Global search opens grouped Parts and Transactions results; selection opens Part Details or Transaction Details.
- Notifications open a panel; low-stock notifications open the low-stock filtered parts list.
- Avatar opens My Profile, Account Settings, and Sign Out.
- Out-of-scope modules show an informational toast; no control should do nothing.

OVERVIEW
- Add Part -> Add Part.
- Record Transaction -> Record Transaction.
- Total Parts/View All Parts -> Parts Management.
- Low Stock -> Parts Management with Low Stock filter.
- Total Stock Value -> Parts sorted by Stock Value descending.
- Chart bar -> relevant filtered parts list.
- View All Transactions -> Inventory Transactions.
- Recent transaction -> Transaction Details drawer.

PARTS
- Part name/View/row double-click -> Part Details.
- Edit -> Edit Part.
- Stock In/Stock Out -> Record Transaction with part and type prefilled.
- Search, filters, sorting, pagination, and rows-per-page visibly update rows and result count.
- Active filters appear as removable chips; Clear Filters resets them.
- Export CSV shows progress then success.
- Preserve list search, filters, sorting, and page when returning from Part Details.

PART DETAILS
- Edit Part -> Edit Part.
- Record Transaction -> Record Transaction with current part prefilled.
- View All Transactions -> Transactions filtered to current part.
- Transaction row -> Transaction Details drawer.
- Back and breadcrumb Parts -> previous Parts state.

ADD/EDIT PART
- Save is disabled until valid and changed.
- Successful Add/Edit -> success toast -> updated Part Details.
- Cancel with no changes -> previous page.
- Any navigation with unsaved changes -> modal with Keep Editing and Discard Changes.
- Duplicate name or invalid price shows inline errors without clearing valid fields.

TRANSACTIONS
- Record Transaction -> Record Transaction.
- Part name -> Part Details.
- Row -> Transaction Details drawer.
- Search, filters, date range, sorting, pagination, filter chips, and Clear Filters visibly update results.
- Export CSV shows progress then success.

RECORD TRANSACTION
- Part/type/quantity changes recalculate stock immediately.
- Negative projected stock disables review and shows an inline error.
- Adjustment reveals mandatory Increase/Decrease and Reason.
- Review opens the confirmation modal.
- Confirm shows processing, blocks double submission, shows success, then opens the updated Part Details.
- Cancel with entered values asks before discarding.

Add recognizable hover, focus, pressed, selected, disabled, and loading states to every interactive control. Do not create dead ends.
```

## Prompt 3 — 状态、验证与响应式强化

```text
Continue the same CoolCare Admin Inventory project and preserve its design. Add production-quality states and validation without redesigning the screens.

STATES
- Loading: skeleton KPI cards/tables and disabled submit actions.
- Empty inventory: explanation and Add First Part.
- Empty history: explanation and Record First Transaction.
- No results: show active search/filters and Clear Filters.
- Server error: concise message with Retry and Back.
- Success: toast with a useful follow-up link.
- Warning: low stock and unsaved changes.
- Permission denied: disabled restricted action with explanation.

VALIDATION
- Part Name: required, trimmed, 2–120 characters, unique.
- Unit Price: required, numeric, not negative.
- Status, Transaction Part, and Transaction Type: required.
- Quantity: integer greater than zero.
- Stock Out: cannot exceed current stock.
- Adjustment: requires Increase/Decrease and Reason.
- Remarks: maximum 500 characters with live count.
- Show inline errors and a top error summary; preserve all valid input after an error.

ACCESSIBILITY AND RESPONSIVENESS
- Add visible keyboard focus, logical tab order, semantic labels, tooltips, and text labels for important icons.
- Never rely on color alone for meaning; use icons and labels.
- Use minimum 44px touch targets on smaller screens.
- Tablet: icon sidebar, horizontally scrollable tables, sticky first column.
- Mobile: navigation drawer, stacked cards/forms, table-to-card layout, sticky bottom primary action.

DATA CONSISTENCY
Use the same part IDs, stock levels, transaction IDs, admins, and jobs everywhere. After confirming a prototype transaction, visually update Current Stock, projected stock, KPI totals, recent activity, and transaction history. Show “Last updated just now”.
```

## 单页修复提示词

如果 Stitch 漏掉某页，先粘贴下面这句，再写明要补的页面：

```text
Continue the existing CoolCare Admin Inventory project. Keep the exact same design system, navigation, routes, components, sample data, and interactions. Add or repair only the requested screen; do not redesign other screens. Follow all navigation, validation, loading, empty, error, success, and responsive rules from the previous prompts.
```
