# CoolCare / AC Care 整合网站

整合版位于 `coolcare/`，原来的项目和 `accare/` 保留为来源备份。网站界面全英文，主页使用上传的 AC Care 设计，客户、技师、库存页面保留各自原设计。

## 启动

需要 Node.js 22.13+ 和 Docker Desktop（Linux containers）。在仓库根目录执行：

```powershell
npm run setup
npm run db:up
npm start
```

打开 http://localhost:3000/ 。以后可在 Docker Desktop 运行后双击 `启动整合网站.cmd`。`npm run db:down` 仅停止数据库，保留数据卷。

## 页面与账号

| 页面 | 地址 |
| --- | --- |
| AC Care 主页 | `/` |
| 登录 / 注册 | `/#/login` / `/#/register` |
| 主页预约管理（取消、改期） | `/#/bookings` |
| 客户 Dashboard / 预约 / 历史 | `/customer` |
| 技师工单 | `/technician/index.html` |
| 库存后台 | `/admin/inventory` |

已有测试账号共用密码 `CoolCareDemo2026!`：

- 客户：`alice.tan@coolcare.demo`
- 技师：`chris.lim@coolcare.demo`
- 管理员：`norshida@coolcare.demo`

主页登录后按账号角色进入对应区域；客户可通过页头 Dashboard 进入原客户中心。也支持注册新客户。旧 SQLite 导入账号保留原有 bcrypt 密码，不覆盖同邮箱现有账号。

客户登录后，在 `/customer` Dashboard 点击 **Ask CoolCare Assistant** 打开英文按钮式预约助手。可按服务、数量、时间、地址及联系方式逐步创建预约。提交前有摘要确认，成功后显示真实订单编号并更新 Dashboard，还可开始另一笔预约。预约历史和订单详情仍可在客户预约页面查看。助手复用现有 MySQL 接口和权限校验，无需外部 AI API key；对话本身不存入数据库。

## 数据整合

所有运行模块使用同一个 MySQL `coolcare_service_app`，地址为本机 `3307`。不再启动 accare 的独立 SQLite 后端。

- 登录使用服务端 HttpOnly 会话、bcrypt 校验、CSRF 和登录频率限制，不保存浏览器模拟账号或密码。
- 客户与技师身份来自登录会话，每个账号只能读取自己的预约或工单。管理员库存权限独立校验。
- 主页和原客户页面共用 booking、service_address、aircon_unit 等业务表，预约状态与资料可交叉读取。
- 主页支持预约提交、查询、取消和改期。只有尚未分配的 Submitted 预约可自助修改；已安排工单的预约需联系服务团队。
- 预约写入、设备关联、备注、状态历史采用事务；重复请求 ID 防止重复预约。
- `database/05-public-site.sql` 增加注册附加资料、预约补充资料、旧数据映射表。`npm run db:up` 自动执行非破坏性迁移与权限更新。
- 上传 SQLite 的 4 个账号、3 条预约已在本机导入。原文件不变。旧库没有价格，因此导入预约的金额保留为未知，不编造历史价格。

其他电脑如需导入上传的历史记录，启动数据库后执行：

```powershell
cd coolcare
node scripts/import-accare.mjs
```

导入通过来源映射去重，可重复运行；不会重复创建同一条历史预约。

## 范围说明

原页面的 Google / Apple 登录及邮件找回密码没有配置外部提供商，界面会明确提示不可用。预约通知已接入邮件队列，本机默认由 Mailpit 测试邮箱接收；这与找回密码是不同功能。首页已移除未实现的促销和示例评价，价格卡片读取当前数据库目录。

本次整合现有页面，未新增后台派单页面或技师状态编辑页面。客户预约仍需有有效 assignment 与 work_order 后才进入技师工单列表。服务端会话目前存放内存，重启后需要重新登录。

## 最新业务规则与预约邮件

新预约和自助改期须按新加坡日期至少提前 **14 个自然日**，只接受 **周一至周五**，周六日不营业。My Bookings 只显示未完成、未取消的订单；Completed 和 Cancelled 在 Booking History 查看，旧记录保留。

同一客户对同一地址，在任意连续 7 天的服务日期内最多预约两次，取消的订单不计入。客户必须注册并登录，只需选择 **Cleaning、Repair 或 Annual Cleaning Bundle**。Membership 已退出新预约流程，原有订单、订阅和报告保留。

唯一年度 Bundle 一次提交保存四条关联预约，日期为首次预约及其后第 3、6、9 个月，后续日期遇周末顺延到周一，确认前显示实际日期；预约仍需服务团队确认。全年价格按四次分摊，每次服务后结算，不会在创建预约时声称完成支付。普通或化学清洗由技师检查后记录，额外工作另行确认报价。当前价格、参考来源和交付边界见 [SERVICE-PRICING.md](coolcare/SERVICE-PRICING.md)。

管理员可修改入库/出库数量、时间及描述，修改保留审计记录并同步库存。技师可在自己的工单内出库；配件按每台空调用量标准提示超量，并可查看相关地址及年度 Bundle 维护报告。清洗方法评估记录同样有权限、并发版本和修改审计。

运行 `npm run db:up` 会保留旧数据并更新所需数据表，同时启动本机测试邮箱。预约后打开 **http://localhost:8025** 查看自动生成的邮件。该邮箱用于课堂演示，**不会向客户外部邮箱投递**；正式投递需要在本机配置经过验证的 SMTP 发件账号。详细规则、数据表及配置见 [BOOKING-WORKFLOWS.md](coolcare/BOOKING-WORKFLOWS.md)。

## 验证

```powershell
npm test
npm --prefix coolcare run test:db
cd coolcare
node node_modules/typescript/bin/tsc --noEmit
cd ..
npm run build
```

40 项自动化测试通过，覆盖注册登录、角色及记录归属、两套预约接口、14 天提前量、新加坡跨日与周末限制、四次年度预约与邮件的原子写入、重复请求、季度内改期、取消、库存审计及技师清洗评估。TypeScript 和两套生产构建通过。数据库测试采用事务回滚，自增编号可能出现空号。

最新浏览器验证覆盖两套 My Bookings 的状态过滤、Completed/Cancelled 历史、三个预约入口的日期拦截、年度周末顺延预览，以及桌面/390px 布局。运行中的本机接口也验证了两套创建接口和改期的 9 次无效日期拒绝，订单未被创建或修改。

本次浏览器检查覆盖首页三项服务及动态价格、登录前拦截、客户预约页、助手年度预约完整提交、订单列表、技师评估真实保存和桌面/390px 布局。浏览器创建的四条年度测试预约已取消；技师独立 QA 数据已清理。邮件经本机 SMTP 接收验证。未将该范围声明为全站上线验收。

## GitHub

组员使用 Codex 时，先在各自电脑 clone 并打开这个仓库；根目录 `AGENTS.md` 提供统一的项目约定。实际开发目录为 `coolcare/`，原始项目目录保留作参考。

首次获取：

```powershell
git clone https://github.com/YuZixiong3549521/3851b.git
cd 3851b
npm run setup
npm run db:up
npm start
```

日常协作建议从最新 `main` 新建各自的 `codex/任务名` 分支，通过 Pull Request 合并，避免多人直接修改同一个分支。拉取前先提交或妥善保存当前修改；依赖有变化时重新安装对应依赖，数据库迁移有变化时运行 `npm run db:up`。

**每位组员的本机数据库是独立的。** GitHub 同步代码和建表/迁移文件，不会同步本机创建的订单、Docker 数据卷或登录会话。课堂演示可导入 `coolcare/postman/CoolCare-Booking-Demo.postman_collection.json`，在自己的机器上创建订单，再运行 `node coolcare/scripts/verify-booking.mjs <订单编号>` 直接查询 MySQL。详见 `coolcare/postman/README.md`。

统一 UI 约定位于 `coolcare/UI-ARCHITECTURE.md`：各端复用 shadcn/ui、Base UI、Tailwind 和 Lucide。

`.gitignore` 排除本机凭据、依赖、生成文件和 IDE 缓存。原先三个 ZIP 已用解压后的源代码目录替代。`accare.zip` 保留为上传的原始设计来源。同步更新使用 `git pull --ff-only origin main`，首次运行按上方安装步骤准备本机环境。

公开部署前需要配置持久化会话、HTTPS、邮件及可选 OAuth 服务；当前服务只面向本机运行。
