# CoolCare 整合网站

唯一维护和运行的应用位于 `coolcare/`。网站界面全英文，主页沿用上传设计的蓝白配色、图片和卡片风格，品牌统一为 CoolCare。客户、技师、库存页面保留各自原设计。旧上传项目及压缩包已退出 Git 跟踪，本机参考副本保留；来源记录见 [ORIGINS.md](coolcare/ORIGINS.md)。

## 启动

需要 Node.js 22.13+ 和 Docker Desktop（Linux containers）。在仓库根目录执行：

```powershell
npm run setup
npm run db:up
npm run db:sample
npm start
```

打开 http://localhost:3000/ 。以后可在 Docker Desktop 运行后双击 `启动整合网站.cmd`。`npm run db:down` 仅停止数据库，保留数据卷。

新电脑只需要当前仓库中的文件，不需要旧 ZIP、旧项目目录或 Git LFS。`coolcare/` 包含两端前端源码、共享组件、Node API、数据库结构和迁移；根目录保留统一启动脚本、团队约定及 Postman 工作区。

`db:sample` 是可选的本机合成数据导入步骤：提供 28 笔相互关联的预约、2 份年度套餐、10 份维护报告和完整库存流水。已有业务数据时会拒绝覆盖；只有停止网站并明确使用 `--replace` 才会在备份后替换，日常 `db:up` 不清理数据。试运行、指定日期、账号和备份说明见 [SAMPLE-DATA.md](coolcare/SAMPLE-DATA.md)。

## 页面与账号

| 页面 | 地址 |
| --- | --- |
| CoolCare 主页 | `/` |
| 登录 / 注册 | `/#/login` / `/#/register` |
| 客户预约管理（取消、改期） | `/customer/bookings`（旧 `/#/bookings` 自动转入） |
| 客户 Dashboard / 预约 / 历史 | `/customer` |
| 技师工单 | `/technician/index.html` |
| Admin Console（订单、派单、员工、库存） | `/admin/orders`（`/admin/inventory` 继续兼容） |

已有测试账号共用密码 `CoolCareDemo2026!`：

- 客户：`alice.tan@coolcare.demo`
- 技师：`chris.lim@coolcare.demo`
- Owner 管理员：`norshida@coolcare.demo`

主页登录后按账号角色进入对应区域；客户可通过页头 Dashboard 进入原客户中心。公开注册始终只创建 Customer。Admin 和 Technician 使用 48 小时有效的一次性邀请链接激活账号；Owner 可邀请 Admin，Owner 或 Admin 可邀请 Technician。旧 SQLite 导入账号保留原有 bcrypt 密码，不覆盖同邮箱现有账号。

主页将服务和报价合并展示，空调数量选择实时使用 `/api/public/offers` 的目录价格计算清洗、维修检查、年度套餐总价及每次费用；目录加载失败时提示重试，不显示虚构价格。游客选定的服务、数量及故障说明在本次页面的登录/注册流程中保留，登录后继续预约。普通客户登录进入 Dashboard，所有 My Bookings 入口进入同一客户订单页。主页提前展示至少 14 天、工作日、同地址滚动 7 天最多两次及等待确认的预约规则。

客户登录后，在任意 Customer 页面点击侧边栏 **CoolCare Assistant**（手机端底部导航 **Assistant**）打开英文按钮式预约助手。通过 Service、Address、Schedule、Review 四步预约，支持服务选择帮助、问题快捷按钮和摘要快速编辑。草稿按客户账号自动保存到 MySQL，刷新或重新登录后可以恢复。确认前服务端检查最新价格及年度套餐全部四次日期；价格变化会要求重新确认。成功后显示真实订单编号、邮件状态，并可直接打开本次订单。预约历史仍在客户预约页面查看，助手不提供历史查询，也无需外部 AI API key。运行 `npm run db:up` 会应用新增的 `12-customer-assistant.sql`，保留现有数据。

客户中心提供独立的 `/customer/bookings/:id` 订单详情，可查看状态进度、自助改期或取消尚未分配的预约。**Contact support** 打开写给 `c3549521@uon.edu.au` 的邮件草稿并带上订单编号，不会自动发送。年度套餐按购买批次归组，Dashboard 优先显示最近预约，页面在返回时刷新订单状态。

头像菜单可进入个人资料和地址管理，支持修改姓名、电话、新增地址、设置默认地址和归档旧地址。修改已被订单使用的地址会保存替代地址，保留历史订单原地址。客户页面、助手和主页预约/改期使用固定英文日历；中文操作系统也显示英文月份、星期及日期，不依赖系统原生日期控件。手机端预约操作栏固定显示。

已完成订单的维护报告显示实际记录的工作时长、配件用量及可用照片，支持照片放大和 **Print / Save as PDF**。未记录的时长或缺失照片会明确提示，不生成虚构报告数据。迁移 `11-customer-address-management.sql` 随 `npm run db:up` 执行，保留已有数据。

## 数据整合

所有运行模块使用同一个 MySQL `coolcare_service_app`，地址为本机 `3307`。网站运行不依赖 SQLite 或旧项目后端。

- 登录使用服务端 HttpOnly 会话、bcrypt 校验、CSRF 和登录频率限制，不保存浏览器模拟账号或密码。
- 客户与技师身份来自登录会话，每个账号只能读取自己的预约或工单。Admin Console 按 Admin/Owner 权限校验；只有 Owner 能邀请或停用 Admin、转交所有权。
- 主页和原客户页面共用 booking、service_address、aircon_unit 等业务表，预约状态与资料可交叉读取。
- 主页支持预约提交、查询、取消和改期。只有尚未分配的 Submitted 预约可自助修改；已确认或已安排的预约需联系服务团队。
- 预约写入、设备关联、备注、状态历史采用事务；重复请求 ID 防止重复预约。
- Submitted、Confirmed、Assigned、On The Way 和 In Progress 预约占用团队时段容量；提交和改期在数据库锁内重新检查，年度套餐四次访问原子占位。
- `database/05-public-site.sql` 增加注册附加资料、预约补充资料、旧数据映射表。`npm run db:up` 自动执行非破坏性迁移与权限更新。
- 可选的旧 SQLite 导入保留来源映射和原始状态；旧库没有价格时，导入金额保留为未知。

只有需要迁移自己持有的旧 SQLite 数据时，才运行以下可选命令，并将示例路径替换为实际源文件路径。旧数据库不随 GitHub 分发：

```powershell
cd coolcare
node scripts/import-accare.mjs "C:/path/to/ac-care.db"
```

导入以只读方式打开源文件，通过来源映射去重，可重复运行；不会重复创建同一条历史预约。`--help` 仅显示用法，不访问数据库。普通安装无需运行导入。

## 范围说明

原页面的 Google / Apple 登录及邮件找回密码没有配置外部提供商，界面会明确提示不可用。预约通知已接入邮件队列，本机默认由 Mailpit 测试邮箱接收；这与找回密码是不同功能。首页已移除未实现的促销和示例评价，价格卡片读取当前数据库目录。

Admin Console 已提供订单审核、自动派单、员工邀请和库存管理；Technician 工单只能按顺序推进状态。服务端会话目前存放内存，重启后需要重新登录。

## 最新业务规则与预约邮件

客户预约只需选择服务、填写地址和空调数量、选择时间并确认，不再逐台勾选已登记的空调。地址步骤的 **Add new address** 会将地址保存到当前客户账号，供本次和后续预约使用；没有已登记设备的新客户也可预约。Dashboard 的 UPCOMING 卡片及数量按新加坡当前时间筛选尚未开始的有效预约，并显示最近一单。

新预约和自助改期须按新加坡日期至少提前 **14 个自然日**，只接受 **周一至周五**，周六日不营业。My Bookings 显示 Submitted、Confirmed、Assigned 及进行中的订单；Completed、Rejected 和 Cancelled 在 Booking History 查看，拒绝原因对客户可见。

同一客户对同一地址，在任意连续 7 天的服务日期内最多预约两次，取消的订单不计入。客户必须注册并登录，只需选择 **Cleaning、Repair 或 Annual Cleaning Bundle**。Membership 已退出新预约流程，原有订单、订阅和报告保留。

唯一年度 Bundle 一次提交保存四条关联预约，日期为首次预约及其后第 3、6、9 个月，后续日期遇周末顺延到周一，确认前显示实际日期；预约仍需服务团队确认。全年价格按四次分摊，每次服务后结算，不会在创建预约时声称完成支付。普通或化学清洗由技师检查后记录，额外工作另行确认报价。当前价格、参考来源和交付边界见 [SERVICE-PRICING.md](coolcare/SERVICE-PRICING.md)。

订单固定经过 `Submitted → Confirmed → Assigned → On The Way → In Progress → Completed`。Admin 必须先在 Orders 批准，再在 Dispatch 单独触发自动派单；系统按目标日期负载、最久未派单时间和 technician ID，从无重叠工单的 Active/Available Technician 中选择。拒绝订单必须填写客户可见原因并进入 Rejected；取消、拒绝和完成都会释放团队容量。

Owner/Admin 可邀请 Technician 并管理其可用状态；Owner 还可管理 Admin，并把唯一 Owner 身份原子转交给另一名 Active Admin。管理员可修改入库/出库数量、时间及描述，修改保留审计记录并同步库存。技师可在自己的工单内出库；配件按每台空调用量标准提示超量，并可查看相关地址及年度 Bundle 维护报告。清洗方法评估记录同样有权限、并发版本和修改审计。

运行 `npm run db:up` 会保留旧数据并更新所需数据表，同时启动本机测试邮箱。预约后打开 **http://localhost:8025** 查看自动生成的邮件。该邮箱用于课堂演示，**不会向客户外部邮箱投递**；正式投递需要在本机配置经过验证的 SMTP 发件账号。详细规则、数据表及配置见 [BOOKING-WORKFLOWS.md](coolcare/BOOKING-WORKFLOWS.md)。

## 验证

本轮仓库与数据整理已验证：脱离旧目录的安装配置、非破坏性迁移、合成数据、事务回滚测试、TypeScript 和完整构建。员工流程的真实 MySQL 集成测试覆盖邀请安全、Owner 唯一性、审核与派单分离、轮询、工单状态顺序及最后一个容量名额的并发竞争。完整私人备份保存在本机 `.local/backups/`，不提交 GitHub。

```powershell
npm test
npm --prefix coolcare run test:db
node coolcare/node_modules/typescript/bin/tsc --noEmit -p coolcare/tsconfig.json
npm run build
```

当前 **82 项测试**通过（37 项主应用、4 项技师、41 项真实 MySQL 集成测试）。覆盖客户与记录归属、CSRF、事务、幂等重试、地址保留与默认/归档、账号切换保护、预约限制、年度套餐、库存审计、时间戳时区及私有照片 HTTP 权限；还覆盖助手草稿恢复、员工邀请、Owner 转交、审核、拒绝、派单、重新派单、技师状态和团队容量并发锁。数据库测试通过事务回滚清理，自增编号可能出现空号。

本轮浏览器检查覆盖桌面及 390px 手机布局：最近预约、年度分组与详情切换、资料保存后重新读取、新增/默认/编辑/归档地址、保留订单原地址、重复预约日期禁用、英文日历与键盘选日、真实改期/取消及历史分流、助手创建四次年度预约、报告时长、缺失照片提示及真实文件放大。日期格式测试使用中文语言环境和多个系统时区，日期控件固定显示英文。测试账号、地址、订单和照片均独立于已有数据，验证后清理。

PDF 功能调用浏览器打印窗口并提供专用打印样式；本轮未验收操作系统打印/PDF 对话框。客服邮件链接只预填收件人和订单编号，未发送外部邮件。本轮属于客户流程验收，不代表生产环境部署验收。

## GitHub

组员使用 Codex 时，先在各自电脑 clone 并打开这个仓库；根目录 `AGENTS.md` 提供统一的项目约定。所有开发在 `coolcare/` 进行，旧项目不会出现在新的 clone 中。

首次获取：

```powershell
git clone https://github.com/YuZixiong3549521/3851b.git
cd 3851b
npm run setup
npm run db:up
npm run db:sample
npm start
```

按项目负责人的最新约定，后续通过验证的更新直接提交并推送到 `main`，除非另行要求使用分支或 Pull Request。推送前先获取并整合远端改动，不强制推送；拉取前先提交或妥善保存当前修改。依赖有变化时重新安装对应依赖，数据库迁移有变化时运行 `npm run db:up`。

**每位组员的本机数据库是独立的。** GitHub 同步代码、建表/迁移文件和合成数据生成脚本，不会同步本机创建的订单、Docker 数据卷、登录会话或私人备份。课堂演示可导入 `coolcare/postman/CoolCare-Booking-Demo.postman_collection.json`，在自己的机器上创建订单，再运行 `node coolcare/scripts/verify-booking.mjs <订单编号>` 直接查询 MySQL。详见 `coolcare/postman/README.md`。

统一 UI 约定位于 `coolcare/UI-ARCHITECTURE.md`：各端复用 shadcn/ui、Base UI、Tailwind 和 Lucide。

`.gitignore` 排除本机凭据、依赖、生成文件、IDE 缓存及旧上传参考目录。原上传文件可从历史提交查阅，不再占据当前分支的项目列表。同步更新使用 `git pull --ff-only origin main`，首次运行按上方安装步骤准备本机环境。

公开部署前需要配置持久化会话、HTTPS、邮件及可选 OAuth 服务；当前服务只面向本机运行。
