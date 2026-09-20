# CoolCare 本机整合版

从仓库根目录运行 `npm run setup`、`npm run db:up`、`npm start`。

首次运行可在启动前执行 `npm run db:sample`，生成相互关联的合成预约、报告和库存记录。已有数据必须先备份并明确使用 `--replace`；详见 [SAMPLE-DATA.md](SAMPLE-DATA.md)。日常迁移不会覆盖业务数据。

完整启动方式、模块说明、测试和 GitHub 注意事项见 [仓库说明](../README.md)。

- 首页：http://localhost:3000/
- 客户端：http://localhost:3000/customer
- 技师端：http://localhost:3000/technician/index.html
- Admin Console：http://localhost:3000/admin/orders
- 库存兼容入口：http://localhost:3000/admin/inventory

本目录为整合后的主应用；`technician/` 在构建时输出静态页面到 `public/technician/`。
客户、Admin、Technician 和库存 API 共用 `server/app.mjs` 及同一 MySQL 连接池。公开注册只创建 Customer；员工通过邀请链接激活。首次没有 Owner 时可在 `coolcare/` 运行 `npm run staff:bootstrap-owner -- --email <email>`，脚本会提示输入其他资料和密码。
数据库环境文件由 setup 自动生成，已加入 Git 忽略。

启动和构建不依赖仓库外或旧上传项目中的文件。数据库结构、迁移、种子数据、共享 UI 和技师源码均保存在本目录。

`scripts/import-accare.mjs` 仅用于可选的旧 SQLite 资料迁移；必须显式提供本机源文件路径，不随 GitHub 分发旧数据库。查看用法：`node scripts/import-accare.mjs --help`。

## Technician completion workflow (2026-09-18)

Run npm run db:up once to apply 15-technician-completion.sql and the service_report write grants. Existing records are retained. The technician list refreshes every 30 seconds while visible and on focus/reconnect, with a manual Refresh jobs button. New assignments show an in-page notice.

Start journey -> Start service -> Submit report & complete. Starting service records Singapore local start time; completion requires work performed and checks completed. Report, booking/work-order/assignment statuses and status history commit together. Request IDs prevent duplicate writes and reject changed-content retries. Completed reports are read-only. Legacy in-progress jobs without a recorded start retain unknown duration rather than inventing one.

Customer report pages read the same service_report; Admin order details now include the submitted report. This does not add email or push notifications. Vite uses its native config loader for Windows compatibility.

## Technician reports and profile

Migration `16-technician-pages.sql` adds the report revision log and optional technician primary region without replacing business records. The normal `npm run db:up` applies it and grants the application write permissions.

- `/technician/index.html#reports` lists the signed-in technician's In Progress/Completed jobs, including pending reports. Search, English service-date filtering, status filters and pagination use actual API data. `GET /api/technician/reports`, `GET /reports/:jobId` and `PUT /reports/:jobId` are session/role/ownership protected.
- Required work performed and checks, optional problems, solutions and customer/technician HTTPS signature-image URLs map to `service_report`. The private signature capture flow below supersedes manual URL entry. Old seeded links may point to unavailable example images.
- Submitting an In Progress report atomically completes the work order, booking and assignment. Submitted reports remain editable by the assigned technician. Edits retain original submission/start/completion times, use optimistic content versions, store before/after revision snapshots and safely replay request IDs. Historical missing duration stays unknown. Customer and Admin report readers see the updated service_report fields.
- `/technician/index.html#profile` reads the authenticated account and edits full name, phone, primary region and availability. Email, role and account activation are read-only. Primary region is descriptive; it is not a new dispatch constraint. Availability uses the same technician column and roster lock as dispatch. Concurrent edits conflict instead of overwriting changes.
- `POST /api/technician/password` verifies the current password, confirmation, length and bcrypt byte limit, applies rate limiting and saves a bcrypt hash. Changing a password does not revoke already-existing in-memory sessions; restarting the local API ends all sessions. No passwords are changed by the UI verification.
- Sidebar logout ends the current session. New pages reuse shared UI controls and responsive portal styling. API tests roll back changes to reports/profiles/passwords.

## Private report signatures

Migration `17-report-signatures.sql` replaces manual signature URL entry with mouse/touch drawing, PNG/JPEG upload, preview and clear/re-sign controls. Existing historical reports are preserved. The Service Reports form uploads each new signature on submission, then saves its generated private reference in the existing `customer_signature_url` / `technician_signature_url` fields. My Jobs sends completion work to Service Reports so the signature controls are available.

`POST /api/technician/reports/:jobId/signatures/:signer` accepts a bounded image data URL and the reviewed report text/version, with session, Technician ownership, CSRF and upload rate limiting. Sharp fully decodes PNG/JPEG (2 MB / 12 megapixels maximum), rejects blank/invalid input, strips metadata by re-encoding and stores a normalized PNG in `.local/report-signatures/`. This directory is private and ignored by Git. A database row binds each image to its job, uploader, signer, report text hash and base version. Include this folder and MySQL together in local backups; Git does not transfer signatures.

`GET /api/report-signatures/:id` verifies the current session and serves images with `private, no-store` caching. Assigned technicians may preview their uploads; customers may read only currently attached, submitted signatures on their own bookings; active admins may read currently attached submitted signatures. Arbitrary external signature URLs are never loaded as images. Legacy example links are labelled unavailable.

If any service text changes, the editor clears both signature inputs. The server independently requires each previously signed party to provide a new image bound to the changed content; old signatures cannot be reused by sending their URLs. Earlier snapshots and files remain for audit, but customer/admin views only show current signatures. Uploaded images from a cancelled or failed submission may remain staged privately; they are not customer-visible. A drawn or uploaded image records an acknowledgement, not verified identity or a certified digital signature.

First-time signatures remain optional for compatibility with existing unsigned reports. Editing a previously signed report requires recollecting the applicable signatures. No real customer signatures or business reports are changed during automated tests; synthetic image files are cleaned up and MySQL edits roll back.


## Service process photo attachments

Migration `18-service-photo-upload.sql` adds an idempotent upload ledger and grants INSERT on the existing `photo` table. Technicians can attach before/during/after service photos from Service Reports, with a required note (1–255 characters) for each image. Select up to five PNG/JPEG files per batch, at most 5 MB / 40 megapixels each, and up to 30 photos per job. The UI previews selections, allows removing unuploaded selections, and explicitly saves them using **Upload photos & notes**. Already uploaded photos are append-only attachments; notes are entered before upload.

Photos are saved independently of the service-text/signature submission. They have their own recorded/upload time and do not alter the signed text. Customer reports use the existing `photo` reader and show the same notes; Admin report details also show these attachments. Reopening the report reloads saved photos. This extension does not add photo deletion or post-upload note editing.

`POST /api/technician/reports/:jobId/photos` requires the assigned active Technician, CSRF, an In Progress/Completed work order and a unique request ID. Uploads are fully decoded and re-encoded as JPEG with metadata removed, preserving orientation and fitting within 2400×2400. Private files stay in `.local/service-photos/`; MySQL stores their filenames, notes and timestamps. Lost responses replay the same photo ID without duplicate inserts. A partial batch retains only unfinished selections for retry.

`GET /api/technician/reports/:jobId/photos` lists owned attachments. `GET /api/service-photos/:photoId` checks active account/role and job/customer ownership, with private no-store caching. Existing customer report-photo URLs stay compatible. Include `.local/service-photos/` with database backups; Git does not transfer uploaded files. Runtime failures before commit remove newly created test/failed files; uncertain commits retain files so a successful upload is not broken by a lost acknowledgement.
